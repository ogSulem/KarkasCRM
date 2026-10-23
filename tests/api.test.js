import { test, before, after } from 'node:test';
import assert from 'node:assert';
process.env.DATA_DIR = '/tmp/karkas-test-' + Date.now();
process.env.PORT = '18099';
process.env.SEED_MODE = 'off'; // детерминированная чистая база для тестов
const { server } = await import('../backend/src/server.js');
const base = 'http://127.0.0.1:18099';
let h;
const call = (p, opt = {}) => fetch(base + p, { ...opt, headers: { 'Content-Type': 'application/json', ...(h || {}), ...(opt.headers || {}) } }).then(async r => ({ status: r.status, body: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text() }));
// Existing business scenarios run after the explicit first-login password change.
async function readyLogin(path, opt) {
  const result = await call(path, opt);
  if (result.body.user?.must_change_password) {
    const old = JSON.parse(opt.body).password;
    const changed = await call('/api/me/password', { method: 'POST', headers: { Authorization: 'Bearer ' + result.body.token }, body: JSON.stringify({ old_password: old, new_password: old + '-Personal-2026' }) });
    assert.equal(changed.status, 200);
    result.body.token = changed.body.token;
  }
  return result;
}
before(async () => { await new Promise(r => server.listening ? r() : server.once('listening', r)); });
after(() => server.close());

