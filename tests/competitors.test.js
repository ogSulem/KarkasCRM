// Тесты модуля «Конкуренты»: все внешние источники проверяются на локальных заглушках,
// чтобы проверять реальный формат запросов и разбор ответов без доступа в интернет.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = '/tmp/karkas-competitors-' + Date.now();
process.env.PORT = '18088';
// внешние источники замоканы на localhost — разрешаем внутренние адреса
process.env.ALLOW_PRIVATE_FETCH = '1';
const { server } = await import('../backend/src/server.js');
const base = 'http://127.0.0.1:18088';
const INN = '7700000001', OGRN = '1027700000001';
let h, mocks = {}, calls = [];
const call = (p, opt = {}) => fetch(base + p, { ...opt, headers: { 'Content-Type': 'application/json', ...(h || {}), ...(opt.headers || {}) } }).then(async r => ({ status: r.status, body: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text() }));

// ── локальные «внешние сервисы» ─────────────────────────────────────────
function mock(name, handler) {
  return new Promise(res => {
    const s = http.createServer(async (req, r) => {
      let b = ''; for await (const ch of req) b += ch;
      calls.push({ name, url: req.url, method: req.method, body: b });
      try { handler(req, r, b) } catch (e) { r.writeHead(500); r.end(String(e)) }
    });
    s.listen(0, '127.0.0.1', () => { mocks[name] = { server: s, port: s.address().port }; res() });
  });
}
const jsonReply = (r, obj, code = 200) => { r.writeHead(code, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(obj)) };

