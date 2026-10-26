#!/usr/bin/env bash
# Проверка KarkasCRM: синтаксис, интеграционные тесты, миграции базы и (опционально) интерфейс.
set -euo pipefail
cd "$(dirname "$0")"

command -v node >/dev/null || { echo "Node.js не найден (нужен 22.5+)"; exit 1; }

echo "[1/4] Проверка синтаксиса"
node --check backend/src/server.js
node --check backend/src/competitors.js
node --check backend/src/smtp.js
node --check frontend/public/app.js
node --check tests/routes.test.mjs
node --check tests/timezone.test.js
node --check tests/install-args.test.mjs
node --check tests/update-mode.test.mjs
node --check tests/wazzup-contract.test.mjs
node --check tests/mail.test.mjs
# Скрипты установки и сопровождения. Ни один тест кода их не запускает, поэтому
# опечатка в install.sh доходит до сервера пользователя: скрипт просто не стартует.
for sh in install.sh run-local.sh run-tests.sh scripts/update.sh scripts/pack.sh deploy/start-caddy.sh; do
  bash -n "$sh" || { echo "  ОШИБКА: синтаксис $sh"; exit 1; }
done

echo "[2/4] Интеграционные тесты (API, конкуренты, уведомления, гигиена базы, контракт Wazzup, почта, маршруты, часовой пояс, установщик, обновление, миграции, S3)"
node --experimental-sqlite --test tests/api.test.js tests/competitors.test.js tests/notifications.test.mjs tests/db-hygiene.test.mjs
# Контракт Wazzup сверяется с документацией вендора на подставном API: расхождение
# здесь выглядит как «синхронизировано: 0» или как недоставленное сообщение.
node --experimental-sqlite --test tests/wazzup-contract.test.mjs
# Почта проверяется на подставном SMTP-сервере: письмо должно дойти целиком,
# вместе со структурой вложения и ссылкой на документ.
node --experimental-sqlite --test tests/mail.test.mjs
node --test tests/routes.test.mjs
# Часовой пояс задан явно: в UTC модификатор localtime совпадает с UTC и сдвиг
# на три часа между отметками в базе и местным месяцем выручки не увидеть.
TZ=Europe/Moscow node --experimental-sqlite --test tests/timezone.test.js
# Аргументы установщика — без docker, на копии скрипта во временном каталоге
node --test tests/install-args.test.mjs
# Режим обновления — на подставных docker/git/curl: ошибка здесь стоит портов
# 80/443 чужого сайта, поэтому профиль tls должен включаться только по отметке режима
node --test tests/update-mode.test.mjs
node --experimental-sqlite tests/migrate.test.mjs
node --experimental-sqlite tests/seed.test.mjs
node --test tests/backup-s3.test.mjs

echo "[3/4] Проверка docker-compose, Caddyfile и CI"
# Ошибка в YAML воркфлоу не выглядит как ошибка: прогон падает за 0 секунд
# с подписью «workflow file issue», а проверки в pull request просто не
# появляются. Проверяем файл до пуша.
python3 << 'WFCHECK'
import re, sys
path = '.github/workflows/tests.yml'
src = open(path, encoding='utf-8').read()
parsed = False
try:
    import yaml
    yaml.safe_load(src)
    parsed = True
except ImportError:
    pass
except Exception as e:
    print('  ОШИБКА: YAML воркфлоу не разобран:', str(e).splitlines()[0]); sys.exit(1)
# Незакавыченное значение с «: » внутри парсер читает как второй ключ —
# именно так ломается имя шага вида «- name: Маршруты API: …».
bad = []
for i, line in enumerate(src.splitlines(), 1):
    m = re.match(r'^\s*-?\s*(name|run|if|uses|shell):\s+(.+)$', line)
    if not m:
        continue
    val = m.group(2).strip()
    if val[:1] in ('"', "'", '|', '>'):
        continue
    if ': ' in val or val.endswith(':'):
        bad.append('строка %d: %s' % (i, val[:60]))
if bad:
    print('  ОШИБКА: воркфлоу: значение с «: » без кавычек — ' + '; '.join(bad)); sys.exit(1)
