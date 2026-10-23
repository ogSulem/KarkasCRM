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
    // форма ответа api-fns.ru/api/egr: адрес, руководитель, ОКВЭД и численность
    // лежат во вложенных объектах — заглушка повторяет именно реальную структуру
    jsonReply(r, { items: [{ 'ЮЛ': { ИНН: INN, ОГРН: OGRN, КПП: '770001001', НаимСокрЮЛ: 'ООО «Конкурент»', НаимПолнЮЛ: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ «КОНКУРЕНТ»', ДатаРег: '2015-04-02', Статус: 'Действующая', Регион: 'Москва', Адрес: { АдресПолн: 'г. Москва, ул. Стройная, 1' }, Руководитель: { ФИОПолн: 'Иванов Иван Иванович', Должность: 'ГЕНЕРАЛЬНЫЙ ДИРЕКТОР' }, ОснВидДеят: { Код: '41.20', Текст: 'Строительство жилых и нежилых зданий' }, ОткрСведения: { КолРаб: 24 }, Учредители: [{ Фамилия: 'Иванов', Имя: 'Иван', Отчество: 'Иванович', ДоляУставКап: 10000 }], Недоимка: 145000 } }] });
  });
  await mock('fedresurs', (req, r) => jsonReply(r, { pageData: [{ name: 'ООО «Конкурент»', inn: INN, ogrn: OGRN, caseNumber: 'А40-123/2024', isActive: true, date: '2024-06-01' }] }));
  // форма ответа kad.arbitr.ru/Kad/SearchInstances: TotalCount, Date, стороны —
  // в Plaintiffs/Respondents .Participants (полей Count, FilingDate и Sides там нет)
  await mock('kad', (req, r, b) => jsonReply(r, { Result: { Page: 1, PageSize: 25, PagesCount: 1, TotalCount: 7, Items: [
    { CaseId: 'case-1', CaseNumber: 'А40-555/2023', CaseType: 'А', CourtName: 'АС города Москвы', Judge: 'Иванова И.И.', Date: '2023-08-01T00:00:00', Plaintiffs: { Count: 1, Participants: [{ Name: 'ООО «Поставщик»', Inn: '7700000009' }] }, Respondents: { Count: 1, Participants: [{ Name: 'ООО «Конкурент»', Inn: INN }] } },
    { CaseId: 'case-2', CaseNumber: 'А40-777/2022', CaseType: 'Г', CourtName: 'АС города Москвы', Date: '2022-02-02T00:00:00', Plaintiffs: { Count: 1, Participants: [{ Name: 'ООО «Конкурент»', Inn: INN }] }, Respondents: { Count: 1, Participants: [{ Name: 'ООО «Заказчик»', Inn: '7700000008' }] } },
  ] }, Message: '', Success: true }));
  await mock('rusprofile', (req, r) => {
    if (/blocked/.test(req.url)) { r.writeHead(403); return r.end('captcha') }
    r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    r.end(`<html><head><title>ООО «Конкурент» — Москва — ИНН ${INN}</title></head><body><span itemprop="name">ООО «Конкурент»</span><span itemprop="address">г. Москва, ул. Стройная, 1</span>ИНН ${INN} ОГРН ${OGRN} Действующая организация <a href="/id/${OGRN}">карточка</a> 12 арбитражных дел</body></html>`);
  });
  // Places API (New): карточка и отзывы приходят одним ответом на POST places:searchText.
  // Legacy-ветка оставлена — её проверяем отдельным тестом.
  await mock('google', (req, r) => {
    if (/places:searchText/.test(req.url)) return jsonReply(r, { places: [{ displayName: { text: 'Конкурент' }, formattedAddress: 'Москва, Стройная 1', nationalPhoneNumber: '+7 495 000-00-00', googleMapsUri: 'https://maps.google.com/p1', rating: 3.2, userRatingCount: 41, reviews: [{ author: { displayName: 'Пётр' }, rating: 1, text: { text: 'Сорвали сроки, дом поставили на месяц позже' }, relativePublishTimeDescription: 'месяц назад' }, { author: { displayName: 'Ольга' }, rating: 5, text: { text: 'Всё ок' }, relativePublishTimeDescription: 'год назад' }] }] });
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
    FNS_API_KEY: 'test-fns-key', GOOGLE_PLACES_KEY: 'test-google-key', TWOGIS_KEY: 'test-2gis-key', YANDEX_API_KEY: 'test-yandex-key',
    FNS_API_URL: url('fns'), FEDRESURS_API_URL: url('fedresurs'), KAD_API_URL: url('kad'), RUSPROFILE_URL: url('rusprofile'), GOOGLE_API_URL: url('google'), TWOGIS_API_URL: url('2gis'), YANDEX_API_URL: url('yandex'),
  }) });
  assert.equal(r.body.saved, true);
  const s = await call('/api/competitor-sources');
  assert.ok(s.body.sources.find(x => x.key === 'fns').configured, 'ФНС настроена по ключу');
  assert.ok(s.body.keys.GOOGLE_PLACES_KEY, 'ключи сохранены');
  assert.ok(!('FSSP_TOKEN' in s.body.keys), 'токена ФССП в настройках нет: официальный API закрыт с 2022 года');
  assert.ok(!('FSSP_API_URL' in s.body.urls), 'адреса ФССП в настройках нет');
  const fsspDef = s.body.sources.find(x => x.key === 'fssp');
  assert.equal(fsspDef.needs.length, 0, 'ФССП больше не требует ключ');
  assert.match(fsspDef.about, /закрыт/, 'в описании источника сказано, что API закрыт');
});