test('health и вход', async () => {
  const anon = (await call('/api/health')).body;
  assert.equal(anon.ok, true);
  // публичный health доступен без входа (Docker healthcheck), но не раскрывает бизнес-данные
  assert.equal(anon.counts, undefined, 'счётчики клиентов не видны без входа');
  assert.equal(anon.backups, undefined, 'имена резервных копий не видны без входа');
  const l = await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@example.com', password: 'admin12345' }) });
  assert.ok(l.body.token, 'получен JWT');
  h = { Authorization: 'Bearer ' + l.body.token };
  assert.equal((await fetch(base + '/api/contacts')).status, 401, 'без токена — 401');
  assert.equal((await fetch(base + '/api/contacts', { headers: { Authorization: 'Bearer broken.token' } })).status, 401, 'битый токен — 401');
  assert.equal((await fetch(base + '/api/contacts?token=' + encodeURIComponent(h.Authorization.split(' ')[1]), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401, 'токен в адресной строке не даёт менять данные');
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

test('логотип: отдаётся как изображение и кэшируется по ETag', async () => {
  const first = await fetch(base + '/logo.png');
  const bytes = (await first.arrayBuffer()).byteLength; // тело обязательно читаем: иначе сокет держит процесс
  assert.equal(first.status, 200);
  assert.ok(bytes > 100, 'логотип не пустой');
  assert.match(first.headers.get('content-type') || '', /^image\//, 'логотип отдаётся изображением');
  const etag = first.headers.get('etag');
  assert.ok(etag, 'у логотипа есть ETag');
  const second = await fetch(base + '/logo.png', { headers: { 'If-None-Match': etag } });
  await second.arrayBuffer();
  assert.equal(second.status, 304, 'неизменённый логотип не скачивается повторно');
  const favicon = await fetch(base + '/favicon.ico');
  await favicon.arrayBuffer();
  assert.equal(favicon.status, 200, 'иконка вкладки отдаётся по /favicon.ico');
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

test('строгая проверка данных: цена, срок и удалённые записи', async () => {
  const badPrice = await call('/api/products', { method: 'POST', body: JSON.stringify({ name: 'Отрицательная цена', price: -10 }) });
  assert.equal(badPrice.status, 400, 'отрицательная цена не сохраняется');
  assert.match(String(badPrice.body.error), /неотрицательн/i);
  const okPrice = await call('/api/products', { method: 'POST', body: JSON.stringify({ name: '  С ценой  ', price: '1234', unit: '  ' }) });
  assert.equal(okPrice.status, 201);
  assert.equal(okPrice.body.price, 1234, 'цена приводится к числу');
  assert.equal(okPrice.body.name, 'С ценой', 'название без лишних пробелов');
  assert.equal(okPrice.body.unit, 'шт', 'пустая единица заменяется на «шт»');
  assert.equal((await call('/api/products/' + okPrice.body.id, { method: 'PATCH', body: JSON.stringify({ price: -1 }) })).status, 400, 'отрицательная цена не проходит и при правке');
  await call('/api/products/' + okPrice.body.id, { method: 'DELETE' });

  const badDue = await call('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'Задача с мусорным сроком', due: 'когда-нибудь' }) });
  assert.equal(badDue.status, 400, 'непонятный срок не сохраняется');
  assert.match(String(badDue.body.error), /срок/i);
  const goodDue = await call('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'Задача с понятным сроком', due: 'завтра 10:00' }) });
  assert.equal(goodDue.status, 201);
  assert.match(goodDue.body.due, /^\d{4}-\d{2}-\d{2} 10:00$/, 'срок приведён к единому формату');

  assert.equal((await call('/api/contacts/999999')).status, 404, 'удалённый контакт отдаёт 404, а не пустую карточку');
  assert.equal((await call('/api/tasks/999999')).status, 404, 'удалённая задача отдаёт 404');
});

test('защита данных: этапы с делами, удаление сделки, позиции и секрет вебхука', async () => {
  const made = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка на этапе', amount: 0, stage: 'new' }) });
  assert.equal(made.status, 201);
  assert.equal((await call('/api/deals', { method: 'POST', body: JSON.stringify({ amount: 500 }) })).status, 400, 'сделка без названия не создаётся');

  const pl = (await call('/api/pipelines')).body.find(p => p.id === 1);
  const stages = pl.stages.map(s => ({ code: s.code, name: s.name, color: s.color, kind: s.kind }));
  const broken = await call('/api/pipelines/1', { method: 'PUT', body: JSON.stringify({ name: pl.name, stages: stages.filter(s => s.code !== 'new') }) });
  assert.equal(broken.status, 400, 'этап со сделками удалить нельзя');
  assert.match(String(broken.body.error), /сделк/i, 'подсказка объясняет причину');
  assert.equal((await call('/api/pipelines/1', { method: 'PUT', body: JSON.stringify({ name: pl.name, stages: stages.slice(0, 1) }) })).status, 400, 'минимум два этапа');
  assert.equal((await call('/api/pipelines/1', { method: 'PUT', body: JSON.stringify({ name: pl.name, stages }) })).status, 200, 'корректная воронка сохраняется');

  assert.equal((await call('/api/deals/999999/products', { method: 'POST', body: JSON.stringify({ name: 'Позиция', price: 1, qty: 1 }) })).status, 404, 'позицию нельзя добавить в несуществующую сделку');

  const task = (await call('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'Позвонить по сделке', deal_id: made.body.id }) })).body;
  await call('/api/deals/' + made.body.id, { method: 'DELETE' });
  const kept = (await call('/api/tasks')).body.find(t => t.id === task.id);
  assert.ok(kept, 'задача не удаляется вместе со сделкой');
  assert.equal(kept.deal_id, null, 'задача остаётся в списке дел без привязки');
  assert.equal((await call('/api/deals/' + made.body.id)).status, 404, 'сделка удалена');

  await call('/api/settings', { method: 'PUT', body: JSON.stringify({ WEBHOOK_SECRET: 's3cret-key' }) });
  const denied = await call('/webhooks/generic', { method: 'POST', body: JSON.stringify({ phone: '79001112233', body: 'спам' }) });
  assert.equal(denied.status, 403, 'без секрета заявка отклоняется');
  assert.equal((await call('/webhooks/generic?secret=s3cret-key', { method: 'POST', body: JSON.stringify({ phone: '79001112233', name: 'С формы', body: 'Настоящая заявка' }) })).status, 200, 'с секретом заявка проходит');
  await call('/api/settings', { method: 'PUT', body: JSON.stringify({ WEBHOOK_SECRET: '' }) });
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
  {
    // Выгрузка сделок открывается в Excel: даты должны быть 05.11.2026, а не 2026-11-05.
    const dl = (await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка для выгрузки', deadline: '2026-11-05' }) })).body;
    const dealsCsv = String((await call('/api/export/deals')).body);
    assert.match(dealsCsv, /Сделка для выгрузки/);
    assert.match(dealsCsv, /"05\.11\.2026"/, 'срок в выгрузке — дд.мм.гггг');
    assert.doesNotMatch(dealsCsv, /2026-11-05/, 'ISO-даты в выгрузке нет');
    await call('/api/deals/' + dl.id, { method: 'DELETE' });
  }
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
  // текст шаблона и канал не должны меняться местами
  assert.equal(tpl.body, 'Здравствуйте, {name}!', 'в шаблоне сохраняется текст ответа');
  assert.equal(tpl.channel, 'any', 'канал у шаблона не используется');
  // канал из старой формы игнорируется: куда отправить, выбирают в чате
  assert.equal((await call('/api/templates', { method: 'POST', body: JSON.stringify({ name: 'WA', body: 'Текст для WhatsApp', channel: 'whatsapp' }) })).body.channel, 'any');
  const changed = (await call('/api/templates/' + tpl.id, { method: 'PATCH', body: JSON.stringify({ channel: 'telegram', body: 'Новый текст' }) })).body;
  assert.equal(changed.channel, 'any', 'канал через API тоже не меняется');
  assert.equal(changed.body, 'Новый текст');
  // Wazzup: маскировка ключа и синхронизация каналов
  await call('/api/settings', { method: 'PUT', body: JSON.stringify({ WAZZUP_API_KEY: 'test-api-key-123456', WAZZUP_CHANNEL_ID: 'e0629e11-0f67-4567-92a9-2237e91ec1b9' }) });
  const set = (await call('/api/settings')).body;
  assert.ok(set.wazzup.api_key.startsWith('••••••'), 'ключ Wazzup маскируется');
  // публичный адрес CRM для ссылок и вебхуков
  assert.equal((await call('/api/settings', { method: 'PUT', body: JSON.stringify({ PUBLIC_URL: 'ftp://crm.local' }) })).status, 400, 'кривой публичный адрес не принимается');
  await call('/api/settings', { method: 'PUT', body: JSON.stringify({ PUBLIC_URL: 'https://crm.example.ru/' }) });
  assert.equal((await call('/api/settings')).body.public_url, 'https://crm.example.ru', 'адрес сохраняется без хвостового слэша');
  await call('/api/settings', { method: 'PUT', body: JSON.stringify({ PUBLIC_URL: '' }) });
  assert.equal((await call('/api/settings')).body.public_url, '', 'пустой адрес возвращает автоопределение');
  assert.equal(set.wazzup.configured, true);
  const test = await call('/api/integrations/wazzup/test', { method: 'POST' });
  assert.equal(test.status, 400, 'без реального ключа Wazzup возвращается понятная ошибка');
  // команда и роли
  const mgr = (await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Менеджер', email: 'mgr@example.com', password: 'manager12345', role: 'manager' }) })).body;
  const vw = (await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Наблюдатель', email: 'view@example.com', password: 'viewer12345', role: 'viewer' }) })).body;
  const mgrToken = (await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'mgr@example.com', password: 'manager12345' }) })).body.token;
  const vwToken = (await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'view@example.com', password: 'viewer12345' }) })).body.token;
  assert.ok(mgrToken && vwToken);
  const adminH = h; h = { Authorization: 'Bearer ' + mgrToken };
  assert.equal((await call('/api/settings', { method: 'PUT', body: JSON.stringify({ COMPANY_NAME: 'x' }) })).status, 403, 'менеджер не меняет настройки');
  assert.equal((await call('/api/contacts')).status, 200, 'менеджер видит данные');
  h = { Authorization: 'Bearer ' + vwToken };
  assert.equal((await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Nope' }) })).status, 403, 'наблюдатель только читает');
  h = adminH;
});

test('письма уходят через почту, а не через мессенджер', async () => {
  const conv = (await call('/api/conversations')).body[0];
  assert.ok(conv, 'есть чат для проверки');
  const viaMessenger = await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'Письмо', channel: 'email' }) });
  assert.equal(viaMessenger.status, 400, 'мессенджер не отправляет письма');
  const noSmtp = await call(`/api/conversations/${conv.id}/email`, { method: 'POST', body: JSON.stringify({ subject: 'Тема', body: 'Текст' }) });
  assert.equal(noSmtp.status, 400, 'без настроенного SMTP письмо не отправляется');
  assert.match(String(noSmtp.body.error), /Почта не настроена|SMTP|e-mail/i, 'подсказка объясняет, чего не хватает для отправки');
});

test('общий вебхук: любые каналы сливаются в один чат клиента', async () => {
  await call('/webhooks/generic', { method: 'POST', body: JSON.stringify({ channel: 'whatsapp', phone: '79223334455', name: 'Клиент с сайта', body: 'Заявка с формы' }) });
  await call('/webhooks/generic', { method: 'POST', body: JSON.stringify({ channel: 'telegram', chatId: '79223334455', chatType: 'telegram', name: 'Клиент с сайта', body: 'Написал в Telegram' }) });
  await call('/webhooks/generic', { method: 'POST', body: JSON.stringify({ channel: 'site', phone: '79223334455', name: 'Клиент с сайта', body: 'Ещё раз с формы' }) });
  const conv = (await call('/api/conversations')).body.find(c => (c.phone || '').includes('9223334455'));
  assert.ok(conv, 'чат создан');
  assert.ok(conv.channels.includes('whatsapp') && conv.channels.includes('telegram') && conv.channels.includes('site'), 'все каналы в одном чате');
  const msgs = (await call(`/api/conversations/${conv.id}/messages`)).body;
  assert.equal(msgs.length, 3, 'три сообщения в единой переписке');
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
    // Каналы за пределами «WhatsApp/Telegram/Instagram/Viber» — Авито, MAX, Циан,
    // ВКонтакте, WABA. Раньше неизвестный тип молча заменялся на whatsapp: ответ
    // клиенту с Авито уходил в WhatsApp и выглядел как доставленный.
    for (const t of ['avito', 'max', 'cian', 'vk', 'wapi', 'tgapi', 'maxbot']) {
      await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'Ответ', chat_type: t }) });
      assert.equal(globalThis.__wz.body.chatType, t, `транспорт ${t} передаётся в Wazzup без подмены`);
    }
    const bogus = await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'Ответ', chat_type: 'одноклассники' }) });
    assert.equal(bogus.body.message.status, 'error', 'неизвестный канал не отправляется молча');
    assert.match(bogus.body.send.mode, /одноклассники/, 'в ошибке назван канал, который не поддержан');
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
  assert.equal(send.status, 400, 'без настроенного SMTP отправка возвращает 400 с причиной');
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

