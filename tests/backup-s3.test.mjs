// Резервная копия на другой сервер: подпись запросов к S3 и сама выгрузка.
// Проверки идут без внешней сети — поднимаем локальный сервер, который
// притворяется хранилищем, и смотрим, что скрипт отправляет ровно один PUT.
import { test } from 'node:test';
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
    assert.equal(seen[0].url, '/karkascrm/crm-2026-10-20-0300.db');
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
