#!/usr/bin/env bash
# KarkasCRM без Docker — запуск на своём компьютере за пару секунд.
# Нужен только Node.js 22.5+ (https://nodejs.org). База — файл ./data/crm.db.
#
#   ./run-local.sh            запустить на http://localhost:8080
#   PORT=3000 ./run-local.sh  на другом порту
#   ADMIN_PASSWORD=свой-пароль ./run-local.sh  задать пароль администратора при первом запуске
set -euo pipefail
cd "$(dirname "$0")"

command -v node >/dev/null || { echo "Node.js не найден. Поставьте Node 22.5+ с https://nodejs.org"; exit 1; }

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
NODE_MINOR=$(node -p "process.versions.node.split('.')[1]")
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 5 ]; }; then
  echo "Нужен Node.js 22.5 или новее (сейчас $(node -v)). Обновите Node и повторите."; exit 1
fi

export DATA_DIR="${DATA_DIR:-$PWD/data}"
export PORT="${PORT:-8080}"
export HOST="${HOST:-127.0.0.1}"
# локальный запуск — сразу с демонстрационными данными (SEED_MODE=demo/base/off)
export SEED_MODE="${SEED_MODE:-demo}"
mkdir -p "$DATA_DIR"

if [ ! -f .env ]; then
  echo "Совет: cp .env.example .env — там секреты, пароль администратора, ключи каналов связи и почты."
  echo "Без файла настроек система запустится с демонстрационными данными: admin@example.com / admin12345 (смените пароль после входа)."
fi

# Читаем .env построчно: значения с пробелами и решёткой не ломают запуск,
# как это бывает при обычном `source` файла окружения.
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    case "$line" in *=*) ;; *) continue ;; esac
    key=${line%%=*}; val=${line#*=}
    case "$val" in
      \"*\") val=${val#\"}; val=${val%\"} ;;
      \'*\') val=${val#\'}; val=${val%\'} ;;
    esac
    case "$key" in [!A-Za-z_]*|*[!A-Za-z0-9_]*) continue ;; esac
    export "$key=$val"
  done < .env
fi
export DATA_DIR PORT HOST

echo "KarkasCRM → http://localhost:${PORT}   (база: ${DATA_DIR}/crm.db, Ctrl+C — остановить)"
exec node --experimental-sqlite backend/src/server.js
