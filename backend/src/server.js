// КаркасCRM — ядро системы: воронки и сделки, клиенты и компании, задачи, единый инбокс
// мессенджеров и почты, аналитика, разведка конкурентов. Без внешних зависимостей:
// Node >= 22.5 (http, node:sqlite, crypto, fetch).
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, statSync, readdirSync, unlinkSync, copyFileSync, mkdirSync as mkdir, createReadStream } from 'node:fs';
import { extname, join, normalize, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCompetitors } from './competitors.js';
import { sendMail } from './smtp.js';
import { seedBase, seedDemo, demoCounts, cleanDemo } from './seed.js';

const PORT = process.env.PORT || 8080, HOST = process.env.HOST || '0.0.0.0';
// Режим начальных данных: demo (локально, примеры) / base (прод, правовая основа) / off (чистая база).
// По умолчанию: если задан домен — base, иначе demo. Переопределяется в SEED_MODE.
const SEED_MODE_RAW = String(process.env.SEED_MODE || '').trim().toLowerCase();
// Неизвестное значение (опечатка в .env) раньше молча включало демо-данные на проде —
// теперь такой режим игнорируется с предупреждением и работает автоопределение.
const SEED_MODE = ['demo', 'base', 'off'].includes(SEED_MODE_RAW)
  ? SEED_MODE_RAW
  : (process.env.CRM_DOMAIN ? 'base' : 'demo');
if (SEED_MODE_RAW && !['demo', 'base', 'off'].includes(SEED_MODE_RAW)) {
  console.warn(`SEED_MODE="${process.env.SEED_MODE}" не распознан (допустимо demo, base, off) — используется режим по умолчанию: ${SEED_MODE}.`);
}
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(ROOT, '../../data');
const PUBLIC_DIR = process.env.PUBLIC_DIR || join(ROOT, '../../frontend/public');
const BUNDLED_LOGO = join(ROOT, '../../logo.jpg');
const CUSTOM_LOGO_DIR = join(DATA_DIR, 'logo');
const UPLOAD_DIR = join(DATA_DIR, 'uploads');
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin12345';

// Версия продукта: единый источник — файл VERSION в корне (он же попадает в Docker-образ).
const VERSION = (() => { try { return readFileSync(join(ROOT, '../../VERSION'), 'utf8').trim() || '1'; } catch { return '1'; } })();
const STARTED = Date.now();
// Понятная ошибка вместо стектрейса, если каталог данных недоступен (не смонтирован том,
// права root вместо пользователя node, диск только для чтения).
function ensureDataDir() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    mkdirSync(UPLOAD_DIR, { recursive: true });
    const probe = join(DATA_DIR, '.write-test');
    writeFileSync(probe, 'ok');
    unlinkSync(probe);
  } catch (e) {
    console.error(`Каталог данных недоступен для записи: ${DATA_DIR}\n${e.message}\nПроверьте права: в Docker это том /data (владелец — пользователь node, uid 1000), локально — папка ./data.`);
    process.exit(1);
  }
}
ensureDataDir();
// Секрет подписи токенов: берём из окружения; если он не задан — генерируем постоянный
// случайный секрет и сохраняем в каталоге данных, чтобы сессии переживали перезапуск.
function loadSecret() {
  if (process.env.JWT_SECRET) {
    if (process.env.JWT_SECRET.length >= 16 && !/смените|change.?me/i.test(process.env.JWT_SECRET)) return process.env.JWT_SECRET;
    console.warn('JWT_SECRET задан, но он слишком короткий или похож на шаблонный пример — используется постоянный секрет из каталога данных. Задайте случайную строку от 32 символов (openssl rand -hex 32).');
  }
  const secretFile = join(DATA_DIR, '.jwt-secret');
  try { if (existsSync(secretFile)) { const v = readFileSync(secretFile, 'utf8').trim(); if (v) return v; } } catch { }
  const generated = randomBytes(48).toString('hex');
  try { writeFileSync(secretFile, generated, { mode: 0o600 }); chmodSync(secretFile, 0o600); }
  catch (e) { console.error('JWT_SECRET не задан и не удалось сохранить сгенерированный секрет:', e.message); }
    console.warn('JWT_SECRET не задан в окружении — использован постоянный секрет, сохранённый в каталоге данных. При запуске нескольких серверов задайте JWT_SECRET в окружении');
  return generated;
}
const SECRET = loadSecret();
const db = (() => {
  try { return new DatabaseSync(join(DATA_DIR, 'crm.db')); }
  catch (e) {
    console.error(`Не удалось открыть базу ${join(DATA_DIR, 'crm.db')}: ${e.message}\nЕсли файл повреждён, восстановите его из резервной копии в ${join(DATA_DIR, 'backups')} или начните с пустой базы, убрав файл crm.db.`);
    process.exit(1);
  }
})();
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;      -- не падать, если запись идёт параллельно
PRAGMA synchronous=NORMAL;     -- быстрая запись при WAL и при этом безопасная
PRAGMA temp_store=MEMORY;      -- временные таблицы в памяти
PRAGMA cache_size=-16000;      -- кэш страниц ~16 МБ
PRAGMA mmap_size=268435456;    -- файл базы читается через память, SELECT быстрее`);
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE,pass TEXT,role TEXT DEFAULT 'manager',active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS companies(id INTEGER PRIMARY KEY,name TEXT NOT NULL,inn TEXT,phone TEXT,email TEXT,site TEXT,notes TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS contacts(id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT,email TEXT,company TEXT,company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,position TEXT,source TEXT DEFAULT 'manual',tags TEXT DEFAULT '',notes TEXT DEFAULT '',responsible_id INTEGER,demo INTEGER DEFAULT 0,custom TEXT DEFAULT '{}',created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS pipelines(id INTEGER PRIMARY KEY,name TEXT NOT NULL,is_default INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS stages(id INTEGER PRIMARY KEY,pipeline_id INTEGER REFERENCES pipelines(id) ON DELETE CASCADE,code TEXT,name TEXT,color TEXT DEFAULT '#16a34a',sort INTEGER DEFAULT 0,kind TEXT DEFAULT 'open');
CREATE TABLE IF NOT EXISTS deals(id INTEGER PRIMARY KEY,title TEXT NOT NULL,amount INTEGER DEFAULT 0,stage TEXT DEFAULT 'new',pipeline_id INTEGER DEFAULT 1,contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,company_id INTEGER, responsible TEXT DEFAULT 'Администратор',responsible_id INTEGER,priority TEXT DEFAULT 'normal',loss_reason TEXT,deadline TEXT,closed_at TEXT,demo INTEGER DEFAULT 0,custom TEXT DEFAULT '{}',created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY,title TEXT NOT NULL,type TEXT DEFAULT 'call',due TEXT,priority TEXT DEFAULT 'normal',done INTEGER DEFAULT 0,deal_id INTEGER,contact_id INTEGER,responsible_id INTEGER,result TEXT,demo INTEGER DEFAULT 0,notified_at TEXT,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY,entity_type TEXT,entity_id INTEGER,body TEXT,author TEXT,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,name TEXT NOT NULL,sku TEXT,price INTEGER DEFAULT 0,unit TEXT DEFAULT 'шт',active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS deal_products(id INTEGER PRIMARY KEY,deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,product_id INTEGER,name TEXT,price INTEGER,qty REAL DEFAULT 1);
CREATE TABLE IF NOT EXISTS templates(id INTEGER PRIMARY KEY,name TEXT NOT NULL,body TEXT,channel TEXT DEFAULT 'whatsapp');
CREATE TABLE IF NOT EXISTS automations(id INTEGER PRIMARY KEY,name TEXT NOT NULL,trigger_type TEXT NOT NULL,trigger_value TEXT,action_type TEXT NOT NULL,action_value TEXT,active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS channels(id INTEGER PRIMARY KEY,provider TEXT DEFAULT 'wazzup',external_id TEXT UNIQUE,name TEXT,transport TEXT,phone TEXT,state TEXT,raw TEXT);
CREATE TABLE IF NOT EXISTS conversations(id INTEGER PRIMARY KEY,contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,title TEXT,channels TEXT DEFAULT '',channel_id TEXT,external_chat_id TEXT,chat_type TEXT,unread INTEGER DEFAULT 0,assigned_id INTEGER,demo INTEGER DEFAULT 0,last_at TEXT DEFAULT (datetime('now')),UNIQUE(contact_id));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,channel TEXT DEFAULT 'whatsapp',direction TEXT DEFAULT 'in',body TEXT,content_uri TEXT,status TEXT,external_id TEXT,author TEXT,subject TEXT,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE IF NOT EXISTS activities(id INTEGER PRIMARY KEY,text TEXT,entity_type TEXT,entity_id INTEGER,user_name TEXT,created_at TEXT DEFAULT (datetime('now')));
`);
// мягкие миграции: дополняем ранее созданные таблицы недостающими колонками
const SCHEMA = [
  ['contacts', 'demo', 'INTEGER DEFAULT 0'], ['deals', 'demo', 'INTEGER DEFAULT 0'], ['tasks', 'demo', 'INTEGER DEFAULT 0'],
  ['conversations', 'demo', 'INTEGER DEFAULT 0'], ['tasks', 'notified_at', 'TEXT'], ['messages', 'subject', 'TEXT'],
  ['contacts', 'custom', "TEXT DEFAULT '{}'"], ['deals', 'custom', "TEXT DEFAULT '{}'"],
];
const SCHEMA_COLUMNS = [...SCHEMA,
  ['users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'session_version', 'INTEGER NOT NULL DEFAULT 0'],
  ['contacts', 'company_id', 'INTEGER'], ['contacts', 'position', 'TEXT'], ['contacts', 'responsible_id', 'INTEGER'],
  ['contacts', 'tags', "TEXT DEFAULT ''"], ['contacts', 'notes', "TEXT DEFAULT ''"], ['contacts', 'source', "TEXT DEFAULT 'manual'"],
  ['deals', 'pipeline_id', 'INTEGER DEFAULT 1'], ['deals', 'priority', "TEXT DEFAULT 'normal'"], ['deals', 'loss_reason', 'TEXT'],
  ['deals', 'company_id', 'INTEGER'], ['deals', 'responsible', "TEXT DEFAULT 'Администратор'"], ['deals', 'responsible_id', 'INTEGER'], ['deals', 'updated_at', 'TEXT'],
  ['tasks', 'type', "TEXT DEFAULT 'call'"], ['tasks', 'priority', "TEXT DEFAULT 'normal'"], ['tasks', 'responsible_id', 'INTEGER'],
  ['tasks', 'done', 'INTEGER DEFAULT 0'], ['tasks', 'repeat', "TEXT DEFAULT 'none'"],
  ['messages', 'content_uri', 'TEXT'], ['messages', 'status', 'TEXT'], ['messages', 'external_id', 'TEXT'],
  ['messages', 'channel', "TEXT DEFAULT 'whatsapp'"], ['messages', 'direction', "TEXT DEFAULT 'in'"], ['messages', 'author', 'TEXT'],
  ['messages', 'content_name', 'TEXT'], ['messages', 'content_type', 'TEXT'],
  ['conversations', 'channel_id', 'TEXT'], ['conversations', 'external_chat_id', 'TEXT'], ['conversations', 'chat_type', 'TEXT'],
  ['conversations', 'last_at', 'TEXT'], ['conversations', 'assigned_id', 'INTEGER'], ['conversations', 'title', 'TEXT'], ['conversations', 'channels', "TEXT DEFAULT ''"],
  ['contacts', 'phone_norm', 'TEXT'], ['templates', 'user_id', 'INTEGER'],
  ['products', 'demo', 'INTEGER DEFAULT 0'], ['templates', 'demo', 'INTEGER DEFAULT 0'], ['automations', 'demo', 'INTEGER DEFAULT 0'],
  ['companies', 'demo', 'INTEGER DEFAULT 0'], ['notes', 'demo', 'INTEGER DEFAULT 0'],
];

// чего не хватает в этой базе: если она из старой версии — сначала копия, потом изменения
const missingColumns = [];
for (const [t, c] of SCHEMA_COLUMNS) {
  const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(r => r.name);
  if (!cols.includes(c)) missingColumns.push([t, c]);
}
// совсем новый файл базы: копировать нечего, страховочная копия не нужна
const freshDb = (() => {
  try {
    return ['users', 'contacts', 'deals', 'messages', 'conversations'].every(t => {
      try { return db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n === 0 } catch { return true }
    });
  } catch { return true }
})();
if (missingColumns.length && !freshDb) {
  try {
    mkdir(join(DATA_DIR, 'backups'), { recursive: true });
    const pre = join(DATA_DIR, 'backups', `pre-upgrade-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.db`);
    // сбрасываем WAL на диск: копия одного файла должна быть согласованной
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch {}
    copyFileSync(join(DATA_DIR, 'crm.db'), pre);
    console.log(`Обновление схемы базы — страховочная копия: ${pre}`);
  } catch (e) { console.error('Не удалось сделать копию перед обновлением схемы:', e.message) }
}
for (const [t, c, d] of SCHEMA_COLUMNS) {
  const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(r => r.name); if (!cols.includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`);
}
if (missingColumns.length && !freshDb) console.log(`Схема базы обновлена: заполнено полей — ${missingColumns.length}`);
// индексы создаём ПОСЛЕ миграций: иначе база прошлой версии упадёт на отсутствующей колонке
db.exec(`
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id,id);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_phone_norm ON contacts(phone_norm);
CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks(done,due);
CREATE INDEX IF NOT EXISTS idx_conv_contact ON conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_templates_owner ON templates(user_id);
CREATE INDEX IF NOT EXISTS idx_deals_pipeline ON deals(pipeline_id, stage);
CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contact_id);
CREATE INDEX IF NOT EXISTS idx_deals_responsible ON deals(responsible_id);
CREATE INDEX IF NOT EXISTS idx_tasks_deal ON tasks(deal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_contact ON tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_tasks_responsible ON tasks(responsible_id, done);
CREATE INDEX IF NOT EXISTS idx_conv_last ON conversations(last_at);
CREATE INDEX IF NOT EXISTS idx_deal_products_deal ON deal_products(deal_id);
CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activities_entity ON activities(entity_type, entity_id);
`);
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_ext ON messages(external_id) WHERE external_id IS NOT NULL'); }
catch (e) { console.error('Не удалось создать уникальный индекс по external_id (в базе есть дубли внешних id):', e.message); }
const SCHEMA_VERSION = 5;

// Дата в местном часовом поясе (в базе время хранится в UTC, а сроки задач —
// в местном настенном времени; сравнивать их с UTC-«сегодня» нельзя).
function localDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function localNow(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${localDate(d)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function nowDue(offsetHours = 2) {
  const d = new Date(Date.now() + offsetHours * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`;
}

function normalizeDue(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const tmrw = new Date(now.getTime() + 86400000);
  const tmrwStr = `${tmrw.getFullYear()}-${pad(tmrw.getMonth() + 1)}-${pad(tmrw.getDate())}`;

  const mSeg = s.match(/^сегодня(?:\s+(\d{1,2}:\d{2}))?$/i);
  if (mSeg) {
    const time = mSeg[1] ? (mSeg[1].length === 4 ? '0' + mSeg[1] : mSeg[1]) : '14:00';
    return `${todayStr} ${time}`;
  }
  const mZav = s.match(/^завтра(?:\s+(\d{1,2}:\d{2}))?$/i);
  if (mZav) {
    const time = mZav[1] ? (mZav[1].length === 4 ? '0' + mZav[1] : mZav[1]) : '10:00';
    return `${tmrwStr} ${time}`;
  }
  const mRu = s.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}:\d{2}))?$/);
  if (mRu) {
    const time = mRu[4] ? (mRu[4].length === 4 ? '0' + mRu[4] : mRu[4]) : '10:00';
    return `${mRu[3]}-${mRu[2]}-${mRu[1]} ${time}`;
  }
  const mIso = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}))?/);
  if (mIso) {
    return `${mIso[1]} ${mIso[2] || '10:00'}`;
  }
  // Непонятный формат не сохраняем: иначе задача не сортируется и выглядит сломанной.
  return '';
}

function fixTaskDues() {
  try {
    const rows = db.prepare("SELECT id, due FROM tasks WHERE due IS NOT NULL AND due != ''").all();
    const stmt = db.prepare('UPDATE tasks SET due=? WHERE id=?');
    for (const r of rows) {
      const norm = normalizeDue(r.due);
      if (norm && norm !== r.due) stmt.run(norm, r.id);
    }
  } catch {}
}
fixTaskDues();

