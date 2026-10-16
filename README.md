# KarkasCRM

**CRM уровня amoCRM за один `docker compose up`** — сделки и настраиваемые воронки, клиенты и компании, задачи, аналитика и **единый инбокс мессенджеров через Wazzup**: WhatsApp, Telegram, Instagram и Viber собираются в один чат клиента.

Написана без внешних зависимостей: Node.js 22 + SQLite + статический SPA. Ни одного npm-пакета в рантайме — контейнер собирается за секунды и не ломается от обновлений зависимостей.

---

## Быстрый старт

```bash
git clone <ваш-репозиторий> KarkasCRM && cd KarkasCRM
cp .env.example .env      # обязательно поменяйте JWT_SECRET и ADMIN_PASSWORD
docker compose up -d --build
```

Откройте `http://<IP-сервера>:8080` → вход `admin@example.com` / `admin12345` (из `.env`).

Скрипт-помощник: `./install.sh` — создаст `.env` и запустит всё одной командой.
Без Docker: `DATA_DIR=./data node --experimental-sqlite backend/src/server.js`.

---

## Что внутри

### Продажи
- **Сделки на канбане** с drag-and-drop между этапами, суммой, сроками и приоритетами
- **Настраиваемые воронки**: создавайте любые воронки и этапы (название, цвет, тип «обычный/успех/отказ») прямо в интерфейсе — Настройки → Воронки
- **Товары и прайс**: добавление позиций в сделку, сумма пересчитывается автоматически
- **Причины отказа**, дедлайны, ответственные, приоритеты

### Клиенты
- **Контакты** с тегами, источниками, поиском, карточкой клиента (сделки, заметки, задачи)
- **Компании** (включая ИНН, сайт)
- **Заметки** к контактам и сделкам, **лента активности** по каждому клиенту
- **Импорт/экспорт CSV** и полный **бэкап JSON** из интерфейса

### Задачи
- Типы (звонок, встреча, сообщение, письмо), сроки, приоритеты, результат
- Группировка: просроченные / активные / выполненные
- Создаются вручную, из карточки сделки/клиента или **автоматизациями**

### Единый инбокс (Wazzup)
- **Один чат на клиента**: сообщения из WhatsApp, Telegram, Instagram и Viber склеиваются по телефону или chatId
- Первое входящее **само создаёт контакт, чат и сделку** на первом этапе воронки
- Отправка ответов клиенту через ваш номер Wazzup прямо из CRM
- Статусы сообщений (`sent / delivered / read / error`), счётчики непрочитанного, реалтайм через SSE
- История сохраняется даже если провайдер отключён — «локальный режим»
- **Кнопка «🧪 Тестовое входящее»** — проверить всю логику без реального мессенджера

### Аналитика
- Конверсия в успех, средний чек, прогноз выручки по активным сделкам
- Выручка по этапам, источники лидов, причины отказов

### Команда и права
- Роли: **Администратор** (всё), **Менеджер** (работа с клиентами и сделками), **Наблюдатель** (только чтение)
- Смена пароля пользователем, управление командой в Настройках

### Автоматизации
- Триггеры: создана сделка, входящее сообщение, смена этапа
- Действия: создать задачу, перевести сделку на этап, добавить тег
- Готовые примеры уже включены после первого запуска

---

## Подключение Wazzup (5 шагов)

1. **В Wazzup**: личный кабинет → «Интеграция с CRM» → API → **Подключить** → скопируйте API-ключ. (Каналы WhatsApp/Telegram/Instagram/Viber добавляются там же в разделе «Каналы».)
2. **В CRM**: Настройки → **Интеграции и каналы** → вставьте API-ключ → «Сохранить ключ».
3. Нажмите **«🔍 Проверить и синхронизировать каналы»** — CRM обратится к Wazzup, покажет ваши каналы и сохранит их. При необходимости выберите «Канал по умолчанию».
4. Нажмите **«Отправить адрес вебхука в Wazzup автоматически»** (или укажите вручную в кабинете Wazzup URL вида `https://ваш-домен/webhooks/wazzup`).
5. Пишите клиенту с телефона или из мессенджера — сообщение появится в разделе **Чаты Wazzup**; ответы из CRM уходят клиенту через ваш номер.

> Для вебхуков нужен публичный HTTPS-адрес: см. раздел «Домен и HTTPS» в [DEPLOY.md](DEPLOY.md). Поддерживаются и старый (`messages[]`), и новый (`event: message.add`) формат вебхуков Wazzup.

