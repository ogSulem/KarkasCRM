// Проверка уведомлений: каждое событие должно приходить нужному человеку,
// с понятным текстом и без дублей. Запуск:
//   npm run test:notify
//   node --experimental-sqlite --test tests/notifications.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert';

process.env.DATA_DIR = '/tmp/karkas-notify-' + Date.now();
process.env.PORT = '18097';
process.env.SEED_MODE = 'off';
process.env.SCHEDULER_INTERVAL_MS = '250'; // просроченные задачи проверяются часто, тест не ждёт минуту
const { server, db } = await import('../backend/src/server.js');
const base = 'http://127.0.0.1:18097';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let admin;
const streams = [];
const ctx = {};

const call = async (path, { method = 'GET', body, token } = {}) => {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
};
const login = async (email, password) => {
  const r = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(r.status, 200, 'вход ' + email);
  return r.data.token;
};
const personalLogin = async (name, email) => {
  email = email.replace('@', '-' + Math.random().toString(36).slice(2, 8) + '@');
  const password = 'TemporaryPass-2026!';
  const created = await call('/api/users', { method: 'POST', token: admin, body: { name, email, role: 'manager', active: 1, password } });
  assert.ok(created.data.id, 'сотрудник создан');
  const first = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  const own = 'PersonalPass-2026!';
  const changed = await call('/api/me/password', { method: 'POST', token: first.data.token, body: { old_password: password, new_password: own } });
  assert.equal(changed.status, 200);
  return { id: created.data.id, token: changed.data.token };
};

// Открываем поток событий так же, как браузер: он нужен, чтобы увидеть,
// кому именно сервер отправил уведомление.
const openStream = async token => {
  const ctrl = new AbortController();
  const events = [];
  const res = await fetch(base + '/api/events', { headers: { Authorization: 'Bearer ' + token }, signal: ctrl.signal });
  assert.equal(res.status, 200, 'поток событий доступен');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /event: ([^\n]+)/.exec(chunk);
          const data = /data: (.*)/.exec(chunk);
          if (ev) events.push({ ev: ev[1], data: data ? JSON.parse(data[1]) : null });
        }
      }
    } catch {}
  })();
  for (let i = 0; i < 100 && !events.some(e => e.ev === 'ready'); i++) await sleep(20);
  assert.ok(events.some(e => e.ev === 'ready'), 'сервер прислал ready');
  const stream = { events, close: () => { try { ctrl.abort() } catch {} }, pump };
  streams.push(stream);
  return stream;
};
const waitFor = async (stream, name, predicate = () => true, ms = 2500) => {
  for (let i = 0; i < ms / 25; i++) {
    const found = stream.events.find(e => e.ev === name && predicate(e.data));
    if (found) return found.data;
    await sleep(25);
  }
  return null;
};

before(async () => {
  await new Promise(r => server.listening ? r() : server.once('listening', r));
  admin = await login('admin@example.com', 'admin12345');
});

after(async () => {
  for (const s of streams) { s.close(); try { await s.pump } catch {} }
  await new Promise(r => server.close(r));
  try { db.close() } catch {}
});

test('уведомления: поток событий открыт у всех участников', async () => {
  const userB = await personalLogin('Коллега Б', 'notify-b@example.com');
  const userC = await personalLogin('Коллега В', 'notify-c@example.com');
  const [a, b, c] = await Promise.all([openStream(admin), openStream(userB.token), openStream(userC.token)]);
  Object.assign(ctx, { adminStream: a, bStream: b, cStream: c, b: userB, c: userC });
  assert.ok(a.events.length && b.events.length && c.events.length);
});

test('входящее сообщение: общее уведомление с именем клиента и превью', async () => {
  const { bStream, cStream } = ctx;
  const r = await call('/webhooks/generic', { method: 'POST', body: { channel: 'site', name: 'Клиент Сайта', phone: '+7 999 000-11-22', body: 'Нужен расчёт дома' } });
  assert.equal(r.status, 200);
  const noteB = await waitFor(bStream, 'message', d => d.preview === 'Нужен расчёт дома');
  const noteC = await waitFor(cStream, 'message', d => d.preview === 'Нужен расчёт дома');
  assert.ok(noteB && noteC, 'оба сотрудника получили уведомление о сообщении');
  assert.equal(noteB.title, 'Клиент Сайта');
  assert.equal(noteB.direction, 'in');
});

