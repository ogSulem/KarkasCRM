#!/usr/bin/env bash
# Сборка дистрибутива КаркасCRM: один самодостаточный ZIP для переноса на сервер.
# Внутри — код приложения, docker-compose, Caddy, скрипты установки; данные и .env не включаются.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

OUT_DIR="$DIR/downloads"
ZIP_FILE="$OUT_DIR/KarkasCRM.zip"
mkdir -p "$OUT_DIR"
rm -f "$ZIP_FILE"

zip -r "$ZIP_FILE" . \
  -x "*.git/*" \
  -x "*/node_modules/*" \
  -x "data/*" \
  -x "downloads/*" \
  -x "frontend/public/downloads/*" \
  -x "*.DS_Store" \
  -x "*.log" \
  -x "*.db" \
  -x "*.db-wal" \
  -x "*.db-shm" \
  -x ".env" \
  -q

SHA=$(sha256sum "$ZIP_FILE" | cut -d' ' -f1)
SIZE=$(du -h "$ZIP_FILE" | cut -f1)

echo "Дистрибутив собран: $ZIP_FILE"
echo "Размер: $SIZE"
echo "SHA256: $SHA"