test('обязательные свои поля: пустое значение не сохраняется', async () => {
  await call('/api/custom-fields', { method: 'PUT', body: JSON.stringify({ fields: [{ key: 'area', label: 'Площадь участка', type: 'number', entity: 'both', required: true }] }) });
  const bad = await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Без площади' }) });
  assert.equal(bad.status, 400, 'контакт без обязательного поля не создаётся');
  assert.match(String(bad.body.error), /Площадь участка/, 'ошибка называет поле');
  assert.equal((await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'С площадью', custom: JSON.stringify({ area: '90' }) }) })).status, 201, 'заполненное поле пропускает');
  const badDeal = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Без площади' }) });
  assert.equal(badDeal.status, 400, 'сделка тоже требует обязательное поле');
  // возвращаем необязательное поле, чтобы не мешать остальным сценариям
  await call('/api/custom-fields', { method: 'PUT', body: JSON.stringify({ fields: [{ key: 'area', label: 'Площадь участка', type: 'number', entity: 'both' }] }) });
});

test('создание контакта: проверка дублей по телефону и почте', async () => {
  const first = await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Проверка Дубля', phone: '+7 901 555-11-22', email: 'dup-check@example.com' }) });
  assert.equal(first.status, 201);
  // интерфейс просит проверить дубли: тот же телефон в другом формате должен дать 409 с id карточки
  const samePhone = await call('/api/contacts?check_duplicates=1', { method: 'POST', body: JSON.stringify({ name: 'Ещё один', phone: '89015551122' }) });
  assert.equal(samePhone.status, 409, 'дубль по телефону не создаётся');
  assert.equal(samePhone.body.duplicate.id, first.body.id, 'возвращается существующая карточка');
  const sameEmail = await call('/api/contacts?check_duplicates=1', { method: 'POST', body: JSON.stringify({ name: 'Ещё один', email: 'DUP-CHECK@example.com' }) });
  assert.equal(sameEmail.status, 409, 'дубль по почте не создаётся');
  // без проверки (импорт, осознанное решение менеджера) запись создаётся
  const forced = await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Сознательный дубль', phone: '+7 901 555-11-22' }) });
  assert.equal(forced.status, 201, 'без флага дубли разрешены');
  await call('/api/contacts/' + forced.body.id, { method: 'DELETE' });
  await call('/api/contacts/' + first.body.id, { method: 'DELETE' });
});

test('дубли контактов: поиск и объединение карточек', async () => {
  const a = (await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Иван Дубль', phone: '+7 999 123-45-67' }) })).body;
  const b = (await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Иван Дубль (Авито)', phone: '89991234567', email: 'dubl@mail.ru' }) })).body;
  await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка дубля', amount: 500, stage: 'new', contact_id: b.id }) });
  const dup = (await call('/api/contacts/duplicates')).body;
  const group = dup.groups.find(g => g.contacts.some(c => c.id === a.id));
  assert.ok(group, 'дубль найден по телефону');
  // интерфейс шлёт keep_id/merge_ids — проверяем именно этот формат, он должен работать
  const merged = await call('/api/contacts/merge', { method: 'POST', body: JSON.stringify({ keep_id: a.id, merge_ids: group.contacts.map(c => c.id) }) });
  assert.equal(merged.status, 200);
  assert.ok(merged.body.merged >= 1, 'карточки объединены');
  const left = (await call('/api/contacts')).body.filter(c => [a.id, b.id].includes(c.id));
  assert.equal(left.length, 1, 'осталась одна карточка');
  assert.equal(left[0].email, 'dubl@mail.ru', 'пустые поля заполнены из дубля');
  const afterMerge = (await call('/api/search?q=9991234567')).body;
  assert.ok(afterMerge.contacts.some(c => c.id === a.id || c.name === 'Иван Дубль'), 'после объединения телефон находится поиском (phone_norm пересчитан)');
  const deals = (await call('/api/deals')).body.deals.filter(d => d.contact_id === a.id);
  assert.ok(deals.some(d => d.title === 'Сделка дубля'), 'сделки перенесены в основную карточку');
  const after = (await call('/api/contacts/duplicates')).body;
  assert.ok(!after.groups.some(g => g.contacts.some(c => c.id === a.id)), 'дубль больше не находится');
});

test('состояние системы: health, версия, резервные копии', async () => {
  const health = (await call('/api/health')).body;
  assert.equal(health.version, '1.0.0', 'health сообщает версию из файла VERSION');
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
  const login = async (email, password) => (await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })).body.token;
  const mToken = await login('petr@example.com', 'menedzher123');
  const vToken = await login('viewer@example.com', 'nabludatel123');
  const asM = (p, opt = {}) => call(p, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + mToken } });
  const asV = (p, opt = {}) => call(p, { ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + vToken } });

  const c = await asM('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Клиент менеджера', phone: '+7 999 000-11-22' }) });
  assert.equal(c.status, 201, 'менеджер создаёт контакты');
  const d = await asM('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка менеджера', amount: 1000, stage: 'new', contact_id: c.body.id }) });
  assert.equal(d.status, 201, 'менеджер создаёт сделки');
  assert.equal((await asM('/api/deals/' + d.body.id, { method: 'PATCH', body: JSON.stringify({ stage: 'contact' }) })).status, 200, 'менеджер двигает сделки');
  for (const [path, method, body] of [['/api/settings', 'PUT', '{"COMPANY_NAME":"Хак"}'], ['/api/pipelines', 'POST', '{"name":"Хак"}'], ['/api/automations', 'POST', '{"name":"Хак","trigger_type":"deal_created","action_type":"create_task","action_value":"x"}'], ['/api/custom-fields', 'PUT', '{"fields":[]}'], ['/api/users', 'POST', '{"name":"Хак","email":"h@h.ru","password":"hacker1234"}'], ['/api/backups', 'POST', '{}'], ['/api/demo/cleanup', 'POST', '{}']]) {
    assert.equal((await asM(path, { method, body })).status, 403, 'менеджеру запрещено: ' + method + ' ' + path);
  }
  // шаблоны личные: менеджер создаёт свои, но чужой (шаблон администратора) менять не может
  const adminTpl = (await call('/api/templates', { method: 'POST', body: JSON.stringify({ name: 'Шаблон админа', body: 'x', channel: 'any' }) })).body;
  assert.equal((await asM('/api/templates/' + adminTpl.id, { method: 'PATCH', body: JSON.stringify({ body: 'взлом' }) })).status, 403, 'чужой шаблон менять нельзя');
  assert.equal((await asM('/api/templates/' + adminTpl.id, { method: 'DELETE' })).status, 403, 'чужой шаблон удалять нельзя');
  assert.ok(!(await asM('/api/templates')).body.some(t => t.id === adminTpl.id), 'менеджер не видит чужие шаблоны');
  assert.equal((await asV('/api/contacts')).status, 200, 'наблюдатель читает данные');
  assert.equal((await asV('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Нельзя' }) })).status, 403, 'наблюдатель не создаёт записи');
  const denied = await asM('/api/prices', { method: 'POST', body: JSON.stringify({ scope: 'ours', text: 'Позиция;100' }) });
  assert.equal(denied.status, 403, 'прайс-лист (каталог) меняет только администратор');
  assert.match(denied.body.error, /Прайс-лист меняет только администратор/, 'отказ объясняет, что делать вместо правки прайса');
  // загрузка прайса доступна по двум путям — текст отказа один и тот же
  const denied2 = await asM('/api/prices/ours', { method: 'POST', body: JSON.stringify({ csv: 'Наименование;Цена\nПозиция;100\n' }) });
  assert.equal(denied2.status, 403, '/api/prices/ours закрыт для менеджера');
  assert.equal(denied2.body.error, denied.body.error, 'оба пути загрузки прайса дают одинаковый текст отказа');
  // каталог = прайс-лист компании: позиции и цены в нём меняет администратор,
  // а менеджер добавляет недостающую позицию прямо в сделку
  const mgrProd = await asM('/api/products', { method: 'POST', body: JSON.stringify({ name: 'Позиция менеджера', price: 1000 }) });
  assert.equal(mgrProd.status, 403, 'менеджер не добавляет позиции в прайс-лист');
  assert.match(String(mgrProd.body.error), /добавить прямо в сделку/, 'отказ объясняет, что делать вместо этого');
  const anyProd = (await call('/api/products', { method: 'POST', body: JSON.stringify({ name: 'Позиция для проверки прав', price: 1000 }) })).body;
  assert.equal((await asM('/api/products/' + anyProd.id, { method: 'PATCH', body: JSON.stringify({ price: 1 }) })).status, 403, 'менеджер не меняет цену в прайс-листе');
  assert.equal((await asM('/api/products')).status, 200, 'менеджер видит прайс-лист');
  assert.equal((await asM(`/api/deals/${d.body.id}/products`, { method: 'POST', body: JSON.stringify({ name: 'Свободная позиция', price: 5000, qty: 1 }) })).status, 201, 'в сделку менеджер добавляет любую позицию');
  await call('/api/products/' + anyProd.id, { method: 'DELETE' });
  assert.equal((await asV('/api/deals/' + d.body.id, { method: 'PATCH', body: JSON.stringify({ amount: 1 }) })).status, 403, 'наблюдатель не меняет сделки');
  h = admin; // дальше снова работаем администратором
});

