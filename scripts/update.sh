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

echo "Забираем изменения из git"
git pull --ff-only

echo "Пересобираем и перезапускаем"
# Профиль tls поднимает собственный Caddy на 80 и 443. Включать его можно, только
# если установка действительно была со своим HTTPS: ориентироваться на CRM_DOMAIN
# нельзя. Его задаёт и режим --proxy, где 80/443 принадлежат чужому веб-серверу,
# и свой Caddy отобрал бы порты у работающего сайта.
TLS=$(grep -E '^CRM_TLS=' .env 2>/dev/null | cut -d= -f2- || true)
PROFILE=""
if [ "$TLS" = 1 ]; then
  PROFILE="--profile tls"
  echo "  режим: домен и HTTPS (профиль tls)"
elif [ -z "$TLS" ]; then
  # Отметки режима нет — установка сделана до её появления. Профиль включаем
  # только если контейнер HTTPS-прокси существует: значит, он здесь и работал.
  if [ -n "$(docker ps -a --filter name=karkascrm-caddy --format '{{.Names}}' 2>/dev/null || true)" ]; then
    PROFILE="--profile tls"
    echo "  режим: домен и HTTPS (определён по контейнеру karkascrm-caddy)"
  else
    echo "  режим: без собственного HTTPS-прокси"
    echo "  Отметки режима (CRM_TLS) в .env нет, контейнера karkascrm-caddy тоже —"
    echo "  профиль tls не включается: если 80/443 заняты другим сайтом, свой Caddy"
    echo "  отобрал бы у него порты. Нужен свой HTTPS — ./install.sh --tls ваш-домен.ru"
  fi
else
  echo "  режим: локально, по IP или рядом с чужим веб-сервером"
fi
# PROFILE намеренно без кавычек: пустая строка должна исчезнуть, а не стать аргументом
docker compose ${PROFILE} up -d --build

PORT=$(grep -E '^CRM_PORT=' .env 2>/dev/null | cut -d= -f2- || true); PORT=${PORT:-8080}
sleep 2
if curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  echo "Обновление завершено: $(curl -s "http://127.0.0.1:${PORT}/api/health")"
else
  echo "CRM пока не отвечает — смотрите логи: docker compose logs -f crm"
fi
docker compose ps
