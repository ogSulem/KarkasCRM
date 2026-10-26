// Резервная копия на другой сервер: подпись запросов к S3 и сама выгрузка.
// Проверки идут без внешней сети — поднимаем локальный сервер, который
// притворяется хранилищем, и смотрим, что скрипт отправляет ровно один PUT.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signedHeaders } from '../scripts/s3-sign.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const run = promisify(execFile);

// Автовыгрузка живёт внутри процесса CRM: копия создаётся планировщиком или
// кнопкой, поэтому поднять сервер нужно здесь же, до его импорта.
process.env.DATA_DIR = '/tmp/karkas-s3srv-' + Date.now();
process.env.PORT = '18094';
process.env.SEED_MODE = 'off';
const { server, db } = await import('../backend/src/server.js');
const crm = 'http://127.0.0.1:18094';
let admin;
const call = async (path, { method = 'GET', body, token } = {}) => {
  const r = await fetch(crm + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data };
};

// Хранилище ведёт себя как настоящее: принимает PUT, отдаёт список объектов
// и удаляет лишнее. Ключи держим в памяти — проверяем не файлы, а протокол.
function fakeS3() {
  const store = new Map();
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://s3.local');
      const path = decodeURIComponent(u.pathname);
      if (!path.startsWith('/karkas-backups')) {
        res.writeHead(404, { 'Content-Type': 'application/xml' });
        return res.end('<Error><Code>NoSuchBucket</Code><Message>Ведро не найдено: в пути нет его имени</Message></Error>');
      }
      if (req.method === 'PUT') { store.set(path, Buffer.concat(chunks)); res.writeHead(200); return res.end() }
      if (req.method === 'DELETE') { store.delete(path); res.writeHead(204); return res.end() }
      const prefix = u.searchParams.get('prefix') || '';
      const keys = [...store.keys()]
        .filter(k => k.startsWith('/karkas-backups/' + prefix))
        .sort()
        .map(k => `<Contents><Key>${k.replace('/karkas-backups/', '')}</Key></Contents>`).join('');
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>karkas-backups</Name><Prefix>${prefix}</Prefix>${keys}</ListBucketResult>`);
    });
  });
  return { srv, store, start: () => new Promise(r => srv.listen(0, '127.0.0.1', r)), port: () => srv.address().port };
}

before(async () => {
  await new Promise(r => server.listening ? r() : server.once('listening', r));
  admin = (await call('/api/auth/login', { method: 'POST', body: { email: 'admin@example.com', password: 'admin12345' } })).data.token;
  assert.ok(admin, 'вход администратора');
});
after(async () => { await new Promise(r => server.close(r)); try { db.close() } catch {} });

test('без настроек хранилища выгрузка не начинается, а причина названа по-человечески', async () => {
  const list = await call('/api/backups', { token: admin });
  assert.equal(list.status, 200);
  assert.equal(list.data.s3.configured, false, 'хранилище не настроено');
  assert.deepEqual(list.data.s3.missing, ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'], 'перечислено, чего не хватает');
  const manual = await call('/api/backups/s3', { method: 'POST', token: admin, body: {} });
  assert.equal(manual.status, 400);
  assert.match(String(manual.data.error), /S3_ENDPOINT/, 'ошибка называет конкретные поля');

  // сама копия при этом создаётся: отсутствие хранилища не должно её отменять
  const made = await call('/api/backups', { method: 'POST', token: admin, body: {} });
  assert.equal(made.status, 200);
  assert.ok(made.data.created, 'копия создана');
  assert.equal(made.data.s3.ok, false, 'выгрузка не удалась — и это не спрятано');
});

test('новая копия сама уходит в хранилище, а статус виден администратору', async () => {
  const s3 = fakeS3(); await s3.start();
  try {
    const saved = await call('/api/settings', { method: 'PUT', token: admin, body: {
      S3_ENDPOINT: `http://127.0.0.1:${s3.port()}`, S3_BUCKET: 'karkas-backups', S3_ACCESS_KEY: 'AKIATEST',
      S3_SECRET_KEY: 'secret-test', S3_PREFIX: 'karkascrm', S3_REGION: 'ru-1', S3_KEEP: '5', S3_AUTO: '1',
    } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));

    const made = await call('/api/backups', { method: 'POST', token: admin, body: {} });
    assert.equal(made.status, 200);
    assert.equal(made.data.s3.ok, true, JSON.stringify(made.data.s3));
    assert.equal(s3.store.size, 1, 'копия легла в хранилище');
    const [key, bytes] = [...s3.store][0];
    assert.match(key, /^\/karkas-backups\/karkascrm\/crm-\d{4}-\d{2}-\d{2}\.db$/, 'путь содержит ведро и папку: ' + key);
    assert.ok(bytes.length > 4096, 'файл ушёл целиком, ' + bytes.length + ' байт');

    const status = (await call('/api/settings', { token: admin })).data.s3 || (await call('/api/backups', { token: admin })).data.s3;
    assert.ok(status.last_ok, 'время последней выгрузки сохранено');
    assert.equal(status.last_file, made.data.created, 'имя выгруженной копии сохранено');
    assert.equal(status.last_error, '', 'ошибок нет');
    assert.equal(status.secret_set, true, 'секретный ключ задан');
    assert.ok(!/secret-test/.test(JSON.stringify(status)), 'секретный ключ наружу не отдаётся');
    assert.equal(status.access_key.slice(-4), 'TEST', 'ключ доступа показан хвостом');
  } finally { await new Promise(r => s3.srv.close(r)) }
});

