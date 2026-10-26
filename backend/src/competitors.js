// KarkasCRM — модуль «Конкуренты»: разведка конкурента (долги, суды, банкротство, отзывы, цены из Excel)
// Zero external deps. Every source is best-effort and reports its own status:
//   ok | skipped (нет ключа) | blocked (сайт не отдал данные) | error
// Для любого источника всегда формируются прямые ссылки ручной проверки — они работают без API.
import zlib from 'node:zlib';
import dns from 'node:dns';

const digits = s => String(s || '').replace(/\D/g, '');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const money = n => Number(n || 0);
const LEVELS = [[25, 'низкий', '#16a34a'], [50, 'умеренный', '#eab308'], [75, 'повышенный', '#f97316'], [101, 'высокий', '#dc2626']];
const levelOf = score => LEVELS.find(([max]) => score < max)[1];
const levelColor = score => LEVELS.find(([max]) => score < max)[2];
const norm = s => String(s || '').toLowerCase().replace(/[«»"'`]/g, '').replace(/[^a-zа-я0-9]+/gi, ' ').trim();

// Насколько похожи названия позиций (0..1): сравнение цен и загрузка прайса
// ищут «свою» позицию по названию, если нет артикула. Точное совпадение — 1.
// «Баня каркасная 4×6» и «Баня 4×6» — одна позиция (все слова короткого названия
// есть в длинном), а «Дом 6×8 «Летний»» и «Дом 6×8 с террасой» — разные комплектации.
const wordsOf = s => new Set(norm(s).split(' ').filter(Boolean));
export function nameScore(a, b) {
  const A = wordsOf(a), B = wordsOf(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  if (!shared) return 0;
  const union = new Set([...A, ...B]).size;
  const jaccard = shared / union;
  return shared === Math.min(A.size, B.size) ? Math.max(jaccard, 0.8) : jaccard;
}
const MATCH_MIN = 0.6;

// about — что источник отдаёт и нужен ли для этого ключ.
// manual: true — данных по API нет (нет API или сайт закрыт от роботов),
// источник даёт только ссылку на официальную страницу ручной проверки.
export const SOURCE_DEFS = [
  { key: 'rusprofile', name: 'Rusprofile', kind: 'card', needs: [], manual: true, about: 'Карточка компании: реквизиты, связи, суды, долги. Публичного API нет, сайт закрыт от роботов — проверка по ссылке' },
  { key: 'fns', name: 'ФНС (api-fns.ru)', kind: 'card', needs: ['FNS_API_KEY'], about: 'ЕГРЮЛ/ЕГРИП: статус, адрес, руководитель, учредители, ОКВЭД, численность' },
  { key: 'fedresurs', name: 'Федресурс (ЕФРСБ)', kind: 'debts', needs: [], about: 'Реестр банкротств: сведения о процедурах. Сайт обычно запрещает автоматический доступ — тогда проверка по ссылке' },
  { key: 'fssp', name: 'ФССП (приставы)', kind: 'debts', needs: [], manual: true, about: 'Долги у приставов. Официальный API ФССП закрыт с марта 2022 года — только ссылка на банк данных' },
  { key: 'kad', name: 'Суды (kad.arbitr.ru)', kind: 'courts', needs: [], about: 'Арбитражные дела с участием компании: номер, дата, суд, роль' },
  { key: 'google', name: 'Google Карты', kind: 'reviews', needs: ['GOOGLE_PLACES_KEY'], about: 'Рейтинг и отзывы клиентов (Places API)' },
  { key: '2gis', name: '2ГИС', kind: 'reviews', needs: ['TWOGIS_KEY'], about: 'Рейтинг и количество отзывов' },
  { key: 'yandex', name: 'Яндекс Карты', kind: 'reviews', needs: ['YANDEX_API_KEY'], about: 'Карточка организации, адрес, телефоны' },
];

// схема модуля «Конкуренты»: создаётся и при запуске сервера, и при явном seed
export function ensureCompetitorsSchema(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS competitors(id INTEGER PRIMARY KEY,name TEXT NOT NULL,inn TEXT,ogrn TEXT,city TEXT,website TEXT,phone TEXT,notes TEXT DEFAULT '',price_url TEXT DEFAULT '',created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS competitor_checks(id INTEGER PRIMARY KEY,competitor_id INTEGER REFERENCES competitors(id) ON DELETE CASCADE,source TEXT,status TEXT,summary TEXT,payload TEXT,checked_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS competitor_reports(id INTEGER PRIMARY KEY,competitor_id INTEGER REFERENCES competitors(id) ON DELETE CASCADE,risk INTEGER,level TEXT,verdict TEXT,payload TEXT,created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY,competitor_id INTEGER REFERENCES competitors(id) ON DELETE CASCADE,source TEXT DEFAULT 'вручную',rating REAL,text TEXT,author TEXT,url TEXT,created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS price_rows(id INTEGER PRIMARY KEY,competitor_id INTEGER,scope TEXT DEFAULT 'competitor',item TEXT,price REAL,unit TEXT,sku TEXT,note TEXT,source_name TEXT,updated_at TEXT DEFAULT (datetime('now')));
  CREATE INDEX IF NOT EXISTS idx_checks_comp ON competitor_checks(competitor_id,source);
  CREATE TABLE IF NOT EXISTS competitor_findings(id INTEGER PRIMARY KEY,competitor_id INTEGER REFERENCES competitors(id) ON DELETE CASCADE,kind TEXT DEFAULT 'прочее',title TEXT,amount REAL,note TEXT,source_url TEXT,author TEXT,created_at TEXT DEFAULT (datetime('now')));
  CREATE INDEX IF NOT EXISTS idx_reviews_comp ON reviews(competitor_id);
  CREATE INDEX IF NOT EXISTS idx_findings_comp ON competitor_findings(competitor_id);
  CREATE INDEX IF NOT EXISTS idx_prices_comp ON price_rows(competitor_id,scope);
  `);
  for (const [t, c, d] of [['competitors', 'demo', 'INTEGER DEFAULT 0'], ['price_rows', 'demo', 'INTEGER DEFAULT 0']]) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(r => r.name);
    if (!cols.includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`);
  }
  ensureCatalogColumns(db);
}

/* ───────────────────── каталог = наш прайс-лист ─────────────────────
   Раньше «наша таблица цен» жила отдельно (price_rows, scope='ours') и по сути
   дублировала каталог (products): одну и ту же позицию приходилось вести в двух
   местах, а цена в сделке и цена в сравнении с конкурентом могли разъехаться.
   Теперь источник один — каталог. price_rows остался только для прайсов конкурентов. */
export function ensureCatalogColumns(db) {
  try {
    const cols = db.prepare('PRAGMA table_info(products)').all().map(r => r.name);
    if (!cols.length) return; // таблицы ещё нет — её создаёт сервер
    if (!cols.includes('note')) db.exec("ALTER TABLE products ADD COLUMN note TEXT DEFAULT ''");
  } catch { /* каталог не нужен самому модулю разведки — не ломаемся */ }
}

// Позиции каталога в том же виде, в каком интерфейс ждёт «нашу таблицу цен».
// pricedOnly — для сравнения цен (позиция без цены сравниваться не может).
export function catalogPrices(db, { pricedOnly = false, includeArchived = false } = {}) {
  const where = [includeArchived ? '1=1' : 'active=1', pricedOnly ? 'price>0' : '1=1'].join(' AND ');
  return db.prepare(`SELECT * FROM products WHERE ${where} ORDER BY name`).all()
    .map(p => ({
      id: p.id, product_id: p.id, competitor_id: null, scope: 'ours',
      item: p.name, price: money(p.price), unit: p.unit || 'шт', sku: p.sku || '',
      note: p.note || '', active: p.active, source_name: 'каталог',
    }));
}

/* Загрузка прайса в каталог. Позиция с тем же артикулом или тем же названием
   обновляется, новая — добавляется; ничего не пропадает.
   mode='replace' дополнительно убирает в архив то, чего в файле нет (именно в архив,
   не удаление: позиция могла остаться в прошлых сделках). */
export function catalogUpsert(db, rows, { mode = 'merge' } = {}) {
  ensureCatalogColumns(db);
  const list = db.prepare('SELECT * FROM products').all();
  const byName = new Map(list.map(p => [norm(p.name), p]));
  const bySku = new Map(list.filter(p => p.sku).map(p => [norm(p.sku), p]));
  const hasDemo = db.prepare('PRAGMA table_info(products)').all().some(c => c.name === 'demo');
  let added = 0, updated = 0, archived = 0;
  const touched = new Set();
  db.exec('BEGIN IMMEDIATE');
  try {
    const upd = db.prepare('UPDATE products SET name=?,price=?,unit=?,sku=?,note=?,active=1 WHERE id=?');
    const ins = db.prepare(hasDemo
      ? 'INSERT INTO products(name,sku,price,unit,active,note,demo) VALUES(?,?,?,?,1,?,?)'
      : 'INSERT INTO products(name,sku,price,unit,active,note) VALUES(?,?,?,?,1,?)');
    for (const r of rows) {
      const item = String(r.item || '').trim().slice(0, 200);
      if (!item) continue;
      const sku = String(r.sku || '').trim().slice(0, 80);
      const key = norm(item), skey = sku ? norm(sku) : '';
      const hit = (skey && bySku.get(skey)) || byName.get(key) || null;
      const price = Math.round(money(r.price));
      const unit = (String(r.unit || (hit && hit.unit) || '').trim().slice(0, 20)) || 'шт';
      const note = String(r.note || '').trim().slice(0, 300) || (hit && hit.note) || '';
      if (hit) {
        upd.run(item, price, unit, sku || hit.sku || '', note, hit.id);
        touched.add(hit.id); updated++;
        byName.set(key, hit); if (skey) bySku.set(skey, hit);
      } else {
        const id = Number(ins.run(item, sku, price, unit, note, r.demo ? 1 : 0).lastInsertRowid);
        const row = { id, name: item, sku, unit, note };
        byName.set(key, row); if (skey) bySku.set(skey, row);
        touched.add(id); added++;
      }
    }
    if (mode === 'replace') {
      const arch = db.prepare('UPDATE products SET active=0 WHERE id=?');
      for (const p of db.prepare('SELECT id FROM products WHERE active=1').all()) {
        if (!touched.has(p.id)) { arch.run(p.id); archived++ }
      }
    }
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK') } catch { /* уже откатилось */ } throw e }
  return { added, updated, archived, total: db.prepare('SELECT COUNT(*) n FROM products WHERE active=1').get().n };
}

// Перенос «нашей таблицы цен» из базы прошлой версии в каталог. Идемпотентно:
// запускается при каждом старте, второй раз переносить уже нечего.
export function migrateOurPricesToCatalog(db) {
  try {
    const legacy = db.prepare("SELECT * FROM price_rows WHERE scope='ours'").all();
    if (!legacy.length) return 0;
    ensureCatalogColumns(db);
    catalogUpsert(db, legacy.map(r => ({ item: r.item, price: r.price, unit: r.unit, sku: r.sku, note: r.note, demo: r.demo })), { mode: 'merge' });
    db.prepare("DELETE FROM price_rows WHERE scope='ours'").run();
    return legacy.length;
  } catch { return 0 }
}

export function createCompetitors(ctx) {
  const { db, json, readBody, log, broadcast, getSetting, setSetting } = ctx;
  ensureCompetitorsSchema(db);

  const SOURCE_URL_DEFAULTS = {
    RUSPROFILE_URL: 'https://www.rusprofile.ru',
    FNS_API_URL: 'https://api-fns.ru/api',
    FEDRESURS_API_URL: 'https://bankrot.fedresurs.ru',
    KAD_API_URL: 'https://kad.arbitr.ru',
    // Places API (New): старая версия (maps.googleapis.com/maps/api/place/...)
    // с октября 2026 не включается в новых проектах Google Cloud.
    GOOGLE_API_URL: 'https://places.googleapis.com/v1',
    TWOGIS_API_URL: 'https://catalog.api.2gis.ru/3.0',
    YANDEX_API_URL: 'https://search-maps.yandex.ru/v1',
  };
  const srcUrl = k => getSetting(k, SOURCE_URL_DEFAULTS[k]).replace(/\/$/, '');
  // какой адрес настройки относится к какому источнику (у ФССП адреса нет: API закрыт)
  const URL_OF = { rusprofile: 'RUSPROFILE_URL', fns: 'FNS_API_URL', fedresurs: 'FEDRESURS_API_URL', kad: 'KAD_API_URL', google: 'GOOGLE_API_URL', '2gis': 'TWOGIS_API_URL', yandex: 'YANDEX_API_URL' };

  // ─────────────────────────── helpers ───────────────────────────
  // SSRF-защита: пользовательские ссылки (прайс конкурента, « наша таблица по URL»)
  // не должны тянуть данные из внутренней сети. Только http/https, только
  // публичные IP, редиректы проверяются заново, размер ответа ограничен.
  const isPrivateIp = ip => {
    if (!ip) return true;
    if (ip.includes('::ffff:')) ip = ip.split('::ffff:').pop(); // IPv4-mapped IPv6
    const v6 = ip.includes(':');
    if (v6) return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80') || ip.startsWith('fe00');
    const o = ip.split('.').map(Number);
    if (o.length !== 4 || o.some(x => !Number.isFinite(x) || x < 0 || x > 255)) return true;
    if (o[0] === 127 || o[0] === 10 || o[0] === 0) return true;
    if (o[0] === 169 && o[1] === 254) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
    return false;
  };
  // ALLOW_PRIVATE_FETCH=1 — только для тестов и самохостинговых шлюзов в локальной сети
  const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_FETCH === '1';
  async function safeFetch(url, opt = {}, ms = 12000, hops = 0) {
    let u;
    try { u = new URL(url); } catch { throw new Error('Некорректная ссылка'); }
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Только ссылки http/https');
    let infos = [];
    try { infos = await dns.promises.lookup(u.hostname, { all: true }); } catch { throw new Error('Не удалось узнать адрес сервера'); }
    if (!ALLOW_PRIVATE && (!infos.length || infos.some(i => isPrivateIp(i.address)))) throw new Error('Ссылка ведёт на внутренний адрес — это запрещено политикой безопасности');
    const res = await fetch(url, { ...opt, redirect: 'manual', signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KarkasCRM)', Accept: '*/*', ...(opt.headers || {}) } });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('Пустое перенаправление');
      if (hops >= 5) throw new Error('Слишком много перенаправлений');
      return safeFetch(new URL(loc, url).toString(), opt, ms, hops + 1);
    }
    // ограничиваем размер ответа: читаем поток с потолком 8 МБ
    const MAX = 8 * 1024 * 1024;
    const chunks = []; let total = 0;
    for await (const chunk of res.body ?? []) {
      total += chunk.length;
      if (total > MAX) { res.body?.cancel?.(); throw new Error('Ответ слишком большой (более 8 МБ)'); }
      chunks.push(chunk);
    }
    return { ok: res.ok, status: res.status, text: Buffer.concat(chunks).toString('utf8') };
  }
  const httpOnce = async (url, opt, ms) => {
    try {
      const res = await safeFetch(url, opt, ms);
      let data = null; try { data = JSON.parse(res.text); } catch {}
      return { ok: res.ok, status: res.status, text: res.text, data };
    } catch (e) {
      // таймаут отличается от отказа в соединении: первый случается от нагрузки
      // на источник и повтор помогает, второй повторится с тем же результатом
      const timeout = Boolean(e) && (e.name === 'TimeoutError' || e.name === 'AbortError' || /timeout|aborted/i.test(String(e.message)));
      return { ok: false, status: 0, text: '', data: null, error: e.message, timeout };
    }
  };
  async function http(url, opt = {}, ms = Number(getSetting('COMPETITOR_TIMEOUT_MS', '12000'))) {
    const first = await httpOnce(url, opt, ms);
    // Один повтор при обрыве соединения, таймауте или ответе 5xx: карты и реестры
    // периодически отвечают ошибкой на отдельный запрос. Без повтора источник
    // выглядел бы сломанным, а проверка — неполной. Больше одного раза не
    // повторяем: источник может отвечать отказом именно из-за частоты запросов.
    const transient = first.timeout || (first.status >= 500 && first.status <= 599);
    if (!transient) return first;
    await new Promise(r => setTimeout(r, 400));
    const second = await httpOnce(url, opt, ms);
    if (second.ok) return { ...second, retried: true };
    return { ...(second.status ? second : first), retried: true };
  }
  const blockedHint = 'сайт не отдал данные автоматически — проверьте по ссылке ниже';
  // нет соединения / блокировка антиботом / превышен лимит — во всех случаях данные берём по ссылке
  const failStatus = res => ([0, 401, 403, 410, 429].includes(res.status) ? 'blocked' : 'error');
  const failText = res => res.status === 0 ? `Источник недоступен (${res.error || 'нет соединения'}). ${blockedHint}`
    : res.status === 410 ? `HTTP 410 — источник закрыт навсегда и данные больше не отдаёт. ${blockedHint}`
    : res.status >= 500 ? `HTTP ${res.status} — сервер источника не справился с запросом${res.retried ? ', повтор тоже не помог' : ''}. Повторите проверку позже. ${blockedHint}`
    : `HTTP ${res.status}. ${blockedHint}`;

  // Прямые ссылки ручной проверки: работают всегда, без ключей и API.
  // Форматы адресов сверены с самими сервисами:
  //  • Rusprofile: карточка ИП — это /ip/<ОГРНИП> (номер и есть адрес страницы),
  //    а у юрлица в /id/ стоит внутренний номер сайта, а не ОГРН — поэтому
  //    юрлицо открываем через поиск, иначе ссылка приводит на «404».
  //  • kad.arbitr.ru: картотека не принимает параметр поиска в адресе,
  //    ИНН сотрудник вводит в форму сам — об этом сказано в названии ссылки.
  function linksFor({ name = '', inn = '', ogrn = '', rpId = '' } = {}) {
    const q = encodeURIComponent(inn || ogrn || name || '');
    const id = ogrn || inn;
    const rp = 'https://www.rusprofile.ru';
    const isIp = digits(ogrn).length === 15;
    const rid = digits(rpId).length <= 12 ? digits(rpId) : '';
    // Карточка Rusprofile открывается по его внутреннему номеру, а не по ОГРН:
    // у ООО «УК «Дримхаус» ОГРН 1115260005057, а адрес карточки — /id/5448224.
    // Номер приходит из ответа самого сайта; пока он неизвестен, ведём на поиск.
    const cardUrl = rid ? `${rp}/${isIp ? 'ip' : 'id'}/${rid}`
      : isIp && digits(ogrn) ? `${rp}/ip/${digits(ogrn)}` : `${rp}/search?query=${q}`;
    return [
      { label: 'Rusprofile: карточка', url: cardUrl },
      // «Связи» строятся по тому же внутреннему номеру. Без него адрес
      // /connections/<ОГРН> открыл бы чужую страницу или 404, поэтому ссылку
      // даём только когда номер известен.
      ...(rid ? [{ label: 'Rusprofile: связи и аффилированные лица', url: `${rp}/connections/${rid}` }] : []),
      { label: 'Rusprofile: поиск по названию', url: `${rp}/search?query=${encodeURIComponent(name || id)}` },
      { label: 'ФНС: Прозрачный бизнес', url: `https://pb.nalog.ru/search.html?mode=search-ul&queryAll=${q}` },
      { label: 'ФНС: бухотчётность (ГИР БО)', url: `https://bo.nalog.gov.ru/search?allFieldsMatch=false&query=${q}` },
      { label: 'ФССП: банк исполнительных производств', url: 'https://fssp.gov.ru/iss/ip' },
      { label: 'Федресурс: реестр банкротств', url: `https://bankrot.fedresurs.ru/DebtorsSearch.aspx?searchString=${q}` },
      { label: 'Суды: картотека kad.arbitr.ru (ИНН вводится в форму)', url: 'https://kad.arbitr.ru/' },
      { label: 'Яндекс Карты: отзывы', url: `https://yandex.ru/maps/?text=${encodeURIComponent(name || inn)}` },
      { label: '2ГИС: отзывы', url: `https://2gis.ru/search/${encodeURIComponent(name || inn)}` },
      { label: 'Авито: предложения конкурента', url: `https://www.avito.ru/all?q=${encodeURIComponent(name || inn)}` },
      { label: 'Google: отзывы и упоминания', url: `https://www.google.com/search?q=${encodeURIComponent((name || inn) + ' отзывы')}` },
      ...(id ? [{ label: 'Госзакупки', url: `https://zakupki.gov.ru/epz/main/public/search/results.html?searchString=${encodeURIComponent(id)}` }] : []),
    ];
  }

  // ─────────────────────────── источники ───────────────────────────
  async function srcRusprofile({ name, inn, ogrn }) {
    const q = digits(inn) || digits(ogrn) || name;
    const res = await http(`${srcUrl('RUSPROFILE_URL')}/search?query=${encodeURIComponent(q)}`);
    const out = { source: 'rusprofile', title: 'Rusprofile', links: linksFor({ name, inn, ogrn }) };
    if (!res.ok) return { ...out, status: failStatus(res), summary: failText(res), data: {} };
    const html = res.text || '';
    const pick = re => (html.match(re) || [])[1]?.trim() || '';
    const card = {
      name: pick(/<span[^>]*itemprop="name"[^>]*>([^<]+)</i) || pick(/<title>([^<|]+)/i),
      inn: pick(/ИНН[^0-9]{0,40}(\d{10,12})/i) || digits(inn),
      ogrn: pick(/ОГРН[^0-9]{0,40}(\d{13,15})/i) || digits(ogrn),
      status: /действующ/i.test(html) ? 'действующая' : /ликвидац|прекращ/i.test(html) ? 'ликвидация/прекращена' : '',
      address: pick(/itemprop="address"[^>]*>([^<]+)</i),
      courts: Number(pick(/(\d+)\s*(?:арбитражн|судебн)/i)) || 0,
      debts: /исполнительн[^<]{0,80}/i.test(html) ? pick(/(\d[\d\s]{2,})\s*₽/i) : '',
      found: /\/id\/\d+|\/ip\/\d+|ОГРН/i.test(html),
      rpId: '',
    };
    // Внутренний номер Rusprofile — из ссылки на карточку в ответе сайта. Он
    // короткий и не совпадает с ОГРН: если в HTML попался сам ОГРН, строить по
    // нему /id/ и /connections/ нельзя — адрес откроет чужую страницу или 404.
    const rid = pick(/href="\/(?:id|ip)\/(\d+)"/i) || pick(/\/(?:id|ip)\/(\d{4,12})/i);
    if (rid && rid.length <= 12 && rid !== digits(ogrn) && rid !== digits(inn)) card.rpId = rid;
    card.found = card.found || Boolean(card.rpId);
    return {
      ...out,
      links: linksFor({ name, inn, ogrn, rpId: card.rpId }),
      status: 'ok',
      summary: card.found ? `Найдено: ${card.name || q}${card.status ? ' · ' + card.status : ''}` : 'Совпадение не найдено — уточните ИНН',
      data: { card },
    };
  }

  async function srcFns({ name, inn }) {
    const key = getSetting('FNS_API_KEY');
    const out = { source: 'fns', title: 'ФНС (ЕГРЮЛ)', links: linksFor({ name, inn }) };
    if (!key) return { ...out, status: 'skipped', summary: 'Не задан ключ api-fns.ru — данные доступны по ссылкам ручной проверки', data: {} };
    const base = srcUrl('FNS_API_URL');
    const q = digits(inn).length >= 10 ? digits(inn) : name;
    const res = await http(`${base}/egr?req=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`);
    if (!res.ok || !res.data) {
      // при сбое сначала наше объяснение с кодом ответа, потом текст источника:
      // одно лишь «Internal Server Error» не говорит сотруднику, что делать
      const vendor = res.data?.error;
      return { ...out, status: failStatus(res), summary: res.ok ? (vendor || 'Источник не отдал данные') : failText(res) + (vendor ? ' Ответ источника: ' + vendor : ''), data: {} };
    }
    const item = (res.data.items || [])[0] || res.data;
    const ul = item['ЮЛ'] || item['ИП'] || item['НР'] || item;
    // Ответ api-fns.ru вложенный: адрес, руководитель, ОКВЭД и численность лежат
    // в собственных объектах (Адрес.АдресПолн, Руководитель.ФИОПолн, ОснВидДеят.Код,
    // ОткрСведения.КолРаб). Плоские ключи оставлены запасным путём — разные методы
    // сервиса отдают данные по-разному, а пустая карточка хуже любой из версий.
    const at = (...path) => { let v = ul; for (const k of path) { if (v === null || typeof v !== 'object') return undefined; v = v[k] } return v };
    const first = (...vals) => { for (const v of vals) if (v !== undefined && v !== null && v !== '') return v; return '' };
    const foundersRaw = first(at('Учредители'), at('Учред'), at('УчредителиФЛ'), at('УчредителиЮЛ'), []);
    const card = {
      name: first(at('НаимСокрЮЛ'), at('НаимПолнЮЛ'), at('ФИОПолн')),
      fullName: first(at('НаимПолнЮЛ'), at('ФИОПолн')),
      inn: String(first(at('ИНН'), at('ИННФЛ')) || digits(inn)),
      ogrn: String(first(at('ОГРН'), at('ОГРНИП')) || ''),
      kpp: String(first(at('КПП')) || ''),
      status: first(at('Статус')),
      regDate: first(at('ДатаРег'), at('ДатаОГРН')),
      region: first(at('Регион'), at('Адрес', 'Регион')),
      address: first(at('Адрес', 'АдресПолн'), at('АдресРФ', 'АдресПолн'), at('АдресПолн'), at('АдресРФ')),
      okved: first(at('ОснВидДеят', 'Код'), at('ОКВЭД'), at('ОсновнойВидДеят')),
      okvedText: first(at('ОснВидДеят', 'Текст')),
      employees: first(at('ОткрСведения', 'КолРаб'), at('КолРаб'), at('ССЧР')),
      capital: first(at('УстКап'), at('УставныйКапитал')),
      director: first(at('Руководитель', 'ФИОПолн'), at('Руководитель', 'ФИО'), at('Руководитель', 'Наим'), at('Руководители', 0, 'ФИОПолн')),
      founders: (Array.isArray(foundersRaw) ? foundersRaw : []).map(x => first(
        x && x['ФИОПолн'], x && x['ФИО'], x && x['Наим'], x && x['НаимЮЛ'],
        x && [x['Фамилия'], x['Имя'], x['Отчество']].filter(Boolean).join(' '),
      )).filter(Boolean).slice(0, 5),
      arrears: money(first(at('Недоимка'), at('СумНедоим'), at('НедоимкаСум'), at('Финансы', 'Недоимка'), 0)),
      offenses: first(at('НалогПравонарушения'), at('Правонарушения'), []),
      invalid: first(at('СвНедостоверн'), at('СведНедостоверн'), at('СвДост'), at('Недостоверность')),
    };
    const flags = [];
    if (/недейств|прекращ|ликвидац/i.test(String(card.status))) flags.push('статус: ' + card.status);
    if (card.arrears > 0) flags.push(`недоимка ${card.arrears.toLocaleString('ru-RU')} ₽`);
    if (card.invalid) flags.push('недостоверные сведения в ЕГРЮЛ');
    return { ...out, status: 'ok', summary: `${card.name || q}${card.status ? ' · ' + card.status : ''}${flags.length ? ' · ' + flags.join(', ') : ''}`, data: { card, flags } };
  }

  async function srcFedresurs({ name, inn, ogrn }) {
    const q = digits(inn) || digits(ogrn) || name;
    const out = { source: 'fedresurs', title: 'Федресурс (банкротство)', links: linksFor({ name, inn, ogrn }) };
    const res = await http(`${srcUrl('FEDRESURS_API_URL')}/backend/counterparties?searchString=${encodeURIComponent(q)}&offset=0&limit=15`);
    if (!res.ok) return { ...out, status: failStatus(res), summary: failText(res), data: {} };
    const d = res.data || {};
    const list = d.pageData || d.items || d.data || (Array.isArray(d) ? d : []);
    const cases = list.map(x => ({ name: x.name || x.Name || x.fullName || '', inn: x.inn || x.Inn || '', ogrn: x.ogrn || x.Ogrn || '', case: x.caseNumber || x.CaseNumber || '', status: x.legalCaseStatus || x.isActive === true ? 'в производстве' : (x.isActive === false ? 'завершено' : ''), date: String(x.date || x.Date || '').slice(0, 10) })).filter(x => x.name || x.inn);
    return { ...out, status: 'ok', summary: cases.length ? `Найден в реестре банкротств: ${cases.length} дел(о)` : 'В реестре банкротств не найден — плюс к надёжности', data: { cases } };
  }

  // Долги у судебных приставов. Официальный API банка данных ФССП
  // (api-ip.fssp.gov.ru) отключён 10 марта 2022 года и не восстанавливается:
  // любой запрос возвращает 410 Gone, токен получить негде. Поэтому запрос
  // не выполняется вовсе, а источник даёт ссылку на публичный банк данных.
  async function srcFssp({ name, inn }) {
    const out = { source: 'fssp', title: 'ФССП (долги)', links: linksFor({ name, inn }) };
    return {
      ...out, status: 'skipped',
      summary: 'Официальный API ФССП закрыт с марта 2022 года — суммы долгов смотрите по ссылке «ФССП: банк исполнительных производств»',
      data: { productions: [], total: null, manual: true },
    };
  }

  async function srcKad({ name, inn, ogrn }) {
    const out = { source: 'kad', title: 'Арбитражные суды', links: linksFor({ name, inn }) };
    // Контракт kad.arbitr.ru/Kad/SearchInstances: сторона задаётся одной строкой
    // Sides[].Name — туда можно передать наименование, ИНН или ОГРН (отдельного
    // поля Inn в запросе нет), Type -1 означает «любая сторона». Даты приходят
    // в привычном ISO только с заголовком x-date-format: iso.
    const side = digits(inn) || digits(ogrn) || String(name || '').trim();
    if (!side) return { ...out, status: 'skipped', summary: 'Не заполнены ни ИНН, ни ОГРН, ни название — искать в картотеке нечего', data: { cases: [], total: 0 } };
    const res = await http(`${srcUrl('KAD_API_URL')}/Kad/SearchInstances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'x-date-format': 'iso' },
      body: JSON.stringify({ Sides: [{ Name: side, Type: -1, ExactMatch: false }], Page: 1, Count: 25, Courts: [], Judges: [], CaseNumbers: [], WithVKSInstances: false }),
    });
    if (!res.ok || !res.data) {
      // Картотека иногда отвечает HTML-страницей вместо JSON — из неё берём хотя бы число дел.
      const htmlTotal = Number((String(res.text || '').match(/documentsTotalCount[^>]*value="(\d+)"/) || [])[1]) || 0;
      if (htmlTotal > 0) return { ...out, status: 'ok', summary: `Найдено дел: ${htmlTotal} (картотека отдала страницу вместо списка — подробности по ссылке)`, data: { cases: [], total: htmlTotal } };
      return { ...out, status: failStatus(res), summary: failText(res), data: { cases: [], total: 0 } };
    }
    if (res.data.Success === false) return { ...out, status: 'error', summary: res.data.Message || 'Картотека отклонила запрос', data: { cases: [], total: 0 } };
    const result = res.data.Result || {};
    const items = result.Items || res.data.items || [];
    const total = Number(result.TotalCount ?? result.Count ?? items.length) || items.length;
    const me = digits(inn) || digits(ogrn);
    // Роль берём из списков сторон ответа: Plaintiffs / Respondents .Participants[].Inn
    const roleOf = x => {
      const has = s2 => (s2 && Array.isArray(s2.Participants) ? s2.Participants : []).some(p => me && digits(p && p.Inn) === me);
      return has(x.Respondents) ? 'ответчик' : has(x.Plaintiffs) ? 'истец' : 'участник';
    };
    const cases = items.slice(0, 25).map(x => ({
      number: x.CaseNumber || '',
      date: String(x.Date || x.FilingDate || x.RegistrationDate || '').slice(0, 10),
      type: x.CaseType || '',
      court: x.CourtName || '',
      judge: x.Judge || '',
      url: x.CaseId ? `https://kad.arbitr.ru/Card/${x.CaseId}` : '',
      role: roleOf(x),
    }));
    return { ...out, status: 'ok', summary: total ? `Найдено дел: ${total}` : 'Арбитражных дел не найдено', data: { cases, total } };
  }

  // Google Карты. С октября 2026 старая версия Places API
  // (maps.googleapis.com/maps/api/place/...) не включается в новых проектах
  // Google Cloud, поэтому по умолчанию используется Places API (New): один
  // POST-запрос возвращает и карточку, и до пяти отзывов — второй запрос
  // за деталями больше не нужен. Старый путь сохранён для проектов, где он
  // уже включён: он выбирается по адресу, заданному в настройках.
  const GOOGLE_FIELDS = 'places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.googleMapsUri,places.reviews.author.displayName,places.reviews.rating,places.reviews.text.text,places.reviews.relativePublishTimeDescription';

  async function srcGoogleLegacy(out, q, key, base) {
    const s = await http(`${base}/place/textsearch/json?query=${encodeURIComponent(q)}&language=ru&key=${encodeURIComponent(key)}`);
    const hit = s.data?.results?.[0];
    if (!hit) return { ...out, status: s.ok ? 'ok' : failStatus(s), summary: s.data?.error_message || s.data?.status || (s.ok ? 'Организация не найдена на Google Картах' : failText(s)), data: {} };
    const det = await http(`${base}/place/details/json?place_id=${hit.place_id}&fields=rating,user_ratings_total,reviews,formatted_address,formatted_phone_number,url&language=ru&key=${encodeURIComponent(key)}`);
    const r = det.data?.result || hit;
    const reviews = (r.reviews || []).map(x => ({ author: x.author_name, rating: x.rating, text: x.text, url: x.author_url, created_at: x.relative_time_description }));
    return { ...out, status: 'ok', summary: `Рейтинг ${r.rating ?? '—'}${r.user_ratings_total ? ` · ${r.user_ratings_total} отзывов` : ''}${r.formatted_address ? ' · ' + r.formatted_address : ''}`, data: { card: { name: hit.name, address: r.formatted_address, phone: r.formatted_phone_number, url: r.url, rating: r.rating ?? null, count: r.user_ratings_total ?? 0 }, reviews } };
  }

  async function srcGoogle({ name, city }) {
    const key = getSetting('GOOGLE_PLACES_KEY');
    const out = { source: 'google', title: 'Google Карты', links: linksFor({ name }) };
    if (!key) return { ...out, status: 'skipped', summary: 'Не задан ключ Google Places API — отзывы по ссылке', data: {} };
    const base = srcUrl('GOOGLE_API_URL');
    const q = [name, city].filter(Boolean).join(' ');
    if (/maps\.googleapis\.com/.test(base) || /\/maps\/api\/?$/.test(base)) return srcGoogleLegacy(out, q, key, base);
    const r = await http(`${base}/places:searchText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': GOOGLE_FIELDS },
      body: JSON.stringify({ textQuery: q, languageCode: 'ru', maxResultCount: 5 }),
    });
    const hit = r.data?.places?.[0];
    if (!hit) {
      const vendor = r.data?.error?.message;
      return { ...out, status: r.ok ? 'ok' : failStatus(r), summary: r.ok ? (vendor || 'Организация не найдена на Google Картах') : failText(r) + (vendor ? ' Ответ источника: ' + vendor : ''), data: {} };
    }
    const reviews = (hit.reviews || []).map(x => ({ author: x.author?.displayName, rating: x.rating, text: x.text?.text, url: hit.googleMapsUri, created_at: x.relativePublishTimeDescription }));
    return { ...out, status: 'ok', summary: `Рейтинг ${hit.rating ?? '—'}${hit.userRatingCount ? ` · ${hit.userRatingCount} отзывов` : ''}${hit.formattedAddress ? ' · ' + hit.formattedAddress : ''}`, data: { card: { name: hit.displayName?.text || name, address: hit.formattedAddress, phone: hit.nationalPhoneNumber, url: hit.googleMapsUri, rating: hit.rating ?? null, count: hit.userRatingCount ?? 0 }, reviews } };
  }

  async function src2gis({ name, city }) {
    const key = getSetting('TWOGIS_KEY');
    const out = { source: '2gis', title: '2ГИС', links: linksFor({ name }) };
    if (!key) return { ...out, status: 'skipped', summary: 'Не задан ключ 2GIS API — рейтинг по ссылке', data: {} };
    // type=branch — искать только организации (филиалы), а не улицы и дома.
    // Город остаётся в тексте запроса: без геоограничения 2ГИС требует указывать его в q.
    const res = await http(`${srcUrl('TWOGIS_API_URL')}/items?q=${encodeURIComponent([name, city].filter(Boolean).join(' '))}&type=branch&locale=ru_RU&fields=items.reviews,items.address,items.contact_groups&key=${encodeURIComponent(key)}`);
    const item = res.data?.result?.items?.[0];
    if (!item) {
      const vendor = res.data?.meta?.error?.message;
      return { ...out, status: res.ok ? 'ok' : failStatus(res), summary: res.ok ? (vendor || 'Организация не найдена в 2ГИС') : failText(res) + (vendor ? ' Ответ источника: ' + vendor : ''), data: {} };
    }
    const rv = item.reviews || {};
    return { ...out, status: 'ok', summary: `Рейтинг ${rv.general_rating ?? rv.org_rating ?? '—'}${rv.general_review_count || rv.org_review_count ? ` · ${rv.general_review_count || rv.org_review_count} отзывов` : ''}`, data: { card: { name: item.name, address: item.address_name, rating: rv.general_rating ?? rv.org_rating ?? null, count: rv.general_review_count ?? rv.org_review_count ?? 0 } } };
  }

  async function srcYandex({ name, city }) {
    const key = getSetting('YANDEX_API_KEY');
    const out = { source: 'yandex', title: 'Яндекс Карты', links: linksFor({ name }) };
    if (!key) return { ...out, status: 'skipped', summary: 'Не задан ключ Яндекс Геопоиска — карточка по ссылке', data: {} };
    const res = await http(`${srcUrl('YANDEX_API_URL')}?apikey=${encodeURIComponent(key)}&text=${encodeURIComponent([name, city].filter(Boolean).join(' '))}&type=biz&lang=ru_RU&results=3`);
    const f = res.data?.features?.[0];
    if (!f) {
      const vendor = res.data?.message;
      // 403 и 429 у Яндекса означают ключ или лимит, а не «данных нет»:
      // помечаем так же, как остальные источники
      return { ...out, status: res.ok ? 'ok' : failStatus(res), summary: res.ok ? (vendor || 'Организация не найдена на Яндекс Картах') : failText(res) + (vendor ? ' Ответ источника: ' + vendor : ''), data: {} };
    }
    const cm = f.properties?.CompanyMetaData || {};
    return { ...out, status: 'ok', summary: `${f.properties?.name || name}${cm.address ? ' · ' + cm.address : ''}`, data: { card: { name: f.properties?.name, address: cm.address, url: cm.url, phone: (cm.Phones || [])[0]?.formatted, rating: cm.rating ?? null, count: cm.reviews ?? 0 } } };
  }

  const RUNNERS = { rusprofile: srcRusprofile, fns: srcFns, fedresurs: srcFedresurs, fssp: srcFssp, kad: srcKad, google: srcGoogle, '2gis': src2gis, yandex: srcYandex };

  // ─────────────────────────── оценка риска ───────────────────────────
  function buildReport(comp, results, { ourPrices = [], competitorRows = [], findings = [] } = {}) {
    const by = k => results.find(r => r.source === k)?.data || {};
    const fnsCard = by('fns').card || {};
    const rusCard = by('rusprofile').card || {};
    const kad = by('kad');
    const fed = by('fedresurs');
    const g = by('google').card, t = by('2gis').card, y = by('yandex').card;
    const factors = [];
    const add = (type, text, weight, source) => factors.push({ type, text, weight, source });

    const status = String(fnsCard.status || rusCard.status || '');
    if (/недейств|прекращ|ликвидац|банкрот/i.test(status)) add('risk', `Статус компании: ${status}`, 30, 'fns');
    if ((fed.cases || []).length) add('risk', `Есть записи в реестре банкротств: ${(fed.cases || []).length}`, 40, 'fedresurs');
    // Долги у приставов в риск-оценке не участвуют: официальный API ФССП закрыт
    // с марта 2022 года, данных нет. Придумывать фактор «долгов нет» по пустому
    // ответу нельзя — менеджер принял бы это за проверенную надёжность.
    if (money(fnsCard.arrears) > 0) add('risk', `Налоговая недоимка: ${money(fnsCard.arrears).toLocaleString('ru-RU')} ₽`, 18, 'fns');
    if (fnsCard.invalid) add('risk', 'В ЕГРЮЛ внесена запись о недостоверных сведениях', 15, 'fns');
    // Ручные находки: банк данных ФССП, «Связи» на Rusprofile и отзывы на Авито
    // автоматически не отдаются (API закрыт, сайт закрыт от роботов, данные за
    // платным доступом). Без записи такая проверка испарялась: менеджер посмотрел
    // и забыл, а отчёт продолжал показывать прочерк.
    for (const f of findings) {
      const n = Number(f.amount) || 0;
      const what = String(f.title || '').trim();
      if (f.kind === 'долги' && n > 0) add('risk', `Долги у приставов (записано вручную): ${Math.round(n).toLocaleString('ru-RU')} ₽${what ? ' — ' + what : ''}`, 18, 'manual');
      else if (f.kind === 'суды' && n > 0) add('risk', `Судебные дела (записано вручную): ${Math.round(n)}${what ? ' — ' + what : ''}`, n >= 10 ? 15 : 8, 'manual');
      else if (f.kind === 'связи') add('info', `Связанные организации (записано вручную): ${what || f.note || '—'}`, 0, 'manual');
      else if (what || f.note) add('info', `${f.kind || 'Прочее'}: ${what || f.note}`, 0, 'manual');
    }

    const courts = kad.total || 0;
    if (courts >= 10) add('risk', `Много арбитражных дел: ${courts}`, 15, 'kad');
    else if (courts >= 3) add('risk', `Арбитражные дела: ${courts}`, 8, 'kad');
    else if (courts === 0 && results.find(r => r.source === 'kad')?.status === 'ok') add('plus', 'Арбитражных дел нет', -5, 'kad');
    if (fnsCard.director) add('info', `Руководитель: ${fnsCard.director}`, 0, 'fns');
    if (fnsCard.regDate || rusCard.status) add('info', `Регистрация: ${fnsCard.regDate || '—'}${fnsCard.region ? ' · ' + fnsCard.region : ''}`, 0, 'fns');

    const ratings = [g?.rating, t?.rating, y?.rating].filter(v => typeof v === 'number');
    const counts = [g?.count, t?.count, y?.count].map(n => money(n)); const totalReviews = counts.reduce((a, b) => a + b, 0);
    const avgRating = ratings.length ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length * 10) / 10 : null;
    if (avgRating !== null) {
      if (avgRating < 3.5 && totalReviews >= 5) add('plus', `Слабая репутация: средний рейтинг ${avgRating} из 5 (${totalReviews} отзывов)`, -10, 'reviews');
      else if (avgRating >= 4.5) add('risk', `Сильная репутация: ${avgRating} из 5 (${totalReviews} отзывов) — конкурент хорошо держит клиентов`, 8, 'reviews');
      else add('info', `Средний рейтинг по картам: ${avgRating} из 5`, 0, 'reviews');
    } else if (results.some(r => r.kind === 'reviews' && r.status === 'ok')) add('info', 'Рейтингов на картах не найдено', 0, 'reviews');

    // цены
    let pricing = null;
    if (ourPrices.length && competitorRows.length) {
      const map = new Map(competitorRows.map(r => [norm(r.item), r]));
      // сначала точное совпадение названия, затем самое похожее из остальных
      const pair = item => {
        const exact = map.get(norm(item));
        if (exact) return exact;
        let hit = null, best = 0;
        for (const r of competitorRows) { const sc = nameScore(item, r.item); if (sc >= MATCH_MIN && sc > best) { best = sc; hit = r } }
        return hit;
      };
      const pairs = ourPrices.map(o => { const c = pair(o.item); return c ? { item: o.item, ours: money(o.price), theirs: money(c.price) } : null }).filter(Boolean);
      if (pairs.length) {
        const diffs = pairs.map(p => (p.theirs - p.ours) / (p.ours || 1) * 100);
        const avg = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
        pricing = { pairs, avgDiff: avg, cheaper: diffs.filter(d => d < 0).length, expensive: diffs.filter(d => d > 0).length, ourSum: pairs.reduce((a, p) => a + p.ours, 0), theirSum: pairs.reduce((a, p) => a + p.theirs, 0) };
        if (avg <= -5) add('plus', `Цены конкурента в среднем на ${Math.abs(avg)}% ниже наших — готовьте обоснование ценности`, -5, 'pricing');
        if (avg >= 5) add('plus', `Цены конкурента в среднем на ${avg}% выше наших — покажите смету и выиграете по цене`, -8, 'pricing');
      }
    }

    const dataQuality = results.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a }, { ok: 0, skipped: 0, blocked: 0, error: 0 });
    const hasAnyData = results.some(r => r.status === 'ok' && Object.keys(r.data || {}).length);
    let score = clamp(factors.filter(f => f.type !== 'info').reduce((a, f) => a + f.weight, 0) + 20, 0, 100);
    const riskFactors = factors.filter(f => f.type === 'risk');
    const verdicts = [];
    if (!hasAnyData) verdicts.push('Данных пока мало: ни один источник не отдал информацию автоматически. Задайте ключи в Настройках (ФНС, Google, 2ГИС, Яндекс) или внесите сведения вручную — отзывы и прайс можно добавить прямо в карточке');
    if (score >= 75) verdicts.push('Слабый конкурент: вероятны сложности с исполнением и гарантиями');
    else if (score >= 50) verdicts.push('Конкурент с заметными рисками — акцентируйте надёжность и договор');
    else if (score >= 25) verdicts.push('Относительно стабильный конкурент — конкурируйте сервисом и ценой');
    else verdicts.push('Аккуратный конкурент: ищите отличия в скорости, материалах и гарантии');
    if (riskFactors.some(f => f.source === 'fedresurs')) verdicts.push('Есть записи в реестре банкротств — клиенту это важно знать при выборе подрядчика');
    if (avgRating !== null && avgRating < 4) verdicts.push('Низкие оценки на картах — показывайте отзывы наших клиентов');
    if (pricing?.avgDiff >= 5) verdicts.push(`Наши цены ниже на ${pricing.avgDiff}% по сопоставимым позициям — сравнение в пользу нас`);

      const talking = factors.filter(f => f.type === 'plus' || f.type === 'risk').slice(0, 6).map(f => f.type === 'risk' ? `Аргумент: ${f.text} — используйте в переговорах` : `Плюс: ${f.text} — усильте преимуществом сервиса`);
    const lines = [];
    if (pricing) lines.push(`Средняя разница цен: ${pricing.avgDiff > 0 ? '+' : ''}${pricing.avgDiff}% · дороже у конкурента в ${pricing.expensive} поз., дешевле в ${pricing.cheaper} поз.`);
    lines.push(`Проверено источников: ${results.filter(r => r.status === 'ok').length} из ${results.length} (без ключей: ${results.filter(r => r.status === 'skipped').length})`);
    const innKnown = comp.inn || fnsCard.inn || rusCard.inn || '';
    const ogrnKnown = comp.ogrn || fnsCard.ogrn || rusCard.ogrn || '';
    return { risk: score, noData: !hasAnyData, dataQuality, level: levelOf(score), color: levelColor(score), factors, verdict: verdicts.join('. ') + '.', talking_points: talking, pricing, reviews: { avgRating, totalReviews, sources: { google: g, '2gis': t, yandex: y } }, summary: lines, links: linksFor({ name: comp.name, inn: innKnown, ogrn: ogrnKnown, rpId: rusCard.rpId }), found: { inn: innKnown, ogrn: ogrnKnown, name: fnsCard.name || rusCard.name || comp.name, address: fnsCard.address || rusCard.address || g?.address || y?.address || '', director: fnsCard.director || '' } };
  }

  // ─────────────────────────── Excel / CSV ───────────────────────────
  function readZipEntries(buf) {
    const EOCD = 0x06054b50; let eocd = -1;
    for (let i = Math.max(0, buf.length - 65600); i <= buf.length - 22; i++) if (buf.readUInt32LE(i) === EOCD) { eocd = i; break }
    if (eocd < 0) throw new Error('Это не ZIP-контейнер (.xlsx) — используйте CSV или исправьте файл');
    let count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
    if (cdOff === 0xffffffff) { const loc = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06])); if (loc > 0) { count = Number(buf.readBigUInt64LE(loc + 32)); cdOff = Number(buf.readBigUInt64LE(loc + 48)); } }
    const entries = {}; let p = cdOff;
    for (let i = 0; i < count && p < buf.length; i++) {
      if (buf.readUInt32LE(p) !== 0x02014b50) break;
      const method = buf.readUInt16LE(p + 10), compSize = buf.readUInt32LE(p + 20);
      const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), localOff = buf.readUInt32LE(p + 42);
      const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
      const lNameLen = buf.readUInt16LE(localOff + 26), lExtraLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(start, start + compSize);
      try { entries[name] = method === 0 ? raw : zlib.inflateRawSync(raw) } catch { entries[name] = Buffer.alloc(0) }
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }
  const colIndex = ref => { const m = String(ref).match(/^([A-Z]+)/); let n = 0; for (const ch of m ? m[1] : 'A') n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1 };
  const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
  function readXlsx(buf) {
    const z = readZipEntries(buf);
    const shared = (z['xl/sharedStrings.xml'] ? z['xl/sharedStrings.xml'].toString('utf8').match(/<si>[\s\S]*?<\/si>/g) || [] : []).map(si => [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => unesc(m[1])).join(''));
    const sheetName = Object.keys(z).find(k => /^xl\/worksheets\/sheet1\.xml$/.test(k)) || Object.keys(z).find(k => /^xl\/worksheets\/.*\.xml$/.test(k));
    if (!sheetName) throw new Error('В файле .xlsx не найден лист');
    const xml = z[sheetName].toString('utf8');
    const rows = [];
    for (const rowXml of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []) {
      const row = [];
      for (const c of rowXml.match(/<c[^>]*\/>|<c[^>]*>[\s\S]*?<\/c>/g) || []) {
        const ref = (c.match(/r="([A-Z]+\d+)"/) || [])[1] || '';
        const t = (c.match(/ t="([^"]+)"/) || [])[1] || '';
        const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const inline = c.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
        let val = inline !== undefined ? unesc(inline) : v === undefined ? '' : (t === 's' ? (shared[Number(v)] ?? '') : unesc(v));
        if (ref) row[colIndex(ref)] = val; else row.push(val);
      }
      rows.push(row.map(x => x ?? ''));
    }
    return rows;
  }
  const splitCsvLine = line => { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++ } else q = !q } else if ((ch === ';' || ch === ',' || ch === '\t') && !q) { out.push(cur); cur = '' } else cur += ch } out.push(cur); return out.map(s => s.trim().replace(/^"|"$/g, '')) };
  function parseTable(text) {
    const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return { rows: [], header: [] };
    const delim = [';', '\t', ','].map(d => ({ d, n: lines[0].split(d).length })).sort((a, b) => b.n - a.n)[0].d;
    const grid = lines.map(l => delim === '\t' ? l.split('\t').map(s => s.trim()) : splitCsvLine(l));
    return { header: grid[0], grid };
  }
  const COLS = {
    item: /наимен|позиц|услуг|товар|назван|номенклат|работ/i, price: /цена|стоим|прайс|price|₽|руб/i,
    unit: /ед\b|единиц|unit|м2|м²/i, sku: /артикул|sku|код/i, note: /налич|остаток|склад|загруз|срок|коммент|примеч|note/i,
  };
  function rowsToPrices(parsed, sourceName) {
    const { header, grid } = parsed;
    const idx = {}; header.forEach((h, i) => { for (const [k, re] of Object.entries(COLS)) if (idx[k] === undefined && re.test(h)) idx[k] = i });
    const hasHeader = idx.item !== undefined || idx.price !== undefined;
    const body = hasHeader ? grid.slice(1) : grid;
    const out = [];
    for (const r of body) {
      const pickv = k => (idx[k] !== undefined ? String(r[idx[k]] ?? '').trim() : '');
      const item = pickv('item') || String(r[0] ?? '').trim();
      const rawPrice = pickv('price') || String(r[1] ?? '').trim();
      const price = money(String(rawPrice).replace(/\s|₽|руб\.?/gi, '').replace(',', '.'));
      if (!item || !price) continue;
      out.push({ item, price, unit: pickv('unit') || 'шт', sku: pickv('sku'), note: pickv('note') || (hasHeader ? '' : r.slice(2).join(' ').trim()), source_name: sourceName });
    }
    return out;
  }
  function importBuffer(buf, sourceName) {
    const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
    if (isZip) { const grid = readXlsx(buf); return rowsToPrices({ header: grid[0] || [], grid }, sourceName); }
    return rowsToPrices(parseTable(buf.toString('utf8')), sourceName);
  }

  async function fetchTable(url) {
    const res = await http(url, {}, 20000);
    if (!res.ok) throw new Error(`Не удалось скачать таблицу: HTTP ${res.status || res.error}`);
    if (res.error) throw new Error(res.error);
    const isSheet = /docs\.google\.com\/spreadsheets/.test(url) && !/output=csv|format=csv/.test(url);
    const body = isSheet ? (await http(url.replace(/\/edit.*$/, '/export?format=csv'), {}, 20000)).text : res.text;
    return body;
  }

  // ─────────────────────────── проверка конкурента ───────────────────────────
  async function runCheck(comp, opts = {}) {
    const sources = opts.sources?.length ? opts.sources : SOURCE_DEFS.filter(s => ['rusprofile', 'fns', 'fedresurs', 'fssp', 'kad', 'google', '2gis', 'yandex'].includes(s.key)).map(s => s.key);
    const results = await Promise.all(sources.map(async key => {
      const runner = RUNNERS[key] || (async () => ({ source: key, title: key, status: 'error', summary: 'неизвестный источник', data: {}, links: [] }));
      const def = SOURCE_DEFS.find(s => s.key === key) || { kind: 'card' };
      try { const r = await runner({ name: comp.name, inn: comp.inn, ogrn: comp.ogrn, city: comp.city }); return { kind: def.kind, title: def.name, ...r } }
      catch (e) { return { source: key, title: def.name, kind: def.kind, status: 'error', summary: e.message, data: {}, links: linksFor(comp) } }
    }));
    // отзывы из источников -> в таблицу отзывов
    for (const r of results) for (const rv of (r.data?.reviews || [])) if (rv.text) {
      const exists = db.prepare('SELECT id FROM reviews WHERE competitor_id=? AND source=? AND text=?').get(comp.id, r.source, rv.text);
      if (!exists) db.prepare('INSERT INTO reviews(competitor_id,source,rating,text,author,url) VALUES(?,?,?,?,?,?)').run(comp.id, r.source, rv.rating ?? null, rv.text, rv.author || '', rv.url || '');
    }
    // прайс конкурента из его таблицы
    let competitorRows = db.prepare("SELECT * FROM price_rows WHERE competitor_id=? AND scope='competitor'").all(comp.id);
    if (comp.price_url && opts.pullTable !== false) {
      try {
        const text = await fetchTable(comp.price_url);
        const rows = importBuffer(Buffer.from(text), 'таблица конкурента');
        if (rows.length) {
          db.prepare("DELETE FROM price_rows WHERE competitor_id=? AND scope='competitor'").run(comp.id);
          const ins = db.prepare('INSERT INTO price_rows(competitor_id,scope,item,price,unit,sku,note,source_name) VALUES(?,?,?,?,?,?,?,?)');
          rows.forEach(r => ins.run(comp.id, 'competitor', r.item, r.price, r.unit, r.sku, r.note, r.source_name));
          competitorRows = db.prepare("SELECT * FROM price_rows WHERE competitor_id=? AND scope='competitor'").all(comp.id);
          results.push({ source: 'prices', title: 'Таблица конкурента', kind: 'pricing', status: 'ok', summary: `Загружено позиций: ${rows.length} из ${comp.price_url}`, data: { count: rows.length }, links: [{ label: 'Открыть таблицу', url: comp.price_url }] });
        }
      } catch (e) { results.push({ source: 'prices', title: 'Таблица конкурента', kind: 'pricing', status: 'error', summary: e.message, data: {}, links: [{ label: 'Открыть таблицу', url: comp.price_url }] }) }
    }
    // «наши цены» — это каталог: позиции без цены в сравнении не участвуют
    const ourPrices = catalogPrices(db, { pricedOnly: true });
    const findings = db.prepare('SELECT * FROM competitor_findings WHERE competitor_id=? ORDER BY id DESC').all(comp.id);
    const report = buildReport(comp, results, { ourPrices, competitorRows, findings });
    // сохранение
    const prev = db.prepare('SELECT * FROM competitor_reports WHERE competitor_id=? ORDER BY id DESC LIMIT 1').get(comp.id);
    db.prepare('DELETE FROM competitor_checks WHERE competitor_id=?').run(comp.id);
    const insChk = db.prepare('INSERT INTO competitor_checks(competitor_id,source,status,summary,payload) VALUES(?,?,?,?,?)');
    results.forEach(r => insChk.run(comp.id, r.source, r.status, r.summary, JSON.stringify(r)));
    const insRep = db.prepare('INSERT INTO competitor_reports(competitor_id,risk,level,verdict,payload) VALUES(?,?,?,?,?)');
    const level = report.level;
    insRep.run(comp.id, report.risk, level, report.verdict, JSON.stringify(report));
    const changes = [];
    if (prev) {
      if (prev.risk !== report.risk) changes.push(`Риск: ${prev.risk} → ${report.risk}`);
      const prevPayload = JSON.parse(prev.payload || '{}');
      const pd = (prevPayload.factors || []).filter(f => f.type === 'risk').length, nd = report.factors.filter(f => f.type === 'risk').length;
      if (pd !== nd) changes.push(`Негативных факторов: ${pd} → ${nd}`);
    }
    log(`Проверка конкурента «${comp.name}»: риск ${report.risk} (${level})${changes.length ? ' · ' + changes.join(', ') : ''}`, 'competitors', comp.id);
    broadcast('change', { table: 'competitors', id: comp.id });
    return { report, results, changes, history: db.prepare('SELECT id,risk,level,verdict,created_at FROM competitor_reports WHERE competitor_id=? ORDER BY id DESC LIMIT 12').all(comp.id) };
  }

  function importPriceRows(b, defaultCompId) {
    const scope = b.scope === 'ours' ? 'ours' : 'competitor';
    let rows = [];
    if (b.base64) rows = importBuffer(Buffer.from(String(b.base64).split(',').pop(), 'base64'), b.filename || 'загруженный файл');
    else if (b.csv || b.text) rows = rowsToPrices(parseTable(b.csv || b.text), b.filename || 'вставленная таблица');
    if (!rows.length) return { error: 'Не удалось распознать ни одной строки. Нужны колонки «наименование» и «цена».' };
    if (scope === 'ours') {
      // наш прайс-лист = каталог: обновляем цены у знакомых позиций, новые добавляем.
      // mode='replace' — человек сам попросил заменить прайс целиком: лишнее уходит в архив.
      const mode = b.mode === 'replace' ? 'replace' : 'merge';
      const stat = catalogUpsert(db, rows, { mode });
      return { imported: rows.length, scope, mode, ...stat, rows: catalogPrices(db) };
    }
    const compId = scope === 'ours' ? null : (defaultCompId ?? (b.competitor_id ? Number(b.competitor_id) : null));
    if (scope === 'competitor' && !compId) return { error: 'Не указан конкурент' };
    // замена таблицы — в транзакции: упало на середине, старый прайс цел
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM price_rows WHERE scope=? AND IFNULL(competitor_id,0)=IFNULL(?,0)').run(scope, compId);
      const ins = db.prepare('INSERT INTO price_rows(competitor_id,scope,item,price,unit,sku,note,source_name) VALUES(?,?,?,?,?,?,?,?)');
      rows.forEach(r => ins.run(compId, scope, r.item, r.price, r.unit || 'шт', r.sku || '', r.note || '', r.source_name || b.filename || 'файл'));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e }
    return { imported: rows.length, scope, rows: db.prepare('SELECT * FROM price_rows WHERE scope=? AND IFNULL(competitor_id,0)=IFNULL(?,0)').all(scope, compId) };
  }

  // ─────────────────────────── HTTP ───────────────────────────
  const competitorFull = id => {
    const comp = db.prepare('SELECT * FROM competitors WHERE id=?').get(id); if (!comp) return null;
    const report = db.prepare('SELECT * FROM competitor_reports WHERE competitor_id=? ORDER BY id DESC LIMIT 1').get(id);
    return {
      ...comp,
      report: report ? { id: report.id, risk: report.risk, level: report.level, verdict: report.verdict, created_at: report.created_at, ...JSON.parse(report.payload || '{}') } : null,
      checks: db.prepare('SELECT source,status,summary,checked_at,payload FROM competitor_checks WHERE competitor_id=?').all(id).map(c => ({ ...c, data: (() => { try { return JSON.parse(c.payload || '{}').data || {} } catch { return {} } })(), links: (() => { try { return JSON.parse(c.payload || '{}').links || [] } catch { return [] } })(), title: (() => { try { return JSON.parse(c.payload || '{}').title || c.source } catch { return c.source } })(), payload: undefined })),
      reviews: db.prepare('SELECT * FROM reviews WHERE competitor_id=? ORDER BY id DESC').all(id),
      findings: db.prepare('SELECT * FROM competitor_findings WHERE competitor_id=? ORDER BY id DESC').all(id),
      prices: db.prepare("SELECT * FROM price_rows WHERE competitor_id=? AND scope='competitor' ORDER BY item").all(id),
      history: db.prepare('SELECT id,risk,level,verdict,created_at FROM competitor_reports WHERE competitor_id=? ORDER BY id DESC LIMIT 12').all(id),
    };
  };

  // чем закончилась загрузка прайса: запись в журнал и сигнал интерфейсу обновиться
  function finishImport(out, compId, user) {
    if (out.scope === 'ours') {
      const parts = [`добавлено ${out.added}`, `обновлено ${out.updated}`];
      if (out.archived) parts.push(`в архив ${out.archived}`);
      log(`Прайс-лист (каталог) загружен: ${out.imported} позиций — ${parts.join(', ')}`, 'products', null, user.name);
      broadcast('change', { table: 'products' });
    } else {
      log(`Импорт прайса конкурента: ${out.imported} позиций`, 'competitors', compId, user.name);
      broadcast('change', { table: 'price_rows', id: compId });
    }
    return out;
  }

  async function handle(req, res, { p, u, user }) {
    const admin = async () => { if (user.role !== 'admin') { json(res, 403, { error: 'Только для администратора' }); return false } return true };
    // список источников и их статус
    if (p === '/api/competitor-sources') {
      if (req.method === 'GET') return json(res, 200, {
        sources: SOURCE_DEFS.map(s => ({ ...s, configured: s.needs.every(k => !!getSetting(k)), url: URL_OF[s.key] ? srcUrl(URL_OF[s.key]) : '' })),
        keys: { FNS_API_KEY: !!getSetting('FNS_API_KEY'), GOOGLE_PLACES_KEY: !!getSetting('GOOGLE_PLACES_KEY'), TWOGIS_KEY: !!getSetting('TWOGIS_KEY'), YANDEX_API_KEY: !!getSetting('YANDEX_API_KEY') },
        timeout: getSetting('COMPETITOR_TIMEOUT_MS', '12000'),
        urls: Object.fromEntries(Object.keys(SOURCE_URL_DEFAULTS).map(k => [k, srcUrl(k)])),
      });
      if (req.method === 'PUT') {
      if (!await admin()) return;
      const b = await readBody(req);
      // только известные ключи: адреса источников, ключи и таймаут
      const allowed = [...Object.keys(SOURCE_URL_DEFAULTS), 'FNS_API_KEY', 'GOOGLE_PLACES_KEY', 'TWOGIS_KEY', 'YANDEX_API_KEY', 'COMPETITOR_TIMEOUT_MS'];
      for (const k of allowed) if (b[k] !== undefined && !String(b[k]).includes('•')) setSetting(k, String(b[k]).slice(0, 512));
      return json(res, 200, { saved: true });
    }
    }
    // Диагностика источников: один запрос ко всем источникам с нейтральными данными.
    // Ничего не сохраняет — показывает, кто отвечает, кто требует ключ, кто закрыт антиботом.
    if (p === '/api/competitor-sources/check' && req.method === 'POST') {
      if (!await admin()) return;
      const probe = { name: 'ПАО Сбербанк', inn: '7707083893', ogrn: '1027700132195', city: 'Москва' };
      const started = Date.now();
      const timed = (promise, ms) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`не ответил за ${Math.round(ms / 1000)} с`)), ms))]);
      const results = await Promise.all(SOURCE_DEFS.map(async def => {
        const t0 = Date.now();
        const needsKey = def.needs.length > 0;
        const keySet = def.needs.every(k => !!getSetting(k));
        try {
          const r = await timed(RUNNERS[def.key](probe), 20000);
          return { key: def.key, name: def.name, kind: def.kind, status: r.status, summary: r.summary, ms: Date.now() - t0, needsKey, keySet };
        } catch (e) {
          return { key: def.key, name: def.name, kind: def.kind, status: 'error', summary: e.message, ms: Date.now() - t0, needsKey, keySet };
        }
      }));
      return json(res, 200, { results, ms: Date.now() - started, probe: probe.name });
    }
    if (p === '/api/competitors') {
      if (req.method === 'GET') {
        const list = db.prepare('SELECT * FROM competitors ORDER BY id DESC').all();
        return json(res, 200, list.map(c => {
          const r = db.prepare('SELECT id,risk,level,verdict,created_at FROM competitor_reports WHERE competitor_id=? ORDER BY id DESC LIMIT 1').get(c.id);
          const cnt = db.prepare('SELECT COUNT(*) n, AVG(rating) a FROM reviews WHERE competitor_id=? AND rating IS NOT NULL').get(c.id);
          const prices = db.prepare('SELECT COUNT(*) n FROM price_rows WHERE competitor_id=?').get(c.id).n;
          return { ...c, risk: r?.risk ?? null, level: r?.level ?? null, verdict: r?.verdict ?? '', checked_at: r?.created_at ?? null, reviews: cnt.n, avg_rating: cnt.a ? Math.round(cnt.a * 10) / 10 : null, prices };
        }));
      }
      if (req.method === 'POST') { const b = await readBody(req); const r = db.prepare('INSERT INTO competitors(name,inn,ogrn,city,website,phone,notes,price_url) VALUES(?,?,?,?,?,?,?,?)').run(b.name || 'Конкурент', digits(b.inn) || null, digits(b.ogrn) || null, b.city || '', b.website || '', b.phone || '', b.notes || '', b.price_url || ''); log(`Добавлен конкурент: ${b.name}`, 'competitors', Number(r.lastInsertRowid), user.name); return json(res, 201, { id: r.lastInsertRowid }); }
    }
    // Ручные находки: то, что менеджер посмотрел сам по ссылкам и записал.
    const mFind = p.match(/^\/api\/competitors\/(\d+)\/findings(?:\/(\d+))?$/);
    if (mFind) {
      const id = Number(mFind[1]);
      if (!db.prepare('SELECT id FROM competitors WHERE id=?').get(id)) return json(res, 404, { error: 'Конкурент не найден' });
      const list = () => db.prepare('SELECT * FROM competitor_findings WHERE competitor_id=? ORDER BY id DESC').all(id);
      if (req.method === 'GET') return json(res, 200, list());
      if (req.method === 'POST') {
        const b = await readBody(req);
        const KINDS = ['долги', 'суды', 'связи', 'прочее'];
        const kind = KINDS.includes(String(b.kind || '').trim().toLowerCase()) ? String(b.kind).trim().toLowerCase() : 'прочее';
        const title = String(b.title || '').slice(0, 200);
        const note = String(b.note || '').slice(0, 2000);
        const amount = Number(b.amount) || 0;
        const url = String(b.source_url || '').trim();
        if (!title && !note && !(amount > 0)) return json(res, 400, { error: 'Пустая находка: напишите, что нашли, или укажите сумму либо число дел' });
        if (url && !/^https?:\/\//i.test(url)) return json(res, 400, { error: 'Ссылка на источник должна начинаться с http:// или https://' });
        if (amount < 0 || amount > 1e12) return json(res, 400, { error: 'Сумма или число дел выглядят неправдоподобно' });
        db.prepare('INSERT INTO competitor_findings(competitor_id,kind,title,amount,note,source_url,author) VALUES(?,?,?,?,?,?,?)')
          .run(id, kind, title, amount > 0 ? amount : null, note, url.slice(0, 500), user?.name || '');
        return json(res, 201, { findings: list() });
      }
      if (req.method === 'DELETE' && mFind[2]) {
        const r = db.prepare('DELETE FROM competitor_findings WHERE id=? AND competitor_id=?').run(Number(mFind[2]), id);
        if (!r.changes) return json(res, 404, { error: 'Находка не найдена' });
        return json(res, 200, { deleted: true, findings: list() });
      }
      return json(res, 405, { error: 'Метод не поддерживается' });
    }
    const mId = p.match(/^\/api\/competitors\/(\d+)(?:\/(check|reviews|prices|report))?$/);
    if (mId) {
      const id = Number(mId[1]), action = mId[2];
      const comp = db.prepare('SELECT * FROM competitors WHERE id=?').get(id);
      if (!comp) return json(res, 404, { error: 'Конкурент не найден' });
      if (!action && req.method === 'GET') return json(res, 200, competitorFull(id));
      if (!action && req.method === 'PATCH') { const b = await readBody(req); const f = ['name', 'inn', 'ogrn', 'city', 'website', 'phone', 'notes', 'price_url']; const ks = Object.keys(b).filter(k => f.includes(k)); if (ks.length) db.prepare(`UPDATE competitors SET ${ks.map(k => k + '=?')} WHERE id=?`).run(...ks.map(k => b[k]), id); return json(res, 200, competitorFull(id)); }
      if (!action && req.method === 'DELETE') { db.prepare('DELETE FROM competitors WHERE id=?').run(id); return json(res, 200, { deleted: true }); }
      if (action === 'report' && req.method === 'GET') return json(res, 200, competitorFull(id));
      if (action === 'check' && req.method === 'POST') { const b = await readBody(req).catch(() => ({})); if (b.inn && !comp.inn) { db.prepare('UPDATE competitors SET inn=? WHERE id=?').run(digits(b.inn), id); comp.inn = digits(b.inn) } const out = await runCheck(comp, { sources: b.sources, pullTable: b.pullTable !== false }); return json(res, 200, { ...out, competitor: competitorFull(id) }); }
      if (action === 'reviews' && req.method === 'POST') { const b = await readBody(req); const r = db.prepare('INSERT INTO reviews(competitor_id,source,rating,text,author,url) VALUES(?,?,?,?,?,?)').run(id, b.source || 'вручную', b.rating ?? null, b.text || '', b.author || user.name, b.url || ''); return json(res, 201, { id: r.lastInsertRowid }); }
      if (action === 'prices' && req.method === 'POST') {
        const b = await readBody(req);
        // наш прайс-лист — это каталог: общий справочник, меняет его только администратор
        if (b.scope === 'ours' && user.role !== 'admin') return json(res, 403, { error: 'Прайс-лист меняет только администратор. Позицию, которой нет в каталоге, можно добавить прямо в сделку.' });
        // «Текст / ссылки»: подтягиваем таблицу по URL или разбираем вставленный текст
        if (b.url && !b.base64 && !b.csv && !b.text) {
          try { b.csv = await fetchTable(String(b.url)); } catch (e) { return json(res, 400, { error: e.message }) }
        }
        const out = importPriceRows(b, id);
        if (out.error) return json(res, 400, { error: out.error });
        return json(res, 201, finishImport(out, id, user));
      }
    }
    if (p === '/api/reviews' && req.method === 'POST') { const b = await readBody(req); if (!b.competitor_id) return json(res, 400, { error: 'Не указан конкурент' }); const r = db.prepare('INSERT INTO reviews(competitor_id,source,rating,text,author,url) VALUES(?,?,?,?,?,?)').run(b.competitor_id, b.source || 'вручную', b.rating ?? null, b.text || '', b.author || user.name, b.url || ''); return json(res, 201, { id: r.lastInsertRowid }); }
    const mRev = p.match(/^\/api\/reviews\/(\d+)$/);
    if (mRev && req.method === 'DELETE') { db.prepare('DELETE FROM reviews WHERE id=?').run(mRev[1]); return json(res, 200, { deleted: true }); }
    if ((p === '/api/prices' || p === '/api/prices/ours') && req.method === 'POST') {
      const b = await readBody(req);
      if (p === '/api/prices/ours') b.scope = 'ours';
      if (b.scope === 'ours' && user.role !== 'admin') return json(res, 403, { error: 'Прайс-лист меняет только администратор. Позицию, которой нет в каталоге, можно добавить прямо в сделку.' });
      if (b.url && !b.base64 && !b.csv && !b.text) {
        try { b.csv = await fetchTable(String(b.url)); } catch (e) { return json(res, 400, { error: e.message }) }
      }
      const out = importPriceRows(b, null);
      if (out.error) return json(res, 400, { error: out.error });
      return json(res, 201, finishImport(out, null, user));
    }
    if (p === '/api/prices/export' && req.method === 'GET') {
      // «сгрузить» прайс обратно в таблицу: колонки те же, что при загрузке,
      // поэтому файл можно поправить в Excel и загрузить снова
      const scope = u.searchParams.get('scope') === 'competitor' ? 'competitor' : 'ours';
      const compId = scope === 'competitor' ? Number(u.searchParams.get('competitor') || 0) : null;
      const rows = scope === 'ours'
        ? catalogPrices(db)
        : db.prepare('SELECT item,price,unit,sku,note FROM price_rows WHERE scope=? AND competitor_id=? ORDER BY item').all(scope, compId);
      const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = ['Наименование;Цена;Ед;Артикул;Примечание', ...rows.map(r => [r.item, r.price, r.unit, r.sku, r.note].map(q).join(';'))].join('\r\n');
      const name = scope === 'ours' ? 'our-prices.csv' : `competitor-${compId || 'prices'}.csv`;
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename=${name}` });
      return res.end('\uFEFF' + csv);
    }
    if (p === '/api/prices' || (p === '/api/prices/ours' && req.method === 'GET')) {
      const scope = p === '/api/prices/ours' ? 'ours' : (u.searchParams.get('scope') || 'ours');
      const compId = u.searchParams.get('competitor');
      const rows = scope === 'ours'
        ? catalogPrices(db, { includeArchived: u.searchParams.get('all') === '1' })
        : db.prepare('SELECT * FROM price_rows WHERE scope=? AND competitor_id=? ORDER BY item').all(scope, compId || 0);
      return json(res, 200, { scope, rows, competitor_id: compId ? Number(compId) : null, source: scope === 'ours' ? 'catalog' : 'price_rows' });
    }
    if (p === '/api/competitors/find' && req.method === 'POST') {
      // «Пишем название конкурента» — ищем и сразу проверяем.
      // Интерфейс присылает query, старые вызовы — name; принимаем оба.
      const b = await readBody(req);
      const name = String(b.query || b.name || '').trim().slice(0, 200);
      if (!name) return json(res, 400, { error: 'Укажите название или ИНН конкурента' });
      const inn = digits(name).length >= 10 ? digits(name) : (digits(b.inn) || '');
      let comp = inn ? db.prepare('SELECT * FROM competitors WHERE inn=?').get(inn) : db.prepare('SELECT * FROM competitors WHERE lower(name)=lower(?)').get(name);
      let created = false;
      if (!comp) { const r = db.prepare('INSERT INTO competitors(name,inn,city,website) VALUES(?,?,?,?)').run(name.replace(/\s*ИНН\s*\d+.*/i, '').trim() || name, inn || null, b.city || '', b.website || ''); comp = db.prepare('SELECT * FROM competitors WHERE id=?').get(r.lastInsertRowid); created = true; log(`Новый конкурент для проверки: ${comp.name}`, 'competitors', comp.id, user.name); }
      else if (inn && !comp.inn) { db.prepare('UPDATE competitors SET inn=? WHERE id=?').run(inn, comp.id); comp.inn = inn }
      const out = await runCheck(comp, { sources: b.sources });
      return json(res, 200, { created, ...out, competitor: competitorFull(comp.id) });
    }
    return false;
  }


  return { handle, runCheck, linksFor, importBuffer, rowsToPrices, parseTable, readXlsx, buildReport, SOURCE_DEFS };
}
