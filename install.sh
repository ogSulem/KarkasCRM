#!/usr/bin/env bash
# KarkasCRM — установка в одну команду.
#
#   ./install.sh                       локально или на сервере без домена → http://localhost:8080 (или http://IP:8080)
#   ./install.sh --tls crm.домен.ru    сервер с доменом → HTTPS на 80/443 через Caddy (профиль tls)
#   ./install.sh --tls crm.домен.ru me@mail.ru
#
# Всё остальное настраивается позже прямо в интерфейсе CRM — код править не нужно.
set -euo pipefail
cd "$(dirname "$0")"

MODE="local"; DOMAIN=""; EMAIL=""

usage() {
  cat << 'TXT'
Использование:
  ./install.sh                                  запуск на локалке/по IP (http://localhost:8080)
  ./install.sh --tls crm.example.ru [email]     запуск на домене с HTTPS (Caddy + Let's Encrypt)

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

# ── .env: создаём из шаблона и заполняем секреты/режим ──────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  if command -v openssl >/dev/null; then
    SECRET=$(openssl rand -hex 32); PASS=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-14)
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$SECRET|" .env
    sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$PASS|" .env
  else
    PASS="admin12345 (смените в .env!)"
  fi
  echo "──────────────────────────────────────────────"
  echo " Создан .env с автоматическими секретами."
  echo " Пароль администратора: $(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"
  echo " Логин:                 $(grep '^ADMIN_EMAIL=' .env | cut -d= -f2-)"
  echo "──────────────────────────────────────────────"
fi

set_env() { # set_env KEY VALUE — заменяет строку в .env или добавляет её
  local key="$1" value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

if [ "$MODE" = "tls" ]; then
  set_env CRM_DOMAIN "$DOMAIN"
  [ -n "$EMAIL" ] && set_env ACME_EMAIL "$EMAIL"
  # CRM доступна только через HTTPS-прокси, наружу порт 8080 не торчит
  set_env CRM_BIND "127.0.0.1"
  echo "Режим: домен с HTTPS → https://${DOMAIN}"
  echo "Проверьте, что DNS домена указывает на этот сервер, а порты 80 и 443 открыты."
  docker compose --profile tls up -d --build
  ADDRESS="https://${DOMAIN}"
else
  set_env CRM_BIND "0.0.0.0"
  echo "Режим: локальный запуск / по IP без домена"
  docker compose up -d --build
  IP=$(curl -s --max-time 4 ifconfig.me || hostname -I | awk '{print $1}')
  PORT=$(grep -E '^CRM_PORT=' .env | cut -d= -f2- || true); PORT=${PORT:-8080}
  ADDRESS="http://localhost:${PORT}  (снаружи: http://${IP}:${PORT})"
fi

PORT=$(grep -E '^CRM_PORT=' .env | cut -d= -f2- || true); PORT=${PORT:-8080}
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
echo "Проверка API:        curl http://127.0.0.1:$(grep -E '^CRM_PORT=' .env | cut -d= -f2- || echo 8080)/api/health"
echo "Логи:                docker compose logs -f crm"
[ "$MODE" = "tls" ] && echo "HTTPS-прокси:        docker compose --profile tls logs -f caddy"
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
