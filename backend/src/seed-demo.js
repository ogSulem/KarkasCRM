// Явное заполнение только пустой, ранее инициализированной базы.
// Обычный запуск CRM заполняет базу автоматически (SEED_MODE) —
// этот скрипт для ручного контроля и тестов.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { seedBase, seedDemo } from './seed.js';
const dir = process.env.DATA_DIR || fileURLToPath(new URL('../../data', import.meta.url));
const file = join(dir, 'crm.db');
if (!process.argv.includes('--confirm-test-data')) throw new Error('Только для тестовой базы: добавьте --confirm-test-data');
if (!existsSync(file)) throw new Error('Сначала запустите CRM для инициализации базы');
const db = new DatabaseSync(file);
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
try {
  for (const table of ['contacts', 'deals', 'tasks', 'products', 'templates', 'conversations', 'competitors']) {
    if (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n) throw new Error(`База не пустая (${table}). Заполнение отменено, данные не изменены.`);
  }
  const admin = db.prepare("SELECT id,name FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1").get();
  if (!admin) throw new Error('Нужен администратор');
  const mode = process.argv.includes('--base') ? 'base' : 'demo';
  if (mode === 'base') {
    seedBase(db, admin.id, 0);
    console.log('Созданы начальные данные: каталог, шаблоны администратора, правило автоматизации.');
  } else {
    seedDemo(db, admin.id, admin.name);
    console.log('Созданы демо-данные: 7 клиентов, 9 сделок, 6 задач, 3 чата, 2 конкурента, каталог и шаблоны. Сообщения не отправлялись.');
  }
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; }
finally { db.close(); }
