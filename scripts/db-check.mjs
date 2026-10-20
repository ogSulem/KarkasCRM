#!/usr/bin/env node
// Проверка базы без остановки CRM: что лежит, нет ли «висячих» строк,
// цела ли база. Запуск:
//   npm run db:check          — только отчёт (ничего не меняет)
//   npm run db:clean          — убрать осиротевшие строки, старую ленту и файлы
//   node --experimental-sqlite scripts/db-check.mjs --data=/путь/к/данным
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { auditDatabase, dailyMaintenance } from '../backend/src/maintenance.js';

const args = process.argv.slice(2);
const clean = args.includes('--clean') || args.includes('--fix');
const dataArg = args.find(a => a.startsWith('--data='));
const DATA_DIR = resolve(dataArg ? dataArg.slice('--data='.length) : (process.env.DATA_DIR || './data'));
const DB = join(DATA_DIR, 'crm.db');
const UPLOADS = join(DATA_DIR, 'uploads');

if (!existsSync(DB)) {
  console.error(`База не найдена: ${DB}`);
  console.error('Укажите каталог данных: npm run db:check -- --data=/data (в Docker) или DATA_DIR=./data.');
  process.exit(1);
}

const db = new DatabaseSync(DB, { readOnly: !clean });
db.exec('PRAGMA busy_timeout=5000');
const human = n => new Intl.NumberFormat('ru-RU').format(n);
const mb = bytes => (bytes / 1048576).toFixed(2) + ' МБ';
const sizeOf = dir => {
  if (!existsSync(dir)) return { files: 0, bytes: 0 };
  let files = 0, bytes = 0;
  for (const f of readdirSync(dir)) { try { const st = statSync(join(dir, f)); if (st.isFile()) { files++; bytes += st.size; } } catch {} }
  return { files, bytes };
};

console.log(`База: ${DB}`);
console.log(`Размер файла базы: ${mb(statSync(DB).size)}`);

if (clean) {
  const m = dailyMaintenance(db, { uploadDir: UPLOADS });
  const removed = Object.values(m.orphans).reduce((a, b) => a + b, 0);
  console.log(`\nУборка выполнена: строк-сирот убрано ${removed}, событий ленты ${m.activitiesTrimmed}, ` +
    `отчётов конкурентов ${m.reportsTrimmed}, файлов чатов ${m.uploads.removed} (${mb(m.uploads.bytes)}), ` +
    `имён ответственных обновлено ${m.synced}.`);
}

const report = auditDatabase(db);
const labels = {
  notes: 'заметки удалённых карточек', deal_products: 'позиции удалённых сделок',
  tasks_deal: 'задачи со ссылкой на удалённую сделку', tasks_contact: 'задачи со ссылкой на удалённого клиента',
  conversations: 'чаты без клиента', messages: 'сообщения без чата',
  contacts_company: 'контакты со ссылкой на удалённую компанию',
  deals_contact: 'сделки со ссылкой на удалённого клиента', deals_company: 'сделки со ссылкой на удалённую компанию',
};

console.log('\nЗаписи в базе:');
const names = {
  users: 'Сотрудники', companies: 'Компании', contacts: 'Клиенты', deals: 'Сделки', tasks: 'Задачи',
  notes: 'Заметки', products: 'Каталог', deal_products: 'Позиции сделок', templates: 'Шаблоны',
  automations: 'Автоматизации', channels: 'Каналы', conversations: 'Чаты', messages: 'Сообщения',
  activities: 'Лента событий', settings: 'Настройки', pipelines: 'Воронки', stages: 'Этапы',
};
for (const [key, value] of Object.entries(report.counts)) {
  if (value !== null && (value > 0 || ['users', 'contacts', 'deals', 'tasks', 'messages'].includes(key))) {
    console.log(`  ${(names[key] || key).padEnd(22)} ${human(value).padStart(10)}`);
  }
}

const orph = Object.entries(report.orphans).filter(([, n]) => n);
console.log('\nСвязанность данных:');
if (!orph.length) console.log('  ✅ потерявших родителя строк нет');
else for (const [key, n] of orph) console.log(`  ❌ ${labels[key] || key}: ${human(n)}`);

console.log('\nЦелостность:');
console.log(`  ${report.integrity === 'ok' ? '✅' : '❌'} integrity_check: ${report.integrity}`);
console.log(`  ${report.foreignKeyIssues ? '❌' : '✅'} внешние ключи: ${report.foreignKeyIssues ? report.foreignKeyIssues + ' нарушений' : 'нарушений нет'}`);

const backups = sizeOf(join(DATA_DIR, 'backups'));
const uploads = sizeOf(UPLOADS);
console.log('\nФайлы:');
console.log(`  резервные копии: ${backups.files} шт., ${mb(backups.bytes)}`);
console.log(`  вложения чатов:  ${uploads.files} шт., ${mb(uploads.bytes)}`);

db.close();
const ok = report.integrity === 'ok' && report.foreignKeyIssues === 0 && report.orphanTotal === 0;
if (!ok && !clean) console.log('\nЧтобы убрать безопасно: npm run db:clean');
console.log(ok ? '\n✅ База в порядке.' : '\n❌ Есть замечания — см. выше.');
process.exit(ok ? 0 : 1);
