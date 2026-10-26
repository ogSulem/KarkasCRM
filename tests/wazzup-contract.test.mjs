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
const WA_CHANNEL = 'aaaaaaaa-1111-4111-8111-111111111111';
// второй аккаунт того же мессенджера: по нему видно, что канал выбирается
// не «первый подходящий», а аккаунт того сотрудника, который отвечает
const WA2_CHANNEL = 'eeeeeeee-5555-4555-8555-555555555555';
const MAXBOT_CHANNEL = 'cccccccc-3333-4333-8333-333333333333';
const WA_PHONE = '79992223344';

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
      { channelId: MAXBOT_CHANNEL, transport: 'maxbot', plainId: '79994445566', state: 'notEnoughMoney' },
      { channelId: WA_CHANNEL, transport: 'whatsapp', plainId: '79991112233', state: 'active' },
      { channelId: WA2_CHANNEL, transport: 'whatsapp', plainId: '79995556677', state: 'active' },
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

const { server, db, queueTick } = await import('../backend/src/server.js');
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
  assert.equal(sync.data.synced, 4, 'все четыре канала вендора найдены и сохранены');
  assert.equal(seen.channels, 1, 'к вендору сходили один раз');
  const chans = (await call('/api/channels', { token: admin })).data;
  assert.equal(chans.length, 4);
  // список приходит от новых к старым, поэтому канал ищем по его идентификатору
  const wa = chans.find(c => c.external_id === WA_CHANNEL);
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

test('аккаунт отправки соответствует выбранному мессенджеру', async () => {
  // Клиент написал на WhatsApp одного сотрудника. Каналов у заказчика несколько,
  // поэтому пара «тип чата + канал» обязана быть согласованной: тип чата telegram
  // с каналом от WhatsApp вендор отклоняет.
  const r = await hook({ messages: [{ messageId: 'wz-wa-1', channelId: WA_CHANNEL, chatType: 'whatsapp', chatId: WA_PHONE, dateTime: '2026-10-23T12:30:00.000', type: 'text', isEcho: false, status: 'inbound', text: 'Сколько стоит дом 6 на 8?', contact: { name: 'Клиент WhatsApp' } }] });
  assert.equal(r.status, 200);
  const conv = db.prepare('SELECT * FROM conversations WHERE external_chat_id=?').get(WA_PHONE);
  assert.ok(conv, 'беседа создана');
  assert.equal(conv.channel_id, WA_CHANNEL, 'беседа запомнила аккаунт, на который писал клиент');

  const same = await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', token: admin, body: { body: 'Добрый день!', chat_type: 'whatsapp' } });
  assert.equal(same.data.send.delivered, true, JSON.stringify(same.data.send));
  assert.equal(seen.messages[seen.messages.length - 1].channelId, WA_CHANNEL, 'ответ в WhatsApp уходит с того же аккаунта');

  const other = await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', token: admin, body: { body: 'И то же в Telegram', chat_type: 'telegram' } });
  assert.equal(other.data.send.delivered, true, JSON.stringify(other.data.send));
  assert.equal(seen.messages[seen.messages.length - 1].channelId, TG_CHANNEL, 'для Telegram взят аккаунт Telegram, а не канал от WhatsApp');
});

test('нерабочий аккаунт не подставляется под тип чата', async () => {
  // единственный MAX-аккаунт в кабинете не работает: брать его нельзя, иначе
  // сообщение выглядело бы отправленным и не дошло
  const conv = db.prepare('SELECT * FROM conversations WHERE external_chat_id=?').get(WA_PHONE);
  const r = await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', token: admin, body: { body: 'Ответ', chat_type: 'max' } });
  assert.equal(r.status, 201);
  assert.notEqual(seen.messages[seen.messages.length - 1].channelId, MAXBOT_CHANNEL, 'канал с пустым балансом не выбран');
});

