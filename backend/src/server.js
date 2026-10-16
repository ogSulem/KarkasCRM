// KarkasCRM backend — zero external dependencies (Node >=22.5: http + node:sqlite + crypto)
// API: auth, contacts, deals (kanban), tasks, unified inbox, WhatsApp/Telegram webhooks, SSE realtime
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || join(fileURLToPath(new URL('.', import.meta.url)), '../../data');
const PUBLIC_DIR = process.env.PUBLIC_DIR || join(fileURLToPath(new URL('.', import.meta.url)), '../../frontend/public');
const SECRET = process.env.JWT_SECRET || 'change-me-in-production-please-32-chars';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin12345';
mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(join(DATA_DIR, 'crm.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');

// ---------- schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE, pass TEXT, role TEXT DEFAULT 'admin');
CREATE TABLE IF NOT EXISTS contacts(id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, email TEXT, company TEXT, source TEXT DEFAULT 'manual', tags TEXT DEFAULT '', notes TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS deals(id INTEGER PRIMARY KEY, title TEXT NOT NULL, amount INTEGER DEFAULT 0, stage TEXT DEFAULT 'new', contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL, responsible TEXT DEFAULT 'Администратор', deadline TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, title TEXT NOT NULL, due TEXT, done INTEGER DEFAULT 0, deal_id INTEGER, contact_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS conversations(id INTEGER PRIMARY KEY, contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE, title TEXT, channels TEXT DEFAULT '', unread INTEGER DEFAULT 0, last_at TEXT DEFAULT (datetime('now')), UNIQUE(contact_id));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE, channel TEXT DEFAULT 'whatsapp', direction TEXT DEFAULT 'in', body TEXT, external_id TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS activities(id INTEGER PRIMARY KEY, text TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_ext ON messages(external_id) WHERE external_id IS NOT NULL;
`);
export const STAGES = [
  { id: 'new', name: 'Новые', color: '#f97316' }, { id: 'contact', name: 'Контакт установлен', color: '#fb923c' },
  { id: 'offer', name: 'Предложение', color: '#22c55e' }, { id: 'negotiation', name: 'Переговоры', color: '#16a34a' },
  { id: 'won', name: 'Успешно реализовано', color: '#15803d' }, { id: 'lost', name: 'Закрыто (не реализовано)', color: '#78716c' },
];
const log = (text) => db.prepare('INSERT INTO activities(text) VALUES(?)').run(text);
const getSetting = (k, d = '') => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value ?? process.env[k] ?? d;
const setSetting = (k, v) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v ?? ''));

// ---------- auth ----------
const hashPass = (p, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(p, salt, 64).toString('hex')}`;
function checkPass(p, stored) { const [s, h] = String(stored).split(':'); if (!s) return false; const a = Buffer.from(h, 'hex'), b = scryptSync(p, s, 64); return a.length === b.length && timingSafeEqual(a, b); }
const sign = (payload) => { const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 7 * 864e5 })).toString('base64url'); return body + '.' + createHmac('sha256', SECRET).update(body).digest('base64url'); };
function verify(token) { try { const [body, sig] = token.split('.'); if (createHmac('sha256', SECRET).update(body).digest('base64url') !== sig) return null; const p = JSON.parse(Buffer.from(body, 'base64url')); return p.exp > Date.now() ? p : null; } catch { return null; } }

// ---------- seed ----------
if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
  db.prepare('INSERT INTO users(name,email,pass,role) VALUES(?,?,?,?)').run('Администратор', ADMIN_EMAIL, hashPass(ADMIN_PASSWORD), 'admin');
  const c = db.prepare('INSERT INTO contacts(name,phone,email,company,source,tags) VALUES(?,?,?,?,?,?)');
  const ids = [
    c.run('Ирина Соколова', '+7 916 555-01-20', 'Иванова@example.com', 'СтройДом', 'whatsapp', 'VIP,каркасные дома').lastInsertRowid,
    c.run('Дмитрий Орлов', '+7 925 555-01-21', 'Орлов@example.com', 'ИП Орлов', 'telegram', 'баня').lastInsertRowid,
    c.run('Анна Лебедева', '+7 903 555-01-22', 'Анна@example.com', '—', 'site', 'дом 6x8').lastInsertRowid,
    c.run('Сергей Волков', '+7 999 555-01-23', 'Волков@example.com', 'Волков и Ко', 'whatsapp', 'повторный').lastInsertRowid,
  ];
  const d = db.prepare('INSERT INTO deals(title,amount,stage,contact_id,deadline) VALUES(?,?,?,?,date(?,?))');
  d.run('Каркасный дом 8×10 «Север»', 3850000, 'new', ids[0], 'now', '+7 days'); d.run('Баня 4×6 под ключ', 890000, 'contact', ids[1], 'now', '+3 days');
  d.run('Дом 6×8 с террасой', 2640000, 'offer', ids[2], 'now', '+10 days'); d.run('Дачный дом + хозблок', 1950000, 'negotiation', ids[3], 'now', '+5 days');
  d.run('Каркасный дом 9×12', 4720000, 'won', ids[0], 'now', '-2 days');
  db.prepare('INSERT INTO tasks(title,due,contact_id) VALUES(?,?,?)').run('Позвонить Ирине, уточнить участок', 'Сегодня 14:00', ids[0]);
  db.prepare('INSERT INTO tasks(title,due,contact_id) VALUES(?,?,?)').run('Отправить расчёт бани Дмитрию', 'Завтра 10:00', ids[1]);
  const conv = db.prepare('INSERT INTO conversations(contact_id,title,channels,unread) VALUES(?,?,?,?)');
  const m = db.prepare('INSERT INTO messages(conversation_id,channel,direction,body) VALUES(?,?,?,?)');
  let cv = conv.run(ids[0], 'Ирина Соколова', 'whatsapp,telegram', 2).lastInsertRowid;
  m.run(cv, 'whatsapp', 'in', 'Здравствуйте! Интересует каркасный дом 8×10, что входит в комплектацию?');
  m.run(cv, 'whatsapp', 'out', 'Здравствуйте, Ирина! Отправил презентацию и смету. Удобно созвониться сегодня?');
  m.run(cv, 'telegram', 'in', 'Да, давайте в 14:00. И ещё вопрос по фундаменту на сваях.');
  cv = conv.run(ids[1], 'Дмитрий Орлов', 'whatsapp', 1).lastInsertRowid;
  m.run(cv, 'whatsapp', 'in', 'Добрый день, баню 4×6 можно посмотреть на производстве?');
  log('Система инициализирована: демо-данные созданы');
}