const getSetting = (k, d = '') => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value ?? process.env[k] ?? d;
// IP клиента для лимитов. X-Forwarded-For доверяем только когда запрос пришёл
// от локального/контейнерного прокси, и берём ПОСЛЕДНИЙ адрес: его дописал наш
// прокси. Первый адрес клиент может подделать и обойти ограничение попыток входа.
const isPrivateIp = ip => {
  const s = String(ip || '');
  if (s === '::1' || /^(fe80|fc|fd)/i.test(s)) return true;
  return /^(::ffff:)?(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(s);
};
function clientIp(req) {
  const remote = req.socket.remoteAddress || 'local';
  if (!isPrivateIp(remote)) return remote;
  const list = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean);
  return list.length ? list[list.length - 1] : remote;
}
const setSetting = (k, v) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v ?? ''));
const log = (text, et = null, eid = null, user = '') => db.prepare('INSERT INTO activities(text,entity_type,entity_id,user_name) VALUES(?,?,?,?)').run(text, et, eid, user);
const hashPass = (p, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(p, salt, 64).toString('hex')}`;
function checkPass(p, s) { try { const [salt, h] = String(s).split(':'); const a = Buffer.from(h, 'hex'), b = scryptSync(p, salt, 64); return a.length === b.length && timingSafeEqual(a, b); } catch { return false; } }
// Проверка пароля при входе — асинхронная: 50 одновременных входов утром не
// блокируют обработку остальных запросов (scrypt считается в пуле потоков).
const scryptAsync = promisify(scrypt);
async function checkPassAsync(p, s) {
  try { const [salt, h] = String(s).split(':'); const a = Buffer.from(h, 'hex'), b = await scryptAsync(p, salt, 64); return a.length === b.length && timingSafeEqual(a, b); }
  catch { return false; }
}
const sign = p => { const b = Buffer.from(JSON.stringify({ ...p, sv: db.prepare('SELECT session_version FROM users WHERE id=?').get(p.id)?.session_version || 0, exp: Date.now() + 7 * 864e5 })).toString('base64url'); return b + '.' + createHmac('sha256', SECRET).update(b).digest('base64url'); };
function verify(t) {
  try {
    const [b, s] = String(t || '').split('.');
    if (!b || !s) return null;
    const expected = createHmac('sha256', SECRET).update(b).digest(), got = Buffer.from(s, 'base64url');
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
    const p = JSON.parse(Buffer.from(b, 'base64url'));
    if (p.exp <= Date.now()) return null;
    const user = db.prepare('SELECT id,name,email,role,must_change_password,session_version FROM users WHERE id=? AND active=1').get(p.id);
    return user && (p.sv ?? 0) === user.session_version ? user : null;
  } catch { return null; }
}
// httpOnly-cookie сессии: токен не доступен из JavaScript и не переживает XSS
const isHttps = req => ((req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || '').toLowerCase() === 'https';
function sessionCookie(req, token) {
  return `karkas_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 86400}${isHttps(req) ? '; Secure' : ''}`;
}
const clearSessionCookie = req => `karkas_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${isHttps(req) ? '; Secure' : ''}`;
const cookieOf = req => Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=').map(decodeURIComponent)).filter(([k]) => k));
const digits = s => String(s || '').replace(/\D/g, '').replace(/^8(?=\d{10}$)/, '7');
// нормализованные телефоны для быстрой связи входящих с карточками (миграция)
{
  const cols = db.prepare('PRAGMA table_info(contacts)').all().map(r => r.name);
  if (cols.includes('phone_norm')) {
    const rows = db.prepare('SELECT id,phone FROM contacts WHERE phone_norm IS NULL OR phone_norm=\'\'').all();
    const up = db.prepare('UPDATE contacts SET phone_norm=? WHERE id=?');
    for (const r of rows) up.run(digits(r.phone) || null, r.id);
  }
}

// ---------- seed ----------
if (!db.prepare('SELECT id FROM pipelines LIMIT 1').get()) {
  db.prepare('INSERT INTO pipelines(id,name,is_default) VALUES(1,?,1)').run('Основная воронка');
  const st = db.prepare('INSERT INTO stages(pipeline_id,code,name,color,sort,kind) VALUES(1,?,?,?,?,?)');
  [['new','Неразобранное','#f97316',0,'open'],['contact','Контакт установлен','#fb923c',1,'open'],['offer','Предложение / расчёт','#eab308',2,'open'],['negotiation','Переговоры','#22c55e',3,'open'],['decision','Принимают решение','#16a34a',4,'open'],['won','Успешно реализовано','#15803d',5,'won'],['lost','Закрыто и не реализовано','#78716c',6,'lost']].forEach(x => st.run(...x));
}


if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
  db.prepare('INSERT INTO users(name,email,pass,role) VALUES(?,?,?,?)').run('Администратор', ADMIN_EMAIL, hashPass(ADMIN_PASSWORD), 'admin');
  if (!getSetting('COMPANY_NAME')) { setSetting('COMPANY_NAME', 'Каркас — каркасные дома'); setSetting('CURRENCY', '₽'); setSetting('AUTO_DEAL', '1'); setSetting('AUTO_DEAL_STAGE', 'new'); }
  log('Система инициализирована: создана чистая база и учётная запись администратора');
}
export function getStages(pipeline_id = 1) { return db.prepare('SELECT * FROM stages WHERE pipeline_id=? ORDER BY sort,id').all(pipeline_id); }
export function getCustomFields() { try { const v = JSON.parse(getSetting('CUSTOM_FIELDS', '[]')); return Array.isArray(v) ? v.filter(f => f && f.key && f.label) : [] } catch { return [] } }
// Обязательные свои поля проверяются на сервере, а не только звёздочкой в форме.
function missingRequiredCustom(table, customRaw) {
  const req = getCustomFields().filter(f => f.required && (f.entity === 'both' || f.entity === table));
  if (!req.length) return null;
  let obj = {};
  try { obj = typeof customRaw === 'string' ? JSON.parse(customRaw || '{}') : (customRaw || {}) } catch { obj = {} }
  const miss = req.filter(f => !String(obj[f.key] ?? '').trim());
  return miss.length ? `Заполните обязательные поля: ${miss.map(f => f.label).join(', ')}` : null;
}
const sanitizeFields = list => (Array.isArray(list) ? list : []).slice(0, 40).map(f => ({
  key: String(f.key || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40),
  label: String(f.label || '').slice(0, 80),
  type: ['text', 'number', 'date', 'select', 'phone', 'email'].includes(f.type) ? f.type : 'text',
  entity: ['contacts', 'deals', 'both'].includes(f.entity) ? f.entity : 'both',
  options: Array.isArray(f.options) ? f.options.map(String).slice(0, 40) : [],
  required: !!f.required,
})).filter(f => f.key && f.label);

// ---------- realtime ----------
const clients = new Set();
function closeUserStreams(id) { for (const res of clients) if (res.userId === id) { clients.delete(res); res.end(); } }
const staticGzip = new Map(); // кэш сжатых ассетов: gzip считается один раз на версию файла
export function broadcast(ev, data) { const s = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`; clients.forEach(r => { try { r.write(s); } catch {} }); }

// ---------- automations ----------
function runAutomations(trigger, ctx = {}) {
  for (const a of db.prepare('SELECT * FROM automations WHERE active=1 AND trigger_type=?').all(trigger)) {
    if (a.trigger_value && ctx.stage && a.trigger_value !== ctx.stage) continue;
    try {
      if (a.action_type === 'create_task' && (ctx.contact_id || ctx.deal_id)) {
        const owner = (ctx.deal_id && db.prepare('SELECT responsible_id FROM deals WHERE id=?').get(ctx.deal_id)?.responsible_id) || (ctx.contact_id && db.prepare('SELECT responsible_id FROM contacts WHERE id=?').get(ctx.contact_id)?.responsible_id) || null;
        db.prepare('INSERT INTO tasks(title,due,contact_id,deal_id,responsible_id) VALUES(?,?,?,?,?)').run(a.action_value || a.name, normalizeDue('сегодня'), ctx.contact_id || null, ctx.deal_id || null, owner);
      }
      if (a.action_type === 'change_stage' && ctx.deal_id && a.action_value) db.prepare('UPDATE deals SET stage=? WHERE id=?').run(a.action_value, ctx.deal_id);
      if (a.action_type === 'add_tag' && ctx.contact_id && a.action_value) { const c = db.prepare('SELECT tags FROM contacts WHERE id=?').get(ctx.contact_id); const tags = [...new Set([...(c?.tags || '').split(',').filter(Boolean), a.action_value])].join(','); db.prepare('UPDATE contacts SET tags=? WHERE id=?').run(tags, ctx.contact_id); }
      log(`Автоматизация «${a.name}» сработала`);
    } catch (e) { console.error('automation', e); }
  }
}

// ---------- unified inbox ----------
// «Неразобранное»: при первом обращении (или если открытых сделок нет) создаём сделку в воронке
// свободный менеджер: у кого меньше всего сделок в работе (распределение лидов)
export function nextManager() {
  const users = db.prepare("SELECT id,name FROM users WHERE active=1 AND role IN ('manager','admin') ORDER BY id").all();
  if (!users.length) return null;
  const load = db.prepare("SELECT COUNT(*) n FROM deals WHERE responsible_id=? AND stage NOT IN ('won','lost')");
  return users.map(u => ({ u, n: load.get(u.id).n })).sort((a, b) => a.n - b.n || a.u.id - b.u.id)[0].u;
}
export function ensureDeal(contact) {
  if (getSetting('AUTO_DEAL', '1') !== '1' || !contact) return null;
  const open = db.prepare("SELECT id FROM deals WHERE contact_id=? AND stage NOT IN ('won','lost') ORDER BY id DESC").get(contact.id);
  if (open) return null;
  // этап для новых обращений: первый этап воронки. Жёсткий код 'new' ломался,
  // если воронку переименовали или удалили этот этап.
  const firstStage = getStages(1)[0]?.code || 'new';
  const wantedStage = getSetting('AUTO_DEAL_STAGE', '');
  const stage = (wantedStage && db.prepare('SELECT 1 x FROM stages WHERE code=? AND pipeline_id=1').get(wantedStage)) ? wantedStage : firstStage;
  let ownerId = contact.responsible_id || null, ownerName = '';
  if (ownerId) ownerName = db.prepare('SELECT name FROM users WHERE id=?').get(ownerId)?.name || '';
  if (!ownerId && getSetting('AUTO_ASSIGN', '0') === '1') {
    const m = nextManager();
    if (m) { ownerId = m.id; ownerName = m.name; db.prepare('UPDATE contacts SET responsible_id=? WHERE id=?').run(ownerId, contact.id); log(`Обращение «${contact.name}» назначено на ${m.name}`, 'contacts', contact.id); }
  }
  const dr = db.prepare('INSERT INTO deals(title,amount,stage,contact_id,responsible,responsible_id) VALUES(?,?,?,?,?,?)').run('Обращение: ' + contact.name, 0, stage, contact.id, ownerName, ownerId);
  log(`Новое обращение «${contact.name}» → сделка в этапе «${stage}»`, 'deals', Number(dr.lastInsertRowid));
  runAutomations('deal_created', { deal_id: Number(dr.lastInsertRowid), contact_id: contact.id });
  broadcast('change', { table: 'deals' });
  return Number(dr.lastInsertRowid);
}

export function upsertIncoming({ channel = 'whatsapp', chatType = '', phone = '', chatId = '', name = '', body = '', external_id = null, channelId = '', contentUri = '', author = '', email = '', subject = '', direction = 'in' }) {
  if (!body && !contentUri) return null;
  // ограничиваем длину: вебхук — доверенный, но не бесконечный источник
  const cap = (s, n) => String(s ?? '').slice(0, n);
  name = cap(name, 120); body = cap(body, 100000); subject = cap(subject, 200); author = cap(author, 120);
  const ph = phone || (['whatsapp', 'viber'].includes(chatType || channel) ? chatId : '');
  // быстрый поиск по нормализованному телефону (индекс), раньше — полный скан
  let contact = null;
  const phNorm = digits(ph);
  if (phNorm) {
    const tail10 = phNorm.slice(-10);
    contact = db.prepare('SELECT * FROM contacts WHERE phone_norm=?').get(phNorm)
      || db.prepare('SELECT * FROM contacts WHERE phone_norm=?').get('7' + tail10)
      || db.prepare('SELECT * FROM contacts WHERE phone_norm LIKE ?').get('%' + tail10);
  }
  if (!contact && email) contact = db.prepare('SELECT * FROM contacts WHERE lower(email)=lower(?)').get(String(email).trim());
  if (!contact && chatId) { const conv0 = db.prepare('SELECT * FROM conversations WHERE external_chat_id=?').get(String(chatId)); if (conv0) contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(conv0.contact_id); }
  if (!contact) { const r = db.prepare('INSERT INTO contacts(name,phone,email,source,phone_norm) VALUES(?,?,?,?,?)').run(name || ph || chatId || email || 'Новый клиент', ph, email || '', channel === 'email' ? 'email' : 'wazzup-' + (chatType || channel), phNorm || null); contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(r.lastInsertRowid); log(`Новый контакт (${channel === 'email' ? 'email' : chatType || channel}): ${contact.name}`, 'contacts', contact.id); }
  let conv = db.prepare('SELECT * FROM conversations WHERE contact_id=?').get(contact.id);
  let dealId = null;
  if (!conv) {
    const r = db.prepare('INSERT INTO conversations(contact_id,title,channels,channel_id,external_chat_id,chat_type) VALUES(?,?,?,?,?,?)').run(contact.id, contact.name, channel, channelId, String(chatId || ph || ''), chatType || channel);
    conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(r.lastInsertRowid);
    dealId = ensureDeal(contact);
  }
  const channels = [...new Set([...(conv.channels || '').split(',').filter(Boolean), channel])].join(',');
  try { db.prepare('INSERT INTO messages(conversation_id,channel,direction,body,subject,content_uri,status,external_id,author) VALUES(?,?,?,?,?,?,?,?,?)').run(conv.id, channel, 'in', body || '[вложение]', subject, contentUri, channel === 'email' ? 'received' : 'inbound', external_id, author); }
  catch (e) { if (/UNIQUE/i.test(e.message)) return conv; console.error('message insert', e); throw e; }
  db.prepare("UPDATE conversations SET channels=?,channel_id=COALESCE(NULLIF(?,''),channel_id),external_chat_id=COALESCE(NULLIF(?,''),external_chat_id),chat_type=COALESCE(NULLIF(?,''),chat_type),unread=unread+1,last_at=datetime('now') WHERE id=?").run(channels, channelId, String(chatId || ''), chatType, conv.id);
  if (!dealId) dealId = ensureDeal(contact); // клиент вернулся, а открытой сделки нет — заводим новое обращение
  const openDeal = db.prepare("SELECT id FROM deals WHERE contact_id=? AND stage NOT IN ('won','lost') ORDER BY id DESC").get(contact.id);
  runAutomations('message_in', { contact_id: contact.id, deal_id: dealId || openDeal?.id });
  // в событии есть имя и превью: интерфейс показывает понятное уведомление
  broadcast('message', { conversation_id: conv.id, title: contact.name || conv.title || 'Клиент', preview: String(body || '').slice(0, 90), direction: 'in' });
  return conv;
}

// ---------- providers ----------
async function wazzupFetch(path, opt = {}) {
  const key = getSetting('WAZZUP_API_KEY'); if (!key) throw new Error('Wazzup API-ключ не настроен');
  const base = (getSetting('WAZZUP_API_URL', 'https://api.wazzup24.com/v3')).replace(/\/$/, '');
  const res = await fetch(base + path, { ...opt, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...(opt.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data?.description || data?.error || `Wazzup API ${res.status}`); e.status = res.status; throw e; }
  return data;
}
const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const WZ_TYPES = ['whatsapp', 'viber', 'telegram', 'instagram', 'whatsgroup'];
const normChatType = t => WZ_TYPES.includes(String(t || '').toLowerCase()) ? String(t).toLowerCase() : 'whatsapp';
// понятные ошибки вместо «Wazzup API 401»
function wazzupError(e, status) {
  const m = String(e?.message || e || '');
  if (status === 401 || /401|unauthor/i.test(m)) return 'Wazzup: ключ не подошёл (401). Проверьте API-ключ в Настройках — возможно, он перевыпущен в кабинете Wazzup.';
  if (status === 403 || /403|forbidden/i.test(m)) return 'Wazzup: доступ запрещён (403). Проверьте, что канал подключён и тариф активен.';
  if (status === 429) return 'Wazzup: слишком много запросов (429). Повторите через минуту.';
  if (/chatId|chat_id/i.test(m) && /400|invalid/i.test(m)) return 'Wazzup: не принял адресата. Для WhatsApp/Viber нужен номер телефона цифрами, для Telegram/Instagram — идентификатор чата из переписки.';
  return 'Wazzup: ' + m;
}
export async function sendViaWazzup(conv, text, user, chatTypeOverride = '', file = null) {
  // Wazzup принимает только id канала в формате uuid — иначе отвечаем каналом по умолчанию из настроек
  const channelId = (isUuid(conv.channel_id) ? conv.channel_id : '') || getSetting('WAZZUP_CHANNEL_ID');
  if (!channelId) throw new Error('Не выбран канал Wazzup. Настройки → Интеграции → «Проверить и синхронизировать каналы», затем выберите канал по умолчанию.');
  const chatType = normChatType(chatTypeOverride || conv.chat_type);
  // адресат — id чата из вебхука или номер телефона клиента
  const chatId = conv.external_chat_id || digits(conv.phone);
  if (!chatId) throw new Error('Нет адресата: у клиента не заполнен телефон или не пришло ни одного сообщения из этого канала.');
  const payload = {
    channelId, chatType, chatId,
    crmMessageId: 'karkas-' + Date.now().toString(36) + '-' + randomBytes(4).toString('hex'),
    crmUserId: String(user?.id || ''),
  };
  if (file?.contentUri) { payload.contentUri = file.contentUri; if (text) payload.text = text }
  else payload.text = text || '';
  let data;
  try { data = await wazzupFetch('/message', { method: 'POST', body: JSON.stringify(payload) }); }
  catch (e) { throw new Error(wazzupError(e, e.status)); }
  return { delivered: true, mode: 'wazzup', id: data.messageId || data.id };
}
// Wazzup объединяет WhatsApp, Telegram, Instagram и Viber в одном ключе —
// второй провайдер не нужен, отправка идёт только через него.
async function deliver(conv, channel, text, user, file = null) {
  if (!getSetting('WAZZUP_API_KEY')) throw new Error('WAZZUP_NOT_CONFIGURED');
  return sendViaWazzup(conv, text, user, channel && channel !== 'site' ? channel : '', file);
}

// ---------- обслуживание: бэкапы и напоминания ----------
function makeBackup(force = false) {
  const dir = join(DATA_DIR, 'backups'); mkdir(dir, { recursive: true });
  const name = `crm-${localDate()}.db`;
  const target = join(dir, name);
  if (!force && existsSync(target)) return null;
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch {}
  copyFileSync(join(DATA_DIR, 'crm.db'), target);
  const keep = Number(getSetting('BACKUP_KEEP_DAYS', '7')) || 0;
  if (keep > 0) {
    const limit = Date.now() - keep * 864e5;
    for (const f of readdirSync(dir).filter(x => x.endsWith('.db'))) { try { if (statSync(join(dir, f)).mtimeMs < limit) unlinkSync(join(dir, f)) } catch {} }
  }
  log(`Резервная копия базы создана: ${name}`);
  return name;
}
async function overdueTick() {
  const today = localDate();
  const now = localNow();
  const rows = db.prepare("SELECT t.*, c.name contact_name FROM tasks t LEFT JOIN contacts c ON c.id=t.contact_id WHERE t.done=0 AND t.due IS NOT NULL AND t.due != '' AND (t.notified_at IS NULL OR t.notified_at != ?)").all(today);
  // просрочено = срок уже прошёл (включая сегодняшнее время), а не только «вчера и раньше»
  const overdue = rows.filter(t => (String(t.due).length === 10 ? t.due + ' 23:59:59' : String(t.due)) < now || /^\d{2}\.\d{2}\.\d{4}/.test(t.due));
  if (!overdue.length) return;
  const ids = overdue.map(t => t.id);
  db.prepare(`UPDATE tasks SET notified_at=? WHERE id IN (${ids.map(() => '?').join(',')})`).run(today, ...ids);
  const list = overdue.map(t => ({ id: t.id, title: t.title, due: t.due, contact: t.contact_name || '' }));
  log(`Просроченные задачи: ${list.length} (${list.map(t => t.title).slice(0, 3).join('; ')})`);
  broadcast('notify', { type: 'overdue_tasks', count: list.length, tasks: list });
  const hook = getSetting('NOTIFY_WEBHOOK');
  if (hook) fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'overdue_tasks', count: list.length, tasks: list, company: getSetting('COMPANY_NAME') }) }).catch(() => {});
}
let lastBackupDay = '';
function startScheduler() {
  const tick = async () => {
    try {
      const hourly = getSetting('BACKUP_HOUR', '3');
      const now = new Date();
      const day = localDate(now);
      if (lastBackupDay !== day && now.getHours() >= Number(hourly)) {
        lastBackupDay = day;
        try { makeBackup() } catch (e) { console.error('backup', e) }
        // лента активности не растёт бесконечно: храним последние 20 000 событий
        try { db.prepare('DELETE FROM activities WHERE id NOT IN (SELECT id FROM activities ORDER BY id DESC LIMIT 20000)').run() } catch (e) { console.error('activities cleanup', e) }
      }
      await overdueTick();
    } catch (e) { console.error('scheduler', e) }
  };
  tick();
  const timer = setInterval(tick, Number(getSetting('SCHEDULER_INTERVAL_MS', '60000')));
  timer.unref?.();
  return timer;
}
export const scheduler = startScheduler();

