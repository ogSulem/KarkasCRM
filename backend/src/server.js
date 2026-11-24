// КаркасCRM — ядро системы: воронки и сделки, клиенты и компании, задачи, единый инбокс
// мессенджеров и почты, аналитика, разведка конкурентов. Без внешних зависимостей:
// Node >= 22.5 (http, node:sqlite, crypto, fetch).
import http from 'node:http';
import https from 'node:https';
import { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { lookup as dnsLookup } from 'node:dns/promises';
// подпись запросов к S3-хранилищу — тот же модуль, что использует скрипт выгрузки
import { signedHeaders } from '../../scripts/s3-sign.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, statSync, lstatSync, openSync, fstatSync, closeSync, constants as fsConstants, readdirSync, unlinkSync, copyFileSync, renameSync, mkdirSync as mkdir, createReadStream } from 'node:fs';
import { extname, join, resolve, relative, isAbsolute, sep, basename } from 'node:path';
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
// копия настроек: объявлена рядом с путями данных, потому что читается
// сразу после миграций схемы, до остального кода настроек
const SETTINGS_FILE = join(DATA_DIR, 'settings.env');
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
// Пароль первого администратора. Значение по умолчанию подходит только для
// запуска на своём компьютере: оно короче не бывает, а правило личного пароля
// требует от 12 символов, поэтому с ним можно войти и сразу задать свой.
const DEFAULT_ADMIN_PASSWORD = 'admin1234567';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;

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
// SQLite по умолчанию приводит к нижнему регистру только латиницу. Для поиска
// сделок ОКК регистр русских имён не должен влиять на результат.
db.function('lower_ru', { deterministic: true }, value => String(value ?? '').toLocaleLowerCase('ru-RU'));
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE,pass TEXT,role TEXT DEFAULT 'manager',active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS teams(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS companies(id INTEGER PRIMARY KEY,name TEXT NOT NULL,inn TEXT,phone TEXT,email TEXT,site TEXT,notes TEXT DEFAULT '',responsible_id INTEGER,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS contacts(id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT,email TEXT,company TEXT,company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,position TEXT,source TEXT DEFAULT 'manual',tags TEXT DEFAULT '',notes TEXT DEFAULT '',responsible_id INTEGER,demo INTEGER DEFAULT 0,custom TEXT DEFAULT '{}',created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS pipelines(id INTEGER PRIMARY KEY,name TEXT NOT NULL,is_default INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS stages(id INTEGER PRIMARY KEY,pipeline_id INTEGER REFERENCES pipelines(id) ON DELETE CASCADE,code TEXT,name TEXT,color TEXT DEFAULT '#16a34a',sort INTEGER DEFAULT 0,kind TEXT DEFAULT 'open');
CREATE TABLE IF NOT EXISTS deals(id INTEGER PRIMARY KEY,title TEXT NOT NULL,amount INTEGER DEFAULT 0,deal_object TEXT NOT NULL DEFAULT 'Не уточнён',land_status TEXT NOT NULL DEFAULT 'unknown',construction_date TEXT NOT NULL DEFAULT 'unknown',payment_type TEXT NOT NULL DEFAULT 'unknown',lead_source TEXT NOT NULL DEFAULT 'unknown',stage TEXT DEFAULT 'new',pipeline_id INTEGER DEFAULT 1,contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,company_id INTEGER, responsible TEXT DEFAULT 'Администратор',responsible_id INTEGER,priority TEXT DEFAULT 'normal',loss_reason TEXT,deadline TEXT,closed_at TEXT,demo INTEGER DEFAULT 0,custom TEXT DEFAULT '{}',created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS lead_routing(
  deal_id INTEGER PRIMARY KEY REFERENCES deals(id) ON DELETE CASCADE,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  received_time_source TEXT NOT NULL DEFAULT 'crm',
  queued_at TEXT,
  queue_status TEXT NOT NULL DEFAULT 'queued' CHECK(queue_status IN ('queued','assigned','closed')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','urgent')),
  queue_team_id INTEGER,
  assigned_at TEXT,
  first_assigned_at TEXT,
  first_assigned_user_id INTEGER,
  first_response_at TEXT,
  first_response_user_id INTEGER,
  last_reason TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS lead_assignment_events(
  id INTEGER PRIMARY KEY,
  deal_id INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('assigned','returned','reassigned','priority_changed','partner_granted','partner_revoked','stage_revoked')),
  from_user_id INTEGER,
  to_user_id INTEGER,
  actor_id INTEGER,
  actor_name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'user',
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS shift_sessions(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  night_batch_at TEXT,
  last_assigned_at TEXT,
  end_reason TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS lead_classifications(
  deal_id INTEGER PRIMARY KEY REFERENCES deals(id) ON DELETE CASCADE,
  classifier_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','complete')),
  topic TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT '',
  suggested_manager_id INTEGER,
  classification_note TEXT NOT NULL DEFAULT '',
  assigned_by_id INTEGER,
  updated_by_id INTEGER,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS partner_transfers(
  id INTEGER PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  partner_id INTEGER NOT NULL REFERENCES users(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by_id INTEGER,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS access_log(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL DEFAULT '',
  resource_id TEXT NOT NULL DEFAULT '',
  request_method TEXT NOT NULL DEFAULT 'GET',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS deal_stage_history(
  id INTEGER PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  pipeline_id INTEGER NOT NULL DEFAULT 1,
  stage TEXT NOT NULL,
  stage_name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  responsible_id INTEGER,
  event_type TEXT NOT NULL CHECK(event_type IN ('created','entered','baseline')),
  entered_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY,title TEXT NOT NULL,type TEXT DEFAULT 'call',due TEXT,priority TEXT DEFAULT 'normal',done INTEGER DEFAULT 0,deal_id INTEGER,contact_id INTEGER,responsible_id INTEGER,result TEXT,demo INTEGER DEFAULT 0,notified_at TEXT,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY,entity_type TEXT,entity_id INTEGER,body TEXT,author TEXT,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,name TEXT NOT NULL,sku TEXT,price INTEGER DEFAULT 0,unit TEXT DEFAULT 'шт',active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS deal_products(id INTEGER PRIMARY KEY,deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,product_id INTEGER,name TEXT,price INTEGER,qty REAL DEFAULT 1);
CREATE TABLE IF NOT EXISTS templates(id INTEGER PRIMARY KEY,name TEXT NOT NULL,body TEXT,channel TEXT DEFAULT 'whatsapp');
CREATE TABLE IF NOT EXISTS automations(id INTEGER PRIMARY KEY,name TEXT NOT NULL,trigger_type TEXT NOT NULL,trigger_value TEXT,action_type TEXT NOT NULL,action_value TEXT,active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS channels(id INTEGER PRIMARY KEY,provider TEXT DEFAULT 'wazzup',external_id TEXT UNIQUE,name TEXT,transport TEXT,phone TEXT,state TEXT,raw TEXT);
CREATE TABLE IF NOT EXISTS conversations(id INTEGER PRIMARY KEY,contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,title TEXT,channels TEXT DEFAULT '',channel_id TEXT,external_chat_id TEXT,chat_type TEXT,unread INTEGER DEFAULT 0,assigned_id INTEGER,demo INTEGER DEFAULT 0,last_at TEXT DEFAULT (datetime('now')),UNIQUE(contact_id));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,channel TEXT DEFAULT 'whatsapp',direction TEXT DEFAULT 'in',body TEXT,content_uri TEXT,status TEXT,external_id TEXT,author TEXT,subject TEXT,created_at TEXT DEFAULT (datetime('now')),event_at TEXT,event_time_source TEXT DEFAULT '');
-- Проверки ОКК хранят только ручной разбор и доказательства. Снимки названия,
-- контакта и ответственного остаются в архиве, даже если карточку позже удалят.
-- Результаты доступны только администратору; сами проверки не меняют CRM-записи.
CREATE TABLE IF NOT EXISTS quality_reviews(
  id INTEGER PRIMARY KEY,
  deal_id INTEGER NOT NULL,
  deal_title TEXT NOT NULL,
  contact_id INTEGER,
  contact_name TEXT DEFAULT '',
  responsible_id INTEGER,
  responsible_name TEXT DEFAULT '',
  pipeline_id INTEGER NOT NULL DEFAULT 1,
  pipeline_name TEXT DEFAULT '',
  stage TEXT DEFAULT '',
  stage_name TEXT DEFAULT '',
  source TEXT DEFAULT '',
  demo INTEGER NOT NULL DEFAULT 0,
  reviewer_id INTEGER,
  reviewer_name TEXT NOT NULL,
  updated_by_id INTEGER,
  updated_by_name TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','complete','no_contact','unavailable')),
  data_status TEXT NOT NULL DEFAULT 'partial' CHECK(data_status IN ('complete','partial','unavailable')),
  interaction_type TEXT NOT NULL DEFAULT 'unknown' CHECK(interaction_type IN ('unknown','call','chat','mixed','other')),
  period_start TEXT DEFAULT '',
  period_end TEXT DEFAULT '',
  data_notes TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  issues TEXT NOT NULL DEFAULT '[]',
  next_steps TEXT NOT NULL DEFAULT '[]',
  crm_observation TEXT DEFAULT '',
  sample_rule TEXT NOT NULL DEFAULT '',
  sample_note TEXT DEFAULT '',
  abandoned_card INTEGER NOT NULL DEFAULT 0 CHECK(abandoned_card IN (0,1)),
  abandoned_card_evidence TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS quality_review_items(
  id INTEGER PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES quality_reviews(id) ON DELETE CASCADE,
  criterion_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '' CHECK(status IN ('','yes','no','na','unknown')),
  evidence_source TEXT NOT NULL DEFAULT '' CHECK(evidence_source IN ('','message','recording','crm','other')),
  message_id INTEGER,
  evidence_text TEXT NOT NULL DEFAULT '',
  evidence_timestamp TEXT NOT NULL DEFAULT '',
  evidence_speaker TEXT NOT NULL DEFAULT '' CHECK(evidence_speaker IN ('','manager','client','both','unknown')),
  evidence_confidence TEXT NOT NULL DEFAULT '' CHECK(evidence_confidence IN ('','verified','needs_review','low')),
  UNIQUE(review_id, criterion_key)
);
CREATE TABLE IF NOT EXISTS quality_review_growth_items(
  id INTEGER PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES quality_reviews(id) ON DELETE CASCADE,
  criterion_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '' CHECK(status IN ('','yes','no','na','unknown')),
  evidence_source TEXT NOT NULL DEFAULT '' CHECK(evidence_source IN ('','message','recording','crm','other')),
  message_id INTEGER,
  evidence_text TEXT NOT NULL DEFAULT '',
  evidence_timestamp TEXT NOT NULL DEFAULT '',
  evidence_speaker TEXT NOT NULL DEFAULT '' CHECK(evidence_speaker IN ('','manager','client','both','unknown')),
  evidence_confidence TEXT NOT NULL DEFAULT '' CHECK(evidence_confidence IN ('','verified','needs_review','low')),
  UNIQUE(review_id, criterion_key)
);
CREATE TABLE IF NOT EXISTS quality_review_facts(
  review_id INTEGER NOT NULL REFERENCES quality_reviews(id) ON DELETE CASCADE,
  fact_key TEXT NOT NULL CHECK(fact_key IN ('object_area','city','land','timeline','budget','payment')),
  heard_status TEXT NOT NULL DEFAULT '' CHECK(heard_status IN ('','yes','no','na','unknown')),
  crm_status TEXT NOT NULL DEFAULT '' CHECK(crm_status IN ('','yes','no','na','unknown')),
  PRIMARY KEY(review_id,fact_key)
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE IF NOT EXISTS read_marks(user_id INTEGER NOT NULL,conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  last_msg_id INTEGER NOT NULL DEFAULT 0,updated_at TEXT DEFAULT (datetime('now')),PRIMARY KEY(user_id,conversation_id));
CREATE TABLE IF NOT EXISTS conversation_deal_read_marks(user_id INTEGER NOT NULL,conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,last_msg_id INTEGER NOT NULL DEFAULT 0,updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY(user_id,conversation_id,deal_id));
CREATE TABLE IF NOT EXISTS activities(id INTEGER PRIMARY KEY,text TEXT,entity_type TEXT,entity_id INTEGER,user_name TEXT,feed INTEGER DEFAULT 1,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS automation_queue(id INTEGER PRIMARY KEY,automation_id INTEGER,trigger_type TEXT,deal_id INTEGER,contact_id INTEGER,run_at TEXT,quiet INTEGER DEFAULT 0,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS campaigns(id INTEGER PRIMARY KEY,name TEXT NOT NULL,channel TEXT NOT NULL DEFAULT 'whatsapp',subject TEXT DEFAULT '',message TEXT NOT NULL,audience TEXT DEFAULT '{}',status TEXT NOT NULL DEFAULT 'scheduled',scheduled_at TEXT,created_by TEXT DEFAULT '',created_by_id INTEGER,total INTEGER DEFAULT 0,sent INTEGER DEFAULT 0,failed INTEGER DEFAULT 0,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS campaign_items(id INTEGER PRIMARY KEY,campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,contact_id INTEGER,address TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'queued',error TEXT DEFAULT '',sent_at TEXT);
CREATE TABLE IF NOT EXISTS partner_training_items(id INTEGER PRIMARY KEY,title TEXT NOT NULL,body TEXT DEFAULT '',url TEXT DEFAULT '',sort INTEGER DEFAULT 0,active INTEGER DEFAULT 1,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')));
`);
// мягкие миграции: дополняем ранее созданные таблицы недостающими колонками
const SCHEMA = [
  ['contacts', 'demo', 'INTEGER DEFAULT 0'], ['deals', 'demo', 'INTEGER DEFAULT 0'], ['tasks', 'demo', 'INTEGER DEFAULT 0'],
  ['conversations', 'demo', 'INTEGER DEFAULT 0'], ['tasks', 'notified_at', 'TEXT'], ['messages', 'subject', 'TEXT'],
  ['contacts', 'custom', "TEXT DEFAULT '{}'"], ['deals', 'custom', "TEXT DEFAULT '{}'"],
];
const SCHEMA_COLUMNS = [...SCHEMA,
  ['users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'session_version', 'INTEGER NOT NULL DEFAULT 0'], ['users', 'pref_view', "TEXT DEFAULT ''"],
  ['users', 'last_login', 'TEXT'], ['users', 'pass_changed_at', 'TEXT'],
  ['users', 'theme', "TEXT DEFAULT ''"],
  ['users', 'team_id', 'INTEGER'],
  ['users', 'max_open_leads', 'INTEGER'],
  ['users', 'routing_regions', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'routing_directions', "TEXT NOT NULL DEFAULT ''"],
  ['contacts', 'company_id', 'INTEGER'], ['contacts', 'position', 'TEXT'], ['contacts', 'responsible_id', 'INTEGER'],
  ['contacts', 'tags', "TEXT DEFAULT ''"], ['contacts', 'notes', "TEXT DEFAULT ''"], ['contacts', 'source', "TEXT DEFAULT 'manual'"],
  ['deals', 'pipeline_id', 'INTEGER DEFAULT 1'], ['deals', 'priority', "TEXT DEFAULT 'normal'"], ['deals', 'loss_reason', 'TEXT'],
  ['deals', 'company_id', 'INTEGER'], ['deals', 'responsible', "TEXT DEFAULT 'Администратор'"], ['deals', 'responsible_id', 'INTEGER'], ['deals', 'updated_at', 'TEXT'],
  ['tasks', 'type', "TEXT DEFAULT 'call'"], ['tasks', 'priority', "TEXT DEFAULT 'normal'"], ['tasks', 'responsible_id', 'INTEGER'],
  ['tasks', 'done', 'INTEGER DEFAULT 0'], ['tasks', 'repeat', "TEXT DEFAULT 'none'"],
  ['messages', 'content_uri', 'TEXT'], ['messages', 'status', 'TEXT'], ['messages', 'external_id', 'TEXT'],
  ['messages', 'channel', "TEXT DEFAULT 'whatsapp'"], ['messages', 'direction', "TEXT DEFAULT 'in'"], ['messages', 'author', 'TEXT'],
  ['messages', 'content_name', 'TEXT'], ['messages', 'content_type', 'TEXT'], ['messages', 'content_size', 'INTEGER'], ['messages', 'channel_id', 'TEXT'], ['messages', 'deal_id', 'INTEGER'],
  ['conversations', 'channel_id', 'TEXT'], ['conversations', 'external_chat_id', 'TEXT'], ['conversations', 'chat_type', 'TEXT'],
  ['conversations', 'last_at', 'TEXT'], ['conversations', 'assigned_id', 'INTEGER'], ['conversations', 'title', 'TEXT'], ['conversations', 'channels', "TEXT DEFAULT ''"],
  ['contacts', 'phone_norm', 'TEXT'], ['templates', 'user_id', 'INTEGER'],
  ['products', 'demo', 'INTEGER DEFAULT 0'], ['templates', 'demo', 'INTEGER DEFAULT 0'], ['automations', 'demo', 'INTEGER DEFAULT 0'],
  ['products', 'note', "TEXT DEFAULT ''"],   // примечание к позиции каталога (= прайс-листа)
  ['companies', 'demo', 'INTEGER DEFAULT 0'], ['companies', 'responsible_id', 'INTEGER'], ['notes', 'demo', 'INTEGER DEFAULT 0'],
  ['deals', 'deal_object', "TEXT NOT NULL DEFAULT 'Не уточнён'"],
  ['deals', 'land_status', "TEXT NOT NULL DEFAULT 'unknown'"],
  ['deals', 'construction_date', "TEXT NOT NULL DEFAULT 'unknown'"],
  ['deals', 'payment_type', "TEXT NOT NULL DEFAULT 'unknown'"],
  ['deals', 'lead_source', "TEXT NOT NULL DEFAULT 'unknown'"],
  // своё название канала: вендор отдаёт только номер или юзернейм, а каналов
  // бывает по одному на сотрудника, и отличить их друг от друга нужно человеку
  ['channels', 'label', 'TEXT'],
  // сотрудник, чей это аккаунт: с него отвечаем, когда клиент ещё не писал,
  // и на него назначается обращение, пришедшее на этот аккаунт
  ['channels', 'user_id', 'INTEGER'],
  // строки журнала, рождённые чатами, живут в истории карточек, но ленту
  // рабочего стола не заполняют; quiet у очереди хранит этот признак через выдержку
  ['activities', 'feed', 'INTEGER DEFAULT 1'],
  ['automation_queue', 'quiet', 'INTEGER DEFAULT 0'],
  // выдержка правила: действие срабатывает не сразу, а через N дней
  ['automations', 'delay_days', 'INTEGER'],
  // каким правилом отправлено сообщение: по нему работает защита от потоковой рассылки
  ['messages', 'automation_id', 'INTEGER'],
  ['messages', 'event_at', 'TEXT'],
  ['messages', 'event_time_source', "TEXT NOT NULL DEFAULT ''"],
  ['quality_reviews', 'pipeline_id', 'INTEGER NOT NULL DEFAULT 1'],
  ['quality_reviews', 'pipeline_name', "TEXT NOT NULL DEFAULT ''"],
  ['quality_reviews', 'sample_rule', "TEXT NOT NULL DEFAULT ''"],
  ['quality_reviews', 'sample_note', "TEXT NOT NULL DEFAULT ''"],
  ['quality_reviews', 'abandoned_card', 'INTEGER NOT NULL DEFAULT 0'],
  ['quality_reviews', 'abandoned_card_evidence', "TEXT NOT NULL DEFAULT ''"],
  ['lead_routing', 'first_assigned_at', 'TEXT'],
  ['lead_routing', 'first_assigned_user_id', 'INTEGER'],
  ['quality_review_items', 'evidence_timestamp', "TEXT NOT NULL DEFAULT ''"],
  ['quality_review_items', 'evidence_speaker', "TEXT NOT NULL DEFAULT ''"],
  ['quality_review_items', 'evidence_confidence', "TEXT NOT NULL DEFAULT ''"],
  // Отписка от рассылок по каналам: клиент, написавший «Отписка», больше не
  // попадает в сегменты рассылок этого канала. Проверка делается и при
  // создании рассылки, и в момент отправки каждого сообщения.
  ['contacts', 'email_opt_out', 'INTEGER NOT NULL DEFAULT 0'],
  ['contacts', 'whatsapp_opt_out', 'INTEGER NOT NULL DEFAULT 0'],
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
// копия делается один раз на запуск: она нужна и перед добавлением колонок, и
// перед удалением таблицы убранного раздела, а двух одинаковых файлов быть не должно
let preUpgradeCopy = '';
if (missingColumns.length && !freshDb) {
  try {
    mkdir(join(DATA_DIR, 'backups'), { recursive: true });
    const pre = join(DATA_DIR, 'backups', `pre-upgrade-${localStamp()}.db`);
    // сбрасываем WAL на диск: копия одного файла должна быть согласованной
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch {}
    copyFileSync(join(DATA_DIR, 'crm.db'), pre);
    preUpgradeCopy = pre;
    console.log(`Обновление схемы базы — страховочная копия: ${pre}`);
  } catch (e) { console.error('Не удалось сделать копию перед обновлением схемы:', e.message) }
}
for (const [t, c, d] of SCHEMA_COLUMNS) {
  const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(r => r.name); if (!cols.includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`);
}
// При первом добавлении источника сделки переносим известное значение из карточки клиента.
// Повторный запуск не трогает явно выбранное «неизвестно».
if (missingColumns.some(([t, c]) => t === 'deals' && c === 'lead_source')) {
  db.exec(`UPDATE deals SET lead_source=COALESCE((SELECT NULLIF(c.source,'') FROM contacts c WHERE c.id=deals.contact_id),'unknown')
    WHERE lead_source='unknown' AND contact_id IS NOT NULL`);
}
// Старые данные знают только о последнем назначении. Сохраняем его как
// начальную отметку для таких карточек, но новые назначения её больше не затирают.
db.exec(`UPDATE lead_routing SET first_assigned_at=COALESCE(first_assigned_at,assigned_at),
  first_assigned_user_id=COALESCE(first_assigned_user_id,(SELECT responsible_id FROM deals WHERE deals.id=lead_routing.deal_id))
  WHERE assigned_at IS NOT NULL`);
if (missingColumns.length && !freshDb) console.log(`Схема базы обновлена: заполнено полей — ${missingColumns.length}`);
seedSettingsFromFile();
// индексы создаём ПОСЛЕ миграций: иначе база прошлой версии упадёт на отсутствующей колонке
db.exec(`
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id,id);
CREATE INDEX IF NOT EXISTS idx_msg_conv_time ON messages(conversation_id,created_at,id);
CREATE INDEX IF NOT EXISTS idx_msg_conv_event_time ON messages(conversation_id,event_at,id);
-- Непрочитанное считается EXISTS-запросом «есть ли входящее с id больше
-- отметки»: без direction в индексе планировщик сканировал сообщения по
-- rowid и на пяти тысячах диалогов счётчик собирался секунды. Покрывающий
-- индекс свёл тот же запрос к миллисекундам.
CREATE INDEX IF NOT EXISTS idx_msg_conv_dir ON messages(conversation_id,direction,id);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_phone_norm ON contacts(phone_norm);
CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(responsible_id);
CREATE INDEX IF NOT EXISTS idx_companies_owner ON companies(responsible_id);
CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks(done,due);
CREATE INDEX IF NOT EXISTS idx_conv_contact ON conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_templates_owner ON templates(user_id);
CREATE INDEX IF NOT EXISTS idx_deals_pipeline ON deals(pipeline_id, stage);
CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contact_id);
-- карточка компании спрашивает её сделки и сотрудников: без индекса оба
-- фильтра перебирали бы таблицу целиком
CREATE INDEX IF NOT EXISTS idx_deals_company ON deals(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_deals_responsible ON deals(responsible_id);
CREATE INDEX IF NOT EXISTS idx_tasks_deal ON tasks(deal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_contact ON tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_tasks_responsible ON tasks(responsible_id, done);
CREATE INDEX IF NOT EXISTS idx_conv_last ON conversations(last_at);
CREATE INDEX IF NOT EXISTS idx_deal_products_deal ON deal_products(deal_id);
CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activities_entity ON activities(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(lower(email));
CREATE INDEX IF NOT EXISTS idx_conv_external ON conversations(external_chat_id);
-- Файл вложения ищем по адресу, чтобы отдать его только тому, кому принадлежит
-- переписка: без индекса каждая картинка в чате партнёра стоила бы перебора
-- всех сообщений.
CREATE INDEX IF NOT EXISTS idx_msg_content_uri ON messages(content_uri);
CREATE INDEX IF NOT EXISTS idx_messages_deal_conversation ON messages(deal_id,conversation_id,id);
CREATE INDEX IF NOT EXISTS idx_camp_items ON campaign_items(campaign_id, status, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_camp_items_contact ON campaign_items(campaign_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_camp_queue ON campaigns(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_partner_training_active ON partner_training_items(active, sort, id);
CREATE INDEX IF NOT EXISTS idx_quality_reviews_status_date ON quality_reviews(status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_quality_reviews_deal_date ON quality_reviews(deal_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_quality_reviews_report ON quality_reviews(status, completed_at DESC, pipeline_id, responsible_id, stage, source);
CREATE INDEX IF NOT EXISTS idx_quality_items_review ON quality_review_items(review_id, criterion_key);
CREATE INDEX IF NOT EXISTS idx_quality_items_key_status ON quality_review_items(criterion_key, status);
CREATE INDEX IF NOT EXISTS idx_quality_growth_review ON quality_review_growth_items(review_id, criterion_key);
CREATE INDEX IF NOT EXISTS idx_quality_growth_key_status ON quality_review_growth_items(criterion_key, status);
CREATE INDEX IF NOT EXISTS idx_quality_facts_key_status ON quality_review_facts(fact_key, heard_status, crm_status, review_id);
CREATE INDEX IF NOT EXISTS idx_stage_history_period ON deal_stage_history(event_type, entered_at, pipeline_id, stage);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stage_history_baseline ON deal_stage_history(deal_id) WHERE event_type='baseline';
CREATE INDEX IF NOT EXISTS idx_lead_routing_queue ON lead_routing(queue_status,priority,queued_at,deal_id);
CREATE INDEX IF NOT EXISTS idx_lead_routing_response ON lead_routing(queue_status,first_response_at,received_at);
CREATE INDEX IF NOT EXISTS idx_assignment_events_deal ON lead_assignment_events(deal_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_assignment_events_actor ON lead_assignment_events(actor_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_shift_sessions_user ON shift_sessions(user_id,started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_one_active ON shift_sessions(user_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_classifications_owner ON lead_classifications(classifier_id,status,updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_transfer_active_deal ON partner_transfers(deal_id) WHERE active=1;
CREATE INDEX IF NOT EXISTS idx_partner_transfer_partner ON partner_transfers(partner_id,active,deal_id);
CREATE INDEX IF NOT EXISTS idx_access_log_recent ON access_log(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_access_log_user ON access_log(user_id,created_at DESC,id DESC);
`);
// Для старых сделок известна дата их создания в CRM, но не время фактического
// поступления или назначения. Не подменяем эти события; ведём только текущий
// статус и сохраняем created_at как источник времени записи CRM.
db.prepare(`INSERT OR IGNORE INTO lead_routing(deal_id,received_at,received_time_source,queued_at,queue_status,priority)
  SELECT d.id,COALESCE(NULLIF(d.created_at,''),datetime('now')),'crm',
    CASE WHEN d.responsible_id IS NULL AND d.stage NOT IN ('won','lost') THEN COALESCE(NULLIF(d.created_at,''),datetime('now')) ELSE NULL END,
    CASE WHEN d.stage IN ('won','lost') THEN 'closed' WHEN d.responsible_id IS NULL THEN 'queued' ELSE 'assigned' END,
    CASE WHEN d.priority='urgent' THEN 'urgent' ELSE 'normal' END FROM deals d`).run();
db.exec(`
DROP TRIGGER IF EXISTS trg_lead_routing_insert;
CREATE TRIGGER trg_lead_routing_insert AFTER INSERT ON deals BEGIN
  INSERT OR IGNORE INTO lead_routing(deal_id,received_at,received_time_source,queued_at,queue_status,priority,assigned_at,first_assigned_at,first_assigned_user_id)
  VALUES(NEW.id,COALESCE(NULLIF(NEW.created_at,''),datetime('now')),'crm',
    CASE WHEN NEW.responsible_id IS NULL AND NEW.stage NOT IN ('won','lost') THEN COALESCE(NULLIF(NEW.created_at,''),datetime('now')) ELSE NULL END,
    CASE WHEN NEW.stage IN ('won','lost') THEN 'closed' WHEN NEW.responsible_id IS NULL THEN 'queued' ELSE 'assigned' END,
    CASE WHEN NEW.priority='urgent' THEN 'urgent' ELSE 'normal' END,
    CASE WHEN NEW.responsible_id IS NOT NULL THEN COALESCE(NULLIF(NEW.created_at,''),datetime('now')) ELSE NULL END,
    CASE WHEN NEW.responsible_id IS NOT NULL THEN COALESCE(NULLIF(NEW.created_at,''),datetime('now')) ELSE NULL END,
    CASE WHEN NEW.responsible_id IS NOT NULL THEN NEW.responsible_id ELSE NULL END);
END;
DROP TRIGGER IF EXISTS trg_lead_routing_state;
CREATE TRIGGER trg_lead_routing_state AFTER UPDATE OF responsible_id,stage,pipeline_id ON deals BEGIN
  INSERT OR IGNORE INTO lead_routing(deal_id,received_at,received_time_source,queued_at,queue_status,priority)
    VALUES(NEW.id,COALESCE(NULLIF(NEW.created_at,''),datetime('now')),'crm',
      CASE WHEN NEW.responsible_id IS NULL AND NEW.stage NOT IN ('won','lost') THEN datetime('now') ELSE NULL END,
      CASE WHEN NEW.stage IN ('won','lost') THEN 'closed' WHEN NEW.responsible_id IS NULL THEN 'queued' ELSE 'assigned' END,
      CASE WHEN NEW.priority='urgent' THEN 'urgent' ELSE 'normal' END);
  UPDATE lead_routing SET
    queue_status=CASE WHEN NEW.stage IN ('won','lost') THEN 'closed' WHEN NEW.responsible_id IS NULL THEN 'queued' ELSE 'assigned' END,
    queued_at=CASE WHEN NEW.responsible_id IS NULL AND NEW.stage NOT IN ('won','lost') THEN COALESCE(queued_at,datetime('now')) ELSE NULL END,
    assigned_at=CASE WHEN NEW.responsible_id IS NOT NULL THEN COALESCE(assigned_at,COALESCE(NULLIF(NEW.updated_at,''),datetime('now'))) ELSE NULL END,
    first_assigned_at=CASE WHEN NEW.responsible_id IS NOT NULL THEN COALESCE(first_assigned_at,COALESCE(NULLIF(NEW.updated_at,''),datetime('now'))) ELSE first_assigned_at END,
    first_assigned_user_id=CASE WHEN NEW.responsible_id IS NOT NULL THEN COALESCE(first_assigned_user_id,NEW.responsible_id) ELSE first_assigned_user_id END
    WHERE deal_id=NEW.id;
END;
DROP TRIGGER IF EXISTS trg_partner_transfer_stage_revoke;
CREATE TRIGGER trg_partner_transfer_stage_revoke AFTER UPDATE OF stage,pipeline_id ON deals
WHEN EXISTS(SELECT 1 FROM partner_transfers pt WHERE pt.deal_id=NEW.id AND pt.active=1)
 AND (COALESCE(NEW.pipeline_id,1)<>COALESCE(CAST((SELECT value FROM settings WHERE key='PARTNER_TRANSFER_PIPELINE_ID') AS INTEGER),0)
   OR instr(','||COALESCE((SELECT value FROM settings WHERE key='PARTNER_TRANSFER_ALLOWED_STAGES'),'')||',',','||COALESCE(NEW.stage,'')||',')=0)
BEGIN
  INSERT INTO lead_assignment_events(deal_id,event_type,from_user_id,to_user_id,actor_id,actor_name,source,reason)
    SELECT NEW.id,'stage_revoked',pt.partner_id,NULL,0,'Система','system','Этап сделки больше не разрешает доступ партнёру'
    FROM partner_transfers pt WHERE pt.deal_id=NEW.id AND pt.active=1;
  UPDATE partner_transfers SET active=0,revoked_at=datetime('now') WHERE deal_id=NEW.id AND active=1;
END;
`);
// История переходов нужна для конверсии по этапам. Старые сделки получают только
// снимок «уже в работе» — он помогает ориентироваться, но не выдаётся за историю
// входа в этап. Дальше реальные переходы фиксируются триггерами в самой SQLite,
// поэтому их не пропускают ни API, ни пакетные обновления.
db.exec(`
DROP TRIGGER IF EXISTS trg_deal_stage_history_created;
CREATE TRIGGER trg_deal_stage_history_created
AFTER INSERT ON deals
BEGIN
  INSERT INTO deal_stage_history(deal_id,pipeline_id,stage,stage_name,source,responsible_id,event_type,entered_at)
  VALUES(NEW.id,COALESCE(NEW.pipeline_id,1),COALESCE(NEW.stage,'new'),
    COALESCE((SELECT name FROM stages WHERE pipeline_id=COALESCE(NEW.pipeline_id,1) AND code=COALESCE(NEW.stage,'new')),COALESCE(NEW.stage,'new')),
    COALESCE(NULLIF(NEW.lead_source,''),''),NEW.responsible_id,'created',
    COALESCE(NULLIF(NEW.created_at,''),datetime('now')));
END;
DROP TRIGGER IF EXISTS trg_deal_stage_history_entered;
CREATE TRIGGER trg_deal_stage_history_entered
AFTER UPDATE OF stage,pipeline_id ON deals
WHEN COALESCE(OLD.stage,'')<>COALESCE(NEW.stage,'') OR COALESCE(OLD.pipeline_id,1)<>COALESCE(NEW.pipeline_id,1)
BEGIN
  INSERT INTO deal_stage_history(deal_id,pipeline_id,stage,stage_name,source,responsible_id,event_type,entered_at)
  VALUES(NEW.id,COALESCE(NEW.pipeline_id,1),COALESCE(NEW.stage,'new'),
    COALESCE((SELECT name FROM stages WHERE pipeline_id=COALESCE(NEW.pipeline_id,1) AND code=COALESCE(NEW.stage,'new')),COALESCE(NEW.stage,'new')),
    COALESCE(NULLIF(NEW.lead_source,''),''),NEW.responsible_id,'entered',
    COALESCE(NULLIF(NEW.updated_at,''),datetime('now')));
END;
INSERT INTO deal_stage_history(deal_id,pipeline_id,stage,stage_name,source,responsible_id,event_type,entered_at)
SELECT d.id,COALESCE(d.pipeline_id,1),COALESCE(d.stage,'new'),
  COALESCE((SELECT name FROM stages WHERE pipeline_id=COALESCE(d.pipeline_id,1) AND code=COALESCE(d.stage,'new')),COALESCE(d.stage,'new')),
  COALESCE(NULLIF(d.lead_source,''),''),d.responsible_id,'baseline',datetime('now')
FROM deals d
WHERE NOT EXISTS(SELECT 1 FROM deal_stage_history h WHERE h.deal_id=d.id);
`);
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_ext ON messages(external_id) WHERE external_id IS NOT NULL'); }
catch (e) { console.error('Не удалось создать уникальный индекс по external_id (в базе есть дубли внешних id):', e.message); }
// Деньги в базе — целые рубли. До версии 1.2.5 сумма сделки пересчитывалась по
// позициям без округления, и при дробном количестве в старых базах оставался
// хвост вида 300.00000000000004: он уходил в выгрузку для Excel и в ответ API.
// Правка одноразовая и повторяется безопасно: целые строки условие не трогает.
try {
  const moneyFix = db.prepare(`UPDATE deals SET amount = CAST(ROUND(amount) AS INTEGER)
    WHERE amount IS NOT NULL AND typeof(amount) <> 'integer'`).run();
  if (moneyFix.changes) console.log(`Суммы сделок приведены к целым рублям: строк исправлено ${moneyFix.changes}`);
} catch (e) { console.error('Не удалось привести суммы сделок к целым рублям:', e.message) }

// Раздела «Обучение» больше нет: материалы команда хранит у себя, а CRM остаётся
// про продажи. Таблица и записи журнала о материалах убираются при запуске один
// раз; проверка повторяется безопасно и пустую базу не трогает.
try {
  const old = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='training_items'").get();
  if (old) {
    // материалы — данные заказчика, а не служебная таблица: если в ней что-то
    // лежит, перед удалением кладём копию базы рядом с ежедневными копиями
    const had = db.prepare('SELECT COUNT(*) n FROM training_items').get().n;
    if (had && !freshDb && !preUpgradeCopy) {
      try {
        mkdir(join(DATA_DIR, 'backups'), { recursive: true });
        try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch {}
        const pre = join(DATA_DIR, 'backups', `pre-upgrade-${localStamp()}.db`);
        copyFileSync(join(DATA_DIR, 'crm.db'), pre);
        preUpgradeCopy = pre;
        console.log(`Перед удалением раздела «Обучение» сделана копия базы, материалов в ней: ${had} — ${pre}`);
      } catch (e) { console.error('Не удалось сделать копию перед удалением обучения:', e.message) }
    } else if (had && preUpgradeCopy) {
      console.log(`Материалов обучения в базе: ${had}, они остались в копии ${preUpgradeCopy}`);
    }
    db.exec('DROP TABLE training_items');
    const acts = db.prepare("DELETE FROM activities WHERE entity_type='training_items'").run();
    console.log(`Таблица training_items удалена, записей журнала очищено ${acts.changes}`);
  }
} catch (e) { console.error('Не удалось убрать таблицу training_items:', e.message) }

// Любимый раздел хранится у сотрудника. «Качество» стало вкладкой аналитики,
// «Рассылки» — вкладкой контактов, «Обучение» убрано: старые значения переводим
// на раздел, где работа теперь живёт, чтобы CRM не открывалась пустым экраном.
try {
  const moved = db.prepare(`UPDATE users SET pref_view = CASE pref_view
      WHEN 'quality' THEN 'analytics' WHEN 'campaigns' THEN 'contacts' WHEN 'training' THEN 'dashboard'
      ELSE pref_view END WHERE pref_view IN ('quality','campaigns','training')`).run();
  if (moved.changes) console.log(`Любимый раздел перенесён у сотрудников: ${moved.changes}`);
} catch (e) { console.error('Не удалось перенести любимый раздел:', e.message) }

const SCHEMA_VERSION = 15;

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

// Единый предел длины текстов в карточках: мегабайтное название или заметка
// не должны попадать в базу — списки и карточки такое всё равно не показывают
// целиком, а место и скорость поиска расходуются. Пределы с запасом: обычное
// название компании или задачи в них укладывается многократно.
const TEXT_LIMITS = { name: 200, title: 300, body: 20000, notes: 20000, phone: 64, email: 254, company: 200, position: 120, unit: 30, sku: 64, inn: 32, ogrn: 32, city: 120, website: 500, site: 500, tags: 500, source: 60, loss_reason: 500, deadline: 40, result: 2000, custom: 20000, type: 30, repeat: 20, priority: 10 };
function clampTexts(b) {
  // свои поля форма присылает JSON-строкой; объект из прямого запроса к API
  // приводим к строке здесь, иначе запись в базу упала бы с невнятной ошибкой
  if (b.custom !== undefined && typeof b.custom !== 'string') {
    try { b.custom = JSON.stringify(b.custom ?? {}) } catch { b.custom = '{}' }
  }
  for (const k of ['email_opt_out', 'whatsapp_opt_out']) if (b[k] !== undefined) b[k] = b[k] ? 1 : 0;
  for (const k of Object.keys(b)) {
    const lim = TEXT_LIMITS[k];
    if (lim && typeof b[k] === 'string' && b[k].length > lim) b[k] = b[k].slice(0, lim);
  }
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
  // За прокси адрес клиента берётся из цепочки X-Forwarded-For. Реальный адрес
  // дописывает ближайший прокси (nginx — $proxy_add_x_forwarded_for, Caddy —
  // подставляет заголовок сам), поэтому берём ПОСЛЕДНИЙ элемент: значение
  // слева клиент может подделать из браузера, а справа — это адрес, за который
  // поручился наш прокси. Офис за одним адресом при этом не делит счётчики:
  // предел неудачных попыток входа считается на учётную запись.
  const list = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(x => /^[0-9a-f:.]{3,45}$/i.test(x));
  return list.length ? list[list.length - 1] : remote;
}
const setSetting = (k, v) => { db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v ?? '')); scheduleSettingsMirror(); };
// Файл-копия настроек: всё, что сохранено в «Настройках», дополнительно пишется
// в data/settings.env. При старте файл дополняет базу ключами, которых в ней
// нет: при переносе на новый сервер или пересозданной базе адреса интеграций,
// ключи и параметры возвращаются без ручного ввода. Источник истины — база:
// значение, сохранённое через интерфейс, тут же перезаписывает строку файла.
let settingsMirrorTimer = 0;
function scheduleSettingsMirror() {
  clearTimeout(settingsMirrorTimer);
  settingsMirrorTimer = setTimeout(mirrorSettingsToFile, 400);
  settingsMirrorTimer.unref?.(); // тесты и завершение процесса не ждут копию
}
export function mirrorSettingsToFile() {
  try {
    const rows = db.prepare('SELECT key,value FROM settings ORDER BY key').all();
    const lines = ['# Настройки КаркасCRM — автоматическая копия значений, сохранённых в интерфейсе.',
      '# База остаётся источником истины; при старте файл дополняет базу недостающими ключами.',
      ...rows.map(r => `${r.key}=${JSON.stringify(String(r.value ?? ''))}`)];
    const tmp = SETTINGS_FILE + '.part';
    // в копии ключи интеграций и пароли почты: читать файл должен только
    // владелец сервиса, поэтому права сжимаются до 0600 до переименования
    writeFileSync(tmp, lines.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, SETTINGS_FILE);
  } catch (e) { console.error('Не удалось сохранить копию настроек в settings.env:', e.message); }
}
export function seedSettingsFromFile() {
  try {
    if (!existsSync(SETTINGS_FILE)) return 0;
    // файл прежней версии мог остаться доступным для чтения всем на сервере
    try { chmodSync(SETTINGS_FILE, 0o600); } catch { /* права поправит следующая запись */ }
    const ins = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
    let n = 0;
    for (const line of readFileSync(SETTINGS_FILE, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 1) continue;
      const key = t.slice(0, i).trim();
      if (!/^[A-Za-z0-9_]+$/.test(key)) continue;
      let val = t.slice(i + 1).trim();
      if (val.startsWith('"')) { try { val = JSON.parse(val); } catch { val = val.replace(/^"|"$/g, ''); } }
      const r = ins.run(key, String(val));
      if (r.changes) n++;
    }
    if (n) console.log(`Настройки дополнены из settings.env: ${n} ключ${n === 1 ? '' : 'ей'}`);
    return n;
  } catch (e) { console.error('Не удалось прочитать settings.env:', e.message); return 0; }
}
// feed=0 — строка остаётся в истории карточек, но не показывается в ленте
// «Последние события компании» на рабочем столе: там нужны действия людей,
// а не поток событий из чатов
const logActivity = (text, et = null, eid = null, user = '', feed = 1) => db.prepare('INSERT INTO activities(text,entity_type,entity_id,user_name,feed) VALUES(?,?,?,?,?)').run(text, et, eid, user, feed ? 1 : 0);
// События доступа пишутся без содержимого закрытых полей и без персональных
// значений. Идентификатор ресурса нужен только для последующей проверки аудита.
function logAccess(user, action, resourceType = '', resourceId = '', method = 'GET') {
  if (!user?.id) return;
  try { db.prepare('INSERT INTO access_log(user_id,action,resource_type,resource_id,request_method) VALUES(?,?,?,?,?)')
    .run(Number(user.id), String(action).slice(0, 80), String(resourceType).slice(0, 40), String(resourceId).slice(0, 80), String(method).slice(0, 12)); }
  catch (e) { console.error('access log', e.message); }
}
function transaction(run) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = run(); db.exec('COMMIT'); return result; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
// Склонение числительных: 1 запись, 2 записи, 5 записей
const ruPlural = (n, one, few, many) => {
  const x = Math.abs(Math.round(Number(n) || 0)), l2 = x % 100, l = x % 10;
  if (l2 >= 11 && l2 <= 14) return many;
  if (l === 1) return one;
  if (l >= 2 && l <= 4) return few;
  return many;
};
// Русские названия таблиц и полей для журнала: строка вида «Массовое изменение
// (contacts): 3 записей — responsible_id» читалась как отладочный вывод
const TABLE_RU = { contacts: 'клиентов', companies: 'компаний', tasks: 'задач', deals: 'сделок', products: 'позиций каталога', templates: 'шаблонов', automations: 'правил автоматизации', notes: 'заметок', users: 'сотрудников', pipelines: 'воронок' };
const ROLE_RU = { admin: 'администратор', rop: 'руководитель отдела продаж', manager: 'менеджер', classifier: 'классификатор', viewer: 'наблюдатель', partner: 'партнёр' };
const FIELD_RU = { responsible_id: 'ответственный', responsible: 'ответственный', tags: 'теги', stage: 'этап', priority: 'приоритет', done: 'выполнение', amount: 'сумма', deadline: 'срок', active: 'активность', price: 'цена', source: 'источник', pipeline_id: 'воронка', loss_reason: 'причина проигрыша', company_id: 'компания', position: 'должность', type: 'тип', repeat: 'повтор', result: 'результат', due: 'срок', name: 'название', title: 'название', phone: 'телефон', email: 'почта', notes: 'примечание', custom: 'дополнительные поля' };
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
    const user = db.prepare('SELECT id,name,email,role,must_change_password,session_version,theme,pref_view,team_id FROM users WHERE id=? AND active=1').get(p.id);
    return user && (p.sv ?? 0) === user.session_version ? user : null;
  } catch { return null; }
}
/* Почему предъявленный токен не принят. Один и тот же ответ «требуется
   авторизация» на закрытый сеанс, отключённый доступ и истёкший срок оставляет
   сотрудника в недоумении. Причину объясняем точно и нейтрально: смена пароля
   закрывает старые сеансы независимо от того, кто её выполнил. Подпись
   проверяется прежним ключом, поэтому ответ о причине нельзя подделать. */
function sessionFailure(t) {
  try {
    const [b, sig] = String(t || '').split('.');
    if (!b || !sig) return null;
    const expected = createHmac('sha256', SECRET).update(b).digest(), got = Buffer.from(sig, 'base64url');
    if (got.length !== expected.length || !timingSafeEqual(expected, got)) return null;
    const p = JSON.parse(Buffer.from(b, 'base64url').toString());
    // Срок проверяется первым: неделя прошла у каждого, а сообщение «пароль
    // сброшен администратором» на обычном истечении пугает без причины.
    if (p.exp <= Date.now()) return { code: 'SESSION_EXPIRED', error: 'Сеанс истёк. Войдите заново.' };
    const row = db.prepare('SELECT id,active,session_version FROM users WHERE id=?').get(p.id);
    if (!row) return { code: 'USER_GONE', error: 'Учётная запись удалена. Обратитесь к администратору.' };
    if (!row.active) return { code: 'USER_DISABLED', error: 'Доступ к CRM отключён администратором: сеансы закрыты.' };
    if ((p.sv ?? 0) !== row.session_version) return { code: 'SESSION_REVOKED', error: 'Пароль этой учётной записи сменили или сбросили; старый сеанс закрыт. Войдите снова с актуальным паролем.' };
    return null;
  } catch { return null; }
}
// httpOnly-cookie сессии: токен не доступен из JavaScript и не переживает XSS
const isHttps = req => ((req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || '').toLowerCase() === 'https';
function sessionCookie(req, token) {
  return `karkas_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 86400}${isHttps(req) ? '; Secure' : ''}`;
}
const clearSessionCookie = req => `karkas_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${isHttps(req) ? '; Secure' : ''}`;
// Заголовок Cookie и имена файлов приходят снаружи: битая процент-последовательность
// (%zz и подобное) не должна ронять запрос в 500 — возвращаем строку как есть,
// а дальнейшие проверки её отсеют
const safeDecode = v => { try { return decodeURIComponent(v) } catch { return v } };
const cookieOf = req => Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=').map(safeDecode)).filter(([k]) => k));
const digits = s => String(s || '').replace(/\D/g, '').replace(/^8(?=\d{10}$)/, '7');
// Сырой номер вместо имени читается в списках как мусор: если клиент не
// представился, пишем человеком читаемый номер — по нему контакт узнаваем
const fmtPhoneRu = s => { const d = digits(s); return /^7\d{10}$/.test(d) ? '+7 ' + d.slice(1, 4) + ' ' + d.slice(4, 7) + '-' + d.slice(7, 9) + '-' + d.slice(9) : ''; };
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
// Этот рабочий этап нужен в каждой воронке. Старые базы дополняются без
// переноса сделок; этап всегда остаётся перед закрытыми колонками.
{
  const add = db.prepare('INSERT INTO stages(pipeline_id,code,name,color,sort,kind) VALUES(?,?,?,?,?,?)');
  const update = db.prepare('UPDATE stages SET name=?,color=?,sort=?,kind=? WHERE id=?');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const pipe of db.prepare('SELECT id FROM pipelines ORDER BY id').all()) {
      let stages = db.prepare('SELECT * FROM stages WHERE pipeline_id=? ORDER BY sort,id').all(pipe.id);
      let deferred = stages.find(st => st.code === 'deferred');
      if (!deferred) {
        const terminal = stages.findIndex(st => ['won','lost'].includes(st.kind));
        const sort = terminal < 0 ? stages.length : terminal;
        const result = add.run(pipe.id, 'deferred', 'Отложенный спрос', '#0284c7', sort, 'open');
        deferred = db.prepare('SELECT * FROM stages WHERE id=?').get(result.lastInsertRowid);
        stages.splice(sort, 0, deferred);
      } else {
        stages = stages.filter(st => st.id !== deferred.id);
        const terminal = stages.findIndex(st => ['won','lost'].includes(st.kind));
        stages.splice(terminal < 0 ? stages.length : terminal, 0, deferred);
      }
      stages.forEach((st, sort) => update.run(st.code === 'deferred' ? 'Отложенный спрос' : st.name,
        st.code === 'deferred' ? '#0284c7' : st.color, sort,
        st.code === 'deferred' ? 'open' : st.kind, st.id));
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e }
}


if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
  // Первый администратор начинает с временного пароля, если пароль не задан
  // сознательно: значение по умолчанию описано в документации, а пароль из
  // установщика знает тот, кто ставил систему. Пока временный пароль не заменён
  // личным, шлюз PASSWORD_CHANGE_REQUIRED не пускает ни в один раздел.
  // Требование не предъявляется к явно заданному паролю: иначе тот, кто вписал
  // в .env короткий пароль и уже работает с ним, не смог бы задать личный —
  // правило длины от 12 символов такой пароль не принимает.
  const tempAdmin = ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD ? 1 : 0;
  db.prepare('INSERT INTO users(name,email,pass,role,must_change_password) VALUES(?,?,?,?,?)').run('Администратор', ADMIN_EMAIL, hashPass(ADMIN_PASSWORD), 'admin', tempAdmin);
  if (tempAdmin) console.log(`Пароль первого администратора взят по умолчанию (${ADMIN_EMAIL} / ${DEFAULT_ADMIN_PASSWORD}). Он действует только до первого входа: система потребует задать личный пароль. Для сервера в интернете задайте ADMIN_PASSWORD в .env: openssl rand -hex 12`);
  if (!getSetting('COMPANY_NAME')) { setSetting('COMPANY_NAME', 'Каркас — каркасные дома'); setSetting('CURRENCY', '₽'); setSetting('AUTO_DEAL', '1'); setSetting('AUTO_DEAL_STAGE', 'new'); }
  logActivity('Система инициализирована: создана чистая база и учётная запись администратора');
}
export function getStages(pipeline_id = 1) { return db.prepare('SELECT * FROM stages WHERE pipeline_id=? ORDER BY sort,id').all(pipeline_id); }
// E-mail сотрудника приводится к общему виду один раз при запуске. Раньше адрес
// сохранялся как вводили, а вход искал адрес в нижнем регистре: сотрудник,
// чей адрес когда-то завели с заглавной буквы или с пробелом, вводил свой
// адрес и получал «Неверный e-mail или пароль» — выглядит как «не могу зайти».
// Запись приводится к нижнему регистру; если такой адрес уже занят, строка не
// трогается, а в журнал пишется предупреждение: решать это должен администратор.
export function normalizeUserEmails() {
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(lower(email))'); } catch {}
  const rows = db.prepare('SELECT id,email,name FROM users').all();
  const norm = r => String(r.email || '').trim().toLowerCase();
  // сколько записей претендуют на один и тот же адрес без учёта регистра:
  // если претендентов больше одного, адрес не трогаем — решает администратор
  const counts = new Map();
  for (const r of rows) counts.set(norm(r), (counts.get(norm(r)) || 0) + 1);
  let fixed = 0;
  for (const r of rows) {
    const n = norm(r);
    if (!n || n === r.email) continue;
    if ((counts.get(n) || 0) > 1) {
      console.warn(`E-mail сотрудника «${r.name}» (${r.email}) совпадает с другим адресом без учёта регистра — запись не изменена, проверьте адрес в карточке сотрудника`);
      continue;
    }
    db.prepare('UPDATE users SET email=? WHERE id=?').run(n, r.id);
    fixed++;
  }
  return fixed;
}
normalizeUserEmails();
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
// Партнёр видит только свои лиды, поэтому общий поток ему не подходит: в событии
// нового сообщения есть имя клиента и начало текста, а обновление списков зовёт
// клиента перечитать раздел, которого у партнёра нет. Партнёрским соединениям
// уходят события о его собственных диалогах и обновления тех таблиц, которые он
// действительно может перечитать.
const PARTNER_SSE_TABLES = new Set(['deals', 'contacts', 'tasks', 'notes', 'conversations', 'pipelines', 'products', 'prices', 'custom_fields', 'partner-transfers', 'partner-training', 'all']);
export function partnerSeesEvent(r, ev, data) {
  if (!r) return true;
  const d = data && typeof data === 'object' ? data : {};
  if (r.role === 'manager') {
    if (ev === 'change') return PARTNER_SSE_TABLES.has(String(d.table || '')) || ['channels', 'campaigns', 'templates'].includes(String(d.table || ''));
    if (ev === 'message') {
      const id = Number(r.userId), conversationId = Number(d.conversation_id), dealId = d.deal_id === null ? 0 : Number(d.deal_id);
      if (!Number.isSafeInteger(conversationId) || conversationId < 1
        || !Object.prototype.hasOwnProperty.call(d, 'deal_id')
        || !Number.isSafeInteger(dealId) || dealId < 0
        || !managerOwns({ id, role: 'manager' }, 'conversations', conversationId)) return false;
      // Чат общий для клиента, история — нет: у него могут быть сделки офиса
      // или другого менеджера. Проверяем область именно той записи, которая
      // изменилась, иначе превью чужого сообщения утекает через общий SSE.
      return dealId
        ? managerOwns({ id, role: 'manager' }, 'deals', dealId)
        : managerCanReadUnlinkedMessages({ id, role: 'manager' }, conversationId);
    }
    return false; // адресные уведомления идут через broadcastTo, а не общий поток
  }
  // Руководителю нужны обновления очереди и отчётов, классификатору — только
  // состояние его очереди. Сообщения несут имя и фрагмент текста клиента, а
  // эти роли не имеют доступа к переписке через API.
  if (r.role === 'rop') {
    if (ev === 'change') return ['routing', 'classification', 'partner-transfers', 'deals', 'users', 'teams', 'pipelines', 'all'].includes(String(d.table || ''));
    if (ev === 'notify') return Number(d.for_user || 0) === Number(r.userId);
    return false;
  }
  if (r.role === 'classifier') {
    if (ev === 'change') return ['routing', 'classification'].includes(String(d.table || ''));
    if (ev === 'notify') return Number(d.for_user || 0) === Number(r.userId);
    return false;
  }
  if (r.role !== 'partner') return true;
  if (ev === 'change') return PARTNER_SSE_TABLES.has(String(d.table || ''));
  if (ev === 'message') {
    const conversationId = Number(d.conversation_id), dealId = Number(d.deal_id), user = { id: Number(r.userId) };
    // Переданный клиент может одновременно иметь сделки офиса; одна общая
    // беседа не даёт партнёру права на сообщения, привязанные к чужой сделке.
    return Number.isSafeInteger(conversationId) && conversationId > 0
      && Number.isSafeInteger(dealId) && dealId > 0
      && partnerOwns(user, 'conversations', conversationId)
      && partnerOwns(user, 'deals', dealId);
  }
  if (ev === 'notify') return Number(d.for_user || 0) === Number(r.userId);
  return false;
}
export function broadcast(ev, data) {
  const s = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(r => { if (!partnerSeesEvent(r, ev, data)) return; try { r.write(s); } catch {} });
}
// Личное уведомление: «вам поставили задачу» должен увидеть только исполнитель,
// а не вся команда. Соединения знают своего пользователя (res.userId).
export function broadcastTo(userId, ev, data) {
  if (!userId) return;
  const s = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(r => { if (r.userId === Number(userId)) { try { r.write(s); } catch {} } });
}

// Единая точка публикации изменений переписки: привязываем событие к точному
// сообщению и его сделке. Контур ролей в partnerSeesEvent проверяет обе связи.
function broadcastMessage(messageId, details = {}) {
  const row = db.prepare('SELECT id,conversation_id,deal_id,direction FROM messages WHERE id=?').get(Number(messageId));
  if (!row) return false;
  broadcast('message', {
    ...(details && typeof details === 'object' ? details : {}),
    message_id: Number(row.id), conversation_id: Number(row.conversation_id),
    deal_id: row.deal_id == null ? null : Number(row.deal_id), direction: row.direction,
  });
  return true;
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
// Защита от потоковой рассылки: ошибочно созданное правило без ключевого слова
// («отвечать на каждое входящее») не должно засыпать клиента сообщениями на
// каждую строчку переписки. Одно правило отправляет в одну беседу не чаще раза
// за три часа; пропуск записывается в ленту активности, чтобы администратор
// видел причину молчания правила и мог поправить настройку.
const autoSentRecently = (a, convId) => db.prepare("SELECT id FROM messages WHERE conversation_id=? AND automation_id=? AND direction='out' AND created_at > datetime('now','-3 hours')").get(convId, a.id);
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
// ----- рассылки -----
// Сегмент получателей: фильтр по источнику, тегу, владельцу и сделке.
// Адрес берётся готовый — нормализованный телефон или e-mail; пустые отсекаются.
function campaignRecipients(aud, channel, scopeUser = null) {
  const a = aud && typeof aud === 'object' ? aud : {};
  const where = [], params = [];
  // Отправка конкретным клиентам: их выбирает сотрудник в списке контактов, а не
  // фильтр. Пустой набор означает «никому» — иначе рассылка ушла бы всей базе.
  if (Array.isArray(a.ids)) {
    const ids = [...new Set(a.ids.map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 5000);
    if (!ids.length) return [];
    where.push(`c.id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  if (a.source) { where.push('c.source=?'); params.push(String(a.source).slice(0, 60)); }
  if (a.tag) { where.push("(',' || REPLACE(c.tags,' ','') || ',') LIKE ?"); params.push(`%,${String(a.tag).replace(/[,%]/g, '').slice(0, 60)},%`); }
  if (a.owner_id) { where.push('c.responsible_id=?'); params.push(Number(a.owner_id)); }
  if (a.pipeline_id || a.stage) {
    where.push('EXISTS(SELECT 1 FROM deals dd WHERE dd.contact_id=c.id' + (a.pipeline_id ? ' AND COALESCE(dd.pipeline_id,1)=?' : '') + (a.stage ? " AND dd.stage<>'' AND dd.stage=?" : '') + ')');
    if (a.pipeline_id) params.push(Number(a.pipeline_id));
    if (a.stage) params.push(String(a.stage).slice(0, 60));
  }
  if(scopeUser?.role==='manager') { where.push(managerContactScopeSql('c')); params.push(...managerContactParams(scopeUser)); }
  // Отписавшийся клиент не попадает в рассылку этого канала — ни по сегменту,
  // ни по отмеченным вручную id. Проверка дублируется в момент отправки.
  where.push(channel === 'email' ? 'COALESCE(c.email_opt_out,0)=0' : 'COALESCE(c.whatsapp_opt_out,0)=0');
  const addr = channel === 'email' ? "NULLIF(TRIM(c.email),'')" : 'c.phone_norm';
  const sql = `SELECT c.id, c.name, ${addr} AS address FROM contacts c ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.id`;
  return db.prepare(sql).all(...params).filter(r => r.address);
}
// Одно сообщение рассылки: канал, подстановка {имя}, запись в переписку клиента.
async function campaignSendOne(camp, it) {
  const contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(it.contact_id);
  const author = camp.created_by_id ? db.prepare('SELECT role FROM users WHERE id=?').get(camp.created_by_id) : null;
  if(author?.role==='manager'&&contact&&!managerOwns({id:Number(camp.created_by_id)},'contacts',contact.id)) {
    const error='Клиент больше не закреплён за автором рассылки';
    db.prepare("UPDATE campaign_items SET status='failed',error=?,sent_at=datetime('now') WHERE id=?").run(error,it.id);
    db.prepare("UPDATE campaigns SET failed=(SELECT COUNT(*) FROM campaign_items WHERE campaign_id=? AND status='failed') WHERE id=?").run(camp.id,camp.id);
    return;
  }
  const firstName = String(contact?.name || '').trim().split(/\s+/)[0] || '';
  const text = String(camp.message).replace(/\{имя\}|\{name\}/giu, firstName).trim();
  let status = 'failed', error = '';
  try {
    if (!contact) throw new Error('Клиент удалён');
    if (!text) throw new Error('Пустой текст');
    // Отписка могла прийти после создания рассылки: проверяем ещё раз перед
    // отправкой, иначе запланированная рассылка ушла бы отписавшемуся.
    if (camp.channel === 'email' && Number(contact.email_opt_out) === 1) throw new Error('Клиент отписался от почтовых рассылок');
    if (camp.channel !== 'email' && Number(contact.whatsapp_opt_out) === 1) throw new Error('Клиент отписался от рассылок в мессенджерах');
    if (camp.channel === 'email') {
      if (!contact.email) throw new Error('У клиента нет e-mail');
      const settings = smtpSettings();
      const mailText = text + '\n\n—\nЕсли не хотите получать рассылки, ответьте «Отписка».';
      const listUnsubscribe = settings.from ? `<mailto:${settings.from}?subject=unsubscribe>` : '';
      await sendMail({ ...settings, to: contact.email, toName: contact.name || undefined, subject: camp.subject || camp.name, text: mailText, listUnsubscribe });
      const conv = db.prepare('SELECT id FROM conversations WHERE contact_id=?').get(contact.id);
      if (conv) {
        const message = db.prepare("INSERT INTO messages(conversation_id,channel,direction,body,subject,status,author) VALUES(?,?,?,?,?,'sent','Рассылка')").run(conv.id, 'email', 'out', text, camp.subject || camp.name);
        db.prepare("UPDATE conversations SET last_at=datetime('now') WHERE id=?").run(conv.id);
        broadcastMessage(message.lastInsertRowid);
      }
    } else {
      let conv = db.prepare('SELECT cv.*,c.phone FROM conversations cv LEFT JOIN contacts c ON c.id=cv.contact_id WHERE cv.contact_id=?').get(contact.id);
      if (!conv) {
        const chatId = digits(contact.phone || '');
        if (!chatId) throw new Error('У клиента нет телефона');
        const r = db.prepare("INSERT INTO conversations(contact_id,title,channels,channel_id,external_chat_id,chat_type,assigned_id,last_at) VALUES(?,?,?,?,?,?,?,datetime('now'))")
          .run(contact.id, contact.name || 'Клиент', 'whatsapp', '', chatId, 'whatsapp', contact.responsible_id || null);
        conv = db.prepare('SELECT cv.*,c.phone FROM conversations cv LEFT JOIN contacts c ON c.id=cv.contact_id WHERE cv.id=?').get(r.lastInsertRowid);
      }
      const send = await deliver(conv, conv.chat_type || 'whatsapp', text, { id: camp.created_by_id, name: camp.created_by });
      if (!send.delivered) throw new Error(send.hint || 'Канал не подключён');
      const message = db.prepare("INSERT INTO messages(conversation_id,channel,direction,body,status,author) VALUES(?,?,?,?,?,?)")
        .run(conv.id, conv.chat_type || 'whatsapp', 'out', text, 'sent', 'Рассылка');
      db.prepare("UPDATE conversations SET last_at=datetime('now') WHERE id=?").run(conv.id);
      broadcastMessage(message.lastInsertRowid);
    }
    status = 'sent';
  } catch (e) { error = String(e.message || e).slice(0, 300); }
  db.prepare("UPDATE campaign_items SET status=?, error=?, sent_at=datetime('now') WHERE id=?").run(status, error, it.id);
  db.prepare("UPDATE campaigns SET sent=(SELECT COUNT(*) FROM campaign_items WHERE campaign_id=? AND status='sent'), failed=(SELECT COUNT(*) FROM campaign_items WHERE campaign_id=? AND status='failed') WHERE id=?").run(camp.id, camp.id, camp.id);
}
// Очередь рассылок: за такт — небольшая порция, между сообщениями пауза,
// чтобы мессенджер не принял поток за спам. После перезапуска сервера
// недоотправленная рассылка продолжается: статус живёт в базе.
let campaignBusy = false;
async function campaignTick() {
  if (campaignBusy) return;
  campaignBusy = true;
  try {
    for (const c of db.prepare("SELECT id,scheduled_at FROM campaigns WHERE status='scheduled' AND scheduled_at IS NOT NULL").all()) {
      const t = new Date(String(c.scheduled_at));
      if (!isNaN(t.getTime()) && t.getTime() <= Date.now()) { db.prepare("UPDATE campaigns SET status='queued' WHERE id=?").run(c.id); broadcast('change', { table: 'campaigns' }); }
    }
    const camp = db.prepare("SELECT * FROM campaigns WHERE status IN ('queued','running') ORDER BY id LIMIT 1").get();
    if (!camp) return;
    if (camp.status === 'queued') { db.prepare("UPDATE campaigns SET status='running' WHERE id=?").run(camp.id); broadcast('change', { table: 'campaigns' }); }
    const items = db.prepare("SELECT * FROM campaign_items WHERE campaign_id=? AND status='queued' ORDER BY id LIMIT 4").all(camp.id);
    for (const it of items) {
      if (db.prepare("SELECT status FROM campaigns WHERE id=?").get(camp.id)?.status === 'canceled') return;
      await campaignSendOne(camp, it);
      await new Promise(r => setTimeout(r, camp.channel === 'email' ? 500 : 1200));
    }
    const left = db.prepare("SELECT COUNT(*) n FROM campaign_items WHERE campaign_id=? AND status='queued'").get(camp.id).n;
    if (!left && db.prepare('SELECT status FROM campaigns WHERE id=?').get(camp.id)?.status === 'running') {
      const cnt = db.prepare("SELECT COALESCE(SUM(status='sent'),0) s, COALESCE(SUM(status='failed'),0) f FROM campaign_items WHERE campaign_id=?").get(camp.id);
      db.prepare("UPDATE campaigns SET status='done', sent=?, failed=? WHERE id=?").run(cnt.s, cnt.f, camp.id);
      logActivity(`Рассылка «${camp.name}» завершена: отправлено ${cnt.s}, с ошибками ${cnt.f}`, 'campaigns', camp.id, camp.created_by);
      broadcast('change', { table: 'campaigns' });
    }
  } catch (e) { console.error('Очередь рассылок:', e.message); }
  finally { campaignBusy = false; }
}
async function applyAction(a, ctx) {
  // Правило, сработавшее из чата, не пишется в ленту компании: иначе в активный
  // день на рабочем столе стоят только строки автоматизации. Полная история
  // сохраняется в журнале и видна в карточках сделки и клиента.
  const alog = (t, et = null, eid = null, user = '') => logActivity(t, et, eid, user, ctx.quiet ? 0 : 1);
  {
      if (a.action_type === 'create_task') {
        if (!ctx.contact_id && !ctx.deal_id) return;
        const owner = (ctx.deal_id && db.prepare('SELECT responsible_id FROM deals WHERE id=?').get(ctx.deal_id)?.responsible_id)
          || (ctx.contact_id && db.prepare('SELECT responsible_id FROM contacts WHERE id=?').get(ctx.contact_id)?.responsible_id) || null;
        const r = db.prepare('INSERT INTO tasks(title,due,contact_id,deal_id,responsible_id) VALUES(?,?,?,?,?)')
          .run(a.action_value || a.name, normalizeDue('сегодня'), ctx.contact_id || null, ctx.deal_id || null, owner);
        alog(`Автоматизация «${a.name}»: создана задача`, 'tasks', Number(r.lastInsertRowid));
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
        alog(`Автоматизация «${a.name}»: сделка «${d.title}» → этап «${st.name}»`, 'deals', d.id);
        broadcast('change', { table: 'deals' });
      }
      if (a.action_type === 'add_tag' && ctx.contact_id && a.action_value) {
        const c = db.prepare('SELECT tags FROM contacts WHERE id=?').get(ctx.contact_id);
        if (!c) return;
        const tags = [...new Set([...(c.tags || '').split(',').map(x => x.trim()).filter(Boolean), a.action_value])].join(',');
        if (tags === (c.tags || '')) return;
        db.prepare('UPDATE contacts SET tags=? WHERE id=?').run(tags, ctx.contact_id);
        alog(`Автоматизация «${a.name}»: клиенту добавлен тег «${a.action_value}»`, 'contacts', ctx.contact_id);
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
            alog(`Автоматизация «${a.name}»: сделка «${d.title}» передана сотруднику ${u.name}`, 'deals', d.id);
            if (Number(u.id) !== Number(ctx.actor_id)) broadcastTo(u.id, 'notify', { type: 'deal_assigned', id: d.id, title: d.title });
            changed = true;
          }
        }
        if (ctx.contact_id) {
          const c = db.prepare('SELECT id,name,responsible_id FROM contacts WHERE id=?').get(ctx.contact_id);
          if (c && Number(c.responsible_id) !== u.id) {
            db.prepare('UPDATE contacts SET responsible_id=? WHERE id=?').run(u.id, c.id);
            alog(`Автоматизация «${a.name}»: клиент «${c.name}» передан сотруднику ${u.name}`, 'contacts', c.id);
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
        if (!conv) { alog(`Автоматизация «${a.name}»: переписки с клиентом нет, сообщение не отправлено`, 'contacts', ctx.contact_id || null); return; }
        if (autoSentRecently(a, conv.id)) { alog(`Автоматизация «${a.name}»: клиенту уже уходило сообщение этого правила меньше трёх часов назад — повтор пропущен`, 'contacts', ctx.contact_id || null); return; }
        const channel = conv.chat_type || '';
        let status = 'error';
        try {
          const send = await deliver(conv, channel, body, null);
          status = send.delivered ? 'sent' : 'local';
        } catch (e) {
          // без подключённого Wazzup текст остаётся в переписке: правило не «молчит»
          status = String(e.message) === 'WAZZUP_NOT_CONFIGURED' ? 'local' : 'error';
          alog(`Автоматизация «${a.name}»: сообщение клиенту не ушло — ${e.message}`, 'contacts', ctx.contact_id || null);
        }
        const message = db.prepare('INSERT INTO messages(conversation_id,channel,direction,body,status,author,automation_id) VALUES(?,?,?,?,?,?,?)')
          .run(conv.id, channel || 'whatsapp', 'out', body, status, 'Автоматизация', a.id);
        db.prepare("UPDATE conversations SET last_at=datetime('now') WHERE id=?").run(conv.id);
        broadcastMessage(message.lastInsertRowid);
        if (status === 'sent') alog(`Автоматизация «${a.name}»: клиенту отправлено сообщение`, 'contacts', ctx.contact_id || null);
      }
      // отправить письмо: тема — название правила, текст — значение действия
      if (a.action_type === 'send_email') {
        const c = ctx.contact_id ? db.prepare('SELECT id,name,email FROM contacts WHERE id=?').get(ctx.contact_id) : null;
        if (!c?.email) { alog(`Автоматизация «${a.name}»: у клиента нет e-mail, письмо не отправлено`, 'contacts', ctx.contact_id || null); return; }
        if (!getSetting('SMTP_HOST')) { alog(`Автоматизация «${a.name}»: почта не настроена, письмо не отправлено`, 'contacts', c.id); return; }
        const body = fillVars(a.action_value, autoVars(ctx)).trim();
        const conv = db.prepare('SELECT id FROM conversations WHERE contact_id=?').get(c.id);
        if (conv && autoSentRecently(a, conv.id)) { alog(`Автоматизация «${a.name}»: клиенту уже уходило письмо этого правила меньше трёх часов назад — повтор пропущен`, 'contacts', c.id); return; }
        let status = 'sent';
        try { await sendMail({ ...smtpSettings(), to: c.email, toName: c.name || undefined, subject: a.name, text: body }); }
        catch (e) { status = 'error'; alog(`Автоматизация «${a.name}»: письмо не ушло — ${e.message}`, 'contacts', c.id); }
        if (conv) {
          const message = db.prepare("INSERT INTO messages(conversation_id,channel,direction,body,subject,status,author,automation_id) VALUES(?,?,?,?,?,?,?,?)")
            .run(conv.id, 'email', 'out', body, a.name, status, 'Автоматизация', a.id);
          db.prepare("UPDATE conversations SET last_at=datetime('now') WHERE id=?").run(conv.id);
          broadcastMessage(message.lastInsertRowid);
        }
        if (status === 'sent') alog(`Автоматизация «${a.name}»: клиенту отправлено письмо на ${c.email}`, 'contacts', c.id);
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
        db.prepare('INSERT INTO automation_queue(automation_id,trigger_type,deal_id,contact_id,run_at,quiet) VALUES(?,?,?,?,?,?)')
          .run(a.id, trigger, ctx.deal_id || null, ctx.contact_id || null, runAt, ctx.quiet ? 1 : 0);
        logActivity(`Автоматизация «${a.name}»: сработает ${ruDate(runAt)}, через ${delay} дн.`,
          ctx.deal_id ? 'deals' : 'contacts', ctx.deal_id || ctx.contact_id || null, '', ctx.quiet ? 0 : 1);
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
    try { await applyAction(a, { deal_id: q.deal_id, contact_id: q.contact_id, quiet: !!q.quiet }) }
    catch (e) { console.error('automation queue', e) }
  }
  return due.length;
}

// ---------- unified inbox ----------
// Распределение обращений опирается только на открытую смену. Старый алгоритм
// выбирал сотрудника по общему числу сделок и мог назначить лид ночью или в
// выходной. Настройки специализации пусты по умолчанию: без классификации они
// не угадываются и не направляют клиента не тому сотруднику.
function routeTokens(value) { return String(value || '').split(/[;,\n]/).map(x => x.trim().toLocaleLowerCase('ru-RU')).filter(Boolean); }
function defaultQueueTeamId() {
  const configured=Number(getSetting('ROUTING_DEFAULT_TEAM_ID','0'))||0;
  if(configured&&db.prepare('SELECT 1 x FROM teams WHERE id=? AND active=1').get(configured))return configured;
  const teams=db.prepare('SELECT id FROM teams WHERE active=1 ORDER BY id').all();
  return teams.length===1?Number(teams[0].id):null;
}
function openDealLoad(userId) {
  return Number(db.prepare("SELECT COUNT(*) n FROM deals WHERE responsible_id=? AND stage NOT IN ('won','lost')").get(Number(userId))?.n || 0);
}
function shiftFor(userId) { return db.prepare('SELECT * FROM shift_sessions WHERE user_id=? AND ended_at IS NULL').get(Number(userId)) || null; }
function routeContext(dealId) {
  return db.prepare(`SELECT d.id,d.title,d.stage,d.pipeline_id,d.contact_id,d.responsible_id,d.priority,
      COALESCE(r.queue_status,CASE WHEN d.responsible_id IS NULL THEN 'queued' ELSE 'assigned' END) queue_status,
      r.priority queue_priority,r.queue_team_id,lc.region,lc.direction,lc.status classification_status
    FROM deals d LEFT JOIN lead_routing r ON r.deal_id=d.id
    LEFT JOIN lead_classifications lc ON lc.deal_id=d.id WHERE d.id=?`).get(Number(dealId));
}
function routeUserEligible(deal, user, { requireShift = true, enforceLoad = true } = {}) {
  if (!deal || !user || Number(user.active) !== 1 || user.role !== 'manager') return false;
  if (requireShift && !shiftFor(user.id)) return false;
  if (deal.queue_team_id && Number(deal.queue_team_id) !== Number(user.team_id || 0)) return false;
  if (deal.contact_id) {
    const contact = db.prepare('SELECT responsible_id FROM contacts WHERE id=?').get(deal.contact_id);
    if (contact?.responsible_id && Number(contact.responsible_id) !== Number(user.id)) return false;
  }
  const regions = routeTokens(user.routing_regions), directions = routeTokens(user.routing_directions);
  if (regions.length && (!deal.region || !regions.includes(String(deal.region).trim().toLocaleLowerCase('ru-RU')))) return false;
  if (directions.length && (!deal.direction || !directions.includes(String(deal.direction).trim().toLocaleLowerCase('ru-RU')))) return false;
  const cap = Number(user.max_open_leads) || 0;
  if (enforceLoad && cap > 0 && openDealLoad(user.id) >= cap) return false;
  return true;
}
function assignmentEvent(dealId, eventType, fromId, toId, actor, source, reason) {
  db.prepare(`INSERT INTO lead_assignment_events(deal_id,event_type,from_user_id,to_user_id,actor_id,actor_name,source,reason)
    VALUES(?,?,?,?,?,?,?,?)`).run(Number(dealId), eventType, fromId || null, toId || null, Number(actor?.id) || 0,
      String(actor?.name || 'Система').slice(0, 120), String(source || 'system').slice(0, 20), String(reason || '').slice(0, 500));
}
function assignLeadInTransaction(deal, assignee, actor, reason, source = 'routing', options = {}) {
  if (!deal?.id || !assignee || !routeUserEligible(deal, assignee, options)) return false;
  const changed = db.prepare(`UPDATE deals SET responsible_id=?,responsible=?,updated_at=datetime('now')
    WHERE id=? AND responsible_id IS NULL AND stage NOT IN ('won','lost')`).run(assignee.id, assignee.name, deal.id);
  if (!changed.changes) return false;
  if (deal.contact_id) db.prepare('UPDATE contacts SET responsible_id=? WHERE id=? AND responsible_id IS NULL').run(assignee.id, deal.contact_id);
  if (deal.contact_id) db.prepare('UPDATE conversations SET assigned_id=? WHERE contact_id=? AND assigned_id IS NULL').run(assignee.id, deal.contact_id);
  db.prepare(`UPDATE lead_routing SET queue_status='assigned',queued_at=NULL,assigned_at=datetime('now'),
    first_assigned_at=COALESCE(first_assigned_at,datetime('now')),first_assigned_user_id=COALESCE(first_assigned_user_id,?),
    queue_team_id=COALESCE(queue_team_id,?),last_reason=? WHERE deal_id=?`).run(assignee.id,assignee.team_id || null, String(reason || '').slice(0, 500), deal.id);
  db.prepare('UPDATE shift_sessions SET last_assigned_at=datetime(\'now\') WHERE user_id=? AND ended_at IS NULL').run(assignee.id);
  assignmentEvent(deal.id, 'assigned', deal.responsible_id, assignee.id, actor, source, reason);
  return true;
}
function activeRoutingCandidates(deal, preferredId = 0) {
  const rows = db.prepare(`SELECT u.* FROM users u JOIN shift_sessions s ON s.user_id=u.id AND s.ended_at IS NULL
    WHERE u.active=1 AND u.role='manager' ORDER BY s.last_assigned_at IS NOT NULL,s.last_assigned_at,u.id`).all();
  const eligible = rows.filter(user => routeUserEligible(deal, user));
  eligible.sort((a,b) => {
    const preferred=Number(preferredId)||0;
    if(preferred){
      const orderA=Number(a.id)===preferred?0:1,orderB=Number(b.id)===preferred?0:1;
      if(orderA!==orderB)return orderA-orderB;
    }
    return openDealLoad(a.id) - openDealLoad(b.id)
      || String(shiftFor(a.id)?.last_assigned_at || '').localeCompare(String(shiftFor(b.id)?.last_assigned_at || ''))
      || Number(a.id) - Number(b.id);
  });
  return eligible;
}
function dispatchQueuedLead(dealId, preferredId = 0, actor = null, reason = 'Новое обращение во время активной смены') {
  if (getSetting('AUTO_ASSIGN', '0') !== '1') return null;
  return transaction(() => {
    const deal = routeContext(dealId);
    if (!deal || deal.responsible_id || ['won','lost'].includes(deal.stage)) return null;
    const assignee = activeRoutingCandidates(deal, preferredId)[0];
    if (!assignee || !assignLeadInTransaction(deal, assignee, actor, reason, 'auto')) return null;
    return assignee;
  });
}
function nextManager() {
  const users = db.prepare("SELECT id,name FROM users WHERE active=1 AND role='manager' ORDER BY id").all();
  if (!users.length) return null;
  return users.map(u => ({ u, n: openDealLoad(u.id), shift: shiftFor(u.id) })).filter(x => x.shift)
    .sort((a,b) => a.n-b.n || String(a.shift.last_assigned_at || '').localeCompare(String(b.shift.last_assigned_at || '')) || a.u.id-b.u.id)[0]?.u || null;
}
function shiftStart(user) {
  return transaction(() => {
    let shift = shiftFor(user.id);
    if (shift) return { shift, created: false, assigned: [] };
    const r = db.prepare("INSERT INTO shift_sessions(user_id) VALUES(?)").run(Number(user.id));
    shift = db.prepare('SELECT * FROM shift_sessions WHERE id=?').get(r.lastInsertRowid);
    const assigned = [];
    const rawLimit = Number(getSetting('SHIFT_BACKLOG_LIMIT', '5'));
    const limit = Number.isFinite(rawLimit) ? Math.max(0, Math.min(5, Math.trunc(rawLimit))) : 5;
    if (getSetting('AUTO_ASSIGN', '0') === '1' && limit) {
      const queued = db.prepare(`SELECT d.id FROM deals d JOIN lead_routing r ON r.deal_id=d.id
        WHERE r.queue_status='queued' AND d.responsible_id IS NULL AND d.stage NOT IN ('won','lost')
        ORDER BY CASE r.priority WHEN 'urgent' THEN 0 ELSE 1 END,r.queued_at,d.id LIMIT 500`).all();
      const manager = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
      for (const row of queued) {
        if (assigned.length >= limit) break;
        const deal = routeContext(row.id);
        if (!routeUserEligible(deal, manager, { requireShift: true })) continue;
        if (assignLeadInTransaction(deal, manager, user, 'Лид из очереди при начале смены', 'shift')) assigned.push(Number(row.id));
      }
    }
    db.prepare("UPDATE shift_sessions SET night_batch_at=datetime('now') WHERE id=?").run(shift.id);
    return { shift: db.prepare('SELECT * FROM shift_sessions WHERE id=?').get(shift.id), created: true, assigned };
  });
}
function shiftEnd(user, reason) {
  return transaction(() => {
    const shift = shiftFor(user.id);
    if (!shift) return { shift: null, returned: [], retained: [] };
    const deals = db.prepare("SELECT d.id,d.contact_id,r.first_response_at FROM deals d LEFT JOIN lead_routing r ON r.deal_id=d.id WHERE d.responsible_id=? AND d.stage NOT IN ('won','lost') ORDER BY d.id").all(user.id);
    const returned = [], retained = [];
    for (const deal of deals) {
      if (deal.first_response_at) { retained.push(Number(deal.id)); continue; }
      const changed = db.prepare('UPDATE deals SET responsible_id=NULL,responsible=NULL,updated_at=datetime(\'now\') WHERE id=? AND responsible_id=?').run(deal.id,user.id);
      if (!changed.changes) continue;
      if (deal.contact_id) {
        const other = db.prepare("SELECT 1 x FROM deals WHERE contact_id=? AND responsible_id=? AND stage NOT IN ('won','lost') AND id<>? LIMIT 1").get(deal.contact_id,user.id,deal.id);
        if (!other) {
          db.prepare('UPDATE contacts SET responsible_id=NULL WHERE id=? AND responsible_id=?').run(deal.contact_id,user.id);
          db.prepare('UPDATE conversations SET assigned_id=NULL WHERE contact_id=? AND assigned_id=?').run(deal.contact_id,user.id);
        }
      }
      db.prepare("UPDATE lead_routing SET queue_status='queued',queued_at=datetime('now'),last_reason=? WHERE deal_id=?").run(String(reason).slice(0,500),deal.id);
      assignmentEvent(deal.id,'returned',user.id,null,user,'shift-close',reason);
      returned.push(Number(deal.id));
    }
    db.prepare("UPDATE shift_sessions SET ended_at=datetime('now'),end_reason=? WHERE id=? AND ended_at IS NULL").run(String(reason).slice(0,500),shift.id);
    return { shift: db.prepare('SELECT * FROM shift_sessions WHERE id=?').get(shift.id), returned, retained };
  });
}
export async function ensureDeal(contact) {
  if (getSetting('AUTO_DEAL', '1') !== '1' || !contact) return null;
  const open = db.prepare("SELECT id FROM deals WHERE contact_id=? AND stage NOT IN ('won','lost') ORDER BY id DESC LIMIT 2").all(contact.id);
  if (open.length) return open.length === 1 ? Number(open[0].id) : null;
  const firstStage = getStages(1)[0]?.code || 'new';
  const wantedStage = getSetting('AUTO_DEAL_STAGE', '');
  const stage = (wantedStage && db.prepare('SELECT 1 x FROM stages WHERE code=? AND pipeline_id=1').get(wantedStage)) ? wantedStage : firstStage;
  const stageName = (getStages(1).find(x => x.code === stage) || {}).name || stage;
  // Обращение сначала записывается в очередь. Назначение ниже требует открытой
  // смены и подходящей нагрузки; найденный ранее ответственный или канал сам по
  // себе не означает, что сотрудник сейчас работает.
  const dr = db.prepare(`INSERT INTO deals(title,amount,deal_object,land_status,construction_date,payment_type,lead_source,stage,pipeline_id,contact_id,responsible,responsible_id)
    VALUES(?,0,'Не уточнён','unknown','unknown','unknown',?,?,?,?,?,NULL)`).run('Обращение: ' + contact.name,contact.source||'unknown',stage,1,contact.id,'');
  const id = Number(dr.lastInsertRowid);
  const intakeTeam=defaultQueueTeamId();
  if(intakeTeam)db.prepare('UPDATE lead_routing SET queue_team_id=? WHERE deal_id=?').run(intakeTeam,id);
  const classifierId=Number(getSetting('LEAD_CLASSIFIER_USER_ID','0'))||0;
  if(classifierId&&db.prepare("SELECT 1 x FROM users WHERE id=? AND active=1 AND role='classifier'").get(classifierId))
    db.prepare("INSERT OR IGNORE INTO lead_classifications(deal_id,classifier_id,status) VALUES(?,?,'pending')").run(id,classifierId);
  const preferred = Number(contact.preferred_manager_id || contact.responsible_id || 0);
  const assigned = dispatchQueuedLead(id, preferred, null, 'Новое обращение во время активной смены');
  if (assigned) broadcastTo(assigned.id, 'notify', { type: 'deal_assigned', id, title: 'Обращение: ' + contact.name });
  logActivity(`Новое обращение «${contact.name}» → сделка в этапе «${stageName}»${assigned ? `, назначена ${assigned.name}` : ', оставлена в очереди до начала подходящей смены'}`, 'deals', id, '', 0);
  await runAutomations('deal_created', { deal_id: id, contact_id: contact.id, quiet: true });
  broadcast('change', { table: 'deals' });
  return id;
}

// Адрес вложения приходит и из внешних вебхуков: в базу пишем только http(s)
// или наш /uploads/. Другие схемы интерфейс и так не рисует, а мусор в
// хранении не нужен — пустая строка вместо javascript:-адреса.
const safeContentUri = v => (/^(https?:\/\/|\/uploads\/)/i.test(String(v || '')) ? String(v) : '');
function messageTimeInstant(value, requireZone = false) {
  const raw=String(value??'').trim();
  if(!raw||raw.length>64)return NaN;
  const match=raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:?\d{2})?$/i);
  if(!match)return NaN;
  const [,year,month,day,hour,minute,second,fraction='',zone='']=match;
  if(requireZone&&!zone)return NaN;
  if(zone&&zone.toUpperCase()!=='Z'){
    const digits=zone.slice(1).replace(':','');
    const offsetHours=Number(digits.slice(0,2)),offsetMinutes=Number(digits.slice(2,4));
    if(offsetHours>14||offsetMinutes>59||(offsetHours===14&&offsetMinutes!==0))return NaN;
  }
  const parts=[Number(year),Number(month),Number(day),Number(hour),Number(minute),Number(second)];
  const check=new Date(0);check.setUTCFullYear(parts[0],parts[1]-1,parts[2]);check.setUTCHours(parts[3],parts[4],parts[5],Number(fraction.padEnd(3,'0'))||0);
  if(check.getUTCFullYear()!==parts[0]||check.getUTCMonth()!==parts[1]-1||check.getUTCDate()!==parts[2]
    ||check.getUTCHours()!==parts[3]||check.getUTCMinutes()!==parts[4]||check.getUTCSeconds()!==parts[5])return NaN;
  // Webhook timestamps without an offset are ambiguous; only internal database
  // timestamps (known to be UTC by schema contract) are parsed without one.
  const input=raw.replace(' ','T')+(zone?'':'Z');
  const instant=Date.parse(input);
  return Number.isFinite(instant)?instant:NaN;
}
function normalizeMessageEventTime(value) {
  const instant=messageTimeInstant(value,true);
  if(!Number.isFinite(instant))return '';
  return new Date(instant).toISOString().slice(0,23).replace('T',' ').replace(/\.000$/,'');
}
function storedMessageTimeInstant(value) {
  return messageTimeInstant(value,false);
}
function qLocalMessageDay(value) {
  const instant=storedMessageTimeInstant(value);
  return Number.isFinite(instant)?localDate(new Date(instant)):'';
}

export async function upsertIncoming({ channel = 'whatsapp', chatType = '', phone = '', chatId = '', name = '', body = '', external_id = null, channelId = '', contentUri = '', contentName = '', author = '', email = '', subject = '', direction = 'in', eventAt = '' }) {
  contentUri = safeContentUri(contentUri);
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
  // групповой чат привязан к адресу чата, а не к участнику: иначе сообщение
  // каждого участника заводило бы собственную беседу и история группы
  // разлеталась бы по карточкам. Беседу ищем сначала по адресу чата.
  let conv = chatId ? db.prepare('SELECT * FROM conversations WHERE external_chat_id=?').get(String(chatId)) : null;
  if (!contact && conv) contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(conv.contact_id);
  // имя пришло позже карточки: карточка успела завестись по одному номеру и
  // выглядела телефонным номером. Как только отправитель представился —
  // поправляем имя на карточке, чтобы клиент был подписан по-человечески.
  if (contact && name && /^[\d\s()+-]{7,}$/.test(String(contact.name || '').trim())) { db.prepare('UPDATE contacts SET name=? WHERE id=?').run(name, contact.id); contact.name = name; }
  if (!contact) { const r = db.prepare('INSERT INTO contacts(name,phone,email,source,phone_norm) VALUES(?,?,?,?,?)').run(String(name || fmtPhoneRu(ph) || ph || chatId || email || 'Новый клиент').slice(0, 120), String(ph || '').slice(0, 64), String(email || '').slice(0, 254), channel === 'email' ? 'email' : 'wazzup-' + (chatType || channel), phNorm || null); contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(r.lastInsertRowid); logActivity(`Новый контакт (${channel === 'email' ? 'email' : chatType || channel}): ${contact.name}`, 'contacts', contact.id, '', 0); }
  // Отписка от рассылок: клиент отвечает «Отписка» (или жмёт List-Unsubscribe
  // в письме). Отмечаем канал и больше не включаем его в рассылки. Само
  // сообщение сохраняется в переписке как обычное входящее.
  if (direction !== 'out' && /отписк|unsubscribe|не\s+писать|(^|[^а-яёa-z])стоп([^а-яёa-z]|$)/i.test(String(body || '') + ' ' + String(subject || ''))) {
    const col = channel === 'email' ? 'email_opt_out' : 'whatsapp_opt_out';
    if (Number(contact[col]) !== 1) {
      db.prepare(`UPDATE contacts SET ${col}=1 WHERE id=?`).run(contact.id);
      contact[col] = 1;
      logActivity(`Клиент «${contact.name || 'без имени'}» отписался от рассылок (${channel === 'email' ? 'почта' : 'мессенджеры'})`, 'contacts', contact.id, '', 0);
    }
  }
  // Привязанный к аккаунту сотрудник — предпочтительный кандидат, но канал не
  // заменяет правила смены и пригодности: если владелец не работает, лид остаётся
  // в очереди и назначается только по правилам активной смены.
  const boundId = channelId ? Number(db.prepare('SELECT user_id FROM channels WHERE external_id=?').get(String(channelId))?.user_id) || 0 : 0;
  if (boundId) {
    const bound = db.prepare("SELECT id,name FROM users WHERE id=? AND active=1 AND role='manager'").get(boundId);
    if (bound) contact.preferred_manager_id = bound.id;
  }
  if (!conv) conv = db.prepare('SELECT * FROM conversations WHERE contact_id=?').get(contact.id);
  let dealId = null;
  if (!conv) {
    const r = db.prepare('INSERT INTO conversations(contact_id,title,channels,channel_id,external_chat_id,chat_type) VALUES(?,?,?,?,?,?)').run(contact.id, contact.name, channel, channelId, String(chatId || ph || ''), chatType || channel);
    conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(r.lastInsertRowid);
  }
  const channels = [...new Set([...(conv.channels || '').split(',').filter(Boolean), channel])].join(',');
  // Ретраи вендора и двойная доставка: Wazzup повторяет событие, если ответ
  // задержался или потерялся, а групповое сообщение порой приходит дважды и
  // с разными идентификаторами — уникальный индекс такое не ловит, в чате
  // вырастал второй такой же пузырь. Проверяем содержимое за короткое окно
  // независимо от того, пришёл идентификатор или нет.
  const eventTime=normalizeMessageEventTime(eventAt);
  const sameText = body || '[вложение]';
  if(external_id){
    const existing=db.prepare('SELECT id,event_at FROM messages WHERE external_id=?').get(external_id);
    if(existing){
      if(eventTime&&!existing.event_at)db.prepare("UPDATE messages SET event_at=?,event_time_source='provider' WHERE id=?").run(eventTime,existing.id);
      return conv;
    }
  }
  const recent = db.prepare("SELECT id,event_at FROM messages WHERE conversation_id=? AND direction=? AND body=? AND COALESCE(content_uri,'')=? AND created_at > datetime('now','-120 seconds')").get(conv.id, direction, sameText, contentUri);
  if (recent) {
    if(eventTime&&!recent.event_at)db.prepare("UPDATE messages SET event_at=?,event_time_source='provider' WHERE id=?").run(eventTime,recent.id);
    return conv;
  }
  // собственное отправление вернулось групповой доставкой: пузырь уже стоит
  // справа, «входящая» копия продублировала бы его и запустила автоматизации
  if (direction !== 'out') {
    const own = db.prepare("SELECT id FROM messages WHERE conversation_id=? AND direction='out' AND body=? AND COALESCE(content_uri,'')=? AND created_at > datetime('now','-120 seconds')").get(conv.id, sameText, contentUri);
    if (own) return conv;
  }
  if (!dealId) dealId = await ensureDeal(contact);
  if (!dealId) {
    const openDeals = db.prepare("SELECT id FROM deals WHERE contact_id=? AND stage NOT IN ('won','lost') ORDER BY id DESC LIMIT 2").all(contact.id);
    if (openDeals.length === 1) dealId = Number(openDeals[0].id);
  }
  if (dealId && direction !== 'out') {
    const current = routeContext(dealId);
    if (current?.queue_status === 'queued' && !current.responsible_id) {
      const assigned = dispatchQueuedLead(dealId, boundId || contact.responsible_id || 0, null, 'Повторное сообщение по сделке в активную смену');
      if (assigned) broadcastTo(assigned.id, 'notify', { type: 'deal_assigned', id: Number(dealId), title: current.title || contact.name });
    }
  }
  let inserted;
  try { inserted = db.prepare('INSERT INTO messages(conversation_id,deal_id,channel,direction,body,subject,content_uri,content_name,status,external_id,author,channel_id,event_at,event_time_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(conv.id, dealId, channel, direction, body || '[вложение]', subject, contentUri, contentName || null, direction === 'out' ? 'sent' : (channel === 'email' ? 'received' : 'inbound'), external_id, author, channelId || null, eventTime || null, eventTime ? 'provider' : ''); }
  catch (e) { if (/UNIQUE/i.test(e.message)) return conv; console.error('message insert', e); throw e; }
  if (dealId && direction !== 'out' && eventTime) {
    const first = db.prepare("SELECT COUNT(*) n FROM messages WHERE deal_id=? AND direction='in'").get(dealId).n === 1;
    if (first) db.prepare("UPDATE lead_routing SET received_at=?,received_time_source='provider' WHERE deal_id=? AND received_time_source='crm'").run(eventTime, dealId);
  }
  queueAttachmentDownload(conv.id, contentUri, external_id);
  db.prepare("UPDATE conversations SET channels=?,channel_id=COALESCE(NULLIF(?,''),channel_id),external_chat_id=COALESCE(NULLIF(?,''),external_chat_id),chat_type=COALESCE(NULLIF(?,''),chat_type),last_at=datetime('now') WHERE id=?").run(channels, channelId, String(chatId || ''), chatType, conv.id);
  // Ответ из второй CRM сохранён: автоматизации входящих не запускаются и
  // уведомление не показывается — это сообщение своей команды, не клиента
  if (direction === 'out') {
    broadcastMessage(inserted.lastInsertRowid);
    return conv;
  }
  const openDeal = db.prepare("SELECT id FROM deals WHERE contact_id=? AND stage NOT IN ('won','lost') ORDER BY id DESC").get(contact.id);
  await runAutomations('message_in', { contact_id: contact.id, deal_id: dealId || openDeal?.id, text: body, quiet: true });
  // в событии есть имя и превью: интерфейс показывает понятное уведомление
  // всплывающее уведомление о чужом клиенте мешало бы остальным: событие
  // помечается адресатом, а интерфейс сам решит, кому показать
  const forUser = Number(conv.assigned_id) || Number(contact.responsible_id) || 0;
  broadcastMessage(inserted.lastInsertRowid, { title: contact.name || conv.title || 'Клиент', preview: String(body || '').slice(0, 90), for_user: forUser || null, channel });
  return conv;
}

// Исходящее из другой CRM или мобильного приложения вендора: для Wazzup это
// тот же чат, поэтому сохраняем и у себя — история должна быть полной.
async function upsertOutgoing(m) {
  const body = wzBody(m) || '';
  if (!body && !m.contentUri) return null;
  const chatType = normChatType(m.chatType);
  const channel = wzChannel(chatType);
  let conv = m.chatId ? db.prepare('SELECT * FROM conversations WHERE external_chat_id=?').get(String(m.chatId)) : null;
  if (!conv) {
    const phNorm = digits(m.cli?.phone || '');
    if (phNorm) {
      const c = db.prepare('SELECT * FROM contacts WHERE phone_norm=?').get(phNorm) || db.prepare('SELECT * FROM contacts WHERE phone_norm=?').get('7' + phNorm.slice(-10));
      if (c) conv = db.prepare('SELECT * FROM conversations WHERE contact_id=?').get(c.id);
    }
  }
  // беседы нет — клиент написал впервые, а ответили ему из другой CRM:
  // заводим карточку и беседу обычным механизмом входящих
  if (!conv) return upsertIncoming({ channel, chatType, phone: m.cli?.phone || '', chatId: m.recipient?.chat_id || m.chatId || '', name: m.cli?.name || '', body, contentUri: m.contentUri || '', contentName: m.fileName || '', external_id: m.messageId || null, channelId: m.channelId || '', author: m.authorName || '', direction: 'out', eventAt:m.eventAt || '' });
  const eventTime=normalizeMessageEventTime(m.eventAt);
  if(m.messageId){
    const existing=db.prepare('SELECT id,event_at,direction FROM messages WHERE external_id=?').get(m.messageId);
    if(existing){
      if(existing.direction!=='out')db.prepare("UPDATE messages SET direction='out',status=?,author=?,channel=?,channel_id=?,event_at=COALESCE(event_at,?),event_time_source=CASE WHEN COALESCE(event_at,?) IS NOT NULL THEN 'provider' ELSE event_time_source END WHERE id=?").run(['sent','delivered','read'].includes(m.status)?m.status:'sent',m.authorName||'',channel,m.channelId||'',eventTime||null,eventTime||null,existing.id);
      else if(eventTime&&!existing.event_at)db.prepare("UPDATE messages SET event_at=?,event_time_source='provider' WHERE id=?").run(eventTime,existing.id);
      return conv;
    }
  }
  const st = ['sent', 'delivered', 'read'].includes(m.status) ? m.status : 'sent';
  const openDeals = db.prepare("SELECT id FROM deals WHERE contact_id=? AND stage NOT IN ('won','lost') ORDER BY id DESC LIMIT 2").all(conv.contact_id);
  const dealId = openDeals.length === 1 ? Number(openDeals[0].id) : null;
  // ретраи без идентификатора: та же защита, что у входящих
  if (!m.messageId) {
    const recent = db.prepare("SELECT id,event_at FROM messages WHERE conversation_id=? AND direction='out' AND body=? AND created_at > datetime('now','-120 seconds')").get(conv.id, body || '[вложение]');
    if (recent) {
      if(eventTime&&!recent.event_at)db.prepare("UPDATE messages SET event_at=?,event_time_source='provider' WHERE id=?").run(eventTime,recent.id);
      return conv;
    }
  }
  // Эхо догоняет случайную групповую доставку: сообщение уже попало в чат
  // входящим (пузырь слева). Второй пузырь не создаём — переносим имеющийся
  // на свою сторону и ставим статус доставки. Берём только безымянные копии
  // или копии с именем отправителя эха: настоящую цитату клиента не трогаем.
  const stray = db.prepare("SELECT id, author FROM messages WHERE conversation_id=? AND direction='in' AND body=? AND COALESCE(content_uri,'')=? AND created_at > datetime('now','-120 seconds') ORDER BY id").get(conv.id, body || '[вложение]', safeContentUri(m.contentUri) || '');
  if (stray && (!stray.author || !m.authorName || stray.author === m.authorName)) {
    const outDup = db.prepare("SELECT id FROM messages WHERE conversation_id=? AND direction='out' AND body=? AND created_at > datetime('now','-120 seconds')").get(conv.id, body || '[вложение]');
    if (!outDup) {
      try { db.prepare("UPDATE messages SET direction='out', status=?, external_id=?, author=?, event_at=COALESCE(event_at,?), event_time_source=CASE WHEN COALESCE(event_at,?) IS NOT NULL THEN 'provider' ELSE event_time_source END WHERE id=?").run(st, m.messageId || null, m.authorName || '', eventTime || null, eventTime || null, stray.id); }
      catch (e) { if (/UNIQUE/i.test(e.message)) return conv; throw e; }
      db.prepare("UPDATE conversations SET last_at=datetime('now') WHERE id=?").run(conv.id);
      broadcastMessage(stray.id);
      return conv;
    }
  }
  let inserted;
  try {
    inserted = db.prepare('INSERT INTO messages(conversation_id,deal_id,channel,direction,body,content_uri,content_name,status,external_id,author,channel_id,event_at,event_time_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(conv.id, dealId, channel, 'out', body || '[вложение]', safeContentUri(m.contentUri), m.fileName || '', st, m.messageId || null, m.authorName || '', m.channelId || '',eventTime||null,eventTime?'provider':'');
  } catch (e) { if (/UNIQUE/i.test(e.message)) return conv; throw e; }
  db.prepare("UPDATE conversations SET last_at=datetime('now') WHERE id=?").run(conv.id);
  queueAttachmentDownload(conv.id, safeContentUri(m.contentUri), m.messageId || null);
  broadcastMessage(inserted.lastInsertRowid);
  return conv;
}

// Вложения Wazzup лежат на сервере вендора и со временем перестают открываться —
// в истории остаётся пустой пузырь. Забираем файл к себе фоном: ответ вебхуку
// уходит сразу, а когда копия скачана, ссылка подменяется на локальную.
const ATTACH_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv', 'application/zip': 'zip', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/3gpp': '3gp', 'video/x-msvideo': 'avi',
  'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a', 'audio/x-wav': 'wav', 'audio/x-aac': 'aac', 'audio/x-opus+ogg': 'ogg', 'audio/aac': 'aac', 'audio/amr': 'amr', 'audio/webm': 'weba' };
// Вложение забираем только с публичных адресов: ссылка из вебхука не должна
// становиться способом заглянуть на внутренние ресурсы сервера (SSRF).
// Перенаправления проходим вручную и каждый адрес проверяем заново.
function ipv6Groups(raw) {
  const ip = String(raw || '').split('%')[0].toLowerCase();
  if (!ip.includes(':')) return null;
  let source = ip;
  // DNS может вернуть IPv4 в записи IPv6. Разбираем её явно, чтобы запись
  // с внутренним IPv4 не обошла проверку диапазонов.
  if (source.includes('.')) {
    const last = source.slice(source.lastIndexOf(':') + 1).split('.').map(Number);
    if (last.length !== 4 || last.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    source = source.slice(0, source.lastIndexOf(':')) + ':' + ((last[0] << 8) | last[1]).toString(16) + ':' + ((last[2] << 8) | last[3]).toString(16);
  }
  const parts = source.split('::');
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  if (left.concat(right).some(x => !/^[0-9a-f]{1,4}$/.test(x))) return null;
  const missing = 8 - left.length - right.length;
  if ((parts.length === 1 && missing !== 0) || (parts.length === 2 && missing < 1)) return null;
  return [...left.map(x => parseInt(x,16)), ...Array(missing).fill(0), ...right.map(x => parseInt(x,16))];
}
const isPublicIp = ip => {
  if (!ip || String(ip).includes('%')) return false;
  if (String(ip).includes(':')) {
    const g = ipv6Groups(ip);
    if (!g || g.length !== 8) return false;
    // Общедоступный IPv6 находится в 2000::/3. Отдельно блокируем сети
    // документации, служебные диапазоны, 6to4 и известный префикс NAT64.
    if (g[0] < 0x2000 || g[0] > 0x3fff) return false;
    if (g[0] === 0x2001 && (g[1] <= 0x01ff || g[1] === 0x0db8)) return false;
    if (g[0] === 0x2002 || g[0] === 0x3fff) return false;
    if (g[0] === 0x0064 && g[1] === 0xff9b) return false;
    return true;
  }
  const octets = String(ip).split('.').map(Number);
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a,b,c,d] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;             // служебная сеть провайдеров
  if (a === 169 && b === 254) return false;                       // link-local
  if (a === 172 && b >= 16 && b <= 31) return false;               // private
  if (a === 192 && (b === 0 || b === 2 || b === 168)) return false; // служебная, тестовая и частная сеть
  if (a === 192 && b === 88 && c === 99) return false;             // устаревший ретранслятор
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false; // тестовая сеть
  if (a === 203 && b === 0 && c === 113) return false;
  if (a === 255 && b === 255 && c === 255 && d === 255) return false;
  return true;
};
async function safeRemoteUrl(raw) {
  let url; try { url = new URL(String(raw)); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  if (url.hostname.startsWith('[')) return null; // IPv6 передаём только как проверенную DNS-запись
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(url.hostname)) return null;
  const defaultPort = url.protocol === 'https:' ? '443' : '80';
  if (url.port && url.port !== defaultPort) return null;
  const ips = await dnsLookup(url.hostname, { all: true }).catch(() => []);
  // Проверяется каждый адрес; выбранный адрес передаётся HTTP-клиенту напрямую,
  // чтобы подмена DNS между проверкой и скачиванием не обошла фильтр SSRF.
  const publicIps = ips.filter(i => isPublicIp(i.address));
  if (!ips.length || publicIps.length !== ips.length) return null;
  return { url, address: publicIps[0].address };
}
// node:net передаёт lookup({ all:true }) при Happy Eyeballs (Node 20+).
// Возвращать нужно список записей, а не legacy-пару address/family, иначе
// скачивание вложений падает с ERR_INVALID_IP_ADDRESS на актуальном Node.js.
export function pinnedDnsLookup(address) {
  const family = String(address).includes(':') ? 6 : 4;
  return (_hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    const result = { address: String(address), family };
    const args = options?.all ? [null, [result]] : [null, result.address, result.family];
    process.nextTick(() => callback(...args));
  };
}
function requestPublicAttachment(url, address) {
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve,reject)=>{
    let settled=false,timer;
    const fail=e=>{ if(settled)return; settled=true; clearTimeout(timer); reject(e); };
    const req=client.request({
      protocol:url.protocol,hostname:url.hostname,port:url.port||undefined,
      path:url.pathname+url.search,method:'GET',
      headers:{'User-Agent':'KarkasCRM attachment fetch',Accept:'*/*','Accept-Encoding':'identity'},
      // Подключаемся ровно к проверенному IP; имя сервера TLS и сертификат при этом
      // сверяются с исходным доменом хранилища.
      lookup:pinnedDnsLookup(address),
      ...(url.protocol==='https:'?{servername:url.hostname}:{}),
    },res=>{
      if(settled){res.destroy();return;}
      settled=true;
      // Таймер действует до конца тела ответа, а не только до заголовков.
      res.once('end',()=>clearTimeout(timer));
      res.once('close',()=>clearTimeout(timer));
      resolve(res);
    });
    timer=setTimeout(()=>req.destroy(new Error('Ссылка на файл не ответила за 15 секунд')),15000);
    timer.unref?.();
    req.on('error',fail);
    req.end();
  });
}
/* Файл вложения появляется в папке uploads уже готовым: пишем во временное имя
   и переименовываем. Без этого сбой в момент записи оставляет обрезанный файл,
   а сообщение в базе уже ссылается на него — в чате открывается битая картинка.
   Недописанные остатки убирает ночная чистка сиротских файлов. */
function storeUpload(stored, buf) {
  const dest = join(UPLOAD_DIR, stored);
  const tmp = dest + '.part';
  writeFileSync(tmp, buf);
  renameSync(tmp, dest);
  return '/uploads/' + stored;
}
// Вложения скачиваются ограниченным числом потоков. Даже при 50 сотрудниках
// несколько крупных записей не должны одновременно занять всю память контейнера.
const ATTACH_FETCH_LIMIT = 4;
const ATTACH_FETCH_QUEUE_LIMIT = 128;
let attachFetchActive = 0;
const attachFetchWaiters = [];
const attachPending = new Set();
async function acquireAttachmentSlot() {
  if (attachFetchActive >= ATTACH_FETCH_LIMIT) {
    if (attachFetchWaiters.length >= ATTACH_FETCH_QUEUE_LIMIT) return false;
    await new Promise(resolve => attachFetchWaiters.push(resolve));
  }
  attachFetchActive++;
  return true;
}
function releaseAttachmentSlot() {
  attachFetchActive = Math.max(0, attachFetchActive - 1);
  attachFetchWaiters.shift()?.();
}
async function fetchAttachment(uri) {
  if (!await acquireAttachmentSlot()) {
    const e = new Error('Очередь загрузки вложений занята. Подождите и повторите попытку.');
    e.statusCode = 503;
    throw e;
  }
  try {
    let target = await safeRemoteUrl(uri);
    if (!target) return null;
    let res = null;
    for (let hop = 0; hop < 3; hop++) {
      res = await requestPublicAttachment(target.url, target.address);
      if ([301,302,303,307,308].includes(Number(res.statusCode))) {
        const loc = res.headers.location;
        res.resume();
        if (!loc) return null;
        const next = new URL(loc, target.url);
        if (target.url.protocol === 'https:' && next.protocol !== 'https:') return null;
        target = await safeRemoteUrl(next.toString());
        if (!target) return null;
        continue;
      }
      break;
    }
    if (!res || res.statusCode !== 200) { res?.resume(); return null; }
    const maxBytes = 15 * 1024 * 1024;
    if (Number(res.headers['content-length'] || 0) > maxBytes) { res.destroy(); return null; }
    // Content-Length у CDN может отсутствовать или лгать: читаем поток с жёстким
    // пределом, чтобы одна ссылка из вебхука не заняла всю память сервера.
    const chunks = []; let total = 0;
    try {
      for await (const chunk of res) {
        total += chunk.length;
        if (total > maxBytes) { res.destroy(); return null; }
        chunks.push(Buffer.from(chunk));
      }
    } catch { return null; }
    if (!total) return null;
    const buf = Buffer.concat(chunks, total);
    const ct = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = ATTACH_EXT[ct] || (String(uri).match(/\.(png|jpe?g|gif|webp|svg|pdf|txt|csv|zip|docx?|xlsx?|mp4|m4v|webm|mov|3gp|avi|mp3|ogg|opus|wav|weba|m4a|aac|amr)(?:\?|$)/i)?.[1] || 'bin').toLowerCase();
    const stored = `${localDate().replace(/-/g, '')}-${randomBytes(6).toString('hex')}-wazzup.${ext}`;
    mkdir(UPLOAD_DIR, { recursive: true });
    return storeUpload(stored, buf);
  } finally { releaseAttachmentSlot(); }
}
/* Ссылка вендора живёт несколько часов: если файл не успели забрать, в чате
   остаётся адрес, который уже не открывается. Повторная загрузка возвращает
   вложение в CRM — файл ложится в uploads и сообщение ссылается на него. */
async function refetchAttachment(messageId) {
  const m = db.prepare('SELECT * FROM messages WHERE id=?').get(messageId);
  if (!m) return { status: 404, body: { error: 'Сообщение не найдено' } };
  const uri = String(m.content_uri || '');
  if (!uri) return { status: 400, body: { error: 'У сообщения нет вложения' } };
  if (!/^https?:\/\//i.test(uri)) return { status: 400, body: { error: 'Файл уже сохранён в CRM' } };
  const key = 'message:' + Number(messageId);
  if (attachPending.has(key)) return { status: 409, body: { error: 'Этот файл уже загружается в CRM. Подождите несколько секунд и обновите чат.' } };
  attachPending.add(key);
  try {
    let local;
    try { local = await fetchAttachment(uri); }
    catch (e) {
      if (e.statusCode === 503) return { status: 503, body: { error: e.message } };
      return { status: 502, body: { error: 'Не удалось получить файл с источника. Ссылка могла устареть; попросите клиента отправить файл ещё раз.' } };
    }
    if (!local) return { status: 502, body: { error: 'Источник не отдал файл: ссылка устарела или недоступна. Попросите клиента отправить его ещё раз.' } };
    db.prepare('UPDATE messages SET content_uri=? WHERE id=?').run(local, messageId);
    let size = null, type = null;
    try {
      const st = statSync(join(UPLOAD_DIR, basename(local)));
      if (st.isFile()) { size = st.size; db.prepare('UPDATE messages SET content_size=? WHERE id=?').run(size, messageId); }
      type = MIME[extname(local).toLowerCase()] || null;
      if (type) db.prepare('UPDATE messages SET content_type=? WHERE id=?').run(type, messageId);
    } catch { }
    return {
      status: 200,
      body: { saved: true, url: local, size, contentType: type, message: db.prepare('SELECT * FROM messages WHERE id=?').get(messageId) },
    };
  } finally { attachPending.delete(key); }
}
function queueAttachmentDownload(convId, uri, externalId) {
  if (!externalId || !/^https?:\/\//i.test(String(uri || ''))) return;
  const rowId = db.prepare('SELECT id FROM messages WHERE external_id=? AND content_uri=?').get(externalId, uri)?.id;
  const pendingKey = rowId ? 'message:' + Number(rowId) : 'external:' + externalId;
  if (attachPending.has(pendingKey)) return;
  attachPending.add(pendingKey);
  setTimeout(async () => {
    try {
      const local = await fetchAttachment(uri);
      if (!local) return;
      const r = db.prepare('UPDATE messages SET content_uri=? WHERE external_id=? AND content_uri=?').run(local, externalId, uri);
      if (r.changes) {
        // размер скачанного файла сразу уезжает в сообщение: чип в чате
        // показывает «смета.pdf · 2,4 МБ», а не безликое «вложение»
        try {
          const st = statSync(join(UPLOAD_DIR, basename(local)));
          if (st.isFile()) db.prepare('UPDATE messages SET content_size=? WHERE external_id=? AND content_uri=?').run(st.size, externalId, local);
          const type = MIME[extname(local).toLowerCase()];
          if (type) db.prepare('UPDATE messages SET content_type=? WHERE external_id=? AND content_uri=?').run(type, externalId, local);
        } catch { }
        const updated = db.prepare('SELECT id FROM messages WHERE external_id=? AND content_uri=?').get(externalId, local);
        if (updated) broadcastMessage(updated.id);
      }
    } catch { /* ссылка вендора осталась — показываем её как есть */ }
    finally { attachPending.delete(pendingKey); }
  }, 50);
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
// Снимок базы, безопасный при параллельных записях: VACUUM INTO создаёт
// атомарный согласованный файл. Прямое копирование crm.db таким свойством
// не обладает: автоматический checkpoint может писать в основной файл во
// время копирования, и снимок получится рваным.
function snapshotDb(target) {
  const tmp = target + '.part';
  try {
    try { unlinkSync(tmp) } catch {}
    db.exec(`VACUUM INTO '${String(tmp).replace(/'/g, "''")}'`);
    renameSync(tmp, target);
  } catch {
    // запасной путь прежний: checkpoint и прямое копирование
    try { unlinkSync(tmp) } catch {}
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch {}
    copyFileSync(join(DATA_DIR, 'crm.db'), target);
  }
  return target;
}
function makeBackup(force = false) {
  const dir = join(DATA_DIR, 'backups'); mkdir(dir, { recursive: true });
  const name = `crm-${localDate()}.db`;
  const target = join(dir, name);
  if (!force && existsSync(target)) return null;
  snapshotDb(target);
  const keep = Number(getSetting('BACKUP_KEEP_DAYS', '7')) || 0;
  if (keep > 0) {
    const limit = Date.now() - keep * 864e5;
    for (const f of readdirSync(dir).filter(x => x.endsWith('.db'))) { try { if (statSync(join(dir, f)).mtimeMs < limit) unlinkSync(join(dir, f)) } catch {} }
    // обрывок прерванного снимка не должен лежать вечно: чистим старые .part
    for (const f of readdirSync(dir).filter(x => x.endsWith('.part'))) { try { if (statSync(join(dir, f)).mtimeMs < Date.now() - 864e5) unlinkSync(join(dir, f)) } catch {} }
  }
  logActivity(`Резервная копия базы создана: ${name}`);
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
  // ключи в списке приходят от внешнего хранилища: битая процент-последовательность
  // в одном старом ключе не должна ломать всю чистку (иначе копии копятся вечно)
  const unesc = v => safeDecode(String(v).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
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
  // имя копии приходит из запроса: без проверки «../../» позволила бы прочитать
  // любой файл (crm.db, .env) и отправить его во внешнее хранилище.
  // Тот же шаблон имени, что у скачивания и восстановления копии.
  if (!/^[A-Za-z0-9._-]+\.db$/.test(String(name || ''))) {
    setSetting('S3_LAST_ERROR', 'некорректное имя копии');
    return { ok: false, error: 'некорректное имя копии' };
  }
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
    logActivity(`Резервная копия ${name} выгружена в хранилище${pruned.removed ? `, старых удалено: ${pruned.removed}` : ''}`);
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
  const list = overdue.map(t => ({ id: t.id, title: t.title, due: t.due, contact: t.contact_name || '', responsible_id: t.responsible_id }));
  logActivity(`Просроченные задачи: ${list.length} (${list.map(t => t.title).slice(0, 3).join('; ')})`);
  // Адресная рассылка: каждому сотруднику приходят только его собственные
  // просрочки и неназначенные (их должен кто-то взять). Раньше полный список
  // уходил всем подключённым, а клиент отсекал чужие задачи — названия чужих
  // дел текли через поток без надобности.
  const unassigned = list.filter(t => !t.responsible_id);
  const byUser = new Map();
  for (const t of list) if (t.responsible_id) {
    const k = Number(t.responsible_id);
    if (!byUser.has(k)) byUser.set(k, []);
    byUser.get(k).push(t);
  }
  for (const c of [...clients]) {
    // неназначенные дела разбирает офис: партнёр со своим входом их не видит
    const tasks = [...(byUser.get(Number(c.userId)) || []), ...(c.role === 'partner' ? [] : unassigned)];
    if (!tasks.length) continue;
    try { c.write(`event: notify\ndata: ${JSON.stringify({ type: 'overdue_tasks', count: tasks.length, tasks })}\n\n`); } catch {}
  }
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
        try {
          db.prepare("DELETE FROM access_log WHERE created_at<datetime('now','-180 days')").run();
          db.prepare('DELETE FROM access_log WHERE id NOT IN (SELECT id FROM access_log ORDER BY id DESC LIMIT 200000)').run();
        } catch(e) { console.error('access log maintenance',e.message); }
        // Статистика для планировщика запросов сохраняется ежедневно, а не
        // только при штатной остановке: контейнер могут убить сигналом, и
        // тогда SQLite не останется без данных об индексах
        try { db.exec('PRAGMA optimize') } catch {}
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
  // Строка документа округляется до рубля, а итог складывается из округлённых
  // строк. При дробном количестве иначе «Итого» расходится со сложением строк,
  // и бухгалтерия возвращает счёт; сумма сделки в базе считается тем же правилом.
  const lineSum = x => Math.round((Number(x.price) || 0) * (Number(x.qty) || 0));
  const sum = items.reduce((a, x) => a + lineSum(x), 0);
  const vat = Math.round(sum * 20 / 120);
  // Префикс задаёт пользователь, разделитель добавляет документ. Хвостовой дефис
  // убираем, чтобы и «КП», и «К-» давали «КП-0001» и «К-0001», а не «К--0001».
  const prefix = String(company.doc_prefix || 'КП').trim().replace(/[-\s]+$/, '');
  const number = `${prefix}-${String(deal.id).padStart(4, '0')}`;
  const rows = items.map((x, i) => `<tr><td>${i + 1}</td><td>${escHtml(x.name)}</td><td>шт</td><td class="r">${money(x.price, company.currency)}</td><td class="r">${x.qty}</td><td class="r">${money(lineSum(x), company.currency)}</td></tr>`).join('');
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
// Сброс счётчиков попыток входа: проверки должны убедиться и в блокировке
// подбора, и в том, что она не мешает работе офиса, а ждать пять минут окна
// внутри прогона нельзя. В рабочем режиме счётчики гасит удачный вход.
export function clearLoginAttempts() {
  for (const k of [...RL.keys()]) if (k.startsWith('login')) RL.delete(k);
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
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.zip': 'application/zip', '.txt': 'text/plain', '.csv': 'text/csv', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.3gp': 'video/3gpp', '.avi': 'video/x-msvideo', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.weba': 'audio/webm', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.amr': 'audio/amr', '.patch': 'text/plain', '.diff': 'text/plain',
  // записи звонков, голосовые и видео из мессенджеров: без своего типа файл
  // отдаётся как application/octet-stream и браузер не умеет его проигрывать
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.3gp': 'video/3gpp',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.amr': 'audio/amr' };
const IMAGE_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const CHAT_UPLOADS_AT_ONCE = 8;
let chatUploadsActive = 0;
const FILE_UPLOAD_TYPES = [...IMAGE_UPLOAD_TYPES, 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // видео и звук: менеджер отправляет клиенту ролик объекта или голосовое,
  // а РОП прикладывает к сделке запись звонка
  'video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp', 'video/x-msvideo',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/amr'];
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
  /^\/api\/custom-fields(\/.*)?$/, /^\/api\/competitor-sources(\/.*)?$/, /^\/api\/teams(\/.*)?$/,
  /^\/api\/backups(\/.*)?$/, /^\/api\/integrations(\/.*)?$/, /^\/api\/prices\/ours(\/.*)?$/,
  /^\/api\/demo\/cleanup$/, /^\/api\/channels(\/.*)?$/, /^\/api\/automation-queue(\/.*)?$/,
];
// Отказ по правам понятнее, если сказать, что именно закрыто и что делать вместо этого.
const ADMIN_ONLY_HINT = [
  [/^\/api\/prices\/ours(\/.*)?$/, 'Прайс-лист меняет только администратор. Позицию, которой нет в каталоге, можно добавить прямо в сделку.'],
];
// Партнёр видит карточку только по активной передаче в разрешённой воронке и
// на одном из согласованных этапов. Пустые настройки закрывают доступ полностью.
const partnerAllowedStages = () => new Set(String(getSetting('PARTNER_TRANSFER_ALLOWED_STAGES') || '').split(',').map(x => x.trim()).filter(Boolean));
const partnerPipelineId = () => Number(getSetting('PARTNER_TRANSFER_PIPELINE_ID', '0')) || 0;
function partnerTransferForDeal(user, dealId) {
  const pid = partnerPipelineId(), stages = partnerAllowedStages();
  if (!pid || !stages.size) return null;
  const d = db.prepare(`SELECT d.id,d.contact_id,d.pipeline_id,d.stage,pt.id transfer_id,pt.partner_id
    FROM deals d JOIN partner_transfers pt ON pt.deal_id=d.id AND pt.active=1
    WHERE d.id=? AND pt.partner_id=?`).get(Number(dealId), Number(user.id));
  return d && Number(d.pipeline_id) === pid && stages.has(String(d.stage)) ? d : null;
}
function partnerDealView(row) {
  const fields=['id','title','amount','deal_object','land_status','construction_date','payment_type','lead_source',
    'stage','pipeline_id','contact_id','company_id','priority','deadline','created_at','updated_at',
    'contact_name','contact_phone','contact_email','company_name','tasks_open','next_task_due'];
  return Object.fromEntries(fields.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]));
}
function revokeInvalidPartnerTransfers(actor, reason='Настройки разрешённой передачи изменены') {
  const active=db.prepare('SELECT id,deal_id,partner_id FROM partner_transfers WHERE active=1').all();
  const invalid=active.filter(row=>!partnerTransferForDeal({id:Number(row.partner_id)},row.deal_id));
  if(!invalid.length)return 0;
  transaction(()=>{for(const row of invalid){
    db.prepare("UPDATE partner_transfers SET active=0,revoked_at=datetime('now') WHERE id=? AND active=1").run(row.id);
    db.prepare(`INSERT INTO lead_assignment_events(deal_id,event_type,from_user_id,to_user_id,actor_id,actor_name,source,reason)
      VALUES(?,'partner_revoked',?,NULL,?,?,?,?)`).run(row.deal_id,row.partner_id,Number(actor?.id)||0,String(actor?.name||'Система'),String(actor?.role||'system'),reason);
  }});
  return invalid.length;
}
function partnerTransferForContact(user, contactId) {
  const pid = partnerPipelineId(), stages = partnerAllowedStages();
  if (!pid || !stages.size) return null;
  const rows = db.prepare(`SELECT d.id deal_id,d.contact_id,d.pipeline_id,d.stage,pt.id transfer_id
    FROM deals d JOIN partner_transfers pt ON pt.deal_id=d.id AND pt.active=1
    WHERE d.contact_id=? AND pt.partner_id=? ORDER BY pt.id DESC`).all(Number(contactId), Number(user.id));
  const allowed = rows.filter(r => Number(r.pipeline_id) === pid && stages.has(String(r.stage)));
  const activeForContact=Number(db.prepare(`SELECT COUNT(*) n FROM deals d JOIN partner_transfers pt ON pt.deal_id=d.id
    WHERE d.contact_id=? AND pt.active=1`).get(Number(contactId)).n)||0;
  // Один общий чат нельзя безопасно разделить между несколькими переданными
  // сделками или партнёрами. Не отдаём его целиком, даже при старых конфликтных данных.
  return allowed.length === 1 && activeForContact === 1 ? allowed[0] : null;
}
// Партнёрский контур намеренно не опирается на responsible_id: только активная
// передача открывает сделку, сообщения, задачи и вложения. Связанные записи
// проверяются по той же переданной сделке, не по всему клиенту.
export function partnerOwns(user, table, id) {
  const uid = Number(user.id), tid = Number(id);
  if (!tid) return false;
  if (table === 'deals') return !!partnerTransferForDeal(user, tid);
  if (table === 'contacts') return !!db.prepare('SELECT 1 x FROM contacts WHERE id=?').get(tid) && !!partnerTransferForContact(user, tid);
  if (table === 'tasks') {
    const task = db.prepare('SELECT deal_id FROM tasks WHERE id=?').get(tid);
    return !!task?.deal_id && !!partnerTransferForDeal(user, task.deal_id);
  }
  if (table === 'notes') { const n = db.prepare('SELECT entity_type,entity_id FROM notes WHERE id=?').get(tid); return !!n && n.entity_type === 'deals' && partnerOwns(user, 'deals', n.entity_id); }
  if (table === 'conversations') {
    const cv = db.prepare('SELECT contact_id FROM conversations WHERE id=?').get(tid);
    return !!cv && !!partnerTransferForContact(user, cv.contact_id);
  }
  return false;
}
// Менеджер работает только с назначенными ему сделками и их связанными карточками.
// Для старых записей без ответственного контакт считается своим только тогда, когда
// у него нет сделок другого менеджера. Конфликтные связи остаются администратору.
const managerDealScopeSql = a => `(${a}.responsible_id=? OR (${a}.responsible_id IS NULL AND EXISTS(
  SELECT 1 FROM contacts owner_contact WHERE owner_contact.id=${a}.contact_id AND owner_contact.responsible_id=?
))) AND (${a}.contact_id IS NULL OR EXISTS (
  SELECT 1 FROM contacts mc WHERE mc.id=${a}.contact_id AND (
    mc.responsible_id=? OR (mc.responsible_id IS NULL AND NOT EXISTS (
      SELECT 1 FROM deals other_deal JOIN users other_owner ON other_owner.id=other_deal.responsible_id
      WHERE other_deal.contact_id=mc.id AND other_owner.role='manager' AND other_deal.responsible_id<>?
    ))
  )
))`;
const managerContactScopeSql = a => `(${a}.responsible_id=? OR (${a}.responsible_id IS NULL
  AND EXISTS(SELECT 1 FROM deals owned_deal WHERE owned_deal.contact_id=${a}.id AND owned_deal.responsible_id=?)
  AND NOT EXISTS(
    SELECT 1 FROM deals other_deal JOIN users other_owner ON other_owner.id=other_deal.responsible_id
    WHERE other_deal.contact_id=${a}.id AND other_owner.role='manager' AND other_deal.responsible_id<>?
  )
))`;
const managerDealParams = user => { const id = Number(user.id); return [id, id, id, id] };
const managerContactParams = user => { const id=Number(user.id); return [id,id,id] };
const managerCompanyScopeSql = a => `(${a}.responsible_id=? OR EXISTS(
  SELECT 1 FROM contacts mc WHERE mc.company_id=${a}.id AND ${managerContactScopeSql('mc')}
) OR EXISTS(SELECT 1 FROM deals md WHERE md.company_id=${a}.id AND ${managerDealScopeSql('md')}))`;
const managerCompanyParams = user => [Number(user.id), ...managerContactParams(user), ...managerDealParams(user)];
const managerConversationScopeSql = (cv='cv', c='c') => `(${managerContactScopeSql(c)} OR (${c}.responsible_id IS NULL AND ${cv}.assigned_id=?))`;
const managerConversationParams = user => [...managerContactParams(user), Number(user.id)];
const managerUnlinkedMessageContextSql=(cv='cv',c='c')=>`((${cv}.assigned_id=? OR ${c}.responsible_id=?)
  AND NOT EXISTS(SELECT 1 FROM deals unlinked_other WHERE unlinked_other.contact_id=${cv}.contact_id
    AND unlinked_other.responsible_id IS NOT NULL AND unlinked_other.responsible_id<>?))`;
const managerUnlinkedMessageSql=(m='m',cv='cv',c='c')=>`(${m}.deal_id IS NULL AND ${managerUnlinkedMessageContextSql(cv,c)})`;
const managerUnlinkedMessageParams=user=>[Number(user.id),Number(user.id),Number(user.id)];
function managerCanReadUnlinkedMessages(user,conversationId){
  const userId=Number(user?.id),id=Number(conversationId);
  if(user?.role!=='manager'||!Number.isSafeInteger(userId)||userId<1||!Number.isSafeInteger(id)||id<1)return false;
  // Use the same predicate as list/unread queries. LEFT JOIN is intentional:
  // older/imported chats can have no contact row; their assigned manager still
  // owns the unlinked messages, while a deal owned by someone else stays private.
  return !!db.prepare(`SELECT 1 x FROM conversations cv LEFT JOIN contacts c ON c.id=cv.contact_id
    WHERE cv.id=? AND ${managerUnlinkedMessageContextSql('cv','c')}`)
    .get(id,...managerUnlinkedMessageParams({id:userId}));
}
const managerTaskScopeSql = a => {
  const ownedDeals = `SELECT md.id FROM deals md WHERE ${managerDealScopeSql('md')}`;
  const ownedContacts = `SELECT mc.id FROM contacts mc WHERE ${managerContactScopeSql('mc')}`;
  return `((${a}.responsible_id=? OR ${a}.deal_id IN (${ownedDeals}) OR ${a}.contact_id IN (${ownedContacts}))
    AND (${a}.deal_id IS NULL OR ${a}.deal_id IN (${ownedDeals}))
    AND (${a}.contact_id IS NULL OR ${a}.contact_id IN (${ownedContacts})))`;
};
const managerTaskParams = user => [Number(user.id), ...managerDealParams(user), ...managerContactParams(user), ...managerDealParams(user), ...managerContactParams(user)];
export function managerOwns(user, table, id) {
  const uid = Number(user.id), tid = Number(id);
  if (!tid) return false;
  if (table === 'deals') return !!db.prepare(`SELECT 1 x FROM deals d WHERE d.id=? AND ${managerDealScopeSql('d')}`).get(tid, ...managerDealParams(user));
  if (table === 'contacts') return !!db.prepare(`SELECT 1 x FROM contacts c WHERE c.id=? AND ${managerContactScopeSql('c')}`).get(tid, ...managerContactParams(user));
  if (table === 'companies') return !!db.prepare(`SELECT 1 x FROM companies co WHERE co.id=? AND ${managerCompanyScopeSql('co')}`).get(tid, ...managerCompanyParams(user));
  if (table === 'tasks') return !!db.prepare(`SELECT 1 x FROM tasks t WHERE t.id=? AND ${managerTaskScopeSql('t')}`).get(tid, ...managerTaskParams(user));
  if (table === 'notes') {
    const n = db.prepare('SELECT entity_type,entity_id FROM notes WHERE id=?').get(tid);
    return !!n && managerOwns(user, n.entity_type, n.entity_id);
  }
  if (table === 'conversations') return !!db.prepare(`SELECT 1 x FROM conversations cv LEFT JOIN contacts c ON c.id=cv.contact_id WHERE cv.id=? AND ${managerConversationScopeSql('cv','c')}`).get(tid, ...managerConversationParams(user));
  return false;
}
// Удаление родительской карточки меняет и связи её дочерних записей. Менеджер
// не удаляет контакт/компанию/сделку, если этим затронет лид другого менеджера.
export function managerCanDelete(user, table, ids) {
  const list=[...new Set([ids].flat().map(Number).filter(n=>Number.isSafeInteger(n)&&n>0))];
  if(!list.length||list.some(id=>!managerOwns(user,table,id)))return false;
  const marks=list.map(()=>'?').join(',');
  const allOwned=(rows,kind)=>rows.every(row=>managerOwns(user,kind,row.id));
  if(table==='deals'){
    const tasks=db.prepare(`SELECT id FROM tasks WHERE deal_id IN (${marks})`).all(...list);
    return allOwned(tasks,'tasks');
  }
  if(table==='contacts'){
    const deals=db.prepare(`SELECT id FROM deals WHERE contact_id IN (${marks})`).all(...list);
    const tasks=db.prepare(`SELECT id FROM tasks WHERE contact_id IN (${marks}) OR deal_id IN (SELECT id FROM deals WHERE contact_id IN (${marks}))`).all(...list,...list);
    const conversations=db.prepare(`SELECT id FROM conversations WHERE contact_id IN (${marks})`).all(...list);
    return allOwned(deals,'deals')&&allOwned(tasks,'tasks')&&allOwned(conversations,'conversations');
  }
  if(table==='companies'){
    const contacts=db.prepare(`SELECT id FROM contacts WHERE company_id IN (${marks})`).all(...list);
    const deals=db.prepare(`SELECT id FROM deals WHERE company_id IN (${marks}) OR contact_id IN (SELECT id FROM contacts WHERE company_id IN (${marks}))`).all(...list,...list);
    const tasks=db.prepare(`SELECT id FROM tasks WHERE contact_id IN (SELECT id FROM contacts WHERE company_id IN (${marks})) OR deal_id IN (SELECT id FROM deals WHERE company_id IN (${marks}) OR contact_id IN (SELECT id FROM contacts WHERE company_id IN (${marks})))`).all(...list,...list,...list);
    return allOwned(contacts,'contacts')&&allOwned(deals,'deals')&&allOwned(tasks,'tasks');
  }
  return true;
}
function messageAttachmentAllowed(user,row) {
  if(!user||!row)return false;
  if(['admin','viewer'].includes(user.role))return true;
  if(user.role==='partner')return !!row.deal_id&&partnerOwns(user,'deals',row.deal_id)&&partnerOwns(user,'conversations',row.conversation_id);
  if(user.role==='manager')return managerOwns(user,'conversations',row.conversation_id)&&(row.deal_id?managerOwns(user,'deals',row.deal_id):managerCanReadUnlinkedMessages(user,row.conversation_id));
  return false;
}
function messageViewForUser(message,user) {
  if(!message||!['partner','manager'].includes(user?.role))return message;
  const uri=String(message.content_uri||'');
  return /^https?:\/\//i.test(uri)?{...message,content_uri:`/api/messages/${Number(message.id)}/file`}:message;
}
function managerOwnsPath(user, p) {
  const m = p.match(/^\/api\/(deals|contacts|tasks|companies|notes|conversations)\/(\d+)(?:\/|$)/);
  if (m) return managerOwns(user, m[1], m[2]);
  const dp = p.match(/^\/api\/deal_products\/(\d+)$/);
  if (dp) { const row = db.prepare('SELECT deal_id FROM deal_products WHERE id=?').get(dp[1]); return !!row && managerOwns(user, 'deals', row.deal_id); }
  const msg = p.match(/^\/api\/messages\/(\d+)\/(?:refetch|file)$/);
  if (msg) { const row = db.prepare('SELECT conversation_id,deal_id FROM messages WHERE id=?').get(msg[1]); return !!row && messageAttachmentAllowed(user,row); }
  return true;
}
/* Что потеряется вместе с карточкой. Переписка удаляется каскадом и
   возвращается только из резервной копии, сделка остаётся, но теряет клиента,
   а у компании отвязываются её клиенты. Поэтому удаление карточки, за которой
   что-то стоит, просит второго подтверждения с перечнем потерь — и на сервере:
   кнопку в интерфейсе может обойти скрипт, а вернуть переписку уже нельзя. */
// «переписка: 2 чата, 15 сообщений» — журнал читают люди, склонение настоящее
function impactWords(impact) {
  const parts = [];
  if (impact.conversations) parts.push(`переписка: ${impact.conversations} ${ruPlural(impact.conversations, 'чат', 'чата', 'чатов')}`
    + (impact.messages ? `, ${impact.messages} ${ruPlural(impact.messages, 'сообщение', 'сообщения', 'сообщений')}` : ''));
  if (impact.deals) parts.push(`сделок без клиента: ${impact.deals}`);
  if (impact.tasks) parts.push(`задач без клиента: ${impact.tasks}`);
  if (impact.contacts) parts.push(`клиентов без компании: ${impact.contacts}`);
  return parts.join('; ');
}

function deleteImpact(table, ids) {
  try {
    const list = [ids].flat().map(Number).filter(Boolean);
    if (!list.length) return null;
    const ph = list.map(() => '?').join(',');
    const n = sql => Number(db.prepare(sql).get(...list).n);
    let out = null;
    if (table === 'contacts') {
      out = {
        conversations: n(`SELECT COUNT(*) n FROM conversations WHERE contact_id IN (${ph})`),
        deals: n(`SELECT COUNT(*) n FROM deals WHERE contact_id IN (${ph})`),
        tasks: n(`SELECT COUNT(*) n FROM tasks WHERE contact_id IN (${ph})`),
      };
      out.messages = out.conversations
        ? n(`SELECT COUNT(*) n FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE contact_id IN (${ph}))`)
        : 0;
    } else if (table === 'companies') {
      out = {
        contacts: n(`SELECT COUNT(*) n FROM contacts WHERE company_id IN (${ph})`),
        deals: n(`SELECT COUNT(*) n FROM deals WHERE company_id IN (${ph})`),
      };
    }
    return out && Object.values(out).some(v => v > 0) ? out : null;
  } catch { return null; }
}

/* Какие поля таблицы можно писать. Список задан кодом, а не телом запроса:
   он же решает, какие таблицы принимает универсальный маршрут, поэтому имена
   колонок не могут прийти снаружи. Объявлен один раз на модуль: прежде объект
   собирался заново на каждом запросе. */
const CRUD = { contacts: ['name', 'phone', 'email', 'company', 'company_id', 'position', 'source', 'tags', 'notes', 'responsible_id', 'custom', 'email_opt_out', 'whatsapp_opt_out'], companies: ['name', 'inn', 'phone', 'email', 'site', 'notes', 'responsible_id'], tasks: ['title', 'type', 'due', 'priority', 'done', 'deal_id', 'contact_id', 'responsible_id', 'result', 'repeat'], deals: ['title', 'amount', 'stage', 'pipeline_id', 'contact_id', 'company_id', 'responsible', 'responsible_id', 'priority', 'loss_reason', 'deadline', 'custom'], products: ['name', 'sku', 'price', 'unit', 'active', 'note'], templates: ['name', 'body'], automations: ['name', 'trigger_type', 'trigger_value', 'action_type', 'action_value', 'active', 'delay_days'], notes: ['entity_type', 'entity_id', 'body', 'author'] };

/* Связи, которые схема не рвёт каскадом: у задач нет внешнего ключа на клиента
   и на сделку, заметки привязаны парой «тип + идентификатор», позиции сделки
   живут отдельной таблицей. Правила собраны в одном месте, и их применяют
   одиночное удаление, массовое и удаление сделки. Прежде один и тот же набор
   запросов был переписан в трёх местах: новое правило легко было добавить
   только в одно из них, и часть записей оставалась с «висячей» ссылкой. */
const DETACH_SQL = {
  contacts: ['UPDATE tasks SET contact_id=NULL WHERE contact_id=?', 'UPDATE deals SET contact_id=NULL WHERE contact_id=?', "DELETE FROM notes WHERE entity_type='contacts' AND entity_id=?"],
  companies: ['UPDATE deals SET company_id=NULL WHERE company_id=?', 'UPDATE contacts SET company_id=NULL WHERE company_id=?', "DELETE FROM notes WHERE entity_type='companies' AND entity_id=?"],
  deals: ['UPDATE tasks SET deal_id=NULL WHERE deal_id=?', 'DELETE FROM deal_products WHERE deal_id=?', "DELETE FROM notes WHERE entity_type='deals' AND entity_id=?"],
};
const detachChildren = (table, id) => { for (const sql of DETACH_SQL[table] || []) db.prepare(sql).run(id); };

/* Сумма сделки по её позициям. Количество бывает дробным (полтора этажа, 0,3
   сотни), а деньги в базе целые: без округления в deals.amount ложился хвост
   вида 300.00000000000004, и он уезжал в выгрузку для Excel и в ответ API.
   Правило одно на добавление позиции, её правку и удаление: строка округляется
   до рубля, сумма складывается из округлённых строк — ровно так же считает
   итог документ и карточка сделки, поэтому цифры везде совпадают. */
const dealSumByProducts = dealId => Number(
  db.prepare('SELECT COALESCE(SUM(CAST(ROUND(price*qty) AS INTEGER)),0) s FROM deal_products WHERE deal_id=?').get(dealId).s);

/* Ответственный в сделке хранится дважды: идентификатором и именем, потому что
   имя читают аналитика и поиск. Приведение одно на создание и на правку, иначе
   два поля расходятся, и сделка показывает одного человека, а фильтрует по
   другому. */
function normalizeResponsible(b) {
  if (b.responsible_id === undefined) return;
  b.responsible_id = b.responsible_id ? Number(b.responsible_id) : null;
  b.responsible = b.responsible_id ? (db.prepare('SELECT name FROM users WHERE id=?').get(b.responsible_id)?.name || null) : null;
}
const DEAL_LAND_STATUSES = new Set(['yes', 'no', 'unknown']);
const DEAL_PAYMENT_TYPES = new Set(['cash', 'mortgage', 'installment', 'mixed', 'unknown']);
function normalizeDealDate(value) {
  const raw = String(value ?? '').trim();
  if (['unknown', 'не определена', 'не определён', 'не определен', 'не выяснена', 'не выяснен'].includes(raw.toLowerCase())) return 'unknown';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const d = new Date(raw + 'T00:00:00.000Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw ? '' : raw;
}
function normalizeDealRequirements(input, current = {}) {
  const val = (key, fallback) => input[key] !== undefined ? input[key] : (current[key] !== undefined ? current[key] : fallback);
  const invalid = [];
  const amountRaw = val('amount', undefined);
  const amount = amountRaw === null || amountRaw === '' || amountRaw === undefined ? NaN : Number(amountRaw);
  if (!Number.isSafeInteger(Math.round(amount)) || !Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER)
    invalid.push('бюджет');
  const dealObject = String(val('deal_object', '') ?? '').trim().slice(0, 160);
  if (!dealObject) invalid.push('объект');
  const landRaw = String(val('land_status', '') ?? '').trim().toLowerCase();
  const landAliases = { да: 'yes', есть: 'yes', yes: 'yes', нет: 'no', no: 'no', unknown: 'unknown', 'не выяснено': 'unknown', 'неизвестно': 'unknown', 'не указано': 'unknown' };
  const landStatus = landAliases[landRaw] || '';
  if (!DEAL_LAND_STATUSES.has(landStatus)) invalid.push('наличие земли');
  const constructionDate = normalizeDealDate(val('construction_date', ''));
  if (!constructionDate) invalid.push('дата строительства');
  const paymentRaw = String(val('payment_type', '') ?? '').trim().toLowerCase();
  const paymentAliases = { cash: 'cash', наличные: 'cash', ипотека: 'mortgage', mortgage: 'mortgage', кредит: 'mortgage', рассрочка: 'installment', installment: 'installment', смешанная: 'mixed', mixed: 'mixed', unknown: 'unknown', 'не определён': 'unknown', 'не определен': 'unknown', 'неизвестно': 'unknown', 'не указано': 'unknown' };
  const paymentType = paymentAliases[paymentRaw] || '';
  if (!DEAL_PAYMENT_TYPES.has(paymentType)) invalid.push('тип оплаты');
  const sourceRaw = val('lead_source', '');
  const leadSource = String(sourceRaw ?? '').trim().slice(0, 80);
  if (!leadSource) invalid.push('источник лида');
  if (invalid.length) return { error: `Заполните обязательные поля сделки: ${invalid.join(', ')}` };
  return { value: { amount: Math.round(amount), deal_object: dealObject, land_status: landStatus, construction_date: constructionDate, payment_type: paymentType, lead_source: leadSource } };
}

function partnerOwnsPath(user, p) {
  const m = p.match(/^\/api\/(deals|contacts|tasks|notes|conversations)\/(\d+)(\/|$)/);
  if (!m) return true;
  return partnerOwns(user, m[1], m[2]);
}
function requireAdmin(user, res) { if (user.role !== 'admin') { json(res, 403, { error: 'Только для администратора' }); return false; } return true; }
// Закрыли повторяющуюся задачу — сразу создаём следующую по расписанию.
// Отсчёт от сегодня, а не от просроченной даты: закрытая с опозданием задача
// не должна порождать новую уже просроченную. Одиночное и массовое «Выполнено»
// пользуют одну функцию, чтобы поведение не разъезжалось.
function extendRepeatingTask(id, byName) {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
  if (!t || !t.repeat || t.repeat === 'none') return null;
  const days = { daily: 1, weekly: 7, monthly: 30 }[t.repeat] || 0;
  if (!days) return null;
  const base = /^\d{4}-\d{2}-\d{2}/.test(t.due || '') ? new Date(String(t.due).replace(' ', 'T')) : new Date();
  const next = new Date(Math.max(base.getTime(), Date.now()) + days * 864e5);
  const time = /\d{2}:\d{2}/.test(t.due || '') ? String(t.due).slice(-5) : '10:00';
  const due = `${localDate(next)} ${time}`;
  const r = db.prepare('INSERT INTO tasks(title,type,due,priority,done,deal_id,contact_id,responsible_id,result,repeat) VALUES(?,?,?,?,0,?,?,?,?,?)')
    .run(t.title, t.type, due, t.priority || 'normal', t.deal_id, t.contact_id, t.responsible_id, t.result, t.repeat);
  logActivity(`Повторяющаяся задача «${t.title}» продлена до ${due}`, 'tasks', Number(r.lastInsertRowid), byName);
  return Number(r.lastInsertRowid);
}

function validateUser(b, creating = false) {
  if ((creating || b.name !== undefined) && (typeof b.name !== 'string' || !b.name.trim())) return 'Укажите имя';
  if ((creating || b.email !== undefined) && (typeof b.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim()))) return 'Укажите корректный e-mail';
  // Без пароля сотрудника создать нельзя: хеш строки «undefined» стал бы
  // рабочим паролем, который никто не выдавал и никто не знает.
  if (creating && !b.password) return 'Задайте временный пароль сотрудника (от 12 символов)';
  if ((creating || b.password) && (typeof b.password !== 'string' || b.password.length < 12 || b.password.length > 256)) return 'Пароль должен содержать от 12 до 256 символов';
  if (b.role !== undefined && !['admin', 'rop', 'manager', 'classifier', 'viewer', 'partner'].includes(b.role)) return 'Неизвестная роль';
  if (b.active !== undefined && ![0, 1].includes(b.active)) return 'Некорректный статус';
  if (b.team_id !== undefined && b.team_id !== null && b.team_id !== '') {
    b.team_id=Number(b.team_id);
    if(!Number.isSafeInteger(b.team_id)||b.team_id<1||!db.prepare('SELECT 1 x FROM teams WHERE id=? AND active=1').get(b.team_id))return 'Выберите существующую активную команду';
  } else if(b.team_id!==undefined)b.team_id=null;
  if(b.max_open_leads!==undefined){
    if(b.max_open_leads===null||b.max_open_leads==='')b.max_open_leads=null;
    else {b.max_open_leads=Number(b.max_open_leads);if(!Number.isSafeInteger(b.max_open_leads)||b.max_open_leads<1||b.max_open_leads>1000)return 'Лимит открытых лидов должен быть от 1 до 1000 или не задан';}
  }
  for(const k of ['routing_regions','routing_directions'])if(b[k]!==undefined)b[k]=String(b[k]||'').trim().slice(0,500);
  // длина имени и адреса ограничена: проверка формата пройдена, теперь
  // мегабайты текста не должны попадать в таблицу сотрудников
  if (b.name !== undefined) b.name = String(b.name).trim().slice(0, 120);
  if (b.email !== undefined) b.email = String(b.email).trim().slice(0, 254);
}

const competitorsApi = createCompetitors({ db, json, readBody, log: logActivity, logAccess, broadcast, getSetting, setSetting, rateLimit });

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

// Разовая отметка в старых базах: до этой версии строки, рождённые чатами
// («Wazzup: получено сообщений», «Новое обращение …», «Обращение …»), писались
// в общую ленту, и после обновления она состояла бы только из них. Правим
// только строки с явным чатовым происхождением, повторный запуск ничего не меняет.
try {
  const hushed = db.prepare(`UPDATE activities SET feed=0 WHERE feed=1 AND (text LIKE 'Wazzup: получено сообщений%'
      OR text LIKE 'Новое обращение «%' OR text LIKE 'Обращение «%' OR text LIKE 'Новый контакт (%'
      OR text LIKE 'Автоматизация «%' OR text LIKE 'Файл загружен в чат #%' OR text LIKE 'Создано (%')`).run().changes;
  if (hushed) console.log(`Лента событий: ${hushed} ${ruPlural(hushed, 'запись перенесена', 'записи перенесены', 'записей перенесено')} из чатов в историю карточек.`);
} catch (e) { console.error('Не удалось почистить ленту событий:', e.message) }

// Разовая уборка дублей сообщений в чатах: ретраи вендора с новым номером и
// групповая доставка собственных отправлений оставляли в истории второй такой
// же пузырь. В пределах минуты оставляем первую копию; входящую копию своего
// исходящего убираем совсем — оригинал уже стоит справа. История остаётся
// читаемой, ничего кроме повторов не удаляется.
try {
  const dups = db.prepare(`SELECT m.id FROM messages m JOIN (
      SELECT conversation_id, direction, body, COALESCE(content_uri,'') cu, strftime('%Y-%m-%d %H:%M', created_at) mn, MIN(id) keep
      FROM messages GROUP BY 1,2,3,4,5 HAVING COUNT(*) > 1) d
    ON m.conversation_id=d.conversation_id AND m.direction=d.direction AND m.body=d.body
    AND COALESCE(m.content_uri,'')=d.cu AND strftime('%Y-%m-%d %H:%M', m.created_at)=d.mn AND m.id<>d.keep`).all();
  for (const r of dups) db.prepare('DELETE FROM messages WHERE id=?').run(r.id);
  const shadows = db.prepare(`SELECT m.id FROM messages m WHERE m.direction='in' AND EXISTS (
      SELECT 1 FROM messages o WHERE o.conversation_id=m.conversation_id AND o.direction='out'
      AND o.body=m.body AND COALESCE(o.content_uri,'')=COALESCE(m.content_uri,'')
      AND ABS(julianday(o.created_at)-julianday(m.created_at))*86400 <= 120)`).all();
  for (const r of shadows) db.prepare('DELETE FROM messages WHERE id=?').run(r.id);
  const gone = dups.length + shadows.length;
  if (gone) console.log(`Чаты: убрано повторов сообщений: ${gone}.`);
} catch (e) { console.error('Не удалось убрать повторы сообщений:', e.message) }

// Разовая уборка при старте: если старая версия оставила заметки удалённых
// сделок или ссылки задач на несуществующие записи, они не должны копиться.
try {
  // прерванное восстановление могло оставить временный файл копии — убираем,
  // иначе он лежит в каталоге данных вечно и не попадает под дневную чистку
  try { const restoreTmp = join(DATA_DIR, '.restore-src.db'); if (existsSync(restoreTmp)) { unlinkSync(restoreTmp); console.log('База: удалён временный файл прерванного восстановления.') } } catch {}
  const cleaned = cleanupOrphans(db);
  const synced = syncDealResponsibleNames(db);
  const n = Object.values(cleaned).reduce((a, b) => a + b, 0);
  if (n) console.log(`База: убрано ${n} строк, потерявших родителя (заметки, позиции, ссылки задач).`);
  if (synced) console.log(`База: имя ответственного обновлено у ${synced} сделок.`);
} catch (e) { console.error('Уборка базы при старте:', e.message) }

const QUALITY_CRITERIA = [
  { key: 'response_speed', block: 'Скорость', title: 'Первый живой ответ в срок', guide: 'От первого сообщения клиента до первого ответа сотрудника: до 5 минут в чате и до 15 минут в других каналах. Автоответы и рассылки не считаются. Сверьте время с историей; если канал или время ответа не видны, выберите «данных недостаточно».', critical: true, evidence: 'таймлайн CRM и переписка' },
  { key: 'greeting', block: 'Контакт', title: 'Приветствие', guide: 'Вежливо поздоровался. Учитывайте канал и формат короткого первого ответа.', critical: false, evidence: 'переписка или запись звонка' },
  { key: 'introduce_company', block: 'Контакт', title: 'Представился и назвал компанию', guide: 'Назвал своё имя и «Каркас Тайги», если это уместно в канале.', critical: false, evidence: 'переписка или запись звонка' },
  { key: 'first_answer', block: 'Контакт', title: 'Ответил по сути первого вопроса', guide: 'Сначала коротко ответьте на вопрос клиента, затем вежливо предложите удобный способ связи или попросите номер. Не задавайте повторно вопрос, на который клиент уже ответил. Если точных сведений нет, скажите, что уточните их у менеджера; не придумывайте цену, комплектацию, срок или наличие. Уважайте выбранный клиентом канал.', critical: true, evidence: 'первое обращение и ответ' },
  { key: 'customer_name', block: 'Контакт', title: 'Уточнил имя клиента', guide: 'Проверяйте уместность: имя может быть уже указано в карточке или не требоваться для короткого первого ответа.', critical: false, evidence: 'переписка или запись звонка' },
  { key: 'need', block: 'Диагностика', title: 'Выяснил потребность', guide: 'Объект, назначение, площадь или другие важные для клиента параметры. Для недельной метрики отдельно отметьте известность объекта/площади в блоке «Факты и карточка CRM».', critical: false, evidence: 'переписка или запись звонка' },
  { key: 'budget', block: 'Диагностика', title: 'Выяснил бюджет', guide: 'Уточнил ориентир тактично, без давления. Не требовать, если контекст делает вопрос неуместным.', critical: false, evidence: 'переписка или запись звонка' },
  { key: 'location', block: 'Диагностика', title: 'Выяснил участок и город строительства', guide: 'Не считать город подтверждением наличия участка. Не додумывать, если это не прозвучало. Статус участка, готовность и доступ проверяются дополнительно в развивающих наблюдениях.', critical: false, evidence: 'переписка, запись или поля CRM' },
  { key: 'timeline', block: 'Диагностика', title: 'Выяснил сроки', guide: 'Когда клиент планирует покупать или начинать строительство.', critical: false, evidence: 'переписка или запись звонка' },
  { key: 'benefits', block: 'Презентация', title: 'Объяснил выгоды простым языком', guide: 'Связал подтверждённые преимущества с запросом конкретного клиента.', critical: false, evidence: 'переписка или запись звонка' },
  { key: 'configuration', block: 'Презентация', title: 'Предложил подходящую комплектацию', guide: 'Вариант соответствует запросу, а состав и ограничения не придуманы. Сверьте конкретное объявление и комплектацию в развивающих наблюдениях.', critical: false, evidence: 'переписка или запись звонка' },
  { key: 'payment', block: 'Презентация', title: 'Обсудил подходящий способ оплаты', guide: 'Условия проверены и соответствуют интересу клиента; не обещать неподтверждённую рассрочку или ипотеку.', critical: false, evidence: 'переписка, запись или утверждённые условия' },
  { key: 'objection', block: 'Возражения', title: 'Ответил на возражение по существу', guide: 'Только если клиент действительно возражал: выслушал, уточнил причину, ответил фактами без спора. При отсутствии возражения выберите «не применимо».', critical: true, evidence: 'переписка или запись звонка' },
  { key: 'next_step', block: 'Договорённость', title: 'Согласовал следующий шаг', guide: 'Действие, цель, дата и время, канал связи подтверждены клиентом; «свяжемся» без конкретной договорённости недостаточно.', critical: true, evidence: 'переписка, запись или задача CRM' },
  { key: 'crm_fields', block: 'CRM', title: 'Карточка заполнена по фактам', guide: 'Объект, город, участок, бюджет, сроки и оплата заполнены только если это выяснено. Не добавляйте сведения по догадке.', critical: false, evidence: 'карточка сделки и контакт' },
  { key: 'task_followup', block: 'CRM', title: 'Есть задача на следующий контакт', guide: 'Задача назначена с понятным сроком; просроченной задачи по этому шагу нет.', critical: true, evidence: 'список задач CRM' },
  { key: 'materials', block: 'Сервис', title: 'Отправил запрошенные материалы', guide: 'Только нужные клиенту фото, каталог или видео; без спама, с коротким пояснением и в выбранном клиентом канале.', critical: false, evidence: 'переписка' },
  { key: 'followup', block: 'Сервис', title: 'Сделал уместное повторное касание', guide: 'Если клиент не ответил — одно-два своевременных касания с новой пользой, без дублей и спама. Учитывайте, что клиент уже сообщил.', critical: false, evidence: 'переписка и задачи CRM' },
];
// Дополнительные наблюдения из «Контура развития ОКК» дополняют 18-балльный
// чек-лист, но не меняют его балл. Это отдельные факты для обучения и недельных
// метрик, а не ещё один скрытый штраф сотруднику.
const QUALITY_GROWTH_CRITERIA = [
  { key:'ad_context', block:'Контекст рекламы', title:'Сверил объявление и запрос', guide:'До ответа проверил конкретное объявление, объект, цену и комплектацию; отметил, если источник лида недоступен.', evidence:'объявление и переписка' },
  { key:'open_question', block:'Старт', title:'Задал открытый вопрос после приветствия', guide:'Зафиксируйте первый вопрос дословно или кратко. Он раскрывает задачу клиента, а не сразу переводит разговор в монолог или прайс.', evidence:'переписка или запись звонка' },
  { key:'qualification', block:'Квалификация', title:'Выяснил не менее четырёх из шести факторов', guide:'Сверьте объект/площадь, город, участок, срок, бюджет и способ оплаты. Отметьте только услышанное; недоступный фрагмент не считайте отрицательным.', evidence:'переписка или запись звонка' },
  { key:'land_readiness', block:'Квалификация', title:'Уточнил готовность участка', guide:'Проверил наличие участка, его статус/готовность и важные особенности доступа; не считайте один город достаточным ответом.', evidence:'переписка или запись звонка' },
  { key:'region_coverage', block:'Доверие', title:'Проверил географию и возможности', guide:'До обещания строительства или выезда сверил регион с подтверждённым покрытием; при отсутствии сведений не обещал «работаем везде».', evidence:'утверждённая карта покрытия и переписка' },
  { key:'price_configuration', block:'Цена', title:'Объяснил цену вместе с комплектацией', guide:'Связал сумму с площадью и составом: отделка, фундамент, доставка и прочие относящиеся к запросу позиции. Не подтверждённые условия отмечайте как недоступные.', evidence:'каталог/расчёт и переписка' },
  { key:'materials_followup', block:'Материалы', title:'Сопроводил материалы следующим шагом', guide:'Если отправлял каталог/фото/видео, зафиксируйте что, куда, когда и зачем отправлено, а также задачу или согласованный follow-up. Если материал не отправлялся, отметьте «не применимо».', evidence:'переписка и задача CRM' },
  { key:'closing_step', block:'Договорённость', title:'Закрыл разговор на конкретный шаг', guide:'Клиент подтвердил канал, дату, время и цель следующего действия. Обещание «свяжемся» без календарной договорённости не считается подтверждением.', evidence:'переписка, запись или задача CRM' },
  { key:'crm_link', block:'CRM', title:'Связал разговор с карточкой CRM', guide:'После разговора внесены только известные факты, актуальный итог и задача на следующий шаг; источник и ответственный понятны.', evidence:'карточка сделки и задачи CRM' },
  { key:'objection_cause', block:'Возражения', title:'Выяснил причину возражения', guide:'Если возражение было, сначала выяснил, что именно смущает (цена, регион, срок, комплектация или доверие), затем ответил фактом и согласовал действие. Если возражения не было, выберите «не применимо».', evidence:'переписка или запись звонка' },
];
const QUALITY_KEYS = new Set(QUALITY_CRITERIA.map(x => x.key));
const QUALITY_GROWTH_KEYS = new Set(QUALITY_GROWTH_CRITERIA.map(x => x.key));
const QUALITY_ALL_KEYS = new Set([...QUALITY_KEYS, ...QUALITY_GROWTH_KEYS]);
const QUALITY_FACT_KEYS = ['object_area','city','land','timeline','budget','payment'];
const QUALITY_FACT_LABELS = { object_area:'Объект и площадь', city:'Город строительства', land:'Участок / статус / доступ', timeline:'Сроки', budget:'Бюджет', payment:'Способ оплаты' };
const QUALITY_SAMPLE_RULES = new Set(['all_new','random','repeat_contact','closed_deal','risk_signal','manager_choice','other']);
const QUALITY_SAMPLE_RULE_LABELS = { all_new:'Все новые обращения', random:'Случайная выборка', repeat_contact:'Повторное касание', closed_deal:'Завершённая сделка', risk_signal:'Сигнал риска', manager_choice:'Выбор руководителя', other:'Другое' };
const QUALITY_SOURCES = new Set(['message', 'recording', 'crm', 'other']);
const QUALITY_CONFIDENCE = new Set(['','verified','needs_review','low']);
const QUALITY_ITEM_STATUSES = new Set(['','yes','no','na','unknown']);
// Категории, минимум применимых критериев и действия из листа «Правила оценки»
// требуют отдельного согласования. До него показываем только исходные счётчики.
const qParseArray = value => { try { const v = JSON.parse(value || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const qPercent=(numerator,denominator)=>denominator?Number((Number(numerator)*100/Number(denominator)).toFixed(1)):null;
const qStats = (items, review = {}) => {
  const counts = { yes:0, no:0, na:0, unknown:0, empty:0 };
  for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
  const applicable = counts.yes + counts.no;
  const criticalMarkedNo = QUALITY_CRITERIA.filter(c => c.critical
    && items.some(item => item.criterion_key === c.key && item.status === 'no')).map(c => c.key);
  return {
    confirmed:counts.yes, applicable, criticalMarkedNo,
    notApplicable:counts.na, insufficient:counts.unknown, unreviewed:counts.empty,
    percent:qPercent(counts.yes,applicable),
    coverage:qPercent(applicable,QUALITY_CRITERIA.length), total:QUALITY_CRITERIA.length,
    abandonedCard:Number(review.abandoned_card) === 1,
  };
};
const qReviewShape = (row, items, growthItems = [], facts = []) => ({
  ...row,
  issues: qParseArray(row.issues), next_steps: qParseArray(row.next_steps),
  facts: Object.fromEntries(facts.map(f => [f.fact_key, { heard_status:f.heard_status, crm_status:f.crm_status }])),
  growthItems,
  score: ['complete'].includes(row.status) ? qStats(items, row) : null,
});
const qParseObject = value => { try { const v = JSON.parse(value || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
const qIsAudioMessage = message => {
  const type=String(message?.content_type||'').toLowerCase();
  const path=String(message?.content_name||message?.content_uri||'').split(/[?#]/)[0];
  return type.startsWith('audio/') || ['.mp3','.ogg','.opus','.wav','.m4a','.aac','.amr'].includes(extname(path).toLowerCase());
};
const qFactObject = rows => Object.fromEntries(rows.map(f => [f.fact_key, { heard_status:f.heard_status, crm_status:f.crm_status }]));
const qEvidenceSpeakerFromMessage = direction => direction === 'out' ? 'manager' : direction === 'in' ? 'client' : 'unknown';
function qMessageRows(review, limit = 500) {
  if (!review.contact_id) return { messages:[], truncated:false };
  const max = Math.min(500, Math.max(1, limit));
  const rows = db.prepare(`SELECT m.id,m.conversation_id,m.direction,m.channel,m.body,m.content_uri,m.content_name,m.content_type,m.content_size,m.author,m.created_at,m.event_at,m.event_time_source,m.status,m.automation_id
    FROM conversations cv JOIN messages m ON m.conversation_id=cv.id
    WHERE cv.contact_id=?
      AND (?='' OR date(COALESCE(m.event_at,m.created_at),'localtime')>=?) AND (?='' OR date(COALESCE(m.event_at,m.created_at),'localtime')<=?)
    ORDER BY COALESCE(m.event_at,m.created_at) DESC,m.id DESC LIMIT ?`).all(
      review.contact_id, review.period_start || '', review.period_start || '', review.period_end || '', review.period_end || '', max + 1);
  const truncated = rows.length > max;
  const messages = rows.slice(0,max).reverse().map(m => ({ ...m, body:String(m.body || '').slice(0,1200) }));
  // Завершённый разбор всегда открывает сохранённое доказательство, даже если
  // оно старше окна последних сообщений или выбранного периода.
  const have = new Set(messages.map(m => Number(m.id)));
  const linked = db.prepare(`SELECT m.id,m.conversation_id,m.direction,m.channel,m.body,m.content_uri,m.content_name,m.content_type,m.content_size,m.author,m.created_at,m.event_at,m.event_time_source,m.status,m.automation_id
    FROM conversations cv JOIN messages m ON m.conversation_id=cv.id WHERE cv.contact_id=? AND m.id=?`);
  const itemRows = db.prepare(`SELECT message_id FROM quality_review_items WHERE review_id=? AND message_id IS NOT NULL
    UNION SELECT message_id FROM quality_review_growth_items WHERE review_id=? AND message_id IS NOT NULL`).all(review.id,review.id);
  for (const item of itemRows) if (!have.has(Number(item.message_id))) {
    const m = linked.get(review.contact_id, Number(item.message_id));
    if (m) { messages.push({ ...m, body:String(m.body || '').slice(0,1200) }); have.add(Number(m.id)); }
  }
  messages.sort((a,b)=>String(a.event_at||a.created_at).localeCompare(String(b.event_at||b.created_at))||a.id-b.id);
  return { messages, truncated };
}
function qFirstReplyInfo(messages, review, truncated = false, crmContext = null) {
  if(truncated)return{available:false,reason:'Подсказка не рассчитана: в переписке больше 500 сообщений, доступна только часть истории.'};
  if(crmContext?.available&&Number(crmContext.contactDealCount)>1)return{available:false,reason:'У контакта несколько сделок, а переписка хранится на уровне контакта. Выберите вручную сообщения именно по этой сделке.'};
  const eventTime=m=>{
    if(!m?.event_at||!['provider','crm'].includes(String(m.event_time_source||'')))return null;
    const value=storedMessageTimeInstant(m.event_at);
    return Number.isFinite(value)?value:null;
  };
  const inPeriod=m=>{
    const day=qLocalMessageDay(m.event_at||m.created_at);
    return Boolean(day)&&(!review.period_start||day>=review.period_start)&&(!review.period_end||day<=review.period_end);
  };
  const ordered=messages.filter(inPeriod);
  const incoming=ordered.filter(m=>m.direction==='in').sort((a,b)=>{const ta=eventTime(a),tb=eventTime(b);return(ta??Infinity)-(tb??Infinity)||Number(a.id)-Number(b.id);});
  if(!incoming.length)return{available:false,reason:'В выбранном периоде нет входящего сообщения клиента.'};
  if(incoming.some(m=>eventTime(m)===null))return{available:false,reason:'Для одного или нескольких входящих сообщений не сохранено время события канала. Подсказка по SLA не рассчитывается.'};
  const firstIncoming=incoming[0],channel=String(firstIncoming.channel||'').toLowerCase(),incomingAt=eventTime(firstIncoming);
  const chatChannels=new Set(['whatsapp','whatsgroup','wapi','viber','instagram','telegram','telegroup','tgapi','vk','avito','max','maxgroup','maxbot','cian']);
  const otherChannels=new Set(['email','phone','call','site','sms']);
  const thresholdMinutes=chatChannels.has(channel)?5:otherChannels.has(channel)?15:null;
  if(thresholdMinutes===null)return{available:false,firstIncomingAt:firstIncoming.event_at,channel,reason:'Для этого канала норматив не определён в рабочей таблице. Проверьте вручную; статус критерия выбирает руководитель.'};
  const candidates=ordered.filter(m=>{
    const author=String(m.author||'').trim().toLocaleLowerCase('ru-RU');
    return m.direction==='out'&&Number(m.automation_id||0)===0
      &&!['рассылка','автоматизация'].includes(author)&&!author.startsWith('рассылка:')
      &&['sent','delivered','read'].includes(String(m.status||''));
  });
  if(candidates.some(m=>eventTime(m)===null))return{available:false,firstIncomingAt:firstIncoming.event_at,channel,reason:'Для одного или нескольких исходящих сообщений не сохранено время отправки. Нельзя надёжно определить первый живой ответ.'};
  const reply=candidates.filter(m=>eventTime(m)>=incomingAt).sort((a,b)=>eventTime(a)-eventTime(b)||Number(a.id)-Number(b.id))[0];
  const sourceLabel=source=>source==='provider'?'Отметка канала Wazzup':'Время отправки из CRM';
  if(!reply)return{available:true,pending:true,firstIncomingAt:firstIncoming.event_at,thresholdMinutes,channel,
    timingBasis:sourceLabel(firstIncoming.event_time_source),
    reason:'В доступной истории после обращения нет отправленного вручную ответа. Проверьте, не обрезан ли период и не отвечали ли клиенту в другом канале.'};
  if(Number(reply.conversation_id)!==Number(firstIncoming.conversation_id)||String(reply.channel||'').toLowerCase()!==channel)
    return{available:false,firstIncomingAt:firstIncoming.event_at,firstReplyAt:reply.event_at,channel,
      reason:'Первое исходящее сообщение записано в другом чате или канале. Нельзя уверенно связать его с этим обращением; проверьте вручную.'};
  const elapsedMs=eventTime(reply)-incomingAt;
  if(elapsedMs<0)return{available:false,firstIncomingAt:firstIncoming.event_at,firstReplyAt:reply.event_at,channel,
    reason:'Временные отметки сообщений противоречат друг другу. Проверьте историю вручную.'};
  const elapsedSeconds=Math.floor(elapsedMs/1000);
  const sources=new Set([firstIncoming.event_time_source,reply.event_time_source]);
  return{available:true,pending:false,firstIncomingAt:firstIncoming.event_at,firstReplyAt:reply.event_at,
    firstReplyAuthor:reply.author||'Сотрудник',channel,thresholdMinutes,elapsedSeconds,minutes:elapsedMs/60000,
    onTime:elapsedMs<=thresholdMinutes*60000,
    timingBasis:sources.size===1?sourceLabel([...sources][0]):'Отметки канала и CRM',
    reason:'Подсказка рассчитана по доступным отметкам времени; вручную сверьте период и автора ответа.'};
}
function qDealContext(review) {
  const deal = db.prepare(`SELECT d.id,d.title,d.amount,d.stage,d.pipeline_id,d.responsible,d.responsible_id,d.created_at,d.updated_at,d.closed_at,d.custom,
      COALESCE(p.name,'') pipeline_name,COALESCE(st.name,d.stage) stage_name,
      COALESCE(c.id,0) contact_id,COALESCE(c.name,'') contact_name,COALESCE(NULLIF(d.lead_source,''),NULLIF(c.source,''),'') source,COALESCE(c.custom,'{}') contact_custom,
      COALESCE(u.name,d.responsible) current_responsible,
      (SELECT COUNT(*) FROM deals dx WHERE dx.contact_id=d.contact_id) contact_deal_count
    FROM deals d LEFT JOIN pipelines p ON p.id=d.pipeline_id
    LEFT JOIN stages st ON st.pipeline_id=d.pipeline_id AND st.code=d.stage
    LEFT JOIN contacts c ON c.id=d.contact_id LEFT JOIN users u ON u.id=d.responsible_id WHERE d.id=?`).get(review.deal_id);
  if (!deal) return { available:false, note:'Карточка сделки удалена; сохранённый снимок проверки остаётся в истории.' };
  const stages = db.prepare(`SELECT event_type,stage,stage_name,entered_at FROM deal_stage_history
    WHERE deal_id=? ORDER BY entered_at DESC,id DESC LIMIT 30`).all(deal.id);
  const tasks = db.prepare(`SELECT t.id,t.title,t.type,t.due,t.done,t.result,t.created_at,
      CASE WHEN t.deal_id=? THEN 'deal' ELSE 'contact' END link_type,COALESCE(u.name,'') responsible_name
    FROM tasks t LEFT JOIN users u ON u.id=t.responsible_id
    WHERE t.deal_id=? OR (t.deal_id IS NULL AND ?<>0 AND t.contact_id=?)
    ORDER BY t.done ASC,CASE WHEN t.due IS NULL OR t.due='' THEN 1 ELSE 0 END,t.due,t.id DESC LIMIT 50`).all(deal.id,deal.id,deal.contact_id,deal.contact_id);
  const fields = getCustomFields();
  const shapeCustom = (raw, entity) => {
    const values = qParseObject(raw);
    return fields.filter(f => f.entity === entity || f.entity === 'both').map(f => ({
      label:f.label, present:String(values[f.key] ?? '').trim() !== '',
      // Не раскрываем телефоны, e-mail, адреса и документы в панели проверки.
      value:/phone|tel|email|mobile|address/i.test(f.type || '') || /телефон|почт|e-?mail|мобильн|адрес|паспорт|документ|снилс|инн/i.test(f.label)
        ? '' : String(values[f.key] ?? '').slice(0,240),
      hidden:/phone|tel|email|mobile|address/i.test(f.type || '') || /телефон|почт|e-?mail|мобильн|адрес|паспорт|документ|снилс|инн/i.test(f.label),
    }));
  };
  return {
    available:true,
    deal:{ id:deal.id,title:deal.title,amount:deal.amount,stage:deal.stage,stage_name:deal.stage_name,pipeline_id:deal.pipeline_id,
      pipeline_name:deal.pipeline_name,responsible:deal.current_responsible || deal.responsible,source:deal.source,
      created_at:deal.created_at,updated_at:deal.updated_at,closed_at:deal.closed_at,custom:shapeCustom(deal.custom,'deals') },
    contact:{ id:deal.contact_id || null,name:deal.contact_name,source:deal.source,custom:shapeCustom(deal.contact_custom,'contacts') },
    contactDealCount:Number(deal.contact_deal_count)||0,
    tasks, stageHistory:stages, stageHistoryAvailable:stages.some(x=>x.event_type==='created'||x.event_type==='entered'),
    stageHistoryBaseline:stages.some(x=>x.event_type==='baseline'),
  };
}
function qBuildReviewFilters(search, alias = 'r') {
  const clauses = [], params = [];
  const numeric = (key, label) => {
    const raw = String(search.get(key) || '').trim();
    if (!raw) return { value:0 };
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1)
      return { error:`Фильтр «${label}» задан неверно` };
    return { value:Number(raw) };
  };
  const manager = numeric('manager_id','ответственный');
  if (manager.error) return manager;
  const pipeline = numeric('pipeline_id','воронка');
  if (pipeline.error) return pipeline;
  if (manager.value) { clauses.push(`${alias}.responsible_id=?`); params.push(manager.value); }
  if (pipeline.value) { clauses.push(`${alias}.pipeline_id=?`); params.push(pipeline.value); }
  const stage = String(search.get('stage') || '').trim().slice(0,120);
  const source = String(search.get('source') || '').trim().slice(0,60);
  if (stage) { clauses.push(`COALESCE(${alias}.stage,'')=?`); params.push(stage); }
  if (source) { clauses.push(`COALESCE(${alias}.source,'')=?`); params.push(source); }
  return { clauses, params, selected:{ manager_id:manager.value || null,pipeline_id:pipeline.value || null,stage,source } };
}

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
      // оба формата входа вендора приводим одной картой: в старом messages[]
      // вложение лежит в attachment.url, и без приведения файл без подписи
      // молча терялся — история показывала только текстовые сообщения
      const mapMsg = m => {
        // отправитель группового сообщения в разных форматах вендора лежит в
        // разных ключах: без него сообщения участников группы обезличены
        const snd = m.sender || (m.from && typeof m.from === 'object' ? m.from : null)
          || (m.user && typeof m.user === 'object' ? m.user : null)
          || (m.author && typeof m.author === 'object' ? m.author : null) || {};
        const sndName = snd.name || [snd.first_name, snd.last_name].filter(Boolean).join(' ').trim() || '';
        return {
        messageId: m.message_id || m.messageId, channelId: m.channel_id || m.channelId,
        eventAt: m.dateTime || '',
        // тип чата берём только из данных: подставлять 'whatsapp' вместо отсутствующего
        // нельзя, ответ ушёл бы клиенту не в тот мессенджер, а выглядело бы как доставка
        chatType: m.recipient?.chat_type || snd.chat_type || m.chatType || '',
        chatId: m.recipient?.chat_id || snd.chat_id || m.chatId, isEcho: m.isEcho === true, outbound: m.direction === 'outbound',
        // в исходящем событии клиент — получатель: карточка и поиск беседы
        // идут по его данным, а не по данным отправившего сотрудника
        recipient: m.recipient,
        // клиент исходящего события лежит в recipient (новый формат) или contact
        // (старый); sender — сотрудник, и его номер для поиска клиента не годится
        cli: { name: m.recipient?.name || m.contact?.name || '', phone: m.recipient?.phone || m.contact?.phone || '' },
        text: m.text, type: m.attachment ? 'file' : (WZ_TYPE_BODY[m.type] ? m.type : 'text'), contentUri: m.attachment?.url || m.contentUri, status: m.direction === 'inbound' ? 'inbound' : (m.status || ''),
        fileName: m.attachment?.name || m.attachment?.fileName || m.fileName || '',
        authorName: sndName || m.authorName, contact: { name: sndName || m.recipient?.name || m.contact?.name, phone: snd.phone || m.recipient?.phone || m.contact?.phone }
      }; };
      // щедрые пределы на число событий в одном запросе: обычный пакет вендора
      // содержит единицы сообщений, а огромный запрос не должен надолго занимать базу
      const legacy = (Array.isArray(b.messages) ? b.messages.slice(0, 200) : []).map(mapMsg);
      const modern = (Array.isArray(b.data) ? b.data.slice(0, 200) : []).concat(!b.data && (b.message_id || b.messageId) ? [b] : []).map(mapMsg);
      for (const m of legacy.concat(modern)) {
        // чистое статусное событие — без текста и вложения: обновляет статус уже известного сообщения
        if (m.status && m.status !== 'inbound' && !(m.text || m.contentUri)) { if (m.messageId) db.prepare('UPDATE messages SET status=? WHERE external_id=?').run(String(m.status).slice(0, 20), m.messageId); continue; }
        // Свои отправки узнаём по префиксу внешнего id (karkas-) — они уже лежат в базе.
        // Флагу isEcho на слово не верим: когда обе CRM работают через одну интеграцию
        // Wazzup (один ключ на всех), ответы менеджеров из amoCRM приходят именно с
        // isEcho, и история оказывалась половинной — только с сообщениями клиентов.
        // Повторы гасит уникальный индекс external_id.
        if (String(m.messageId || '').startsWith('karkas-')) continue;
        // В старом формате (messages[]) нет поля direction: ответ менеджера из
        // второй CRM узнаётся по isEcho. Без этой ветки собственные ответы
        // сохранялись входящими — вставали слева, уведомляли всю команду и
        // даже заводили карточку «клиента» из данных сотрудника.
        if (m.outbound || m.isEcho) { await upsertOutgoing(m); continue; }
        await upsertIncoming({ channel: wzChannel(m.chatType), chatType: normChatType(m.chatType), phone: m.contact?.phone || '', chatId: m.chatId || '', name: m.contact?.name || m.authorName || '', body: wzBody(m), contentUri: m.contentUri || '', contentName: m.fileName || wzNameFromUri(m.contentUri), external_id: m.messageId, channelId: m.channelId, author: m.authorName || '', eventAt:m.eventAt || '' });
      }
      const fwd = getSetting('WAZZUP_FORWARD_URL');
      // Wazzup присылает входящие на один адрес: если мессенджеры подключены ещё
      // и к другой CRM, копия пачки уходит туда же, и чаты живут в обеих системах
      if (fwd && !b.test) {
        fetch(fwd, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: rawBody, signal: AbortSignal.timeout(8000) })
          .catch(e => logActivity(`Не удалось продублировать сообщения клиентов на вторую CRM: ${e.message}`, null, null, 'Wazzup'));
      }
      const inbound = legacy.concat(modern).filter(m => !(m.status && m.status !== 'inbound' && !(m.text || m.contentUri)) && !String(m.messageId || '').startsWith('karkas-') && !m.outbound && !m.isEcho).length;
      if (inbound) {
        const total = Number(db.prepare("SELECT value FROM settings WHERE key='WZ_HOOK_MSG_TOTAL'").get()?.value || 0) + inbound;
        wzHookMark('WZ_HOOK_MSG_TOTAL', String(total));
        // В ленту событий приём сообщений не пишется: каждое входящее
        // оставляло строку «Wazzup: получено сообщений», и в активный день
        // лента на рабочем столе состояла из них целиком. Дойдёт ли входящее,
        // админ видит по счётчику и дате последнего приёма в настройках,
        // а лента — про действия коллег: клиенты, сделки, письма, документы.
      }
      // пустой статус не записываем: он стирал бы подпись о доставке у сообщения
      for (const s of (Array.isArray(b.statuses) ? b.statuses : []).slice(0, 500)) if (s.status && s.messageId) db.prepare('UPDATE messages SET status=? WHERE external_id=?').run(String(s.status).slice(0, 20), s.messageId);
      for (const cu of (Array.isArray(b.channelsUpdates) ? b.channelsUpdates : []).slice(0, 100)) db.prepare('INSERT INTO channels(provider,external_id,state) VALUES(?,?,?) ON CONFLICT(external_id) DO UPDATE SET state=excluded.state').run('wazzup', String(cu.channelId || '').slice(0, 80), String(cu.state || '').slice(0, 40));
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
      const hToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || cookieOf(req).karkas_token || '';
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
      // (каждый требует вычисления scrypt). Порог настраивается: большой офис за
      // одним адресом или мобильный оператор со многими сотрудниками иначе
      // упрутся в потолок и сотрудник получит отказ на ровном месте.
      const floodLimit = Math.max(30, Number(getSetting('LOGIN_FLOOD_LIMIT', '300')) || 300);
      const flood = rateLimit('login-flood:' + ip, floodLimit, 300000);
      if (!flood.ok) { res.setHeader('Retry-After', String(flood.retryAfter || 300)); return json(res, 429, { error: `Слишком много запросов на вход. Повторите через ${flood.retryAfter || 300} с.` }) }
      // Лимит из настроек считает только НЕУДАЧНЫЕ попытки по конкретной
      // учётной записи: 50 сотрудников за одним офисным IP входят одновременно,
      // а подбор пароля всё равно упирается в предел.
      const limit = Math.max(1, Number(getSetting('LOGIN_RATE_LIMIT', '12')) || 12);
      const b = await readBody(req);
      const emailKey = String(b.email || '').trim().toLowerCase().slice(0, 160);
      // адрес ищем без учёта регистра и пробелов: сотрудник вводит свой адрес
      // так, как он записан в карточке, и получает вход, а не отказ
      const user = db.prepare('SELECT * FROM users WHERE lower(trim(email))=? AND active=1 ORDER BY id LIMIT 1').get(emailKey);
      // проверяем пароль даже для несуществующего e-mail: время ответа не выдаёт, зарегистрирован ли адрес
      const passOk = await checkPassAsync(String(b.password || ''), user ? user.pass : 'fake-salt:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000');
      if (!user || !passOk) {
        // Лимит на учётную запись — основная защита от подбора: он считает
        // неудачные попытки конкретного сотрудника и не трогает остальных.
        const rlAcc = emailKey ? rateLimit('login-acc:' + emailKey, limit, 300000) : { ok: true };
        if (!rlAcc.ok) { res.setHeader('Retry-After', String(rlAcc.retryAfter || 300)); return json(res, 429, { error: `Слишком много неудачных попыток входа для этого e-mail. Повторите через ${Math.max(1, Math.ceil((rlAcc.retryAfter || 300) / 60))} мин. или обратитесь к администратору для сброса пароля.` }) }
        // Лимит на адрес считает только попытки для несуществующих e-mail:
        // офис за одним интернет-адресом не должен отвечать блокировкой на
        // чужую опечатку, а перебор «разными» адресами упирается в предел.
        if (!user && emailKey) {
          const rlSpray = rateLimit('login-spray:' + ip, Math.max(10, Number(getSetting('LOGIN_SPRAY_LIMIT', '30')) || 30), 300000);
          if (!rlSpray.ok) { res.setHeader('Retry-After', String(rlSpray.retryAfter || 300)); return json(res, 429, { error: 'Слишком много попыток входа с несуществующими e-mail. Проверьте адрес или обратитесь к администратору.' }) }
        }
        return json(res, 401, { error: 'Неверный e-mail или пароль' });
      }
      // успешный вход обнуляет счётчик неудач этой учётной записи — опечатка
      // в пароле не блокирует сотрудника и не мешает коллегам за тем же IP
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
    // Токен принимается только в заголовке или HttpOnly-cookie: URLы
    // попадают в историю браузера, журналы и заголовки Referer.
    const presented = bearer || cookieOf(req).karkas_token || '';
    const user = verify(presented);
    // Ответ на недействительный сеанс намеренно общий: поддельная подпись не
    // должна получать больше сведений, чем её отсутствие. Причину обрыва
    // сеанса объясняет интерфейс — по признаку «здесь уже работали».
    if (p.startsWith('/api/') && !user) return json(res, 401, sessionFailure(presented) || { error: 'Требуется авторизация' });
    if (user?.must_change_password && (p.startsWith('/api/') || p.startsWith('/uploads/')) && !['/api/me', '/api/me/password'].includes(p)) return json(res, 403, { code: 'PASSWORD_CHANGE_REQUIRED', error: 'Сначала смените временный пароль' });
    if (user && user.role !== 'admin' && ['/api/settings', '/api/competitor-sources', '/api/backup', '/api/export/json', '/api/backups'].includes(p)) return json(res, 403, { error: 'Только для администратора' });
    if (p === '/api/events') {
      // Потолок одновременных живых соединений на учётную запись: скрипт или
      // зависшая вкладка, не закрывающая потоки, не должны исчерпывать
      // дескрипторы сервера. Лишние прежние соединения закрываются, новое живёт.
      let n = 0;
      for (const r of clients) if (r.userId === Number(user.id) && ++n >= 10) { clients.delete(r); try { r.end(); } catch {} }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('event: ready\ndata: {}\n\n');
      res.userId = user.id; res.role = user.role; clients.add(res);
      // heartbeat: прокси не рвут «молчащие» соединения
      const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
      res.on('close', () => { clearInterval(hb); clients.delete(res); });
      return;
    }
    if (p === '/api/me') return json(res, 200, { user });
    // тема оформления личная, как в amoCRM: хранится у сотрудника, а не в браузере,
    // поэтому на общем компьютере у каждого свои светлая/тёмная настройки
    if (p === '/api/me/theme' && req.method === 'PATCH') {
      const b = await readBody(req);
      const t = String(b.theme || '');
      if (!['light', 'dark', 'auto'].includes(t)) return json(res, 400, { error: 'Неизвестная тема: доступна светлая, тёмная и «как в системе»' });
      db.prepare('UPDATE users SET theme=? WHERE id=?').run(t === 'auto' ? '' : t, user.id);
      return json(res, 200, { ok: true, theme: t });
    }
    // любимый раздел: CRM открывается на том экране, где сотрудник работал,
    // а не каждый раз на рабочем столе; хранится у сотрудника, как тема
    if (p === '/api/me/pref' && req.method === 'PATCH') {
      const b = await readBody(req);
      const v = String(b.view || '');
      if (!['dashboard', 'pipe', 'inbox', 'contacts', 'companies', 'tasks', 'products', 'competitors', 'analytics', 'settings', 'routing', 'classification', 'training'].includes(v)) return json(res, 400, { error: 'Неизвестный раздел' });
      db.prepare('UPDATE users SET pref_view=? WHERE id=?').run(v, user.id);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/meta') return json(res, 200, {
      version: VERSION, schema: SCHEMA_VERSION, user,
      company: { name: getSetting('COMPANY_NAME', 'Моя компания'), currency: getSetting('CURRENCY', '₽') },
      taskTypes: [{ id: 'call', name: 'Звонок' }, { id: 'meeting', name: 'Встреча' }, { id: 'message', name: 'Сообщение' }, { id: 'email', name: 'Письмо' }, { id: 'other', name: 'Другое' }],
      sources: ['manual', 'import', 'site', 'email', ...WZ_ALL, ...WZ_ALL.map(t => 'wazzup-' + t)],
      customFields: getCustomFields(),
      features: { email: !!getSetting('SMTP_HOST'), wazzup: !!getSetting('WAZZUP_API_KEY') },
      // правило распределения нужно интерфейсу: по нему считается подсказка
      // «кому достанется новый контакт» в форме. План продаж сюда не кладётся:
      // интерфейс берёт его из аналитики, а общий ответ читает и партнёр,
      // которому внутренние планы компании не предназначены
      autoAssign: getSetting('AUTO_ASSIGN', '0') === '1',
      activeUsers: db.prepare('SELECT COUNT(*) n FROM users WHERE active=1').get().n,
    });
    if (user && p.startsWith('/api/') && user.role === 'viewer' && req.method !== 'GET' && !['/api/me/password', '/api/me/theme', '/api/conversations/read'].includes(p)) return json(res, 403, { error: 'Роль «Наблюдатель» — только просмотр' });
    // Партнёр: своя учётка и свои лиды. Аналитика, рассылки, контроль качества,
    // настройки и чужие карточки закрыты здесь централизованно, а списки ниже
    // дополнительно фильтруются по владельцу.
    if (user && user.role === 'partner' && p.startsWith('/api/')) {
      const PARTNER_GET = [/^\/api\/me$/, /^\/api\/meta$/, /^\/api\/events$/, /^\/api\/dashboard$/, /^\/api\/pipelines$/, /^\/api\/users$/, /^\/api\/search$/, /^\/api\/deals(\/\d+)?$/, /^\/api\/contacts(\/\d+)?$/, /^\/api\/tasks(\/\d+)?$/, /^\/api\/notes(\/\d+)?$/, /^\/api\/conversations$/, /^\/api\/conversations\/\d+\/messages$/, /^\/api\/messages\/\d+\/file$/, /^\/api\/templates$/, /^\/api\/custom-fields$/, /^\/api\/companies$/, /^\/api\/deals\/\d+\/(print|products)$/, /^\/api\/partner-training$/];
      const PARTNER_WRITE = [/^\/api\/me\/(password|theme|pref)$/, /^\/api\/deals\/\d+$/, /^\/api\/tasks$/, /^\/api\/tasks\/\d+$/, /^\/api\/notes$/, /^\/api\/notes\/\d+$/, /^\/api\/conversations$/, /^\/api\/conversations\/read$/, /^\/api\/conversations\/\d+\/(messages|upload|email)$/, /^\/api\/messages\/\d+\/refetch$/, /^\/api\/deals\/\d+\/send-doc$/];
      if (!(req.method === 'GET' || req.method === 'HEAD' ? PARTNER_GET : PARTNER_WRITE).some(re => re.test(p)))
        return json(res, 403, { error: 'Партнёру доступны его сделки, клиенты и задачи' });
      if (!partnerOwnsPath(user, p)) return json(res, 403, { error: 'Это чужая карточка: партнёр видит только свои лиды' });
    }
    // Руководитель и классификатор получают отдельные API-контуры, а не обычные
    // права администратора. Запрет по умолчанию закрывает новые маршруты, пока
    // их явно не добавили в матрицу доступа.
    if (user && user.role === 'rop' && p.startsWith('/api/')) {
      const read = [/^\/api\/(me|meta|events|shifts|routing\/queue|routing\/assigned|routing\/managers|classification\/queue|classification\/classifiers|classification\/deals\/\d+|reports\/team|reports\/team\/records|reports\/sla|reports\/sla\/records|partner-transfers|pipelines|quality|quality\/reviews|quality\/reviews\/\d+|quality\/conversion)$/];
      const write = [/^\/api\/me\/(password|theme|pref)$/, /^\/api\/routing\/(assign|return|priority)$/, /^\/api\/classification\/(assign|deals\/\d+)$/, /^\/api\/partner-transfers(?:\/\d+)?$/];
      const allowed = (req.method === 'GET' || req.method === 'HEAD') ? read.some(re => re.test(p)) : write.some(re => re.test(p));
      if (!allowed) return json(res,403,{error:'Эта операция руководителю отдела продаж недоступна.'});
    }
    if (user && user.role === 'classifier' && p.startsWith('/api/')) {
      const read = [/^\/api\/(me|meta|events)$/, /^\/api\/classification\/queue$/, /^\/api\/classification\/deals\/\d+$/];
      const write = [/^\/api\/me\/(password|theme|pref)$/, /^\/api\/classification\/deals\/\d+$/];
      const allowed = (req.method === 'GET' || req.method === 'HEAD') ? read.some(re => re.test(p)) : write.some(re => re.test(p));
      if (!allowed) return json(res,403,{error:'Классификатору доступны только назначенные обращения и поля классификации.'});
    }
    // Доступ к карточке проверяется на сервере даже при ручном запросе по ID.
    if (user && user.role === 'manager' && p.startsWith('/api/') && !managerOwnsPath(user, p))
      return json(res, 403, { error: 'Менеджеру доступны только его сделки и связанные с ними карточки' });
    // настройки, команда, воронки, шаблоны, автоматизации, ключи и обслуживание — только администратор
    if (user && user.role !== 'admin' && req.method !== 'GET' && ADMIN_ONLY.some(re => re.test(p))) {
      const hint = ADMIN_ONLY_HINT.find(([re]) => re.test(p));
      return json(res, 403, { error: hint ? hint[1] : 'Это может менять только администратор (роль в Настройки → Команда)' });
    }
    if(user&&req.method==='GET'&&(/^\/api\/(deals|contacts|conversations|search)(?:\/|$)/.test(p)||/^\/api\/conversations\/\d+\/messages$/.test(p))){
      const m=p.match(/^\/api\/(deals|contacts|conversations)\/(\d+)/);logAccess(user,'read',m?.[1]||'search',m?.[2]||'',req.method);
    }

    // ===== teams, shifts, queue and classification =====
    if (p === '/api/teams') {
      if (!requireAdmin(user,res)) return;
      if (req.method === 'GET') return json(res,200,db.prepare('SELECT * FROM teams ORDER BY name COLLATE NOCASE,id').all());
      if (req.method === 'POST') {
        const b=await readBody(req),name=String(b.name||'').trim().slice(0,80);
        if(!name)return json(res,400,{error:'Укажите название команды'});
        try { const r=db.prepare('INSERT INTO teams(name) VALUES(?)').run(name); logActivity(`Создана команда «${name}»`,'teams',Number(r.lastInsertRowid),user.name); return json(res,201,db.prepare('SELECT * FROM teams WHERE id=?').get(r.lastInsertRowid)); }
        catch(e){if(/UNIQUE/i.test(e.message))return json(res,409,{error:'Команда с таким названием уже есть'});throw e;}
      }
      return json(res,405,{error:'Метод не поддерживается'});
    }
    if (p === '/api/shifts') {
      if (!['admin','rop','manager'].includes(user.role)) return json(res,403,{error:'Смены доступны руководителю и сотруднику.'});
      if (req.method !== 'GET') return json(res,405,{error:'Используйте отдельное действие начала или завершения смены.'});
      let rows;
      if(user.role==='manager') rows=db.prepare(`SELECT s.*,u.name manager_name,u.team_id FROM shift_sessions s JOIN users u ON u.id=s.user_id WHERE s.user_id=? ORDER BY s.id DESC LIMIT 30`).all(user.id);
      else if(user.role==='rop') {
        if(!user.team_id)return json(res,403,{error:'Руководителю сначала назначают команду.'});
        rows=db.prepare(`SELECT s.*,u.name manager_name,u.team_id FROM shift_sessions s JOIN users u ON u.id=s.user_id WHERE u.team_id=? ORDER BY s.id DESC LIMIT 300`).all(user.team_id);
      } else rows=db.prepare(`SELECT s.*,u.name manager_name,u.team_id FROM shift_sessions s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 500`).all();
      return json(res,200,{shifts:rows,active:rows.filter(s=>!s.ended_at)});
    }
    if (p === '/api/shifts/start' && req.method === 'POST') {
      if(user.role!=='manager')return json(res,403,{error:'Начать смену может сам менеджер.'});
      const result=shiftStart(user);
      logAccess(user,'shift_start','shift',result.shift.id,'POST');
      if(result.created) {
        logActivity(`Смена начата${result.assigned.length?`: из очереди получено лидов ${result.assigned.length}`:''}`,'users',user.id,user.name);
        for(const id of result.assigned) broadcastTo(user.id,'notify',{type:'deal_assigned',id,title:routeContext(id)?.title||'Новый лид'});
        broadcast('change',{table:'routing'});
      }
      return json(res,200,{started:true,alreadyActive:!result.created,shift:result.shift,assigned:result.assigned,queueRemaining:Number(db.prepare("SELECT COUNT(*) n FROM lead_routing WHERE queue_status='queued'").get().n)});
    }
    if (p === '/api/shifts/end' && req.method === 'POST') {
      if(user.role!=='manager')return json(res,403,{error:'Завершить смену может сам менеджер.'});
      const b=await readBody(req),reason=String(b.reason||'').trim().slice(0,500);
      if(reason.length<5)return json(res,400,{error:'Укажите причину завершения смены (не менее 5 символов).'});
      const result=shiftEnd(user,reason);
      if(!result.shift)return json(res,409,{error:'Активная смена не найдена.'});
      logAccess(user,'shift_end','shift',result.shift.id,'POST');
      logActivity(`Смена завершена: возвращено неотвеченных лидов ${result.returned.length}, оставлено ответственных ${result.retained.length}; причина: ${reason}`,'users',user.id,user.name);
      broadcast('change',{table:'routing'});
      return json(res,200,{ended:true,...result});
    }
    if (p === '/api/routing/managers' && req.method === 'GET') {
      if(!['admin','rop'].includes(user.role))return json(res,403,{error:'Список доступен руководителю и администратору.'});
      if(user.role==='rop'&&!user.team_id)return json(res,403,{error:'Руководителю сначала назначают команду.'});
      const teamClause=user.role==='rop'?' AND u.team_id=?':'';
      const params=user.role==='rop'?[user.team_id]:[];
      return json(res,200,db.prepare(`SELECT u.id,u.name,u.team_id,u.max_open_leads,u.routing_regions,u.routing_directions,
        EXISTS(SELECT 1 FROM shift_sessions s WHERE s.user_id=u.id AND s.ended_at IS NULL) on_shift,
        (SELECT COUNT(*) FROM deals d WHERE d.responsible_id=u.id AND d.stage NOT IN ('won','lost')) open_leads
        FROM users u WHERE u.role='manager' AND u.active=1${teamClause} ORDER BY u.name COLLATE NOCASE,u.id`).all(...params));
    }
    if (p === '/api/routing/queue' && req.method === 'GET') {
      if(!['admin','rop'].includes(user.role))return json(res,403,{error:'Очередь обращений доступна руководителю и администратору.'});
      if(user.role==='rop'&&!user.team_id)return json(res,403,{error:'Руководителю сначала назначают команду.'});
      const teamClause=user.role==='rop'?' AND r.queue_team_id=?':'';
      const params=user.role==='rop'?[user.team_id]:[];
      const rows=db.prepare(`SELECT d.id,d.title,d.stage,d.pipeline_id,d.contact_id,d.priority,d.lead_source,d.created_at,
          c.name contact_name,c.phone contact_phone,r.received_at,r.received_time_source,r.queued_at,r.queue_status,
          r.priority queue_priority,r.queue_team_id,r.assigned_at,r.first_response_at,lc.status classification_status,lc.region,lc.direction
        FROM deals d JOIN lead_routing r ON r.deal_id=d.id LEFT JOIN contacts c ON c.id=d.contact_id
        LEFT JOIN lead_classifications lc ON lc.deal_id=d.id
        WHERE r.queue_status='queued' AND d.responsible_id IS NULL AND d.stage NOT IN ('won','lost')${teamClause}
        ORDER BY CASE r.priority WHEN 'urgent' THEN 0 ELSE 1 END,r.queued_at,d.id LIMIT 500`).all(...params);
      logAccess(user,'queue_view','routing','',req.method);
      return json(res,200,{queue:rows,count:rows.length});
    }
    if (p === '/api/routing/assigned' && req.method === 'GET') {
      if(!['admin','rop'].includes(user.role))return json(res,403,{error:'Назначенные обращения доступны руководителю и администратору.'});
      if(user.role==='rop'&&!user.team_id)return json(res,403,{error:'Руководителю сначала назначают команду.'});
      const teamClause=user.role==='rop'?' AND (owner.team_id=? OR (owner.team_id IS NULL AND r.queue_team_id=?))':'';
      const params=user.role==='rop'?[user.team_id,user.team_id]:[];
      const rows=db.prepare(`SELECT d.id,d.title,d.amount,d.stage,d.pipeline_id,d.priority,d.lead_source,d.created_at,
          c.name contact_name,c.phone contact_phone,owner.id manager_id,owner.name manager_name,owner.team_id,
          r.received_at,r.assigned_at,r.first_assigned_at,r.first_assigned_user_id,r.first_response_at,r.first_response_user_id,r.queue_team_id,r.priority queue_priority,
          lc.status classification_status
        FROM deals d JOIN lead_routing r ON r.deal_id=d.id LEFT JOIN contacts c ON c.id=d.contact_id
        JOIN users owner ON owner.id=d.responsible_id LEFT JOIN lead_classifications lc ON lc.deal_id=d.id
        WHERE d.responsible_id IS NOT NULL AND d.stage NOT IN ('won','lost')${teamClause}
        ORDER BY r.assigned_at DESC,d.id DESC LIMIT 500`).all(...params);
      logAccess(user,'assigned_leads_view','routing','',req.method);
      return json(res,200,{assigned:rows,count:rows.length});
    }
    if (p === '/api/routing/assign' && req.method === 'POST') {
      if(!['admin','rop'].includes(user.role))return json(res,403,{error:'Назначать лиды может руководитель или администратор.'});
      const b=await readBody(req),dealId=Number(b.deal_id),managerId=Number(b.manager_id),reason=String(b.reason||'').trim().slice(0,500);
      if(!Number.isSafeInteger(dealId)||dealId<1||!Number.isSafeInteger(managerId)||managerId<1)return json(res,400,{error:'Выберите обращение и менеджера.'});
      if(reason.length<5)return json(res,400,{error:'Для назначения нужна причина (не менее 5 символов).'});
      const manager=db.prepare("SELECT * FROM users WHERE id=? AND active=1 AND role='manager'").get(managerId);
      if(!manager)return json(res,400,{error:'Активный менеджер не найден.'});
      const deal=routeContext(dealId);
      if(!deal)return json(res,404,{error:'Сделка не найдена.'});
      if(['won','lost'].includes(deal.stage))return json(res,409,{error:'Закрытую сделку нельзя назначить из очереди.'});
      if(deal.responsible_id)return json(res,409,{error:'Сделка уже назначена. Сначала верните её в очередь с причиной.'});
      if(user.role==='rop'&&(!user.team_id||Number(manager.team_id)!==Number(user.team_id)||deal.queue_team_id&&Number(deal.queue_team_id)!==Number(user.team_id)))return json(res,403,{error:'Руководитель может назначать только лиды и менеджеров своей команды.'});
      const saved=transaction(()=>{
        const current=routeContext(dealId);
        if(current.queue_team_id==null&&user.role==='rop')db.prepare('UPDATE lead_routing SET queue_team_id=? WHERE deal_id=?').run(user.team_id,dealId);
        const next=routeContext(dealId);
        return assignLeadInTransaction(next,manager,user,reason,user.role==='rop'?'rop':'admin',{requireShift:true});
      });
      if(!saved)return json(res,409,{error:'Назначение не выполнено: проверьте команду, лимит нагрузки и ответственного клиента.'});
      logAccess(user,'lead_assign','deal',dealId,'POST');
      logActivity(`Лид «${deal.title}» назначен ${manager.name} (${ROLE_RU[user.role]}: ${reason})`,'deals',dealId,user.name);
      broadcastTo(managerId,'notify',{type:'deal_assigned',id:dealId,title:deal.title});broadcast('change',{table:'routing'});
      return json(res,200,{assigned:true,deal_id:dealId,manager_id:managerId});
    }
    if (p === '/api/routing/return' && req.method === 'POST') {
      if(!['admin','rop'].includes(user.role))return json(res,403,{error:'Возвращать лиды может руководитель или администратор.'});
      const b=await readBody(req),dealId=Number(b.deal_id),reason=String(b.reason||'').trim().slice(0,500);
      if(!Number.isSafeInteger(dealId)||dealId<1)return json(res,400,{error:'Укажите сделку.'});
      if(reason.length<5)return json(res,400,{error:'Для возврата нужна причина (не менее 5 символов).'});
      const deal=routeContext(dealId);
      if(!deal)return json(res,404,{error:'Сделка не найдена.'});
      const assigned=db.prepare('SELECT id,team_id FROM users WHERE id=?').get(deal.responsible_id);
      if(user.role==='rop'&&(!user.team_id||Number(assigned?.team_id||deal.queue_team_id)!==Number(user.team_id)))return json(res,403,{error:'Руководитель может возвращать только лиды своей команды.'});
      if(!deal.responsible_id)return json(res,200,{returned:false,alreadyQueued:true});
      const oldId=Number(deal.responsible_id);
      transaction(()=>{
        const changed=db.prepare("UPDATE deals SET responsible_id=NULL,responsible=NULL,updated_at=datetime('now') WHERE id=? AND responsible_id=? AND stage NOT IN ('won','lost')").run(dealId,oldId);
        if(!changed.changes)throw Object.assign(new Error('Сделка уже изменилась. Обновите очередь.'),{statusCode:409});
        if(deal.contact_id){
          const still=db.prepare("SELECT 1 x FROM deals WHERE contact_id=? AND responsible_id=? AND stage NOT IN ('won','lost') AND id<>? LIMIT 1").get(deal.contact_id,oldId,dealId);
          if(!still){db.prepare('UPDATE contacts SET responsible_id=NULL WHERE id=? AND responsible_id=?').run(deal.contact_id,oldId);db.prepare('UPDATE conversations SET assigned_id=NULL WHERE contact_id=? AND assigned_id=?').run(deal.contact_id,oldId);}
        }
        db.prepare("UPDATE lead_routing SET queue_status='queued',queued_at=datetime('now'),last_reason=? WHERE deal_id=?").run(reason,dealId);
        assignmentEvent(dealId,'returned',oldId,null,user,user.role==='rop'?'rop':'admin',reason);
      });
      logAccess(user,'lead_return','deal',dealId,'POST');logActivity(`Лид «${deal.title}» возвращён в очередь от ${assigned?.name||'ответственного'} (${reason})`,'deals',dealId,user.name);broadcast('change',{table:'routing'});
      return json(res,200,{returned:true,deal_id:dealId,from_user_id:oldId});
    }
    if (p === '/api/routing/priority' && req.method === 'POST') {
      if(!['admin','rop'].includes(user.role))return json(res,403,{error:'Менять приоритет может руководитель или администратор.'});
      const b=await readBody(req),dealId=Number(b.deal_id),priority=String(b.priority||''),reason=String(b.reason||'').trim().slice(0,500);
      if(!Number.isSafeInteger(dealId)||dealId<1||!['urgent','normal'].includes(priority))return json(res,400,{error:'Приоритет должен быть срочным или обычным.'});
      if(reason.length<5)return json(res,400,{error:'Для изменения приоритета нужна причина.'});
      const deal=routeContext(dealId);if(!deal)return json(res,404,{error:'Сделка не найдена.'});
      if(user.role==='rop'&&(!user.team_id||Number(deal.queue_team_id)!==Number(user.team_id)))return json(res,403,{error:'Приоритет доступен руководителю только в его очереди.'});
      transaction(()=>{db.prepare('UPDATE deals SET priority=?,updated_at=datetime(\'now\') WHERE id=?').run(priority,dealId);db.prepare('UPDATE lead_routing SET priority=?,last_reason=? WHERE deal_id=?').run(priority,reason,dealId);assignmentEvent(dealId,'priority_changed',deal.responsible_id,deal.responsible_id,user,user.role==='rop'?'rop':'admin',reason);});
      logAccess(user,'priority_change','deal',dealId,'POST');broadcast('change',{table:'routing'});return json(res,200,{saved:true,deal_id:dealId,priority});
    }
    if (p === '/api/classification/queue' && req.method === 'GET') {
      if(!['admin','rop','classifier'].includes(user.role))return json(res,403,{error:'Очередь классификации недоступна.'});
      let where="lc.status='pending'",params=[];
      if(user.role==='classifier'){where+=' AND lc.classifier_id=?';params.push(user.id);}
      if(user.role==='rop'){
        if(!user.team_id)return json(res,403,{error:'Руководителю сначала назначают команду.'});
        where+=' AND ((d.responsible_id IS NULL AND r.queue_team_id=?) OR (d.responsible_id IS NOT NULL AND owner.team_id=?))';
        params.push(user.team_id,user.team_id);
      }
      const rows=db.prepare(`SELECT d.id,d.title,d.pipeline_id,d.stage,d.lead_source,d.created_at,c.name contact_name,
          d.responsible_id,owner.team_id,
          r.received_at,r.queue_status,r.priority queue_priority,r.queue_team_id,lc.classifier_id,lc.status,lc.region,lc.direction,lc.topic,
          (SELECT substr(m.body,1,500) FROM messages m WHERE m.deal_id=d.id AND m.direction='in' AND m.body<>'[вложение]' ORDER BY m.id DESC LIMIT 1) last_incoming
        FROM lead_classifications lc JOIN deals d ON d.id=lc.deal_id LEFT JOIN contacts c ON c.id=d.contact_id
        LEFT JOIN lead_routing r ON r.deal_id=d.id LEFT JOIN users owner ON owner.id=d.responsible_id
        WHERE ${where} ORDER BY r.received_at,d.id LIMIT 300`).all(...params);
      let unassigned=[];
      if(user.role==='admin'||user.role==='rop'){
        const teamClause=user.role==='rop'?' AND r.queue_team_id=?':'',unassignedParams=user.role==='rop'?[user.team_id]:[];
        unassigned=db.prepare(`SELECT d.id,d.title,d.pipeline_id,d.stage,d.lead_source,d.created_at,c.name contact_name,
            r.received_at,r.queue_status,r.priority queue_priority,r.queue_team_id,
            (SELECT substr(m.body,1,500) FROM messages m WHERE m.deal_id=d.id AND m.direction='in' AND m.body<>'[вложение]' ORDER BY m.id DESC LIMIT 1) last_incoming
          FROM deals d JOIN lead_routing r ON r.deal_id=d.id LEFT JOIN contacts c ON c.id=d.contact_id
          LEFT JOIN lead_classifications lc ON lc.deal_id=d.id
          WHERE d.responsible_id IS NULL AND d.stage NOT IN ('won','lost') AND r.queue_status='queued' AND lc.deal_id IS NULL${teamClause}
          ORDER BY CASE r.priority WHEN 'urgent' THEN 0 ELSE 1 END,r.queued_at,d.id LIMIT 300`).all(...unassignedParams);
      }
      return json(res,200,{items:rows,unassigned});
    }
    if(p==='/api/classification/classifiers'&&req.method==='GET'){
      if(!['admin','rop'].includes(user.role))return json(res,403,{error:'Список классификаторов доступен руководителю и администратору.'});
      if(user.role==='rop'&&!user.team_id)return json(res,403,{error:'Руководителю сначала назначают команду.'});
      const teamClause=user.role==='rop'?' AND team_id=?':'',params=user.role==='rop'?[user.team_id]:[];
      return json(res,200,db.prepare(`SELECT id,name,team_id FROM users WHERE role='classifier' AND active=1${teamClause} ORDER BY name COLLATE NOCASE,id`).all(...params));
    }
    const classDeal=p.match(/^\/api\/classification\/deals\/(\d+)$/);
    if(classDeal&&['GET','PATCH'].includes(req.method)){
      const dealId=Number(classDeal[1]),row=db.prepare(`SELECT d.id,d.title,d.pipeline_id,d.stage,d.lead_source,d.created_at,d.responsible_id,
        c.name contact_name,owner.team_id owner_team_id,
        r.received_at,r.queue_status,r.priority queue_priority,r.queue_team_id,lc.classifier_id,lc.status,lc.topic,lc.region,lc.direction,lc.suggested_manager_id,lc.classification_note
        FROM lead_classifications lc JOIN deals d ON d.id=lc.deal_id LEFT JOIN contacts c ON c.id=d.contact_id
        LEFT JOIN users owner ON owner.id=d.responsible_id LEFT JOIN lead_routing r ON r.deal_id=d.id WHERE d.id=?`).get(dealId);
      if(!row)return json(res,404,{error:'Обращение для классификации не найдено.'});
      if(user.role==='classifier'&&Number(row.classifier_id)!==Number(user.id))return json(res,404,{error:'Обращение не назначено вам.'});
      const classificationTeam=row.responsible_id?(row.owner_team_id||row.queue_team_id):row.queue_team_id;
      if(user.role==='rop'&&(!user.team_id||Number(classificationTeam||0)!==Number(user.team_id)))return json(res,403,{error:'Это обращение вне вашей команды.'});
      if(req.method==='GET'){
        const messages=db.prepare("SELECT id,channel,direction,body,created_at,event_at,event_time_source FROM messages WHERE deal_id=? AND direction='in' ORDER BY id DESC LIMIT 30").all(dealId);
        const safeDeal={id:row.id,title:row.title,pipeline_id:row.pipeline_id,stage:row.stage,lead_source:row.lead_source,created_at:row.created_at,
          contact_name:row.contact_name,received_at:row.received_at,queue_status:row.queue_status,queue_priority:row.queue_priority,
          classifier_id:row.classifier_id,status:row.status,topic:row.topic,region:row.region,direction:row.direction,classification_note:row.classification_note};
        if(user.role!=='classifier')safeDeal.suggested_manager_id=row.suggested_manager_id;
        logAccess(user,'classification_view','deal',dealId,'GET');return json(res,200,{deal:safeDeal,messages});
      }
      if(!['classifier','admin','rop'].includes(user.role))return json(res,403,{error:'Изменять классификацию может только назначенный классификатор, руководитель или администратор.'});
      const b=await readBody(req),allowed=user.role==='classifier'
        ?['topic','region','direction','classification_note','status']
        :['topic','region','direction','classification_note','status','suggested_manager_id'];
      const patch={};for(const k of allowed)if(b[k]!==undefined)patch[k]=b[k];
      if(!Object.keys(patch).length)return json(res,400,{error:'Нет полей классификации для сохранения.'});
      for(const k of ['topic','region','direction','classification_note'])if(patch[k]!==undefined)patch[k]=String(patch[k]||'').trim().slice(0,k==='classification_note'?500:120);
      if(patch.status!==undefined&&!['pending','complete'].includes(patch.status))return json(res,400,{error:'Статус классификации должен быть «в работе» или «готово».'});
      if(patch.suggested_manager_id!==undefined){patch.suggested_manager_id=patch.suggested_manager_id?Number(patch.suggested_manager_id):null;const mgr=patch.suggested_manager_id?db.prepare("SELECT id,team_id FROM users WHERE id=? AND role='manager' AND active=1").get(patch.suggested_manager_id):null;if(patch.suggested_manager_id&&!mgr)return json(res,400,{error:'Активный менеджер не найден.'});if(user.role==='rop'&&mgr&&Number(mgr.team_id)!==Number(user.team_id))return json(res,403,{error:'Руководитель может рекомендовать только менеджера своей команды.'});}
      patch.updated_by_id=Number(user.id);patch.updated_at=localNow();
      const ks=Object.keys(patch);db.prepare(`UPDATE lead_classifications SET ${ks.map(k=>k+'=?').join(',')} WHERE deal_id=?`).run(...ks.map(k=>patch[k]),dealId);
      logAccess(user,'classification_update','deal',dealId,'PATCH');logActivity(`Классификация сделки ${dealId} обновлена`,'deals',dealId,user.name);
      // Рекомендация менеджера — только подсказка. Назначение остаётся явным
      // действием руководителя в очереди, пока бизнес-правило маршрутизации не согласовано.
      broadcast('change',{table:'classification'});broadcast('change',{table:'routing'});
      const saved=db.prepare('SELECT deal_id,status,topic,region,direction,classification_note,suggested_manager_id,updated_at FROM lead_classifications WHERE deal_id=?').get(dealId);
      if(user.role==='classifier')delete saved.suggested_manager_id;
      return json(res,200,{saved:true,deal:saved});
    }
    if (p === '/api/classification/assign' && req.method === 'POST') {
      if(!['admin','rop'].includes(user.role))return json(res,403,{error:'Назначать классификатора может руководитель или администратор.'});
      const b=await readBody(req),dealId=Number(b.deal_id),classifierId=Number(b.classifier_id),reason=String(b.reason||'').trim().slice(0,500);
      if(!Number.isSafeInteger(dealId)||dealId<1||!Number.isSafeInteger(classifierId)||classifierId<1)return json(res,400,{error:'Выберите обращение и классификатора.'});
      if(reason.length<5)return json(res,400,{error:'Укажите причину назначения классификатора.'});
      const cls=db.prepare("SELECT id,team_id FROM users WHERE id=? AND role='classifier' AND active=1").get(classifierId);
      if(!cls)return json(res,400,{error:'Активный классификатор не найден.'});
      const deal=routeContext(dealId);if(!deal)return json(res,404,{error:'Сделка не найдена.'});
      const ownerTeam=deal.responsible_id?db.prepare('SELECT team_id FROM users WHERE id=?').get(deal.responsible_id)?.team_id:null;
      const dealTeam=ownerTeam||deal.queue_team_id;
      if(user.role==='rop'&&(!user.team_id||Number(cls.team_id)!==Number(user.team_id)||Number(dealTeam||0)!==Number(user.team_id)))return json(res,403,{error:'Назначать можно только обращение и классификатора своей команды.'});
      db.prepare(`INSERT INTO lead_classifications(deal_id,classifier_id,status,assigned_by_id,updated_by_id) VALUES(?,?,'pending',?,?)
        ON CONFLICT(deal_id) DO UPDATE SET classifier_id=excluded.classifier_id,status='pending',assigned_by_id=excluded.assigned_by_id,updated_by_id=excluded.updated_by_id,updated_at=datetime('now')`).run(dealId,classifierId,user.id,user.id);
      logAccess(user,'classifier_assign','deal',dealId,'POST');logActivity(`Классификатор назначен на сделку ${dealId} (${reason})`,'deals',dealId,user.name);
      broadcastTo(classifierId,'notify',{type:'classification_assigned',id:dealId,title:deal.title});broadcast('change',{table:'classification'});
      return json(res,200,{assigned:true,deal_id:dealId,classifier_id:classifierId});
    }

    // ===== partner transfer: access is granted per deal and expires immediately =====
    if (p === '/api/partner-transfers') {
      if(!['admin','rop'].includes(user.role))return json(res,403,{error:'Передачу партнёру меняет руководитель или администратор.'});
      if(req.method==='GET'){
        const rows=db.prepare(`SELECT pt.*,d.title deal_title,d.pipeline_id,d.stage,d.contact_id,c.name contact_name,
            u.name partner_name,owner.name responsible_name,owner.team_id,r.queue_team_id
          FROM partner_transfers pt JOIN deals d ON d.id=pt.deal_id LEFT JOIN contacts c ON c.id=d.contact_id
          JOIN users u ON u.id=pt.partner_id LEFT JOIN users owner ON owner.id=d.responsible_id LEFT JOIN lead_routing r ON r.deal_id=d.id
          WHERE pt.active=1 ORDER BY pt.created_at DESC,pt.id DESC LIMIT 500`).all();
        const visible=user.role==='rop'?(user.team_id?rows.filter(r=>Number(r.team_id||r.queue_team_id||0)===Number(user.team_id)):[]):rows;
        if(user.role==='rop'&&!user.team_id)return json(res,403,{error:'Руководителю сначала назначают команду.'});
        const partners=db.prepare("SELECT id,name FROM users WHERE role='partner' AND active=1 ORDER BY name COLLATE NOCASE,id").all();
        const pipelineId=partnerPipelineId(),allowedStages=[...partnerAllowedStages()];
        logAccess(user,'partner_transfer_list','partner_transfers','',req.method);
        return json(res,200,{transfers:visible,partners,policy:{pipeline_id:pipelineId||null,allowed_stages:allowedStages,enabled:!!pipelineId&&allowedStages.length>0}});
      }
      if(req.method==='POST'){
        const b=await readBody(req),dealId=Number(b.deal_id),partnerId=Number(b.partner_id),reason=String(b.reason||'').trim().slice(0,500);
        if(!Number.isSafeInteger(dealId)||dealId<1||!Number.isSafeInteger(partnerId)||partnerId<1)return json(res,400,{error:'Выберите сделку и партнёра.'});
        if(reason.length<5)return json(res,400,{error:'Для передачи нужна причина (не менее 5 символов).'});
        const deal=db.prepare('SELECT d.*,r.queue_team_id FROM deals d LEFT JOIN lead_routing r ON r.deal_id=d.id WHERE d.id=?').get(dealId);
        if(!deal)return json(res,404,{error:'Сделка не найдена.'});
        const partner=db.prepare("SELECT id,name FROM users WHERE id=? AND active=1 AND role='partner'").get(partnerId);
        if(!partner)return json(res,400,{error:'Активный аккаунт партнёра не найден.'});
        const pid=partnerPipelineId(),stages=partnerAllowedStages();
        if(!pid||!stages.size)return json(res,409,{error:'Передача партнёру выключена: администратор должен задать разрешённую воронку и этапы.'});
        if(Number(deal.pipeline_id)!==pid||!stages.has(String(deal.stage)))return json(res,409,{error:'Сделка находится вне настроенных этапов передачи.'});
        const owner=deal.responsible_id?db.prepare('SELECT team_id FROM users WHERE id=?').get(deal.responsible_id):null;
        if(user.role==='rop'&&(!user.team_id||Number(owner?.team_id||deal.queue_team_id||0)!==Number(user.team_id)))return json(res,403,{error:'Передавать партнёру можно только сделку своей команды.'});
        const existing=db.prepare('SELECT * FROM partner_transfers WHERE deal_id=? AND active=1').get(dealId);
        if(existing&&Number(existing.partner_id)===partnerId)return json(res,200,{id:existing.id,active:1,alreadyActive:true});
        if(deal.contact_id){
          const conflict=db.prepare(`SELECT pt.deal_id,pt.partner_id FROM partner_transfers pt JOIN deals other ON other.id=pt.deal_id
            WHERE pt.active=1 AND other.contact_id=? AND other.id<>? LIMIT 1`).get(deal.contact_id,dealId);
          if(conflict)return json(res,409,{error:'У этого клиента уже есть активная передача по другой сделке. Сначала отзовите её, чтобы не смешать переписку.'});
        }
        const id=transaction(()=>{
          if(existing){
            db.prepare("UPDATE partner_transfers SET active=0,revoked_at=datetime('now') WHERE id=? AND active=1").run(existing.id);
            db.prepare(`INSERT INTO lead_assignment_events(deal_id,event_type,from_user_id,to_user_id,actor_id,actor_name,source,reason)
              VALUES(?,'partner_revoked',?,NULL,?,?,?,?)`).run(dealId,existing.partner_id,user.id,user.name,user.role,`Сменён партнёр: ${reason}`);
          }
          const ins=db.prepare('INSERT INTO partner_transfers(deal_id,partner_id,active,created_by_id,reason) VALUES(?,?,1,?,?)').run(dealId,partnerId,user.id,reason);
          db.prepare(`INSERT INTO lead_assignment_events(deal_id,event_type,from_user_id,to_user_id,actor_id,actor_name,source,reason)
            VALUES(?,'partner_granted',NULL,?,?,?,?,?)`).run(dealId,partnerId,user.id,user.name,user.role,reason);
          return Number(ins.lastInsertRowid);
        });
        logAccess(user,'partner_grant','deal',dealId,'POST');logActivity(`Сделка «${deal.title}» передана партнёру ${partner.name}: ${reason}`,'deals',dealId,user.name);
        broadcastTo(partnerId,'notify',{type:'partner_transfer',id:dealId,title:deal.title});broadcast('change',{table:'partner-transfers'});
        return json(res,201,{id,deal_id:dealId,partner_id:partnerId,active:1});
      }
      return json(res,405,{error:'Метод не поддерживается'});
    }
    const transferPath=p.match(/^\/api\/partner-transfers\/(\d+)$/);
    if(transferPath&&req.method==='DELETE'){
      if(!['admin','rop'].includes(user.role))return json(res,403,{error:'Отозвать передачу может руководитель или администратор.'});
      const b=await readBody(req),reason=String(b.reason||'').trim().slice(0,500),id=Number(transferPath[1]);
      if(reason.length<5)return json(res,400,{error:'Для отзыва нужна причина (не менее 5 символов).'});
      const row=db.prepare(`SELECT pt.*,d.title,d.responsible_id,r.queue_team_id,u.team_id FROM partner_transfers pt JOIN deals d ON d.id=pt.deal_id
        LEFT JOIN lead_routing r ON r.deal_id=d.id LEFT JOIN users u ON u.id=d.responsible_id WHERE pt.id=? AND pt.active=1`).get(id);
      if(!row)return json(res,404,{error:'Активная передача не найдена.'});
      if(user.role==='rop'&&(!user.team_id||Number(row.team_id||row.queue_team_id||0)!==Number(user.team_id)))return json(res,403,{error:'Руководитель может отозвать передачу только по своей команде.'});
      transaction(()=>{
        db.prepare("UPDATE partner_transfers SET active=0,revoked_at=datetime('now') WHERE id=? AND active=1").run(id);
        db.prepare(`INSERT INTO lead_assignment_events(deal_id,event_type,from_user_id,to_user_id,actor_id,actor_name,source,reason)
          VALUES(?,'partner_revoked',?,NULL,?,?,?,?)`).run(row.deal_id,row.partner_id,user.id,user.name,user.role,reason);
      });
      logAccess(user,'partner_revoke','deal',row.deal_id,'DELETE');logActivity(`Передача сделки «${row.title}» партнёру отозвана: ${reason}`,'deals',row.deal_id,user.name);broadcast('change',{table:'partner-transfers'});
      return json(res,200,{revoked:true,id});
    }

    // ===== team reports and SLA evidence =====
    if(['/api/reports/team','/api/reports/sla','/api/reports/team/records','/api/reports/sla/records'].includes(p)){
      if(!['admin','rop'].includes(user.role))return json(res,403,{error:'Сводку руководителя видят руководитель отдела продаж и администратор.'});
      if(user.role==='rop'&&!user.team_id)return json(res,403,{error:'Руководителю сначала назначают команду.'});
      const dateOk=v=>{const s=String(v||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;};
      const toRaw=u.searchParams.get('to')||localDate(),fromRaw=u.searchParams.get('from')||localDate(new Date(Date.now()-6*864e5));
      if(!dateOk(fromRaw)||!dateOk(toRaw)||fromRaw>toRaw)return json(res,400,{error:'Период задаётся датами в формате ГГГГ-ММ-ДД.'});
      if((Date.parse(toRaw+'T00:00:00Z')-Date.parse(fromRaw+'T00:00:00Z'))/864e5>366)return json(res,400,{error:'Период отчёта не может превышать 367 дней.'});
      const requestedTeam=Number(u.searchParams.get('team_id')||0)||0,managerId=Number(u.searchParams.get('manager_id')||0)||0,source=String(u.searchParams.get('source')||'').trim().slice(0,80);
      if(user.role==='rop'&&requestedTeam&&requestedTeam!==Number(user.team_id))return json(res,403,{error:'Можно смотреть только свою команду.'});
      const teamId=user.role==='rop'?Number(user.team_id):requestedTeam;
      if(managerId){const m=db.prepare("SELECT id,team_id FROM users WHERE id=? AND role='manager'").get(managerId);if(!m)return json(res,400,{error:'Менеджер не найден.'});if(teamId&&Number(m.team_id)!==teamId)return json(res,403,{error:'Менеджер не входит в выбранную команду.'});}
      const clauses=["date(COALESCE(NULLIF(r.received_at,''),NULLIF(d.created_at,'')),'localtime') BETWEEN ? AND ?"],params=[fromRaw,toRaw];
      if(teamId){clauses.push('COALESCE(u.team_id,r.queue_team_id)=?');params.push(teamId);}
      if(managerId){clauses.push('d.responsible_id=?');params.push(managerId);}
      if(source){clauses.push('COALESCE(d.lead_source,\'\')=?');params.push(source);}
      const where=clauses.join(' AND ');
      const reportRows=db.prepare(`SELECT d.id,d.title,d.contact_id,d.lead_source,d.stage,d.created_at,d.responsible_id,u.name manager_name,u.team_id,
          r.received_at,r.received_time_source,r.queued_at,r.queue_status,r.assigned_at,r.first_assigned_at,r.first_assigned_user_id,
          r.first_response_at,r.first_response_user_id,r.priority,
          (SELECT COUNT(*) FROM lead_assignment_events e WHERE e.deal_id=d.id AND e.event_type='returned' AND date(e.created_at,'localtime') BETWEEN ? AND ?) return_count
        FROM deals d LEFT JOIN lead_routing r ON r.deal_id=d.id LEFT JOIN users u ON u.id=d.responsible_id
        WHERE ${where} ORDER BY r.received_at,d.id LIMIT 50001`).all(fromRaw,toRaw,...params);
      if(reportRows.length>50000)return json(res,413,{error:'Для этого периода слишком много записей. Выберите более короткий период.'});
      const minutes=(a,b)=>{if(!a||!b)return null;const x=Date.parse(String(a).replace(' ','T')+'Z'),y=Date.parse(String(b).replace(' ','T')+'Z');return Number.isFinite(x)&&Number.isFinite(y)&&y>=x?(y-x)/60000:null;};
      const medianOf=xs=>{const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const i=Math.floor(a.length/2);return Number((a.length%2?a[i]:(a[i-1]+a[i])/2).toFixed(1));};
      const firstAssignmentAt=r=>r.first_assigned_at||r.assigned_at;
      const assignmentSamples=reportRows.map(r=>minutes(r.received_at,firstAssignmentAt(r))).filter(x=>x!==null);
      const responseSamples=reportRows.map(r=>minutes(firstAssignmentAt(r),r.first_response_at)).filter(x=>x!==null);
      const assignSla=Number(getSetting('SLA_ASSIGN_MINUTES','0'))||null,responseSla=Number(getSetting('SLA_FIRST_RESPONSE_MINUTES','0'))||null;
      const assignmentViolations=assignSla?assignmentSamples.filter(x=>x>assignSla).length:null,responseViolations=responseSla?responseSamples.filter(x=>x>responseSla).length:null;
      if(p.endsWith('/records')){
        const metric=String(u.searchParams.get('metric')||'all');
        if(!['all','assignment','first_response','queued','returns','calls','meetings'].includes(metric))return json(res,400,{error:'Неизвестный показатель отчёта.'});
        if(metric==='calls'||metric==='meetings')return json(res,200,{status:'нет данных',reason:metric==='calls'?'В CRM нет подключённого источника событий телефонии.':'Не согласован источник и набор статусов встречи.',records:[]});
        let chosen=reportRows;
        if(metric==='assignment')chosen=chosen.filter(r=>firstAssignmentAt(r));
        if(metric==='first_response')chosen=chosen.filter(r=>r.first_response_at);
        if(metric==='queued')chosen=chosen.filter(r=>r.queue_status==='queued');
        if(metric==='returns')chosen=chosen.filter(r=>Number(r.return_count)>0);
        const records=chosen.slice(0,200).map(r=>({id:Number(r.id),title:r.title,contact_id:r.contact_id||null,lead_source:r.lead_source||'нет данных',manager_id:r.responsible_id||null,manager_name:r.manager_name||'не назначен',received_at:r.received_at||null,received_time_source:r.received_time_source||'нет данных',assigned_at:r.assigned_at||null,first_assigned_at:firstAssignmentAt(r)||null,first_assigned_user_id:r.first_assigned_user_id||null,first_response_at:r.first_response_at||null,first_response_user_id:r.first_response_user_id||null,assignment_minutes:minutes(r.received_at,firstAssignmentAt(r)),first_response_minutes:minutes(firstAssignmentAt(r),r.first_response_at),queue_status:r.queue_status||'нет данных',priority:r.priority||'normal'}));
        logAccess(user,'report_records','reports',metric,'GET');return json(res,200,{status:chosen.length?'данные есть':'нет данных',count:chosen.length,records,limit:200,hasMore:chosen.length>200});
      }
      const sources=db.prepare(`SELECT COALESCE(NULLIF(d.lead_source,''),'нет данных') source,
          COUNT(DISTINCT CASE WHEN d.contact_id IS NULL THEN 'd:'||d.id ELSE 'c:'||d.contact_id END) unique_leads
        FROM deals d LEFT JOIN lead_routing r ON r.deal_id=d.id LEFT JOIN users u ON u.id=d.responsible_id
        WHERE ${where} GROUP BY COALESCE(NULLIF(d.lead_source,''),'нет данных') ORDER BY unique_leads DESC,source`).all(...params);
      const managerMap=new Map();
      for(const r of reportRows){
        if(!r.responsible_id)continue;
        const id=Number(r.responsible_id);
        if(!managerMap.has(id))managerMap.set(id,{id,name:r.manager_name,team_id:r.team_id,leads:0,unique_contacts:new Set(),assignment:[],first_response:[],returns:0});
        const m=managerMap.get(id),first=firstAssignmentAt(r),assignment=minutes(r.received_at,first),response=minutes(first,r.first_response_at);
        m.leads++;if(r.contact_id)m.unique_contacts.add(Number(r.contact_id));
        if(assignment!==null)m.assignment.push(assignment);if(response!==null)m.first_response.push(response);
        m.returns+=Number(r.return_count)||0;
      }
      const managers=[...managerMap.values()].map(m=>({id:m.id,name:m.name,team_id:m.team_id,leads:m.leads,unique_leads:m.unique_contacts.size,median_assignment_minutes:medianOf(m.assignment),assignment_samples:m.assignment.length,median_first_response_minutes:medianOf(m.first_response),first_response_samples:m.first_response.length,returns:m.returns,open_load:openDealLoad(m.id),on_shift:!!shiftFor(m.id)}));
      const queueClause=teamId?' AND r.queue_team_id=?':'',queueArgs=teamId?[teamId]:[];
      const queueNow=Number(db.prepare("SELECT COUNT(*) n FROM lead_routing r WHERE r.queue_status='queued'"+queueClause).get(...queueArgs)?.n||0);
      const shiftClause=teamId?' AND u.team_id=?':'',shiftArgs=teamId?[teamId]:[];
      const shifts=db.prepare(`SELECT u.id manager_id,u.name manager_name,COUNT(s.id) shifts,SUM(CASE WHEN s.ended_at IS NULL THEN 1 ELSE 0 END) active_shifts
        FROM users u LEFT JOIN shift_sessions s ON s.user_id=u.id AND date(s.started_at,'localtime') BETWEEN ? AND ?
        WHERE u.role='manager'${shiftClause} GROUP BY u.id ORDER BY u.name`).all(fromRaw,toRaw,...shiftArgs);
      logAccess(user,'report_view','reports','team','GET');
      return json(res,200,{period:{from:fromRaw,to:toRaw,team_id:teamId||null,manager_id:managerId||null,source:source||null},
        totals:{leads:reportRows.length,unique_leads:sources.reduce((n,r)=>n+Number(r.unique_leads),0),queued_now:queueNow,returned:reportRows.reduce((n,r)=>n+Number(r.return_count||0),0)},
        assignment:{median_minutes:medianOf(assignmentSamples),samples:assignmentSamples.length,sla_minutes:assignSla,violations:assignmentViolations,status:assignmentSamples.length?'данные есть':'нет данных'},
        first_response:{median_minutes:medianOf(responseSamples),samples:responseSamples.length,sla_minutes:responseSla,violations:responseViolations,status:responseSamples.length?'данные есть':'нет данных',definition:'От первого назначения до первого сообщения живого сотрудника, отправленного через интерфейс CRM. Автоответы в расчёт не входят.'},
        calls:{calls:null,missed:null,callbacks:null,status:'нет данных',reason:'В CRM нет подключённого источника событий телефонии.'},
        meetings:{count:null,status:'нет данных',reason:'Не согласованы статусы встречи и источник подтверждения.'},
        sources,managers,shifts,definitions:['Уникальный лид — уникальная карточка клиента; при отсутствии клиента учитывается сделка.','Период берётся по времени поступления в CRM/от поставщика; исторические записи без точного времени помечены источником CRM.','Порог SLA не задан — нарушения не вычисляются, пока администратор не укажет согласованное значение.']});
    }
    if (p === '/api/access-log' && req.method === 'GET') {
      if(!requireAdmin(user,res))return;
      const limit=Math.max(1,Math.min(500,Math.trunc(Number(u.searchParams.get('limit')||100))||100)),before=Math.max(0,Math.trunc(Number(u.searchParams.get('before')||0))),uid=Number(u.searchParams.get('user_id')||0);
      const clauses=[],params=[];if(before){clauses.push('a.id<?');params.push(before);}if(uid){clauses.push('a.user_id=?');params.push(uid);}
      const rows=db.prepare(`SELECT a.id,a.user_id,u.name user_name,a.action,a.resource_type,a.resource_id,a.request_method,a.created_at FROM access_log a LEFT JOIN users u ON u.id=a.user_id${clauses.length?' WHERE '+clauses.join(' AND '):''} ORDER BY a.id DESC LIMIT ?`).all(...params,limit);
      return json(res,200,{items:rows,next_before:rows.length===limit?rows.at(-1).id:null});
    }
    // ===== dashboard / analytics =====
    if (p === '/api/dashboard') {
      // Партнёру сводка по компании не отдаётся: выручка, число клиентов и лента
      // действий — внутренние цифры. Ему нужны только счётчики в меню (его сделки
      // и его непрочитанные чаты), поэтому считается то же самое, но по его данным
      // и тем же правилом, что и список его диалогов.
      if (user?.role === 'partner') {
        const pid=Number(user.id),nowP=localNow();
        const deals=db.prepare(`SELECT d.id,d.contact_id,d.amount,d.stage FROM deals d JOIN partner_transfers pt ON pt.deal_id=d.id AND pt.active=1 WHERE pt.partner_id=?`).all(pid).filter(d=>partnerTransferForDeal(user,d.id));
        const ids=deals.map(d=>Number(d.id)),marks=ids.map(()=>'?').join(',');
        const countSql=(sql,args=[])=>ids.length?Number(db.prepare(sql.replaceAll('$IDS',marks)).get(...ids,...args)?.n||0):0;
        const unreadP=countSql(`SELECT COUNT(*) n FROM messages m WHERE m.deal_id IN ($IDS) AND m.direction='in'
          AND m.id>COALESCE((SELECT rm.last_msg_id FROM conversation_deal_read_marks rm WHERE rm.conversation_id=m.conversation_id AND rm.user_id=? AND rm.deal_id=m.deal_id),0)`,[pid]);
        const tasksOpenP=countSql(`SELECT COUNT(*) n FROM tasks WHERE deal_id IN ($IDS) AND done=0`);
        const openDeals=deals.filter(d=>!['won','lost'].includes(d.stage));
        const contacts=new Set(deals.map(d=>Number(d.contact_id)).filter(Boolean));
        const overDue=countSql(`SELECT COUNT(*) n FROM tasks WHERE deal_id IN ($IDS) AND done=0 AND due IS NOT NULL AND due!='' AND (CASE WHEN length(due)=10 THEN due||' 23:59:59' ELSE due END)<?`,[nowP]);
        return json(res,200,{stages:[],activities:[],recentDeals:[],dealsTotal:openDeals.length,activeDealsSum:openDeals.reduce((n,d)=>n+Number(d.amount||0),0),
          contacts:contacts.size,companies:0,revenue:0,lostSum:0,monthRevenue:0,conversion:0,unread:unreadP,unreadMine:unreadP,
          tasksOpen:tasksOpenP,tasksToday:0,tasksOverdue:overDue,myTasksOpen:tasksOpenP,myTasksOverdue:overDue,myTasksToday:0});
      }
      if (user?.role === 'manager') {
        const uid = Number(user.id), pipelineId = Number(u.searchParams.get('pipeline') || 1), today = localDate(), now = localNow();
        const dealWhere = managerDealScopeSql('d'), dealParams = managerDealParams(user);
        const stageStats = new Map(db.prepare(`SELECT d.stage,COUNT(*) n,COALESCE(SUM(d.amount),0) s FROM deals d
          WHERE COALESCE(d.pipeline_id,1)=? AND ${dealWhere} GROUP BY d.stage`).all(pipelineId, ...dealParams).map(r => [r.stage, r]));
        const active = db.prepare(`SELECT COUNT(*) n,COALESCE(SUM(d.amount),0) s FROM deals d
          WHERE d.stage NOT IN ('won','lost') AND ${dealWhere}`).get(...dealParams);
        const sumWhere = extra => db.prepare(`SELECT COALESCE(SUM(d.amount),0) s FROM deals d WHERE ${dealWhere} AND (${extra})`).get(...dealParams).s;
        const cntWhere = extra => db.prepare(`SELECT COUNT(*) n FROM deals d WHERE ${dealWhere} AND (${extra})`).get(...dealParams).n;
        const taskWhere = managerTaskScopeSql('t'), taskParams = managerTaskParams(user);
        const taskCount = (extra='', params=[]) => db.prepare(`SELECT COUNT(*) n FROM tasks t WHERE t.done=0 AND ${taskWhere}${extra ? ' AND (' + extra + ')' : ''}`).get(...taskParams,...params).n;
        const unread = db.prepare(`SELECT COUNT(*) n FROM conversations cv JOIN contacts c ON c.id=cv.contact_id
          WHERE ${managerConversationScopeSql('cv','c')} AND EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=cv.id AND m.direction='in'
          AND (m.deal_id IN (SELECT d.id FROM deals d WHERE d.contact_id=cv.contact_id AND ${managerDealScopeSql('d')}) OR ${managerUnlinkedMessageSql('m','cv','c')})
          AND m.id>CASE WHEN m.deal_id IS NULL THEN COALESCE((SELECT rm.last_msg_id FROM read_marks rm WHERE rm.conversation_id=cv.id AND rm.user_id=?),0)
            ELSE COALESCE((SELECT rm.last_msg_id FROM conversation_deal_read_marks rm WHERE rm.conversation_id=cv.id AND rm.user_id=? AND rm.deal_id=m.deal_id),0) END)`)
          .get(...managerConversationParams(user),...managerDealParams(user),...managerUnlinkedMessageParams(user),uid,uid).n;
        const activityDeals = `SELECT d.id FROM deals d WHERE ${managerDealScopeSql('d')}`;
        const activityContacts = `SELECT c.id FROM contacts c WHERE ${managerContactScopeSql('c')}`;
        const activityTasks = `SELECT t.id FROM tasks t WHERE ${managerTaskScopeSql('t')}`;
        const activities = db.prepare(`SELECT * FROM activities a WHERE a.feed=1 AND (
          (a.entity_type='deals' AND a.entity_id IN (${activityDeals})) OR
          (a.entity_type='contacts' AND a.entity_id IN (${activityContacts})) OR
          (a.entity_type='tasks' AND a.entity_id IN (${activityTasks}))) ORDER BY a.id DESC LIMIT 10`)
          .all(...dealParams, ...managerContactParams(user), ...taskParams);
        return json(res, 200, {
          stages: getStages(pipelineId).map(st => { const x=stageStats.get(st.code)||{n:0,s:0}; return { ...st, count:x.n, sum:x.s }; }),
          dealsTotal: Number(active.n), activeDealsSum: Number(active.s),
          revenue: sumWhere("d.stage='won'"), lostSum: sumWhere("d.stage='lost'"),
          contacts: db.prepare(`SELECT COUNT(*) n FROM contacts c WHERE ${managerContactScopeSql('c')}`).get(...managerContactParams(user)).n,
          companies: db.prepare(`SELECT COUNT(*) n FROM companies co WHERE ${managerCompanyScopeSql('co')}`).get(...managerCompanyParams(user)).n,
          unread, unreadMine: unread,
          tasksOpen: taskCount(), tasksToday: taskCount('t.due LIKE ?',[today+'%']),
          tasksOverdue: taskCount("t.due IS NOT NULL AND t.due!='' AND (CASE WHEN length(t.due)=10 THEN t.due || ' 23:59:59' ELSE t.due END) < ?",[now]),
          myTasksOpen: taskCount(), myTasksOverdue: taskCount("t.responsible_id=? AND t.due IS NOT NULL AND t.due!='' AND (CASE WHEN length(t.due)=10 THEN t.due || ' 23:59:59' ELSE t.due END) < ?",[uid,now]),
          myTasksToday: taskCount('t.responsible_id=? AND t.due LIKE ?',[uid,today+'%']),
          conversion: (() => { const w=cntWhere("d.stage='won'"), l=cntWhere("d.stage='lost'"); return w+l?Math.round(w/(w+l)*100):0 })(),
          monthRevenue: sumWhere(`d.stage='won' AND ${DEAL_MONTH_SQL}=substr(datetime('now','localtime'),1,7)`),
          activities,
          recentDeals: db.prepare(`SELECT d.*,c.name contact_name FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id WHERE ${dealWhere} ORDER BY d.id DESC LIMIT 6`).all(...dealParams),
        });
      }
      const pipelineId = Number(u.searchParams.get('pipeline') || 1);
      const stages = getStages(pipelineId);
      const today = localDate();
      const myId = user?.id;
      // агрегация в SQL: не выгружаем все сделки в память
      const agg = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM deals WHERE stage NOT IN ('won','lost')").get();
      // этапы считаем по выбранной воронке: сводные цифры ниже остаются
      // общими по компании, а распределение по колонкам — её собственное
      const stageStats = new Map(db.prepare('SELECT stage, COUNT(*) n, COALESCE(SUM(amount),0) s FROM deals WHERE COALESCE(pipeline_id,1)=? GROUP BY stage').all(pipelineId).map(r => [r.stage, r]));
      const sumWhere = w => db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM deals WHERE ${w}`).get().s;
      const cntWhere = w => db.prepare(`SELECT COUNT(*) n FROM deals WHERE ${w}`).get().n;
      // «мои» = назначенные на меня и без ответственного: вторые кто-то должен
      // разобрать, и интерфейс (дашборд, колокольчик) показывает их тем же правилом
      const myTasksOpen = db.prepare("SELECT COUNT(*) n FROM tasks WHERE done=0 AND (responsible_id=? OR responsible_id IS NULL)").get(myId)?.n || 0;
      const myTasksToday = db.prepare("SELECT COUNT(*) n FROM tasks WHERE done=0 AND due LIKE ? AND (responsible_id=? OR responsible_id IS NULL)").get(today + '%', myId)?.n || 0;
      const now = localNow();
      const myTasksOverdue = db.prepare("SELECT COUNT(*) n FROM tasks WHERE done=0 AND (responsible_id=? OR responsible_id IS NULL) AND due IS NOT NULL AND due != '' AND (CASE WHEN length(due)=10 THEN due || ' 23:59:59' ELSE due END) < ?").get(myId, now)?.n || 0;
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
        // личный счётчик непрочитанных: свои беседы, беседы своего клиента и
        // ничейные — то же правило, что у «Моих задач» и у списка в колокольчике
        unreadMine: db.prepare("SELECT COUNT(*) n FROM conversations cv LEFT JOIN contacts c ON c.id=cv.contact_id WHERE (cv.assigned_id=? OR c.responsible_id=? OR (cv.assigned_id IS NULL AND c.responsible_id IS NULL)) AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=cv.id AND m.direction='in' AND m.id > COALESCE((SELECT rm.last_msg_id FROM read_marks rm WHERE rm.conversation_id=cv.id AND rm.user_id=?),0))").get(user.id, user.id, user.id).n,
        tasksOpen: db.prepare('SELECT COUNT(*) n FROM tasks WHERE done=0').get().n,
        tasksToday,
        tasksOverdue,
        myTasksOpen,
        myTasksOverdue,
        myTasksToday,
        conversion: (() => { const w = cntWhere("stage='won'"), l = cntWhere("stage='lost'"); return w + l ? Math.round(w / (w + l) * 100) : 0 })(),
        monthRevenue: sumWhere(`stage='won' AND ${DEAL_MONTH_SQL}=substr(datetime('now','localtime'),1,7)`),
        // в ленте рабочего стола — только действия людей и значимые события (feed=1);
        // строки, рождённые потоком чатов, остаются в истории карточек
        activities: db.prepare('SELECT * FROM activities WHERE feed=1 ORDER BY id DESC LIMIT 10').all(),
        recentDeals: db.prepare('SELECT d.*,c.name contact_name FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id ORDER BY d.id DESC LIMIT 6').all()
      });
    }
    if (p === '/api/analytics') {
      if (user?.role === 'manager') {
        const dealWhere = managerDealScopeSql('d'), dealParams = managerDealParams(user);
        const wonLost = db.prepare(`SELECT SUM(d.stage='won') w,SUM(d.stage='lost') l,SUM(CASE WHEN d.stage='won' THEN d.amount ELSE 0 END) wonSum FROM deals d WHERE ${dealWhere}`).get(...dealParams);
        const wonCount=Number(wonLost.w)||0, lostCount=Number(wonLost.l)||0, wonSum=Number(wonLost.wonSum)||0;
        const month=localDate().slice(0,7);
        const monthRow=db.prepare(`SELECT COUNT(*) n,COALESCE(SUM(d.amount),0) s FROM deals d WHERE ${dealWhere} AND d.stage='won' AND ${DEAL_MONTH_SQL}=?`).get(...dealParams,month);
        const forecast=db.prepare(`SELECT COALESCE(SUM(d.amount),0) s FROM deals d WHERE ${dealWhere} AND d.stage NOT IN ('won','lost')`).get(...dealParams).s;
        const byMonth=db.prepare(`SELECT ${DEAL_MONTH_SQL} ym,COUNT(*) n,COALESCE(SUM(d.amount),0) s FROM deals d
          WHERE ${dealWhere} AND d.stage='won' AND ${DEAL_MONTH_SQL}<>'' GROUP BY ym ORDER BY ym DESC LIMIT 6`).all(...dealParams).reverse();
        const bySource=db.prepare(`SELECT COALESCE(NULLIF(d.lead_source,''),NULLIF(c.source,''),'—') name,COUNT(*) n,COALESCE(SUM(d.amount),0) s
          FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id WHERE ${dealWhere} GROUP BY 1`).all(...dealParams)
          .map(r=>({name:r.name||'—',count:r.n,sum:r.s}));
        const byLoss=db.prepare(`SELECT COALESCE(NULLIF(d.loss_reason,''),'—') name,COUNT(*) n,COALESCE(SUM(d.amount),0) s
          FROM deals d WHERE ${dealWhere} AND d.stage='lost' GROUP BY d.loss_reason`).all(...dealParams)
          .map(r=>({name:r.name||'—',count:r.n,sum:r.s}));
        const byManager=db.prepare(`SELECT COALESCE(u.name,NULLIF(d.responsible,''),'—') name,COUNT(*) n,COALESCE(SUM(d.amount),0) s,
          COALESCE(SUM(d.stage='won'),0) w,COALESCE(SUM(d.stage='lost'),0) l FROM deals d LEFT JOIN users u ON u.id=d.responsible_id
          WHERE ${dealWhere} GROUP BY d.responsible_id`).all(...dealParams).map(r=>({name:r.name||'—',count:r.n,sum:r.s,won:r.w,lost:r.l,conversion:r.w+r.l?Math.round(r.w/(r.w+r.l)*100):null}));
        const stages=db.prepare(`SELECT s.name,s.code,s.pipeline_id,COUNT(d.id) count,COALESCE(SUM(d.amount),0) sum
          FROM stages s LEFT JOIN deals d ON d.stage=s.code AND COALESCE(d.pipeline_id,1)=s.pipeline_id AND ${managerDealScopeSql('d')}
          GROUP BY s.id ORDER BY s.pipeline_id,s.sort,s.id`).all(...dealParams);
        return json(res,200,{
          byMonth,plan:{target:0,fact:monthRow.s,month,deals:monthRow.n,percent:null},
          conversion:wonCount+lostCount?Math.round(wonCount/(wonCount+lostCount)*100):0,
          avgCheck:wonCount?Math.round(wonSum/wonCount):0,forecast,bySource,byManager,byLoss,stages,
        });
      }
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
        bySource: by("SELECT COALESCE(NULLIF(d.lead_source,''),NULLIF(c.source,''),'—') name, COUNT(*) n, COALESCE(SUM(d.amount),0) s FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id GROUP BY 1"),
        byManager: db.prepare("SELECT COALESCE(u.name, NULLIF(d.responsible,''), '—') name, COUNT(*) n, COALESCE(SUM(d.amount),0) s, COALESCE(SUM(d.stage='won'),0) w, COALESCE(SUM(d.stage='lost'),0) l FROM deals d LEFT JOIN users u ON u.id=d.responsible_id GROUP BY 1").all().map(r => ({ name: r.name || '—', count: r.n, sum: r.s, won: r.w, lost: r.l, conversion: r.w + r.l ? Math.round(r.w / (r.w + r.l) * 100) : null })),
        byLoss: by("SELECT COALESCE(loss_reason,'—') name, COUNT(*) n, COALESCE(SUM(amount),0) s FROM deals WHERE stage='lost' GROUP BY loss_reason"),
        // распределение по этапам всех воронок: сделка попадает в свой этап по
        // паре «воронка + код», иначе одноимённые этапы разных воронок сливаются
        stages: db.prepare(`SELECT s.name, s.code, s.pipeline_id, COUNT(d.id) count, COALESCE(SUM(d.amount),0) sum
            FROM stages s LEFT JOIN deals d ON d.stage = s.code AND COALESCE(d.pipeline_id,1) = s.pipeline_id
            GROUP BY s.id ORDER BY s.pipeline_id, s.sort, s.id`).all(),
      });
    }
    if (p === '/api/contacts/duplicates') {
      // Дубли ищем по видимым пользователю карточкам: менеджер не узнаёт
      // телефоны, почту и количество записей чужого контура.
      const manager = user.role === 'manager', scope = manager ? ` AND ${managerContactScopeSql('c')}` : '';
      const scopeParams = manager ? managerContactParams(user) : [];
      const phoneGroups = db.prepare(`SELECT c.phone_norm k,COUNT(*) n FROM contacts c
        WHERE c.phone_norm IS NOT NULL${scope} GROUP BY c.phone_norm HAVING n>1`).all(...scopeParams);
      const emailGroups = db.prepare(`SELECT lower(c.email) k,COUNT(*) n FROM contacts c
        WHERE c.email IS NOT NULL AND c.email<>''${scope} GROUP BY lower(c.email) HAVING n>1`).all(...scopeParams);
      const byPhone = db.prepare(`SELECT c.* FROM contacts c WHERE c.phone_norm=?${scope} ORDER BY c.id`);
      const byEmail = db.prepare(`SELECT c.* FROM contacts c WHERE lower(c.email)=lower(?)${scope} ORDER BY c.id`);
      const groups = [];
      for (const g of phoneGroups) groups.push({ key:'phone:'+g.k,type:'phone',contacts:byPhone.all(g.k,...scopeParams) });
      for (const g of emailGroups) groups.push({ key:'email:'+g.k,type:'email',contacts:byEmail.all(g.k,...scopeParams) });
      return json(res,200,{groups,total:groups.reduce((a,g)=>a+g.contacts.length-1,0)});
    }
    if (p === '/api/contacts/merge' && req.method === 'POST') {
      const b = await readBody(req);
      // принимаем оба варианта имён полей: интерфейс шлёт keep_id/merge_ids, старые вызовы — keep/ids
      const keepId = Number(b.keep_id ?? b.keep), mergeIds = [...new Set((b.merge_ids || b.ids || []).map(Number).filter(id => id && id !== keepId))];
      if (mergeIds.length > 50) return json(res, 400, { error: 'За один раз можно объединить не больше 50 карточек' });
      const keep = db.prepare('SELECT * FROM contacts WHERE id=?').get(keepId);
      if (!keep || !mergeIds.length) return json(res, 400, { error: 'Укажите основного контакта и что с ним объединить' });
      const others = mergeIds.map(id => db.prepare('SELECT * FROM contacts WHERE id=?').get(id)).filter(Boolean);
      if (user.role === 'manager') {
        if (!managerOwns(user,'contacts',keepId) || others.length !== mergeIds.length || others.some(c=>!managerOwns(user,'contacts',c.id)))
          return json(res,403,{error:'Объединять можно только ваши карточки клиентов.'});
        const ids=[keepId,...others.map(c=>c.id)],marks=ids.map(()=>'?').join(',');
        const foreignDeals=db.prepare(`SELECT id FROM deals WHERE contact_id IN (${marks})`).all(...ids).some(d=>!managerOwns(user,'deals',d.id));
        const foreignTasks=db.prepare(`SELECT id FROM tasks WHERE contact_id IN (${marks}) OR deal_id IN (SELECT id FROM deals WHERE contact_id IN (${marks}))`)
          .all(...ids,...ids).some(t=>!managerOwns(user,'tasks',t.id));
        if(foreignDeals||foreignTasks)return json(res,403,{error:'В карточках есть сделки или задачи другого контура. Перед объединением обратитесь к администратору.'});
      }
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
      logActivity(`Контакты объединены: ${others.map(o => o.name).join(', ')} → ${keep.name}`, 'contacts', keepId, user.name);
      broadcast('change', { table: 'contacts' });
      return json(res, 200, { kept: keepId, merged: mergeIds.length, contact: db.prepare('SELECT * FROM contacts WHERE id=?').get(keepId) });
    }
    if (p === '/api/search') {
      // SQLite сравнивает кириллицу в LIKE с учётом регистра, поэтому поиск
      // выполняем через lower_ru; телефон дополнительно ищется по цифрам.
      const raw = String(u.searchParams.get('q') || '').trim();
      if (raw.length < 2) return json(res, 200, { contacts: [], deals: [], companies: [], tasks: [], products: [] });
      const needleDigits = digits(raw), only = String(u.searchParams.get('only') || '');
      const isPartner=user.role==='partner',manager=user.role==='manager';
      const partnerStages=[...partnerAllowedStages()],partnerPid=partnerPipelineId();
      const want = key => (!only || only === key) && (!isPartner || ['contacts','deals','companies','tasks'].includes(key));
      const partnerDealScope=(alias)=>!partnerPid||!partnerStages.length?{sql:'0',params:[]}:{
        sql:`${alias}.pipeline_id=? AND ${alias}.stage IN (${partnerStages.map(()=>'?').join(',')})
          AND EXISTS(SELECT 1 FROM partner_transfers pt WHERE pt.deal_id=${alias}.id AND pt.partner_id=? AND pt.active=1)`,
        params:[partnerPid,...partnerStages,Number(user.id)]};
      const partnerContactScope=alias=>!partnerPid||!partnerStages.length?{sql:'0',params:[]}:{
        sql:`EXISTS(SELECT 1 FROM deals pd JOIN partner_transfers pt ON pt.deal_id=pd.id
          WHERE pd.contact_id=${alias}.id AND pt.partner_id=? AND pt.active=1 AND pd.pipeline_id=? AND pd.stage IN (${partnerStages.map(()=>'?').join(',')}))
          AND (SELECT COUNT(*) FROM deals ad JOIN partner_transfers apt ON apt.deal_id=ad.id WHERE ad.contact_id=${alias}.id AND apt.active=1)=1`,
        params:[Number(user.id),partnerPid,...partnerStages]};
      const search = (table, select, match, params, scopeSql='', scopeParams=[], limit=8) => {
        const conditions = [`(${match})`], args = [...params];
        if (scopeSql) { conditions.push(scopeSql); args.push(...scopeParams); }
        return db.prepare(`SELECT ${select} FROM ${table} WHERE ${conditions.join(' AND ')} ORDER BY 1 DESC LIMIT ?`)
          .all(...args,limit);
      };
      const digitMatch = (alias, column='phone_norm') => needleDigits.length >= 3
        ? { sql: ` OR ${alias}.${column} LIKE ?`, params: ['%'+needleDigits+'%'] } : { sql:'',params:[] };
      const contacts = want('contacts') ? (() => {
        const d = digitMatch('c'), scope = isPartner ? partnerContactScope('c') : manager ? {sql:managerContactScopeSql('c'),params:managerContactParams(user)} : {sql:'',params:[]};
        const args = [raw,raw,raw,raw,...d.params];
        return search('contacts c',isPartner?'c.id,c.name,c.phone,c.email,c.source':'c.id,c.name,c.phone,c.email,c.company',
          `instr(lower_ru(COALESCE(c.name,'')),lower_ru(?))>0 OR instr(lower_ru(COALESCE(c.phone,'')),lower_ru(?))>0 OR instr(lower_ru(COALESCE(c.email,'')),lower_ru(?))>0 OR instr(lower_ru(COALESCE(c.company,'')),lower_ru(?))>0${d.sql}`,
          args,scope.sql,scope.params,8);
      })() : [];
      const dealScope=isPartner?partnerDealScope('d'):manager?{sql:managerDealScopeSql('d'),params:managerDealParams(user)}:{sql:'',params:[]};
      const dealMatch=isPartner
        ? `instr(lower_ru(COALESCE(d.title,'')),lower_ru(?))>0 OR instr(CAST(d.amount AS TEXT),?)>0 OR instr(lower_ru(COALESCE(c.name,'')),lower_ru(?))>0 OR instr(lower_ru(COALESCE(co.name,'')),lower_ru(?))>0`
        : `instr(lower_ru(COALESCE(d.title,'')),lower_ru(?))>0 OR instr(CAST(d.amount AS TEXT),?)>0 OR instr(lower_ru(COALESCE(c.name,'')),lower_ru(?))>0 OR instr(lower_ru(COALESCE(co.name,'')),lower_ru(?))>0 OR instr(lower_ru(COALESCE(d.responsible,'')),lower_ru(?))>0`;
      const deals = want('deals') ? search('deals d LEFT JOIN contacts c ON c.id=d.contact_id LEFT JOIN companies co ON co.id=d.company_id',
        'd.id,d.title,d.amount',dealMatch,isPartner?[raw,raw,raw,raw]:[raw,raw,raw,raw,raw],dealScope.sql,dealScope.params,8) : [];
      const companyScope=isPartner?(!partnerPid||!partnerStages.length?{sql:'0',params:[]}:{
        sql:`EXISTS(SELECT 1 FROM deals cd JOIN partner_transfers cpt ON cpt.deal_id=cd.id AND cpt.partner_id=? AND cpt.active=1
          WHERE cd.pipeline_id=? AND cd.stage IN (${partnerStages.map(()=>'?').join(',')}) AND (cd.company_id=${'co.id'} OR cd.contact_id IN (SELECT cc.id FROM contacts cc WHERE cc.company_id=co.id)))`,
        params:[Number(user.id),partnerPid,...partnerStages]}):manager?{sql:managerCompanyScopeSql('co'),params:managerCompanyParams(user)}:{sql:'',params:[]};
      const companies = want('companies') ? search('companies co','co.id,co.name,co.inn',
        `instr(lower_ru(COALESCE(co.name,'')),lower_ru(?))>0 OR instr(lower_ru(COALESCE(co.inn,'')),lower_ru(?))>0`,
        [raw,raw],companyScope.sql,companyScope.params,5) : [];
      const taskScope=isPartner?partnerDealScope('d'):manager?{sql:managerTaskScopeSql('t'),params:managerTaskParams(user)}:{sql:'',params:[]};
      const tasks = want('tasks') ? search(isPartner?'tasks t JOIN deals d ON d.id=t.deal_id':'tasks t','t.id,t.title,t.due,t.done,t.type',
        `instr(lower_ru(COALESCE(t.title,'')),lower_ru(?))>0`,[raw],taskScope.sql,taskScope.params,6) : [];
      // Справочник каталога не нужен партнёру для работы с переданной сделкой.
      const products = want('products') ? search('products pr','pr.id,pr.name,pr.sku,pr.price,pr.unit,pr.active',
        `instr(lower_ru(COALESCE(pr.name,'')),lower_ru(?))>0 OR instr(lower_ru(COALESCE(pr.sku,'')),lower_ru(?))>0`,
        [raw,raw],'',[],5) : [];
      return json(res, 200, { contacts, deals, companies, tasks, products });
    }
    if (p === '/api/export/json' || p === '/api/backup') {
      // полная выгрузка содержит пользователей и настройки — только администратор
      if (!requireAdmin(user, res)) return;
      logAccess(user,p==='/api/backup'?'backup_download':'export_json','database','',req.method);
      const tables = ['users', 'companies', 'contacts', 'pipelines', 'stages', 'deals', 'tasks', 'notes', 'products', 'templates', 'automations', 'conversations', 'messages', 'channels', 'competitors', 'competitor_checks', 'competitor_reports', 'reviews', 'price_rows']; const out = {}; tables.forEach(t => out[t] = db.prepare(`SELECT * FROM ${t}`).all());
      // Хеш пароля в выгрузку не входит: файл уносят на свой компьютер, а
      // восстановить доступ по нему всё равно нельзя — пароль задаётся заново
      // в карточке сотрудника. Целиком база переносится копией файла crm.db.
      out.users = out.users.map(({ pass, ...rest }) => rest);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename=karkas-backup.json' }); return res.end(JSON.stringify(out, null, 2)); }

    // Очередь отложенных действий. Без неё правило с выдержкой выглядит как
    // «настроил и забыл»: не видно, что именно сработает и можно ли отменить.
    if (p === '/api/automation-queue' && req.method === 'GET') {
      const manager=user.role==='manager';
      const scope=manager?`WHERE (q.deal_id IS NOT NULL OR q.contact_id IS NOT NULL)
        AND (q.deal_id IS NULL OR EXISTS(SELECT 1 FROM deals sd WHERE sd.id=q.deal_id AND ${managerDealScopeSql('sd')}))
        AND (q.contact_id IS NULL OR EXISTS(SELECT 1 FROM contacts sc WHERE sc.id=q.contact_id AND ${managerContactScopeSql('sc')}))`:'';
      const rows = db.prepare(`SELECT q.id, q.automation_id, q.deal_id, q.contact_id, q.run_at, q.created_at,
          a.name rule_name, a.action_type, a.action_value,
          d.title deal_title, c.name contact_name
        FROM automation_queue q
        LEFT JOIN automations a ON a.id = q.automation_id
        LEFT JOIN deals d ON d.id = q.deal_id
        LEFT JOIN contacts c ON c.id = q.contact_id
        ${scope} ORDER BY q.run_at, q.id`).all(...(manager?[...managerDealParams(user),...managerContactParams(user)]:[]));
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
      logActivity(`Запланированное действие отменено: «${rule?.name || 'правило удалено'}»`, q.deal_id ? 'deals' : 'contacts', q.deal_id || q.contact_id || null, user.name);
      broadcast('change', { table: 'automations' });
      return json(res, 200, { cancelled: q.id });
    }

    // ===== generic CRUD =====
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
          logActivity(`Создан шаблон «${String(b.name || '').slice(0, 80) || 'без названия'}»`, 'templates', Number(r.lastInsertRowid), user.name);
          broadcast('change', { table });
          return json(res, 201, db.prepare('SELECT * FROM templates WHERE id=?').get(r.lastInsertRowid));
        }
        if (id) {
          const tpl = db.prepare('SELECT * FROM templates WHERE id=?').get(id);
          if (!tpl) return json(res, 404, { error: 'Шаблон не найден' });
          if (tpl.user_id !== user.id) return json(res, 403, { error: 'Это чужой шаблон — можно менять только свои' });
          if (req.method === 'PATCH') { const b = await readBody(req);
            // те же пределы, что при создании: иначе правка позволила бы раздуть шаблон
            if (b.name !== undefined) b.name = String(b.name).slice(0, 80);
            if (b.body !== undefined) b.body = String(b.body).slice(0, 20000);
            const ks = Object.keys(b).filter(k => ['name', 'body'].includes(k)); if (ks.length) db.prepare(`UPDATE templates SET ${ks.map(k => k + '=?')} WHERE id=?`).run(...ks.map(k => k === 'name' ? String(b[k]).slice(0, 80) : String(b[k]).slice(0, 20000)), id); broadcast('change', { table }); return json(res, 200, db.prepare('SELECT * FROM templates WHERE id=?').get(id)); }
          if (req.method === 'DELETE') { db.prepare('DELETE FROM templates WHERE id=?').run(id); logActivity('Шаблон удалён', 'templates', Number(id), user.name); broadcast('change', { table }); return json(res, 200, { deleted: true }); }
        }
        return json(res, 405, { error: 'Метод не поддерживается' });
      }
      // правила и каталог меняет администратор. Каталог — это прайс-лист компании:
      // цены в нём не должен переписывать любой менеджер. Позицию, которой в каталоге
      // нет, менеджер добавляет прямо в сделку — на прайс это не влияет.
      if (req.method !== 'GET' && table === 'automations' && !requireAdmin(user, res)) return;
      if (req.method !== 'GET' && table === 'products' && user.role !== 'admin')
        return json(res, 403, { error: 'Каталог и прайс-лист меняет администратор. Позицию, которой нет в каталоге, можно добавить прямо в сделку.' });
      if (req.method === 'GET' && !id) {
        const isPartner = user.role === 'partner', isManager = user.role === 'manager';
        if (table === 'tasks') {
          // карточке клиента нужны только его задачи: фильтр собираем на сервере,
          // иначе карточка тянула бы весь список задач компании
          const tw = [], tp = [];
          if (isPartner) {
            tw.push("t.deal_id IN (SELECT pt.deal_id FROM partner_transfers pt WHERE pt.partner_id=? AND pt.active=1)");
            tp.push(Number(user.id));
          } else if (isManager) {
            tw.push(managerTaskScopeSql('t')); tp.push(...managerTaskParams(user));
          }
          const tContact = Number(u.searchParams.get('contact_id') || 0);
          if (tContact) { tw.push('t.contact_id=?'); tp.push(tContact); }
          const tDeal = Number(u.searchParams.get('deal_id') || 0);
          if (tDeal) { tw.push('t.deal_id=?'); tp.push(tDeal); }
          const taskRows=db.prepare(`SELECT t.*,c.name contact_name,d.title deal_title,u.name responsible_name FROM tasks t LEFT JOIN contacts c ON c.id=t.contact_id LEFT JOIN deals d ON d.id=t.deal_id LEFT JOIN users u ON u.id=t.responsible_id${tw.length ? ' WHERE ' + tw.join(' AND ') : ''} ORDER BY done,due,id DESC`).all(...tp);
          return json(res, 200, isPartner?taskRows.filter(t=>partnerOwns(user,'tasks',t.id)):taskRows);
        }
        if (table === 'notes') {
          const et = String(u.searchParams.get('type') || ''), eid = Number(u.searchParams.get('entity'));
          if (isPartner && !partnerOwns(user, et, eid)) return json(res, 403, { error: 'Это чужая карточка: партнёр видит только свои лиды' });
          if (isManager && !managerOwns(user, et, eid)) return json(res, 403, { error: 'Заметки доступны только по вашим карточкам' });
          return json(res, 200, db.prepare('SELECT * FROM notes WHERE entity_type=? AND entity_id=? ORDER BY id DESC').all(et, eid));
        }
        if (table === 'contacts') {
          // карточке компании нужны только её сотрудники: фильтр на сервере
          const cw = [], cp = [];
          if (isPartner) {
            const ids=[...new Set(db.prepare(`SELECT DISTINCT d.contact_id FROM deals d JOIN partner_transfers pt ON pt.deal_id=d.id AND pt.active=1
              WHERE pt.partner_id=? AND d.contact_id IS NOT NULL`).all(user.id).filter(r=>partnerTransferForContact(user,r.contact_id)).map(r=>Number(r.contact_id)))];
            const requested=Number(u.searchParams.get('company_id')||0);
            const list=ids.length?db.prepare(`SELECT id,name,phone,email,source FROM contacts WHERE id IN (${ids.map(()=>'?').join(',')})${requested?' AND company_id=?':''} ORDER BY id DESC`).all(...ids,...(requested?[requested]:[])):[];
            logAccess(user,'contact_list','contacts','',req.method);return json(res,200,list);
          } else if (isManager) {
            cw.push(managerContactScopeSql('contacts')); cp.push(...managerContactParams(user));
          }
          const cCompany = Number(u.searchParams.get('company_id') || 0);
          if (cCompany) { cw.push('company_id=?'); cp.push(cCompany); }
          return json(res, 200, db.prepare(`SELECT * FROM contacts${cw.length ? ' WHERE ' + cw.join(' AND ') : ''} ORDER BY id DESC`).all(...cp));
        }
        // компании партнёру нужны как справочник для его же карточек: без них
        // форма клиента не открывается, а привязка сделки к компании теряется
        if (table === 'companies' && isPartner) {
          const deals=db.prepare(`SELECT d.id,d.company_id,d.contact_id FROM deals d JOIN partner_transfers pt ON pt.deal_id=d.id AND pt.active=1 WHERE pt.partner_id=?`).all(user.id).filter(d=>partnerTransferForDeal(user,d.id));
          const ids=[...new Set(deals.flatMap(d=>[Number(d.company_id)||0,Number(d.contact_id?db.prepare('SELECT company_id FROM contacts WHERE id=?').get(d.contact_id)?.company_id:0)||0]).filter(Boolean))];
          return json(res,200,ids.length?db.prepare(`SELECT id,name,inn FROM companies WHERE id IN (${ids.map(()=>'?').join(',')}) ORDER BY id DESC`).all(...ids):[]);
        }
        if (table === 'companies' && isManager) return json(res,200,db.prepare(`SELECT * FROM companies co WHERE ${managerCompanyScopeSql('co')} ORDER BY co.id DESC`).all(...managerCompanyParams(user)));
        return json(res, 200, db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all());
      }
      if (req.method === 'GET') {
        const row=table==='contacts'&&user.role==='partner'
          ?db.prepare('SELECT id,name,phone,email,source FROM contacts WHERE id=?').get(id)
          :db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
        if(row&&user.role==='partner')logAccess(user,'card_view',table,id,'GET');
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
        if (user.role === 'partner') {
          if (table === 'contacts' || table === 'tasks') b.responsible_id = user.id;
          if (table === 'tasks' && !b.deal_id) return json(res,400,{error:'Задачу партнёра нужно связать с переданной сделкой.'});
          if (table === 'tasks' && !partnerOwns(user, 'deals', Number(b.deal_id))) return json(res, 403, { error: 'Задача доступна только по переданной сделке' });
          if (table === 'tasks' && b.contact_id && !partnerOwns(user, 'contacts', b.contact_id)) return json(res, 403, { error: 'Это чужой клиент' });
          if (table === 'notes' && !partnerOwns(user, String(b.entity_type || ''), Number(b.entity_id))) return json(res, 403, { error: 'Заметку можно добавить только к своей карточке' });
        } else if (user.role === 'manager') {
          if (['contacts','companies','tasks'].includes(table)) {
            if (b.responsible_id !== undefined && Number(b.responsible_id) !== Number(user.id)) return json(res,403,{error:'Менеджер может назначать ответственного только на себя.'});
            b.responsible_id = user.id;
          }
          if (table === 'tasks' && b.deal_id && !managerOwns(user,'deals',Number(b.deal_id))) return json(res,403,{error:'Задачу можно связать только с вашей сделкой.'});
          if (table === 'tasks' && b.contact_id && !managerOwns(user,'contacts',Number(b.contact_id))) return json(res,403,{error:'Задачу можно связать только с вашим клиентом.'});
          if (table === 'contacts' && b.company_id && !managerOwns(user,'companies',Number(b.company_id))) return json(res,403,{error:'Компания не входит в ваши карточки.'});
          if (table === 'notes' && !managerOwns(user,String(b.entity_type||''),Number(b.entity_id))) return json(res,403,{error:'Заметку можно добавить только к своей карточке.'});
        }
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
        clampTexts(b);
        const ks = fields.filter(f => b[f] !== undefined), vals = ks.map(k => b[k]);
        if (table === 'contacts' && b.phone !== undefined) { ks.push('phone_norm'); vals.push(digits(b.phone) || null); }
        const r = db.prepare(`INSERT INTO ${table}(${ks}) VALUES(${ks.map(() => '?')})`).run(...vals);
        // Лента читается людьми: «Создано (contacts #123)» с техническим именем
        // таблицы занимало в ней место и ничего не говорило о том, что сделано
        const createdText = {
          contacts: () => `Клиент «${b.name || fmtPhoneRu(b.phone) || b.phone || 'без имени'}» добавлен`,
          companies: () => `Компания «${b.name || 'без названия'}» добавлена`,
          tasks: () => `Задача «${b.title || 'без названия'}» создана`,
          products: () => `Позиция каталога «${b.name || 'без названия'}» добавлена`,
          automations: () => `Правило автоматизации «${b.name || 'без названия'}» добавлено`,
          notes: () => 'Добавлена заметка',
        }[table];
        logActivity(createdText ? createdText() : `Новая запись (${table})`, table, Number(r.lastInsertRowid), user.name);
        // задачу поставили коллеге — он сразу увидит всплывающее уведомление
        if (table === 'tasks' && b.responsible_id && Number(b.responsible_id) !== Number(user.id)) {
          broadcastTo(b.responsible_id, 'notify', { type: 'task_assigned', id: Number(r.lastInsertRowid), title: String(b.title || 'Задача'), due: b.due || '' });
        }
        broadcast('change', { table });
        return json(res, 201, db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(r.lastInsertRowid));
      }
      if (req.method === 'PATCH' && id) {
        const b = await readBody(req);
        if (user.role === 'partner') {
          if (b.responsible_id !== undefined && Number(b.responsible_id) !== Number(user.id)) return json(res, 400, { error: 'Партнёр отвечает только за свои карточки' });
          if (b.deal_id && !partnerOwns(user, 'deals', b.deal_id)) return json(res, 403, { error: 'Это чужая сделка' });
          if (b.contact_id && !partnerOwns(user, 'contacts', b.contact_id)) return json(res, 403, { error: 'Это чужой клиент' });
          if (table === 'notes' && (b.entity_type !== undefined || b.entity_id !== undefined)) {
            const cur=db.prepare('SELECT entity_type,entity_id FROM notes WHERE id=?').get(id);
            const entityType=b.entity_type===undefined?cur?.entity_type:String(b.entity_type);
            const entityId=b.entity_id===undefined?Number(cur?.entity_id):Number(b.entity_id);
            if(!partnerOwns(user,entityType,entityId))return json(res,403,{error:'Заметку можно связать только с вашей переданной сделкой.'});
          }
        } else if (user.role === 'manager') {
          if (b.responsible_id !== undefined && Number(b.responsible_id) !== Number(user.id)) return json(res,403,{error:'Менеджер может назначать ответственного только на себя.'});
          if (table === 'tasks' && b.deal_id && !managerOwns(user,'deals',Number(b.deal_id))) return json(res,403,{error:'Задачу можно связать только с вашей сделкой.'});
          if (table === 'tasks' && b.contact_id && !managerOwns(user,'contacts',Number(b.contact_id))) return json(res,403,{error:'Задачу можно связать только с вашим клиентом.'});
          if (table === 'contacts' && b.company_id && !managerOwns(user,'companies',Number(b.company_id))) return json(res,403,{error:'Компания не входит в ваши карточки.'});
          if (table === 'notes' && (b.entity_type !== undefined || b.entity_id !== undefined)) {
            const cur=db.prepare('SELECT entity_type,entity_id FROM notes WHERE id=?').get(id);
            const entityType=b.entity_type===undefined?cur?.entity_type:String(b.entity_type);
            const entityId=b.entity_id===undefined?Number(cur?.entity_id):Number(b.entity_id);
            if(!managerOwns(user,entityType,entityId))return json(res,403,{error:'Заметку можно связать только с вашей карточкой.'});
          }
        }
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
        clampTexts(b);
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
        // Передача клиента или задачи другому сотруднику остаётся в журнале.
        // Уведомление видит только новый исполнитель, а по ленте потом можно
        // разобрать, кто и когда переложил карточку: в сделках такие правки
        // писались всегда, в клиентах и задачах след терялся.
        const prevOwner = prevTask || prevContact;
        if (prevOwner && b.responsible_id !== undefined
          && Number(b.responsible_id || 0) !== Number(prevOwner.responsible_id || 0)) {
          const ownerName = x => x
            ? (db.prepare('SELECT name FROM users WHERE id=?').get(Number(x))?.name || 'сотрудник ' + Number(x))
            : 'не назначен';
          const whatTitle = String((prevTask ? prevTask.title : prevContact.name) || '').trim().slice(0, 120);
          logActivity(`${prevTask ? 'Задача' : 'Клиент'} «${whatTitle || 'без названия'}»: ответственный ${ownerName(prevOwner.responsible_id)} → ${ownerName(b.responsible_id)}`, table, Number(id), user.name);
        }
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
          nextTaskId = extendRepeatingTask(id, user.name);
          if (nextTaskId) broadcast('change', { table: 'tasks' });
        }
        broadcast('change', { table });
        const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
        return json(res, 200, nextTaskId ? { ...row, next_task_id: nextTaskId } : row);
      }
      if (req.method === 'DELETE' && id) {
        if(user.role==='manager'&&!managerCanDelete(user,table,[id]))return json(res,403,{error:'Удаление затронет данные другого сотрудника. Передайте карточку администратору.'});
        // карточка, за которой стоит переписка, сделки или клиенты компании,
        // удаляется только с явным подтверждением: потери необратимы
        const impact = deleteImpact(table, [id]);
        if (impact && u.searchParams.get('confirm') !== '1')
          return json(res, 409, { error: 'Требуется подтверждение удаления', confirmDelete: true, impact });
        // связанные записи не должны оставаться с «висячими» ссылками
        detachChildren(table, id);
        const before = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
        const gone = db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id).changes;
        if (!gone) return json(res, 404, { error: 'Запись не найдена — обновите страницу' });
        // Удаление необратимо, поэтому след в журнале обязателен: без него
        // пропажу карточки клиента или задачи некому объяснить — неизвестно,
        // кто и когда её убрал. Сделки и шаблоны писались в журнал и раньше,
        // остальные записи удалялись молча.
        const deletedText = {
          contacts: 'Клиент удалён', companies: 'Компания удалена', tasks: 'Задача удалена',
          products: 'Позиция каталога удалена', automations: 'Правило автоматизации удалено',
          notes: 'Заметка удалена',
        }[table] || 'Запись удалена';
        const goneTitle = String((before && (before.name || before.title)) || '').trim().slice(0, 120);
        // состав потерь пишем и в журнал: он объясняет, почему карточка исчезла
        // вместе с перепиской, когда самой карточки уже нет
        const impactText = impact ? '; ' + impactWords(impact) : '';
        logActivity((goneTitle ? `${deletedText}: «${goneTitle}»` : deletedText) + impactText, table, Number(id), user.name);
        broadcast('change', { table });
        return json(res, 200, { deleted: true });
      }
    }
    // ===== pipelines & stages (configurable) =====
    // ===== Обучающий портал партнёров: только партнёры читают, только администратор ведёт =====
    if (p === '/api/partner-training' || /^\/api\/partner-training\/\d+$/.test(p)) {
      if (!['admin', 'partner'].includes(user.role)) return json(res, 403, { error: 'Обучающий портал доступен только партнёрам' });
      if (req.method === 'GET' && p === '/api/partner-training') {
        const rows = user.role === 'admin'
          ? db.prepare('SELECT * FROM partner_training_items ORDER BY sort,id').all()
          : db.prepare('SELECT id,title,body,url,sort,created_at,updated_at FROM partner_training_items WHERE active=1 ORDER BY sort,id').all();
        return json(res, 200, rows);
      }
      if (user.role !== 'admin') return json(res, 403, { error: 'Материалы ведёт администратор' });
      if (req.method === 'POST' && p === '/api/partner-training') {
        const b = await readBody(req);
        const title = String(b.title || '').trim().slice(0, 200);
        if (!title) return json(res, 400, { error: 'Укажите название материала' });
        const body = String(b.body || '').slice(0, 20000);
        const url = String(b.url || '').trim().slice(0, 2000);
        if (url && !/^https?:\/\//i.test(url)) return json(res, 400, { error: 'Ссылка должна начинаться с http:// или https://' });
        const sort = Math.max(0, Math.min(10000, Math.trunc(Number(b.sort) || 0)));
        const r = db.prepare('INSERT INTO partner_training_items(title,body,url,sort,active) VALUES(?,?,?,?,1)').run(title, body, url, sort);
        logActivity(`Материал обучения партнёров «${title}» добавлен`, 'partner_training_items', Number(r.lastInsertRowid), user.name);
        broadcast('change', { table: 'partner-training' });
        return json(res, 201, db.prepare('SELECT * FROM partner_training_items WHERE id=?').get(r.lastInsertRowid));
      }
      const mTrain = p.match(/^\/api\/partner-training\/(\d+)$/);
      if (mTrain) {
        const id = Number(mTrain[1]);
        const row = db.prepare('SELECT * FROM partner_training_items WHERE id=?').get(id);
        if (!row) return json(res, 404, { error: 'Материал не найден' });
        if (req.method === 'PATCH') {
          const b = await readBody(req);
          const title = b.title === undefined ? row.title : String(b.title || '').trim().slice(0, 200);
          if (!title) return json(res, 400, { error: 'Укажите название материала' });
          const body = b.body === undefined ? row.body : String(b.body || '').slice(0, 20000);
          const url = b.url === undefined ? row.url : String(b.url || '').trim().slice(0, 2000);
          if (url && !/^https?:\/\//i.test(url)) return json(res, 400, { error: 'Ссылка должна начинаться с http:// или https://' });
          const sort = b.sort === undefined ? row.sort : Math.max(0, Math.min(10000, Math.trunc(Number(b.sort) || 0)));
          const active = b.active === undefined ? row.active : (b.active ? 1 : 0);
          db.prepare('UPDATE partner_training_items SET title=?,body=?,url=?,sort=?,active=?,updated_at=datetime(\'now\') WHERE id=?').run(title, body, url, sort, active, id);
          logActivity(`Материал обучения партнёров «${title}» обновлён`, 'partner_training_items', id, user.name);
          broadcast('change', { table: 'partner-training' });
          return json(res, 200, db.prepare('SELECT * FROM partner_training_items WHERE id=?').get(id));
        }
        if (req.method === 'DELETE') {
          db.prepare('DELETE FROM partner_training_items WHERE id=?').run(id);
          logActivity('Материал обучения партнёров удалён', 'partner_training_items', id, user.name);
          broadcast('change', { table: 'partner-training' });
          return json(res, 200, { deleted: true });
        }
      }
      return json(res, 405, { error: 'Метод не поддерживается' });
    }
    // ===== Рассылки: менеджер выбирает сегмент, канал и время, сервер отправляет очередью =====
    if (p === '/api/campaigns' || /^\/api\/campaigns\//.test(p)) {
      if (!['admin', 'manager'].includes(user.role)) return json(res, 403, { error: 'Рассылки доступны менеджеру и администратору' });
      if (p === '/api/campaigns/preview' && req.method === 'POST') {
        const b = await readBody(req);
        const channel = String(b.channel) === 'email' ? 'email' : 'whatsapp';
        return json(res, 200, { count: campaignRecipients(b.audience, channel, user).length });
      }
      if (p === '/api/campaigns') {
        if (req.method === 'GET') {
          const rows=user.role==='admin'
            ? db.prepare('SELECT * FROM campaigns ORDER BY id DESC LIMIT 100').all()
            : db.prepare('SELECT * FROM campaigns WHERE created_by_id=? ORDER BY id DESC LIMIT 100').all(user.id);
          return json(res,200,rows);
        }
        if (req.method === 'POST') {
          const rl = rateLimit('campaign:' + user.id, 10, 60000);
          if (!rl.ok) { res.setHeader('Retry-After', String(rl.retryAfter || 60)); return json(res, 429, { error: 'Слишком много рассылок за минуту' }); }
          const b = await readBody(req);
          const name = String(b.name || '').trim().slice(0, 120);
          if (!name) return json(res, 400, { error: 'Укажите название рассылки' });
          const channel = String(b.channel) === 'email' ? 'email' : 'whatsapp';
          if (channel === 'whatsapp' && !getSetting('WAZZUP_API_KEY')) return json(res, 400, { error: 'WhatsApp не подключён: Настройки → Интеграции → Wazzup. Либо выберите канал «Почта»' });
          if (channel === 'email' && !getSetting('SMTP_HOST')) return json(res, 400, { error: 'Почта не настроена: Настройки → Интеграции → Почта (SMTP). Либо выберите канал «WhatsApp»' });
          const message = String(b.message || '').trim().slice(0, 4000);
          if (!message) return json(res, 400, { error: 'Напишите текст сообщения' });
          const subject = channel === 'email' ? (String(b.subject || '').trim().slice(0, 200) || name) : '';
          let scheduledAt = null;
          if (b.scheduled_at) {
            const t = new Date(String(b.scheduled_at));
            if (isNaN(t.getTime())) return json(res, 400, { error: 'Не поняли время отправки' });
            if (t.getTime() < Date.now() - 60000) return json(res, 400, { error: 'Время отправки уже прошло — выберите будущее или отправьте сразу' });
            // храним момент времени в UTC: рассылка уходит в выбранную минуту
            // независимо от того, в каком поясе работает сервер и сотрудник
            scheduledAt = t.toISOString();
          }
          const rows = campaignRecipients(b.audience, channel, user);
          // ошибка называет причину: клиентов не отметили, у отмеченных не
          // заполнен адрес канала или под фильтры сегмента никто не подходит
          const picked = Array.isArray(b.audience && b.audience.ids);
          const pickedIds = picked ? [...new Set(b.audience.ids.map(Number).filter(n => Number.isInteger(n) && n > 0))] : [];
          if (!rows.length && picked && !pickedIds.length) return json(res, 400, { error: 'Отметьте клиентов: рассылка без получателей не создаётся' });
          if (!rows.length) return json(res, 400, { error: (picked ? 'У выбранных клиентов не заполнен ' : 'Под фильтр не подходит ни один клиент с заполненным ')
            + (channel === 'email' ? 'e-mail' : 'телефон') + '. Проверьте сегмент или выберите другой канал' });
          if (rows.length > 5000) return json(res, 400, { error: 'Слишком большой сегмент: предел одной рассылки — 5000 получателей' });
          // список получателей уже лежит поштучно в campaign_items, поэтому в
          // описании рассылки массив id не дублируем: пишем только число
          const stored = { ...(b.audience && typeof b.audience === 'object' ? b.audience : {}) };
          delete stored.ids;
          if (picked) stored.picked = rows.length;
          const r = db.prepare('INSERT INTO campaigns(name,channel,subject,message,audience,status,scheduled_at,created_by,created_by_id,total) VALUES(?,?,?,?,?,?,?,?,?,?)')
            .run(name, channel, subject, message, JSON.stringify(stored), scheduledAt ? 'scheduled' : 'queued', scheduledAt, user.name, user.id, rows.length);
          const ins = db.prepare('INSERT INTO campaign_items(campaign_id,contact_id,address) VALUES(?,?,?)');
          for (const row of rows) ins.run(Number(r.lastInsertRowid), row.id, String(row.address));
          logActivity(`Рассылка «${name}»: ${rows.length} получателей, канал ${channel === 'email' ? 'почта' : 'WhatsApp'}${scheduledAt ? ', запланирована на ' + localNow(new Date(scheduledAt)) : ''}`, 'campaigns', Number(r.lastInsertRowid), user.name);
          broadcast('change', { table: 'campaigns' });
          return json(res, 201, db.prepare('SELECT * FROM campaigns WHERE id=?').get(r.lastInsertRowid));
        }
      }
      const mCamp = p.match(/^\/api\/campaigns\/(\d+)(?:\/(start|cancel))?$/);
      if (mCamp) {
        const cid = Number(mCamp[1]);
        const camp = db.prepare('SELECT * FROM campaigns WHERE id=?').get(cid);
        if (!camp || (user.role==='manager'&&Number(camp.created_by_id)!==Number(user.id))) return json(res,404,{error:'Рассылка не найдена — обновите страницу'});
        if (req.method === 'GET') {
          const items=db.prepare('SELECT ci.*, c.name contact_name FROM campaign_items ci LEFT JOIN contacts c ON c.id=ci.contact_id WHERE ci.campaign_id=? ORDER BY ci.id LIMIT 1000').all(cid);
          if(user.role==='manager') for(const item of items) if(!managerOwns(user,'contacts',Number(item.contact_id))){
            item.contact_id=null; item.contact_name='Карточка недоступна'; item.address='';
          }
          return json(res,200,{...camp,items});
        }
        if (req.method === 'POST' && mCamp[2] === 'start') {
          if (user.role !== 'admin' && Number(camp.created_by_id) !== Number(user.id)) return json(res, 403, { error: 'Запустить рассылку может её автор или администратор' });
          if (camp.status !== 'scheduled') return json(res, 400, { error: 'Отправить сразу можно только запланированную рассылку' });
          db.prepare("UPDATE campaigns SET status='queued', scheduled_at=NULL WHERE id=?").run(cid);
          logActivity(`Рассылка «${camp.name}» запущена вручную`, 'campaigns', cid, user.name);
          broadcast('change', { table: 'campaigns' });
          return json(res, 200, { ok: true });
        }
        if (req.method === 'POST' && mCamp[2] === 'cancel') {
          if (user.role !== 'admin' && Number(camp.created_by_id) !== Number(user.id)) return json(res, 403, { error: 'Отменить рассылку может её автор или администратор' });
          if (!['scheduled', 'queued', 'running'].includes(camp.status)) return json(res, 400, { error: 'Эта рассылка уже завершена' });
          db.prepare("UPDATE campaigns SET status='canceled' WHERE id=?").run(cid);
          db.prepare("UPDATE campaign_items SET status='canceled' WHERE campaign_id=? AND status='queued'").run(cid);
          logActivity(`Рассылка «${camp.name}» отменена`, 'campaigns', cid, user.name);
          broadcast('change', { table: 'campaigns' });
          return json(res, 200, { ok: true });
        }
        if (req.method === 'DELETE') {
          if (!requireAdmin(user, res)) return;
          db.prepare('DELETE FROM campaigns WHERE id=?').run(cid);
          logActivity(`Рассылка «${camp.name}» удалена`, 'campaigns', cid, user.name);
          broadcast('change', { table: 'campaigns' });
          return json(res, 200, { ok: true });
        }
      }
      return json(res, 404, { error: 'Не найдено' });
    }
    // ===== ОКК: ручная проверка по рабочей таблице заказчика =====
    // Оценка всегда ручная. Чек-лист не меняет карточки, задачи и переписку;
    // рекомендации показываются человеку и ничего не отправляют автоматически.
    if (p === '/api/quality/deals' && req.method === 'GET') {
      if (!requireAdmin(user, res)) return;
      const q = String(u.searchParams.get('q') || '').trim().slice(0, 100);
      const needle = q;
      const limit = Math.min(60, Math.max(1, Math.trunc(Number(u.searchParams.get('limit')) || 30)));
      const rows = db.prepare(`WITH candidate AS (
          SELECT d.id,d.title,d.stage,d.pipeline_id,COALESCE(p.name,'') pipeline_name,
            COALESCE(st.name,d.stage) stage_name,d.responsible,d.responsible_id,d.closed_at,
            COALESCE(c.id,0) contact_id,COALESCE(c.name,'') contact_name,COALESCE(NULLIF(d.lead_source,''),NULLIF(c.source,''),'') source,
            d.created_at,d.updated_at
          FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id
          LEFT JOIN pipelines p ON p.id=d.pipeline_id
          LEFT JOIN stages st ON st.pipeline_id=d.pipeline_id AND st.code=d.stage
          WHERE (?='' OR instr(lower_ru(d.title),lower_ru(?))>0 OR instr(lower_ru(COALESCE(c.name,'')),lower_ru(?))>0
            OR instr(lower_ru(COALESCE(d.responsible,'')),lower_ru(?))>0 OR instr(CAST(d.id AS TEXT),?)>0)
          ORDER BY COALESCE(d.updated_at,d.created_at) DESC,d.id DESC LIMIT ?
        )
        SELECT x.id,x.title,x.stage,x.stage_name,x.pipeline_id,x.pipeline_name,x.responsible,x.responsible_id,
          x.contact_name,x.source,x.created_at,x.updated_at,x.closed_at,
          (SELECT COUNT(*) FROM conversations cv JOIN messages m ON m.conversation_id=cv.id WHERE cv.contact_id=x.contact_id) message_count,
          (SELECT MAX(m.created_at) FROM conversations cv JOIN messages m ON m.conversation_id=cv.id WHERE cv.contact_id=x.contact_id) last_message_at,
          (SELECT COUNT(*) FROM quality_reviews qr WHERE qr.deal_id=x.id) review_count,
          (SELECT MAX(qr.completed_at) FROM quality_reviews qr WHERE qr.deal_id=x.id AND qr.status='complete') last_review_at
        FROM candidate x ORDER BY COALESCE(x.updated_at,x.created_at) DESC,x.id DESC`).all(q, needle, needle, needle, needle, limit);
      return json(res, 200, { rows });
    }
    if (p === '/api/quality/my-reviews' && req.method === 'GET') {
      if (user.role !== 'manager') return json(res, 403, { error: 'Здесь доступны только ваши завершённые проверки' });
      const days = Math.min(365, Math.max(1, Math.trunc(Number(u.searchParams.get('days')) || 90)));
      const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 19).replace('T', ' ');
      const rows = db.prepare(`SELECT * FROM quality_reviews
        WHERE status='complete' AND responsible_id=? AND completed_at>=?
        ORDER BY completed_at DESC,id DESC LIMIT 30`).all(user.id,since);
      const ids = rows.map(r => Number(r.id));
      const mark = ids.map(() => '?').join(',');
      const itemsBy = new Map();
      if (ids.length) for (const item of db.prepare(`SELECT review_id,criterion_key,status FROM quality_review_items WHERE review_id IN (${mark})`).all(...ids)) {
        if (!itemsBy.has(item.review_id)) itemsBy.set(item.review_id,[]);
        itemsBy.get(item.review_id).push(item);
      }
      return json(res,200,{ days, reviews:rows.map(r=>({ id:r.id,deal_title:r.deal_title,contact_name:r.contact_name,
        responsible_name:r.responsible_name,stage_name:r.stage_name,source:r.source,period_start:r.period_start,
        period_end:r.period_end,interaction_type:r.interaction_type,completed_at:r.completed_at,
        reviewer_name:r.reviewer_name,next_steps:qParseArray(r.next_steps),score:qStats(itemsBy.get(r.id)||[],r) })) });
    }
    if (p === '/api/quality/reviews' && req.method === 'GET') {
      if (!['admin', 'rop'].includes(user.role)) return json(res, 403, { error: 'Проверки ОКК видят руководитель и администратор' });
      if (user.role === 'rop' && !user.team_id) return json(res, 403, { error: 'Руководителю сначала назначают команду.' });
      const days = Math.min(365, Math.max(1, Math.trunc(Number(u.searchParams.get('days')) || 7)));
      const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 19).replace('T', ' ');
      const filters = qBuildReviewFilters(u.searchParams);
      if (filters.error) return json(res,400,{error:filters.error});
      const clauses = [...filters.clauses], params = [...filters.params];
      // РОП видит только завершённые проверки своей команды: черновики
      // руководителя и чужие команды ему не раскрываются.
      if (user.role === 'rop') {
        clauses.push("r.status<>'draft'");
        clauses.push('r.responsible_id IN (SELECT id FROM users WHERE team_id=?)');
        params.push(Number(user.team_id));
        if (filters.selected.manager_id) {
          const m = db.prepare('SELECT team_id FROM users WHERE id=?').get(filters.selected.manager_id);
          if (!m || Number(m.team_id) !== Number(user.team_id)) return json(res, 403, { error: 'Можно смотреть только свою команду.' });
        }
      }
      const extra = clauses.length ? ' AND '+clauses.join(' AND ') : '';
      const args = [since,...params];
      const rows = db.prepare(`SELECT r.* FROM quality_reviews r
        WHERE (r.status='draft' OR r.completed_at>=?)${extra}
        ORDER BY CASE WHEN r.status='draft' THEN 0 ELSE 1 END,r.updated_at DESC,r.id DESC LIMIT 100`).all(...args);
      const summary = { drafts:0,complete:0,no_contact:0,unavailable:0 };
      db.prepare(`SELECT r.status,COUNT(*) n FROM quality_reviews r
        WHERE (r.status='draft' OR r.completed_at>=?)${extra} GROUP BY r.status`).all(...args)
        .forEach(r=>{summary[r.status]=Number(r.n)||0;});
      const total = db.prepare(`SELECT COUNT(*) n FROM quality_reviews r
        WHERE (r.status='draft' OR r.completed_at>=?)${extra}`).get(...args).n;
      const ids=rows.map(r=>Number(r.id)), marks=ids.map(()=>'?').join(',');
      const itemMap=new Map(), growthMap=new Map(), factMap=new Map();
      if(ids.length){
        for(const item of db.prepare(`SELECT * FROM quality_review_items WHERE review_id IN (${marks}) ORDER BY id`).all(...ids)){
          if(!itemMap.has(item.review_id))itemMap.set(item.review_id,[]); itemMap.get(item.review_id).push(item);
        }
        for(const item of db.prepare(`SELECT * FROM quality_review_growth_items WHERE review_id IN (${marks}) ORDER BY id`).all(...ids)){
          if(!growthMap.has(item.review_id))growthMap.set(item.review_id,[]); growthMap.get(item.review_id).push(item);
        }
        for(const fact of db.prepare(`SELECT * FROM quality_review_facts WHERE review_id IN (${marks})`).all(...ids)){
          if(!factMap.has(fact.review_id))factMap.set(fact.review_id,[]); factMap.get(fact.review_id).push(fact);
        }
      }
      const reviews=rows.map(row=>qReviewShape(row,itemMap.get(row.id)||[],growthMap.get(row.id)||[],factMap.get(row.id)||[]));
      const ranked=`WITH ranked AS (
        SELECT r.id,r.deal_id,r.pipeline_id,r.pipeline_name,r.stage,r.stage_name,r.source,r.responsible_id,r.responsible_name,r.next_steps,
          COALESCE(r.period_start,'') period_start,COALESCE(r.period_end,'') period_end,r.interaction_type,r.completed_at,
          ROW_NUMBER() OVER(PARTITION BY r.deal_id,COALESCE(r.period_start,''),COALESCE(r.period_end,''),r.interaction_type
            ORDER BY r.completed_at DESC,r.id DESC) rn
        FROM quality_reviews r WHERE r.status='complete' AND r.completed_at>=?${extra}
      )`;
      const metricRows=db.prepare(`${ranked}
        SELECT r.id,r.deal_id,r.pipeline_id,r.pipeline_name,r.stage,r.stage_name,r.source,
          r.responsible_id,r.responsible_name,r.interaction_type,r.period_start,r.period_end,r.next_steps,r.completed_at,
          (SELECT COUNT(*) FROM quality_review_facts f WHERE f.review_id=r.id) fact_count,
          (SELECT COUNT(*) FROM quality_review_facts f WHERE f.review_id=r.id AND f.heard_status='yes') heard_yes,
          (SELECT COUNT(*) FROM quality_review_facts f WHERE f.review_id=r.id AND f.heard_status IN ('yes','no')) heard_known,
          (SELECT COUNT(*) FROM quality_review_facts f WHERE f.review_id=r.id AND f.heard_status IN ('unknown','')) heard_unknown,
          (SELECT COUNT(*) FROM quality_review_facts f WHERE f.review_id=r.id AND f.heard_status='na') heard_na,
          (SELECT MAX(CASE WHEN f.fact_key='city' THEN f.heard_status END) FROM quality_review_facts f WHERE f.review_id=r.id) city_heard,
          (SELECT MAX(CASE WHEN f.fact_key='city' THEN f.crm_status END) FROM quality_review_facts f WHERE f.review_id=r.id) city_crm,
          (SELECT MAX(CASE WHEN f.fact_key='land' THEN f.heard_status END) FROM quality_review_facts f WHERE f.review_id=r.id) land_heard,
          (SELECT MAX(CASE WHEN f.fact_key='land' THEN f.crm_status END) FROM quality_review_facts f WHERE f.review_id=r.id) land_crm,
          (SELECT status FROM quality_review_items i WHERE i.review_id=r.id AND i.criterion_key='next_step') next_step_status,
          (SELECT status FROM quality_review_items i WHERE i.review_id=r.id AND i.criterion_key='followup') repeat_status,
          (SELECT status FROM quality_review_growth_items g WHERE g.review_id=r.id AND g.criterion_key='materials_followup') materials_status,
          (SELECT status FROM quality_review_growth_items g WHERE g.review_id=r.id AND g.criterion_key='region_coverage') geography_status
        FROM ranked r WHERE r.rn=1 ORDER BY r.completed_at DESC,r.id DESC`).all(since,...params);
      const metricDefinitions=[
        {key:'qualification',title:'Полная квалификация',target:75,definition:'Доля проверенных разговоров, где подтверждено не менее 4 из 6 факторов: объект/площадь, город, участок, срок, бюджет и способ оплаты.'},
        {key:'cityLandCrm',title:'Город и участок в CRM',target:90,definition:'Среди разговоров, где город был известен и оба CRM-поля можно проверить: доля карточек с заполненными городом и участком/его статусом.'},
        {key:'nextStep',title:'Конкретный следующий шаг',target:85,definition:'Доля разговоров, где подтверждены действие, дата, время, канал и цель следующего контакта.'},
        {key:'materials',title:'Материалы с контролем',target:90,definition:'Доля проверенных отправок каталога/фото, для которых зафиксирован следующий шаг или follow-up.'},
        {key:'geography',title:'Проверенная география',target:100,definition:'Доля применимых случаев, где покрытие региона сверено до обещания строительства или выезда.'},
        {key:'calls',title:'Разбор звонков с действием',target:5,definition:'Число уникальных разборов звонка на сотрудника, для каждого указано хотя бы одно конкретное действие. Цель — 5 разборов в неделю.'},
        {key:'repeatFollowup',title:'Повторные касания',target:80,definition:'Доля лидов без ответа, для которых подтверждены 1–2 своевременных касания с новой пользой, без дублей и спама.'},
      ];
      const statusOK=s=>s==='yes'||s==='no';
      const ratio=(list,eligible,success,target)=>{
        const a=list.filter(eligible),n=a.filter(success).length;
        return{numerator:n,denominator:a.length,excluded:list.length-a.length,percent:qPercent(n,a.length),target};
      };
      const weeks=Math.max(days/7,1/7);
      const metricsFor=list=>({
        qualification:ratio(list,r=>Number(r.heard_yes)>=4||(6-Number(r.heard_na)>=4&&Number(r.heard_yes)+Number(r.heard_unknown)<4),r=>Number(r.heard_yes)>=4,75),
        cityLandCrm:ratio(list,r=>r.city_heard==='yes'&&statusOK(r.city_crm)&&statusOK(r.land_crm),r=>r.city_crm==='yes'&&r.land_crm==='yes',90),
        nextStep:ratio(list,r=>statusOK(r.next_step_status),r=>r.next_step_status==='yes',85),
        materials:ratio(list,r=>statusOK(r.materials_status),r=>r.materials_status==='yes',90),
        geography:ratio(list,r=>statusOK(r.geography_status),r=>r.geography_status==='yes',100),
        repeatFollowup:ratio(list,r=>statusOK(r.repeat_status),r=>r.repeat_status==='yes',80),
        calls:(()=>{
          const a=list.filter(r=>['call','mixed'].includes(r.interaction_type));
          const withAction=a.filter(r=>qParseArray(r.next_steps).some(x=>String(x).trim().length>=8)).length;
          return{numerator:withAction,denominator:a.length,excluded:list.length-a.length,percent:null,
            weeklyRate:withAction/weeks,target:5,weeks};
        })(),
      });
      const rawComplete=db.prepare(`SELECT COUNT(*) n FROM quality_reviews r WHERE r.status='complete' AND r.completed_at>=?${extra}`).get(...args).n;
      const metricsByManagerMap=new Map();
      for(const row of metricRows){
        const id=Number(row.responsible_id)||0;
        if(!metricsByManagerMap.has(id))metricsByManagerMap.set(id,{id:id||null,name:row.responsible_name||'Не назначен',rows:[]});
        metricsByManagerMap.get(id).rows.push(row);
      }
      const activeManagers=user.role==='rop'
        ? db.prepare("SELECT id,name FROM users WHERE active=1 AND role IN ('admin','manager') AND team_id=? ORDER BY name,id").all(Number(user.team_id))
        : db.prepare("SELECT id,name FROM users WHERE active=1 AND role IN ('admin','manager') ORDER BY name,id").all();
      const metricsByManager=activeManagers.map(m=>{
        const group=metricsByManagerMap.get(Number(m.id)), values=metricsFor(group?.rows||[]);
        return{id:m.id,name:m.name,reviewedCalls:values.calls.denominator,callsWithAction:values.calls.numerator,
          callsPerWeek:values.calls.weeklyRate,metrics:values};
      });
      for(const [id,group] of metricsByManagerMap){
        if(!activeManagers.some(m=>Number(m.id)===id)){
          const values=metricsFor(group.rows);
          metricsByManager.push({id:id||null,name:group.name||'Не назначен',reviewedCalls:values.calls.denominator,
            callsWithAction:values.calls.numerator,callsPerWeek:values.calls.weeklyRate,metrics:values});
        }
      }
      const metricValues=metricsFor(metricRows);
      const stageBreakdownMap=new Map();
      for(const row of metricRows){
        const key=`${row.pipeline_id||0}:${row.stage||''}`;
        if(!stageBreakdownMap.has(key))stageBreakdownMap.set(key,{pipeline_name:row.pipeline_name||'Воронка не указана',stage_name:row.stage_name||row.stage||'Этап не указан',interactions:0,deals:new Set()});
        const group=stageBreakdownMap.get(key);group.interactions++;group.deals.add(Number(row.deal_id));
      }
      const stageBreakdown=[...stageBreakdownMap.values()].map(x=>({...x,deals:x.deals.size})).sort((a,b)=>a.pipeline_name.localeCompare(b.pipeline_name,'ru')||a.stage_name.localeCompare(b.stage_name,'ru'));
      const periodBreakdownMap=new Map();
      for(const row of metricRows){
        const dt=new Date(String(row.completed_at||'').replace(' ','T')+'Z');
        if(Number.isNaN(dt.getTime()))continue;
        const day=(dt.getUTCDay()+6)%7;dt.setUTCDate(dt.getUTCDate()-day);dt.setUTCHours(0,0,0,0);
        const week=dt.toISOString().slice(0,10);
        if(!periodBreakdownMap.has(week))periodBreakdownMap.set(week,{week_start:week,interactions:0,deals:new Set()});
        const group=periodBreakdownMap.get(week);group.interactions++;group.deals.add(Number(row.deal_id));
      }
      const periodBreakdown=[...periodBreakdownMap.values()].map(x=>({...x,deals:x.deals.size})).sort((a,b)=>a.week_start.localeCompare(b.week_start));
      const optionsSince=new Date(Date.now()-365*864e5).toISOString().slice(0,19).replace('T',' ');
      const savedOptions=user.role==='rop'
        ? db.prepare(`SELECT DISTINCT pipeline_id,pipeline_name,stage,stage_name,source,responsible_id,responsible_name
        FROM quality_reviews WHERE completed_at>=? AND responsible_id IN (SELECT id FROM users WHERE team_id=?) ORDER BY pipeline_name,stage_name,source,responsible_name`).all(optionsSince,Number(user.team_id))
        : db.prepare(`SELECT DISTINCT pipeline_id,pipeline_name,stage,stage_name,source,responsible_id,responsible_name
        FROM quality_reviews WHERE completed_at>=? ORDER BY pipeline_name,stage_name,source,responsible_name`).all(optionsSince);
      const pipelineMap=new Map(db.prepare('SELECT id,name FROM pipelines ORDER BY name').all().map(x=>[Number(x.id),{id:Number(x.id),name:x.name}]));
      for(const x of savedOptions)if(x.pipeline_id&&!pipelineMap.has(Number(x.pipeline_id)))pipelineMap.set(Number(x.pipeline_id),{id:Number(x.pipeline_id),name:x.pipeline_name||`Воронка ${x.pipeline_id}`});
      const stageMap=new Map();
      const addStage=(key,name,pipelineName)=>{
        if(!key)return;
        const k=String(key);if(!stageMap.has(k))stageMap.set(k,{id:k,names:new Set(),pipelines:new Set()});
        const item=stageMap.get(k);if(name)item.names.add(String(name));if(pipelineName)item.pipelines.add(String(pipelineName));
      };
      for(const x of db.prepare(`SELECT s.code,s.name,p.name pipeline_name FROM stages s JOIN pipelines p ON p.id=s.pipeline_id ORDER BY p.name,s.sort`).all())addStage(x.code,x.name,x.pipeline_name);
      for(const x of savedOptions)addStage(x.stage,x.stage_name,x.pipeline_name);
      const stages=[...stageMap.values()].map(x=>({id:x.id,name:[...x.names].join(' / ')||x.id,...(x.pipelines.size>1?{pipelines:[...x.pipelines].join(', ')}:{})}));
      const sourceSet=new Set(db.prepare("SELECT DISTINCT source FROM contacts WHERE COALESCE(source,'')<>'' ORDER BY source").all().map(x=>String(x.source)));
      const managerMap=new Map((user.role==='rop'
        ? db.prepare("SELECT id,name FROM users WHERE role IN ('admin','manager') AND team_id=? ORDER BY name,id").all(Number(user.team_id))
        : db.prepare("SELECT id,name FROM users WHERE role IN ('admin','manager') ORDER BY name,id").all()).map(x=>[Number(x.id),{id:Number(x.id),name:x.name}]));
      for(const x of savedOptions){if(x.source)sourceSet.add(String(x.source));if(x.responsible_id&&!managerMap.has(Number(x.responsible_id)))managerMap.set(Number(x.responsible_id),{id:Number(x.responsible_id),name:x.responsible_name||'Сотрудник'});}
      const filterOptions={pipelines:[...pipelineMap.values()],stages,sources:[...sourceSet],managers:[...managerMap.values()]};
      const grouped=db.prepare(`${ranked}
        SELECT i.criterion_key,i.status,COUNT(*) n FROM quality_review_items i JOIN ranked r ON r.id=i.review_id
        WHERE r.rn=1 GROUP BY i.criterion_key,i.status`).all(since,...params);
      const byCriterion=new Map();
      for(const row of grouped){if(!byCriterion.has(row.criterion_key))byCriterion.set(row.criterion_key,{yes:0,no:0,na:0,unknown:0,empty:0});if(Object.hasOwn(byCriterion.get(row.criterion_key),row.status))byCriterion.get(row.criterion_key)[row.status]=Number(row.n)||0;}
      const uniqueCount=metricRows.length;
      const criteria=QUALITY_CRITERIA.map(c=>{const n=byCriterion.get(c.key)||{yes:0,no:0,na:0,unknown:0,empty:0};const applicable=n.yes+n.no;return{...c,...n,applicable,percent:qPercent(n.yes,applicable),coverage:qPercent(applicable,uniqueCount)||0};});
      const groupedGrowth=db.prepare(`${ranked}
        SELECT g.criterion_key,g.status,COUNT(*) n FROM quality_review_growth_items g JOIN ranked r ON r.id=g.review_id
        WHERE r.rn=1 GROUP BY g.criterion_key,g.status`).all(since,...params);
      const growthStatusMap=new Map();for(const row of groupedGrowth){if(!growthStatusMap.has(row.criterion_key))growthStatusMap.set(row.criterion_key,{yes:0,no:0,na:0,unknown:0,empty:0});if(Object.hasOwn(growthStatusMap.get(row.criterion_key),row.status))growthStatusMap.get(row.criterion_key)[row.status]=Number(row.n)||0;}
      const growthCriteria=QUALITY_GROWTH_CRITERIA.map(c=>{const n=growthStatusMap.get(c.key)||{yes:0,no:0,na:0,unknown:0,empty:0};const applicable=n.yes+n.no;return{...c,...n,applicable,percent:qPercent(n.yes,applicable),coverage:qPercent(applicable,uniqueCount)||0};});
      return json(res,200,{days,total:Number(total)||0,summary,criteria,growthCriteria,metrics:metricValues,metricsByManager,
        metricDefinitions,filterOptions,selectedFilters:filters.selected,stageBreakdown,periodBreakdown,
        deduplication:{unit:'Сделка + проверенный период + тип контакта; повторная оценка одной выборки учитывается один раз, последняя завершённая версия главная.',
          interactions:uniqueCount,duplicateReviews:Math.max(0,Number(rawComplete)-uniqueCount)},
        reviews,truncated:Number(total)>reviews.length});
    }
    if (p === '/api/quality/conversion' && req.method === 'GET') {
      if(!['admin','rop'].includes(user.role))return json(res,403,{error:'Конверсию видят руководитель и администратор'});
      if(user.role==='rop'&&!user.team_id)return json(res,403,{error:'Руководителю сначала назначают команду.'});
      const days=Math.min(365,Math.max(1,Math.trunc(Number(u.searchParams.get('days'))||7)));
      const since=new Date(Date.now()-days*864e5).toISOString().slice(0,19).replace('T',' ');
      const parseId=(key,label)=>{
        const raw=String(u.searchParams.get(key)||'').trim();
        if(!raw)return{value:0};
        if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<1)return{error:`Фильтр «${label}» задан неверно`};
        return{value:Number(raw)};
      };
      const pipe=parseId('pipeline_id','воронка'),owner=parseId('manager_id','ответственный');
      if(pipe.error||owner.error)return json(res,400,{error:pipe.error||owner.error});
      const pipelineId=pipe.value,managerId=owner.value;
      if(user.role==='rop'&&managerId){
        const m=db.prepare('SELECT team_id FROM users WHERE id=?').get(managerId);
        if(!m||Number(m.team_id)!==Number(user.team_id))return json(res,403,{error:'Можно смотреть только свою команду.'});
      }
      const source=String(u.searchParams.get('source')||'').trim().slice(0,60);
      const stage=String(u.searchParams.get('stage')||'').trim().slice(0,120);
      const cohortClauses=["h.event_type='created'",'h.entered_at>=?'],cohortParams=[since];
      if(user.role==='rop'){cohortClauses.push('h.responsible_id IN (SELECT id FROM users WHERE team_id=?)');cohortParams.push(Number(user.team_id));}
      if(pipelineId){cohortClauses.push('h.pipeline_id=?');cohortParams.push(pipelineId);}
      if(managerId){cohortClauses.push('h.responsible_id=?');cohortParams.push(managerId);}
      if(source){cohortClauses.push("COALESCE(h.source,'')=?");cohortParams.push(source);}
      const cohortWhere=cohortClauses.join(' AND ');
      const byPipeline=db.prepare(`SELECT h.pipeline_id,COALESCE(p.name,'Воронка') name,
          COUNT(DISTINCT d.id) total,COUNT(DISTINCT CASE WHEN d.stage='won' THEN d.id END) won,
          COUNT(DISTINCT CASE WHEN d.stage='lost' THEN d.id END) lost,
          COUNT(DISTINCT CASE WHEN d.stage NOT IN ('won','lost') THEN d.id END) open
        FROM deal_stage_history h JOIN deals d ON d.id=h.deal_id LEFT JOIN pipelines p ON p.id=h.pipeline_id
        WHERE ${cohortWhere} GROUP BY h.pipeline_id,p.name ORDER BY p.name`).all(...cohortParams)
        .map(r=>({...r,closed:r.won+r.lost,conversion:qPercent(r.won,r.won+r.lost)}));
      const bySource=db.prepare(`SELECT COALESCE(NULLIF(h.source,''),'Источник не указан') name,
          COUNT(DISTINCT d.id) total,COUNT(DISTINCT CASE WHEN d.stage='won' THEN d.id END) won,
          COUNT(DISTINCT CASE WHEN d.stage='lost' THEN d.id END) lost,
          COUNT(DISTINCT CASE WHEN d.stage NOT IN ('won','lost') THEN d.id END) open
        FROM deal_stage_history h JOIN deals d ON d.id=h.deal_id
        WHERE ${cohortWhere} GROUP BY COALESCE(NULLIF(h.source,''),'Источник не указан') ORDER BY name`).all(...cohortParams)
        .map(r=>({...r,closed:r.won+r.lost,conversion:qPercent(r.won,r.won+r.lost)}));
      const stageClauses=["h.event_type IN ('created','entered')",'h.entered_at>=?'],stageParams=[since];
      if(user.role==='rop'){stageClauses.push('h.responsible_id IN (SELECT id FROM users WHERE team_id=?)');stageParams.push(Number(user.team_id));}
      if(pipelineId){stageClauses.push('h.pipeline_id=?');stageParams.push(pipelineId);}
      if(managerId){stageClauses.push('h.responsible_id=?');stageParams.push(managerId);}
      if(source){stageClauses.push("COALESCE(h.source,'')=?");stageParams.push(source);}
      if(stage){stageClauses.push("COALESCE(h.stage,'')=?");stageParams.push(stage);}
      const byStage=db.prepare(`SELECT h.pipeline_id,COALESCE(p.name,'Воронка') pipeline_name,h.stage,h.stage_name,
          COUNT(DISTINCT d.id) entered,COUNT(DISTINCT CASE WHEN d.stage='won' THEN d.id END) won,
          COUNT(DISTINCT CASE WHEN d.stage='lost' THEN d.id END) lost,
          COUNT(DISTINCT CASE WHEN d.stage NOT IN ('won','lost') THEN d.id END) open
        FROM deal_stage_history h JOIN deals d ON d.id=h.deal_id LEFT JOIN pipelines p ON p.id=h.pipeline_id
        WHERE ${stageClauses.join(' AND ')} GROUP BY h.pipeline_id,p.name,h.stage,h.stage_name
        ORDER BY p.name,h.stage_name`).all(...stageParams)
        .map(r=>({...r,closed:r.won+r.lost,conversion:qPercent(r.won,r.won+r.lost)}));
      const creationHistoryUnavailable=Number(db.prepare(`SELECT COUNT(DISTINCT d.id) n FROM deals d
        WHERE d.created_at>=? AND NOT EXISTS(SELECT 1 FROM deal_stage_history h WHERE h.deal_id=d.id AND h.event_type='created')${user.role==='rop'?' AND d.responsible_id IN (SELECT id FROM users WHERE team_id=?)':''}`).get(...(user.role==='rop'?[since,Number(user.team_id)]:[since])).n)||0;
      const historyAvailableSince=db.prepare('SELECT MIN(entered_at) value FROM deal_stage_history').get().value||'';
      return json(res,200,{days,from:since,byPipeline,byStage,bySource,creationHistoryUnavailable,historyAvailableSince,
        definitions:[
          'Период по воронкам и источникам — дата создания сделки. Источник, воронка и ответственный берутся из события создания; результат сделки показан в её текущем состоянии.',
          'Конверсия — выигранные среди выигранных и проигранных. Открытые сделки показаны отдельно и в знаменатель не входят.',
          'По этапам считаются уникальные сделки, вошедшие в этап в выбранный период. Итог — текущее состояние этих сделок; повторный вход в тот же этап не дублирует сделку в этом срезе.',
          'Система не восстанавливает историю до включения журнала этапов. Сделки без события создания не входят в срезы по воронке и источнику; их число показано отдельно.',
          'Фильтр этапа относится к истории проверок и таблице этапов. Фильтр сотрудника в конверсии использует ответственного на момент создания сделки или перехода.',
        ]});
    }
    if (p === '/api/quality/ai-draft' && req.method === 'POST') {
      if (!['admin', 'rop'].includes(user.role)) return json(res, 403, { error: 'Только для администратора или РОПа' });
      const b = await readBody(req);
      const dealId = Number(b.deal_id);
      if (!Number.isSafeInteger(dealId) || dealId < 1) return json(res, 400, { error: 'Выберите сделку' });
      const deal = db.prepare('SELECT id,title,responsible_id FROM deals WHERE id=?').get(dealId);
      if (!deal) return json(res, 404, { error: 'Сделка не найдена' });
      if (user.role === 'rop' && !ropCanSeeManager(user, deal.responsible_id)) return json(res, 403, { error: 'Нет доступа к сделке другой команды' });
      let text = String(b.transcript || '').trim();
      let source = 'transcript';
      if (!text) {
        const msgs = db.prepare("SELECT direction,body FROM messages WHERE deal_id=? AND trim(COALESCE(body,''))!='' ORDER BY id DESC LIMIT 30").all(dealId);
        if (msgs.length) {
          text = msgs.reverse().map(m => `${m.direction === 'out' ? 'Менеджер' : 'Клиент'}: ${m.body}`).join('\n');
          source = 'messages';
        }
      }
      if (!text) return json(res, 200, { experimental: true, draft: true, status: 'no_data', message: 'Нет данных: нет расшифровки звонка или переписки по сделке', items: [] });
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const findEvidence = re => lines.find(l => re.test(l)) || '';
      const checks = [
        { code: 'greeting_qualification', title: 'Приветствие и квалификация', re: /(здравствуйте|добрый день|меня зовут|какой|планируете|дом|проект)/i },
        { code: 'location_land', title: 'Город и наличие участка', re: /(участок|земл|город|район|область|посёлок|поселок)/i },
        { code: 'budget_payment', title: 'Бюджет и тип оплаты', re: /(бюджет|миллион|тысяч|руб|ипотек|налич|рассроч|маткапитал|оплат)/i },
        { code: 'next_step', title: 'Следующий шаг', re: /(созвон|встреч|отправлю|кп|расчёт|расчет|завтра|договорились)/i },
      ];
      const items = checks.map(c => {
        const evidence = findEvidence(c.re);
        return { code: c.code, title: c.title, status: evidence ? 'found' : 'no_data', evidence: evidence ? evidence.slice(0, 180) : null };
      });
      return json(res, 200, {
        experimental: true,
        draft: true,
        source,
        message: 'Тестовый черновик ОКК (требует подтверждения РОПа)',
        items
      });
    }
    if (p === '/api/quality/reviews' && req.method === 'POST') {
      if (!requireAdmin(user, res)) return;
      const b = await readBody(req);
      const dealId = Number(b.deal_id);
      if (!Number.isSafeInteger(dealId) || dealId < 1) return json(res, 400, { error: 'Выберите сделку для проверки' });
      const deal = db.prepare(`SELECT d.id,d.title,d.stage,d.pipeline_id,d.responsible,d.responsible_id,d.demo,d.closed_at,d.created_at,d.updated_at,
          COALESCE(c.id,0) contact_id,COALESCE(c.name,'') contact_name,COALESCE(NULLIF(d.lead_source,''),NULLIF(c.source,''),'') source,
          COALESCE(st.name,d.stage) stage_name,COALESCE(p.name,'') pipeline_name,u.name current_responsible
        FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id
        LEFT JOIN stages st ON st.pipeline_id=d.pipeline_id AND st.code=d.stage
        LEFT JOIN pipelines p ON p.id=d.pipeline_id LEFT JOIN users u ON u.id=d.responsible_id WHERE d.id=?`).get(dealId);
      if (!deal) return json(res, 404, { error: 'Сделка не найдена — обновите список' });
      const dbTitle=String(deal.title||'').trim();
      if(!dbTitle)return json(res,400,{error:'У сделки нет названия — сначала заполните карточку'});
      let id;
      db.exec('BEGIN IMMEDIATE');
      try{
        const result=db.prepare(`INSERT INTO quality_reviews
          (deal_id,deal_title,contact_id,contact_name,responsible_id,responsible_name,pipeline_id,pipeline_name,stage,stage_name,source,
           demo,reviewer_id,reviewer_name,updated_by_id,updated_by_name)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          deal.id,dbTitle.slice(0,300),Number(deal.contact_id)||null,String(deal.contact_name||'').slice(0,200),
          deal.responsible_id||null,String(deal.current_responsible||deal.responsible||'').slice(0,200),Number(deal.pipeline_id)||1,
          String(deal.pipeline_name||'').slice(0,120),String(deal.stage||'').slice(0,40),String(deal.stage_name||'').slice(0,120),
          String(deal.source||'').slice(0,60),Number(deal.demo)===1?1:0,user.id,user.name,user.id,user.name);
        id=Number(result.lastInsertRowid);
        const addCore=db.prepare('INSERT INTO quality_review_items(review_id,criterion_key) VALUES(?,?)');
        const addGrowth=db.prepare('INSERT INTO quality_review_growth_items(review_id,criterion_key) VALUES(?,?)');
        const addFact=db.prepare('INSERT INTO quality_review_facts(review_id,fact_key) VALUES(?,?)');
        for(const c of QUALITY_CRITERIA)addCore.run(id,c.key);
        for(const c of QUALITY_GROWTH_CRITERIA)addGrowth.run(id,c.key);
        for(const key of QUALITY_FACT_KEYS)addFact.run(id,key);
        db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
      return json(res,201,{id,status:'draft'});
    }
    const mReview=p.match(/^\/api\/quality\/reviews\/(\d+)$/);
    if(mReview){
      const id=Number(mReview[1]);
      const review=db.prepare('SELECT * FROM quality_reviews WHERE id=?').get(id);
      if(!review)return json(res,404,{error:'Проверка ОКК не найдена'});
      const isAdmin=user.role==='admin';
      const mayReadOwnReview=user.role==='manager'&&req.method==='GET'&&review.status==='complete'&&Number(review.responsible_id)===Number(user.id);
      const mayReadTeamReview=user.role==='rop'&&req.method==='GET'&&review.status!=='draft'&&!!user.team_id
        && !!db.prepare('SELECT 1 x FROM users WHERE id=? AND team_id=?').get(Number(review.responsible_id),Number(user.team_id));
      if(!isAdmin&&!mayReadOwnReview&&!mayReadTeamReview)return json(res,403,{error:'Доступны только ваши завершённые проверки'});
      if(req.method==='GET'){
        const items=db.prepare('SELECT * FROM quality_review_items WHERE review_id=? ORDER BY id').all(id);
        const growthItems=db.prepare('SELECT * FROM quality_review_growth_items WHERE review_id=? ORDER BY id').all(id);
        const facts=db.prepare('SELECT * FROM quality_review_facts WHERE review_id=? ORDER BY fact_key').all(id);
        const {messages,truncated}=isAdmin?qMessageRows(review,500):{messages:[],truncated:false};
        const crmContext=isAdmin?qDealContext(review):null;
        const sla=isAdmin?qFirstReplyInfo(messages,review,truncated,crmContext):null;
        const safeReview=isAdmin?review:{...review,contact_id:null,reviewer_id:null,updated_by_id:null};
        return json(res,200,{review:qReviewShape(safeReview,items,growthItems,facts),criteria:QUALITY_CRITERIA,items,
          growthCriteria:QUALITY_GROWTH_CRITERIA,growthItems,facts:qFactObject(facts),messages,messageHistoryTruncated:truncated,
          firstReply:sla,crmContext,sampleRules:QUALITY_SAMPLE_RULE_LABELS});
      }
      if(!isAdmin)return json(res,403,{error:'Редактировать проверки может только руководитель'});
      if(req.method==='DELETE'){
        if(review.status!=='draft')return json(res,409,{error:'Завершённая проверка сохраняется в истории и не удаляется. Для нового разбора создайте новую проверку.'});
        db.prepare("DELETE FROM quality_reviews WHERE id=? AND status='draft'").run(id);
        return json(res,200,{deleted:true});
      }
      if(req.method==='PUT'){
        if(review.status!=='draft')return json(res,409,{error:'Завершённую проверку нельзя переписать. Создайте новую, чтобы сохранить историю.'});
        const b=await readBody(req);
        const targetStatus=String(b.status||'draft');
        if(!['draft','complete','no_contact','unavailable'].includes(targetStatus))return json(res,400,{error:'Неизвестный результат проверки'});
        const dataStatus=String(b.data_status||'partial');
        if(!['complete','partial','unavailable'].includes(dataStatus))return json(res,400,{error:'Выберите полноту доступной истории'});
        const interactionType=String(b.interaction_type||'unknown');
        if(!['unknown','call','chat','mixed','other'].includes(interactionType))return json(res,400,{error:'Выберите тип контакта'});
        const day=raw=>{
          const value=String(raw||'').trim();if(!value)return'';if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
          const date=new Date(value+'T00:00:00Z');return Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==value?null:value;
        };
        const periodStart=day(b.period_start),periodEnd=day(b.period_end);
        if(periodStart===null||periodEnd===null)return json(res,400,{error:'Укажите дату в формате календаря'});
        if(periodStart&&periodEnd&&periodStart>periodEnd)return json(res,400,{error:'Начало периода позже его окончания'});
        if(targetStatus!=='draft'&&(!periodStart||!periodEnd))return json(res,400,{error:'Для сохранённого результата укажите начало и конец выбранного периода'});
        const text=(value,limit,label)=>{const v=String(value||'').trim();return v.length>limit?{error:`${label}: максимум ${limit} знаков`}:{value:v};};
        const notes=text(b.data_notes,1200,'Комментарий о доступности данных');
        const summaryText=text(b.summary,2000,'Сильные стороны');
        const crmText=text(b.crm_observation,2000,'Проверка CRM');
        const sampleNote=text(b.sample_note,500,'Пояснение к выборке');
        const abandonedEvidence=text(b.abandoned_card_evidence,1200,'Подтверждение заброшенной карточки');
        if(notes.error||summaryText.error||crmText.error||sampleNote.error||abandonedEvidence.error)return json(res,400,{error:notes.error||summaryText.error||crmText.error||sampleNote.error||abandonedEvidence.error});
        const sampleRule=String(b.sample_rule||'');
        if(sampleRule&&!QUALITY_SAMPLE_RULES.has(sampleRule))return json(res,400,{error:'Выберите допустимое основание выборки'});
        const abandonedCard=Boolean(b.abandoned_card)?1:0;
        const lineList=(value,label)=>{if(!Array.isArray(value))return{error:`${label}: передайте список строк`};const out=value.map(x=>String(x||'').trim()).filter(Boolean);if(out.length>3)return{error:`${label}: не больше трёх пунктов`};if(out.some(x=>x.length>500))return{error:`${label}: один пункт не длиннее 500 знаков`};return{value:out};};
        const issues=lineList(b.issues??[],'Проблемы'),nextSteps=lineList(b.next_steps??[],'Следующие шаги');
        if(issues.error||nextSteps.error)return json(res,400,{error:issues.error||nextSteps.error});
        const validTimestamp=value=>{
          const v=String(value||'').trim();if(!v)return false;
          const pattern=/^(?:\d{1,2}:)?[0-5]?\d:[0-5]\d(?:\s*[–-]\s*(?:\d{1,2}:)?[0-5]?\d:[0-5]\d)?$/;
          if(!pattern.test(v))return false;
          const parse=t=>{const p=t.trim().split(':').map(Number);return p.length===3?p[0]*3600+p[1]*60+p[2]:p[0]*60+p[1];};
          const parts=v.split(/[–-]/);return parts.length===1||parse(parts[0])<=parse(parts[1]);
        };
        const normalizeEvidenceList=(input,expected,criteria,tableLabel)=>{
          if(!Array.isArray(input))return{error:`${tableLabel}: передайте список критериев`};
          const seen=new Set(),out=[];
          for(const raw of input){
            if(!raw||typeof raw!=='object'||Array.isArray(raw))return{error:`${tableLabel}: пункт заполнен неверно`};
            const key=String(raw.key||'');if(!expected.has(key)||seen.has(key))return{error:`${tableLabel}: неизвестный или повторный критерий`};seen.add(key);
            const status=String(raw.status||'');if(!QUALITY_ITEM_STATUSES.has(status))return{error:'Выберите допустимый статус критерия'};
            const evidenceSource=String(raw.evidence_source||'');if(evidenceSource&&!QUALITY_SOURCES.has(evidenceSource))return{error:'Выберите допустимый источник подтверждения'};
            const confidence=String(raw.evidence_confidence||'');if(!QUALITY_CONFIDENCE.has(confidence))return{error:'Выберите допустимую уверенность в источнике'};
            const timestamp=String(raw.evidence_timestamp||'').trim().slice(0,40);
            const speaker=String(raw.evidence_speaker||'');if(!['','manager','client','both','unknown'].includes(speaker))return{error:'Укажите допустимого автора фрагмента'};
            const evidenceText=String(raw.evidence_text||'').trim();if(evidenceText.length>1200)return{error:'Подтверждение одного критерия не длиннее 1200 знаков'};
            const messageId=raw.message_id===''||raw.message_id==null?null:Number(raw.message_id);
            if(messageId!==null&&(!Number.isSafeInteger(messageId)||messageId<1))return{error:'Ссылка на сообщение некорректна'};
            const title=criteria.find(c=>c.key===key)?.title||'критерия';
            if(targetStatus==='complete'){
              if(!status)return{error:`Не заполнен критерий «${title}»`};
              if(evidenceText.length<8)return{error:`Добавьте подтверждение или причину (не меньше 8 знаков) для критерия «${title}»`};
              if(!evidenceSource)return{error:`Укажите источник для критерия «${title}»`};
              if(!confidence)return{error:`Укажите уверенность в источнике для критерия «${title}»`};
              if(['yes','no','na'].includes(status)&&confidence!=='verified')return{error:`Для вывода «${title}» сначала вручную проверьте источник. При сомнении выберите «данных недостаточно».`};
              if(['yes','no'].includes(status)&&confidence==='low')return{error:`Низкая уверенность не может подтверждать «да» или «нет» по критерию «${title}»`};
              if(evidenceSource==='recording'&&['yes','no'].includes(status)){
                if(!validTimestamp(timestamp))return{error:`Укажите проверенный таймкод записи для критерия «${title}» (например, 00:15–00:32)`};
                if(!['manager','client','both'].includes(speaker))return{error:`Укажите, кто говорит в проверенном фрагменте «${title}»`};
              }
            }
            if(targetStatus==='complete'&&['message','recording'].includes(evidenceSource)&&!messageId)
              return{error:`Для источника «${evidenceSource==='recording'?'запись звонка':'переписка'}» выберите конкретное сообщение из истории`};
            if(messageId){
              const linked=db.prepare(`SELECT m.id,m.direction,m.channel,m.content_uri,m.content_name,m.content_type,m.created_at,m.event_at,m.event_time_source
                FROM messages m JOIN conversations cv ON cv.id=m.conversation_id WHERE m.id=? AND cv.contact_id=?`).get(messageId,review.contact_id||0);
              if(!linked)return{error:'Доказательство должно относиться к истории контакта выбранной сделки'};
              if(!['message','recording'].includes(evidenceSource))return{error:'Для связанного сообщения выберите источник «Переписка» или «Запись звонка»'};
              const messageDay=qLocalMessageDay(linked.event_at||linked.created_at);
              if(targetStatus==='complete'&&(messageDay<periodStart||messageDay>periodEnd))return{error:'Источник сообщения находится за пределами проверяемого периода'};
              if(evidenceSource==='recording'&&!qIsAudioMessage(linked))return{error:'Для источника «Запись звонка» выберите аудиозапись, доступную в истории контакта'};
              if(evidenceSource==='message'&&qIsAudioMessage(linked)&&['yes','no'].includes(status))return{error:'Для аудиозаписи выберите источник «Запись звонка» и укажите проверенный таймкод'};
              if(evidenceSource==='recording'&&timestamp&&!validTimestamp(timestamp))return{error:`Таймкод записи для критерия «${title}» задан неверно`};
            }
            out.push({key,status,evidenceSource,messageId,evidenceText,timestamp,speaker,confidence});
          }
          if(targetStatus==='complete'&&seen.size!==expected.size)return{error:`Проверьте все ${expected.size} пункта раздела «${tableLabel}»`};
          return{value:out};
        };
        const inputItems=b.items??[],inputGrowth=b.growth_items??[];
        const normalized=normalizeEvidenceList(inputItems,QUALITY_KEYS,QUALITY_CRITERIA,'18 критериев ОКК');
        if(normalized.error)return json(res,400,{error:normalized.error});
        const normalizedGrowth=normalizeEvidenceList(inputGrowth,QUALITY_GROWTH_KEYS,QUALITY_GROWTH_CRITERIA,'развивающих наблюдений');
        if(normalizedGrowth.error)return json(res,400,{error:normalizedGrowth.error});
        const factsInput=b.facts&&typeof b.facts==='object'&&!Array.isArray(b.facts)?b.facts:{};
        const normalizedFacts=[];
        for(const key of QUALITY_FACT_KEYS){
          const entry=factsInput[key]&&typeof factsInput[key]==='object'?factsInput[key]:{};
          const heard=String(entry.heard_status||''),crm=String(entry.crm_status||'');
          if(!QUALITY_ITEM_STATUSES.has(heard)||!QUALITY_ITEM_STATUSES.has(crm))return json(res,400,{error:`Проверьте статусы факта «${QUALITY_FACT_LABELS[key]}»`});
          if(targetStatus==='complete'&&(!heard||!crm))return json(res,400,{error:`Отметьте факт «${QUALITY_FACT_LABELS[key]}» в разговоре и CRM. Если данных нет, выберите соответствующий статус.`});
          normalizedFacts.push({key,heard,crm});
        }
        if(targetStatus!=='draft'&&(!sampleRule||(sampleRule==='other'&&sampleNote.value.length<8)))return json(res,400,{error:'Укажите правило выбора сделки; для «Другое» добавьте пояснение'});
        if(targetStatus==='complete'&&abandonedCard&&abandonedEvidence.value.length<10)return json(res,400,{error:'Подтвердите факт заброшенной карточки (не меньше 10 знаков)'});
        if(targetStatus==='complete'&&!['complete','partial'].includes(dataStatus))return json(res,400,{error:'Для завершённой оценки выберите полную или частичную историю'});
        if((targetStatus==='no_contact'||targetStatus==='unavailable')&&notes.value.length<10)return json(res,400,{error:'Кратко объясните, почему контакт не состоялся или данные недоступны (не меньше 10 знаков)'});
        if((targetStatus==='no_contact'||targetStatus==='unavailable')&&[...inputItems,...inputGrowth].some(x=>String(x?.status||'')))return json(res,400,{error:'Для отдельного статуса без оценки очистите баллы и сохраните черновик перед завершением'});
        const isUnscored=['no_contact','unavailable'].includes(targetStatus);
        const finalDataStatus=isUnscored?'unavailable':dataStatus;
        const finalInteraction=isUnscored?'unknown':interactionType;
        const finalSummary=isUnscored?'':summaryText.value;
        const finalIssues=isUnscored?[]:issues.value;
        const finalNextSteps=isUnscored?[]:nextSteps.value;
        const finalCrmText=isUnscored?'':crmText.value;
        const finalAbandonedCard=!isUnscored&&abandonedCard?1:0;
        const finalAbandonedEvidence=finalAbandonedCard?abandonedEvidence.value:'';
        const completedAt=targetStatus==='draft'?'':new Date().toISOString().slice(0,19).replace('T',' ');
        db.exec('BEGIN IMMEDIATE');
        try{
          const result=db.prepare(`UPDATE quality_reviews SET status=?,data_status=?,interaction_type=?,period_start=?,period_end=?,
            data_notes=?,summary=?,issues=?,next_steps=?,crm_observation=?,sample_rule=?,sample_note=?,abandoned_card=?,abandoned_card_evidence=?,
            updated_by_id=?,updated_by_name=?,updated_at=datetime('now'),completed_at=?
            WHERE id=? AND status='draft'`).run(
            targetStatus,finalDataStatus,finalInteraction,periodStart||'',periodEnd||'',notes.value,finalSummary,JSON.stringify(finalIssues),
            JSON.stringify(finalNextSteps),finalCrmText,sampleRule,sampleNote.value,finalAbandonedCard,finalAbandonedEvidence,
            user.id,user.name,completedAt,id);
          if(!result.changes)throw Object.assign(new Error('Проверку уже изменил другой руководитель — обновите страницу'),{statusCode:409});
          const updateCore=db.prepare(`UPDATE quality_review_items SET status=?,evidence_source=?,message_id=?,evidence_text=?,evidence_timestamp=?,evidence_speaker=?,evidence_confidence=?
            WHERE review_id=? AND criterion_key=?`);
          for(const item of normalized.value)updateCore.run(item.status,item.evidenceSource,item.messageId,item.evidenceText,item.timestamp,item.speaker,item.confidence,id,item.key);
          const updateGrowth=db.prepare(`UPDATE quality_review_growth_items SET status=?,evidence_source=?,message_id=?,evidence_text=?,evidence_timestamp=?,evidence_speaker=?,evidence_confidence=?
            WHERE review_id=? AND criterion_key=?`);
          for(const item of normalizedGrowth.value)updateGrowth.run(item.status,item.evidenceSource,item.messageId,item.evidenceText,item.timestamp,item.speaker,item.confidence,id,item.key);
          const updateFact=db.prepare('UPDATE quality_review_facts SET heard_status=?,crm_status=? WHERE review_id=? AND fact_key=?');
          for(const fact of normalizedFacts)updateFact.run(fact.heard,fact.crm,id,fact.key);
          if(targetStatus==='no_contact'||targetStatus==='unavailable'){
            db.prepare(`UPDATE quality_review_items SET status='',evidence_source='',message_id=NULL,evidence_text='',evidence_timestamp='',evidence_speaker='',evidence_confidence='' WHERE review_id=?`).run(id);
            db.prepare(`UPDATE quality_review_growth_items SET status='',evidence_source='',message_id=NULL,evidence_text='',evidence_timestamp='',evidence_speaker='',evidence_confidence='' WHERE review_id=?`).run(id);
            db.prepare("UPDATE quality_review_facts SET heard_status='',crm_status='' WHERE review_id=?").run(id);
          }
          db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');throw e;}
        const saved=db.prepare('SELECT * FROM quality_reviews WHERE id=?').get(id);
        const savedItems=db.prepare('SELECT * FROM quality_review_items WHERE review_id=? ORDER BY id').all(id);
        const savedGrowth=db.prepare('SELECT * FROM quality_review_growth_items WHERE review_id=? ORDER BY id').all(id);
        const savedFacts=db.prepare('SELECT * FROM quality_review_facts WHERE review_id=? ORDER BY fact_key').all(id);
        return json(res,200,{review:qReviewShape(saved,savedItems,savedGrowth,savedFacts),saved:true});
      }
    }
    if (p === '/api/quality') {
      if (!['admin', 'rop'].includes(user.role)) return json(res, 403, { error: 'Показатели качества видят руководитель и администратор' });
      if (user.role === 'rop' && !user.team_id) return json(res, 403, { error: 'Руководителю сначала назначают команду.' });
      const days = Math.min(365, Math.max(1, Math.trunc(Number(u.searchParams.get('days')) || 30)));
      // История переписки — за выбранный период. Задачи и сделки без движения —
      // текущая очередь, поэтому не включаем их в искусственную оценку сотрудника.
      const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 19).replace('T', ' ');
      const managers = user.role === 'rop'
        ? db.prepare("SELECT id,name FROM users WHERE active=1 AND role IN ('admin','manager') AND team_id=? ORDER BY id").all(Number(user.team_id))
        : db.prepare("SELECT id,name FROM users WHERE active=1 AND role IN ('admin','manager') ORDER BY id").all();
      // Один запрос на сотрудника; автоматические исходящие (правила и рассылки)
      // не считаются ответом живого менеджера.
      const convMsgQ = db.prepare(`SELECT cv.id AS cid,m.id AS mid,m.direction,m.created_at,m.event_at,m.event_time_source,
          CASE WHEN m.event_time_source IN ('provider','crm') AND m.event_at IS NOT NULL THEN m.event_at ELSE m.created_at END event_time,
          CASE WHEN m.event_time_source IN ('provider','crm') AND m.event_at IS NOT NULL THEN 1 ELSE 0 END event_time_known
        FROM conversations cv JOIN contacts c ON c.id=cv.contact_id
        JOIN messages m ON m.conversation_id=cv.id
        WHERE datetime(CASE WHEN m.event_time_source IN ('provider','crm') AND m.event_at IS NOT NULL THEN m.event_at ELSE m.created_at END)>=?
          AND (c.responsible_id=? OR EXISTS(SELECT 1 FROM deals d WHERE d.contact_id=cv.contact_id AND d.responsible_id=?))
          AND (m.direction='in' OR (COALESCE(m.automation_id,0)=0 AND lower(trim(COALESCE(m.author,''))) NOT IN ('рассылка','автоматизация')))
        ORDER BY cv.id,event_time,m.id`);
      const median = arr => { if (!arr.length) return null; const mid = Math.floor(arr.length / 2); return arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2); };
      const allResponseTimes = new Map();
      const rows = managers.map(m => {
        const deals = db.prepare('SELECT id,stage,deal_object,land_status,construction_date,payment_type,lead_source FROM deals WHERE responsible_id=?').all(m.id);
        const won = deals.filter(d => d.stage === 'won').length, lost = deals.filter(d => d.stage === 'lost').length;
        // Автоматическая оценка по данным CRM: карточка заполнена по фактам
        // (все шесть полей квалификации не «не выяснено») и у сделки есть
        // открытая задача на следующий контакт. Содержание разговора
        // автоматически не оценивается — для него остаётся ручная проверка.
        const qualified = deals.filter(d => String(d.deal_object || '').trim() && String(d.deal_object) !== 'Не уточнён'
          && !['', 'unknown'].includes(String(d.land_status || '')) && !['', 'unknown'].includes(String(d.construction_date || ''))
          && !['', 'unknown'].includes(String(d.payment_type || '')) && String(d.lead_source || '').trim() && String(d.lead_source) !== 'unknown').length;
        const withOpenTask = deals.filter(d => db.prepare('SELECT 1 x FROM tasks WHERE deal_id=? AND done=0 LIMIT 1').get(d.id)).length;
        let unansweredDialogs = 0; const responseTimes = [];
        let curCid = null, pendingIn = null;
        for (const msg of convMsgQ.all(since,m.id,m.id)) {
          if (msg.cid !== curCid) { curCid=msg.cid; pendingIn=null; }
          if (msg.direction === 'in') {
            if (!pendingIn) { pendingIn={id:Number(msg.mid),time:msg.event_time,known:Number(msg.event_time_known)===1}; unansweredDialogs++; }
          } else if (pendingIn) {
            const incomingAt=Date.parse(String(pendingIn.time||'').replace(' ','T')+'Z');
            const replyAt=Date.parse(String(msg.event_time||'').replace(' ','T')+'Z');
            const elapsed=(replyAt-incomingAt)/60000;
            if(pendingIn.known&&Number(msg.event_time_known)===1&&Number.isFinite(elapsed)&&elapsed>=0){
              responseTimes.push(elapsed);
              allResponseTimes.set(`${msg.cid}:${pendingIn.id}:${Number(msg.mid)}`,elapsed);
            }
            pendingIn=null; unansweredDialogs--;
          }
        }
        unansweredDialogs = Math.max(0,unansweredDialogs);
        responseTimes.sort((a,b)=>a-b);
        const medianResponseMin = median(responseTimes.map(x=>Math.round(x)));
        const stalled = db.prepare("SELECT COUNT(*) n FROM deals WHERE responsible_id=? AND stage NOT IN ('won','lost') AND COALESCE(updated_at,created_at)<datetime('now','-14 days')").get(m.id).n;
        const overdueTasks = db.prepare("SELECT COUNT(*) n FROM tasks WHERE done=0 AND due IS NOT NULL AND due!='' AND (CASE WHEN length(due)=10 THEN due||' 23:59:59' ELSE due END)<datetime('now','localtime') AND (responsible_id=? OR EXISTS(SELECT 1 FROM deals d WHERE d.id=tasks.deal_id AND d.responsible_id=?))").get(m.id,m.id).n;
        const closed = won + lost;
        return { id:m.id,name:m.name,deals:deals.length,won,lost,conversion:closed?Math.round(won*100/closed):null,
          unansweredDialogs,medianResponseMin,responseTimeSamples:responseTimes.length,stalled,overdueTasks,qualified,withOpenTask };
      });
      const medians = [...allResponseTimes.values()].map(x=>Math.round(x)).sort((a,b)=>a-b);
      return json(res,200,{
        days,
        totals:{managers:rows.length,unansweredDialogs:rows.reduce((a,r)=>a+r.unansweredDialogs,0),stalled:rows.reduce((a,r)=>a+r.stalled,0),
          overdueTasks:rows.reduce((a,r)=>a+r.overdueTasks,0),medianResponseMin:median(medians),responseTimeSamples:medians.length,
          qualified:rows.reduce((a,r)=>a+Number(r.qualified||0),0),withOpenTask:rows.reduce((a,r)=>a+Number(r.withOpenTask||0),0)},
        managers:rows,
        definitions:[
          'Диалоги с вопросом клиента без следующего ответа живого сотрудника за выбранный период. Для фильтра периода используется время события, если оно сохранено, иначе время записи в CRM; автоответы и рассылки не закрывают ожидание.',
          'Медиана ответа считается только для пар с отметками времени канала Wazzup или CRM; без достоверной отметки пара не попадает в медиану. Автоответы и рассылки не закрывают ожидание.',
          'Открытые сделки, у которых нет движения больше 14 дней (снимок текущей очереди).',
          'Открытые задачи, срок которых уже прошёл (снимок текущей очереди).',
          'Конверсия — выигранные среди закрытых сделок; числитель и знаменатель видны в строке сотрудника.',
          'Автоматическая оценка считается только по данным CRM: заполненность карточки по шести полям квалификации и наличие открытой задачи. Содержание разговора автоматически не оценивается — для него остаётся ручная проверка ОКК с доказательствами.',
        ],
        note:'Автоматическая оценка — это объективные сигналы из CRM (ответ, заполненность, задачи, конверсия). Содержание разговора оценивается отдельно в ручной проверке ОКК с подтверждениями; автоматический общий балл и санкции не применяются.',
      });
    }
    if (p === '/api/pipelines') {
      if (req.method === 'GET') {
        // счётчики сделок нужны вкладке «Воронки», где видно, можно ли удалить
        // воронку. Отдаём их только администратору: партнёру объём чужих
        // воронок не предназначен, а список воронок ему нужен для его доски
        const st = u.searchParams.get('stats') === '1' && user.role === 'admin'
          ? new Map(db.prepare(`SELECT COALESCE(pipeline_id,1) id, COUNT(*) total,
              COALESCE(SUM(COALESCE(stage,'') NOT IN ('won','lost')),0) open
              FROM deals GROUP BY COALESCE(pipeline_id,1)`).all().map(r => [Number(r.id), r]))
          : null;
        if(user.role==='partner'){
          const pid=partnerPipelineId();
          if(!pid||!partnerAllowedStages().size)return json(res,200,[]);
          const pipeline=db.prepare('SELECT * FROM pipelines WHERE id=?').get(pid);
          return json(res,200,pipeline?[{...pipeline,stages:getStages(pid).filter(stage=>partnerAllowedStages().has(String(stage.code)))}]:[]);
        }
        return json(res, 200, db.prepare('SELECT * FROM pipelines ORDER BY id').all().map(pl => {
          const c = st && st.get(Number(pl.id));
          return { ...pl, stages: getStages(pl.id), ...(c ? { deals_total: Number(c.total), deals_open: Number(c.open) } : {}) };
        }));
      }
      if (req.method === 'POST') {
        if (!requireAdmin(user, res)) return;
        const b = await readBody(req), name = String(b.name || 'Новая воронка').trim().slice(0,80) || 'Новая воронка';
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = db.prepare('INSERT INTO pipelines(name) VALUES(?)').run(name);
          const add = db.prepare('INSERT INTO stages(pipeline_id,code,name,color,sort,kind) VALUES(?,?,?,?,?,?)');
          [['new','Неразобранное','#f97316',0,'open'],['deferred','Отложенный спрос','#0284c7',1,'open'],
            ['won','Успешно реализовано','#15803d',2,'won'],['lost','Закрыто и не реализовано','#78716c',3,'lost']]
            .forEach(stage => add.run(result.lastInsertRowid,...stage));
          db.exec('COMMIT');
          return json(res, 201, { id: Number(result.lastInsertRowid) });
        } catch (e) { db.exec('ROLLBACK'); throw e }
      }
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
      // коды won и lost зарезервированы системой: по ним считаются выручка,
      // конверсия и закрытие сделок, а кнопки «Успех» и «Отказ» на доске
      // переносят карточку именно в них. Названия и цвета можно менять как угодно.
      if (!clean.some(x => x.code === 'won') || !clean.some(x => x.code === 'lost'))
        return json(res, 400, { error: 'В воронке нужны этап успеха и этап отказа: на них закрываются сделки и по ним считается выручка. Переименуйте их как удобно, но удалять нельзя.' });
      const deferred = clean.find(x => x.code === 'deferred');
      if (!deferred) return json(res,400,{error:'Этап «Отложенный спрос» нужен в каждой воронке и не может быть удалён.'});
      deferred.name = 'Отложенный спрос'; deferred.color = '#0284c7'; deferred.kind = 'open';
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
      logActivity('Воронка и этапы обновлены', 'pipelines', pid, user.name);
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
      // доска показывает сделки только выбранной воронки: коды этапов в разных
      // воронках совпадают ('new', 'won'), и без фильтра чужие сделки вставали
      // бы в колонки этой доски, а счётчики считали бы лишнее
      if (req.method === 'GET') {
        const pid = user.role==='partner' ? partnerPipelineId() : Number(u.searchParams.get('pipeline') || 1);
        // фильтр по воронке включается только явным параметром (доска сделок);
        // карточки клиента и компании просят сделки без параметра — там нужен
        // список по всем воронкам
        const conds = [], params = [];
        if (user.role==='partner'||u.searchParams.has('pipeline')) { conds.push('COALESCE(d.pipeline_id,1)=?'); params.push(pid); }
        // карточке клиента и карточке компании нужны только их сделки: без
        // фильтра сервер отдавал бы весь список, а клиент отбирал бы на месте
        const byContact = Number(u.searchParams.get('contact_id') || 0);
        if (byContact) { conds.push('d.contact_id=?'); params.push(byContact); }
        const byCompany = Number(u.searchParams.get('company_id') || 0);
        // сделка компании — и та, что заведена на её сотрудника: иначе работа
        // по компании разваливалась на два списка в карточке и в форме
        if (byCompany) { conds.push('(d.company_id=? OR d.contact_id IN (SELECT id FROM contacts WHERE company_id=?))'); params.push(byCompany, byCompany); }
        // Партнёрский доступ привязан к активной передаче, не к ответственному.
        if (user.role === 'partner') { conds.push("EXISTS(SELECT 1 FROM partner_transfers pt WHERE pt.deal_id=d.id AND pt.partner_id=? AND pt.active=1)"); params.push(Number(user.id)); }
        const manager = user.role === 'manager';
        if (manager) { conds.push(managerDealScopeSql('d')); params.push(...managerDealParams(user)); }
        const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';
        const taskScope = manager ? ` AND ${managerTaskScopeSql('t')}` : '';
        const taskParams = manager ? [...managerTaskParams(user), ...managerTaskParams(user)] : [];
        const rows = db.prepare('SELECT d.*,c.name contact_name,c.phone contact_phone,co.name company_name,' +
          '(SELECT COUNT(*) FROM tasks t WHERE t.deal_id=d.id AND t.done=0' + taskScope + ') as tasks_open,' +
          '(SELECT MIN(t.due) FROM tasks t WHERE t.deal_id=d.id AND t.done=0' + taskScope + ') as next_task_due ' +
          'FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id LEFT JOIN companies co ON co.id=d.company_id' + where + ' ORDER BY d.id DESC')
          .all(...taskParams, ...params);
        const visibleDeals=user.role==='partner'?rows.filter(d=>partnerTransferForDeal(user,d.id)).map(partnerDealView):rows;
        if(user.role==='partner')logAccess(user,'deal_list','deals','',req.method);
        const pipelines=user.role==='partner'
          ? (pid&&partnerAllowedStages().size&&db.prepare('SELECT 1 x FROM pipelines WHERE id=?').get(pid)?db.prepare('SELECT * FROM pipelines WHERE id=?').all(pid):[])
          : db.prepare('SELECT * FROM pipelines').all();
        const stages=user.role==='partner'?getStages(pid).filter(stage=>partnerAllowedStages().has(String(stage.code))):getStages(pid);
        return json(res, 200, { pipelines, stages, deals: visibleDeals });
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (!String(b.title || '').trim()) return json(res, 400, { error: 'Укажите название сделки' });
        b.title = String(b.title).trim().slice(0, 200);
        const pipelineId = Number(b.pipeline_id) || 1;
        if (!db.prepare('SELECT 1 x FROM pipelines WHERE id=?').get(pipelineId)) return json(res, 400, { error: 'Воронка не найдена — обновите страницу и выберите другую' });
        const stageList = getStages(pipelineId);
        const stage = b.stage ? String(b.stage) : (stageList[0]?.code || 'new');
        if (!stageList.some(x => x.code === stage)) return json(res, 400, { error: 'Этап не найден в выбранной воронке — обновите страницу' });
        b.pipeline_id = pipelineId; b.stage = stage;
        b.contact_id = b.contact_id ? Number(b.contact_id) : null;
        b.company_id = b.company_id ? Number(b.company_id) : null;
        if (b.contact_id !== null && (!Number.isInteger(b.contact_id) || b.contact_id <= 0)) return json(res, 400, { error: 'Некорректный клиент — выберите контакт из списка' });
        if (b.company_id !== null && (!Number.isInteger(b.company_id) || b.company_id <= 0)) return json(res, 400, { error: 'Некорректная компания — выберите из списка' });
        const contact = b.contact_id ? db.prepare('SELECT * FROM contacts WHERE id=?').get(b.contact_id) : null;
        if (b.contact_id && !contact) return json(res, 400, { error: 'Клиент не найден — выберите контакт из списка' });
        if (b.company_id && !db.prepare('SELECT 1 x FROM companies WHERE id=?').get(b.company_id)) return json(res, 400, { error: 'Компания не найдена — обновите страницу и выберите из списка' });
        if (b.responsible_id !== undefined && b.responsible_id !== null && b.responsible_id !== '' && !db.prepare('SELECT 1 x FROM users WHERE id=?').get(b.responsible_id)) return json(res, 400, { error: 'Ответственный не найден — обновите страницу и выберите сотрудника' });
        let claimContact = false;
        if (user.role === 'manager') {
          if (b.responsible_id && Number(b.responsible_id) !== Number(user.id)) return json(res, 403, { error: 'Менеджер создаёт лид только на себя. Передачу другому сотруднику выполняет администратор.' });
          b.responsible_id = user.id;
          if (contact) {
            if (contact.responsible_id && Number(contact.responsible_id) !== Number(user.id)) return json(res, 403, { error: 'Клиент закреплён за другим сотрудником. Попросите администратора передать карточку.' });
            const conflict = db.prepare(`SELECT 1 x FROM deals d JOIN users u ON u.id=d.responsible_id
              WHERE d.contact_id=? AND u.role='manager' AND d.responsible_id<>? LIMIT 1`).get(contact.id, user.id);
            if (!contact.responsible_id && conflict) return json(res, 403, { error: 'У клиента уже есть сделка другого менеджера. Попросите администратора назначить ответственного.' });
            claimContact = !contact.responsible_id;
          }
        }
        if (user.role === 'partner') b.responsible_id = user.id; // партнёр создаёт лид только себе
        if (user.role === 'manager' && b.company_id && !managerOwns(user,'companies',b.company_id))
          return json(res,403,{error:'Компания не входит в ваши карточки. Попросите администратора назначить её вам.'});
        const required = normalizeDealRequirements(b);
        if (required.error) return json(res, 400, { error: required.error });
        Object.assign(b, required.value);
        normalizeResponsible(b);
        { const err = missingRequiredCustom('deals', b.custom); if (err) return json(res, 400, { error: err }); }
        clampTexts(b);
        // сделку можно завести сразу закрытой («продали давно»). Дата закрытия нужна
        // аналитике: без неё выручка привязалась бы к дате создания, а не к продаже.
        if (['won', 'lost'].includes(stage)) b.closed_at = normalizeStamp(b.closed_at) || new Date().toISOString().slice(0, 19).replace('T', ' ');
        else delete b.closed_at;
        const fields = ['title','amount','deal_object','land_status','construction_date','payment_type','lead_source','stage','pipeline_id','contact_id','company_id','responsible','responsible_id','priority','loss_reason','deadline','closed_at','custom'];
        const ks = fields.filter(f => b[f] !== undefined);
        let r;
        db.exec('BEGIN IMMEDIATE');
        try {
          if (claimContact) db.prepare('UPDATE contacts SET responsible_id=? WHERE id=? AND responsible_id IS NULL').run(user.id, contact.id);
          r = db.prepare(`INSERT INTO deals(${ks}) VALUES(${ks.map(() => '?')})`).run(...ks.map(k => b[k]));
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e }
        logActivity(`Сделка создана: ${b.title}`, 'deals', Number(r.lastInsertRowid), user.name);
        runAutomations('deal_created', { deal_id: Number(r.lastInsertRowid), contact_id: b.contact_id });
        broadcast('change', { table: 'deals' });
        return json(res, 201, db.prepare('SELECT * FROM deals WHERE id=?').get(r.lastInsertRowid));
      }
    }
    // ===== печать документов по сделке: коммерческое предложение или счёт =====
    if (/^\/api\/deals\/\d+\/print$/.test(p) && req.method === 'GET') {
      const id = Number(p.split('/')[3]);
      const deal = db.prepare('SELECT d.*,c.name contact_name,c.phone contact_phone,c.email contact_email,co.name company_name FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id LEFT JOIN companies co ON co.id=d.company_id WHERE d.id=?').get(id);
      if (!deal) return json(res, 404, { error: 'Сделка не найдена' });
      if (user.role === 'partner' && !partnerOwns(user,'deals',id)) return json(res, 403, { error: 'Это чужая сделка: партнёр печатает документы только по активной передаче' });
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
      if (user.role === 'partner' && !partnerOwns(user,'deals',id)) return json(res, 403, { error: 'Это чужая сделка: партнёр отправляет документы только по активной передаче' });
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
      const text = `${String(b.body || '').trim().slice(0, 20000) || `${deal.contact_name || 'Добрый день'}!`}

${kind} по заявке «${deal.title}» на сумму ${money(sum, company.currency)} — по ссылке:
${link}

Ссылка действует ${DOC_LINK_DAYS} дней. Откройте её в браузере и, если нужен файл, сохраните как PDF: «Печать» → «Сохранить как PDF».

${company.name || ''}${company.phone ? ', ' + company.phone : ''}
${user?.name || ''}`.trim();
      try {
        await sendMail({ ...smtpSettings(), to, toName: deal.contact_name || undefined, subject: String(b.subject || '').trim() || `${kind} от ${company.name || 'нашей компании'}`, text });
      } catch (e) {
        return json(res, 502, { error: 'Письмо не ушло: ' + e.message });
      }
      logActivity(`Клиенту отправлен ${kind.toLowerCase()} по сделке «${deal.title}» на ${to}`, 'deals', id, user.name);
      // письмо видно и в переписке клиента, если она уже есть
      const conv = deal.contact_id ? db.prepare('SELECT id FROM conversations WHERE contact_id=?').get(deal.contact_id) : null;
      if (conv) {
        const message = db.prepare("INSERT INTO messages(conversation_id,deal_id,channel,direction,body,subject,status,author,event_at,event_time_source) VALUES(?,?,'email','out',?,?,'sent',?,datetime('now'),'crm')").run(conv.id,id,text,kind,user.name);
        db.prepare(`UPDATE lead_routing SET first_response_at=COALESCE(first_response_at,datetime('now')),first_response_user_id=COALESCE(first_response_user_id,?)
          WHERE deal_id=? AND assigned_at IS NOT NULL`).run(Number(user.id),id);
        db.prepare("UPDATE conversations SET last_at=datetime('now') WHERE id=?").run(conv.id);
        broadcastMessage(message.lastInsertRowid);
      }
      return json(res, 200, { ok: true, to, doc, link, expiresDays: DOC_LINK_DAYS });
    }

    const mDeal = p.match(/^\/api\/deals\/(\d+)(?:\/(products))?$/);
    if (mDeal) { const id = mDeal[1];
      if (mDeal[2] === 'products') {
        // состав сделки видит и меняет её ответственный: партнёру чужие позиции недоступны
        if (user.role === 'partner' && !partnerOwns(user, 'deals', Number(id))) return json(res, 403, { error: 'Это чужая сделка: партнёр работает только со своими' });
        if (req.method === 'GET') return json(res, 200, db.prepare('SELECT * FROM deal_products WHERE deal_id=?').all(id));
        if (req.method === 'POST') {
          if (!db.prepare('SELECT id FROM deals WHERE id=?').get(id)) return json(res, 404, { error: 'Сделка не найдена' });
          const b = await readBody(req);
          const pr = b.product_id ? db.prepare('SELECT * FROM products WHERE id=?').get(b.product_id) : null;
          // цена позиции — целые рубли, как в каталоге: иначе в базе остаётся
          // дробь, а в документе и карточке человек видит округлённое число
          const price = Math.round(Math.max(0, Number(b.price ?? pr?.price ?? 0) || 0)), qty = Math.max(0.001, Number(b.qty) || 1);
          const name = String(b.name || pr?.name || 'Позиция').slice(0, 200);
          const r = db.prepare('INSERT INTO deal_products(deal_id,product_id,name,price,qty) VALUES(?,?,?,?,?)').run(id, b.product_id || null, name, price, qty); const sum = dealSumByProducts(id); db.prepare('UPDATE deals SET amount=? WHERE id=?').run(sum, id); broadcast('change', { table: 'deals' }); return json(res, 201, db.prepare('SELECT * FROM deal_products WHERE id=?').get(r.lastInsertRowid)); }
        return json(res, 405, { error: 'Метод не поддерживается' });
      }
      if (req.method === 'GET') {
        // имя компании нужно карточке, чтобы показать привязку подписью:
        // справочник компаний целиком ради одной строки больше не грузится
        const deal = db.prepare('SELECT d.*,c.name contact_name,c.phone contact_phone,c.email contact_email,co.name company_name,u.name responsible_name FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id LEFT JOIN companies co ON co.id=d.company_id LEFT JOIN users u ON u.id=d.responsible_id WHERE d.id=?').get(id);
        if (!deal) return json(res, 404, { error: 'Сделка не найдена' });
        const products = db.prepare('SELECT dp.*,pr.name product_name FROM deal_products dp LEFT JOIN products pr ON pr.id=dp.product_id WHERE dp.deal_id=?').all(id);
        // переписка клиента по этой сделке — единый диалог прямо в карточке
        const conv = deal?.contact_id ? db.prepare('SELECT id,title,channels,unread,chat_type FROM conversations WHERE contact_id=? ORDER BY last_at DESC').get(deal.contact_id) : null;
        let messages=[];
        if(conv){
          messages=user.role==='partner'||user.role==='manager'
            ?db.prepare('SELECT m.*,cv.chat_type AS chat_type FROM messages m JOIN conversations cv ON cv.id=m.conversation_id WHERE m.conversation_id=? AND m.deal_id=? ORDER BY m.id DESC LIMIT 40').all(conv.id,id).reverse()
            :db.prepare('SELECT m.*,cv.chat_type AS chat_type FROM messages m JOIN conversations cv ON cv.id=m.conversation_id WHERE m.conversation_id=? ORDER BY m.id DESC LIMIT 40').all(conv.id).reverse();
          if(user.role==='partner'||user.role==='manager')conv.unread=Number(db.prepare(`SELECT COUNT(*) n FROM messages m WHERE m.conversation_id=? AND m.deal_id=? AND m.direction='in'
            AND m.id>COALESCE((SELECT last_msg_id FROM conversation_deal_read_marks WHERE conversation_id=? AND user_id=? AND deal_id=?),0)`).get(conv.id,id,conv.id,user.id,id).n)||0;
          messages=messages.map(m=>messageViewForUser(m,user));
        }
        // Для партнёра история только по самой переданной сделке: общие действия
        // по карточке клиента могут относиться к другим продажам.
        const history=user.role==='partner'
          ?db.prepare("SELECT * FROM activities WHERE entity_type='deals' AND entity_id=? ORDER BY id DESC LIMIT 40").all(id)
          :db.prepare(`SELECT * FROM (
              SELECT * FROM activities WHERE entity_type='deals' AND entity_id=?
              UNION ALL SELECT * FROM activities WHERE entity_type='contacts' AND entity_id=?
            ) ORDER BY id DESC LIMIT 40`).all(id,deal.contact_id||0);
        const tasks = user.role === 'manager'
          ? db.prepare(`SELECT * FROM tasks t WHERE t.deal_id=? AND ${managerTaskScopeSql('t')} ORDER BY t.id DESC`).all(id,...managerTaskParams(user))
          : db.prepare('SELECT * FROM tasks WHERE deal_id=? ORDER BY id DESC').all(id);
        const safeDeal=user.role==='partner'?partnerDealView(deal):deal;
        return json(res, 200, { deal:safeDeal, notes: db.prepare("SELECT * FROM notes WHERE entity_type='deals' AND entity_id=? ORDER BY id DESC").all(id), tasks, products, history, conversation: conv, messages });
      }
      if (req.method === 'PATCH') { const b = await readBody(req); const old = db.prepare('SELECT * FROM deals WHERE id=?').get(id);
        if (!old) return json(res, 404, { error: 'Сделка не найдена' });
        if(user.role==='partner'){
          const allowed=new Set(['title','stage','deal_object','land_status','construction_date','payment_type','lead_source','deadline']);
          if(Object.keys(b).some(k=>!allowed.has(k)))return json(res,403,{error:'Партнёр может обновлять только согласованные сведения и этап переданной сделки; сумму и ответственного меняет офис.'});
          if(b.stage!==undefined&&!partnerAllowedStages().has(String(b.stage)))return json(res,403,{error:'Этот этап не входит в согласованные этапы работы партнёра.'});
        }
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
        let linkedContact = null, claimContact = false, claimCompany = false;
        if (b.contact_id !== undefined) {
          b.contact_id = b.contact_id ? Number(b.contact_id) : null;
          if (b.contact_id !== null && (!Number.isInteger(b.contact_id) || b.contact_id <= 0)) return json(res, 400, { error: 'Некорректный клиент — выберите контакт из списка' });
          linkedContact = b.contact_id ? db.prepare('SELECT * FROM contacts WHERE id=?').get(b.contact_id) : null;
          if (b.contact_id && !linkedContact) return json(res, 400, { error: 'Клиент не найден — выберите контакт из списка' });
        } else if (old.contact_id) linkedContact = db.prepare('SELECT * FROM contacts WHERE id=?').get(old.contact_id);
        if (b.company_id !== undefined) {
          b.company_id = b.company_id ? Number(b.company_id) : null;
          if (b.company_id !== null && (!Number.isInteger(b.company_id) || b.company_id <= 0)) return json(res, 400, { error: 'Некорректная компания — выберите из списка' });
          const linkedCompany = b.company_id ? db.prepare('SELECT * FROM companies WHERE id=?').get(b.company_id) : null;
          if (b.company_id && !linkedCompany) return json(res, 400, { error: 'Компания не найдена — обновите страницу и выберите из списка' });
          if (user.role === 'manager' && linkedCompany) {
            if (linkedCompany.responsible_id && Number(linkedCompany.responsible_id) !== Number(user.id) && !managerOwns(user,'companies',linkedCompany.id))
              return json(res,403,{error:'Компания закреплена за другим сотрудником. Попросите администратора передать карточку.'});
            claimCompany = !linkedCompany.responsible_id;
          }
        }
        if (user.role === 'manager' && b.contact_id !== undefined && linkedContact) {
          if (linkedContact.responsible_id && Number(linkedContact.responsible_id) !== Number(user.id)) return json(res,403,{error:'Клиент закреплён за другим сотрудником. Попросите администратора передать карточку.'});
          const conflict = db.prepare(`SELECT 1 x FROM deals d JOIN users u ON u.id=d.responsible_id WHERE d.contact_id=? AND u.role='manager' AND d.responsible_id<>? LIMIT 1`).get(linkedContact.id,user.id);
          if (!linkedContact.responsible_id && conflict) return json(res,403,{error:'У клиента уже есть сделка другого менеджера. Попросите администратора назначить ответственного.'});
          claimContact = !linkedContact.responsible_id;
        }
        if (b.responsible_id !== undefined && b.responsible_id !== null && b.responsible_id !== '' && !db.prepare('SELECT 1 x FROM users WHERE id=?').get(b.responsible_id)) return json(res, 400, { error: 'Ответственный не найден — обновите страницу и выберите сотрудника' });
        if (user.role === 'partner' && b.responsible_id !== undefined && Number(b.responsible_id) !== Number(user.id)) return json(res, 400, { error: 'Партнёр не может передать лид другому сотруднику' });
        if (user.role === 'manager' && b.responsible_id !== undefined && Number(b.responsible_id) !== Number(user.id)) return json(res,403,{error:'Передать сделку другому сотруднику может администратор.'});
        const required = normalizeDealRequirements(b,old);
        if (required.error) return json(res,400,{error:required.error});
        Object.assign(b,required.value);
        normalizeResponsible(b);
        if (b.custom !== undefined) { const err = missingRequiredCustom('deals', b.custom); if (err) return json(res, 400, { error: err }); }
        clampTexts(b);
        const fields = ['title','amount','deal_object','land_status','construction_date','payment_type','lead_source','stage','pipeline_id','contact_id','company_id','responsible','responsible_id','priority','loss_reason','deadline','custom']; const ks = Object.keys(b).filter(k => fields.includes(k));
        // закрытая сделка, которую вернули в работу, не должна хранить дату закрытия:
        // иначе аналитика по месяцам считает её повторно закрытой
        // дату закрытия трогаем только если этап действительно сменился:
        // повторное сохранение «успеха» не должно обновлять дату продажи
        const closedSetter = b.stage !== undefined && b.stage !== old.stage ? (['won', 'lost'].includes(b.stage) ? ",closed_at=datetime('now')" : ',closed_at=NULL') : '';
        if (ks.length || claimContact || claimCompany) {
          db.exec('BEGIN IMMEDIATE');
          try {
            if (claimContact) db.prepare('UPDATE contacts SET responsible_id=? WHERE id=? AND responsible_id IS NULL').run(user.id, linkedContact.id);
            if (claimCompany) db.prepare('UPDATE companies SET responsible_id=? WHERE id=? AND responsible_id IS NULL').run(user.id, Number(b.company_id));
            if (ks.length) db.prepare(`UPDATE deals SET ${ks.map(k => k + '=?')},updated_at=datetime('now')${closedSetter} WHERE id=?`).run(...ks.map(k => b[k]), id);
            db.exec('COMMIT');
          } catch (e) { db.exec('ROLLBACK'); throw e }
        }
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
          if (b.amount !== undefined && Number(b.amount || 0) !== Number(old.amount || 0)) changes.push(`бюджет: ${money(old.amount)} → ${money(b.amount)}`);
          if (b.deal_object !== undefined && b.deal_object !== old.deal_object) changes.push(`объект: ${old.deal_object || 'не указан'} → ${b.deal_object}`);
          if (b.land_status !== undefined && b.land_status !== old.land_status) changes.push(`наличие земли: ${old.land_status || 'не указано'} → ${b.land_status}`);
          if (b.construction_date !== undefined && b.construction_date !== old.construction_date) changes.push(`дата строительства: ${old.construction_date || 'не указана'} → ${b.construction_date}`);
          if (b.payment_type !== undefined && b.payment_type !== old.payment_type) changes.push(`тип оплаты: ${old.payment_type || 'не указан'} → ${b.payment_type}`);
          if (b.lead_source !== undefined && b.lead_source !== old.lead_source) changes.push(`источник лида: ${old.lead_source || 'не указан'} → ${b.lead_source}`);
          if (b.responsible_id !== undefined && Number(b.responsible_id || 0) !== Number(old.responsible_id || 0)) changes.push(`ответственный: ${who(old.responsible_id)} → ${who(b.responsible_id)}`);
          if (b.contact_id !== undefined && Number(b.contact_id || 0) !== Number(old.contact_id || 0)) changes.push(`клиент: ${what('contacts', old.contact_id)} → ${what('contacts', b.contact_id)}`);
          if (b.company_id !== undefined && Number(b.company_id || 0) !== Number(old.company_id || 0)) changes.push(`компания: ${what('companies', old.company_id)} → ${what('companies', b.company_id)}`);
          if (b.pipeline_id !== undefined && Number(b.pipeline_id || 0) !== Number(old.pipeline_id || 0)) changes.push(`воронка: ${what('pipelines', old.pipeline_id)} → ${what('pipelines', b.pipeline_id)}`);
          if (b.deadline !== undefined && String(b.deadline || '') !== String(old.deadline || '')) changes.push(`срок: ${day(old.deadline)} → ${day(b.deadline)}`);
          if (b.loss_reason !== undefined && String(b.loss_reason || '').trim() !== String(old.loss_reason || '').trim()) changes.push(`причина проигрыша: ${String(b.loss_reason || '').trim() || 'не указана'}`);
          for (const ch of changes) logActivity(`Сделка «${title}»: ${ch}`, 'deals', Number(id), user.name);
        }
        if (b.stage && old && b.stage !== old.stage) { const sname = (dealStages.find(x => x.code === b.stage) || {}).name || b.stage; logActivity(`Сделка «${old.title}» → этап «${sname}»`, 'deals', Number(id), user.name); await runAutomations('stage_changed', { deal_id: Number(id), contact_id: old.contact_id, stage: b.stage, actor_id: user.id }); } broadcast('change', { table: 'deals' }); return json(res, 200, db.prepare('SELECT * FROM deals WHERE id=?').get(id)); }
      if (req.method === 'DELETE') {
        if(user.role==='partner')return json(res,403,{error:'Партнёр не удаляет сделки; при отзыве передачи доступ закрывается автоматически.'});
        const d = db.prepare('SELECT * FROM deals WHERE id=?').get(id);
        if (!d) return json(res, 404, { error: 'Сделка не найдена' });
        db.exec('BEGIN IMMEDIATE');
        try {
          // задачи не удаляем: они остаются в списке дел и у клиента, просто без привязки к сделке
          detachChildren('deals', id);
          db.prepare('DELETE FROM deals WHERE id=?').run(id);
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e }
        logActivity(`Сделка удалена: ${d.title}`, 'deals', Number(id), user.name);
        broadcast('change', { table: 'deals' });
        return json(res, 200, { deleted: true });
      }
    }
    const mDp = p.match(/^\/api\/deal_products\/(\d+)$/);
    if (mDp) { const id = mDp[1]; const row = db.prepare('SELECT * FROM deal_products WHERE id=?').get(id); if (!row) return json(res, 404, { error: 'Позиция не найдена' });
      // позиция меняет сумму сделки, поэтому проверяем владельца сделки, а не только роль
      if (user.role === 'partner' && !partnerOwns(user, 'deals', Number(row.deal_id))) return json(res, 403, { error: 'Это чужая сделка: партнёр меняет состав только своих' });
      if (req.method === 'PATCH') { const b = await readBody(req); const qty = b.qty === undefined ? row.qty : Math.max(0.001, Number(b.qty) || row.qty), price = b.price === undefined ? row.price : Math.round(Math.max(0, Number(b.price) || 0)); db.prepare('UPDATE deal_products SET qty=?,price=? WHERE id=?').run(qty, price, id); }
      if (req.method === 'DELETE') db.prepare('DELETE FROM deal_products WHERE id=?').run(id);
      const sum = dealSumByProducts(row.deal_id); db.prepare('UPDATE deals SET amount=? WHERE id=?').run(sum, row.deal_id); return json(res, 200, { saved: true, amount: sum }); }
    // ===== users / team =====
    if (p === '/api/users') {
      // Список нужен всем для выбора ответственного, но e-mail сотрудников —
      // только администратору: остальным достаточно имени и роли.
      if (req.method === 'GET') {
        const rows = user.role === 'admin'
          ? db.prepare('SELECT id,name,email,role,active,last_login,must_change_password,pass_changed_at,team_id,max_open_leads,routing_regions,routing_directions FROM users ORDER BY id').all()
          : user.role === 'partner'
            ? [{ id: user.id, name: user.name, role: 'partner', active: 1 }]
            : db.prepare('SELECT id,name,role,active FROM users ORDER BY id').all();
        // Вкладке «Команда» нужны числа нагрузки сотрудника. Считаем их двумя
        // группировками на сервере: иначе вкладка тянула бы все сделки и все
        // задачи базы, чтобы отобрать из них четыре числа на строку.
        if (u.searchParams.get('stats') === '1' && user.role === 'admin') {
          const dStat = new Map(db.prepare(`SELECT responsible_id id,
              COALESCE(SUM(COALESCE(stage,'') NOT IN ('won','lost')),0) open,
              COALESCE(SUM(CASE WHEN COALESCE(stage,'') NOT IN ('won','lost') THEN COALESCE(amount,0) ELSE 0 END),0) sum,
              COALESCE(SUM(stage='won'),0) won
              FROM deals WHERE responsible_id IS NOT NULL GROUP BY responsible_id`).all().map(r => [Number(r.id), r]));
          const tStat = new Map(db.prepare('SELECT responsible_id id, COUNT(*) n FROM tasks WHERE done=0 AND responsible_id IS NOT NULL GROUP BY responsible_id').all().map(r => [Number(r.id), Number(r.n)]));
          for (const r of rows) {
            const d = dStat.get(Number(r.id)) || {};
            r.deals_open = Number(d.open || 0);
            r.deals_sum = Number(d.sum || 0);
            r.deals_won = Number(d.won || 0);
            r.tasks_open = tStat.get(Number(r.id)) || 0;
          }
        }
        return json(res, 200, rows);
      }
      if (req.method === 'POST') {
        if (!requireAdmin(user, res)) return;
        const b = await readBody(req);
        const error = validateUser(b, true);
        if (error) return json(res, 400, { error });
        const role = b.role || 'manager';
        if(role==='rop'&&!b.team_id)return json(res,400,{error:'Для руководителя выберите команду — без неё доступ к очереди и отчётам закрыт.'});
        const email = b.email.trim().toLowerCase();
        if (db.prepare('SELECT id FROM users WHERE lower(trim(email))=?').get(email)) return json(res, 409, { error: 'Этот e-mail уже используется' });
        const r = db.prepare("INSERT INTO users(name,email,pass,role,active,must_change_password,pass_changed_at,team_id,max_open_leads,routing_regions,routing_directions) VALUES(?,?,?,?,?,1,datetime('now'),?,?,?,?)").run(b.name.trim(), email, hashPass(b.password), role, b.active ?? 1, b.team_id ?? null, b.max_open_leads ?? null, b.routing_regions || '', b.routing_directions || '');
        // кто и кому выдал доступ, должно быть видно в журнале: иначе на вопрос
        // «пароль поменялся сам» ответить нечем
        logActivity(`Сотрудник добавлен: ${b.name.trim()} (${ROLE_RU[role] || role}), выдан временный пароль`, 'users', Number(r.lastInsertRowid), user.name);
        broadcast('change', { table: 'users' });
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
      const nextRole=b.role??current.role,nextTeamId=b.team_id!==undefined?b.team_id:current.team_id;
      if(nextRole==='rop'&&!nextTeamId)return json(res,400,{error:'Для руководителя выберите команду — без неё доступ к очереди и отчётам закрыт.'});
      if (current.role === 'admin' && current.active && ((b.role && b.role !== 'admin') || b.active === 0)
          && db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1").get().n <= 1)
        return json(res, 400, { error: 'Нельзя отключить последнего администратора' });
      if (b.email !== undefined) {
        b.email = b.email.trim().toLowerCase();
        if (db.prepare('SELECT id FROM users WHERE lower(trim(email))=? AND id!=?').get(b.email, id)) return json(res, 409, { error: 'Этот e-mail уже используется' });
      }
      if (b.password) db.prepare("UPDATE users SET pass=?,must_change_password=1,session_version=session_version+1,pass_changed_at=datetime('now') WHERE id=?").run(hashPass(b.password), id);
      const ks = ['name','email','role','active','team_id','max_open_leads','routing_regions','routing_directions'].filter(k=>b[k]!==undefined);
      if (ks.length) db.prepare(`UPDATE users SET ${ks.map(k => k + '=?')} WHERE id=?`).run(...ks.map(k => b[k]), id);
      if (b.password || b.active === 0 || b.role !== undefined) closeUserStreams(id);
      // изменения доступа читаются в журнале одной строкой: кто, кому и что сделал
      const done = [];
      if (b.password) done.push('сброшен пароль, прежние сеансы закрыты');
      if (b.role !== undefined && b.role !== current.role) done.push(`роль ${ROLE_RU[current.role] || current.role} → ${ROLE_RU[b.role] || b.role}`);
      if (b.active !== undefined && Number(b.active) !== Number(current.active)) done.push(Number(b.active) ? 'доступ разрешён' : 'доступ отключён');
      if (b.name !== undefined && String(b.name).trim() !== current.name) done.push('изменено имя');
      if (b.email !== undefined && b.email !== current.email) done.push(`e-mail ${current.email} → ${b.email}`);
      if (b.team_id !== undefined && Number(b.team_id||0)!==Number(current.team_id||0)) done.push(`команда ${current.team_id||'не задана'} → ${b.team_id||'не задана'}`);
      if (b.max_open_leads !== undefined && Number(b.max_open_leads||0)!==Number(current.max_open_leads||0)) done.push('изменён лимит открытых лидов');
      if (b.routing_regions !== undefined && String(b.routing_regions)!==String(current.routing_regions||'')) done.push('изменена настройка регионов распределения');
      if (b.routing_directions !== undefined && String(b.routing_directions)!==String(current.routing_directions||'')) done.push('изменена настройка направлений распределения');
      const after = db.prepare('SELECT name FROM users WHERE id=?').get(id);
      if (done.length) logActivity(`Сотрудник ${after ? after.name : current.name}: ${done.join(', ')}`, 'users', id, user.name);
      broadcast('change', { table: 'users' });
      return json(res, 200, { saved: true });
    }
    if (p === '/api/custom-fields') {
      if (req.method === 'GET') return json(res, 200, { fields: getCustomFields() });
      if (req.method === 'PUT') { if (!requireAdmin(user, res)) return; const b = await readBody(req); const fields = sanitizeFields(b.fields); setSetting('CUSTOM_FIELDS', JSON.stringify(fields)); logActivity(`Настраиваемые поля обновлены (${fields.length})`, null, null, user.name); return json(res, 200, { saved: true, fields }) }
    }
    if (p === '/api/backups') {
      const dir = join(DATA_DIR, 'backups');
      if (req.method === 'GET') {
        if (!requireAdmin(user, res)) return;
        return json(res, 200, { dir: '/data/backups', keepDays: Number(getSetting('BACKUP_KEEP_DAYS', '7')) || 0, s3: s3status(), files: existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.db')).sort().reverse().map(f => ({ name: f, sizeBytes: statSync(join(dir, f)).size, created_at: statSync(join(dir, f)).mtime.toISOString() })) : [] });
      }
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
      // имя приходит из запроса — проверяем до обращения к файловой системе,
      // как у скачивания и восстановления копии
      if (!/^[A-Za-z0-9._-]+\.db$/.test(name)) return json(res, 400, { error: 'Некорректное имя файла копии' });
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
      try { snapshotDb(join(DATA_DIR, 'backups', safety)) } catch (e) { console.error('restore: страховочная копия', e.message) }
      try { db.close() } catch {}
      copyFileSync(tmp, join(DATA_DIR, 'crm.db'));
      unlinkSync(tmp);
      for (const suffix of ['-wal', '-shm']) { const f = join(DATA_DIR, 'crm.db' + suffix); if (existsSync(f)) unlinkSync(f) }
      json(res, 200, { ok: true, restored: name, safety_copy: safety, restarting: true, message: 'База восстановлена из копии. В Docker служба перезапустится сама; если запускали без Docker — перезапустите её своей командой запуска. Страницу обновите через несколько секунд' });
      setTimeout(() => process.exit(0), 400);
      return;
    }
    if (p === '/api/me/password' && req.method === 'POST') {
      const b = await readBody(req), nextPass = String(b.new_password || b.next || '');
      if (nextPass.length < 12 || nextPass.length > 256) return json(res, 400, { error: 'Новый пароль должен содержать от 12 до 256 символов' });
      const me = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
      if (!checkPass(String(b.old_password || b.old || ''), me.pass)) return json(res, 400, { error: me.must_change_password
        ? 'Временный пароль не совпал. Проверьте раскладку клавиатуры и что в начале или конце нет пробелов.'
        : 'Текущий пароль не совпал. Проверьте раскладку клавиатуры и что в начале или конце нет пробелов.' });
      if (checkPass(nextPass, me.pass)) return json(res, 400, { error: 'Новый пароль должен отличаться от временного или текущего' });
      db.prepare("UPDATE users SET pass=?,must_change_password=0,session_version=session_version+1,pass_changed_at=datetime('now') WHERE id=?").run(hashPass(nextPass), user.id);
      closeUserStreams(user.id);
      // запись в журнале отвечает на вопрос руководителя: сотрудник сам задал
      // личный пароль при первом входе или менял его позже
      logActivity(me.must_change_password ? 'Временный пароль заменён личным' : 'Сотрудник сменил свой пароль', 'users', user.id, user.name);
      const token = sign({ id: user.id });
      res.setHeader('Set-Cookie', sessionCookie(req, token));
      return json(res, 200, { saved: true, token });
    }

    // ===== inbox =====
    if (p === '/api/conversations' && req.method === 'GET') {
      if(user.role==='partner'){
        const partnerDeals=db.prepare(`SELECT d.id deal_id,d.contact_id,d.title deal_title,d.amount FROM deals d
          JOIN partner_transfers pt ON pt.deal_id=d.id AND pt.active=1 WHERE pt.partner_id=? AND d.contact_id IS NOT NULL`).all(user.id)
          .filter(d=>partnerTransferForDeal(user,d.deal_id));
        const byContact=new Map();for(const d of partnerDeals){const target=partnerTransferForContact(user,d.contact_id);if(target&&Number(target.deal_id)===Number(d.deal_id))byContact.set(Number(d.contact_id),d);}
        let contactIds=[...byContact.keys()];const requested=Number(u.searchParams.get('contact_id')||0);if(requested)contactIds=contactIds.filter(id=>id===requested);
        if(!contactIds.length)return json(res,200,[]);
        const convs=db.prepare(`SELECT cv.id,cv.contact_id,cv.title,cv.channels,cv.chat_type,cv.last_at,c.name,c.phone,c.email,c.source
          FROM conversations cv JOIN contacts c ON c.id=cv.contact_id WHERE cv.contact_id IN (${contactIds.map(()=>'?').join(',')}) ORDER BY cv.last_at DESC,cv.id DESC`).all(...contactIds);
        const rows=convs.map(cv=>{
          const d=byContact.get(Number(cv.contact_id));
          const last=db.prepare(`SELECT id,body,direction,author,content_name,content_uri FROM messages WHERE conversation_id=? AND deal_id=? ORDER BY id DESC LIMIT 1`).get(cv.id,d.deal_id);
          const unread=Number(db.prepare(`SELECT COUNT(*) n FROM messages m WHERE m.conversation_id=? AND m.deal_id=? AND m.direction='in'
            AND m.id>COALESCE((SELECT last_msg_id FROM conversation_deal_read_marks WHERE conversation_id=? AND user_id=? AND deal_id=?),0)`).get(cv.id,d.deal_id,cv.id,user.id,d.deal_id).n)||0;
          return {id:cv.id,contact_id:cv.contact_id,title:cv.title,channels:cv.channels,chat_type:cv.chat_type,last_at:last?.id?db.prepare('SELECT created_at FROM messages WHERE id=?').get(last.id)?.created_at:cv.last_at,
            name:cv.name,phone:cv.phone,email:cv.email,source:cv.source,deal_id:d.deal_id,deal_title:d.deal_title,deal_amount:d.amount,
            last_body:last?(last.body&&last.body!=='[вложение]'?String(last.body).slice(0,200):last.content_name?'Файл: '+String(last.content_name).slice(0,80):last.content_uri?'Файл':''):'',
            last_direction:last?.direction||'',last_author:last?.author||'',unread};
        });
        logAccess(user,'conversation_list','conversations','',req.method);return json(res,200,rows);
      }
      if(user.role==='manager'){
        const sub=`SELECT od.id FROM deals od WHERE od.contact_id=cv.contact_id AND ${managerDealScopeSql('od')}`;
        const scope=`(m.deal_id IN (${sub}) OR ${managerUnlinkedMessageSql('m','cv','c')})`;
        const scopeParams=[...managerDealParams(user),...managerUnlinkedMessageParams(user)];
        const convContact=Number(u.searchParams.get('contact_id')||0);
        const where=`WHERE ${managerConversationScopeSql('cv','c')}${convContact?' AND cv.contact_id=?':''}`;
        const rows=db.prepare(`SELECT cv.*,c.phone,c.email,c.company,c.source,c.position,
          c.responsible_id AS contact_responsible_id,ru.name AS contact_responsible_name,
          (SELECT CASE WHEN COALESCE(m.body,'')<>'' AND m.body<>'[вложение]' THEN substr(m.body,1,200)
            WHEN COALESCE(m.content_name,'')<>'' THEN 'Файл: '||substr(m.content_name,1,80)
            WHEN COALESCE(m.content_uri,'')<>'' THEN 'Файл' ELSE m.body END FROM messages m
            WHERE m.conversation_id=cv.id AND ${scope} ORDER BY m.id DESC LIMIT 1) last_body,
          (SELECT m.direction FROM messages m WHERE m.conversation_id=cv.id AND ${scope} ORDER BY m.id DESC LIMIT 1) last_direction,
          (SELECT m.author FROM messages m WHERE m.conversation_id=cv.id AND ${scope} ORDER BY m.id DESC LIMIT 1) last_author,
          (SELECT COALESCE(m.event_at,m.created_at) FROM messages m WHERE m.conversation_id=cv.id AND ${scope} ORDER BY m.id DESC LIMIT 1) visible_last_at,
          (SELECT d.amount FROM deals d WHERE d.contact_id=cv.contact_id AND d.stage NOT IN ('won','lost') AND ${managerDealScopeSql('d')} ORDER BY d.id DESC LIMIT 1) deal_amount,
          (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=cv.id AND m.direction='in' AND ${scope}
            AND m.id>CASE WHEN m.deal_id IS NULL THEN COALESCE((SELECT rm.last_msg_id FROM read_marks rm WHERE rm.conversation_id=cv.id AND rm.user_id=?),0)
              ELSE COALESCE((SELECT dr.last_msg_id FROM conversation_deal_read_marks dr WHERE dr.conversation_id=cv.id AND dr.user_id=? AND dr.deal_id=m.deal_id),0) END) unread
          FROM conversations cv LEFT JOIN contacts c ON c.id=cv.contact_id LEFT JOIN users ru ON ru.id=c.responsible_id ${where}
          ORDER BY visible_last_at DESC,cv.id DESC`).all(...scopeParams,...scopeParams,...scopeParams,...scopeParams,...managerDealParams(user),...scopeParams,Number(user.id),Number(user.id),...managerConversationParams(user),...(convContact?[convContact]:[]));
        const result=rows.map(({visible_last_at,...row})=>({...row,last_at:visible_last_at||'',unread:Number(row.unread)||0}));
        return json(res,200,result);
      }
      const conds = [], params = [], manager = false;
      if (user.role === 'partner') {
        conds.push('(c.responsible_id=? OR c.id IN (SELECT contact_id FROM deals WHERE responsible_id=? AND contact_id IS NOT NULL))');
        params.push(Number(user.id),Number(user.id));
      } else if (manager) {
        conds.push(managerConversationScopeSql('cv','c')); params.push(...managerConversationParams(user));
      }
      const convContact = Number(u.searchParams.get('contact_id') || 0);
      if (convContact) { conds.push('cv.contact_id=?'); params.push(convContact); }
      const pw = conds.length ? 'WHERE ' + conds.join(' AND ') + ' ' : '';
      // Сумма на чате строится по доступным менеджеру сделкам, а не по любому
      // активному лиду клиента, который мог быть передан коллеге.
      const dealAmountScope = user.role === 'partner' ? ' AND d.responsible_id=?'
        : manager ? ` AND ${managerDealScopeSql('d')}` : '';
      const dealAmountParams = user.role === 'partner' ? [Number(user.id)] : manager ? managerDealParams(user) : [];
      return json(res, 200, db.prepare(`SELECT cv.*,c.phone,c.email,c.company,c.source,c.position,
      c.responsible_id AS contact_responsible_id,ru.name AS contact_responsible_name,
      (SELECT CASE WHEN COALESCE(body,'')<>'' AND body<>'[вложение]' THEN substr(body,1,200)
        WHEN COALESCE(content_name,'')<>'' THEN 'Файл: '||substr(content_name,1,80)
        WHEN COALESCE(content_uri,'')<>'' THEN 'Файл' ELSE body END
       FROM messages WHERE conversation_id=cv.id ORDER BY id DESC LIMIT 1) last_body,
      (SELECT direction FROM messages WHERE conversation_id=cv.id ORDER BY id DESC LIMIT 1) last_direction,
      (SELECT author FROM messages WHERE conversation_id=cv.id ORDER BY id DESC LIMIT 1) last_author,
      (SELECT d.amount FROM deals d WHERE d.contact_id=cv.contact_id AND d.stage NOT IN ('won','lost')${dealAmountScope} ORDER BY d.id DESC LIMIT 1) deal_amount,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=cv.id AND m.direction='in'
        AND m.id>COALESCE((SELECT rm.last_msg_id FROM read_marks rm WHERE rm.conversation_id=cv.id AND rm.user_id=?),0)) unread
      FROM conversations cv LEFT JOIN contacts c ON c.id=cv.contact_id LEFT JOIN users ru ON ru.id=c.responsible_id ${pw}ORDER BY cv.last_at DESC,cv.id DESC`)
        .all(...dealAmountParams,user.id,...params).map(r=>({...r,unread:r.unread||0})));
    }
    // Начать переписку первым. Беседа появлялась только из входящего сообщения,
    // поэтому менеджер не мог написать клиенту, который ещё не обращался.
    if (p === '/api/conversations' && req.method === 'POST') {
      const b = await readBody(req);
      const cid = Number(b.contact_id);
      if (!cid) return json(res, 400, { error: 'Не указан клиент' });
      const contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(cid);
      if (!contact) return json(res, 404, { error: 'Клиент не найден' });
      // Менеджер и партнёр начинают переписку только по доступным им клиентам.
      if (user.role === 'partner' && !partnerOwns(user, 'contacts', cid)) return json(res, 403, { error: 'Это чужой клиент: партнёр переписывается только со своими' });
      if (user.role === 'manager' && !managerOwns(user,'contacts',cid)) {
        const existing = db.prepare('SELECT id FROM conversations WHERE contact_id=?').get(cid);
        if (!existing || !managerOwns(user,'conversations',existing.id)) return json(res,403,{error:'Этот клиент не закреплён за вами.'});
      }
      const chatType = normChatType(String(b.chat_type || 'whatsapp').trim().toLowerCase());
      if (!chatType) return json(res, 400, { error: `Мессенджер «${b.chat_type}» не поддерживается. Доступны: ${WZ_CHAT_TYPES.join(', ')}` });
      // у беседы один клиент (UNIQUE по contact_id): вторая ветка разделила бы историю
      const exist = db.prepare('SELECT * FROM conversations WHERE contact_id=?').get(cid);
      if (exist) {
        if (user.role === 'manager' && !managerOwns(user,'conversations',exist.id)) return json(res,403,{error:'Этот чат не закреплён за вами.'});
        return json(res,200,exist);
      }
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
      logActivity(`Начата переписка с «${conv.title}» (${chatType})`, 'contacts', cid, user?.name || '');
      return json(res, 201, conv);
    }
    // отметить прочитанными несколько бесед сразу: сотрудник выделил список и закрыл хвосты
    if (p === '/api/conversations/read' && req.method === 'POST') {
      const b = await readBody(req);
      const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 500);
      const mark = db.prepare("INSERT INTO read_marks(user_id,conversation_id,last_msg_id,updated_at) VALUES(?,?,(SELECT COALESCE(MAX(id),0) FROM messages WHERE conversation_id=?),datetime('now')) ON CONFLICT(user_id,conversation_id) DO UPDATE SET last_msg_id=MAX(read_marks.last_msg_id,excluded.last_msg_id),updated_at=datetime('now')");
      let done = 0;
      for (const id of ids) {
        const allowed = user.role === 'manager' ? managerOwns(user,'conversations',id)
          : user.role === 'partner' ? partnerOwns(user,'conversations',id)
          : !!db.prepare('SELECT id FROM conversations WHERE id=?').get(id);
        if(!allowed)continue;
        if(user.role==='manager'){
          const cv=db.prepare('SELECT contact_id FROM conversations WHERE id=?').get(id);
          const deals=cv?db.prepare(`SELECT d.id FROM deals d WHERE d.contact_id=? AND ${managerDealScopeSql('d')}`).all(cv.contact_id,...managerDealParams(user)):[];
          for(const deal of deals){const lastId=Number(db.prepare('SELECT COALESCE(MAX(id),0) m FROM messages WHERE conversation_id=? AND deal_id=?').get(id,deal.id).m)||0;
            db.prepare("INSERT INTO conversation_deal_read_marks(user_id,conversation_id,deal_id,last_msg_id,updated_at) VALUES(?,?,?,?,datetime('now')) ON CONFLICT(user_id,conversation_id,deal_id) DO UPDATE SET last_msg_id=MAX(conversation_deal_read_marks.last_msg_id,excluded.last_msg_id),updated_at=datetime('now')").run(user.id,id,deal.id,lastId);}
          if(managerCanReadUnlinkedMessages(user,id)){const last=Number(db.prepare("SELECT COALESCE(MAX(id),0) m FROM messages WHERE conversation_id=? AND deal_id IS NULL").get(id).m)||0;db.prepare("INSERT INTO read_marks(user_id,conversation_id,last_msg_id,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(user_id,conversation_id) DO UPDATE SET last_msg_id=MAX(read_marks.last_msg_id,excluded.last_msg_id),updated_at=datetime('now')").run(user.id,id,last);}
        }else if(user.role==='partner'){
          const cv=db.prepare('SELECT contact_id FROM conversations WHERE id=?').get(id),target=cv&&partnerTransferForContact(user,cv.contact_id);
          if(!target)continue;
          const lastId=Number(db.prepare('SELECT COALESCE(MAX(id),0) m FROM messages WHERE conversation_id=? AND deal_id=?').get(id,target.deal_id).m)||0;
          db.prepare("INSERT INTO conversation_deal_read_marks(user_id,conversation_id,deal_id,last_msg_id,updated_at) VALUES(?,?,?,?,datetime('now')) ON CONFLICT(user_id,conversation_id,deal_id) DO UPDATE SET last_msg_id=MAX(conversation_deal_read_marks.last_msg_id,excluded.last_msg_id),updated_at=datetime('now')").run(user.id,id,target.deal_id,lastId);
        }else mark.run(user.id,id,id);
        done++;
      }
      return json(res, 200, { ok: true, marked: done });
    }
    const mConv = p.match(/^\/api\/conversations\/(\d+)\/messages$/);
    if (mConv) { const id = mConv[1];
      if (req.method === 'GET') {
        if(user.role==='partner'){
          const conv=db.prepare('SELECT contact_id FROM conversations WHERE id=?').get(id),target=conv&&partnerTransferForContact(user,conv.contact_id);
          if(!target)return json(res,403,{error:'Активная передача этой переписки партнёру отсутствует.'});
          const lim=Math.max(1,Math.min(1000,Math.trunc(Number(u.searchParams.get('limit'))||200))),before=Math.max(0,Math.trunc(Number(u.searchParams.get('before'))||0));
          const rows=before
            ?db.prepare('SELECT m.*,cv.chat_type AS chat_type FROM messages m JOIN conversations cv ON cv.id=m.conversation_id WHERE m.conversation_id=? AND m.deal_id=? AND m.id<? ORDER BY m.id DESC LIMIT ?').all(id,target.deal_id,before,lim).reverse()
            :db.prepare('SELECT m.*,cv.chat_type AS chat_type FROM messages m JOIN conversations cv ON cv.id=m.conversation_id WHERE m.conversation_id=? AND m.deal_id=? ORDER BY m.id DESC LIMIT ?').all(id,target.deal_id,lim).reverse();
          const lastId=db.prepare('SELECT COALESCE(MAX(id),0) m FROM messages WHERE conversation_id=? AND deal_id=?').get(id,target.deal_id).m;
          db.prepare("INSERT INTO conversation_deal_read_marks(user_id,conversation_id,deal_id,last_msg_id,updated_at) VALUES(?,?,?,?,datetime('now')) ON CONFLICT(user_id,conversation_id,deal_id) DO UPDATE SET last_msg_id=MAX(conversation_deal_read_marks.last_msg_id,excluded.last_msg_id),updated_at=datetime('now')").run(user.id,Number(id),target.deal_id,lastId);
          logAccess(user,'conversation_messages','deal',target.deal_id,'GET');return json(res,200,rows.map(m=>messageViewForUser(m,user)));
        }
        if(user.role==='manager'){
          const conv=db.prepare('SELECT cv.contact_id FROM conversations cv WHERE cv.id=?').get(id);
          const deals=conv?db.prepare(`SELECT d.id FROM deals d WHERE d.contact_id=? AND ${managerDealScopeSql('d')} ORDER BY d.id`).all(conv.contact_id,...managerDealParams(user)):[];
          const ids=deals.map(d=>Number(d.id)),canReadUnlinked=managerCanReadUnlinkedMessages(user,id);
          if(!ids.length&&!canReadUnlinked)return json(res,200,[]);
          const marks=ids.map(()=>'?').join(','),dealCondition=ids.length?`deal_id IN (${marks})`:'0';
          const lim=Math.max(0,Math.min(1000,Math.trunc(Number(u.searchParams.get('limit'))||0))),before=Math.max(0,Math.trunc(Number(u.searchParams.get('before'))||0));
          const where=`conversation_id=? AND (${dealCondition}${canReadUnlinked?' OR deal_id IS NULL':''})${before?' AND id<?':''}`;
          const params=[Number(id),...ids,...(before?[before]:[])];
          const rows=lim
            ?db.prepare(`SELECT m.*,cv.chat_type AS chat_type FROM (SELECT * FROM messages WHERE ${where} ORDER BY id DESC LIMIT ?) m JOIN conversations cv ON cv.id=m.conversation_id ORDER BY m.id`).all(...params,lim)
            :db.prepare(`SELECT m.*,cv.chat_type AS chat_type FROM messages m JOIN conversations cv ON cv.id=m.conversation_id WHERE ${where} ORDER BY m.id`).all(...params);
          for(const deal of deals){
            const lastId=Number(db.prepare('SELECT COALESCE(MAX(id),0) m FROM messages WHERE conversation_id=? AND deal_id=?').get(Number(id),deal.id).m)||0;
            db.prepare("INSERT INTO conversation_deal_read_marks(user_id,conversation_id,deal_id,last_msg_id,updated_at) VALUES(?,?,?,?,datetime('now')) ON CONFLICT(user_id,conversation_id,deal_id) DO UPDATE SET last_msg_id=MAX(conversation_deal_read_marks.last_msg_id,excluded.last_msg_id),updated_at=datetime('now')").run(user.id,Number(id),deal.id,lastId);
          }
          if(canReadUnlinked){
            const lastUnlinked=Number(db.prepare("SELECT COALESCE(MAX(id),0) m FROM messages WHERE conversation_id=? AND deal_id IS NULL").get(Number(id)).m)||0;
            db.prepare("INSERT INTO read_marks(user_id,conversation_id,last_msg_id,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(user_id,conversation_id) DO UPDATE SET last_msg_id=MAX(read_marks.last_msg_id,excluded.last_msg_id),updated_at=datetime('now')").run(user.id,Number(id),lastUnlinked);
          }
          logAccess(user,'conversation_messages','conversations',id,'GET');return json(res,200,rows.map(m=>messageViewForUser(m,user)));
        }
        // Длинные диалоги отдаются окном: чат с историей на годы не должен
        // тянуть мегабайты на каждое открытие. Без параметров — вся история
        // (прежнее поведение для совместимости), с limit — последние N,
        // с before — N сообщений до указанного id.
        // только целые 0..1000: дробный или отрицательный limit уехал бы в SQL
        // как есть, а LIMIT -1 в SQLite означает «без ограничения»
        const lim = Math.max(0, Math.min(1000, Math.trunc(Number(u.searchParams.get('limit')) || 0)));
        const before = Math.max(0, Math.trunc(Number(u.searchParams.get('before')) || 0));
        const rows = lim
          ? (before
            ? db.prepare('SELECT m.*, cv.chat_type AS chat_type FROM (SELECT * FROM messages WHERE conversation_id=? AND id<? ORDER BY id DESC LIMIT ?) m JOIN conversations cv ON cv.id=m.conversation_id ORDER BY m.id').all(id, before, lim)
            : db.prepare('SELECT m.*, cv.chat_type AS chat_type FROM (SELECT * FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT ?) m JOIN conversations cv ON cv.id=m.conversation_id ORDER BY m.id').all(id, lim))
          : db.prepare('SELECT m.*, cv.chat_type AS chat_type FROM messages m JOIN conversations cv ON cv.id=m.conversation_id WHERE m.conversation_id=? ORDER BY m.id').all(id);
        // прочитанность личная: коллега, открывший чат раньше, не стирает метку у ответственного
        const lastId = db.prepare('SELECT MAX(id) m FROM messages WHERE conversation_id=?').get(id)?.m || 0;
        if (user?.id) db.prepare("INSERT INTO read_marks(user_id,conversation_id,last_msg_id,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(user_id,conversation_id) DO UPDATE SET last_msg_id=MAX(last_msg_id,excluded.last_msg_id),updated_at=datetime('now')").run(user.id, Number(id), lastId);
        return json(res, 200, rows);
      }
      if (req.method === 'POST') { const b = await readBody(req); const conv = db.prepare('SELECT cv.*,c.phone FROM conversations cv LEFT JOIN contacts c ON c.id=cv.contact_id WHERE cv.id=?').get(id); if (!conv) return json(res, 404, { error: 'Чат не найден' }); if (b.channel_id) conv.channel_id = b.channel_id; if (b.chat_type) conv.chat_type = b.chat_type; if (b.chatId) conv.external_chat_id = b.chatId;
        // ссылка на вложение — только http(s) или наш /uploads/: javascript: и data: не пройдут
        const rawUri = String(b.contentUri || b.fileUrl || '').trim();
        if (rawUri && !/^(https?:\/\/|\/uploads\/)/i.test(rawUri)) return json(res, 400, { error: 'Ссылка на файл должна начинаться с http://, https:// или /uploads/' });
        if(user.role==='partner'&&/^https?:\/\//i.test(rawUri))return json(res,400,{error:'Партнёр прикладывает файл через загрузку в CRM. Внешние адреса не передаются в чате.'});
        const file = rawUri ? { contentUri: rawUri.slice(0, 2048) } : null;
        if (!String(b.body || '').trim() && !file) return json(res, 400, { error: 'Пустое сообщение: введите текст или приложите ссылку на файл' });
        // предел длины — как у мессенджеров: огромное сообщение вендор всё равно
        // не принял бы, а в базе и в ленте чата оно занимало бы мегабайты
        const msgText = String(b.body || '');
        if (msgText.length > 4096) return json(res, 400, { error: 'Сообщение длиннее 4096 символов: мессенджеры такие не принимают. Разбейте текст на несколько частей или приложите файл.' });
        const openForChat = db.prepare("SELECT id,responsible_id FROM deals WHERE contact_id=(SELECT contact_id FROM conversations WHERE id=?) AND stage NOT IN ('won','lost') ORDER BY id DESC LIMIT 20").all(id);
        let responseDealId = null;
        const requestedDealId=b.deal_id===undefined||b.deal_id===null||b.deal_id===''?0:Number(b.deal_id);
        if(requestedDealId&&(!Number.isSafeInteger(requestedDealId)||requestedDealId<1))return json(res,400,{error:'Выбранная сделка указана неверно.'});
        if (user.role === 'partner') {
          responseDealId=Number(partnerTransferForContact(user,conv.contact_id)?.deal_id)||null;
          if(requestedDealId&&requestedDealId!==responseDealId)return json(res,403,{error:'Можно отвечать только в контексте переданной сделки.'});
        } else if(user.role==='manager') {
          const visible=openForChat.filter(d=>managerOwns(user,'deals',d.id));
          if(requestedDealId){
            if(!managerOwns(user,'deals',requestedDealId)||!db.prepare('SELECT 1 x FROM deals WHERE id=? AND contact_id=?').get(requestedDealId,conv.contact_id))return json(res,403,{error:'Выбранная сделка не относится к вашим карточкам этого клиента.'});
            responseDealId=requestedDealId;
          }else if(visible.length===1)responseDealId=Number(visible[0].id);
          else if(visible.length>1)return json(res,400,{error:'У клиента несколько ваших сделок. Выберите, к какой из них относится ответ.'});
          else if(openForChat.some(d=>d.responsible_id&&db.prepare("SELECT 1 x FROM users WHERE id=? AND role='manager' AND id<>?").get(d.responsible_id,user.id)))return json(res,403,{error:'В этом чате есть сделка другого менеджера. Попросите выбрать корректный контекст.'});
        } else if(requestedDealId){
          if(!db.prepare('SELECT 1 x FROM deals WHERE id=? AND contact_id=?').get(requestedDealId,conv.contact_id))return json(res,400,{error:'Выбранная сделка не связана с этим клиентом.'});
          responseDealId=requestedDealId;
        }else if(openForChat.length===1)responseDealId=Number(openForChat[0].id);
        if (user.role === 'partner' && !responseDealId) return json(res, 403, { error: 'Для этого общего чата нет однозначной активной передачи сделки партнёру.' });
        let send = { delivered: false, mode: 'local' }, status = 'local'; const wantChannel = b.chat_type || b.channel || conv.chat_type || 'whatsapp';
        // письма идут через SMTP отдельным действием: мессенджер их не отправляет
        if (wantChannel === 'email') return json(res, 400, { error: 'Письмо отправляется кнопкой «Письмо» в шапке чата — через настроенный почтовый сервер' });
        try { send = await deliver(conv, wantChannel, msgText, user, file); status = send.delivered ? 'sent' : 'local'; }
        catch (e) {
          // без подключённого Wazzup сообщение сохраняется только в CRM
          if (String(e.message) === 'WAZZUP_NOT_CONFIGURED') { status = 'local'; send = { delivered: false, mode: 'local-only', hint: 'Wazzup не подключён — сообщение сохранено в CRM. Настройки → Интеграции: вставьте API-ключ Wazzup, и ответ уйдёт клиенту.' }; }
          else { status = 'error'; send = { delivered: false, mode: 'error: ' + e.message }; }
        }
        const body = msgText.trim() || (file ? '[вложение]' : '');
        const sendEventAt=status==='sent'?normalizeMessageEventTime(new Date().toISOString()):'';
        const insertOut = ext => db.prepare('INSERT INTO messages(conversation_id,deal_id,channel,direction,body,content_uri,content_name,content_type,content_size,status,external_id,author,channel_id,event_at,event_time_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, responseDealId, wantChannel, 'out', body, file?.contentUri || null, b.contentName ? safeFileName(b.contentName) : null, b.contentType || null, Number.isFinite(Number(b.contentSize)) && Number(b.contentSize) > 0 ? Math.min(Math.round(Number(b.contentSize)), 1e9) : null, status, ext, user.name, send.channelId || conv.channel_id || null,sendEventAt||null,sendEventAt?'crm':'');
        // внешний id уникален (защита от повторной доставки входящих), но если провайдер
        // вернул уже встречавшийся id, сообщение всё равно должно сохраниться в CRM
        let r; try { r = insertOut(send.id || null); }
        catch (e) { if (!/UNIQUE/i.test(e.message)) throw e; r = insertOut(null); }
        if (status === 'sent' && responseDealId) db.prepare(`UPDATE lead_routing SET first_response_at=datetime('now'),first_response_user_id=?
          WHERE deal_id=? AND first_response_at IS NULL AND assigned_at IS NOT NULL`).run(Number(user.id), responseDealId);
        db.prepare("UPDATE conversations SET last_at=datetime('now') WHERE id=?").run(id); broadcastMessage(r.lastInsertRowid); return json(res, 201, { message: messageViewForUser(db.prepare('SELECT * FROM messages WHERE id=?').get(r.lastInsertRowid),user), send }); }
    }
    const mEmail = p.match(/^\/api\/conversations\/(\d+)\/email$/);
    if (mEmail && req.method === 'POST') {
      // Предел частоты отправок: письма, отправленные потоком — случайно или
      // намеренно, — грозят блокировкой релея у почтового провайдера, а
      // разбирается с этим вся компания
      const rlMail = rateLimit('email:' + user.id, 20, 60000);
      if (!rlMail.ok) { res.setHeader('Retry-After', String(rlMail.retryAfter || 60)); return json(res, 429, { error: 'Слишком много писем за короткое время — сделайте паузу и повторите' }); }
      const b = await readBody(req);
      const conv = db.prepare('SELECT cv.*,c.phone,c.email FROM conversations cv LEFT JOIN contacts c ON c.id=cv.contact_id WHERE cv.id=?').get(mEmail[1]);
      if (!conv) return json(res, 404, { error: 'Чат не найден' });
      const openForMail = db.prepare("SELECT id FROM deals WHERE contact_id=? AND stage NOT IN ('won','lost') ORDER BY id DESC LIMIT 20").all(conv.contact_id);
      const mailDeal = user.role === 'partner' ? partnerTransferForContact(user, conv.contact_id)?.deal_id
        : (openForMail.filter(d => user.role !== 'manager' || managerOwns(user,'deals',d.id)).length === 1
          ? openForMail.filter(d => user.role !== 'manager' || managerOwns(user,'deals',d.id))[0].id : null);
      if (user.role === 'partner' && !mailDeal) return json(res,403,{error:'Для этого чата нет однозначной активной передачи сделки партнёру.'});
      const to = b.to || conv.email;
      if (!to) return json(res, 400, { error: 'У контакта не указан e-mail — добавьте его в карточке клиента' });
      if (!getSetting('SMTP_HOST')) return json(res, 400, { error: 'Почта не настроена: Настройки → Интеграции → Почта (SMTP)' });
      const mailText = String(b.body || '');
      if (mailText.length > 100000) return json(res, 400, { error: 'Письмо слишком длинное: предел 100 000 символов. Сократите текст или приложите документ ссылкой.' });
      let send = { delivered: false, mode: 'not-configured' }, status = 'error';
      try {
        const r = await sendMail({ ...smtpSettings(), to, toName: conv.title || '', subject: String(b.subject || '').slice(0, 200) || 'Письмо от ' + getSetting('COMPANY_NAME', 'CRM'), text: mailText });
        send = { delivered: true, mode: 'smtp', id: r.messageId }; status = 'sent';
      } catch (e) { send = { delivered: false, mode: 'error: ' + e.message } }
      const sendEventAt=status==='sent'?normalizeMessageEventTime(new Date().toISOString()):'';
      const ins = db.prepare('INSERT INTO messages(conversation_id,deal_id,channel,direction,body,subject,status,author,event_at,event_time_source) VALUES(?,?,?,?,?,?,?,?,?,?)').run(conv.id, mailDeal || null, 'email', 'out', mailText, String(b.subject || '').slice(0, 200), status, user.name,sendEventAt||null,sendEventAt?'crm':'');
      if (status === 'sent' && mailDeal) db.prepare(`UPDATE lead_routing SET first_response_at=datetime('now'),first_response_user_id=?
        WHERE deal_id=? AND first_response_at IS NULL AND assigned_at IS NOT NULL`).run(Number(user.id), Number(mailDeal));
      db.prepare("UPDATE conversations SET channels=?, last_at=datetime('now') WHERE id=?").run([...new Set([...(conv.channels || '').split(',').filter(Boolean), 'email'])].join(','), conv.id);
      broadcastMessage(ins.lastInsertRowid);
      return json(res, 201, { message: db.prepare('SELECT * FROM messages WHERE id=?').get(ins.lastInsertRowid), send });
    }
    // Медиа по ссылке, видимой в чате, всегда проходит через CRM. У внешней
    // ссылки Wazzup срок жизни ограничен и её нельзя отозвать; наружу её не
    // возвращаем. После проверки прав файл сохраняется локально и отдаётся через
    // защищённый маршрут /uploads, который повторно проверяет доступ при каждом запросе.
    const mFile=p.match(/^\/api\/messages\/(\d+)\/file$/);
    if(mFile&&req.method==='GET'){
      const id=Number(mFile[1]),row=db.prepare('SELECT id,conversation_id,deal_id,content_uri FROM messages WHERE id=?').get(id);
      if(!row)return json(res,404,{error:'Сообщение не найдено.'});
      if(!messageAttachmentAllowed(user,row))return json(res,403,{error:'Нет доступа к этому вложению.'});
      let uri=String(row.content_uri||'');
      if(/^https?:\/\//i.test(uri)){
        const rl=rateLimit('attachment-proxy:'+user.id,40,60000);
        if(!rl.ok){res.setHeader('Retry-After',String(rl.retryAfter||60));return json(res,429,{error:'Слишком много загрузок файла. Повторите позже.'});}
        const fetched=await refetchAttachment(id);
        if(fetched.status!==200)return json(res,fetched.status,fetched.body);
        uri=String(fetched.body.url||'');
      }
      if(!/^\/uploads\/[A-Za-z0-9._-]+$/.test(uri))return json(res,404,{error:'Вложение недоступно или ещё не сохранено в CRM.'});
      logAccess(user,'attachment_view','message',id,'GET');
      res.writeHead(302,{Location:uri,'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer'});return res.end();
    }
    // ===== вложение: забрать файл с адреса вендора повторно =====
    const mRefetch = p.match(/^\/api\/messages\/(\d+)\/refetch$/);
    if (mRefetch && req.method === 'POST') {
      const id = Number(mRefetch[1]);
      const row = db.prepare('SELECT conversation_id,deal_id FROM messages WHERE id=?').get(id);
      if (!row) return json(res, 404, { error: 'Сообщение не найдено' });
      // Право на вложение проверяется по самой сделке сообщения, а не только
      // по общему чату клиента: у контакта могут быть другие сделки.
      if (user.role === 'partner' && (!row.deal_id||!partnerOwns(user,'deals',row.deal_id)||!partnerOwns(user, 'conversations', row.conversation_id)))
        return json(res, 403, { error: 'Это чужой чат: партнёр видит только документы своих лидов' });
      // загрузка идёт во внешнюю сеть и весит до 15 МБ: частые нажатия кнопки
      // не должны превращаться в канал загрузки всего, что попало
      const rl = rateLimit('refetch:' + user.id, 20, 60000);
      if (!rl.ok) { res.setHeader('Retry-After', String(rl.retryAfter || 60)); return json(res, 429, { error: `Слишком много попыток. Повторите через ${rl.retryAfter || 60} с.` }) }
      const r = await refetchAttachment(id);
      if (r.status === 200) broadcastMessage(id);
      return json(res, r.status, r.body);
    }
    // ===== загрузка файла в чат (фото, документы) =====
    const mUpload = p.match(/^\/api\/conversations\/(\d+)\/upload$/);
    if (mUpload && req.method === 'POST') {
      const cid = Number(mUpload[1]);
      if (!db.prepare('SELECT id FROM conversations WHERE id=?').get(cid)) return json(res, 404, { error: 'Чат не найден' });
      const uploadRate = rateLimit('chat-upload:' + user.id, 20, 60000);
      if (!uploadRate.ok) { res.setHeader('Retry-After', String(uploadRate.retryAfter || 60)); return json(res, 429, { error: `Слишком много файлов за минуту. Повторите через ${uploadRate.retryAfter || 60} с.` }); }
      if (chatUploadsActive >= CHAT_UPLOADS_AT_ONCE) { res.setHeader('Retry-After','3'); return json(res, 429, { error: 'CRM уже принимает несколько больших файлов. Подождите пару секунд и повторите отправку.' }); }
      chatUploadsActive++;
      try {
        const b = await readBody(req, 22e6);
        const contentType = String(b.contentType || 'application/octet-stream').split(';')[0].trim().toLowerCase();
        if (!FILE_UPLOAD_TYPES.includes(contentType)) return json(res, 400, { error: 'Такой тип файла загружать нельзя. Доступны изображения, PDF, документы Word/Excel, CSV, TXT, ZIP, видео и звук.' });
        const raw = Buffer.from(String(b.dataBase64 || '').split(',').pop() || '', 'base64');
        if (!raw.length || raw.length > 15 * 1024 * 1024) return json(res, 400, { error: 'Файл пустой или превышает 15 МБ' });
        const extByType = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv', 'application/zip': 'zip', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
          'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/3gpp': '3gp', 'video/x-msvideo': 'avi',
          'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'weba', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr' };
        const ext = extByType[contentType] || 'bin';
        const safeName = safeFileName(b.filename || ('файл.' + ext));
        // Путь и MIME определяет проверенный contentType, не расширение из имени.
        // Иначе «фото.html» с заявленным image/png открывалось бы как HTML-файл,
        // ломало превью и могло получить неверный заголовок ответа.
        const storageName = asciiFileName(b.filename || ('file.' + ext));
        const storageBase = storageName.replace(/\.[A-Za-z0-9]{1,8}$/, '').slice(0, 96) || 'file';
        const stored = `${localDate().replace(/-/g, '')}-${randomBytes(6).toString('hex')}-${storageBase}.${ext}`;
        mkdir(UPLOAD_DIR, { recursive: true });
        storeUpload(stored, raw);
        // В журнал загрузка не пишется: файл тут же становится сообщением чата
        // с именем, форматом и размером — след живёт в самой переписке, а
        // недоотправленные остатки убирает ночная чистка сиротских файлов
        return json(res, 201, { url: '/uploads/' + stored, name: safeName, contentType, size: raw.length });
      } finally { chatUploadsActive = Math.max(0, chatUploadsActive - 1); }
    }
    // CSV export/import
    if (p === '/api/export/contacts') {
      if(!requireAdmin(user,res))return;
      logAccess(user,'export_contacts','contacts','',req.method);
      // Выгрузки — отдельная административная операция, не продолжение права читать карточки.
      const fields = getCustomFields().filter(f => f.entity === 'contacts' || f.entity === 'both');
      const rows = user.role === 'manager'
        ? db.prepare(`SELECT c.name,c.phone,c.email,c.company,c.source,c.tags,c.custom FROM contacts c WHERE ${managerContactScopeSql('c')} ORDER BY c.id DESC`).all(...managerContactParams(user))
        : db.prepare('SELECT name,phone,email,company,source,tags,custom FROM contacts ORDER BY id DESC').all();
      const outRows = rows.map(c => {
        let val = {}; try { val = JSON.parse(c.custom || '{}') } catch {}
        const out = { 'Имя': c.name, 'Телефон': c.phone, 'E-mail': c.email, 'Компания': c.company, 'Источник': c.source, 'Теги': c.tags };
        for (const f of fields) out[f.label] = val[f.key] ?? '';
        return out;
      });
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=contacts.csv' });
      return res.end('\ufeff' + csv(outRows));
    }
    if (p === '/api/export/deals') {
      if(!requireAdmin(user,res))return;
      logAccess(user,'export_deals','deals','',req.method);
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=deals.csv' });
      const rows = user.role === 'manager'
        ? db.prepare(`SELECT d.title 'Название',d.amount 'Бюджет',d.deal_object 'Объект',d.land_status 'Земля',d.construction_date 'Дата строительства',d.payment_type 'Тип оплаты',d.lead_source 'Источник лида',COALESCE(c.name,'') 'Клиент',COALESCE(c.phone,'') 'Телефон',d.stage 'Этап',d.priority 'Приоритет',COALESCE(d.deadline,'') 'Срок',COALESCE(d.loss_reason,'') 'Причина отказа',datetime(d.created_at,'localtime') 'Создана' FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id WHERE ${managerDealScopeSql('d')} ORDER BY d.id DESC`).all(...managerDealParams(user))
        : db.prepare(`SELECT d.title 'Название',d.amount 'Бюджет',d.deal_object 'Объект',d.land_status 'Земля',d.construction_date 'Дата строительства',d.payment_type 'Тип оплаты',d.lead_source 'Источник лида',COALESCE(c.name,'') 'Клиент',COALESCE(c.phone,'') 'Телефон',d.stage 'Этап',d.priority 'Приоритет',COALESCE(d.deadline,'') 'Срок',COALESCE(d.loss_reason,'') 'Причина отказа',datetime(d.created_at,'localtime') 'Создана' FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id ORDER BY d.id DESC`).all()
        // даты для Excel с русской локалью; неизвестный срок не маскируем датой.
        .map(r => ({ ...r, 'Дата строительства': r['Дата строительства']==='unknown'?'Не определена':displayDate(r['Дата строительства']), 'Срок':displayDate(r['Срок']), 'Создана':displayDate(r['Создана']) }));
      return res.end('﻿' + csv(rows));
    }
    if (p === '/api/import/contacts' && req.method === 'POST') {
      if(!['admin','manager'].includes(user.role))return json(res,403,{error:'Импорт доступен только администратору и менеджеру.'});
      logAccess(user,'import_contacts','contacts','',req.method);
      const b = await readBody(req);
      // CSV с кавычками: простой split по ; или , ломается на полях «Иван;Иванов»
      const parseCsvLine = line => { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++ } else q = !q } else if ((ch === ';' || ch === ',') && !q) { out.push(cur); cur = '' } else cur += ch } out.push(cur); return out.map(x => x.trim()) };
      // BOM (невидимый байт порядка байтов) встречается в файлах из Excel —
      // без снятия он приклеивался к имени первого контакта и ломал поиск
      const lines = String(b.csv || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
      if (!lines.length) return json(res, 400, { error: 'Пустой CSV — вставьте строки с контактами' });
      if (lines.length > 5001) return json(res, 400, { error: 'За один раз можно импортировать не больше 5000 контактов — разбейте файл на части' });
      // \b с кириллицей не работает («я» не входит в \w) — русский заголовок «Имя;…»
      // не определялся и импортировался контактом; lookahead покрывает оба алфавита
      const start = /^(имя|name)(?![а-яёa-z])/i.test(lines[0]) ? 1 : 0; // первая строка — заголовок
      let n = 0, skipped = 0;
      const exists = db.prepare('SELECT id FROM contacts WHERE phone_norm=?');
      const existsEmail = db.prepare('SELECT id FROM contacts WHERE lower(email)=lower(?)');
      const importedOwner=user.role==='manager'?Number(user.id):null;
      const ins = db.prepare('INSERT INTO contacts(name,phone,email,company,source,phone_norm,responsible_id) VALUES(?,?,?,?,?,?,?)');
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const line of lines.slice(start)) {
          const [name, phone, email, company] = parseCsvLine(line);
          if (!name) continue;
          const norm = digits(phone) || null;
          // лимиты те же, что у ручной карточки: файл на миллион строк не должен
          // попадать в базу целиком, а дубли сверяются уже с обрезанными значениями
          const mail = String(email || '').trim().slice(0, 254);
          // повторный импорт того же файла не плодит дубли: сверяем телефон,
          // а когда его нет — почту (раньше строки без телефона дублировались)
          if (norm ? exists.get(norm) : (mail && existsEmail.get(mail))) { skipped++; continue }
          ins.run(name.slice(0, 200), String(phone || '').slice(0, 64), mail, String(company || '').slice(0, 200), 'import', norm, importedOwner); n++;
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e }
      broadcast('change', { table: 'contacts' });
      return json(res, 200, { imported: n, skipped, message: skipped ? `Добавлено ${n}, пропущено дублей ${skipped}` : `Добавлено контактов: ${n}` });
    }

    // ===== channels & integrations (all configurable from UI) =====
    if (p === '/api/channels') {
      const rows = db.prepare('SELECT * FROM channels ORDER BY id DESC').all();
      // raw — технический ответ вендора со служебными полями: менеджерам
      // и наблюдателям он не нужен, а администратору помогает в диагностике
      return json(res, 200, user.role === 'admin' ? rows : rows.map(r => { const { raw, ...rest } = r; return rest; }));
    }
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
    if (p === '/api/integrations/wazzup/test' && req.method === 'POST') { if (!requireAdmin(user, res)) return; try { const list = wzChannels(await wazzupFetch('/channels')); return json(res, 200, { ok: true, channels: list }); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
    // Каналом по умолчанию становится рабочий: первым вендор может вернуть
    // отключённый или заблокированный, и ответы молча не уходили бы вовсе.
    if (p === '/api/integrations/wazzup/sync' && req.method === 'POST') { if (!requireAdmin(user, res)) return; try { const list = wzChannels(await wazzupFetch('/channels')); for (const ch of list) db.prepare('INSERT INTO channels(provider,external_id,name,transport,phone,state,raw) VALUES(?,?,?,?,?,?,?) ON CONFLICT(external_id) DO UPDATE SET name=excluded.name,transport=excluded.transport,phone=excluded.phone,state=excluded.state').run('wazzup', ch.channelId || ch.id, ch.name || ch.plainId || '', ch.transport || ch.type || '', ch.plainId || ch.phone || '', ch.state || '', JSON.stringify(ch));
      const usable = list.find(wzUsable) || list[0]; if (usable && !getSetting('WAZZUP_CHANNEL_ID')) setSetting('WAZZUP_CHANNEL_ID', usable.channelId || usable.id); return json(res, 200, { synced: list.length, channels: db.prepare("SELECT * FROM channels WHERE provider='wazzup'").all() }); } catch (e) { return json(res, 400, { error: e.message }); } }
    // Подписки обязательны: без них вендор не присылает события вовсе. Включаем
    // только те, которые наш обработчик разбирает. Лимит адреса — 200 символов,
    // как у вендора: длинный адрес он отклоняет, незачем отправлять отказной запрос.
    if (p === '/api/integrations/wazzup/webhook' && req.method === 'POST') { if (!requireAdmin(user, res)) return; const b = await readBody(req); let hookUrl = String(b.url || '').trim(); if (!/^https?:\/\//i.test(hookUrl) || hookUrl.length > 200) return json(res, 400, { error: 'Укажите корректный адрес вебхука: http/https, не длиннее 200 символов' });
      // адрес регистрируем только с секретом: без кода защиты принимать входящие
      // мог бы кто угодно; если секрет не задан, создаём его сами
      let hookSecret = getSetting('WAZZUP_WEBHOOK_SECRET');
      if (!hookSecret) { hookSecret = randomBytes(16).toString('hex'); setSetting('WAZZUP_WEBHOOK_SECRET', hookSecret); }
      const hookU = new URL(hookUrl);
      if (!hookU.searchParams.has('secret')) hookU.searchParams.set('secret', hookSecret);
      hookUrl = hookU.toString();
      try { await wazzupFetch('/webhooks', { method: 'PATCH', body: JSON.stringify({ webhooksUri: hookUrl, subscriptions: { messagesAndStatuses: true, channelsUpdates: true } }) }); setSetting('WAZZUP_WEBHOOK_URL', hookUrl); return json(res, 200, { saved: true }); } catch (e) { return json(res, 400, { error: e.message + ' — можно указать вебхук вручную в кабинете Wazzup' }); } }
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
        const out = await sendMail({ ...smtpSettings(), to, subject: 'КаркасCRM: проверка почты', text: `Почта настроена верно. Письмо отправлено ${new Date().toLocaleString('ru-RU')}.` });
        setSetting('SMTP_TEST_TO', to); logActivity(`Проверочное письмо отправлено на ${to}`, null, null, user.name);
        return json(res, 200, { ok: true, to, messageId: out.messageId });
      } catch (e) { return json(res, 400, { ok: false, error: e.message }) }
    }
    if (p === '/api/settings') {
      if (req.method === 'GET') {
        if (!requireAdmin(user, res)) return;
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
          advanced: { frame_ancestors: getSetting('FRAME_ANCESTORS'), login_rate_limit: num('LOGIN_RATE_LIMIT', 12), login_spray_limit: num('LOGIN_SPRAY_LIMIT', 30), login_flood_limit: num('LOGIN_FLOOD_LIMIT', 300) },
          auto_deal: getSetting('AUTO_DEAL', '1'), auto_assign: getSetting('AUTO_ASSIGN', '0'),
          routing: { default_team_id: defaultQueueTeamId(), shift_backlog_limit: Math.min(5,Math.max(0,Number(getSetting('SHIFT_BACKLOG_LIMIT','5'))||0)), classifier_user_id:Number(getSetting('LEAD_CLASSIFIER_USER_ID','0'))||null,
            partner_pipeline_id:partnerPipelineId()||null,partner_allowed_stages:[...partnerAllowedStages()],sla_assignment_minutes:Number(getSetting('SLA_ASSIGN_MINUTES','0'))||null,sla_first_response_minutes:Number(getSetting('SLA_FIRST_RESPONSE_MINUTES','0'))||null },
          webhook: { secret: getSetting('WEBHOOK_SECRET'), configured: !!getSetting('WEBHOOK_SECRET') },
          wazzup: { api_key: mask(getSetting('WAZZUP_API_KEY')), api_url: getSetting('WAZZUP_API_URL', 'https://api.wazzup24.com/v3'), channel_id: getSetting('WAZZUP_CHANNEL_ID'), webhook_secret: getSetting('WAZZUP_WEBHOOK_SECRET'), configured: !!getSetting('WAZZUP_API_KEY'), hook_last_at: getSetting('WZ_HOOK_LAST_AT') || '', hook_test_at: getSetting('WZ_HOOK_TEST_AT') || '', hook_last_human: wzHookHuman(getSetting('WZ_HOOK_LAST_AT')), hook_test_human: wzHookHuman(getSetting('WZ_HOOK_TEST_AT')), hook_msgs: Number(getSetting('WZ_HOOK_MSG_TOTAL', '0')) || 0, forward_url: getSetting('WAZZUP_FORWARD_URL') || '', webhook_url: getSetting('WAZZUP_WEBHOOK_URL') || '' }
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
        for(const k of ['AUTO_DEAL','AUTO_ASSIGN'])if(b[k]!==undefined){if(!['0','1',0,1,true,false].includes(b[k]))return json(res,400,{error:`Настройка ${k} принимает только «включено» или «выключено».`});setSetting(k,(b[k]===true||b[k]===1||b[k]==='1')?'1':'0');}
        if(b.SHIFT_BACKLOG_LIMIT!==undefined){const n=Number(b.SHIFT_BACKLOG_LIMIT);if(!Number.isSafeInteger(n)||n<0||n>5)return json(res,400,{error:'Лимит выдачи из очереди за смену должен быть от 0 до 5.'});setSetting('SHIFT_BACKLOG_LIMIT',String(n));}
        if(b.ROUTING_DEFAULT_TEAM_ID!==undefined){const n=Number(b.ROUTING_DEFAULT_TEAM_ID)||0;if(n&&!db.prepare('SELECT 1 x FROM teams WHERE id=? AND active=1').get(n))return json(res,400,{error:'Команда для новых лидов не найдена.'});if(n)setSetting('ROUTING_DEFAULT_TEAM_ID',String(n));else db.prepare("DELETE FROM settings WHERE key='ROUTING_DEFAULT_TEAM_ID'").run();}
        if(b.LEAD_CLASSIFIER_USER_ID!==undefined){const n=Number(b.LEAD_CLASSIFIER_USER_ID)||0;if(n&&!db.prepare("SELECT 1 x FROM users WHERE id=? AND active=1 AND role='classifier'").get(n))return json(res,400,{error:'Классификатор не найден или отключён.'});if(n)setSetting('LEAD_CLASSIFIER_USER_ID',String(n));else db.prepare("DELETE FROM settings WHERE key='LEAD_CLASSIFIER_USER_ID'").run();}
        if(b.PARTNER_TRANSFER_PIPELINE_ID!==undefined){const n=Number(b.PARTNER_TRANSFER_PIPELINE_ID)||0;if(n&&!db.prepare('SELECT 1 x FROM pipelines WHERE id=?').get(n))return json(res,400,{error:'Воронка передачи не найдена.'});if(n)setSetting('PARTNER_TRANSFER_PIPELINE_ID',String(n));else db.prepare("DELETE FROM settings WHERE key='PARTNER_TRANSFER_PIPELINE_ID'").run();}
        if(b.PARTNER_TRANSFER_ALLOWED_STAGES!==undefined){const list=[...new Set(String(b.PARTNER_TRANSFER_ALLOWED_STAGES||'').split(',').map(x=>x.trim()).filter(Boolean))];if(list.length>30)return json(res,400,{error:'Слишком много разрешённых этапов.'});const pid=Number(b.PARTNER_TRANSFER_PIPELINE_ID??getSetting('PARTNER_TRANSFER_PIPELINE_ID','0'))||0;if(list.length&&(!pid||list.some(code=>!db.prepare('SELECT 1 x FROM stages WHERE pipeline_id=? AND code=?').get(pid,code))))return json(res,400,{error:'Один из этапов не входит в выбранную воронку.'});if(list.length)setSetting('PARTNER_TRANSFER_ALLOWED_STAGES',list.join(','));else db.prepare("DELETE FROM settings WHERE key='PARTNER_TRANSFER_ALLOWED_STAGES'").run();}
        for(const [k,v]of [['SLA_ASSIGN_MINUTES',b.SLA_ASSIGN_MINUTES],['SLA_FIRST_RESPONSE_MINUTES',b.SLA_FIRST_RESPONSE_MINUTES]])if(v!==undefined){if(v===''||v===null){db.prepare('DELETE FROM settings WHERE key=?').run(k);continue;}const n=Number(v);if(!Number.isSafeInteger(n)||n<1||n>10080)return json(res,400,{error:'Порог SLA должен быть целым числом минут от 1 до 10080 либо не задан.'});setSetting(k,String(n));}
        for (const k of ['WAZZUP_API_URL', 'WAZZUP_CHANNEL_ID', 'WAZZUP_WEBHOOK_SECRET', 'COMPANY_NAME', 'CURRENCY', 'AUTO_DEAL', 'AUTO_DEAL_STAGE', 'AUTO_ASSIGN', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'MAIL_FROM', 'EMAIL_WEBHOOK_SECRET', 'NOTIFY_WEBHOOK', 'COMPANY_INN', 'COMPANY_KPP', 'COMPANY_OGRN', 'COMPANY_ADDRESS', 'COMPANY_PHONE', 'COMPANY_EMAIL', 'COMPANY_SITE', 'COMPANY_BANK', 'COMPANY_ACCOUNT', 'COMPANY_CORR', 'COMPANY_SIGNER', 'COMPANY_SIGNER_POSITION', 'DOC_PREFIX', 'SMTP_TEST_TO', 'WEBHOOK_SECRET']) if (b[k] !== undefined && !['AUTO_DEAL','AUTO_ASSIGN'].includes(k)) setSetting(k, clean(b[k]) ?? String(b[k]).slice(0, 512));
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
        if (b.LOGIN_SPRAY_LIMIT !== undefined) putNum('LOGIN_SPRAY_LIMIT', b.LOGIN_SPRAY_LIMIT, 10, 10000, 30);
        if (b.LOGIN_FLOOD_LIMIT !== undefined) putNum('LOGIN_FLOOD_LIMIT', b.LOGIN_FLOOD_LIMIT, 30, 10000, 300);
        // FRAME_ANCESTORS: только хосты и схемы — иначе ломаем CSP и сам заголовок
        if (b.FRAME_ANCESTORS !== undefined) {
          const fa = String(b.FRAME_ANCESTORS).replace(/[\r\n\t]/g, ' ').replace(/[^a-zA-Z0-9\s:'"*,.\/-]/g, '').trim().slice(0, 512);
          setSetting('FRAME_ANCESTORS', fa);
        }
        const revokedTransfers=revokeInvalidPartnerTransfers(user,'Администратор изменил разрешённую воронку или этапы передачи');
        if(revokedTransfers){
          logActivity(`Из-за изменения настроек доступа к сделкам лишились партнёры: ${revokedTransfers}`,'partner-transfers',null,user.name);
          broadcast('change',{table:'partner-transfers'});
        }
        logActivity('Настройки обновлены', null, null, user.name);
        // другие окна узнают об изменении настроек и перечитают свой кэш:
        // баннер регистрации вебхука и адрес CRM не устареют до перезагрузки
        broadcast('change', { table: 'settings' });
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
      logActivity('Демонстрационные данные удалены (' + removed + ' записей)', null, null, user.name);
      broadcast('change', { table: 'all' });
      return json(res, 200, { removed });
    }
    // ===== массовые действия: выделили записи и применили к ним одно изменение =====
    if (p === '/api/bulk' && req.method === 'POST') {
      // Пакетная операция — отдельное разрешение, а не следствие доступа к
      // одиночной карточке. Менеджер работает пачкой только со своими клиентами,
      // компаниями, задачами и сделками; переданные лиды и справочники закрыты.
      if (!['admin','manager'].includes(user.role))
        return json(res,403,{error:'Массовые действия доступны только администратору и менеджеру.'});
      const b = await readBody(req);
      const table = String(b.table || ''), ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean))];
      const fields = CRUD[table];
      if (!fields || !ids.length) return json(res, 400, { error: 'Нечего обрабатывать: укажите таблицу и хотя бы одну запись' });
      if (user.role === 'manager' && !['contacts','companies','tasks','deals'].includes(table))
        return json(res,403,{error:'Менеджер может выполнять массовые действия только со своими клиентами, компаниями, задачами и сделками.'});
      if (!['update','delete',undefined].includes(b.action)) return json(res,400,{error:'Неизвестное массовое действие'});
      if (ids.length > 500) return json(res, 400, { error: 'За один раз можно изменить не больше 500 записей' });
      if(user.role==='manager'&&ids.some(id=>!managerOwns(user,table,id)))return json(res,403,{error:'Массовое действие можно выполнить только над вашими карточками.'});
      if(user.role==='manager'&&b.action==='delete'&&!managerCanDelete(user,table,ids))return json(res,403,{error:'Удаление затронет данные другого сотрудника. Передайте карточку администратору.'});
      // Каталог — администраторская зона: массовые операции закрыты остальным
      // так же, как одиночные правки прайса
      if (table === 'products' && !requireAdmin(user, res)) return;
      if (b.action === 'delete' && table === 'automations' && !requireAdmin(user, res)) return;
      if (b.action === 'delete' && table === 'templates') {
        // шаблоны личные: массово удаляем только свои, чужие не трогаем
        const st = db.prepare('DELETE FROM templates WHERE id=? AND user_id=?');
        let done = 0; for (const id of ids) done += st.run(id, user.id).changes;
        broadcast('change', { table });
        return json(res, 200, { done, count: done });
      }
      let applied = 0;
      if (b.action === 'delete') {
        // пачка карточек теряет переписку и связи так же, как одна карточка,
        // поэтому порог подтверждения общий и считается одним запросом
        const bulkImpact = deleteImpact(table, ids);
        if (bulkImpact && !b.confirm) return json(res, 409, { error: 'Требуется подтверждение удаления', confirmDelete: true, impact: bulkImpact });
        const st = db.prepare(`DELETE FROM ${table} WHERE id=?`);
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const id of ids) {
            // связи рвём так же, как при одиночном удалении: иначе остаются «висячие» задачи и заметки
            detachChildren(table, id);
            applied += st.run(id).changes;
          }
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e }
        // удаление пачки записей — заметное действие: без строки в журнале
        // пропажа нескольких клиентов выглядела бы необъяснимой
        const bulkWords = bulkImpact ? '; ' + impactWords(bulkImpact) : '';
        logActivity(`Массовое удаление (${TABLE_RU[table] || table}): ${applied} ${ruPlural(applied, 'запись', 'записи', 'записей')}` + bulkWords, table, null, user.name);
      }
      else {
        const patch = {}; for (const k of Object.keys(b.patch || {})) if (fields.includes(k) && b.patch[k] !== undefined) patch[k] = b.patch[k];
        const ks = Object.keys(patch);
        if (!ks.length) return json(res, 400, { error: 'Не передано ни одного допустимого поля' });
        clampTexts(patch);
        if(user.role==='manager'&&patch.responsible_id!==undefined&&Number(patch.responsible_id)!==Number(user.id))
          return json(res,403,{error:'Передать записи другому сотруднику может администратор.'});
        // проверяем ссылки и значения до записи: массовая операция не должна
        // падать на середине и оставлять часть записей изменёнными
        if (patch.responsible_id) {
          patch.responsible_id = Number(patch.responsible_id);
          if (!Number.isInteger(patch.responsible_id) || !db.prepare('SELECT 1 x FROM users WHERE id=?').get(patch.responsible_id)) return json(res, 400, { error: 'Ответственный не найден — обновите страницу' });
        }
        if (table === 'contacts') {
          if (patch.name !== undefined && !String(patch.name || '').trim()) return json(res, 400, { error: 'Имя клиента не может быть пустым' });
          if (patch.company_id && !db.prepare('SELECT 1 x FROM companies WHERE id=?').get(patch.company_id)) return json(res, 400, { error: 'Компания не найдена — обновите страницу' });
          if(user.role==='manager'&&patch.company_id&&!managerOwns(user,'companies',Number(patch.company_id)))return json(res,403,{error:'Компания не входит в ваши карточки.'});
          if (patch.phone !== undefined) { ks.push('phone_norm'); patch.phone_norm = digits(patch.phone) || null; }
        }
        if(table==='notes'&&user.role==='manager'&&(patch.entity_type!==undefined||patch.entity_id!==undefined)){
          for(const id of ids){
            const cur=db.prepare('SELECT entity_type,entity_id FROM notes WHERE id=?').get(id);
            const entityType=patch.entity_type===undefined?cur?.entity_type:String(patch.entity_type);
            const entityId=patch.entity_id===undefined?Number(cur?.entity_id):Number(patch.entity_id);
            if(!managerOwns(user,entityType,entityId))return json(res,403,{error:'Заметку можно связать только с вашими карточками.'});
          }
        }
        if (table === 'tasks') {
          for (const [field, target] of [['deal_id', 'deals'], ['contact_id', 'contacts']]) {
            if (patch[field] && !db.prepare(`SELECT 1 x FROM ${target} WHERE id=?`).get(patch[field])) return json(res, 400, { error: 'Связанная запись не найдена — обновите страницу' });
            if(user.role==='manager'&&patch[field]&&!managerOwns(user,target,Number(patch[field])))return json(res,403,{error:'Задачу можно связать только с вашими карточками.'});
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
                if(user.role==='manager'&&val!==null&&!managerOwns(user,target,val))return json(res,403,{error:'Сделку можно связать только с вашими карточками.'});
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
            // дату закрытия храним, только если этап не менялся (правка суммы у
            // закрытой сделки); переход «успех → отказ» закрывает сделку новой
            // датой — как одиночная правка, иначе аналитика считает её старым месяцем
            n.closed_at = !['won', 'lost'].includes(n.stage) ? null
              : (d.stage === n.stage && d.closed_at ? d.closed_at : new Date().toISOString().slice(0, 19).replace('T', ' '));
            next.push(n);
          }
          const st = db.prepare(`UPDATE deals SET title=?,amount=?,stage=?,pipeline_id=?,contact_id=?,company_id=?,responsible=?,responsible_id=?,priority=?,loss_reason=?,deadline=?,custom=?,closed_at=?,updated_at=datetime('now') WHERE id=?`);
          db.exec('BEGIN IMMEDIATE');
          try { for (const n of next) applied += st.run(n.title, n.amount, n.stage, n.pipeline_id, n.contact_id, n.company_id, n.responsible, n.responsible_id, n.priority, n.loss_reason, n.deadline, n.custom, n.closed_at, n.id).changes; db.exec('COMMIT'); }
          catch (e) { db.exec('ROLLBACK'); throw e }
          // правила «сделку перевели на этап» срабатывают и при массовом переводе —
          // как при перетаскивании карточки и в одиночной карточке сделки
          if (patch.stage !== undefined) {
            for (let i = 0; i < next.length; i++) {
              if (rows[i].stage !== next[i].stage) {
                await runAutomations('stage_changed', { deal_id: next[i].id, stage: next[i].stage, contact_id: next[i].contact_id, actor_id: user.id });
              }
            }
          }
        } else {
          const st = db.prepare(`UPDATE ${table} SET ${ks.map(k => k + '=?').join(',')} WHERE id=?`);
          for (const id of ids) applied += st.run(...ks.map(k => patch[k]), id).changes;
          // массовое «Выполнено» продлевает повторяющиеся задачи так же, как
          // одиночное: иначе цепочка ежедневных задач обрывалась бы после отметки списком
          if (table === 'tasks' && Number(patch.done) === 1) for (const id of ids) extendRepeatingTask(id, user.name);
        }
        if (assignedTo && assignedCount && assignedTo !== Number(user.id)) {
          // одна сводка вместо сотни одинаковых тостов при массовой передаче
          broadcastTo(assignedTo, 'notify', { type: 'bulk_assigned', table, count: assignedCount });
        }
        logActivity(`Массовое изменение (${TABLE_RU[table] || table}): ${ids.length} ${ruPlural(ids.length, 'запись', 'записи', 'записей')} — ${ks.map(k => FIELD_RU[k] || k).join(', ')}`, table, null, user.name);
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

    // Загруженные файлы чатов: только для авторизованных по cookie или заголовку.
    if (p.startsWith('/uploads/')) {
      if (!user) return json(res, 401, sessionFailure(presented) || { error: 'Требуется авторизация' });
      if(!['admin','viewer','manager','partner'].includes(user.role))return json(res,403,{error:'Этой роли доступ к вложениям не предоставлен.'});
      if(['partner','manager'].includes(user.role)){
        const refs=db.prepare('SELECT id,conversation_id,deal_id FROM messages WHERE content_uri=?').all(p);
        const allowed=refs.filter(ref=>messageAttachmentAllowed(user,ref));
        if(!allowed.length)return json(res,403,{error:user.role==='partner'
          ?'Это чужой файл: партнёр видит только документы своих лидов'
          :'Это чужой файл: менеджер видит документы только своих лидов'});
      }
      logAccess(user,'attachment_view','upload',basename(p),'GET');
      const name = basename(safeDecode(p));
      if (!/^[A-Za-z0-9._-]+$/.test(name)) return json(res, 400, { error: 'Некорректное имя файла' });
      const src = join(UPLOAD_DIR, name);
      if (!src.startsWith(UPLOAD_DIR)) return json(res, 404, { error: 'Файл не найден' });
      // Не следуем по симлинкам из uploads: иначе файл с безопасным именем
      // мог бы открыть любой путь, доступный процессу. O_NOFOLLOW закрывает
      // гонку между lstat и open там, где ОС поддерживает этот флаг.
      let fd, st;
      try {
        const linkStat = lstatSync(src);
        if (!linkStat.isFile() || linkStat.isSymbolicLink()) return json(res, 404, { error: 'Файл не найден' });
        fd = openSync(src, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
        st = fstatSync(fd);
        if (!st.isFile()) { closeSync(fd); fd = null; return json(res, 404, { error: 'Файл не найден' }); }
      } catch {
        if (fd !== undefined && fd !== null) { try { closeSync(fd); } catch {} }
        return json(res, 404, { error: 'Файл не найден' });
      }
      const type = MIME[extname(src).toLowerCase()] || 'application/octet-stream';
      // SVG открываем только скачиванием: внутри svg возможен скрипт, а наша CSP
      // разрешает inline-скрипты для собственного интерфейса — нельзя давать
      // чужому файлу выполняться в странице CRM
      // Проигрыватель в странице работает только с inline: скачиваемый файл
      // открывался бы отдельной загрузкой на каждое нажатие «play».
      const inline = (type.startsWith('image/') && extname(src).toLowerCase() !== '.svg')
        || type === 'application/pdf' || type.startsWith('video/') || type.startsWith('audio/');
      const headers = {
        'Content-Type': type, 'Cache-Control': 'private, no-store, max-age=0',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
        ...((type.startsWith('video/') || type.startsWith('audio/')) ? { 'Accept-Ranges': 'bytes' } : {}),
      };
      const range = String(req.headers.range || '');
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (match && (type.startsWith('video/') || type.startsWith('audio/'))) {
        let start, end;
        if (match[1] === '') {
          const suffix = Number(match[2]);
          if (!Number.isSafeInteger(suffix) || suffix <= 0) { closeSync(fd); res.writeHead(416, { 'Content-Range': `bytes */${st.size}`, 'Accept-Ranges': 'bytes' }); return res.end(); }
          start = Math.max(0, st.size - suffix); end = st.size - 1;
        } else {
          start = Number(match[1]); end = match[2] ? Number(match[2]) : st.size - 1;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= st.size) {
            closeSync(fd);
            res.writeHead(416, { 'Content-Range': `bytes */${st.size}`, 'Accept-Ranges': 'bytes' }); return res.end();
          }
          end = Math.min(end, st.size - 1);
        }
        headers['Accept-Ranges'] = 'bytes';
        headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
        headers['Content-Length'] = end - start + 1;
        res.writeHead(206, headers);
        if (req.method === 'HEAD') { closeSync(fd); return res.end(); }
        return createReadStream(src, { fd, autoClose: true, start, end }).pipe(res);
      }
      headers['Content-Length'] = st.size;
      if (req.method === 'HEAD') { closeSync(fd); res.writeHead(200, headers); return res.end(); }
      res.writeHead(200, headers);
      return createReadStream(src, { fd, autoClose: true }).pipe(res);
    }

    // прежний адрес иконки: браузеры и старые закладки просят /favicon.ico,
    // отправляем их к векторному файлу одним ответом без тела
    if (p === '/favicon.ico') { res.writeHead(301, { Location: '/favicon.svg' }); return res.end(); }

    const publicRoot = resolve(PUBLIC_DIR);
    const inPublicRoot = candidate => {
      const rel = relative(publicRoot, candidate);
      return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
    };
    const staticCandidate = value => {
      const candidate = resolve(publicRoot, String(value || '').replace(/^[/\\\\]+/, ''));
      return inPublicRoot(candidate) ? candidate : resolve(publicRoot, 'index.html');
    };
    let file = staticCandidate(p === '/' ? 'index.html' : p);
    if (existsSync(file) && statSync(file).isDirectory()) file = staticCandidate(join(relative(publicRoot, file), 'index.html'));
    if (!inPublicRoot(file) || !existsSync(file)) file = resolve(publicRoot, 'index.html');
    const st = statSync(file);
    const ext = extname(file).toLowerCase();
    // no-cache — «храни, но сверяй с сервером перед каждым использованием»:
    // неизменный файл возвращается как 304 за сотни байт вместо полной
    // перекачки интерфейса при каждом открытии, а после обновления ETag
    // меняется и браузер сразу забирает новую версию, без жёсткой перезагрузки
    const cacheControl = 'no-cache';
    // ETag = размер+время файла: по нему браузер и сверяет свою копию
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
// медленные/зависшие клиенты не держат соединения и память бесконечно.
// Заголовки ограничены жёстко, а время на тело запроса большое намеренно:
// вложение 15 МБ уходит в теле примерно на 20 МБ, и с объекта на мобильной сети
// оно передаётся минуты. При прежних двух минутах такая загрузка обрывалась
// на середине, а человек видел ошибку связи.
server.headersTimeout = 30000;
server.requestTimeout = 600000;
server.keepAliveTimeout = 65000;
server.maxHeadersCount = 100;
mirrorSettingsToFile();
// unref: очередь работает, пока сервер жив, но не держит процесс в тестах
const campaignTimer = setInterval(campaignTick, 4000);
campaignTimer.unref();
campaignTick().catch(() => {});
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
  campaignTimer && clearInterval(campaignTimer);
  // PRAGMA optimize обновляет статистику для планировщика запросов: следующая
  // версия стартует с актуальными данными о том, как быстрее читать базу
  server.close(() => { try { db.exec('PRAGMA optimize'); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch {} process.exit(0); });
  // если что-то зависло — принудительный выход через 5 секунд
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', () => graceful('SIGTERM'));
process.on('SIGINT', () => graceful('SIGINT'));
// логируем, но не даём одному сбойному запросу убить всю CRM
process.on('uncaughtException', e => console.error('uncaughtException:', e));
process.on('unhandledRejection', e => console.error('unhandledRejection:', e));
export { db, getSetting, nowDue, normalizeDue, fixTaskDues, VERSION };
