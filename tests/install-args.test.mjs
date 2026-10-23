// Разбор аргументов install.sh. Раньше этот скрипт не проверялся ничем, и
// опечатка в case отправила на сервер установщик, который отказывался
// запускаться без --port: пустое значение попало в ветку «не число».
//
// Тест герметичный: установщик копируется во временный каталог и запускается
// с PATH, в котором нет docker. Проверка аргументов идёт до проверки docker,
// поэтому ответ «Docker не установлен» означает, что аргументы приняты.
// Настоящий репозиторий не затрагивается: .env не создаётся, compose не идёт.
import { test } from 'node:test';
import assert from 'node:assert';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const HOST_PATH = process.env.PATH || '/usr/bin:/bin';
const lookPath = name => {
  for (const d of HOST_PATH.split(delimiter)) {
    if (!d) continue;
    const at = join(d, name);
    if (existsSync(at)) return at;
  }
  return '';
};

const dir = mkdtempSync(join(tmpdir(), 'karkas-install-'));
const bin = join(dir, 'bin');
mkdirSync(bin);
for (const tool of ['cat', 'sed', 'grep', 'cp', 'chmod', 'openssl', 'tr', 'head', 'seq', 'sleep', 'curl', 'hostname', 'awk', 'printf']) {
  const at = lookPath(tool);
  if (at) symlinkSync(at, join(bin, tool));
}
const BASH = lookPath('bash') || '/bin/bash';
copyFileSync(join(ROOT, 'install.sh'), join(dir, 'install.sh'));
copyFileSync(join(ROOT, '.env.example'), join(dir, '.env.example'));
chmodSync(join(dir, 'install.sh'), 0o755);

const envBefore = existsSync(join(ROOT, '.env'));

const run = args => {
  try {
    const stdout = execFileSync(BASH, [join(dir, 'install.sh'), ...args], { env: { PATH: bin }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') };
  }
};
// Аргументы приняты: скрипт дошёл до проверки docker и остановился на ней.
const accepted = r => r.code === 1 && /Docker не установлен/.test(r.out);

test('запуск без --port принимается: порт берётся из .env', () => {
  for (const args of [[], ['--proxy', 'crm.example.ru'], ['--tls', 'crm.example.ru'], ['--proxy'], ['--proxy', 'crm.xn--80aaamzedb7cml.xn--p1ai']]) {
    const r = run(args);
    assert.ok(accepted(r), `./install.sh ${args.join(' ')} доходит до docker, а не падает на порте: ${r.out.split('\n')[0]}`);
    assert.ok(!/Порт должен быть числом/.test(r.out), `./install.sh ${args.join(' ')} не жалуется на порт`);
  }
});

test('явный --port тоже принимается, в любом порядке флагов', () => {
  for (const args of [['--port', '9090'], ['--proxy', 'crm.example.ru', '--port', '9090'], ['--port', '9090', '--proxy', 'crm.example.ru'], ['--tls', 'crm.example.ru', 'me@mail.ru', '--port', '8443']]) {
    const r = run(args);
    assert.ok(accepted(r), `./install.sh ${args.join(' ')} доходит до docker: ${r.out.split('\n')[0]}`);
  }
});

test('порт не числом отклоняется до проверки docker', () => {
  for (const bad of ['80x80', 'abc', '80 80', '-1']) {
    const r = run(['--port', bad]);
    assert.equal(r.code, 1);
    assert.match(r.out, /Порт должен быть числом/, `--port ${JSON.stringify(bad)} отклоняется`);
  }
});

test('режим с доменом требует домен, неизвестный флаг отклоняется', () => {
  const noDomain = run(['--tls']);
  assert.equal(noDomain.code, 1);
  assert.match(noDomain.out, /Для режима с доменом укажите его/);

  const bogus = run(['--bogus']);
  assert.equal(bogus.code, 1);
  assert.match(bogus.out, /Неизвестный аргумент/);
});

test('--help печатает справку и завершается успешно', () => {
  const r = run(['--help']);
  assert.equal(r.code, 0, 'справка — не ошибка');
  assert.match(r.out, /Использование:/);
  assert.match(r.out, /--proxy/, 'в справке есть режим рядом с чужим сайтом');
  assert.match(r.out, /--tls/, 'в справке есть режим с HTTPS');
});

test('установщик не трогает репозиторий и не создаёт .env до проверки docker', () => {
  // во временном каталоге .env не появился: скрипт вышел раньше
  assert.ok(!existsSync(join(dir, '.env')), 'копия установщика не создала .env');
  assert.deepEqual(readdirSync(dir).filter(f => f !== 'bin').sort(), ['.env.example', 'install.sh'], 'во временном каталоге только скопированные файлы');
  // настоящий репозиторий не изменился
  assert.equal(existsSync(join(ROOT, '.env')), envBefore, 'install.sh в репозитории не запускался');
});
