// Гигиена базы: удаление карточек не оставляет «висячих» строк, ошибки ввода
// не создают битые ссылки, выгрузка CSV безопасна, уборка чистит только лишнее.
// Запуск: node --experimental-sqlite --test tests/db-hygiene.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdirSync, utimesSync, existsSync } from 'node:fs';
import { join } from 'node:path';

process.env.DATA_DIR = '/tmp/karkas-hygiene-' + Date.now();
process.env.PORT = '18096';
process.env.SEED_MODE = 'off';
process.env.SCHEDULER_INTERVAL_MS = '600000';
const { server, db } = await import('../backend/src/server.js');
const { auditDatabase, cleanupOrphans, cleanupUploads, trimActivities, trimCompetitorReports, syncDealResponsibleNames } = await import('../backend/src/maintenance.js');
const base = 'http://127.0.0.1:18096';
const DATA = process.env.DATA_DIR;
let token;
const call = async (path, { method = 'GET', body, raw, token: ownToken } = {}) => {
  const auth = ownToken || token;
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) },
    body: raw !== undefined ? raw : (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
};

before(async () => {
  await new Promise(r => server.listening ? r() : server.once('listening', r));
  const login = await call('/api/auth/login', { method: 'POST', body: { email: 'admin@example.com', password: 'admin12345' } });
  assert.equal(login.status, 200);
  token = login.data.token;
});

after(async () => {
  await new Promise(r => server.close(r));
  try { db.close() } catch {}
});