test('контакт передан коллеге: contact_assigned только получателю', async () => {
  const { bStream, cStream, b, c } = ctx;
  const created = await call('/api/contacts', { token: admin, method: 'POST', body: { name: 'Клиент для передачи' } });
  const moved = await call('/api/contacts/' + created.data.id, { token: admin, method: 'PATCH', body: { responsible_id: b.id } });
  assert.equal(moved.status, 200);
  const note = await waitFor(bStream, 'notify', d => d.type === 'contact_assigned' && d.id === created.data.id);
  assert.ok(note, 'получатель увидел contact_assigned');
  assert.equal(note.title, 'Клиент для передачи');
  await sleep(250);
  assert.ok(!cStream.events.some(e => e.ev === 'notify' && e.data?.type === 'contact_assigned' && e.data?.id === created.data.id), 'другому сотруднику не пришло');
  ctx.contactId = created.data.id;
  // Заодно убеждаемся, что контакт передаётся и второму сотруднику отдельным событием
  await call('/api/contacts/' + created.data.id, { token: admin, method: 'PATCH', body: { responsible_id: c.id } });
  const toC = await waitFor(cStream, 'notify', d => d.type === 'contact_assigned' && d.id === created.data.id);
  assert.ok(toC, 'второй сотрудник тоже получил уведомление');
});

test('сделка передана коллеге: deal_assigned только получателю', async () => {
  const { bStream, cStream, b, c, contactId } = ctx;
  const deal = await call('/api/deals', { token: admin, method: 'POST', body: { title: 'Сделка для передачи', contact_id: contactId } });
  assert.equal(deal.status, 201);
  assert.equal((await call('/api/deals/' + deal.data.id, { token: admin, method: 'PATCH', body: { responsible_id: b.id } })).status, 200);
  const note = await waitFor(bStream, 'notify', d => d.type === 'deal_assigned' && d.id === deal.data.id);
  assert.ok(note, 'получатель увидел deal_assigned');
  assert.equal(note.title, 'Сделка для передачи');
  await sleep(250);
  assert.ok(!cStream.events.some(e => e.ev === 'notify' && e.data?.type === 'deal_assigned' && e.data?.id === deal.data.id), 'другому сотруднику не пришло');
  // передача тому же человеку не должна дублировать уведомление
  const before = bStream.events.filter(e => e.ev === 'notify' && e.data?.type === 'deal_assigned' && e.data?.id === deal.data.id).length;
  await call('/api/deals/' + deal.data.id, { token: admin, method: 'PATCH', body: { responsible_id: b.id } });
  await sleep(250);
  assert.equal(bStream.events.filter(e => e.ev === 'notify' && e.data?.type === 'deal_assigned' && e.data?.id === deal.data.id).length, before, 'без смены ответственного — без уведомления');
  // имя ответственного в старом поле остаётся согласованным
  const card = await call('/api/deals/' + deal.data.id, { token: admin });
  assert.equal(card.data.deal.responsible, 'Коллега Б');
  ctx.dealId = deal.data.id;
});

test('задача назначена при создании: task_assigned получает исполнитель', async () => {
  const { bStream, cStream, b } = ctx;
  const task = await call('/api/tasks', { token: admin, method: 'POST', body: { title: 'Задача для коллеги', due: '2026-12-31 10:00', responsible_id: b.id } });
  assert.equal(task.status, 201);
  const note = await waitFor(bStream, 'notify', d => d.type === 'task_assigned' && d.id === task.data.id);
  assert.ok(note, 'исполнитель увидел task_assigned');
  assert.equal(note.title, 'Задача для коллеги');
  await sleep(250);
  assert.ok(!cStream.events.some(e => e.ev === 'notify' && e.data?.type === 'task_assigned' && e.data?.id === task.data.id), 'другому сотруднику не пришло');
  ctx.taskId = task.data.id;
});

test('задача переназначена: уведомление новому, без дубля прежнему', async () => {
  const { bStream, cStream, c, taskId } = ctx;
  const beforeB = bStream.events.filter(e => e.ev === 'notify' && e.data?.type === 'task_assigned' && e.data?.id === taskId).length;
  const r = await call('/api/tasks/' + taskId, { token: admin, method: 'PATCH', body: { responsible_id: c.id } });
  assert.equal(r.status, 200);
  const note = await waitFor(cStream, 'notify', d => d.type === 'task_assigned' && d.id === taskId);
  assert.ok(note, 'новый исполнитель увидел task_assigned');
  await sleep(250);
  assert.equal(bStream.events.filter(e => e.ev === 'notify' && e.data?.type === 'task_assigned' && e.data?.id === taskId).length, beforeB, 'прежнему исполнителю повторно не пришло');
});