test('каталог и наш прайс-лист — один список', async () => {
  const p = (await call('/api/products', { method: 'POST', body: JSON.stringify({ name: 'Дом для прайса 8×8', sku: 'DOM-88', price: 2100000, unit: 'шт', note: '  срок 8 недель  ' }) })).body;
  assert.equal(p.note, 'срок 8 недель', 'примечание позиции сохранено без лишних пробелов');
  const ours = (await call('/api/prices?scope=ours')).body;
  assert.equal(ours.source, 'catalog', 'наш прайс-лист берётся из каталога');
  const row = ours.rows.find(r => r.product_id === p.id);
  assert.ok(row && row.price === 2100000 && row.item === 'Дом для прайса 8×8', 'позиция каталога видна в прайсе');
  // цену поменяли в каталоге — прайс и сравнение с конкурентами видят её сразу
  await call('/api/products/' + p.id, { method: 'PATCH', body: JSON.stringify({ price: 2250000 }) });
  assert.equal((await call('/api/prices?scope=ours')).body.rows.find(r => r.product_id === p.id).price, 2250000, 'вторая копия цены не разъезжается');
  // позиция в архиве: в прайсе не участвует, но не удалена
  await call('/api/products/' + p.id, { method: 'PATCH', body: JSON.stringify({ active: 0 }) });
  assert.ok(!(await call('/api/prices?scope=ours')).body.rows.some(r => r.product_id === p.id), 'архивная позиция не в прайсе');
  assert.ok((await call('/api/prices?scope=ours&all=1')).body.rows.some(r => r.product_id === p.id), 'архив виден, если смотреть все позиции');
  await call('/api/products/' + p.id, { method: 'DELETE' });
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

test('сделки и задачи: сервер проверяет этап, сумму и срок', async () => {
  const badStage = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Плохой этап', stage: 'no-such-stage' }) });
  assert.equal(badStage.status, 400, 'несуществующий этап отклоняется');
  const badAmount = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Плохая сумма', stage: 'new', amount: -10 }) });
  assert.equal(badAmount.status, 400, 'отрицательная сумма отклоняется');
  const good = (await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Правильная сделка', stage: 'new', amount: '1500' }) })).body;
  assert.equal(good.amount, 1500, 'сумма приводится к числу');
  assert.equal((await call('/api/deals/' + good.id, { method: 'PATCH', body: JSON.stringify({ stage: 'no-such-stage' }) })).status, 400, 'этап проверяется и при изменении');
  const task = (await call('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'Позвонить сегодня', due: 'сегодня' }) })).body;
  assert.match(task.due, /^\d{4}-\d{2}-\d{2} 14:00$/, 'слово «сегодня» превращается в дату и время');
  const moved = (await call('/api/tasks/' + task.id, { method: 'PATCH', body: JSON.stringify({ due: 'завтра 09:30' }) })).body;
  assert.match(moved.due, / 09:30$/, 'срок задачи нормализуется и при изменении');
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
  const linked = (await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Связанный для пачки' }) })).body;
  const linkedDeal = (await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка связанного', stage: 'new', contact_id: linked.id }) })).body;
  const linkedTask = (await call('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'Задача связанного', contact_id: linked.id }) })).body;
  assert.equal((await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'contacts', ids: [linked.id], action: 'delete' }) })).status, 200);
  assert.equal((await call('/api/tasks/' + linkedTask.id)).body.contact_id, null, 'задача осталась, но без ссылки на удалённый контакт');
  assert.equal((await call('/api/deals/' + linkedDeal.id)).body.deal.contact_id, null, 'сделка осталась, но без ссылки на удалённый контакт');
  const del = await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'contacts', ids, action: 'delete' }) });
  assert.equal(del.status, 200);
  assert.equal((await call('/api/contacts')).body.filter(c => ids.includes(c.id)).length, 0, 'записи удалены');
});

test('сделка, заведённая сразу закрытой, получает дату закрытия', async () => {
  const won = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Продажа задним числом', stage: 'won', amount: 5000 }) });
  assert.equal(won.status, 201);
  assert.match(won.body.closed_at || '', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'у выигранной сделки есть дата закрытия');
  const lost = (await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Отказ задним числом', stage: 'lost', amount: 100 }) })).body;
  assert.ok(lost.closed_at, 'у проигранной сделки тоже есть дата закрытия');
  const open = (await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Ещё в работе', stage: 'new' }) })).body;
  assert.equal(open.closed_at, null, 'открытая сделка дату закрытия не получает');
  // дата закрытия не переписывается при повторном сохранении уже закрытой сделки
  await new Promise(r => setTimeout(r, 1100));
  const saved = (await call('/api/deals/' + won.body.id, { method: 'PATCH', body: JSON.stringify({ amount: 5100 }) })).body;
  assert.equal(saved.closed_at, won.body.closed_at, 'дата закрытия не «уезжает» при правке суммы');
  // а возврат в работу её очищает — иначе выручка посчитается дважды
  const reopened = (await call('/api/deals/' + won.body.id, { method: 'PATCH', body: JSON.stringify({ stage: 'negotiation' }) })).body;
  assert.equal(reopened.closed_at, null, 'возврат в работу очищает дату закрытия');
});

test('массовые действия со сделками: этап, ответственный, закрытие и удаление', async () => {
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: `Пачка сделок ${i}`, stage: 'new', amount: 1000 * (i + 1) }) })).body.id);
  // повторяющиеся id — одна запись, иначе счётчик и уведомления врут
  const won = await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'deals', ids: [ids[0], ids[0], ids[1]], action: 'update', patch: { stage: 'won' } }) });
  assert.equal(won.status, 200, 'этап меняется пачкой');
  assert.equal(won.body.count, 2, 'повторяющиеся id считаются один раз');
  assert.equal((await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'deals', ids: [ids[0], 999999], action: 'update', patch: { amount: 4000 } }) })).body.count, 1, 'в ответе — сколько записей реально изменилось');
  const first = (await call('/api/deals/' + ids[0])).body.deal, second = (await call('/api/deals/' + ids[1])).body.deal, third = (await call('/api/deals/' + ids[2])).body.deal;
  assert.equal(first.stage, 'won'); assert.equal(second.stage, 'won');
  assert.match(first.closed_at || '', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'массовый перевод в «Успешно» ставит дату закрытия');
  assert.equal(third.stage, 'new'); assert.equal(third.closed_at, null, 'невыбранные сделки не тронуты');
  const back = await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'deals', ids: [ids[0], ids[1]], action: 'update', patch: { stage: 'negotiation' } }) });
  assert.equal(back.status, 200);
  assert.equal((await call('/api/deals/' + ids[0])).body.deal.closed_at, null, 'возврат в работу очищает дату закрытия');
  // ошибочные значения отбиваются до записи: пачка не должна измениться частично
  assert.equal((await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'deals', ids: [ids[2]], action: 'update', patch: { responsible_id: 999999 } }) })).status, 400, 'несуществующий ответственный отклоняется');
  assert.equal((await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'deals', ids: [ids[2]], action: 'update', patch: { amount: -5 } }) })).status, 400, 'отрицательная сумма отклоняется');
  assert.equal((await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'deals', ids: [ids[2]], action: 'update', patch: { priority: 'срочно' } }) })).status, 400, 'неизвестный приоритет отклоняется');
  assert.equal((await call('/api/deals/' + ids[2])).body.deal.stage, 'new', 'после ошибок сделка не изменилась');
  const admin = (await call('/api/users')).body.find(u => u.role === 'admin');
  const owner = await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'deals', ids, action: 'update', patch: { responsible_id: admin.id } }) });
  assert.equal(owner.status, 200);
  const owned = (await call('/api/deals/' + ids[2])).body.deal;
  assert.equal(owned.responsible_id, admin.id); assert.equal(owned.responsible, admin.name, 'имя ответственного не расходится с id');
  // смена воронки без выбора этапа не ломает пачку: этап берётся из новой воронки
  const pipe = (await call('/api/pipelines', { method: 'POST', body: JSON.stringify({ name: 'Воронка для пачки' }) })).body;
  const moved = await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'deals', ids: [ids[2]], action: 'update', patch: { pipeline_id: pipe.id } }) });
  assert.equal(moved.status, 200, 'перенос в другую воронку работает пачкой');
  assert.equal((await call('/api/deals/' + ids[2])).body.deal.pipeline_id, pipe.id);
  // удаление пачкой не оставляет висячих задач, позиций и заметок
  const doomed = (await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка под удаление', stage: 'new' }) })).body;
  const product = (await call('/api/products', { method: 'POST', body: JSON.stringify({ name: 'Товар под удаление', price: 700 }) })).body;
  await call(`/api/deals/${doomed.id}/products`, { method: 'POST', body: JSON.stringify({ product_id: product.id, qty: 2 }) });
  const task = (await call('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'Задача по удаляемой сделке', deal_id: doomed.id }) })).body;
  await call('/api/notes', { method: 'POST', body: JSON.stringify({ entity_type: 'deals', entity_id: doomed.id, body: 'Заметка по удаляемой сделке' }) });
  const del = await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'deals', ids: [doomed.id], action: 'delete' }) });
  assert.equal(del.status, 200, 'сделки удаляются пачкой');
  assert.equal((await call('/api/deals/' + doomed.id)).status, 404, 'сделка удалена');
  assert.equal((await call('/api/tasks/' + task.id)).body.deal_id, null, 'задача осталась, но без ссылки на удалённую сделку');
  assert.equal((await call('/api/deals/' + doomed.id + '/products')).body.length, 0, 'позиции удалённой сделки убраны');
  assert.equal((await call('/api/notes?type=deals&entity=' + doomed.id)).body.length, 0, 'заметки удалённой сделки убраны');
  await call('/api/tasks/' + task.id, { method: 'DELETE' });
  await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'deals', ids, action: 'delete' }) });
});

