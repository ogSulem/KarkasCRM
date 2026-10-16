#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { cp .env.example .env; echo "Создан .env — отредактируйте JWT_SECRET и ADMIN_PASSWORD, затем запустите снова."; exit 1; }
docker compose up -d --build
echo "KarkasCRM: http://$(curl -s ifconfig.me 2>/dev/null || echo ВАШ_IP):8080"
docker compose ps