test('назначение самому себе: уведомлений нет', async () => {
  const { adminStream } = ctx;
  const me = await call('/api/me', { token: admin });
  const task = await call('/api/tasks', { token: admin, method: 'POST', body: { title: 'Личная задача', responsible_id: me.data.user.id } });
  assert.equal(task.status, 201);
  await sleep(300);
  assert.ok(!adminStream.events.some(e => e.ev === 'notify' && e.data?.type === 'task_assigned' && e.data?.id === task.data.id), 'себе уведомление не отправляется');
});

test('массовая передача: одна сводка получателю вместо сотни тостов', async () => {
  const { bStream, cStream, adminStream, b, c } = ctx;
  const ids = [];
  for (let i = 0; i < 2; i++) ids.push((await call('/api/deals', { token: admin, method: 'POST', body: { title: `Пачка для уведомления ${i}` } })).data.id);
  const before = bStream.events.filter(e => e.ev === 'notify' && e.data?.type === 'bulk_assigned').length;
  const r = await call('/api/bulk', { token: admin, method: 'POST', body: { table: 'deals', ids, action: 'update', patch: { responsible_id: b.id } } });
  assert.equal(r.status, 200);
  assert.equal(r.data.count, 2, 'переданы обе сделки');
  const note = await waitFor(bStream, 'notify', d => d.type === 'bulk_assigned' && d.table === 'deals');
  assert.ok(note, 'получатель увидел сводку о массовой передаче');
  assert.equal(note.count, 2, 'в сводке — сколько записей передали');
  await sleep(250);
  assert.equal(bStream.events.filter(e => e.ev === 'notify' && e.data?.type === 'bulk_assigned').length, before + 1, 'одна сводка на пачку, а не по тосту на запись');
  assert.ok(!cStream.events.some(e => e.ev === 'notify' && e.data?.type === 'bulk_assigned'), 'другому сотруднику сводка не пришла');
  assert.ok(!adminStream.events.some(e => e.ev === 'notify' && e.data?.type === 'bulk_assigned'), 'себе уведомление не отправляется');
  // повторная передача тех же сделок тому же человеку — не повод для новой сводки
  await call('/api/bulk', { token: admin, method: 'POST', body: { table: 'deals', ids, action: 'update', patch: { responsible_id: b.id } } });
  await sleep(300);
  assert.equal(bStream.events.filter(e => e.ev === 'notify' && e.data?.type === 'bulk_assigned').length, before + 1, 'без смены ответственного сводка не повторяется');
  // и сама сделка действительно закреплена за коллегой
  const card = await call('/api/deals/' + ids[0], { token: admin });
  assert.equal(card.data.deal.responsible_id, b.id);
});

test('просроченная задача: общее уведомление приходит один раз', async () => {
  const { adminStream, bStream, cStream, b } = ctx;
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const task = await call('/api/tasks', { token: admin, method: 'POST', body: { title: 'Просроченный звонок', due: yesterday + ' 09:00', responsible_id: b.id } });
  assert.equal(task.status, 201);
  // планировщик проверяет сроки каждые 250 мс
  const note = await waitFor(bStream, 'notify', d => d.type === 'overdue_tasks' && (d.tasks || []).some(t => t.id === task.data.id), 4000);
  assert.ok(note, 'уведомление о просроченной задаче пришло');
  assert.ok(note.count >= 1);
  assert.ok(Array.isArray(note.tasks) && note.tasks[0].title && note.tasks[0].due);
  await sleep(700);
  const repeats = bStream.events.filter(e => e.ev === 'notify' && e.data?.type === 'overdue_tasks' && (e.data.tasks || []).some(t => t.id === task.data.id)).length;
  assert.equal(repeats, 1, 'повторный тик не дублирует уведомление');
  assert.ok(adminStream.events.some(e => e.ev === 'notify' && e.data?.type === 'overdue_tasks'), 'напоминание видят все сотрудники');
  assert.ok(cStream.events.some(e => e.ev === 'notify' && e.data?.type === 'overdue_tasks'));
});
