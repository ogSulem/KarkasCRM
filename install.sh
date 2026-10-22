#!/usr/bin/env bash
# KarkasCRM — установка в одну команду.
#
#   ./install.sh                       локально или на сервере без домена → http://localhost:8080 (или http://IP:8080)
#   ./install.sh --tls crm.домен.ru    сервер СВОБОДЕН → HTTPS на 80/443 через Caddy (профиль tls)
#   ./install.sh --tls crm.домен.ru me@mail.ru
#   ./install.sh --proxy crm.домен.ru  на сервере УЖЕ крутится сайт → CRM на 127.0.0.1:8080,
#                                      80/443 не трогаем, наружу её отдаёт ваш nginx/apache
#   ./install.sh --port 9090           занять другой порт, если 8080 уже используется
#
# Перед запуском скрипт проверяет, свободны ли нужные порты: на сервере может
# работать чужой сайт, и падать с невнятным «address already in use» поздно.
#
# Всё остальное настраивается позже прямо в интерфейсе CRM — код править не нужно.
set -euo pipefail
cd "$(dirname "$0")"

MODE="local"; DOMAIN=""; EMAIL=""; PORT_ARG=""

usage() {
  cat << 'TXT'
Использование:
  ./install.sh                                  запуск на локалке/по IP (http://localhost:8080)
  ./install.sh --tls crm.example.ru [email]     домен с HTTPS (Caddy + Let's Encrypt); 80 и 443 должны быть свободны
  ./install.sh --proxy crm.example.ru           на сервере уже работает сайт: CRM на 127.0.0.1, 80/443 не трогаем
  ./install.sh --port 9090                      занять другой порт (сочетается с любым режимом)

Полезные команды после установки:
  docker compose logs -f crm          логи приложения
  docker compose ps                   статус контейнеров
  docker compose down                 остановить
  docker compose --profile tls logs -f caddy   логи HTTPS-прокси
TXT
}

while [ $# -gt 0 ]; do
  case "$1" in
    --tls)   MODE="tls"; DOMAIN="${2:-}"; EMAIL="${3:-}"; shift $(( $# >= 3 ? 3 : $# )) ;;
    --proxy) MODE="proxy"; case "${2:-}" in ''|--*) ;; *) DOMAIN="$2"; shift ;; esac; shift ;;
    --port)  PORT_ARG="${2:-}"; if [ -n "$PORT_ARG" ]; then shift; fi; shift ;;
    --local) MODE="local"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Неизвестный аргумент: $1"; usage; exit 1 ;;
  esac
done

command -v docker >/dev/null || { echo "Docker не установлен. Поставьте: curl -fsSL https://get.docker.com | sh"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Нужен Docker Compose v2 (идёт вместе с Docker). Проверьте: docker compose version"; exit 1; }

if [ "$MODE" = "tls" ] && [ -z "$DOMAIN" ]; then
  echo "Для режима с доменом укажите его: ./install.sh --tls crm.example.ru [email]"; exit 1
fi
case "$PORT_ARG" in
  ''|*[!0-9]*) echo "Порт должен быть числом: ./install.sh --port 9090"; exit 1 ;;
esac

# ── .env: создаём из шаблона и заполняем секреты/режим ──────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  # секреты не должны быть читаемы другим пользователям сервера
  chmod 600 .env 2>/dev/null || true
  if command -v openssl >/dev/null; then
    SECRET=$(openssl rand -hex 32); PASS=$(openssl rand -hex 12)
  else
    # openssl есть не всегда — берём ту же энтропию из /dev/urandom
    SECRET=$(tr -dc 'a-f0-9' </dev/urandom | head -c 64)
    PASS=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)
  fi
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$SECRET|" .env
  sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$PASS|" .env
  echo "──────────────────────────────────────────────"
  echo " Создан .env с автоматическими секретами."
  echo " Пароль администратора: $(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"
  echo " Логин:                 $(grep '^ADMIN_EMAIL=' .env | cut -d= -f2-)"
  echo "──────────────────────────────────────────────"
