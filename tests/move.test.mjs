// Перенос на другой сервер: scripts/move.sh упаковывает том с данными и .env
// и разворачивает их на новой машине. Ошибка здесь стоит всех данных заказчика,
// поэтому круг проверяется целиком на подставных docker и curl: состав архива,
// контрольная сумма, остановка и возврат CRM, права на файлы, страховочная копия
// и выбор профиля tls (свой Caddy не должен отобрать 80 и 443 у чужого сайта).
//
// Запуск:  node --test tests/move.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const HOST_PATH = process.env.PATH || '/usr/bin:/bin';
const lookPath = name => {
  for (const d of HOST_PATH.split(delimiter)) {
    if (d && existsSync(join(d, name))) return join(d, name);
  }
  return '';
};
const BASH = lookPath('bash') || '/bin/bash';
const NODE = lookPath('node') || process.execPath;

// «Том» — обычный каталог, а подставной docker переписывает пути монтирования
// (/data, /out, /in) на настоящие. Так скрипт выполняется целиком, включая tar,
// sha256sum и распаковку, но без настоящего Docker.
const FAKE_DOCKER = String.raw`
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const LOG = process.env.FAKE_LOG;
const VOL = process.env.FAKE_VOLUME;
const log = line => fs.appendFileSync(LOG, line + '\n');
const a = process.argv.slice(2);
const want = (process.env.FAKE_CRM_RUNNING === '1');
const hasContainer = (process.env.FAKE_CONTAINER === '1');

if (a[0] === 'compose') {
  const sub = a.slice(1);
  if (sub[0] === 'version') { console.log('Docker Compose version v2.29.0'); process.exit(0); }
  if (sub[0] === 'ps' && sub[1] === '-q') { if (hasContainer) console.log('crm0123'); process.exit(0); }
  log('compose ' + sub.join(' '));
  process.exit(0);
}
if (a[0] === 'inspect') { console.log(want ? 'true' : 'false'); process.exit(0); }
if (a[0] === 'ps') { log('ps ' + a.slice(1).join(' ')); if (process.env.FAKE_CADDY === '1') console.log('karkascrm-caddy'); process.exit(0); }
if (a[0] === 'volume') {
  if (a[1] === 'inspect') process.exit(fs.existsSync(VOL) ? 0 : 1);
  if (a[1] === 'create') { fs.mkdirSync(VOL, { recursive: true }); log('volume create ' + a[2]); process.exit(0); }
  process.exit(0);
}
if (a[0] === 'image' || a[0] === 'builder') { log(a.join(' ')); process.exit(0); }
if (a[0] === 'run') {
  const maps = [];
  let script = '';
  for (let i = 1; i < a.length; i++) {
    const t = a[i];
    if (t === '-v') { const m = a[++i]; const host = m.slice(0, m.indexOf(':')); const rest = m.slice(m.indexOf(':') + 1); const dst = rest.split(':')[0]; maps.push([dst, host]); continue; }
    if (t === '--user') { i++; continue; }
    if (t === 'sh' && a[i + 1] === '-c') { script = a[i + 2]; break; }
  }
  log('run ' + a.slice(1).filter(x => x !== script).join(' '));
  // пути заменяются от длинного к короткому, и только как целые пути: иначе
  // «/data» внутри «/out/data.tar.gz» испортил бы команду
  let out = script;
  for (const [dst, host] of maps) {
    const real = (dst === '/data') ? VOL : host;
    out = out.replace(new RegExp('(^|[^A-Za-z0-9_./-])' + dst.replace('/', '\\/') + '(?![A-Za-z0-9_.-])', 'g'), '$1' + real);
  }
  // chown от имени обычного пользователя не проходит: фиксируем вызов и не падаем
  const wrapped = 'chown() { printf "chown %s\\n" "$*" >> "' + LOG + '"; }\n' + out;
  const r = spawnSync(process.env.FAKE_SH || '/bin/sh', ['-c', wrapped], { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}
log('unknown ' + a.join(' '));
process.exit(0);
`;