test('в хранилище остаётся заданное число последних копий', async () => {
  const s3 = fakeS3(); await s3.start();
  // старые копии уже лежат в ведре: чистка должна убрать их, а не свежие
  for (const d of ['2026-09-01', '2026-09-02', '2026-09-03']) s3.store.set('/karkas-backups/karkascrm/crm-' + d + '.db', Buffer.from('old'));
  try {
    await call('/api/settings', { method: 'PUT', token: admin, body: { S3_ENDPOINT: `http://127.0.0.1:${s3.port()}`, S3_KEEP: '2' } });
    const made = await call('/api/backups', { method: 'POST', token: admin, body: {} });
    assert.equal(made.data.s3.ok, true, JSON.stringify(made.data.s3));
    assert.equal(s3.store.size, 2, 'лишние копии удалены: ' + [...s3.store.keys()].join(', '));
    const left = [...s3.store.keys()].sort();
    assert.ok(left.some(k => k.includes(made.data.created)), 'свежая копия на месте');
    assert.ok(!left.some(k => k.includes('2026-09-01')), 'самая старая удалена');
  } finally { await new Promise(r => s3.srv.close(r)) }
});

test('недоступное хранилище не мешает резервной копии', async () => {
  const dead = fakeS3(); await dead.start();
  const port = dead.port();
  await new Promise(r => dead.srv.close(r)); // порт свободен: соединение не установится
  await call('/api/settings', { method: 'PUT', token: admin, body: { S3_ENDPOINT: `http://127.0.0.1:${port}`, S3_KEEP: '3' } });
  const made = await call('/api/backups', { method: 'POST', token: admin, body: {} });
  assert.equal(made.status, 200, 'сама копия создана, несмотря на сбой хранилища');
  assert.ok(made.data.created, 'файл копии есть');
  assert.equal(made.data.s3.ok, false);
  const st = (await call('/api/backups', { token: admin })).data.s3;
  assert.ok(st.last_error, 'причина сбоя записана и видна в настройках: ' + st.last_error);
  assert.ok(existsSync(join(process.env.DATA_DIR, 'backups', made.data.created)), 'копия лежит на диске');
});

