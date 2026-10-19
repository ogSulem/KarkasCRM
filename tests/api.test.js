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
  const product = (await call('/api/products', { method: 'POST', body: JSON.stringify({ name: 'Тестовый дом', sku: 'DOM-T', price: 100000, unit: 'шт' }) })).body;
  const c = (await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Тестовая сделка', amount: 0, stage: 'new', contact_id: 1 }) })).body;
  await call(`/api/deals/${c.id}/products`, { method: 'POST', body: JSON.stringify({ product_id: product.id, qty: 2 }) });
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
  assert.ok((await call('/api/export/json')).body.contacts.length > 0, 'полный бэкап');
  assert.ok((await call('/api/backup')).body.contacts.length > 0, 'старый адрес бэкапа тоже жив');
});

test('резервные копии базы: создать, скачать, защита от подмены пути', async () => {
  const made = await call('/api/backups', { method: 'POST' });
  assert.ok(made.body.created, 'файл копии создан');
  const list = await call('/api/backups');
  assert.ok(list.body.files.some(f => f.name === made.body.created), 'копия видна в списке');
  const file = made.body.created;
  const dl = await fetch(base + '/api/backups/download?file=' + file, { headers: h });
  assert.equal(dl.status, 200, 'копия скачивается');
  assert.equal(dl.headers.get('content-type'), 'application/vnd.sqlite3');
  const bytes = Buffer.from(await dl.arrayBuffer());
  assert.equal(bytes.subarray(0, 15).toString(), 'SQLite format 3', 'это настоящий файл базы SQLite');
  assert.equal((await fetch(base + '/api/backups/download?file=' + file)).status, 401, 'без токена копия не отдаётся');
  assert.equal((await call('/api/backups/download?file=../crm.db')).status, 400, 'выход из каталога копий запрещён');
  assert.equal((await call('/api/backups/download?file=no-such-file.db')).status, 404, 'несуществующая копия — 404');
  assert.equal((await call('/api/backups/download?file=кириллица.db')).status, 400, 'подозрительное имя отклонено');
  assert.equal((await call('/api/backups/restore', { method: 'POST', body: JSON.stringify({ file: '../crm.db' }) })).status, 400);
  assert.equal((await call('/api/backups/restore', { method: 'POST', body: JSON.stringify({ file: 'no-such-file.db' }) })).status, 404);
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
  assert.ok(html.includes('КаркасCRM') && html.includes('/app.js'), 'index.html с подключением app.js');
  for (const f of ['/app.js', '/style.css']) {
    const r = await fetch(base + f);
    assert.equal(r.status, 200, f + ' отдаётся');
    assert.ok((await r.text()).length > 500, f + ' не пустой');
  }
  const spa = await fetch(base + '/some/client/route');
  assert.equal(spa.status, 200, 'SPA fallback для внутренних маршрутов');
  assert.ok((await spa.text()).includes('<div id="app"'), 'вернулся index.html');
});

test('почта: входящее письмо попадает в тот же чат клиента', async () => {
  const hook = b => call('/webhooks/email', { method: 'POST', body: JSON.stringify(b) });
  await hook({ from: 'client@mail.ru', name: 'Почтовый клиент', subject: 'Прошу расчёт', text: 'Здравствуйте! Сколько стоит дом 8×10?' });
  await hook({ from: 'client@mail.ru', subject: 'Re: Прошу расчёт', text: 'И ещё вопрос про фундамент' });
  await hook({ from: 'client@mail.ru', subject: 'Игнор', text: 'Ещё письмо' });
  const convs = (await call('/api/conversations')).body.filter(c => (c.channels || '').includes('email'));
  assert.equal(convs.length, 1, 'все письма одного клиента — в одном чате');
  assert.ok((convs[0].channels || '').includes('email'));
  const msgs = (await call(`/api/conversations/${convs[0].id}/messages`)).body;
  assert.equal(msgs.length, 3, 'три письма в переписке');
  assert.ok(msgs.some(m => m.subject === 'Прошу расчёт'), 'тема письма сохраняется');
  const contacts = (await call('/api/contacts')).body.filter(c => c.email === 'client@mail.ru');
  assert.equal(contacts.length, 1, 'контакт создан один раз по e-mail');
  const send = await call(`/api/conversations/${convs[0].id}/email`, { method: 'POST', body: JSON.stringify({ subject: 'Ответ', body: 'Отправляю расчёт' }) });
  assert.equal(send.status, 400, 'без настроенного SMTP отправка честно сообщает об этом');
  assert.ok(/Почта не настроена/.test(send.body.error));
});

