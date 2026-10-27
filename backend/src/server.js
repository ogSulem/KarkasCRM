// КаркасCRM — ядро системы: воронки и сделки, клиенты и компании, задачи, единый инбокс
// мессенджеров и почты, аналитика, разведка конкурентов. Без внешних зависимостей:
// Node >= 22.5 (http, node:sqlite, crypto, fetch).
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
// подпись запросов к S3-хранилищу — тот же модуль, что использует скрипт выгрузки
import { signedHeaders } from '../../scripts/s3-sign.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, statSync, readdirSync, unlinkSync, copyFileSync, mkdirSync as mkdir, createReadStream } from 'node:fs';
import { extname, join, normalize, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCompetitors, migrateOurPricesToCatalog } from './competitors.js';
import { sendMail } from './smtp.js';
import { cleanupOrphans, syncDealResponsibleNames, cleanupUploads, dailyMaintenance } from './maintenance.js';
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
const UPLOAD_DIR = join(DATA_DIR, 'uploads');
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin12345';

// Версия продукта: единый источник — файл VERSION в корне (он же попадает в Docker-образ).
const VERSION = (() => { try { return readFileSync(join(ROOT, '../../VERSION'), 'utf8').trim() || '0.0.0'; } catch { return '0.0.0'; } })();
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
CREATE TABLE IF NOT EXISTS read_marks(user_id INTEGER NOT NULL,conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  last_msg_id INTEGER NOT NULL DEFAULT 0,updated_at TEXT DEFAULT (datetime('now')),PRIMARY KEY(user_id,conversation_id));
CREATE TABLE IF NOT EXISTS activities(id INTEGER PRIMARY KEY,text TEXT,entity_type TEXT,entity_id INTEGER,user_name TEXT,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS automation_queue(id INTEGER PRIMARY KEY,automation_id INTEGER,trigger_type TEXT,deal_id INTEGER,contact_id INTEGER,run_at TEXT,created_at TEXT DEFAULT (datetime('now')));
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
  ['users', 'last_login', 'TEXT'],
  ['contacts', 'company_id', 'INTEGER'], ['contacts', 'position', 'TEXT'], ['contacts', 'responsible_id', 'INTEGER'],
  ['contacts', 'tags', "TEXT DEFAULT ''"], ['contacts', 'notes', "TEXT DEFAULT ''"], ['contacts', 'source', "TEXT DEFAULT 'manual'"],
  ['deals', 'pipeline_id', 'INTEGER DEFAULT 1'], ['deals', 'priority', "TEXT DEFAULT 'normal'"], ['deals', 'loss_reason', 'TEXT'],
  ['deals', 'company_id', 'INTEGER'], ['deals', 'responsible', "TEXT DEFAULT 'Администратор'"], ['deals', 'responsible_id', 'INTEGER'], ['deals', 'updated_at', 'TEXT'],
  ['tasks', 'type', "TEXT DEFAULT 'call'"], ['tasks', 'priority', "TEXT DEFAULT 'normal'"], ['tasks', 'responsible_id', 'INTEGER'],
  ['tasks', 'done', 'INTEGER DEFAULT 0'], ['tasks', 'repeat', "TEXT DEFAULT 'none'"],
  ['messages', 'content_uri', 'TEXT'], ['messages', 'status', 'TEXT'], ['messages', 'external_id', 'TEXT'],
  ['messages', 'channel', "TEXT DEFAULT 'whatsapp'"], ['messages', 'direction', "TEXT DEFAULT 'in'"], ['messages', 'author', 'TEXT'],
  ['messages', 'content_name', 'TEXT'], ['messages', 'content_type', 'TEXT'], ['messages', 'channel_id', 'TEXT'],
  ['conversations', 'channel_id', 'TEXT'], ['conversations', 'external_chat_id', 'TEXT'], ['conversations', 'chat_type', 'TEXT'],
  ['conversations', 'last_at', 'TEXT'], ['conversations', 'assigned_id', 'INTEGER'], ['conversations', 'title', 'TEXT'], ['conversations', 'channels', "TEXT DEFAULT ''"],
  ['contacts', 'phone_norm', 'TEXT'], ['templates', 'user_id', 'INTEGER'],
  ['products', 'demo', 'INTEGER DEFAULT 0'], ['templates', 'demo', 'INTEGER DEFAULT 0'], ['automations', 'demo', 'INTEGER DEFAULT 0'],
  ['products', 'note', "TEXT DEFAULT ''"],   // примечание к позиции каталога (= прайс-листа)
  ['companies', 'demo', 'INTEGER DEFAULT 0'], ['notes', 'demo', 'INTEGER DEFAULT 0'],
  // своё название канала: вендор отдаёт только номер или юзернейм, а каналов
  // бывает по одному на сотрудника, и отличить их друг от друга нужно человеку
  ['channels', 'label', 'TEXT'],
  // сотрудник, чей это аккаунт: с него отвечаем, когда клиент ещё не писал,
  // и на него назначается обращение, пришедшее на этот аккаунт
  ['channels', 'user_id', 'INTEGER'],
  // выдержка правила: действие срабатывает не сразу, а через N дней
  ['automations', 'delay_days', 'INTEGER'],
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
    const pre = join(DATA_DIR, 'backups', `pre-upgrade-${localStamp()}.db`);
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
const SCHEMA_VERSION = 7;

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
// Метка для имён файлов резервных копий — местное время, а не UTC: имена видно
// в интерфейсе, и они должны совпадать с тем, когда копия реально сделана.
// Обычная копия называется crm-<местная дата>.db, страховочные — так же.
function localStamp(d = new Date()) {
  return localNow(d).replace(/[: ]/g, '-');
}
function nowDue(offsetHours = 2) {
  const d = new Date(Date.now() + offsetHours * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`;
}

// Месяц закрытия сделки в местном поясе компании, в виде YYYY-MM.
// Отметки времени база хранит в UTC (datetime('now')), а выручка месяца и план
// продаж считаются по местным месяцам. Без приведения к местному поясу сделки,
// закрытые с 00:00 до 03:00 по Москве, попадали в прошлый месяц, а сравнение
// «закрыта в этом месяце» расходилось с ним на те же три часа.
// NULLIF нужен потому, что COALESCE пропускает только NULL, а в колонках бывает
// пустая строка: без него сделка с closed_at='' не дошла бы до updated_at.
const DEAL_MONTH_SQL = "COALESCE(substr(datetime(COALESCE(NULLIF(closed_at,''),NULLIF(updated_at,''),NULLIF(created_at,'')),'localtime'),1,7),'')";

// Отметка времени из запроса: «YYYY-MM-DD» или полное время, в формате базы
// (UTC, «YYYY-MM-DD HH:MM:SS»). Пустая строка означает «не задано» — тогда
// отметку ставит сам сервер. Принимается только разборчивая дата: иначе в базу
// попала бы строка, которую datetime() не сможет привести к местному поясу.
function normalizeStamp(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return '';
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${day}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}Z`);
  if (isNaN(d)) return '';
  const out = d.toISOString();
  // Разбор прощает лишние дни месяца и переносит 30 февраля на 1 марта. Сверяем
  // день, чтобы в базу не попала дата, которой пользователь не вводил.
  if (out.slice(0, 10) !== day) return '';
  return out.slice(0, 19).replace('T', ' ');
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
export function getCustomFields() {
  try {
    const v = JSON.parse(getSetting('CUSTOM_FIELDS', '[]'));
    if (!Array.isArray(v)) return [];
    const seen = new Set();
    return v.filter(f => {
      if (!f || !f.key || !f.label || seen.has(f.key)) return false;
      seen.add(f.key); return true;
    });
  } catch { return [] }
}
// Обязательные свои поля проверяются на сервере, а не только звёздочкой в форме.
function missingRequiredCustom(table, customRaw) {
  const req = getCustomFields().filter(f => f.required && (f.entity === 'both' || f.entity === table));
  if (!req.length) return null;
  let obj = {};
  try { obj = typeof customRaw === 'string' ? JSON.parse(customRaw || '{}') : (customRaw || {}) } catch { obj = {} }
  const miss = req.filter(f => !String(obj[f.key] ?? '').trim());
  return miss.length ? `Заполните обязательные поля: ${miss.map(f => f.label).join(', ')}` : null;
}
const sanitizeFields = list => {
  const out = [], seen = new Set();
  for (const f of (Array.isArray(list) ? list : []).slice(0, 40)) {
    const key = String(f?.key || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40);
    const label = String(f?.label || '').trim().slice(0, 80);
    // ключ — техническое имя поля: дубликаты ломают формы и сохранение значений
    if (!key || !label || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key, label,
      type: ['text', 'number', 'date', 'select', 'phone', 'email'].includes(f.type) ? f.type : 'text',
      entity: ['contacts', 'deals', 'both'].includes(f.entity) ? f.entity : 'both',
      options: Array.isArray(f.options) ? f.options.map(String).slice(0, 40) : [],
      required: !!f.required,
    });
  }
  return out;
};

// ---------- realtime ----------
const clients = new Set();
function closeUserStreams(id) { for (const res of clients) if (res.userId === id) { clients.delete(res); res.end(); } }
const staticGzip = new Map(); // кэш сжатых ассетов: gzip считается один раз на версию файла
export function broadcast(ev, data) { const s = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`; clients.forEach(r => { try { r.write(s); } catch {} }); }
// Личное уведомление: «вам поставили задачу» должен увидеть только исполнитель,
// а не вся команда. Соединения знают своего пользователя (res.userId).
export function broadcastTo(userId, ev, data) {
  if (!userId) return;
  const s = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(r => { if (r.userId === Number(userId)) { try { r.write(s); } catch {} } });
}

// ---------- automations ----------
// Автоматизации: событие → одно действие. Правило проверяется при сохранении,
// поэтому во время работы с клиентом ничего не ломается из-за опечатки.
const AUTOMATION_TRIGGERS = ['deal_created', 'message_in', 'stage_changed'];
const AUTOMATION_ACTIONS = ['create_task', 'change_stage', 'add_tag', 'send_message', 'send_email', 'assign_user'];
// текст письма или сообщения длиннее названия этапа, поэтому предел свой
const ACTION_VALUE_LIMIT = { send_message: 2000, send_email: 4000 };
function validateAutomation(b, current = {}) {
  const merged = { ...current, ...b };
  const name = String(merged.name || '').trim();
  if (!name) return 'Укажите название правила — по нему вы найдёте его в списке';
  if (!AUTOMATION_TRIGGERS.includes(merged.trigger_type)) return 'Выберите событие, на которое срабатывает правило';
  if (!AUTOMATION_ACTIONS.includes(merged.action_type)) return 'Выберите, что должно произойти';
  const value = String(merged.action_value || '').trim();
  if (!value) return merged.action_type === 'change_stage' ? 'Выберите этап, на который переводить сделку' : merged.action_type === 'add_tag' ? 'Укажите тег, который нужно добавить' : 'Напишите текст задачи, которую нужно создать';
  if (merged.action_type === 'change_stage' && !db.prepare('SELECT 1 x FROM stages WHERE code=?').get(value)) return 'Такого этапа нет — обновите страницу и выберите этап из списка';
  const tv = String(merged.trigger_value || '').trim();
  if (merged.trigger_type === 'stage_changed' && tv && !db.prepare('SELECT 1 x FROM stages WHERE code=?').get(tv)) return 'Этап-условие не найден — выберите этап из списка';
  // сотруднику, которого в правиле нет, сделку передать нельзя: правило молча
  // ничего бы не сделало, а менеджер ждал бы, что заявка ушла дежурному
  if (merged.action_type === 'assign_user') {
    const u = db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(Number(value));
    if (!u) return 'Сотрудник не найден или уже не работает — выберите из списка';
  }
  b.name = name.slice(0, 120);
  b.action_value = value.slice(0, ACTION_VALUE_LIMIT[merged.action_type] || 300);
  b.trigger_value = tv.slice(0, 120);
  // выдержка: целое число дней от 0 до года. Отрицательная означала бы «выполнить
  // вчера», и правило сработало бы на первом же тике
  if (b.delay_days !== undefined) {
    const d = Number(b.delay_days);
    if (!Number.isFinite(d) || d < 0 || d > 365) return 'Выдержка задаётся в днях: от 0 (сразу) до 365';
    b.delay_days = Math.round(d);
  }
  if (b.active !== undefined) b.active = b.active ? 1 : 0;
  return null;
}
// Ключевое слово в сообщении ищем по основе и поддерживаем список через запятую:
// «смета» находит и «смету», и «сметы», а «цена, смета» срабатывает на любое из слов.
function keywordHit(text, rule) {
  const haystack = String(text || '').toLowerCase();
  return String(rule || '').split(/[,;]/).map(w => w.trim().toLowerCase()).filter(Boolean)
    .some(w => haystack.includes(w) || (w.length >= 5 && haystack.includes(w.slice(0, -1))));
}
// Настройки почты собраны в одном месте: раньше они повторялись в трёх маршрутах,
// и расхождение означало бы, что письмо из одного места уходит, а из другого нет.
const smtpSettings = () => ({
  host: getSetting('SMTP_HOST'), port: Number(getSetting('SMTP_PORT', '587')),
  secure: getSetting('SMTP_SECURE') === '1' ? true : getSetting('SMTP_SECURE') === '0' ? false : undefined,
  user: getSetting('SMTP_USER') || undefined, pass: getSetting('SMTP_PASS') || undefined,
  from: getSetting('MAIL_FROM') || getSetting('SMTP_USER') || undefined,
  fromName: getSetting('MAIL_FROM_NAME') || companyRequisites().name || undefined,
});
// В текст правила подставляются те же значения, что и в шаблоны: {name} — имя
// клиента, {deal} — название сделки, {sum} — сумма, {company} — наша компания.
const autoVars = ctx => {
  const c = ctx.contact_id ? db.prepare('SELECT name FROM contacts WHERE id=?').get(ctx.contact_id) : null;
  const d = ctx.deal_id ? db.prepare('SELECT title,amount FROM deals WHERE id=?').get(ctx.deal_id) : null;
  return { name: c?.name || 'Добрый день', deal: d?.title || '', sum: d ? String(Math.round(Number(d.amount) || 0)) : '', company: companyRequisites().name || '' };
};
const fillVars = (text, vars) => String(text ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== '' ? String(vars[k]) : m));
const ruDate = v => String(v || '').slice(0, 10).split('-').reverse().join('.');
// Отметки входящих из Wazzup: без них администратор не отличит «никто не пишет»
// от «сообщения не доходят до CRM».
const wzHookMark = (key, value) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
const wzHookHuman = v => v ? ruDate(v) + ' ' + String(v).slice(11, 16) : '';

// Одно действие правила. Отдельной функцией — потому что его выполняют и сразу,
// и по очереди, если задана выдержка.
async function applyAction(a, ctx) {
  {
      if (a.action_type === 'create_task') {
        if (!ctx.contact_id && !ctx.deal_id) return;
        const owner = (ctx.deal_id && db.prepare('SELECT responsible_id FROM deals WHERE id=?').get(ctx.deal_id)?.responsible_id)
          || (ctx.contact_id && db.prepare('SELECT responsible_id FROM contacts WHERE id=?').get(ctx.contact_id)?.responsible_id) || null;
        const r = db.prepare('INSERT INTO tasks(title,due,contact_id,deal_id,responsible_id) VALUES(?,?,?,?,?)')
          .run(a.action_value || a.name, normalizeDue('сегодня'), ctx.contact_id || null, ctx.deal_id || null, owner);
        log(`Автоматизация «${a.name}»: создана задача`, 'tasks', Number(r.lastInsertRowid));
        if (owner && Number(owner) !== Number(ctx.actor_id)) broadcastTo(owner, 'notify', { type: 'task_assigned', id: Number(r.lastInsertRowid), title: String(a.action_value || a.name), due: normalizeDue('сегодня') });
        broadcast('change', { table: 'tasks' });
      }
      if (a.action_type === 'change_stage' && ctx.deal_id && a.action_value) {
        const d = db.prepare('SELECT * FROM deals WHERE id=?').get(ctx.deal_id);
        if (!d || d.stage === a.action_value) return;
        // этап должен принадлежать воронке сделки: иначе карточка исчезнет из доски
        const st = getStages(Number(d.pipeline_id) || 1).find(x => x.code === a.action_value);
        if (!st) { console.warn(`Автоматизация «${a.name}»: этап ${a.action_value} не найден в воронке сделки`); return; }
        const closed = ['won', 'lost'].includes(st.code) ? ",closed_at=datetime('now')" : ',closed_at=NULL';
        db.prepare(`UPDATE deals SET stage=?,updated_at=datetime('now')${closed} WHERE id=?`).run(st.code, d.id);
        log(`Автоматизация «${a.name}»: сделка «${d.title}» → этап «${st.name}»`, 'deals', d.id);
        broadcast('change', { table: 'deals' });
      }
      if (a.action_type === 'add_tag' && ctx.contact_id && a.action_value) {
        const c = db.prepare('SELECT tags FROM contacts WHERE id=?').get(ctx.contact_id);
        if (!c) return;
        const tags = [...new Set([...(c.tags || '').split(',').map(x => x.trim()).filter(Boolean), a.action_value])].join(',');
        if (tags === (c.tags || '')) return;
        db.prepare('UPDATE contacts SET tags=? WHERE id=?').run(tags, ctx.contact_id);
        log(`Автоматизация «${a.name}»: клиенту добавлен тег «${a.action_value}»`, 'contacts', ctx.contact_id);
        broadcast('change', { table: 'contacts' });
      }
      // передать сделку и клиента другому сотруднику
      if (a.action_type === 'assign_user' && a.action_value) {
        const u = db.prepare('SELECT id,name FROM users WHERE id=? AND active=1').get(Number(a.action_value));
        if (!u) { console.warn(`Автоматизация «${a.name}»: сотрудник ${a.action_value} не найден или уже не работает`); return; }
        let changed = false;
        if (ctx.deal_id) {
          const d = db.prepare('SELECT id,title,responsible_id FROM deals WHERE id=?').get(ctx.deal_id);
          if (d && Number(d.responsible_id) !== u.id) {
            db.prepare("UPDATE deals SET responsible_id=?,responsible=?,updated_at=datetime('now') WHERE id=?").run(u.id, u.name, d.id);
            log(`Автоматизация «${a.name}»: сделка «${d.title}» передана сотруднику ${u.name}`, 'deals', d.id);
            if (Number(u.id) !== Number(ctx.actor_id)) broadcastTo(u.id, 'notify', { type: 'deal_assigned', id: d.id, title: d.title });
            changed = true;
          }
        }
        if (ctx.contact_id) {
          const c = db.prepare('SELECT id,name,responsible_id FROM contacts WHERE id=?').get(ctx.contact_id);
          if (c && Number(c.responsible_id) !== u.id) {
            db.prepare('UPDATE contacts SET responsible_id=? WHERE id=?').run(u.id, c.id);
            log(`Автоматизация «${a.name}»: клиент «${c.name}» передан сотруднику ${u.name}`, 'contacts', c.id);
            changed = true;
          }
        }
        if (changed) { broadcast('change', { table: 'deals' }); broadcast('change', { table: 'contacts' }) }
      }
      // написать клиенту в тот канал, откуда он обращался
      if (a.action_type === 'send_message') {
        const body = fillVars(a.action_value, autoVars(ctx)).trim();
        if (!body) return;
        const conv = ctx.contact_id ? db.prepare('SELECT cv.*,c.phone FROM conversations cv LEFT JOIN contacts c ON c.id=cv.contact_id WHERE cv.contact_id=?').get(ctx.contact_id) : null;
        if (!conv) { log(`Автоматизация «${a.name}»: переписки с клиентом нет, сообщение не отправлено`, 'contacts', ctx.contact_id || null); return; }
        const channel = conv.chat_type || '';
        let status = 'error';
        try {
          const send = await deliver(conv, channel, body, null);
          status = send.delivered ? 'sent' : 'local';
        } catch (e) {
          // без подключённого Wazzup текст остаётся в переписке: правило не «молчит»
          status = String(e.message) === 'WAZZUP_NOT_CONFIGURED' ? 'local' : 'error';
          log(`Автоматизация «${a.name}»: сообщение клиенту не ушло — ${e.message}`, 'contacts', ctx.contact_id || null);
        }
        db.prepare('INSERT INTO messages(conversation_id,channel,direction,body,status,author) VALUES(?,?,?,?,?,?)')
          .run(conv.id, channel || 'whatsapp', 'out', body, status, 'Автоматизация');
        db.prepare("UPDATE conversations SET last_at=datetime('now') WHERE id=?").run(conv.id);
        broadcast('message', { conversation_id: conv.id, direction: 'out' });
        if (status === 'sent') log(`Автоматизация «${a.name}»: клиенту отправлено сообщение`, 'contacts', ctx.contact_id || null);
      }
      // отправить письмо: тема — название правила, текст — значение действия
      if (a.action_type === 'send_email') {
        const c = ctx.contact_id ? db.prepare('SELECT id,name,email FROM contacts WHERE id=?').get(ctx.contact_id) : null;
        if (!c?.email) { log(`Автоматизация «${a.name}»: у клиента нет e-mail, письмо не отправлено`, 'contacts', ctx.contact_id || null); return; }
        if (!getSetting('SMTP_HOST')) { log(`Автоматизация «${a.name}»: почта не настроена, письмо не отправлено`, 'contacts', c.id); return; }
        const body = fillVars(a.action_value, autoVars(ctx)).trim();
        let status = 'sent';
        try { await sendMail({ ...smtpSettings(), to: c.email, toName: c.name || undefined, subject: a.name, text: body }); }
        catch (e) { status = 'error'; log(`Автоматизация «${a.name}»: письмо не ушло — ${e.message}`, 'contacts', c.id); }
        const conv = db.prepare('SELECT id FROM conversations WHERE contact_id=?').get(c.id);
        if (conv) {
          db.prepare("INSERT INTO messages(conversation_id,channel,direction,body,subject,status,author) VALUES(?,?,?,?,?,?,?)")
            .run(conv.id, 'email', 'out', body, a.name, status, 'Автоматизация');
          db.prepare("UPDATE conversations SET last_at=datetime('now') WHERE id=?").run(conv.id);
          broadcast('message', { conversation_id: conv.id, direction: 'out' });
        }
        if (status === 'sent') log(`Автоматизация «${a.name}»: клиенту отправлено письмо на ${c.email}`, 'contacts', c.id);
      }
  }
}

async function runAutomations(trigger, ctx = {}) {
  for (const a of db.prepare('SELECT * FROM automations WHERE active=1 AND trigger_type=? ORDER BY id').all(trigger)) {
    try {
      // условие правила: конкретный этап или ключевое слово в сообщении
      if (a.trigger_value) {
        if (trigger === 'stage_changed' && a.trigger_value !== ctx.stage) continue;
        if (trigger === 'message_in' && !keywordHit(ctx.text, a.trigger_value)) continue;
      }
      const delay = Number(a.delay_days) || 0;
      if (delay > 0) {
        // действие с выдержкой: планировщик выполнит его в срок. Ставим в очередь
        // и сразу выходим — иначе «напомнить через 3 дня» сработало бы сейчас.
        const runAt = localNow(new Date(Date.now() + delay * 864e5));
        db.prepare('INSERT INTO automation_queue(automation_id,trigger_type,deal_id,contact_id,run_at) VALUES(?,?,?,?,?)')
          .run(a.id, trigger, ctx.deal_id || null, ctx.contact_id || null, runAt);
        log(`Автоматизация «${a.name}»: сработает ${ruDate(runAt)}, через ${delay} дн.`,
          ctx.deal_id ? 'deals' : 'contacts', ctx.deal_id || ctx.contact_id || null);
        continue;
      }
      await applyAction(a, ctx);
    } catch (e) { console.error('automation', e); }
  }
}

// Очередь отложенных действий. Строку удаляем до выполнения: иначе сбой оставил
// бы её в очереди навсегда, и правило повторялось бы каждый тик.
export async function queueTick() {
  const due = db.prepare('SELECT * FROM automation_queue WHERE run_at <= ? ORDER BY id').all(localNow());
  for (const q of due) {
    db.prepare('DELETE FROM automation_queue WHERE id=?').run(q.id);
    const a = db.prepare('SELECT * FROM automations WHERE id=? AND active=1').get(q.automation_id);
    // правило выключили или удалили — выполнять уже нечего
    if (!a) continue;
    try { await applyAction(a, { deal_id: q.deal_id, contact_id: q.contact_id }) }
    catch (e) { console.error('automation queue', e) }
  }
  return due.length;
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
export async function ensureDeal(contact) {
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
  await runAutomations('deal_created', { deal_id: Number(dr.lastInsertRowid), contact_id: contact.id });
  broadcast('change', { table: 'deals' });
  return Number(dr.lastInsertRowid);
}

export async function upsertIncoming({ channel = 'whatsapp', chatType = '', phone = '', chatId = '', name = '', body = '', external_id = null, channelId = '', contentUri = '', contentName = '', author = '', email = '', subject = '', direction = 'in' }) {
  if (!body && !contentUri) return null;
  // ограничиваем длину: вебхук — доверенный, но не бесконечный источник
  const cap = (s, n) => String(s ?? '').slice(0, n);
  name = cap(name, 120); body = cap(body, 100000); subject = cap(subject, 200); author = cap(author, 120);
  // В этих каналах адресат — номер телефона; в остальных (Авито, Циан, MAX,
  // Telegram, Instagram, ВК) chatId номером не является, и писать его в телефон
  // контакта нельзя: карточка склеилась бы с чужим клиентом.
  const ph = phone || (['whatsapp', 'wapi', 'whatsgroup', 'viber'].includes(String(chatType || channel).toLowerCase()) ? chatId : '');
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
  // Клиент написал на аккаунт конкретного сотрудника — значит, обращением
  // занимается он, а не тот, кому выпало по очереди. Привязку канала к сотруднику
  // задаёт администратор один раз в настройках; без привязки работает прежнее
  // распределение по загруженности. Назначаем до создания сделки, чтобы сделка
  // сразу завелась на нужного человека.
  const boundId = channelId ? Number(db.prepare('SELECT user_id FROM channels WHERE external_id=?').get(String(channelId))?.user_id) || 0 : 0;
  if (boundId && !contact.responsible_id) {
    const bound = db.prepare('SELECT id,name FROM users WHERE id=? AND active=1').get(boundId);
    if (bound) {
      db.prepare('UPDATE contacts SET responsible_id=? WHERE id=?').run(bound.id, contact.id);
      contact.responsible_id = bound.id;
      log(`Обращение «${contact.name}» пришло на аккаунт ${bound.name} и назначено на него`, 'contacts', contact.id);
    }
  }
  let conv = db.prepare('SELECT * FROM conversations WHERE contact_id=?').get(contact.id);
  let dealId = null;
  if (!conv) {
    const r = db.prepare('INSERT INTO conversations(contact_id,title,channels,channel_id,external_chat_id,chat_type) VALUES(?,?,?,?,?,?)').run(contact.id, contact.name, channel, channelId, String(chatId || ph || ''), chatType || channel);
    conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(r.lastInsertRowid);
    dealId = await ensureDeal(contact);
  }
  const channels = [...new Set([...(conv.channels || '').split(',').filter(Boolean), channel])].join(',');
  try { db.prepare('INSERT INTO messages(conversation_id,channel,direction,body,subject,content_uri,content_name,status,external_id,author,channel_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(conv.id, channel, 'in', body || '[вложение]', subject, contentUri, contentName || null, channel === 'email' ? 'received' : 'inbound', external_id, author, channelId || null); }
  catch (e) { if (/UNIQUE/i.test(e.message)) return conv; console.error('message insert', e); throw e; }
  db.prepare("UPDATE conversations SET channels=?,channel_id=COALESCE(NULLIF(?,''),channel_id),external_chat_id=COALESCE(NULLIF(?,''),external_chat_id),chat_type=COALESCE(NULLIF(?,''),chat_type),last_at=datetime('now') WHERE id=?").run(channels, channelId, String(chatId || ''), chatType, conv.id);
  // беседу тоже отмечаем за владельцем канала, если она ничья
  if (boundId && !conv.assigned_id) db.prepare('UPDATE conversations SET assigned_id=? WHERE id=?').run(boundId, conv.id);
  if (!dealId) dealId = await ensureDeal(contact); // клиент вернулся, а открытой сделки нет — заводим новое обращение
  const openDeal = db.prepare("SELECT id FROM deals WHERE contact_id=? AND stage NOT IN ('won','lost') ORDER BY id DESC").get(contact.id);
  await runAutomations('message_in', { contact_id: contact.id, deal_id: dealId || openDeal?.id, text: body });
  // в событии есть имя и превью: интерфейс показывает понятное уведомление
  // всплывающее уведомление о чужом клиенте мешало бы остальным: событие
  // помечается адресатом, а интерфейс сам решит, кому показать
  const forUser = Number(conv.assigned_id) || Number(contact.responsible_id) || 0;
  broadcast('message', { conversation_id: conv.id, title: contact.name || conv.title || 'Клиент', preview: String(body || '').slice(0, 90), direction: 'in', for_user: forUser || null, channel });
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
// Wazzup различает ТРАНСПОРТ канала и ТИП ЧАТА — это два разных закрытых списка
// (wazzup24.ru/help/api-ru/rabota-s-kanalami и .../otpravka-soobshhenij).
// Транспорт приходит в GET /channels и описывает подключённый аккаунт; тип чата
// используется в POST /message и в вебхуках. Смешивать их нельзя: в типах чата нет
// wapi, tgapi, maxbot и циана, зато есть групповые чаты telegroup и maxgroup —
// без них в группу Telegram и MAX ответить невозможно.
const WZ_TRANSPORTS = ['whatsapp', 'wapi', 'whatsgroup', 'tgapi', 'telegram', 'instagram',
  'viber', 'avito', 'max', 'maxbot', 'cian', 'vk'];
const WZ_CHAT_TYPES = ['whatsapp', 'whatsgroup', 'viber', 'instagram', 'telegram',
  'telegroup', 'vk', 'avito', 'max', 'maxgroup'];
// всё, что может встретиться в наших данных: источник контакта, канал беседы
const WZ_ALL = [...new Set([...WZ_TRANSPORTS, ...WZ_CHAT_TYPES])];
// Состояния канала, при которых сообщения не ходят (wazzup24.ru/help/api-ru/rabota-s-kanalami).
// Неизвестное или отсутствующее состояние считаем рабочим: новый статус у вендора
// не должен прятать каналы заказчика.
const WZ_DEAD_STATES = ['disabled', 'notEnoughMoney', 'blocked', 'unauthorized', 'qridle',
  'openelsewhere', 'foreignphone', 'waitForPassword', 'onModeration', 'rejected', 'phoneUnavailable'];
const wzUsable = ch => !WZ_DEAD_STATES.includes(String(ch?.state || ''));
// Типы сообщений Wazzup без текста и файла (wazzup24.ru/help/api-ru/webhooks-2).
// Без подписи такое событие терялось: клиент промахнулся звонком или прислал
// визитку, а в CRM не оставалось никакого следа.
const WZ_TYPE_BODY = {
  missing_call: '[пропущенный звонок]', vcard: '[визитка контакта]', geo: '[геометка]',
  wapi_template: '[шаблон WhatsApp]', unsupported: '[сообщение, которое не открывается]',
  system: '[служебное сообщение]', unknown: '[сообщение без текста]',
  image: '[изображение]', audio: '[голосовое сообщение]', video: '[видео]', document: '[документ]'
};
// Канал входящего сообщения. Тип чата сохраняем как есть; если вендор прислал
// транспорт без соответствующего типа чата (так бывает у Циана), канал всё равно
// называем его именем: обращение видно в его канале, а не в обезличенном «сайте».
// Отправить туда нельзя — нормализация типа чата такое значение не пропустит.
const normChatType = t => { const v = String(t || '').trim().toLowerCase(); return WZ_CHAT_TYPES.includes(v) ? v : ''; };
const wzChannel = t => {
  const v = String(t || '').trim().toLowerCase();
  return normChatType(v) || (WZ_TRANSPORTS.includes(v) ? v : 'site');
};
// что писать в историю, если у сообщения нет ни текста, ни файла
// В истории вложение подписывается именем файла: техническая метка вида
// «[вложение: document]» человеку ничего не говорит и дублирует значок файла.
const wzFileLabel = m => m.fileName || wzNameFromUri(m.contentUri) || 'файл';
const wzNameFromUri = u => { try { const last = String(u || '').split('?')[0].split('/').pop() || ''; const d = decodeURIComponent(last); return d && /\./.test(d) ? d.slice(0, 80) : ''; } catch { return ''; } };
const wzBody = m => m.text || (m.contentUri ? 'Вложение: ' + wzFileLabel(m) : (WZ_TYPE_BODY[m.type] || ''));
// GET /channels отдаёт ГОЛЫЙ МАССИВ (wazzup24.ru/help/api-ru/rabota-s-kanalami),
// обёртка {channels:[…]} встречается только в партнёрском API. Чтение ответа как
// объекта давало пустой список при рабочем ключе: «синхронизировано: 0».
const wzChannels = data => (Array.isArray(data) ? data : (data?.channels || data?.data || []));
// Какому типу чата соответствуют транспорты подключённых аккаунтов. Карта обратная
// к интерфейсной: у типа чата telegram два транспорта (личный аккаунт и бот), у max
// тоже, а групповой чат приходит с транспортом того же мессенджера.
const WZ_CHAT_TRANSPORTS = {
  whatsapp: ['whatsapp', 'wapi'], whatsgroup: ['whatsgroup'], viber: ['viber'],
  instagram: ['instagram'], telegram: ['telegram', 'tgapi'], telegroup: ['telegram', 'tgapi'],
  vk: ['vk'], avito: ['avito'], max: ['max', 'maxbot'], maxgroup: ['max', 'maxbot']
};
// Канал и тип чата должны соответствовать друг другу. Если клиент писал в WhatsApp
// одного сотрудника, а отвечают в Telegram-бот компании, прежний канал не годится:
// вендор получит пару «тип чата telegram + канал от WhatsApp» и ответ не уйдёт.
const pickChannelId = (conv, chatType, user = null) => {
  const fits = t => (WZ_CHAT_TRANSPORTS[chatType] || []).includes(String(t || '').trim().toLowerCase());
  const own = isUuid(conv?.channel_id) ? conv.channel_id : '';
  const rows = db.prepare("SELECT external_id,transport,state,user_id FROM channels WHERE provider='wazzup'").all();
  const ownRow = own ? rows.find(c => c.external_id === own) : null;
  // Клиент писал на этот аккаунт, и он подходит под выбранный мессенджер —
  // отвечаем с него же. Иначе клиент получит сообщение с незнакомого номера.
  // Канал не синхронизирован (ownRow пуст) — тоже доверяем беседе.
  if (own && (!ownRow || fits(ownRow.transport))) return own;
  // Исходящая беседа: клиент ещё не писал, или его аккаунт не подходит под
  // выбранный мессенджер. Тогда берём аккаунт того сотрудника, который отвечает,
  // если администратор привязал к нему канал.
  const mine = user?.id ? rows.find(c => Number(c.user_id) === Number(user.id) && fits(c.transport) && wzUsable(c)) : null;
  if (mine) return mine.external_id;
  // иначе любой подключённый и работающий аккаунт нужного мессенджера
  const match = rows.find(c => fits(c.transport) && wzUsable(c));
  return match?.external_id || own || '';
};
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
  // Пустой тип бывает у беседы, созданной вручную, — там годится канал по
  // умолчанию. Неизвестный тип подменять на whatsapp нельзя: ответ ушёл бы
  // клиенту не в тот мессенджер, и выглядело бы это как delivered.
  const rawType = String(chatTypeOverride || conv.chat_type || '').trim().toLowerCase();
  const chatType = normChatType(rawType);
  // Какой аккаунт отправляет, зависит от типа чата, поэтому канал выбираем после него
  const channelId = pickChannelId(conv, chatType, user) || getSetting('WAZZUP_CHANNEL_ID');
  if (!channelId) throw new Error('Не выбран канал Wazzup. Настройки → Интеграции → «Проверить и синхронизировать каналы», затем выберите канал по умолчанию.');
  if (!chatType) {
    if (!rawType) throw new Error('Не выбран канал отправки');
    throw new Error(`Тип чата «${rawType}» не поддерживается. Wazzup принимает chatType из списка: ${WZ_CHAT_TYPES.join(', ')}`);
  }
  // адресат — id чата из вебхука или номер телефона клиента
  const chatId = conv.external_chat_id || digits(conv.phone);
  if (!chatId) throw new Error('Нет адресата: у клиента не заполнен телефон или не пришло ни одного сообщения из этого канала.');
  if (!text && !file?.contentUri) throw new Error('Пустое сообщение: Wazzup требует текст или ссылку на файл');
  const base = { channelId, chatType, chatId };
  // идентификатор менеджера в нашей CRM: Wazzup вернёт его в вебхуке, и видно,
  // кто отправил сообщение. Пустое значение не передаём.
  if (user?.id) base.crmUserId = String(user.id);
  // crmMessageId защищает от повторной доставки при повторе запроса; у каждого
  // обращения к Wazzup он свой.
  const newId = () => 'karkas-' + Date.now().toString(36) + '-' + randomBytes(4).toString('hex');
  const post = async body => {
    try { return await wazzupFetch('/message', { method: 'POST', body: JSON.stringify(body) }); }
    catch (e) { throw new Error(wazzupError(e, e.status)); }
  };
  if (file?.contentUri) {
    // Wazzup запрещает передавать text и contentUri одним запросом, поэтому
    // вложение и подпись к нему уходят двумя сообщениями — как сделал бы человек.
    const sent = await post({ ...base, contentUri: file.contentUri, crmMessageId: newId() });
    if (text) {
      try { await post({ ...base, text, crmMessageId: newId() }); }
      catch (e) { throw new Error(e.message + ' Вложение клиенту ушло, подпись — нет: отправьте текст отдельным сообщением.'); }
    }
    return { delivered: true, mode: 'wazzup', id: sent.messageId || sent.id, channelId };
  }
  const data = await post({ ...base, text, crmMessageId: newId() });
  return { delivered: true, mode: 'wazzup', id: data.messageId || data.id, channelId };
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
// ----- выгрузка резервных копий в S3 -----
// Копия на том же диске, что и база, не спасает ни при потере сервера, ни при
// шифровальщике. Поэтому после создания копии отправляем её в S3-хранилище,
// если администратор его настроил. Ошибка выгрузки саму копию не отменяет:
// база остаётся защищённой локально, а причина видна в настройках.
const s3cfg = () => {
  const g = (k, d = '') => String(getSetting(k) || process.env[k] || d);
  return {
    endpoint: g('S3_ENDPOINT').replace(/\/+$/, ''),
    bucket: g('S3_BUCKET'),
    region: g('S3_REGION', 'us-east-1'),
    accessKey: g('S3_ACCESS_KEY'),
    secretKey: g('S3_SECRET_KEY'),
    prefix: g('S3_PREFIX', 'karkascrm').replace(/^\/+|\/+$/g, ''),
    keep: Number(getSetting('S3_KEEP') || process.env.S3_KEEP || '14') || 0,
    auto: String(getSetting('S3_AUTO') || process.env.S3_AUTO || '1') === '1',
  };
};
export const s3ready = c => Boolean(c.endpoint && c.bucket && c.accessKey && c.secretKey);
export const s3missing = c => ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY']
  .filter(k => !String(getSetting(k) || process.env[k] || '').trim());

async function s3request(c, { method, key = '', query, body = null, contentType = '' }) {
  const signed = signedHeaders({ method, key, bucket: c.bucket, query, body: body || '', region: c.region, endpoint: c.endpoint, accessKey: c.accessKey, secretKey: c.secretKey });
  const headers = { ...signed.headers };
  if (contentType) headers['Content-Type'] = contentType;
  if (body) headers['Content-Length'] = String(Buffer.byteLength(body));
  const res = await fetch(signed.url, { method, headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const code = (text.match(/<Code>([^<]+)<\/Code>/) || [])[1];
    throw new Error(`хранилище ответило ${res.status}${code ? ' (' + code + ')' : ''}`);
  }
  return res;
}

// Оставляем в хранилище N последних копий: без этого ведро растёт бесконечно,
// а платят за него по объёму. Список берём из хранилища, а не из локальных
// файлов — локальные копии чистятся раньше и живут меньше.
async function s3prune(c, keep) {
  if (!keep || keep <= 0) return { kept: 0, removed: 0 };
  // Хранилище отдаёт список страницами. Без досборки чистка посчитала бы только
  // первую тысячу объектов, а старые копии продолжали бы лежать и занимать место.
  const prefix = c.prefix ? c.prefix + '/' : '';
  const unesc = v => decodeURIComponent(String(v).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
  const all = [];
  let marker = '';
  for (let page = 0; page < 10; page++) {
    const query = { prefix, 'max-keys': '1000' };
    if (marker) query.marker = marker;
    const xml = await (await s3request(c, { method: 'GET', key: '', query })).text();
    const page_keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => unesc(m[1]));
    all.push(...page_keys);
    if (!/<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml) || !page_keys.length) break;
    const next = (xml.match(/<NextMarker>([^<]+)<\/NextMarker>/) || [])[1];
    marker = unesc(next || page_keys[page_keys.length - 1]);
  }
  const keys = all.filter(k => k.endsWith('.db'));
  // имена копий начинаются с даты, поэтому сортировка по имени = сортировка по времени
  keys.sort();
  const extra = keys.slice(0, Math.max(0, keys.length - keep));
  let removed = 0;
  for (const key of extra) {
    try { await s3request(c, { method: 'DELETE', key }); removed++ }
    catch (e) { console.error('S3: не удалось удалить старую копию ' + key + ': ' + e.message) }
  }
  return { kept: keys.length - removed, removed, total: keys.length };
}

// ключ доступа показываем хвостом: полностью его видеть не нужно, а понять,
// тот ли ключ вставлен, — нужно
const maskKey = v => v ? '••••••' + String(v).slice(-4) : '';
// Что видит администратор в настройках: настроено ли хранилище, когда была
// последняя успешная выгрузка и почему не получилось в прошлый раз. Секретный
// ключ наружу не отдаём — только отметку, что он задан.
const s3status = () => {
  const c = s3cfg();
  return {
    configured: s3ready(c), missing: s3missing(c),
    endpoint: c.endpoint, bucket: c.bucket, region: c.region, prefix: c.prefix,
    access_key: maskKey(c.accessKey), secret_set: Boolean(c.secretKey),
    keep: c.keep, auto: c.auto,
    last_ok: getSetting('S3_LAST_OK', ''), last_file: getSetting('S3_LAST_FILE', ''), last_error: getSetting('S3_LAST_ERROR', ''),
  };
};

export async function uploadBackupToS3(name) {
  const c = s3cfg();
  if (!s3ready(c)) {
    const missing = s3missing(c);
    const err = missing.length ? `не заполнены поля: ${missing.join(', ')}` : 'хранилище не настроено';
    setSetting('S3_LAST_ERROR', err);
    return { ok: false, error: err };
  }
  const file = join(DATA_DIR, 'backups', name);
  if (!existsSync(file)) { setSetting('S3_LAST_ERROR', `нет файла копии: ${name}`); return { ok: false, error: 'нет файла копии' }; }
  const key = `${c.prefix ? c.prefix + '/' : ''}${name}`;
  try {
    const body = readFileSync(file);
    await s3request(c, { method: 'PUT', key, body, contentType: 'application/vnd.sqlite3' });
    const pruned = await s3prune(c, c.keep).catch(e => { console.error('S3: чистка старых копий не удалась: ' + e.message); return { removed: 0 } });
    setSetting('S3_LAST_OK', localNow());
    setSetting('S3_LAST_FILE', name);
    setSetting('S3_LAST_ERROR', '');
    log(`Резервная копия ${name} выгружена в хранилище${pruned.removed ? `, старых удалено: ${pruned.removed}` : ''}`);
    return { ok: true, name, key, bucket: c.bucket, ...pruned };
  } catch (e) {
    setSetting('S3_LAST_ERROR', String(e.message).slice(0, 300));
    console.error('S3: выгрузка копии не удалась: ' + e.message);
    return { ok: false, error: e.message };
  }
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
        try {
          const made = makeBackup();
          // ночная копия сразу уезжает в хранилище: ждать ручного запуска нельзя,
          // иначе она так и лежит на одном диске с базой
          if (made && s3cfg().auto) await uploadBackupToS3(made);
        } catch (e) { console.error('backup', e) }
        // ежедневная уборка: лента активности (20 000 событий), осиротевшие
        // строки и старые файлы чатов, на которые больше нет ссылок
        try {
          const m = dailyMaintenance(db, { uploadDir: UPLOAD_DIR });
          const n = Object.values(m.orphans).reduce((a, b) => a + b, 0);
          if (n || m.activitiesTrimmed || m.reportsTrimmed || m.uploads.removed) console.log(`Обслуживание базы: строк убрано ${n}, событий ленты ${m.activitiesTrimmed}, отчётов конкурентов ${m.reportsTrimmed}, файлов ${m.uploads.removed}.`);
        } catch (e) { console.error('maintenance', e) }
      }
      await overdueTick();
      // отложенные действия правил: «напомнить клиенту через 3 дня»
      try { const n = await queueTick(); if (n) console.log(`Автоматизация: выполнено отложенных действий ${n}`) } catch (e) { console.error('automation queue', e) }
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
// ----- документ по ссылке -----
// КП и счёт нужно отправить клиенту, а входить в CRM он не должен. Ссылка
// подписана секретом сервера и действует ограниченное время: подделать её
// нельзя, перебор номера сделки ничего не даст, а через две недели она
// сама перестаёт открываться.
const DOC_LINK_DAYS = Math.max(1, Number(process.env.DOC_LINK_DAYS) || 14);
const docSign = data => createHmac('sha256', SECRET).update(String(data)).digest('base64url');
export function docToken(id, doc, days = DOC_LINK_DAYS) {
  const exp = Date.now() + Number(days) * 86400000;
  const data = `${Number(id)}.${doc === 'invoice' ? 'invoice' : 'quote'}.${exp}`;
  return Buffer.from(data, 'utf8').toString('base64url') + '.' + docSign(data);
}
export function readDocToken(token) {
  const t = String(token || '');
  const dot = t.lastIndexOf('.');
  if (dot <= 0 || dot === t.length - 1) return null;
  const data = Buffer.from(t.slice(0, dot), 'base64url').toString('utf8');
  const got = Buffer.from(t.slice(dot + 1));
  const want = Buffer.from(docSign(data));
  // сравнение постоянным временем и только равных длин: иначе подпись подбирают
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const m = data.match(/^(\d+)\.(quote|invoice)\.(\d+)$/);
  if (!m || Number(m[3]) < Date.now()) return null;
  return { id: Number(m[1]), doc: m[2], expiresAt: Number(m[3]) };
}
// Адрес, по которому CRM видна снаружи: его кладём в письмо клиенту. Внутренний
// адрес контейнера в письме был бы бесполезен.
const publicBase = req => {
  const set = String(getSetting('PUBLIC_URL') || '').replace(/\/+$/, '');
  if (set) return set;
  const host = String(req?.headers?.host || '').replace(/[^A-Za-z0-9._:\-]/g, '');
  if (!host) return '';
  return `${isHttps(req) ? 'https' : 'http'}://${host}`;
};
const docPage = (title, text) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)}</title>
<style>body{font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a;background:#f6f7f9;margin:0;padding:40px 16px}
.box{max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:26px}h1{font-size:19px;margin:0 0 8px}p{margin:0;color:#475569}</style>
</head><body><div class="box"><h1>${escHtml(title)}</h1><p>${escHtml(text)}</p></div></body></html>`;

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
// Дата для документов и писем — привычная: 05.11.2026 вместо 2026-11-05.
// В базе и API остаётся ISO: по нему сортируют и сравнивают.
function displayDate(value) {
  const raw = String(value ?? '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  return m ? `${m[3]}.${m[2]}.${m[1]}${m[4] ? ' ' + m[4] + ':' + m[5] : ''}` : raw;
}
function dealDocument({ deal, items, doc, company }) {
  const isInvoice = doc === 'invoice';
  const sum = items.reduce((a, x) => a + x.price * x.qty, 0);
  const vat = Math.round(sum * 20 / 120);
  // Префикс задаёт пользователь, разделитель добавляет документ. Хвостовой дефис
  // убираем, чтобы и «КП», и «К-» давали «КП-0001» и «К-0001», а не «К--0001».
  const prefix = String(company.doc_prefix || 'КП').trim().replace(/[-\s]+$/, '');
  const number = `${prefix}-${String(deal.id).padStart(4, '0')}`;
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
${deal.deadline ? `<p class="muted">Срок действия предложения / срок выполнения: ${escHtml(displayDate(deal.deadline))}</p>` : ''}
<div class="sign"><div>${isInvoice ? 'Руководитель' : 'Исполнитель'}<div class="line"></div>${company.signer ? escHtml(company.signer) : ''}</div>
<div>Заказчик<div class="line"></div>${escHtml(deal.contact_name || '')}</div></div>
</body></html>`;
}
const html = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body); };
const GZ_CACHE = new Map(); // тело ответа -> gzip; порядок Map = порядок замены
const gzCache = body => {
  const hit = GZ_CACHE.get(body);
  if (hit) return hit;
  const gz = gzipSync(body);
  if (body.length <= 262144) { if (GZ_CACHE.size >= 48) GZ_CACHE.delete(GZ_CACHE.keys().next().value); GZ_CACHE.set(body, gz); }
  return gz;
};
const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  // списки сделок, чатов и контактов весят десятки килобайт: на медленной
  // сети gzip сокращает ответ в разы, и страница открывается заметно быстрее
  const req = res.req;
  if (body.length > 1024 && req && /gzip/.test(String(req.headers['accept-encoding'] || ''))) {
    const gz = gzCache(body);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding', 'Content-Length': gz.length });
    return res.end(gz);
  }
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body);
};
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
const readBodyRaw = async (req, maxBytes = 5e6) => {
  let s = ''; for await (const ch of req) { s += ch; if (s.length > maxBytes) throw new Error('Слишком большой запрос'); }
  return s;
};
const readBody = async (req, maxBytes = 5e6) => {
  let s = ''; for await (const ch of req) { s += ch; if (s.length > maxBytes) throw new Error('Слишком большой запрос'); }
  try { return s ? JSON.parse(s) : {}; }
  catch { const e = new Error('Некорректный JSON в запросе — проверьте данные формы'); e.statusCode = 400; throw e; }
};
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.zip': 'application/zip', '.txt': 'text/plain', '.csv': 'text/csv', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.patch': 'text/plain', '.diff': 'text/plain' };
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
const csv = rows => {
  if (!rows.length) return '';
  const ks = Object.keys(rows[0]);
  // Excel выполняет ячейки, начинающиеся с = + - @, как формулы. Данные клиентов
  // не должны запускать вычисления при открытии выгрузки — экранируем апострофом.
  const q = v => { let s = String(v ?? ''); if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  return [ks.join(';'), ...rows.map(r => ks.map(k => q(r[k])).join(';'))].join('\n');
};
const ADMIN_ONLY = [
  /^\/api\/settings(\/.*)?$/, /^\/api\/users(\/.*)?$/, /^\/api\/pipelines(\/.*)?$/, /^\/api\/automations(\/.*)?$/,
  /^\/api\/custom-fields(\/.*)?$/, /^\/api\/competitor-sources(\/.*)?$/,
  /^\/api\/backups(\/.*)?$/, /^\/api\/integrations(\/.*)?$/, /^\/api\/prices\/ours(\/.*)?$/,
  /^\/api\/demo\/cleanup$/, /^\/api\/channels(\/.*)?$/, /^\/api\/automation-queue(\/.*)?$/,
];
// Отказ по правам понятнее, если сказать, что именно закрыто и что делать вместо этого.
const ADMIN_ONLY_HINT = [
  [/^\/api\/prices\/ours(\/.*)?$/, 'Прайс-лист меняет только администратор. Позицию, которой нет в каталоге, можно добавить прямо в сделку.'],
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

// «Наш прайс» прошлых версий переезжает в каталог: это один и тот же список
// (что продаём и по какой цене), вести его в двух местах больше не нужно.
try {
  const moved = migrateOurPricesToCatalog(db);
  if (moved) console.log(`Наша таблица цен перенесена в каталог: ${moved} поз. (прайс-лист и каталог теперь один список)`);
} catch (e) { console.error('Не удалось перенести нашу таблицу цен в каталог:', e.message) }


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
// а сам текст — в поле «канал». Возвращаем текст на место, а канал обнуляем:
// у шаблона его больше нет (куда отправить, выбирают в чате). Правим только
// явно испорченные записи, поэтому повторный запуск ничего не портит.
try {
  const CODES = ['whatsapp', 'telegram', 'instagram', 'viber', 'email', 'any'];
  const holes = CODES.map(() => '?').join(',');
  const broken = db.prepare(`SELECT id, body, channel FROM templates WHERE lower(trim(COALESCE(body,''))) IN (${holes})
      AND lower(trim(COALESCE(channel,''))) NOT IN (${holes})`).all(...CODES, ...CODES);
  if (broken.length) {
    const fix = db.prepare('UPDATE templates SET body=?, channel=? WHERE id=?');
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const t of broken) fix.run(String(t.channel || ''), 'any', t.id);
      db.exec('COMMIT');
      console.log(`Шаблоны: исправлен текст у ${broken.length} зап. (в ранней версии текст и канал были перепутаны).`);
    } catch (e) { db.exec('ROLLBACK'); throw e }
  }
} catch (e) { console.error('Не удалось проверить шаблоны:', e.message) }

