// Проверка миграций базы: KarkasCRM должна открывать базу прошлых версий без потери данных.
// Запуск:  node --experimental-sqlite tests/migrate.test.mjs
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA = mkdtempSync(join(tmpdir(), 'karkas-migrate-'));
const PORT = 18077;
process.env.DATA_DIR = DATA;
process.env.PORT = String(PORT);
process.env.SEED_MODE = 'off'; // миграция проверяется на чистой базе

let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); if (!cond) failed++ };

// ── 1. Делаем «старую» базу: схема до новых полей, с данными внутри ─────────────
const old = new DatabaseSync(join(DATA, 'crm.db'));
old.exec(`
CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE,pass TEXT,role TEXT DEFAULT 'manager',active INTEGER DEFAULT 1,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE settings(id INTEGER PRIMARY KEY,key TEXT UNIQUE,value TEXT);
CREATE TABLE contacts(id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT,email TEXT,company TEXT,source TEXT DEFAULT 'manual',tags TEXT DEFAULT '',notes TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE companies(id INTEGER PRIMARY KEY,name TEXT,inn TEXT,phone TEXT,email TEXT,site TEXT,notes TEXT,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE pipelines(id INTEGER PRIMARY KEY,name TEXT);
CREATE TABLE stages(id INTEGER PRIMARY KEY,pipeline_id INTEGER,code TEXT,name TEXT,color TEXT,sort INTEGER DEFAULT 0,kind TEXT DEFAULT 'open');
CREATE TABLE deals(id INTEGER PRIMARY KEY,title TEXT,amount INTEGER DEFAULT 0,stage TEXT DEFAULT 'new',contact_id INTEGER,responsible TEXT DEFAULT 'Администратор',deadline TEXT,closed_at TEXT,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE deal_products(id INTEGER PRIMARY KEY,deal_id INTEGER,product_id INTEGER,name TEXT,price INTEGER,qty REAL DEFAULT 1);
CREATE TABLE tasks(id INTEGER PRIMARY KEY,title TEXT,due TEXT,done INTEGER DEFAULT 0,deal_id INTEGER,contact_id INTEGER,result TEXT,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE notes(id INTEGER PRIMARY KEY,entity_type TEXT,entity_id INTEGER,body TEXT,author TEXT,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE activities(id INTEGER PRIMARY KEY,text TEXT,entity_type TEXT,entity_id INTEGER,user_name TEXT,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,sku TEXT,price INTEGER DEFAULT 0,unit TEXT DEFAULT 'шт',active INTEGER DEFAULT 1);
CREATE TABLE templates(id INTEGER PRIMARY KEY,name TEXT,body TEXT,channel TEXT DEFAULT 'any');
CREATE TABLE automations(id INTEGER PRIMARY KEY,name TEXT,trigger_type TEXT,trigger_value TEXT,action_type TEXT,action_value TEXT,active INTEGER DEFAULT 1);
CREATE TABLE conversations(id INTEGER PRIMARY KEY,contact_id INTEGER,title TEXT,channels TEXT DEFAULT '',unread INTEGER DEFAULT 0,last_at TEXT DEFAULT (datetime('now')),created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE messages(id INTEGER PRIMARY KEY,conversation_id INTEGER,channel TEXT DEFAULT 'whatsapp',direction TEXT DEFAULT 'in',body TEXT,author TEXT,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE channels(id INTEGER PRIMARY KEY,provider TEXT,external_id TEXT UNIQUE,name TEXT,transport TEXT,phone TEXT,state TEXT,raw TEXT);
`);
old.exec(`
INSERT INTO contacts(name,phone,email,source) VALUES('Клиент из старой базы','+7 900 123-45-67','old@mail.ru','avito');
INSERT INTO deals(title,amount,stage,contact_id) VALUES('Старая сделка',777000,'new',1);
INSERT INTO conversations(contact_id,title,channels) VALUES(1,'Клиент из старой базы','whatsapp');
INSERT INTO messages(conversation_id,direction,body) VALUES(1,'in','Сообщение из старой базы');
INSERT INTO pipelines(name) VALUES('Основная воронка');
INSERT INTO stages(pipeline_id,code,name,color,sort,kind) VALUES(1,'new','Неразобранное','#f97316',0,'open');
INSERT INTO settings(key,value) VALUES('COMPANY_NAME','Старая компания');
`);
const before = {
  contacts: old.prepare('SELECT COUNT(*) n FROM contacts').get().n,
  deals: old.prepare('SELECT COUNT(*) n FROM deals').get().n,
  messages: old.prepare('SELECT COUNT(*) n FROM messages').get().n,
};
old.close();
console.log(`\n=== Миграции базы KarkasCRM (${DATA}) ===`);
ok('подготовлена база прежней схемы', before.contacts === 1 && before.deals === 1 && before.messages === 1, JSON.stringify(before));

// ── 2. Открываем её текущим сервером ─────────────────────────────────────────
const { server, db } = await import('../backend/src/server.js');
await new Promise(r => server.listening ? r() : server.once('listening', r));