test('свои поля карточек: настройка из интерфейса и значения в карточках', async () => {
  const saved = await call('/api/custom-fields', { method: 'PUT', body: JSON.stringify({ fields: [{ key: 'area', label: 'Площадь участка', type: 'number', entity: 'both' }, { key: 'base', label: 'Тип фундамента', type: 'select', options: ['сваи', 'лента'] }, { key: 'bad key!', label: '', type: 'text' }] }) });
  assert.equal(saved.body.fields.length, 2, 'валидные поля сохранены, пустое — отброшено');
  assert.equal(saved.body.fields[0].key, 'area');
  const meta = (await call('/api/meta')).body;
  assert.ok(meta.customFields.some(f => f.key === 'area'), 'поля отдаются интерфейсу через /api/meta');
  assert.ok(meta.version && meta.features, 'meta содержит версию и состояние интеграций');
  await call('/api/contacts/1', { method: 'PATCH', body: JSON.stringify({ custom: JSON.stringify({ area: '120', base: 'сваи' }) }) });
  const c = (await call('/api/contacts/1')).body;
  assert.equal(JSON.parse(c.custom).area, '120', 'значение своего поля сохранилось в карточке');
  const d = (await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка с полем', amount: 100, stage: 'new', custom: JSON.stringify({ area: '85' }) }) })).body;
  assert.equal(JSON.parse((await call('/api/deals/' + d.id)).body.deal.custom).area, '85', 'свои поля работают и в сделках');
});

test('дубли контактов: поиск и объединение карточек', async () => {
  const a = (await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Иван Дубль', phone: '+7 999 123-45-67' }) })).body;
  const b = (await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Иван Дубль (Авито)', phone: '89991234567', email: 'dubl@mail.ru' }) })).body;
  await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка дубля', amount: 500, stage: 'new', contact_id: b.id }) });
  const dup = (await call('/api/contacts/duplicates')).body;
  const group = dup.groups.find(g => g.contacts.some(c => c.id === a.id));
  assert.ok(group, 'дубль найден по телефону');
  const merged = await call('/api/contacts/merge', { method: 'POST', body: JSON.stringify({ keep: a.id, ids: group.contacts.map(c => c.id) }) });
  assert.equal(merged.status, 200);
  assert.ok(merged.body.merged >= 1, 'карточки объединены');
  const left = (await call('/api/contacts')).body.filter(c => [a.id, b.id].includes(c.id));
  assert.equal(left.length, 1, 'осталась одна карточка');
  assert.equal(left[0].email, 'dubl@mail.ru', 'пустые поля заполнены из дубля');
  const deals = (await call('/api/deals')).body.deals.filter(d => d.contact_id === a.id);
  assert.ok(deals.some(d => d.title === 'Сделка дубля'), 'сделки перенесены в основную карточку');
  const after = (await call('/api/contacts/duplicates')).body;
  assert.ok(!after.groups.some(g => g.contacts.some(c => c.id === a.id)), 'дубль больше не находится');
});

test('состояние системы: health, версия, резервные копии', async () => {
  const health = (await call('/api/health')).body;
  assert.equal(health.version, '1', 'продукт всегда сообщает версию 1');
  assert.ok(health.uptimeSec >= 0, 'health отдаёт аптайм');
  assert.ok(health.counts.contacts > 0 && health.counts.deals > 0, 'health отдаёт счётчики записей');
  const made = await call('/api/backups', { method: 'POST' });
  assert.equal(made.status, 200);
  const list = (await call('/api/backups')).body;
  assert.ok(list.files.some(f => f.name === made.body.created), 'созданная копия видна в списке');
  assert.ok(list.files[0].sizeBytes > 0, 'копия не пустая');
  assert.ok(list.keepDays >= 0, 'настройка хранения копий читается');
});

test('чистая установка: эндпоинт демонстрационных данных отключён', async () => {
  const gone = await call('/api/demo/clean', { method: 'POST' });
  assert.equal(gone.status, 404, 'в продукте нет команды очистки примеров данных');
});

test('права: менеджер ведёт клиентов, но не меняет настройки; наблюдатель — только чтение', async () => {
  const admin = h;
  await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Менеджер Пётр', email: 'petr@example.com', password: 'menedzher123', role: 'manager' }) });
  await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Наблюдатель', email: 'viewer@example.com', password: 'nabludatel123', role: 'viewer' }) });
  const login = async (email, password) => (await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })).body.token;
  const mToken = await login('petr@example.com', 'menedzher123');
  const vToken = await login('viewer@example.com', 'nabludatel123');
  const asM = (p, opt = {}) => call(p, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + mToken } });
  const asV = (p, opt = {}) => call(p, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + vToken } });

  const c = await asM('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Клиент менеджера', phone: '+7 999 000-11-22' }) });
  assert.equal(c.status, 201, 'менеджер создаёт контакты');
  const d = await asM('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка менеджера', amount: 1000, stage: 'new', contact_id: c.body.id }) });
  assert.equal(d.status, 201, 'менеджер создаёт сделки');
  assert.equal((await asM('/api/deals/' + d.body.id, { method: 'PATCH', body: JSON.stringify({ stage: 'open' }) })).status, 200, 'менеджер двигает сделки');
  for (const [path, method, body] of [['/api/settings', 'PUT', '{"COMPANY_NAME":"Хак"}'], ['/api/pipelines', 'POST', '{"name":"Хак"}'], ['/api/templates', 'POST', '{"name":"Хак","body":"x"}'], ['/api/automations', 'POST', '{"name":"Хак","trigger_type":"deal_created","action_type":"create_task","action_value":"x"}'], ['/api/custom-fields', 'PUT', '{"fields":[]}'], ['/api/users', 'POST', '{"name":"Хак","email":"h@h.ru","password":"hacker1234"}'], ['/api/backups', 'POST', '{}']]) {
    assert.equal((await asM(path, { method, body })).status, 403, 'менеджеру запрещено: ' + method + ' ' + path);
  }
  assert.equal((await asV('/api/contacts')).status, 200, 'наблюдатель читает данные');
  assert.equal((await asV('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Нельзя' }) })).status, 403, 'наблюдатель не создаёт записи');
  assert.equal((await asV('/api/deals/' + d.body.id, { method: 'PATCH', body: JSON.stringify({ amount: 1 }) })).status, 403, 'наблюдатель не меняет сделки');
  h = admin; // дальше снова работаем администратором
});

