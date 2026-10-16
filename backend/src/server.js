// KarkasCRM v2 — amoCRM-like: pipelines, companies, products, tasks, automations, analytics, Wazzup/WhatsApp/Telegram
// Zero external deps: Node >=22.5 (http, node:sqlite, crypto, fetch)
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCompetitors } from './competitors.js';

const PORT = process.env.PORT || 8080, HOST = process.env.HOST || '0.0.0.0';
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(ROOT, '../../data');
const PUBLIC_DIR = process.env.PUBLIC_DIR || join(ROOT, '../../frontend/public');
const SECRET = process.env.JWT_SECRET || 'change-me-in-production-please-32-chars';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin12345';
mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(join(DATA_DIR, 'crm.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE,pass TEXT,role TEXT DEFAULT 'manager',active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS companies(id INTEGER PRIMARY KEY,name TEXT NOT NULL,inn TEXT,phone TEXT,email TEXT,site TEXT,notes TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS contacts(id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT,email TEXT,company TEXT,company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,position TEXT,source TEXT DEFAULT 'manual',tags TEXT DEFAULT '',notes TEXT DEFAULT '',responsible_id INTEGER,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS pipelines(id INTEGER PRIMARY KEY,name TEXT NOT NULL,is_default INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS stages(id INTEGER PRIMARY KEY,pipeline_id INTEGER REFERENCES pipelines(id) ON DELETE CASCADE,code TEXT,name TEXT,color TEXT DEFAULT '#16a34a',sort INTEGER DEFAULT 0,kind TEXT DEFAULT 'open');
CREATE TABLE IF NOT EXISTS deals(id INTEGER PRIMARY KEY,title TEXT NOT NULL,amount INTEGER DEFAULT 0,stage TEXT DEFAULT 'new',pipeline_id INTEGER DEFAULT 1,contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,company_id INTEGER, responsible TEXT DEFAULT 'Администратор',responsible_id INTEGER,priority TEXT DEFAULT 'normal',loss_reason TEXT,deadline TEXT,closed_at TEXT,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY,title TEXT NOT NULL,type TEXT DEFAULT 'call',due TEXT,priority TEXT DEFAULT 'normal',done INTEGER DEFAULT 0,deal_id INTEGER,contact_id INTEGER,responsible_id INTEGER,result TEXT,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY,entity_type TEXT,entity_id INTEGER,body TEXT,author TEXT,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,name TEXT NOT NULL,sku TEXT,price INTEGER DEFAULT 0,unit TEXT DEFAULT 'шт',active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS deal_products(id INTEGER PRIMARY KEY,deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,product_id INTEGER,name TEXT,price INTEGER,qty REAL DEFAULT 1);
CREATE TABLE IF NOT EXISTS templates(id INTEGER PRIMARY KEY,name TEXT NOT NULL,body TEXT,channel TEXT DEFAULT 'whatsapp');
CREATE TABLE IF NOT EXISTS automations(id INTEGER PRIMARY KEY,name TEXT NOT NULL,trigger_type TEXT NOT NULL,trigger_value TEXT,action_type TEXT NOT NULL,action_value TEXT,active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS channels(id INTEGER PRIMARY KEY,provider TEXT DEFAULT 'wazzup',external_id TEXT UNIQUE,name TEXT,transport TEXT,phone TEXT,state TEXT,raw TEXT);
CREATE TABLE IF NOT EXISTS conversations(id INTEGER PRIMARY KEY,contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,title TEXT,channels TEXT DEFAULT '',channel_id TEXT,external_chat_id TEXT,chat_type TEXT,unread INTEGER DEFAULT 0,assigned_id INTEGER,last_at TEXT DEFAULT (datetime('now')),UNIQUE(contact_id));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,channel TEXT DEFAULT 'whatsapp',direction TEXT DEFAULT 'in',body TEXT,content_uri TEXT,status TEXT,external_id TEXT,author TEXT,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE IF NOT EXISTS activities(id INTEGER PRIMARY KEY,text TEXT,entity_type TEXT,entity_id INTEGER,user_name TEXT,created_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_ext ON messages(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
`);
// light migrations for v1 DBs
for (const [t, c, d] of [['contacts','company_id','INTEGER'],['contacts','position','TEXT'],['contacts','responsible_id','INTEGER'],['deals','pipeline_id','INTEGER DEFAULT 1'],['deals','priority',"TEXT DEFAULT 'normal'"],['deals','loss_reason','TEXT'],['deals','company_id','INTEGER'],['tasks','type',"TEXT DEFAULT 'call'"],['tasks','priority',"TEXT DEFAULT 'normal'"],['tasks','responsible_id','INTEGER'],['messages','content_uri','TEXT'],['messages','status','TEXT'],['conversations','channel_id','TEXT'],['conversations','external_chat_id','TEXT'],['conversations','chat_type','TEXT']]) {
  const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(r => r.name); if (!cols.includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`);
}
const getSetting = (k, d = '') => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value ?? process.env[k] ?? d;
const setSetting = (k, v) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v ?? ''));
const log = (text, et = null, eid = null, user = '') => db.prepare('INSERT INTO activities(text,entity_type,entity_id,user_name) VALUES(?,?,?,?)').run(text, et, eid, user);
const hashPass = (p, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(p, salt, 64).toString('hex')}`;
function checkPass(p, s) { try { const [salt, h] = String(s).split(':'); const a = Buffer.from(h, 'hex'), b = scryptSync(p, salt, 64); return a.length === b.length && timingSafeEqual(a, b); } catch { return false; } }
const sign = p => { const b = Buffer.from(JSON.stringify({ ...p, exp: Date.now() + 7 * 864e5 })).toString('base64url'); return b + '.' + createHmac('sha256', SECRET).update(b).digest('base64url'); };
function verify(t) { try { const [b, s] = t.split('.'); if (createHmac('sha256', SECRET).update(b).digest('base64url') !== s) return null; const p = JSON.parse(Buffer.from(b, 'base64url')); return p.exp > Date.now() ? p : null; } catch { return null; } }
const digits = s => String(s || '').replace(/\D/g, '').replace(/^8(?=\d{10}$)/, '7');

// ---------- seed ----------
if (!db.prepare('SELECT id FROM pipelines LIMIT 1').get()) {
  db.prepare('INSERT INTO pipelines(id,name,is_default) VALUES(1,?,1)').run('Основная воронка');
  const st = db.prepare('INSERT INTO stages(pipeline_id,code,name,color,sort,kind) VALUES(1,?,?,?,?,?)');
  [['new','Неразобранное','#f97316',0,'open'],['contact','Контакт установлен','#fb923c',1,'open'],['offer','Предложение / расчёт','#eab308',2,'open'],['negotiation','Переговоры','#22c55e',3,'open'],['decision','Принимают решение','#16a34a',4,'open'],['won','Успешно реализовано','#15803d',5,'won'],['lost','Закрыто и не реализовано','#78716c',6,'lost']].forEach(x => st.run(...x));
}
if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
  db.prepare('INSERT INTO users(name,email,pass,role) VALUES(?,?,?,?)').run('Администратор', ADMIN_EMAIL, hashPass(ADMIN_PASSWORD), 'admin');
  const comp = db.prepare('INSERT INTO companies(name,phone,email) VALUES(?,?,?)');
  const c1 = comp.run('СтройДом', '+7 495 111-22-33', 'info@stroydom.ru').lastInsertRowid;
  const c = db.prepare('INSERT INTO contacts(name,phone,email,company,company_id,source,tags) VALUES(?,?,?,?,?,?,?)');
  const ids = [c.run('Ирина Соколова', '+7 916 555-01-20', 'Иванова@example.com', 'СтройДом', c1, 'wazzup-whatsapp', 'VIP,дом').lastInsertRowid, c.run('Дмитрий Орлов', '+7 925 555-01-21', 'Орлов@example.com', 'ИП Орлов', null, 'wazzup-telegram', 'баня').lastInsertRowid, c.run('Анна Лебедева', '+7 903 555-01-22', 'Анна@example.com', '', null, 'site', 'дом 6x8').lastInsertRowid, c.run('Сергей Волков', '+7 999 555-01-23', 'Волков@example.com', 'Волков и Ко', null, 'wazzup-whatsapp', 'повторный').lastInsertRowid];
  const d = db.prepare('INSERT INTO deals(title,amount,stage,contact_id,deadline,priority) VALUES(?,?,?,?,date(\'now\',?),?)');
  d.run('Каркасный дом 8×10 «Север»', 3850000, 'new', ids[0], '+7 days', 'high'); d.run('Баня 4×6 под ключ', 890000, 'contact', ids[1], '+3 days', 'normal'); d.run('Дом 6×8 с террасой', 2640000, 'offer', ids[2], '+10 days', 'normal'); d.run('Дачный дом + хозблок', 1950000, 'negotiation', ids[3], '+5 days', 'low'); d.run('Каркасный дом 9×12', 4720000, 'won', ids[0], '-2 days', 'normal');
  db.prepare('INSERT INTO products(name,sku,price,unit) VALUES(?,?,?,?)').run('Каркасный дом 8×10 «Север»', 'DOM-810', 3850000, 'шт');
  db.prepare('INSERT INTO products(name,sku,price,unit) VALUES(?,?,?,?)').run('Баня 4×6 под ключ', 'BANYA-46', 890000, 'шт');
  db.prepare('INSERT INTO products(name,sku,price,unit) VALUES(?,?,?,?)').run('Фундамент на сваях', 'FUND-SVAI', 180000, 'компл.');
  db.prepare('INSERT INTO templates(name,body,channel) VALUES(?,?,?)').run('Приветствие', 'Здравствуйте, {name}! Спасибо за обращение в «Каркас». Отправляю расчёт — посмотрите, пожалуйста, и напишите, удобно ли созвониться.', 'whatsapp');
  db.prepare('INSERT INTO templates(name,body,channel) VALUES(?,?,?)').run('Напоминание о созвоне', 'Добрый день, {name}! Напоминаю о нашем созвоне сегодня. Подтвердите, пожалуйста, время.', 'whatsapp');
  db.prepare('INSERT INTO automations(name,trigger_type,trigger_value,action_type,action_value) VALUES(?,?,?,?,?)').run('Новая сделка → задача позвонить', 'deal_created', '', 'create_task', 'Позвонить новому клиенту');
  db.prepare('INSERT INTO automations(name,trigger_type,trigger_value,action_type,action_value) VALUES(?,?,?,?,?)').run('Входящее сообщение → задача при простое', 'message_in', '', 'create_task', 'Ответить на новое сообщение');
  db.prepare('INSERT INTO tasks(title,due,contact_id,type) VALUES(?,?,?,?)').run('Позвонить Ирине, уточнить участок', 'Сегодня 14:00', ids[0], 'call');
  db.prepare('INSERT INTO tasks(title,due,contact_id,type) VALUES(?,?,?,?)').run('Отправить расчёт бани Дмитрию', 'Завтра 10:00', ids[1], 'message');
  const conv = db.prepare('INSERT INTO conversations(contact_id,title,channels,unread,chat_type) VALUES(?,?,?,?,?)');
  const m = db.prepare('INSERT INTO messages(conversation_id,channel,direction,body,status) VALUES(?,?,?,?,?)');
  let cv = conv.run(ids[0], 'Ирина Соколова', 'whatsapp,telegram', 2, 'whatsapp').lastInsertRowid;
  m.run(cv, 'whatsapp', 'in', 'Здравствуйте! Интересует каркасный дом 8×10, что входит в комплектацию?', 'inbound'); m.run(cv, 'whatsapp', 'out', 'Здравствуйте, Ирина! Отправил презентацию и смету. Удобно созвониться сегодня?', 'read'); m.run(cv, 'telegram', 'in', 'Да, давайте в 14:00. И ещё вопрос по фундаменту на сваях.', 'inbound');
  cv = conv.run(ids[1], 'Дмитрий Орлов', 'whatsapp', 1, 'whatsapp').lastInsertRowid; m.run(cv, 'whatsapp', 'in', 'Добрый день, баню 4×6 можно посмотреть на производстве?', 'inbound');
  if (!getSetting('COMPANY_NAME')) { setSetting('COMPANY_NAME', 'Каркас — каркасные дома'); setSetting('CURRENCY', '₽'); setSetting('AUTO_DEAL', '1'); setSetting('AUTO_DEAL_STAGE', 'new'); }
  log('Система инициализирована: демо-данные, воронка, товары, шаблоны, автоматизации');
}
export function getStages(pipeline_id = 1) { return db.prepare('SELECT * FROM stages WHERE pipeline_id=? ORDER BY sort,id').all(pipeline_id); }

// ---------- realtime ----------
const clients = new Set();
export function broadcast(ev, data) { const s = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`; clients.forEach(r => { try { r.write(s); } catch {} }); }

// ---------- automations ----------
function runAutomations(trigger, ctx = {}) {
  for (const a of db.prepare('SELECT * FROM automations WHERE active=1 AND trigger_type=?').all(trigger)) {
    if (a.trigger_value && ctx.stage && a.trigger_value !== ctx.stage) continue;
    try {
      if (a.action_type === 'create_task' && (ctx.contact_id || ctx.deal_id)) db.prepare('INSERT INTO tasks(title,due,contact_id,deal_id) VALUES(?,?,?,?)').run(a.action_value || a.name, 'Сегодня', ctx.contact_id || null, ctx.deal_id || null);
      if (a.action_type === 'change_stage' && ctx.deal_id && a.action_value) db.prepare('UPDATE deals SET stage=? WHERE id=?').run(a.action_value, ctx.deal_id);
      if (a.action_type === 'add_tag' && ctx.contact_id && a.action_value) { const c = db.prepare('SELECT tags FROM contacts WHERE id=?').get(ctx.contact_id); const tags = [...new Set([...(c?.tags || '').split(',').filter(Boolean), a.action_value])].join(','); db.prepare('UPDATE contacts SET tags=? WHERE id=?').run(tags, ctx.contact_id); }
      log(`Автоматизация «${a.name}» сработала`);
    } catch (e) { console.error('automation', e); }
  }
}

// ---------- unified inbox ----------
export function upsertIncoming({ channel = 'whatsapp', chatType = '', phone = '', chatId = '', name = '', body = '', external_id = null, channelId = '', contentUri = '', author = '' }) {
  if (!body && !contentUri) return null;
  const ph = phone || (['whatsapp', 'viber'].includes(chatType || channel) ? chatId : '');
  let contact = ph ? db.prepare('SELECT * FROM contacts').all().find(c => digits(c.phone) && digits(c.phone) === digits(ph)) : null;
  if (!contact && chatId) { const conv0 = db.prepare('SELECT * FROM conversations WHERE external_chat_id=?').get(String(chatId)); if (conv0) contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(conv0.contact_id); }
  if (!contact) { const r = db.prepare('INSERT INTO contacts(name,phone,source) VALUES(?,?,?)').run(name || ph || chatId || 'Новый клиент', ph, 'wazzup-' + (chatType || channel)); contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(r.lastInsertRowid); log(`Новый контакт (${chatType || channel}): ${contact.name}`, 'contact', contact.id); }
  let conv = db.prepare('SELECT * FROM conversations WHERE contact_id=?').get(contact.id);
  let dealId = null;
  if (!conv) {
    const r = db.prepare('INSERT INTO conversations(contact_id,title,channels,channel_id,external_chat_id,chat_type) VALUES(?,?,?,?,?,?)').run(contact.id, contact.name, channel, channelId, String(chatId || ph || ''), chatType || channel);
    conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(r.lastInsertRowid);
    if (getSetting('AUTO_DEAL', '1') === '1') { const dr = db.prepare('INSERT INTO deals(title,amount,stage,contact_id) VALUES(?,?,?,?)').run('Обращение: ' + contact.name, 0, getSetting('AUTO_DEAL_STAGE', 'new'), contact.id); dealId = dr.lastInsertRowid; runAutomations('deal_created', { deal_id: dealId, contact_id: contact.id }); }
  }
  const channels = [...new Set([...(conv.channels || '').split(',').filter(Boolean), channel])].join(',');
  try { db.prepare('INSERT INTO messages(conversation_id,channel,direction,body,content_uri,status,external_id,author) VALUES(?,?,?,?,?,?,?,?)').run(conv.id, channel, 'in', body || '[вложение]', contentUri, 'inbound', external_id, author); }
  catch (e) { if (/UNIQUE/i.test(e.message)) return conv; console.error('message insert', e); throw e; }
  db.prepare("UPDATE conversations SET channels=?,channel_id=COALESCE(NULLIF(?,''),channel_id),external_chat_id=COALESCE(NULLIF(?,''),external_chat_id),chat_type=COALESCE(NULLIF(?,''),chat_type),unread=unread+1,last_at=datetime('now') WHERE id=?").run(channels, channelId, String(chatId || ''), chatType, conv.id);
  const openDeal = db.prepare("SELECT id FROM deals WHERE contact_id=? AND stage NOT IN ('won','lost') ORDER BY id DESC").get(contact.id);
  runAutomations('message_in', { contact_id: contact.id, deal_id: dealId || openDeal?.id });
  broadcast('message', { conversation_id: conv.id });
  return conv;
}

// ---------- providers ----------
async function wazzupFetch(path, opt = {}) {
  const key = getSetting('WAZZUP_API_KEY'); if (!key) throw new Error('Wazzup API-ключ не настроен');
  const base = (getSetting('WAZZUP_API_URL', 'https://api.wazzup24.com/v3')).replace(/\/$/, '');
  const res = await fetch(base + path, { ...opt, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...(opt.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.description || data?.error || `Wazzup API ${res.status}`);
  return data;
}
const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
export async function sendViaWazzup(conv, text, user, chatTypeOverride = '') {
  // Wazzup принимает только id канала в формате uuid — иначе отвечаем каналом по умолчанию из настроек
  const channelId = (isUuid(conv.channel_id) ? conv.channel_id : '') || getSetting('WAZZUP_CHANNEL_ID');
  if (!channelId) throw new Error('Не выбран канал Wazzup. Настройки → Интеграции → «Проверить и синхронизировать каналы», затем выберите канал по умолчанию.');
  const chatType = chatTypeOverride || conv.chat_type || 'whatsapp';
  // whatsapp/viber адресуются по номеру телефона, telegram/instagram — по идентификатору чата из вебхука
  const chatId = ['whatsapp', 'viber'].includes(chatType) ? (digits(conv.phone) || conv.external_chat_id) : (conv.external_chat_id || digits(conv.phone));
  const data = await wazzupFetch('/message', { method: 'POST', body: JSON.stringify({ channelId, chatType, chatId, text, crmMessageId: 'karkas-' + Date.now(), crmUserId: String(user?.id || '') }) });
  return { delivered: true, mode: 'wazzup', id: data.messageId || data.id };
}
async function sendWhatsAppDirect(to, text) {
  const token = getSetting('WHATSAPP_TOKEN'), phoneId = getSetting('WHATSAPP_PHONE_ID'); if (!token || !phoneId) return null;
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: digits(to), type: 'text', text: { body: text } }) });
  const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data?.error?.message || 'WhatsApp API ' + res.status);
  return { delivered: true, mode: 'whatsapp-cloud', id: data?.messages?.[0]?.id };
}
async function deliver(conv, channel, text, user) {
  const provider = getSetting('MESSENGER_PROVIDER', 'wazzup');
  if (provider === 'wazzup') { try { return await sendViaWazzup(conv, text, user, channel && channel !== 'site' ? channel : ''); } catch (e) { if (channel !== 'whatsapp') throw e; const d = await sendWhatsAppDirect(conv.phone, text).catch(() => null); if (d) return d; throw e; } }
  if (channel === 'whatsapp') { const d = await sendWhatsAppDirect(conv.phone, text); if (d) return d; }
  return { delivered: false, mode: 'local-only' };
}

