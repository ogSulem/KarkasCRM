// Контракт Wazzup проверяется по официальной документации вендора, а не по догадке
// о форме ответа. Расхождение здесь выглядит для заказчика безобидно на экране и
// дорого в работе: «синхронизировано: 0», отказ при регистрации вебхука или
// сообщение, которое не ушло клиенту.
// Документация: wazzup24.ru/help/api-ru/
//   rabota-s-kanalami    — GET /channels отдаёт голый массив без поля name
//   otpravka-soobshhenij — POST /message; text и contentUri одновременно нельзя
//   webhooks-2           — PATCH /webhooks с подписками и проверочный POST на адрес
// Запуск:
//   npm run test:wazzup
//   node --experimental-sqlite --test tests/wazzup-contract.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';

process.env.DATA_DIR = '/tmp/karkas-wazzup-' + Date.now();
process.env.PORT = '18098';
process.env.SEED_MODE = 'off';

const KEY = 'wazzup-contract-key';
const SECRET = 'contract-secret';
const WZ_PORT = 18157;
const CRM_HOOK = `http://127.0.0.1:18098/webhooks/wazzup?secret=${SECRET}`;
const GROUP_CHAT = '-1001234567890';
const TG_CHANNEL = 'bbbbbbbb-2222-4222-8222-222222222222';

// что увидел мок Wazzup
const seen = { channels: 0, messages: [], webhook: null, longUrlRejected: 0 };

// Мок ведёт себя как вендор: каналы — голый массив, при регистрации вебхука
// приходит проверочный POST {test:true} и требуется ответ 200.
const wz = createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c;
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.headers.authorization !== 'Bearer ' + KEY) return send(401, { error: 'unauthorized', description: 'Invalid token' });
  if (req.url === '/channels' && req.method === 'GET') {
    seen.channels++;
    // первым стоит нерабочий канал: каналом по умолчанию должен стать не он
    return send(200, [
      { channelId: 'cccccccc-3333-4333-8333-333333333333', transport: 'maxbot', plainId: '79994445566', state: 'notEnoughMoney' },
      { channelId: 'aaaaaaaa-1111-4111-8111-111111111111', transport: 'whatsapp', plainId: '79991112233', state: 'active' },
      { channelId: TG_CHANNEL, transport: 'tgapi', plainId: 'karkas_dom', state: 'active' },
    ]);
  }
  if (req.url === '/message' && req.method === 'POST') { seen.messages.push(JSON.parse(b)); return send(200, { messageId: 'wz-' + seen.messages.length }); }
  if (req.url === '/webhooks' && req.method === 'PATCH') {
    seen.webhook = JSON.parse(b);
    if (String(seen.webhook.webhooksUri || '').length > 200) { seen.longUrlRejected++; return send(400, { error: 'uriNotValid' }); }
    const probe = await fetch(seen.webhook.webhooksUri, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: true }) });
    if (probe.status !== 200) return send(400, { error: 'testPostNotPassed', description: 'URI does not return 200 OK on test request' });
    return send(200, { saved: true });
  }
  send(404, {});
});

const { server, db } = await import('../backend/src/server.js');
const base = 'http://127.0.0.1:18098';
let admin;

const call = async (path, { method = 'GET', body, token } = {}) => {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data };
};
const hook = payload => fetch(`${base}/webhooks/wazzup?secret=${SECRET}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
});

before(async () => {
  await new Promise(r => wz.listen(WZ_PORT, r));
  await new Promise(r => server.listening ? r() : server.once('listening', r));
  admin = (await call('/api/auth/login', { method: 'POST', body: { email: 'admin@example.com', password: 'admin12345' } })).data.token;
  assert.ok(admin, 'вход администратора');
  const saved = await call('/api/settings', { method: 'PUT', token: admin, body: { WAZZUP_API_KEY: KEY, WAZZUP_API_URL: `http://127.0.0.1:${WZ_PORT}`, WAZZUP_WEBHOOK_SECRET: SECRET, PUBLIC_URL: base } });
  assert.equal(saved.status, 200, 'настройки Wazzup сохранены');
});

