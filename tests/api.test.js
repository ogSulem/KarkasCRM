import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync, statSync } from 'node:fs';

// Версия берётся из файла VERSION, а не вписывается в тест: иначе каждое её
// повышение требовало бы правки проверок, которые должны быть от него свободны.
const VERSION = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();
process.env.DATA_DIR = '/tmp/karkas-test-' + Date.now();
process.env.PORT = '18099';
process.env.SEED_MODE = 'off'; // детерминированная чистая база для тестов
const { server, db, partnerSeesEvent, clearLoginAttempts } = await import('../backend/src/server.js');
const base = 'http://127.0.0.1:18099';
let h;
const rawCall = (p, opt = {}) => fetch(base + p, { ...opt, headers: { 'Content-Type': 'application/json', ...(h || {}), ...(opt.headers || {}) } }).then(async r => ({ status: r.status, body: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text() }));
// Сценарии, не проверяющие форму сделки, используют явное «не выяснено» для
// новых обязательных полей. Отдельная проверка вызывает rawCall и проверяет отказ API.
const DEAL_TEST_DEFAULTS = { amount: 0, deal_object: 'Объект для теста', land_status: 'unknown', construction_date: 'unknown', payment_type: 'unknown', lead_source: 'Тест' };
const call = (p, opt = {}) => {
  if (p === '/api/deals' && String(opt.method || 'GET').toUpperCase() === 'POST' && typeof opt.body === 'string') {
    const body = JSON.parse(opt.body);
    opt = { ...opt, body: JSON.stringify({ ...DEAL_TEST_DEFAULTS, ...body }) };
  }
  return rawCall(p, opt);
};
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
  const l = await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@example.com', password: 'admin1234567' }) });
  assert.ok(l.body.token, 'получен JWT');
  h = { Authorization: 'Bearer ' + l.body.token };
  assert.equal((await fetch(base + '/api/contacts')).status, 401, 'без токена — 401');
  assert.equal((await fetch(base + '/api/contacts', { headers: { Authorization: 'Bearer broken.token' } })).status, 401, 'битый токен — 401');
  assert.equal((await fetch(base + '/api/contacts?token=' + encodeURIComponent(h.Authorization.split(' ')[1]), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401, 'токен в адресной строке не даёт менять данные');
});

test('файлы вложений отдаются с правильным способом открытия', async () => {
  // svg из вложения вебхука может содержать скрипт — открывать его страницей нельзя
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const dir = process.env.DATA_DIR + '/uploads';
  mkdirSync(dir, { recursive: true });
  writeFileSync(dir + '/20260101-abcdef-test.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  writeFileSync(dir + '/20260101-abcdef-test.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  writeFileSync(dir + '/20260101-abcdef-test.mp3', Buffer.from('0123456789abcdef'));
  const svg = await fetch(base + '/uploads/20260101-abcdef-test.svg', { headers: h });
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get('content-disposition') || '', /attachment/, 'svg открывается только скачиванием');
  assert.equal(svg.headers.get('content-type'), 'image/svg+xml');
  const png = await fetch(base + '/uploads/20260101-abcdef-test.png', { headers: h });
  assert.match(png.headers.get('content-disposition') || '', /inline/, 'обычная картинка показывается на месте');
  const audio = await fetch(base + '/uploads/20260101-abcdef-test.mp3', { headers: { ...h, Range: 'bytes=2-5' } });
  assert.equal(audio.status, 206, 'браузер может запрашивать фрагменты записи звонка');
  assert.equal(audio.headers.get('content-type'), 'audio/mpeg', 'голосовое получает тип, который понимает проигрыватель');
  assert.equal(audio.headers.get('content-range'), 'bytes 2-5/16', 'размер фрагмента и всего файла согласованы');
  assert.equal(await audio.text(), '2345', 'отдан только запрошенный диапазон');
  const badRange = await fetch(base + '/uploads/20260101-abcdef-test.mp3', { headers: { ...h, Range: 'bytes=99-100' } });
  assert.equal(badRange.status, 416, 'невозможный диапазон не отдаёт неверный файл');
});

test('поля записей обрезаются до пределов, а свои поля принимаются объектом', async () => {
  const long = 'x'.repeat(3000);
  const c = await call('/api/companies', { method: 'POST', body: JSON.stringify({ name: 'Компания с длинным сайтом', site: long }) });
  assert.equal(c.status, 201);
  assert.equal(String(c.body.site).length, 500, 'сайт обрезан до 500 символов, а не лёг в базу куском на 3000');
  const d = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка с длинным сроком', deadline: long }) });
  assert.equal(d.status, 201);
  const row = (await call('/api/deals/' + d.body.id)).body.deal;
  assert.equal(String(row.deadline).length, 40, 'срок сделки обрезан');
  const k = await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Контакт с объектом custom', custom: { test: 'значение' } }) });
  assert.equal(k.status, 201, 'свои поля, присланные объектом, принимаются');
  assert.equal(JSON.parse(k.body.custom).test, 'значение', 'объект сохранён строкой JSON');
});

test('тема оформления личная: хранится на сервере и доступна наблюдателю', async () => {
  const dark = await call('/api/me/theme', { method: 'PATCH', body: JSON.stringify({ theme: 'dark' }) });
  assert.equal(dark.status, 200);
  let me = await call('/api/me');
  assert.equal(me.body.user.theme, 'dark', 'личный выбор виден в профиле');
  const bad = await call('/api/me/theme', { method: 'PATCH', body: JSON.stringify({ theme: 'ночь' }) });
  assert.equal(bad.status, 400, 'неизвестная тема отклоняется');
  const auto = await call('/api/me/theme', { method: 'PATCH', body: JSON.stringify({ theme: 'auto' }) });
  assert.equal(auto.status, 200);
  me = await call('/api/me');
  assert.equal(me.body.user.theme, '', 'режим «как в системе» хранится пустым значением');
  // наблюдателю закрыты все изменения, кроме собственных пароля и темы
  const v = await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Наблюдатель темы', email: 'theme-viewer@example.com', password: 'nabludatel123', role: 'viewer' }) });
  assert.equal(v.status, 201);
  const vl = await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'theme-viewer@example.com', password: 'nabludatel123' }) });
  const vHeaders = { Authorization: 'Bearer ' + vl.body.token };
  const vTheme = await call('/api/me/theme', { method: 'PATCH', headers: vHeaders, body: JSON.stringify({ theme: 'dark' }) });
  assert.equal(vTheme.status, 200, 'наблюдатель выбирает свою тему');
  const vOther = await call('/api/contacts', { method: 'POST', headers: vHeaders, body: JSON.stringify({ name: 'Не пройдут' }) });
  assert.equal(vOther.status, 403, 'остальные изменения наблюдателю по-прежнему закрыты');
});