// ---------- realtime (SSE) ----------
const clients = new Set();
export function broadcast(event, data) { const s = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; clients.forEach(r => { try { r.write(s); } catch {} }); }

// ---------- unified inbox core ----------
export function upsertIncoming({ channel = 'whatsapp', phone = '', name = '', body = '', external_id = null }) {
  if (!body) return null;
  const digits = s => String(s || '').replace(/\D/g, '').replace(/^8/, '7');
  let contact = phone ? db.prepare('SELECT * FROM contacts').all().find(c => digits(c.phone) && digits(c.phone) === digits(phone)) : null;
  if (!contact) { const r = db.prepare('INSERT INTO contacts(name,phone,source) VALUES(?,?,?)').run(name || phone || 'Новый клиент', phone, channel); contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(r.lastInsertRowid); log(`Новый контакт из ${channel}: ${contact.name}`); }
  let conv = db.prepare('SELECT * FROM conversations WHERE contact_id=?').get(contact.id);
  if (!conv) { const r = db.prepare('INSERT INTO conversations(contact_id,title,channels) VALUES(?,?,?)').run(contact.id, contact.name, channel); conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(r.lastInsertRowid); db.prepare("INSERT INTO deals(title,amount,stage,contact_id) VALUES(?,?,?,?)").run('Обращение: ' + contact.name, 0, 'new', contact.id); }
  const channels = [...new Set([...(conv.channels || '').split(',').filter(Boolean), channel])].join(',');
  try { db.prepare('INSERT INTO messages(conversation_id,channel,direction,body,external_id) VALUES(?,?,?,?,?)').run(conv.id, channel, 'in', body, external_id); }
  catch { return conv; } // duplicate external_id -> idempotent webhook
  db.prepare("UPDATE conversations SET channels=?, unread=unread+1, last_at=datetime('now') WHERE id=?").run(channels, conv.id);
  broadcast('message', { conversation_id: conv.id, channel, body });
  return conv;
}
async function sendWhatsApp(to, text) {
  const token = getSetting('WHATSAPP_TOKEN'), phoneId = getSetting('WHATSAPP_PHONE_ID');
  if (!token || !phoneId) return { delivered: false, mode: 'local-only (WhatsApp API не настроен)' };
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: String(to).replace(/\D/g, ''), type: 'text', text: { body: text } }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `WhatsApp API ${res.status}`);
  return { delivered: true, mode: 'whatsapp-cloud-api', id: data?.messages?.[0]?.id };
}