after(async () => {
  await new Promise(r => server.close(r));
  wz.close();
  try { db.close() } catch {}
});

test('каналы читаются из голого массива — именно так отвечает GET /channels', async () => {
  const sync = await call('/api/integrations/wazzup/sync', { method: 'POST', token: admin });
  assert.equal(sync.status, 200, sync.data?.error || '');
  assert.equal(sync.data.synced, 3, 'все три канала вендора найдены и сохранены');
  assert.equal(seen.channels, 1, 'к вендору сходили один раз');
  const chans = (await call('/api/channels', { token: admin })).data;
  assert.equal(chans.length, 3);
  const wa = chans.find(c => c.transport === 'whatsapp');
  assert.equal(wa.state, 'active', 'состояние канала сохранено как прислал вендор');
  assert.equal(wa.phone, '79991112233', 'plainId сохранён');
  assert.equal(wa.name, '79991112233', 'поля name в API Wazzup нет — название берётся из plainId');
  assert.equal(chans.find(c => c.transport === 'maxbot').state, 'notEnoughMoney', 'нерабочее состояние не теряется');
  const settings = (await call('/api/settings', { token: admin })).data;
  assert.equal(settings.wazzup.channel_id, 'aaaaaaaa-1111-4111-8111-111111111111',
    'каналом по умолчанию стал рабочий, а не первый в списке');
});

test('регистрация вебхука передаёт подписки и проходит проверочный запрос вендора', async () => {
  const reg = await call('/api/integrations/wazzup/webhook', { method: 'POST', token: admin, body: { url: CRM_HOOK } });
  assert.equal(reg.status, 200, 'вендор принял адрес: проверочный POST получил 200 — ' + JSON.stringify(reg.data));
  assert.equal(reg.data.saved, true);
  assert.equal(seen.webhook.webhooksUri, CRM_HOOK, 'адрес передан вместе с кодом защиты');
  // без подписок Wazzup не присылает события вовсе
  assert.equal(seen.webhook.subscriptions.messagesAndStatuses, true, 'подписка на сообщения и статусы');
  assert.equal(seen.webhook.subscriptions.channelsUpdates, true, 'подписка на изменения каналов');
});

test('адрес длиннее 200 символов не отправляется вендору', async () => {
  const long = await call('/api/integrations/wazzup/webhook', { method: 'POST', token: admin, body: { url: CRM_HOOK + '&pad=' + 'a'.repeat(220) } });
  assert.equal(long.status, 400, 'лимит вендора — 200 символов');
  assert.match(String(long.data.error), /200/);
  assert.equal(seen.longUrlRejected, 0, 'заведомо отказной запрос к вендору не уходил');
});

test('входящее из группового чата сохраняет telegroup и не подменяет его', async () => {
  const r = await hook({
    messages: [{
      messageId: 'wz-in-group-1', channelId: TG_CHANNEL, chatType: 'telegroup', chatId: GROUP_CHAT,
      dateTime: '2026-10-23T12:00:00.000', type: 'text', isEcho: false, status: 'inbound',
      text: 'Нужен дом 8 на 10', contact: { name: 'Стройбригада' },
    }],
  });
  assert.equal(r.status, 200, 'вебхук принят');
  const convs = (await call('/api/conversations', { token: admin })).data;
  const grp = convs.find(c => String(c.external_chat_id || '') === GROUP_CHAT);
  assert.ok(grp, 'групповой чат появился в «Чатах»');
  assert.equal(grp.chat_type, 'telegroup', 'тип чата сохранён как прислал вендор');
  assert.ok(!grp.phone, 'id группы не записан в телефон клиента: иначе карточка склеилась бы с чужой');
});