test('карточка сделки показывает переписку клиента', async () => {
  const convs = (await call('/api/conversations')).body;
  const conv = convs.find(c => (c.phone || '').includes('79115550101'));
  const client = (await call('/api/contacts')).body.find(c => c.id === conv.contact_id);
  const deal = (await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка с перепиской', amount: 500, stage: 'new', contact_id: client.id }) })).body;
  const card = (await call('/api/deals/' + deal.id)).body;
  assert.ok(card.conversation && card.conversation.id === conv.id, 'в карточке сделки есть ссылка на чат клиента');
  assert.ok(card.messages.length >= 2, 'переписка клиента отдаётся вместе со сделкой');
  assert.ok(card.messages.some(m => m.direction === 'in'), 'видны входящие сообщения клиента');
});

test('Wazzup: отправка файла по ссылке и понятные подсказки об ошибках', async () => {
  const mock = (await import('node:http')).createServer(async (req, res) => {
    let b = ''; for await (const ch of req) b += ch;
    if (req.url === '/message' && req.method === 'POST') { (globalThis.__wzFiles = globalThis.__wzFiles || []).push(JSON.parse(b)); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ messageId: 'wz-file-' + globalThis.__wzFiles.length })); }
    res.writeHead(404); res.end('{}');
  });
  await new Promise(r => mock.listen(18156, r));
  try {
    await call('/api/settings', { method: 'PUT', body: JSON.stringify({ WAZZUP_API_URL: 'http://127.0.0.1:18156', WAZZUP_CHANNEL_ID: 'e0629e11-0f67-4567-92a9-2237e91ec1b9', MESSENGER_PROVIDER: 'wazzup' }) });
    const conv = (await call('/api/conversations')).body.find(c => (c.phone || '').includes('79115550101'));
    assert.equal((await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: JSON.stringify({ body: '   ' }) })).status, 400, 'пустое сообщение отклоняется с подсказкой');
    const file = await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: JSON.stringify({ contentUri: 'https://disk.yandex.ru/i/smeta.pdf', body: 'Смета во вложении', chat_type: 'whatsapp' }) });
    assert.equal(file.status, 201);
    const sentFile = globalThis.__wzFiles.find(x => x.contentUri);
    assert.equal(sentFile.contentUri, 'https://disk.yandex.ru/i/smeta.pdf', 'файл уходит ссылкой contentUri');
    assert.equal(sentFile.text, 'Смета во вложении', 'подпись к файлу передаётся');
    assert.equal(sentFile.chatType, 'whatsapp', 'тип канала из интерфейса');
    assert.ok(/^\d+$/.test(sentFile.chatId), 'для WhatsApp адресат — только цифры телефона, как требует Wazzup');
    assert.equal(file.body.message.content_uri, 'https://disk.yandex.ru/i/smeta.pdf', 'ссылка на файл сохраняется в истории чата');
    await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'Ещё одно сообщение', chat_type: 'whatsapp' }) });
    const ids = globalThis.__wzFiles.map(x => x.crmMessageId);
    assert.equal(ids.length, 2, 'два исходящих ушли в Wazzup');
    assert.notEqual(ids[0], ids[1], 'у каждого сообщения уникальный crmMessageId (Wazzup не склеит дубли)');
  } finally { mock.close(); }
});