// ---------- http ----------
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const readBody = async req => { let s = ''; for await (const ch of req) { s += ch; if (s.length > 5e6) throw new Error('Слишком большой запрос'); } try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const csv = rows => { if (!rows.length) return ''; const ks = Object.keys(rows[0]); const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`; return [ks.join(';'), ...rows.map(r => ks.map(k => q(r[k])).join(';'))].join('\n'); };
function requireAdmin(user, res) { if (user.role !== 'admin') { json(res, 403, { error: 'Только для администратора' }); return false; } return true; }

const competitorsApi = createCompetitors({ db, json, readBody, log, broadcast, getSetting, setSetting });
export const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`), p = u.pathname;
  try {
    // ===== public webhooks =====
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
    if (p === '/webhooks/whatsapp') {
      if (req.method === 'GET') { const ok = u.searchParams.get('hub.mode') === 'subscribe' && u.searchParams.get('hub.verify_token') === getSetting('WHATSAPP_VERIFY_TOKEN', 'karkas-verify'); res.writeHead(ok ? 200 : 403); return res.end(ok ? u.searchParams.get('hub.challenge') : 'forbidden'); }
      const payload = await readBody(req);
      for (const e of payload.entry || []) for (const ch of e.changes || []) for (const msg of ch.value?.messages || []) upsertIncoming({ channel: 'whatsapp', chatType: 'whatsapp', phone: '+' + msg.from, name: ch.value.contacts?.find(c => c.wa_id === msg.from)?.profile?.name || '', body: msg.text?.body || '[медиа]', external_id: msg.id });
      return json(res, 200, { received: true });
    }
    if ((p === '/webhooks/telegram' || p === '/webhooks/generic') && req.method === 'POST') { const b = await readBody(req); const msg = b.message || b; upsertIncoming({ channel: p.includes('telegram') ? 'telegram' : (b.channel || 'site'), chatType: b.chatType || '', phone: b.phone || msg.chat?.id || '', chatId: b.chatId || '', name: msg.from?.first_name || b.name || '', body: msg.text || b.body || '', external_id: msg.message_id ? `tg-${msg.message_id}` : (b.external_id || null) }); return json(res, 200, { received: true }); }
    if (p === '/api/health') return json(res, 200, { ok: true, service: 'KarkasCRM', version: '2.0', time: new Date().toISOString() });
    if (p === '/api/auth/login' && req.method === 'POST') { const b = await readBody(req); const user = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(String(b.email || '').toLowerCase()); if (!user || !checkPass(String(b.password || ''), user.pass)) return json(res, 401, { error: 'Неверный e-mail или пароль' }); return json(res, 200, { token: sign({ id: user.id, email: user.email, name: user.name, role: user.role }), user: { id: user.id, name: user.name, email: user.email, role: user.role } }); }

    const user = verify((req.headers.authorization || '').replace('Bearer ', '') || u.searchParams.get('token') || '');
    if (p.startsWith('/api/') && !user) return json(res, 401, { error: 'Требуется авторизация' });
    if (p === '/api/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.write('event: ready\ndata: {}\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return; }
    if (p === '/api/me') return json(res, 200, { user });
    if (user && p.startsWith('/api/') && user.role === 'viewer' && req.method !== 'GET') return json(res, 403, { error: 'Роль «Наблюдатель» — только просмотр' });

    // ===== dashboard / analytics =====
    if (p === '/api/dashboard') {
      const deals = db.prepare('SELECT * FROM deals').all(), stages = getStages(Number(u.searchParams.get('pipeline') || 1));
      return json(res, 200, { stages: stages.map(s => ({ ...s, count: deals.filter(d => d.stage === s.code).length, sum: deals.filter(d => d.stage === s.code).reduce((a, d) => a + d.amount, 0) })), dealsTotal: deals.filter(d => !['won', 'lost'].includes(d.stage)).length, revenue: deals.filter(d => d.stage === 'won').reduce((a, d) => a + d.amount, 0), lostSum: deals.filter(d => d.stage === 'lost').reduce((a, d) => a + d.amount, 0), contacts: db.prepare('SELECT COUNT(*) n FROM contacts').get().n, companies: db.prepare('SELECT COUNT(*) n FROM companies').get().n, unread: db.prepare('SELECT COALESCE(SUM(unread),0) n FROM conversations').get().n, tasksOpen: db.prepare('SELECT COUNT(*) n FROM tasks WHERE done=0').get().n, tasksOverdue: db.prepare("SELECT COUNT(*) n FROM tasks WHERE done=0 AND due LIKE '20%' AND due < datetime('now')").get().n, activities: db.prepare('SELECT * FROM activities ORDER BY id DESC LIMIT 10').all(), recentDeals: db.prepare('SELECT d.*,c.name contact_name FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id ORDER BY d.id DESC LIMIT 6').all() });
    }
    if (p === '/api/analytics') {
      const deals = db.prepare('SELECT d.*,c.source FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id').all(); const won = deals.filter(d => d.stage === 'won'), lost = deals.filter(d => d.stage === 'lost');
      const by = (arr, key) => Object.values(arr.reduce((a, x) => { const k = x[key] || '—'; a[k] = a[k] || { name: k, count: 0, sum: 0 }; a[k].count++; a[k].sum += x.amount || 0; return a; }, {}));
      return json(res, 200, { conversion: deals.length ? Math.round(won.length / Math.max(1, won.length + lost.length) * 100) : 0, avgCheck: won.length ? Math.round(won.reduce((a, d) => a + d.amount, 0) / won.length) : 0, forecast: deals.filter(d => !['won', 'lost'].includes(d.stage)).reduce((a, d) => a + d.amount, 0), bySource: by(deals, 'source'), byManager: by(deals, 'responsible'), byLoss: by(lost, 'loss_reason'), stages: getStages().map(s => ({ name: s.name, code: s.code, count: deals.filter(d => d.stage === s.code).length, sum: deals.filter(d => d.stage === s.code).reduce((a, x) => a + x.amount, 0) })) });
    }
    if (p === '/api/search') { const q = '%' + (u.searchParams.get('q') || '') + '%'; return json(res, 200, { contacts: db.prepare('SELECT id,name,phone FROM contacts WHERE name LIKE ? OR phone LIKE ? LIMIT 8').all(q, q), deals: db.prepare('SELECT id,title,amount FROM deals WHERE title LIKE ? LIMIT 8').all(q), companies: db.prepare('SELECT id,name FROM companies WHERE name LIKE ? LIMIT 5').all(q) }); }
    if (p === '/api/backup') { const tables = ['users', 'companies', 'contacts', 'pipelines', 'stages', 'deals', 'tasks', 'notes', 'products', 'templates', 'automations', 'conversations', 'messages', 'channels']; const out = {}; tables.forEach(t => out[t] = db.prepare(`SELECT * FROM ${t}`).all()); res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename=karkas-backup.json' }); return res.end(JSON.stringify(out, null, 2)); }

    // ===== generic CRUD =====
    const CRUD = { contacts: ['name', 'phone', 'email', 'company', 'company_id', 'position', 'source', 'tags', 'notes', 'responsible_id'], companies: ['name', 'inn', 'phone', 'email', 'site', 'notes'], tasks: ['title', 'type', 'due', 'priority', 'done', 'deal_id', 'contact_id', 'responsible_id', 'result'], products: ['name', 'sku', 'price', 'unit', 'active'], templates: ['name', 'body', 'channel'], automations: ['name', 'trigger_type', 'trigger_value', 'action_type', 'action_value', 'active'], notes: ['entity_type', 'entity_id', 'body', 'author'] };
    const mCrud = p.match(/^\/api\/(contacts|companies|tasks|products|templates|automations|notes)(?:\/(\d+))?$/);
    if (mCrud) { const [, table, id] = mCrud; const fields = CRUD[table];
      if (req.method === 'GET' && !id) { if (table === 'tasks') return json(res, 200, db.prepare('SELECT t.*,c.name contact_name,d.title deal_title FROM tasks t LEFT JOIN contacts c ON c.id=t.contact_id LEFT JOIN deals d ON d.id=t.deal_id ORDER BY done,due,id DESC').all()); if (table === 'notes') return json(res, 200, db.prepare('SELECT * FROM notes WHERE entity_type=? AND entity_id=? ORDER BY id DESC').all(u.searchParams.get('type'), u.searchParams.get('entity'))); return json(res, 200, db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all()); }
      if (req.method === 'GET') return json(res, 200, db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) || {});
      if (req.method === 'POST') { const b = await readBody(req); if (table === 'notes') b.author = user.name; const ks = fields.filter(f => b[f] !== undefined); const r = db.prepare(`INSERT INTO ${table}(${ks}) VALUES(${ks.map(() => '?')})`).run(...ks.map(k => b[k])); log(`Создано (${table} #${r.lastInsertRowid})`, table, Number(r.lastInsertRowid), user.name); broadcast('change', { table }); return json(res, 201, db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(r.lastInsertRowid)); }
      if (req.method === 'PATCH' && id) { const b = await readBody(req); const ks = Object.keys(b).filter(k => fields.includes(k)); if (ks.length) db.prepare(`UPDATE ${table} SET ${ks.map(k => k + '=?')} WHERE id=?`).run(...ks.map(k => b[k]), id); broadcast('change', { table }); return json(res, 200, db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id)); }
      if (req.method === 'DELETE' && id) { db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id); broadcast('change', { table }); return json(res, 200, { deleted: true }); }
    }
    // ===== pipelines & stages (configurable) =====
    if (p === '/api/pipelines') {
      if (req.method === 'GET') return json(res, 200, db.prepare('SELECT * FROM pipelines ORDER BY id').all().map(pl => ({ ...pl, stages: getStages(pl.id) })));
      if (req.method === 'POST') { if (!requireAdmin(user, res)) return; const b = await readBody(req); const r = db.prepare('INSERT INTO pipelines(name) VALUES(?)').run(b.name || 'Новая воронка'); const st = db.prepare('INSERT INTO stages(pipeline_id,code,name,color,sort,kind) VALUES(?,?,?,?,?,?)'); [['new', 'Неразобранное', '#f97316', 0, 'open'], ['won', 'Успешно реализовано', '#15803d', 1, 'won'], ['lost', 'Закрыто и не реализовано', '#78716c', 2, 'lost']].forEach(x => st.run(r.lastInsertRowid, ...x)); return json(res, 201, { id: r.lastInsertRowid }); }
    }
    const mPipe = p.match(/^\/api\/pipelines\/(\d+)$/);
    if (mPipe && req.method === 'PUT') { if (!requireAdmin(user, res)) return; const b = await readBody(req); db.prepare('UPDATE pipelines SET name=? WHERE id=?').run(b.name, mPipe[1]); db.prepare('DELETE FROM stages WHERE pipeline_id=?').run(mPipe[1]); const st = db.prepare('INSERT INTO stages(pipeline_id,code,name,color,sort,kind) VALUES(?,?,?,?,?,?)'); (b.stages || []).forEach((s, i) => st.run(mPipe[1], s.code || ('s' + Date.now() + i), s.name, s.color || '#16a34a', i, s.kind || 'open')); log('Воронка и этапы обновлены', 'pipelines', Number(mPipe[1]), user.name); return json(res, 200, { saved: true }); }
    if (mPipe && req.method === 'DELETE') { if (!requireAdmin(user, res)) return; db.prepare('DELETE FROM pipelines WHERE id=?').run(mPipe[1]); return json(res, 200, { deleted: true }); }

    // ===== deals =====
    if (p === '/api/deals') {
      if (req.method === 'GET') return json(res, 200, { pipelines: db.prepare('SELECT * FROM pipelines').all(), stages: getStages(Number(u.searchParams.get('pipeline') || 1)), deals: db.prepare('SELECT d.*,c.name contact_name,c.phone contact_phone,co.name company_name FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id LEFT JOIN companies co ON co.id=d.company_id ORDER BY d.id DESC').all() });
      if (req.method === 'POST') { const b = await readBody(req); const fields = ['title', 'amount', 'stage', 'pipeline_id', 'contact_id', 'company_id', 'responsible', 'responsible_id', 'priority', 'loss_reason', 'deadline']; const ks = fields.filter(f => b[f] !== undefined); const r = db.prepare(`INSERT INTO deals(${ks}) VALUES(${ks.map(() => '?')})`).run(...ks.map(k => b[k])); log(`Сделка создана: ${b.title}`, 'deals', Number(r.lastInsertRowid), user.name); runAutomations('deal_created', { deal_id: Number(r.lastInsertRowid), contact_id: b.contact_id }); broadcast('change', { table: 'deals' }); return json(res, 201, db.prepare('SELECT * FROM deals WHERE id=?').get(r.lastInsertRowid)); }
    }
    const mDeal = p.match(/^\/api\/deals\/(\d+)(?:\/(products))?$/);
    if (mDeal) { const id = mDeal[1];
      if (mDeal[2] === 'products') {
        if (req.method === 'GET') return json(res, 200, db.prepare('SELECT * FROM deal_products WHERE deal_id=?').all(id));
        if (req.method === 'POST') { const b = await readBody(req); const pr = b.product_id ? db.prepare('SELECT * FROM products WHERE id=?').get(b.product_id) : null; const r = db.prepare('INSERT INTO deal_products(deal_id,product_id,name,price,qty) VALUES(?,?,?,?,?)').run(id, b.product_id || null, b.name || pr?.name, b.price ?? pr?.price ?? 0, b.qty || 1); const sum = db.prepare('SELECT COALESCE(SUM(price*qty),0) s FROM deal_products WHERE deal_id=?').get(id).s; db.prepare('UPDATE deals SET amount=? WHERE id=?').run(sum, id); broadcast('change', { table: 'deals' }); return json(res, 201, db.prepare('SELECT * FROM deal_products WHERE id=?').get(r.lastInsertRowid)); }
        return json(res, 405, { error: 'Метод не поддерживается' });
      }
      if (req.method === 'GET') { const deal = db.prepare('SELECT d.*,c.name contact_name,c.phone contact_phone FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id WHERE d.id=?').get(id); return json(res, 200, { deal, notes: db.prepare("SELECT * FROM notes WHERE entity_type='deals' AND entity_id=? ORDER BY id DESC").all(id), tasks: db.prepare('SELECT * FROM tasks WHERE deal_id=? ORDER BY id DESC').all(id), products: db.prepare('SELECT * FROM deal_products WHERE deal_id=?').all(id), history: db.prepare("SELECT * FROM activities WHERE entity_type='deals' AND entity_id=? ORDER BY id DESC LIMIT 20").all(id) }); }
      if (req.method === 'PATCH') { const b = await readBody(req); const old = db.prepare('SELECT * FROM deals WHERE id=?').get(id); const fields = ['title', 'amount', 'stage', 'pipeline_id', 'contact_id', 'company_id', 'responsible', 'responsible_id', 'priority', 'loss_reason', 'deadline']; const ks = Object.keys(b).filter(k => fields.includes(k)); if (ks.length) db.prepare(`UPDATE deals SET ${ks.map(k => k + '=?')},updated_at=datetime('now')${b.stage && ['won', 'lost'].includes(b.stage) ? ",closed_at=datetime('now')" : ''} WHERE id=?`).run(...ks.map(k => b[k]), id); if (b.stage && old && b.stage !== old.stage) { const s = db.prepare('SELECT name FROM stages WHERE code=?').get(b.stage); log(`Сделка «${old.title}» → этап «${s?.name || b.stage}»`, 'deals', Number(id), user.name); runAutomations('stage_changed', { deal_id: Number(id), contact_id: old.contact_id, stage: b.stage }); } broadcast('change', { table: 'deals' }); return json(res, 200, db.prepare('SELECT * FROM deals WHERE id=?').get(id)); }
      if (req.method === 'DELETE') { db.prepare('DELETE FROM deals WHERE id=?').run(id); return json(res, 200, { deleted: true }); }
    }
    const mDp = p.match(/^\/api\/deal_products\/(\d+)$/);
    if (mDp) { const id = mDp[1]; const row = db.prepare('SELECT * FROM deal_products WHERE id=?').get(id); if (!row) return json(res, 404, { error: 'Позиция не найдена' });
      if (req.method === 'PATCH') { const b = await readBody(req); db.prepare('UPDATE deal_products SET qty=?,price=? WHERE id=?').run(b.qty ?? row.qty, b.price ?? row.price, id); }
      if (req.method === 'DELETE') db.prepare('DELETE FROM deal_products WHERE id=?').run(id);
      const sum = db.prepare('SELECT COALESCE(SUM(price*qty),0) s FROM deal_products WHERE deal_id=?').get(row.deal_id).s; db.prepare('UPDATE deals SET amount=? WHERE id=?').run(sum, row.deal_id); return json(res, 200, { saved: true, amount: sum }); }
    // ===== users / team =====
    if (p === '/api/users') {
      if (req.method === 'GET') return json(res, 200, db.prepare('SELECT id,name,email,role,active FROM users ORDER BY id').all());
      if (req.method === 'POST') { if (!requireAdmin(user, res)) return; const b = await readBody(req); const r = db.prepare('INSERT INTO users(name,email,pass,role) VALUES(?,?,?,?)').run(b.name, String(b.email).toLowerCase(), hashPass(b.password || 'user12345'), b.role || 'manager'); return json(res, 201, { id: r.lastInsertRowid }); }
    }
    const mUser = p.match(/^\/api\/users\/(\d+)$/);
    if (mUser && req.method === 'PATCH') { if (!requireAdmin(user, res) && Number(mUser[1]) !== user.id) return; const b = await readBody(req); if (b.password) db.prepare('UPDATE users SET pass=? WHERE id=?').run(hashPass(b.password), mUser[1]); const ks = ['name', 'role', 'active'].filter(k => b[k] !== undefined); if (ks.length) db.prepare(`UPDATE users SET ${ks.map(k => k + '=?')} WHERE id=?`).run(...ks.map(k => b[k]), mUser[1]); return json(res, 200, { saved: true }); }
    if (p === '/api/me/password' && req.method === 'POST') { const b = await readBody(req); const me = db.prepare('SELECT * FROM users WHERE id=?').get(user.id); if (!checkPass(b.old || '', me.pass)) return json(res, 400, { error: 'Старый пароль неверен' }); db.prepare('UPDATE users SET pass=? WHERE id=?').run(hashPass(b.next), user.id); return json(res, 200, { saved: true }); }

    // ===== inbox =====
    if (p === '/api/conversations' && req.method === 'GET') return json(res, 200, db.prepare(`SELECT cv.*,c.phone,c.email,(SELECT body FROM messages WHERE conversation_id=cv.id ORDER BY id DESC LIMIT 1) last_body FROM conversations cv LEFT JOIN contacts c ON c.id=cv.contact_id ORDER BY cv.last_at DESC, cv.id DESC`).all());
    const mConv = p.match(/^\/api\/conversations\/(\d+)\/messages$/);
    if (mConv) { const id = mConv[1];
      if (req.method === 'GET') { db.prepare('UPDATE conversations SET unread=0 WHERE id=?').run(id); return json(res, 200, db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY id').all(id)); }
      if (req.method === 'POST') { const b = await readBody(req); const conv = db.prepare('SELECT cv.*,c.phone FROM conversations cv LEFT JOIN contacts c ON c.id=cv.contact_id WHERE cv.id=?').get(id); if (!conv) return json(res, 404, { error: 'Чат не найден' }); if (b.channel_id) conv.channel_id = b.channel_id; if (b.chat_type) conv.chat_type = b.chat_type; if (b.chatId) conv.external_chat_id = b.chatId; let send = { delivered: false, mode: 'local' }, status = 'local'; const wantChannel = b.chat_type || b.channel || conv.chat_type || 'whatsapp'; try { send = await deliver(conv, wantChannel, b.body, user); status = send.delivered ? 'sent' : 'local'; } catch (e) { status = 'error'; send = { delivered: false, mode: 'error: ' + e.message }; } const tpl = b.body; const r = db.prepare('INSERT INTO messages(conversation_id,channel,direction,body,status,external_id,author) VALUES(?,?,?,?,?,?,?)').run(id, wantChannel, 'out', tpl, status, send.id || null, user.name); db.prepare("UPDATE conversations SET last_at=datetime('now') WHERE id=?").run(id); broadcast('message', { conversation_id: Number(id) }); return json(res, 201, { message: db.prepare('SELECT * FROM messages WHERE id=?').get(r.lastInsertRowid), send }); }
    }
    if (p === '/api/inbox/simulate' && req.method === 'POST') { const b = await readBody(req); const conv = upsertIncoming({ channel: b.channel || 'whatsapp', chatType: b.channel || 'whatsapp', phone: b.phone || '+7 900 000-00-00', name: b.name || 'Тестовый клиент', body: b.body || 'Здравствуйте! Хочу расчёт дома.' }); return json(res, 201, { conversation_id: conv?.id }); }
    // CSV export/import
    if (p === '/api/export/contacts') { res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=contacts.csv' }); return res.end('﻿' + csv(db.prepare('SELECT name,phone,email,company,source,tags FROM contacts').all())); }
    if (p === '/api/export/deals') { res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=deals.csv' }); return res.end('﻿' + csv(db.prepare('SELECT title,amount,stage,priority,deadline,created_at FROM deals').all())); }
    if (p === '/api/import/contacts' && req.method === 'POST') { const b = await readBody(req); const lines = String(b.csv || '').split(/\r?\n/).slice(1).filter(Boolean); let n = 0; for (const line of lines) { const [name, phone, email, company] = line.split(/;|,/).map(x => x.replace(/^"|"$/g, '')); if (name) { db.prepare('INSERT INTO contacts(name,phone,email,company,source) VALUES(?,?,?,?,?)').run(name, phone || '', email || '', company || '', 'import'); n++; } } return json(res, 200, { imported: n }); }

    // ===== channels & integrations (all configurable from UI) =====
    if (p === '/api/channels') return json(res, 200, db.prepare('SELECT * FROM channels ORDER BY id DESC').all());
    if (p === '/api/integrations/wazzup/test' && req.method === 'POST') { try { const data = await wazzupFetch('/channels'); const list = data.channels || data.data || data || []; return json(res, 200, { ok: true, channels: list }); } catch (e) { return json(res, 400, { ok: false, error: e.message }); } }
    if (p === '/api/integrations/wazzup/sync' && req.method === 'POST') { try { const data = await wazzupFetch('/channels'); const list = data.channels || data.data || []; for (const ch of list) db.prepare('INSERT INTO channels(provider,external_id,name,transport,phone,state,raw) VALUES(?,?,?,?,?,?,?) ON CONFLICT(external_id) DO UPDATE SET name=excluded.name,transport=excluded.transport,phone=excluded.phone,state=excluded.state').run('wazzup', ch.channelId || ch.id, ch.name || ch.plainId || '', ch.transport || ch.type || '', ch.plainId || ch.phone || '', ch.state || '', JSON.stringify(ch)); if (list[0] && !getSetting('WAZZUP_CHANNEL_ID')) setSetting('WAZZUP_CHANNEL_ID', list[0].channelId || list[0].id); return json(res, 200, { synced: list.length, channels: db.prepare("SELECT * FROM channels WHERE provider='wazzup'").all() }); } catch (e) { return json(res, 400, { error: e.message }); } }
    if (p === '/api/integrations/wazzup/webhook' && req.method === 'POST') { const b = await readBody(req); try { await wazzupFetch('/webhooks', { method: 'PATCH', body: JSON.stringify({ webhooksUri: b.url }) }); setSetting('WAZZUP_WEBHOOK_URL', b.url); return json(res, 200, { saved: true }); } catch (e) { return json(res, 400, { error: e.message + ' — можно указать вебхук вручную в кабинете Wazzup' }); } }
    if (p === '/api/settings') {
      if (req.method === 'GET') { const mask = v => v ? '••••••' + String(v).slice(-4) : ''; return json(res, 200, { company: { name: getSetting('COMPANY_NAME'), currency: getSetting('CURRENCY', '₽') }, messenger_provider: getSetting('MESSENGER_PROVIDER', 'wazzup'), auto_deal: getSetting('AUTO_DEAL', '1'), wazzup: { api_key: mask(getSetting('WAZZUP_API_KEY')), api_url: getSetting('WAZZUP_API_URL', 'https://api.wazzup24.com/v3'), channel_id: getSetting('WAZZUP_CHANNEL_ID'), webhook_secret: getSetting('WAZZUP_WEBHOOK_SECRET'), configured: !!getSetting('WAZZUP_API_KEY') }, whatsapp: { token: mask(getSetting('WHATSAPP_TOKEN')), phone_id: getSetting('WHATSAPP_PHONE_ID'), verify_token: getSetting('WHATSAPP_VERIFY_TOKEN', 'karkas-verify'), configured: !!(getSetting('WHATSAPP_TOKEN') && getSetting('WHATSAPP_PHONE_ID')) }, telegram: { configured: !!getSetting('TELEGRAM_BOT_TOKEN') } }); }
      if (req.method === 'PUT') { if (!requireAdmin(user, res)) return; const b = await readBody(req); const clean = v => (v && !String(v).includes('•')) ? v : null; if (clean(b.WAZZUP_API_KEY)) setSetting('WAZZUP_API_KEY', b.WAZZUP_API_KEY); for (const k of ['WAZZUP_API_URL', 'WAZZUP_CHANNEL_ID', 'WAZZUP_WEBHOOK_SECRET', 'WHATSAPP_PHONE_ID', 'WHATSAPP_VERIFY_TOKEN', 'COMPANY_NAME', 'CURRENCY', 'MESSENGER_PROVIDER', 'AUTO_DEAL', 'AUTO_DEAL_STAGE']) if (b[k] !== undefined) setSetting(k, b[k]); if (clean(b.WHATSAPP_TOKEN)) setSetting('WHATSAPP_TOKEN', b.WHATSAPP_TOKEN); if (clean(b.TELEGRAM_BOT_TOKEN)) setSetting('TELEGRAM_BOT_TOKEN', b.TELEGRAM_BOT_TOKEN); log('Настройки обновлены', null, null, user.name); return json(res, 200, { saved: true }); }
    }
    // ===== конкуренты: разведка (долги, суды, банкротство, отзывы, прайс-таблицы) =====
    if (/^\/api\/(competitors|competitor-sources|competitor-links|competitors\/find|prices|reviews)/.test(p)) {
      const handled = await competitorsApi.handle(req, res, { p, u, user });
      if (handled !== false) return;
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'Не найдено' });
    let file = normalize(join(PUBLIC_DIR, p === '/' ? 'index.html' : p)); if (!file.startsWith(PUBLIC_DIR) || !existsSync(file)) file = join(PUBLIC_DIR, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(readFileSync(file));
  } catch (e) { console.error(e); json(res, 500, { error: e.message }); }
});
server.listen(PORT, HOST, () => console.log(`KarkasCRM v2 http://${HOST}:${PORT} | admin: ${ADMIN_EMAIL}`));
export { db, getSetting };
