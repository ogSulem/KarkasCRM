// Обслуживание базы: поиск «осиротевших» строк, мягкая уборка и отчёт.
// Модуль ничего не знает про HTTP — его используют сервер (при старте и по
// расписанию), CLI-проверка `scripts/db-check.mjs` и тесты.
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';

const NOTES_ORPHAN = `(
  entity_type IS NULL
  OR entity_type NOT IN ('contacts', 'deals', 'companies')
  OR entity_id IS NULL
  OR (entity_type = 'contacts'  AND NOT EXISTS (SELECT 1 FROM contacts  WHERE id = notes.entity_id))
  OR (entity_type = 'deals'     AND NOT EXISTS (SELECT 1 FROM deals     WHERE id = notes.entity_id))
  OR (entity_type = 'companies' AND NOT EXISTS (SELECT 1 FROM companies WHERE id = notes.entity_id))
)`;

const CHECKS = {
  notes: `SELECT COUNT(*) n FROM notes WHERE ${NOTES_ORPHAN}`,
  deal_products: `SELECT COUNT(*) n FROM deal_products
    WHERE deal_id IS NULL OR NOT EXISTS (SELECT 1 FROM deals WHERE id = deal_products.deal_id)`,
  tasks_deal: `SELECT COUNT(*) n FROM tasks
    WHERE deal_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM deals WHERE id = tasks.deal_id)`,
  tasks_contact: `SELECT COUNT(*) n FROM tasks
    WHERE contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contacts WHERE id = tasks.contact_id)`,
  conversations: `SELECT COUNT(*) n FROM conversations
    WHERE contact_id IS NULL OR NOT EXISTS (SELECT 1 FROM contacts WHERE id = conversations.contact_id)`,
  messages: `SELECT COUNT(*) n FROM messages
    WHERE conversation_id IS NULL OR NOT EXISTS (SELECT 1 FROM conversations WHERE id = messages.conversation_id)`,
  contacts_company: `SELECT COUNT(*) n FROM contacts
    WHERE company_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM companies WHERE id = contacts.company_id)`,
  deals_contact: `SELECT COUNT(*) n FROM deals
    WHERE contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contacts WHERE id = deals.contact_id)`,
  deals_company: `SELECT COUNT(*) n FROM deals
    WHERE company_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM companies WHERE id = deals.company_id)`,
};

const TABLES = ['users', 'companies', 'contacts', 'pipelines', 'stages', 'deals', 'tasks', 'notes',
  'products', 'deal_products', 'templates', 'automations', 'channels', 'conversations', 'messages',
  'settings', 'activities'];

/** Что лежит в базе и есть ли «висячие» строки. Только чтение. */
export function auditDatabase(db) {
  const counts = {};
  for (const t of TABLES) {
    try { counts[t] = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n; } catch { counts[t] = null; }
  }
  const orphans = {};
  let total = 0;
  for (const [key, sql] of Object.entries(CHECKS)) {
    try { orphans[key] = db.prepare(sql).get().n; total += orphans[key]; } catch { orphans[key] = null; }
  }
  let integrity = 'unknown', foreignKeys = [];
  try { integrity = String(db.prepare('PRAGMA integrity_check').get().integrity_check); } catch (e) { integrity = 'ошибка проверки: ' + e.message; }
  try { foreignKeys = db.prepare('PRAGMA foreign_key_check').all(); } catch { foreignKeys = []; }
  return { counts, orphans, orphanTotal: total, integrity, foreignKeyIssues: foreignKeys.length, foreignKeys };
}

/**
 * Убирает только то, что уже потеряло родителя: заметки удалённых карточек,
 * позиции удалённых сделок, ссылки задач на несуществующие записи и чаты без
 * клиента. Данные пользователей не затрагиваются.
 */
