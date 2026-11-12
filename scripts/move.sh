#!/usr/bin/env bash
# Перенос КаркасCRM на другой сервер: всё состояние в одном архиве.
#
#   ./scripts/move.sh pack                 собрать архив на старом сервере
#   ./scripts/move.sh restore АРХИВ        развернуть его на новом сервере
#   ./scripts/move.sh restore АРХИВ --yes  без вопроса о замене данных
#
# В архив попадают том с данными (база, настройки, вложения чатов, резервные
# копии), файл .env с доменом и секретами и сведения о версии для сверки.
# Код приложения не копируется: на новом сервере его ставит install.sh или
# распаковка KarkasCRM.zip. Порядок действий описан в DEPLOY.md, раздел 12.
set -euo pipefail
cd "$(dirname "$0")/.."

VOLUME="${KARKAS_VOLUME:-karkascrm_data}"
HELPER="${KARKAS_HELPER_IMAGE:-alpine:3.21}"
# в образе каталог /data принадлежит непривилегированному пользователю node
DATA_UID="${KARKAS_DATA_UID:-1000}"

die() { printf '  %s\n' "$*" >&2; exit 1; }

# временный каталог живёт в переменной скрипта: ловушка EXIT выполняется уже вне
# функции, где локальная переменная не видна, и с set -u дала бы ошибку на выходе
CLEAN_DIR=""
cleanup() { if [ -n "$CLEAN_DIR" ]; then rm -rf -- "$CLEAN_DIR"; fi; }
trap cleanup EXIT

compose() { docker compose "$@"; }

need_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker не найден. Установите его (https://docs.docker.com/engine/install/) или перенесите данные вручную: DEPLOY.md, раздел 12."
  docker compose version >/dev/null 2>&1 || die "Нет docker compose. Обновите Docker: команда должна отвечать на «docker compose version»."
}

# работает ли контейнер CRM: снимать копию нужно с остановленного, иначе в архив
# попадёт база с недописанным журналом WAL
crm_running() {
  local id
  id=$(compose ps -q crm 2>/dev/null || true)
  [ -n "$id" ] || return 1
  [ "$(docker inspect -f '{{.State.Running}}' "$id" 2>/dev/null || echo false)" = true ]
}

# тот же выбор профиля, что в update.sh: свой Caddy поднимаем только там, где
# установка действительно была со своим HTTPS, иначе он отберёт 80 и 443 у чужого сайта
tls_profile() {
  local tls
  tls=$(grep -E '^CRM_TLS=' .env 2>/dev/null | cut -d= -f2- || true)
  if [ "$tls" = 1 ]; then printf -- '--profile tls'; return; fi
  if [ -z "$tls" ] && [ -n "$(docker ps -a --filter name=karkascrm-caddy --format '{{.Names}}' 2>/dev/null || true)" ]; then
    printf -- '--profile tls'; return
  fi
  printf ''
}

port_from_env() {
  local p
  p=$(grep -E '^CRM_PORT=' .env 2>/dev/null | cut -d= -f2- || true)
  printf '%s' "${p:-8080}"
}

wait_health() {
  local port="$1" i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 3
    if curl -fsS --max-time 5 "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
      curl -s --max-time 5 "http://127.0.0.1:${port}/api/health" || true
      return 0
    fi
  done
  return 1
}