if not re.search(r'^\s*-\s*uses:\s*actions/checkout', src, re.M):
    print('  ОШИБКА: воркфлоу: нет шага actions/checkout'); sys.exit(1)
print('  ok   воркфлоу CI разбирается' + (' (проверено парсером YAML)' if parsed else ' (кавычки, «: » и checkout проверены)'))
WFCHECK

if python3 -c 'import yaml' 2>/dev/null; then
  python3 << 'PY'
import yaml, sys
try:
    d = yaml.safe_load(open('docker-compose.yml'))
except Exception as e:
    print('  ОШИБКА: docker-compose.yml не разобран:', e); sys.exit(1)
svc = d.get('services', {})
assert 'crm' in svc and 'caddy' in svc, 'нет сервисов crm/caddy'
assert svc['caddy'].get('profiles') == ['tls'], 'caddy должен быть в профиле tls'
assert 'CRM_DOMAIN' in (svc['caddy'].get('environment') or {}), 'caddy без домена из .env'
print('  ok   docker-compose.yml: сервисы', ', '.join(svc), '| профиль tls и домен из .env настроены')
PY
else
  echo "  (pyyaml нет — проверяю ключевые строки docker-compose.yml)"
  grep -q 'profiles: \["tls"\]' docker-compose.yml && grep -q '^  caddy:' docker-compose.yml \
    && grep -q 'CRM_DOMAIN' docker-compose.yml && grep -q 'restart: unless-stopped' docker-compose.yml \
    && echo "  ok   docker-compose.yml: сервис caddy в профиле tls, домен из .env, автоперезапуск" \
    || { echo "  ОШИБКА: docker-compose.yml: не найдены профиль tls / сервис caddy / CRM_DOMAIN"; exit 1; }
fi

echo "  - Caddyfile (домен и HTTPS)"
python3 << 'CADDYCHECK'
import sys
conf = open('deploy/Caddyfile').read()
checks = {'{$CRM_DOMAIN}': 'домен из .env', 'reverse_proxy crm:8080': 'прокси в CRM',
          '.well-known/health': 'проверка домена', 'Strict-Transport-Security': 'HSTS'}
missing = [name for frag, name in checks.items() if frag not in conf]
if missing:
    print('  ОШИБКА: Caddyfile: не найдено —', ', '.join(missing)); sys.exit(1)
print('  ok   Caddyfile: домен из .env, прокси на crm:8080, https://домен/.well-known/health → ok, HSTS')
CADDYCHECK

echo "  - файлы для Dockerfile не исключены из контекста сборки"
python3 << 'DOCKERCTX'
import sys
lines = open('Dockerfile').read().splitlines()
dockerignore = [l.strip().rstrip('/') for l in open('.dockerignore').read().splitlines()
                if l.strip() and not l.strip().startswith('#')]
errors = []
for line in lines:
    if not line.startswith('COPY '):
        continue
    parts = line[5:].split()
    if len(parts) < 2:
        continue
    for src in parts[:-1]:
        if src.startswith('--'):
            continue
        import os
        if not os.path.exists(src):
            errors.append(f'{src}: нет такого файла или каталога'); continue
        for ign in dockerignore:
            if ign.startswith('*'):
                continue  # шаблоны вида *.md проверять смысла нет
            if src == ign or src.startswith(ign + '/'):
                errors.append(f'{src}: исключён .dockerignore («{ign}») — сборка упадёт')
if errors:
    print('  ОШИБКА: Dockerfile и .dockerignore:', '; '.join(errors)); sys.exit(1)
print('  ok   Dockerfile: все COPY-источники есть и не отсечены .dockerignore')
DOCKERCTX

echo "  - nginx-пример для сервера с уже занятыми 80/443"
NGINX=deploy/nginx.conf
for frag in 'X-Forwarded-For' 'proxy_buffering off' 'client_max_body_size' 'proxy_read_timeout'; do
  grep -q "$frag" "$NGINX" || { echo "  ОШИБКА: nginx.conf: нет $frag"; exit 1; }
