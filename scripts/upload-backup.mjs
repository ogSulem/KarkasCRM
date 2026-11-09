// Выгрузка резервных копий базы в S3-совместимое хранилище (Рег.ру, Timeweb,
// Selectel, Hostkey, MinIO…) — чтобы копия лежала НЕ на том же сервере.
// Без внешних зависимостей: запрос подписывается по стандарту AWS Signature V4.
//
// Запуск:
//   S3_ENDPOINT=https://s3.regru.cloud S3_BUCKET=karkas-backups \
//   S3_ACCESS_KEY=... S3_SECRET_KEY=... node scripts/upload-backup.mjs
//
// Переменные окружения:
//   S3_ENDPOINT   адрес хранилища из панели (например, https://s3.regru.cloud)
//   S3_BUCKET     имя «ведра», например karkas-backups
//   S3_REGION     регион из панели (по умолчанию us-east-1 — подходит большинству)
//   S3_ACCESS_KEY / S3_SECRET_KEY   ключи доступа
//   S3_PREFIX     папка внутри ведра (по умолчанию karkascrm)
//   S3_KEEP       сколько последних копий держать в хранилище (по умолчанию 14;
//                 0 — не удалять старые)
//   DATA_DIR      каталог данных CRM (по умолчанию ./data, в Docker это /data)
//
// Старые копии в хранилище удаляются автоматически: без этого ведро росло бы
// годами — локальные копии чистятся через 7 дней, а их загрузки оставались бы
// в S3 навсегда.
// Повторно одни и те же файлы не отправляются: их размер и время изменения
// запоминаются в DATA_DIR/.uploaded.json. Любая ошибка → код возврата 1,
// поэтому сбой сразу видно в письме cron или в мониторинге.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { signedHeaders } from './s3-sign.mjs';

const {
  S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY,
  S3_REGION = 'us-east-1', S3_PREFIX = 'karkascrm', DATA_DIR = './data',
  S3_KEEP = '14',
} = process.env;

function fail(message) {
  console.error('Ошибка: ' + message);
  process.exit(1);
}

// Параметры не должны «тихо» отсутствовать: сразу говорим, чего не хватает.
if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
  fail(`Не заданы параметры хранилища. Нужны S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY.
Пример: S3_ENDPOINT=https://s3.regru.cloud S3_BUCKET=karkas-backups \\
        S3_ACCESS_KEY=... S3_SECRET_KEY=... node scripts/upload-backup.mjs`);
}

const backupsDir = join(DATA_DIR, 'backups');
if (!existsSync(backupsDir)) {
  fail(`Каталог резервных копий не найден: ${backupsDir}. Сначала создайте копию в CRM: Настройки → Резервные копии.`);
}

const prefix = String(S3_PREFIX).replace(/^\/+|\/+$/g, '');
const stateFile = join(DATA_DIR, '.uploaded.json');
const uploaded = (() => {
  try { return JSON.parse(readFileSync(stateFile, 'utf8')) || {}; } catch { return {}; }
})();

const keep = Number(S3_KEEP) || 0;

// Подписанный запрос без тела: список объектов и удаление копии.
async function s3fetch(method, key, query = {}) {
  const req = signedHeaders({ method, key, bucket: S3_BUCKET, query, body: '', region: S3_REGION, endpoint: S3_ENDPOINT, accessKey: S3_ACCESS_KEY, secretKey: S3_SECRET_KEY });
  const res = await fetch(req.url, { method, headers: req.headers });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
  return text;
}

// Ключи приходят из внешнего хранилища: битая процент-последовательность
// в одном старом ключе не должна ломать всю чистку.
const unesc = v => {
  const raw = String(v).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  try { return decodeURIComponent(raw) } catch { return raw }
};

// Хранилище отдаёт список страницами: без досборки чистка посчитала бы только
// первую тысячу объектов, а старые копии продолжали бы лежать и занимать место.
async function pruneRemote() {
  const all = [];
  let marker = '';
  for (let page = 0; page < 10; page++) {
    const query = { prefix: prefix ? prefix + '/' : '', 'max-keys': '1000' };
    if (marker) query.marker = marker;
    const xml = await s3fetch('GET', '', query);
    const pageKeys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => unesc(m[1]));
    all.push(...pageKeys);
    if (!/<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml) || !pageKeys.length) break;
    const next = (xml.match(/<NextMarker>([^<]+)<\/NextMarker>/) || [])[1];
    marker = unesc(next || pageKeys[pageKeys.length - 1]);
  }
  // имена копий начинаются с даты, поэтому сортировка по имени = сортировка по времени
  const keys = all.filter(k => k.endsWith('.db')).sort();
  const extra = keys.slice(0, Math.max(0, keys.length - keep));
  let removed = 0;
  for (const key of extra) {
    try {
      await s3fetch('DELETE', key);
      delete uploaded[key.split('/').pop()];
      removed++;
    } catch (e) { console.error(`Предупреждение: не удалось удалить старую копию ${key}: ${e.message}`) }
  }
  return removed;
}

const files = readdirSync(backupsDir).filter(f => f.endsWith('.db')).sort();
if (!files.length) fail('В каталоге резервных копий пока нет файлов .db — создайте копию в CRM и повторите запуск.');

let sent = 0;
let failed = 0;
for (const name of files) {
  const full = join(backupsDir, name);
  const st = statSync(full);
  const stamp = `${st.size}-${Math.round(st.mtimeMs)}`;
  if (uploaded[name] === stamp) { console.log(`• ${name} — уже в хранилище`); continue; }

  const body = readFileSync(full);
  const key = `${prefix}/${name}`;
  let res;
  try {
    const req = signedHeaders({ method: 'PUT', key, bucket: S3_BUCKET, body, region: S3_REGION, endpoint: S3_ENDPOINT, accessKey: S3_ACCESS_KEY, secretKey: S3_SECRET_KEY });
    res = await fetch(req.url, {
      method: 'PUT',
      headers: { ...req.headers, 'Content-Type': 'application/vnd.sqlite3', 'Content-Length': String(body.length) },
      body,
    });
  } catch (err) {
    failed++;
    console.error(`Ошибка: ${name}: хранилище недоступно — ${err.message}`);
    continue;
  }
  if (!res.ok) {
    failed++;
    const text = await res.text().catch(() => '');
    console.error(`Ошибка: ${name}: HTTP ${res.status} ${text.slice(0, 300)}`);
    continue;
  }
  uploaded[name] = stamp;
  sent++;
  console.log(`Выгружено: ${name} (${(body.length / 1048576).toFixed(1)} МБ) → ${S3_BUCKET}/${key}`);
}

// записи о давно исчезнувших локальных файлах не должны копиться в состоянии
for (const name of Object.keys(uploaded)) if (!files.includes(name)) delete uploaded[name];

if (keep > 0) {
  try {
    const removed = await pruneRemote();
    if (removed) console.log(`Удалено старых копий в хранилище: ${removed} (хранятся последние ${keep}).`);
  } catch (e) {
    // чистка не отменяет выгрузку: свежие копии уже в хранилище
    console.error(`Предупреждение: не удалось почистить старые копии в хранилище: ${e.message}`);
  }
}

writeFileSync(stateFile, JSON.stringify(uploaded, null, 2));
console.log(`\nГотово. Отправлено сейчас: ${sent}. Всего в хранилище: ${Object.keys(uploaded).length}. Ошибок: ${failed}.`);
console.log(`Хранилище: ${S3_ENDPOINT} · ведро ${S3_BUCKET} · папка ${prefix}`);
if (failed) process.exit(1);
