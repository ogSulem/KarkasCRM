// Регрессии SSRF: локальные тестовые источники этого файла не отключают
// production-политику запрета внутренних адресов.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync } from 'node:zlib';

process.env.DATA_DIR = '/tmp/karkas-ssrf-' + Date.now();
process.env.PORT = '0';
process.env.SEED_MODE = 'off';
process.env.ALLOW_PRIVATE_FETCH = '0';
const { isPrivateIp, safeFetch } = await import('../backend/src/competitors.js');
const { server, pinnedDnsLookup } = await import('../backend/src/server.js');
let base = '';
let localSource;
let localRequests = 0;
let token = '';

const api = async (path, options = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(options.headers || {}) };
  const response = await fetch(base + path, { ...options, headers });
  const type = response.headers.get('content-type') || '';
  return { status: response.status, body: type.includes('application/json') ? await response.json() : await response.text() };
};
const fakeResponse = (statusCode, headers = {}, body = Buffer.alloc(0)) => ({
  statusCode,
  headers,
  destroyed: false,
  destroy() { this.destroyed = true; },
  async *[Symbol.asyncIterator]() { if (body.length) yield body; },
});

before(async () => {
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  localSource = http.createServer((req, res) => {
    localRequests++;
    res.writeHead(200, { 'Content-Type': 'text/csv' });
    res.end('Наименование;Цена\nЛокальный секрет;1\n');
  });
  await new Promise(resolve => localSource.listen(0, '127.0.0.1', resolve));
  const first = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@example.com', password: 'admin1234567' }) });
  assert.equal(first.status, 200, 'администратор входит в изолированную тестовую CRM');
  token = first.body.token;
  if (first.body.user?.must_change_password) {
    const changed = await api('/api/me/password', { method: 'POST', body: JSON.stringify({ old_password: 'admin1234567', new_password: 'SSRF-Test-Admin-2026!' }) });
    assert.equal(changed.status, 200);
    token = changed.body.token;
  }
});
after(async () => {
  if (localSource?.listening) await new Promise(resolve => localSource.close(resolve));
  if (server.listening) await new Promise(resolve => server.close(resolve));
});

test('адресный фильтр запрещает частные, специальные и немаршрутизируемые IP', () => {
  const blocked = [
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '192.0.0.9', '192.0.2.1', '192.168.1.1', '192.88.99.1',
    '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.0.0.1',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:192.168.1.1', 'fc00::1', 'fd12::1',
    'fe80::1', 'ff02::1', '2001::1', '2001:db8::1', '2002:7f00:1::1',
    '64:ff9b::a00:1', '64:ff9b:1::a00:1', '100::1', '3fff::1', 'not-an-ip',
  ];
  for (const address of blocked) assert.equal(isPrivateIp(address), true, `${address} must be blocked`);
  for (const address of ['8.8.8.8', '93.184.216.34', '2001:4860:4860::8888'])
    assert.equal(isPrivateIp(address), false, `${address} is a public unicast address`);
});

test('HTTP-загрузка через CRM не подключается к loopback IPv4 или IPv6', async () => {
  const port = localSource.address().port;
  for (const url of [`http://127.0.0.1:${port}/secret.csv`, `http://[::1]:${port}/secret.csv`]) {
    const result = await api('/api/prices/ours', { method: 'POST', body: JSON.stringify({ url }) });
    assert.equal(result.status, 400, `внутренний адрес отклонён: ${url}`);
    assert.match(result.body.error, /внутренний|специальный/i);
  }
  assert.equal(localRequests, 0, 'запросы не достигли сервера во внутренней сети');
});

test('HTTP-клиент Node 22 подключается по pin-IP с режимом lookup all=true', async () => {
  let hits = 0;
  const target = http.createServer((req, res) => { hits++; res.end('attached'); });
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  try {
    const result = await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: 'attachment.example.test', port: target.address().port, path: '/file',
        lookup: pinnedDnsLookup('127.0.0.1'),
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
      });
      request.on('error', reject);
      request.end();
    });
    assert.deepEqual(result, { status: 200, body: 'attached' });
    assert.equal(hits, 1, 'HTTP подключился только к зафиксированному адресу');
  } finally {
    await new Promise(resolve => target.close(resolve));
  }
});

test('DNS-проверенный IP используется для соединения без второго разрешения имени', async () => {
  let resolveCalls = 0;
  let pinnedAddresses = [];
  const resolver = async hostname => {
    resolveCalls++;
    assert.equal(hostname, 'rebinding.example.test');
    // Между проверкой и подключением небезопасная реализация делала бы второй
    // системный DNS lookup, который мог уже вернуть адрес злоумышленника.
    return [{ address: '8.8.8.8', family: 4 }];
  };
  const request = async (url, options) => {
    const resolved = await new Promise((resolve, reject) => options.lookup(url.hostname, { all: true }, (error, addresses) => error ? reject(error) : resolve(addresses)));
    pinnedAddresses = resolved.map(x => x.address);
    return fakeResponse(200, {}, Buffer.from('pinned'));
  };
  const result = await safeFetch('http://rebinding.example.test/data', {}, 1000, { lookup: resolver, request });
  assert.equal(result.text, 'pinned');
  assert.equal(resolveCalls, 1, 'проверка и сетевое подключение используют один DNS-ответ');
  assert.deepEqual(pinnedAddresses, ['8.8.8.8'], 'HTTP-слой получает только проверенный адрес');
});

test('редирект повторно проверяется до подключения к приватному адресу', async () => {
  const hosts = [];
  const resultRequest = async (url, options) => {
    hosts.push(url.hostname);
    // Проверяем, что первый переход также закреплён за публичным адресом.
    await new Promise((resolve, reject) => options.lookup(url.hostname, { all: true }, error => error ? reject(error) : resolve()));
    return fakeResponse(302, { location: 'http://127.0.0.1:8080/private' });
  };
  await assert.rejects(
    safeFetch('http://public.example.test/start', {}, 1000, {
      lookup: async () => [{ address: '8.8.8.8', family: 4 }], request: resultRequest,
    }),
    /внутренний или специальный адрес/,
  );
  assert.deepEqual(hosts, ['public.example.test'], 'до приватного адреса сетевой запрос не отправлен');
});

test('сжатый HTTP-ответ распаковывается, но ограничение защищает от gzip-бомбы', async () => {
  const resolver = async () => [{ address: '8.8.8.8', family: 4 }];
  const body = gzipSync(Buffer.from('Прайс;данные'));
  const result = await safeFetch('http://public.example.test/file', {}, 1000, {
    lookup: resolver,
    request: async () => fakeResponse(200, { 'content-encoding': 'gzip', 'content-length': String(body.length) }, body),
  });
  assert.equal(result.text, 'Прайс;данные');

  const bomb = gzipSync(Buffer.alloc(8 * 1024 * 1024 + 1, 0x61));
  await assert.rejects(safeFetch('http://public.example.test/bomb', {}, 1000, {
    lookup: resolver,
    request: async () => fakeResponse(200, { 'content-encoding': 'gzip', 'content-length': String(bomb.length) }, bomb),
  }), /Ответ слишком большой/);
});
