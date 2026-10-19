#!/bin/sh
set -eu
CRM_DOMAIN=${CRM_DOMAIN:-}
JWT_SECRET=${JWT_SECRET:-}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-}
[ -n "$CRM_DOMAIN" ] || { echo 'TLS: укажите CRM_DOMAIN в .env' >&2; exit 1; }
case "$CRM_DOMAIN" in *[!a-zA-Z0-9.-]*|.*|*.) echo 'TLS: CRM_DOMAIN — только DNS-имя без https://, порта и пути (для кириллицы используйте punycode)' >&2; exit 1;; esac
case "$CRM_DOMAIN" in *.*) ;; *) echo 'TLS: укажите полное DNS-имя' >&2; exit 1;; esac
[ "${#JWT_SECRET}" -ge 32 ] || { echo 'TLS: задайте случайный JWT_SECRET (32+ символа)' >&2; exit 1; }
case "$JWT_SECRET" in *change*|*СМЕНИТЕ*|*смените*) echo 'TLS: замените пример JWT_SECRET' >&2; exit 1;; esac
[ "${#ADMIN_PASSWORD}" -ge 12 ] && [ "$ADMIN_PASSWORD" != 'admin12345' ] || { echo 'TLS: задайте ADMIN_PASSWORD (12+ символов)' >&2; exit 1; }
# Необязательный e-mail добавляется только если указан, без пустой директивы Caddy.
config=/etc/caddy/Caddyfile
if [ -n "${ACME_EMAIL:-}" ]; then
  case "$ACME_EMAIL" in *[!a-zA-Z0-9@._+-]*) echo 'TLS: некорректный ACME_EMAIL' >&2; exit 1;; esac
  case "$ACME_EMAIL" in *@*.*) ;; *) echo 'TLS: некорректный ACME_EMAIL' >&2; exit 1;; esac
  config=/tmp/karkas-Caddyfile
  printf '{\n email %s\n}\n' "$ACME_EMAIL" > "$config"
  cat /etc/caddy/Caddyfile >> "$config"
fi
exec caddy run --config "$config" --adapter caddyfile