test('менеджер не меняет правила и шаблоны, но работает с клиентами', async () => {
  const created = (await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Менеджер Оля', email: `olya${Date.now()}@example.com`, password: 'manager12345', role: 'manager' }) })).body;
  const login = (await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: `olya${Date.now() - 1}@example.com`, password: 'manager12345' }) })).body;
  // повторный вход с тем же e-mail, что и создавали
  const users = (await call('/api/users')).body; const u = users.find(x => x.id === created.id);
  const l2 = (await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: u.email, password: 'manager12345' }) })).body;
  const mh = { Authorization: 'Bearer ' + l2.token };
  const mcall = (path, opt = {}) => fetch(base + path, { ...opt, headers: { 'Content-Type': 'application/json', ...mh, ...(opt.headers || {}) } }).then(async r => ({ status: r.status, body: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text() }));
  assert.equal((await mcall('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Клиент Оли' }) })).status, 201, 'менеджер ведёт клиентов');
  assert.equal((await mcall('/api/automations', { method: 'POST', body: JSON.stringify({ name: 'Правило', trigger_type: 'deal_created', action_type: 'create_task', action_value: 'x' }) })).status, 403, 'правила — только админ');
  const personal = await mcall('/api/templates', { method: 'POST', body: JSON.stringify({ name: 'Мой шаблон', body: 'Личный текст {name}', channel: 'whatsapp' }) });
  assert.equal(personal.status, 201, 'личный шаблон менеджер создаёт');
  assert.equal(personal.body.user_id, created.id, 'шаблон привязан к автору');
  const hisList = (await mcall('/api/templates')).body;
  assert.ok(hisList.some(t => t.name === 'Мой шаблон'), 'в списке есть личный шаблон');
  const adminView = (await call('/api/templates')).body;
  assert.ok(!adminView.some(t => t.name === 'Мой шаблон'), 'шаблоны строго личные: админ не видит чужие');
  const adminOwn = adminView.find(t => t.name === 'Шаблон админа') || adminView[0];
  assert.equal((await mcall('/api/templates/' + adminOwn.id, { method: 'PATCH', body: JSON.stringify({ body: 'чужой' }) })).status, 403, 'чужой шаблон не редактируется');
  assert.equal((await mcall('/api/templates/' + personal.body.id, { method: 'DELETE' })).status, 200, 'свой шаблон менеджер удаляет');
  assert.equal((await mcall('/api/settings', { method: 'PUT', body: JSON.stringify({ COMPANY_NAME: 'Взлом' }) })).status, 403, 'настройки — только админ');
  assert.equal((await mcall('/api/users', { method: 'POST', body: JSON.stringify({ name: 'x', email: 'x@x.ru', password: '12345678' }) })).status, 403, 'команда — только админ');
});