const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(r => r.name);
const expect = {
  contacts: ['demo', 'custom', 'responsible_id', 'position', 'company_id'],
  deals: ['demo', 'custom', 'pipeline_id', 'priority', 'loss_reason', 'company_id'],
  tasks: ['demo', 'notified_at', 'type', 'priority', 'responsible_id'],
  messages: ['subject', 'content_uri', 'content_name', 'content_type', 'status'],
  conversations: ['demo', 'channel_id', 'external_chat_id', 'chat_type'],
};
for (const [table, names] of Object.entries(expect)) {
  const have = cols(table);
  const missing = names.filter(n => !have.includes(n));
  ok(`таблица ${table}: новые колонки добавлены`, missing.length === 0, missing.length ? 'нет: ' + missing.join(', ') : names.join(', '));
}
ok('разведка конкурентов: таблицы созданы', cols('competitors').includes('demo') && cols('price_rows').includes('demo'));

// ── 3. Данные на месте, старые записи не помечены как демо ───────────────────
const after = {
  contacts: db.prepare('SELECT COUNT(*) n FROM contacts').get().n,
  deals: db.prepare('SELECT COUNT(*) n FROM deals').get().n,
  messages: db.prepare('SELECT COUNT(*) n FROM messages').get().n,
};
ok('данные не потеряны', after.contacts === before.contacts && after.deals === before.deals && after.messages === before.messages, JSON.stringify(after));
const c = db.prepare('SELECT * FROM contacts WHERE id=1').get();
ok('карточка клиента читается полностью', c.name === 'Клиент из старой базы' && c.email === 'old@mail.ru', c.name);
ok('новые поля у старых записей заполнены значениями по умолчанию', c.demo === 0 && (c.custom === '{}' || c.custom === null), `demo=${c.demo}, custom=${c.custom}`);
const m = db.prepare('SELECT * FROM messages WHERE id=1').get();
ok('переписка из старой базы сохранена', m.body === 'Сообщение из старой базы');
ok('настройки компании перенесены', db.prepare("SELECT value FROM settings WHERE key='COMPANY_NAME'").get().value === 'Старая компания');

// ── 4. API поверх мигрированной базы ─────────────────────────────────────────
const health = await (await fetch(`http://127.0.0.1:${PORT}/api/health`)).json();
ok('сервер отвечает /api/health', health.ok === true && health.counts.contacts >= 1, `схема ${health.schema}`);
ok('перед обновлением схемы сделана страховочная копия базы', health.backups.count >= 1 && String(health.backups.last || '').startsWith('pre-upgrade'), JSON.stringify(health.backups));
ok('в мигрированную базу не добавляются посторонние записи', health.counts.contacts === 1 && health.counts.deals === 1, JSON.stringify(health.counts));
ok('без токена данные закрыты', (await fetch(`http://127.0.0.1:${PORT}/api/contacts`)).status === 401);

const login = await (await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com', password: 'admin12345' }) })).json();
ok('администратор создан для базы без пользователей', !!login.token, login.error || '');
const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
const meta = await fetch(`http://127.0.0.1:${PORT}/api/meta`, { headers: H });
ok('новые эндпоинты работают на мигрированной базе', meta.status === 200);
const contacts = await (await fetch(`http://127.0.0.1:${PORT}/api/contacts`, { headers: H })).json();
ok('клиент из старой базы виден через API', contacts.length === 1 && contacts[0].name === 'Клиент из старой базы' && contacts[0].demo === 0, JSON.stringify(contacts.map(c => [c.name, c.demo])));
const cleanStatus = (await fetch(`http://127.0.0.1:${PORT}/api/demo/clean`, { method: 'POST', headers: H })).status;
ok('команда очистки примеров данных в продукте отключена', cleanStatus === 404, 'статус ' + cleanStatus);
const deals = await (await fetch(`http://127.0.0.1:${PORT}/api/deals`, { headers: H })).json();
ok('старая сделка читается со всеми новыми полями', deals.deals.length === 1 && deals.deals[0].amount === 777000 && deals.deals[0].pipeline_id === 1, JSON.stringify(deals.deals.map(d => [d.title, d.amount, d.pipeline_id])));
const conv = await (await fetch(`http://127.0.0.1:${PORT}/api/conversations`, { headers: H })).json();
ok('старый чат на месте и читается', conv.length === 1 && conv[0].channels === 'whatsapp');

// ── 5. Повторный старт (миграции идемпотентны) ───────────────────────────────
const again = new DatabaseSync(join(DATA, 'crm.db'));
let alreadyMigrated = false, rerunErr = '';
try { again.exec('ALTER TABLE contacts ADD COLUMN demo INTEGER DEFAULT 0') } catch (e) { alreadyMigrated = /duplicate column/i.test(e.message); rerunErr = String(e.message).slice(0, 60) }
again.close();
ok('колонки уже на месте (повторная миграция не нужна)', alreadyMigrated, rerunErr);

server.close();
rmSync(DATA, { recursive: true, force: true });
console.log(`\nИтого: ${failed === 0 ? 'все проверки пройдены ✅' : failed + ' проверок не пройдено ❌'}\n`);
process.exit(failed ? 1 : 0);
