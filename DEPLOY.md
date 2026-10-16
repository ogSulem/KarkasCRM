# KarkasCRM — развёртывание за 3 минуты

Современная CRM в духе amoCRM: дашборд, канбан-воронка сделок, контакты, задачи и **единый инбокс**: WhatsApp + Telegram + сайт объединяются в один чат клиента (склейка по номеру телефона), первое обращение само создаёт контакт и сделку.

## Быстрый старт (Docker, публичный IP)

```bash
git clone <ваш-репозиторий> KarkasCRM && cd KarkasCRM
cp .env.example .env
nano .env            # ОБЯЗАТЕЛЬНО: JWT_SECRET и ADMIN_PASSWORD
docker compose up -d --build
```

Открыть: `http://<публичный-IP>:8080` — логин из `.env` (по умолчанию `admin@example.com / admin12345`).
Проверка: `curl http://127.0.0.1:8080/api/health` → `{"ok":true,...}`

Без Docker (Node ≥ 22.5): `DATA_DIR=./data node --experimental-sqlite backend/src/server.js`

## Домен + HTTPS (рекомендуется для вебхуков Meta)

Caddy (авто-HTTPS): см. `deploy/Caddyfile` → `caddy run --config deploy/Caddyfile`.
Или nginx: `deploy/nginx.conf` + `certbot --nginx -d crm.example.com`.
Затем в `.env`/UI укажите публичный URL — вебхуки должны быть доступны по HTTPS.

## WhatsApp (официальный WhatsApp Cloud API, Meta)

1. [developers.facebook.com](https://developers.facebook.com) → приложение → WhatsApp → API Setup: скопируйте **Phone Number ID** и **Permanent Access Token**.
2. В CRM: **Интеграции** → вставьте токен и Phone ID → Сохранить (или задайте `WHATSAPP_*` в `.env`).
3. Там же в Meta: Webhooks → Callback URL: `https://ВАШ-ДОМЕН/webhooks/whatsapp`, Verify token — из поля в CRM (`karkas-verify` по умолчанию), подписка **messages**.
4. Готово: входящие создают контакт+сделку+чат, ответы из CRM уходят клиенту в WhatsApp. Повторные вебхуки дедуплицируются по ID сообщения.

Telegram: направьте `setWebhook` бота на `https://ВАШ-ДОМЕН/webhooks/telegram` — сообщения попадут в тот же инбокс.
Прочие каналы (сайт/Avito и т.п.): `POST /webhooks/generic` с JSON `{channel, phone, name, body}`.

## Данные, бэкап, обновление

- Вся БД — один файл в Docker-томе `karkascrm_data` (`/data/crm.db`, SQLite WAL).
- Бэкап: `docker run --rm -v karkascrm_data:/d -v $PWD:/b alpine cp /d/crm.db /b/backup.db`
- Обновление: `git pull && docker compose up -d --build`
- Логи: `docker compose logs -f crm`

## Безопасность перед продакшеном

Сменить `JWT_SECRET` и `ADMIN_PASSWORD`, поставить HTTPS, закрыть порт 8080 наружу при работе за reverse-proxy (в compose оставить `127.0.0.1:8080:8080`).

## Архитектура

Один контейнер, ноль внешних npm-зависимостей: Node 22 (`http`, `node:sqlite`, `crypto`) + статический SPA-фронтенд. Реалтайм — SSE. Тесты: `node --experimental-sqlite --test tests/*.test.js`.
Исторический монорепозиторий Twenty в `packages/` сохранён как есть и в сборке KarkasCRM не участвует (исключён через `.dockerignore`).