test('ответ в групповой чат уходит с chatType telegroup и адресатом из вебхука', async () => {
  const convs = (await call('/api/conversations', { token: admin })).data;
  const grp = convs.find(c => String(c.external_chat_id || '') === GROUP_CHAT);
  const sent = await call(`/api/conversations/${grp.id}/messages`, { method: 'POST', token: admin, body: { body: 'Здравствуйте! Готовим расчёт.', chat_type: 'telegroup' } });
  assert.equal(sent.status, 201);
  assert.equal(sent.data.send.delivered, true, JSON.stringify(sent.data.send));
  assert.equal(sent.data.message.status, 'sent');
  const m = seen.messages[seen.messages.length - 1];
  assert.equal(m.chatType, 'telegroup', 'в групповой чат можно ответить');
  assert.equal(m.chatId, GROUP_CHAT, 'адресат — id чата из вебхука, не телефон');
  assert.equal(m.channelId, TG_CHANNEL, 'канал той беседы, в которую пишем');
  assert.ok(/^\d+$/.test(String(m.crmUserId || '')), 'менеджер передан, пустой строки нет');
  assert.ok(/^karkas-/.test(m.crmMessageId), 'crmMessageId для защиты от повторной доставки');
  assert.ok(!('contentUri' in m), 'в текстовом сообщении нет contentUri');
});