test('битые процент-последовательности не валят сервер в 500', async () => {
  // Cookie — заголовок целиком во власти клиента: раньше decodeURIComponent бросал
  // исключение на %zz, и любой запрос с битой кукой давал 500 и строку в журнале
  const cookie = await fetch(base + '/api/contacts', { headers: { Cookie: 'karkas_token=%zz; x=%E0%A4' } });
  assert.equal(cookie.status, 401, 'запрос с битой кукой обработан штатно: 401 без авторизации, не 500');
  // имя файла с битым процентом — ошибка клиента, ответ 400
  const file = await call('/uploads/%zz');
  assert.equal(file.status, 400, 'битое имя файла — 400, не 500');
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

test('любимый раздел сотрудника сохраняется и возвращается в meta', async () => {
  const save = await call('/api/me/pref', { method: 'PATCH', body: JSON.stringify({ view: 'contacts' }) });
  assert.equal(save.status, 200, 'раздел сохранён');
  const meta = (await call('/api/meta')).body;
  assert.equal(meta.user.pref_view, 'contacts', 'meta отдаёт любимый раздел');
  const bad = await call('/api/me/pref', { method: 'PATCH', body: JSON.stringify({ view: 'no-such-view' }) });
  assert.equal(bad.status, 400, 'неизвестный раздел отклоняется');
  await call('/api/me/pref', { method: 'PATCH', body: JSON.stringify({ view: 'dashboard' }) });
});

test('групповой чат: одна история, участники с именами, повторы схлопнуты', async () => {
  // событие группы приходит с именем отправителя: пузырь подписывается участником
  await call('/webhooks/wazzup', { method: 'POST', body: JSON.stringify({ messages: [{ messageId: 'grp-1', channelId: 'ch-g', chatType: 'maxgroup', chatId: 'group-77', text: 'Всем привет из группы', sender: { name: 'Надежда', phone: '79001110001' } }] }) });
  // второй участник пишет в ту же группу: история не разделяется по карточкам
  await call('/webhooks/wazzup', { method: 'POST', body: JSON.stringify({ messages: [{ messageId: 'grp-2', channelId: 'ch-g', chatType: 'maxgroup', chatId: 'group-77', text: 'А это от меня', sender: { name: 'Сергей', phone: '79001110002' } }] }) });
  // двойная доставка того же сообщения с другим идентификатором: один пузырь
  await call('/webhooks/wazzup', { method: 'POST', body: JSON.stringify({ messages: [{ messageId: 'grp-2-retry', channelId: 'ch-g', chatType: 'maxgroup', chatId: 'group-77', text: 'А это от меня', sender: { name: 'Сергей', phone: '79001110002' } }] }) });
  const convs = (await call('/api/conversations')).body.filter(c => (c.external_chat_id || '') === 'group-77');
  assert.equal(convs.length, 1, 'у группы одна беседа на всех участников');
  const msgs = (await call(`/api/conversations/${convs[0].id}/messages`)).body;
  assert.equal(msgs.filter(m => m.body === 'А это от меня').length, 1, 'двойная доставка не создала второй пузырь');
  assert.equal(msgs.find(m => m.body === 'Всем привет из группы').author, 'Надежда', 'сообщение подписано именем участника');
  assert.equal(msgs.find(m => m.body === 'Всем привет из группы').chat_type, 'maxgroup', 'тип чата приходит вместе с сообщением');
  // своё отправление вернулось групповой доставкой чужим: эхо переносит копию на нашу сторону
  await call('/webhooks/wazzup', { method: 'POST', body: JSON.stringify({ messages: [{ messageId: 'grp-3', channelId: 'ch-g', chatType: 'maxgroup', chatId: 'group-77', text: 'Спецификация готова', sender: { name: 'Расим' } }] }) });
  await call('/webhooks/wazzup', { method: 'POST', body: JSON.stringify({ data: [{ message_id: 'grp-3-echo', direction: 'outbound', recipient: { chat_id: 'group-77', chat_type: 'maxgroup' }, sender: { name: 'Расим' }, text: 'Спецификация готова' }] }) });
  const msgs2 = (await call(`/api/conversations/${convs[0].id}/messages`)).body;
  const spec = msgs2.filter(m => m.body === 'Спецификация готова');
  assert.equal(spec.length, 1, 'своё сообщение видно в чате ровно один раз');
  assert.equal(spec[0].direction, 'out', 'своё сообщение стоит на нашей стороне');
});

test('фирменный лист: вектор отдаётся без входа и кэшируется по ETag', async () => {
  const first = await fetch(base + '/favicon.svg');
  const text = await first.text(); // тело обязательно читаем: иначе сокет держит процесс
  assert.equal(first.status, 200);
  assert.match(first.headers.get('content-type') || '', /image\/svg/, 'лист отдаётся вектором');
  assert.ok(text.includes('<path') && text.includes('currentColor'), 'лист — контур, красится цветом интерфейса');
  const etag = first.headers.get('etag');
  assert.ok(etag, 'у вектора есть ETag');
  const second = await fetch(base + '/favicon.svg', { headers: { 'If-None-Match': etag } });
  await second.arrayBuffer();
  assert.equal(second.status, 304, 'неизменённый лист не скачивается повторно');
  const favicon = await fetch(base + '/favicon.ico', { redirect: 'manual' });
  await favicon.arrayBuffer();
  assert.equal(favicon.status, 301, 'прежний адрес иконки уводит на вектор');
  assert.equal(favicon.headers.get('location'), '/favicon.svg');
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

test('сервер требует все шесть основных полей сделки и принимает явное «не выяснено»', async () => {
  const valid={title:'Сделка с подтверждённой формой',...DEAL_TEST_DEFAULTS};
  const created=await rawCall('/api/deals',{method:'POST',body:JSON.stringify(valid)});
  assert.equal(created.status,201,'явное состояние неизвестного значения не считается пустым');
  const missing=[
    ['amount','бюджет'],['deal_object','объект'],['land_status','наличие земли'],
    ['construction_date','дата строительства'],['payment_type','тип оплаты'],['lead_source','источник лида'],
  ];
  for(const [field,label] of missing){
    const body={...valid,title:`Проверка ${field}`};delete body[field];
    const response=await rawCall('/api/deals',{method:'POST',body:JSON.stringify(body)});
    assert.equal(response.status,400,`${field} обязателен на сервере`);
    assert.match(String(response.body.error),new RegExp(label,'i'),`ошибка называет поле ${field}`);
  }
  for(const [field,value] of [['deal_object','   '],['land_status',''],['construction_date','2026-02-30'],['payment_type',''],['lead_source','']]){
    const response=await rawCall('/api/deals',{method:'POST',body:JSON.stringify({...valid,title:`Некорректно ${field}`,[field]:value})});
    assert.equal(response.status,400,`${field}: пустое или неверное значение отклоняется`);
  }
});

test('история сделки: смену суммы, ответственного и названия видно в карточке', async () => {
  const staff = (await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Историк Олег', email: 'history-oleg@example.com', role: 'manager', active: 1, password: 'HistoryPass-2026!' }) })).body;
  assert.ok(staff.id, 'сотрудник создан');
  const d = (await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Дом для журнала', amount: 100000, stage: 'new', contact_id: 1 }) })).body;
  await call('/api/deals/' + d.id, { method: 'PATCH', body: JSON.stringify({ amount: 250000, title: 'Дом для журнала (уточнён)', responsible_id: staff.id, deadline: '2026-11-30' }) });
  const texts = (await call('/api/deals/' + d.id)).body.history.map(x => x.text);
  assert.ok(texts.some(t => t.includes('бюджет: 100 000 ₽ → 250 000 ₽')), 'смена бюджета записана: ' + texts.join(' | '));
  assert.ok(texts.some(t => t.includes('ответственный:') && t.includes('Историк Олег')), 'смена ответственного записана');
  assert.ok(texts.some(t => t.includes('название:')), 'смена названия записана');
  assert.ok(texts.some(t => t.includes('срок:') && t.includes('30.11.2026')), 'срок в привычном виде дд.мм.гггг: ' + texts.join(' | '));
  // повторное сохранение того же значения не должно раздувать журнал
  await call('/api/deals/' + d.id, { method: 'PATCH', body: JSON.stringify({ amount: 250000 }) });
  const after = (await call('/api/deals/' + d.id)).body.history;
  assert.equal(after.filter(x => x.text.includes('бюджет:')).length, 1, 'тот же бюджет второй раз не пишется');
  assert.ok(after.some(x => x.user_name), 'в истории видно, кто менял');
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
  const deferred=pl.stages.find(s=>s.code==='deferred');
  assert.ok(deferred,'в существующей воронке есть системный этап «Отложенный спрос»');
  assert.equal(deferred.name,'Отложенный спрос');
  assert.equal(deferred.kind,'open');
  const stages = pl.stages.map(s => ({ code: s.code, name: s.name, color: s.color, kind: s.kind }));
  const noDeferred=await call('/api/pipelines/1',{method:'PUT',body:JSON.stringify({name:pl.name,stages:stages.filter(s=>s.code!=='deferred')})});
  assert.equal(noDeferred.status,400,'API не позволяет удалить обязательный этап');
  const altered=await call('/api/pipelines/1',{method:'PUT',body:JSON.stringify({name:pl.name,stages:stages.map(s=>s.code==='deferred'?{...s,name:'Подмена',color:'#ff0000',kind:'won'}:s)})});
  assert.equal(altered.status,200,'остальные этапы можно сохранить рядом с системным');
  const fixed=(await call('/api/pipelines')).body.find(p=>p.id===1).stages.find(s=>s.code==='deferred');
  assert.deepEqual([fixed.name,fixed.color,fixed.kind],['Отложенный спрос','#0284c7','open'],'сервер фиксирует имя, цвет и тип этапа');
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
  const saved=await call('/api/pipelines/' + pipe.id, { method: 'PUT', body: JSON.stringify({ name: 'Сервис и монтаж', stages: [{ code: 'in', name: 'Заявка', color: '#f97316' }, { code: 'work', name: 'В работе', color: '#16a34a' }, { code: 'deferred', name: 'Отложенный спрос', color: '#0284c7', kind: 'open' }, { code: 'won', name: 'Готово', color: '#15803d', kind: 'won' }, { code: 'lost', name: 'Не сделали', color: '#78716c', kind: 'lost' }] }) });
  assert.equal(saved.status,200,'воронка с системным этапом сохраняется');
  const pl = (await call('/api/pipelines')).body.find(p => p.id === pipe.id);
  assert.equal(pl.name, 'Сервис и монтаж');
  assert.deepEqual(pl.stages.map(s => s.name), ['Заявка', 'В работе', 'Отложенный спрос', 'Готово', 'Не сделали']);
  // без этапа успеха и этапа отказа воронка не сохраняется: по этим кодам
  // система считает выручку и закрывает сделки кнопками на доске
  const bad = await call('/api/pipelines/' + pipe.id, { method: 'PUT', body: JSON.stringify({ name: 'Без успеха', stages: [{ code: 'a', name: 'А' }, { code: 'b', name: 'Б' }] }) });
  assert.equal(bad.status, 400, 'воронка без этапов успеха и отказа не сохраняется');
  assert.match(String(bad.body.error), /успех/, 'ошибка объясняет, каких этапов не хватает');
});

test('доска воронки показывает только её сделки, даже когда коды этапов совпадают', async () => {
  const pipe = (await call('/api/pipelines', { method: 'POST', body: JSON.stringify({ name: 'Вторая воронка' }) })).body;
  const d1 = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка первой воронки', stage: 'new' }) });
  const d2 = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка второй воронки', stage: 'new', pipeline_id: pipe.id }) });
  assert.equal(d1.status, 201); assert.equal(d2.status, 201);
  const board1 = (await call('/api/deals?pipeline=1')).body.deals.map(x => x.id);
  const board2 = (await call('/api/deals?pipeline=' + pipe.id)).body.deals.map(x => x.id);
  assert.ok(board1.includes(d1.body.id) && !board1.includes(d2.body.id), 'на доске первой воронки нет чужой сделки');
  assert.ok(board2.includes(d2.body.id) && !board2.includes(d1.body.id), 'на доске второй воронки нет чужой сделки');
  // карточки клиента и компании запрашивают сделки без параметра — там нужны все воронки
  const all = (await call('/api/deals')).body.deals.map(x => x.id);
  assert.ok(all.includes(d1.body.id) && all.includes(d2.body.id), 'без параметра список содержит сделки всех воронок');
  // распределение по этапам в аналитике не сливает одноимённые этапы разных воронок
  const an = (await call('/api/analytics')).body.stages;
  const newP1 = an.find(x => x.code === 'new' && Number(x.pipeline_id) === 1);
  const newP2 = an.find(x => x.code === 'new' && Number(x.pipeline_id) === Number(pipe.id));
  assert.ok(newP1 && newP2, 'этап «new» виден в аналитике для обеих воронок раздельно');
  assert.ok(newP1.count >= 1 && newP2.count >= 1, 'сделки посчитаны каждая в своей воронке');
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
  const vw = (await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Наблюдатель', email: 'view@example.com', password: 'viewer123456', role: 'viewer' }) })).body;
  const mgrToken = (await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'mgr@example.com', password: 'manager12345' }) })).body.token;
  const vwToken = (await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'view@example.com', password: 'viewer123456' }) })).body.token;
  assert.ok(mgrToken && vwToken);
  const adminH = h; h = { Authorization: 'Bearer ' + mgrToken };
  assert.equal((await call('/api/settings', { method: 'PUT', body: JSON.stringify({ COMPANY_NAME: 'x' }) })).status, 403, 'менеджер не меняет настройки');
  assert.equal((await call('/api/settings')).status,403,'секреты интеграций и настройки доступны только администратору');
  assert.equal((await call('/api/backups')).status,403,'список копий и метаданные хранилища доступны только администратору');
  assert.equal((await call('/api/contacts')).status, 200, 'менеджер видит данные');
  h = { Authorization: 'Bearer ' + vwToken };
  assert.equal((await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Nope' }) })).status, 403, 'наблюдатель только читает');
  // Личная метка прочитанного — не изменение общих данных: просмотренный
  // наблюдателем чат не должен вечно висеть непрочитанным
  h = adminH;
  await call('/webhooks/generic', { method: 'POST', body: JSON.stringify({ channel: 'site', phone: '79220001122', name: 'Чат Наблюдателя', body: 'Вопрос команде' }) });
  const vwConv = (await call('/api/conversations')).body.find(c => (c.phone || '').includes('9220001122'));
  assert.ok(vwConv, 'чат для проверки наблюдателя создан');
  h = { Authorization: 'Bearer ' + vwToken };
  const marked = await call('/api/conversations/read', { method: 'POST', body: JSON.stringify({ ids: [vwConv.id] }) });
  assert.equal(marked.status, 200, 'наблюдатель отмечает чат прочитанным');
  assert.equal(marked.body.marked, 1, 'метка сохранена');
  assert.equal((await call(`/api/conversations/${vwConv.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'Привет' }) })).status, 403, 'наблюдатель не пишет в чат');
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

test('автоответ без ключевого слова не превращается в рассылку', async () => {
  // правило «отвечать на любое входящее» — частая ошибка настройки: без
  // ограничения клиент получал бы сообщение на каждую строчку переписки
  const rule = (await call('/api/automations', { method: 'POST', body: JSON.stringify({ name: 'Автоответ-поток', trigger_type: 'message_in', trigger_value: '', action_type: 'send_message', action_value: 'Спасибо, что написали нам!', active: 1, delay_days: 0 }) })).body;
  assert.ok(rule.id, 'правило создано');
  await call('/webhooks/generic', { method: 'POST', body: JSON.stringify({ channel: 'site', phone: '79229990011', name: 'Поток Клиент', body: 'Первый вопрос' }) });
  await call('/webhooks/generic', { method: 'POST', body: JSON.stringify({ channel: 'site', phone: '79229990011', name: 'Поток Клиент', body: 'Второй вопрос подряд' }) });
  const conv = (await call('/api/conversations')).body.find(c => (c.phone || '').includes('9229990011'));
  assert.ok(conv, 'чат клиента создан');
  const msgs = (await call(`/api/conversations/${conv.id}/messages`)).body;
  const replies = msgs.filter(m => m.body === 'Спасибо, что написали нам!');
  assert.equal(replies.length, 1, 'на два сообщения подряд автоответ сохранён один раз');
  assert.equal(replies[0].direction, 'out', 'автоответ сохранён исходящим');
  // правило удаляется, чтобы не влиять на остальные проверки
  const del = await call('/api/automations/' + rule.id, { method: 'DELETE' });
  assert.equal(del.status, 200, 'тестовое правило удалено');
});

test('отправка сообщения клиенту через Wazzup (сквозная проверка запроса к API)', async () => {
  // локальная заглушка API Wazzup — проверяем точный формат запроса и что оно «доставлено»
  const mock = (await import('node:http')).createServer(async (req, res) => {
    let b = ''; for await (const ch of req) b += ch;
    const okAuth = req.headers.authorization === 'Bearer test-api-key-123456';
    // GET /channels отдаёт ГОЛЫЙ МАССИВ без поля name — ровно как в документации
    // (wazzup24.ru/help/api-ru/rabota-s-kanalami). Обёртка {channels:[…]} была нашей
    // догадкой, из-за неё синхронизация всегда находила ноль каналов.
    if (req.url === '/channels') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify([{ channelId: 'e0629e11-0f67-4567-92a9-2237e91ec1b9', transport: 'whatsapp', plainId: '79991112233', state: 'active' }])); }
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
    assert.equal(sync.body.synced, 1, 'каналы Wazzup синхронизированы из голого массива');
    const chans = (await call('/api/channels')).body;
    assert.equal(chans[0].transport, 'whatsapp', 'транспорт канала сохранён');
    assert.equal(chans[0].state, 'active', 'состояние канала сохранено');
    assert.equal(chans[0].phone, '79991112233', 'plainId сохранён как номер');
    assert.equal(chans[0].name, '79991112233', 'поля name в API Wazzup нет — название берём из plainId');
    await call('/api/integrations/wazzup/webhook', { method: 'POST', body: JSON.stringify({ url: 'https://crm.example.com/webhooks/wazzup' }) });
    const regUri = new URL(globalThis.__wzHook.webhooksUri);
    assert.equal(regUri.origin + regUri.pathname, 'https://crm.example.com/webhooks/wazzup', 'вебхук зарегистрирован в Wazzup');
    assert.ok((regUri.searchParams.get('secret') || '').length >= 16, 'в адрес встроен секрет: поддельные входящие не пройдут');
    // без подписок Wazzup не присылает события вовсе
    assert.equal(globalThis.__wzHook.subscriptions.messagesAndStatuses, true, 'подписка на сообщения и статусы включена');
    assert.equal(globalThis.__wzHook.subscriptions.channelsUpdates, true, 'подписка на изменения каналов включена');
    const longUrl = await call('/api/integrations/wazzup/webhook', { method: 'POST', body: JSON.stringify({ url: 'https://crm.example.com/webhooks/wazzup?' + 'a'.repeat(220) }) });
    assert.equal(longUrl.status, 400, 'адрес длиннее 200 символов Wazzup не принимает — не отправляем заведомо отказной запрос');
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
    // Тип чата и транспорт канала у Wazzup — РАЗНЫЕ списки. В типах чата есть
    // групповые telegroup и maxgroup, а wapi, tgapi, maxbot и cian отсутствуют.
    for (const t of ['avito', 'max', 'vk', 'whatsgroup', 'telegroup', 'maxgroup']) {
      await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'Ответ', chat_type: t }) });
      assert.equal(globalThis.__wz.body.chatType, t, `тип чата ${t} передаётся в Wazzup без подмены`);
    }
    for (const t of ['wapi', 'tgapi', 'maxbot', 'cian']) {
      const r = await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'Ответ', chat_type: t }) });
      assert.equal(r.body.message.status, 'error', `транспорт ${t} не выдаётся за тип чата`);
      assert.match(r.body.send.mode, /chatType/, 'ошибка называет список допустимых типов чата');
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
  assert.equal(health.version, VERSION, 'health сообщает версию из файла VERSION');
  // Единый источник версии — файл VERSION, но поле version есть и в package.json.
  // Никто его не читает, поэтому расхождение не ломает работу и накапливается тихо.
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, health.version, 'версия в package.json не расходится с файлом VERSION');
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
  assert.equal((await asM('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'products', ids: [anyProd.id], action: 'update', patch: { active: 0 } }) })).status, 403, 'менеджер не меняет прайс-лист и массово');
  assert.equal((await asM('/api/products')).status, 200, 'менеджер видит прайс-лист');
  assert.equal((await asM(`/api/deals/${d.body.id}/products`, { method: 'POST', body: JSON.stringify({ name: 'Свободная позиция', price: 5000, qty: 1 }) })).status, 201, 'в сделку менеджер добавляет любую позицию');
  await call('/api/products/' + anyProd.id, { method: 'DELETE' });
  assert.equal((await asV('/api/deals/' + d.body.id, { method: 'PATCH', body: JSON.stringify({ amount: 1 }) })).status, 403, 'наблюдатель не меняет сделки');
  h = admin; // дальше снова работаем администратором
});

test('изоляция менеджеров действует в карточках, поиске, задачах, чатах, аналитике и выгрузках', async () => {
  const admin=h, suffix=String(Date.now());
  const makeManager=async(label)=>{
    const email=`scope-${label}-${suffix}@example.com`,password=`scope-${label}-password`;
    const user=(await call('/api/users',{method:'POST',body:JSON.stringify({name:`Менеджер ${label}`,email,password,role:'manager'})})).body;
    const login=await readyLogin('/api/auth/login',{method:'POST',body:JSON.stringify({email,password})});
    assert.ok(user.id&&login.body.token,`создан и вошёл менеджер ${label}`);
    return{...user,name:`Менеджер ${label}`,headers:{Authorization:'Bearer '+login.body.token}};
  };
  const a=await makeManager('А'), b=await makeManager('Б');
  const contactA=(await call('/api/contacts',{method:'POST',body:JSON.stringify({name:`ScopeAlpha${suffix}`,phone:`7900${suffix.slice(-7)}1`,source:`scope-a-${suffix}`,responsible_id:a.id})})).body;
  const contactB=(await call('/api/contacts',{method:'POST',body:JSON.stringify({name:`ScopeBeta${suffix}`,phone:`7900${suffix.slice(-7)}2`,source:`scope-b-${suffix}`,responsible_id:b.id})})).body;
  const dealA=(await call('/api/deals',{method:'POST',body:JSON.stringify({title:`ScopeAlphaDeal${suffix}`,contact_id:contactA.id,responsible_id:a.id})})).body;
  const dealB=(await call('/api/deals',{method:'POST',body:JSON.stringify({title:`ScopeBetaDeal${suffix}`,contact_id:contactB.id,responsible_id:b.id})})).body;
  const adminId=db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get().id;
  const adminDealSameContact=(await call('/api/deals',{method:'POST',body:JSON.stringify({title:`OfficePrivateDeal${suffix}`,contact_id:contactA.id,responsible_id:adminId})})).body;
  assert.ok(dealA.id&&dealB.id&&adminDealSameContact.id,'созданы независимые сделки');
  const taskA=(await call('/api/tasks',{method:'POST',body:JSON.stringify({title:`ScopeAlphaTask${suffix}`,contact_id:contactA.id,deal_id:dealA.id,responsible_id:a.id})})).body;
  const taskB=(await call('/api/tasks',{method:'POST',body:JSON.stringify({title:`ScopeBetaTask${suffix}`,contact_id:contactB.id,deal_id:dealB.id,responsible_id:b.id})})).body;
  const convA=(await call('/api/conversations',{method:'POST',body:JSON.stringify({contact_id:contactA.id,chat_type:'whatsapp'})})).body;
  const convB=(await call('/api/conversations',{method:'POST',body:JSON.stringify({contact_id:contactB.id,chat_type:'whatsapp'})})).body;
  const bulkTask=(await call('/api/tasks',{method:'POST',body:JSON.stringify({title:`ScopeBulkTask${suffix}`,responsible_id:a.id})})).body;
  const bulkCompany=(await call('/api/companies',{method:'POST',body:JSON.stringify({name:`ScopeBulkCompany${suffix}`,responsible_id:a.id})})).body;
  db.prepare("INSERT INTO messages(conversation_id,deal_id,channel,direction,body,status,author) VALUES(?,?,'whatsapp','in',?,'inbound','Клиент')").run(convA.id,dealA.id,`Сообщение по своей сделке ${suffix}`);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64').toString('base64');
  const officeOnlyFile=await call(`/api/conversations/${convA.id}/upload`,{method:'POST',body:JSON.stringify({filename:'office-only.png',contentType:'image/png',dataBase64:png})});
  assert.equal(officeOnlyFile.status,201);
  const foreignFile=await call(`/api/conversations/${convB.id}/upload`,{method:'POST',body:JSON.stringify({filename:'manager-foreign.png',contentType:'image/png',dataBase64:png})});
  assert.equal(foreignFile.status,201,'чужое вложение создано для проверки доступа');
  await call(`/api/conversations/${convB.id}/messages`,{method:'POST',body:JSON.stringify({body:'',contentUri:foreignFile.body.url,contentName:foreignFile.body.name,contentType:foreignFile.body.contentType})});
  const ownFile=await call(`/api/conversations/${convA.id}/upload`,{method:'POST',body:JSON.stringify({filename:'manager-own.png',contentType:'image/png',dataBase64:png})});
  assert.equal(ownFile.status,201);
  await call(`/api/conversations/${convA.id}/messages`,{method:'POST',body:JSON.stringify({deal_id:dealA.id,body:'',contentUri:ownFile.body.url,contentName:ownFile.body.name,contentType:ownFile.body.contentType})});
  // Более новое сообщение по сделке офиса не должно менять видимое превью менеджера.
  db.prepare("INSERT INTO messages(conversation_id,deal_id,channel,direction,body,content_uri,status,author) VALUES(?,?,'whatsapp','in','Внутреннее сообщение другой сделки',?,'inbound','Клиент')").run(convA.id,adminDealSameContact.id,officeOnlyFile.body.url);
  const productB=await call(`/api/deals/${dealB.id}/products`,{method:'POST',body:JSON.stringify({name:'Чужая позиция',price:100,qty:1})});
  assert.equal(productB.status,201);
  const asA=(path,opt={})=>call(path,{...opt,headers:{...(opt.headers||{}),...a.headers}});
  const bulkContact=await asA('/api/bulk',{method:'POST',body:JSON.stringify({table:'contacts',action:'update',ids:[contactA.id],patch:{tags:`bulk-${suffix}`}})});
  assert.equal(bulkContact.status,200,'менеджер может массово изменить свой контакт');
  assert.equal(db.prepare('SELECT tags FROM contacts WHERE id=?').get(contactA.id).tags,`bulk-${suffix}`,'пакетное изменение сохранено');
  const beforeDealAmount=Number(db.prepare('SELECT amount FROM deals WHERE id=?').get(dealA.id).amount);
  const bulkDeal=await asA('/api/bulk',{method:'POST',body:JSON.stringify({table:'deals',action:'update',ids:[dealA.id],patch:{priority:'high'}})});
  assert.equal(bulkDeal.status,200,'менеджер может массово изменить свою сделку');
  const mixedBulk=await asA('/api/bulk',{method:'POST',body:JSON.stringify({table:'deals',action:'update',ids:[dealA.id,dealB.id],patch:{amount:beforeDealAmount+1}})});
  assert.equal(mixedBulk.status,403,'пачка со сделкой другого менеджера отклоняется целиком');
  assert.equal(Number(db.prepare('SELECT amount FROM deals WHERE id=?').get(dealA.id).amount),beforeDealAmount,'отказ на смешанной пачке не оставляет частичного изменения');
  assert.equal((await asA('/api/bulk',{method:'POST',body:JSON.stringify({table:'contacts',action:'update',ids:[contactB.id],patch:{tags:'чужой контакт'}})})).status,403,'менеджер не меняет пачкой чужой контакт');
  assert.equal((await asA('/api/bulk',{method:'POST',body:JSON.stringify({table:'contacts',action:'delete',ids:[contactA.id]})})).status,403,'нельзя удалить контакт, за которым остаётся сделка офиса');
  const bulkTaskDelete=await asA('/api/bulk',{method:'POST',body:JSON.stringify({table:'tasks',action:'delete',ids:[bulkTask.id]})});
  assert.equal(bulkTaskDelete.status,200,'менеджер может массово удалить свою задачу');
  const bulkCompanyDelete=await asA('/api/bulk',{method:'POST',body:JSON.stringify({table:'companies',action:'delete',ids:[bulkCompany.id]})});
  assert.equal(bulkCompanyDelete.status,200,'менеджер может массово удалить свою компанию без связанных карточек');
  const contacts=await asA('/api/contacts');
  assert.ok(contacts.body.some(c=>c.id===contactA.id)&&!contacts.body.some(c=>c.id===contactB.id),'список клиентов ограничен владельцем');
  const deals=await asA('/api/deals');
  assert.ok(deals.body.deals.some(d=>d.id===dealA.id)&&!deals.body.deals.some(d=>d.id===dealB.id),'воронка не содержит чужую сделку');
  const tasks=await asA('/api/tasks');
  assert.ok(tasks.body.some(t=>t.id===taskA.id)&&!tasks.body.some(t=>t.id===taskB.id),'список задач не пересекает контуры');
  const chats=await asA('/api/conversations');
  assert.ok(chats.body.some(c=>c.id===convA.id)&&!chats.body.some(c=>c.id===convB.id),'список чатов ограничен своими клиентами');
  const ownSummary=chats.body.find(c=>c.id===convA.id);
  assert.equal(ownSummary.last_body,'Файл: manager-own.png','превью берётся из последнего доступного сообщения, а не из более нового сообщения другой сделки');
  assert.equal((await asA('/api/dashboard')).body.unread,1,'непрочитанным считается только сообщение своей сделки');
  const ownHistory=await asA(`/api/conversations/${convA.id}/messages`);
  assert.equal(ownHistory.body.length,2,'история содержит текст и вложение своей сделки, но не переписку другой сделки');
  assert.ok(ownHistory.body.some(m=>/Сообщение по своей сделке/.test(m.body)),'собственное текстовое сообщение не потеряно');
  assert.ok(ownHistory.body.every(m=>Number(m.deal_id)===Number(dealA.id)),'каждое сообщение истории относится к доступной сделке');
  assert.equal((await asA('/api/dashboard')).body.unread,0,'чтение своей переписки обновляет только свою отметку прочтения');
  const ownCard=await asA('/api/deals/'+dealA.id);
  assert.equal(ownCard.body.messages.length,2,'карточка показывает текст и вложение своей сделки');
  assert.ok(ownCard.body.messages.every(m=>Number(m.deal_id)===Number(dealA.id)),'карточка сделки скрывает сообщения другой сделки клиента');
  assert.equal((await fetch(base+officeOnlyFile.body.url,{headers:a.headers})).status,403,'файл другой сделки не открывается через общий чат');
  assert.equal((await asA('/api/contacts/'+contactB.id)).status,403,'чужая карточка закрыта и по прямому ID');
  assert.equal((await asA('/api/deals/'+dealB.id)).status,403,'чужая сделка закрыта и по прямому ID');
  assert.equal((await asA('/api/conversations/'+convB.id+'/messages')).status,403,'история чужого чата закрыта');
  assert.equal((await asA('/api/deal_products/'+productB.body.id)).status,403,'состав чужой сделки закрыт отдельным маршрутом');
  assert.equal((await fetch(base+foreignFile.body.url,{headers:a.headers})).status,403,'вложение чужого чата нельзя скачать по прямому адресу');
  assert.equal((await fetch(base+ownFile.body.url,{headers:a.headers})).status,200,'вложение своей переписки доступно');
  const searchContacts=await asA('/api/search?q='+encodeURIComponent(`ScopeBeta${suffix}`)+'&only=contacts');
  const searchDeals=await asA('/api/search?q='+encodeURIComponent(`ScopeBetaDeal${suffix}`)+'&only=deals');
  assert.equal(searchContacts.body.contacts.length,0,'поиск не выдаёт чужого клиента');
  assert.equal(searchDeals.body.deals.length,0,'поиск не выдаёт чужую сделку');
  const dash=(await asA('/api/dashboard')).body;
  assert.ok(dash.recentDeals.some(d=>d.id===dealA.id)&&!dash.recentDeals.some(d=>d.id===dealB.id),'рабочий стол не раскрывает чужие сделки');
  const analytics=(await asA('/api/analytics')).body;
  assert.ok(analytics.byManager.some(m=>m.name===a.name)&&!analytics.byManager.some(m=>m.name===b.name),'аналитика агрегирует только карточки текущего менеджера: '+JSON.stringify({a:a.name,b:b.name,byManager:analytics.byManager}));
  const exportContacts=await asA('/api/export/contacts'),exportDeals=await asA('/api/export/deals');
  assert.equal(exportContacts.status,403,'менеджеру запрещена выгрузка контактов отдельным серверным правом');
  assert.equal(exportDeals.status,403,'менеджеру запрещена выгрузка сделок отдельным серверным правом');
  const adminExport=await call('/api/export/deals');
  assert.ok(adminExport.body.includes(`ScopeAlphaDeal${suffix}`)&&adminExport.body.includes(`ScopeBetaDeal${suffix}`),'администратор выгружает данные с полным обзором');
  const importPhone=`7901${suffix.slice(-7)}3`;
  const imported=await asA('/api/import/contacts',{method:'POST',body:JSON.stringify({csv:`Имя;Телефон;Почта;Компания\nИмпорт ${suffix};${importPhone};;`})});
  assert.equal(imported.status,200,'менеджер может импортировать клиентов');
  const importedRow=db.prepare('SELECT responsible_id FROM contacts WHERE phone_norm=?').get(importPhone);
  assert.equal(Number(importedRow?.responsible_id),Number(a.id),'импортированный контакт назначается импортировавшему менеджеру');
  assert.equal((await asA('/api/contacts')).body.some(c=>c.phone_norm===importPhone),true,'импорт сразу виден автору');
  h=admin;
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

test('экспорт и удаление общего справочника конкурентов требуют отдельного права администратора', async () => {
  const adminHeaders=h,suffix=String(Date.now());
  try {
    const first=await call('/api/competitors',{method:'POST',body:JSON.stringify({name:`Общий конкурент А ${suffix}`})});
    const second=await call('/api/competitors',{method:'POST',body:JSON.stringify({name:`Общий конкурент Б ${suffix}`})});
    assert.equal(first.status,201);assert.equal(second.status,201);
    const password=`Manager-Comp-${suffix}-Pwd!`,email=`manager-comp-${suffix}@example.com`;
    const created=await call('/api/users',{method:'POST',body:JSON.stringify({name:'Менеджер конкурентов',email,password,role:'manager'})});
    assert.equal(created.status,201);
    const login=await readyLogin('/api/auth/login',{method:'POST',body:JSON.stringify({email,password})});
    const managerHeaders={Authorization:'Bearer '+login.body.token};
    h=managerHeaders;
    assert.equal((await call('/api/competitors')).status,200,'менеджер может читать общий список конкурентов');
    assert.equal((await call('/api/competitors/'+first.body.id,{method:'DELETE'})).status,403,'менеджер не удаляет общую карточку по прямому запросу');
    assert.equal((await call('/api/competitors/bulk-delete',{method:'POST',body:JSON.stringify({ids:[first.body.id]})})).status,403,'пакетное удаление общего справочника — только администратору');
    assert.equal((await call('/api/prices/export?scope=ours')).status,403,'право читать прайс не даёт право выгружать его');
    assert.ok(db.prepare('SELECT id FROM competitors WHERE id=?').get(first.body.id),'отказ не удалил выбранную карточку');

    const viewerEmail=`viewer-comp-${suffix}@example.com`,viewerPassword=`Viewer-Comp-${suffix}-Pwd!`;
    const viewer=await call('/api/users',{method:'POST',headers:adminHeaders,body:JSON.stringify({name:'Наблюдатель конкурентов',email:viewerEmail,password:viewerPassword,role:'viewer'})});
    assert.equal(viewer.status,201);
    const viewerLogin=await readyLogin('/api/auth/login',{method:'POST',body:JSON.stringify({email:viewerEmail,password:viewerPassword})});
    h={Authorization:'Bearer '+viewerLogin.body.token};
    assert.equal((await call('/api/competitors')).status,200,'наблюдатель видит карточки для чтения');
    assert.equal((await call('/api/prices/export?scope=ours')).status,403,'наблюдатель не обходит отдельное право выгрузки');
    assert.equal((await call('/api/competitors/bulk-delete',{method:'POST',body:JSON.stringify({ids:[second.body.id]})})).status,403,'наблюдатель не удаляет карточки');

    h=adminHeaders;
    assert.equal((await call('/api/competitors/bulk-delete',{method:'POST',body:JSON.stringify({ids:{}})})).status,400,'не-массив ID отклонён без ошибки сервера');
    assert.equal((await call('/api/competitors/bulk-delete',{method:'POST',body:JSON.stringify({ids:[first.body.id,'bad']})})).status,400,'неверный ID отклоняет пачку целиком');
    assert.equal((await call('/api/competitors/bulk-delete',{method:'POST',body:JSON.stringify({ids:[999999999]})})).status,404,'устаревший выбор не даёт ложного результата');
    assert.ok(db.prepare('SELECT id FROM competitors WHERE id=?').get(first.body.id),'некорректная пачка не изменила базу');
    const exported=await call('/api/prices/export?scope=ours');
    assert.equal(exported.status,200,'администратор может выгрузить прайс');
    const removed=await call('/api/competitors/bulk-delete',{method:'POST',body:JSON.stringify({ids:[first.body.id,second.body.id,first.body.id]})});
    assert.equal(removed.status,200);assert.equal(removed.body.deleted,2,'повторяющиеся ID схлопнуты без двойного удаления');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM competitors WHERE id IN (?,?)').get(first.body.id,second.body.id).n,0,'обе карточки удалены атомарно');
    const audit=db.prepare("SELECT action FROM access_log WHERE user_id=? AND action IN ('export_prices','competitor_bulk_delete') ORDER BY id").all(db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get().id).map(x=>x.action);
    assert.ok(audit.includes('export_prices')&&audit.includes('competitor_bulk_delete'),'выгрузка и массовое удаление остаются в журнале доступа');
  } finally { h=adminHeaders; }
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
    // «Одновременно передавать и text, и contentUri нельзя» — поэтому подпись
    // уходит вторым сообщением, а не в том же запросе.
    assert.ok(!sentFile.text, 'в запросе с файлом нет текста: Wazzup такое не принимает');
    const caption = globalThis.__wzFiles.find(x => x.text === 'Смета во вложении');
    assert.ok(caption && !caption.contentUri, 'подпись к файлу отправлена отдельным сообщением');
    assert.notEqual(sentFile.crmMessageId, caption.crmMessageId, 'у каждого запроса свой crmMessageId');
    assert.equal(sentFile.crmUserId, caption.crmUserId, 'менеджер один и тот же в обоих сообщениях');
    assert.equal(sentFile.chatType, 'whatsapp', 'тип канала из интерфейса');
    assert.ok(/^\d+$/.test(sentFile.chatId), 'для WhatsApp адресат — только цифры телефона, как требует Wazzup');
    assert.equal(file.body.message.content_uri, 'https://disk.yandex.ru/i/smeta.pdf', 'ссылка на файл сохраняется в истории чата');
    await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'Ещё одно сообщение', chat_type: 'whatsapp' }) });
    const ids = globalThis.__wzFiles.map(x => x.crmMessageId);
    // вложение и подпись к нему — два запроса, плюс одно обычное сообщение
    assert.equal(ids.length, 3, 'в Wazzup ушли файл, подпись к нему и отдельное сообщение');
    assert.equal(new Set(ids).size, ids.length, 'у каждого запроса уникальный crmMessageId (Wazzup не склеит дубли)');
    assert.ok(globalThis.__wzFiles.every(x => !(x.text && x.contentUri)), 'ни один запрос не содержит text и contentUri одновременно');
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

test('смены и очередь: без смены лиды ждут, ночная очередь выдаётся по пять, повтор не создаёт дубль', async () => {
  const suffix=String(Date.now());
  const made=[];
  for(const [i,name] of ['Анна','Борис'].entries()){
    const email=`shift-${i}-${suffix}@example.com`,password=`Shift-manager-${i}-2026!`;
    const user=await call('/api/users',{method:'POST',body:JSON.stringify({name:`Менеджер ${name}`,email,password,role:'manager'})});
    assert.equal(user.status,201);
    const login=await readyLogin('/api/auth/login',{method:'POST',body:JSON.stringify({email,password})});
    made.push({id:user.body.id,headers:{Authorization:'Bearer '+login.body.token}});
  }
  const adminUser=db.prepare("SELECT id,name FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1").get();
  db.prepare(`UPDATE deals SET responsible_id=?,responsible=? WHERE id IN (SELECT deal_id FROM lead_routing WHERE queue_status='queued')`).run(adminUser.id,adminUser.name);
  await call('/api/settings',{method:'PUT',body:JSON.stringify({AUTO_ASSIGN:'1',AUTO_DEAL:'1',SHIFT_BACKLOG_LIMIT:5})});
  for(let i=0;i<12;i++)await call('/webhooks/generic',{method:'POST',body:JSON.stringify({channel:'site',phone:`79110008${String(i).padStart(4,'0')}`,name:`Очередь ${suffix}-${i}`,body:`Нужен расчёт ${i}`,external_id:`queue-${suffix}-${i}`})});
  let queued=(await call('/api/routing/queue')).body;
  assert.equal(queued.count,12,'без открытой смены все 12 обращений остаются в очереди');
  let deals=(await call('/api/deals')).body.deals.filter(d=>(d.contact_name||'').includes(`Очередь ${suffix}`));
  assert.equal(deals.length,12);assert.ok(deals.every(d=>!d.responsible_id),'автоматическое назначение вне смены не происходит');
  const [startA,startB]=await Promise.all([
    call('/api/shifts/start',{method:'POST',headers:made[0].headers,body:'{}'}),
    call('/api/shifts/start',{method:'POST',headers:made[1].headers,body:'{}'}),
  ]);
  assert.equal(startA.status,200);assert.equal(startB.status,200);
  assert.equal(startA.body.assigned.length,5,'первый менеджер получает не больше пяти лидов из очереди');
  assert.equal(startB.body.assigned.length,5,'вторая смена получает свои пять лидов');
  const repeatStart=await call('/api/shifts/start',{method:'POST',headers:made[0].headers,body:'{}'});
  assert.equal(repeatStart.body.alreadyActive,true,'повторное включение смены идемпотентно');
  assert.deepEqual(repeatStart.body.assigned,[],'повторное включение не выдаёт новую пачку');
  queued=(await call('/api/routing/queue')).body;
  assert.equal(queued.count,2,'после двух смен в очереди остаются ровно два лида');
  deals=(await call('/api/deals')).body.deals.filter(d=>(d.contact_name||'').includes(`Очередь ${suffix}`));
  assert.equal(deals.filter(d=>d.responsible_id===made[0].id).length,5);
  assert.equal(deals.filter(d=>d.responsible_id===made[1].id).length,5);
  const phone='79110008999';
  await call('/webhooks/generic',{method:'POST',body:JSON.stringify({channel:'site',phone,name:`Живой лид ${suffix}`,body:'Хочу обсудить проект',external_id:`live-${suffix}`})});
  await call('/webhooks/generic',{method:'POST',body:JSON.stringify({channel:'site',phone,name:`Живой лид ${suffix}`,body:'Хочу обсудить проект',external_id:`live-${suffix}`})});
  const live=(await call('/api/deals')).body.deals.filter(d=>(d.contact_name||'').includes(`Живой лид ${suffix}`));
  assert.equal(live.length,1,'повторная доставка не создаёт вторую сделку');
  assert.ok([made[0].id,made[1].id].includes(live[0].responsible_id),'новое обращение назначается только активной смене');
  const owner=live[0].responsible_id,assigned=deals.filter(d=>d.responsible_id===made[0].id).map(d=>d.id);
  db.prepare("UPDATE lead_routing SET first_response_at=datetime('now'),first_response_user_id=? WHERE deal_id=?").run(made[0].id,assigned[0]);
  const endedA=await call('/api/shifts/end',{method:'POST',headers:made[0].headers,body:JSON.stringify({reason:'Плановое завершение смены'})});
  assert.equal(endedA.status,200);
  assert.equal(endedA.body.retained.length,1,'сделка с начатой перепиской остаётся ответственному');
  assert.equal(endedA.body.returned.length,5+(owner===made[0].id?1:0)-1,'неотвеченные сделки атомарно вернулись в очередь');
  await call('/api/shifts/end',{method:'POST',headers:made[1].headers,body:JSON.stringify({reason:'Плановое завершение смены'})});
  await call('/webhooks/generic',{method:'POST',body:JSON.stringify({channel:'site',phone:'79110008998',name:`Без смены ${suffix}`,body:'Новый запрос'})});
  const withoutShift=(await call('/api/deals')).body.deals.find(d=>(d.contact_name||'').includes(`Без смены ${suffix}`));
  assert.equal(withoutShift.responsible_id,null,'после завершения всех смен распределения нет');
  await call('/api/settings',{method:'PUT',body:JSON.stringify({AUTO_ASSIGN:'0'})});
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
  assert.equal((await call('/api/bulk',{method:'POST',body:JSON.stringify({table:'contacts',ids,action:'upsert',patch:{tags:'не должно сохраниться'}})})).status,400,'неизвестное пакетное действие отклоняется явно');
  const all = (await call('/api/contacts')).body.filter(c => String(c.tags || '').includes('пачка'));
  assert.equal(all.length, 3, 'тег проставился всем выбранным');
  const bulkDash = (await call('/api/dashboard')).body;
  assert.match(bulkDash.activities[0].text, /Массовое изменение \(клиентов\): 3 записи — теги/, 'массовая операция читается по-русски: ' + bulkDash.activities[0].text);
  assert.equal((await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'contacts', ids: [], patch: { tags: 'x' } }) })).status, 400, 'пустой список — ошибка');
  assert.equal((await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'contacts', ids, patch: { role: 'admin' } }) })).status, 400, 'недопустимое поле отброшено');
  const linked = (await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Связанный для пачки' }) })).body;
  const linkedDeal = (await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка связанного', stage: 'new', contact_id: linked.id }) })).body;
  const linkedTask = (await call('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'Задача связанного', contact_id: linked.id }) })).body;
  // карточка со связями молча не удаляется: сервер перечисляет, что потеряется
  const asked = await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'contacts', ids: [linked.id], action: 'delete' }) });
  assert.equal(asked.status, 409, 'удаление карточки со связями требует подтверждения');
  assert.equal(asked.body.confirmDelete, true, 'интерфейс узнаёт, что нужен второй вопрос');
  assert.equal(asked.body.impact.deals, 1, 'сделка учтена в потерях');
  assert.equal(asked.body.impact.tasks, 1, 'задача учтена в потерях');
  assert.equal((await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'contacts', ids: [linked.id], action: 'delete', confirm: true }) })).status, 200,
    'после подтверждения пачка удалена');
  const linkedDash = (await call('/api/dashboard')).body;
  assert.match(linkedDash.activities[0].text, /сделок без клиента: 1/,
    'потери названы в журнале: ' + linkedDash.activities[0].text);
  assert.equal((await call('/api/tasks/' + linkedTask.id)).body.contact_id, null, 'задача осталась, но без ссылки на удалённый контакт');
  assert.equal((await call('/api/deals/' + linkedDeal.id)).body.deal.contact_id, null, 'сделка осталась, но без ссылки на удалённый контакт');
  const del = await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'contacts', ids, action: 'delete' }) });
  assert.equal(del.status, 200);
  assert.equal((await call('/api/contacts')).body.filter(c => ids.includes(c.id)).length, 0, 'записи удалены');
  const delDash = (await call('/api/dashboard')).body;
  assert.match(delDash.activities[0].text, /Массовое удаление \(клиентов\): 3 записи/, 'массовое удаление осталось в журнале: ' + delDash.activities[0].text);
  // пустые карточки подтверждения не требуют: лишний вопрос мешает работе
  assert.equal((await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'tasks', ids: [linkedTask.id], action: 'delete' }) })).status, 200,
    'задача без связей удаляется сразу');
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
  // дата закрытия обновляется при переходе между закрытыми этапами и хранится,
  // если этап не менялся: аналитика считает сделку там, где её реально закрыли
  db.prepare("UPDATE deals SET stage='won',closed_at='2020-01-01 10:00:00' WHERE id=?").run(ids[1]);
  await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'deals', ids: [ids[1]], action: 'update', patch: { stage: 'lost' } }) });
  const relisted = (await call('/api/deals/' + ids[1])).body.deal;
  assert.equal(relisted.stage, 'lost');
  assert.ok(relisted.closed_at > '2021-01-01', 'переход «Успешно → Отказ» обновляет дату закрытия, а не хранит старую');
  db.prepare("UPDATE deals SET closed_at='2020-05-05 10:00:00' WHERE id=?").run(ids[1]);
  await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'deals', ids: [ids[1]], action: 'update', patch: { amount: 777 } }) });
  assert.equal((await call('/api/deals/' + ids[1])).body.deal.closed_at, '2020-05-05 10:00:00', 'дата закрытия не уезжает при массовой правке суммы');
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

test('фото-логотип не отдаётся, а адрес загрузки закрыт', async () => {
  const r = await fetch(base + '/logo.png');
  await r.arrayBuffer();
  assert.ok(!(r.headers.get('content-type') || '').startsWith('image/'), 'по прежнему адресу нет картинки');
  const up = await call('/api/logo', { method: 'POST', body: '{}' });
  assert.equal(up.status, 404, 'маршрут загрузки фото-логотипа не существует');
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
  const beforeEdit = db.prepare('SELECT pass,session_version,must_change_password FROM users WHERE id=?').get(created.body.id);
  const edit = await call('/api/users/' + created.body.id, { method: 'PATCH', body: JSON.stringify({ role: 'viewer', active: 1 }) });
  assert.equal(edit.status, 200, 'обычная правка роли не требует передавать пароль');
  const afterEdit = db.prepare('SELECT pass,session_version,must_change_password FROM users WHERE id=?').get(created.body.id);
  assert.equal(afterEdit.pass, beforeEdit.pass, 'правка сотрудника не меняет его пароль');
  assert.equal(afterEdit.session_version, beforeEdit.session_version, 'правка сотрудника не отзывает парольную сессию');
  assert.equal(afterEdit.must_change_password, 1, 'временный пароль остаётся действующим до личной смены');
  const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify(account) });
  assert.equal(login.body.user.must_change_password, 1);
  const headers = { Authorization: 'Bearer ' + login.body.token };
  assert.equal((await call('/api/me', { headers })).body.user.must_change_password, 1);
  for (const path of ['/api/contacts', '/api/meta', '/api/events', '/api/templates']) {
    const denied = await call(path, { headers });
    assert.equal(denied.status, 403); assert.equal(denied.body.code, 'PASSWORD_CHANGE_REQUIRED');
  }
  const change = (old_password, new_password) => call('/api/me/password', { method: 'POST', headers, body: JSON.stringify({ old_password, new_password }) });
  const wrongTemp=await change('wrong','NewPersonalPass123');
  assert.equal(wrongTemp.status,400);
  assert.match(wrongTemp.body.error,/Временный пароль не совпал/i,'ошибка первого входа подсказывает проверить раскладку и пробелы');
  assert.equal((await change(account.password, 'short')).status, 400);
  assert.equal((await change(account.password, account.password)).status, 400);
  const changed = await change(account.password, 'NewPersonalPass123');
  assert.equal(changed.status, 200);
  const staleSession=await call('/api/me',{headers});
  assert.equal(staleSession.status,401,'старый токен отозван');
  assert.equal(staleSession.body.code,'SESSION_REVOKED','устаревшая сессия отличима от неверного пароля');
  assert.match(staleSession.body.error,/сменили или сбросили/i,'сообщение не утверждает, что пароль менял именно администратор');
  const freshHeaders = { Authorization: 'Bearer ' + changed.body.token };
  assert.equal((await call('/api/me', { headers: freshHeaders })).body.user.must_change_password, 0);
  assert.equal((await call('/api/contacts', { headers: freshHeaders })).status, 200);
  assert.equal((await call('/api/contacts', { method: 'POST', headers: freshHeaders, body: '{"name":"blocked"}' })).status, 403);
  const personalLogin=await call('/api/auth/login',{method:'POST',body:JSON.stringify({email:account.email,password:'NewPersonalPass123'})});
  assert.equal(personalLogin.status,200,'личный пароль сохранён и работает при следующем входе');
  assert.equal(personalLogin.body.user.must_change_password,0,'повторный вход не требует менять его ещё раз');
  assert.equal((await call('/api/auth/login',{method:'POST',body:JSON.stringify({email:account.email,password:account.password})})).status,401,'одноразовый пароль больше не действует');
  const employeeAudit=db.prepare("SELECT text,user_name FROM activities WHERE entity_type='users' AND entity_id=? ORDER BY id").all(created.body.id);
  assert.ok(employeeAudit.some(x=>x.text==='Временный пароль заменён личным'&&x.user_name===account.name),'в журнале видно, что личный пароль задал сотрудник');
  const reset = await call('/api/users/' + created.body.id, { method: 'PATCH', body: JSON.stringify({ password: 'AnotherTempPass123' }) });
  assert.equal(reset.status, 200);
  assert.equal((await call('/api/me', { headers: freshHeaders })).status, 401, 'админский сброс отзывает сессии');
  assert.equal((await call('/api/auth/login',{method:'POST',body:JSON.stringify({email:account.email,password:'NewPersonalPass123'})})).status,401,'сброс заменил прежний личный пароль');
  const second = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: account.email, password: 'AnotherTempPass123' }) });
  assert.equal(second.status,200);assert.equal(second.body.user.must_change_password, 1,'после админского сброса временный пароль снова требует замены');
  const secondChange = await call('/api/me/password', { method: 'POST', headers: { Authorization: 'Bearer ' + second.body.token }, body: JSON.stringify({ old_password: 'AnotherTempPass123', new_password: 'FinalPersonalPass123' }) });
  assert.equal(secondChange.status,200,'сброшенный пароль можно заменить личным тем же потоком первого входа');
  const finalLogin = await call('/api/auth/login',{method:'POST',body:JSON.stringify({email:account.email,password:'FinalPersonalPass123'})});
  assert.equal(finalLogin.status,200,'после замены временного пароля вход работает снова');
  assert.equal(finalLogin.body.user.must_change_password,0,'после повторного входа личный пароль не нужно менять ещё раз');
  assert.equal((await call('/api/auth/login',{method:'POST',body:JSON.stringify({email:account.email,password:'AnotherTempPass123'})})).status,401,'после смены сброшенный временный пароль больше не действует');
  const resetAudit=db.prepare("SELECT text,user_name FROM activities WHERE entity_type='users' AND entity_id=? ORDER BY id").all(created.body.id);
  assert.ok(resetAudit.some(x=>/сброшен пароль/.test(x.text)&&x.user_name==='Администратор'),'журнал отличает административный сброс от смены сотрудником');
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
  // Счётчик неудач общий на IP, а все сценарии идут с одного адреса: без сброса
  // следующие проверки входа упирались бы в блокировку и падали не по своей причине.
  clearLoginAttempts();
});

test('очередь отложенных действий видна, отменяется администратором и помечает удалённое правило', async () => {
  const rule = (await call('/api/automations', { method: 'POST', body: JSON.stringify({ name: 'Напомнить о предложении', trigger_type: 'stage_changed', trigger_value: 'offer', action_type: 'create_task', action_value: 'Перезвонить по предложению', active: 1, delay_days: 5 }) })).body;
  assert.ok(rule.id, 'правило с выдержкой создано: ' + JSON.stringify(rule));
  const contact = (await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Очередной Клиент', phone: '+7 900 777-66-55' }) })).body;
  const deal = (await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка в очереди', amount: 250000, stage: 'new', contact_id: contact.id }) })).body;
  assert.equal((await call(`/api/deals/${deal.id}`, { method: 'PATCH', body: JSON.stringify({ stage: 'offer' }) })).status, 200);

  const q = await call('/api/automation-queue');
  assert.equal(q.status, 200);
  const mine = q.body.filter(x => x.rule === 'Напомнить о предложении');
  assert.equal(mine.length, 1, 'действие стоит в очереди: ' + JSON.stringify(q.body).slice(0, 300));
  assert.equal(mine[0].deal_title, 'Сделка в очереди', 'в очереди видно сделку');
  assert.equal(mine[0].contact_name, 'Очередной Клиент', 'и клиента');
  assert.equal(mine[0].action_type, 'create_task', 'действие правило сохранилось');
  assert.match(mine[0].run_at_human, /^\d{2}\.\d{2}\.\d{4}$/, 'срок показан датой, а не строкой базы: ' + mine[0].run_at_human);
  assert.equal(mine[0].orphan, false, 'живое правило не помечается удалённым');

  const created = (await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Менеджер Очереди', email: 'queue-mgr@example.com', password: 'ochered12345', role: 'manager' }) }));
  assert.ok(created.status === 200 || created.status === 201, 'менеджер создан');
  const mgrLogin = await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'queue-mgr@example.com', password: 'ochered12345' }) });
  const mgrH = { Authorization: 'Bearer ' + mgrLogin.body.token };
  const managerQueue=await call('/api/automation-queue',{headers:mgrH});
  assert.equal(managerQueue.status,200,'очередь доступна менеджеру в ограниченном виде');
  assert.ok(!managerQueue.body.some(x=>Number(x.id)===Number(mine[0].id)),'чужое запланированное действие не раскрывает сделку и клиента');
  assert.equal((await call(`/api/automation-queue/${mine[0].id}`, { method: 'DELETE', headers: mgrH })).status, 403, 'отменяет только администратор');

  const cancel = await call(`/api/automation-queue/${mine[0].id}`, { method: 'DELETE' });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.cancelled, mine[0].id);
  assert.equal((await call('/api/automation-queue')).body.filter(x => x.rule === 'Напомнить о предложении').length, 0, 'после отмены действия в очереди нет');
  const again = await call(`/api/automation-queue/${mine[0].id}`, { method: 'DELETE' });
  assert.equal(again.status, 404, 'повторная отмена не проходит молча');
  assert.match(String(again.body.error), /уже выполнилось/, 'текст объясняет, почему действия нет: ' + again.body.error);

  // правило удалили, а действие осталось в очереди: в интерфейсе это должно быть
  // видно, иначе сотрудник ждал бы отправки, которой не существует
  const gone = (await call('/api/automations', { method: 'POST', body: JSON.stringify({ name: 'Временное правило', trigger_type: 'stage_changed', trigger_value: 'negotiation', action_type: 'add_tag', action_value: 'Отложенный', active: 1, delay_days: 2 }) })).body;
  await call(`/api/deals/${deal.id}`, { method: 'PATCH', body: JSON.stringify({ stage: 'negotiation' }) });
  assert.equal((await call('/api/automation-queue')).body.filter(x => x.rule === 'Временное правило').length, 1, 'второе действие в очереди');
  assert.equal((await call('/api/automations/' + gone.id, { method: 'DELETE' })).status, 200, 'правило удалено');
  const orphan = (await call('/api/automation-queue')).body.filter(x => x.rule === 'Правило удалено');
  assert.equal(orphan.length, 1, 'осиротевшее действие помечено, а не пропало без следа');
  assert.equal(orphan[0].orphan, true);
  assert.equal((await call(`/api/automation-queue/${orphan[0].id}`, { method: 'DELETE' })).status, 200, 'его тоже можно отменить');
});

test('вебхук Wazzup: проверка адреса, счётчик входящих, защита секретом', async () => {
  assert.equal((await call('/api/settings', { method: 'PUT', body: JSON.stringify({ WAZZUP_WEBHOOK_SECRET: 'hook-secret-1' }) })).status, 200);
  const hook = (body, secret) => fetch(base + '/webhooks/wazzup' + (secret ? '?secret=' + secret : ''), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.status);
  const msg = id => ({ messages: [{ messageId: id, channelId: 'ch-hook', chatType: 'whatsapp', chatId: '79000000001', type: 'text', text: 'Здравствуйте, это проверка', contact: { name: 'Счётчик Вебхука', phone: '+7 900 000-00-71' } }] });
  assert.equal(await hook({ test: true }, 'hook-secret-1'), 200, 'проверочный запрос Wazzup проходит');
  let st = (await call('/api/settings')).body;
  assert.ok(st.wazzup.hook_test_at && st.wazzup.hook_test_human, 'отметка проверки видна в настройках: ' + JSON.stringify(st.wazzup).slice(0, 220));
  const before = (await call('/api/settings')).body.wazzup.hook_msgs;
  assert.equal(await hook(msg('wz-hook-1'), 'неверный'), 403, 'без секрета сообщения не принимаются');
  st = (await call('/api/settings')).body;
  assert.equal(st.wazzup.hook_msgs, before, 'отклонённое сообщение не попадает в счётчик');
  assert.equal(await hook(msg('wz-hook-2'), 'hook-secret-1'), 200, 'входящее сообщение принято');
  st = (await call('/api/settings')).body;
  assert.equal(st.wazzup.hook_msgs, before + 1, 'входящие считаются');
  assert.match(st.wazzup.hook_last_human, /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/, 'дата последнего входящего по-человечески: ' + st.wazzup.hook_last_human);
  const dash = (await call('/api/dashboard')).body;
  assert.ok(!dash.activities.some(a => /Wazzup: получено сообщений/.test(a.text)), 'приём сообщений не засоряет ленту событий компании: он виден по счётчику в настройках');
});

test('Wazzup: входящие дублируются на второй адрес, петля запрещена', async () => {
  const { createServer } = await import('node:http');
  const got = [];
  const mock = createServer((req, res) => { let d = ''; req.on('data', c => { d += c; }); req.on('end', () => { got.push(d); res.writeHead(200); res.end('ok'); }); });
  await new Promise(r => mock.listen(18123, '127.0.0.1', r));
  const fwd = 'http://127.0.0.1:18123/webhooks/wazzup';
  assert.equal((await call('/api/settings', { method: 'PUT', body: JSON.stringify({ WAZZUP_FORWARD_URL: fwd }) })).status, 200, 'адрес дублирования сохраняется');
  assert.equal((await call('/api/settings')).body.wazzup.forward_url, fwd, 'адрес виден в карточке интеграций');

  // пересылка на саму себя превратила бы вебхук в вечный цикл
  const loop = await call('/api/settings', { method: 'PUT', body: JSON.stringify({ WAZZUP_FORWARD_URL: base + '/webhooks/wazzup' }) });
  assert.equal(loop.status, 400, 'адрес самой CRM не принимается');
  assert.match(String(loop.body.error), /петл/i, 'текст объясняет причину: ' + loop.body.error);

  const payload = { messages: [{ messageId: 'wz-fwd-1', channelId: 'ch-hook', chatType: 'whatsapp', chatId: '79000000002', type: 'text', text: 'Проверка дублирования' }] };
  const body = JSON.stringify(payload);
  const r = await fetch(base + '/webhooks/wazzup?secret=hook-secret-1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  assert.equal(r.status, 200, 'пачка принята');
  for (let i = 0; i < 50 && !got.length; i++) await new Promise(rs => setTimeout(rs, 100));
  assert.equal(got.length, 1, 'пачка переслана ровно один раз');
  assert.equal(got[0], body, 'второй адрес получил ту же пачку байт в байт');

  await fetch(base + '/webhooks/wazzup?secret=hook-secret-1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: true }) });
  await new Promise(rs => setTimeout(rs, 400));
  assert.equal(got.length, 1, 'проверочный запрос Wazzup не дублируется');

  const bad = await call('/api/settings', { method: 'PUT', body: JSON.stringify({ WAZZUP_FORWARD_URL: 'ftp://second-crm/hook' }) });
  assert.equal(bad.status, 400, 'адрес не-http не принимается');
  assert.equal((await call('/api/settings', { method: 'PUT', body: JSON.stringify({ WAZZUP_FORWARD_URL: '' }) })).status, 200);
  assert.equal((await call('/api/settings')).body.wazzup.forward_url, '', 'поле очищается');
  mock.close();
});

test('большие ответы API приходят сжатыми', async () => {
  const { gunzipSync } = await import('node:zlib');
  const { get } = await import('node:http');
  for (let i = 0; i < 40; i++) await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Компрессия ' + i, phone: '+791100' + String(i).padStart(4, '0') }) });
  // сырой http-запрос: fetch в Node распаковывает тело сам, и по нему не проверить байты
  const raw = await new Promise((resolve, reject) => {
    get(base + '/api/contacts', { headers: { ...h, 'Accept-Encoding': 'gzip' } }, r => {
      const chunks = []; r.on('data', c => chunks.push(c)); r.on('end', () => resolve({ headers: r.headers, buf: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  assert.equal(raw.headers['content-encoding'], 'gzip', 'сжатие объявлено в заголовке');
  assert.equal(raw.headers['vary'], 'Accept-Encoding', 'кэши учитывают заголовок');
  assert.equal(raw.buf[0], 0x1f); assert.equal(raw.buf[1], 0x8b);
  const parsed = JSON.parse(gunzipSync(raw.buf).toString('utf8'));
  assert.ok(Array.isArray(parsed) && parsed.length >= 40, 'после распаковки данные целы');
  const plain = await new Promise((resolve, reject) => {
    get(base + '/api/contacts', { headers: h }, r => {
      const chunks = []; r.on('data', c => chunks.push(c)); r.on('end', () => resolve({ headers: r.headers, buf: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  assert.notEqual(plain.headers['content-encoding'], 'gzip', 'без запроса сжатия ответ обычный');
  assert.ok(JSON.parse(plain.buf.toString('utf8')).length >= 40, 'обычный ответ тоже цел');
  // браузерный fetch видит обычный JSON — сервер распаковывает не на клиенте
  const viaFetch = await fetch(base + '/api/contacts', { headers: { ...h, 'Accept-Encoding': 'gzip' } });
  assert.ok((await viaFetch.json()).length >= 40, 'fetch-клиент получает распакованные данные');
});

test('входящее вложение подписано именем файла, повтор вебхука не дублирует чат', async () => {
  const hook = body => fetch(base + '/webhooks/wazzup?secret=hook-secret-1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.status);
  const att = { messages: [{ messageId: 'wz-att-1', channelId: 'ch-att', chatType: 'whatsapp', chatId: '79000000003', type: 'text', attachment: { url: 'https://cdn.example/files/otchet%20pdf.pdf' } }] };
  assert.equal(await hook(att), 200, 'входящее с вложением принято');
  const convs = (await call('/api/conversations')).body;
  const conv = convs.find(c => c.external_chat_id === '79000000003');
  assert.ok(conv, 'беседа создана по входящему');
  const msgs = (await call(`/api/conversations/${conv.id}/messages`)).body;
  const m = msgs[msgs.length - 1];
  assert.equal(m.body, 'Вложение: otchet pdf.pdf', 'в истории имя файла, а не техническая метка: ' + m.body);
  assert.equal(m.content_name, 'otchet pdf.pdf', 'имя файла сохранено и попадёт в чип');
  assert.equal(m.channel_id, 'ch-att', 'сообщение помнит аккаунт Wazzup, через который пришло');
  const unreadBefore = conv.unread;
  assert.equal(await hook(att), 200, 'повторная доставка принята без ошибки');
  const msgs2 = (await call(`/api/conversations/${conv.id}/messages`)).body;
  assert.equal(msgs2.length, msgs.length, 'то же messageId не создаёт второе сообщение');
  const conv2 = (await call('/api/conversations')).body.find(c => c.id === conv.id);
  assert.equal(conv2.unread, 0, 'счётчик непрочитанных после прочтения не растёт от повтора');
  assert.ok(unreadBefore >= 0);
});

test('лента рабочего стола не тонет в чатах, история обращения сохраняется', async () => {
  const hook = body => fetch(base + '/webhooks/wazzup?secret=hook-secret-1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.status);
  const chatId = '79000000099';
  assert.equal(await hook({ messages: [{ messageId: 'feed-noise-1', channelId: 'ch-feed', chatType: 'whatsapp', chatId, type: 'text', text: 'Здравствуйте, хочу баню', direction: 'inbound', contact: { name: 'Лента Тест', phone: chatId }, timestamp: Date.now() }] }), 200, 'входящее обращение принято');
  const dash = (await call('/api/dashboard')).body;
  const texts = dash.activities.map(a => a.text).join(' | ');
  assert.ok(!/Новое обращение|пришло на аккаунт|назначено на|Новый контакт \(/.test(texts), 'поток чатов не заполняет ленту рабочего стола: ' + texts.slice(0, 240));
  const deals = (await call('/api/deals')).body.deals;
  const deal = deals.find(d => /Лента Тест/.test(d.title || ''));
  assert.ok(deal, 'сделка обращения создана и видна на доске');
  const card = (await call(`/api/deals/${deal.id}`)).body;
  assert.ok((card.history || []).some(h => /Новое обращение/.test(h.text)), 'в истории карточки событие обращения осталось');
  // ручное создание видно в ленте человеческим текстом, а не «Создано (table #1)»
  const created = await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Ленточный Клиент' }) });
  assert.equal(created.status, 201, 'клиент создан');
  const dash2 = (await call('/api/dashboard')).body;
  assert.match(dash2.activities[0].text, /Клиент «Ленточный Клиент» добавлен/, 'создание записи читается по-человечески: ' + dash2.activities[0].text);
  // файл в чате не оставляет строки в ленте: след живёт в самом сообщении
  const convForFile = (await call('/api/conversations')).body.find(c => c.contact_id) || (await call('/api/conversations')).body[0];
  const up = await call(`/api/conversations/${convForFile.id}/upload`, { method: 'POST', body: JSON.stringify({ filename: 'фото-дома.png', contentType: 'image/png', dataBase64: Buffer.from('fake-png-bytes').toString('base64') }) });
  assert.equal(up.status, 201, 'файл загружен');
  assert.equal(up.body.name, 'фото-дома.png', 'имя файла с кириллицей сохранено');
  const dash3 = (await call('/api/dashboard')).body;
  assert.ok(!dash3.activities.some(a => /[Фф]айл загружен|загружен в переписку/.test(a.text)), 'загрузка файла в чат не попала в ленту компании');
});

test('удаление и передача карточки видны в журнале, план компании не уходит в общем ответе', async () => {
  // /api/meta читает каждая роль, включая партнёра: внутренних планов компании
  // в этом ответе быть не должно, а правило распределения интерфейсу нужно
  const meta = (await call('/api/meta')).body;
  assert.ok(!('salesTarget' in meta), 'план продаж не отдаётся в общем ответе');
  assert.ok(!('autoDeal' in meta), 'признак автоматической сделки не отдаётся в общем ответе');
  assert.equal(typeof meta.autoAssign, 'boolean', 'правило распределения обращений осталось');

  const me = (await call('/api/me')).body.user;
  const c = await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Журнальный Клиент' }) });
  assert.equal(c.status, 201, 'клиент для проверки создан');
  const t = await call('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'Журнальная Задача' }) });
  assert.equal(t.status, 201, 'задача для проверки создана');

  // передача карточки другому сотруднику: уведомление уходит новому исполнителю,
  // а след остаётся в ленте — иначе не разобрать, кто и когда переложил клиента
  const re = await call('/api/contacts/' + c.body.id, { method: 'PATCH', body: JSON.stringify({ responsible_id: me.id }) });
  assert.equal(re.status, 200, 'ответственный назначен');
  const dashRe = (await call('/api/dashboard')).body;
  assert.match(dashRe.activities[0].text, /Клиент «Журнальный Клиент»: ответственный не назначен → /,
    'передача клиента записана в журнал: ' + dashRe.activities[0].text);

  const reTask = await call('/api/tasks/' + t.body.id, { method: 'PATCH', body: JSON.stringify({ responsible_id: me.id }) });
  assert.equal(reTask.status, 200, 'задача назначена');
  const dashTask = (await call('/api/dashboard')).body;
  assert.match(dashTask.activities[0].text, /Задача «Журнальная Задача»: ответственный не назначен → /,
    'передача задачи записана в журнал: ' + dashTask.activities[0].text);

  // снятие ответственного — тоже изменение, которое должно остаться в ленте
  await call('/api/contacts/' + c.body.id, { method: 'PATCH', body: JSON.stringify({ responsible_id: '' }) });
  const dashOff = (await call('/api/dashboard')).body;
  assert.match(dashOff.activities[0].text, /ответственный .* → не назначен/,
    'снятие ответственного записано: ' + dashOff.activities[0].text);

  // удаление необратимо: без записи в журнале пропажу карточки не объяснить
  const dealOf = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка журнального клиента', contact_id: c.body.id }) });
  assert.equal(dealOf.status, 201, 'сделка привязана к клиенту');
  const guarded = await call('/api/contacts/' + c.body.id, { method: 'DELETE' });
  assert.equal(guarded.status, 409, 'клиент со сделкой без подтверждения не удаляется');
  assert.equal(guarded.body.impact.deals, 1, 'сервер назвал, сколько сделок останется без клиента');
  assert.equal((await call('/api/contacts/' + c.body.id)).status, 200, 'карточка на месте, пока нет подтверждения');
  assert.equal((await call('/api/contacts/' + c.body.id + '?confirm=1', { method: 'DELETE' })).status, 200, 'после подтверждения клиент удалён');
  const dashDel = (await call('/api/dashboard')).body;
  assert.match(dashDel.activities[0].text, /Клиент удалён: «Журнальный Клиент»/,
    'удаление клиента записано в журнал: ' + dashDel.activities[0].text);

  assert.equal((await call('/api/tasks/' + t.body.id, { method: 'DELETE' })).status, 200, 'задача удалена');
  const dashDel2 = (await call('/api/dashboard')).body;
  assert.match(dashDel2.activities[0].text, /Задача удалена: «Журнальная Задача»/,
    'удаление задачи записано в журнал: ' + dashDel2.activities[0].text);

  const co = await call('/api/companies', { method: 'POST', body: JSON.stringify({ name: 'Журнальная Компания' }) });
  assert.equal((await call('/api/companies/' + co.body.id, { method: 'DELETE' })).status, 200, 'компания удалена');
  const dashDel3 = (await call('/api/dashboard')).body;
  assert.match(dashDel3.activities[0].text, /Компания удалена: «Журнальная Компания»/,
    'удаление компании записано в журнал: ' + dashDel3.activities[0].text);
});

test('файл в сообщении хранит имя, тип и размер, превью списка читается', async () => {
  const conv = (await call('/api/conversations')).body[0];
  assert.ok(conv, 'есть чат для проверки');
  const sent = await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: JSON.stringify({ body: '', contentUri: '/uploads/20260101-abcdef-test.pdf', contentName: 'смета.pdf', contentType: 'application/pdf', contentSize: 2516582 }) });
  assert.equal(sent.status, 201, 'сообщение с файлом сохранено');
  const m = sent.body.message;
  assert.equal(m.content_name, 'смета.pdf', 'имя файла с кириллицей сохранено как есть');
  assert.equal(m.content_type, 'application/pdf', 'тип файла сохранён');
  assert.equal(m.content_size, 2516582, 'размер сохранён — чип покажет «2,4 МБ»');
  const list = (await call('/api/conversations')).body.find(c => c.id === conv.id);
  assert.match(String(list.last_body), /^Файл: смета\.pdf/, 'в списке чатов вместо пустоты видно имя файла: ' + list.last_body);
});

test('повторная загрузка вложения проверяет ID и не скачивает локальный файл заново', async () => {
  const conv = (await call('/api/conversations')).body[0];
  assert.ok(conv, 'есть чат для проверки');
  const local = db.prepare("INSERT INTO messages(conversation_id,channel,direction,body,content_uri,content_name,content_type) VALUES(?,'whatsapp','in','[вложение]','/uploads/20260101-abcdef-test.png','фото.png','image/png')").run(conv.id);
  const already = await call(`/api/messages/${local.lastInsertRowid}/refetch`, { method: 'POST' });
  assert.equal(already.status, 400, 'локально сохранённый файл повторно не скачивается');
  assert.match(already.body.error, /уже сохранён/);
  const missing = await call('/api/messages/999999/refetch', { method: 'POST' });
  assert.equal(missing.status, 404, 'несуществующее сообщение не создаёт файл');
  const remote = db.prepare("INSERT INTO messages(conversation_id,channel,direction,body,content_uri) VALUES(?,'whatsapp','in','[вложение]',?)").run(conv.id, `${base}/api/health`);
  const blocked = await call(`/api/messages/${remote.lastInsertRowid}/refetch`, { method: 'POST' });
  assert.equal(blocked.status, 502, 'повторное скачивание не обращается к локальным адресам сервера');
  db.prepare('UPDATE messages SET content_uri=? WHERE id=?').run('http://198.18.0.1/file.pdf', remote.lastInsertRowid);
  const reserved = await call(`/api/messages/${remote.lastInsertRowid}/refetch`, { method: 'POST' });
  assert.equal(reserved.status, 502, 'специальная тестовая сеть также не считается публичным адресом');
});

test('голосовые и видео можно прикрепить, проиграть и перематывать внутри CRM', async () => {
  const conv = (await call('/api/conversations')).body[0];
  assert.ok(conv, 'есть чат для отправки файла');
  for (const [filename, contentType, bytes] of [
    ['звонок.html', 'audio/mpeg', 'audio-bytes-1234'],
    ['обзор.mp4', 'video/mp4', 'video-bytes-5678'],
  ]) {
    const up = await call(`/api/conversations/${conv.id}/upload`, { method: 'POST', body: JSON.stringify({ filename, contentType, dataBase64: Buffer.from(bytes).toString('base64') }) });
    assert.equal(up.status, 201, `${filename} принят сервером`);
    if (filename.endsWith('.html')) assert.match(up.body.url, /\.mp3$/, 'расширение на диске соответствует проверенному типу аудио, а не имени пользователя');
    const full = await fetch(base + up.body.url, { headers: h });
    assert.equal(full.headers.get('content-type'), contentType, 'браузер получает корректный тип медиа');
    assert.match(full.headers.get('content-disposition') || '', /inline/, 'файл не уходит принудительной загрузкой');
    const range = await fetch(base + up.body.url, { headers: { ...h, Range: 'bytes=1-4' } });
    assert.equal(range.status, 206, 'плеер может запросить диапазон байтов для перемотки');
    assert.equal(range.headers.get('content-range'), `bytes 1-4/${Buffer.from(bytes).length}`);
  }
});

test('непрочитанные личные: чтение одного сотрудника не стирает метку другого', async () => {
  // отдельный сотрудник: у созданных ранее в сюите пароли уже менялись принудительно
  const created=await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Чтец Меток', email: 'readmark@example.com', password: 'readmark12345', role: 'manager' }) });
  const mgrLogin = await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'readmark@example.com', password: 'readmark12345' }) });
  const mh = { Authorization: 'Bearer ' + mgrLogin.body.token };
  const hook = body => fetch(base + '/webhooks/wazzup?secret=hook-secret-1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.status);
  // базовые значения: в сюите уже были входящие, поэтому считаем дельты
  const d0a = (await call('/api/dashboard')).body.unread;
  const d0m = (await call('/api/dashboard', { headers: mh })).body.unread;
  assert.equal(await hook({ messages: [{ messageId: 'wz-read-1', channelId: 'ch-r', chatType: 'whatsapp', chatId: '79000000004', type: 'text', text: 'Проверка личных счётчиков' }] }), 200);
  assert.equal((await call('/api/dashboard')).body.unread, d0a + 1, 'входящее добавило единицу администратору');
  assert.equal((await call('/api/dashboard', { headers: mh })).body.unread, d0m, 'неразобранная карточка не попадает в контур менеджера');
  const find = (list) => list.find(c => c.external_chat_id === '79000000004');
  const adminConvs = (await call('/api/conversations')).body;
  const unassignedConv=find(adminConvs);
  assert.ok(unassignedConv,'администратор видит новое неразобранное обращение');
  assert.equal(find((await call('/api/conversations', { headers: mh })).body),undefined,'менеджер не получает чужой или неназначенный чат');
  assert.equal((await call('/api/contacts/'+unassignedConv.contact_id,{method:'PATCH',body:JSON.stringify({responsible_id:created.body.id})})).status,200,'администратор назначил контакт менеджеру');
  assert.equal((await call('/api/dashboard', { headers: mh })).body.unread,d0m+1,'после назначения менеджер видит своё непрочитанное обращение');
  const mgrConvs=(await call('/api/conversations',{headers:mh})).body;
  assert.equal(find(mgrConvs).unread,1,'менеджер видит своё входящее непрочитанным');
  assert.equal(find(adminConvs).unread,1,'админ видит входящее непрочитанным');
  const id = unassignedConv.id;
  await call(`/api/conversations/${id}/messages`);
  assert.equal(find((await call('/api/conversations')).body).unread,0,'админ прочитал — у него ноль');
  assert.equal(find((await call('/api/conversations', { headers: mh })).body).unread,1,'у менеджера метка осталась: чужое чтение не стирает');
  assert.equal((await call('/api/dashboard')).body.unread,d0a,'счётчик админа вернулся к базовому: чтение личное');
  assert.equal((await call('/api/dashboard', { headers: mh })).body.unread,d0m+1,'у менеджера единица держится, пока он сам не откроет чат');
  await fetch(base + `/api/conversations/${id}/messages`, { headers: mh });
  assert.equal(find((await call('/api/conversations', { headers: mh })).body).unread,0,'менеджер прочитал — у него ноль');
  assert.equal((await call('/api/dashboard', { headers: mh })).body.unread,d0m,'счётчик менеджера тоже вернулся к базовому');
});

test('счётчик непрочитанных чатов личный: неразобранное обращение недоступно менеджеру', async () => {
  // отдельный менеджер: у прежней учётки сюита пароль уже менялся принудительно
  await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Счётчик Чатов', email: 'unreadmine@example.com', password: 'unreadmine12345', role: 'manager' }) });
  const mgrLogin = await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'unreadmine@example.com', password: 'unreadmine12345' }) });
  const mh = { Authorization: 'Bearer ' + mgrLogin.body.token };
  const hook = body => fetch(base + '/webhooks/wazzup?secret=hook-secret-1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.status);
  const meAdmin = (await call('/api/me')).body.user;
  const m0a = (await call('/api/dashboard')).body.unreadMine;
  const m0m = (await call('/api/dashboard', { headers: mh })).body.unreadMine;
  const d0m = (await call('/api/dashboard', { headers: mh })).body.unread;
  // новый клиент написал впервые: до назначения переписка доступна администратору
  assert.equal(await hook({ messages: [{ messageId: 'wz-unread-mine-1', channelId: 'ch-um', chatType: 'whatsapp', chatId: '79000000006', type: 'text', text: 'Неразобранное обращение', status: 'inbound', contact: { name: 'Ничей Клиент', phone: '79000000006' } }] }), 200);
  assert.equal((await call('/api/dashboard')).body.unreadMine, m0a + 1, 'админу неразобранное обращение попало в личный счётчик');
  assert.equal((await call('/api/dashboard', { headers: mh })).body.unreadMine, m0m, 'неразобранная карточка не раскрывается менеджеру');
  assert.equal((await call('/api/dashboard', { headers: mh })).body.unread, d0m, 'чужой чат не увеличивает счётчик менеджера');
  const conv = (await call('/api/conversations')).body.find(c => c.external_chat_id === '79000000006');
  assert.ok(conv, 'администратор видит неразобранную беседу');
  assert.equal((await call('/api/conversations',{headers:mh})).body.some(c=>c.id===conv.id),false,'неназначенная беседа отсутствует в списке менеджера');
  assert.equal((await call(`/api/conversations/${conv.id}/messages`,{headers:mh})).status,403,'история неназначенной беседы закрыта напрямую');
  // клиента забрал администратор: у менеджера он не появляется ни в списке, ни в счётчике
  const r = await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'contacts', action: 'update', ids: [conv.contact_id], patch: { responsible_id: meAdmin.id } }) });
  assert.equal(r.body.count, 1, 'клиент закреплён за администратором');
  assert.equal((await call('/api/dashboard')).body.unreadMine,m0a+1,'у администратора чат остался непрочитанным');
  assert.equal((await call('/api/dashboard',{headers:mh})).body.unreadMine,m0m,'менеджеру не раскрывается лид администратора');
  assert.equal((await call('/api/dashboard',{headers:mh})).body.unread,d0m,'счётчик менеджера остаётся без чужой беседы');
});

test('исходящие из другой CRM видны в чате, эхо своих не дублируется, отметка «прочитано» пачкой', async () => {
  const hook = body => fetch(base + '/webhooks/wazzup?secret=hook-secret-1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.status);
  // беседа создаётся обычным входящим
  assert.equal(await hook({ messages: [{ messageId: 'wz-oc-1', channelId: 'ch-oc', chatType: 'whatsapp', chatId: '79000000005', type: 'text', text: 'Вопрос клиента из другой CRM' }] }), 200);
  const conv = (await call('/api/conversations')).body.find(c => c.external_chat_id === '79000000005');
  assert.ok(conv, 'беседа создана по входящему');
  // ответ коллеги из amoCRM или мобильного приложения: направление исходящее, id не наш
  assert.equal(await hook({ data: [{ messageId: 'amo-out-9', direction: 'outbound', chatType: 'whatsapp', chatId: '79000000005', text: 'Ответ из другой CRM', status: 'created', sender: { name: 'Коллега' } }] }), 200);
  let msgs = (await call(`/api/conversations/${conv.id}/messages`)).body;
  const out = msgs.find(m => m.body === 'Ответ из другой CRM');
  assert.ok(out, 'исходящее из другой CRM сохранено в истории');
  assert.equal(out.direction, 'out', 'сообщение видно именно как исходящее');
  assert.equal(out.status, 'sent', 'служебный статус вендора приведён к понятному');
  // своя отправка возвращается эхом — второй раз в историю не попадает
  assert.equal(await hook({ data: [{ messageId: 'karkas-echo-1', direction: 'outbound', chatType: 'whatsapp', chatId: '79000000005', text: 'Эхо своей отправки' }] }), 200);
  msgs = (await call(`/api/conversations/${conv.id}/messages`)).body;
  assert.ok(!msgs.some(m => m.body === 'Эхо своей отправки'), 'эхо собственной отправки не дублируется');
  // отметка «прочитано» сразу для нескольких бесед
  const d0 = (await call('/api/dashboard')).body.unread;
  assert.equal(await hook({ messages: [{ messageId: 'wz-oc-2', channelId: 'ch-oc', chatType: 'whatsapp', chatId: '79000000005', type: 'text', text: 'Ещё вопрос' }] }), 200);
  assert.equal((await call('/api/dashboard')).body.unread, d0 + 1, 'входящее добавило единицу непрочитанных');
  const r = await call('/api/conversations/read', { method: 'POST', body: JSON.stringify({ ids: [conv.id, 999999] }) });
  assert.equal(r.body.marked, 1, 'отмечена только существующая беседа');
  assert.equal((await call('/api/dashboard')).body.unread, d0, 'пачка отметок вернула счётчик к базовому');
  // внешняя ссылка на вложение сохраняется, даже если файл скачать не удалось
  assert.equal(await hook({ messages: [{ messageId: 'wz-oc-3', channelId: 'ch-oc', chatType: 'whatsapp', chatId: '79000000005', type: 'text', attachment: { url: 'https://cdn.invalid-host.example/photo.png' } }] }), 200);
  msgs = (await call(`/api/conversations/${conv.id}/messages`)).body;
  assert.ok(msgs.some(m => (m.content_uri || '').includes('cdn.invalid-host.example')), 'вложение сохранено со ссылкой вендора как запасной вариант');
});

test('интеграции только для админа, вебхук с секретом, вложения не качаются с внутренних адресов', async () => {
  await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Интегратор', email: 'integrator@example.com', password: 'integrator12345', role: 'manager' }) });
  const mLogin = await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'integrator@example.com', password: 'integrator12345' }) });
  const mh = { Authorization: 'Bearer ' + mLogin.body.token };
  // сотрудник не может перенаправить приём входящих или дёргать внешние API
  const reg = await call('/api/integrations/wazzup/webhook', { method: 'POST', headers: mh, body: JSON.stringify({ url: 'https://crm.example/webhooks/wazzup' }) });
  assert.equal(reg.status, 403, 'регистрация вебхука доступна только администратору');
  assert.equal((await call('/api/integrations/wazzup/sync', { method: 'POST', headers: mh })).status, 403, 'синхронизация каналов — только админ');
  assert.equal((await call('/api/integrations/wazzup/test', { method: 'POST', headers: mh })).status, 403, 'проверка Wazzup — только админ');
  assert.equal((await call('/api/integrations/email/test', { method: 'POST', headers: mh, body: JSON.stringify({ to: 'x@example.com' }) })).status, 403, 'проверка почты — только админ');
  // адрес вебхука регистрируется только с секретом: без кода защиты входящие мог бы слать кто угодно
  const noSecret = await fetch(base + '/webhooks/wazzup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ messageId: 'evil-1', chatType: 'whatsapp', chatId: '79000000009', type: 'text', text: 'Подделка без секрета' }] }) });
  assert.equal(noSecret.status, 403, 'вебхук без секрета не принимает сообщения');
  const evilConvs = (await call('/api/conversations')).body;
  assert.ok(!evilConvs.some(c => c.external_chat_id === '79000000009'), 'поддельное сообщение не создало беседу');
  // SSRF: ссылка на внутренний адрес в вебхуке не скачивается и не подменяется локальным файлом
  const hook = body => fetch(base + '/webhooks/wazzup?secret=hook-secret-1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.status);
  assert.equal(await hook({ messages: [{ messageId: 'wz-ssrf-1', channelId: 'ch-s', chatType: 'whatsapp', chatId: '79000000006', type: 'text', attachment: { url: base + '/api/health' } }] }), 200);
  await new Promise(r => setTimeout(r, 500));
  const conv = (await call('/api/conversations')).body.find(c => c.external_chat_id === '79000000006');
  assert.ok(conv, 'беседа с вложением создана');
  const msgs = (await call(`/api/conversations/${conv.id}/messages`)).body;
  const m = msgs.find(x => x.external_id === 'wz-ssrf-1');
  assert.ok(m, 'сообщение сохранено');
  assert.equal(m.content_uri, base + '/api/health', 'внутренний адрес не скачан: ссылка осталась как есть, локальный файл не создан');
});

test('ответ менеджера через вторую CRM с флагом isEcho виден в истории', async () => {
  const hook = body => fetch(base + '/webhooks/wazzup?secret=hook-secret-1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.status);
  assert.equal(await hook({ messages: [{ messageId: 'wz-am-1', channelId: 'ch-am', chatType: 'whatsapp', chatId: '79000000007', type: 'text', text: 'Вопрос клиента при параллельной работе' }] }), 200);
  const conv = (await call('/api/conversations')).body.find(c => c.external_chat_id === '79000000007');
  assert.ok(conv, 'беседа создана');
  // менеджер ответил через amoCRM: для общей интеграции Wazzup такое сообщение
  // приходит с isEcho — оно обязано остаться в истории исходящим
  assert.equal(await hook({ data: [{ messageId: 'amo-echo-77', direction: 'outbound', isEcho: true, chatType: 'whatsapp', chatId: '79000000007', text: 'Ответ менеджера из второй CRM', status: 'delivered', sender: { name: 'Коллега из Амо' } }] }), 200);
  let msgs = (await call(`/api/conversations/${conv.id}/messages`)).body;
  const out = msgs.find(m => m.body === 'Ответ менеджера из второй CRM');
  assert.ok(out, 'исходящее с isEcho сохранено: ответы через вторую CRM видны');
  assert.equal(out.direction, 'out', 'сообщение встало в историю исходящим');
  assert.equal(out.status, 'delivered', 'статус доставки сохранён');
  assert.equal(out.author, 'Коллега из Амо', 'имя ответившего сохранено');
  // собственная отправка узнаётся по префиксу внешнего id и не дублируется
  assert.equal(await hook({ data: [{ messageId: 'karkas-own-77', direction: 'outbound', isEcho: true, chatType: 'whatsapp', chatId: '79000000007', text: 'Своя отправка эхом' }] }), 200);
  msgs = (await call(`/api/conversations/${conv.id}/messages`)).body;
  assert.ok(!msgs.some(m => m.body === 'Своя отправка эхом'), 'эхо собственной отправки не дублируется');
  // повтор того же события второй строкой не появляется
  assert.equal(await hook({ data: [{ messageId: 'amo-echo-77', direction: 'outbound', isEcho: true, chatType: 'whatsapp', chatId: '79000000007', text: 'Ответ менеджера из второй CRM', status: 'delivered', sender: { name: 'Коллега из Амо' } }] }), 200);
  msgs = (await call(`/api/conversations/${conv.id}/messages`)).body;
  assert.equal(msgs.filter(m => m.body === 'Ответ менеджера из второй CRM').length, 1, 'повтор события не дублирует сообщение');
});

test('эхо старого формата сохраняется исходящим, а ретрай вендора без id не дублирует сообщение', async () => {
  const hook = body => fetch(base + '/webhooks/wazzup?secret=hook-secret-1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.status);
  // клиент пишет; в событии нет messageId — так выглядят ретраи вендора
  assert.equal(await hook({ messages: [{ channelId: 'ch-lg', chatType: 'whatsapp', chatId: '79000000091', type: 'text', text: 'Вопрос из старого формата', status: 'inbound' }] }), 200);
  const conv = (await call('/api/conversations')).body.find(c => c.external_chat_id === '79000000091');
  assert.ok(conv, 'беседа создана');
  // вендор повторил то же событие: вторая копия не появляется
  assert.equal(await hook({ messages: [{ channelId: 'ch-lg', chatType: 'whatsapp', chatId: '79000000091', type: 'text', text: 'Вопрос из старого формата', status: 'inbound' }] }), 200);
  let msgs = (await call(`/api/conversations/${conv.id}/messages`)).body;
  assert.equal(msgs.filter(m => m.body === 'Вопрос из старого формата').length, 1, 'ретрай без id не дублирует входящее');
  // менеджер ответил через вторую CRM: старый формат, isEcho, без поля direction —
  // ответ обязан встать в историю исходящим, а не входящим от клиента
  assert.equal(await hook({ messages: [{ messageId: 'amo-legacy-1', channelId: 'ch-lg', chatType: 'whatsapp', chatId: '79000000091', type: 'text', text: 'Ответ из старого формата', isEcho: true, status: 'outbound' }] }), 200);
  msgs = (await call(`/api/conversations/${conv.id}/messages`)).body;
  const out = msgs.find(m => m.body === 'Ответ из старого формата');
  assert.ok(out, 'эхо старого формата сохранено');
  assert.equal(out.direction, 'out', 'ответ менеджера виден исходящим, а не входящим');
});

test('эхо старого формата находит клиента по номеру и не плодит карточки из id чата', async () => {
  const hook = body => fetch(base + '/webhooks/wazzup?secret=hook-secret-1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.status);
  // клиент уже известен: раньше он написал в другой чат того же аккаунта
  assert.equal(await hook({ messages: [{ messageId: 'wz-echo-src-9', channelId: 'ch-lg', chatType: 'whatsapp', chatId: 'chat-echo-src', type: 'text', text: 'Вопрос по дому из другого чата', status: 'inbound', contact: { name: 'Клиент Эхо', phone: '79000000093' } }] }), 200);
  const before = (await call('/api/contacts')).body.filter(c => c.name === 'Клиент Эхо');
  assert.equal(before.length, 1, 'карточка клиента одна');
  // менеджер ответил через вторую CRM: старый формат, другой id чата, клиент указан в contact.
  // Без номера из contact ответ завёл бы вторую карточку с именем «chat-echo-dst»
  assert.equal(await hook({ messages: [{ messageId: 'amo-legacy-9', channelId: 'ch-lg', chatType: 'whatsapp', chatId: 'chat-echo-dst', type: 'text', text: 'Ответ тому же клиенту из второй CRM', isEcho: true, status: 'outbound', contact: { name: 'Клиент Эхо', phone: '79000000093' } }] }), 200);
  const after = (await call('/api/contacts')).body.filter(c => c.name === 'Клиент Эхо');
  assert.equal(after.length, 1, 'вторая карточка клиента не появилась');
  assert.ok(!(await call('/api/contacts')).body.some(c => c.name === 'chat-echo-dst'), '«клиент» из id чата не создан');
  const conv = (await call(`/api/contacts/${after[0].id}`)).body.conversations?.[0] || (await call('/api/conversations')).body.find(c => Number(c.contact_id) === Number(after[0].id));
  const msgs = (await call(`/api/conversations/${conv.id}/messages`)).body;
  const out = msgs.find(m => m.body === 'Ответ тому же клиенту из второй CRM');
  assert.ok(out, 'ответ из второй CRM лёг в беседу существующего клиента');
  assert.equal(out.direction, 'out', 'ответ виден исходящим');
  const listRow = (await call('/api/conversations')).body.find(c => Number(c.id) === Number(conv.id));
  assert.equal(listRow.last_direction, 'out', 'список бесед знает, чьё последнее сообщение');
});

test('массовое выполнение повторяющейся задачи продлевает цепочку, пароль короче 12 отклоняется', async () => {
  const created = await call('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'Ежедневная планёрка', type: 'call', due: '2026-11-02 10:00', repeat: 'daily' }) });
  assert.equal(created.status, 201, 'повторяющаяся задача создана');
  const id = created.body.id;
  const r = await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'tasks', action: 'update', ids: [id], patch: { done: 1 } }) });
  assert.equal(r.body.count, 1, 'массовое выполнение сработало');
  const rows = (await call('/api/tasks')).body;
  const orig = rows.find(x => x.id === id);
  assert.equal(Number(orig.done), 1, 'задача выполнена');
  const next = rows.find(x => x.title === 'Ежедневная планёрка' && x.id !== id && !x.done);
  assert.ok(next, 'массовое выполнение создало следующий повтор, цепочка не оборвалась');
  assert.ok(next.due > orig.due, 'новый срок позже закрытого: ' + next.due + ' > ' + orig.due);
  assert.equal(next.repeat, 'daily', 'повтор унаследован');
  // пароль сотрудника: единый минимум 12 символов — и при создании, и при смене
  const weak = await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Слабый Пароль', email: 'weakpass@example.com', password: 'short12345', role: 'manager' }) });
  assert.equal(weak.status, 400, 'пароль короче 12 символов отклонён');
  assert.match(weak.body.error, /от 12 до 256/, 'сообщение объясняет правило');
});

test('импорт CSV: BOM не портит имя, повторный импорт без телефона не дублирует по почте', async () => {
  const csv1 = '\uFEFFИмя;Телефон;E-mail;Компания\nИван Бом;;ivan-bom@example.com;Ромашка';
  const r1 = await call('/api/import/contacts', { method: 'POST', body: JSON.stringify({ csv: csv1 }) });
  assert.equal(r1.body.imported, 1, 'контакт с BOM импортирован');
  const list = (await call('/api/contacts')).body;
  const c = list.find(x => x.email === 'ivan-bom@example.com');
  assert.ok(c, 'импортированный контакт на месте');
  assert.equal(c.name, 'Иван Бом', 'невидимый BOM не приклеился к имени');
  const r2 = await call('/api/import/contacts', { method: 'POST', body: JSON.stringify({ csv: 'Имя;Телефон;E-mail;Компания\nИван Бом Второй;;IVAN-BOM@example.com;Ромашка' }) });
  assert.equal(r2.body.imported, 0, 'повторный импорт той же почты без телефона не плодит дубли');
  assert.equal(r2.body.skipped, 1, 'строка пропущена как дубль');
});

test('выгрузка копии в S3 отвергает имя с обходом пути', async () => {
  const r = await call('/api/backups/s3', { method: 'POST', body: JSON.stringify({ name: '../../crm.db' }) });
  assert.equal(r.status, 400, 'выход из каталога копий запрещён');
  assert.equal(r.body.error, 'Некорректное имя файла копии', 'посторонний файл в хранилище не уходит');
  assert.equal((await call('/api/backups/s3', { method: 'POST', body: JSON.stringify({ name: 'кириллица.db' }) })).status, 400, 'подозрительное имя отклонено');
  const r2 = await call('/api/backups/s3', { method: 'POST', body: JSON.stringify({ name: 'crm-2026-01-01.db' }) });
  assert.notEqual(r2.body.error, 'Некорректное имя файла копии', 'обычное имя копии проверку имени проходит');
});

test('сообщение длиннее лимита мессенджера отклоняется, обычное отправляется', async () => {
  const convs = (await call('/api/conversations')).body;
  assert.ok(convs.length, 'к этому моменту в базе есть диалог');
  const conv = convs[0];
  const long = await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'а'.repeat(5000) }) });
  assert.equal(long.status, 400, 'текст на 5000 символов не принимается');
  assert.match(long.body.error, /4096/, 'ошибка называет предел');
  const ok = await call(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'обычное сообщение' }) });
  assert.equal(ok.status, 201, 'сообщение в пределах лимита отправляется');
});

test('длинные тексты в карточках обрезаются до разумного предела', async () => {
  const c = await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'К'.repeat(500), phone: '+7 999 000-11-22', notes: 'Н'.repeat(30000) }) });
  assert.equal(c.status, 201);
  assert.equal(c.body.name.length, 200, 'имя обрезано до 200 символов');
  assert.equal(c.body.notes.length, 20000, 'заметка обрезана до 20000 символов');
  const t = await call('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'З'.repeat(600), due: 'завтра 10:00' }) });
  assert.equal(t.status, 201);
  assert.equal(t.body.title.length, 300, 'название задачи обрезано до 300 символов');
  const p = await call(`/api/contacts/${c.body.id}`, { method: 'PATCH', body: JSON.stringify({ position: 'Д'.repeat(400) }) });
  assert.equal(p.body.position.length, 120, 'должность обрезана и при обновлении');
});

test('массовый перевод на этап запускает автоматизацию «сделку перевели»', async () => {
  const pl = (await call('/api/pipelines')).body;
  const stages = pl[0].stages;
  const target = stages.find(s => !['won', 'lost'].includes(s.code) && s.code !== stages[0].code) || stages[1];
  const rule = await call('/api/automations', { method: 'POST', body: JSON.stringify({ name: 'Тест массового перевода', trigger_type: 'stage_changed', trigger_value: target.code, action_type: 'create_task', action_value: 'Автозадача массовая', active: 1 }) });
  assert.equal(rule.status, 201, 'правило создано: ' + JSON.stringify(rule.body));
  const d1 = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка массовая А', stage: stages[0].code }) });
  const d2 = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка массовая Б', stage: stages[0].code }) });
  assert.equal(d1.status, 201); assert.equal(d2.status, 201);
  const list = (await call('/api/deals')).body.deals;
  const ids = list.filter(x => ['Сделка массовая А', 'Сделка массовая Б'].includes(x.title)).map(x => x.id);
  assert.equal(ids.length, 2, 'обе сделки найдены');
  const bulk = await call('/api/bulk', { method: 'POST', body: JSON.stringify({ table: 'deals', action: 'update', ids, patch: { stage: target.code } }) });
  assert.equal(bulk.status, 200);
  assert.equal(bulk.body.count, 2, 'обе сделки переведены');
  const tasks = (await call('/api/tasks')).body;
  assert.equal(tasks.filter(t => t.title === 'Автозадача массовая').length, 2, 'правило сработало для обеих сделок массового перевода');
  await call('/api/automations/' + rule.body.id, { method: 'DELETE' });
});

test('дашборд считает неназначенные задачи общими: они видны каждому в «Моих»', async () => {
  const d0 = (await call('/api/dashboard')).body;
  const t = await call('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'Общая просроченная задача', due: '01.01.2020 10:00' }) });
  assert.equal(t.status, 201);
  assert.ok(!t.body.responsible_id, 'задача создана без ответственного');
  const d1 = (await call('/api/dashboard')).body;
  assert.equal(d1.myTasksOpen, d0.myTasksOpen + 1, 'неназначенная задача добавила ровно единицу в «Мои задачи»');
  assert.equal(d1.myTasksOverdue, d0.myTasksOverdue + 1, 'неназначенная просрочка добавила ровно единицу в личный счётчик');
  await call('/api/tasks/' + t.body.id, { method: 'PATCH', body: JSON.stringify({ done: 1 }) });
  const d2 = (await call('/api/dashboard')).body;
  assert.equal(d2.myTasksOpen, d0.myTasksOpen, 'после выполнения счётчик вернулся к прежнему значению');
});

test('настройки дублируются в файл settings.env', async () => {
  // Токен администратора уже получен в первом сценарии и остаётся действующим:
  // временный пароль первого входа к этому моменту заменён личным, поэтому
  // повторный вход с исходным паролем невозможен — и не нужен.
  assert.ok(h && h.Authorization, 'токен администратора действует');
  const put = await call('/api/settings', { method: 'PUT', body: JSON.stringify({ SMTP_HOST: 'mail.example.test' }) });
  assert.equal(put.status, 200);
  await new Promise(r => setTimeout(r, 700)); // копия пишется с задержкой, чтобы не дёргать диск на каждое сохранение
  const env = readFileSync(process.env.DATA_DIR + '/settings.env', 'utf8');
  assert.match(env, /SMTP_HOST="mail\.example\.test"/, 'значение из интерфейса попало в файл');
  assert.match(env, /^# /m, 'файл начинается с пояснения, что это копия');
  // в копии ключи интеграций и пароли почты: читать её может только владелец сервиса
  assert.equal(statSync(process.env.DATA_DIR + '/settings.env').mode & 0o777, 0o600, 'права файла с секретами 0600');
  await call('/api/settings', { method: 'PUT', body: JSON.stringify({ SMTP_HOST: '' }) });
});

test('новая воронка сразу с этапами: франшизу можно вести без ручной настройки', async () => {
  const r = await call('/api/pipelines', { method: 'POST', body: JSON.stringify({ name: 'Франшиза' }) });
  assert.equal(r.status, 201);
  const list = await call('/api/pipelines');
  const pipe = list.body.find(x => x.id === r.body.id);
  assert.ok(pipe && pipe.stages.length >= 3, 'этапы созданы вместе с воронкой');
  assert.ok(pipe.stages.some(x => x.code === 'won') && pipe.stages.some(x => x.code === 'lost'), 'успех и отказ есть сразу');
  const d = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Партнёрский городок', pipeline_id: r.body.id, amount: 500000 }) });
  assert.equal(d.status, 201);
  const board = await call('/api/deals?pipeline=' + r.body.id);
  assert.equal(board.body.deals.length, 1, 'сделка встала в свою воронку');
  assert.equal(board.body.stages.length, pipe.stages.length);
});

test('аналитика отдаёт конверсию по каждому менеджеру', async () => {
  const w = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Успешная для конверсии', amount: 100 }) });
  await call('/api/deals/' + w.body.id, { method: 'PATCH', body: JSON.stringify({ stage: 'won' }) });
  const lo = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Отказная для конверсии', amount: 100 }) });
  await call('/api/deals/' + lo.body.id, { method: 'PATCH', body: JSON.stringify({ stage: 'lost' }) });
  const a = await call('/api/analytics');
  assert.equal(a.status, 200);
  const row = a.body.byManager.find(x => x.name && x.name !== '—');
  assert.ok(row, 'строка менеджера есть');
  assert.equal(typeof row.won, 'number', 'успех посчитан');
  assert.equal(typeof row.lost, 'number', 'отказы посчитаны');
  assert.ok(row.conversion === null || (row.conversion >= 0 && row.conversion <= 100), 'конверсия в процентах');
});

test('операционные показатели не выдают ложную оценку менеджера', async () => {
  const q = await call('/api/quality?days=30');
  assert.equal(q.status, 200);
  assert.equal(q.body.days, 30);
  assert.ok(Array.isArray(q.body.managers) && q.body.managers.length >= 1, 'по активным менеджерам есть строки');
  assert.ok(q.body.managers.every(m => typeof m.unansweredDialogs === 'number' && typeof m.stalled === 'number' && typeof m.overdueTasks === 'number'), 'отдаются измеримые рабочие показатели');
  assert.ok(q.body.managers.every(m => !('score' in m) && !('verdict' in m)), 'медиана ответа и просрочка не превращаются в оценку менеджера');
  assert.ok(q.body.totals && Array.isArray(q.body.definitions) && q.body.definitions.length >= 4, 'значение показателей объясняется');
  assert.match(q.body.note, /не оценка качества менеджера/);
  // вопрос клиента, на который ответил не человек, а правило или рассылка,
  // остаётся в отчёте: качество измеряется ответами сотрудника
  const qContact = await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Клиент ОКК', phone: '+79007770011', responsible_id: 1 }) });
  const qConv = await call('/api/conversations', { method: 'POST', body: JSON.stringify({ contact_id: qContact.body.id, chat_type: 'whatsapp' }) });
  const ago = m => new Date(Date.now() - m * 60000).toISOString().slice(0, 19).replace('T', ' ');
  db.prepare("INSERT INTO messages(conversation_id,channel,direction,body,created_at) VALUES(?,'whatsapp','in','Вопрос клиента',?)").run(qConv.body.id, ago(20));
  db.prepare("INSERT INTO messages(conversation_id,channel,direction,body,created_at,author) VALUES(?,'whatsapp','out','Автоответ',?,'Рассылка')").run(qConv.body.id, ago(19));
  const qAuto = await call('/api/quality?days=7');
  const adminRow = qAuto.body.managers.find(m => Number(m.id) === 1);
  assert.ok(adminRow && adminRow.unansweredDialogs >= 1, 'автоответ не закрыл вопрос клиента');
  assert.equal(adminRow.medianResponseMin, null, 'медиана не считается по автоматическим сообщениям');
  const mgr = await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Менеджер ОКК', email: 'qc@example.com', password: 'qcpassword123', role: 'manager' }) });
  assert.equal(mgr.status, 201);
  const lm = await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'qc@example.com', password: 'qcpassword123' }) });
  const savedH = h;
  h = { Authorization: 'Bearer ' + lm.body.token };
  assert.equal((await call('/api/quality')).status, 403, 'менеджер не видит показатели команды');
  assert.equal((await call('/api/quality/reviews')).status, 403, 'менеджер не видит внутренние проверки ОКК');
  assert.equal((await call('/api/quality/deals')).status, 403, 'менеджер не получает выборку сделок для ОКК');
  h = savedH;
});

test('ОКК: ручная оценка с доказательствами, временем, метриками и отдельным статусом «контакта не было»', async () => {
  const contact = await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Клиент для ОКК', phone: '79000000088', responsible_id: 1, source: 'site' }) });
  assert.equal(contact.status, 201);
  const deal = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Проверка ОКК ДОМ 45', contact_id: contact.body.id, responsible_id: 1 }) });
  assert.equal(deal.status, 201);
  const conv = await call('/api/conversations', { method: 'POST', body: JSON.stringify({ contact_id: contact.body.id, chat_type: 'whatsapp' }) });
  assert.equal(conv.status, 201);
  const localDay = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const utcStamp = d => d.toISOString().slice(0,23).replace('T',' ');
  const inboundAt = new Date(Date.now()-8*60000), replyAt = new Date(Date.now()-6*60000);
  const reviewDays = [localDay(inboundAt),localDay(replyAt)].sort();
  const msg = db.prepare("INSERT INTO messages(conversation_id,channel,direction,body,author,event_at,event_time_source,status) VALUES(?,'whatsapp','in','Сколько стоит дом и можно ли построить в Уфе?','Клиент',?,'provider','inbound')").run(conv.body.id,utcStamp(inboundAt));
  db.prepare("INSERT INTO messages(conversation_id,channel,direction,body,author,event_at,event_time_source,status) VALUES(?,'whatsapp','out','Здравствуйте, отвечу по вопросу и уточню детали.','Администратор',?,'crm','sent')").run(conv.body.id,utcStamp(replyAt));
  const searched = await call('/api/quality/deals?q=дом');
  assert.equal(searched.status, 200, 'руководитель ищет сделки без учёта регистра кириллицы');
  assert.ok(searched.body.rows.some(x => Number(x.id) === Number(deal.body.id)), 'найдена нужная сделка');
  const created = await call('/api/quality/reviews', { method: 'POST', body: JSON.stringify({ deal_id: deal.body.id }) });
  assert.equal(created.status, 201, 'черновик создан');
  let detail = await call('/api/quality/reviews/' + created.body.id);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.criteria.length, 18, 'чек-лист соответствует листу «Чек-лист ОКК»');
  assert.equal(detail.body.growthCriteria.length, 10, 'развивающий контур не смешан с 18-балльным чек-листом');
  assert.equal(detail.body.messages.length, 2, 'история включает клиентское сообщение и ответ сотрудника');
  assert.equal(detail.body.messages.find(x=>Number(x.id)===Number(msg.lastInsertRowid)).event_time_source,'provider');
  assert.equal(detail.body.firstReply.available,true,'подсказка по SLA доступна только с сохранёнными отметками события');
  assert.equal(detail.body.firstReply.pending,false);
  assert.equal(detail.body.firstReply.thresholdMinutes,5);
  assert.equal(detail.body.firstReply.onTime,true);
  assert.equal(detail.body.firstReply.timingBasis,'Отметки канала и CRM');
  assert.equal(detail.body.firstReply.firstReplyAuthor,'Администратор');
  const items = detail.body.criteria.map((c, i) => ({
    key: c.key,
    status: i < 13 ? 'yes' : i < 15 ? 'no' : i < 17 ? 'na' : 'unknown',
    evidence_source: i === 15 ? 'crm' : 'message',
    message_id: i === 15 ? null : Number(msg.lastInsertRowid),
    evidence_text: i < 13 ? 'Подтверждено сообщением клиента и ответом сотрудника.'
      : i < 15 ? 'В доступной переписке факт не подтверждён, приведена причина.'
        : i < 17 ? 'В этом случае критерий неприменим, причина указана.' : 'Не хватает записи звонка, нужен ручной просмотр.',
    evidence_confidence: i === 17 ? 'needs_review' : 'verified'
  }));
  const growthItems = detail.body.growthCriteria.map(c => ({
    key:c.key,
    status:c.key==='materials_followup'?'no':c.key==='region_coverage'?'yes':'unknown',
    evidence_source:'message',message_id:Number(msg.lastInsertRowid),
    evidence_text:'Проверен конкретный фрагмент переписки или указана причина ограничения данных.',
    evidence_confidence:c.key==='materials_followup'||c.key==='region_coverage'?'verified':'needs_review'
  }));
  const facts = Object.fromEntries(['object_area','city','land','timeline','budget','payment'].map(key=>[
    key,{heard_status:'yes',crm_status:'yes'}
  ]));
  const otherContact = await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Чужой контакт для ОКК', phone: '79000000089' }) });
  const otherConv = await call('/api/conversations', { method: 'POST', body: JSON.stringify({ contact_id: otherContact.body.id, chat_type: 'whatsapp' }) });
  const foreignMessage = db.prepare("INSERT INTO messages(conversation_id,channel,direction,body) VALUES(?,'whatsapp','in','Чужая переписка')").run(otherConv.body.id);
  const reviewBody = {
    status: 'complete', data_status: 'partial', interaction_type: 'chat', period_start: reviewDays[0], period_end: reviewDays[1],
    data_notes: 'Проверена доступная переписка; записи звонков нет.', summary: 'Сотрудник уточнил параметры объекта.',
    issues: ['На первый вопрос не дан точный ответ.'], next_steps: ['Подготовить расчёт и согласовать время разговора.'],
    crm_observation: 'Поля бюджета и срока не заполнены, уточнить их у клиента.', sample_rule:'manager_choice',
    facts,items,growth_items:growthItems
  };
  const foreignItems = items.map((x,i)=>i===0?{...x,message_id:Number(foreignMessage.lastInsertRowid)}:x);
  const crossed = await call('/api/quality/reviews/' + created.body.id, { method: 'PUT', body: JSON.stringify({ ...reviewBody, items: foreignItems }) });
  assert.equal(crossed.status, 400, 'источник из чужой сделки нельзя прикрепить как доказательство');
  const saved = await call('/api/quality/reviews/' + created.body.id, { method: 'PUT', body: JSON.stringify(reviewBody) });
  assert.equal(saved.status, 200, 'полная проверка сохранена');
  assert.deepEqual(saved.body.review.score, {
    confirmed:13,applicable:15,criticalMarkedNo:['next_step'],notApplicable:2,insufficient:1,unreviewed:0,
    percent:86.7,coverage:83.3,total:18,abandonedCard:false
  });
  assert.equal(saved.body.review.status, 'complete');
  const edited = await call('/api/quality/reviews/' + created.body.id, { method: 'PUT', body: JSON.stringify({ status: 'draft', items }) });
  assert.equal(edited.status, 409, 'завершённый разбор нельзя незаметно переписать');
  assert.equal((await call('/api/quality/reviews/' + created.body.id, { method: 'DELETE' })).status, 409, 'завершённое доказательство нельзя удалить');
  const list = await call('/api/quality/reviews?days=30');
  assert.equal(list.status, 200);
  assert.equal(list.body.summary.complete, 1);
  assert.equal(list.body.criteria.length, 18);
  assert.equal(list.body.growthCriteria.length,10);
  assert.equal(list.body.criteria.find(x => x.key === 'greeting').percent, 100);
  assert.equal(list.body.criteria.find(x => x.key === 'materials').applicable, 0, 'неприменимые критерии не попадают в знаменатель');
  assert.deepEqual(list.body.metrics.qualification,{numerator:1,denominator:1,excluded:0,percent:100,target:75},'неопределённые факторы не подменяют долю 4 из 6');
  assert.deepEqual(list.body.metrics.cityLandCrm,{numerator:1,denominator:1,excluded:0,percent:100,target:90});
  assert.deepEqual(list.body.metrics.nextStep,{numerator:0,denominator:1,excluded:0,percent:0,target:85});
  assert.deepEqual(list.body.metrics.materials,{numerator:0,denominator:1,excluded:0,percent:0,target:90});
  assert.deepEqual(list.body.metrics.geography,{numerator:1,denominator:1,excluded:0,percent:100,target:100});
  const managerMetrics=list.body.metricsByManager.find(x=>Number(x.id)===1);
  assert.ok(managerMetrics && managerMetrics.metrics.qualification.denominator===1,'метрики сгруппированы по ответственному на момент проверки');
  const addMetricSample=async(name,heardStatuses)=>{
    const c=await call('/api/contacts',{method:'POST',body:JSON.stringify({name,phone:`79${String(Math.floor(Math.random()*1e9)).padStart(9,'0')}`,responsible_id:1,source:'site'})});
    const d=await call('/api/deals',{method:'POST',body:JSON.stringify({title:`Метрика ${name}`,contact_id:c.body.id,responsible_id:1})});
    const draft=await call('/api/quality/reviews',{method:'POST',body:JSON.stringify({deal_id:d.body.id})});
    const qd=(await call('/api/quality/reviews/'+draft.body.id)).body;
    const blankEvidence=criteria=>criteria.map(x=>({key:x.key,status:'unknown',evidence_source:'crm',message_id:null,evidence_text:'Данных для уверенного вывода недостаточно.',evidence_confidence:'needs_review'}));
    const sampleFacts=Object.fromEntries(['object_area','city','land','timeline','budget','payment'].map((key,i)=>[
      key,{heard_status:heardStatuses[i],crm_status:'unknown'}
    ]));
    const result=await call('/api/quality/reviews/'+draft.body.id,{method:'PUT',body:JSON.stringify({
      status:'complete',data_status:'partial',interaction_type:'other',period_start:reviewDays[0],period_end:reviewDays[1],
      sample_rule:'manager_choice',facts:sampleFacts,items:blankEvidence(qd.criteria),growth_items:blankEvidence(qd.growthCriteria)
    })});
    assert.equal(result.status,200,`тестовая проверка «${name}» сохранена: ${JSON.stringify(result.body)}`);
  };
  await addMetricSample('Неопределённая квалификация',['yes','yes','yes','no','unknown','unknown']);
  await addMetricSample('Определённый недобор',['yes','yes','no','no','no','no']);
  await addMetricSample('Не применимый фактор',['yes','yes','yes','no','no','na']);
  const metricCases=await call('/api/quality/reviews?days=30');
  assert.deepEqual(metricCases.body.metrics.qualification,{numerator:1,denominator:3,excluded:1,percent:33.3,target:75},
    'неоднозначная выборка и не применимый фактор не превращаются в штраф, определённые случаи остаются в знаменателе');

  const blank = await call('/api/quality/reviews', { method: 'POST', body: JSON.stringify({ deal_id: deal.body.id }) });
  const blankItems = (await call('/api/quality/reviews/' + blank.body.id)).body.items.map(x => ({ key: x.criterion_key, status: '', evidence_source: '', message_id: null, evidence_text: '' }));
  const noContact = await call('/api/quality/reviews/' + blank.body.id, { method: 'PUT', body: JSON.stringify({
    status: 'no_contact', data_notes: 'Менеджер ещё не связался с клиентом; оценивать нечего.',
    period_start:reviewDays[0],period_end:reviewDays[1],sample_rule:'manager_choice',items:blankItems
  }) });
  assert.equal(noContact.status, 200, 'отсутствие разговора сохраняется отдельно с периодом и основанием выборки');
  assert.equal(noContact.body.review.score, null, 'отсутствие разговора не превращается в ноль баллов');
  assert.equal((await call('/api/quality/reviews?days=30')).body.summary.no_contact, 1);

  const draft = await call('/api/quality/reviews', { method: 'POST', body: JSON.stringify({ deal_id: deal.body.id }) });
  const bad = await call('/api/quality/reviews/' + draft.body.id, { method: 'PUT', body: JSON.stringify({ status: 'complete', data_status: 'complete', period_start: reviewDays[0], period_end: reviewDays[1], items: [] }) });
  assert.equal(bad.status, 400, 'нельзя завершить разбор без всех статусов и подтверждений');
  assert.equal((await call('/api/quality/reviews/' + draft.body.id, { method: 'DELETE' })).status, 200, 'черновик можно удалить');
});

test('обучения больше нет: маршрут закрыт, таблица убрана из базы', async () => {
  assert.equal((await call('/api/training')).status, 404, 'маршрута обучения нет');
  assert.equal((await call('/api/training', { method: 'POST', body: JSON.stringify({ title: 'Как мы продаём', kind: 'text', body: 'текст' }) })).status, 404, 'материалы не создаются');
  assert.equal((await call('/api/training/1', { method: 'DELETE' })).status, 404, 'удалять нечего');
  assert.equal((await call('/api/me/pref', { method: 'PATCH', body: JSON.stringify({ view: 'training' }) })).status, 400, 'обучение не сохраняется любимым разделом');
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='training_items'").get(), undefined, 'таблица материалов удалена');
});

test('рассылка: сегмент, расписание и отмена; канал без подключения отклоняется', async () => {
  // ключ Wazzup остался от сценария интеграции выше, а через интерфейс он
  // только заменяется (защита от затирания замаскированного значения):
  // для проверки отказа гасим ключ напрямую в базе теста
  db.prepare("DELETE FROM settings WHERE key='WAZZUP_API_KEY'").run();
  const noCh = await call('/api/campaigns', { method: 'POST', body: JSON.stringify({ name: 'Без канала', channel: 'whatsapp', message: 'текст' }) });
  assert.equal(noCh.status, 400, 'WhatsApp не подключён — рассылка отклонена');
  assert.match(noCh.body.error, /Wazzup|WhatsApp/, 'ошибка объясняет, что подключить');
  const rc1 = await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Получатель Один', email: 'rc1@example.com' }) });
  const rc2 = await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Получатель Два', email: 'rc2@example.com' }) });
  assert.equal((await call('/api/settings', { method: 'PUT', body: JSON.stringify({ SMTP_HOST: 'smtp.example.test' }) })).status, 200);
  const pv = await call('/api/campaigns/preview', { method: 'POST', body: JSON.stringify({ channel: 'email', audience: {} }) });
  assert.ok(pv.body.count >= 2, 'сегмент посчитан до создания');
  const pvTag = await call('/api/campaigns/preview', { method: 'POST', body: JSON.stringify({ channel: 'email', audience: { tag: 'нет-такого-тега' } }) });
  assert.equal(pvTag.body.count, 0, 'по несуществующему тегу получателей нет');
  // рассылка отмеченным клиентам: получатели ровно те, кого выбрал сотрудник,
  // а пустой набор не превращается в отправку всей базе
  const pvPicked = await call('/api/campaigns/preview', { method: 'POST', body: JSON.stringify({ channel: 'email', audience: { ids: [rc1.body.id, rc2.body.id, rc2.body.id] } }) });
  assert.equal(pvPicked.body.count, 2, 'отмеченные клиенты посчитаны без повторов');
  assert.equal((await call('/api/campaigns/preview', { method: 'POST', body: JSON.stringify({ channel: 'email', audience: { ids: [] } }) })).body.count, 0, 'пустой набор — получателей нет');
  assert.equal((await call('/api/campaigns/preview', { method: 'POST', body: JSON.stringify({ channel: 'email', audience: { ids: [999999] } }) })).body.count, 0, 'чужой или несуществующий id не подходит');
  const emptyPick = await call('/api/campaigns', { method: 'POST', body: JSON.stringify({ name: 'Пустой набор', channel: 'email', message: 'текст', audience: { ids: [] } }) });
  assert.equal(emptyPick.status, 400, 'рассылка никому не создаётся');
  assert.match(emptyPick.body.error, /Отметьте клиентов/, 'пустой набор объясняют словами, а не отправкой всей базе');
  const noMail = await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Без почты', phone: '+79005554433' }) });
  const pickNoAddr = await call('/api/campaigns', { method: 'POST', body: JSON.stringify({ name: 'Без адреса', channel: 'email', message: 'текст', audience: { ids: [noMail.body.id] } }) });
  assert.equal(pickNoAddr.status, 400, 'клиенту без почты рассылка не создаётся');
  assert.match(pickNoAddr.body.error, /не заполнен e-mail/, 'ошибка называет причину');
  const pickOk = await call('/api/campaigns', { method: 'POST', body: JSON.stringify({ name: 'Выбранным клиентам', channel: 'email', message: 'Здравствуйте, {имя}', scheduled_at: '2030-01-01T10:00', audience: { ids: [rc1.body.id, rc2.body.id, rc1.body.id] } }) });
  assert.equal(pickOk.status, 201, 'рассылка отмеченным клиентам создана');
  assert.equal(pickOk.body.total, 2, 'повторы в наборе не удваивают получателей');
  const pickCard = await call('/api/campaigns/' + pickOk.body.id);
  assert.deepEqual(pickCard.body.items.map(x => x.contact_id).sort(), [rc1.body.id, rc2.body.id].sort(), 'в очереди ровно отмеченные клиенты');
  assert.equal(pickCard.body.audience.includes('ids'), false, 'список id не дублируется в описании рассылки');
  assert.equal((await call('/api/campaigns/' + pickOk.body.id, { method: 'DELETE' })).status, 200);
  const past = await call('/api/campaigns', { method: 'POST', body: JSON.stringify({ name: 'В прошлом', channel: 'email', message: 'текст', scheduled_at: '2020-01-01T10:00' }) });
  assert.equal(past.status, 400, 'время в прошлом отклонено');
  const noMsg = await call('/api/campaigns', { method: 'POST', body: JSON.stringify({ name: 'Без текста', channel: 'email' }) });
  assert.equal(noMsg.status, 400, 'рассылка без текста отклонена');
  const c = await call('/api/campaigns', { method: 'POST', body: JSON.stringify({ name: 'Зимнее предложение', channel: 'email', subject: 'Зима', message: 'Здравствуйте, {имя}!', scheduled_at: '2030-01-01T10:00' }) });
  assert.equal(c.status, 201);
  assert.equal(c.body.status, 'scheduled', 'рассылка ждёт расписания');
  // момент отправки хранится в UTC: расписание не съезжает, если сервер и
  // сотрудник работают в разных поясах
  const utcWhen = new Date(Date.now() + 3600e3).toISOString();
  const utcCamp = await call('/api/campaigns', { method: 'POST', body: JSON.stringify({ name: 'По поясу', channel: 'email', message: 'текст', scheduled_at: utcWhen }) });
  assert.equal(utcCamp.status, 201);
  assert.equal(utcCamp.body.scheduled_at, utcWhen, 'время отправки сохранено в UTC без сдвига');
  assert.ok(c.body.total >= 2, 'получатели посчитаны');
  const one = await call('/api/campaigns/' + c.body.id);
  assert.equal(one.body.items.length, one.body.total, 'список получателей зафиксирован при создании');
  const cancel = await call('/api/campaigns/' + c.body.id + '/cancel', { method: 'POST', body: '{}' });
  assert.equal(cancel.status, 200);
  assert.equal((await call('/api/campaigns/' + c.body.id)).body.status, 'canceled');
  // менеджер видит и ведёт рассылки, но удалить историю может только админ
  const mm = await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Менеджер Рассылок', email: 'camp@example.com', password: 'camppassword1', role: 'manager' }) });
  assert.equal(mm.status, 201);
  const lmm = await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'camp@example.com', password: 'camppassword1' }) });
  const savedH = h;
  h = { Authorization: 'Bearer ' + lmm.body.token };
  assert.equal((await call('/api/campaigns')).status, 200, 'менеджер видит список рассылок');
  assert.equal((await call('/api/campaigns/' + c.body.id, { method: 'DELETE' })).status, 404, 'история чужой рассылки скрыта, чтобы не раскрывать её наличие');
  assert.equal((await call('/api/campaigns/' + utcCamp.body.id + '/cancel', { method: 'POST', body: '{}' })).status, 404, 'чужая рассылка скрыта от менеджера при попытке отмены');
  assert.equal((await call('/api/campaigns/' + utcCamp.body.id + '/start', { method: 'POST', body: '{}' })).status, 404, 'чужая рассылка скрыта от менеджера при попытке запуска');
  const managerContact=await call('/api/contacts',{method:'POST',body:JSON.stringify({name:'Получатель менеджера',phone:'79005550022',email:'private-recipient@example.com'})});
  assert.equal(managerContact.status,201);
  const managerCampaign=await call('/api/campaigns',{method:'POST',body:JSON.stringify({name:'Личная рассылка',channel:'email',message:'Текст',scheduled_at:'2030-01-01T10:00',audience:{ids:[managerContact.body.id]}})});
  assert.equal(managerCampaign.status,201,'менеджер создаёт рассылку по своей аудитории');
  h = savedH;
  const transferredTo=await call('/api/users',{method:'POST',body:JSON.stringify({name:'Новый владелец получателя',email:'campaign-owner@example.com',password:'campaign-owner-123',role:'manager'})});
  assert.equal(transferredTo.status,201);
  assert.equal((await call('/api/contacts/'+managerContact.body.id,{method:'PATCH',body:JSON.stringify({responsible_id:transferredTo.body.id})})).status,200,'администратор передал контакт');
  h={Authorization:'Bearer '+lmm.body.token};
  const privateCampaign=await call('/api/campaigns/'+managerCampaign.body.id);
  assert.equal(privateCampaign.status,200,'автор видит свою историю рассылки');
  assert.equal(privateCampaign.body.items[0].contact_id,null,'после передачи контакта ID получателя скрыт');
  assert.equal(privateCampaign.body.items[0].contact_name,'Карточка недоступна');
  assert.equal(privateCampaign.body.items[0].address,'','номер или e-mail переданного контакта не раскрывается');
  assert.equal((await call('/api/campaigns/'+managerCampaign.body.id,{method:'DELETE'})).status,403,'менеджер не удаляет даже собственную историю рассылки');
  h = savedH;
  assert.equal((await call('/api/campaigns/'+managerCampaign.body.id,{method:'DELETE'})).status,200,'администратор удаляет тестовую рассылку');
  assert.equal((await call('/api/campaigns/' + c.body.id, { method: 'DELETE' })).status, 200);
  assert.equal((await call('/api/campaigns/' + utcCamp.body.id, { method: 'DELETE' })).status, 200);
  await call('/api/settings', { method: 'PUT', body: JSON.stringify({ SMTP_HOST: '' }) });
  await new Promise(r => setTimeout(r, 500)); // копия настроек в файле гасится вместе с ключами
});

test('партнёр: доступ только по активной передаче и немедленно закрывается после отзыва', async () => {
  const adminHeaders=h;
  try {
    const u = await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Партнёр Север', email: 'partner@example.com', password: 'partnerpassword1', role: 'partner' }) });
    assert.equal(u.status, 201);
    const badRole = await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Хакер', email: 'hacker@example.com', password: 'hackerpassword1', role: 'hacker' }) });
    assert.equal(badRole.status, 400, 'неизвестная роль отклонена');
    const fd = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Чужой лид без передачи', amount: 10 }) });
    assert.equal(fd.status, 201);
    const PNG_B64 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64').toString('base64');
    const foreignContact = await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Чужой клиент с файлом', phone: '+79000000009' }) });
    assert.equal(foreignContact.status, 201);
    const foreignConv = await call('/api/conversations', { method: 'POST', body: JSON.stringify({ contact_id: foreignContact.body.id, chat_type: 'whatsapp' }) });
    assert.equal(foreignConv.status, 201);
    const alienFile = await call(`/api/conversations/${foreignConv.body.id}/upload`, { method: 'POST', body: JSON.stringify({ filename: 'dogovor.png', contentType: 'image/png', dataBase64: PNG_B64 }) });
    assert.equal(alienFile.status, 201);
    await call(`/api/conversations/${foreignConv.body.id}/messages`, { method: 'POST', body: JSON.stringify({ body: '', contentUri: alienFile.body.url, contentName: alienFile.body.name, contentType: alienFile.body.contentType }) });

    const fcOwn = await call('/api/companies', { method: 'POST', body: JSON.stringify({ name: 'Компания переданного клиента' }) });
    const fcOther = await call('/api/companies', { method: 'POST', body: JSON.stringify({ name: 'Чужая компания' }) });
    assert.equal(fcOwn.status, 201); assert.equal(fcOther.status, 201);
    const fcContact = await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Клиент партнёра от офиса', phone: '+79000000011', email: 'partner-customer@example.com', responsible_id: u.body.id, company_id: fcOwn.body.id }) });
    assert.equal(fcContact.status, 201);
    const adminId=db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get().id;
    const deal=await call('/api/deals',{method:'POST',body:JSON.stringify({title:'Сделка для передачи',amount:100000,stage:'new',pipeline_id:1,contact_id:fcContact.body.id,company_id:fcOwn.body.id,responsible_id:adminId})});
    assert.equal(deal.status,201);
    const otherDeal=await call('/api/deals',{method:'POST',body:JSON.stringify({title:'Другая сделка того же клиента',amount:50000,stage:'new',pipeline_id:1,contact_id:fcContact.body.id,responsible_id:adminId})});
    assert.equal(otherDeal.status,201);
    assert.equal((await call('/api/settings',{method:'PUT',body:JSON.stringify({PARTNER_TRANSFER_PIPELINE_ID:1,PARTNER_TRANSFER_ALLOWED_STAGES:'new'})})).status,200,'доступ включён только после явной настройки воронки и этапа');

    const lp = await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'partner@example.com', password: 'partnerpassword1' }) });
    const partnerHeaders={Authorization:'Bearer '+lp.body.token};
    h=partnerHeaders;
    assert.equal((await call('/api/bulk',{method:'POST',body:JSON.stringify({table:'deals',action:'update',ids:[deal.body.id],patch:{priority:'high'}})})).status,403,'партнёр не выполняет массовые действия даже по переданной сделке');
    for (const path of ['/api/analytics', '/api/settings', '/api/quality', '/api/campaigns', '/api/competitors']) {
      assert.equal((await call(path)).status,403,path+' закрыт для партнёра');
    }
    assert.equal((await call('/api/deals')).body.deals.length,0,'одного ответственного недостаточно без активной передачи');
    assert.equal((await call('/api/deals/'+deal.body.id)).status,403,'старая ссылка закрыта до передачи');
    assert.equal((await call('/api/contacts')).body.length,0,'контакт без активной передачи не виден');
    assert.equal((await call('/api/companies')).body.length,0,'компания без активной передачи не видна');
    assert.equal((await call('/api/conversations')).body.length,0,'чат без активной передачи не виден');
    assert.equal((await call('/api/search?q='+encodeURIComponent('Сделка для передачи'))).body.deals.length,0,'поиск до передачи пуст');
    assert.equal((await call('/api/deals',{method:'POST',body:JSON.stringify({title:'Самостоятельная сделка',amount:1})})).status,403,'партнёр не создаёт неподтверждённые сделки');
    assert.equal((await call('/api/contacts',{method:'POST',body:JSON.stringify({name:'Самостоятельный контакт'})})).status,403,'партнёр не заводит клиентов вне передачи');
    assert.equal((await call('/api/deals/'+deal.body.id+'/print?doc=quote')).status,403,'печать закрыта до передачи');
    assert.equal((await fetch(base+alienFile.body.url,{headers:h})).status,403,'старое вложение чужого чата закрыто');

    h=adminHeaders;
    const granted=await call('/api/partner-transfers',{method:'POST',body:JSON.stringify({deal_id:deal.body.id,partner_id:u.body.id,reason:'Согласована передача клиенту'})});
    assert.equal(granted.status,201,'руководитель передал подходящую сделку партнёру');
    h=partnerHeaders;
    for (const path of ['/api/analytics', '/api/settings', '/api/quality', '/api/campaigns', '/api/competitors']) assert.equal((await call(path)).status,403,path+' остаётся закрытым');
    const board=await call('/api/deals');
    assert.equal(board.body.deals.length,1,'партнёр видит одну переданную сделку');
    assert.deepEqual(board.body.pipelines.map(x=>x.id),[1],'партнёру отдана только разрешённая воронка');
    assert.deepEqual(board.body.stages.map(x=>x.code),['new'],'этапы ограничены разрешённым списком');
    assert.equal(board.body.deals[0].id,deal.body.id);
    assert.equal((await call('/api/deals/'+fd.body.id)).status,403,'другая сделка закрыта');
    const card=await call('/api/deals/'+deal.body.id);
    assert.equal(card.status,200);
    assert.equal(card.body.deal.amount,100000);
    assert.equal(card.body.deal.responsible_id,undefined,'внутренний ответственный не раскрывается партнёру');
    assert.equal(card.body.deal.custom,undefined,'неразрешённые пользовательские поля не раскрываются партнёру');
    assert.equal((await call('/api/contacts')).body.map(x=>x.id).join(','),String(fcContact.body.id),'партнёру виден только клиент сделки');
    const contacts=await call('/api/contacts/'+fcContact.body.id);
    assert.equal(contacts.status,200);
    assert.equal(contacts.body.responsible_id,undefined,'ответственный офиса не раскрывается');
    assert.deepEqual((await call('/api/companies')).body.map(x=>x.id),[fcOwn.body.id],'справочник ограничен переданной сделкой');
    assert.equal((await call('/api/companies/'+fcOther.body.id)).status,403,'чужая компания закрыта');
    const search=await call('/api/search?q='+encodeURIComponent('Сделка для передачи'));
    assert.equal(search.status,200);assert.equal(search.body.deals.length,1,'поиск находит переданную сделку');
    assert.equal((await call('/api/search?q='+encodeURIComponent('Чужая компания'))).body.companies.length,0,'поиск не раскрывает чужие компании');
    const dash = await call('/api/dashboard');
    assert.equal(dash.body.dealsTotal,1);assert.equal(dash.body.activeDealsSum,100000);assert.equal(dash.body.contacts,1);
    assert.equal(dash.body.revenue,0);assert.equal(dash.body.lostSum,0);assert.equal(dash.body.companies,0);
    assert.deepEqual(dash.body.activities,[]);assert.deepEqual(dash.body.recentDeals,[]);assert.deepEqual(dash.body.stages,[]);
    const users=await call('/api/users');assert.equal(users.body.length,1);assert.equal(users.body[0].id,u.body.id);
    assert.equal((await call('/api/users')).body[0].email,undefined,'список сотрудников партнёру не раскрывает служебные сведения');
    const task=await call('/api/tasks',{method:'POST',body:JSON.stringify({title:'Задача переданной сделки',deal_id:deal.body.id,contact_id:fcContact.body.id})});
    assert.equal(task.status,201,'партнёр создаёт задачу только к переданной сделке');
    assert.equal((await call('/api/tasks')).body.some(x=>x.id===task.body.id),true);
    assert.equal((await call('/api/tasks',{method:'POST',body:JSON.stringify({title:'Чужая задача',deal_id:fd.body.id})})).status,403);
    assert.equal((await call('/api/tasks/'+task.body.id,{method:'PATCH',body:JSON.stringify({title:'Обновлённая задача'})})).status,200);
    assert.equal((await call('/api/deals/'+deal.body.id+'/products')).status,200,'состав своей сделки читается');
    assert.equal((await call('/api/deals/'+deal.body.id+'/products',{method:'POST',body:JSON.stringify({name:'Позиция вне разрешения',price:700000,qty:1})})).status,403,'партнёр не меняет сумму через состав сделки');
    assert.equal((await call('/api/deals/'+deal.body.id,{method:'PATCH',body:JSON.stringify({amount:1})})).status,403,'сумма — закрытое для изменения поле');
    assert.equal((await call('/api/deals/'+deal.body.id,{method:'PATCH',body:JSON.stringify({stage:'deferred'})})).status,403,'переход вне разрешённых этапов закрыт');
    assert.equal((await call('/api/deals/'+deal.body.id+'/print?doc=quote')).status,200,'по переданной сделке печать разрешена');
    assert.equal((await call('/api/deals/'+deal.body.id+'/send-doc',{method:'POST',body:JSON.stringify({doc:'quote'})})).status!==403,true,'отправка документа по переданной сделке разрешена');
    const conv=await call('/api/conversations',{method:'POST',body:JSON.stringify({contact_id:fcContact.body.id,chat_type:'whatsapp'})});
    assert.equal(conv.status,201,'партнёр начинает чат только для переданного клиента');
    db.prepare("INSERT INTO messages(conversation_id,deal_id,channel,direction,body,status,author) VALUES(?,?,'whatsapp','in','Вопрос по переданной сделке','inbound','Клиент')").run(conv.body.id,deal.body.id);
    db.prepare("INSERT INTO messages(conversation_id,deal_id,channel,direction,body,status,author) VALUES(?,?,'whatsapp','in','Переписка по офисной сделке','inbound','Клиент')").run(conv.body.id,otherDeal.body.id);
    const partnerChatList=await call('/api/conversations');
    assert.equal(partnerChatList.body[0].unread,1,'непрочитанность считается по переданной сделке, не по другим сделкам клиента');
    const partnerHistory=await call('/api/conversations/'+conv.body.id+'/messages');
    assert.equal(partnerHistory.body.length,1,'партнёр получает переписку только своей переданной сделки');
    assert.match(partnerHistory.body[0].body,/переданной сделке/);
    assert.equal((await call('/api/dashboard')).body.unreadMine,0,'прочтение обновляет отметку отдельной сделки');
    const sent=await call('/api/conversations/'+conv.body.id+'/messages',{method:'POST',body:JSON.stringify({body:'Здравствуйте',channel:'whatsapp'})});
    assert.equal(sent.status,201);assert.equal(sent.body.message.deal_id,deal.body.id,'сообщение привязано к конкретной переданной сделке');
    const remoteAttachment=db.prepare("INSERT INTO messages(conversation_id,deal_id,channel,direction,body,content_uri,status,author) VALUES(?,?,'whatsapp','in','Внешнее вложение','https://files.example.invalid/temporary.png','inbound','Клиент')").run(conv.body.id,deal.body.id);
    const proxied=(await call('/api/conversations/'+conv.body.id+'/messages')).body.find(m=>Number(m.id)===Number(remoteAttachment.lastInsertRowid));
    assert.equal(proxied.content_uri,`/api/messages/${remoteAttachment.lastInsertRowid}/file`,'партнёру не раскрывается временная внешняя ссылка на файл');
    assert.equal((await call('/api/conversations/'+foreignConv.body.id+'/messages')).status,403,'чужая история закрыта');
    assert.equal((await call('/api/templates')).status,200,'разрешённые шаблоны ответа доступны');
    const ownFile=await call(`/api/conversations/${conv.body.id}/upload`,{method:'POST',body:JSON.stringify({filename:'smeta.png',contentType:'image/png',dataBase64:PNG_B64})});
    assert.equal(ownFile.status,201);
    await call(`/api/conversations/${conv.body.id}/messages`,{method:'POST',body:JSON.stringify({body:'',contentUri:ownFile.body.url,contentName:ownFile.body.name,contentType:ownFile.body.contentType})});
    assert.equal((await fetch(base+ownFile.body.url,{headers:h})).status,200,'вложение переданной сделки доступно');
    assert.equal((await fetch(base+alienFile.body.url,{headers:h})).status,403,'чужое вложение закрыто');
    const convList=await call('/api/conversations');assert.ok(convList.body.length===1&&convList.body[0].contact_id===fcContact.body.id);
    assert.equal((await call('/api/dashboard')).body.unreadMine,0);

    h=adminHeaders;
    assert.equal((await call('/api/partner-transfers/'+granted.body.id,{method:'DELETE',body:JSON.stringify({reason:'Доступ отозван офисом'})})).status,200,'передача отозвана с причиной');
    h=partnerHeaders;
    assert.equal((await call('/api/deals')).body.deals.length,0,'список закрывается сразу после отзыва');
    assert.equal((await call('/api/deals/'+deal.body.id)).status,403,'старая ссылка на карточку закрывается сразу');
    assert.equal((await call('/api/contacts/'+fcContact.body.id)).status,403,'старая ссылка на контакт закрывается сразу');
    assert.equal((await call('/api/search?q='+encodeURIComponent('Сделка для передачи'))).body.deals.length,0,'поиск перестаёт находить сделку после отзыва');
    assert.equal((await call('/api/conversations')).body.length,0,'чат пропадает после отзыва');
    assert.equal((await call('/api/conversations/'+conv.body.id+'/messages')).status,403,'история и старые ссылки на сообщения закрываются');
    assert.equal((await call(`/api/messages/${remoteAttachment.lastInsertRowid}/file`)).status,403,'прокси-адрес внешнего файла закрывается после отзыва');
    assert.equal((await call('/api/conversations/'+conv.body.id+'/messages',{method:'POST',body:JSON.stringify({body:'Пишу после отзыва'})})).status,403,'отправка блокируется после отзыва');
    assert.equal((await fetch(base+ownFile.body.url,{headers:h})).status,403,'старый URL вложения закрывается после отзыва');
    assert.equal((await call('/api/deals/'+deal.body.id+'/print?doc=quote')).status,403,'печать закрывается после отзыва');
  } finally { h=adminHeaders; }
});

test('карточка получает только свои записи, нагрузка сотрудников считается на сервере', async () => {
  // Карточки клиента, компании и формы задач раньше забирали списки целиком и
  // отбирали нужное на месте: на базе в тысячи записей окно открывалось секунды.
  // Теперь сервер отдаёт только то, что относится к карточке, а числа нагрузки
  // считает группировкой — вкладкам настроек не нужны все сделки и задачи базы.
  const adminId = (await call('/api/users')).body.find(x => x.role === 'admin').id;
  const before = (await call('/api/users?stats=1')).body.find(x => x.id === adminId);
  const pipeBefore = (await call('/api/pipelines?stats=1')).body.find(x => x.id === 1);

  const co = await call('/api/companies', { method: 'POST', body: JSON.stringify({ name: 'ООО Фильтр Девяносто Шесть', inn: '7700000096' }) });
  assert.equal(co.status, 201, 'компания создана');
  const c1 = await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Клиент Фильтр Один', phone: '+79009600011', company_id: co.body.id }) });
  const c2 = await call('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Клиент Фильтр Два', phone: '+79009600022' }) });
  const d1 = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка Фильтр Один', amount: 100000, contact_id: c1.body.id, company_id: co.body.id, responsible_id: adminId }) });
  const d2 = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка Фильтр Два', amount: 200000, contact_id: c2.body.id, responsible_id: adminId }) });
  const t1 = await call('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'Задача Фильтр Один', contact_id: c1.body.id, deal_id: d1.body.id, responsible_id: adminId }) });
  await call('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'Задача Фильтр Два', contact_id: c2.body.id, responsible_id: adminId }) });
  assert.equal(d1.status, 201, 'сделка компании создана');
  assert.equal(t1.status, 201, 'задача сделки создана');

  const byContact = await call(`/api/deals?contact_id=${c1.body.id}`);
  assert.equal(byContact.status, 200, 'сделки по клиенту отдаются');
  assert.ok(byContact.body.deals.every(d => d.contact_id === c1.body.id), 'в ответе только сделки этого клиента');
  assert.ok(byContact.body.deals.some(d => d.id === d1.body.id), 'нужная сделка на месте');
  assert.ok(!byContact.body.deals.some(d => d.id === d2.body.id), 'чужая сделка не приходит');

  const byCompany = await call(`/api/deals?company_id=${co.body.id}`);
  assert.ok(byCompany.body.deals.some(d => d.id === d1.body.id), 'сделка компании на месте');
  const staff = await call(`/api/contacts?company_id=${co.body.id}`);
  assert.ok(staff.body.length >= 1 && staff.body.every(x => Number(x.company_id) === Number(co.body.id)), 'сотрудники только этой компании');
  assert.ok(staff.body.some(x => x.id === c1.body.id), 'нужный сотрудник на месте');

  const tByContact = await call(`/api/tasks?contact_id=${c1.body.id}`);
  assert.ok(tByContact.body.length >= 1 && tByContact.body.every(x => x.contact_id === c1.body.id), 'задачи только этого клиента');
  const tByDeal = await call(`/api/tasks?deal_id=${d1.body.id}`);
  assert.ok(tByDeal.body.every(x => x.deal_id === d1.body.id) && tByDeal.body.some(x => x.id === t1.body.id), 'задачи только этой сделки');

  // имя компании приходит в карточке сделки: справочник компаний ради одной
  // подписи больше не грузится
  const dealOne = await call(`/api/deals/${d1.body.id}`);
  assert.equal(dealOne.body.deal.company_name, 'ООО Фильтр Девяносто Шесть', 'имя компании есть в карточке сделки');

  // нагрузка: две новые сделки в работе на 300 000 и две новые открытые задачи
  const after = (await call('/api/users?stats=1')).body.find(x => x.id === adminId);
  assert.equal(Number(after.deals_open) - Number(before.deals_open), 2, 'сделки в работе посчитаны');
  assert.equal(Number(after.deals_sum) - Number(before.deals_sum), 300000, 'сумма сделок в работе посчитана');
  assert.equal(Number(after.tasks_open) - Number(before.tasks_open), 2, 'открытые задачи посчитаны');
  assert.ok(!('deals_open' in (await call('/api/users')).body[0]), 'без параметра нагрузка не отдаётся');
  const pipeAfter = (await call('/api/pipelines?stats=1')).body.find(x => x.id === 1);
  assert.equal(Number(pipeAfter.deals_total) - Number(pipeBefore.deals_total), 2, 'счётчик сделок воронки посчитан');
  assert.equal(Number(pipeAfter.deals_open) - Number(pipeBefore.deals_open), 2, 'счётчик открытых сделок воронки посчитан');
  assert.ok(!('deals_total' in (await call('/api/pipelines')).body[0]), 'без параметра счётчиков воронок нет');

  // подбор в формах просит один вид записей: лишние выборки не выполняются,
  // а общий поиск в шапке по-прежнему получает все пять списков
  const onlyC = await call('/api/search?q=' + encodeURIComponent('Фильтр') + '&only=contacts');
  assert.equal(onlyC.status, 200, 'поиск с only отвечает');
  assert.ok(onlyC.body.contacts.length > 0, 'нужный список найден');
  assert.equal(onlyC.body.deals.length, 0, 'чужие списки не выполняются');
  assert.equal(onlyC.body.products.length, 0, 'каталог не ищется без нужды');
  const fullSearch = await call('/api/search?q=' + encodeURIComponent('Фильтр'));
  assert.ok(fullSearch.body.contacts.length > 0 && fullSearch.body.deals.length > 0, 'общий поиск отдаёт все списки');

  // чужой объём работы партнёру не виден, даже если он попросит числа
  const created = await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Партнёр Нагрузка', email: 'partner-stats@example.com', password: 'partnerpassword1', role: 'partner' }) });
  assert.equal(created.status, 201, 'партнёр создан');
  const lp = await readyLogin('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'partner-stats@example.com', password: 'partnerpassword1' }) });
  const ph = { Authorization: 'Bearer ' + lp.body.token };
  const pUsers = await call('/api/users?stats=1', { headers: ph });
  assert.equal(pUsers.status, 200, 'партнёру список сотрудников доступен');
  assert.equal(pUsers.body.length, 1, 'партнёр видит только себя');
  assert.ok(!('deals_open' in pUsers.body[0]), 'чужая нагрузка партнёру не отдаётся');
  const pPipes = await call('/api/pipelines?stats=1', { headers: ph });
  assert.equal(pPipes.status, 200, 'воронки партнёру доступны');
  assert.ok(!('deals_total' in pPipes.body[0]), 'счётчики чужих воронок партнёру не отдаются');
  const pDeals = await call(`/api/deals?contact_id=${c1.body.id}`, { headers: ph });
  assert.ok(pDeals.body.deals.length === 0, 'чужие сделки партнёру не отдаются и с фильтром');
});

test('РОП и классификатор: команда, очередь, назначение, ограниченные поля и отчёты', async () => {
  const adminHeaders=h,suffix=String(Date.now());
  const made=[];
  try {
    const teamA=await call('/api/teams',{method:'POST',body:JSON.stringify({name:`Команда A ${suffix}`})});
    const teamB=await call('/api/teams',{method:'POST',body:JSON.stringify({name:`Команда B ${suffix}`})});
    assert.equal(teamA.status,201);assert.equal(teamB.status,201);
    const noTeam=await call('/api/users',{method:'POST',body:JSON.stringify({name:'РОП без команды',email:`rop-no-team-${suffix}@example.com`,password:`RopNoTeam-${suffix}-Pwd!`,role:'rop'})});
    assert.equal(noTeam.status,400,'руководителю нельзя выдать доступ без команды');
    let n=0;
    const createUser=async(role,teamId=null)=>{
      const password=`RolePass-${role}-${suffix}-${++n}!`,email=`${role}-${suffix}-${n}@example.com`;
      const created=await call('/api/users',{method:'POST',body:JSON.stringify({name:`${role} ${n} ${suffix}`,email,password,role,...(teamId?{team_id:teamId}:{})})});
      assert.equal(created.status,201,`учётная запись ${role} создана: ${JSON.stringify(created.body)}`);
      const login=await readyLogin('/api/auth/login',{method:'POST',body:JSON.stringify({email,password})});
      const value={id:created.body.id,role,headers:{Authorization:'Bearer '+login.body.token},name:created.body.name};made.push(value);return value;
    };
    const rop=await createUser('rop',teamA.body.id);
    const classifier=await createUser('classifier',teamA.body.id);
    const classifierOther=await createUser('classifier',teamB.body.id);
    const managerA=await createUser('manager',teamA.body.id);
    const managerB=await createUser('manager',teamA.body.id);
    const managerOff=await createUser('manager',teamA.body.id);
    const managerOther=await createUser('manager',teamB.body.id);
    for(const manager of [managerA,managerB,managerOther]){
      const started=await call('/api/shifts/start',{method:'POST',headers:manager.headers,body:'{}'});
      assert.equal(started.status,200,'смену начинает сам менеджер');
    }
    h=adminHeaders;
    const createLead=async(title,source=`Тест ${suffix}`,contactId=null)=>{
      const created=await call('/api/deals',{method:'POST',body:JSON.stringify({title,stage:'new',lead_source:source,contact_id:contactId})});
      assert.equal(created.status,201,`сделка создана: ${JSON.stringify(created.body)}`);return created.body;
    };
    const older=await createLead(`Старая очередь ${suffix}`),newer=await createLead(`Новая очередь ${suffix}`),urgent=await createLead(`Срочный лид ${suffix}`);
    const classificationContact=await call('/api/contacts',{method:'POST',body:JSON.stringify({name:`Контакт классификации ${suffix}`,phone:`+7900${suffix.slice(-7)}`})});
    assert.equal(classificationContact.status,201);
    const classLead=await createLead(`Разбор ${suffix}`,`Классификация ${suffix}`,classificationContact.body.id);
    const offShiftLead=await createLead(`Без смены ${suffix}`);
    const outsideLead=await createLead(`Вне команды ${suffix}`);
    const qOld='2020-01-01 00:00:00',qMid='2025-01-01 00:00:00',qNew='2026-01-01 00:00:00';
    for(const [deal,team,priority,queued] of [[older,teamA.body.id,'normal',qOld],[newer,teamA.body.id,'normal',qMid],[urgent,teamA.body.id,'urgent',qNew],[classLead,teamA.body.id,'normal',qNew],[offShiftLead,teamA.body.id,'normal',qNew],[outsideLead,teamB.body.id,'normal',qOld]])
      db.prepare('UPDATE lead_routing SET queue_team_id=?,priority=?,queued_at=? WHERE deal_id=?').run(team,priority,queued,deal.id);

    h=rop.headers;
    const managers=(await call('/api/routing/managers')).body;
    assert.ok(managers.some(m=>m.id===managerA.id)&&managers.some(m=>m.id===managerB.id),'список руководителя содержит менеджеров своей команды');
    assert.ok(!managers.some(m=>m.id===managerOther.id),'чужая команда не попадает в список');
    const availableClassifiers=await call('/api/classification/classifiers');
    assert.equal(availableClassifiers.status,200);
    assert.ok(availableClassifiers.body.some(c=>c.id===classifier.id)&&!availableClassifiers.body.some(c=>c.id===classifierOther.id),'классификаторы также ограничены командой');
    const queue=(await call('/api/routing/queue')).body;
    assert.ok(queue.queue.some(d=>d.id===classLead.id)&&!queue.queue.some(d=>d.id===outsideLead.id),'очередь ограничена командой');
    const sortedIds=queue.queue.filter(d=>[older.id,newer.id,urgent.id].includes(d.id)).map(d=>d.id);
    assert.deepEqual(sortedIds,[urgent.id,older.id,newer.id],'сначала срочные, затем обычные от старых к новым');
    const forbiddenRop=[
      ['/api/dashboard','GET'],['/api/deals','GET'],['/api/search?q=test','GET'],['/api/analytics','GET'],
      ['/api/export/deals','GET'],['/api/settings','GET'],['/api/teams','GET'],['/api/conversations','GET'],
      ['/api/bulk','POST']
    ];
    for(const [path,method] of forbiddenRop)assert.equal((await call(path,{method,...(method==='GET'?{}:{body:'{}'})})).status,403,`РОПу закрыт ${method} ${path}`);
    assert.equal((await call('/api/reports/team?team_id='+teamB.body.id)).status,403,'руководитель не читает сводку другой команды');

    const offShift=await call('/api/routing/assign',{method:'POST',body:JSON.stringify({deal_id:offShiftLead.id,manager_id:managerOff.id,reason:'Ручное назначение'})});
    assert.equal(offShift.status,409,'ручное назначение не обходит требование активной смены');
    const foreignAssign=await call('/api/routing/assign',{method:'POST',body:JSON.stringify({deal_id:outsideLead.id,manager_id:managerOther.id,reason:'Чужая команда'})});
    assert.equal(foreignAssign.status,403,'руководитель не назначает сделки другой команды');
    const assigned=await call('/api/routing/assign',{method:'POST',body:JSON.stringify({deal_id:older.id,manager_id:managerA.id,reason:'Менеджер на смене'})});
    assert.equal(assigned.status,200,'руководитель может назначить подходящего менеджера на смене');
    let assignedList=(await call('/api/routing/assigned')).body.assigned;
    assert.ok(assignedList.some(d=>d.id===older.id)&&!assignedList.some(d=>d.id===outsideLead.id),'назначенные лиды ограничены командой');
    const originalFirst=db.prepare('SELECT first_assigned_at,first_assigned_user_id FROM lead_routing WHERE deal_id=?').get(older.id);
    assert.ok(originalFirst.first_assigned_at&&Number(originalFirst.first_assigned_user_id)===managerA.id,'первая передача хранится отдельно от текущей');
    const originalStamp='2025-02-03 04:05:06';
    db.prepare('UPDATE lead_routing SET first_assigned_at=?,first_assigned_user_id=? WHERE deal_id=?').run(originalStamp,managerA.id,older.id);
    const returned=await call('/api/routing/return',{method:'POST',body:JSON.stringify({deal_id:older.id,reason:'Перераспределить нагрузку'})});
    assert.equal(returned.status,200);
    assert.equal((await call('/api/routing/assign',{method:'POST',body:JSON.stringify({deal_id:older.id,manager_id:managerB.id,reason:'Передача внутри команды'})})).status,200);
    const afterReassign=db.prepare('SELECT first_assigned_at,first_assigned_user_id FROM lead_routing WHERE deal_id=?').get(older.id);
    assert.equal(afterReassign.first_assigned_at,originalStamp,'возврат и переназначение не сбрасывают исходное время');
    assert.equal(Number(afterReassign.first_assigned_user_id),managerA.id,'сохраняется первый ответственный');

    h=adminHeaders;
    const conversation=await call('/api/conversations',{method:'POST',body:JSON.stringify({contact_id:classificationContact.body.id,chat_type:'whatsapp'})});
    assert.equal(conversation.status,201);
    h=rop.headers;
    db.prepare("INSERT INTO messages(conversation_id,deal_id,channel,direction,body,status,author) VALUES(?,?,'whatsapp','in','Нужен дом для постоянного проживания','inbound','Клиент')").run(conversation.body.id,classLead.id);
    db.prepare("INSERT INTO messages(conversation_id,deal_id,channel,direction,body,status,author) VALUES(?,?,'whatsapp','out','Здравствуйте, мы получили обращение','sent','Автоответ')").run(conversation.body.id,classLead.id);
    const classAssigned=await call('/api/classification/assign',{method:'POST',body:JSON.stringify({deal_id:classLead.id,classifier_id:classifier.id,reason:'Новая заявка на разбор'})});
    assert.equal(classAssigned.status,200);
    const classQueue=(await call('/api/classification/queue')).body;
    assert.ok(classQueue.items.some(d=>d.id===classLead.id),'руководитель видит назначенный разбор');
    assert.ok(classQueue.unassigned.some(d=>d.id===offShiftLead.id),'руководитель видит очередь без назначенного классификатора');

    h=classifier.headers;
    const ownQueue=await call('/api/classification/queue');
    assert.equal(ownQueue.status,200);
    assert.deepEqual(ownQueue.body.items.map(d=>d.id),[classLead.id],'классификатор видит только адресованные ему обращения');
    const detail=await call('/api/classification/deals/'+classLead.id);
    assert.equal(detail.status,200);
    assert.equal(detail.body.deal.amount,undefined,'сумма не отправляется классификатору');
    assert.equal(detail.body.deal.responsible_id,undefined,'ответственный не раскрывается классификатору');
    assert.equal(detail.body.deal.suggested_manager_id,undefined,'внутренняя рекомендация менеджера не раскрывается классификатору');
    assert.equal(detail.body.messages.length,1,'классификатор получает только входящие сообщения, не автоответ');
    assert.match(detail.body.messages[0].body,/постоянного проживания/);
    for(const path of ['/api/deals','/api/analytics','/api/export/deals','/api/search?q=разбор','/api/conversations','/api/classification/classifiers'])
      assert.equal((await call(path)).status,403,`классификатору закрыт ${path}`);
    assert.equal((await call('/api/deals/'+classLead.id,{method:'PATCH',body:JSON.stringify({amount:999999})})).status,403,'классификатор не меняет сумму сделки');
    assert.equal((await call('/api/bulk',{method:'POST',body:JSON.stringify({table:'deals',ids:[classLead.id],action:'delete'})})).status,403,'массовые операции классификатору закрыты');
    assert.equal((await call('/api/classification/deals/'+offShiftLead.id)).status,404,'чужая классификация скрыта по ID');
    const classified=await call('/api/classification/deals/'+classLead.id,{method:'PATCH',body:JSON.stringify({topic:'Постоянное проживание',region:'Рига',direction:'Каркасный дом',classification_note:'Уточнить бюджет',status:'complete',suggested_manager_id:managerA.id,amount:777})});
    assert.equal(classified.status,200,'классификатор изменяет только поля разметки');
    assert.equal(classified.body.deal.suggested_manager_id,undefined,'ответ классификатора не раскрывает внутреннюю рекомендацию');
    assert.equal(db.prepare('SELECT amount FROM deals WHERE id=?').get(classLead.id).amount,0,'присланная сумма проигнорирована');
    assert.equal(db.prepare('SELECT responsible_id FROM deals WHERE id=?').get(classLead.id).responsible_id,null,'готовая разметка сама не запускает несогласованное назначение');
    assert.equal(db.prepare('SELECT suggested_manager_id FROM lead_classifications WHERE deal_id=?').get(classLead.id).suggested_manager_id,null,'классификатор не может записать внутреннюю рекомендацию менеджера');

    h=adminHeaders;
    const slaSource=`SLA ${suffix}`;
    const slaDeal=await createLead(`SLA с переназначением ${suffix}`,slaSource);
    db.prepare('UPDATE lead_routing SET queue_team_id=?,queued_at=datetime(\'now\') WHERE deal_id=?').run(teamA.body.id,slaDeal.id);
    h=rop.headers;
    assert.equal((await call('/api/routing/assign',{method:'POST',body:JSON.stringify({deal_id:slaDeal.id,manager_id:managerA.id,reason:'Первая передача для SLA'})})).status,200);
    const time=s=>new Date(Date.now()+s*1000).toISOString().slice(0,19).replace('T',' ');
    const received=time(-20*60),firstAssigned=time(-10*60),currentAssigned=time(-2*60),firstResponse=time(-60);
    db.prepare('UPDATE lead_routing SET received_at=?,received_time_source=\'provider\',first_assigned_at=?,first_assigned_user_id=?,assigned_at=?,first_response_at=?,first_response_user_id=? WHERE deal_id=?')
      .run(received,firstAssigned,managerA.id,currentAssigned,firstResponse,managerA.id,slaDeal.id);
    const adminSettings=adminHeaders;
    h=adminSettings;
    assert.equal((await call('/api/settings',{method:'PUT',body:JSON.stringify({SLA_ASSIGN_MINUTES:5,SLA_FIRST_RESPONSE_MINUTES:5})})).status,200);
    h=rop.headers;
    const from=new Date(Date.now()-86400000).toISOString().slice(0,10),to=new Date().toISOString().slice(0,10);
    const query=new URLSearchParams({from,to,team_id:String(teamA.body.id),manager_id:String(managerA.id),source:slaSource});
    const report=await call('/api/reports/team?'+query);
    assert.equal(report.status,200);
    assert.equal(report.body.totals.leads,1,'источник, менеджер и период фильтруют отчёт на сервере');
    assert.equal(report.body.assignment.median_minutes,10,'время назначения идёт от первой передачи, не от переназначения');
    assert.equal(report.body.first_response.median_minutes,9,'первый ответ считается от исходного назначения живому сотруднику');
    assert.equal(report.body.assignment.violations,1,'нарушение порога назначения видно руководителю');
    assert.equal(report.body.first_response.violations,1,'нарушение порога ответа видно руководителю');
    const records=await call('/api/reports/team/records?'+new URLSearchParams({...Object.fromEntries(query),metric:'first_response'}));
    assert.equal(records.status,200);assert.equal(records.body.records.length,1);
    assert.equal(records.body.records[0].first_assigned_user_id,managerA.id,'в расшифровке виден первый ответственный, но не поля закрытой сделки');
    assert.equal(records.body.records[0].assignment_minutes,10);
    assert.equal(records.body.records[0].first_response_minutes,9);
    const noCalls=await call('/api/reports/team/records?'+new URLSearchParams({from,to,metric:'calls'}));
    assert.equal(noCalls.body.status,'нет данных','звонки без источника не выдумываются');
    assert.equal((await call('/api/reports/team?from=bad&to=bad')).status,400,'неверный период отклонён');
    h=managerA.headers;
    assert.equal((await call('/api/reports/team')).status,403,'менеджер не открывает сводку РОПа');
    const forbiddenManagerExport=await call('/api/export/deals');
    assert.equal(forbiddenManagerExport.status,403,'менеджеру запрещён экспорт сделок на сервере');
  } finally {
    h=adminHeaders;
    for(const user of made.filter(x=>x.role==='manager'))
      await call('/api/shifts/end',{method:'POST',headers:user.headers,body:JSON.stringify({reason:'Завершение тестовой смены'})}).catch(()=>{});
    await call('/api/settings',{method:'PUT',body:JSON.stringify({SLA_ASSIGN_MINUTES:'',SLA_FIRST_RESPONSE_MINUTES:''})}).catch(()=>{});
  }
});

test('автоответ и ответ живого сотрудника имеют разный учёт в SLA', async () => {
  const adminHeaders=h,suffix=String(Date.now());
  const manager=await call('/api/users',{method:'POST',body:JSON.stringify({name:`SLA менеджер ${suffix}`,email:`sla-human-${suffix}@example.com`,password:`SlaHuman-${suffix}-Pwd!`,role:'manager'})});
  assert.equal(manager.status,201);
  const login=await readyLogin('/api/auth/login',{method:'POST',body:JSON.stringify({email:`sla-human-${suffix}@example.com`,password:`SlaHuman-${suffix}-Pwd!`})});
  const managerHeaders={Authorization:'Bearer '+login.body.token};
  const contact=await call('/api/contacts',{method:'POST',body:JSON.stringify({name:`Клиент автоответа ${suffix}`,phone:`+7901${suffix.slice(-7)}`,responsible_id:manager.body.id})});
  assert.equal(contact.status,201);
  const deal=await call('/api/deals',{method:'POST',body:JSON.stringify({title:`Проверка первого ответа ${suffix}`,stage:'new',contact_id:contact.body.id,responsible_id:manager.body.id})});
  assert.equal(deal.status,201);
  const conversation=await call('/api/conversations',{method:'POST',body:JSON.stringify({contact_id:contact.body.id,chat_type:'whatsapp'})});
  assert.equal(conversation.status,201);
  const rule=await call('/api/automations',{method:'POST',body:JSON.stringify({name:`SLA автоответ ${suffix}`,trigger_type:'message_in',trigger_value:'проверка sla',action_type:'send_message',action_value:'Получили ваше обращение',active:1})});
  assert.equal(rule.status,201);
  const mock=(await import('node:http')).createServer(async(req,res)=>{
    for await(const _ of req){}
    if(req.url==='/message'&&req.method==='POST'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({messageId:`sla-mock-${Date.now()}`}));}
    res.writeHead(404);res.end('{}');
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  try{
    h=adminHeaders;
    await call('/api/settings',{method:'PUT',body:JSON.stringify({WAZZUP_API_KEY:'sla-test-key',WAZZUP_CHANNEL_ID:'sla-test-channel',WAZZUP_API_URL:`http://127.0.0.1:${mock.address().port}`})});
    await call('/webhooks/generic',{method:'POST',body:JSON.stringify({channel:'whatsapp',chatType:'whatsapp',phone:contact.body.phone||`+7901${suffix.slice(-7)}`,name:contact.body.name,body:'Проверка SLA: нужен расчёт',external_id:`sla-in-${suffix}`})});
    const auto=db.prepare('SELECT id,status,author FROM messages WHERE conversation_id=? AND automation_id=? ORDER BY id DESC LIMIT 1').get(conversation.body.id,rule.body.id);
    assert.ok(auto&&auto.status==='sent'&&auto.author==='Автоматизация','проверенный автоответ реально отправлен через подставной Wazzup');
    assert.equal(db.prepare('SELECT first_response_at FROM lead_routing WHERE deal_id=?').get(deal.body.id).first_response_at,null,'даже доставленный автоответ не закрывает SLA первого ответа');
    h=managerHeaders;
    const human=await call(`/api/conversations/${conversation.body.id}/messages`,{method:'POST',body:JSON.stringify({body:'Сотрудник ответил клиенту',chat_type:'whatsapp',deal_id:deal.body.id})});
    assert.equal(human.status,201);
    assert.equal(human.body.message.author,login.body.user.name,'ответ записан от имени живого сотрудника');
    const response=db.prepare('SELECT first_response_at,first_response_user_id FROM lead_routing WHERE deal_id=?').get(deal.body.id);
    assert.ok(response.first_response_at,'после живого ответа отметка SLA заполняется');
    assert.equal(Number(response.first_response_user_id),manager.body.id,'для SLA сохраняется автор первого ответа');
  }finally{
    h=adminHeaders;mock.close();
    await call('/api/automations/'+rule.body.id,{method:'DELETE'}).catch(()=>{});
    await call('/api/settings',{method:'PUT',body:JSON.stringify({WAZZUP_API_KEY:'',WAZZUP_CHANNEL_ID:'',WAZZUP_API_URL:'https://api.wazzup24.com/v3'})}).catch(()=>{});
  }
});
