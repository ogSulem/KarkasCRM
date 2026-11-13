// Жизненный цикл пароля сотрудника. Вопрос руководителя «я выдавал пароль,
// сотрудник его не менял, а он поменялся» должен иметь ответ в самой системе:
// выданный пароль временный, его заменяет сотрудник при первом входе, и каждое
// действие с доступом остаётся в журнале. Здесь проверяется весь круг — выдача,
// обязательная замена, сброс администратором, закрытие сеансов и причина отказа.
// Запуск: DATA_DIR=/tmp/kpw SEED_MODE=off PORT=18097 node --experimental-sqlite --test tests/password.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

process.env.DATA_DIR = '/tmp/karkas-password-' + Date.now();
process.env.PORT = '18097';
process.env.SEED_MODE = 'off';
const require = createRequire(import.meta.url);
const { server, db, clearLoginAttempts } = await import('../backend/src/server.js');
const base = 'http://127.0.0.1:18097';
const ADMIN_TMP = 'admin1234567';
const ADMIN_PASS = 'AdministratorPersonal2026';

const call = (p, opt = {}, token = null) => fetch(base + p, {
  ...opt,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opt.headers || {}) },
}).then(async r => ({
  status: r.status,
  retryAfter: r.headers.get('retry-after'),
  body: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text(),
}));
const login = (email, password) => call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
const { admin: adminToken } = require('./admin-login.cjs').flow({
  login: (email, password) => call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  change: (token, oldp, newp) => call('/api/me/password', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ old_password: oldp, new_password: newp }) }, token),
});
const journal = () => db.prepare('SELECT text,entity_type,entity_id,user_name FROM activities ORDER BY id DESC LIMIT 40').all();
const has = text => journal().some(a => a.text.includes(text));

before(async () => { await new Promise(r => server.listening ? r() : server.once('listening', r)); });
after(() => server.close());

let admin;
const manager = { email: 'ivan@example.com', temp: 'TempPasswordIvan2026', personal: 'IvanPersonalPass2026' };

test('первый администратор обязан заменить временный пароль', async () => {
  const first = await login('admin@example.com', ADMIN_TMP);
  assert.equal(first.status, 200);
  assert.equal(first.body.user.must_change_password, 1, 'дефолтный пароль из установщика не остаётся рабочим');
  assert.equal(first.body.user.pass, undefined, 'хеш пароля не отдаётся на клиент');
  assert.ok(!JSON.stringify(first.body).match(/[0-9a-f]{64}/), 'в ответе входа нет хеша');

  // до замены пароля данные закрыты, профиль и смена пароля доступны
  const gated = await call('/api/contacts', {}, first.body.token);
  assert.equal(gated.status, 403);
  assert.equal(gated.body.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await call('/api/me', {}, first.body.token)).status, 200);

  const same = await call('/api/me/password', { method: 'POST', body: JSON.stringify({ old_password: ADMIN_TMP, new_password: ADMIN_TMP }) }, first.body.token);
  assert.equal(same.status, 400);
  assert.match(same.body.error, /должен отличаться/, 'замена на тот же пароль отклоняется');
  assert.equal((await call('/api/me/password', { method: 'POST', body: JSON.stringify({ old_password: ADMIN_TMP, new_password: 'короткий' }) }, first.body.token)).status, 400, 'личный пароль короче 12 символов не принимается');
  const wrong = await call('/api/me/password', { method: 'POST', body: JSON.stringify({ old_password: 'ЧужойПароль2026', new_password: ADMIN_PASS }) }, first.body.token);
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /Старый пароль неверен/);

  admin = await adminToken();
  assert.ok(admin, 'личный пароль задан, выдан новый токен');
  assert.equal((await login('admin@example.com', ADMIN_TMP)).status, 401, 'временный пароль больше не работает');
  assert.equal((await login('admin@example.com', ADMIN_PASS)).status, 200, 'личный пароль работает');
  assert.ok(has('Временный пароль заменён личным'), 'в журнале видно, что пароль сменил сам человек: ' + journal().slice(0, 3).map(a => a.text).join(' | '));
  assert.ok(!journal().some(a => /пароль/i.test(a.text) && /[0-9a-f]{32}/.test(a.text)), 'текст пароля и его хеш в журнал не попадают');
});

