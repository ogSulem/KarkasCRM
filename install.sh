#!/usr/bin/env bash
# KarkasCRM — установка в одну команду: ./install.sh
set -euo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null || { echo "Docker не установлен. Установите: curl -fsSL https://get.docker.com | sh"; exit 1; }

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
  echo " Отредактируйте .env при необходимости и запустите ./install.sh снова,"
  echo " либо продолжите — CRM запустится сейчас с этими данными."
  echo "──────────────────────────────────────────────"
fi

docker compose up -d --build

IP=$(curl -s --max-time 4 ifconfig.me || hostname -I | awk '{print $1}')
PORT=$(grep -E '^CRM_PORT=' .env | cut -d= -f2- || true); PORT=${PORT:-8080}
echo
echo "KarkasCRM запущена:  http://${IP}:${PORT}"
echo "Проверка API:        curl http://127.0.0.1:${PORT}/api/health"
echo "Логи:                docker compose logs -f crm"
echo "Дальше: Настройки → Интеграции → подключите Wazzup (см. DEPLOY.md, раздел 5)."
docker compose ps