// ---------- http ----------
// Заголовки безопасности на каждый ответ: CSP под собственный SPA без внешних скриптов,
// запрет фреймов (кроме явного FRAME_ANCESTORS), nosniff, закрытая индексация.
function applySecurityHeaders(req, res) {
  const frame = getSetting('FRAME_ANCESTORS');
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    frame ? `frame-ancestors ${frame}` : "frame-ancestors 'none'",
  ].join('; ');
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': csp,
  };
  if (!frame) headers['X-Frame-Options'] = 'DENY';
  if (isHttps(req)) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
}
// реквизиты компании для печатных документов (задаются в интерфейсе: Настройки → Данные и компания)
function companyRequisites() {
  const g = k => getSetting(k, '');
  return {
    name: g('COMPANY_NAME') || 'Моя компания', inn: g('COMPANY_INN'), kpp: g('COMPANY_KPP'), ogrn: g('COMPANY_OGRN'),
    address: g('COMPANY_ADDRESS'), phone: g('COMPANY_PHONE'), email: g('COMPANY_EMAIL'), site: g('COMPANY_SITE'),
    bank: g('COMPANY_BANK'), account: g('COMPANY_ACCOUNT'), corr: g('COMPANY_CORR'), signer: g('COMPANY_SIGNER'), signer_position: g('COMPANY_SIGNER_POSITION'),
    currency: g('CURRENCY') || '₽', doc_prefix: g('DOC_PREFIX') || 'КП',
  };
}
const escHtml = (v = '') => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, cur = '₽') => new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0)) + ' ' + cur;
// печатная страница А4: открывается в новой вкладке и сразу готова к печати или сохранению в PDF
function dealDocument({ deal, items, doc, company }) {
  const isInvoice = doc === 'invoice';
  const sum = items.reduce((a, x) => a + x.price * x.qty, 0);
  const vat = Math.round(sum * 20 / 120);
  const number = `${company.doc_prefix}-${String(deal.id).padStart(4, '0')}`;
  const rows = items.map((x, i) => `<tr><td>${i + 1}</td><td>${escHtml(x.name)}</td><td>шт</td><td class="r">${money(x.price, company.currency)}</td><td class="r">${x.qty}</td><td class="r">${money(x.price * x.qty, company.currency)}</td></tr>`).join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${isInvoice ? 'Счёт' : 'КП'} № ${escHtml(number)} — ${escHtml(company.name)}</title>
<style>
  @page{margin:16mm}
  body{font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a;margin:0;padding:24px;max-width:900px}
  h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px}
  .head{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #16a34a;padding-bottom:12px}
  .brand{font-weight:800;color:#16a34a;font-size:18px}.muted{color:#64748b}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th,td{border:1px solid #cbd5e1;padding:7px 9px;text-align:left;vertical-align:top}
  th{background:#f1f5f9;font-size:12px;text-transform:uppercase;letter-spacing:.03em}
  td.r,th.r{text-align:right;white-space:nowrap}
  .total{margin-top:10px;text-align:right;font-size:15px;font-weight:700}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin-top:10px}
  .sign{margin-top:40px;display:flex;justify-content:space-between;gap:24px}
  .sign div{flex:1}.line{border-bottom:1px solid #94a3b8;height:26px}
  .noprint{margin:0 0 18px;padding:10px 12px;background:#f0fdf4;border:1px solid #16a34a;border-radius:10px;display:flex;gap:10px;align-items:center}
  .noprint button{cursor:pointer;border:0;background:#16a34a;color:#fff;padding:8px 14px;border-radius:8px;font:inherit;font-weight:600}
  @media print{.noprint{display:none}body{padding:0}}
</style></head><body>
<div class="noprint"><button onclick="window.print()">Печать / сохранить в PDF</button><span class="muted">Документ сформирован CRM ${new Date().toLocaleString('ru-RU')}</span></div>
<div class="head">
  <div><div class="brand">${escHtml(company.name)}</div>
    ${company.inn ? `<div class="muted">ИНН ${escHtml(company.inn)}${company.kpp ? ' · КПП ' + escHtml(company.kpp) : ''}${company.ogrn ? ' · ОГРН ' + escHtml(company.ogrn) : ''}</div>` : ''}
    ${company.address ? `<div class="muted">${escHtml(company.address)}</div>` : ''}
    <div class="muted">${[company.phone, company.email, company.site].filter(Boolean).map(escHtml).join(' · ')}</div></div>
  <div style="text-align:right"><h1>${isInvoice ? 'Счёт на оплату' : 'Коммерческое предложение'} № ${escHtml(number)}</h1>
    <div class="muted">от ${new Date().toLocaleDateString('ru-RU')}</div></div>
</div>
<h2>${isInvoice ? 'Плательщик' : 'Заказчик'}</h2>
<div class="grid"><div><b>${escHtml(deal.contact_name || '—')}</b>${deal.company_name ? `<br>${escHtml(deal.company_name)}` : ''}</div>
<div>${deal.contact_phone ? `Тел.: ${escHtml(deal.contact_phone)}<br>` : ''}${deal.contact_email ? `E-mail: ${escHtml(deal.contact_email)}` : ''}</div></div>
<h2>${isInvoice ? 'Предмет счёта' : 'Предложение'}${deal.title ? ' — ' + escHtml(deal.title) : ''}</h2>
<table><tr><th style="width:34px">№</th><th>Наименование</th><th style="width:70px">Ед.</th><th class="r" style="width:120px">Цена</th><th class="r" style="width:64px">Кол-во</th><th class="r" style="width:130px">Сумма</th></tr>
${rows || '<tr><td colspan="6" class="muted">Позиции не добавлены — заполните состав в карточке сделки</td></tr>'}</table>
<div class="total">Итого: ${money(sum, company.currency)}${isInvoice ? `<br><span class="muted">в том числе НДС 20%: ${money(vat, company.currency)}</span>` : ''}</div>
${isInvoice ? `<h2>Реквизиты для оплаты</h2><div class="grid"><div>${company.bank ? escHtml(company.bank) + '<br>' : ''}${company.account ? 'Р/с ' + escHtml(company.account) : ''}</div><div>${company.signer ? `Подписант: ${escHtml(company.signer_position || 'Руководитель')} ${escHtml(company.signer)}` : ''}</div></div>` : ''}
${deal.deadline ? `<p class="muted">Срок действия предложения / срок выполнения: ${escHtml(deal.deadline)}</p>` : ''}
<div class="sign"><div>${isInvoice ? 'Руководитель' : 'Исполнитель'}<div class="line"></div>${company.signer ? escHtml(company.signer) : ''}</div>
<div>Заказчик<div class="line"></div>${escHtml(deal.contact_name || '')}</div></div>
</body></html>`;
}
const html = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body); };
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
// простое ограничение частоты: защита от перебора пароля и от шторма запросов к источникам
const RL = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  // периодически чистим просроченные записи, чтобы Map не росла бесконечно
  if (RL.size > 10000) for (const k of RL.keys()) { const r = RL.get(k); if (now > r.resetAt) RL.delete(k); }
  const rec = RL.get(key);
  if (!rec || now > rec.resetAt) { RL.set(key, { count: 1, resetAt: now + windowMs }); return { ok: true, left: limit - 1 } }
  rec.count++;
  return { ok: rec.count <= limit, left: Math.max(0, limit - rec.count), retryAfter: Math.ceil((rec.resetAt - now) / 1000) };
}
const readBody = async (req, maxBytes = 5e6) => { let s = ''; for await (const ch of req) { s += ch; if (s.length > maxBytes) throw new Error('Слишком большой запрос'); } try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.zip': 'application/zip', '.txt': 'text/plain', '.csv': 'text/csv', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.patch': 'text/plain', '.diff': 'text/plain' };
// Определение типа изображения по сигнатуре файла: расширению доверять нельзя
// (логотип могут загрузить в .jpg, .png или любом другом формате).
function sniffImage(buf, fallback = 'application/octet-stream') {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return fallback;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') return 'image/gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) return 'image/x-icon';
  return fallback;
}
// Логотип: явный путь из LOGO_FILE → загруженный в интерфейсе → логотип из комплекта поставки.
function findCustomLogo() {
  try {
    if (!existsSync(CUSTOM_LOGO_DIR)) return null;
    const f = readdirSync(CUSTOM_LOGO_DIR).find(x => /^logo\.(png|jpe?g|gif|webp|ico)$/i.test(x));
    return f ? join(CUSTOM_LOGO_DIR, f) : null;
  } catch { return null; }
}
function resolveLogo() {
  if (process.env.LOGO_FILE && existsSync(process.env.LOGO_FILE)) return process.env.LOGO_FILE;
  return findCustomLogo() || (existsSync(BUNDLED_LOGO) ? BUNDLED_LOGO : null);
}
const IMAGE_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const FILE_UPLOAD_TYPES = [...IMAGE_UPLOAD_TYPES, 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
const safeFileName = name => String(name || 'файл').normalize('NFKD').replace(/[^\wа-яё ._\-()]/gi, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'файл';
// Имя файла на диске и в URL — только ASCII (кириллица транслитерируется), исходное имя остаётся в content_name.
const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const asciiFileName = name => String(name || 'file').normalize('NFKD').toLowerCase().split('').map(ch => {
  if (/[a-z0-9._-]/.test(ch)) return ch;
  if (ch === ' ') return '_';
  return TRANSLIT[ch] || TRANSLIT[ch.toLowerCase()] || '_';
}).join('').replace(/_+/g, '_').replace(/^[._-]+|[._-]+$/g, '').slice(0, 120) || 'file';
const csv = rows => { if (!rows.length) return ''; const ks = Object.keys(rows[0]); const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`; return [ks.join(';'), ...rows.map(r => ks.map(k => q(r[k])).join(';'))].join('\n'); };
const ADMIN_ONLY = [
  /^\/api\/settings(\/.*)?$/, /^\/api\/users(\/.*)?$/, /^\/api\/pipelines(\/.*)?$/, /^\/api\/automations(\/.*)?$/,
  /^\/api\/custom-fields(\/.*)?$/, /^\/api\/competitor-sources(\/.*)?$/,
  /^\/api\/backups(\/.*)?$/, /^\/api\/integrations(\/.*)?$/, /^\/api\/prices\/ours(\/.*)?$/,
  /^\/api\/demo\/cleanup$/,
];
function requireAdmin(user, res) { if (user.role !== 'admin') { json(res, 403, { error: 'Только для администратора' }); return false; } return true; }

function validateUser(b, creating = false) {
  if ((creating || b.name !== undefined) && (typeof b.name !== 'string' || !b.name.trim())) return 'Укажите имя';
  if ((creating || b.email !== undefined) && (typeof b.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim()))) return 'Укажите корректный e-mail';
  if ((creating || b.password) && (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 256)) return 'Пароль должен содержать от 8 до 256 символов';
  if (b.role !== undefined && !['admin', 'manager', 'viewer'].includes(b.role)) return 'Неизвестная роль';
  if (b.active !== undefined && ![0, 1].includes(b.active)) return 'Некорректный статус';
}

const competitorsApi = createCompetitors({ db, json, readBody, log, broadcast, getSetting, setSetting });


// начальное заполнение: только в полностью пустой базе, один раз,
// после того как все таблицы (включая конкурентов) созданы
if (!process.env.KARKAS_NO_SEED && SEED_MODE !== 'off' && !getSetting('SEED_DONE')) {
  const hasTable = t => db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(t).n > 0;
  const empty = ['contacts', 'deals', 'companies', 'conversations', 'competitors']
    .every(t => !hasTable(t) || db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n === 0);
  if (empty) {
    try {
      if (SEED_MODE === 'base') {
        const admin = db.prepare("SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1").get();
        seedBase(db, admin.id, 0);
        console.log('Загружены начальные данные: каталог, личные шаблоны администратора, пример правила (режим base). Всё редактируется в интерфейсе.');
      } else {
        const admin = db.prepare("SELECT id,name FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1").get();
        seedDemo(db, admin.id, admin.name);
        console.log('Загружены демонстрационные данные (режим demo). Удалить: Настройки → Данные и компания.');
      }
      setSetting('SEED_DONE', '1');
    } catch (e) { console.error('Не удалось заполнить начальные данные:', e) }
  }
}
// Разовая починка шаблонов из ранних сборок: при вставке были перепутаны
// текст и канал, поэтому в поле «текст» оказывался код канала (telegram, any),
// а сам текст — в поле «канал». Меняем местами только явно испорченные записи,
// поэтому повторный запуск ничего не портит.
try {
  const CODES = ['whatsapp', 'telegram', 'instagram', 'viber', 'email', 'any'];
  const holes = CODES.map(() => '?').join(',');
  const broken = db.prepare(`SELECT id, body, channel FROM templates WHERE lower(trim(COALESCE(body,''))) IN (${holes})
      AND lower(trim(COALESCE(channel,''))) NOT IN (${holes})`).all(...CODES, ...CODES);
  if (broken.length) {
    const fix = db.prepare('UPDATE templates SET body=?, channel=? WHERE id=?');
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const t of broken) fix.run(String(t.channel || ''), String(t.body || '').trim().toLowerCase(), t.id);
      db.exec('COMMIT');
      console.log(`Шаблоны: исправлен текст у ${broken.length} зап. (в ранней версии текст и канал были перепутаны).`);
    } catch (e) { db.exec('ROLLBACK'); throw e }
  }
} catch (e) { console.error('Не удалось проверить шаблоны:', e.message) }

export const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`), p = u.pathname;
  applySecurityHeaders(req, res);
  try {
    // ===== публичные вебхуки =====
    // защита от спам-шторма: лимит запросов с одного IP только на вебхуки
    if (p.startsWith('/webhooks/')) {
      const webhookIp = clientIp(req);
      const hookLimit = Number(getSetting('WEBHOOK_RATE_LIMIT', '120'));
      const rlHook = rateLimit('webhook:' + webhookIp, Number.isFinite(hookLimit) && hookLimit > 0 ? hookLimit : 120, 60000);
      if (!rlHook.ok) { res.setHeader('Retry-After', String(rlHook.retryAfter || 60)); return json(res, 429, { error: 'Слишком много запросов — повторите позже' }) }
    }
    if (p === '/webhooks/wazzup' && req.method === 'POST') {
      const secret = getSetting('WAZZUP_WEBHOOK_SECRET'); if (secret && u.searchParams.get('secret') !== secret && req.headers['x-webhook-secret'] !== secret) return json(res, 403, { error: 'bad secret' });
      const b = await readBody(req);
      const legacy = b.messages || [];
      const modern = (b.data || []).concat(!b.data && (b.message_id || b.messageId) ? [b] : []).map(m => ({
        messageId: m.message_id || m.messageId, channelId: m.channel_id || m.channelId, chatType: m.recipient?.chat_type || m.sender?.chat_type || m.chatType || 'whatsapp',
        chatId: m.recipient?.chat_id || m.sender?.chat_id || m.chatId, isEcho: (m.direction === 'outbound') || m.isEcho,
        text: m.text, type: m.attachment ? 'file' : 'text', contentUri: m.attachment?.url || m.contentUri, status: m.direction === 'inbound' ? 'inbound' : (m.status || 'sent'),
        authorName: m.sender?.name, contact: { name: m.sender?.name || m.recipient?.name, phone: m.sender?.phone || m.recipient?.phone }
      }));
      for (const m of legacy.concat(modern)) {
        if (m.status && m.status !== 'inbound') { db.prepare('UPDATE messages SET status=? WHERE external_id=?').run(m.status, m.messageId); continue; }
        if (m.isEcho) continue;
        upsertIncoming({ channel: m.chatType || 'whatsapp', chatType: m.chatType, phone: m.contact?.phone || '', chatId: m.chatId || '', name: m.contact?.name || m.authorName || '', body: m.text || (m.contentUri ? '[вложение: ' + (m.type || 'файл') + ']' : ''), contentUri: m.contentUri || '', external_id: m.messageId, channelId: m.channelId, author: m.authorName || '' });
      }
      for (const s of b.statuses || []) db.prepare('UPDATE messages SET status=? WHERE external_id=?').run(s.status, s.messageId);
      for (const cu of b.channelsUpdates || []) db.prepare('INSERT INTO channels(provider,external_id,state) VALUES(?,?,?) ON CONFLICT(external_id) DO UPDATE SET state=excluded.state').run('wazzup', cu.channelId, cu.state);
      return json(res, 200, { received: true });
    }
    // общий вебхук: форма сайта, свой бот Telegram, любая система, умеющая POST
    if (p === '/webhooks/generic' && req.method === 'POST') {
      // Секрет необязателен, но если он задан в настройках — без него заявки не принимаются.
      const secret = getSetting('WEBHOOK_SECRET');
      if (secret && u.searchParams.get('secret') !== secret && req.headers['x-webhook-secret'] !== secret) return json(res, 403, { error: 'Неверный секрет вебхука' });
      const b = await readBody(req);
      const msg = (b.message && typeof b.message === 'object') ? b.message : b;
      const channel = ['whatsapp', 'telegram', 'instagram', 'viber', 'email'].includes(b.channel) ? b.channel : 'site';
      const name = String((msg.from && msg.from.first_name) || b.name || '').slice(0, 120);
      upsertIncoming({ channel, chatType: b.chatType || channel, phone: String(b.phone || (msg.chat && msg.chat.id) || ''), chatId: String(b.chatId || ''), name, body: String(msg.text || b.body || ''), external_id: msg.message_id ? `${channel}-${msg.message_id}` : (b.external_id || null) });
      return json(res, 200, { received: true });
    }
    if (p === '/webhooks/email' && req.method === 'POST') {
      const secret = getSetting('EMAIL_WEBHOOK_SECRET');
      if (secret && u.searchParams.get('secret') !== secret && req.headers['x-webhook-secret'] !== secret) return json(res, 403, { error: 'bad secret' });
      const b = await readBody(req);
      upsertIncoming({ channel: 'email', chatType: 'email', email: String(b.from || b.email || '').trim(), name: b.name || String(b.from || '').split('@')[0] || 'E-mail', subject: b.subject || '', body: b.text || b.body || b.html || '', external_id: b.message_id || b.external_id || null, direction: 'in' });
      return json(res, 200, { received: true });
    }
    if (p === '/api/health') {
      // Публичный ответ — только факт работы и версия: этот адрес открыт без входа
      // (Docker healthcheck, мониторинг) и не должен раскрывать объём базы клиентов.
      const h = { ok: true, service: 'KarkasCRM', version: VERSION, schema: SCHEMA_VERSION, time: new Date().toISOString(), uptimeSec: Math.round((Date.now() - STARTED) / 1000) };
      const hToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || cookieOf(req).karkas_token || (req.method === 'GET' ? u.searchParams.get('token') : '');
      const hUser = verify(hToken || '');
      if (hUser && hUser.role === 'admin') {
        let dbSize = 0; try { dbSize = statSync(join(DATA_DIR, 'crm.db')).size } catch {}
        let backupsCount = 0, lastBackup = null;
        try { const dir = join(DATA_DIR, 'backups'); const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.db')).sort() : []; backupsCount = files.length; lastBackup = files.length ? files[files.length - 1] : null } catch {}
        Object.assign(h, {
          dbSizeBytes: dbSize, backups: { count: backupsCount, last: lastBackup },
          counts: {
            users: db.prepare('SELECT COUNT(*) n FROM users').get().n, contacts: db.prepare('SELECT COUNT(*) n FROM contacts').get().n,
            deals: db.prepare('SELECT COUNT(*) n FROM deals').get().n, tasks: db.prepare('SELECT COUNT(*) n FROM tasks WHERE done=0').get().n,
            messages: db.prepare('SELECT COUNT(*) n FROM messages').get().n,
          },
        });
      }
      return json(res, 200, h);
    }
    if (p === '/api/auth/login' && req.method === 'POST') {
      const ip = clientIp(req);
      // Жёсткий потолок на все запросы входа с одного IP: защищает от лавины запросов
      // (каждый требует вычисления scrypt). 300 за 5 минут — с запасом для офиса за одним IP.
      const flood = rateLimit('login-flood:' + ip, 300, 300000);
      if (!flood.ok) { res.setHeader('Retry-After', String(flood.retryAfter || 300)); return json(res, 429, { error: `Слишком много запросов на вход. Повторите через ${flood.retryAfter || 300} с.` }) }
      // Лимит из настроек считает только НЕУДАЧНЫЕ попытки: 50 сотрудников за одним
      // офисным IP могут войти одновременно, а подбор пароля всё равно упирается в предел.
      const limit = Math.max(1, Number(getSetting('LOGIN_RATE_LIMIT', '12')) || 12);
      const b = await readBody(req);
      const emailKey = String(b.email || '').trim().toLowerCase().slice(0, 160);
      const user = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(String(b.email || '').toLowerCase());
      // проверяем пароль даже для несуществующего e-mail: время ответа не выдаёт, зарегистрирован ли адрес
      const passOk = await checkPassAsync(String(b.password || ''), user ? user.pass : 'fake-salt:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000');
      if (!user || !passOk) {
        const rlIp = rateLimit('login:' + ip, limit, 300000);
        // второй лимит — на конкретный аккаунт: распределённый перебор с разных IP тоже упирается в предел
        const rlAcc = emailKey ? rateLimit('login-acc:' + emailKey, Math.max(limit * 2, 24), 300000) : { ok: true };
        if (!rlIp.ok || !rlAcc.ok) { res.setHeader('Retry-After', String(rlIp.retryAfter || rlAcc.retryAfter || 300)); return json(res, 429, { error: 'Слишком много неудачных попыток входа. Подождите несколько минут или обратитесь к администратору.' }) }
        return json(res, 401, { error: 'Неверный e-mail или пароль' });
      }
      // успешный вход обнуляет счётчики неудач — опечатка в пароле не блокирует офис
      RL.delete('login:' + ip);
      if (emailKey) RL.delete('login-acc:' + emailKey);
      const token = sign({ id: user.id, email: user.email, name: user.name, role: user.role });
      res.setHeader('Set-Cookie', sessionCookie(req, token));
      return json(res, 200, { token, user: { id: user.id, name: user.name, email: user.email, role: user.role, must_change_password: user.must_change_password } }); }
    if (p === '/api/auth/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', clearSessionCookie(req));
      return json(res, 200, { ok: true });
    }

    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    // токен в адресной строке допускаем только для GET (печать, вложения):
    // иначе ссылка с ?token= могла бы инициировать изменение данных
    const user = verify(bearer || cookieOf(req).karkas_token || (req.method === 'GET' ? u.searchParams.get('token') : '') || '');
    if (p.startsWith('/api/') && !user) return json(res, 401, { error: 'Требуется авторизация' });
    if (user?.must_change_password && (p.startsWith('/api/') || p.startsWith('/uploads/')) && !['/api/me', '/api/me/password'].includes(p)) return json(res, 403, { code: 'PASSWORD_CHANGE_REQUIRED', error: 'Сначала смените временный пароль' });
    if (user && user.role !== 'admin' && ['/api/settings', '/api/competitor-sources', '/api/backup', '/api/export/json', '/api/backups'].includes(p)) return json(res, 403, { error: 'Только для администратора' });
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('event: ready\ndata: {}\n\n');
      res.userId = user.id; clients.add(res);
      // heartbeat: прокси не рвут «молчащие» соединения
      const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
      res.on('close', () => { clearInterval(hb); clients.delete(res); });
      return;
    }
    if (p === '/api/me') return json(res, 200, { user });
    if (p === '/api/meta') return json(res, 200, {
      version: VERSION, schema: SCHEMA_VERSION, user,
      company: { name: getSetting('COMPANY_NAME', 'Моя компания'), currency: getSetting('CURRENCY', '₽') },
      taskTypes: [{ id: 'call', name: 'Звонок' }, { id: 'meeting', name: 'Встреча' }, { id: 'message', name: 'Сообщение' }, { id: 'email', name: 'Письмо' }, { id: 'other', name: 'Другое' }],
      sources: ['manual', 'wazzup-whatsapp', 'wazzup-telegram', 'wazzup-instagram', 'wazzup-viber', 'whatsapp', 'telegram', 'email', 'site', 'avito', 'import'],
      customFields: getCustomFields(),
      features: { email: !!getSetting('SMTP_HOST'), wazzup: !!getSetting('WAZZUP_API_KEY') },
      salesTarget: Number(getSetting('SALES_TARGET', '0')) || 0,
    });
    if (user && p.startsWith('/api/') && user.role === 'viewer' && req.method !== 'GET' && p !== '/api/me/password') return json(res, 403, { error: 'Роль «Наблюдатель» — только просмотр' });
    // настройки, команда, воронки, шаблоны, автоматизации, ключи и обслуживание — только администратор
    if (user && user.role !== 'admin' && req.method !== 'GET' && ADMIN_ONLY.some(re => re.test(p))) return json(res, 403, { error: 'Это может менять только администратор (роль в Настройки → Команда)' });

    // ===== dashboard / analytics =====
    if (p === '/api/dashboard') {
      const pipelineId = Number(u.searchParams.get('pipeline') || 1);
      const stages = getStages(pipelineId);
      const today = localDate();
      const myId = user?.id;
      // агрегация в SQL: не выгружаем все сделки в память
      const agg = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM deals WHERE stage NOT IN ('won','lost')").get();
      const stageStats = new Map(db.prepare('SELECT stage, COUNT(*) n, COALESCE(SUM(amount),0) s FROM deals GROUP BY stage').all().map(r => [r.stage, r]));
      const sumWhere = w => db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM deals WHERE ${w}`).get().s;
      const cntWhere = w => db.prepare(`SELECT COUNT(*) n FROM deals WHERE ${w}`).get().n;
      const myTasksOpen = db.prepare("SELECT COUNT(*) n FROM tasks WHERE done=0 AND (responsible_id=? OR (responsible_id IS NULL AND ? IS NULL))").get(myId, myId)?.n || 0;
      const now = localNow();
      const myTasksOverdue = db.prepare("SELECT COUNT(*) n FROM tasks WHERE done=0 AND (responsible_id=? OR (responsible_id IS NULL AND ? IS NULL)) AND due IS NOT NULL AND due != '' AND (CASE WHEN length(due)=10 THEN due || ' 23:59:59' ELSE due END) < ?").get(myId, myId, now)?.n || 0;
      const tasksToday = db.prepare("SELECT COUNT(*) n FROM tasks WHERE done=0 AND due LIKE ?").get(today + '%')?.n || 0;
      const tasksOverdue = db.prepare("SELECT COUNT(*) n FROM tasks WHERE done=0 AND due IS NOT NULL AND due != '' AND (CASE WHEN length(due)=10 THEN due || ' 23:59:59' ELSE due END) < ?").get(now)?.n || 0;
      return json(res, 200, {
        stages: stages.map(s => { const st = stageStats.get(s.code) || { n: 0, s: 0 }; return { ...s, count: st.n, sum: st.s } }),
        dealsTotal: agg.n,
        activeDealsSum: agg.s,
        revenue: sumWhere("stage='won'"),
        lostSum: sumWhere("stage='lost'"),
        contacts: db.prepare('SELECT COUNT(*) n FROM contacts').get().n,
        companies: db.prepare('SELECT COUNT(*) n FROM companies').get().n,
        unread: db.prepare('SELECT COALESCE(SUM(unread),0) n FROM conversations').get().n,
        tasksOpen: db.prepare('SELECT COUNT(*) n FROM tasks WHERE done=0').get().n,
        tasksToday,
        tasksOverdue,
        myTasksOpen,
        myTasksOverdue,
        conversion: (() => { const w = cntWhere("stage='won'"), l = cntWhere("stage='lost'"); return w + l ? Math.round(w / (w + l) * 100) : 0 })(),
        monthRevenue: sumWhere("stage='won' AND substr(COALESCE(closed_at,updated_at,''),1,7)=substr(datetime('now','localtime'),1,7)"),
        activities: db.prepare('SELECT * FROM activities ORDER BY id DESC LIMIT 10').all(),
        recentDeals: db.prepare('SELECT d.*,c.name contact_name FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id ORDER BY d.id DESC LIMIT 6').all()
      });
    }
    if (p === '/api/analytics') {
      // группировки в SQL — не выгружаем все сделки в память
      const by = (sql) => db.prepare(sql).all().map(r => ({ name: r.name || '—', count: r.n, sum: r.s }));
      const wonLost = db.prepare("SELECT SUM(stage='won') w, SUM(stage='lost') l, SUM(CASE WHEN stage='won' THEN amount ELSE 0 END) wonSum FROM deals").get();
      const wonCount = wonLost.w || 0, lostCount = wonLost.l || 0, wonSum = wonLost.wonSum || 0;
      const month = localDate().slice(0, 7);
      const monthRow = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM deals WHERE stage='won' AND substr(COALESCE(closed_at,updated_at,''),1,7)=?").get(month);
      const target = Number(getSetting('SALES_TARGET', '0')) || 0;
      const plan = { target, fact: monthRow.s, month, deals: monthRow.n, percent: target ? Math.round(monthRow.s / target * 100) : null };
      const forecast = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM deals WHERE stage NOT IN ('won','lost')").get().s;
      return json(res, 200, {
        plan,
        conversion: wonCount + lostCount ? Math.round(wonCount / (wonCount + lostCount) * 100) : 0,
        avgCheck: wonCount ? Math.round(wonSum / wonCount) : 0,
        forecast,
        bySource: by('SELECT c.source name, COUNT(*) n, COALESCE(SUM(d.amount),0) s FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id GROUP BY c.source'),
        byManager: by('SELECT COALESCE(d.responsible,\'—\') name, COUNT(*) n, COALESCE(SUM(d.amount),0) s FROM deals d GROUP BY d.responsible'),
        byLoss: by("SELECT COALESCE(loss_reason,'—') name, COUNT(*) n, COALESCE(SUM(amount),0) s FROM deals WHERE stage='lost' GROUP BY loss_reason"),
        stages: getStages().map(s => { const r = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM deals WHERE stage=?').get(s.code); return { name: s.name, code: s.code, count: r.n, sum: r.s } }),
      });
    }
    if (p === '/api/contacts/duplicates') {
      // дубли ищем по нормализованному телефону и почте — индексы, а не полный скан
      const phoneGroups = db.prepare("SELECT phone_norm k, COUNT(*) n FROM contacts WHERE phone_norm IS NOT NULL GROUP BY phone_norm HAVING n > 1").all();
      const emailGroups = db.prepare("SELECT lower(email) k, COUNT(*) n FROM contacts WHERE email IS NOT NULL AND email != '' GROUP BY lower(email) HAVING n > 1").all();
      const groups = [];
      for (const g of phoneGroups) groups.push({ key: 'phone:' + g.k, type: 'phone', contacts: db.prepare('SELECT * FROM contacts WHERE phone_norm=? ORDER BY id').all(g.k) });
      for (const g of emailGroups) groups.push({ key: 'email:' + g.k, type: 'email', contacts: db.prepare('SELECT * FROM contacts WHERE lower(email)=lower(?) ORDER BY id').all(g.k) });
      return json(res, 200, { groups, total: groups.reduce((a, g) => a + g.contacts.length - 1, 0) });
    }
    if (p === '/api/contacts/merge' && req.method === 'POST') {
      const b = await readBody(req);
      // принимаем оба варианта имён полей: интерфейс шлёт keep_id/merge_ids, старые вызовы — keep/ids
      const keepId = Number(b.keep_id ?? b.keep), mergeIds = [...new Set((b.merge_ids || b.ids || []).map(Number).filter(id => id && id !== keepId))];
      if (mergeIds.length > 50) return json(res, 400, { error: 'За один раз можно объединить не больше 50 карточек' });
      const keep = db.prepare('SELECT * FROM contacts WHERE id=?').get(keepId);
      if (!keep || !mergeIds.length) return json(res, 400, { error: 'Укажите основного контакта и что с ним объединить' });
      const others = mergeIds.map(id => db.prepare('SELECT * FROM contacts WHERE id=?').get(id)).filter(Boolean);
      db.exec('BEGIN');
      try {
        for (const o of others) {
          // переносим сделки, задачи, заметки
          db.prepare('UPDATE deals SET contact_id=? WHERE contact_id=?').run(keepId, o.id);
          db.prepare('UPDATE tasks SET contact_id=? WHERE contact_id=?').run(keepId, o.id);
          db.prepare("UPDATE notes SET entity_id=? WHERE entity_type='contacts' AND entity_id=?").run(keepId, o.id);
          // чаты: сообщения переносим в чат основного контакта, дубликат чата удаляем
          const mine = db.prepare('SELECT * FROM conversations WHERE contact_id=?').get(keepId);
          const theirs = db.prepare('SELECT * FROM conversations WHERE contact_id=?').get(o.id);
          if (theirs && mine) {
            db.prepare('UPDATE messages SET conversation_id=? WHERE conversation_id=?').run(mine.id, theirs.id);
            db.prepare('UPDATE conversations SET channels=?, unread=unread+? WHERE id=?').run([...new Set([...(mine.channels || '').split(','), ...(theirs.channels || '').split(',')].filter(Boolean))].join(','), theirs.unread || 0, mine.id);
            db.prepare('DELETE FROM conversations WHERE id=?').run(theirs.id);
          } else if (theirs && !mine) db.prepare('UPDATE conversations SET contact_id=? WHERE id=?').run(keepId, theirs.id);
          // объединяем теги и заполняем пустые поля
          const tags = [...new Set([...(keep.tags || '').split(','), ...(o.tags || '').split(',')].map(x => x.trim()).filter(Boolean))].join(',');
          db.prepare('UPDATE contacts SET tags=? WHERE id=?').run(tags, keepId); keep.tags = tags;
          for (const f of ['phone', 'email', 'company', 'position', 'notes', 'company_id']) {
            if (!keep[f] && o[f]) { db.prepare(`UPDATE contacts SET ${f}=? WHERE id=?`).run(o[f], keepId); keep[f] = o[f]; }
          }
          db.prepare('DELETE FROM contacts WHERE id=?').run(o.id);
        }
        // телефон мог быть заполнен из объединяемой карточки — пересчитываем нормализованный вид
        db.prepare('UPDATE contacts SET phone_norm=? WHERE id=?').run(digits(keep.phone) || null, keepId);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e }
      log(`Контакты объединены: ${others.map(o => o.name).join(', ')} → ${keep.name}`, 'contacts', keepId, user.name);
      broadcast('change', { table: 'contacts' });
      return json(res, 200, { kept: keepId, merged: mergeIds.length, contact: db.prepare('SELECT * FROM contacts WHERE id=?').get(keepId) });
    }
    if (p === '/api/search') {
      // SQLite сравнивает кириллицу в LIKE с учётом регистра, поэтому фильтруем по строке в JS —
      // так «ирина», «Ирина» и «ИРИНА» находят одного клиента
      const raw = String(u.searchParams.get('q') || '').trim();
      if (raw.length < 2) return json(res, 200, { contacts: [], deals: [], companies: [], tasks: [] });
      const needle = raw.toLowerCase();
      // телефон ищется и слитно: «9991234567» находит «+7 999 123-45-67»
      const needleDigits = digits(raw);
      const hit = (...vals) => vals.some(v => String(v ?? '').toLowerCase().includes(needle)
        || (needleDigits.length >= 3 && digits(v).includes(needleDigits)));
      const contacts = db.prepare('SELECT id,name,phone,email,company FROM contacts ORDER BY id DESC LIMIT 2000').all().filter(c => hit(c.name, c.phone, c.email, c.company)).slice(0, 8);
      const deals = db.prepare('SELECT id,title,amount FROM deals ORDER BY id DESC LIMIT 2000').all().filter(d => hit(d.title, d.amount)).slice(0, 8);
      const companies = db.prepare('SELECT id,name,inn FROM companies ORDER BY id DESC LIMIT 1000').all().filter(c => hit(c.name, c.inn)).slice(0, 5);
      const tasks = db.prepare('SELECT id,title,due,done,type FROM tasks ORDER BY id DESC LIMIT 2000').all().filter(t => hit(t.title)).slice(0, 6);
      return json(res, 200, { contacts, deals, companies, tasks });
    }
    if (p === '/api/export/json' || p === '/api/backup') {
      // полная выгрузка содержит пользователей и настройки — только администратор
      if (!requireAdmin(user, res)) return;
      const tables = ['users', 'companies', 'contacts', 'pipelines', 'stages', 'deals', 'tasks', 'notes', 'products', 'templates', 'automations', 'conversations', 'messages', 'channels', 'competitors', 'competitor_checks', 'competitor_reports', 'reviews', 'price_rows']; const out = {}; tables.forEach(t => out[t] = db.prepare(`SELECT * FROM ${t}`).all()); res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename=karkas-backup.json' }); return res.end(JSON.stringify(out, null, 2)); }

    // ===== generic CRUD =====
    const CRUD = { contacts: ['name', 'phone', 'email', 'company', 'company_id', 'position', 'source', 'tags', 'notes', 'responsible_id', 'custom'], companies: ['name', 'inn', 'phone', 'email', 'site', 'notes'], tasks: ['title', 'type', 'due', 'priority', 'done', 'deal_id', 'contact_id', 'responsible_id', 'result', 'repeat'], products: ['name', 'sku', 'price', 'unit', 'active'], templates: ['name', 'body', 'channel'], automations: ['name', 'trigger_type', 'trigger_value', 'action_type', 'action_value', 'active'], notes: ['entity_type', 'entity_id', 'body', 'author'] };
    const mCrud = p.match(/^\/api\/(contacts|companies|tasks|products|templates|automations|notes)(?:\/(\d+))?$/);
    if (mCrud) { const [, table, id] = mCrud; const fields = CRUD[table];
      if (table === 'templates') {
        // шаблоны личные: каждый видит и правит только свои — без вкладок и переключателей
        if (req.method === 'GET' && !id) return json(res, 200, db.prepare('SELECT * FROM templates WHERE user_id=? ORDER BY id DESC').all(user.id));
        if (req.method === 'POST') {
          const b = await readBody(req);
          const r = db.prepare('INSERT INTO templates(name,body,channel,user_id) VALUES(?,?,?,?)')
            .run(String(b.name || '').slice(0, 80) || 'Шаблон', String(b.body || '').slice(0, 20000),
              ['whatsapp', 'telegram', 'instagram', 'viber', 'email', 'any'].includes(b.channel) ? b.channel : 'any', user.id);
          log('Создан шаблон', 'templates', Number(r.lastInsertRowid), user.name);
          broadcast('change', { table });
          return json(res, 201, db.prepare('SELECT * FROM templates WHERE id=?').get(r.lastInsertRowid));
        }
        if (id) {
          const tpl = db.prepare('SELECT * FROM templates WHERE id=?').get(id);
          if (!tpl) return json(res, 404, { error: 'Шаблон не найден' });
          if (tpl.user_id !== user.id) return json(res, 403, { error: 'Это чужой шаблон — можно менять только свои' });
          if (req.method === 'PATCH') { const b = await readBody(req); const ks = Object.keys(b).filter(k => ['name', 'body', 'channel'].includes(k)); if (ks.length) db.prepare(`UPDATE templates SET ${ks.map(k => k + '=?')} WHERE id=?`).run(...ks.map(k => k === 'name' ? String(b[k]).slice(0, 80) : k === 'body' ? String(b[k]).slice(0, 20000) : b[k]), id); broadcast('change', { table }); return json(res, 200, db.prepare('SELECT * FROM templates WHERE id=?').get(id)); }
          if (req.method === 'DELETE') { db.prepare('DELETE FROM templates WHERE id=?').run(id); log('Шаблон удалён', 'templates', Number(id), user.name); broadcast('change', { table }); return json(res, 200, { deleted: true }); }
        }
        return json(res, 405, { error: 'Метод не поддерживается' });
      }
      // автоматизации и товары удаляет администратор — иначе правила и прайс
      // может случайно переписать любой менеджер
      if (req.method !== 'GET' && table === 'automations' && !requireAdmin(user, res)) return;
      if (req.method === 'DELETE' && table === 'products' && !requireAdmin(user, res)) return;
      if (req.method === 'GET' && !id) { if (table === 'tasks') return json(res, 200, db.prepare('SELECT t.*,c.name contact_name,d.title deal_title,u.name responsible_name FROM tasks t LEFT JOIN contacts c ON c.id=t.contact_id LEFT JOIN deals d ON d.id=t.deal_id LEFT JOIN users u ON u.id=t.responsible_id ORDER BY done,due,id DESC').all()); if (table === 'notes') return json(res, 200, db.prepare('SELECT * FROM notes WHERE entity_type=? AND entity_id=? ORDER BY id DESC').all(u.searchParams.get('type'), u.searchParams.get('entity'))); return json(res, 200, db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all()); }
      if (req.method === 'GET') {
        const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
        return row ? json(res, 200, row) : json(res, 404, { error: 'Запись не найдена — возможно, её уже удалили. Обновите страницу.' });
      }
      // товар: цена только неотрицательная, поля обрезаем по длине
      const normalizeProduct = b => {
        if (b.price !== undefined) { const pr = Number(b.price); if (!Number.isFinite(pr) || pr < 0) return 'Цена должна быть неотрицательным числом'; b.price = Math.round(pr); }
        if (b.active !== undefined) b.active = b.active ? 1 : 0;
        if (b.sku !== undefined) b.sku = String(b.sku).trim().slice(0, 80);
        if (b.unit !== undefined) b.unit = String(b.unit).trim().slice(0, 20) || 'шт';
        if (b.name !== undefined) b.name = String(b.name).trim().slice(0, 200);
        return null;
      };
      if (req.method === 'POST') {
        const b = await readBody(req); if (table === 'notes') b.author = user.name;
        if (table === 'products') { const err = normalizeProduct(b); if (err) return json(res, 400, { error: err }); }
        if (table === 'tasks' && b.due && !normalizeDue(String(b.due))) return json(res, 400, { error: 'Не поняли срок. Укажите дату как 25.10.2026 14:00 или «завтра 10:00».' });
        // обязательные поля проверяем до SQL: иначе пользователь увидит 500 вместо подсказки
        const required = { contacts: 'name', companies: 'name', products: 'name', tasks: 'title', automations: 'name', templates: 'name' }[table];
        if (required && !String(b[required] || '').trim()) return json(res, 400, { error: required === 'name' ? 'Укажите название' : 'Укажите название задачи' });
        if (table === 'notes' && !String(b.body || '').trim()) return json(res, 400, { error: 'Заметка не может быть пустой' });
        // проверка дублей при создании контакта: интерфейс шлёт check_duplicates=1,
        // чтобы показать «такой клиент уже есть» и не плодить карточки
        if (table === 'contacts' && u.searchParams.get('check_duplicates') === '1') {
          const ph = digits(b.phone), em = String(b.email || '').trim().toLowerCase();
          const dup = (ph && db.prepare('SELECT id,name,phone FROM contacts WHERE phone_norm=?').get(ph))
            || (em && db.prepare('SELECT id,name,phone FROM contacts WHERE lower(email)=?').get(em));
          if (dup) return json(res, 409, { error: `Клиент с такими контактами уже есть: ${dup.name}`, duplicate: { id: dup.id, name: dup.name, phone: dup.phone || '' } });
        }
        // при создании обязательные поля проверяются всегда, при частичном обновлении — только если custom передан
        if (table === 'contacts') { const err = missingRequiredCustom('contacts', b.custom); if (err) return json(res, 400, { error: err }); }
        // связанные записи должны существовать: понятная ошибка вместо сбоя внешнего ключа
        const fk = { tasks: [['deal_id', 'deals'], ['contact_id', 'contacts'], ['responsible_id', 'users']], contacts: [['company_id', 'companies'], ['responsible_id', 'users']] }[table] || [];
        for (const [field, target] of fk) {
          if (b[field] && !db.prepare(`SELECT 1 x FROM ${target} WHERE id=?`).get(b[field])) return json(res, 400, { error: 'Связанная запись не найдена — обновите страницу и выберите из списка' });
        }
        if (table === 'tasks' && b.due) b.due = normalizeDue(String(b.due));
        const ks = fields.filter(f => b[f] !== undefined), vals = ks.map(k => b[k]);
        if (table === 'contacts' && b.phone !== undefined) { ks.push('phone_norm'); vals.push(digits(b.phone) || null); }
        const r = db.prepare(`INSERT INTO ${table}(${ks}) VALUES(${ks.map(() => '?')})`).run(...vals);
        log(`Создано (${table} #${r.lastInsertRowid})`, table, Number(r.lastInsertRowid), user.name);
        broadcast('change', { table });
        return json(res, 201, db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(r.lastInsertRowid));
      }
      if (req.method === 'PATCH' && id) {
        const b = await readBody(req);
        if (table === 'products') { const err = normalizeProduct(b); if (err) return json(res, 400, { error: err }); }
        if (table === 'tasks' && b.due !== undefined) {
          const norm = b.due ? normalizeDue(String(b.due)) : '';
          if (b.due && !norm) return json(res, 400, { error: 'Не поняли срок. Укажите дату как 25.10.2026 14:00 или «завтра 10:00».' });
          b.due = norm;
        }
        const ks = Object.keys(b).filter(k => fields.includes(k));
        if (table === 'contacts' && b.custom !== undefined) { const err = missingRequiredCustom('contacts', b.custom); if (err) return json(res, 400, { error: err }); }
        if (table === 'contacts' && b.phone !== undefined && !ks.includes('phone_norm')) { ks.push('phone_norm'); b.phone_norm = digits(b.phone) || null; }
        if (ks.length) db.prepare(`UPDATE ${table} SET ${ks.map(k => k + '=?')} WHERE id=?`).run(...ks.map(k => b[k]), id);
        // закрыли повторяющуюся задачу — сразу создаём следующую по расписанию
        let nextTaskId = null;
        if (table === 'tasks' && Number(b.done) === 1) {
          const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
          if (t && t.repeat && t.repeat !== 'none') {
            const days = { daily: 1, weekly: 7, monthly: 30 }[t.repeat] || 0;
            const base = /^\d{4}-\d{2}-\d{2}/.test(t.due || '') ? new Date(String(t.due).replace(' ', 'T')) : new Date();
            const next = new Date(Math.max(base.getTime(), Date.now()) + days * 864e5);
            const time = /\d{2}:\d{2}/.test(t.due || '') ? String(t.due).slice(-5) : '10:00';
            const due = `${localDate(next)} ${time}`;
            const r = db.prepare('INSERT INTO tasks(title,type,due,priority,done,deal_id,contact_id,responsible_id,result,repeat) VALUES(?,?,?,?,0,?,?,?,?,?)')
              .run(t.title, t.type, due, t.priority || 'normal', t.deal_id, t.contact_id, t.responsible_id, t.result, t.repeat);
            nextTaskId = Number(r.lastInsertRowid);
            log(`Повторяющаяся задача «${t.title}» продлена до ${due}`, 'tasks', nextTaskId, user.name);
            broadcast('change', { table: 'tasks' });
          }
        }
        broadcast('change', { table });
        const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
        return json(res, 200, nextTaskId ? { ...row, next_task_id: nextTaskId } : row);
      }
      if (req.method === 'DELETE' && id) {
        // связанные записи не должны оставаться с «висячими» ссылками
        if (table === 'contacts') {
          db.prepare('UPDATE tasks SET contact_id=NULL WHERE contact_id=?').run(id);
          db.prepare('UPDATE deals SET contact_id=NULL WHERE contact_id=?').run(id);
          db.prepare("DELETE FROM notes WHERE entity_type='contacts' AND entity_id=?").run(id);
        }
        if (table === 'companies') {
          db.prepare('UPDATE deals SET company_id=NULL WHERE company_id=?').run(id);
          db.prepare('UPDATE contacts SET company_id=NULL WHERE company_id=?').run(id);
          db.prepare("DELETE FROM notes WHERE entity_type='companies' AND entity_id=?").run(id);
        }
        const gone = db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id).changes;
        if (!gone) return json(res, 404, { error: 'Запись не найдена — обновите страницу' });
        broadcast('change', { table });
        return json(res, 200, { deleted: true });
      }
    }
    // ===== pipelines & stages (configurable) =====
    if (p === '/api/pipelines') {
      if (req.method === 'GET') return json(res, 200, db.prepare('SELECT * FROM pipelines ORDER BY id').all().map(pl => ({ ...pl, stages: getStages(pl.id) })));
      if (req.method === 'POST') { if (!requireAdmin(user, res)) return; const b = await readBody(req); const r = db.prepare('INSERT INTO pipelines(name) VALUES(?)').run(b.name || 'Новая воронка'); const st = db.prepare('INSERT INTO stages(pipeline_id,code,name,color,sort,kind) VALUES(?,?,?,?,?,?)'); [['new', 'Неразобранное', '#f97316', 0, 'open'], ['won', 'Успешно реализовано', '#15803d', 1, 'won'], ['lost', 'Закрыто и не реализовано', '#78716c', 2, 'lost']].forEach(x => st.run(r.lastInsertRowid, ...x)); return json(res, 201, { id: r.lastInsertRowid }); }
    }
    const mPipe = p.match(/^\/api\/pipelines\/(\d+)$/);
    if (mPipe && req.method === 'PUT') {
      if (!requireAdmin(user, res)) return;
      const b = await readBody(req), pid = Number(mPipe[1]);
      const pipe = db.prepare('SELECT * FROM pipelines WHERE id=?').get(pid);
      if (!pipe) return json(res, 404, { error: 'Воронка не найдена' });
      const list = Array.isArray(b.stages) ? b.stages : null;
      if (!list) return json(res, 400, { error: 'Не передан список этапов' });
      if (list.length < 2) return json(res, 400, { error: 'Нужно минимум 2 этапа: сделка не может «повиснуть» без этапа' });
      const clean = [];
      for (let i = 0; i < list.length; i++) {
        const st = list[i] || {};
        const name = String(st.name || '').trim().slice(0, 60);
        if (!name) return json(res, 400, { error: `У этапа №${i + 1} нет названия` });
        clean.push({ code: String(st.code || ('s' + Date.now() + i)).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || ('s' + Date.now() + i), name, color: /^#[0-9a-f]{6}$/i.test(st.color || '') ? st.color : '#16a34a', kind: ['open', 'won', 'lost'].includes(st.kind) ? st.kind : 'open' });
      }
      if (new Set(clean.map(x => x.code)).size !== clean.length) return json(res, 400, { error: 'Этапы не должны повторяться' });
      // нельзя терять сделки: этап с карточками сначала переносят
      const keep = new Set(clean.map(x => x.code));
      const lost = db.prepare('SELECT stage, COUNT(*) n FROM deals WHERE pipeline_id=? GROUP BY stage').all(pid).filter(r => !keep.has(r.stage));
      if (lost.length) {
        const names = lost.map(r => `«${r.stage}» — ${r.n}`).join(', ');
        return json(res, 400, { error: `На удаляемых этапах есть сделки (${names}). Сначала переведите их на другой этап в канбане, затем сохраните воронку.` });
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE pipelines SET name=? WHERE id=?').run(String(b.name || pipe.name).trim().slice(0, 80) || pipe.name, pid);
        db.prepare('DELETE FROM stages WHERE pipeline_id=?').run(pid);
        const st = db.prepare('INSERT INTO stages(pipeline_id,code,name,color,sort,kind) VALUES(?,?,?,?,?,?)');
        clean.forEach((x, i) => st.run(pid, x.code, x.name, x.color, i, x.kind));
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e }
      log('Воронка и этапы обновлены', 'pipelines', pid, user.name);
      broadcast('change', { table: 'pipelines' });
      return json(res, 200, { saved: true, stages: getStages(pid) });
    }
    if (mPipe && req.method === 'DELETE') {
      if (!requireAdmin(user, res)) return;
      if (db.prepare('SELECT COUNT(*) n FROM pipelines').get().n <= 1) return json(res, 400, { error: 'Это единственная воронка — удалять её нельзя, иначе новым сделкам некуда попадать' });
      const used = db.prepare('SELECT COUNT(*) n FROM deals WHERE pipeline_id=?').get(mPipe[1]).n;
      if (used) return json(res, 400, { error: `В воронке ${used} сделок — перенесите их в другую воронку, потом удаляйте` });
      db.prepare('DELETE FROM pipelines WHERE id=?').run(mPipe[1]);
      return json(res, 200, { deleted: true });
    }

    // ===== deals =====
    if (p === '/api/deals') {
      if (req.method === 'GET') return json(res, 200, { pipelines: db.prepare('SELECT * FROM pipelines').all(), stages: getStages(Number(u.searchParams.get('pipeline') || 1)), deals: db.prepare('SELECT d.*,c.name contact_name,c.phone contact_phone,co.name company_name,(SELECT COUNT(*) FROM tasks t WHERE t.deal_id=d.id AND t.done=0) as tasks_open,(SELECT MIN(t.due) FROM tasks t WHERE t.deal_id=d.id AND t.done=0) as next_task_due FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id LEFT JOIN companies co ON co.id=d.company_id ORDER BY d.id DESC').all() });
      if (req.method === 'POST') { const b = await readBody(req); if (!String(b.title || '').trim()) return json(res, 400, { error: 'Укажите название сделки' });
        b.title = String(b.title).trim().slice(0, 200);
        const pipelineId = Number(b.pipeline_id) || 1;
        if (!db.prepare('SELECT 1 x FROM pipelines WHERE id=?').get(pipelineId)) return json(res, 400, { error: 'Воронка не найдена — обновите страницу и выберите другую' });
        const stageList = getStages(pipelineId);
        const stage = b.stage ? String(b.stage) : (stageList[0]?.code || 'new');
        if (!stageList.some(x => x.code === stage)) return json(res, 400, { error: 'Этап не найден в выбранной воронке — обновите страницу' });
        const amount = (b.amount === undefined || b.amount === null || b.amount === '') ? 0 : Number(b.amount);
        if (!Number.isFinite(amount) || amount < 0) return json(res, 400, { error: 'Сумма сделки должна быть неотрицательным числом' });
        b.pipeline_id = pipelineId; b.stage = stage; b.amount = Math.round(amount);
        b.contact_id = b.contact_id ? Number(b.contact_id) : null;
        b.company_id = b.company_id ? Number(b.company_id) : null;
        if (b.contact_id !== null && (!Number.isInteger(b.contact_id) || b.contact_id <= 0)) return json(res, 400, { error: 'Некорректный клиент — выберите контакт из списка' });
        if (b.company_id !== null && (!Number.isInteger(b.company_id) || b.company_id <= 0)) return json(res, 400, { error: 'Некорректная компания — выберите из списка' });
        if (b.contact_id && !db.prepare('SELECT 1 x FROM contacts WHERE id=?').get(b.contact_id)) return json(res, 400, { error: 'Клиент не найден — выберите контакт из списка' });
        if (b.company_id && !db.prepare('SELECT 1 x FROM companies WHERE id=?').get(b.company_id)) return json(res, 400, { error: 'Компания не найдена — обновите страницу и выберите из списка' });
        if (b.responsible_id !== undefined && b.responsible_id !== null && b.responsible_id !== '' && !db.prepare('SELECT 1 x FROM users WHERE id=?').get(b.responsible_id)) return json(res, 400, { error: 'Ответственный не найден — обновите страницу и выберите сотрудника' });
        { const err = missingRequiredCustom('deals', b.custom); if (err) return json(res, 400, { error: err }); } const fields = ['title', 'amount', 'stage', 'pipeline_id', 'contact_id', 'company_id', 'responsible', 'responsible_id', 'priority', 'loss_reason', 'deadline', 'custom']; const ks = fields.filter(f => b[f] !== undefined); const r = db.prepare(`INSERT INTO deals(${ks}) VALUES(${ks.map(() => '?')})`).run(...ks.map(k => b[k])); log(`Сделка создана: ${b.title}`, 'deals', Number(r.lastInsertRowid), user.name); runAutomations('deal_created', { deal_id: Number(r.lastInsertRowid), contact_id: b.contact_id }); broadcast('change', { table: 'deals' }); return json(res, 201, db.prepare('SELECT * FROM deals WHERE id=?').get(r.lastInsertRowid)); }
    }
    // ===== печать документов по сделке: коммерческое предложение или счёт =====
    if (/^\/api\/deals\/\d+\/print$/.test(p) && req.method === 'GET') {
      const id = Number(p.split('/')[3]);
      const deal = db.prepare('SELECT d.*,c.name contact_name,c.phone contact_phone,c.email contact_email,co.name company_name FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id LEFT JOIN companies co ON co.id=d.company_id WHERE d.id=?').get(id);
      if (!deal) return json(res, 404, { error: 'Сделка не найдена' });
      const doc = u.searchParams.get('doc') === 'invoice' ? 'invoice' : 'quote';
      const items = db.prepare('SELECT * FROM deal_products WHERE deal_id=? ORDER BY id').all(id);
      return html(res, 200, dealDocument({ deal, items, doc, company: companyRequisites() }));
    }

    const mDeal = p.match(/^\/api\/deals\/(\d+)(?:\/(products))?$/);
    if (mDeal) { const id = mDeal[1];
      if (mDeal[2] === 'products') {
        if (req.method === 'GET') return json(res, 200, db.prepare('SELECT * FROM deal_products WHERE deal_id=?').all(id));
        if (req.method === 'POST') {
          if (!db.prepare('SELECT id FROM deals WHERE id=?').get(id)) return json(res, 404, { error: 'Сделка не найдена' });
          const b = await readBody(req);
          const pr = b.product_id ? db.prepare('SELECT * FROM products WHERE id=?').get(b.product_id) : null;
          const price = Math.max(0, Number(b.price ?? pr?.price ?? 0) || 0), qty = Math.max(0.001, Number(b.qty) || 1);
          const name = String(b.name || pr?.name || 'Позиция').slice(0, 200);
          const r = db.prepare('INSERT INTO deal_products(deal_id,product_id,name,price,qty) VALUES(?,?,?,?,?)').run(id, b.product_id || null, name, price, qty); const sum = db.prepare('SELECT COALESCE(SUM(price*qty),0) s FROM deal_products WHERE deal_id=?').get(id).s; db.prepare('UPDATE deals SET amount=? WHERE id=?').run(sum, id); broadcast('change', { table: 'deals' }); return json(res, 201, db.prepare('SELECT * FROM deal_products WHERE id=?').get(r.lastInsertRowid)); }
        return json(res, 405, { error: 'Метод не поддерживается' });
      }
      if (req.method === 'GET') {
        const deal = db.prepare('SELECT d.*,c.name contact_name,c.phone contact_phone,c.email contact_email,u.name responsible_name FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id LEFT JOIN users u ON u.id=d.responsible_id WHERE d.id=?').get(id);
        if (!deal) return json(res, 404, { error: 'Сделка не найдена' });
        const products = db.prepare('SELECT dp.*,pr.name product_name FROM deal_products dp LEFT JOIN products pr ON pr.id=dp.product_id WHERE dp.deal_id=?').all(id);
        // переписка клиента по этой сделке — единый диалог прямо в карточке
        const conv = deal?.contact_id ? db.prepare('SELECT id,title,channels,unread,chat_type FROM conversations WHERE contact_id=? ORDER BY last_at DESC').get(deal.contact_id) : null;
        const messages = conv ? db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT 40').all(conv.id).reverse() : [];
        return json(res, 200, { deal, notes: db.prepare("SELECT * FROM notes WHERE entity_type='deals' AND entity_id=? ORDER BY id DESC").all(id), tasks: db.prepare('SELECT * FROM tasks WHERE deal_id=? ORDER BY id DESC').all(id), products, history: db.prepare("SELECT * FROM activities WHERE entity_type='deals' AND entity_id=? ORDER BY id DESC LIMIT 20").all(id), conversation: conv, messages });
      }
      if (req.method === 'PATCH') { const b = await readBody(req); const old = db.prepare('SELECT * FROM deals WHERE id=?').get(id);
        if (!old) return json(res, 404, { error: 'Сделка не найдена' });
        if (b.title !== undefined && !String(b.title || '').trim()) return json(res, 400, { error: 'Название сделки не может быть пустым' });
        if (b.title !== undefined) b.title = String(b.title).trim().slice(0, 200);
        if (b.pipeline_id !== undefined) { const pid = Number(b.pipeline_id); if (!db.prepare('SELECT 1 x FROM pipelines WHERE id=?').get(pid)) return json(res, 400, { error: 'Воронка не найдена — обновите страницу' }); b.pipeline_id = pid; }
        const dealPipeline = Number(b.pipeline_id ?? old.pipeline_id) || 1;
        const dealStages = getStages(dealPipeline);
        if (b.stage !== undefined) {
          b.stage = String(b.stage);
          if (!dealStages.some(x => x.code === b.stage)) return json(res, 400, { error: 'Этап не найден в выбранной воронке — обновите страницу' });
        } else if (b.pipeline_id !== undefined && !dealStages.some(x => x.code === old.stage)) {
          // воронку сменили, а этап остался от старой — ставим первый этап новой
          b.stage = dealStages[0]?.code || old.stage;
        }
        if (b.amount !== undefined) { const amount = b.amount === null || b.amount === '' ? 0 : Number(b.amount); if (!Number.isFinite(amount) || amount < 0) return json(res, 400, { error: 'Сумма сделки должна быть неотрицательным числом' }); b.amount = Math.round(amount); }
        if (b.contact_id !== undefined) { b.contact_id = b.contact_id ? Number(b.contact_id) : null; if (b.contact_id !== null && (!Number.isInteger(b.contact_id) || b.contact_id <= 0)) return json(res, 400, { error: 'Некорректный клиент — выберите контакт из списка' }); if (b.contact_id && !db.prepare('SELECT 1 x FROM contacts WHERE id=?').get(b.contact_id)) return json(res, 400, { error: 'Клиент не найден — выберите контакт из списка' }); }
        if (b.company_id !== undefined) { b.company_id = b.company_id ? Number(b.company_id) : null; if (b.company_id !== null && (!Number.isInteger(b.company_id) || b.company_id <= 0)) return json(res, 400, { error: 'Некорректная компания — выберите из списка' }); if (b.company_id && !db.prepare('SELECT 1 x FROM companies WHERE id=?').get(b.company_id)) return json(res, 400, { error: 'Компания не найдена — обновите страницу и выберите из списка' }); }
        if (b.responsible_id !== undefined && b.responsible_id !== null && b.responsible_id !== '' && !db.prepare('SELECT 1 x FROM users WHERE id=?').get(b.responsible_id)) return json(res, 400, { error: 'Ответственный не найден — обновите страницу и выберите сотрудника' });
        if (b.custom !== undefined) { const err = missingRequiredCustom('deals', b.custom); if (err) return json(res, 400, { error: err }); }
        const fields = ['title', 'amount', 'stage', 'pipeline_id', 'contact_id', 'company_id', 'responsible', 'responsible_id', 'priority', 'loss_reason', 'deadline', 'custom']; const ks = Object.keys(b).filter(k => fields.includes(k)); if (ks.length) db.prepare(`UPDATE deals SET ${ks.map(k => k + '=?')},updated_at=datetime('now')${b.stage && ['won', 'lost'].includes(b.stage) ? ",closed_at=datetime('now')" : ''} WHERE id=?`).run(...ks.map(k => b[k]), id); if (b.stage && old && b.stage !== old.stage) { const s = db.prepare('SELECT name FROM stages WHERE code=?').get(b.stage); log(`Сделка «${old.title}» → этап «${s?.name || b.stage}»`, 'deals', Number(id), user.name); runAutomations('stage_changed', { deal_id: Number(id), contact_id: old.contact_id, stage: b.stage }); } broadcast('change', { table: 'deals' }); return json(res, 200, db.prepare('SELECT * FROM deals WHERE id=?').get(id)); }
      if (req.method === 'DELETE') {
        const d = db.prepare('SELECT * FROM deals WHERE id=?').get(id);
        if (!d) return json(res, 404, { error: 'Сделка не найдена' });
        db.exec('BEGIN IMMEDIATE');
        try {
          // задачи не удаляем: они остаются в списке дел и у клиента, просто без привязки к сделке
          db.prepare('UPDATE tasks SET deal_id=NULL WHERE deal_id=?').run(id);
          db.prepare('DELETE FROM deal_products WHERE deal_id=?').run(id);
          db.prepare('DELETE FROM deals WHERE id=?').run(id);
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e }
        log(`Сделка удалена: ${d.title}`, 'deals', Number(id), user.name);
        broadcast('change', { table: 'deals' });
        return json(res, 200, { deleted: true, tasks_kept: db.prepare('SELECT COUNT(*) n FROM tasks WHERE deal_id IS NULL AND contact_id IS NOT NULL').get().n ? true : false });
      }
    }
    const mDp = p.match(/^\/api\/deal_products\/(\d+)$/);
    if (mDp) { const id = mDp[1]; const row = db.prepare('SELECT * FROM deal_products WHERE id=?').get(id); if (!row) return json(res, 404, { error: 'Позиция не найдена' });
      if (req.method === 'PATCH') { const b = await readBody(req); const qty = b.qty === undefined ? row.qty : Math.max(0.001, Number(b.qty) || row.qty), price = b.price === undefined ? row.price : Math.max(0, Number(b.price) || 0); db.prepare('UPDATE deal_products SET qty=?,price=? WHERE id=?').run(qty, price, id); }
      if (req.method === 'DELETE') db.prepare('DELETE FROM deal_products WHERE id=?').run(id);
      const sum = db.prepare('SELECT COALESCE(SUM(price*qty),0) s FROM deal_products WHERE deal_id=?').get(row.deal_id).s; db.prepare('UPDATE deals SET amount=? WHERE id=?').run(sum, row.deal_id); return json(res, 200, { saved: true, amount: sum }); }
    // ===== users / team =====
    if (p === '/api/users') {
      if (req.method === 'GET') return json(res, 200, db.prepare('SELECT id,name,email,role,active FROM users ORDER BY id').all());
      if (req.method === 'POST') {
        if (!requireAdmin(user, res)) return;
        const b = await readBody(req);
        const error = validateUser(b, true);
        if (error) return json(res, 400, { error });
        const email = b.email.trim().toLowerCase();
        if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return json(res, 409, { error: 'Этот e-mail уже используется' });
        const r = db.prepare('INSERT INTO users(name,email,pass,role,active,must_change_password) VALUES(?,?,?,?,?,1)').run(b.name.trim(), email, hashPass(b.password), b.role || 'manager', b.active ?? 1);
        return json(res, 201, { id: r.lastInsertRowid });
      }
    }
    const mUser = p.match(/^\/api\/users\/(\d+)$/);
    if (mUser && req.method === 'PATCH') {
      if (!requireAdmin(user, res)) return;
      const b = await readBody(req), id = Number(mUser[1]);
      const current = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!current) return json(res, 404, { error: 'Пользователь не найден' });
      const error = validateUser(b);
      if (error) return json(res, 400, { error });
      if (current.role === 'admin' && current.active && ((b.role && b.role !== 'admin') || b.active === 0)
          && db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1").get().n <= 1)
        return json(res, 400, { error: 'Нельзя отключить последнего администратора' });
      if (b.email !== undefined) {
        b.email = b.email.trim().toLowerCase();
        if (db.prepare('SELECT id FROM users WHERE email=? AND id!=?').get(b.email, id)) return json(res, 409, { error: 'Этот e-mail уже используется' });
      }
      if (b.password) db.prepare('UPDATE users SET pass=?,must_change_password=1,session_version=session_version+1 WHERE id=?').run(hashPass(b.password), id);
      const ks = ['name', 'email', 'role', 'active'].filter(k => b[k] !== undefined);
      if (ks.length) db.prepare(`UPDATE users SET ${ks.map(k => k + '=?')} WHERE id=?`).run(...ks.map(k => b[k]), id);
      if (b.password || b.active === 0 || b.role !== undefined) closeUserStreams(id);
      return json(res, 200, { saved: true });
    }
    if (p === '/api/custom-fields') {
      if (req.method === 'GET') return json(res, 200, { fields: getCustomFields() });
      if (req.method === 'PUT') { if (!requireAdmin(user, res)) return; const b = await readBody(req); const fields = sanitizeFields(b.fields); setSetting('CUSTOM_FIELDS', JSON.stringify(fields)); log(`Настраиваемые поля обновлены (${fields.length})`, null, null, user.name); return json(res, 200, { saved: true, fields }) }
    }
    if (p === '/api/backups') {
      const dir = join(DATA_DIR, 'backups');
      if (req.method === 'GET') return json(res, 200, { dir: '/data/backups', keepDays: Number(getSetting('BACKUP_KEEP_DAYS', '7')) || 0, files: existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.db')).sort().reverse().map(f => ({ name: f, sizeBytes: statSync(join(dir, f)).size, created_at: statSync(join(dir, f)).mtime.toISOString() })) : [] });
      if (req.method === 'POST') { if (!requireAdmin(user, res)) return; const file = makeBackup(true); return json(res, 200, { created: file }) }
    }
    if (p === '/api/backups/download') {
      if (!requireAdmin(user, res)) return;
      const name = String(u.searchParams.get('file') || '');
      if (!/^[A-Za-z0-9._-]+\.db$/.test(name)) return json(res, 400, { error: 'Некорректное имя файла копии' });
      const src = join(DATA_DIR, 'backups', name);
      if (!existsSync(src)) return json(res, 404, { error: 'Копия не найдена' });
      res.writeHead(200, { 'Content-Type': 'application/vnd.sqlite3', 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': statSync(src).size });
      return createReadStream(src).pipe(res);
    }
    // восстановление базы из копии: кладём файл на место crm.db и перезапускаем службу
    // (в Docker стоит restart: unless-stopped — контейнер поднимется сам; локально перезапустите ./run-local.sh)
    if (p === '/api/backups/restore' && req.method === 'POST') {
      if (!requireAdmin(user, res)) return;
      const b = await readBody(req);
      const name = String((b && b.file) || '');
      if (!/^[A-Za-z0-9._-]+\.db$/.test(name)) return json(res, 400, { error: 'Некорректное имя файла копии' });
      const src = join(DATA_DIR, 'backups', name);
      if (!existsSync(src)) return json(res, 404, { error: 'Копия не найдена' });
      // снимок выбранной копии делаем ДО страховочной копии: имена копий за день совпадают
      const tmp = join(DATA_DIR, '.restore-src.db');
      copyFileSync(src, tmp);
      const safety = `before-restore-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.db`;
      try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); copyFileSync(join(DATA_DIR, 'crm.db'), join(DATA_DIR, 'backups', safety)) } catch (e) { console.error('restore: страховочная копия', e.message) }
      try { db.close() } catch {}
      copyFileSync(tmp, join(DATA_DIR, 'crm.db'));
      unlinkSync(tmp);
      for (const suffix of ['-wal', '-shm']) { const f = join(DATA_DIR, 'crm.db' + suffix); if (existsSync(f)) unlinkSync(f) }
      json(res, 200, { ok: true, restored: name, safety_copy: safety, restarting: true, message: 'База восстановлена из копии, служба перезапускается — обновите страницу через несколько секунд' });
      setTimeout(() => process.exit(0), 400);
      return;
    }
    if (p === '/api/me/password' && req.method === 'POST') {
      const b = await readBody(req), nextPass = String(b.new_password || b.next || '');
      if (nextPass.length < 12 || nextPass.length > 256) return json(res, 400, { error: 'Новый пароль должен содержать от 12 до 256 символов' });
      const me = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
      if (!checkPass(String(b.old_password || b.old || ''), me.pass)) return json(res, 400, { error: 'Старый пароль неверен' });
      if (checkPass(nextPass, me.pass)) return json(res, 400, { error: 'Новый пароль должен отличаться от временного или текущего' });
      db.prepare('UPDATE users SET pass=?,must_change_password=0,session_version=session_version+1 WHERE id=?').run(hashPass(nextPass), user.id);
      closeUserStreams(user.id);
      log('Пользователь сменил пароль', 'users', user.id, user.name);
      const token = sign({ id: user.id });
      res.setHeader('Set-Cookie', sessionCookie(req, token));
      return json(res, 200, { saved: true, token });
    }

    // ===== inbox =====
    if (p === '/api/conversations' && req.method === 'GET') return json(res, 200, db.prepare(`SELECT cv.*,c.phone,c.email,(SELECT body FROM messages WHERE conversation_id=cv.id ORDER BY id DESC LIMIT 1) last_body,
      (SELECT d.amount FROM deals d WHERE d.contact_id=cv.contact_id AND d.stage NOT IN ('won','lost') ORDER BY d.id DESC LIMIT 1) deal_amount
      FROM conversations cv LEFT JOIN contacts c ON c.id=cv.contact_id ORDER BY cv.last_at DESC, cv.id DESC`).all());
    const mConv = p.match(/^\/api\/conversations\/(\d+)\/messages$/);
    if (mConv) { const id = mConv[1];
      if (req.method === 'GET') { db.prepare('UPDATE conversations SET unread=0 WHERE id=?').run(id); return json(res, 200, db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY id').all(id)); }
      if (req.method === 'POST') { const b = await readBody(req); const conv = db.prepare('SELECT cv.*,c.phone FROM conversations cv LEFT JOIN contacts c ON c.id=cv.contact_id WHERE cv.id=?').get(id); if (!conv) return json(res, 404, { error: 'Чат не найден' }); if (b.channel_id) conv.channel_id = b.channel_id; if (b.chat_type) conv.chat_type = b.chat_type; if (b.chatId) conv.external_chat_id = b.chatId;
        // ссылка на вложение — только http(s) или наш /uploads/: javascript: и data: не пройдут
        const rawUri = String(b.contentUri || b.fileUrl || '').trim();
        if (rawUri && !/^(https?:\/\/|\/uploads\/)/i.test(rawUri)) return json(res, 400, { error: 'Ссылка на файл должна начинаться с http://, https:// или /uploads/' });
        const file = rawUri ? { contentUri: rawUri.slice(0, 2048) } : null;
        if (!String(b.body || '').trim() && !file) return json(res, 400, { error: 'Пустое сообщение: введите текст или приложите ссылку на файл' });
        let send = { delivered: false, mode: 'local' }, status = 'local'; const wantChannel = b.chat_type || b.channel || conv.chat_type || 'whatsapp';
        // письма идут через SMTP отдельным действием: мессенджер их не отправляет
        if (wantChannel === 'email') return json(res, 400, { error: 'Письмо отправляется кнопкой «Письмо» в шапке чата — через настроенный почтовый сервер' });
        try { send = await deliver(conv, wantChannel, b.body || '', user, file); status = send.delivered ? 'sent' : 'local'; }
        catch (e) {
          // без подключённого Wazzup сообщение честно остаётся в CRM
          if (String(e.message) === 'WAZZUP_NOT_CONFIGURED') { status = 'local'; send = { delivered: false, mode: 'local-only', hint: 'Wazzup не подключён — сообщение сохранено в CRM. Настройки → Интеграции: вставьте API-ключ Wazzup, и ответ уйдёт клиенту.' }; }
          else { status = 'error'; send = { delivered: false, mode: 'error: ' + e.message }; }
        }
        const body = String(b.body || '').trim() || (file ? '[вложение]' : '');
        const insertOut = ext => db.prepare('INSERT INTO messages(conversation_id,channel,direction,body,content_uri,content_name,content_type,status,external_id,author) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, wantChannel, 'out', body, file?.contentUri || null, b.contentName ? safeFileName(b.contentName) : null, b.contentType || null, status, ext, user.name);
        // внешний id уникален (защита от повторной доставки входящих), но если провайдер
        // вернул уже встречавшийся id, сообщение всё равно должно сохраниться в CRM
        let r; try { r = insertOut(send.id || null); }
        catch (e) { if (!/UNIQUE/i.test(e.message)) throw e; r = insertOut(null); }
        db.prepare("UPDATE conversations SET last_at=datetime('now') WHERE id=?").run(id); broadcast('message', { conversation_id: Number(id), direction: 'out' }); return json(res, 201, { message: db.prepare('SELECT * FROM messages WHERE id=?').get(r.lastInsertRowid), send }); }
    }
    const mEmail = p.match(/^\/api\/conversations\/(\d+)\/email$/);
    if (mEmail && req.method === 'POST') {
      const b = await readBody(req);
      const conv = db.prepare('SELECT cv.*,c.phone,c.email FROM conversations cv LEFT JOIN contacts c ON c.id=cv.contact_id WHERE cv.id=?').get(mEmail[1]);
      if (!conv) return json(res, 404, { error: 'Чат не найден' });
      const to = b.to || conv.email;
      if (!to) return json(res, 400, { error: 'У контакта не указан e-mail — добавьте его в карточке клиента' });
      if (!getSetting('SMTP_HOST')) return json(res, 400, { error: 'Почта не настроена: Настройки → Интеграции → Почта (SMTP)' });
      let send = { delivered: false, mode: 'not-configured' }, status = 'error';
      try {
        const r = await sendMail({ host: getSetting('SMTP_HOST'), port: Number(getSetting('SMTP_PORT', '587')), secure: getSetting('SMTP_SECURE') === '1' ? true : getSetting('SMTP_SECURE') === '0' ? false : undefined, user: getSetting('SMTP_USER'), pass: getSetting('SMTP_PASS'), from: getSetting('MAIL_FROM') || getSetting('SMTP_USER'), fromName: getSetting('COMPANY_NAME', 'CRM'), to, toName: conv.title || '', subject: b.subject || 'Письмо от ' + getSetting('COMPANY_NAME', 'CRM'), text: b.body || '' });
        send = { delivered: true, mode: 'smtp', id: r.messageId }; status = 'sent';
      } catch (e) { send = { delivered: false, mode: 'error: ' + e.message } }
      const ins = db.prepare('INSERT INTO messages(conversation_id,channel,direction,body,subject,status,author) VALUES(?,?,?,?,?,?,?)').run(conv.id, 'email', 'out', b.body || '', b.subject || '', status, user.name);
      db.prepare("UPDATE conversations SET channels=?, last_at=datetime('now') WHERE id=?").run([...new Set([...(conv.channels || '').split(',').filter(Boolean), 'email'])].join(','), conv.id);
      broadcast('message', { conversation_id: conv.id });
      return json(res, 201, { message: db.prepare('SELECT * FROM messages WHERE id=?').get(ins.lastInsertRowid), send });
    }
    // ===== загрузка файла в чат (фото, документы) =====
    const mUpload = p.match(/^\/api\/conversations\/(\d+)\/upload$/);
    if (mUpload && req.method === 'POST') {
      const cid = Number(mUpload[1]);
      if (!db.prepare('SELECT id FROM conversations WHERE id=?').get(cid)) return json(res, 404, { error: 'Чат не найден' });
      const b = await readBody(req, 22e6);
      const contentType = String(b.contentType || 'application/octet-stream').split(';')[0].trim().toLowerCase();
      if (!FILE_UPLOAD_TYPES.includes(contentType)) return json(res, 400, { error: 'Такой тип файла загружать нельзя. Доступны изображения, PDF, документы Word/Excel, CSV, TXT и ZIP.' });
      const raw = Buffer.from(String(b.dataBase64 || '').split(',').pop() || '', 'base64');
      if (!raw.length || raw.length > 15 * 1024 * 1024) return json(res, 400, { error: 'Файл пустой или превышает 15 МБ' });
      const extByType = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv', 'application/zip': 'zip', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx' };
      const ext = extByType[contentType] || 'bin';
      const safeName = safeFileName(b.filename || ('файл.' + ext));
      const stored = `${localDate().replace(/-/g, '')}-${randomBytes(6).toString('hex')}-${asciiFileName(b.filename || ('file.' + ext))}`;
      mkdir(UPLOAD_DIR, { recursive: true });
      writeFileSync(join(UPLOAD_DIR, stored), raw);
      log(`Файл загружен в чат #${cid}: ${safeName}`, 'conversations', cid, user.name);
      return json(res, 201, { url: '/uploads/' + stored, name: safeName, contentType, size: raw.length });
    }
    // ===== логотип компании: загрузка и возврат к стандартному =====
    if (p === '/api/logo' && req.method === 'POST') {
      if (!requireAdmin(user, res)) return;
      const b = await readBody(req, 8e6);
      const contentType = String(b.contentType || '').split(';')[0].trim().toLowerCase();
      if (!IMAGE_UPLOAD_TYPES.includes(contentType)) return json(res, 400, { error: 'Логотип: только PNG, JPEG, GIF или WebP' });
      const raw = Buffer.from(String(b.dataBase64 || '').split(',').pop() || '', 'base64');
      if (!raw.length || raw.length > 4 * 1024 * 1024) return json(res, 400, { error: 'Логотип пустой или больше 4 МБ' });
      const realType = sniffImage(raw);
      if (!IMAGE_UPLOAD_TYPES.includes(realType)) return json(res, 400, { error: 'Содержимое файла не является изображением' });
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[realType];
      mkdir(CUSTOM_LOGO_DIR, { recursive: true });
      for (const f of readdirSync(CUSTOM_LOGO_DIR)) if (/^logo\.(png|jpe?g|gif|webp|ico)$/i.test(f)) { try { unlinkSync(join(CUSTOM_LOGO_DIR, f)); } catch { } }
      writeFileSync(join(CUSTOM_LOGO_DIR, 'logo.' + ext), raw);
      log('Логотип компании обновлён', null, null, user.name);
      return json(res, 200, { saved: true, url: '/logo.png?ts=' + Date.now() });
    }
    if (p === '/api/logo' && req.method === 'DELETE') {
      if (!requireAdmin(user, res)) return;
      if (existsSync(CUSTOM_LOGO_DIR)) for (const f of readdirSync(CUSTOM_LOGO_DIR)) if (/^logo\.(png|jpe?g|gif|webp|ico)$/i.test(f)) { try { unlinkSync(join(CUSTOM_LOGO_DIR, f)); } catch { } }
      log('Логотип сброшен на стандартный', null, null, user.name);
      return json(res, 200, { saved: false, url: '/logo.png' });
    }
    // CSV export/import
    if (p === '/api/export/contacts') {
      // свои поля тоже попадают в выгрузку: колонки называются так, как их назвал пользователь
      const fields = getCustomFields().filter(f => f.entity === 'contacts' || f.entity === 'both');
      const rows = db.prepare('SELECT name,phone,email,company,source,tags,custom FROM contacts').all().map(c => {
        let val = {}; try { val = JSON.parse(c.custom || '{}') } catch {}
        const out = { 'Имя': c.name, 'Телефон': c.phone, 'E-mail': c.email, 'Компания': c.company, 'Источник': c.source, 'Теги': c.tags };
        for (const f of fields) out[f.label] = val[f.key] ?? '';
        return out;
      });
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=contacts.csv' });
      return res.end('\ufeff' + csv(rows));
    }
    if (p === '/api/export/deals') {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=deals.csv' });
      const rows = db.prepare(`SELECT d.title 'Название', d.amount 'Сумма', COALESCE(c.name,'') 'Клиент', COALESCE(c.phone,'') 'Телефон', d.stage 'Этап', d.priority 'Приоритет', COALESCE(d.deadline,'') 'Срок', COALESCE(d.loss_reason,'') 'Причина отказа', datetime(d.created_at,'localtime') 'Создана' FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id ORDER BY d.id DESC`).all();
      return res.end('﻿' + csv(rows));
    }
    if (p === '/api/import/contacts' && req.method === 'POST') {
      const b = await readBody(req);
      // CSV с кавычками: простой split по ; или , ломается на полях «Иван;Иванов»
      const parseCsvLine = line => { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++ } else q = !q } else if ((ch === ';' || ch === ',') && !q) { out.push(cur); cur = '' } else cur += ch } out.push(cur); return out.map(x => x.trim()) };
      const lines = String(b.csv || '').split(/\r?\n/).filter(l => l.trim());
      if (!lines.length) return json(res, 400, { error: 'Пустой CSV — вставьте строки с контактами' });
      if (lines.length > 5001) return json(res, 400, { error: 'За один раз можно импортировать не больше 5000 контактов — разбейте файл на части' });
      const start = /^(имя|name)\b/i.test(lines[0]) ? 1 : 0; // первая строка — заголовок
      let n = 0, skipped = 0;
      const ins = db.prepare('INSERT INTO contacts(name,phone,email,company,source,phone_norm) VALUES(?,?,?,?,?,?)');
      const exists = db.prepare('SELECT id FROM contacts WHERE phone_norm=?');
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const line of lines.slice(start)) {
          const [name, phone, email, company] = parseCsvLine(line);
          if (!name) continue;
          const norm = digits(phone) || null;
          // повторный импорт того же файла не плодит дубли
          if (norm && exists.get(norm)) { skipped++; continue }
          ins.run(name.slice(0, 120), phone || '', email || '', company || '', 'import', norm); n++;
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e }
      broadcast('change', { table: 'contacts' });
      return json(res, 200, { imported: n, skipped, message: skipped ? `Добавлено ${n}, пропущено дублей ${skipped}` : `Добавлено контактов: ${n}` });
    }

    // ===== channels & integrations (all configurable from UI) =====
    if (p === '/api/channels') return json(res, 200, db.prepare('SELECT * FROM channels ORDER BY id DESC').all());
    if (p === '/api/integrations/wazzup/test' && req.method === 'POST') { try { const data = await wazzupFetch('/channels'); const list = data.channels || data.data || data || []; return json(res, 200, { ok: true, channels: list }); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
    if (p === '/api/integrations/wazzup/sync' && req.method === 'POST') { try { const data = await wazzupFetch('/channels'); const list = data.channels || data.data || []; for (const ch of list) db.prepare('INSERT INTO channels(provider,external_id,name,transport,phone,state,raw) VALUES(?,?,?,?,?,?,?) ON CONFLICT(external_id) DO UPDATE SET name=excluded.name,transport=excluded.transport,phone=excluded.phone,state=excluded.state').run('wazzup', ch.channelId || ch.id, ch.name || ch.plainId || '', ch.transport || ch.type || '', ch.plainId || ch.phone || '', ch.state || '', JSON.stringify(ch)); if (list[0] && !getSetting('WAZZUP_CHANNEL_ID')) setSetting('WAZZUP_CHANNEL_ID', list[0].channelId || list[0].id); return json(res, 200, { synced: list.length, channels: db.prepare("SELECT * FROM channels WHERE provider='wazzup'").all() }); } catch (e) { return json(res, 400, { error: e.message }); } }
    if (p === '/api/integrations/wazzup/webhook' && req.method === 'POST') { const b = await readBody(req); const hookUrl = String(b.url || '').trim(); if (!/^https?:\/\//i.test(hookUrl) || hookUrl.length > 2048) return json(res, 400, { error: 'Укажите корректный адрес вебхука (http/https)' }); try { await wazzupFetch('/webhooks', { method: 'PATCH', body: JSON.stringify({ webhooksUri: hookUrl }) }); setSetting('WAZZUP_WEBHOOK_URL', hookUrl); return json(res, 200, { saved: true }); } catch (e) { return json(res, 400, { error: e.message + ' — можно указать вебхук вручную в кабинете Wazzup' }); } }
    if (p === '/api/integrations/email/test' && req.method === 'POST') {
      if (!requireAdmin(user, res)) return;
      const rl = rateLimit('mailtest', 10, 60000); if (!rl.ok) return json(res, 429, { error: 'Слишком часто — подождите минуту' });
      const b = await readBody(req);
      if (b.host) setSetting('SMTP_HOST', String(b.host)); if (b.port) setSetting('SMTP_PORT', String(b.port));
      if (b.secure !== undefined) setSetting('SMTP_SECURE', String(b.secure)); if (b.user !== undefined) setSetting('SMTP_USER', String(b.user));
      if (b.pass && !String(b.pass).includes('•')) setSetting('SMTP_PASS', String(b.pass)); if (b.from !== undefined) setSetting('MAIL_FROM', String(b.from));
      const to = b.to || getSetting('SMTP_TEST_TO') || getSetting('SMTP_USER') || getSetting('MAIL_FROM');
      if (!to) return json(res, 400, { error: 'Укажите адрес получателя тестового письма' });
      try {
        const out = await sendMail({ host: getSetting('SMTP_HOST'), port: Number(getSetting('SMTP_PORT', '587')), secure: getSetting('SMTP_SECURE') === '1' ? true : getSetting('SMTP_SECURE') === '0' ? false : undefined, user: getSetting('SMTP_USER'), pass: getSetting('SMTP_PASS'), from: getSetting('MAIL_FROM') || getSetting('SMTP_USER'), fromName: getSetting('COMPANY_NAME', 'CRM'), to, subject: 'КаркасCRM: проверка почты', text: `Почта настроена верно. Письмо отправлено ${new Date().toLocaleString('ru-RU')}.` });
        setSetting('SMTP_TEST_TO', to); log(`Проверочное письмо отправлено на ${to}`, null, null, user.name);
        return json(res, 200, { ok: true, to, messageId: out.messageId });
      } catch (e) { return json(res, 400, { ok: false, error: e.message }) }
    }
    if (p === '/api/settings') {
      if (req.method === 'GET') {
        const mask = v => v ? '••••••' + String(v).slice(-4) : '';
        const num = (k, d) => { const n = Number(getSetting(k, String(d))); return Number.isFinite(n) ? n : d };
        return json(res, 200, {
          version: VERSION,
          // адрес, по которому CRM видна из интернета: из настроек, иначе из CRM_DOMAIN,
          // иначе пусто — тогда интерфейс берёт адрес из строки браузера
          public_url: String(getSetting('PUBLIC_URL') || (process.env.CRM_DOMAIN ? `https://${process.env.CRM_DOMAIN}` : '')).replace(/\/+$/, ''),
          company: { name: getSetting('COMPANY_NAME'), currency: getSetting('CURRENCY', '₽') },
          sales_target: num('SALES_TARGET', 0),
          seed_mode: SEED_MODE,
          demo: demoCounts(db),
          email: { host: getSetting('SMTP_HOST'), port: getSetting('SMTP_PORT', '587'), secure: getSetting('SMTP_SECURE', ''), user: getSetting('SMTP_USER'), pass: mask(getSetting('SMTP_PASS')), from: getSetting('MAIL_FROM'), webhook_secret: getSetting('EMAIL_WEBHOOK_SECRET'), test_to: getSetting('SMTP_TEST_TO'), configured: !!getSetting('SMTP_HOST') },
          maintenance: { backup_keep_days: num('BACKUP_KEEP_DAYS', 7), backup_hour: num('BACKUP_HOUR', 3), notify_webhook: getSetting('NOTIFY_WEBHOOK') },
          requisites: companyRequisites(),
          advanced: { frame_ancestors: getSetting('FRAME_ANCESTORS'), login_rate_limit: num('LOGIN_RATE_LIMIT', 12) },
          auto_deal: getSetting('AUTO_DEAL', '1'), auto_assign: getSetting('AUTO_ASSIGN', '0'),
          webhook: { secret: getSetting('WEBHOOK_SECRET'), configured: !!getSetting('WEBHOOK_SECRET') },
          logo: { custom: !!findCustomLogo(), env: !!process.env.LOGO_FILE },
          wazzup: { api_key: mask(getSetting('WAZZUP_API_KEY')), api_url: getSetting('WAZZUP_API_URL', 'https://api.wazzup24.com/v3'), channel_id: getSetting('WAZZUP_CHANNEL_ID'), webhook_secret: getSetting('WAZZUP_WEBHOOK_SECRET'), configured: !!getSetting('WAZZUP_API_KEY') },
        });
      }
      if (req.method === 'PUT') {
        if (!requireAdmin(user, res)) return;
        const b = await readBody(req);
        const clean = v => (v && !String(v).includes('•')) ? String(v).slice(0, 512) : null;
        const putNum = (k, v, min, max, d) => { const n = Number(String(v).replace(/[^\d.-]/g, '')); if (Number.isFinite(n)) setSetting(k, String(Math.min(max, Math.max(min, n)))); };
        if (b.PUBLIC_URL !== undefined) {
          const v = String(b.PUBLIC_URL || '').trim().replace(/\/+$/, '');
          if (v && !/^https?:\/\/[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(v)) return json(res, 400, { error: 'Адрес CRM должен начинаться с http:// или https:// — например, https://crm.company.ru' });
          // пусто — удаляем настройку, чтобы снова работал CRM_DOMAIN или адрес браузера
          if (v) setSetting('PUBLIC_URL', v.slice(0, 255)); else db.prepare("DELETE FROM settings WHERE key='PUBLIC_URL'").run();
        }
        if (clean(b.WAZZUP_API_KEY)) setSetting('WAZZUP_API_KEY', clean(b.WAZZUP_API_KEY));
        for (const k of ['WAZZUP_API_URL', 'WAZZUP_CHANNEL_ID', 'WAZZUP_WEBHOOK_SECRET', 'COMPANY_NAME', 'CURRENCY', 'AUTO_DEAL', 'AUTO_DEAL_STAGE', 'AUTO_ASSIGN', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'MAIL_FROM', 'EMAIL_WEBHOOK_SECRET', 'NOTIFY_WEBHOOK', 'COMPANY_INN', 'COMPANY_KPP', 'COMPANY_OGRN', 'COMPANY_ADDRESS', 'COMPANY_PHONE', 'COMPANY_EMAIL', 'COMPANY_SITE', 'COMPANY_BANK', 'COMPANY_ACCOUNT', 'COMPANY_CORR', 'COMPANY_SIGNER', 'COMPANY_SIGNER_POSITION', 'DOC_PREFIX', 'SMTP_TEST_TO', 'WEBHOOK_SECRET']) if (b[k] !== undefined) setSetting(k, clean(b[k]) ?? String(b[k]).slice(0, 512));
        if (clean(b.SMTP_PASS)) setSetting('SMTP_PASS', clean(b.SMTP_PASS));
        if (b.SALES_TARGET !== undefined) putNum('SALES_TARGET', b.SALES_TARGET, 0, 1e15, 0);
        if (b.BACKUP_KEEP_DAYS !== undefined) putNum('BACKUP_KEEP_DAYS', b.BACKUP_KEEP_DAYS, 0, 3650, 7);
        if (b.BACKUP_HOUR !== undefined) putNum('BACKUP_HOUR', b.BACKUP_HOUR, 0, 23, 3);
        if (b.LOGIN_RATE_LIMIT !== undefined) putNum('LOGIN_RATE_LIMIT', b.LOGIN_RATE_LIMIT, 1, 10000, 12);
        // FRAME_ANCESTORS: только хосты и схемы — иначе ломаем CSP и сам заголовок
        if (b.FRAME_ANCESTORS !== undefined) {
          const fa = String(b.FRAME_ANCESTORS).replace(/[\r\n\t]/g, ' ').replace(/[^a-zA-Z0-9\s:'"*,.\/-]/g, '').trim().slice(0, 512);
          setSetting('FRAME_ANCESTORS', fa);
        }
        log('Настройки обновлены', null, null, user.name);
        return json(res, 200, { saved: true });
      }
    }
    // удаление демонстрационных данных: всё, что помечено demo=1
    if (p === '/api/demo/cleanup' && req.method === 'POST') {
      if (!requireAdmin(user, res)) return;
      const removed = cleanDemo(db);
      setSetting('SEED_DONE', '1'); // после очистки примеры не вернутся при перезапуске
      log('Демонстрационные данные удалены (' + removed + ' записей)', null, null, user.name);
      broadcast('change', { table: 'all' });
      return json(res, 200, { removed });
    }
    // ===== массовые действия: выделили записи и применили к ним одно изменение =====
    if (p === '/api/bulk' && req.method === 'POST') {
      const b = await readBody(req);
      const table = String(b.table || ''), ids = (b.ids || []).map(Number).filter(Boolean);
      const fields = CRUD[table];
      if (!fields || !ids.length) return json(res, 400, { error: 'Нечего обрабатывать: укажите таблицу и хотя бы одну запись' });
      if (ids.length > 500) return json(res, 400, { error: 'За один раз можно изменить не больше 500 записей' });
      if ((b.action === 'delete' && (table === 'products' || table === 'automations')) && !requireAdmin(user, res)) return;
      if (b.action === 'delete' && table === 'templates') {
        // шаблоны личные: массово удаляем только свои, чужие не трогаем
        const st = db.prepare('DELETE FROM templates WHERE id=? AND user_id=?');
        for (const id of ids) st.run(id, user.id);
        broadcast('change', { table });
        return json(res, 200, { done: ids.length });
      }
      if (b.action === 'delete') {
        const st = db.prepare(`DELETE FROM ${table} WHERE id=?`);
        for (const id of ids) {
          // связи рвём так же, как при одиночном удалении: иначе остаются «висячие» задачи и заметки
          if (table === 'contacts') {
            db.prepare('UPDATE tasks SET contact_id=NULL WHERE contact_id=?').run(id);
            db.prepare('UPDATE deals SET contact_id=NULL WHERE contact_id=?').run(id);
            db.prepare("DELETE FROM notes WHERE entity_type='contacts' AND entity_id=?").run(id);
          }
          if (table === 'companies') {
            db.prepare('UPDATE deals SET company_id=NULL WHERE company_id=?').run(id);
            db.prepare('UPDATE contacts SET company_id=NULL WHERE company_id=?').run(id);
            db.prepare("DELETE FROM notes WHERE entity_type='companies' AND entity_id=?").run(id);
          }
          st.run(id);
        }
      }
      else {
        const patch = {}; for (const k of Object.keys(b.patch || {})) if (fields.includes(k) && b.patch[k] !== undefined) patch[k] = b.patch[k];
        const ks = Object.keys(patch);
        if (!ks.length) return json(res, 400, { error: 'Не передано ни одного допустимого поля' });
        if (table === 'contacts' && patch.phone !== undefined) { ks.push('phone_norm'); patch.phone_norm = digits(patch.phone) || null; }
        if (table === 'tasks' && patch.due !== undefined) patch.due = patch.due ? normalizeDue(String(patch.due)) : '';
        const st = db.prepare(`UPDATE ${table} SET ${ks.map(k => k + '=?').join(',')} WHERE id=?`);
        for (const id of ids) st.run(...ks.map(k => patch[k]), id);
        log(`Массовое изменение (${table}): ${ids.length} записей — ${ks.join(', ')}`, table, null, user.name);
      }
      broadcast('change', { table });
      return json(res, 200, { table, action: b.action === 'delete' ? 'delete' : 'update', count: ids.length });
    }

    // ===== конкуренты: разведка (долги, суды, банкротство, отзывы, прайс-таблицы) =====
    if (/^\/api\/(competitors|competitor-sources|competitor-links|competitors\/find|prices|reviews)/.test(p)) {
      const handled = await competitorsApi.handle(req, res, { p, u, user });
      if (handled !== false) return;
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'Не найдено' });

    // загруженные файлы чатов: только для авторизованных (токен в cookie, заголовке или ?token=)
    if (p.startsWith('/uploads/')) {
      if (!user) return json(res, 401, { error: 'Требуется авторизация' });
      const name = basename(decodeURIComponent(p));
      if (!/^[A-Za-z0-9._-]+$/.test(name)) return json(res, 400, { error: 'Некорректное имя файла' });
      const src = join(UPLOAD_DIR, name);
      if (!src.startsWith(UPLOAD_DIR) || !existsSync(src)) return json(res, 404, { error: 'Файл не найден' });
      const st = statSync(src);
      const type = MIME[extname(src).toLowerCase()] || 'application/octet-stream';
      const inline = type.startsWith('image/') || type === 'application/pdf';
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}` });
      return createReadStream(src).pipe(res);
    }

    // логотип и favicon: путь один (/logo.png), а формат определяем по содержимому —
    // поэтому загрузка JPEG/PNG/WebP не ломает отображение
    if (p === '/logo.png' || p === '/favicon.ico') {
      const logoPath = resolveLogo();
      if (logoPath && existsSync(logoPath)) {
        const stLogo = statSync(logoPath);
        // ETag по содержимому: браузер не скачивает логотип заново, но мгновенно
        // подхватывает замену (новый файл — новый ETag, старый — ответ 304).
        const etag = `"${stLogo.size.toString(16)}-${Math.round(stLogo.mtimeMs).toString(16)}"`;
        const headers = {
          'Cache-Control': 'no-cache', ETag: etag,
          'Last-Modified': new Date(stLogo.mtimeMs).toUTCString(),
        };
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
        const buf = readFileSync(logoPath);
        res.writeHead(200, { ...headers, 'Content-Type': sniffImage(buf, 'image/png'), 'Content-Length': buf.length });
        return res.end(buf);
      }
    }

    let file = normalize(join(PUBLIC_DIR, p === '/' ? 'index.html' : p));
    if (existsSync(file) && statSync(file).isDirectory()) {
      file = join(file, 'index.html');
    }
    if (!file.startsWith(PUBLIC_DIR) || !existsSync(file)) {
      file = join(PUBLIC_DIR, 'index.html');
    }
    const st = statSync(file);
    const ext = extname(file).toLowerCase();
    const isCode = ext === '.html' || ext === '.js' || ext === '.css';
    const cacheControl = isCode ? 'no-store, must-revalidate' : 'no-cache';
    // ETag = размер+время файла: браузер переиспользует копию и страница открывается мгновенно
    const etag = `W/"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`;
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cacheControl, ETag: etag };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    const type = MIME[extname(file)] || '';
    const compressible = /^(text|application\/(javascript|json|xml)|image\/svg)/.test(type);
    if (compressible && /gzip/.test(String(req.headers['accept-encoding'] || '')) && st.size > 1024) {
      const cached = staticGzip.get(file);
      const gz = (cached && cached.mtimeMs === st.mtimeMs) ? cached.gz : (() => { const g = gzipSync(readFileSync(file), { level: 6 }); staticGzip.set(file, { mtimeMs: st.mtimeMs, gz: g }); return g })();
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': gz.length, Vary: 'Accept-Encoding' });
      return res.end(gz);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    res.end(readFileSync(file));
  } catch (e) {
    console.error(e);
    // если ответ уже начали отдавать (файл/поток), повторно заголовки не пишем
    if (res.headersSent) { try { res.end() } catch {} return; }
    // слишком большое тело — это ошибка клиента, а не сбой сервера
    if (/Слишком большой запрос/.test(e.message)) return json(res, 413, { error: 'Слишком большой запрос: уменьшите файл или разбейте данные на части' });
    json(res, 500, { error: 'Внутренняя ошибка сервера. Попробуйте ещё раз; если повторяется — посмотрите логи.' });
  }
});
// медленные/зависшие клиенты не держат соединения и память бесконечно
server.headersTimeout = 30000;
server.requestTimeout = 120000;
server.keepAliveTimeout = 65000;
server.maxHeadersCount = 100;
server.listen(PORT, HOST, () => console.log(`КаркасCRM запущена: http://${HOST}:${PORT} | администратор: ${ADMIN_EMAIL}`));
// понятная ошибка вместо «тихого» зависания, если порт занят или нет прав
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`Порт ${PORT} уже занят другим процессом. Остановите его или задайте другой PORT.`);
  else if (e.code === 'EACCES') console.error(`Нет прав слушать порт ${PORT}. Выберите порт выше 1024.`);
  else console.error('Не удалось запустить сервер:', e);
  process.exit(1);
});

// ── устойчивость: аккуратное завершение и защита от падения процесса ──
let shuttingDown = false;
const graceful = (sig) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Получен ${sig} — завершаюсь аккуратно…`);
  for (const res of clients) { try { res.end(); } catch {} }
  clients.clear();
  scheduler && clearInterval(scheduler);
  server.close(() => { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch {} process.exit(0); });
  // если что-то зависло — принудительный выход через 5 секунд
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', () => graceful('SIGTERM'));
process.on('SIGINT', () => graceful('SIGINT'));
// логируем, но не даём одному сбойному запросу убить всю CRM
process.on('uncaughtException', e => console.error('uncaughtException:', e));
process.on('unhandledRejection', e => console.error('unhandledRejection:', e));
export { db, getSetting, nowDue, normalizeDue, fixTaskDues, VERSION };
