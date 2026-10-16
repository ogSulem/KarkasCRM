import { test, before, after } from 'node:test';
import assert from 'node:assert';
process.env.DATA_DIR = '/tmp/karkas-test-' + Date.now();
process.env.PORT = '18099';
const { server } = await import('../backend/src/server.js');
const base = 'http://127.0.0.1:18099';
let h;
const call = (p, opt = {}) => fetch(base + p, { ...opt, headers: { 'Content-Type': 'application/json', ...(h || {}), ...(opt.headers || {}) } }).then(async r => ({ status: r.status, body: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text() }));
before(async () => { await new Promise(r => server.listening ? r() : server.once('listening', r)); });
after(() => server.close());

test('health и вход', async () => {
  assert.equal((await call('/api/health')).body.ok, true);
  const l = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@example.com', password: 'admin12345' }) });
  assert.ok(l.body.token, 'получен JWT');
  h = { Authorization: 'Bearer ' + l.body.token };
  assert.equal((await fetch(base + '/api/contacts')).status, 401, 'без токена — 401');
  assert.equal((await fetch(base + '/api/contacts', { headers: { Authorization: 'Bearer broken.token' } })).status, 401, 'битый токен — 401');
});

test('объединение чатов WhatsApp + Telegram в один диалог клиента', async () => {
  await call('/webhooks/wazzup', { method: 'POST', body: JSON.stringify({ messages: [{ messageId: 'wz-1', channelId: 'ch-1', chatType: 'whatsapp', chatId: '79115550101', status: 'inbound', text: 'Здравствуйте, нужен дом!', contact: { name: 'Клиент Wazzup', phone: '+79115550101' } }] }) });
  // новый формат вебхука Wazzup (message.add / data[])
  await call('/webhooks/wazzup', { method: 'POST', body: JSON.stringify({ event: 'message.add', data: [{ message_id: 'wz-2', channel_id: 'ch-2', direction: 'inbound', timestamp: Date.now(), text: 'А это уже Telegram', recipient: { chat_id: '79115550101', chat_type: 'telegram', phone: '79115550101', name: 'Клиент Wazzup' } }] }) });
  await call('/webhooks/wazzup', { method: 'POST', body: JSON.stringify({ messages: [{ messageId: 'wz-1', channelId: 'ch-1', chatType: 'whatsapp', chatId: '79115550101', status: 'inbound', text: 'дубль', contact: { phone: '+79115550101' } }] }) }); // идемпотентность
  const convs = (await call('/api/conversations')).body.filter(c => (c.phone || '').includes('9115550101'));
  assert.equal(convs.length, 1, 'один объединённый чат на клиента');
  assert.ok(convs[0].channels.includes('whatsapp') && convs[0].channels.includes('telegram'), 'оба канала в одном чате');
  const msgs = (await call(`/api/conversations/${convs[0].id}/messages`)).body;
  assert.equal(msgs.length, 2, 'дубликат вебхука не создал сообщение');
  const deals = (await call('/api/deals')).body.deals.filter(d => d.contact_name === 'Клиент Wazzup');
  assert.equal(deals.length, 1, 'автосоздана сделка на первом обращении');
});