fi

chmod 600 .env 2>/dev/null || true

set_env() { # set_env KEY VALUE — заменяет строку в .env или добавляет её
  local key="$1" value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

# ── порты: проверяем до сборки и запуска ────────────────────────────────────
# На сервере обычно уже что-то работает. Docker в этом случае падает с невнятным
# «address already in use» уже после долгой сборки образа, поэтому смотрим заранее.
port_busy() { # port_busy ПОРТ → 0, если порт кем-то занят
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${p}\$"; then return 0; fi
    return 1
  fi
  if command -v netstat >/dev/null 2>&1; then
    if netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${p}\$"; then return 0; fi
    return 1
  fi
  # ни ss, ни netstat (минимальный образ) — пробуем соединиться средствами bash
  if (exec 3<>"/dev/tcp/127.0.0.1/${p}") 2>/dev/null; then return 0; fi
  return 1
}

# --port важнее .env: иначе docker слушает один порт, а проверка здоровья — другой
if [ -n "$PORT_ARG" ]; then set_env CRM_PORT "$PORT_ARG"; fi
PORT=$(grep -E '^CRM_PORT=' .env | cut -d= -f2- || true); PORT=${PORT:-8080}

# как повторить текущий запуск с другим портом (внутреннее имя режима — не флаг)
AGAIN=""
case "$MODE" in
  tls)   AGAIN="--tls ${DOMAIN}" ;;
  proxy) AGAIN="--proxy ${DOMAIN:-crm.example.ru}" ;;
esac

echo "Проверяю порты до запуска…"
if port_busy "$PORT"; then
  cat <<TXT

⚠️  Порт ${PORT} уже занят — CRM не сможет на нём работать.
    Посмотреть, кто занял:   ss -ltnp | grep ':${PORT}'
    Запустить CRM на другом порту, например:
        ./install.sh ${AGAIN:+${AGAIN} }--port 9090

TXT
  exit 1
fi
if [ "$MODE" = "tls" ]; then
  BUSY=""
  for p in 80 443; do if port_busy "$p"; then BUSY="${BUSY}${p} "; fi; done
  if [ -n "$BUSY" ]; then
    cat <<TXT

⚠️  Порты ${BUSY}уже заняты: на сервере уже работает веб-сервер (nginx, apache или Caddy).
    Режим --tls забирает 80 и 443 себе и сломал бы существующий сайт.

    Правильный вариант — чужой сайт не трогать, а CRM отдать существующему веб-серверу:
        ./install.sh --proxy ${DOMAIN:-crm.example.ru} --port ${PORT}

    CRM поднимется на 127.0.0.1:${PORT}, а в ваш nginx добавится один прокси-блок:
    готовый конфиг напечатается после установки (подробно — DEPLOY.md, раздел 5.1).

TXT
    exit 1
  fi
fi
if [ "$MODE" = "tls" ]; then
  echo "  порт ${PORT} свободен, порты 80 и 443 свободны"
else
  echo "  порт ${PORT} свободен"
fi

if [ "$MODE" = "tls" ]; then
  set_env CRM_DOMAIN "$DOMAIN"
  [ -n "$EMAIL" ] && set_env ACME_EMAIL "$EMAIL"
  # CRM доступна только через HTTPS-прокси, наружу порт 8080 не торчит
  set_env CRM_BIND "127.0.0.1"
  # прод: чистая база с правовой основой (каталог, шаблоны, правило)
  set_env SEED_MODE "base"
  echo "Режим: домен с HTTPS → https://${DOMAIN} (начальные данные — правовая основа, без демо)"
  echo "Проверьте, что DNS домена указывает на этот сервер, а порты 80 и 443 открыты."
  docker compose --profile tls up -d --build
  ADDRESS="https://${DOMAIN}"