test('сотрудник с временным паролем не видит данные CRM', async () => {
  const noPass = await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Без Пароля', email: 'nopass@example.com', role: 'manager', active: 1 }) }, admin);
  assert.equal(noPass.status, 400, 'сотрудник без пароля не создаётся');
  assert.match(noPass.body.error, /временный пароль/i);
  assert.equal((await login('nopass@example.com', 'undefined')).status, 401, 'и строка «undefined» паролем не становится');

  const created = await call('/api/users', {
    method: 'POST',
    body: JSON.stringify({ name: 'Иван Менеджеров', email: manager.email, password: manager.temp, role: 'manager', active: 1 }),
  }, admin);
  assert.equal(created.status, 201);
  manager.id = created.body.id;

  assert.ok(has('Сотрудник добавлен') && has('выдан временный пароль'), 'выдача доступа записана в журнал');
  const added = journal().find(a => a.text.includes('Сотрудник добавлен'));
  assert.equal(added.user_name, 'Администратор', 'в журнале видно, кто выдал пароль');
  assert.ok(!added.text.includes(manager.temp), 'сам временный пароль в журнал не попадает');

  const l = await login(manager.email, manager.temp);
  assert.equal(l.status, 200);
  assert.equal(l.body.user.must_change_password, 1);
  const token = l.body.token;

  for (const p of ['/api/contacts', '/api/deals', '/api/dashboard', '/api/users']) {
    const gated = await call(p, {}, token);
    assert.equal(gated.status, 403, `${p} закрыт до смены временного пароля`);
    assert.equal(gated.body.code, 'PASSWORD_CHANGE_REQUIRED', 'интерфейс понимает причину и показывает экран смены пароля');
  }
  const me = await call('/api/me', {}, token);
  assert.equal(me.status, 200, 'профиль остаётся доступен: из него человек меняет пароль');
  assert.equal(me.body.user.must_change_password, 1);
  const row = db.prepare('SELECT pass_changed_at,must_change_password FROM users WHERE id=?').get(manager.id);
  assert.ok(row.pass_changed_at, 'момент выдачи временного пароля сохранён');
  assert.equal(row.must_change_password, 1);
  const team = await call('/api/users?stats=1', {}, admin);
  const shown = team.body.find(x => x.id === manager.id);
  assert.ok(shown && shown.pass_changed_at, 'администратору в «Команде» видно, когда пароль был выдан');
  assert.equal(shown.must_change_password, 1, 'и что сотрудник ещё не задал личный пароль');

  const done = await call('/api/me/password', { method: 'POST', body: JSON.stringify({ old_password: manager.temp, new_password: manager.personal }) }, token);
  assert.equal(done.status, 200);
  assert.equal((await call('/api/contacts', {}, done.body.token)).status, 200, 'после замены личного пароля данные открыты');

  const oldToken = await call('/api/contacts', {}, token);
  assert.equal(oldToken.status, 401);
  assert.equal(oldToken.body.code, 'SESSION_REVOKED', 'старый токен отклоняется с понятной причиной, а не общим 401');
  assert.match(oldToken.body.error, /Войдите заново/, 'сообщение объясняет, что делать дальше');

  assert.equal((await login(manager.email, manager.temp)).status, 401, 'выданный администратором пароль перестал действовать');
  assert.equal((await login(manager.email, manager.personal)).status, 200, 'работает личный пароль сотрудника');
});