test('удаление сделки не оставляет заметок, позиций и ссылок задач', async () => {
  const contact = await call('/api/contacts', { method: 'POST', body: { name: 'Клиент удаляемой сделки' } });
  const deal = await call('/api/deals', { method: 'POST', body: { title: 'Удаляемая сделка', contact_id: contact.data.id } });
  await call('/api/notes', { method: 'POST', body: { entity_type: 'deals', entity_id: deal.data.id, body: 'Заметка внутри сделки' } });
  await call('/api/deals/' + deal.data.id + '/products', { method: 'POST', body: { name: 'Позиция', price: 1000, qty: 2 } });
  const task = await call('/api/tasks', { method: 'POST', body: { title: 'Задача по удаляемой сделке', deal_id: deal.data.id } });
  const del = await call('/api/deals/' + deal.data.id, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.ok(!db.prepare("SELECT 1 x FROM notes WHERE entity_type='deals' AND entity_id=?").get(deal.data.id), 'заметки сделки удалены вместе с ней');
  assert.ok(!db.prepare('SELECT 1 x FROM deal_products WHERE deal_id=?').get(deal.data.id), 'позиции удалены');
  const kept = db.prepare('SELECT deal_id FROM tasks WHERE id=?').get(task.data.id);
  assert.ok(kept, 'задача осталась в списке дел');
  assert.equal(kept.deal_id, null, 'у задачи нет ссылки на удалённую сделку');
  const audit = auditDatabase(db);
  assert.equal(audit.orphanTotal, 0, 'после удаления нет строк-сирот');
});

test('смена ответственного синхронизирует имя для аналитики и поиска', async () => {
  const u = await call('/api/users', { method: 'POST', body: { name: 'Синхронный Менеджер', email: 'sync-' + Date.now() + '@example.com', role: 'manager', active: 1, password: 'TemporaryPass-2026!' } });
  assert.ok(u.data.id);
  const deal = await call('/api/deals', { method: 'POST', body: { title: 'Сделка синхронизации' } });
  await call('/api/deals/' + deal.data.id, { method: 'PATCH', body: { responsible_id: u.data.id } });
  const row = db.prepare('SELECT responsible,responsible_id FROM deals WHERE id=?').get(deal.data.id);
  assert.equal(row.responsible_id, u.data.id);
  assert.equal(row.responsible, 'Синхронный Менеджер', 'текстовое имя не отстаёт от id');
  // прямой вызов чинит старые записи, где имя разошлось
  db.prepare('UPDATE deals SET responsible=? WHERE id=?').run('Старое имя', deal.data.id);
  assert.ok(syncDealResponsibleNames(db) >= 1);
  assert.equal(db.prepare('SELECT responsible FROM deals WHERE id=?').get(deal.data.id).responsible, 'Синхронный Менеджер');
  const analytics = await call('/api/analytics');
  assert.ok(analytics.data.byManager.some(m => m.name === 'Синхронный Менеджер'), 'аналитика знает менеджера');
});

test('список сотрудников не раскрывает e-mail менеджеру', async () => {
  const email = 'privacy-' + Date.now() + '@example.com';
  const created = await call('/api/users', { method: 'POST', body: { name: 'Менеджер Приватность', email, role: 'manager', active: 1, password: 'TemporaryPass-2026!' } });
  assert.ok(created.data.id);
  const first = await call('/api/auth/login', { method: 'POST', body: { email, password: 'TemporaryPass-2026!' } });
  const changed = await call('/api/me/password', { method: 'POST', token: first.data.token, body: { old_password: 'TemporaryPass-2026!', new_password: 'PersonalPass-2026!' } });
  const managerView = await call('/api/users', { token: changed.data.token });
  assert.equal(managerView.status, 200);
  assert.ok(managerView.data.some(u => u.name === 'Менеджер Приватность'), 'имена для выбора ответственного доступны');
  assert.ok(managerView.data.every(u => u.email === undefined), 'e-mail сотрудников скрыт');
  const adminView = await call('/api/users');
  assert.ok(adminView.data.some(u => u.email === email), 'администратор видит e-mail');
});

test('возврат закрытой сделки в работу стирает дату закрытия', async () => {
  const pipes = await call('/api/pipelines');
  const stages = pipes.data[0].stages;
  const won = stages.find(s => s.kind === 'won');
  const open = stages.find(s => s.kind === 'open') || stages[0];
  const deal = await call('/api/deals', { method: 'POST', body: { title: 'Сделка для возврата', stage: open.code } });
  await call('/api/deals/' + deal.data.id, { method: 'PATCH', body: { stage: won.code } });
  assert.ok(db.prepare('SELECT closed_at FROM deals WHERE id=?').get(deal.data.id).closed_at, 'дата закрытия появилась');
  await call('/api/deals/' + deal.data.id, { method: 'PATCH', body: { stage: open.code } });
  assert.equal(db.prepare('SELECT closed_at FROM deals WHERE id=?').get(deal.data.id).closed_at, null, 'при возврате дата закрытия очищена');
});

test('ошибочные ссылки отклоняются понятной ошибкой, а не 500', async () => {
  const contact = await call('/api/contacts', { method: 'POST', body: { name: 'Клиент проверки ссылок' } });
  assert.equal((await call('/api/contacts/' + contact.data.id, { method: 'PATCH', body: { company_id: 999999 } })).status, 400, 'несуществующая компания');
  assert.equal((await call('/api/contacts/' + contact.data.id, { method: 'PATCH', body: { name: '  ' } })).status, 400, 'пустое имя');
  const task = await call('/api/tasks', { method: 'POST', body: { title: 'Задача проверки ссылок' } });
  assert.equal((await call('/api/tasks/' + task.data.id, { method: 'PATCH', body: { responsible_id: 999999 } })).status, 400, 'несуществующий ответственный');
  assert.equal((await call('/api/tasks/' + task.data.id, { method: 'PATCH', body: { deal_id: 999999 } })).status, 400, 'несуществующая сделка');
  assert.equal((await call('/api/notes', { method: 'POST', body: { entity_type: 'tasks', entity_id: task.data.id, body: 'Нельзя' } })).status, 400, 'заметка только к карточкам');
  assert.equal((await call('/api/notes', { method: 'POST', body: { entity_type: 'deals', entity_id: 999999, body: 'Нельзя' } })).status, 400, 'заметка к несуществующей сделке');
  const malformed = await call('/api/contacts', { method: 'POST', raw: '{"name": "' });
  assert.equal(malformed.status, 400, 'битый JSON — ошибка клиента');
  assert.match(String(malformed.data.error), /Некорректный JSON/);
});

test('выгрузка CSV не даёт Excel выполнить данные клиента', async () => {
  await call('/api/contacts', { method: 'POST', body: { name: '=1+1', phone: '+7 999 111-22-33' } });
  const r = await fetch(base + '/api/export/contacts?token=' + encodeURIComponent(token));
  const text = await r.text();
  assert.ok(text.includes(`\"'=1+1\"`), 'формула экранирована апострофом');
});

test('старые «висячие» строки убираются, данные остаются', async () => {
  // имитируем базу, испорченную прежней версией
  const contact = await call('/api/contacts', { method: 'POST', body: { name: 'Живой клиент' } });
  // прежние версии могли оставить такие строки при выключенных внешних ключах
  db.exec('PRAGMA foreign_keys=OFF');
  db.prepare("INSERT INTO notes(entity_type,entity_id,body) VALUES('deals',999999,'сирота')").run();
  db.prepare("INSERT INTO notes(entity_type,entity_id,body) VALUES('companies',999999,'сирота')").run();
  db.prepare("INSERT INTO deal_products(deal_id,name,price,qty) VALUES(999999,'сирота',1,1)").run();
  db.prepare("INSERT INTO tasks(title,deal_id,contact_id) VALUES('сирота',999999,999999)").run();
  db.prepare("INSERT INTO conversations(contact_id,title) VALUES(999999,'сирота')").run();
  const conv = db.prepare("SELECT id FROM conversations WHERE title='сирота'").get().id;
  db.prepare("INSERT INTO messages(conversation_id,body) VALUES(?,'сирота')").run(conv);
  db.exec('PRAGMA foreign_keys=ON');
  const before = auditDatabase(db);
  assert.ok(before.orphanTotal >= 6, 'аудит видит все виды сирот');
  const cleaned = cleanupOrphans(db);
  assert.ok(Object.values(cleaned).reduce((a, b) => a + b, 0) >= 6);
  const after = auditDatabase(db);
  assert.equal(after.orphanTotal, 0, 'после уборки сирот нет');
  assert.ok(db.prepare('SELECT 1 x FROM contacts WHERE id=?').get(contact.data.id), 'живой клиент не затронут');
  assert.equal(after.integrity, 'ok');
  assert.equal(after.foreignKeyIssues, 0);
});

test('старые файлы чатов без ссылок удаляются, нужные остаются', async () => {
  const dir = join(DATA, 'uploads');
  mkdirSync(dir, { recursive: true });
  const contact = await call('/api/contacts', { method: 'POST', body: { name: 'Клиент с файлом' } });
  const deal = await call('/api/deals', { method: 'POST', body: { title: 'Сделка с файлом', contact_id: contact.data.id } });
  await call('/webhooks/generic', { method: 'POST', body: { channel: 'site', name: 'Клиент с файлом', phone: '79005556677', body: 'файл' } });
  const conv = db.prepare('SELECT id FROM conversations ORDER BY id DESC LIMIT 1').get().id;
  const old = new Date(Date.now() - 10 * 864e5);
  for (const name of ['used.bin', 'old.bin', 'fresh.bin']) {
    writeFileSync(join(dir, name), 'x'.repeat(100));
    utimesSync(join(dir, name), old, old);
  }
  writeFileSync(join(dir, 'fresh.bin'), 'x'.repeat(100)); // свежий файл не трогаем даже без ссылки
  db.prepare("INSERT INTO messages(conversation_id,body,content_uri) VALUES(?,'файл','/uploads/used.bin')").run(conv);
  const res = cleanupUploads(db, dir, { keepDays: 7 });
  assert.equal(res.removed, 1, 'удалён только старый файл без ссылки');
  assert.ok(existsSync(join(dir, 'used.bin')), 'файл из переписки на месте');
  assert.ok(existsSync(join(dir, 'fresh.bin')), 'свежий файл не удалён');
  assert.ok(!existsSync(join(dir, 'old.bin')));
  assert.equal(res.bytes, 100);
});

test('история проверок конкурентов не растёт бесконечно', async () => {
  const c1 = db.prepare("INSERT INTO competitors(name) VALUES('Конкурент истории 1')").run().lastInsertRowid;
  const c2 = db.prepare("INSERT INTO competitors(name) VALUES('Конкурент истории 2')").run().lastInsertRowid;
  const ins = db.prepare("INSERT INTO competitor_reports(competitor_id,risk,level,verdict) VALUES(?,?,?,?)");
  for (let i = 0; i < 60; i++) ins.run(c1, i % 100, 'low', 'ok');
  for (let i = 0; i < 3; i++) ins.run(c2, 10, 'low', 'ok');
  const removed = trimCompetitorReports(db, 50);
  assert.equal(removed, 10, 'удалены только лишние отчёты');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM competitor_reports WHERE competitor_id=?').get(c1).n, 50);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM competitor_reports WHERE competitor_id=?').get(c2).n, 3, 'маленькая история не тронута');
});

test('свои поля: дубликаты технического ключа не сохраняются', async () => {
  const saved = (await call('/api/custom-fields')).data.fields;
  const put = await call('/api/custom-fields', { method: 'PUT', body: { fields: [
    { key: 'dup_key', label: 'Первое поле', type: 'text', entity: 'both', options: [], required: false },
    { key: 'dup_key', label: 'Второе поле', type: 'text', entity: 'deals', options: [], required: true },
  ] } });
  assert.equal(put.status, 200);
  assert.equal(put.data.fields.length, 1, 'второй дубликат отброшен');
  assert.equal(put.data.fields[0].label, 'Первое поле');
  assert.equal((await call('/api/meta')).data.customFields.length, 1, 'форма получает одно поле');
  await call('/api/custom-fields', { method: 'PUT', body: { fields: saved } });
});

test('лента активности ограничена 20 000 событиями', async () => {
  const insert = db.prepare("INSERT INTO activities(text,user_name) VALUES('тест','Тест')");
  for (let i = 0; i < 25; i++) insert.run();
  const removed = trimActivities(db, 20);
  assert.ok(removed >= 5, 'лишние события удалены');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM activities').get().n, 20);
});