export function cleanupOrphans(db) {
  const removed = { notes: 0, deal_products: 0, conversations: 0, messages: 0, tasksUnlinked: 0, contactsUnlinked: 0, dealsUnlinked: 0 };
  db.exec('BEGIN IMMEDIATE');
  try {
    const run = sql => db.prepare(sql).run().changes;
    removed.messages += run(`DELETE FROM messages
      WHERE conversation_id IS NULL OR NOT EXISTS (SELECT 1 FROM conversations WHERE id = messages.conversation_id)`);
    removed.conversations += run(`DELETE FROM conversations
      WHERE contact_id IS NULL OR NOT EXISTS (SELECT 1 FROM contacts WHERE id = conversations.contact_id)`);
    removed.notes += run(`DELETE FROM notes WHERE ${NOTES_ORPHAN}`);
    removed.deal_products += run(`DELETE FROM deal_products
      WHERE deal_id IS NULL OR NOT EXISTS (SELECT 1 FROM deals WHERE id = deal_products.deal_id)`);
    removed.tasksUnlinked += run(`UPDATE tasks SET deal_id = NULL
      WHERE deal_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM deals WHERE id = tasks.deal_id)`);
    removed.tasksUnlinked += run(`UPDATE tasks SET contact_id = NULL
      WHERE contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contacts WHERE id = tasks.contact_id)`);
    removed.tasksUnlinked += run(`UPDATE tasks SET responsible_id = NULL
      WHERE responsible_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = tasks.responsible_id)`);
    removed.contactsUnlinked += run(`UPDATE contacts SET company_id = NULL
      WHERE company_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM companies WHERE id = contacts.company_id)`);
    removed.dealsUnlinked += run(`UPDATE deals SET contact_id = NULL
      WHERE contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contacts WHERE id = deals.contact_id)`);
    removed.dealsUnlinked += run(`UPDATE deals SET company_id = NULL
      WHERE company_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM companies WHERE id = deals.company_id)`);
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK') } catch {} throw e }
  return removed;
}

/** Имя ответственного в старом текстовом поле должно совпадать с карточкой сотрудника. */
export function syncDealResponsibleNames(db) {
  return db.prepare(`UPDATE deals
    SET responsible = (SELECT name FROM users WHERE id = deals.responsible_id)
    WHERE responsible_id IS NOT NULL
      AND COALESCE(responsible, '') <> COALESCE((SELECT name FROM users WHERE id = deals.responsible_id), '')`).run().changes;
}

/** Лента активности не растёт бесконечно: по умолчанию храним 20 000 последних событий. */
export function trimActivities(db, keep = 20000) {
  if (!Number.isFinite(keep) || keep <= 0) return 0;
  return db.prepare('DELETE FROM activities WHERE id NOT IN (SELECT id FROM activities ORDER BY id DESC LIMIT ?)').run(keep).changes;
}

/**
 * Файлы чата, на которые больше никто не ссылается и которые старше keepDays,
 * удаляются: иначе папка uploads растёт после удаления переписок.
 */
export function cleanupUploads(db, uploadDir, { keepDays = 7, now = Date.now() } = {}) {
  const res = { removed: 0, bytes: 0 };
  if (!uploadDir || !existsSync(uploadDir)) return res;
  const used = new Set();
  try {
    for (const row of db.prepare("SELECT content_uri FROM messages WHERE content_uri LIKE '/uploads/%'").all()) {
      try { used.add(basename(new URL(String(row.content_uri), 'http://local').pathname)); } catch {}
    }
  } catch { return res; }
  const limit = now - Math.max(0, Number(keepDays) || 0) * 864e5;
  for (const name of readdirSync(uploadDir)) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
    const file = join(uploadDir, name);
    try {
      const st = statSync(file);
      if (!st.isFile() || used.has(name) || st.mtimeMs > limit) continue;
      unlinkSync(file);
      res.removed++;
      res.bytes += st.size;
    } catch {}
  }
  return res;
}

/** История проверок конкурентов: для каждой карточки храним последние keep отчётов. */
export function trimCompetitorReports(db, keep = 50) {
  if (!Number.isFinite(keep) || keep <= 0) return 0;
  try {
    return db.prepare(`DELETE FROM competitor_reports WHERE id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY competitor_id ORDER BY id DESC) AS rn
        FROM competitor_reports
      ) WHERE rn <= ?
    )`).run(keep).changes;
  } catch { return 0; } // старая база без таблицы конкурентов
}

/** Полная ежедневная уборка: осиротевшие строки, лента, отчёты и старые файлы чатов. */
export function dailyMaintenance(db, { uploadDir, uploadKeepDays = 7 } = {}) {
  const orphans = cleanupOrphans(db);
  const synced = syncDealResponsibleNames(db);
  const activitiesTrimmed = trimActivities(db, 20000);
  const reportsTrimmed = trimCompetitorReports(db, 50);
  const uploads = uploadDir ? cleanupUploads(db, uploadDir, { keepDays: uploadKeepDays }) : { removed: 0, bytes: 0 };
  return { orphans, synced, activitiesTrimmed, reportsTrimmed, uploads };
}
