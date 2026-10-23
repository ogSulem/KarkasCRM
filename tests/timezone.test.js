// Часовой пояс. Отметки времени база хранит в UTC (datetime('now')), интерфейс
// переводит их в пояс браузера, а «месяц выручки» и план продаж считаются по
// местному месяцу компании.
//
// Тест намеренно работает в Europe/Moscow. В UTC модификатор localtime совпадает
// с UTC, и расхождение в три часа осталось бы незамеченным: именно поэтому
// пояс задаётся здесь, а не берётся из окружения.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
process.env.TZ = 'Europe/Moscow';
process.env.DATA_DIR = '/tmp/karkas-tz-' + Date.now();
process.env.PORT = '18077';
process.env.SEED_MODE = 'off';
const { server } = await import('../backend/src/server.js');
const base = 'http://127.0.0.1:18077';
let h;
const call = (p, opt = {}) => fetch(base + p, { ...opt, headers: { 'Content-Type': 'application/json', ...(h || {}), ...(opt.headers || {}) } }).then(async r => ({ status: r.status, body: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text() }));

// Местный месяц YYYY-MM и отметка в формате базы (UTC, «ГГГГ-ММ-ДД ЧЧ:ММ:СС»).
const ym = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const utcStamp = d => d.toISOString().slice(0, 19).replace('T', ' ');

before(async () => { await new Promise(r => server.listening ? r() : server.once('listening', r)); });
after(() => server.close());

test('отметка о входе хранится в UTC', async () => {
  const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@example.com', password: 'admin12345' }) });
  assert.equal(login.status, 200, 'вход выполнен');
  if (login.body.user?.must_change_password) {
    const changed = await call('/api/me/password', { method: 'POST', headers: { Authorization: 'Bearer ' + login.body.token }, body: JSON.stringify({ old_password: 'admin12345', new_password: 'admin12345-Personal-2026' }) });
    assert.equal(changed.status, 200, 'первый вход требует смены пароля — меняем');
    login.body.token = changed.body.token;
  }
  h = { Authorization: 'Bearer ' + login.body.token };

  const admin = (await call('/api/users')).body.find(u => u.role === 'admin');
  assert.ok(admin?.last_login, 'отметка о входе записана');
  assert.match(admin.last_login, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'формат отметки — как у остальных полей времени');
  // Интерфейс трактует такую строку как UTC и переводит в пояс браузера.
  // Если записать её местным временем, в списке сотрудников окажется вход
  // «через три часа» — в будущем относительно настоящего момента.
  const diffMin = (Date.parse(admin.last_login.replace(' ', 'T') + 'Z') - Date.now()) / 60000;
  assert.ok(Math.abs(diffMin) < 5, `last_login совпадает с текущим UTC, расхождение ${diffMin.toFixed(1)} мин`);
});

test('сделка, закрытая сейчас, попадает в текущий местный месяц', async () => {
  const now = new Date();
  const deal = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Продажа этого месяца', stage: 'won', amount: 150000 }) });
  assert.equal(deal.status, 201);
  assert.match(deal.body.closed_at || '', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'дата закрытия проставлена сервером');

  const a = (await call('/api/analytics')).body;
  assert.equal(a.plan.month, ym(now), 'план считается по текущему местному месяцу');
  assert.ok(a.plan.fact >= 150000, `факт месяца включает сделку (${a.plan.fact})`);
  const d = (await call('/api/dashboard')).body;
  assert.ok(d.monthRevenue >= 150000, `выручка месяца на дашборде включает сделку (${d.monthRevenue})`);
});

test('сделка на границе месяца учитывается в местном месяце, а не в UTC', async () => {
  const now = new Date();
  // 1-е число следующего месяца, 01:00 по Москве. В UTC это 22:00 последнего
  // дня текущего месяца: месяцы в двух поясах разные — на этом и ловим сдвиг.
  const firstNext = new Date(now.getFullYear(), now.getMonth() + 1, 1, 1, 0, 0);
  const closedAt = utcStamp(firstNext);
  assert.notEqual(ym(firstNext), closedAt.slice(0, 7), 'момент действительно лежит в разных месяцах по UTC и по Москве');

  const deal = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Продажа на границе месяца', stage: 'won', amount: 777000, closed_at: closedAt }) });
  assert.equal(deal.status, 201);
  assert.equal(deal.body.closed_at, closedAt, 'дата закрытия из запроса сохранена, а не заменена текущей');

  const a = (await call('/api/analytics')).body;
  const row = a.byMonth.find(r => r.ym === ym(firstNext));
  assert.ok(row, `выручка отнесена к местному месяцу ${ym(firstNext)}`);
  assert.ok(row.s >= 777000, `сумма сделки вошла в этот месяц (${row.s})`);
  assert.ok(a.plan.fact < 777000, 'в текущем месяце сделки следующего месяца нет');
  // строки byMonth — это {ym, n, s}; интерфейс рисует график по полю s
  const cur = a.byMonth.find(r => r.ym === ym(now));
  assert.ok(cur && cur.s < 777000, `в текущем месяце сумма без чужой сделки (${cur && cur.s})`);
  const d = (await call('/api/dashboard')).body;
  assert.ok(d.monthRevenue < 777000, `выручка дашборда не забрала сделку чужого месяца (${d.monthRevenue})`);
});

test('дату закрытия можно задать задним числом, мусор отклоняется', async () => {
  const back = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Продали давно', stage: 'won', amount: 90000, closed_at: '2024-05-06' }) });
  assert.equal(back.status, 201);
  assert.equal(back.body.closed_at, '2024-05-06 00:00:00', 'дата без времени принята и приведена к формату базы');

  // Неразборчивое значение не должно попадать в базу: datetime() его не поймёт,
  // и сделка выпадет из выручки по месяцам. Вместо него ставится текущая дата.
  for (const bad of ['не дата', '2024-13-45', '2024-02-30', '../../etc/passwd', '<script>alert(1)</script>']) {
    const r = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Мусор в дате', stage: 'won', amount: 10, closed_at: bad }) });
    assert.equal(r.status, 201, `сделка создана, несмотря на плохую дату (${bad})`);
    assert.match(r.body.closed_at || '', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, `дата приведена к формату базы (${bad})`);
    assert.ok(!r.body.closed_at.includes('<') && !r.body.closed_at.includes('/'), `из значения не перенесён мусор (${bad})`);
    const ageMin = Math.abs(Date.parse(r.body.closed_at.replace(' ', 'T') + 'Z') - Date.now()) / 60000;
    assert.ok(ageMin < 5, `вместо мусора подставлена текущая дата, расхождение ${ageMin.toFixed(1)} мин (${bad})`);
  }

  // Открытая сделка дату закрытия не хранит — иначе выручка посчиталась бы дважды.
  const open = await call('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Ещё в работе', stage: 'new', closed_at: '2024-05-06 10:00:00' }) });
  assert.equal(open.status, 201);
  assert.equal(open.body.closed_at, null, 'у открытой сделки даты закрытия нет');
});