test('сброс пароля администратором закрывает сеансы сотрудника и остаётся в журнале', async () => {
  const l = await login(manager.email, manager.personal);
  assert.equal(l.status, 200);
  const live = l.body.token;

  const byManager = await call('/api/users/' + manager.id, { method: 'PATCH', body: JSON.stringify({ password: 'ManagerSelfReset2026' }) }, live);
  assert.equal(byManager.status, 403, 'сотрудник не может сбросить пароль себе или другому через карточку');

  const reset = await call('/api/users/' + manager.id, { method: 'PATCH', body: JSON.stringify({ password: 'NewTempForIvan2026' }) }, admin);
  assert.equal(reset.status, 200);

  const kicked = await call('/api/me', {}, live);
  assert.equal(kicked.status, 401, 'открытая вкладка сотрудника закрывается сразу');
  assert.equal(kicked.body.code, 'SESSION_REVOKED');
  assert.match(kicked.body.error, /пароль сброшен|изменён администратором/i, 'человеку названа причина');

  assert.ok(has('сброшен пароль, прежние сеансы закрыты'), 'сброс пароля виден в журнале');
  const line = journal().find(a => a.text.includes('сброшен пароль'));
  assert.equal(line.user_name, 'Администратор', 'в журнале видно, кто сбросил пароль');
  assert.ok(line.text.includes('Иван Менеджеров'), 'в журнале видно, кому сбросили пароль');
  assert.ok(!line.text.includes('NewTempForIvan2026'), 'новый пароль в журнал не попадает');

  const fresh = await login(manager.email, 'NewTempForIvan2026');
  assert.equal(fresh.status, 200, 'сотрудник входит по новому временному паролю');
  assert.equal(fresh.body.user.must_change_password, 1, 'и обязан заменить его при первом входе');
  assert.equal((await login(manager.email, manager.personal)).status, 401, 'прежний личный пароль больше не работает');

  // правка имени не должна трогать пароль: именно эта путаница приводила к
  // жалобе «я ничего не менял, а пароль поменялся»
  const before = db.prepare('SELECT pass,session_version,must_change_password,pass_changed_at FROM users WHERE id=?').get(manager.id);
  assert.equal((await call('/api/users/' + manager.id, { method: 'PATCH', body: JSON.stringify({ name: 'Иван М.' }) }, admin)).status, 200);
  const after = db.prepare('SELECT pass,session_version,must_change_password,pass_changed_at FROM users WHERE id=?').get(manager.id);
  assert.deepEqual(after, before, 'смена имени не меняет пароль и не закрывает сеансы');
  assert.ok(has('изменено имя'), 'правка имени тоже записана в журнал');
});

test('личный пароль сотрудник меняет сам, без временного', async () => {
  const l = await login(manager.email, 'NewTempForIvan2026');
  assert.equal(l.status, 200);
  const changed = await call('/api/me/password', { method: 'POST', body: JSON.stringify({ old_password: 'NewTempForIvan2026', new_password: 'SecondIvanPass2026' }) }, l.body.token);
  assert.equal(changed.status, 200);
  manager.personal = 'SecondIvanPass2026';

  assert.equal((await call('/api/me', {}, changed.body.token)).body.user.must_change_password, 0);
  const again = await call('/api/me/password', { method: 'POST', body: JSON.stringify({ old_password: manager.personal, new_password: 'ThirdIvanPass2026!' }) }, changed.body.token);
  assert.equal(again.status, 200, 'обычная смена пароля из профиля работает');
  assert.ok(db.prepare('SELECT pass_changed_at FROM users WHERE id=?').get(manager.id).pass_changed_at, 'момент последней смены пароля сохранён');
  assert.ok(has('Сотрудник сменил свой пароль'), 'в журнале обычная смена отличается от первого входа');
  manager.personal = 'ThirdIvanPass2026!';
});