cmd_pack() {
  need_docker
  [ -f docker-compose.yml ] || die "Рядом нет docker-compose.yml: запускайте скрипт из каталога, где установлена CRM."
  docker volume inspect "$VOLUME" >/dev/null 2>&1 || die "Том $VOLUME не найден. Если установка сделана в другом каталоге или без Docker, см. DEPLOY.md, раздел 12."

  local tmp stamp out restart=0
  # рабочий каталог держим рядом с архивом, на том же диске: /tmp на VPS бывает
  # маленьким tmpfs, а том с базой и вложениями — на гигабайты. TMPDIR переопределяет.
  tmp=$(mktemp -d "${TMPDIR:-$PWD}/.karkas-move.XXXXXX")
  CLEAN_DIR="$tmp"

  if crm_running; then
    restart=1
    echo "Останавливаю CRM: копия должна быть согласованной (журнал WAL дописывается на диск)"
    compose stop crm >/dev/null
  fi

  echo "Снимаю копию тома $VOLUME"
  docker run --rm --user 0:0 -v "$VOLUME:/data:ro" -v "$tmp:/out" "$HELPER" \
    sh -c 'tar czf /out/data.tar.gz -C /data . && chmod 644 /out/data.tar.gz'
  [ -s "$tmp/data.tar.gz" ] || die "Копия тома получилась пустой: переносить нечего."

  if [ -f .env ]; then
    cp .env "$tmp/env"
    chmod 600 "$tmp/env"
  else
    echo "  Файла .env нет: в архив попадут только данные. Секреты и домен на новом сервере придётся задать заново."
  fi

  stamp=$(date +%Y-%m-%d-%H%M%S)
  out="karkascrm-move-${stamp}.tar.gz"
  {
    echo "version=$(cat VERSION 2>/dev/null || echo unknown)"
    echo "packed_at=$(date -u +%FT%TZ)"
    echo "source_host=$(hostname 2>/dev/null || echo unknown)"
    echo "volume=$VOLUME"
    echo "data_sha256=$(sha256sum "$tmp/data.tar.gz" | cut -d' ' -f1)"
    echo "crm_domain=$(grep -E '^CRM_DOMAIN=' .env 2>/dev/null | cut -d= -f2- || true)"
    echo "data_bytes=$(wc -c < "$tmp/data.tar.gz" | tr -d ' ')"
  } > "$tmp/move-info.txt"

  rm -f "$out"
  # env добавляется в архив только если он есть: пустым аргументом tar подавится
  tar czf "$out" -C "$tmp" data.tar.gz move-info.txt $( [ -f "$tmp/env" ] && printf env || true )
  chmod 600 "$out"
  tar tzf "$out" >/dev/null || die "Архив не читается после сборки."

  if [ "$restart" = 1 ]; then
    echo "Возвращаю CRM в работу"
    compose start crm >/dev/null
    wait_health "$(port_from_env)" >/dev/null 2>&1 || echo "  CRM поднимается дольше обычного: docker compose logs -f crm"
  fi

  echo
  echo "Готово: $out ($(du -h "$out" | cut -f1))"
  echo "Контрольная сумма: $(sha256sum "$out" | cut -d' ' -f1)"
  echo
  echo "Дальше на новом сервере:"
  echo "  1) передайте архив: scp $out root@НОВЫЙ_IP:/opt/"
  echo "     большой архив надёжнее отправлять через rsync -P — он дозаливает при обрыве;"
  echo "     после передачи сверьте сумму: sha256sum на обоих серверах должны совпасть"
  echo "  2) поставьте код: git clone https://github.com/ogSulem/KarkasCRM /opt/KarkasCRM"
  echo "     (или распакуйте KarkasCRM.zip); install.sh для переноса не нужен —"
  echo "     restore сам создаст том, поставит .env из архива и поднимет CRM"
  echo "  3) cd /opt/KarkasCRM && ./scripts/move.sh restore /opt/$out"
  echo "  4) переключите DNS на новый сервер и включите HTTPS: ./install.sh --tls ваш-домен"
  echo "  Полный порядок и проверки — DEPLOY.md, раздел 12."
}