test('сделки, товары и пересчёт суммы', async () => {
  const c = (await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Тестовая сделка', amount: 0, stage: 'new', contact_id: 1 }) })).body;
  await call(`/api/deals/${c.id}/products`, { method: 'POST', body: JSON.stringify({ product_id: 1, qty: 2 }) });
  const card = (await call('/api/deals/' + c.id)).body;
  assert.equal(card.products.length, 1);
  assert.equal(card.deal.amount, card.products[0].price * 2, 'сумма сделки = сумма позиций');
  const moved = (await call('/api/deals/' + c.id, { method: 'PATCH', body: JSON.stringify({ stage: 'won' }) })).body;
  assert.equal(moved.stage, 'won');
  assert.ok((await call('/api/deals/' + c.id)).body.history.some(x => /этап/.test(x.text)), 'смена этапа записана в историю');
  assert.ok((await call(`/api/deals/${c.id}/products`)).body.length === 1);
  await call('/api/deal_products/' + card.products[0].id, { method: 'DELETE' });
  assert.equal((await call('/api/deals/' + c.id)).body.deal.amount, 0, 'после удаления позиции сумма = 0');
});

test('контакты, компании, задачи, заметки, поиск, экспорт', async () => {
  const comp = (await call('/api/companies', { method: 'POST', body: JSON.stringify({ name: 'ООО Тест', inn: '7700000000' }) })).body;
  const ct = (await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Иван Тестов', phone: '+7 900 111-22-33', company_id: comp.id }) })).body;
  await call('/api/contacts/' + ct.id, { method: 'PATCH', body: JSON.stringify({ tags: 'тест,сделка' }) });
  const notes = (await call('/api/notes', { method: 'POST', body: JSON.stringify({ entity_type: 'contacts', entity_id: ct.id, body: 'Созвонились' }) })).body;
  assert.equal((await call(`/api/notes?type=contacts&entity=${ct.id}`)).body.length, 1);
  await call('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'Позвонить Ивану', type: 'call', contact_id: ct.id }) });
  assert.ok((await call('/api/search?q=Иван')).body.contacts.length >= 1);
  const csv = (await call('/api/export/contacts')).body;
  assert.ok(String(csv).includes('Иван Тестов'), 'CSV-экспорт контактов');
  assert.ok((await call('/api/backup')).body.contacts.length > 0, 'полный бэкап');
});

test('настройка воронки и этапов из интерфейса', async () => {
  const pipe = (await call('/api/pipelines', { method: 'POST', body: JSON.stringify({ name: 'Воронка сервиса' }) })).body;
  await call('/api/pipelines/' + pipe.id, { method: 'PUT', body: JSON.stringify({ name: 'Сервис и монтаж', stages: [{ code: 'in', name: 'Заявка', color: '#f97316' }, { code: 'work', name: 'В работе', color: '#16a34a' }, { code: 'won', name: 'Готово', color: '#15803d', kind: 'won' }] }) });
  const pl = (await call('/api/pipelines')).body.find(p => p.id === pipe.id);
  assert.equal(pl.name, 'Сервис и монтаж');
  assert.deepEqual(pl.stages.map(s => s.name), ['Заявка', 'В работе', 'Готово']);
});

test('автоматизации, шаблоны, интеграции, команда и права', async () => {
  await call('/api/automations', { method: 'POST', body: JSON.stringify({ name: 'Новая сделка → тег', trigger_type: 'deal_created', action_type: 'add_tag', action_value: 'новый-лид' }) });
  await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Автосделка', stage: 'new', contact_id: 1 }) });
  const c = (await call('/api/contacts/1')).body;
  assert.ok((c.tags || '').includes('новый-лид'), 'автоматизация добавила тег при создании сделки');
  const tpl = (await call('/api/templates', { method: 'POST', body: JSON.stringify({ name: 'Тест', body: 'Здравствуйте, {name}!' }) })).body;
  assert.ok(tpl.id);
  // Wazzup: маскировка ключа и синхронизация каналов
  await call('/api/settings', { method: 'PUT', body: JSON.stringify({ WAZZUP_API_KEY: 'test-api-key-123456', WAZZUP_CHANNEL_ID: 'e0629e11-0f67-4567-92a9-2237e91ec1b9' }) });
  const set = (await call('/api/settings')).body;
  assert.ok(set.wazzup.api_key.startsWith('••••••'), 'ключ Wazzup маскируется');
  assert.equal(set.wazzup.configured, true);
  const test = await call('/api/integrations/wazzup/test', { method: 'POST' });
  assert.equal(test.status, 400, 'без реального ключа Wazzup возвращается понятная ошибка');
  // команда и роли
  const mgr = (await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Менеджер', email: 'mgr@example.com', password: 'manager12345', role: 'manager' }) })).body;
  const vw = (await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Наблюдатель', email: 'view@example.com', password: 'viewer12345', role: 'viewer' }) })).body;
  const mgrToken = (await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'mgr@example.com', password: 'manager12345' }) })).body.token;
  const vwToken = (await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'view@example.com', password: 'viewer12345' }) })).body.token;
  assert.ok(mgrToken && vwToken);
  const adminH = h; h = { Authorization: 'Bearer ' + mgrToken };
  assert.equal((await call('/api/settings', { method: 'PUT', body: JSON.stringify({ COMPANY_NAME: 'x' }) })).status, 403, 'менеджер не меняет настройки');
  assert.equal((await call('/api/contacts')).status, 200, 'менеджер видит данные');
  h = { Authorization: 'Bearer ' + vwToken };
  assert.equal((await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Nope' }) })).status, 403, 'наблюдатель только читает');
  h = adminH;
});

test('WhatsApp Cloud API и Telegram вебхуки', async () => {
  assert.equal((await call('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=karkas-verify&hub.challenge=CH42')).body, 'CH42');
  await call('/webhooks/whatsapp', { method: 'POST', body: JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: '79223334455', profile: { name: 'Meta Клиент' } }], messages: [{ from: '79223334455', id: 'wamid.X', text: { body: 'Привет из Meta' } }] } }] }] }) });
  await call('/webhooks/telegram', { method: 'POST', body: JSON.stringify({ message: { message_id: 5, chat: { id: 79223334455 }, from: { first_name: 'Meta' }, text: 'И из Telegram' } }) });
  const conv = (await call('/api/conversations')).body.find(c => (c.phone || '').includes('9223334455'));
  assert.ok(conv && conv.channels.includes('whatsapp') && conv.channels.includes('telegram'), 'Meta и Telegram слиты в один чат');
});

