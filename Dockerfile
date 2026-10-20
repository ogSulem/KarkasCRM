# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# KarkasCRM — один контейнер: статика + API + SQLite (node:sqlite).
# Нужен только Node.js 22.5+; внешних npm-зависимостей нет — сборка не требует
# сети и не может «сломаться из-за пакета».
#
# Базовый образ: node:22-alpine — LTS-ветка с патчами безопасности.
# Тег вынесен в ARG: для полностью воспроизводимой сборки зафиксируйте точную
# версию или digest, не меняя Dockerfile:
#   docker compose build --build-arg NODE_IMAGE=node:22.22.3-alpine
# ─────────────────────────────────────────────────────────────────────────────
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE}

WORKDIR /app

# Пути заданы явно: приложение не зависит от текущего каталога запуска.
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    PUBLIC_DIR=/app/frontend/public

# Код приложения. Логотип из комплекта (logo.jpg) копируется в /app и отдаётся
# как /logo.png; свой логотип пользователь загружает в том /data/logo и он
# перекрывает стандартный. При обновлении образа файл logo.jpg берётся из
# репозитория — то есть меняется вместе с кодом, и отдельно обновлять его не нужно.
COPY backend ./backend
COPY frontend ./frontend
# В образ нужны только скрипты сопровождения, которые запускаются внутри контейнера
# (выгрузка резервных копий в S3); pack/update остаются на хосте.
COPY scripts/s3-sign.mjs scripts/upload-backup.mjs ./scripts/
COPY logo.jpg VERSION package.json ./

# tzdata — чтобы TZ=Europe/Moscow реально работал: в alpine по умолчанию нет базы
# часовых поясов, и даты задач, имена резервных копий и отчёты уезжали бы в UTC.
# Каталог данных принадлежит непривилегированному пользователю (uid 1000).
# В docker-compose он подключён томом karkascrm_data и переживает пересборку.
RUN apk add --no-cache tzdata \
 && mkdir -p /data && chown -R node:node /data /app

USER node
EXPOSE 8080

# Проверка живости: Docker сам перезапустит контейнер (restart: unless-stopped),
# если приложение перестало отвечать. Публичный /api/health не требует входа.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

CMD ["node", "--experimental-sqlite", "backend/src/server.js"]