cmd_restore() {
  local archive="" assume_yes=0 arg
  for arg in "$@"; do
    case "$arg" in
      --yes|-y) assume_yes=1 ;;
      *) if [ -z "$archive" ]; then archive="$arg"; else die "Лишний аргумент: $arg"; fi ;;
    esac
  done
  [ -n "$archive" ] || die "Укажите архив: ./scripts/move.sh restore karkascrm-move-2026-11-12-101500.tar.gz"
  [ -f "$archive" ] || die "Архив не найден: $archive"
  need_docker
  [ -f docker-compose.yml ] || die "Рядом нет docker-compose.yml: запускайте скрипт из каталога KarkasCRM на новом сервере."

  local tmp want got
  # рабочий каталог держим рядом с архивом, на том же диске: /tmp на VPS бывает
  # маленьким tmpfs, а том с базой и вложениями — на гигабайты. TMPDIR переопределяет.
  tmp=$(mktemp -d "${TMPDIR:-$PWD}/.karkas-move.XXXXXX")
  CLEAN_DIR="$tmp"

  tar xzf "$archive" -C "$tmp" || die "Архив не распаковался: возможно, он передан не полностью."
  [ -f "$tmp/data.tar.gz" ] || die "В архиве нет data.tar.gz: это не архив переноса КаркасCRM."
  if [ -f "$tmp/move-info.txt" ]; then
    echo "Архив собран:"
    sed 's/^/  /' "$tmp/move-info.txt"
    want=$(grep -E '^data_sha256=' "$tmp/move-info.txt" | cut -d= -f2- || true)
    got=$(sha256sum "$tmp/data.tar.gz" | cut -d' ' -f1)
    if [ -n "$want" ]; then
      [ "$want" = "$got" ] || die "Контрольная сумма данных не совпала. Архив повреждён или обрезан при передаче: перенесите его заново."
      echo "  контрольная сумма данных совпала"
    fi
  fi

  # настройки со старого сервера: с ними остаются домен, секреты и JWT_SECRET,
  # поэтому сотрудникам не нужно входить заново
  if [ -f "$tmp/env" ]; then
    if [ -f .env ]; then
      local keep=".env.pre-move-$(date +%Y%m%d-%H%M%S)"
      cp .env "$keep"; chmod 600 "$keep"
      echo "  прежний .env сохранён как $keep"
    fi
    cp "$tmp/env" .env
    chmod 600 .env
    echo "  установлен .env со старого сервера: сверьте CRM_DOMAIN, CRM_BIND, CRM_PORT и CRM_TLS с новым сервером"
  elif [ ! -f .env ]; then
    [ -f .env.example ] && cp .env.example .env && chmod 600 .env
    echo "  в архиве нет .env: создан шаблон, заполните домен и секреты до запуска"
  fi

  if crm_running; then
    echo "Останавливаю CRM на этом сервере"
    compose stop crm >/dev/null
  fi
  docker volume inspect "$VOLUME" >/dev/null 2>&1 || { docker volume create "$VOLUME" >/dev/null; echo "  создан том $VOLUME"; }

  # страховка: если в томе уже есть база (например, установка успела запуститься
  # с начальными данными), она сохраняется рядом до замены
  local has_db pre
  has_db=$(docker run --rm --user 0:0 -v "$VOLUME:/data:ro" "$HELPER" sh -c '[ -s /data/crm.db ] && echo yes || echo no')
  if [ "$has_db" = yes ]; then
    pre="pre-move-$(date +%Y-%m-%d-%H%M%S).tar.gz"
    echo "  в томе уже есть база: сохраняю её как $pre"
    docker run --rm --user 0:0 -v "$VOLUME:/data:ro" -v "$PWD:/out" "$HELPER" \
      sh -c "tar czf /out/$pre -C /data . && chmod 644 /out/$pre"
    if [ "$assume_yes" != 1 ] && [ -t 0 ]; then
      printf '  Данные в томе %s будут заменены содержимым архива. Продолжить? [д/н] ' "$VOLUME"
      read -r ans
      case "$ans" in д|Д|да|y|Y|yes) ;; *) die "Отменено: данные в томе не тронуты." ;; esac
    fi
  fi

  echo "Распаковываю данные в том $VOLUME"
  docker run --rm --user 0:0 -v "$VOLUME:/data" -v "$tmp:/in:ro" "$HELPER" sh -c '
    set -e
    cd /data
    for f in * .[!.]*; do if [ -e "$f" ]; then rm -rf -- "$f"; fi; done
    tar xzf /in/data.tar.gz -C /data
    chown -R '"$DATA_UID"':'"$DATA_UID"' /data
    chmod 700 /data/settings.env 2>/dev/null || true
    chmod 700 /data/.jwt-secret 2>/dev/null || true
  '

  local profile port health health_ok
  profile=$(tls_profile)
  if [ -n "$profile" ]; then
    echo "Запускаю в режиме «домен и HTTPS» (профиль tls)"
    echo "  если домен ещё указывает на старый сервер, Caddy не получит сертификат:"
    echo "  переключите DNS и повторите ./scripts/update.sh"
  fi
  # PROFILE намеренно без кавычек: пустая строка должна исчезнуть, а не стать аргументом
  compose ${profile} up -d --build
  docker image prune -f >/dev/null 2>&1 || true
  docker builder prune -f --keep-storage 1GB >/dev/null 2>&1 || true

  port=$(port_from_env)
  health_ok=0
  if health=$(wait_health "$port"); then
    echo "CRM отвечает: $health"
    health_ok=1
  else
    echo "CRM пока не отвечает — смотрите логи: docker compose logs -f crm"
  fi
  compose ps

  # Сразу сверяем базу на новом сервере: сколько записей доехало, цела ли база,
  # нет ли висячих строк, на месте ли вложения чатов и резервные копии. Это
  # доказательство, что перенос ничего не потерял, а не только что контейнер
  # поднялся. db-check читает базу без остановки CRM и сам говорит итог.
  if [ "$health_ok" = 1 ]; then
    echo
    echo "Сверяю базу на новом сервере: состав, целостность, вложения и копии"
    compose exec -T crm node --experimental-sqlite --disable-warning=ExperimentalWarning scripts/db-check.mjs 2>&1 | sed 's/^/  /' || true
  fi

  echo
  echo "Проверьте после переноса:"
  echo "  1) войдите своим логином: сеансы сохраняются, если перенесён .env (тот же JWT_SECRET);"
  echo "  2) числа записей и целостность базы сверены выше; повторить вручную можно командой"
  echo "     docker compose exec -T crm node --experimental-sqlite scripts/db-check.mjs;"
  echo "  3) откройте чат с файлом и скачайте вложение: папка uploads перенесена вместе с томом;"
  echo "  4) переключите DNS на новый сервер, затем включите HTTPS (./install.sh --tls ваш-домен);"
  echo "  5) адрес вебхука Wazzup и почты не меняется, если домен прежний: проверьте счётчик"
  echo "     «Сообщений получено» в Настройки → Интеграции и кнопку «Проверить»;"
  echo "  6) перенесите cron выгрузки копий в S3, если он был на старом сервере;"
  echo "  7) старый сервер оставьте на сутки-двое запасным, затем остановите (docker compose stop),"
  echo "     том не удаляйте: docker compose down -v стирает данные."
}

usage() {
  cat << 'TXT'
Перенос КаркасCRM на другой сервер.

  ./scripts/move.sh pack                 собрать архив данных и настроек (старый сервер)
  ./scripts/move.sh restore АРХИВ        развернуть архив (новый сервер, после install.sh)
  ./scripts/move.sh restore АРХИВ --yes  то же без вопроса о замене данных в томе

В архиве: том karkascrm_data (база, настройки, вложения чатов, копии), файл .env
и сведения о версии. Код на новом сервере ставится отдельно (install.sh).
Порядок переноса и проверки — DEPLOY.md, раздел 12.
TXT
}

case "${1:-}" in
  pack) shift; cmd_pack "$@" ;;
  restore) shift; cmd_restore "$@" ;;
  -h|--help|"") usage ;;
  *) echo "Неизвестная команда: $1"; usage; exit 1 ;;
esac