// Разовая уборка при старте: если старая версия оставила заметки удалённых
// сделок или ссылки задач на несуществующие записи, они не должны копиться.
try {
  const cleaned = cleanupOrphans(db);
  const synced = syncDealResponsibleNames(db);
  const n = Object.values(cleaned).reduce((a, b) => a + b, 0);
  if (n) console.log(`База: убрано ${n} строк, потерявших родителя (заметки, позиции, ссылки задач).`);
  if (synced) console.log(`База: имя ответственного обновлено у ${synced} сделок.`);
} catch (e) { console.error('Уборка базы при старте:', e.message) }

export const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`), p = u.pathname;
  applySecurityHeaders(req, res);
  try {
    // ===== документ по подписанной ссылке (КП и счёт для клиента) =====
    const mDocLink = p.match(/^\/d\/([A-Za-z0-9_.\-]+)$/);
    if (mDocLink && req.method === 'GET') {
      const link = readDocToken(mDocLink[1]);
      if (!link) return html(res, 404, docPage('Ссылка не работает', 'Документ открыли по неверной или просроченной ссылке. Попросите менеджера отправить её заново.'));
      const deal = db.prepare('SELECT d.*,c.name contact_name,c.phone contact_phone,c.email contact_email,co.name company_name FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id LEFT JOIN companies co ON co.id=d.company_id WHERE d.id=?').get(link.id);
      if (!deal) return html(res, 404, docPage('Документ не найден', 'Сделка, к которой относился документ, удалена.'));
      const items = db.prepare('SELECT * FROM deal_products WHERE deal_id=? ORDER BY id').all(link.id);
      return html(res, 200, dealDocument({ deal, items, doc: link.doc, company: companyRequisites() }));
    }

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
      const rawBody = await readBodyRaw(req);
      let b;
      try { b = rawBody ? JSON.parse(rawBody) : {}; }
      catch { const e = new Error('Некорректный JSON в запросе — проверьте данные формы'); e.statusCode = 400; throw e; }
      wzHookMark('WZ_HOOK_LAST_AT', localNow());
      if (b.test) { wzHookMark('WZ_HOOK_TEST_AT', localNow()); return json(res, 200, { received: true, test: true }); }
      // оба формата входа venдора приводим одной картой: в старом messages[]
      // вложение лежит в attachment.url, и без приведения файл без подписи
      // молча терялся — история показывала только текстовые сообщения
      const mapMsg = m => ({
        messageId: m.message_id || m.messageId, channelId: m.channel_id || m.channelId,
        // тип чата берём только из данных: подставлять 'whatsapp' вместо отсутствующего
        // нельзя, ответ ушёл бы клиенту не в тот мессенджер, а выглядело бы как доставка
        chatType: m.recipient?.chat_type || m.sender?.chat_type || m.chatType || '',
        chatId: m.recipient?.chat_id || m.sender?.chat_id || m.chatId, isEcho: (m.direction === 'outbound') || m.isEcho,
        text: m.text, type: m.attachment ? 'file' : (WZ_TYPE_BODY[m.type] ? m.type : 'text'), contentUri: m.attachment?.url || m.contentUri, status: m.direction === 'inbound' ? 'inbound' : (m.status || ''),
        fileName: m.attachment?.name || m.attachment?.fileName || m.fileName || '',
        authorName: m.sender?.name, contact: { name: m.sender?.name || m.recipient?.name || m.contact?.name, phone: m.sender?.phone || m.recipient?.phone || m.contact?.phone }
      });
      const legacy = (b.messages || []).map(mapMsg);
      const modern = (b.data || []).concat(!b.data && (b.message_id || b.messageId) ? [b] : []).map(mapMsg);
      for (const m of legacy.concat(modern)) {
        if (m.status && m.status !== 'inbound') { db.prepare('UPDATE messages SET status=? WHERE external_id=?').run(m.status, m.messageId); continue; }
        if (m.isEcho) continue;
        await upsertIncoming({ channel: wzChannel(m.chatType), chatType: normChatType(m.chatType), phone: m.contact?.phone || '', chatId: m.chatId || '', name: m.contact?.name || m.authorName || '', body: wzBody(m), contentUri: m.contentUri || '', contentName: m.fileName || wzNameFromUri(m.contentUri), external_id: m.messageId, channelId: m.channelId, author: m.authorName || '' });
      }
      const fwd = getSetting('WAZZUP_FORWARD_URL');
      // Wazzup присылает входящие на один адрес: если мессенджеры подключены ещё
      // и к другой CRM, копия пачки уходит туда же, и чаты живут в обеих системах
      if (fwd && !b.test) {
        fetch(fwd, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: rawBody, signal: AbortSignal.timeout(8000) })
          .catch(e => log(`Не удалось продублировать входящие на второй адрес: ${e.message}`, null, null, 'Wazzup'));
      }
      const inbound = legacy.concat(modern).filter(m => !(m.status && m.status !== 'inbound') && !m.isEcho).length;
      if (inbound) {
        const total = Number(db.prepare("SELECT value FROM settings WHERE key='WZ_HOOK_MSG_TOTAL'").get()?.value || 0) + inbound;
        wzHookMark('WZ_HOOK_MSG_TOTAL', String(total));
        log(`Wazzup: получено сообщений: ${inbound}`, null, null, 'Wazzup');
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
      const chIn = String(b.channel || '').trim().toLowerCase();
      const channel = (WZ_ALL.includes(chIn) || chIn === 'email') ? chIn : 'site';
      const name = String((msg.from && msg.from.first_name) || b.name || '').slice(0, 120);
      await upsertIncoming({ channel, chatType: b.chatType || channel, phone: String(b.phone || (msg.chat && msg.chat.id) || ''), chatId: String(b.chatId || ''), name, body: String(msg.text || b.body || ''), external_id: msg.message_id ? `${channel}-${msg.message_id}` : (b.external_id || null) });
      return json(res, 200, { received: true });
    }
    if (p === '/webhooks/email' && req.method === 'POST') {
      const secret = getSetting('EMAIL_WEBHOOK_SECRET');
      if (secret && u.searchParams.get('secret') !== secret && req.headers['x-webhook-secret'] !== secret) return json(res, 403, { error: 'bad secret' });
      const b = await readBody(req);
      await upsertIncoming({ channel: 'email', chatType: 'email', email: String(b.from || b.email || '').trim(), name: b.name || String(b.from || '').split('@')[0] || 'E-mail', subject: b.subject || '', body: b.text || b.body || b.html || '', external_id: b.message_id || b.external_id || null, direction: 'in' });
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
      // администратору видно, когда сотрудник заходил последний раз
      try { db.prepare("UPDATE users SET last_login=datetime('now') WHERE id=?").run(user.id); } catch {}
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
      sources: ['manual', 'import', 'site', 'email', ...WZ_ALL, ...WZ_ALL.map(t => 'wazzup-' + t)],
      customFields: getCustomFields(),
      features: { email: !!getSetting('SMTP_HOST'), wazzup: !!getSetting('WAZZUP_API_KEY') },
      salesTarget: Number(getSetting('SALES_TARGET', '0')) || 0,
      // правила распределения нужны интерфейсу: по ним считается подсказка
      // «кому достанется новый контакт» в форме
      autoAssign: getSetting('AUTO_ASSIGN', '0') === '1',
      autoDeal: getSetting('AUTO_DEAL', '1') === '1',
      activeUsers: db.prepare('SELECT COUNT(*) n FROM users WHERE active=1').get().n,
    });
    if (user && p.startsWith('/api/') && user.role === 'viewer' && req.method !== 'GET' && p !== '/api/me/password') return json(res, 403, { error: 'Роль «Наблюдатель» — только просмотр' });
    // настройки, команда, воронки, шаблоны, автоматизации, ключи и обслуживание — только администратор
    if (user && user.role !== 'admin' && req.method !== 'GET' && ADMIN_ONLY.some(re => re.test(p))) {
      const hint = ADMIN_ONLY_HINT.find(([re]) => re.test(p));
      return json(res, 403, { error: hint ? hint[1] : 'Это может менять только администратор (роль в Настройки → Команда)' });
    }

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
      const myTasksToday = db.prepare("SELECT COUNT(*) n FROM tasks WHERE done=0 AND due LIKE ? AND (responsible_id=? OR (responsible_id IS NULL AND ? IS NULL))").get(today + '%', myId, myId)?.n || 0;
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
        unread: db.prepare('SELECT COUNT(*) n FROM conversations cv WHERE EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=cv.id AND m.direction=\'in\' AND m.id > COALESCE((SELECT rm.last_msg_id FROM read_marks rm WHERE rm.conversation_id=cv.id AND rm.user_id=?),0))').get(user.id).n,
        tasksOpen: db.prepare('SELECT COUNT(*) n FROM tasks WHERE done=0').get().n,
        tasksToday,
        tasksOverdue,
        myTasksOpen,
        myTasksOverdue,
        myTasksToday,
        conversion: (() => { const w = cntWhere("stage='won'"), l = cntWhere("stage='lost'"); return w + l ? Math.round(w / (w + l) * 100) : 0 })(),
        monthRevenue: sumWhere(`stage='won' AND ${DEAL_MONTH_SQL}=substr(datetime('now','localtime'),1,7)`),
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
      const monthRow = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM deals WHERE stage='won' AND ${DEAL_MONTH_SQL}=?`).get(month);
      const target = Number(getSetting('SALES_TARGET', '0')) || 0;
      const plan = { target, fact: monthRow.s, month, deals: monthRow.n, percent: target ? Math.round(monthRow.s / target * 100) : null };
      const forecast = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM deals WHERE stage NOT IN ('won','lost')").get().s;
      // выручка по месяцам: считаем месяц закрытия, а не месяц создания сделки
      const byMonth = db.prepare(`SELECT ${DEAL_MONTH_SQL} ym,
          COUNT(*) n, COALESCE(SUM(amount),0) s
        FROM deals WHERE stage='won' AND ${DEAL_MONTH_SQL} <> ''
        GROUP BY ym ORDER BY ym DESC LIMIT 6`).all().reverse();
      return json(res, 200, {
        byMonth,
        plan,
        conversion: wonCount + lostCount ? Math.round(wonCount / (wonCount + lostCount) * 100) : 0,
        avgCheck: wonCount ? Math.round(wonSum / wonCount) : 0,
        forecast,
        bySource: by('SELECT c.source name, COUNT(*) n, COALESCE(SUM(d.amount),0) s FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id GROUP BY c.source'),
        byManager: by('SELECT COALESCE(u.name, NULLIF(d.responsible,\'\'), \'—\') name, COUNT(*) n, COALESCE(SUM(d.amount),0) s FROM deals d LEFT JOIN users u ON u.id=d.responsible_id GROUP BY 1'),
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
      if (raw.length < 2) return json(res, 200, { contacts: [], deals: [], companies: [], tasks: [], products: [] });
      const needle = raw.toLowerCase();
      // телефон ищется и слитно: «9991234567» находит «+7 999 123-45-67»
      const needleDigits = digits(raw);
      const hit = (...vals) => vals.some(v => String(v ?? '').toLowerCase().includes(needle)
        || (needleDigits.length >= 3 && digits(v).includes(needleDigits)));
      const contacts = db.prepare('SELECT id,name,phone,email,company FROM contacts ORDER BY id DESC LIMIT 2000').all().filter(c => hit(c.name, c.phone, c.email, c.company)).slice(0, 8);
      const deals = db.prepare('SELECT id,title,amount FROM deals ORDER BY id DESC LIMIT 2000').all().filter(d => hit(d.title, d.amount)).slice(0, 8);
      const companies = db.prepare('SELECT id,name,inn FROM companies ORDER BY id DESC LIMIT 1000').all().filter(c => hit(c.name, c.inn)).slice(0, 5);
      const tasks = db.prepare('SELECT id,title,due,done,type FROM tasks ORDER BY id DESC LIMIT 2000').all().filter(t => hit(t.title)).slice(0, 6);
      // каталог он же прайс-лист: позицию можно найти из любого раздела
      const products = db.prepare('SELECT id,name,sku,price,unit,active FROM products ORDER BY id DESC LIMIT 1000').all().filter(pr => hit(pr.name, pr.sku)).slice(0, 5);
      return json(res, 200, { contacts, deals, companies, tasks, products });
    }
    if (p === '/api/export/json' || p === '/api/backup') {
      // полная выгрузка содержит пользователей и настройки — только администратор
      if (!requireAdmin(user, res)) return;
      const tables = ['users', 'companies', 'contacts', 'pipelines', 'stages', 'deals', 'tasks', 'notes', 'products', 'templates', 'automations', 'conversations', 'messages', 'channels', 'competitors', 'competitor_checks', 'competitor_reports', 'reviews', 'price_rows']; const out = {}; tables.forEach(t => out[t] = db.prepare(`SELECT * FROM ${t}`).all()); res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename=karkas-backup.json' }); return res.end(JSON.stringify(out, null, 2)); }

    // Очередь отложенных действий. Без неё правило с выдержкой выглядит как
    // «настроил и забыл»: не видно, что именно сработает и можно ли отменить.
    if (p === '/api/automation-queue' && req.method === 'GET') {
      const rows = db.prepare(`SELECT q.id, q.automation_id, q.deal_id, q.contact_id, q.run_at, q.created_at,
          a.name rule_name, a.action_type, a.action_value,
          d.title deal_title, c.name contact_name
        FROM automation_queue q
        LEFT JOIN automations a ON a.id = q.automation_id
        LEFT JOIN deals d ON d.id = q.deal_id
        LEFT JOIN contacts c ON c.id = q.contact_id
        ORDER BY q.run_at, q.id`).all();
      return json(res, 200, rows.map(q => ({
        id: q.id, run_at: q.run_at, run_at_human: ruDate(q.run_at), created_at: q.created_at,
        rule: q.rule_name || 'Правило удалено', orphan: !q.rule_name,
        action_type: q.action_type || '', action_value: q.action_value || '',
        deal_id: q.deal_id, deal_title: q.deal_title || '', contact_id: q.contact_id, contact_name: q.contact_name || '',
      })));
    }
    const mQueue = p.match(/^\/api\/automation-queue\/(\d+)$/);
    if (mQueue && req.method === 'DELETE') {
      if (!requireAdmin(user, res)) return;
      const q = db.prepare('SELECT * FROM automation_queue WHERE id=?').get(Number(mQueue[1]));
      if (!q) return json(res, 404, { error: 'Запланированного действия нет — возможно, оно уже выполнилось' });
      db.prepare('DELETE FROM automation_queue WHERE id=?').run(q.id);
      const rule = db.prepare('SELECT name FROM automations WHERE id=?').get(q.automation_id);
      log(`Запланированное действие отменено: «${rule?.name || 'правило удалено'}»`, q.deal_id ? 'deals' : 'contacts', q.deal_id || q.contact_id || null, user.name);
      broadcast('change', { table: 'automations' });
      return json(res, 200, { cancelled: q.id });
    }

    // ===== generic CRUD =====
    const CRUD = { contacts: ['name', 'phone', 'email', 'company', 'company_id', 'position', 'source', 'tags', 'notes', 'responsible_id', 'custom'], companies: ['name', 'inn', 'phone', 'email', 'site', 'notes'], tasks: ['title', 'type', 'due', 'priority', 'done', 'deal_id', 'contact_id', 'responsible_id', 'result', 'repeat'], deals: ['title', 'amount', 'stage', 'pipeline_id', 'contact_id', 'company_id', 'responsible', 'responsible_id', 'priority', 'loss_reason', 'deadline', 'custom'], products: ['name', 'sku', 'price', 'unit', 'active', 'note'], templates: ['name', 'body'], automations: ['name', 'trigger_type', 'trigger_value', 'action_type', 'action_value', 'active', 'delay_days'], notes: ['entity_type', 'entity_id', 'body', 'author'] };
    const mCrud = p.match(/^\/api\/(contacts|companies|tasks|products|templates|automations|notes)(?:\/(\d+))?$/);
    if (mCrud) { const [, table, id] = mCrud; const fields = CRUD[table];
      if (table === 'templates') {
        // шаблоны личные: каждый видит и правит только свои — без вкладок и переключателей
        if (req.method === 'GET' && !id) return json(res, 200, db.prepare('SELECT * FROM templates WHERE user_id=? ORDER BY id DESC').all(user.id));
        if (req.method === 'POST') {
          const b = await readBody(req);
          // канал у шаблона больше не спрашивается: куда отправить, выбирается в чате
          const r = db.prepare("INSERT INTO templates(name,body,channel,user_id) VALUES(?,?,'any',?)")
            .run(String(b.name || '').slice(0, 80) || 'Шаблон', String(b.body || '').slice(0, 20000), user.id);
          log('Создан шаблон', 'templates', Number(r.lastInsertRowid), user.name);
          broadcast('change', { table });
          return json(res, 201, db.prepare('SELECT * FROM templates WHERE id=?').get(r.lastInsertRowid));
        }
        if (id) {
          const tpl = db.prepare('SELECT * FROM templates WHERE id=?').get(id);
          if (!tpl) return json(res, 404, { error: 'Шаблон не найден' });
          if (tpl.user_id !== user.id) return json(res, 403, { error: 'Это чужой шаблон — можно менять только свои' });
          if (req.method === 'PATCH') { const b = await readBody(req); const ks = Object.keys(b).filter(k => ['name', 'body'].includes(k)); if (ks.length) db.prepare(`UPDATE templates SET ${ks.map(k => k + '=?')} WHERE id=?`).run(...ks.map(k => k === 'name' ? String(b[k]).slice(0, 80) : String(b[k]).slice(0, 20000)), id); broadcast('change', { table }); return json(res, 200, db.prepare('SELECT * FROM templates WHERE id=?').get(id)); }
          if (req.method === 'DELETE') { db.prepare('DELETE FROM templates WHERE id=?').run(id); log('Шаблон удалён', 'templates', Number(id), user.name); broadcast('change', { table }); return json(res, 200, { deleted: true }); }
        }
        return json(res, 405, { error: 'Метод не поддерживается' });
      }
      // правила и каталог меняет администратор. Каталог — это прайс-лист компании:
      // цены в нём не должен переписывать любой менеджер. Позицию, которой в каталоге
      // нет, менеджер добавляет прямо в сделку — на прайс это не влияет.
      if (req.method !== 'GET' && table === 'automations' && !requireAdmin(user, res)) return;
      if (req.method !== 'GET' && table === 'products' && user.role !== 'admin')
        return json(res, 403, { error: 'Каталог и прайс-лист меняет администратор. Позицию, которой нет в каталоге, можно добавить прямо в сделку.' });
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
        if (b.note !== undefined) b.note = String(b.note ?? '').trim().slice(0, 300);
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
        if (table === 'automations') { const err = validateAutomation(b); if (err) return json(res, 400, { error: err }); }
        if (table === 'notes') {
          const et = String(b.entity_type || '');
          if (!['contacts', 'deals', 'companies'].includes(et)) return json(res, 400, { error: 'Заметку можно привязать только к клиенту, сделке или компании' });
          if (!db.prepare(`SELECT 1 x FROM ${et} WHERE id=?`).get(Number(b.entity_id))) return json(res, 400, { error: 'Карточка для заметки не найдена — обновите страницу' });
        }
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
        // задачу поставили коллеге — он сразу увидит всплывающее уведомление
        if (table === 'tasks' && b.responsible_id && Number(b.responsible_id) !== Number(user.id)) {
          broadcastTo(b.responsible_id, 'notify', { type: 'task_assigned', id: Number(r.lastInsertRowid), title: String(b.title || 'Задача'), due: b.due || '' });
        }
        broadcast('change', { table });
        return json(res, 201, db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(r.lastInsertRowid));
      }
      if (req.method === 'PATCH' && id) {
        const b = await readBody(req);
        if (table === 'products') { const err = normalizeProduct(b); if (err) return json(res, 400, { error: err }); }
        if (table === 'automations') {
          const cur = db.prepare('SELECT * FROM automations WHERE id=?').get(id);
          if (!cur) return json(res, 404, { error: 'Правило не найдено — обновите страницу' });
          const err = validateAutomation(b, cur); if (err) return json(res, 400, { error: err });
        }
        if (table === 'tasks' && b.due !== undefined) {
          const norm = b.due ? normalizeDue(String(b.due)) : '';
          if (b.due && !norm) return json(res, 400, { error: 'Не поняли срок. Укажите дату как 25.10.2026 14:00 или «завтра 10:00».' });
          b.due = norm;
        }
        const ks = Object.keys(b).filter(k => fields.includes(k));
        if (table === 'contacts' && b.custom !== undefined) { const err = missingRequiredCustom('contacts', b.custom); if (err) return json(res, 400, { error: err }); }
        if (table === 'contacts' && b.name !== undefined && !String(b.name || '').trim()) return json(res, 400, { error: 'Имя клиента не может быть пустым' });
        // при частичном обновлении проверяем ссылки так же, как при создании
        const patchFk = { tasks: [['deal_id', 'deals'], ['contact_id', 'contacts'], ['responsible_id', 'users']], contacts: [['company_id', 'companies'], ['responsible_id', 'users']] }[table] || [];
        for (const [field, target] of patchFk) {
          if (b[field] && !db.prepare(`SELECT 1 x FROM ${target} WHERE id=?`).get(b[field])) return json(res, 400, { error: 'Связанная запись не найдена — обновите страницу и выберите из списка' });
        }
        if (table === 'contacts' && b.phone !== undefined && !ks.includes('phone_norm')) { ks.push('phone_norm'); b.phone_norm = digits(b.phone) || null; }
        const prevTask = table === 'tasks' ? db.prepare('SELECT title,responsible_id,due FROM tasks WHERE id=?').get(id) : null;
        const prevContact = table === 'contacts' ? db.prepare('SELECT name,responsible_id FROM contacts WHERE id=?').get(id) : null;
        if (ks.length) db.prepare(`UPDATE ${table} SET ${ks.map(k => k + '=?')} WHERE id=?`).run(...ks.map(k => b[k]), id);
        // задачу переназначили — новый исполнитель получает уведомление сразу
        if (prevTask && b.responsible_id !== undefined && b.responsible_id
          && Number(b.responsible_id) !== Number(user.id) && Number(b.responsible_id) !== Number(prevTask.responsible_id)) {
          broadcastTo(b.responsible_id, 'notify', { type: 'task_assigned', id: Number(id), title: String(prevTask.title || 'Задача'), due: b.due ?? prevTask.due ?? '' });
        }
        // контакт передали коллеге — он тоже узнаёт сразу
        if (prevContact && b.responsible_id !== undefined && b.responsible_id
          && Number(b.responsible_id) !== Number(user.id) && Number(b.responsible_id) !== Number(prevContact.responsible_id)) {
          broadcastTo(b.responsible_id, 'notify', { type: 'contact_assigned', id: Number(id), title: String(prevContact.name || 'Клиент') });
        }
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
        // имя ответственного дублируется в старом поле responsible: аналитика и поиск
        // читают его, поэтому не позволяем ему разойтись с responsible_id
        if (b.responsible_id !== undefined) {
          b.responsible_id = b.responsible_id ? Number(b.responsible_id) : null;
          b.responsible = b.responsible_id ? (db.prepare('SELECT name FROM users WHERE id=?').get(b.responsible_id)?.name || null) : null;
        }
        { const err = missingRequiredCustom('deals', b.custom); if (err) return json(res, 400, { error: err }); }
        // сделку можно завести сразу закрытой («продали давно»). Дата закрытия нужна
        // аналитике: без неё выручка привязалась бы к дате создания, а не к продаже.
        // Дату из запроса не затираем — иначе завести закрытую сделку задним числом
        // было бы нельзя, хотя поле для неё разрешено.
        if (['won', 'lost'].includes(stage)) b.closed_at = normalizeStamp(b.closed_at) || new Date().toISOString().slice(0, 19).replace('T', ' ');
        else delete b.closed_at; // открытая сделка дату закрытия не хранит
        const fields = ['title', 'amount', 'stage', 'pipeline_id', 'contact_id', 'company_id', 'responsible', 'responsible_id', 'priority', 'loss_reason', 'deadline', 'closed_at', 'custom']; const ks = fields.filter(f => b[f] !== undefined); const r = db.prepare(`INSERT INTO deals(${ks}) VALUES(${ks.map(() => '?')})`).run(...ks.map(k => b[k])); log(`Сделка создана: ${b.title}`, 'deals', Number(r.lastInsertRowid), user.name); runAutomations('deal_created', { deal_id: Number(r.lastInsertRowid), contact_id: b.contact_id }); broadcast('change', { table: 'deals' }); return json(res, 201, db.prepare('SELECT * FROM deals WHERE id=?').get(r.lastInsertRowid)); }
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

    // отправить клиенту КП или счёт письмом
    const mSendDoc = p.match(/^\/api\/deals\/(\d+)\/send-doc$/);
    if (mSendDoc && req.method === 'POST') {
      const id = Number(mSendDoc[1]);
      const deal = db.prepare('SELECT d.*,c.name contact_name,c.email contact_email FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id WHERE d.id=?').get(id);
      if (!deal) return json(res, 404, { error: 'Сделка не найдена' });
      const b = await readBody(req);
      const doc = b.doc === 'invoice' ? 'invoice' : 'quote';
      const to = String(b.to || deal.contact_email || '').trim();
      if (!to.includes('@')) return json(res, 400, { error: 'У клиента не указан e-mail — добавьте его в карточке клиента' });
      if (!getSetting('SMTP_HOST')) return json(res, 400, { error: 'Почта не настроена: Настройки → Интеграции → Почта (SMTP)' });
      const items = db.prepare('SELECT * FROM deal_products WHERE deal_id=? ORDER BY id').all(id);
      if (!items.length) return json(res, 400, { error: doc === 'invoice' ? 'В сделке нет позиций: не на что выставить счёт. Добавьте товары или услуги.' : 'В сделке нет позиций: КП получилось бы пустым. Добавьте товары или услуги.' });
      const base = publicBase(req);
      if (!base) return json(res, 400, { error: 'Не задан внешний адрес CRM: Настройки → Данные и компания → «Адрес для входа»' });
      const company = companyRequisites();
      const link = `${base}/d/${docToken(id, doc)}`;
      const kind = doc === 'invoice' ? 'Счёт' : 'Коммерческое предложение';
      const sum = items.reduce((a, x) => a + Number(x.price) * Number(x.qty), 0);
      const text = `${String(b.body || '').trim() || `${deal.contact_name || 'Добрый день'}!`}

${kind} по заявке «${deal.title}» на сумму ${money(sum, company.currency)} — по ссылке:
${link}

Ссылка действует ${DOC_LINK_DAYS} дней. Откройте её в браузере и, если нужен файл, сохраните как PDF: «Печать» → «Сохранить как PDF».

${company.name || ''}${company.phone ? ', ' + company.phone : ''}
${user?.name || ''}`.trim();
      try {
        await sendMail({
          host: getSetting('SMTP_HOST'), port: Number(getSetting('SMTP_PORT', '587')),
          secure: getSetting('SMTP_SECURE') === '1' ? true : getSetting('SMTP_SECURE') === '0' ? false : undefined,
          user: getSetting('SMTP_USER') || undefined, pass: getSetting('SMTP_PASS') || undefined,
          from: getSetting('MAIL_FROM') || getSetting('SMTP_USER') || undefined, fromName: getSetting('MAIL_FROM_NAME') || company.name || undefined,
          to, toName: deal.contact_name || undefined, subject: String(b.subject || '').trim() || `${kind} от ${company.name || 'нашей компании'}`, text,
        });
      } catch (e) {
        return json(res, 502, { error: 'Письмо не ушло: ' + e.message });
      }
      log(`Клиенту отправлен ${kind.toLowerCase()} по сделке «${deal.title}» на ${to}`, 'deals', id, user.name);
      // письмо видно и в переписке клиента, если она уже есть
      const conv = deal.contact_id ? db.prepare('SELECT id FROM conversations WHERE contact_id=?').get(deal.contact_id) : null;
      if (conv) {
        db.prepare("INSERT INTO messages(conversation_id,channel,direction,body,subject,status,author) VALUES(?,?,?,?,?,'sent',?)").run(conv.id, 'email', 'out', text, kind, user.name);
        db.prepare("UPDATE conversations SET last_at=datetime('now') WHERE id=?").run(conv.id);
        broadcast('message', { conversation_id: conv.id });
      }
      return json(res, 200, { ok: true, to, doc, link, expiresDays: DOC_LINK_DAYS });
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
        // в историю берём и события клиента: обращение, назначение, переписка
        // относятся к той же продаже, а в отдельной вкладке их никто не найдёт
        const history = db.prepare(`SELECT * FROM (
            SELECT * FROM activities WHERE entity_type='deals' AND entity_id=?
            UNION ALL SELECT * FROM activities WHERE entity_type='contacts' AND entity_id=?
          ) ORDER BY id DESC LIMIT 40`).all(id, deal.contact_id || 0);
        return json(res, 200, { deal, notes: db.prepare("SELECT * FROM notes WHERE entity_type='deals' AND entity_id=? ORDER BY id DESC").all(id), tasks: db.prepare('SELECT * FROM tasks WHERE deal_id=? ORDER BY id DESC').all(id), products, history, conversation: conv, messages });
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
        if (b.responsible_id !== undefined) {
          b.responsible_id = b.responsible_id ? Number(b.responsible_id) : null;
          b.responsible = b.responsible_id ? (db.prepare('SELECT name FROM users WHERE id=?').get(b.responsible_id)?.name || null) : null;
        }
        if (b.custom !== undefined) { const err = missingRequiredCustom('deals', b.custom); if (err) return json(res, 400, { error: err }); }
        const fields = ['title', 'amount', 'stage', 'pipeline_id', 'contact_id', 'company_id', 'responsible', 'responsible_id', 'priority', 'loss_reason', 'deadline', 'custom']; const ks = Object.keys(b).filter(k => fields.includes(k));
        // закрытая сделка, которую вернули в работу, не должна хранить дату закрытия:
        // иначе аналитика по месяцам считает её повторно закрытой
        const closedSetter = b.stage !== undefined ? (['won', 'lost'].includes(b.stage) ? ",closed_at=datetime('now')" : ',closed_at=NULL') : '';
        if (ks.length) db.prepare(`UPDATE deals SET ${ks.map(k => k + '=?')},updated_at=datetime('now')${closedSetter} WHERE id=?`).run(...ks.map(k => b[k]), id);
        // сделку передали коллеге — он сразу увидит уведомление, а не узнает случайно
        const newResp = b.responsible_id !== undefined ? (b.responsible_id ? Number(b.responsible_id) : null) : old.responsible_id;
        if (newResp && newResp !== Number(old.responsible_id) && newResp !== Number(user.id)) {
          broadcastTo(newResp, 'notify', { type: 'deal_assigned', id: Number(id), title: String(b.title || old.title || 'Сделка') });
        }
        // История карточки. Без записи о смене суммы, ответственного или срока
        // вкладка «История» остаётся пустой, и по сделке не видно, кто и что
        // менял — а это первое, что спрашивают при разборе потерянного клиента.
        {
          // пробел обычный, не неразрывный: текст истории сравнивают и ищут
          const money = n => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
          const day = v => { const t = String(v || '').trim(); return t ? t.slice(0, 10).split('-').reverse().join('.') : 'не задан'; };
          const who = uid => uid ? (db.prepare('SELECT name FROM users WHERE id=?').get(Number(uid))?.name || '—') : 'не назначен';
          const what = (tbl, eid) => eid ? (db.prepare(`SELECT name FROM ${tbl} WHERE id=?`).get(Number(eid))?.name || '—') : 'не задано';
          const title = b.title !== undefined ? b.title : old.title;
          const changes = [];
          if (b.title !== undefined && String(b.title) !== String(old.title)) changes.push(`название: «${old.title}» → «${b.title}»`);
          if (b.amount !== undefined && Number(b.amount || 0) !== Number(old.amount || 0)) changes.push(`сумма: ${money(old.amount)} → ${money(b.amount)}`);
          if (b.responsible_id !== undefined && Number(b.responsible_id || 0) !== Number(old.responsible_id || 0)) changes.push(`ответственный: ${who(old.responsible_id)} → ${who(b.responsible_id)}`);
          if (b.contact_id !== undefined && Number(b.contact_id || 0) !== Number(old.contact_id || 0)) changes.push(`клиент: ${what('contacts', old.contact_id)} → ${what('contacts', b.contact_id)}`);
          if (b.company_id !== undefined && Number(b.company_id || 0) !== Number(old.company_id || 0)) changes.push(`компания: ${what('companies', old.company_id)} → ${what('companies', b.company_id)}`);
          if (b.pipeline_id !== undefined && Number(b.pipeline_id || 0) !== Number(old.pipeline_id || 0)) changes.push(`воронка: ${what('pipelines', old.pipeline_id)} → ${what('pipelines', b.pipeline_id)}`);
          if (b.deadline !== undefined && String(b.deadline || '') !== String(old.deadline || '')) changes.push(`срок: ${day(old.deadline)} → ${day(b.deadline)}`);
          if (b.loss_reason !== undefined && String(b.loss_reason || '').trim() !== String(old.loss_reason || '').trim()) changes.push(`причина проигрыша: ${String(b.loss_reason || '').trim() || 'не указана'}`);
          for (const ch of changes) log(`Сделка «${title}»: ${ch}`, 'deals', Number(id), user.name);
        }
        if (b.stage && old && b.stage !== old.stage) { const s = db.prepare('SELECT name FROM stages WHERE code=?').get(b.stage); log(`Сделка «${old.title}» → этап «${s?.name || b.stage}»`, 'deals', Number(id), user.name); await runAutomations('stage_changed', { deal_id: Number(id), contact_id: old.contact_id, stage: b.stage, actor_id: user.id }); } broadcast('change', { table: 'deals' }); return json(res, 200, db.prepare('SELECT * FROM deals WHERE id=?').get(id)); }
      if (req.method === 'DELETE') {
        const d = db.prepare('SELECT * FROM deals WHERE id=?').get(id);
        if (!d) return json(res, 404, { error: 'Сделка не найдена' });
        db.exec('BEGIN IMMEDIATE');
        try {
          // задачи не удаляем: они остаются в списке дел и у клиента, просто без привязки к сделке
          db.prepare('UPDATE tasks SET deal_id=NULL WHERE deal_id=?').run(id);
          db.prepare('DELETE FROM deal_products WHERE deal_id=?').run(id);
          db.prepare("DELETE FROM notes WHERE entity_type='deals' AND entity_id=?").run(id);
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
      // Список нужен всем для выбора ответственного, но e-mail сотрудников —
      // только администратору: остальным достаточно имени и роли.
      if (req.method === 'GET') return json(res, 200, user.role === 'admin'
        ? db.prepare('SELECT id,name,email,role,active,last_login,must_change_password FROM users ORDER BY id').all()
        : db.prepare('SELECT id,name,role,active FROM users ORDER BY id').all());
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
      if (req.method === 'GET') return json(res, 200, { dir: '/data/backups', keepDays: Number(getSetting('BACKUP_KEEP_DAYS', '7')) || 0, s3: s3status(), files: existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.db')).sort().reverse().map(f => ({ name: f, sizeBytes: statSync(join(dir, f)).size, created_at: statSync(join(dir, f)).mtime.toISOString() })) : [] });
      if (req.method === 'POST') {
        if (!requireAdmin(user, res)) return;
        const file = makeBackup(true);
        const b = await readBody(req).catch(() => ({}));
        const wantS3 = b.s3 === undefined ? s3cfg().auto : b.s3 !== false;
        const s3 = (file && wantS3) ? await uploadBackupToS3(file) : null;
        return json(res, 200, { created: file, s3 });
      }
    }
    // выгрузить последнюю копию в хранилище, не создавая новую
    if (p === '/api/backups/s3' && req.method === 'POST') {
      if (!requireAdmin(user, res)) return;
      const b = await readBody(req).catch(() => ({}));
      const dir = join(DATA_DIR, 'backups');
      const name = String(b.name || '') || (existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.db')).sort().pop() : '');
      if (!name) return json(res, 400, { error: 'Резервных копий пока нет — сначала создайте копию' });
      const c = s3cfg();
      if (!s3ready(c)) return json(res, 400, { error: 'Хранилище не настроено. Заполните адрес, ведро и ключи доступа: ' + (s3missing(c).join(', ') || '—') });
      const out = await uploadBackupToS3(name);
      return out.ok ? json(res, 200, out) : json(res, 502, out);
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
      const safety = `before-restore-${localStamp()}.db`;
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
    if (p === '/api/conversations' && req.method === 'GET') return json(res, 200, db.prepare(`SELECT cv.*,c.phone,c.email,c.responsible_id AS contact_responsible_id,
      (SELECT body FROM messages WHERE conversation_id=cv.id ORDER BY id DESC LIMIT 1) last_body,
      (SELECT d.amount FROM deals d WHERE d.contact_id=cv.contact_id AND d.stage NOT IN ('won','lost') ORDER BY d.id DESC LIMIT 1) deal_amount,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=cv.id AND m.direction='in' AND m.id > COALESCE((SELECT rm.last_msg_id FROM read_marks rm WHERE rm.conversation_id=cv.id AND rm.user_id=?),0)) unread
      FROM conversations cv LEFT JOIN contacts c ON c.id=cv.contact_id ORDER BY cv.last_at DESC, cv.id DESC`).all(user.id).map(r => ({ ...r, unread: r.unread || 0 })));
    // Начать переписку первым. Беседа появлялась только из входящего сообщения,
    // поэтому менеджер не мог написать клиенту, который ещё не обращался.
    if (p === '/api/conversations' && req.method === 'POST') {
      const b = await readBody(req);
      const cid = Number(b.contact_id);
      if (!cid) return json(res, 400, { error: 'Не указан клиент' });
      const contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(cid);
      if (!contact) return json(res, 404, { error: 'Клиент не найден' });
      const chatType = normChatType(String(b.chat_type || 'whatsapp').trim().toLowerCase());
      if (!chatType) return json(res, 400, { error: `Мессенджер «${b.chat_type}» не поддерживается. Доступны: ${WZ_CHAT_TYPES.join(', ')}` });
      // у беседы один клиент (UNIQUE по contact_id): вторая ветка разделила бы историю
      const exist = db.prepare('SELECT * FROM conversations WHERE contact_id=?').get(cid);
      if (exist) return json(res, 200, exist);
      // Адресат: в WhatsApp и Viber это номер цифрами, в остальных — имя чата,
      // которое даёт вендор. Без адресата сообщение не ушло бы, и беседа осталась
      // бы пустой записью, поэтому спрашиваем его сразу.
      let chatId = String(b.chat_id || '').trim().slice(0, 120);
      const byPhone = ['whatsapp', 'viber'].includes(chatType);
      if (byPhone) chatId = digits(chatId || contact.phone || '');
      if (!chatId) return json(res, 400, { error: byPhone ? 'У клиента не заполнен телефон — без номера отправить в ' + chatType + ' нельзя' : `Укажите адрес получателя в ${chatType}: номер или имя аккаунта. Его видно в первом сообщении клиента.` });
      const r = db.prepare("INSERT INTO conversations(contact_id,title,channels,channel_id,external_chat_id,chat_type,assigned_id,last_at) VALUES(?,?,?,?,?,?,?,datetime('now'))")
        .run(cid, contact.name || 'Клиент', chatType, '', chatId, chatType, user?.id || null);
      const conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(r.lastInsertRowid);
      log(`Начата переписка с «${conv.title}» (${chatType})`, 'contacts', cid, user?.name || '');
      return json(res, 201, conv);
    }
    const mConv = p.match(/^\/api\/conversations\/(\d+)\/messages$/);
    if (mConv) { const id = mConv[1];
      if (req.method === 'GET') {
        const rows = db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY id').all(id);
        // прочитанность личная: коллега, открывший чат раньше, не стирает метку у ответственного
        const lastId = rows.length ? rows[rows.length - 1].id : 0;
        if (user?.id) db.prepare("INSERT INTO read_marks(user_id,conversation_id,last_msg_id,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(user_id,conversation_id) DO UPDATE SET last_msg_id=MAX(last_msg_id,excluded.last_msg_id),updated_at=datetime('now')").run(user.id, Number(id), lastId);
        return json(res, 200, rows);
      }
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
          // без подключённого Wazzup сообщение сохраняется только в CRM
          if (String(e.message) === 'WAZZUP_NOT_CONFIGURED') { status = 'local'; send = { delivered: false, mode: 'local-only', hint: 'Wazzup не подключён — сообщение сохранено в CRM. Настройки → Интеграции: вставьте API-ключ Wazzup, и ответ уйдёт клиенту.' }; }
          else { status = 'error'; send = { delivered: false, mode: 'error: ' + e.message }; }
        }
        const body = String(b.body || '').trim() || (file ? '[вложение]' : '');
        const insertOut = ext => db.prepare('INSERT INTO messages(conversation_id,channel,direction,body,content_uri,content_name,content_type,status,external_id,author,channel_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, wantChannel, 'out', body, file?.contentUri || null, b.contentName ? safeFileName(b.contentName) : null, b.contentType || null, status, ext, user.name, send.channelId || conv.channel_id || null);
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
      const rows = db.prepare(`SELECT d.title 'Название', d.amount 'Сумма', COALESCE(c.name,'') 'Клиент', COALESCE(c.phone,'') 'Телефон', d.stage 'Этап', d.priority 'Приоритет', COALESCE(d.deadline,'') 'Срок', COALESCE(d.loss_reason,'') 'Причина отказа', datetime(d.created_at,'localtime') 'Создана' FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id ORDER BY d.id DESC`).all()
        // даты в таблице для человека: Excel с русской локалью понимает 05.11.2026, а ISO — нет
        .map(r => ({ ...r, 'Срок': displayDate(r['Срок']), 'Создана': displayDate(r['Создана']) }));
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
    // Своё название канала. Вендор имени не отдаёт, только номер или юзернейм,
    // а каналов у заказчика бывает по одному на сотрудника.
    const mChLabel = p.match(/^\/api\/channels\/(\d+)$/);
    if (mChLabel && req.method === 'PUT') {
      const b = await readBody(req);
      const label = String(b.label ?? '').trim().slice(0, 60);
      // сотрудника проверяем: привязка к удалённому или неактивному означала бы,
      // что обращения назначаются на того, кто уже не работает
      let uid = null;
      if (b.user_id !== undefined && b.user_id !== '' && b.user_id !== null) {
        uid = Number(b.user_id);
        if (!Number.isInteger(uid) || uid <= 0) return json(res, 400, { error: 'Некорректный сотрудник' });
        const u = db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(uid);
        if (!u) return json(res, 400, { error: 'Сотрудник не найден или уже не работает' });
      }
      const upd = uid === null
        ? db.prepare('UPDATE channels SET label=?,user_id=NULL WHERE id=?').run(label, mChLabel[1])
        : db.prepare('UPDATE channels SET label=?,user_id=? WHERE id=?').run(label, uid, mChLabel[1]);
      if (!upd.changes) return json(res, 404, { error: 'Канал не найден' });
      return json(res, 200, db.prepare('SELECT * FROM channels WHERE id=?').get(mChLabel[1]));
    }
    if (p === '/api/integrations/wazzup/test' && req.method === 'POST') { try { const list = wzChannels(await wazzupFetch('/channels')); return json(res, 200, { ok: true, channels: list }); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
    // Каналом по умолчанию становится рабочий: первым вендор может вернуть
    // отключённый или заблокированный, и ответы молча не уходили бы вовсе.
    if (p === '/api/integrations/wazzup/sync' && req.method === 'POST') { try { const list = wzChannels(await wazzupFetch('/channels')); for (const ch of list) db.prepare('INSERT INTO channels(provider,external_id,name,transport,phone,state,raw) VALUES(?,?,?,?,?,?,?) ON CONFLICT(external_id) DO UPDATE SET name=excluded.name,transport=excluded.transport,phone=excluded.phone,state=excluded.state').run('wazzup', ch.channelId || ch.id, ch.name || ch.plainId || '', ch.transport || ch.type || '', ch.plainId || ch.phone || '', ch.state || '', JSON.stringify(ch));
      const usable = list.find(wzUsable) || list[0]; if (usable && !getSetting('WAZZUP_CHANNEL_ID')) setSetting('WAZZUP_CHANNEL_ID', usable.channelId || usable.id); return json(res, 200, { synced: list.length, channels: db.prepare("SELECT * FROM channels WHERE provider='wazzup'").all() }); } catch (e) { return json(res, 400, { error: e.message }); } }
    // Подписки обязательны: без них вендор не присылает события вовсе. Включаем
    // только те, которые наш обработчик разбирает. Лимит адреса — 200 символов,
    // как у вендора: длинный адрес он отклоняет, незачем отправлять отказной запрос.
    if (p === '/api/integrations/wazzup/webhook' && req.method === 'POST') { const b = await readBody(req); const hookUrl = String(b.url || '').trim(); if (!/^https?:\/\//i.test(hookUrl) || hookUrl.length > 200) return json(res, 400, { error: 'Укажите корректный адрес вебхука: http/https, не длиннее 200 символов' }); try { await wazzupFetch('/webhooks', { method: 'PATCH', body: JSON.stringify({ webhooksUri: hookUrl, subscriptions: { messagesAndStatuses: true, channelsUpdates: true } }) }); setSetting('WAZZUP_WEBHOOK_URL', hookUrl); return json(res, 200, { saved: true }); } catch (e) { return json(res, 400, { error: e.message + ' — можно указать вебхук вручную в кабинете Wazzup' }); } }
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
          s3: s3status(),
          requisites: companyRequisites(),
          advanced: { frame_ancestors: getSetting('FRAME_ANCESTORS'), login_rate_limit: num('LOGIN_RATE_LIMIT', 12) },
          auto_deal: getSetting('AUTO_DEAL', '1'), auto_assign: getSetting('AUTO_ASSIGN', '0'),
          webhook: { secret: getSetting('WEBHOOK_SECRET'), configured: !!getSetting('WEBHOOK_SECRET') },
          wazzup: { api_key: mask(getSetting('WAZZUP_API_KEY')), api_url: getSetting('WAZZUP_API_URL', 'https://api.wazzup24.com/v3'), channel_id: getSetting('WAZZUP_CHANNEL_ID'), webhook_secret: getSetting('WAZZUP_WEBHOOK_SECRET'), configured: !!getSetting('WAZZUP_API_KEY'), hook_last_at: getSetting('WZ_HOOK_LAST_AT') || '', hook_test_at: getSetting('WZ_HOOK_TEST_AT') || '', hook_last_human: wzHookHuman(getSetting('WZ_HOOK_LAST_AT')), hook_test_human: wzHookHuman(getSetting('WZ_HOOK_TEST_AT')), hook_msgs: Number(getSetting('WZ_HOOK_MSG_TOTAL', '0')) || 0, forward_url: getSetting('WAZZUP_FORWARD_URL') || '' }
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
        if (b.WAZZUP_FORWARD_URL !== undefined) {
          const v = String(b.WAZZUP_FORWARD_URL || '').trim();
          if (v && !/^https?:\/\//i.test(v)) return json(res, 400, { error: 'Адрес дублирования должен начинаться с http:// или https://' });
          if (v) {
            let host = '';
            try { host = new URL(v).host; } catch { return json(res, 400, { error: 'Адрес дублирования не читается' }); }
            // петля: дублирование на самих себя превратило бы одну пачку в лавину
            let own = '';
            try { own = new URL(publicBase(req)).host; } catch {}
            if (own && host === own) return json(res, 400, { error: 'Адрес дублирования совпадает с этой CRM — получится петля' });
          }
          if (v) setSetting('WAZZUP_FORWARD_URL', v.slice(0, 255)); else db.prepare("DELETE FROM settings WHERE key='WAZZUP_FORWARD_URL'").run();
        }
        if (clean(b.WAZZUP_API_KEY)) setSetting('WAZZUP_API_KEY', clean(b.WAZZUP_API_KEY));
        for (const k of ['WAZZUP_API_URL', 'WAZZUP_CHANNEL_ID', 'WAZZUP_WEBHOOK_SECRET', 'COMPANY_NAME', 'CURRENCY', 'AUTO_DEAL', 'AUTO_DEAL_STAGE', 'AUTO_ASSIGN', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'MAIL_FROM', 'EMAIL_WEBHOOK_SECRET', 'NOTIFY_WEBHOOK', 'COMPANY_INN', 'COMPANY_KPP', 'COMPANY_OGRN', 'COMPANY_ADDRESS', 'COMPANY_PHONE', 'COMPANY_EMAIL', 'COMPANY_SITE', 'COMPANY_BANK', 'COMPANY_ACCOUNT', 'COMPANY_CORR', 'COMPANY_SIGNER', 'COMPANY_SIGNER_POSITION', 'DOC_PREFIX', 'SMTP_TEST_TO', 'WEBHOOK_SECRET']) if (b[k] !== undefined) setSetting(k, clean(b[k]) ?? String(b[k]).slice(0, 512));
        if (clean(b.SMTP_PASS)) setSetting('SMTP_PASS', clean(b.SMTP_PASS));
        if (b.SALES_TARGET !== undefined) putNum('SALES_TARGET', b.SALES_TARGET, 0, 1e15, 0);
        if (b.BACKUP_KEEP_DAYS !== undefined) putNum('BACKUP_KEEP_DAYS', b.BACKUP_KEEP_DAYS, 0, 3650, 7);
        // хранилище резервных копий: адрес и ключи. Секретный ключ принимаем
        // только если он не пришёл маской — иначе сохранили бы «••••••» вместо ключа
        for (const k of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_REGION', 'S3_PREFIX', 'S3_ACCESS_KEY']) {
          if (b[k] !== undefined && !String(b[k]).includes('•')) setSetting(k, String(b[k] ?? '').trim().slice(0, 255));
        }
        if (b.S3_SECRET_KEY !== undefined && !String(b.S3_SECRET_KEY).includes('•')) setSetting('S3_SECRET_KEY', String(b.S3_SECRET_KEY).trim().slice(0, 255));
        if (b.S3_KEEP !== undefined) putNum('S3_KEEP', b.S3_KEEP, 0, 365, 14);
        if (b.S3_AUTO !== undefined) setSetting('S3_AUTO', String(b.S3_AUTO) === '1' || b.S3_AUTO === true ? '1' : '0');
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
      // после демо-сделок могли остаться заметки и ссылки задач без родителя
      try { cleanupOrphans(db) } catch (e) { console.error('cleanup after demo', e) }
      setSetting('SEED_DONE', '1'); // после очистки примеры не вернутся при перезапуске
      log('Демонстрационные данные удалены (' + removed + ' записей)', null, null, user.name);
      broadcast('change', { table: 'all' });
      return json(res, 200, { removed });
    }
    // ===== массовые действия: выделили записи и применили к ним одно изменение =====
    if (p === '/api/bulk' && req.method === 'POST') {
      const b = await readBody(req);
      const table = String(b.table || ''), ids = [...new Set((b.ids || []).map(Number).filter(Boolean))];
      const fields = CRUD[table];
      if (!fields || !ids.length) return json(res, 400, { error: 'Нечего обрабатывать: укажите таблицу и хотя бы одну запись' });
      if (ids.length > 500) return json(res, 400, { error: 'За один раз можно изменить не больше 500 записей' });
      if ((b.action === 'delete' && (table === 'products' || table === 'automations')) && !requireAdmin(user, res)) return;
      if (b.action === 'delete' && table === 'templates') {
        // шаблоны личные: массово удаляем только свои, чужие не трогаем
        const st = db.prepare('DELETE FROM templates WHERE id=? AND user_id=?');
        let done = 0; for (const id of ids) done += st.run(id, user.id).changes;
        broadcast('change', { table });
        return json(res, 200, { done, count: done });
      }
      let applied = 0;
      if (b.action === 'delete') {
        const st = db.prepare(`DELETE FROM ${table} WHERE id=?`);
        db.exec('BEGIN IMMEDIATE');
        try {
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
            if (table === 'deals') {
              db.prepare('UPDATE tasks SET deal_id=NULL WHERE deal_id=?').run(id);
              db.prepare('DELETE FROM deal_products WHERE deal_id=?').run(id);
              db.prepare("DELETE FROM notes WHERE entity_type='deals' AND entity_id=?").run(id);
            }
            applied += st.run(id).changes;
          }
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e }
      }
      else {
        const patch = {}; for (const k of Object.keys(b.patch || {})) if (fields.includes(k) && b.patch[k] !== undefined) patch[k] = b.patch[k];
        const ks = Object.keys(patch);
        if (!ks.length) return json(res, 400, { error: 'Не передано ни одного допустимого поля' });
        // проверяем ссылки и значения до записи: массовая операция не должна
        // падать на середине и оставлять часть записей изменёнными
        if (patch.responsible_id) {
          patch.responsible_id = Number(patch.responsible_id);
          if (!Number.isInteger(patch.responsible_id) || !db.prepare('SELECT 1 x FROM users WHERE id=?').get(patch.responsible_id)) return json(res, 400, { error: 'Ответственный не найден — обновите страницу' });
        }
        if (table === 'contacts') {
          if (patch.name !== undefined && !String(patch.name || '').trim()) return json(res, 400, { error: 'Имя клиента не может быть пустым' });
          if (patch.company_id && !db.prepare('SELECT 1 x FROM companies WHERE id=?').get(patch.company_id)) return json(res, 400, { error: 'Компания не найдена — обновите страницу' });
          if (patch.phone !== undefined) { ks.push('phone_norm'); patch.phone_norm = digits(patch.phone) || null; }
        }
        if (table === 'tasks') {
          for (const [field, target] of [['deal_id', 'deals'], ['contact_id', 'contacts']]) {
            if (patch[field] && !db.prepare(`SELECT 1 x FROM ${target} WHERE id=?`).get(patch[field])) return json(res, 400, { error: 'Связанная запись не найдена — обновите страницу' });
          }
          if (patch.due !== undefined) patch.due = patch.due ? normalizeDue(String(patch.due)) : '';
        }
        let assignedTo = null, assignedCount = 0;
        if (patch.responsible_id && ['deals', 'contacts', 'tasks'].includes(table)) {
          assignedTo = patch.responsible_id;
          for (const id of ids) {
            const prev = db.prepare(`SELECT responsible_id FROM ${table} WHERE id=?`).get(id);
            if (prev && Number(prev.responsible_id) !== assignedTo) assignedCount++;
          }
          if (table === 'deals') patch.responsible = db.prepare('SELECT name FROM users WHERE id=?').get(assignedTo)?.name || null;
        }
        if (table === 'deals') {
          // у сделок проверяем этап вместе с воронкой и пересчитываем дату закрытия
          const rows = ids.map(id => db.prepare('SELECT * FROM deals WHERE id=?').get(id)).filter(Boolean);
          const next = [];
          for (const d of rows) {
            const n = { ...d };
            if (patch.title !== undefined) { const t = String(patch.title || '').trim(); if (!t) return json(res, 400, { error: 'Название сделки не может быть пустым' }); n.title = t.slice(0, 200); }
            if (patch.amount !== undefined) { const a = patch.amount === null || patch.amount === '' ? 0 : Number(patch.amount); if (!Number.isFinite(a) || a < 0) return json(res, 400, { error: 'Сумма сделки должна быть неотрицательным числом' }); n.amount = Math.round(a); }
            if (patch.pipeline_id !== undefined) { const pid = Number(patch.pipeline_id); if (!db.prepare('SELECT 1 x FROM pipelines WHERE id=?').get(pid)) return json(res, 400, { error: 'Воронка не найдена — обновите страницу' }); n.pipeline_id = pid; }
            if (patch.stage !== undefined) n.stage = String(patch.stage);
            for (const [field, target] of [['contact_id', 'contacts'], ['company_id', 'companies']]) {
              if (patch[field] !== undefined) {
                const val = patch[field] ? Number(patch[field]) : null;
                if (val !== null && !db.prepare(`SELECT 1 x FROM ${target} WHERE id=?`).get(val)) return json(res, 400, { error: 'Связанная запись не найдена — обновите страницу' });
                n[field] = val;
              }
            }
            if (patch.responsible_id !== undefined) n.responsible_id = patch.responsible_id;
            if (patch.priority !== undefined) { if (!['low', 'normal', 'high'].includes(patch.priority)) return json(res, 400, { error: 'Неизвестный приоритет' }); n.priority = patch.priority; }
            if (patch.loss_reason !== undefined) n.loss_reason = String(patch.loss_reason || '').slice(0, 500);
            if (patch.deadline !== undefined) n.deadline = String(patch.deadline || '').slice(0, 40);
            if (patch.custom !== undefined) { const err = missingRequiredCustom('deals', patch.custom); if (err) return json(res, 400, { error: err }); n.custom = patch.custom; }
            const stageList = getStages(Number(n.pipeline_id) || 1);
            if (patch.stage === undefined && patch.pipeline_id !== undefined && !stageList.some(st => st.code === n.stage)) {
              // воронку сменили, а этап остался от старой — ставим первый этап новой
              n.stage = stageList[0]?.code || n.stage;
            }
            if (!stageList.some(st => st.code === n.stage)) return json(res, 400, { error: 'Этап не найден в выбранной воронке — обновите страницу' });
            n.responsible = n.responsible_id ? (db.prepare('SELECT name FROM users WHERE id=?').get(n.responsible_id)?.name || null) : null;
            const wasClosed = ['won', 'lost'].includes(d.stage);
            n.closed_at = !['won', 'lost'].includes(n.stage) ? null
              : (wasClosed && d.closed_at ? d.closed_at : new Date().toISOString().slice(0, 19).replace('T', ' '));
            next.push(n);
          }
          const st = db.prepare(`UPDATE deals SET title=?,amount=?,stage=?,pipeline_id=?,contact_id=?,company_id=?,responsible=?,responsible_id=?,priority=?,loss_reason=?,deadline=?,custom=?,closed_at=?,updated_at=datetime('now') WHERE id=?`);
          db.exec('BEGIN IMMEDIATE');
          try { for (const n of next) applied += st.run(n.title, n.amount, n.stage, n.pipeline_id, n.contact_id, n.company_id, n.responsible, n.responsible_id, n.priority, n.loss_reason, n.deadline, n.custom, n.closed_at, n.id).changes; db.exec('COMMIT'); }
          catch (e) { db.exec('ROLLBACK'); throw e }
        } else {
          const st = db.prepare(`UPDATE ${table} SET ${ks.map(k => k + '=?').join(',')} WHERE id=?`);
          for (const id of ids) applied += st.run(...ks.map(k => patch[k]), id).changes;
        }
        if (assignedTo && assignedCount && assignedTo !== Number(user.id)) {
          // одна сводка вместо сотни одинаковых тостов при массовой передаче
          broadcastTo(assignedTo, 'notify', { type: 'bulk_assigned', table, count: assignedCount });
        }
        log(`Массовое изменение (${table}): ${ids.length} записей — ${ks.join(', ')}`, table, null, user.name);
      }
      broadcast('change', { table });
      return json(res, 200, { table, action: b.action === 'delete' ? 'delete' : 'update', count: applied });
    }

    // ===== конкуренты: разведка (долги, суды, банкротство, отзывы, прайс-таблицы) =====
    if (/^\/api\/(competitors|competitor-sources|competitors\/find|prices|reviews)/.test(p)) {
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

    // прежний адрес иконки: браузеры и старые закладки просят /favicon.ico,
    // отправляем их к векторному файлу одним ответом без тела
    if (p === '/favicon.ico') { res.writeHead(301, { Location: '/favicon.svg' }); return res.end(); }

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
    // ошибки клиента (битый JSON, большое тело) не засоряют журнал сервера
    if (!e.statusCode || e.statusCode >= 500) console.error(e);
    // если ответ уже начали отдавать (файл/поток), повторно заголовки не пишем
    if (res.headersSent) { try { res.end() } catch {} return; }
    // слишком большое тело — это ошибка клиента, а не сбой сервера
    if (/Слишком большой запрос/.test(e.message)) return json(res, 413, { error: 'Слишком большой запрос: уменьшите файл или разбейте данные на части' });
    // разбор тела уже дал понятную причину (например, битый JSON)
    if (e.statusCode >= 400 && e.statusCode < 500) return json(res, e.statusCode, { error: e.message });
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

// ── устойчивость: штатное завершение и защита от падения процесса ──
let shuttingDown = false;
const graceful = (sig) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Получен ${sig}, штатно завершаюсь…`);
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
