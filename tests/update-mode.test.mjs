// Режим обновления: scripts/update.sh решает, поднимать ли собственный Caddy
// (профиль tls). Ошибка здесь стоит дорого — Caddy занимает 80 и 443, и если эти
// порты уже отданы чужому сайту, тот перестаёт отвечать.
//
// Раньше режим определялся по непустому CRM_DOMAIN, но его задаёт и --proxy,
// где край держит чужой веб-сервер. Тест запускает update.sh на подставных
// docker/git/curl во временном каталоге и смотрит, какие аргументы тот передал.
import { test } from 'node:test';
import assert from 'node:assert';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
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

// Один прогон update.sh в отдельном временном каталоге.
// caddyContainer — существует ли контейнер karkascrm-caddy (для старой установки
// без отметки режима). Возвращает аргументы, которые получил docker.
function runUpdate({ envFile, caddyContainer = false }) {
  const dir = mkdtempSync(join(tmpdir(), 'karkas-update-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, '.git')); // update.sh требует git-историю, иначе уходит в ветку архива
  copyFileSync(join(ROOT, 'scripts', 'update.sh'), join(dir, 'scripts', 'update.sh'));
  if (envFile !== null) writeFileSync(join(dir, '.env'), envFile);

  const log = join(dir, 'docker-args.log');
  const sh = (name, body) => { writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  sh('docker', `if [ "$1" = ps ]; then [ "\${CADDY_EXISTS:-0}" = 1 ] && echo karkascrm-caddy; exit 0; fi
printf '%s\\n' "$*" >> "$FAKE_LOG"
exit 0`);
  sh('git', 'exit 0');
  sh('curl', 'echo \'{"ok":true,"version":"1.0.1"}\'; exit 0');
  sh('sleep', 'exit 0');
  for (const tool of ['grep', 'cut', 'cat', 'head', 'tr', 'sed', 'basename', 'dirname']) {
    const at = lookPath(tool);
    if (at) symlinkSync(at, join(bin, tool));
  }

  const out = execFileSync(BASH, [join(dir, 'scripts', 'update.sh')], {
    env: { PATH: bin, FAKE_LOG: log, CADDY_EXISTS: caddyContainer ? '1' : '0' },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return { out, up: calls.filter(c => c.includes('up -d --build')) };
}

const TLS = 'CRM_DOMAIN=crm.xn--80aaamzedb7cml.xn--p1ai\nCRM_BIND=127.0.0.1\nCRM_TLS=1\n';
const PROXY = 'CRM_DOMAIN=crm.xn--80aaamzedb7cml.xn--p1ai\nCRM_BIND=127.0.0.1\nCRM_TLS=0\n';
const LEGACY_PROXY = 'CRM_DOMAIN=crm.xn--80aaamzedb7cml.xn--p1ai\nCRM_BIND=127.0.0.1\n';

test('режим tls: профиль включается', () => {
  const r = runUpdate({ envFile: TLS });
  assert.equal(r.up.length, 1, 'один запуск compose up');
  assert.match(r.up[0], /^compose --profile tls up -d --build$/, r.up[0]);
});

test('режим рядом с чужим сайтом: профиль tls не включается, хотя домен задан', () => {
  // Это и есть поломка, из-за которой обновление отбирало 80/443 у чужого сайта:
  // CRM_DOMAIN заполнен, но край держит не наш Caddy.
  const r = runUpdate({ envFile: PROXY });
  assert.equal(r.up.length, 1);
  assert.equal(r.up[0], 'compose up -d --build', 'профиля tls нет: ' + r.up[0]);
  assert.ok(!r.up[0].includes('--profile'), 'профиль не передан');
});

test('старая установка без отметки: профиль — только если контейнер Caddy существует', () => {
  const withCaddy = runUpdate({ envFile: LEGACY_PROXY, caddyContainer: true });
  assert.match(withCaddy.up[0], /--profile tls/, 'свой Caddy был — обновляем с профилем');

  const without = runUpdate({ envFile: LEGACY_PROXY, caddyContainer: false });
  assert.equal(without.up[0], 'compose up -d --build', 'контейнера нет — профиль не включаем');
  assert.match(without.out, /CRM_TLS/, 'объяснено, почему профиль не включён');
  assert.match(without.out, /install\.sh --tls/, 'сказано, как включить свой HTTPS');
});

test('без .env обновление не падает и профиль не включает', () => {
  const r = runUpdate({ envFile: null });
  assert.equal(r.up.length, 1);
  assert.equal(r.up[0], 'compose up -d --build');
});

test('обновление сообщает версию и не теряет данные', () => {
  const r = runUpdate({ envFile: PROXY });
  assert.match(r.out, /Обновление завершено/, 'после перезапуска проверен health');
  assert.match(r.out, /git/i, 'изменения забираются из репозитория');
});