test('своё название канала сохраняется и переживает синхронизацию', async () => {
  const chans = (await call('/api/channels', { token: admin })).data;
  const wa = chans.find(c => c.external_id === WA_CHANNEL);
  const saved = await call(`/api/channels/${wa.id}`, { method: 'PUT', token: admin, body: { label: 'WhatsApp — Ирина' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.label, 'WhatsApp — Ирина');
  // вендор имени не отдаёт, поэтому синхронизация не должна затирать подпись
  const again = await call('/api/integrations/wazzup/sync', { method: 'POST', token: admin });
  assert.equal(again.status, 200);
  const after = (await call('/api/channels', { token: admin })).data.find(c => c.external_id === WA_CHANNEL);
  assert.equal(after.label, 'WhatsApp — Ирина', 'название осталось после повторной синхронизации');
  assert.equal(after.state, 'active', 'состояние при этом обновляется');

  // название сотрудника — не администратора: менять каналы ему нельзя
  const created = await call('/api/users', { method: 'POST', token: admin, body: { name: 'Канал Менеджер', email: 'chan-mgr@example.com', role: 'manager', active: 1, password: 'TemporaryPass-2026!' } });
  assert.ok(created.data.id, 'сотрудник создан');
  let mgr = (await call('/api/auth/login', { method: 'POST', body: { email: 'chan-mgr@example.com', password: 'TemporaryPass-2026!' } })).data.token;
  await call('/api/me/password', { method: 'POST', token: mgr, body: { old_password: 'TemporaryPass-2026!', new_password: 'PersonalPass-2026!', confirm_password: 'PersonalPass-2026!' } });
  mgr = (await call('/api/auth/login', { method: 'POST', body: { email: 'chan-mgr@example.com', password: 'PersonalPass-2026!' } })).data.token;
  assert.ok(mgr, 'сотрудник вошёл после смены пароля');
  const denied = await call(`/api/channels/${wa.id}`, { method: 'PUT', token: mgr, body: { label: 'Чужая подпись' } });
  assert.equal(denied.status, 403, 'менеджер не переименовывает каналы');
  const stillThere = (await call('/api/channels', { token: admin })).data.find(c => c.external_id === WA_CHANNEL);
  assert.equal(stillThere.label, 'WhatsApp — Ирина', 'подпись администратора не изменена');
  assert.ok((await call('/api/channels', { token: mgr })).data.length >= 4, 'читать список каналов менеджеру можно: он нужен списку отправки в чате');
});

// ── привязка аккаунта к сотруднику ──────────────────────────────────────────
// Канал Wazzup — это один подключённый аккаунт, а не сотрудник. Когда аккаунтов
// несколько, администратор один раз указывает, кто с какого отвечает, и дальше
// CRM решает сама: обращение с этого аккаунта назначается на его владельца, а
// исходящее письмо клиенту, который ещё не писал, уходит с его аккаунта.
const IRINA = { name: 'Ирина Каналова', email: 'irina-channel@example.com', password: 'IrinaPass-2026!' };
let irina = null, irinaId = 0;

async function loginStaff(cred) {
  const created = await call('/api/users', { method: 'POST', token: admin, body: { ...cred, role: 'manager', active: 1 } });
  assert.ok(created.data.id, 'сотрудник создан: ' + JSON.stringify(created.data));
  let tok = (await call('/api/auth/login', { method: 'POST', body: { email: cred.email, password: cred.password } })).data.token;
  await call('/api/me/password', { method: 'POST', token: tok, body: { old_password: cred.password, new_password: 'Changed-' + cred.password, confirm_password: 'Changed-' + cred.password } });
  tok = (await call('/api/auth/login', { method: 'POST', body: { email: cred.email, password: 'Changed-' + cred.password } })).data.token;
  assert.ok(tok, 'сотрудник вошёл после смены пароля');
  return { token: tok, id: created.data.id };
}

test('привязка аккаунта к сотруднику сохраняется и переживает синхронизацию', async () => {
  irina = await loginStaff(IRINA); irinaId = irina.id;
  const chans = (await call('/api/channels', { token: admin })).data;
  const wa2 = chans.find(c => c.external_id === WA2_CHANNEL);
  assert.ok(wa2, 'второй аккаунт WhatsApp синхронизирован');

  const bad = await call(`/api/channels/${wa2.id}`, { method: 'PUT', token: admin, body: { label: wa2.label || '', user_id: 999999 } });
  assert.equal(bad.status, 400, 'привязка к несуществующему сотруднику отклонена');
  assert.match(String(bad.data.error), /не найден|не работает/);

  const ok = await call(`/api/channels/${wa2.id}`, { method: 'PUT', token: admin, body: { label: 'WhatsApp — Ирина, второй номер', user_id: irinaId } });
  assert.equal(ok.status, 200);
  assert.equal(Number(ok.data.user_id), irinaId, 'сотрудник записан в канал');

  await call('/api/integrations/wazzup/sync', { method: 'POST', token: admin });
  const after = (await call('/api/channels', { token: admin })).data.find(c => c.external_id === WA2_CHANNEL);
  assert.equal(Number(after.user_id), irinaId, 'привязка не затёрлась при повторной синхронизации');
  assert.equal(after.label, 'WhatsApp — Ирина, второй номер', 'название тоже осталось');

  const denied = await call(`/api/channels/${wa2.id}`, { method: 'PUT', token: irina.token, body: { label: 'Моё', user_id: irinaId } });
  assert.equal(denied.status, 403, 'сотрудник не перепривязывает каналы сам себе');
});

test('обращение на привязанный аккаунт назначается его владельцу, а не по очереди', async () => {
  // распределение по загруженности выбрало бы сотрудника с меньшим id: у обоих
  // сделок в работе нет. Проверяем, что привязка оказывается важнее очереди.
  const phone = '79005554433';
  const r = await hook({ messages: [{ messageId: 'wz-bind-1', channelId: WA2_CHANNEL, chatType: 'whatsapp', chatId: phone, type: 'text', isEcho: false, status: 'inbound', text: 'Нужен подрядчик на дом', dateTime: '2026-10-23T13:00:00.000', contact: { name: 'Клиент Ирины', phone } }] });
  assert.equal(r.status, 200);

  const contact = db.prepare('SELECT * FROM contacts WHERE phone_norm=?').get(phone);
  assert.ok(contact, 'контакт создан');
  assert.equal(Number(contact.responsible_id), irinaId, 'обращение назначено на владельца аккаунта');

  const deal = db.prepare("SELECT * FROM deals WHERE contact_id=? AND stage NOT IN ('won','lost') ORDER BY id DESC").get(contact.id);
  assert.ok(deal, 'сделка из обращения создана');
  assert.equal(Number(deal.responsible_id), irinaId, 'сделка заведена на того же сотрудника');
  assert.equal(deal.responsible, IRINA.name, 'имя ответственного в сделке заполнено');

  const conv = db.prepare('SELECT * FROM conversations WHERE contact_id=?').get(contact.id);
  assert.equal(Number(conv.assigned_id), irinaId, 'беседа закреплена за владельцем аккаунта');
  assert.equal(conv.channel_id, WA2_CHANNEL, 'аккаунт обращения запомнен');

  const act = db.prepare("SELECT text FROM activities WHERE entity_type='contacts' AND entity_id=? ORDER BY id DESC").get(contact.id);
  assert.ok(act && act.text.includes(IRINA.name), 'в истории видно, кому назначено: ' + (act || {}).text);

  // ответ на это обращение уходит с аккаунта Ирины, а не с канала по умолчанию
  const reply = await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', token: admin, body: { body: 'Здравствуйте!', chat_type: 'whatsapp' } });
  assert.equal(reply.data.send.delivered, true, JSON.stringify(reply.data.send));
  assert.equal(seen.messages[seen.messages.length - 1].channelId, WA2_CHANNEL, 'ответ с того аккаунта, на который писал клиент');
});

test('исходящее первым уходит с аккаунта того сотрудника, который пишет', async () => {
  const contact = db.prepare("INSERT INTO contacts(name,phone,phone_norm,source) VALUES('Новосёл Олег','+7 900 777-66-55','79007776655','manual')").run();
  const cid = Number(contact.lastInsertRowid);

  // беседу заводят до первого сообщения клиента: адреса ещё нет, берём из телефона
  const noAddr = await call('/api/conversations', { method: 'POST', token: admin, body: { contact_id: cid, chat_type: 'telegram' } });
  assert.equal(noAddr.status, 400, 'без адреса в Telegram беседу не завести: имя чата не угадать');

  const created = await call('/api/conversations', { method: 'POST', token: irina.token, body: { contact_id: cid, chat_type: 'whatsapp' } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.chat_type, 'whatsapp');
  assert.equal(created.data.external_chat_id, '79007776655', 'адресатом стал телефон клиента');
  const again = await call('/api/conversations', { method: 'POST', token: irina.token, body: { contact_id: cid, chat_type: 'whatsapp' } });
  assert.equal(again.status, 200, 'повторно беседу не создаём');
  assert.equal(again.data.id, created.data.id, 'беседа одна на клиента');

  // пишет Ирина, у неё привязан второй аккаунт WhatsApp — отправляем с него
  const mine = await call(`/api/conversations/${created.data.id}/messages`, { method: 'POST', token: irina.token, body: { body: 'Отправляю КП', chat_type: 'whatsapp' } });
  assert.equal(mine.data.send.delivered, true, JSON.stringify(mine.data.send));
  assert.equal(seen.messages[seen.messages.length - 1].channelId, WA2_CHANNEL, 'аккаунт Ирины, а не первый подходящий');

  // пишет администратор без привязки — берётся канал по умолчанию
  const other = await call(`/api/conversations/${created.data.id}/messages`, { method: 'POST', token: admin, body: { body: 'И счёт', chat_type: 'whatsapp' } });
  assert.equal(other.data.send.delivered, true, JSON.stringify(other.data.send));
  assert.equal(seen.messages[seen.messages.length - 1].channelId, WA_CHANNEL, 'без привязки работает прежний выбор аккаунта');
});

// ── действия правил: сообщение клиенту, передача сотруднику, выдержка ────────
test('правило отвечает клиенту в его канал и подставляет имя', async () => {
  const rule = await call('/api/automations', { method: 'POST', token: admin, body: { name: 'Ответ на смету', trigger_type: 'message_in', trigger_value: 'смета', action_type: 'send_message', action_value: '{name}, смету отправлю сегодня', active: 1, delay_days: 0 } });
  assert.ok(rule.data.id, 'правило создано: ' + JSON.stringify(rule.data));
  const phone = '79008887766';
  const before = seen.messages.length;
  const r = await hook({ messages: [{ messageId: 'wz-auto-1', channelId: WA_CHANNEL, chatType: 'whatsapp', chatId: phone, type: 'text', isEcho: false, status: 'inbound', text: 'Пришлите смету на дом', dateTime: '2026-10-23T14:00:00.000', contact: { name: 'Сметчик Пётр', phone } }] });
  assert.equal(r.status, 200);
  assert.equal(seen.messages.length, before + 1, 'правило отправило ровно одно сообщение');
  const sent = seen.messages[seen.messages.length - 1];
  assert.equal(sent.channelId, WA_CHANNEL, 'автоответ ушёл с того аккаунта, куда писал клиент');
  assert.equal(sent.chatId, phone, 'адресат — тот же клиент');
  assert.equal(sent.text, 'Сметчик Пётр, смету отправлю сегодня', 'имя клиента подставилось вместо {name}');

  const conv = db.prepare('SELECT * FROM conversations WHERE external_chat_id=?').get(phone);
  const out = db.prepare("SELECT * FROM messages WHERE conversation_id=? AND direction='out'").all(conv.id);
  assert.equal(out.length, 1, 'автоответ виден в переписке');
  assert.equal(out[0].status, 'sent', 'сообщение доставлено, а не просто сохранено');
  assert.equal(out[0].author, 'Автоматизация', 'в чате видно, что написал не человек');

  // правило со словом-условием не должно срабатывать на другие сообщения
  const other = await hook({ messages: [{ messageId: 'wz-auto-2', channelId: WA_CHANNEL, chatType: 'whatsapp', chatId: phone, type: 'text', isEcho: false, status: 'inbound', text: 'Спасибо', dateTime: '2026-10-23T14:05:00.000', contact: { name: 'Сметчик Пётр', phone } }] });
  assert.equal(other.status, 200);
  assert.equal(seen.messages.length, before + 1, 'на сообщение без ключевого слова правило молчит');
});

test('правило передаёт сделку сотруднику', async () => {
  const rule = await call('/api/automations', { method: 'POST', token: admin, body: { name: 'Переговоры ведёт Ирина', trigger_type: 'stage_changed', trigger_value: 'negotiation', action_type: 'assign_user', action_value: String(irinaId), active: 1 } });
  assert.ok(rule.data.id, 'правило создано');
  const c = (await call('/api/contacts', { method: 'POST', token: admin, body: { name: 'Переговорщик Лев', phone: '+7 900 222-11-00' } })).data;
  const d = (await call('/api/deals', { method: 'POST', token: admin, body: { title: 'Дом на переговорах', amount: 500000, stage: 'new', contact_id: c.id } })).data;
  assert.notEqual(Number(d.responsible_id), irinaId, 'до правила сделка не на Ирине');

  const moved = await call(`/api/deals/${d.id}`, { method: 'PATCH', token: admin, body: { stage: 'negotiation' } });
  assert.equal(moved.status, 200);
  const after = db.prepare('SELECT responsible_id,responsible FROM deals WHERE id=?').get(d.id);
  assert.equal(Number(after.responsible_id), irinaId, 'сделка передана сотруднику из правила');
  assert.equal(after.responsible, IRINA.name, 'имя ответственного обновилось вместе с идентификатором');
  const contact = db.prepare('SELECT responsible_id FROM contacts WHERE id=?').get(c.id);
  assert.equal(Number(contact.responsible_id), irinaId, 'клиент передан тому же сотруднику');

  // переход на другой этап правило не трогает: условие указано конкретным этапом
  await call('/api/deals/' + d.id, { method: 'PATCH', token: admin, body: { stage: 'offer', responsible_id: null } });
  assert.equal(db.prepare('SELECT responsible_id FROM deals WHERE id=?').get(d.id).responsible_id, null, 'на другом этапе правило не сработало');
});

test('правило с выдержкой ждёт срока, а очередь выполняет его один раз', async () => {
  const rule = await call('/api/automations', { method: 'POST', token: admin, body: { name: 'Напомнить через три дня', trigger_type: 'stage_changed', trigger_value: 'offer', action_type: 'create_task', action_value: 'Перезвонить по предложению', active: 1, delay_days: 3 } });
  assert.ok(rule.data.id, 'правило создано');
  const c = (await call('/api/contacts', { method: 'POST', token: admin, body: { name: 'Отложенный Клиент', phone: '+7 900 333-22-11' } })).data;
  const d = (await call('/api/deals', { method: 'POST', token: admin, body: { title: 'Сделка с выдержкой', amount: 1000, stage: 'new', contact_id: c.id } })).data;

  const tasksBefore = db.prepare('SELECT COUNT(*) n FROM tasks').get().n;
  await call(`/api/deals/${d.id}`, { method: 'PATCH', token: admin, body: { stage: 'offer' } });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks').get().n, tasksBefore, 'сразу задача не создана — иначе выдержка бессмысленна');

  const queued = db.prepare('SELECT * FROM automation_queue WHERE automation_id=?').all(rule.data.id);
  assert.equal(queued.length, 1, 'действие поставлено в очередь');
  assert.match(queued[0].run_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'срок в понятном местном времени: ' + queued[0].run_at);
  assert.equal(Number(queued[0].deal_id), d.id, 'очередь помнит сделку');
  assert.equal(await queueTick(), 0, 'до срока очередь ничего не выполняет');

  // переносим срок в прошлое — так планировщик увидит его на ближайшем тике
  db.prepare("UPDATE automation_queue SET run_at=datetime('now','localtime','-1 minute') WHERE id=?").run(queued[0].id);
  assert.equal(await queueTick(), 1, 'срок наступил — действие выполнено');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks').get().n, tasksBefore + 1, 'задача создана');
  const t = db.prepare('SELECT * FROM tasks ORDER BY id DESC').get();
  assert.equal(t.title, 'Перезвонить по предложению');
  assert.equal(Number(t.deal_id), d.id, 'задача привязана к той же сделке');
  assert.equal(Number(t.contact_id), c.id, 'и к тому же клиенту');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM automation_queue').get().n, 0, 'очередь очищена: действие не повторится на следующем тике');

  // выключенное правило из очереди не выполняется: его могли отменить нарочно
  const off = await call('/api/automations', { method: 'POST', token: admin, body: { name: 'Отменённое', trigger_type: 'stage_changed', trigger_value: 'decision', action_type: 'create_task', action_value: 'Не создавать', active: 1, delay_days: 2 } });
  await call(`/api/deals/${d.id}`, { method: 'PATCH', token: admin, body: { stage: 'decision' } });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM automation_queue').get().n, 1, 'отложенное действие в очереди');
  await call('/api/automations/' + off.data.id, { method: 'PATCH', token: admin, body: { active: 0 } });
  db.prepare("UPDATE automation_queue SET run_at=datetime('now','localtime','-1 minute') WHERE id=?").run(db.prepare('SELECT id FROM automation_queue').get().id);
  const tasksNow = db.prepare('SELECT COUNT(*) n FROM tasks').get().n;
  await queueTick();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks').get().n, tasksNow, 'выключенное правило из очереди не сработало');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM automation_queue').get().n, 0, 'и не осталось висеть в очереди');
});

test('проверочный запрос вендора проходит, а чужой запрос без кода защиты отклоняется', async () => {
  const probe = await fetch(`${base}/webhooks/wazzup?secret=${SECRET}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: true }) });
  assert.equal(probe.status, 200, 'тело {test:true} получает 200 — иначе вендор откажет в регистрации');
  const stranger = await fetch(base + '/webhooks/wazzup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ messageId: 'fake-1', chatType: 'whatsapp', chatId: '79000000000', text: 'чужое сообщение', isEcho: false }] }) });
  assert.equal(stranger.status, 403, 'без кода защиты сообщения не принимаются');
  const fake = db.prepare('SELECT COUNT(*) n FROM messages WHERE external_id=?').get('fake-1');
  assert.equal(fake.n, 0, 'поддельное сообщение не попало в базу');
});