// ---------- http helpers ----------
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const body = async (req) => { let s = ''; for await (const ch of req) s += ch; try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`); const p = u.pathname;
  try {
    // WhatsApp webhook verification (Meta)
    if (p === '/webhooks/whatsapp' && req.method === 'GET') {
      const ok = u.searchParams.get('hub.mode') === 'subscribe' && u.searchParams.get('hub.verify_token') === getSetting('WHATSAPP_VERIFY_TOKEN', 'karkas-verify');
      res.writeHead(ok ? 200 : 403, { 'Content-Type': 'text/plain' }); return res.end(ok ? u.searchParams.get('hub.challenge') : 'forbidden');
    }
    if (p === '/webhooks/whatsapp' && req.method === 'POST') {
      const payload = await body(req);
      for (const e of payload.entry || []) for (const ch of e.changes || []) for (const msg of ch.value?.messages || []) {
        const profile = ch.value.contacts?.find(c => c.wa_id === msg.from)?.profile?.name || '';
        const text = msg.text?.body || msg.image?.caption || msg.button?.text || '[медиа-сообщение]';
        upsertIncoming({ channel: 'whatsapp', phone: '+' + msg.from, name: profile, body: text, external_id: msg.id });
      }
      return json(res, 200, { received: true });
    }
    if ((p === '/webhooks/telegram' || p === '/webhooks/generic') && req.method === 'POST') {
      const b = await body(req); const msg = b.message || b;
      upsertIncoming({ channel: p.includes('telegram') ? 'telegram' : (b.channel || 'site'), phone: msg.chat?.id ? String(msg.chat.id) : (b.phone || ''), name: msg.from?.first_name || b.name || '', body: msg.text || b.body || b.text || '', external_id: msg.message_id ? `tg-${msg.message_id}` : null });
      return json(res, 200, { received: true });
    }
    if (p === '/api/health') return json(res, 200, { ok: true, service: 'KarkasCRM', time: new Date().toISOString() });

    // auth gate
    const authUser = verify((req.headers.authorization || '').replace('Bearer ', '') || u.searchParams.get('token') || '');
    if (p === '/api/auth/login' && req.method === 'POST') {
      const b = await body(req); const user = db.prepare('SELECT * FROM users WHERE email=?').get(String(b.email || '').toLowerCase());
      if (!user || !checkPass(String(b.password || ''), user.pass)) return json(res, 401, { error: 'Неверный e-mail или пароль' });
      return json(res, 200, { token: sign({ id: user.id, email: user.email, name: user.name }), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    }
    if (p.startsWith('/api/') && p !== '/api/events') { if (!authUser) return json(res, 401, { error: 'Требуется авторизация' }); }
    if (p === '/api/events') { if (!authUser) return json(res, 401, { error: 'Требуется авторизация' }); res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.write('event: ready\ndata: {}\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return; }
    if (p === '/api/me') return json(res, 200, { user: authUser });

    if (p === '/api/dashboard') {
      const deals = db.prepare('SELECT * FROM deals').all(); const stages = STAGES.map(s => ({ ...s, count: deals.filter(d => d.stage === s.id).length, sum: deals.filter(d => d.stage === s.id).reduce((a, d) => a + d.amount, 0) }));
      return json(res, 200, { stages, dealsTotal: deals.length, revenue: deals.filter(d => d.stage === 'won').reduce((a, d) => a + d.amount, 0), contacts: db.prepare('SELECT COUNT(*) n FROM contacts').get().n, unread: db.prepare('SELECT COALESCE(SUM(unread),0) n FROM conversations').get().n, tasksOpen: db.prepare('SELECT COUNT(*) n FROM tasks WHERE done=0').get().n, activities: db.prepare('SELECT * FROM activities ORDER BY id DESC LIMIT 8').all(), recentDeals: db.prepare('SELECT d.*,c.name contact_name FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id ORDER BY d.id DESC LIMIT 6').all() });
    }
    // generic CRUD
    const crud = (table, fields) => async () => {
      if (req.method === 'GET') return json(res, 200, db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all());
      if (req.method === 'POST') { const b = await body(req); const ks = fields.filter(f => b[f] !== undefined); const r = db.prepare(`INSERT INTO ${table}(${ks}) VALUES(${ks.map(() => '?')})`).run(...ks.map(k => b[k])); log(`Создано: ${table} #${r.lastInsertRowid}`); broadcast('change', { table }); return json(res, 201, db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(r.lastInsertRowid)); }
    };
    if (p === '/api/contacts') return crud('contacts', ['name', 'phone', 'email', 'company', 'source', 'tags', 'notes'])();
    if (p === '/api/tasks') { if (req.method === 'GET') return json(res, 200, db.prepare('SELECT t.*,c.name contact_name FROM tasks t LEFT JOIN contacts c ON c.id=t.contact_id ORDER BY done,id DESC').all()); return crud('tasks', ['title', 'due', 'done', 'deal_id', 'contact_id'])(); }
    if (p === '/api/deals') {
      if (req.method === 'GET') return json(res, 200, { stages: STAGES, deals: db.prepare('SELECT d.*,c.name contact_name,c.phone contact_phone FROM deals d LEFT JOIN contacts c ON c.id=d.contact_id ORDER BY d.id DESC').all() });
      return crud('deals', ['title', 'amount', 'stage', 'contact_id', 'responsible', 'deadline'])();
    }
    const mId = p.match(/^\/api\/(contacts|deals|tasks)\/(\d+)$/);
    if (mId) { const [, table, id] = mId;
      if (req.method === 'GET') return json(res, 200, db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) || {});
      if (req.method === 'PATCH') { const b = await body(req); const allowed = { contacts: ['name','phone','email','company','source','tags','notes'], deals: ['title','amount','stage','contact_id','responsible','deadline'], tasks: ['title','due','done'] }[table]; const ks = Object.keys(b).filter(k => allowed.includes(k)); if (ks.length) db.prepare(`UPDATE ${table} SET ${ks.map(k => k + '=?')}${table==='deals'?",updated_at=datetime('now')":''} WHERE id=?`).run(...ks.map(k => b[k]), id); if (table === 'deals' && b.stage) log(`Сделка #${id} → этап «${STAGES.find(s => s.id === b.stage)?.name}»`); broadcast('change', { table, id }); return json(res, 200, db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id)); }
      if (req.method === 'DELETE') { db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id); broadcast('change', { table }); return json(res, 200, { deleted: true }); }
    }
    // inbox
    if (p === '/api/conversations' && req.method === 'GET') return json(res, 200, db.prepare(`SELECT cv.*,c.phone,c.email,(SELECT body FROM messages WHERE conversation_id=cv.id ORDER BY id DESC LIMIT 1) last_body FROM conversations cv LEFT JOIN contacts c ON c.id=cv.contact_id ORDER BY cv.last_at DESC`).all());
    const mConv = p.match(/^\/api\/conversations\/(\d+)\/messages$/);
    if (mConv) { const id = mConv[1];
      if (req.method === 'GET') { db.prepare('UPDATE conversations SET unread=0 WHERE id=?').run(id); return json(res, 200, db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY id').all()); }
      if (req.method === 'POST') { const b = await body(req); const conv = db.prepare('SELECT cv.*,c.phone FROM conversations cv LEFT JOIN contacts c ON c.id=cv.contact_id WHERE cv.id=?').get(id); if (!conv) return json(res, 404, { error: 'Чат не найден' }); let send = { delivered: false, mode: 'local' }; if ((b.channel || 'whatsapp') === 'whatsapp' && conv.phone) { try { send = await sendWhatsApp(conv.phone, b.body); } catch (e) { send = { delivered: false, mode: 'error: ' + e.message }; } } const r = db.prepare('INSERT INTO messages(conversation_id,channel,direction,body) VALUES(?,?,?,?)').run(id, b.channel || 'whatsapp', 'out', b.body); db.prepare("UPDATE conversations SET last_at=datetime('now') WHERE id=?").run(id); broadcast('message', { conversation_id: Number(id) }); return json(res, 201, { message: db.prepare('SELECT * FROM messages WHERE id=?').get(r.lastInsertRowid), send }); }
    }
    if (p === '/api/inbox/simulate' && req.method === 'POST') { const b = await body(req); const conv = upsertIncoming({ channel: b.channel || 'whatsapp', phone: b.phone || '+7 900 000-00-00', name: b.name || 'Тестовый клиент', body: b.body || 'Здравствуйте! Хочу расчёт дома.' }); return json(res, 201, { conversation_id: conv?.id }); }
    if (p === '/api/settings/integrations') {
      if (req.method === 'GET') { const mask = v => v ? '••••••' + String(v).slice(-4) : ''; return json(res, 200, { whatsapp: { token: mask(getSetting('WHATSAPP_TOKEN')), phone_id: getSetting('WHATSAPP_PHONE_ID'), verify_token: getSetting('WHATSAPP_VERIFY_TOKEN', 'karkas-verify'), configured: !!(getSetting('WHATSAPP_TOKEN') && getSetting('WHATSAPP_PHONE_ID')) }, telegram: { configured: !!getSetting('TELEGRAM_BOT_TOKEN') }, webhookBase: '/webhooks/whatsapp' }); }
      if (req.method === 'PUT') { const b = await body(req); if (b.WHATSAPP_TOKEN && !String(b.WHATSAPP_TOKEN).includes('•')) setSetting('WHATSAPP_TOKEN', b.WHATSAPP_TOKEN); if (b.WHATSAPP_PHONE_ID) setSetting('WHATSAPP_PHONE_ID', b.WHATSAPP_PHONE_ID); if (b.WHATSAPP_VERIFY_TOKEN) setSetting('WHATSAPP_VERIFY_TOKEN', b.WHATSAPP_VERIFY_TOKEN); if (b.TELEGRAM_BOT_TOKEN && !String(b.TELEGRAM_BOT_TOKEN).includes('•')) setSetting('TELEGRAM_BOT_TOKEN', b.TELEGRAM_BOT_TOKEN); log('Обновлены настройки интеграций'); return json(res, 200, { saved: true }); }
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'Не найдено' });
    // static frontend (SPA fallback)
    let file = normalize(join(PUBLIC_DIR, p === '/' ? 'index.html' : p)); if (!file.startsWith(PUBLIC_DIR) || !existsSync(file)) file = join(PUBLIC_DIR, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(readFileSync(file));
  } catch (e) { console.error(e); json(res, 500, { error: e.message }); }
});
server.listen(PORT, HOST, () => console.log(`KarkasCRM http://${HOST}:${PORT} | admin: ${ADMIN_EMAIL}`));
export { server, db };
