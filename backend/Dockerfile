# Основной способ запуска — корневой Dockerfile + docker-compose.yml.
# Этот файл оставлен для совместимости структуры монорепозитория.
FROM node:22-alpine
WORKDIR /app
COPY . ./backend
COPY ../frontend ./frontend
ENV PORT=8080 HOST=0.0.0.0 DATA_DIR=/data PUBLIC_DIR=/app/frontend/public
EXPOSE 8080
CMD ["node","--experimental-sqlite","backend/src/server.js"]
