FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 DATA_DIR=/data PUBLIC_DIR=/app/frontend/public
COPY backend ./backend
COPY frontend ./frontend
COPY logo.jpg VERSION package.json ./
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node","--experimental-sqlite","backend/src/server.js"]