test('отправка сообщения клиенту через Wazzup (сквозная проверка запроса к API)', async () => {
  // локальная заглушка API Wazzup — проверяем точный формат запроса и что оно «доставлено»
  const mock = (await import('node:http')).createServer(async (req, res) => {
    let b = ''; for await (const ch of req) b += ch;
    const okAuth = req.headers.authorization === 'Bearer test-api-key-123456';
    if (req.url === '/channels') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ channels: [{ channelId: 'e0629e11-0f67-4567-92a9-2237e91ec1b9', name: 'WhatsApp Продажи', transport: 'whatsapp', state: 'active', plainId: '79991112233' }] })); }
    if (req.url === '/message' && req.method === 'POST') {
      globalThis.__wz = { auth: okAuth, body: JSON.parse(b) };
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ messageId: 'wz-out-1' }));
    }
    if (req.url === '/webhooks') { globalThis.__wzHook = JSON.parse(b); res.writeHead(200); return res.end('{}'); }
    res.writeHead(404); res.end('{}');
  });
  await new Promise(r => mock.listen(18155, r));
  try {
    await call('/api/settings', { method: 'PUT', body: JSON.stringify({ WAZZUP_API_URL: 'http://127.0.0.1:18155', WAZZUP_CHANNEL_ID: 'e0629e11-0f67-4567-92a9-2237e91ec1b9', MESSENGER_PROVIDER: 'wazzup' }) });
    const sync = await call('/api/integrations/wazzup/sync', { method: 'POST' });
    assert.equal(sync.body.synced, 1, 'каналы Wazzup синхронизированы');
    const chans = (await call('/api/channels')).body;
    assert.equal(chans[0].name, 'WhatsApp Продажи');
    await call('/api/integrations/wazzup/webhook', { method: 'POST', body: JSON.stringify({ url: 'https://crm.example.com/webhooks/wazzup' }) });
    assert.equal(globalThis.__wzHook.webhooksUri, 'https://crm.example.com/webhooks/wazzup', 'вебхук зарегистрирован в Wazzup');
    const conv = (await call('/api/conversations')).body.find(c => (c.phone || '').includes('79115550101'));
    assert.ok(conv, 'нашлась беседа с клиентом Wazzup');
    const sent = await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'Здравствуйте! Отправляю расчёт.', channel: 'whatsapp' }) });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.send.delivered, true, 'сообщение ушло в Wazzup');
    assert.equal(sent.body.send.mode, 'wazzup');
    assert.equal(globalThis.__wz.auth, true, 'передан Bearer-ключ Wazzup');
    assert.equal(globalThis.__wz.body.channelId, 'e0629e11-0f67-4567-92a9-2237e91ec1b9', 'channelId из настроек');
    assert.equal(globalThis.__wz.body.chatType, 'whatsapp');
    assert.equal(globalThis.__wz.body.text, 'Здравствуйте! Отправляю расчёт.');
    assert.ok(/^\d+$/.test(globalThis.__wz.body.chatId), 'chatId — только цифры, как требует Wazzup');
    // отправка с выбором другого типа канала (как в интерфейсе: Telegram-канал Wazzup)
    await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'Ответ в Telegram', chat_type: 'telegram' }) });
    assert.equal(globalThis.__wz.body.chatType, 'telegram', 'тип канала берётся из интерфейса');
    assert.ok(globalThis.__wz.body.chatId.length > 0, 'для Telegram используется идентификатор чата из вебхука');
    assert.equal(sent.body.message.status, 'sent');
  } finally { mock.close(); }
});

test('SPA-фронтенд отдаётся и работает fallback на index.html', async () => {
  const idx = await fetch(base + '/');
  assert.equal(idx.status, 200);
  const html = await idx.text();
  assert.ok(html.includes('KarkasCRM') && html.includes('/app.js'), 'index.html с подключением app.js');
  for (const f of ['/app.js', '/style.css']) {
    const r = await fetch(base + f);
    assert.equal(r.status, 200, f + ' отдаётся');
    assert.ok((await r.text()).length > 500, f + ' не пустой');
  }
  const spa = await fetch(base + '/some/client/route');
  assert.equal(spa.status, 200, 'SPA fallback для внутренних маршрутов');
  assert.ok((await spa.text()).includes('<div id="app"'), 'вернулся index.html');
});