test('причина отказа понятна: отключённый доступ, удалённый сотрудник, подделанный токен', async () => {
  const viewer = await call('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Пётр Наблюдателей', email: 'petr@example.com', password: 'TempPasswordPetr2026', role: 'viewer', active: 1 }) }, admin);
  assert.equal(viewer.status, 201);
  const l = await login('petr@example.com', 'TempPasswordPetr2026');
  const changed = await call('/api/me/password', { method: 'POST', body: JSON.stringify({ old_password: 'TempPasswordPetr2026', new_password: 'PetrPersonalPass2026' }) }, l.body.token);
  const token = changed.body.token;
  assert.equal((await call('/api/me', {}, token)).status, 200);

  assert.equal((await call('/api/users/' + viewer.body.id, { method: 'PATCH', body: JSON.stringify({ active: 0 }) }, admin)).status, 200);
  const blocked = await call('/api/me', {}, token);
  assert.equal(blocked.status, 401);
  assert.equal(blocked.body.code, 'USER_DISABLED', 'отключённый доступ называется своим именем');
  assert.match(blocked.body.error, /отключён администратором/);
  assert.ok(has('доступ отключён'), 'отключение доступа записано в журнал');

  db.prepare('DELETE FROM users WHERE id=?').run(viewer.body.id);
  const gone = await call('/api/me', {}, token);
  assert.equal(gone.status, 401);
  assert.equal(gone.body.code, 'USER_GONE', 'удалённая учётная запись тоже объяснима');

  // истёкший срок называется отдельно: неделя прошла у каждого, и сообщение
  // «пароль сброшен администратором» здесь пугало бы без причины
  const { createHmac } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const secret = readFileSync(process.env.DATA_DIR + '/.jwt-secret', 'utf8').trim();
  const row = db.prepare('SELECT id,session_version FROM users WHERE id=?').get(manager.id);
  const payload = Buffer.from(JSON.stringify({ id: row.id, sv: row.session_version, exp: Date.now() - 1000 })).toString('base64url');
  const stale = payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url');
  const expired = await call('/api/me', {}, stale);
  assert.equal(expired.status, 401);
  assert.equal(expired.body.code, 'SESSION_EXPIRED', 'просроченный токен отличим от сброшенного пароля');
  assert.match(expired.body.error, /Сеанс истёк/);

  const fake = await call('/api/me', {}, 'broken.token.value');
  assert.equal(fake.status, 401);
  assert.equal(fake.body.code, undefined, 'подделанная подпись причину не получает: ответ общий');
  assert.match(String(fake.body.error), /Требуется авторизация/);
  assert.equal((await fetch(base + '/api/contacts')).status, 401, 'без токена — общий ответ, причина не раскрывается');
});

test('пароль не уходит наружу: ни в ответах API, ни в журнале, ни в выгрузке', async () => {
  const list = await call('/api/users?stats=1', {}, admin);
  assert.equal(list.status, 200);
  assert.equal(list.body[0].pass, undefined, 'хеш пароля не отдаётся в списке сотрудников');
  assert.ok('pass_changed_at' in list.body[0], 'администратор видит, когда пароль менялся');
  assert.equal((await call('/api/me', {}, admin)).body.user.pass, undefined);
  const backup = await fetch(base + '/api/backup', { headers: { Authorization: 'Bearer ' + admin } });
  const text = await backup.text();
  assert.ok(text.includes('"email"'), 'выгрузка содержит данные');
  assert.ok(!/"pass"/.test(text), 'хеш пароля в выгрузку не попадает');
  const feed = await call('/api/dashboard', {}, admin);
  assert.equal(feed.status, 200);
  assert.ok(Array.isArray(feed.body.activities) && feed.body.activities.length > 0, 'лента журнала отдаётся на рабочий стол');
  assert.ok(!/TempPassword|admin12345|IvanPersonal|PetrPersonal|SecondIvan|ThirdIvan|NewTempForIvan/.test(JSON.stringify(feed.body)), 'в журнале нет ни одного пароля');
});

test('подбор пароля упирается в лимит, а опечатка не блокирует офис', async () => {
  clearLoginAttempts();
  const limit = Number(db.prepare("SELECT value FROM settings WHERE key='LOGIN_RATE_LIMIT'").get()?.value || 12);
  let blocked = null;
  for (let i = 0; i < limit + 3; i++) {
    const r = await login('guess@example.com', 'WrongPasswordGuess' + i);
    assert.ok(r.status === 401 || r.status === 429, 'неверный пароль не проходит');
    if (r.status === 429) { blocked = r; break }
  }
  assert.ok(blocked, 'перебор пароля останавливается лимитом из настроек');
  assert.ok(Number(blocked.retryAfter) > 0, 'сервер говорит, сколько ждать');
  assert.match(blocked.body.error, /неудачных попыток|запросов на вход/);

  // удачный вход гасит счётчик: сотрудник, ошибившийся один раз, не ждёт пять минут
  clearLoginAttempts();
  const ok = await login(manager.email, manager.personal);
  assert.equal(ok.status, 200);
  assert.equal((await login('guess@example.com', 'WrongPasswordGuess1')).status, 401, 'после обнуления счёт работает заново, а не остаётся заблокированным');
});
