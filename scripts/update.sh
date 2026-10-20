#!/usr/bin/env bash
# КаркасCRM — обновление системы из репозитория.
#   ./scripts/update.sh
# Данные не трогаются: база живёт в томе karkascrm_data, при старте схема обновляется сама
# (перед обновлением схемы CRM складывает копию pre-upgrade-… в /data/backups).
set -euo pipefail
cd "$(dirname "$0")/.."

command -v docker >/dev/null || { echo "Docker не установлен"; exit 1; }
if [ ! -d .git ]; then
  echo "Это копия без git-истории (например, скачанный архив). Обновление:"
  echo "  1) скачайте новую версию и распакуйте поверх;"
  echo "  2) docker compose up -d --build"
  echo "Данные в томе karkascrm_data при этом не затрагиваются."
  exit 1
fi

echo "▶ Забираем изменения из git"
git pull --ff-only

echo "▶ Пересобираем и перезапускаем"
if [ -f .env ] && grep -qE '^CRM_DOMAIN=.+' .env; then
  echo "  режим: домен и HTTPS (профиль tls)"
  docker compose --profile tls up -d --build
else
  echo "  режим: локально / по IP"
  docker compose up -d --build
fi

PORT=$(grep -E '^CRM_PORT=' .env 2>/dev/null | cut -d= -f2- || true); PORT=${PORT:-8080}
sleep 2
if curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  echo "✅ Обновление завершено: $(curl -s "http://127.0.0.1:${PORT}/api/health")"
else
  echo "⚠️  CRM пока не отвечает — смотрите логи: docker compose logs -f crm"
fi
docker compose ps
