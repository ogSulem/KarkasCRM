#!/usr/bin/env bash
# Проверка KarkasCRM: синтаксис, интеграционные тесты, миграции базы и (опционально) интерфейс.
set -euo pipefail
cd "$(dirname "$0")"

command -v node >/dev/null || { echo "Node.js не найден (нужен 22.5+)"; exit 1; }

echo "▶ 1/4 Проверка синтаксиса"
node --check backend/src/server.js
node --check backend/src/competitors.js
node --check backend/src/smtp.js
node --check frontend/public/app.js

echo "▶ 2/4 Интеграционные тесты (API + конкуренты + миграции базы)"
node --experimental-sqlite --test tests/api.test.js tests/competitors.test.js
node --experimental-sqlite tests/migrate.test.mjs

echo "▶ 3/4 Проверка docker-compose и Caddyfile"
if python3 -c 'import yaml' 2>/dev/null; then
  python3 << 'PY'
import yaml, sys
try:
    d = yaml.safe_load(open('docker-compose.yml'))
except Exception as e:
    print('  ❌ docker-compose.yml не разобран:', e); sys.exit(1)
svc = d.get('services', {})
assert 'crm' in svc and 'caddy' in svc, 'нет сервисов crm/caddy'
assert svc['caddy'].get('profiles') == ['tls'], 'caddy должен быть в профиле tls'
assert 'CRM_DOMAIN' in (svc['caddy'].get('environment') or {}), 'caddy без домена из .env'
print('  ✅ docker-compose.yml: сервисы', ', '.join(svc), '| профиль tls и домен из .env настроены')
PY
else
  echo "  (pyyaml нет — проверяю ключевые строки docker-compose.yml)"
  grep -q 'profiles: \["tls"\]' docker-compose.yml && grep -q '^  caddy:' docker-compose.yml \
    && grep -q 'CRM_DOMAIN' docker-compose.yml && grep -q 'restart: unless-stopped' docker-compose.yml \
    && echo "  ✅ docker-compose.yml: сервис caddy в профиле tls, домен из .env, автоперезапуск" \
    || { echo "  ❌ docker-compose.yml: не найдены профиль tls / сервис caddy / CRM_DOMAIN"; exit 1; }
fi

echo "  • Caddyfile (домен и HTTPS)"
python3 << 'CADDYCHECK'
import sys
conf = open('deploy/Caddyfile').read()
checks = {'{$CRM_DOMAIN}': 'домен из .env', 'reverse_proxy crm:8080': 'прокси в CRM',
          '.well-known/health': 'проверка домена', 'Strict-Transport-Security': 'HSTS'}
missing = [name for frag, name in checks.items() if frag not in conf]
if missing:
    print('  ❌ Caddyfile: не найдено —', ', '.join(missing)); sys.exit(1)
print('  ✅ Caddyfile: домен из .env, прокси на crm:8080, https://домен/.well-known/health → ok, HSTS')
CADDYCHECK

echo "▶ 4/4 Smoke-тест интерфейса (нужен jsdom, иначе шаг пропускается)"
if node -e "import('jsdom').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; then
  node --experimental-sqlite tests/ui.smoke.mjs
elif [ -n "${JSDOM_PATH:-}" ]; then
  JSDOM_PATH="$JSDOM_PATH" node --experimental-sqlite tests/ui.smoke.mjs
else
  if npm i --prefix /tmp/jsdomtest jsdom >/dev/null 2>&1; then
    JSDOM_PATH=/tmp/jsdomtest/node_modules/jsdom/lib/api.js node --experimental-sqlite tests/ui.smoke.mjs
  else
    echo "  ⏭ jsdom недоступен — шаг пропущен (необязательно). Установить: npm i --prefix /tmp/jsdomtest jsdom"
  fi
fi

echo
echo "✅ Все проверки пройдены."