test('автосоздание сделки: новое обращение клиента даёт новую сделку в «Неразобранном»', async () => {
  const phone = '79110007711';
  await call('/webhooks/generic', { method: 'POST', body: JSON.stringify({ channel: 'site', phone, name: 'Обращение с сайта', body: 'Нужен расчёт дома' }) });
  const first = (await call('/api/deals')).body.deals.filter(d => d.contact_name === 'Обращение с сайта');
  assert.equal(first.length, 1, 'первое обращение создало сделку');
  assert.equal(first[0].stage, 'new', 'сделка попала в «Неразобранное»');
  await call('/webhooks/generic', { method: 'POST', body: JSON.stringify({ channel: 'site', phone, body: 'И ещё вопрос' }) });
  assert.equal((await call('/api/deals')).body.deals.filter(d => d.contact_name === 'Обращение с сайта').length, 1, 'пока сделка открыта, второй сделки не создаётся');
  await call('/api/deals/' + first[0].id, { method: 'PATCH', body: JSON.stringify({ stage: 'won' }) });
  await call('/webhooks/generic', { method: 'POST', body: JSON.stringify({ channel: 'site', phone, body: 'Здравствуйте, вернулся! Нужен ещё один дом' }) });
  assert.equal((await call('/api/deals')).body.deals.filter(d => d.contact_name === 'Обращение с сайта').length, 2, 'вернувшийся клиент получил новую сделку');
});

