# Развёртывание KarkasCRM на сервере с публичным IP

Ниже — полный путь от чистого сервера до рабочей CRM с HTTPS и Wazzup. Занимает 5–10 минут.

---

## 1. Что нужно

- Сервер (VPS) с публичным IP, Ubuntu/Debian, 1 ГБ RAM и 5 ГБ диска хватит с запасом
- Установленные Docker и Docker Compose:

```bash
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version
```

- Для HTTPS — домен, A-запись которого указывает на IP сервера (нужен только для вебхуков мессенджеров)

Откройте порт в фаерволе (если используется):

```bash
sudo ufw allow 8080/tcp        # прямой доступ к CRM
sudo ufw allow 80,443/tcp      # если будете ставить HTTPS
```

## 2. Установка

```bash
git clone <ваш-репозиторий> KarkasCRM
cd KarkasCRM
cp .env.example .env
nano .env                      # ОБЯЗАТЕЛЬНО: JWT_SECRET и ADMIN_PASSWORD
./install.sh                   # или: docker compose up -d --build
```

Проверка:

```bash
curl http://127.0.0.1:8080/api/health      # {"ok":true,"service":"KarkasCRM",...}
docker compose ps
docker compose logs -f crm
```

Откройте `http://<IP-сервера>:8080` и войдите под `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

### Сгенерировать надёжные секреты

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)"; echo "ADMIN_PASSWORD=$(openssl rand -base64 12)"
```

Вставьте значения в `.env`. После смены `ADMIN_PASSWORD` у уже созданной базы пароль не изменится (пользователь создаётся один раз при первом запуске) — смените его в CRM: Настройки → Профиль, или создайте нового пользователя в Настройки → Команда.

## 3. Домен и HTTPS (рекомендуется)

HTTPS обязателен для вебхуков WhatsApp/Wazzup и полезен для безопасности.

### Вариант A — Caddy (авто-сертификаты, проще всего)

```bash
sudo apt install -y caddy
sudo sed -i "s/crm.example.com/ваш-домен.ru/" deploy/Caddyfile
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

Caddy сам получит сертификат Let's Encrypt. Останется закрыть прямой порт: в `docker-compose.yml` замените

```yaml
ports:
  - "127.0.0.1:8080:8080"      # доступ только с самого сервера, наружу — через Caddy
```

и выполните `docker compose up -d`.

### Вариант B — nginx + certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo sed -i "s/crm.example.com/ваш-домен.ru/" deploy/nginx.conf
sudo cp deploy/nginx.conf /etc/nginx/sites-available/karkascrm
sudo ln -s /etc/nginx/sites-available/karkascrm /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d ваш-домен.ru --redirect
```

В конфиге уже заданы заголовки и `proxy_buffering off` — это важно, чтобы реалтайм чатов (SSE) работал без задержек.

## 4. Настройка после установки (всё из интерфейса)

1. **Настройки → Данные и компания**: название вашей компании, валюта, автосоздание сделки при первом обращении.
2. **Настройки → Воронки и этапы**: при необходимости переименуйте этапы, поменяйте цвета, добавьте вторую воронку (например, «Сервис и монтаж»).
3. **Настройки → Wazzup**: вставьте API-ключ из личного кабинета Wazzup, синхронизируйте каналы, отправьте адрес вебхука. Подробно — в [README.md](README.md#подключение-wazzup-5-шагов).
4. **Настройки → Автоматизации**: готовые правила уже есть, добавьте свои (например, «Смена этапа → задача»).
5. **Настройки → Шаблоны**: заготовки сообщений с переменной `{name}` — доступны в чате из выпадающего списка.
6. **Настройки → Команда**: создайте менеджеров (роль «Менеджер») и наблюдателей (только чтение).
7. **Настройки → Профиль**: смените пароль администратора.

## 5. Wazzup: чек-лист

| Шаг | Где | Что сделать |
|---|---|---|
| 1 | Wazzup → Каналы | Подключить WhatsApp/Telegram/Instagram/Viber |
| 2 | Wazzup → Интеграция с CRM → API | «Подключить» и скопировать API-ключ |
| 3 | CRM → Настройки → Интеграции | Вставить ключ, «Сохранить ключ» |
| 4 | CRM → та же вкладка | «🔍 Проверить и синхронизировать каналы» |
| 5 | CRM → та же вкладка | «Отправить адрес вебхука в Wazzup автоматически» |
| 6 | Проверка | Написать в WhatsApp на подключённый номер → сообщение появится в «Чаты Wazzup» |

Если автоматическая регистрация вебхука не прошла (неверный ключ или нет HTTPS) — укажите адрес вручную в кабинете Wazzup: `https://ваш-домен/webhooks/wazzup`. Если задан «секрет вебхука», добавьте его к адресу: `.../webhooks/wazzup?secret=ВАШ_СЕКРЕТ`.

## 6. Обновление, бэкап, восстановление

```bash
# обновление
git pull && docker compose up -d --build

# бэкап базы (рекомендуется в cron)
docker run --rm -v karkascrm_data:/d -v $PWD:/b alpine \
  sh -c "cp /d/crm.db /b/crm-$(date +%F).db"
# плюс удобный JSON-бэкап из CRM: Настройки → Данные → «Полный бэкап (JSON)»

# восстановление
docker compose down
docker run --rm -v karkascrm_data:/d -v $PWD:/b alpine \
  sh -c "cp /b/crm-2026-01-31.db /d/crm.db"
docker compose up -d
```

Пример cron (бэкап каждую ночь в 3:30):

```cron
30 3 * * * cd /opt/KarkasCRM && docker run --rm -v karkascrm_data:/d -v /opt/backups:/b alpine cp /d/crm.db /b/crm-$(date +\%F).db
```

## 7. Диагностика

| Симптом | Причина и решение |
|---|---|
| Чат в CRM, сообщения не уходят | Не задан API-ключ Wazzup или не выбран канал: Настройки → Интеграции. В ответе API будет `"mode":"error: …"` |
| Входящие не приходят | Вебхук недоступен: проверьте `curl -I https://ваш-домен/webhooks/wazzup`, HTTPS-сертификат и правильный адрес в кабинете Wazzup |
| «Неверный e-mail или пароль» | Логин берётся из `.env` при первом запуске; если база уже создана, используйте сохранённый пароль или создайте пользователя в БД |
| Реалтайм не обновляется | Прокси буферизует SSE: в nginx должно быть `proxy_buffering off;` (есть в `deploy/nginx.conf`) |
| Порт занят | Измените `CRM_PORT` в `.env` |
| Нужно понять, что происходит | `docker compose logs -f crm` |

## 8. Безопасность: обязательный минимум

- `JWT_SECRET` — длинная случайная строка (32+ символа), не значение по умолчанию
- Сменить пароль администратора после первого входа
- HTTPS (Caddy/nginx) и порт 8080, доступный только с localhost (см. раздел 3)
- Роли: менеджерам — «Менеджер», наблюдателям — «Наблюдатель» (только чтение)
- Регулярные бэкапы базы (раздел 6)

## 9. Запуск без Docker (если нужно)

```bash
node --version          # нужен >= 22.5
DATA_DIR=./data PORT=8080 JWT_SECRET=... node --experimental-sqlite backend/src/server.js
```

Полезно для локальной разработки и тестов: `node --experimental-sqlite --test tests/*.test.js`.