done
grep -q 'proxy_set_header Host $host' "$NGINX" || { echo "  ОШИБКА: nginx.conf: не передаётся Host"; exit 1; }
echo "  ok   nginx.conf: реальный IP клиента, Host, размер тела и таймауты для чатов"

echo "  - пример Caddy для того же случая (край держит Caddy, а не nginx)"
CADDYSITE=deploy/caddy-site.conf
for frag in 'crm.example.com' 'flush_interval -1' 'max_size 25MB' 'reverse_proxy 127.0.0.1:8080' 'docker network connect karkascrm_default'; do
  grep -qF "$frag" "$CADDYSITE" || { echo "  ОШИБКА: caddy-site.conf: нет «$frag»"; exit 1; }
done
# без немедленной отправки Caddy копит поток, и живые события чата приходят пачкой
grep -qF 'request_body' "$CADDYSITE" || { echo "  ОШИБКА: caddy-site.conf: нет ограничения размера тела"; exit 1; }
grep -q 'deploy/caddy-site.conf' install.sh || { echo "  ОШИБКА: install.sh не предлагает пример для Caddy"; exit 1; }
echo "  ok   caddy-site.conf: SSE без буферизации, размер тела, прокси, сеть контейнера; install.sh его печатает"

echo "  - .env.example описывает необязательные параметры"
for key in PUBLIC_URL LOGO_FILE ALLOW_PRIVATE_FETCH KARKAS_NO_SEED S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY; do
  grep -q "^$key=" .env.example || { echo "  ОШИБКА: .env.example: нет $key"; exit 1; }
done
for key in S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY; do
  grep -q "$key" docker-compose.yml || { echo "  ОШИБКА: docker-compose.yml: не пробрасывается $key"; exit 1; }
done
echo "  ok   .env.example и compose: PUBLIC_URL, LOGO_FILE, ALLOW_PRIVATE_FETCH, KARKAS_NO_SEED, S3_*"

echo "  - отметка режима установки (CRM_TLS)"
# По одному CRM_DOMAIN режим не определить: его задаёт и --proxy, где 80/443
# принадлежат чужому веб-серверу. update.sh обязан читать отметку режима.
grep -q "^CRM_TLS=" .env.example || { echo "  ОШИБКА: .env.example: нет отметки режима CRM_TLS"; exit 1; }
grep -q "CRM_TLS" scripts/update.sh || { echo "  ОШИБКА: update.sh не читает CRM_TLS"; exit 1; }
grep -q "set_env CRM_TLS" install.sh || { echo "  ОШИБКА: install.sh не проставляет CRM_TLS"; exit 1; }
echo "  ok   CRM_TLS: install.sh проставляет, update.sh читает, шаблон описывает"

echo "[4/4] Smoke-тест интерфейса (нужен jsdom, иначе шаг пропускается)"
# Указанный JSDOM_PATH обязан существовать. Иначе тест молча завершится успехом,
# не выполнив ни одной проверки интерфейса, и прогон будет выглядеть зелёным.
if [ -n "${JSDOM_PATH:-}" ] && [ ! -f "${JSDOM_PATH}" ]; then
  echo "  ОШИБКА: JSDOM_PATH=${JSDOM_PATH} не существует — проверки интерфейса не выполнены."
  echo "  Установить: npm i --prefix /tmp/jsdomtest jsdom"
  exit 1
fi
if node -e "import('jsdom').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; then
  node --experimental-sqlite tests/ui.smoke.mjs
elif [ -n "${JSDOM_PATH:-}" ]; then
  JSDOM_PATH="$JSDOM_PATH" node --experimental-sqlite tests/ui.smoke.mjs
else
  if npm i --prefix /tmp/jsdomtest jsdom >/dev/null 2>&1; then
    JSDOM_PATH=/tmp/jsdomtest/node_modules/jsdom/lib/api.js node --experimental-sqlite tests/ui.smoke.mjs
  else
    echo "  ВНИМАНИЕ: jsdom недоступен, проверки интерфейса НЕ ВЫПОЛНЕНЫ."
    echo "  Прогон не покрыл интерфейс. Установить: npm i --prefix /tmp/jsdomtest jsdom"
  fi
fi

echo
echo "Все проверки пройдены."