test('автоназначение: новые обращения распределяются между менеджерами', async () => {
  await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Менеджер Анна', email: 'anna@example.com', password: 'menedzher456', role: 'manager' }) });
  await call('/api/settings', { method: 'PUT', body: JSON.stringify({ AUTO_ASSIGN: '1', AUTO_DEAL: '1' }) });
  for (const phone of ['79110008811', '79110008822']) await call('/webhooks/generic', { method: 'POST', body: JSON.stringify({ channel: 'site', phone, name: 'Лид ' + phone.slice(-4), body: 'Нужен расчёт' }) });
  const deals = (await call('/api/deals')).body.deals.filter(d => /Лид/.test(d.contact_name || ''));
  assert.equal(deals.length, 2, 'оба обращения превратились в сделки');
  const owners = deals.map(d => d.responsible_id);
  assert.ok(owners.every(Boolean), 'у новых сделок есть ответственный');
  assert.notEqual(owners[0], owners[1], 'лиды распределились между менеджерами поровну, а не одному');
  const contacts = (await call('/api/contacts')).body.filter(c => /^Лид /.test(c.name));
  assert.ok(contacts.every(c => c.responsible_id), 'ответственный виден и в карточке клиента');
  await call('/api/settings', { method: 'PUT', body: JSON.stringify({ AUTO_ASSIGN: '0' }) });
});

test('массовые действия: одна операция на пачку записей', async () => {
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: `Пачка ${i}`, phone: `+7 900 000-00-0${i}` }) })).body.id);
  const upd = await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'contacts', ids, action: 'update', patch: { tags: 'пачка,тест' } }) });
  assert.equal(upd.status, 200); assert.equal(upd.body.count, 3);
  const all = (await call('/api/contacts')).body.filter(c => String(c.tags || '').includes('пачка'));
  assert.equal(all.length, 3, 'тег проставился всем выбранным');
  assert.equal((await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'contacts', ids: [], patch: { tags: 'x' } }) })).status, 400, 'пустой список — ошибка');
  assert.equal((await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'contacts', ids, patch: { role: 'admin' } }) })).status, 400, 'недопустимое поле отброшено');
  const del = await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'contacts', ids, action: 'delete' }) });
  assert.equal(del.status, 200);
  assert.equal((await call('/api/contacts')).body.filter(c => ids.includes(c.id)).length, 0, 'записи удалены');
});

test('менеджер не меняет правила и шаблоны, но работает с клиентами', async () => {
  const created = (await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Менеджер Оля', email: `olya${Date.now()}@example.com`, password: 'manager12345', role: 'manager' }) })).body;
  const login = (await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: `olya${Date.now() - 1}@example.com`, password: 'manager12345' }) })).body;
  // повторный вход с тем же e-mail, что и создавали
  const users = (await call('/api/users')).body; const u = users.find(x => x.id === created.id);
  const l2 = (await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: u.email, password: 'manager12345' }) })).body;
  const mh = { Authorization: 'Bearer ' + l2.token };
  const mcall = (path, opt = {}) => fetch(base + path, { ...opt, headers: { 'Content-Type': 'application/json', ...mh, ...(opt.headers || {}) } }).then(async r => ({ status: r.status, body: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text() }));
  assert.equal((await mcall('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Клиент Оли' }) })).status, 201, 'менеджер ведёт клиентов');
  assert.equal((await mcall('/api/automations', { method: 'POST', body: JSON.stringify({ name: 'Правило', trigger_type: 'deal_created', action_type: 'create_task', action_value: 'x' }) })).status, 403, 'правила — только админ');
  assert.equal((await mcall('/api/templates', { method: 'POST', body: JSON.stringify({ name: 'Шаблон', body: 'x', channel: 'whatsapp' }) })).status, 403, 'шаблоны — только админ');
  assert.equal((await mcall('/api/settings', { method: 'PUT', body: JSON.stringify({ COMPANY_NAME: 'Взлом' }) })).status, 403, 'настройки — только админ');
  assert.equal((await mcall('/api/users', { method: 'POST', body: JSON.stringify({ name: 'x', email: 'x@x.ru', password: '12345678' }) })).status, 403, 'команда — только админ');
});