before(async () => {
  await mock('fns', (req, r, b) => {
    if (!/key=test-fns-key/.test(req.url)) return jsonReply(r, { error: 'bad key' }, 403);
    jsonReply(r, { items: [{ 'ЮЛ': { ИНН: INN, ОГРН: OGRN, НаимСокрЮЛ: 'ООО «Конкурент»', НаимПолнЮЛ: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ «КОНКУРЕНТ»', ДатаРег: '2015-04-02', Статус: 'Действующая', Регион: 'Москва', АдресПолн: 'г. Москва, ул. Стройная, 1', Руководитель: { ФИО: 'Иванов Иван Иванович' }, Учред: [{ ФИО: 'Иванов Иван Иванович' }], Недоимка: 145000, КолРаб: 24 } }] });
  });
  await mock('fedresurs', (req, r) => jsonReply(r, { pageData: [{ name: 'ООО «Конкурент»', inn: INN, ogrn: OGRN, caseNumber: 'А40-123/2024', isActive: true, date: '2024-06-01' }] }));
  await mock('fssp', (req, r) => {
    if (/\/search\/legal/.test(req.url)) return jsonReply(r, { response: { task: 'task-1' } });
    jsonReply(r, { response: { status: 1, result: [{ result: [{ exe_production: '12345/24/77001-ИП', subject: 'Взыскание задолженности по договору', bail_sum: 2500000, bailiff: 'Сидоров С.С.', department: 'ОСП по Москве' }] }] } });
  });
  await mock('kad', (req, r, b) => jsonReply(r, { Result: { Count: 7, Items: [{ CaseNumber: 'А40-555/2023', FilingDate: '2023-08-01', CaseId: 'case-1', Sides: [{ Inn: INN, SideType: 1 }] }, { CaseNumber: 'А40-777/2022', FilingDate: '2022-02-02', CaseId: 'case-2', Sides: [] }] } }));
  await mock('rusprofile', (req, r) => {
    if (/blocked/.test(req.url)) { r.writeHead(403); return r.end('captcha') }
    r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    r.end(`<html><head><title>ООО «Конкурент» — Москва — ИНН ${INN}</title></head><body><span itemprop="name">ООО «Конкурент»</span><span itemprop="address">г. Москва, ул. Стройная, 1</span>ИНН ${INN} ОГРН ${OGRN} Действующая организация <a href="/id/${OGRN}">карточка</a> 12 арбитражных дел</body></html>`);
  });
  await mock('google', (req, r) => {
    if (/textsearch/.test(req.url)) return jsonReply(r, { results: [{ place_id: 'p1', name: 'Конкурент', rating: 3.2, user_ratings_total: 41 }] });
    jsonReply(r, { result: { rating: 3.2, user_ratings_total: 41, formatted_address: 'Москва, Стройная 1', url: 'https://maps.google.com/p1', reviews: [{ author_name: 'Пётр', rating: 1, text: 'Сорвали сроки, дом поставили на месяц позже', relative_time_description: 'месяц назад' }, { author_name: 'Ольга', rating: 5, text: 'Всё ок', relative_time_description: 'год назад' }] } });
  });
  await mock('2gis', (req, r) => jsonReply(r, { result: { items: [{ id: 'g1', name: 'Конкурент', address_name: 'Москва, Стройная 1', reviews: { general_rating: 3.4, general_review_count: 18 } }] } }));
  await mock('yandex', (req, r) => jsonReply(r, { features: [{ properties: { name: 'Конкурент', CompanyMetaData: { address: 'Москва, Стройная 1', url: 'http://konkurent.ru', rating: 3.6, reviews: 22, Phones: [{ formatted: '+7 495 000-00-00' }] } } }] }));
  await new Promise(r => server.listening ? r() : server.once('listening', r));
  const l = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@example.com', password: 'admin12345' }) });
  h = { Authorization: 'Bearer ' + l.body.token };
});
after(() => { Object.values(mocks).forEach(m => m.server.close()); server.close() });
const url = n => `http://127.0.0.1:${mocks[n].port}`;

test('настройка источников: ключи и адреса, статус «настроен»', async () => {
  const r = await call('/api/competitor-sources', { method: 'PUT', body: JSON.stringify({
    FNS_API_KEY: 'test-fns-key', FSSP_TOKEN: 'test-fssp-token', GOOGLE_PLACES_KEY: 'test-google-key', TWOGIS_KEY: 'test-2gis-key', YANDEX_API_KEY: 'test-yandex-key',
    FNS_API_URL: url('fns'), FEDRESURS_API_URL: url('fedresurs'), FSSP_API_URL: url('fssp'), KAD_API_URL: url('kad'), RUSPROFILE_URL: url('rusprofile'), GOOGLE_API_URL: url('google'), TWOGIS_API_URL: url('2gis'), YANDEX_API_URL: url('yandex'),
  }) });
  assert.equal(r.body.saved, true);
  const s = await call('/api/competitor-sources');
  assert.ok(s.body.sources.find(x => x.key === 'fns').configured, 'ФНС настроена по ключу');
  assert.ok(s.body.keys.FSSP_TOKEN && s.body.keys.GOOGLE_PLACES_KEY, 'ключи сохранены');
});

test('«Пишем название конкурента» → полная проверка: долги, суды, банкротство, отзывы', async () => {
  const r = await call('/api/competitors/find', { method: 'POST', body: JSON.stringify({ name: 'ООО «Конкурент»', inn: INN }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.created, true, 'конкурент создан из названия');
  const rep = r.body.report, results = r.body.results;
  const by = k => results.find(x => x.source === k);
  assert.equal(by('fns').status, 'ok'); assert.equal(by('fns').data.card.director, 'Иванов Иван Иванович');
  assert.equal(by('fedresurs').status, 'ok'); assert.match(by('fedresurs').summary, /реестре банкротств/);
  assert.equal(by('fssp').status, 'ok');
  assert.equal(by('fssp').data.total, 2500000, 'сумма долгов по ФССП');
  assert.equal(by('kad').data.total, 7, 'число арбитражных дел');
  assert.equal(by('rusprofile').status, 'ok'); assert.equal(by('rusprofile').data.card.status, 'действующая');
  assert.equal(by('google').status, 'ok'); assert.equal(by('2gis').status, 'ok'); assert.equal(by('yandex').status, 'ok');
  // риск-скор и факторы
  assert.ok(rep.risk >= 60, 'высокий риск из-за долгов и банкротства: ' + rep.risk);
  assert.equal(rep.level, 'высокий');
  assert.ok(rep.factors.some(f => f.source === 'fssp' && /Долги/.test(f.text)));
  assert.ok(rep.factors.some(f => f.source === 'fedresurs'));
  assert.ok(rep.factors.some(f => f.source === 'fns' && /недоимка/i.test(f.text)));
  assert.ok(rep.factors.some(f => f.source === 'reviews' && /Слабая репутация/.test(f.text)));
  assert.ok(rep.verdict.length > 20, 'есть вердикт для менеджера');
  assert.ok(rep.talking_points.length >= 2, 'есть аргументы для разговора с клиентом');
  // отзывы сохранены в базу
  const full = await call('/api/competitors/' + r.body.competitor.id);
  assert.equal(full.body.reviews.filter(x => x.source === 'google').length, 2, 'отзывы с Google сохранены');
  assert.equal(full.body.reviews[0].source, 'google');
  // ссылки ручной проверки, включая пример пользователя /connections/<id>
  const links = rep.links.map(x => x.url);
  assert.ok(links.some(u => u.endsWith('/' + OGRN) || u.endsWith('/' + INN)), 'ссылка на связи Rusprofile по ИНН/ОГРН');
  assert.equal(rep.found.ogrn, OGRN, 'ОГРН подтянут из ФНС в отчёт');
  assert.equal(rep.found.director, 'Иванов Иван Иванович');
  assert.ok(links.some(u => u.startsWith('https://pb.nalog.ru')), 'ссылка на ФНС');
  assert.ok(links.some(u => u.startsWith('https://fssp.gov.ru')), 'ссылка на ФССП');
  assert.ok(links.some(u => u.startsWith('https://kad.arbitr.ru')), 'ссылка на арбитраж');
  assert.ok(links.some(u => /2gis\.ru/.test(u)) && links.some(u => /avito\.ru/.test(u)), 'ссылки на карты и Авито');
  assert.ok(rep.summary.some(s => /источников/.test(s)));
});

test('повторная проверка показывает изменения, а заблокированный сайт не ломает отчёт', async () => {
  const list = await call('/api/competitors');
  const comp = list.body[0];
  assert.ok(comp.risk >= 60 && comp.level === 'высокий', 'риск виден в списке');
  assert.equal(comp.reviews, 2, 'отзывы посчитаны');
  // имитируем блокировку Rusprofile
  await call('/api/competitor-sources', { method: 'PUT', body: JSON.stringify({ RUSPROFILE_URL: url('rusprofile') + '/blocked' }) });
  const r = await call(`/api/competitors/${comp.id}/check`, { method: 'POST', body: '{}' });
  assert.equal(r.status, 200, 'проверка не падает');
  const rp = r.body.results.find(x => x.source === 'rusprofile');
  assert.equal(rp.status, 'blocked', 'источник помечен как заблокированный');
  assert.match(rp.summary, /проверьте по ссылке/);
  assert.ok(rp.links.length > 3, 'ссылки ручной проверки на месте');
  assert.ok(r.body.report.risk >= 40, 'отчёт всё равно сформирован');
  assert.ok(Array.isArray(r.body.history) && r.body.history.length >= 2, 'история проверок ведётся');
});

test('без ключей источники честно помечаются «skipped»', async () => {
  const r = await call('/api/competitors/find', { method: 'POST', body: JSON.stringify({ name: 'ИП Без Канала', inn: '770000000999', sources: ['fssp', 'google'] }) });
  const results = r.body.results;
  // ключи были заданы ранее для других тестов — проверяем, что при пустых значениях статус skipped
  await call('/api/competitor-sources', { method: 'PUT', body: JSON.stringify({ FSSP_TOKEN: '', GOOGLE_PLACES_KEY: '' }) });
  const r2 = await call('/api/competitors/find', { method: 'POST', body: JSON.stringify({ name: 'ИП Без Канала 2', inn: '770000000998', sources: ['fssp', 'google'] }) });
  const s = r2.body.results.find(x => x.source === 'fssp');
  assert.equal(s.status, 'skipped');
  assert.match(s.summary, /токен|ключ/i);
  assert.ok(s.links.some(l => /fssp\.gov\.ru/.test(l.url)), 'ссылка для ручной проверки есть');
  assert.ok(results.every(x => ['ok', 'skipped', 'error', 'blocked'].includes(x.status)));
});

test('цены: Excel-файл конкурента и наша таблица → сравнение в отчёте', async () => {
  const list = await call('/api/competitors');
  const comp = list.body.find(c => c.inn === INN);
  // наш прайс из настоящего .xlsx (сгенерирован Excel, проверяем и парсер, и API)
  const xlsx = readFileSync(fileURLToPath(new URL('./fixtures/price.xlsx', import.meta.url))).toString('base64');
  const ours = await call(`/api/competitors/${comp.id}/prices`, { method: 'POST', body: JSON.stringify({ base64: xlsx, filename: 'price.xlsx', scope: 'ours' }) });
  assert.equal(ours.body.imported, 5, 'из .xlsx распознано 5 позиций');
  assert.equal(ours.body.rows[0].scope, 'ours');
  assert.ok(ours.body.rows.some(r => r.item.includes('8×10') && r.price === 3850000), 'название и цена разобраны верно');
  // прайс конкурента — CSV с другими ценами
  const theirs = await call(`/api/competitors/${comp.id}/prices`, { method: 'POST', body: JSON.stringify({ csv: 'Наименование;Цена;Ед.\nКаркасный дом 8×10 «Север»;4200000;шт\nКаркасный дом 6×8 с террасой;2500000;шт\nБаня 4×6 под ключ;910000;шт\n', filename: 'konkurent.csv', scope: 'competitor' }) });
  assert.equal(theirs.body.imported, 3);
  const r = await call(`/api/competitors/${comp.id}/check`, { method: 'POST', body: JSON.stringify({ sources: ['fns'] }) });
  const pr = r.body.report.pricing;
  assert.ok(pr, 'блок сравнения цен сформирован');
  assert.equal(pr.pairs.length, 3, 'сопоставлено 3 позиции');
  assert.equal(pr.pairs.find(p => /8×10/.test(p.item)).theirs, 4200000);
  assert.equal(pr.pairs.find(p => /8×10/.test(p.item)).ours, 3850000);
  assert.equal(pr.expensive, 2); assert.equal(pr.cheaper, 1);
  assert.ok(typeof pr.avgDiff === 'number' && pr.avgDiff > 0, 'средняя разница цен посчитана: ' + pr.avgDiff + '%');
  assert.ok(r.body.report.verdict.length > 20);
});

test('прайс можно вставить текстом — без файла', async () => {
  const list = await call('/api/competitors');
  const comp = list.body.find(c => c.inn === INN);
  const ins = await call(`/api/competitors/${comp.id}/prices`, { method: 'POST', body: JSON.stringify({
    text: 'Наименование;Цена;Ед.\nКаркасный дом 8×10 «Север»;4000000;шт\nБаня 4×6;900000;шт\n',
    scope: 'competitor'
  }) });
  assert.equal(ins.status, 201, 'текстовая таблица принимается');
  assert.equal(ins.body.imported, 2, 'обе строки распознаны');
  assert.ok(ins.body.rows.every(r => r.price > 0), 'цены — числа');
  const bad = await call(`/api/competitors/${comp.id}/prices`, { method: 'POST', body: JSON.stringify({ text: '', scope: 'competitor' }) });
  assert.equal(bad.status, 400, 'пустая таблица — понятная ошибка');
});

test('отзывы добавляются вручную и удаляются', async () => {
  const list = await call('/api/competitors');
  const comp = list.body[0];
  const add = await call(`/api/competitors/${comp.id}/reviews`, { method: 'POST', body: JSON.stringify({ source: 'Авито', rating: 2, text: 'Долго не отвечали, цена выросла в процессе', author: 'Менеджер' }) });
  assert.equal(add.status, 201);
  const full = await call('/api/competitors/' + comp.id);
  const mine = full.body.reviews.find(r => r.source === 'Авито');
  assert.ok(mine && mine.rating === 2);
  const del = await call('/api/reviews/' + mine.id, { method: 'DELETE' });
  assert.equal(del.body.deleted, true);
  const after = await call('/api/competitors/' + comp.id);
  assert.ok(!after.body.reviews.find(r => r.id === mine.id));
});

test('прайс-лист доступен отдельно: наш и конкурента', async () => {
  const ours = await call('/api/prices?scope=ours');
  assert.equal(ours.body.rows.length, 5);
  const list = await call('/api/competitors');
  const target = list.body.find(c => c.inn === INN);
  const theirs = await call('/api/prices?scope=competitor&competitor=' + target.id);
  assert.ok(theirs.body.rows.length >= 1);
});

test('конкурент редактируется и удаляется', async () => {
  const created = await call('/api/competitors', { method: 'POST', body: JSON.stringify({ name: 'ООО Удаляемый', inn: '5000000000', city: 'Химки' }) });
  const id = created.body.id;
  const patched = await call('/api/competitors/' + id, { method: 'PATCH', body: JSON.stringify({ name: 'ООО Изменённый', website: 'https://example.com' }) });
  assert.equal(patched.body.name, 'ООО Изменённый');
  assert.equal(patched.body.website, 'https://example.com');
  const del = await call('/api/competitors/' + id, { method: 'DELETE' });
  assert.equal(del.body.deleted, true);
  assert.equal((await call('/api/competitors/' + id)).status, 404);
});

test('наш прайс загружается из настроек, без привязки к конкуренту', async () => {
  const before = (await call('/api/prices?scope=ours')).body.rows.length;
  const r = await call('/api/prices', { method: 'POST', body: JSON.stringify({ csv: 'Позиция;Цена\nКаркасный дом 8×10 «Север»;3900000\nБаня 4×6 под ключ;920000\n', filename: 'nash.csv', scope: 'ours' }) });
  assert.equal(r.status, 201);
  assert.equal(r.body.imported, 2);
  assert.equal(r.body.scope, 'ours');
  const after = (await call('/api/prices?scope=ours')).body.rows;
  assert.equal(after.length, 2, 'таблица заменена (было ' + before + ')');
  const comp = (await call('/api/competitors')).body.find(c => c.inn === INN);
  const chk = await call(`/api/competitors/${comp.id}/check`, { method: 'POST', body: JSON.stringify({ sources: ['fns'] }) });
  assert.ok(chk.body.report.pricing, 'сравнение цен пересчитано с новой нашей таблицей');
});

test('чистая установка: в списке только конкуренты, добавленные пользователем', async () => {
  const list = (await call('/api/competitors')).body;
  assert.ok(list.length >= 1, 'после проверок в системе есть карточки конкурентов');
  assert.ok(!list.some(c => /демо|пример/i.test(c.name)), 'предзаполненных примеров в базе нет');
  const comp = list.find(c => c.inn === INN);
  assert.ok(comp, 'конкурент, добавленный через проверку, сохранился');
  const full = (await call('/api/competitors/' + comp.id)).body;
  assert.ok(full.report.links.some(l => /rusprofile/.test(l.url)), 'есть ссылки ручной проверки');
});

test('источник без соединения помечается «blocked», а отчёт честно сообщает о нехватке данных', async () => {
  await call('/api/competitor-sources', { method: 'PUT', body: JSON.stringify({ RUSPROFILE_URL: 'http://127.0.0.1:9', FEDRESURS_API_URL: 'http://127.0.0.1:9', KAD_API_URL: 'http://127.0.0.1:9', COMPETITOR_TIMEOUT_MS: '1500', FNS_API_KEY: '', FSSP_TOKEN: '', GOOGLE_PLACES_KEY: '', TWOGIS_KEY: '', YANDEX_API_KEY: '' }) });
  const r = await call('/api/competitors/find', { method: 'POST', body: JSON.stringify({ name: 'ООО Без Связи', inn: '6600000000' }) });
  const st = r.body.results.map(x => x.status);
  assert.ok(st.includes('blocked'), 'недоступные сайты помечены blocked: ' + JSON.stringify(st));
  assert.ok(st.includes('skipped'), 'источники без ключей помечены skipped');
  assert.equal(r.body.report.noData, true, 'отчёт понимает, что данных нет');
  assert.match(r.body.report.verdict, /Данных пока мало/, 'честный вердикт вместо ложных выводов');
  assert.ok(r.body.report.dataQuality.blocked + r.body.report.dataQuality.skipped === 8, 'посчитано качество данных по источникам');
  assert.ok(r.body.report.links.length >= 10, 'ссылки ручной проверки всё равно сформированы');
});