### Другие каналы
- **Прямой WhatsApp Cloud API (Meta)** — если Wazzup не нужен: Настройки → Интеграции → укажите Phone Number ID, токен и Verify Token, а в Meta укажите `https://ваш-домен/webhooks/whatsapp`. Переключатель провайдера там же.
- **Свой Telegram-бот**: вебхук на `https://ваш-домен/webhooks/telegram`.
- **Сайт, Авито, любая форма**: `POST https://ваш-домен/webhooks/generic` с JSON `{ "channel": "site", "phone": "+7…", "name": "Имя", "body": "Текст" }` — сообщение попадёт в тот же инбокс и создаст сделку.
- **Проверить без мессенджера**: кнопка «🧪 Тестовое входящее» в чате или `POST /api/inbox/simulate`.

---

## Развёртывание

Подробная инструкция — **[DEPLOY.md](DEPLOY.md)**: публичный IP, HTTPS (Caddy/nginx + Let's Encrypt), обновление, бэкапы, диагностика.

Коротко:

```bash
cp .env.example .env && nano .env      # JWT_SECRET, ADMIN_PASSWORD, WHATSAPP_*/WAZZUP_* по желанию
docker compose up -d --build           # → http://IP:8080
```

## Настройки (.env)

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `PORT` | порт приложения | `8080` |
| `JWT_SECRET` | подпись токенов входа — **смените!** | dev-значение |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | первый администратор | `admin@example.com` / `admin12345` |
| `CRM_PORT` | внешний порт compose | `8080` |
| `DATA_DIR` | каталог базы SQLite (volume) | `/data` в Docker |
| `WAZZUP_API_KEY` | ключ Wazzup (можно задать в UI) | — |
| `WAZZUP_VERIFY` / `WAZZUP_WEBHOOK_SECRET` | секрет вебхука | — |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN` | прямой WhatsApp Cloud API | — |
| `TELEGRAM_BOT_TOKEN` | свой Telegram-бот | — |

Всё, что можно настроить в интерфейсе, хранится в базе (таблица настроек) и **не требует перезапуска**.

---

## API и вебхуки

Все действия CRM доступны по REST с токеном `Authorization: Bearer <JWT>` (`POST /api/auth/login`):

```
GET/POST/PATCH/DELETE  /api/contacts  /api/companies  /api/deals  /api/tasks
                       /api/products  /api/templates  /api/automations  /api/notes
GET  /api/dashboard    GET /api/analytics    GET /api/search?q=
GET/POST /api/pipelines  PUT/DELETE /api/pipelines/:id      # воронки и этапы
GET/POST /api/conversations/:id/messages                    # единый инбокс
GET/PUT  /api/settings  GET/POST /api/channels  /api/users
POST /api/integrations/wazzup/test|sync|webhook             # Wazzup
GET  /api/export/contacts|deals  POST /api/import/contacts  GET /api/backup
POST /webhooks/wazzup  /webhooks/whatsapp  /webhooks/telegram  /webhooks/generic
GET  /api/events                                            # SSE-реалтайм
```

## Тесты

```bash
node --experimental-sqlite --test tests/*.test.js
```

Проверяются: авторизация и роли, склейка чатов Wazzup/WhatsApp/Telegram в один диалог, идемпотентность вебхуков, автосоздание сделки, товары и пересчёт суммы, настройка воронки, автоматизации, а также **сквозная отправка сообщения в API Wazzup** (на локальной заглушке — сверяется точный формат запроса).

---

## Как это устроено

```
backend/src/server.js     весь сервер: схема БД, REST, вебхуки, Wazzup/Meta, SSE (zero-deps)
frontend/public/          SPA: index.html, style.css, app.js (без сборки)
tests/api.test.js         интеграционные тесты на node:test
deploy/                   конфиги Caddy и nginx для HTTPS
Dockerfile, docker-compose.yml, install.sh, .env.example, DEPLOY.md
```

Один контейнер, один файл базы (`/data/crm.db`, SQLite WAL) — бэкап сводится к копированию файла, обновление к `git pull && docker compose up -d --build`.

Каталог `packages/` — исторический монорепозиторий Twenty CRM, из которого вырос этот репозиторий. В сборке KarkasCRM он не участвует (исключён через `.dockerignore`) и оставлен без изменений.