test('печать КП и счёта: реквизиты, позиции и суммы на месте', async () => {
  await call('/api/settings', { method: 'PUT', body: JSON.stringify({ COMPANY_NAME: 'ООО «Каркас»', COMPANY_INN: '7712345678', COMPANY_KPP: '771201001', COMPANY_ADDRESS: 'Москва, ул. Лесная, 1', COMPANY_BANK: 'АО «Тинькофф Банк», БИК 044525974', COMPANY_ACCOUNT: '40702810100000012345', COMPANY_SIGNER: 'Петров П. П.', COMPANY_SIGNER_POSITION: 'Директор', DOC_PREFIX: 'КП' }) });
  const settings = (await call('/api/settings')).body;
  assert.equal(settings.requisites.inn, '7712345678', 'реквизиты сохраняются');
  assert.equal(settings.requisites.signer, 'Петров П. П.');
  const client = (await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Заказчик Печати', phone: '+7 916 000-11-22', email: 'print@example.com' }) })).body;
  const deal = (await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Дом 8×10', amount: 0, contact_id: client.id }) })).body;
  assert.ok(deal.id, 'сделка для печати создана');
  await call(`/api/deals/${deal.id}/products`, { method: 'POST', body: JSON.stringify({ name: 'Каркасный дом 8×10', price: 3000000, qty: 1 }) });
  await call(`/api/deals/${deal.id}/products`, { method: 'POST', body: JSON.stringify({ name: 'Фундамент', price: 200000, qty: 2 }) });
  const quote = await fetch(base + `/api/deals/${deal.id}/print?doc=quote&token=` + h.Authorization.split(' ')[1]);
  assert.equal(quote.status, 200);
  assert.match(quote.headers.get('content-type'), /text\/html/);
  const html = await quote.text();
  assert.match(html, /Коммерческое предложение/);
  assert.match(html, /ООО «Каркас»/);
  assert.match(html, /ИНН 7712345678/);
  assert.match(html, /Фундамент/);
  assert.match(html, /3\s?400\s?000/, 'итог считается по позициям');
  assert.match(html, /window\.print\(\)/, 'на странице есть кнопка печати');
  const invoice = await (await fetch(base + `/api/deals/${deal.id}/print?doc=invoice&token=` + h.Authorization.split(' ')[1])).text();
  assert.match(invoice, /Счёт на оплату/);
  assert.match(invoice, /НДС 20%/);
  assert.match(invoice, /40702810100000012345/, 'банковские реквизиты в счёте');
  assert.equal((await fetch(base + `/api/deals/${deal.id}/print`)).status, 401, 'без токена документ не отдаётся');
  assert.equal((await fetch(base + '/api/deals/999999/print?token=' + h.Authorization.split(' ')[1])).status, 404);
});

test('повторяющиеся задачи: закрыл — появилась следующая', async () => {
  const t = (await call('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'Обзвон клиентов', type: 'call', due: '2026-01-15 09:30', repeat: 'weekly', responsible_id: 1 }) })).body;
  assert.equal(t.repeat, 'weekly', 'повтор сохранился');
  const done = await call('/api/tasks/' + t.id, { method: 'PATCH', body: JSON.stringify({ done: 1 }) });
  assert.ok(done.body.next_task_id, 'создана следующая задача');
  const next = (await call('/api/tasks/' + done.body.next_task_id)).body;
  assert.equal(next.title, 'Обзвон клиентов');
  assert.equal(next.repeat, 'weekly');
  assert.equal(next.done, 0);
  assert.match(next.due, /09:30$/, 'время суток сохраняется');
  assert.ok(new Date(next.due.replace(' ', 'T')) > new Date(), 'новый срок в будущем');
  const plain = (await call('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'Разовое дело', type: 'other' }) })).body;
  const plainDone = await call('/api/tasks/' + plain.id, { method: 'PATCH', body: JSON.stringify({ done: 1 }) });
  assert.ok(!plainDone.body.next_task_id, 'обычная задача не размножается');
});

test('защита входа: ограничение попыток подбора пароля', async () => {
  const codes = [];
  for (let i = 0; i < 16; i++) codes.push((await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@example.com', password: 'wrong-' + i }) })).status);
  assert.ok(codes.includes(429), 'после серии неудачных попыток вход блокируется (429)');
  const ok = await call('/api/health');
  assert.equal(ok.status, 200, 'сервис продолжает работать');
});