function host({ env = 'CRM_PORT=8080\nCRM_DOMAIN=crm.example.ru\n', volume = {}, running = true, container = true, caddy = false, healthy = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'karkas-move-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(join(ROOT, 'scripts', 'move.sh'), join(dir, 'scripts', 'move.sh'));
  chmodSync(join(dir, 'scripts', 'move.sh'), 0o755);
  writeFileSync(join(dir, 'docker-compose.yml'), 'name: karkascrm\n');
  writeFileSync(join(dir, 'VERSION'), '9.9.9\n');
  writeFileSync(join(dir, '.env.example'), 'CRM_DOMAIN=\nJWT_SECRET=\n');
  if (env !== null) writeFileSync(join(dir, '.env'), env);

  const vol = join(dir, 'volume');
  mkdirSync(vol);
  for (const [name, body] of Object.entries(volume)) {
    const p = join(vol, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }

  const log = join(dir, 'docker-args.log');
  writeFileSync(join(bin, 'docker'), '#!' + NODE + '\n' + FAKE_DOCKER);
  chmodSync(join(bin, 'docker'), 0o755);
  const sh = (name, body) => { writeFileSync(join(bin, name), '#!/bin/sh\n' + body + '\n'); chmodSync(join(bin, name), 0o755); };
  sh('curl', healthy ? 'echo \'{"ok":true,"version":"9.9.9","schema":8}\'; exit 0' : 'exit 7');
  sh('sleep', 'exit 0');
  for (const tool of ['tar', 'sha256sum', 'mktemp', 'date', 'du', 'wc', 'tr', 'sed', 'grep', 'cut', 'cat', 'chmod', 'cp', 'rm', 'mkdir', 'dirname', 'basename', 'hostname', 'sh', 'gzip', 'printf']) {
    const at = lookPath(tool);
    if (at && !existsSync(join(bin, tool))) symlinkSync(at, join(bin, tool));
  }

  const run = (args, opts = {}) => {
    try {
      const out = execFileSync(BASH, [join(dir, 'scripts', 'move.sh'), ...args], {
        cwd: dir,
        env: { PATH: bin, HOME: dir, FAKE_LOG: log, FAKE_VOLUME: vol, FAKE_SH: lookPath('sh') || '/bin/sh',
               FAKE_CRM_RUNNING: running ? '1' : '0', FAKE_CONTAINER: container ? '1' : '0', FAKE_CADDY: caddy ? '1' : '0', ...(opts.env || {}) },
        encoding: 'utf8', stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], timeout: 60000,
        ...(opts.input === undefined ? {} : { input: opts.input }),
      });
      return { code: 0, out, err: '' };
    } catch (e) {
      return { code: e.status === undefined ? 1 : e.status, out: String(e.stdout || ''), err: String(e.stderr || '') };
    }
  };
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
  return { dir, vol, log, run, calls, archives: () => readdirSync(dir).filter(f => f.endsWith('.tar.gz')) };
}

test('упаковка собирает архив с данными, настройками и сведениями о версии', () => {
  const h = host({ volume: { 'crm.db': 'SQLITE-DATA', 'settings.env': 'SMTP_HOST=mail.example.ru\n', '.jwt-secret': 'secret', 'uploads/7/photo.png': 'PNG' } });
  const r = h.run(['pack']);
  assert.equal(r.code, 0, r.err);
  const list = h.archives().filter(f => f.startsWith('karkascrm-move-'));
  assert.equal(list.length, 1, 'архив создан: ' + h.archives().join(', '));
  const out = execFileSync(lookPath('tar') || 'tar', ['tzf', join(h.dir, list[0])], { encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.deepEqual(out.sort(), ['data.tar.gz', 'env', 'move-info.txt'], 'в архиве данные, .env и сведения');
  assert.match(r.out, /Контрольная сумма: [0-9a-f]{64}/, 'оператору показана контрольная сумма');
  assert.match(r.out, /scp karkascrm-move-/, 'показано, как передать архив');
  assert.match(r.out, /move\.sh restore/, 'показана команда развёртывания на новом сервере');
  // сведения о версии лежат в архиве: по ним сверяют, откуда приехали данные
  const info = mkdtempSync(join(tmpdir(), 'karkas-info-'));
  execFileSync(lookPath('tar') || 'tar', ['xzf', join(h.dir, list[0]), '-C', info]);
  const meta = readFileSync(join(info, 'move-info.txt'), 'utf8');
  assert.match(meta, /^version=9\.9\.9$/m, 'версия записана для сверки');
  assert.match(meta, /^data_sha256=[0-9a-f]{64}$/m, 'сумма данных записана');
  assert.match(meta, /^crm_domain=crm\.example\.ru$/m, 'домен прежней установки виден');
  assert.match(meta, /^volume=karkascrm_data$/m, 'имя тома записано');
  assert.match(meta, /^packed_at=\d{4}-\d{2}-\d{2}T/m, 'время упаковки в UTC');
});

test('в архив попадает всё содержимое тома, включая вложения чатов', () => {
  const h = host({ volume: { 'crm.db': 'BASE', 'uploads/3/smeta.pdf': 'PDF', 'backups/night.db': 'BACKUP' } });
  assert.equal(h.run(['pack']).code, 0);
  const archive = h.archives().find(f => f.startsWith('karkascrm-move-'));
  const tmp = mkdtempSync(join(tmpdir(), 'karkas-unpack-'));
  execFileSync(lookPath('tar') || 'tar', ['xzf', join(h.dir, archive), '-C', tmp]);
  execFileSync(lookPath('tar') || 'tar', ['xzf', join(tmp, 'data.tar.gz'), '-C', tmp]);
  assert.equal(readFileSync(join(tmp, 'crm.db'), 'utf8'), 'BASE', 'база перенесена');
  assert.equal(readFileSync(join(tmp, 'uploads/3/smeta.pdf'), 'utf8'), 'PDF', 'вложение чата перенесено');
  assert.equal(readFileSync(join(tmp, 'backups/night.db'), 'utf8'), 'BACKUP', 'копии перенесены');
});

test('на время упаковки CRM останавливается и возвращается в работу', () => {
  const h = host({ volume: { 'crm.db': 'BASE' } });
  const r = h.run(['pack']);
  assert.equal(r.code, 0, r.err);
  const c = h.calls();
  const stop = c.findIndex(x => x === 'compose stop crm');
  const start = c.findIndex(x => x === 'compose start crm');
  assert.ok(stop >= 0, 'CRM остановлена: копия базы должна быть согласованной');
  assert.ok(start > stop, 'CRM снова запущена после упаковки');
  assert.ok(c.some(x => x.startsWith('run ')), 'копия снята через вспомогательный контейнер');
});

test('без файла .env архив всё равно собирается, а оператор предупреждён', () => {
  const h = host({ env: null, volume: { 'crm.db': 'BASE' } });
  const r = h.run(['pack']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Файла \.env нет/, 'предупреждение показано');
  const archive = h.archives().find(f => f.startsWith('karkascrm-move-'));
  const out = execFileSync(lookPath('tar') || 'tar', ['tzf', join(h.dir, archive)], { encoding: 'utf8' });
  assert.ok(!out.includes('env'), 'пустого файла настроек в архиве нет');
});

test('развёртывание переносит данные, права и настройки, затем поднимает CRM', () => {
  const src = host({ volume: { 'crm.db': 'BASE-OLD', 'settings.env': 'SMTP_HOST=mail.example.ru\n', '.jwt-secret': 'sec', 'uploads/1/a.png': 'PNG' }, env: 'CRM_PORT=8090\nCRM_DOMAIN=crm.example.ru\nJWT_SECRET=sekret\n' });
  assert.equal(src.run(['pack']).code, 0);
  const archive = join(src.dir, src.archives().find(f => f.startsWith('karkascrm-move-')));

  // новый сервер: код поставлен, том пустой, CRM ещё не запускалась
  const dst = host({ volume: {}, env: null, running: false, container: false });
  const r = dst.run(['restore', archive]);
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(readFileSync(join(dst.vol, 'crm.db'), 'utf8'), 'BASE-OLD', 'база со старого сервера на месте');
  assert.equal(readFileSync(join(dst.vol, 'uploads/1/a.png'), 'utf8'), 'PNG', 'вложения чатов перенесены');
  assert.equal(readFileSync(join(dst.vol, 'settings.env'), 'utf8'), 'SMTP_HOST=mail.example.ru\n', 'настройки из базы данных перенесены');
  assert.match(readFileSync(join(dst.dir, '.env'), 'utf8'), /JWT_SECRET=sekret/, '.env со старого сервера установлен: сеансы сотрудников сохранятся');
  assert.ok(dst.calls().some(x => x === 'chown -R 1000:1000 ' + dst.vol), 'файлы отданы пользователю контейнера (uid 1000)');
  assert.ok(dst.calls().some(x => x === 'compose up -d --build'), 'CRM собрана и запущена');
  assert.match(r.out, /"ok":true/, 'после запуска проверен отклик /api/health');
  assert.match(r.out, /переключите DNS/i, 'оператору напомнили про домен');
});

test('повреждённый архив не разворачивается, а прежние данные остаются целы', () => {
  const src = host({ volume: { 'crm.db': 'BASE-OLD' } });
  assert.equal(src.run(['pack']).code, 0);
  const archive = join(src.dir, src.archives().find(f => f.startsWith('karkascrm-move-')));

  // портим данные внутри архива: сумма перестанет совпадать
  const tmp = mkdtempSync(join(tmpdir(), 'karkas-bad-'));
  execFileSync(lookPath('tar') || 'tar', ['xzf', archive, '-C', tmp]);
  const broken = readFileSync(join(tmp, 'data.tar.gz'));
  broken[Math.floor(broken.length / 2)] ^= 0xff; // один испорченный байт меняет сумму
  writeFileSync(join(tmp, 'data.tar.gz'), broken);
  const bad = join(tmp, 'bad.tar.gz');
  execFileSync(lookPath('tar') || 'tar', ['czf', bad, '-C', tmp, 'data.tar.gz', 'move-info.txt']);

  const dst = host({ volume: { 'crm.db': 'BASE-NEW' }, env: null, running: false, container: false });
  const r = dst.run(['restore', bad, '--yes']);
  assert.notEqual(r.code, 0, 'развёртывание остановлено');
  assert.match(r.err + r.out, /Контрольная сумма данных не совпала/, 'причина понятна оператору');
  assert.equal(readFileSync(join(dst.vol, 'crm.db'), 'utf8'), 'BASE-NEW', 'том не тронут: данные не потеряны');
  assert.ok(!dst.calls().some(x => x === 'compose up -d --build'), 'CRM не запускалась с битыми данными');
});

test('прежние данные в томе сохраняются страховочной копией', () => {
  const src = host({ volume: { 'crm.db': 'BASE-OLD' } });
  assert.equal(src.run(['pack']).code, 0);
  const archive = join(src.dir, src.archives().find(f => f.startsWith('karkascrm-move-')));

  const dst = host({ volume: { 'crm.db': 'BASE-FRESH' }, env: null, running: false, container: false });
  const r = dst.run(['restore', archive, '--yes']);
  assert.equal(r.code, 0, r.err + r.out);
  const backups = readdirSync(dst.dir).filter(f => f.startsWith('pre-move-') && f.endsWith('.tar.gz'));
  assert.equal(backups.length, 1, 'страховочная копия прежнего тома создана');
  assert.match(r.out, /pre-move-/, 'оператору сказали, где копия');
  assert.equal(readFileSync(join(dst.vol, 'crm.db'), 'utf8'), 'BASE-OLD', 'данные заменены перенесёнными');
});

test('замена данных в томе спрашивает оператора, а для автоматизации есть --yes', () => {
  const script = readFileSync(join(ROOT, 'scripts', 'move.sh'), 'utf8');
  assert.match(script, /read -r ans/, 'вопрос задаётся, когда скрипт запущен человеком');
  assert.match(script, /Отменено: данные в томе не тронуты/, 'ответ «нет» останавливает перенос');
  assert.match(script, /--yes\|-y/, 'флаг --yes снимает вопрос');
  assert.match(script, /\[ -t 0 \]/, 'в cron вопрос не блокирует перенос');

  const src = host({ volume: { 'crm.db': 'BASE-OLD' } });
  assert.equal(src.run(['pack']).code, 0);
  const archive = join(src.dir, src.archives().find(f => f.startsWith('karkascrm-move-')));
  const dst = host({ volume: { 'crm.db': 'BASE-FRESH' }, env: null, running: false, container: false });
  const r = dst.run(['restore', archive, '--yes']);
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(readFileSync(join(dst.vol, 'crm.db'), 'utf8'), 'BASE-OLD', 'данные заменены');
});

test('профиль tls включается только по отметке режима перенесённой установки', () => {
  const withTls = host({ volume: { 'crm.db': 'B' }, env: 'CRM_TLS=1\nCRM_DOMAIN=crm.example.ru\n' });
  assert.equal(withTls.run(['pack']).code, 0);
  const archive = join(withTls.dir, withTls.archives().find(f => f.startsWith('karkascrm-move-')));

  const dst = host({ volume: {}, env: null, running: false, container: false });
  assert.equal(dst.run(['restore', archive]).code, 0);
  assert.ok(dst.calls().some(x => x === 'compose --profile tls up -d --build'), 'свой HTTPS поднимается там, где он был');

  // установка без отметки и без контейнера Caddy: 80 и 443 могут принадлежать чужому сайту
  const noTls = host({ volume: { 'crm.db': 'B' }, env: 'CRM_DOMAIN=crm.example.ru\n' });
  assert.equal(noTls.run(['pack']).code, 0);
  const archive2 = join(noTls.dir, noTls.archives().find(f => f.startsWith('karkascrm-move-')));
  const dst2 = host({ volume: {}, env: null, running: false, container: false });
  assert.equal(dst2.run(['restore', archive2]).code, 0);
  assert.ok(dst2.calls().some(x => x === 'compose up -d --build'), 'запуск без профиля');
  assert.ok(!dst2.calls().some(x => x.includes('--profile tls')), 'чужие 80 и 443 не заняты');
});

test('без docker и без тома скрипт объясняет, что делать', () => {
  const h = host({ volume: { 'crm.db': 'B' } });
  const r = h.run(['restore']);
  assert.notEqual(r.code, 0, 'без архива запуск остановлен');
  assert.match(r.err, /Укажите архив/, 'сообщение понятное');
  const r2 = h.run(['что-то']);
  assert.notEqual(r2.code, 0);
  assert.match(r2.out + r2.err, /Неизвестная команда/, 'неизвестная команда названа');
  assert.match(r2.out + r2.err, /move\.sh pack/, 'показано применение');
});

test('если CRM не отвечает после переноса, оператор видит, куда смотреть', () => {
  const src = host({ volume: { 'crm.db': 'B' } });
  assert.equal(src.run(['pack']).code, 0);
  const archive = join(src.dir, src.archives().find(f => f.startsWith('karkascrm-move-')));
  const dst = host({ volume: {}, env: null, running: false, container: false, healthy: false });
  const r = dst.run(['restore', archive]);
  assert.equal(r.code, 0, 'перенос данных выполнен, даже если сервис ещё поднимается');
  assert.match(r.out, /пока не отвечает/, 'сообщение о проверке живости');
  assert.match(r.out, /docker compose logs -f crm/, 'показано, где смотреть логи');
});