test('печать КП и счёта: реквизиты, позиции и суммы на месте', async () => {
  await call('/api/settings', { method: 'PUT', body: JSON.stringify({ COMPANY_NAME: 'ООО «Каркас»', COMPANY_INN: '7712345678', COMPANY_KPP: '771201001', COMPANY_ADDRESS: 'Москва, ул. Лесная, 1', COMPANY_BANK: 'АО «Тинькофф Банк», БИК 044525974', COMPANY_ACCOUNT: '40702810100000012345', COMPANY_SIGNER: 'Петров П. П.', COMPANY_SIGNER_POSITION: 'Директор', DOC_PREFIX: 'КП' }) });
  const settings = (await call('/api/settings')).body;
  assert.equal(settings.requisites.inn, '7712345678', 'реквизиты сохраняются');
  assert.equal(settings.requisites.signer, 'Петров П. П.');
  const client = (await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Заказчик Печати', phone: '+7 916 000-11-22', email: 'print@example.com' }) })).body;
  const deal = (await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Дом 8×10', amount: 0, contact_id: client.id, deadline: '2026-11-05' }) })).body;
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
  assert.match(html, /05\.11\.2026/, 'срок в документе — в формате дд.мм.гггг');
  assert.doesNotMatch(html, /2026-11-05/, 'сырой ISO-даты в документе нет');
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

test('управление командой: валидация, актуальные права и отключение', async () => {
  const post = body => call('/api/users', { method: 'POST', body: JSON.stringify(body) });
  const body = { name: 'Новый сотрудник', email: 'fresh@example.com', password: 'SafePassword123', role: 'manager' };
  assert.equal((await post({ ...body, role: 'root' })).status, 400);
  assert.equal((await post({ ...body, email: 'broken' })).status, 400);
  const created = await post(body); assert.equal(created.status, 201);
  assert.equal((await post(body)).status, 409);
  const id = created.body.id;
  const patch = body => call('/api/users/' + id, { method: 'PATCH', body: JSON.stringify(body) });
  assert.equal((await patch({ password: 'short' })).status, 400);
  assert.equal((await patch({ email: 'changed@example.com' })).status, 200);
  const login = await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'changed@example.com', password: body.password }) });
  const headers = { Authorization: 'Bearer ' + login.body.token };
  for (const path of ['/api/settings', '/api/backup', '/api/export/json', '/api/competitor-sources']) assert.equal((await call(path, { headers })).status, 403);
  await patch({ role: 'viewer' });
  assert.equal((await call('/api/me', { headers })).body.user.role, 'viewer');
  assert.equal((await call('/api/contacts', { method: 'POST', headers, body: '{"name":"Forbidden"}' })).status, 403);
  await patch({ active: 0 });
  assert.equal((await call('/api/me', { headers })).status, 401);
});

test('встроенный логотип JPEG доступен без авторизации', async () => {
  const r = await fetch(base + '/logo.png');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.equal(new Uint8Array(await r.arrayBuffer())[0], 255);
});

test('последний администратор защищён от отключения и понижения роли', async () => {
  const me = (await call('/api/me')).body.user;
  for (const body of [{ active: 0 }, { role: 'manager' }]) {
    assert.equal((await call('/api/users/' + me.id, { method: 'PATCH', body: JSON.stringify(body) })).status, 400);
  }
});

test('первый вход: серверная блокировка, смена пароля и отзыв старых токенов', async () => {
  const account = { name: 'Первый вход', email: 'first-login@example.com', password: 'TemporaryPass123', role: 'viewer' };
  const created = await call('/api/users', { method: 'POST', body: JSON.stringify(account) });
  assert.equal(created.status, 201);
  const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify(account) });
  assert.equal(login.body.user.must_change_password, 1);
  const headers = { Authorization: 'Bearer ' + login.body.token };
  assert.equal((await call('/api/me', { headers })).body.user.must_change_password, 1);
  for (const path of ['/api/contacts', '/api/meta', '/api/events', '/api/templates']) {
    const denied = await call(path, { headers });
    assert.equal(denied.status, 403); assert.equal(denied.body.code, 'PASSWORD_CHANGE_REQUIRED');
  }
  const change = (old_password, new_password) => call('/api/me/password', { method: 'POST', headers, body: JSON.stringify({ old_password, new_password }) });
  assert.equal((await change('wrong', 'NewPersonalPass123')).status, 400);
  assert.equal((await change(account.password, 'short')).status, 400);
  assert.equal((await change(account.password, account.password)).status, 400);
  const changed = await change(account.password, 'NewPersonalPass123');
  assert.equal(changed.status, 200);
  assert.equal((await call('/api/me', { headers })).status, 401, 'старый токен отозван');
  const freshHeaders = { Authorization: 'Bearer ' + changed.body.token };
  assert.equal((await call('/api/me', { headers: freshHeaders })).body.user.must_change_password, 0);
  assert.equal((await call('/api/contacts', { headers: freshHeaders })).status, 200);
  assert.equal((await call('/api/contacts', { method: 'POST', headers: freshHeaders, body: '{"name":"blocked"}' })).status, 403);
  const reset = await call('/api/users/' + created.body.id, { method: 'PATCH', body: JSON.stringify({ password: 'AnotherTempPass123' }) });
  assert.equal(reset.status, 200);
  assert.equal((await call('/api/me', { headers: freshHeaders })).status, 401, 'админский сброс отзывает сессии');
  const second = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: account.email, password: 'AnotherTempPass123' }) });
  assert.equal(second.body.user.must_change_password, 1);
});

