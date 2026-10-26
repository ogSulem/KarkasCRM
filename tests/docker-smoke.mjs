// Проверка собранного Docker-образа «как у пользователя»: права, логотип, сохранность
// данных после перезапуска контейнера. Запускается в CI после
// `docker compose up -d --build --wait`, поэтому требует docker только на машине CI.
//
//   node tests/docker-smoke.mjs
//
// Если что-то не так — скрипт завершается с кодом 1 и печатает, что именно сломалось.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Ожидаемая версия — из файла VERSION в репозитории: образ собирается из него же.
const VERSION = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'VERSION'), 'utf8').trim();

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:8080';
const EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
let PASSWORD = process.env.ADMIN_PASSWORD || 'admin12345';
let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const compose = args => execFileSync('docker', ['compose', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function waitHealthy(seconds = 90) {
  for (let i = 0; i < seconds * 2; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return true; } catch { }
    await sleep(500);
  }
  return false;
}
async function api(path, opt = {}, token = '') {
  const r = await fetch(BASE + path, {
    ...opt,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opt.headers || {}) },
  });
  const type = r.headers.get('content-type') || '';
  return { status: r.status, body: type.includes('json') ? await r.json() : await r.text() };
}
// Первый вход администратора может требовать смены пароля — проходим этот шаг,
// чтобы дальнейшие проверки работали как у обычного пользователя.
async function login() {
  let r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (r.body?.user?.must_change_password) {
    const next = PASSWORD + '-SmokeDocker-2026';
    const changed = await api('/api/me/password', { method: 'POST', body: JSON.stringify({ old_password: PASSWORD, new_password: next }) }, r.body.token);
    if (changed.status !== 200) throw new Error('смена временного пароля: ' + JSON.stringify(changed.body));
    PASSWORD = next;
    r = { status: 200, body: changed.body };
  }
  if (!r.body?.token) throw new Error('вход не удался: ' + JSON.stringify(r.body));
  return r.body.token;
}


(async () => {
  ok('контейнер отвечает /api/health', await waitHealthy());

  const anon = (await api('/api/health')).body;
  ok('публичный health не раскрывает счётчики клиентов', anon.counts === undefined && anon.backups === undefined);
  ok('версия продукта читается из файла VERSION в образе', anon.version === VERSION, `${anon.version} != ${VERSION}`);

  let token = await login();
  const adminHealth = (await api('/api/health', {}, token)).body;
  ok('администратор видит подробности health', Number.isInteger(adminHealth.counts?.contacts), JSON.stringify(adminHealth.counts));

  // ── права внутри контейнера ────────────────────────────────────────────────
  ok('приложение работает не от root', compose(['exec', '-T', 'crm', 'id', '-u']) === '1000');
  // Часовой пояс: без tzdata в alpine TZ игнорируется и «сегодня» уезжает на 3 часа
  const tz = compose(['exec', '-T', 'crm', 'date', '+%Z']);
  ok('часовой пояс контейнера — московский (TZ работает)', /MSK/i.test(tz), tz);
  let dataWritable = true;
  try { compose(['exec', '-T', 'crm', 'sh', '-c', 'test -w /data && test -w /data/uploads']); } catch { dataWritable = false; }
  ok('каталог данных /data доступен на запись', dataWritable);
  let rootReadonly = true;
  try { compose(['exec', '-T', 'crm', 'sh', '-c', 'touch /app/probe 2>/dev/null && rm -f /app/probe && exit 1 || exit 0']); } catch { rootReadonly = false; }
  ok('корень контейнера только для чтения (код нельзя изменить)', rootReadonly);

  // ── данные ────────────────────────────────────────────────────────────────
  const name = 'Проверка Docker ' + new Date().toISOString().slice(11, 19);
  const made = await api('/api/contacts', { method: 'POST', body: JSON.stringify({ name, phone: '+7 900 000-11-22' }) }, token);
  ok('через API создаётся клиент', made.status === 201 && made.body.id > 0, 'id ' + made.body.id);

  const bk = await api('/api/backups', { method: 'POST', body: '{"s3":false}' }, token);
  ok('резервная копия создаётся файлом в /data', bk.status === 200 && !!bk.body.created, String(bk.body.created || bk.status));
  const beforeCopy = bk.body.created;

  // ── перезапуск контейнера ─────────────────────────────────────────────────
  compose(['restart', 'crm']);
  ok('после перезапуска контейнер снова отвечает', await waitHealthy());

  token = await login();
  const contacts = (await api('/api/contacts', {}, token)).body;
  ok('клиент сохранился после перезапуска (том /data)', Array.isArray(contacts) && contacts.some(c => c.name === name));
  const copiesAfter = (await api('/api/backups', {}, token)).body;
  ok('файл резервной копии пережил перезапуск (том /data)', (copiesAfter.files || []).some(f => f.name === beforeCopy), beforeCopy);
  const adminAfter = (await api('/api/health', {}, token)).body;
  ok('health после перезапуска содержит счётчики для администратора', Number.isInteger(adminAfter.counts?.contacts));

  // убираем за собой проверочного клиента: база остаётся такой же, как до проверки
  if (made.body?.id) await api('/api/contacts/' + made.body.id, { method: 'DELETE' }, token);

  console.log(`\n${failed ? `Проверок не пройдено: ${failed}` : 'Docker-образ работает как ожидается'}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('Проверка Docker не выполнена:', e.message); process.exit(1); });