test('«Пишем название конкурента» → полная проверка: долги, суды, банкротство, отзывы', async () => {
  const r = await call('/api/competitors/find', { method: 'POST', body: JSON.stringify({ name: 'ООО «Конкурент»', inn: INN }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.created, true, 'конкурент создан из названия');
  const rep = r.body.report, results = r.body.results;
  const by = k => results.find(x => x.source === k);
  assert.equal(by('fns').status, 'ok');
  const fnsCard = by('fns').data.card;
  assert.equal(fnsCard.director, 'Иванов Иван Иванович', 'руководитель взят из вложенного Руководитель.ФИОПолн');
  assert.equal(fnsCard.address, 'г. Москва, ул. Стройная, 1', 'адрес взят из вложенного Адрес.АдресПолн');
  assert.equal(fnsCard.okved, '41.20', 'ОКВЭД взят из ОснВидДеят.Код');
  assert.equal(fnsCard.employees, 24, 'численность взята из ОткрСведения.КолРаб');
  assert.equal(fnsCard.founders[0], 'Иванов Иван Иванович', 'учредитель собран из Фамилия/Имя/Отчество');
  assert.equal(by('fedresurs').status, 'ok'); assert.match(by('fedresurs').summary, /реестре банкротств/);
  assert.equal(by('fssp').status, 'skipped', 'официальный API ФССП закрыт — запрос не уходит вовсе');
  assert.equal(by('fssp').data.total, null, 'прочерк вместо нуля: ноль читался бы как «долгов нет»');
  assert.equal(by('kad').data.total, 7, 'число дел взято из TotalCount, а не из длины страницы');
  assert.equal(by('kad').data.cases[0].role, 'ответчик', 'роль определена по Respondents.Participants');
  assert.equal(by('kad').data.cases[1].role, 'истец', 'роль определена по Plaintiffs.Participants');
  assert.equal(by('kad').data.cases[0].date, '2023-08-01', 'дата взята из поля Date');
  assert.equal(by('kad').data.cases[0].court, 'АС города Москвы', 'суд и судья отдаются менеджеру');
  // запрос в картотеку соответствует документированному контракту kad.arbitr.ru
  const kadCall = calls.filter(c => c.name === 'kad').pop();
  assert.equal(kadCall.method, 'POST');
  assert.deepEqual(JSON.parse(kadCall.body).Sides, [{ Name: INN, Type: -1, ExactMatch: false }], 'сторона задаётся строкой Name (ИНН), Type -1 = любая сторона');
  assert.equal(by('rusprofile').status, 'ok'); assert.equal(by('rusprofile').data.card.status, 'действующая');
  assert.equal(by('google').status, 'ok'); assert.equal(by('2gis').status, 'ok'); assert.equal(by('yandex').status, 'ok');
  // риск-скор и факторы
  assert.ok(rep.risk >= 60, 'высокий риск из-за долгов и банкротства: ' + rep.risk);
  assert.equal(rep.level, 'высокий');
  assert.ok(!rep.factors.some(f => f.source === 'fssp'), 'фактора про долги нет: официального API ФССП не существует');
  assert.ok(rep.factors.some(f => f.source === 'fedresurs'));
  assert.ok(rep.factors.some(f => f.source === 'fns' && /недоимка/i.test(f.text)));
  assert.ok(rep.factors.some(f => f.source === 'reviews' && /Слабая репутация/.test(f.text)));
  assert.ok(rep.verdict.length > 20, 'есть вердикт для менеджера');
  assert.ok(rep.talking_points.length >= 2, 'есть аргументы для разговора с клиентом');
  // отзывы сохранены в базу
  const full = await call('/api/competitors/' + r.body.competitor.id);
  assert.equal(full.body.reviews.filter(x => x.source === 'google').length, 2, 'отзывы с Google сохранены');
  assert.equal(full.body.reviews[0].source, 'google');
  // ссылки ручной проверки ведут только на существующие адреса
  const links = rep.links.map(x => x.url);
  assert.ok(links.some(u => u.includes(INN)), 'в ссылках ручной проверки есть ИНН конкурента');
  assert.ok(!links.some(u => /rusprofile\.ru\/(connections|search\/advanced)/.test(u)), 'нет адресов Rusprofile, которых не существует');
  assert.ok(!links.some(u => /rusprofile\.ru\/id\/\d{13}/.test(u)), 'карточка юрлица не собирается из ОГРН: в /id/ у Rusprofile внутренний номер');
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

test('без ключей источники помечаются «skipped»', async () => {
  // ключи были заданы ранее для других тестов — проверяем поведение при пустых значениях
  await call('/api/competitor-sources', { method: 'PUT', body: JSON.stringify({ GOOGLE_PLACES_KEY: '' }) });
  const r2 = await call('/api/competitors/find', { method: 'POST', body: JSON.stringify({ name: 'ИП Без Канала 2', inn: '770000000998', sources: ['fssp', 'google'] }) });
  const s = r2.body.results.find(x => x.source === 'fssp');
  assert.equal(s.status, 'skipped');
  assert.match(s.summary, /API ФССП закрыт/, 'в сводке сказано, что официального API больше нет');
  assert.equal(s.data.total, null, 'прочерк вместо нуля — ноль читался бы как «долгов нет»');
  assert.ok(s.links.some(l => /fssp\.gov\.ru/.test(l.url)), 'ссылка для ручной проверки есть');
  const ggl = r2.body.results.find(x => x.source === 'google');
  assert.equal(ggl.status, 'skipped');
  assert.match(ggl.summary, /Не задан ключ/);
  assert.ok(r2.body.results.every(x => ['ok', 'skipped', 'error', 'blocked'].includes(x.status)));
});

test('Google: старый Places API работает, если адрес указан на maps.googleapis.com', async () => {
  // С октября 2026 Legacy не включается в новых проектах, но в старых продолжает
  // работать — запасной путь выбирается по адресу и остаётся проверенным.
  await call('/api/competitor-sources', { method: 'PUT', body: JSON.stringify({ GOOGLE_PLACES_KEY: 'test-google-key', GOOGLE_API_URL: url('google') + '/maps/api' }) });
  const r = await call('/api/competitors/find', { method: 'POST', body: JSON.stringify({ name: 'ООО «Конкурент»', inn: INN, sources: ['google'] }) });
  const g = r.body.results.find(x => x.source === 'google');
  assert.equal(g.status, 'ok');
  assert.equal(g.data.card.rating, 3.2, 'рейтинг разобран из legacy-ответа');
  assert.equal(g.data.reviews.length, 2, 'отзывы подтянуты вторым запросом details');
  const used = calls.filter(c => c.name === 'google').slice(-2).map(c => c.url);
  assert.ok(used.some(u => u.includes('/place/textsearch/json')), 'использован старый эндпоинт textsearch');
  // возвращаем современный адрес: следующие проверки идут через Places API (New)
  await call('/api/competitor-sources', { method: 'PUT', body: JSON.stringify({ GOOGLE_API_URL: url('google') }) });
});

test('цены: Excel-файл конкурента и наша таблица → сравнение в отчёте', async () => {
  const list = await call('/api/competitors');
  const comp = list.body.find(c => c.inn === INN);
  // наш прайс из настоящего .xlsx (сгенерирован Excel, проверяем и парсер, и API)
  const xlsx = readFileSync(fileURLToPath(new URL('./fixtures/price.xlsx', import.meta.url))).toString('base64');
  const ours = await call(`/api/competitors/${comp.id}/prices`, { method: 'POST', body: JSON.stringify({ base64: xlsx, filename: 'price.xlsx', scope: 'ours' }) });
  assert.equal(ours.body.imported, 5, 'из .xlsx распознано 5 позиций');
  assert.equal(ours.body.added + ours.body.updated, 5, 'каждая строка файла либо добавлена, либо обновила позицию каталога');
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

test('наш прайс-лист и каталог — один список, а прайс конкурента хранится отдельно', async () => {
  const ours = await call('/api/prices?scope=ours');
  assert.ok(ours.body.rows.length >= 5, 'в нашем прайсе позиции из загруженного файла');
  assert.equal(ours.body.source, 'catalog', 'наш прайс берётся из каталога');
  assert.ok(ours.body.rows.every(r => r.scope === 'ours' && r.product_id), 'каждая строка ссылается на позицию каталога');
  // каталог и прайс-лист совпадают: вести два списка больше не нужно
  const catalog = await call('/api/products');
  const catalogNames = catalog.body.filter(p => p.active).map(p => p.name).sort();
  assert.deepEqual(ours.body.rows.map(r => r.item).sort(), catalogNames, 'наш прайс = позиции каталога в продаже');
  const list = await call('/api/competitors');
  const target = list.body.find(c => c.inn === INN);
  const theirs = await call('/api/prices?scope=competitor&competitor=' + target.id);
  assert.ok(theirs.body.rows.length >= 1);
  assert.ok(!theirs.body.rows.some(r => r.product_id), 'прайс конкурента не смешан с каталогом');
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

test('наш прайс загружается из настроек: знакомые позиции обновляются, новые добавляются', async () => {
  const before = (await call('/api/prices?scope=ours')).body.rows;
  const r = await call('/api/prices', { method: 'POST', body: JSON.stringify({ csv: 'Позиция;Цена\nКаркасный дом 8×10 «Север»;3900000\nГараж каркасный 4×6;420000\n', filename: 'nash.csv', scope: 'ours' }) });
  assert.equal(r.status, 201);
  assert.equal(r.body.imported, 2);
  assert.equal(r.body.scope, 'ours');
  assert.equal(r.body.updated, 1, 'позиция с тем же названием получила новую цену');
  assert.equal(r.body.added, 1, 'новая позиция добавлена в каталог');
  const after = (await call('/api/prices?scope=ours')).body.rows;
  assert.equal(after.length, before.length + 1, 'остальные позиции не потеряны (было ' + before.length + ')');
  assert.equal(after.find(x => /Гараж/.test(x.item)).price, 420000);
  assert.equal(after.find(x => /8×10 «Север»/.test(x.item)).price, 3900000, 'цена обновилась');
  // каталог показывает ту же цену: источник один
  const catalog = (await call('/api/products')).body;
  assert.equal(catalog.find(p => /8×10 «Север»/.test(p.name)).price, 3900000, 'цена в каталоге та же, что в прайсе');
  const comp = (await call('/api/competitors')).body.find(c => c.inn === INN);
  const chk = await call(`/api/competitors/${comp.id}/check`, { method: 'POST', body: JSON.stringify({ sources: ['fns'] }) });
  assert.ok(chk.body.report.pricing, 'сравнение цен пересчитано с новой нашей таблицей');
  assert.equal(chk.body.report.pricing.pairs.find(p => /8×10/.test(p.item)).ours, 3900000, 'в отчёте свежая цена из каталога');
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

test('прайс можно не только загрузить, но и скачать обратно таблицей', async () => {
  await call('/api/prices', { method: 'POST', body: JSON.stringify({ csv: 'Позиция;Цена;Ед\nДом 8×10 «Север»;3900000;шт\nБаня 4×6;920000;шт\n', scope: 'ours' }) });
  const r = await fetch(base + '/api/prices/export?scope=ours', { headers: h });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition') || '', /our-prices\.csv/);
  assert.match(r.headers.get('content-type') || '', /text\/csv/);
  const bytes = Buffer.from(await r.clone().arrayBuffer());
  assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf', 'BOM — Excel откроет файл в UTF-8 и не сломает кириллицу');
  const text = await r.text(); // Response.text() сам снимает BOM — как это делает Excel
  assert.match(text, /Наименование;Цена;Ед;Артикул;Примечание/);
  assert.match(text, /Дом 8×10 «Север»/);
  // скачанный файл загружается обратно без правок и не плодит дубли
  const was = (await call('/api/prices?scope=ours')).body.rows.length;
  const again = await call('/api/prices', { method: 'POST', body: JSON.stringify({ csv: text.replace('\uFEFF', ''), scope: 'ours' }) });
  assert.equal(again.body.imported, was, 'своя же выгрузка разбирается тем же парсером');
  assert.equal(again.body.added, 0, 'знакомые позиции не дублируются');
  assert.equal((await call('/api/prices?scope=ours')).body.rows.length, was, 'число позиций после повторной загрузки то же');
  // прайс конкурента
  const comp = (await call('/api/competitors')).body.find(c => c.inn === INN);
  const cRes = await fetch(base + `/api/prices/export?scope=competitor&competitor=${comp.id}`, { headers: h });
  assert.equal(cRes.status, 200);
  assert.match(cRes.headers.get('content-disposition') || '', new RegExp(`competitor-${comp.id}\\.csv`));
  assert.match(await cRes.text(), /Наименование;Цена/);
  // без входа файл не отдаётся
  assert.equal((await fetch(base + '/api/prices/export?scope=ours')).status, 401);
});

test('поиск конкурента понимает поле query из интерфейса', async () => {
  const r = await call('/api/competitors/find', { method: 'POST', body: JSON.stringify({ query: 'ООО «Запрос Query»', city: 'Тула' }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.created, true, 'карточка создана');
  assert.match(r.body.competitor.name, /Запрос Query/);
  assert.ok(Array.isArray(r.body.results) && r.body.results.length === 8, 'проверка прошла по всем источникам');
  const empty = await call('/api/competitors/find', { method: 'POST', body: JSON.stringify({ query: '   ' }) });
  assert.equal(empty.status, 400);
  assert.match(empty.body.error, /название или ИНН/);
});

test('диагностика источников: видно, кто отвечает, а кто просит ключ', async () => {
  await call('/api/competitor-sources', { method: 'PUT', body: JSON.stringify({
    RUSPROFILE_URL: url('rusprofile'), FEDRESURS_API_URL: url('fedresurs'), KAD_API_URL: url('kad'),
    FNS_API_URL: url('fns'), GOOGLE_API_URL: url('google'),
    TWOGIS_API_URL: url('2gis'), YANDEX_API_URL: url('yandex'), COMPETITOR_TIMEOUT_MS: '5000',
    FNS_API_KEY: 'test-fns-key', GOOGLE_PLACES_KEY: 'test-google-key',
    TWOGIS_KEY: 'test-2gis-key', YANDEX_API_KEY: 'test-yandex-key',
  }) });
  const r = await call('/api/competitor-sources/check', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal(r.body.results.length, 8, 'проверены все источники');
  assert.ok(r.body.results.every(x => x.name && x.status && typeof x.ms === 'number' && 'needsKey' in x && 'keySet' in x), 'у каждого источника статус и время ответа');
  const okCount = r.body.results.filter(x => x.status === 'ok').length;
  assert.ok(okCount >= 6, 'источники отвечают: ' + JSON.stringify(r.body.results.map(x => x.status)));
  // диагностика ничего не пишет в базу
  const list = (await call('/api/competitors')).body;
  assert.ok(!list.some(c => /Сбербанк/.test(c.name)), 'тестовая компания не стала карточкой конкурента');
  // ключи убираем — источник помечается «нужен ключ»
  await call('/api/competitor-sources', { method: 'PUT', body: JSON.stringify({ FNS_API_KEY: '' }) });
  const r2 = await call('/api/competitor-sources/check', { method: 'POST' });
  const fns = r2.body.results.find(x => x.key === 'fns');
  assert.equal(fns.status, 'skipped');
  assert.equal(fns.keySet, false);
  assert.match(fns.summary, /Не задан ключ/);
});

test('источник без соединения помечается «blocked», а отчёт сообщает о нехватке данных', async () => {
  await call('/api/competitor-sources', { method: 'PUT', body: JSON.stringify({ RUSPROFILE_URL: 'http://127.0.0.1:9', FEDRESURS_API_URL: 'http://127.0.0.1:9', KAD_API_URL: 'http://127.0.0.1:9', COMPETITOR_TIMEOUT_MS: '1500', FNS_API_KEY: '', GOOGLE_PLACES_KEY: '', TWOGIS_KEY: '', YANDEX_API_KEY: '' }) });
  const r = await call('/api/competitors/find', { method: 'POST', body: JSON.stringify({ name: 'ООО Без Связи', inn: '6600000000' }) });
  const st = r.body.results.map(x => x.status);
  assert.ok(st.includes('blocked'), 'недоступные сайты помечены blocked: ' + JSON.stringify(st));
  assert.ok(st.includes('skipped'), 'источники без ключей помечены skipped');
  assert.equal(r.body.report.noData, true, 'отчёт понимает, что данных нет');
  assert.match(r.body.report.verdict, /Данных пока мало/, 'вердикт не делает выводов из неполных данных');
  assert.ok(r.body.report.dataQuality.blocked + r.body.report.dataQuality.skipped === 8, 'посчитано качество данных по источникам');
  assert.ok(r.body.report.links.length >= 10, 'ссылки ручной проверки всё равно сформированы');
});

test('прайс-лист можно заменить целиком: лишнее уходит в архив, а не удаляется', async () => {
  // маршрут, в который грузит файл сам интерфейс (раньше его не существовало)
  const direct = await call('/api/prices/ours', { method: 'POST', body: JSON.stringify({ csv: 'Наименование;Цена;Ед\nКаркасный дом 8×10 «Север»;3950000;шт\n', scope: 'ours', mode: 'merge' }) });
  assert.equal(direct.status, 201, 'загрузка нашего прайс-листа (это каталог) принимается');
  assert.equal(direct.body.updated, 1);
  const before = (await call('/api/prices?scope=ours')).body.rows;
  assert.ok(before.length > 1, 'до замены в прайсе несколько позиций');
  const r = await call('/api/prices', { method: 'POST', body: JSON.stringify({ csv: 'Наименование;Цена;Ед;Примечание\nКаркасный дом 8×10 «Север»;3950000;шт;только до конца месяца\n', scope: 'ours', mode: 'replace' }) });
  assert.equal(r.status, 201);
  assert.equal(r.body.archived, before.length - 1, 'позиции не из файла отправлены в архив');
  const active = (await call('/api/prices?scope=ours')).body.rows;
  assert.equal(active.length, 1, 'в прайсе осталась одна позиция');
  assert.equal(active[0].note, 'только до конца месяца', 'примечание из файла сохранено');
  // архив не удаляется: позицию видно в каталоге и можно вернуть в продажу
  const all = (await call('/api/prices?scope=ours&all=1')).body.rows;
  assert.ok(all.length >= before.length, 'архивные позиции доступны: ' + all.length + ' из ' + before.length);
  const catalog = (await call('/api/products')).body;
  assert.ok(catalog.filter(p => !p.active).length >= before.length - 1, 'в каталоге они помечены как архив');
  // обычная загрузка возвращает позиции в продажу
  const back = await call('/api/prices', { method: 'POST', body: JSON.stringify({ csv: 'Наименование;Цена;Ед\nБаня каркасная 4×6;890000;шт\n', scope: 'ours' }) });
  assert.equal(back.body.updated, 1, 'знакомая позиция найдена по названию');
  const active2 = (await call('/api/prices?scope=ours')).body.rows;
  assert.equal(active2.length, 2, 'позиция вернулась в прайс: ' + JSON.stringify(active2.map(x => x.item)));
});

test('сравнение цен находит позицию с чуть другим названием и не склеивает разные', async () => {
  const comp = (await call('/api/competitors')).body.find(c => c.inn === INN);
  await call('/api/prices', { method: 'POST', body: JSON.stringify({ csv: 'Наименование;Цена;Ед\nБаня каркасная 4×6;890000;шт\nКаркасный дом 6×8 «Летний»;1850000;шт\n', scope: 'ours' }) });
  await call(`/api/competitors/${comp.id}/prices`, { method: 'POST', body: JSON.stringify({ csv: 'Наименование;Цена;Ед\nБаня 4×6;990000;шт\nКаркасный дом 6×8 с террасой;2500000;шт\n', scope: 'competitor' }) });
  const r = await call(`/api/competitors/${comp.id}/check`, { method: 'POST', body: JSON.stringify({ sources: ['fns'] }) });
  const pairs = (r.body.report.pricing || {}).pairs || [];
  assert.ok(pairs.some(p => /Баня/.test(p.item) && p.ours === 890000 && p.theirs === 990000),
    '«Баня каркасная 4×6» и «Баня 4×6» сопоставлены: ' + JSON.stringify(pairs));
  assert.ok(!pairs.some(p => /Летний/.test(p.item)), 'разные комплектации одного размера не склеиваются');
});

test('ссылка на прайс: CRM сама подтягивает таблицу конкурента при каждой проверке', async () => {
  await mock('pricetable', (req, r) => {
    r.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' });
    r.end('Наименование;Цена;Ед\nКаркасный дом 8×10 «Север»;4300000;шт\nБаня 4×6 под ключ;920000;шт\n');
  });
  const comp = (await call('/api/competitors')).body.find(c => c.inn === INN);
  const addr = url('pricetable') + '/price.csv';
  const patched = await call(`/api/competitors/${comp.id}`, { method: 'PATCH', body: JSON.stringify({ price_url: addr }) });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.price_url, addr, 'ссылка сохранена в карточке конкурента');
  const r = await call(`/api/competitors/${comp.id}/check`, { method: 'POST', body: JSON.stringify({ sources: ['fns'] }) });
  const pulled = r.body.results.find(x => x.source === 'prices');
  assert.ok(pulled && pulled.status === 'ok', 'таблица по ссылке подтянута: ' + JSON.stringify(pulled));
  assert.match(pulled.summary, /Загружено позиций: 2/);
  const rows = await call(`/api/prices?scope=competitor&competitor=${comp.id}`);
  assert.equal(rows.body.rows.length, 2, 'подтянутые позиции лежат отдельно от нашего прайса');
  assert.ok(rows.body.rows.some(x => /8×10/.test(x.item) && x.price === 4300000));
  assert.ok(r.body.report.pricing.pairs.some(x => x.theirs === 4300000), 'подтянутая цена сразу попала в сравнение');
});

test('убранные адреса не отвечают, а мёртвая настройка не отдаётся', async () => {
  // Эти три адреса никто не вызывал: ни интерфейс, ни тесты. Держать их — значит
  // держать дверь, которая выглядит рабочей, но ведёт в никуда.
  for (const p of ['/api/competitor-links?inn=' + INN, '/api/competitors/prices-url']) {
    assert.equal((await call(p)).status, 404, p + ' больше не обслуживается');
  }
  assert.equal((await call('/api/prices/load', { method: 'POST', body: JSON.stringify({ url: 'https://example.com/p.csv' }) })).status, 404,
    'загрузка нашего прайса по адресу убрана: прайс-лист = каталог');
  const s = await call('/api/competitor-sources');
  assert.ok(!('ourPriceUrl' in s.body), 'настройка OUR_PRICE_URL больше не отдаётся');
  assert.ok(!Object.keys(s.body).some(k => /ourprice/i.test(k)), 'в настройках источников нет мёртвых ключей');
});