test('демо-данные: счётчики и очистка только администратору', async () => {
  const s = (await call('/api/settings')).body;
  assert.equal(s.seed_mode, 'off', 'тестовая база запущена без seed');
  assert.ok(s.demo && typeof s.demo.contacts === 'number', 'settings отдаёт счётчики демо-данных');
  const r = await call('/api/demo/cleanup', { method: 'POST' });
  assert.equal(r.status, 200, 'администратор очищает демо-данные');
  assert.equal(typeof r.body.removed, 'number');
});

test('контакт находится по телефону в любом формате', async () => {
  const c = (await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Телефонный', phone: '+7 (916) 123-45-67' }) })).body;
  await call('/webhooks/generic', { method: 'POST', body: JSON.stringify({ channel: 'whatsapp', phone: '8-916-123-45-67', name: 'Телефонный', body: 'Написал с другим форматом номера' }) });
  const conv = (await call('/api/conversations')).body.find(x => x.contact_id === c.id);
  assert.ok(conv, 'входящий нашёл существующий контакт по нормализованному телефону');
  assert.equal(conv.channels, 'whatsapp');
});

test('передача ответственного: коллега получает персональное уведомление', async () => {
  // Коллега с собственным паролем (временный пароль обязательно меняется при первом входе).
  const email = 'assignee-' + Date.now() + '@example.com';
  const temp = 'TemporaryPass-2026!x', own = 'OwnPersonalPass-2026!x';
  const created = (await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Коллега', email, role: 'manager', active: 1, password: temp }) })).body;
  assert.ok(created.id, 'сотрудник создан');
  const first = (await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: temp }) })).body;
  const changed = (await call('/api/me/password', { method: 'POST', headers: { Authorization: 'Bearer ' + first.token }, body: JSON.stringify({ old_password: temp, new_password: own }) })).body;
  const colleague = { Authorization: 'Bearer ' + changed.token };

  // Подключаемся к живым событиям так же, как это делает браузер коллеги.
  const ctrl = new AbortController();
  const stream = await fetch(base + '/api/events', { headers: colleague, signal: ctrl.signal });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader(), decoder = new TextDecoder();
  const events = []; let buf = '';
  const pump = (async () => {
    try {
      for (;;) { const { value, done } = await reader.read(); if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /event: ([^\n]+)/.exec(chunk), data = /data: (.*)/.exec(chunk);
          if (ev) events.push({ ev: ev[1], data: data ? JSON.parse(data[1]) : null });
        } }
    } catch {}
  })();
  const waitEvent = async (type) => {
    for (let i = 0; i < 100; i++) {
      const found = events.find(e => e.ev === 'notify' && e.data?.type === type);
      if (found) return found.data;
      await new Promise(r => setTimeout(r, 30));
    }
    return null;
  };
  try {
    await waitEvent('ready'); // подписка зарегистрирована на сервере
    assert.ok(events.some(e => e.ev === 'ready'), 'поток событий открыт');

    const c = (await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Клиент для передачи' }) })).body;
    const dc = await call('/api/contacts/' + c.id, { method: 'PATCH', body: JSON.stringify({ responsible_id: created.id }) });
    assert.equal(dc.status, 200);
    const contactNote = await waitEvent('contact_assigned');
    assert.ok(contactNote, 'контакт передан — коллега получил contact_assigned');
    assert.equal(contactNote.id, c.id);

    const deal = (await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка для передачи', contact_id: c.id }) })).body;
    assert.equal((await call('/api/deals/' + deal.id, { method: 'PATCH', body: JSON.stringify({ responsible_id: created.id }) })).status, 200);
    const dealNote = await waitEvent('deal_assigned');
    assert.ok(dealNote, 'сделка передана — коллега получил deal_assigned');
    assert.equal(dealNote.id, deal.id);

    // Повторная передача тому же человеку уведомление не дублирует.
    const before = events.filter(e => e.ev === 'notify' && e.data?.type === 'deal_assigned').length;
    await call('/api/deals/' + deal.id, { method: 'PATCH', body: JSON.stringify({ responsible_id: created.id }) });
    await new Promise(r => setTimeout(r, 250));
    assert.equal(events.filter(e => e.ev === 'notify' && e.data?.type === 'deal_assigned').length, before, 'без фактической смены уведомления нет');

    // Задача, поставленная коллеге сразу при создании, тоже даёт уведомление.
    const task = (await call('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'Задача для передачи', due: '2026-12-31', responsible_id: created.id }) })).body;
    assert.ok(task.id);
    const taskNote = await waitEvent('task_assigned');
    assert.ok(taskNote, 'задача назначена — коллега получил task_assigned');
    assert.equal(taskNote.id, task.id);
  } finally { ctrl.abort(); await pump.catch(() => {}); }
});

test('автоматизации: правило проверяется при сохранении и работает по событию', async () => {
  // валидация до записи: опечатка в правиле не должна ломать работу с клиентами
  const badStage = await call('/api/automations', { method: 'POST', body: JSON.stringify({ name: 'Плохой этап', trigger_type: 'deal_created', action_type: 'change_stage', action_value: 'этапа-не-существует' }) });
  assert.equal(badStage.status, 400);
  assert.match(badStage.body.error, /Такого этапа нет/);
  const badTrigger = await call('/api/automations', { method: 'POST', body: JSON.stringify({ name: 'Плохое событие', trigger_type: 'когда-нибудь', action_type: 'create_task', action_value: 'Позвонить' }) });
  assert.equal(badTrigger.status, 400);
  assert.match(badTrigger.body.error, /Выберите событие/);
  const noTag = await call('/api/automations', { method: 'POST', body: JSON.stringify({ name: 'Без тега', trigger_type: 'message_in', action_type: 'add_tag' }) });
  assert.equal(noTag.status, 400);
  assert.match(noTag.body.error, /Укажите тег/);
  const noTask = await call('/api/automations', { method: 'POST', body: JSON.stringify({ name: 'Без текста', trigger_type: 'deal_created', action_type: 'create_task', action_value: '  ' }) });
  assert.equal(noTask.status, 400);
  assert.match(noTask.body.error, /Напишите текст задачи/);
  const noName = await call('/api/automations', { method: 'POST', body: JSON.stringify({ trigger_type: 'deal_created', action_type: 'create_task', action_value: 'Позвонить' }) });
  assert.equal(noName.status, 400);
  assert.match(noName.body.error, /Укажите название/);

  const stages = (await call('/api/pipelines')).body[0].stages;
  const won = stages.find(s2 => s2.kind === 'won');
  const lost = stages.find(s2 => s2.kind === 'lost');
  const rules = [];
  rules.push((await call('/api/automations', { method: 'POST', body: JSON.stringify({ name: 'Лид — позвонить', trigger_type: 'deal_created', action_type: 'create_task', action_value: 'Позвонить по автоматизации' }) })).body.id);
  rules.push((await call('/api/automations', { method: 'POST', body: JSON.stringify({ name: 'Смета — тег', trigger_type: 'message_in', trigger_value: 'смета', action_type: 'add_tag', action_value: 'Запросил смету' }) })).body.id);
  rules.push((await call('/api/automations', { method: 'POST', body: JSON.stringify({ name: 'Дожим — успех', trigger_type: 'stage_changed', action_type: 'change_stage', action_value: won.code }) })).body.id);

  try {
    // 1) новая сделка → задача ответственному
    const contact = (await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Авто Клиент', phone: '+7 999 444-33-22' }) })).body;
    const deal = (await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Авто-сделка', amount: 100000, stage: stages[0].code, contact_id: contact.id }) })).body;
    const tasks = await call('/api/tasks');
    assert.ok(tasks.body.some(t => t.title === 'Позвонить по автоматизации' && t.deal_id === deal.id), 'правило создало задачу по новой сделке');

    // 2) смена этапа → правило переводит сделку дальше и закрывает её корректно
    await call('/api/deals/' + deal.id, { method: 'PATCH', body: JSON.stringify({ stage: lost.code }) });
    const moved = (await call('/api/deals/' + deal.id)).body.deal;
    assert.equal(moved.stage, won.code, 'сделка переведена правилом на этап успеха');
    assert.ok(moved.closed_at, 'дата закрытия проставлена — выручка попадёт в нужный месяц');

    // 3) ключевое слово в сообщении → тег клиенту
    await call('/webhooks/generic', { method: 'POST', body: JSON.stringify({ channel: 'site', name: 'Авто Клиент', phone: '+7 999 444-33-22', body: 'Пришлите, пожалуйста, смету на дом' }) });
    const tagged = (await call('/api/contacts/' + contact.id)).body;
    assert.match(tagged.tags || '', /Запросил смету/);

    // 4) без ключевого слова тег не ставится, повторно — не дублируется
    await call('/webhooks/generic', { method: 'POST', body: JSON.stringify({ channel: 'site', name: 'Авто Клиент', phone: '+7 999 444-33-22', body: 'Просто вопрос про дом' }) });
    await call('/webhooks/generic', { method: 'POST', body: JSON.stringify({ channel: 'site', name: 'Авто Клиент', phone: '+7 999 444-33-22', body: 'И ещё раз смета' }) });
    const again = (await call('/api/contacts/' + contact.id)).body;
    assert.equal((again.tags.match(/Запросил смету/g) || []).length, 1, 'тег не дублируется и не ставится без повода');

    // 5) выключенное правило не срабатывает
    await call('/api/automations/' + rules[0], { method: 'PATCH', body: JSON.stringify({ active: 0 }) });
    const deal2 = (await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Авто-сделка 2', amount: 50000, stage: stages[0].code }) })).body;
    const tasks2 = await call('/api/tasks');
    assert.ok(!tasks2.body.some(t => t.title === 'Позвонить по автоматизации' && t.deal_id === deal2.id), 'выключенное правило молчит');

    // 6) частичное обновление правила тоже проверяется
    const broken = await call('/api/automations/' + rules[2], { method: 'PATCH', body: JSON.stringify({ action_value: 'этап-удалён' }) });
    assert.equal(broken.status, 400, 'нельзя сохранить правило с несуществующим этапом');
    assert.match(broken.body.error, /Такого этапа нет/);
  } finally {
    // правила убираем: они не должны влиять на остальные сценарии
    for (const id of rules) if (id) await call('/api/automations/' + id, { method: 'DELETE' });
    const left = await call('/api/automations');
    assert.ok(!left.body.some(a => /Авто|Лид — позвонить|Дожим/.test(a.name)), 'тестовые правила удалены');
  }
});

test('заметку можно изменить, а не только удалить', async () => {
  const c = (await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Заметочный клиент', phone: '+7 999 111-22-33' }) })).body;
  const n = (await call('/api/notes', { method: 'POST', body: JSON.stringify({ entity_type: 'contacts', entity_id: c.id, body: 'Первая версия заметки' }) })).body;
  const upd = await call('/api/notes/' + n.id, { method: 'PATCH', body: JSON.stringify({ body: 'Исправленная версия заметки' }) });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.body, 'Исправленная версия заметки');
  const list = await call('/api/notes?type=contacts&entity=' + c.id);
  assert.equal(list.body.length, 1, 'новая заметка не добавилась — старая изменена');
  assert.equal(list.body[0].body, 'Исправленная версия заметки');
  assert.ok(list.body[0].author, 'автор заметки сохранён');
});

test('последний вход виден администратору и скрыт от остальных', async () => {
  const created = (await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Вход Контроль', email: 'login-check@example.com', password: 'temporary-pass-1', role: 'manager' }) })).body;
  assert.ok(created.id);
  const login = await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'login-check@example.com', password: 'temporary-pass-1' }) });
  assert.ok(login.body.token);
  const asAdmin = await call('/api/users');
  const me = asAdmin.body.find(u => u.id === created.id);
  assert.ok(me.last_login, 'администратор видит, когда сотрудник заходил');
  assert.ok(me.email, 'администратор видит e-mail сотрудника');
  const adminRow = asAdmin.body.find(u => u.email === 'admin@example.com');
  assert.ok(adminRow.last_login, 'время входа администратора тоже отмечено');
  const asManager = await call('/api/users', { headers: { Authorization: 'Bearer ' + login.body.token } });
  const seen = asManager.body.find(u => u.id === created.id);
  assert.equal(seen.last_login, undefined, 'менеджер не видит чужие входы');
  assert.equal(seen.email, undefined, 'менеджер не видит чужие e-mail');
  assert.equal(seen.name, 'Вход Контроль', 'имя и роль доступны для выбора ответственного');
});

test('защита входа: ограничение попыток подбора пароля', async () => {
  const codes = [];
  for (let i = 0; i < 16; i++) codes.push((await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@example.com', password: 'wrong-' + i }) })).status);
  assert.ok(codes.includes(429), 'после серии неудачных попыток вход блокируется (429)');
  const ok = await call('/api/health');
  assert.equal(ok.status, 200, 'сервис продолжает работать');
});