test('вложение и подпись уходят двумя запросами: text и contentUri несовместимы', async () => {
  const convs = (await call('/api/conversations', { token: admin })).data;
  const grp = convs.find(c => String(c.external_chat_id || '') === GROUP_CHAT);
  const r = await call(`/api/conversations/${grp.id}/messages`, { method: 'POST', token: admin, body: { contentUri: 'https://example.com/smeta.pdf', body: 'Смета во вложении', chat_type: 'telegroup' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.send.delivered, true, JSON.stringify(r.data.send));
  const [file, caption] = seen.messages.slice(-2);
  assert.equal(file.contentUri, 'https://example.com/smeta.pdf', 'файл ушёл ссылкой');
  assert.ok(!file.text, 'в запросе с файлом нет текста — вендор такое не принимает');
  assert.equal(caption.text, 'Смета во вложении', 'подпись ушла отдельным сообщением');
  assert.ok(!caption.contentUri, 'в сообщении с подписью нет файла');
  assert.notEqual(file.crmMessageId, caption.crmMessageId, 'у каждого запроса свой crmMessageId');
  assert.ok(seen.messages.every(m => !(m.text && m.contentUri)), 'ни один запрос не содержит text и contentUri одновременно');
});

test('транспорт канала не выдаётся за тип чата', async () => {
  const convs = (await call('/api/conversations', { token: admin })).data;
  const grp = convs.find(c => String(c.external_chat_id || '') === GROUP_CHAT);
  // transport и chatType у Wazzup — разные списки: wapi, tgapi, maxbot и cian
  // типами чата не являются, а telegroup и maxgroup отсутствуют в транспортах
  for (const t of ['wapi', 'tgapi', 'maxbot', 'cian']) {
    const r = await call(`/api/conversations/${grp.id}/messages`, { method: 'POST', token: admin, body: { body: 'Ответ', chat_type: t } });
    assert.equal(r.data.message.status, 'error', `транспорт ${t} не подменяется типом чата`);
    assert.match(String(r.data.send.mode), /chatType/, 'ошибка называет список допустимых типов чата');
    assert.match(String(r.data.send.mode), /telegroup/, 'в списке есть групповые чаты');
  }
  for (const t of ['whatsgroup', 'maxgroup']) {
    const r = await call(`/api/conversations/${grp.id}/messages`, { method: 'POST', token: admin, body: { body: 'Ответ', chat_type: t } });
    assert.equal(r.data.send.delivered, true, `тип чата ${t} принимается`);
    assert.equal(seen.messages[seen.messages.length - 1].chatType, t);
  }
});

test('статусы доставки из вебхука обновляют отправленные сообщения', async () => {
  // статусы вендор присылает по своему messageId — тому, который вернул POST /message
  const wzId = 'wz-' + seen.messages.length;
  const r = await hook({ statuses: [{ messageId: wzId, status: 'delivered' }] });
  assert.equal(r.status, 200);
  const m = db.prepare('SELECT status FROM messages WHERE external_id=?').get(wzId);
  assert.ok(m, 'сообщение найдено по внешнему идентификатору');
  assert.equal(m.status, 'delivered', 'статус обновился');
});

test('события без текста не теряются: пропущенный звонок, визитка, геометка', async () => {
  const convs = (await call('/api/conversations', { token: admin })).data;
  const grp = convs.find(c => String(c.external_chat_id || '') === GROUP_CHAT);
  const cases = [['missing_call', '[пропущенный звонок]'], ['vcard', '[визитка контакта]'], ['geo', '[геометка]']];
  for (const [type, expected] of cases) {
    const r = await hook({ messages: [{ messageId: 'wz-' + type, channelId: TG_CHANNEL, chatType: 'telegroup', chatId: GROUP_CHAT, type, isEcho: false, status: 'inbound', dateTime: '2026-10-23T12:10:00.000' }] });
    assert.equal(r.status, 200, `вебхук с ${type} принят`);
    const m = db.prepare('SELECT body FROM messages WHERE external_id=?').get('wz-' + type);
    assert.ok(m, `событие ${type} сохранено в истории`);
    assert.equal(m.body, expected, `событие ${type} подписано по-русски`);
  }
  assert.ok(grp, 'диалог на месте');
});

test('входящее из канала без типа чата сохраняет свой канал и не становится «сайтом»', async () => {
  // у Циана вендор не публикует тип чата: отправить туда нельзя, но обращение
  // должно остаться в своём канале, а не превратиться в обезличенное «сайт»
  const r = await hook({ messages: [{ messageId: 'wz-cian-1', channelId: 'dddddddd-4444-4444-8444-444444444444', chatType: 'cian', chatId: 'cian-99887', type: 'text', isEcho: false, status: 'inbound', text: 'Квартира в новостройке, нужен подрядчик', dateTime: '2026-10-23T12:20:00.000', contact: { name: 'Клиент с Циана' } }] });
  assert.equal(r.status, 200);
  const m = db.prepare('SELECT channel FROM messages WHERE external_id=?').get('wz-cian-1');
  assert.ok(m, 'обращение сохранено');
  assert.equal(m.channel, 'cian', 'канал назван своим именем');
  const conv = db.prepare('SELECT * FROM conversations WHERE external_chat_id=?').get('cian-99887');
  assert.equal(conv.chat_type, 'cian', 'тип беседы сохранён как прислал вендор');
  assert.ok(!conv.phone, 'идентификатор Циана не записан в телефон клиента');
  const reply = await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', token: admin, body: { body: 'Ответ', chat_type: 'cian' } });
  assert.equal(reply.data.message.status, 'error', 'отправить туда нельзя — и это не выглядит как доставка');
});

test('проверочный запрос вендора проходит, а чужой запрос без кода защиты отклоняется', async () => {
  const probe = await fetch(`${base}/webhooks/wazzup?secret=${SECRET}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: true }) });
  assert.equal(probe.status, 200, 'тело {test:true} получает 200 — иначе вендор откажет в регистрации');
  const stranger = await fetch(base + '/webhooks/wazzup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ messageId: 'fake-1', chatType: 'whatsapp', chatId: '79000000000', text: 'чужое сообщение', isEcho: false }] }) });
  assert.equal(stranger.status, 403, 'без кода защиты сообщения не принимаются');
  const fake = db.prepare('SELECT COUNT(*) n FROM messages WHERE external_id=?').get('fake-1');
  assert.equal(fake.n, 0, 'поддельное сообщение не попало в базу');
});