test('подпись S3 совпадает с эталоном AWS Signature V4', () => {
  const r = signedHeaders({
    method: 'PUT', key: 'karkascrm/crm.db', body: 'hello', region: 'ru-1',
    endpoint: 'https://s3.regru.cloud',
    accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    now: new Date('2026-10-20T08:00:00Z'),
  });
  assert.equal(r.url, 'https://s3.regru.cloud/karkascrm/crm.db');
  assert.equal(r.headers['x-amz-date'], '20261020T080000Z');
  // sha256 от строки "hello"
  assert.equal(r.headers['x-amz-content-sha256'], '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  // значение сверено с официальным SDK AWS для тех же входных данных
  assert.match(r.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20261020\/ru-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.equal(r.headers.Authorization.split('Signature=')[1], '75c9accf3bd0cde7a64bb8e9e5c0ca739c5be5fc9bedf84abc115592cd9f8279');
});

test('кириллица и пробелы в имени файла кодируются, а хост не ломается', () => {
  const r = signedHeaders({
    method: 'PUT', key: 'karkascrm/смета дома.db', body: '', region: 'us-east-1',
    endpoint: 'https://storage.example.com/', accessKey: 'k', secretKey: 's',
    now: new Date('2026-01-01T00:00:00Z'),
  });
  assert.equal(r.url, 'https://storage.example.com/karkascrm/%D1%81%D0%BC%D0%B5%D1%82%D0%B0%20%D0%B4%D0%BE%D0%BC%D0%B0.db');
  assert.match(r.headers.Authorization, /Signature=[0-9a-f]{64}$/);
});

test('без ключей скрипт завершается с кодом 1 и перечисляет переменные', async () => {
  const env = { ...process.env };
  for (const k of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY']) delete env[k];
  await assert.rejects(
    run(process.execPath, ['scripts/upload-backup.mjs'], { cwd: root, env }),
    e => e.code === 1 && /S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY/.test(e.stderr),
  );
});

test('копия уходит в хранилище один раз и не дублируется при повторе', async () => {
  // временный «сервер CRM»: каталог данных с папкой backups
  const dir = mkdtempSync(join(tmpdir(), 'karkas-s3-'));
  mkdirSync(join(dir, 'backups'), { recursive: true });
  const payload = Buffer.alloc(4096, 7);
  writeFileSync(join(dir, 'backups', 'crm-2026-10-20-0300.db'), payload);

  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, size: Buffer.concat(chunks).length, auth: req.headers.authorization || '' });
      res.writeHead(200); res.end();
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const env = {
    ...process.env, S3_ENDPOINT: `http://127.0.0.1:${port}`, S3_BUCKET: 'karkas-backups',
    S3_ACCESS_KEY: 'key', S3_SECRET_KEY: 'secret', DATA_DIR: dir,
  };
  try {
    const first = await run(process.execPath, ['scripts/upload-backup.mjs'], { cwd: root, env });
    assert.match(first.stdout, /Отправлено сейчас: 1/);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, 'PUT');
    // path-style: ведро входит в путь. Без него хранилище ответило бы
    // SignatureDoesNotMatch или NoSuchBucket, и копия осталась бы только на сервере
    assert.equal(seen[0].url, '/karkas-backups/karkascrm/crm-2026-10-20-0300.db');
    // подписанный канонический путь обязан совпадать с тем, что ушло в запрос
    const signedUri = signedHeaders({ method: 'PUT', key: 'karkascrm/crm-2026-10-20-0300.db', bucket: 'karkas-backups', body: payload, region: 'us-east-1', endpoint: `http://127.0.0.1:${port}`, accessKey: 'key', secretKey: 'secret' }).canonicalRequest.split('\n')[0 + 1];
    assert.equal(signedUri, seen[0].url.split('?')[0], 'подпись считается по тому же пути, по которому отправлен файл');
    assert.equal(seen[0].size, payload.length, 'файл уходит целиком, без потерь');
    assert.match(seen[0].auth, /^AWS4-HMAC-SHA256 /, 'запрос подписан');

    const second = await run(process.execPath, ['scripts/upload-backup.mjs'], { cwd: root, env });
    assert.match(second.stdout, /Отправлено сейчас: 0/);
    assert.equal(seen.length, 1, 'повторный запуск не заливает тот же файл снова');
    assert.ok(existsSync(join(dir, '.uploaded.json')));
    assert.ok(JSON.parse(readFileSync(join(dir, '.uploaded.json'), 'utf8'))['crm-2026-10-20-0300.db']);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('ошибка хранилища не прячется: код возврата 1 и понятный текст', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'karkas-s3-'));
  mkdirSync(join(dir, 'backups'), { recursive: true });
  writeFileSync(join(dir, 'backups', 'crm.db'), 'x');
  const server = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(403); res.end('<Error><Code>InvalidAccessKeyId</Code></Error>'); }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    await assert.rejects(
      run(process.execPath, ['scripts/upload-backup.mjs'], { cwd: root, env: { ...process.env, S3_ENDPOINT: `http://127.0.0.1:${port}`, S3_BUCKET: 'b', S3_ACCESS_KEY: 'k', S3_SECRET_KEY: 's', DATA_DIR: dir } }),
      e => e.code === 1 && /HTTP 403/.test(e.stderr),
    );
  } finally {
    await new Promise(r => server.close(r));
  }
});
