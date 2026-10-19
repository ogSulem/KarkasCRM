// Явное заполнение только пустой, ранее инициализированной тестовой базы.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const dir = process.env.DATA_DIR || fileURLToPath(new URL('../../data', import.meta.url));
const file = join(dir, 'crm.db');
if (!process.argv.includes('--confirm-test-data')) throw new Error('Только для тестовой базы: добавьте --confirm-test-data');
if (!existsSync(file)) throw new Error('Сначала запустите CRM для инициализации базы');
const db = new DatabaseSync(file);
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
try {
  for (const table of ['contacts', 'companies', 'deals', 'tasks', 'products', 'templates', 'conversations', 'competitors']) {
    if (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n) throw new Error(`База не пустая (${table}). Заполнение отменено, данные не изменены.`);
  }
  const admin = db.prepare("SELECT id,name FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1").get();
  const stage = db.prepare("SELECT code,pipeline_id FROM stages WHERE kind='open' ORDER BY sort,id LIMIT 1").get();
  if (!admin || !stage) throw new Error('Нужны администратор и воронка');
  for (let i = 1; i <= 5; i++) {
    const contact = db.prepare('INSERT INTO contacts(name,email,source,responsible_id,demo) VALUES(?,?,?,?,1)').run(`Тестовый клиент ${i}`, `client${i}@example.com`, 'manual', admin.id).lastInsertRowid;
    const deal = db.prepare('INSERT INTO deals(title,amount,stage,pipeline_id,contact_id,responsible_id,responsible,demo) VALUES(?,?,?,?,?,?,?,1)').run(`Тест: дом ${i}`, 2000000 + i * 150000, stage.code, stage.pipeline_id, contact, admin.id, admin.name).lastInsertRowid;
    const due = new Date(Date.now() + (i - 3) * 86400000).toISOString().slice(0, 16);
    db.prepare('INSERT INTO tasks(title,type,due,deal_id,contact_id,responsible_id,demo) VALUES(?,?,?,?,?,?,1)').run(`Тест: обсудить проект ${i}`, 'call', due, deal, contact, admin.id);
  }
  db.prepare('INSERT INTO products(name,sku,price,unit) VALUES(?,?,?,?)').run('Тест: каркасный дом', 'TEST-01', 2500000, 'шт');
  db.prepare('INSERT INTO templates(name,body,channel) VALUES(?,?,?)').run('Тест: приветствие', 'Здравствуйте! Спасибо за обращение. Какой проект вас интересует?', 'whatsapp');
  db.exec('COMMIT');
  console.log('Созданы 5 контактов, 5 сделок, 5 задач, товар и шаблон. Сообщения не отправлялись.');
} catch (e) { db.exec('ROLLBACK'); throw e; }
finally { db.close(); }