elif [ "$MODE" = "proxy" ]; then
  # Сервер уже занят чужим сайтом: 80/443 принадлежат его веб-серверу, поэтому
  # CRM не торчит наружу вовсе — слушает только localhost, а прокси добавляется
  # в существующий nginx/apache. Данные боевые: демо на работающем сервере не нужно.
  if [ -n "$DOMAIN" ]; then set_env CRM_DOMAIN "$DOMAIN"; fi
  set_env CRM_BIND "127.0.0.1"
  set_env SEED_MODE "base"
  echo "Режим: рядом с существующим сайтом → CRM на 127.0.0.1:${PORT} (боевые данные, без демо)"
  docker compose up -d --build
  ADDRESS="http://127.0.0.1:${PORT}  (наружу — через ваш веб-сервер: https://${DOMAIN:-ваш-домен})"
else
  set_env CRM_BIND "0.0.0.0"
  # локально: сразу живые примеры, чтобы всё посмотреть и потрогать
  set_env SEED_MODE "demo"
  echo "Режим: локальный запуск / по IP без домена (с демонстрационными данными)"
  docker compose up -d --build
  IP=$(curl -s --max-time 4 ifconfig.me || hostname -I | awk '{print $1}')
  ADDRESS="http://localhost:${PORT}  (снаружи: http://${IP}:${PORT})"
fi

printf 'Ждём запуска CRM'
for i in $(seq 1 30); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    printf '\n✅ CRM отвечает: %s\n' "$(curl -s "http://127.0.0.1:${PORT}/api/health")"
    break
  fi
  printf '.'; sleep 2
  [ "$i" = 30 ] && printf '\n⚠️  CRM пока не отвечает — посмотрите логи: docker compose logs -f crm\n'
done

echo
echo "KarkasCRM запущена:  ${ADDRESS}"
echo "Проверка API:        curl http://127.0.0.1:${PORT}/api/health"
echo "Логи:                docker compose logs -f crm"
[ "$MODE" = "tls" ] && echo "HTTPS-прокси:        docker compose --profile tls logs -f caddy"

if [ "$MODE" = "proxy" ]; then
  D="${DOMAIN:-crm.example.ru}"
  echo
  echo "──────────────────────────────────────────────"
  echo " Осталось отдать CRM вашему веб-серверу. Существующий сайт при этом не трогается:"
  echo " добавляется отдельный server-блок для поддомена ${D}."
  echo "──────────────────────────────────────────────"
  if [ -f deploy/nginx.conf ]; then
    sed -e "s/crm\.example\.com/${D}/g" -e "s|127\.0\.0\.1:8080|127.0.0.1:${PORT}|g" deploy/nginx.conf
  fi
  cat <<TXT

Куда положить этот блок (Debian/Ubuntu):
  sudo nano /etc/nginx/sites-available/crm.conf     # вставьте блок выше
  sudo ln -s /etc/nginx/sites-available/crm.conf /etc/nginx/sites-enabled/
  sudo nginx -t && sudo systemctl reload nginx
  sudo certbot --nginx -d ${D}                       # сертификат: порт 80 уже открыт вашим nginx

На CentOS/RHEL/AlmaLinux тот же блок кладётся в /etc/nginx/conf.d/crm.conf.
Apache, ISPmanager или другой панельный сервер — DEPLOY.md, раздел 5.1.
Домен ${D} должен указывать на этот сервер: dig +short ${D}
TXT
fi

echo
echo "Дальше (всё из интерфейса, код менять не нужно):"
echo "  Настройки → Интеграции      — Wazzup (WhatsApp/Telegram/Instagram/Viber) и почта"
echo "  Настройки → Воронки и этапы  — свои воронки и этапы"
echo "  Настройки → Поля карточек    — свои поля контактов и сделок"
echo "  Настройки → Интеграции → Почта — SMTP и проверочное письмо"
echo "  Настройки → Данные           — план продаж, автораспределение лидов, резервные копии и логотип"
echo "Обновление: ./scripts/update.sh   ·   Проверки: ./run-tests.sh"
echo "Подробно: DEPLOY.md (разделы 4–6.1) и README.md"
docker compose ps
