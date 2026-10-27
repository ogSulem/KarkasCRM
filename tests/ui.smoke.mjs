// Smoke-тест интерфейса: реальный backend + SPA, отрисованная в jsdom.
// Требует jsdom (в рантайме проекта его нет):
//   npm i --prefix /tmp/jsdomtest jsdom
//   JSDOM_PATH=/tmp/jsdomtest/node_modules/jsdom/lib/api.js node --experimental-sqlite tests/ui.smoke.mjs
// Если jsdom не установлен — тест сообщает об этом и завершается успешно.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, accessSync, constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Версия из файла, а не вписанная в тест: повышение версии не должно ломать проверки.
const VERSION = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = await import('jsdom'));
} catch {
  if (process.env.JSDOM_PATH) { try { ({ JSDOM, VirtualConsole } = await import(process.env.JSDOM_PATH)) } catch {} }
}
if (!JSDOM) {
  console.log('jsdom не установлен — тест интерфейса пропущен.');
  console.log('   Установите и повторите:  npm i --prefix /tmp/jsdomtest jsdom');
  process.exit(0);
}

const PORT = 18079, BASE = `http://127.0.0.1:${PORT}`, DATA = '/tmp/karkas-ui-smoke';
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Убираем сервер, оставшийся от прерванного прошлого прогона: иначе порт занят,
// отвечает старый процесс со старыми данными и проверки падают на 409/«пользователь уже есть».
for (const pid of readdirSync('/proc').filter(d => /^\d+$/.test(d))) {
  if (+pid === process.pid) continue;
  try {
    const env = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
    if (env.includes('KARKAS_SMOKE_OWNER=ui')) process.kill(+pid, 'SIGKILL');
  } catch {}
}
await sleep(300);
rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['--experimental-sqlite', 'backend/src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), HOST: '127.0.0.1', SEED_MODE: 'off', KARKAS_SMOKE_OWNER: 'ui' }, stdio: 'ignore' });
let ready = false;
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/health')).ok) { ready = true; break } } catch {} await sleep(200) }
if (!ready) { console.error('Smoke-тест: сервер не запустился — порт ' + PORT + ' занят другим процессом.'); process.exit(1); }

const html = readFileSync(join(ROOT, 'frontend/public/index.html'), 'utf8');
const htmlClean = html.replace(/<script[^>]*><\/script>/g, '');
const appJsRaw = readFileSync(join(ROOT, 'frontend/public/app.js'), 'utf8');
const cssText = readFileSync(join(ROOT, 'frontend/public/style.css'), 'utf8');
const serverJsRaw = readFileSync(join(ROOT, 'backend/src/server.js'), 'utf8');
const competitorsJsRaw = readFileSync(join(ROOT, 'backend/src/competitors.js'), 'utf8');
const appJs = appJsRaw + `
window.__state = state;
Object.assign(window, {
  SKELETONS, toggleTheme, applyTheme, openPalette, closePalette, toggleSel, clearSel,
  siteFormCode, bulkApply, openContactCard, openDealCard, api, get token() { return token },
  icon, normalizeDue, taskDueMeta, isAscii, endSession, togglePass,
  toggleUserMenu, closeUserMenu, toggleTaskSelect, ICON_PATHS, msgHtml, channelOptions,
  uploadChatFile, toggleDeadChannels, checkHealth,
  sourceLabel, channelLabel, roleLabel, askConfirm, askInput, translit, SOURCE_LABELS, CHANNEL_LABELS, ROLE_LABELS,
  isoDate, todayISO, fmtDayMonth, kindStage, fld, grid2, formLegend, pushToast, notify, captureFocus, restoreFocus, PALETTE_ACTIONS,
  openMenu, closeMenu, contactsMoreMenu, openOurPrices, comparePrices, setBuiltinTab, BUILTIN_FIELDS, amAdmin, canEdit,
  ourPriceRows, filterOurPrices, toggleAutomation, openAutomation, noteRow, editNote, lockFormsForViewer, AUTO_TRIGGERS, AUTO_ACTIONS,
  busyButton, priceImportText,
  punyDecodeLabel, humanOrigin, wazzupHookUrl, wzAlive, wzState, wzTitle, closeConv,
  wzAccountLabel, nameFromUri, sendAccountFor, refreshSendAccount, WZ_CHAT_TRANSPORTS,
  setConvScope, convScopeList, convMine, convEmptyHtml, openNotifications,
  msgsHtml, dayLabel, saveDraft, loadDrafts, autoGrow, msgKey, showJumpNew, scrollChatBottom, chatScrolled,
  WZ_TRANSPORT_TO_CHAT, WZ_DEAD_STATES, WZ_CHAT_SET, WZ_TRANSPORTS, WZ_STATE_LABELS, wzTransportLabel,
  saveChannel, startConv, submitStartConv, scAddrHint, sendDoc, submitSendDoc,
  saveS3, uploadS3, s3line, cancelQueued
});`;
const pageErrors = [];
const vConsole = new VirtualConsole();
vConsole.on('jsdomError', e => pageErrors.push(String((e && e.message) || e)));
const dom = new JSDOM(htmlClean, { runScripts: 'dangerously', url: BASE + '/', pretendToBeVisual: true, virtualConsole: vConsole });
const { window } = dom;
window.addEventListener('error', e => pageErrors.push(String((e && e.message) || e)));
window.__token = '';
let inflight = 0; // сколько запросов приложения ещё не завершилось
window.fetch = async (url, opt) => {
  const full = String(url).startsWith('http') ? String(url) : BASE + String(url);
  inflight++;
  try {
    const r = await fetch(full, opt);
    if (r.status === 401 && window.__token) { const o = { ...opt, headers: { ...((opt || {}).headers || {}), Authorization: 'Bearer ' + window.__token } }; return await fetch(full, o) }
    return r;
  } finally { inflight-- }
};
window.EventSource = class { addEventListener() {} close() {} };
// Нативные confirm/prompt в продукте запрещены: любое обращение к ним — провал теста.
window.confirm = () => { throw new Error('native confirm() не должен использоваться'); };
window.prompt = () => { throw new Error('native prompt() не должен использоваться'); };
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
window.FileReader = class { readAsDataURL() { this.result = 'data:image/png;base64,' + PNG_B64; this.onload && this.onload() } };
window.eval(appJs);

const $ = s => window.document.querySelector(s);
const $$ = s => [...window.document.querySelectorAll(s)];
const checks = [];
const check = (name, cond, extra = '') => checks.push({ name, ok: !!cond, extra });
// Пауза в тесте — не «подождать 450 мс на глаз», а «дождаться, пока экран
// действительно дорисовал»: сначала не меньше запрошенного времени (его хватает
// дебаунсу поиска), затем пока не закончатся запросы к серверу и разметка
// перестанет меняться. Фиксированные паузы на медленной машине не успевают,
// и проверки падают случайным образом — так CI мигал на ровном месте.
// Тосты в подпись не входят: они живут своей жизнью и закрываются по таймеру.
const screenSig = () => {
  const d = window.document;
  const len = sel => { const el = d.querySelector(sel); return el ? el.innerHTML.length : -1 };
  const cls = sel => { const el = d.querySelector(sel); return el ? el.className : '' };
  return `${len('#view')}|${len('#modalBody')}|${len('#nav')}|${len('#searchResults')}|${cls('#app')}|${cls('#login')}|${cls('#modal')}`;
};
async function settle(min = 0, cap = 6000) {
  const started = Date.now();
  if (min) await sleep(min);
  let last = screenSig(), stableSince = Date.now();
  while (Date.now() - started < cap) {
    await sleep(30);
    const now = screenSig();
    if (inflight > 0 || now !== last) { last = now; stableSince = Date.now(); continue }
    if (Date.now() - stableSince >= 90) return true;
  }
  return false;
}
const wait = (ms = 0) => settle(ms, Math.max(5000, ms * 6));
const hasEmojis = text => /[\u{10000}-\u{10ffff}\u{2600}-\u{27bf}\u{2300}-\u{23ff}\u{2b50}-\u{2b55}]/u.test(text);
const authH = () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + window.__token });
const apiPost = async (p, body) => (await fetch(BASE + p, { method: 'POST', headers: authH(), body: JSON.stringify(body) })).json();

try {
  // ── вход и сессия ────────────────────────────────────────────────────────
  const loginRes = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com', password: 'admin12345' }) });
  const loginJson = await loginRes.json();
  check('вход по умолчанию создаёт администратора и отдаёт токен', loginRes.status === 200 && !!loginJson.token);
  check('сессия ставится в httpOnly-cookie', /karkas_token=.*HttpOnly/i.test(loginRes.headers.get('set-cookie') || ''));
  const meWithCookie = await fetch(BASE + '/api/me', { headers: { Cookie: loginRes.headers.get('set-cookie').split(';')[0] } });
  check('cookie принимается как параллельный способ авторизации', meWithCookie.status === 200);
  const logoutRes = await fetch(BASE + '/api/auth/logout', { method: 'POST', headers: { Cookie: loginRes.headers.get('set-cookie').split(';')[0] } });
  check('выход гасит cookie', /karkas_token=;/.test(logoutRes.headers.get('set-cookie') || ''));

  $('#loginForm [name=email]').value = 'admin@example.com';
  $('#loginForm [name=password]').value = 'admin12345';
  $('#loginForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(700);
  check('вход через форму открывает приложение', $('#login').classList.contains('hidden') && !$('#app').classList.contains('hidden'), $('#loginErr').textContent);
  window.__token = loginJson.token;
  check('токен сессии не сохраняется в localStorage', window.localStorage.getItem('karkas_token') === null);

  // ── тестовые данные через API ────────────────────────────────────────────
  await apiPost('/webhooks/generic', { channel: 'site', phone: '79110001122', name: 'Ирина Соколова', body: 'Здравствуйте, нужен расчёт дома' });
  await wait(300);
  const convs = await (await fetch(BASE + '/api/conversations', { headers: authH() })).json();
  check('обращение с сайта создало чат и сделку', convs.length === 1 && convs[0].title === 'Ирина Соколова', JSON.stringify(convs.map(c => c.title)));
  const conv = convs[0];
  await apiPost('/api/tasks', { title: 'Позвонить Ирине', type: 'call', due: '2030-01-15 09:30', contact_id: conv.contact_id });
  const competitor = await apiPost('/api/competitors', { name: 'ООО Тестовый конкурент', inn: '7700111222', city: 'Москва' });
  check('конкурент создаётся через API', !!competitor.id);

  // ── все разделы и вкладки настроек отрисовываются без ошибок ─────────────
  const views = ['dashboard', 'pipe', 'inbox', 'contacts', 'companies', 'tasks', 'products', 'competitors', 'analytics'];
  for (const v of views) { window.go(v); await wait(280); const h = $('#view').innerHTML; check('раздел ' + v, h.length > 250 && !/class="card err"/.test(h), h.length + ' симв.') }
  for (const tab of ['integrations', 'fields', 'competitors', 'pipelines', 'automations', 'templates', 'team', 'data', 'profile']) {
    window.__state.settingsTab = tab; window.go('settings'); await wait(300);
    check('настройки → ' + tab, $('#view').innerHTML.length > 300 && !/class="card err"/.test($('#view').innerHTML));
  }

  // ── чат: сообщение отправляется, сохраняется и не пропадает ──────────────
  {
    window.go('inbox'); await wait(500);
    const input = $('#msgText');
    check('чат: поле ввода сообщения на месте', Boolean(input && $('.composer')));
    input.value = 'Проверка сохранения сообщения';
    $('.composer').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await wait(700);
    const saved = await (await fetch(BASE + '/api/conversations/' + window.__state.conv + '/messages', { headers: authH() })).json();
    check('чат: сообщение сохранилось в базе', saved.some(m => m.body === 'Проверка сохранения сообщения' && m.direction === 'out'));
    check('чат: сообщение видно в переписке', /Проверка сохранения сообщения/.test($('#chatMsgs').textContent));
    check('чат: поле ввода очищено после отправки', $('#msgText').value === '');
    check('сообщение пишется в несколько строк, как в мессенджере', $('#msgText').tagName === 'TEXTAREA' && /Shift\+Enter/.test($('#msgText').placeholder));
    $('#msgText').value = 'Первая строка\nВторая строка';
    $('.composer').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await wait(700);
    const saved2 = await (await fetch(BASE + '/api/conversations/' + window.__state.conv + '/messages', { headers: authH() })).json();
    check('многострочное сообщение сохранено с переносом', saved2.some(m => m.body === 'Первая строка\nВторая строка'));
    check('в переписке видны разделители дней', /Сегодня/.test($('#chatMsgs').textContent) && cssText.includes('.msg-day{display:flex'));
    // черновик не пропадает, когда сотрудник ушёл в другой раздел
    $('#msgText').value = 'черновик ответа клиенту';
    window.saveDraft(window.__state.conv);
    window.go('dashboard'); await wait(500);
    window.go('inbox'); await wait(700);
    check('черновик вернулся после ухода и возврата', $('#msgText').value === 'черновик ответа клиенту', $('#msgText').value);
    $('#msgText').value = ''; window.saveDraft(window.__state.conv);
    // новые сообщения видны в заголовке вкладки, даже когда CRM свёрнута
    window.navCounts({ unread: 2, myTasksOpen: 0, dealsTotal: 0, tasksOverdue: 0 });
    check('счётчик непрочитанных виден в заголовке вкладки', window.document.title.startsWith('(2) '), window.document.title);
    window.navCounts({ unread: 0, myTasksOpen: 0, dealsTotal: 0, tasksOverdue: 0 });
    check('без непрочитанных заголовок вкладки обычный', !window.document.title.startsWith('('), window.document.title);
    check('кнопка возврата к новым сообщениям предусмотрена', typeof window.scrollChatBottom === 'function' && typeof window.showJumpNew === 'function' && cssText.includes('.jump-new{position:absolute'));
    window.go('inbox'); await wait(500);
    check('чат: после перерисовки сообщение на месте', /Проверка сохранения сообщения/.test($('#chatMsgs').textContent));
  }

  // ── шаблоны: только текст ответа, без привязки к каналу ──────────────────
  const tplDemo = await apiPost('/api/templates', { name: 'Проверка шаблона', body: 'Здравствуйте, {name}! Это текст ответа для проверки.', channel: 'telegram' });
  check('шаблон сохраняется без канала (канал выбирается в чате)', tplDemo.channel === 'any', String(tplDemo.channel));
  window.__state.settingsTab = 'templates'; window.go('settings'); await wait(400);
  {
    const rows = $$('#view .tpl-row');
    const bodies = rows.map(r => r.querySelector('p')?.textContent.trim() || '');
    check('шаблоны: все строки отрисованы', rows.length >= 1, rows.length + ' шт.');
    check('шаблоны: в списке нет ярлыка канала', $$('#view .tpl-row .tag').length === 0);
    check('шаблоны: в тексте нет кода канала', bodies.every(b => !/^(whatsapp|telegram|instagram|viber|email|any)$/i.test(b)), bodies.map(b => b.slice(0, 12)).join(' | '));
    check('шаблоны: текст ответа длиннее кода', bodies.length > 0 && bodies.every(b => b.length > 20));
    await window.openTemplate(tplDemo.id); await wait(300);
    check('в форме шаблона нет выбора канала', !$('#modalBody [name=channel]') && /Подстановки/.test($('#modalBody').textContent));
    window.closeModal();
    check('в подсказке объяснено, что канал выбирается в чате', /канал.*выбирается в чате|Куда отправить/i.test($('#view').textContent));
  }
  await fetch(BASE + '/api/templates/' + tplDemo.id, { method: 'DELETE', headers: authH() });

  // ── вебхуки: полный адрес, понятное объяснение, кнопка «копировать» ──────
  // вкладка стала тяжелее: у каждого канала своё название и выбор сотрудника.
  // На медленном прогоне прежних 400 мс не хватало, и проверки шли по пустому месту
  window.__state.settingsTab = 'integrations'; window.go('settings'); await wait(700);
  {
    const links = $$('#view .hook-line code').map(c => c.textContent.trim());
    check('вебхуки: адреса собраны с хостом', links.length === 3 && links.every(u => /^https?:\/\//.test(u)) && links.some(u => /\/webhooks\/wazzup$/.test(u)) && links.some(u => /\/webhooks\/email$/.test(u)));
    check('вебхуки: у каждого адреса есть кнопка копирования', $$('#view .hook-line button[data-copy]').length === links.length);
    const txt = $('#view').textContent;
    check('вебхуки: объяснено простыми словами', /входная дверь/.test(txt) && /пароль приложения/.test(txt) && /пересылк/i.test(txt),
      [/входная дверь/.test(txt), /пароль приложения/.test(txt), /пересылк/i.test(txt)].join('/'));
    check('вебхуки: поле публичного адреса доступно в интерфейсе', Boolean($('#publicUrl')));
  }

  // ── свои поля: обязательные сверху, остальные — ниже, без «Дополнительно» ──
  {
    const saved = await (await fetch(BASE + '/api/custom-fields', { headers: authH() })).json();
    await fetch(BASE + '/api/custom-fields', { method: 'PUT', headers: authH(), body: JSON.stringify({ fields: [
      { key: 'plot_area', label: 'Площадь участка', type: 'number', entity: 'both', required: true, options: [] },
      { key: 'foundation', label: 'Тип фундамента', type: 'text', entity: 'both', required: false, options: [] },
    ] }) });
    window.__state.meta = await (await fetch(BASE + '/api/meta', { headers: authH() })).json();
    window.__state.settingsTab = 'fields'; window.go('settings'); await wait(400);
    {
      const rows = $$('#cfFields tr').slice(1).map(r => [...r.children].map(td => td.textContent.trim()));
      const reqRow = rows.find(r => /Площадь участка/.test(r[0]));
      const optRow = rows.find(r => /Тип фундамента/.test(r[0]));
      check('в таблице полей видно, что обязательное идёт сверху', Boolean(reqRow) && /Да/.test(reqRow[3]) && /сначала/i.test(reqRow[3]) && /звёздочк/i.test(reqRow[3]), reqRow && reqRow[3]);
      check('в таблице полей видно, что необязательное идёт ниже', Boolean(optRow) && /Нет/.test(optRow[3]) && /ниже/i.test(optRow[3]), optRow && optRow[3]);
      check('объяснение для неспециалиста есть', /подписано жирным и звёздочкой/i.test($('#view').textContent));
      check('у каждого своего поля есть понятная кнопка «Изменить»', $$('#cfFields tr').slice(1).every(r => /Изменить/.test(r.textContent)));
      const builtin = $$('#builtinFields tr').slice(1).map(r => r.children[0].textContent.trim());
      check('встроенные поля карточек показаны в настройках', builtin.length >= 6 && builtin.includes('Имя клиента') && builtin.includes('Заметки'), builtin.join(', '));
      check('встроенные поля показаны с обязательностью и назначением', Boolean($('#builtinFields')) && /Обязательное/.test($('#view').textContent) && /Зачем/.test($('#view').textContent));

      // Справочник выше пишется руками, и он уже однажды разошёлся с формами
      // («Исполнитель» вместо «Ответственный», «Название» вместо «Что сделать»,
      // пропавшие «Повтор задачи» и «Результат») — то есть подсказка врала.
      // Поэтому сверяем его не с исходником, а с тем, что реально видно в окне:
      // открыли форму → собрали подписи полей → сравнили со справочником.
      const shortName = v => String(v || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
      const formFields = async open => {
        await open(); await wait(400);
        const box = $('#modalBody');
        const fields = Array.from(box.querySelectorAll('label'))
          .filter(l => !l.querySelector('[name^="cf_"]'))   // свои поля — не встроенные
          .map(l => ({ name: shortName(l.childNodes[0] && l.childNodes[0].textContent), req: l.classList.contains('req') }))
          // «Клиент» и «Сделка» в задаче подписаны не label'ом, а короткой шапкой
          .concat(Array.from(box.querySelectorAll('.task-link-cap')).map(e => ({ name: shortName(e.textContent), req: false })));
        window.closeModal();
        return fields.filter(f => f.name);
      };
      const openers = {
        contacts: () => window.openContact(),
        deals: () => { window.__state.dealTab = 'details'; return window.openDealCard(window.__state.deals[0].id) },
        companies: () => window.openCompany(),
        tasks: () => window.openTask(),
      };
      for (const key of Object.keys(window.BUILTIN_FIELDS)) {
        const set = window.BUILTIN_FIELDS[key];
        const real = await formFields(openers[key]);
        const names = real.map(f => f.name);
        const listed = set.rows.map(r => shortName(r[0]));
        const notInForm = listed.filter(x => !names.includes(x));
        const notListed = names.filter(x => !listed.includes(x));
        check('справочник полей «' + set.title + '» = настоящая форма', !notInForm.length && !notListed.length,
          notInForm.length || notListed.length
            ? 'в справочнике лишнее: ' + notInForm.join(', ') + '; не описано: ' + notListed.join(', ')
            : names.length + ' полей, порядок и состав совпадают');
        // «Обязательное» = звёздочка в форме: без неё поле сохранится пустым
        const wrongReq = set.rows.filter(r => {
          const f = real.find(x => x.name === shortName(r[0]));
          return f && f.req !== (r[1] === 'да');
        }).map(r => r[0] + ' (' + r[1] + ')');
        check('в справочнике «' + set.title + '» обязательность совпадает со звёздочкой', !wrongReq.length, wrongReq.join(', '));
      }
      const dealsTab = $$('.tabs button').find(b => /Сделки/.test(b.textContent));
      dealsTab.click(); await wait(500);
      check('справочник полей переключается между разделами', window.__state.builtinTab === 'deals' && $$('#builtinFields tr').slice(1).some(r => /Название сделки/.test(r.textContent)));
      $$('.tabs button').find(b => /Контакты/.test(b.textContent)).click(); await wait(500);
    }
    // редактирование уже существующего поля: кнопка в строке таблицы
    {
      const row = $$('#cfFields tr').find(r => /Тип фундамента/.test(r.textContent));
      const btn = row && [...row.querySelectorAll('button')].find(b => /Изменить/.test(b.textContent));
      check('у существующего поля есть кнопка «Изменить»', Boolean(btn));
      if (btn) {
        btn.click(); await wait(350);
        check('«Изменить» открывает поле с текущими настройками', Boolean($('#modalBody [name=label]')) && $('#modalBody [name=label]').value === 'Тип фундамента');
        $('#modalBody [name=label]').value = 'Тип фундамента (обновлён)';
        $('#modalBody form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
        await wait(700);
        check('изменение существующего поля сохраняется', /Тип фундамента \(обновлён\)/.test($('#view').textContent));
      }
    }
    await window.openContact(conv.contact_id); await wait(350);
    const req = $('#modalBody [name=cf_plot_area]');
    const opt = $('#modalBody [name=cf_foundation]');
    check('обязательное своё поле есть в форме', Boolean(req));
    check('необязательное своё поле тоже видно без раскрытия', Boolean(opt) && !opt.closest('details'));
    check('в форме нет сворачиваемого блока «Дополнительно»', !$('#modalBody details.form-more'));
    check('в форме нет разделителя «Необязательные поля»', !$('#modalBody .form-sep') && !/Необязательные поля/.test($('#modalBody').textContent));
    check('обязательное своё поле идёт раньше необязательного',
      Boolean(req) && Boolean(opt) && (req.compareDocumentPosition(opt) & window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    check('подпись обязательного поля жирная и со звёздочкой', Boolean(req.closest('label.req')) && req.closest('label').querySelector('.star'));
    check('своё поле подписано понятным названием', /Площадь участка/.test($('#modalBody').textContent));
    check('в форме контакта объяснено, кому достанется клиент', /Пока в команде только вы|Обращения из чатов|По умолчанию ответственный/.test($('#modalBody').textContent));
    window.closeModal();
    await window.openDeal(); await wait(350);
    check('в сделке то же порядок: обязательное раньше необязательного',
      Boolean($('#modalBody [name=cf_plot_area]')) && Boolean($('#modalBody [name=cf_foundation]')) && !$('#modalBody [name=cf_foundation]').closest('details')
      && ($('#modalBody [name=cf_plot_area]').compareDocumentPosition($('#modalBody [name=cf_foundation]')) & window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    window.closeModal();
    await window.openContactCard(conv.contact_id); await wait(350);
    check('свои поля видны в карточке клиента', /Площадь участка/.test($('#modalBody').textContent) && /Тип фундамента/.test($('#modalBody').textContent));
    window.closeModal();
    await fetch(BASE + '/api/custom-fields', { method: 'PUT', headers: authH(), body: JSON.stringify({ fields: saved.fields || [] }) });
    window.__state.meta = await (await fetch(BASE + '/api/meta', { headers: authH() })).json();
  }

  // ── навигация: клик по кнопке меню реально переключает раздел ────────────
  const navBtn = $('#nav button[data-view="tasks"]');
  navBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(300);
  check('клик по кнопке навигации переключает раздел', window.__state.view === 'tasks');
  check('у активного раздела проставлен класс active', navBtn.classList.contains('active'));

  // ── иконка «Сделки» — воронка, а не столбцы ──────────────────────────────
  check('иконка раздела «Сделки» — воронка', window.ICON_PATHS.pipe.includes('22 3') && window.ICON_PATHS.pipe.includes('2 3'));

  // ── модальные окна ───────────────────────────────────────────────────────
  const modal = async (label, fn) => { try { await fn(); await wait(300); check('модалка ' + label, !$('#modal').classList.contains('hidden') && $('#modalBody').innerHTML.length > 50); window.closeModal() } catch (e) { check('модалка ' + label, false, e.message) } };
  await modal('сделка', () => window.openDeal());
  await modal('задача', () => window.openTask());
  await modal('контакт', () => window.openContact());
  await modal('компания', () => window.openCompany());
  await modal('товар', () => window.openProduct());
  await modal('конкурент', () => window.openCompetitor());
  await modal('загрузка прайса', () => window.openPriceImport(competitor.id, 'ours'));
  await modal('уведомления', () => window.openNotifications());
  await modal('редактор воронки', () => window.openPipelineEditor());
  await modal('импорт CSV', () => window.importContacts());
  await modal('дубли контактов', () => window.openDuplicates());
  await modal('редактор своих полей', () => window.editField(-1));
  await modal('письмо клиенту', () => window.openEmailComposer(conv.id));

  // ── формы: без «Дополнительно», обязательные поля первыми ──────────────────
  await window.openDeal(); await wait(250);
  check('в форме сделки нет сворачиваемого «Дополнительно»', !$('#modalBody details.form-more'));
  check('главные и второстепенные поля сделки видны сразу',
    Boolean($('#modalBody input[name=title]')) && Boolean($('#modalBody select[name=contact_id]'))
    && Boolean($('#modalBody select[name=responsible_id]')) && Boolean($('#modalBody input[name=deadline]')));
  check('название сделки подписано как обязательное', Boolean($('#modalBody label.req input[name=title]')));
  check('обязательное поле идёт раньше необязательных',
    ($('#modalBody input[name=title]').compareDocumentPosition($('#modalBody input[name=amount]')) & window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
  check('обязательные и необязательные поля идут подряд, без разделителя', !$('#modalBody .form-sep') && !/Необязательные поля/.test($('#modalBody').textContent));
  await window.openCompany(); await wait(250);
  check('в компании название обязательно и первое', Boolean($('#modalBody label.req input[name=name]')) && !$('#modalBody details.form-more'));
  check('в компании видны ИНН, телефон, почта, сайт и заметки', ['inn', 'phone', 'email', 'site', 'notes'].every(n => Boolean($('#modalBody [name=' + n + ']'))));
  await window.openTask(); await wait(250);
  check('в задаче нет «Дополнительно», исполнитель и повтор видны сразу', !$('#modalBody details.form-more') && Boolean($('#modalBody select[name=responsible_id]')) && Boolean($('#modalBody select[name=repeat]')));
  await window.openProduct(); await wait(250);
  check('в каталоге цена обязательна и стоит рядом с названием', Boolean($('#modalBody label.req input[name=price]')) && !$('#modalBody details.form-more'));
  window.closeModal();
  // этап «успех» находится по смыслу, а не по жёсткому коду
  check('этап успеха определяется по виду этапа', window.__state.stages.some(s => s.kind === 'won') ? window.kindStage('won') === window.__state.stages.find(s => s.kind === 'won').code : true);
  // задача из карточки: связи уже известны — подпись вместо двух длинных списков
  const linkDeal = window.__state.deals[0], linkContact = window.__state.contacts[0];
  window.closeModal();
  await window.openTask(null, { deal_id: linkDeal.id, contact_id: linkContact.id }); await wait(250);
  check('задача из карточки показывает привязки подписью', Boolean($('#modalBody .task-link')) && !$('#modalBody select[name=deal_id]') && Boolean($('#modalBody input[type=hidden][name=deal_id]')));
  window.taskUnlink($('#modalBody .task-link .link-btn'), 'contact_id');
  check('привязку можно сменить на другое значение', Boolean($('#modalBody select[name=contact_id]')));
  window.closeModal();
  // локальная дата не зависит от UTC
  check('isoDate возвращает локальную дату', window.isoDate(new Date(2026, 0, 1)) === '2026-01-01' && window.isoDate(new Date(2026, 11, 31)) === '2026-12-31');
  check('todayISO совпадает с локальным днём', window.todayISO() === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`);

  // ── чат: компоновщик как в мессенджере ───────────────────────────────────
  window.go('inbox'); await wait(400);
  check('скрепка прикрепления файла стоит рядом с полем ввода', Boolean($('#chatFile')) && Boolean($('.composer-ico [data-lucide], .composer-ico svg')));
  check('кнопка отправки — круглая со стрелкой вверх, без бумажного самолётика', Boolean($('.send-btn svg')) && !appJsRaw.includes("icon('send'"));
  check('под полем ввода есть выбор канала и шаблонов', Boolean($('#msgChannel')) && Boolean($('#msgTmpl')));
  check('в композере нет кнопки «ссылка на файл»', !window.openAttachment && !$$('.composer-ico').some(b => /ссылк/i.test(b.title)));
  check('выбор канала подписан «Куда отправить»', /Куда отправить/.test($('.composer-sub').textContent));
  check('в композере ровно три действия: файл, поле, отправка', $$('.composer-row:first-child > *').length === 4);
  check('есть быстрый переход к настройке шаблонов', Boolean($('.tmpl-settings')));
  // Список «Куда отправить» строится из того, что у заказчика реально подключено.
  // Зашитый перечень показывал WhatsApp тому, у кого только Авито и MAX, и прятал
  // сами Авито с MAX — ответ ушёл бы не в тот мессенджер.
  const opts = window.channelOptions({ channels: 'avito,max' });
  check('в списке отправки есть каналы этого клиента', opts.includes('avito') && opts.includes('max'));
  check('каналы подписаны по-русски, а не кодом', /Авито/.test(opts) && /MAX/.test(opts));
  check('почты в списке мессенджеров нет: письмо уходит отдельной кнопкой', !opts.includes('email'));
  check('неподключённый WhatsApp не предлагается', !opts.includes('whatsapp'));
  // Транспорт канала и тип чата у Wazzup — разные списки. Отправляем мы по типу
  // чата, поэтому WhatsApp Business API (wapi) превращается в whatsapp, а личный
  // Telegram (tgapi) — в telegram. Раньше в список попадал сам транспорт, и
  // Wazzup отвечал отказом на каждый такой ответ.
  window.__state.channels = [
    { transport: 'wapi', state: 'active' }, { transport: 'tgapi', state: 'active' },
    { transport: 'vk', state: 'disabled' }, { transport: 'cian', state: 'active' },
    { transport: 'maxbot', state: 'notEnoughMoney' }];
  const opts2 = window.channelOptions({ channels: 'avito' });
  check('транспорт канала переводится в тип чата, которым Wazzup отправляет', opts2.includes('whatsapp') && opts2.includes('telegram'), opts2);
  check('отключённый канал не предлагается', !opts2.includes('vk'));
  check('канал с пустым балансом не предлагается', !opts2.includes('>MAX<'));
  check('у Циана нет типа чата — пункт, который всегда падает, не предлагается', !opts2.includes('cian'));
  check('каналы клиента идут раньше остальных подключённых', opts2.indexOf('avito') < opts2.indexOf('whatsapp'));
  window.__state.channels = [];
  const opts3 = window.channelOptions({ channels: '', chat_type: 'max' });
  check('без синхронизации каналов предлагается тип этой беседы', opts3.includes('max'));
  const optsGrp = window.channelOptions({ channels: 'telegroup,maxgroup' });
  check('в групповой чат Telegram и MAX можно ответить', optsGrp.includes('telegroup') && optsGrp.includes('maxgroup') && /Группа Telegram/.test(optsGrp) && /Группа MAX/.test(optsGrp), optsGrp);
  const optsDead = window.channelOptions({ channels: 'cian', chat_type: 'cian' });
  check('когда отвечать некуда, сказано прямо, а не предложением, которое всегда падает', optsDead.includes('disabled') && optsDead.includes('недоступны'), optsDead);
  // состояния канала называются по-русски, а не кодом вендора
  check('состояния канала переведены', window.wzState('active')[0] === 'работает' && window.wzState('notEnoughMoney')[0] === 'не хватает средств на балансе' && window.wzState('qridle')[0] === 'нужно отсканировать QR-код');
  check('неизвестное состояние показывается как есть и не прячет канал', window.wzState('somethingNew')[0] === 'somethingNew' && window.wzAlive({ state: 'somethingNew' }) === true);
  check('ноль каналов объясняет, что делать дальше', /нет ни одного канала/.test(appJsRaw) && /ни один сейчас не работает/.test(appJsRaw));
  check('нерабочие состояния канала распознаются', ['disabled', 'blocked', 'unauthorized', 'openelsewhere', 'foreignphone', 'waitForPassword', 'onModeration', 'rejected', 'phoneUnavailable', 'notEnoughMoney', 'qridle'].every(st => !window.wzAlive({ state: st })) && window.wzAlive({ state: 'active' }));
  check('название канала собирается из мессенджера и номера', window.wzTitle({ transport: 'whatsapp', phone: '79991112233' }) === 'WhatsApp · 79991112233');
  check('своё название канала важнее номера в списках', window.wzTitle({ label: 'WhatsApp — Ирина', transport: 'whatsapp', phone: '79991112233' }) === 'WhatsApp — Ирина');
  check('название и сотрудник канала сохраняются одним действием', typeof window.saveChannel === 'function' && /label: name \? name\.value : '', user_id: who && who\.value/.test(appJsRaw.replace(/\s+/g, ' ')));
  // канал Wazzup — это аккаунт, а не сотрудник: привязку задаёт администратор,
  // а канал для исходящих по умолчанию выбирают один раз в настройках
  check('у канала в настройках выбирают сотрудника', /id="chUser\$\{c\.id\}"/.test(appJsRaw) && /Кто отвечает с этого аккаунта/.test(appJsRaw));
  check('канал для исходящих по умолчанию выбирают в настройках', /id="wzChannel"/.test(appJsRaw) && appJsRaw.includes("WAZZUP_CHANNEL_ID: $('#wzChannel').value"));

  // ── написать клиенту первым ──────────────────────────────────────────────
  check('переписку можно начать без входящего сообщения', typeof window.startConv === 'function' && /method: 'POST'/.test(String(window.submitStartConv)) && /\/api\/conversations/.test(String(window.submitStartConv)));
  check('в карточке клиента есть кнопка «Написать», когда чата ещё нет', /startConv\(\$\{c\.id\}\)/.test(appJsRaw) && /Написать<\/button>/.test(appJsRaw));
  check('адрес получателя объясняется по-человечески', typeof window.scAddrHint === 'function' && /Имя чата видно в первом сообщении клиента/.test(appJsRaw));
  check('список мессенджеров для нового чата берут из подключённых каналов', /chans\.filter\(wzAlive\)/.test(appJsRaw));

  // ── отправить КП или счёт клиенту ────────────────────────────────────────
  check('документ можно отправить клиенту письмом', typeof window.sendDoc === 'function' && /\/send-doc/.test(String(window.submitSendDoc)));
  check('в карточке сделки есть кнопка отправки документа', /sendDoc\(\$\{deal\.id\}\)/.test(appJsRaw));
  check('объяснено, что клиент открывает документ без входа в CRM', /открывается без входа в CRM/.test(appJsRaw));
  check('пустой документ не предлагают отправить', /В сделке нет позиций/.test(appJsRaw));

  // ── копии на другом сервере ──────────────────────────────────────────────
  check('хранилище резервных копий настраивается из интерфейса', typeof window.saveS3 === 'function' && typeof window.uploadS3 === 'function' && /S3_ENDPOINT/.test(appJsRaw) && /S3_SECRET_KEY/.test(appJsRaw));
  check('показано время последней выгрузки копии', typeof window.s3line === 'function' && /Последняя выгрузка/.test(window.s3line({ configured: true, last_ok: '2026-10-26 03:00:00', last_file: 'crm-2026-10-26.db', bucket: 'karkas-backups' })));
  check('ошибка выгрузки не прячется', /не удалась/.test(window.s3line({ configured: true, last_ok: '', last_error: 'хранилище ответило 403' })));
  check('без настроек хранилища сказано, чего не хватает', /не настроено/.test(window.s3line({ configured: false, missing: ['S3_ENDPOINT'] })) && /S3_ENDPOINT/.test(window.s3line({ configured: false, missing: ['S3_ENDPOINT'] })));
  check('секретный ключ не показывается в поле', /type="password"/.test(appJsRaw.split('saveS3')[0].slice(-3000)) || /S3_SECRET_KEY" type="password"/.test(appJsRaw));

  // ── действия правил автоматизации ────────────────────────────────────────
  check('правило умеет писать клиенту в чат', window.AUTO_ACTIONS.send_message === 'Отправить клиенту сообщение в чат');
  check('правило умеет отправлять письмо', window.AUTO_ACTIONS.send_email === 'Отправить клиенту письмо');
  check('правило умеет передавать сделку сотруднику', window.AUTO_ACTIONS.assign_user === 'Передать сделку сотруднику');
  check('прежние действия правил на месте', ['create_task', 'change_stage', 'add_tag'].every(k => window.AUTO_ACTIONS[k]) && Object.keys(window.AUTO_ACTIONS).length === 6);
  check('в тексте правила подставляются имя клиента и сделка', /\{name\}/.test(appJsRaw) && /\{deal\}/.test(appJsRaw) && /\{sum\}/.test(appJsRaw));
  check('действие можно отложить на несколько дней', /name="delay_days"/.test(appJsRaw) && /Через ' \+ n \+ ' дн\./.test(appJsRaw));
  check('выдержка объяснена: правило сработает в срок', /CRM запомнит действие и выполнит его в срок/.test(appJsRaw));
  check('сотрудника для передачи выбирают из списка, а не вписывают номером', /window\.__autoUsers/.test(appJsRaw));
  // в списке каналов важно, бот это или личный аккаунт; в типе чата — уже нет
  check('список каналов различает бота и личный Telegram, а тип чата один', window.wzTransportLabel('telegram') === 'Telegram-бот' && window.wzTransportLabel('tgapi') === 'Telegram' && window.channelLabel('telegram') === 'Telegram');
  const imgMsg = window.msgHtml({ direction: 'out', body: '', content_uri: '/uploads/x.png', content_type: 'image/png', content_name: 'x.png', channel: 'whatsapp', created_at: '2026-01-01 10:00' });
  check('msgHtml рисует изображение-вложение картинкой', imgMsg.includes('chat-attach img') && imgMsg.includes('<img'));
  const fileMsg = window.msgHtml({ direction: 'in', body: 'Документ', content_uri: '/uploads/a.pdf', content_type: 'application/pdf', content_name: 'смета.pdf', channel: 'whatsapp', created_at: '2026-01-01 10:00' });
  check('msgHtml рисует файл-вложение ссылкой с именем', fileMsg.includes('chat-attach file') && fileMsg.includes('смета.pdf'));

  // ── загрузка файла в чат через API ───────────────────────────────────────
  const up = await (await fetch(BASE + `/api/conversations/${conv.id}/upload`, { method: 'POST', headers: authH(), body: JSON.stringify({ filename: 'прайс.png', contentType: 'image/png', dataBase64: PNG_B64 }) })).json();
  check('файл загружается в чат и получает безопасное ASCII-имя', !!up.url && /^\/uploads\/[A-Za-z0-9._-]+$/.test(up.url), up.url);
  const upNoAuth = await fetch(BASE + up.url);
  check('вложения не отдаются без авторизации', upNoAuth.status === 401);
  const upAuth = await fetch(BASE + up.url, { headers: { Authorization: 'Bearer ' + window.__token } });
  check('вложение доступно автору сессии', upAuth.status === 200 && (upAuth.headers.get('content-type') || '').includes('image/png'));
  const badUp = await fetch(BASE + `/api/conversations/${conv.id}/upload`, { method: 'POST', headers: authH(), body: JSON.stringify({ filename: 'x.exe', contentType: 'application/x-msdownload', dataBase64: PNG_B64 }) });
  check('запрещённый тип файла отклоняется', badUp.status === 400);

  // ── бренд: векторный лист вместо фото-логотипа ───────────────────────────
  const leafRes = await fetch(BASE + '/favicon.svg');
  const leafTxt = await leafRes.text();
  check('иконка вкладки — вектор и открывается без входа', leafRes.status === 200 && (leafRes.headers.get('content-type') || '').includes('svg') && leafTxt.includes('<path'));
  check('лист красится цветом интерфейса, а не зашитым цветом', /fill="currentColor"/.test(leafTxt) && /viewBox="0 0 254 238"/.test(leafTxt));
  const leafD = (leafTxt.match(/<path id="leaf" fill="currentColor" d="([^"]+)"/) || [])[1] || '';
  const symD = (html.match(/<symbol id="karkas-leaf"[^>]*><path fill="currentColor" d="([^"]+)"/) || [])[1] || '';
  check('контур листа в разметке тот же, что в файле вкладки', leafD.length > 200 && symD === leafD, `символ ${symD.length} против файла ${leafD.length}`);
  const photoLogo = await fetch(BASE + '/logo.png');
  await photoLogo.arrayBuffer();
  check('фото-логотип больше не отдаётся картинкой', !(photoLogo.headers.get('content-type') || '').startsWith('image/'));
  const logoApi = await fetch(BASE + '/api/logo', { method: 'POST', headers: authH(), body: '{}' });
  check('адрес загрузки фото-логотипа закрыт', logoApi.status === 404);

  // ── задачи: фильтры, календарь, мультивыбор ──────────────────────────────
  window.go('tasks'); await wait(350);
  check('фильтр «Мои (…) / Все (…)» в задачах', /Мои \(/.test($('#view').innerHTML) && /Все \(/.test($('#view').innerHTML));
  window.__state.taskView = 'week'; window.go('tasks'); await wait(350);
  check('календарь задач на неделю', /class="calendar"/.test($('#view').innerHTML) && /cal-day/.test($('#view').innerHTML));
  window.__state.taskView = 'list'; window.go('tasks'); await wait(300);
  check('в обычном режиме чекбоксы задач скрыты', $$('#view .taskrow input[type=checkbox]').length === 0);
  window.toggleTaskSelect(); await wait(450);
  check('режим мультивыбора показывает чекбоксы', $$('#view .taskrow input[type=checkbox]').length > 0, $$('#view .taskrow').length + ' строк задач');
  window.toggleTaskSelect(); await wait(300);
  check('в задачах есть поиск по названию и клиенту', Boolean($('#taskSearch')) && /Поиск по задачам/.test($('#taskSearch').placeholder));
  check('кнопка «Задача» в списке одна — в правом углу', $$('#view .row > button.btn.primary').length === 1);
  window.__state.taskQuery = 'такой задачи точно нет'; window.go('tasks'); await wait(450);
  {
    const empty = $('#view .empty-state');
    check('пустой список задач объясняет, что делать', Boolean(empty) && /измените условия поиска|кнопка «Задача»/.test(empty.textContent), empty && empty.textContent.slice(0, 60));
    check('в середине пустого списка нет второй кнопки создания', Boolean(empty) && empty.querySelectorAll('button').length === 0);
    check('кнопка создания в углу остаётся при пустом списке', $$('#view .row > button.btn.primary').length === 1);
  }
  window.__state.taskQuery = ''; window.go('tasks'); await wait(350);
  check('в шапке остаются кнопки быстрого создания', $$('.head-actions .head-create').length === 3);

  // ── поиск: чистый поиск отдельно от палитры команд ────────────────────────
  const si = $('#globalSearch'); si.value = 'Ирине'; si.dispatchEvent(new window.Event('input', { bubbles: true })); await wait(500);
  check('глобальный поиск находит задачи и показывает секцию «Задачи»', /Задачи/.test($('#searchResults').innerHTML) && /Позвонить Ирине/.test($('#searchResults').innerHTML));
  check('в результатах поиска нет команд палитры', !/Разделы|Быстрое создание/.test($('#searchResults').innerHTML));
  window.openPalette('сделк'); await wait(150);
  check('палитра команд открывается по Ctrl+K и ищет действия', !$('#palette').classList.contains('hidden') && /Сделки/.test($('#paletteList').innerHTML));
  window.closePalette();

  // ── сделки: канбан, карточка, печать ─────────────────────────────────────
  window.go('pipe'); await wait(350);
  check('на канбане есть фильтр «Мои / Все» и поиск сделок', /Все сделки/.test($('#view').innerHTML) && /Поиск по сделкам/.test($('#view').innerHTML));
  const dealId = window.__state.deals[0].id;
  for (const tab of ['details', 'chat', 'products', 'tasks', 'notes', 'history']) { window.__state.dealTab = tab; await window.openDealCard(dealId); await wait(200); check('сделка → ' + tab, $('#modalBody').innerHTML.length > 100) }
  window.closeModal();
  const printed = await fetch(BASE + '/api/deals/' + dealId + '/print?doc=invoice&token=' + encodeURIComponent(window.__token || ''));
  check('счёт на оплату отдаётся сервером с токеном', printed.status === 200 && /Счёт на оплату/.test(await printed.text()));

  // ── контакты: фильтры, карточка, массовые действия ───────────────────────
  window.go('contacts'); await wait(350);
  check('фильтры в списке контактов', /Все ответственные/.test($('#view').innerHTML) && /Все источники/.test($('#view').innerHTML));
  await window.openContactCard(1); await wait(250);
  check('карточка клиента', /Сделки клиента/.test($('#modalBody').innerHTML)); window.closeModal();
  window.toggleSel('contacts', window.__state.contacts[0].id); await wait(300);
  check('панель массовых действий', /class="bulkbar"/.test($('#view').innerHTML) && /Выбрано: 1/.test($('#view').innerHTML));
  window.clearSel('contacts'); await wait(200);
  {
    const moreBtn = $$('#view button').find(b => /Ещё/.test(b.textContent));
    check('в контактах есть меню «Ещё»', Boolean(moreBtn));
    moreBtn.click(); await wait(120);
    const menu = $('#popMenu');
    check('меню «Ещё» крепится к странице и не прячется за таблицей', Boolean(menu) && menu.parentElement === window.document.body && cssText.includes('.dropdown-pop.menu-fixed{position:fixed'));
    check('в меню понятные пункты: дубли, выгрузка, загрузка', $$('#popMenu button').length === 3 && /Найти дубли клиентов/.test(menu.textContent) && /Выгрузить в CSV/.test(menu.textContent) && /Загрузить список из CSV/.test(menu.textContent), menu && menu.textContent.replace(/\s+/g, ' ').slice(0, 90));
    window.closeMenu(); await wait(60);
    check('меню закрывается', !$('#popMenu'));
  }

  // ── конкуренты ───────────────────────────────────────────────────────────
  window.go('competitors'); await wait(400);
  check('непроверенный конкурент помечен как непроверенный, а не «риск 0»', /не проверялся/.test($('#view').innerHTML) && !/риск 0 \(/.test($('#view').innerHTML));
  check('в списке конкурентов есть поиск и наша таблица цен', Boolean($('#compFilter')) && /Наш прайс-лист/.test($('#view').textContent));
  // регрессия «$$(...).find is not a function»: селектор обязан возвращать массив,
  // а поиск кнопки по тексту — работать (именно он падал при поиске конкурента)
  check('селектор $$ возвращает массив, а не NodeList', /const \$\$ = s => Array\.from\(document\.querySelectorAll\(s\)\)/.test(appJsRaw));
  {
    pageErrors.length = 0;
    const probe = window.busyButton(/Наш прайс-лист/, true);
    check('кнопка находится по тексту и блокируется на время запроса', Boolean(probe) && probe.disabled === true && probe.classList.contains('loading'), pageErrors.join(' | ').slice(0, 100));
    window.busyButton(/Наш прайс-лист/, false);
    check('после ответа кнопка снова рабочая', Boolean(probe) && probe.disabled === false);
  }
  {
    // Проверка конкурента не должна зависеть от интернета прогонщика: внешние
    // источники уводим на недоступный локальный адрес. Иначе поиск ждёт настоящие
    // сайты до таймаута, и карточка не успевает открыться к проверке.
    await window.api('/api/competitor-sources', { method: 'PUT', body: JSON.stringify({
      RUSPROFILE_URL: 'http://127.0.0.1:9', FEDRESURS_API_URL: 'http://127.0.0.1:9', KAD_API_URL: 'http://127.0.0.1:9',
      FNS_API_URL: 'http://127.0.0.1:9', GOOGLE_API_URL: 'http://127.0.0.1:9', TWOGIS_API_URL: 'http://127.0.0.1:9',
      YANDEX_API_URL: 'http://127.0.0.1:9', COMPETITOR_TIMEOUT_MS: '1500',
    }) }).catch(() => {});
    const search = $('#compSearch');
    search.value = 'ООО «Проверка Поиска»';
    const btn = $$('#view button').find(b => /Найти и проверить/.test(b.textContent));
    check('в конкурентах есть кнопка «Найти и проверить»', Boolean(btn));
    pageErrors.length = 0;
    btn.click();
    await wait(3000);
    check('клик по «Найти и проверить» не падает', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 140));
    check('после поиска открылась карточка найденного конкурента', /Проверка Поиска/.test($('#modalBody').textContent), $('#modalBody').textContent.replace(/\s+/g, ' ').slice(0, 90));
    window.closeModal(); await wait(150);
  }
  const id = competitor.id;
  for (const tab of ['report', 'sources', 'debts', 'reviews', 'prices', 'history']) { window.__state.compTab = tab; await window.openCompetitorCard(id); await wait(250); check('конкурент → ' + tab, $('#modalBody').innerHTML.length > 150 && !/class="card err"/.test($('#modalBody').innerHTML)) }
  // Крестик закрытия висит в правом верхнем углу окна, а кнопки «Проверить сейчас»
  // и «Загрузить прайс» стоят в том же первом ряду справа: без запаса они наезжали
  // на крестик, и окно нельзя было закрыть мышью. Проверяем и разметку, и CSS.
  {
    window.__state.compTab = 'report'; await window.openCompetitorCard(id); await wait(300);
    const head = $('#modalBody .modal-head');
    const headCss = (cssText.match(/\.modal-head\{[^}]*\}/) || [''])[0];
    check('шапка карточки конкурента — общий класс, а не разовые инлайн-стили', Boolean(head) && !head.getAttribute('style'));
    check('у шапки зарезервировано место под крестик', /padding-right:3[0-9]px/.test(headCss), headCss);
    check('шапка чуть опущена ниже крестика', /margin:6px 0/.test(headCss), headCss);
    check('в шапке остались кнопки проверки и загрузки прайса', /Проверить сейчас/.test(head.textContent) && /Загрузить прайс/.test(head.textContent));
    window.closeModal(); await wait(150);
  }
  check('шапка контакта тоже не заходит под крестик', /padding-right:3[0-9]px/.test((cssText.match(/\.contact-head\{[^}]*\}/) || [''])[0]));
  check('первый текстовый ряд окна не налезает на крестик', cssText.includes('#modalBody>h3:first-child,#modalBody>p:first-child{padding-right:34px}'));
  // Долги у приставов и «Связи» Rusprofile автоматически не отдаются: API ФССП
  // закрыт, сайт Rusprofile закрыт от роботов. Поэтому то, что менеджер посмотрел
  // сам, можно записать — иначе проверка испаряется вместе с закрытой вкладкой.
  {
    const html = window.findingsBlock({ id: 7, findings: [
      { id: 3, kind: 'долги', title: '3 исполнительных производства', amount: 450000, author: 'Администратор', created_at: '2026-10-01 10:00', source_url: 'https://fssp.gov.ru/iss/ip' },
      { id: 4, kind: 'связи', title: 'Общий учредитель', note: 'с ООО «Ромашка»', author: 'Администратор', created_at: '2026-10-02 11:00' },
    ] });
    check('на вкладке долгов есть блок ручных находок', /Найдено вручную/.test(html));
    check('записанная сумма долга видна в блоке', /450/.test(html) && /3 исполнительных производства/.test(html));
    check('у находки видны автор, дата и ссылка на источник', /Администратор/.test(html) && /fssp\.gov\.ru/.test(html));
    check('форма записи предлагает виды находок', /name="kind"/.test(html) && /долги/.test(html) && /связи/.test(html));
    check('в форме есть сумма и описание', /name="amount"/.test(html) && /name="title"/.test(html));
    check('находку можно удалить', /deleteFinding\(3,7\)/.test(html));
    const emptyHtml = window.findingsBlock({ id: 8, findings: [] });
    check('без записей блок объясняет, что делать', /Записей пока нет/.test(emptyHtml) && /Запишите, что увидели в реестре/.test(emptyHtml));
  }
  window.closeModal();
  // «Ссылка на прайс»: сервер умел подтягивать таблицу конкурента по адресу,
  // но поля в форме не было — функция оставалась недостижимой из интерфейса.
  await window.openCompetitor(); await wait(350);
  check('в форме конкурента есть поле «Ссылка на прайс»', Boolean($('#modalBody [name="price_url"]')) && /Ссылка на прайс/.test($('#modalBody').textContent));
  check('подсказка объясняет, зачем конкуренту ссылка на прайс', /сама подтянет|при каждой проверке/i.test($('#modalBody').textContent), $('#modalBody').textContent.replace(/\s+/g, ' ').slice(0, 120));
  window.closeModal(); await wait(150);
  // Ссылки для ручной проверки приходят с сервера (ФНС, ГИР БО, ФССП, Федресурс,
  // арбитраж, карты, отзывы, Авито, Госзакупки), а не зашиты в интерфейс парой штук.
  {
    const html = window.reportLinks({ links: [{ label: 'Росстат', url: 'https://example.gov/a' }, { label: 'ФССП', url: 'https://example.gov/b' }] }, { name: 'ООО Тест', inn: '7700111222' });
    check('в отчёт попадают ссылки из ответа сервера, а не две зашитые', /Росстат/.test(html) && /ФССП/.test(html) && /target="_blank"/.test(html) && /rel="noopener"/.test(html));
    const fallback = window.reportLinks({}, { name: 'ООО Тест', inn: '7700111222' });
    check('без готового отчёта остаются хотя бы поисковые ссылки', /rusprofile\.ru\/search/.test(fallback) && /7700111222/.test(fallback));
  }
  // наша таблица цен: загружена — значит кнопка показывает её, а не просит файл
  await fetch(BASE + '/api/prices', { method: 'POST', headers: authH(), body: JSON.stringify({ scope: 'ours', text: 'Каркасный дом 8×10;2950000;шт\nБаня 4×6;890000;шт' }) });
  await fetch(BASE + '/api/competitors/' + id + '/prices', { method: 'POST', headers: authH(), body: JSON.stringify({ scope: 'competitor', text: 'Каркасный дом 8×10;3200000;шт' }) });
  window.__state.ourPrices = null;
  window.go('competitors'); await wait(450);
  {
    const priceBtn = $$('#view button').find(b => /Наш прайс-лист/.test(b.textContent));
    check('кнопка прайс-листа показывает число позиций', Boolean(priceBtn) && /\(2\)/.test(priceBtn.textContent), priceBtn && priceBtn.textContent.trim());
    priceBtn.click(); await wait(400);
    check('прайс-лист открывается таблицей, а не просьбой загрузить файл', /Наш прайс-лист/.test($('#modalBody').textContent) && $$('#ourPriceTable tr').length === 3 && !$('#modalBody input[type=file]'), $('#modalBody').textContent.replace(/\s+/g, ' ').slice(0, 90));
    check('прайс можно скачать, загрузить и открыть как каталог', /Скачать прайс/.test($('#modalBody').textContent) && /Загрузить из файла/.test($('#modalBody').textContent) && /Открыть каталог/.test($('#modalBody').textContent));
    check('объяснено, что прайс-лист и каталог — один список', /Ваш прайс-лист/.test($('#modalBody').textContent) || /это ваш каталог/i.test($('#modalBody').textContent), $('#modalBody').textContent.replace(/\s+/g, ' ').slice(0, 90));
    check('в таблице цен есть поиск по позициям', Boolean($('#ourPriceFilter')));
    window.filterOurPrices('баня'); await wait(60);
    check('поиск по таблице цен работает', $$('#ourPriceTable tr').length === 2 && /Баня/.test($('#ourPriceTable').textContent));
    window.closeModal();
    window.__state.compTab = 'prices'; await window.openCompetitorCard(id); await wait(350);
    const fuzzy = window.comparePrices(
      [{ item: 'Баня каркасная 4×6', price: 890000 }, { item: 'Каркасный дом 6×8 «Летний»', price: 1850000 }, { item: 'Терраса без цены', price: 0 }],
      [{ item: 'Баня 4×6', price: 990000 }, { item: 'Каркасный дом 6×8 с террасой', price: 2500000 }]
    );
    check('сравнение находит позицию с похожим названием и не склеивает комплектации', fuzzy.length === 1 && /Баня/.test(fuzzy[0].item) && fuzzy[0].theirs === 990000, JSON.stringify(fuzzy));
    check('сравнение цен считается по текущим данным', /мы дешевле на/.test($('#modalBody').textContent) && /Сопоставлено позиций/.test($('#modalBody').textContent), $('#modalBody').textContent.replace(/\s+/g, ' ').slice(0, 120));
    check('в сравнении сказано, что наши цены берутся из каталога', /Сравнение с нашим прайс-листом/.test($('#modalBody').textContent) && /«Каталог»/.test($('#modalBody').textContent), $('#modalBody').textContent.replace(/\s+/g, ' ').slice(0, 120));
    window.closeModal();
  }

  // ── каталог = прайс-лист: один список вместо двух ────────────────────────
  window.go('products'); await wait(450);
  {
    const text = $('#view').textContent;
    check('каталог говорит, что он же прайс-лист', /Каталог и прайс-лист/.test(text) && /один список/.test(text), text.replace(/\s+/g, ' ').slice(0, 120));
    check('из каталога прайс можно скачать и загрузить файлом', /Скачать прайс/.test(text) && /Загрузить из файла/.test(text));
    check('загруженный прайс виден в каталоге теми же позициями', $$('#view table tr').length === 3 && /Каркасный дом 8×10/.test(text) && /Баня 4×6/.test(text), $$('#view table tr').length + ' строк');
    const pSearch = $('#globalSearch');
    pSearch.value = 'Баня 4×6'; pSearch.dispatchEvent(new window.Event('input', { bubbles: true })); await wait(500);
    check('общий поиск находит позицию прайс-листа', /Каталог и прайс/.test($('#searchResults').innerHTML) && /Баня/.test($('#searchResults').innerHTML), $('#searchResults').textContent.replace(/\s+/g, ' ').slice(0, 90));
    window.closeSearchResults(true); await wait(80);
    await window.openProduct(); await wait(300);
    check('у позиции каталога есть примечание', Boolean($('#modalBody input[name=note]')));
    check('примечание необязательное и идёт после цены', !$('#modalBody label.req input[name=note]')
      && (($('#modalBody input[name=price]').compareDocumentPosition($('#modalBody input[name=note]')) & window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0));
    window.closeModal(); await wait(120);
    window.openPriceImport(null, 'ours'); await wait(300);
    check('при загрузке прайса выбирается режим: обновить или заменить целиком', /Обновить цены и добавить новые/.test($('#modalBody').textContent) && /Заменить прайс целиком/.test($('#modalBody').textContent), $('#modalBody').textContent.replace(/\s+/g, ' ').slice(0, 120));
    check('объяснено, что позиции ищутся по артикулу и не удаляются', /по артикулу/.test($('#modalBody').textContent) && /в архив/.test($('#modalBody').textContent));
    window.closeModal(); await wait(120);
  }

  // ── дашборд и внимание ───────────────────────────────────────────────────
  window.go('dashboard'); await wait(350);
  // либо блок внимания с цифрами, либо спокойная плашка «Всё под контролем»
  check('дашборд показывает состояние дел без лишнего шума', /Требует внимания|Всё под контролем/.test($('#view').innerHTML));
  check('карточки внимания: сегодня, просрочено, чаты', $('#view .attn-card.today') && $('#view .attn-card.warn') && $('#view .attn-card.chat'));
  check('дашборд содержит кликабельные KPI', $$('#view .clickable-card, #view .kpi[onclick]').length >= 4);
  {
    const dash = $('#view').innerHTML;
    check('на рабочем столе «Мои задачи» стоят выше ленты событий', dash.indexOf('Мои задачи') > -1 && dash.indexOf('Мои задачи') < dash.indexOf('Последние события компании'));
    check('блока «Быстрые действия» на рабочем столе нет', !/Быстрые действия/.test(dash));
    check('лента событий объясняет, зачем она', /недавно меняли коллеги/.test($('#view').textContent));
  }

  // ── тема и меню пользователя ─────────────────────────────────────────────
  const themeBefore = window.document.documentElement.dataset.theme;
  window.toggleTheme(); await wait(60);
  check('переключение темы меняет data-theme или сохраняет выбор', window.document.documentElement.dataset.theme !== themeBefore || window.localStorage.getItem('karkas_theme'));
  window.localStorage.removeItem('karkas_theme'); window.applyTheme('auto');
  check('кнопка темы содержит SVG', Boolean($('#themeBtn svg')));
  check('меню пользователя в DOM', Boolean($('#userMenu')));
  window.toggleUserMenu(); await wait(100);
  check('меню пользователя раскрывается', !$('#userMenu').classList.contains('hidden'));
  check('в меню есть Профиль, Настройки, Выйти', $('#userMenu .user-menu-item[onclick*="profile"]') && $('#userMenu .user-menu-item[onclick*="settings"]') && $('#userMenu .user-menu-item[onclick*="logout"]'));
  window.closeUserMenu();

  // ── пароль: глазок и помощники ───────────────────────────────────────────
  const pwInput = $('#loginForm [name=password]');
  window.togglePass($('#loginEye'));
  check('глазок показывает пароль', pwInput.type === 'text');
  window.togglePass($('#loginEye'));
  check('повторный клик глазка скрывает пароль', pwInput.type === 'password');
  check('проверка токена отбрасывает не-ASCII значения', window.isAscii('valid_token_123') && !window.isAscii('bad_token_\u0000_тест'));
  check('endSession определён', typeof window.endSession === 'function');
  check('normalizeDue/taskDueMeta работают', window.normalizeDue('сегодня 14:00').includes('14:00') && window.normalizeDue('15.10.2026 18:30') === '2026-10-15 18:30' && window.taskDueMeta('2020-01-01 10:00', false).overdue === true);

  // ── бренд, логотип, фавикон ──────────────────────────────────────────────
  const favRes = await fetch(BASE + '/favicon.svg');
  check('/favicon.svg отдаёт векторный лист', favRes.status === 200 && (favRes.headers.get('content-type') || '').includes('svg'));
  const favIco = await fetch(BASE + '/favicon.ico', { redirect: 'manual' });
  check('прежний /favicon.ico уводит на вектор', favIco.status === 301 && favIco.headers.get('location') === '/favicon.svg');
  check('бренд: Каркас + CRM', $('.brand-part-karkas')?.textContent === 'Каркас' && $('.brand-part-crm')?.textContent === 'CRM');
  check('клик по бренду ведёт на дашборд', ($('aside .brand')?.getAttribute('onclick') || '').includes("go('dashboard')"));
  check('лист и слово CRM оранжевые постоянно', Boolean($('.brand svg.brand-leaf use')) && cssText.includes('.brand-leaf{width:32px;height:30px;color:var(--orange)') && cssText.includes('.brand-part-crm{color:var(--orange)}'));
  check('лист на странице входа тоже векторный, цвет не перебит', Boolean($('.brand-login svg.brand-leaf use')) && !/\.brand-login \.brand-leaf\{color:/.test(cssText));
  check('фото-логотипа в интерфейсе не осталось', !$('img[src*="logo"]'));
  check('слово Каркас нейтральное и подсвечивается при наведении', cssText.includes('.brand:hover .brand-part-karkas') && cssText.includes('.brand-login:hover .brand-part-karkas') && !cssText.includes('.brand:hover .brand-part-crm'));

  check('вход: логотип над названием и подсказка о доступе', cssText.includes('.login-card .brand-login{flex-direction:column') && $('.login-note')?.textContent.includes('администратор'));
  await window.openUser();
  const userForm = $('#modalBody form');
  window.generateUserPassword(userForm);
  const firstPassword = userForm.elements.password.value;
  window.generateUserPassword(userForm);
  check('генератор выдаёт разные длинные пароли', firstPassword.length === 20 && userForm.elements.password.value.length === 20 && firstPassword !== userForm.elements.password.value);
  window.closeModal();

  // ── безопасность и заголовки ─────────────────────────────────────────────
  const root = await fetch(BASE + '/');
  check('выставлен Content-Security-Policy', (root.headers.get('content-security-policy') || '').includes("default-src 'self'"));
  check('встраивание в чужие фреймы запрещено', root.headers.get('x-frame-options') === 'DENY');
  const jsHead = await fetch(BASE + '/app.js');
  check('скрипты не кэшируются (no-store)', (jsHead.headers.get('cache-control') || '').includes('no-store'));

  // ── интерфейс реагирует на клики, а не только на прямые вызовы ───────────
  {
    window.go('settings'); await wait(600);
    // Первая панель .tabs в разделе — вкладки настроек; внутри тела бывают свои
    // панели (например, справочник встроенных полей), их кнопки сюда не относятся.
    const settingsTabsBar = $('#view .tabs');
    const settingsTabs = settingsTabsBar ? Array.from(settingsTabsBar.querySelectorAll('button')).map(b => b.textContent.trim()) : [];
    check('вкладки настроек идут по пути настройки: каналы → воронка → правила → поля → сообщения → разведка → люди → данные → профиль',
      settingsTabs.join(' → ') === 'Интеграции и каналы → Воронки и этапы → Автоматизации → Поля карточек → Шаблоны сообщений → Конкуренты и источники → Команда → Данные и компания → Профиль',
      settingsTabs.join(' → '));
    $$('.tabs button').find(b => /^Команда$/.test(b.textContent.trim())).click(); await wait(500);
    check('вкладка настроек переключается кликом', window.__state.settingsTab === 'team' && /Права ролей/.test($('#view').textContent));
    $$('.tabs button').find(b => /^Профиль$/.test(b.textContent.trim())).click(); await wait(400);
    check('в профиле есть тема и смена пароля', window.__state.settingsTab === 'profile' && /Тема оформления/.test($('#view').textContent) && Boolean($('#view form [name=new_password]')));

    window.go('tasks'); await wait(450);
    $$('#view .tabs button').find(b => /Неделя/.test(b.textContent)).click(); await wait(450);
    check('переключатель «Неделя» показывает календарь', window.__state.taskView === 'week' && Boolean($('#view .calendar')));
    $$('#view .tabs button').find(b => /Список/.test(b.textContent)).click(); await wait(450);
    $$('#view .tabs button').find(b => /^Все \(/.test(b.textContent.trim())).click(); await wait(450);
    check('переключатель «Все» показывает задачи команды', window.__state.taskScope === 'all');

    window.go('pipe'); await wait(450);
    $$('#view .tabs button').find(b => /^Мои \(/.test(b.textContent.trim())).click(); await wait(450);
    check('фильтр «Мои» на доске сделок работает кликом', window.__state.dealScope === 'mine');
    $$('#view .tabs button').find(b => /^Все сделки$/.test(b.textContent.trim())).click(); await wait(450);

    window.go('contacts'); await wait(450);
    const src = $$('#view select').find(x => /Все источники/.test(x.textContent));
    src.value = 'site'; src.dispatchEvent(new window.Event('change', { bubbles: true })); await wait(450);
    check('фильтр источника в контактах применяется кликом', window.__state.contactFilter.source === 'site');
    $$('#view button').find(b => /Сбросить/.test(b.textContent)).click(); await wait(400);
    check('фильтр контактов сбрасывается', !window.__state.contactFilter.source);

    window.go('inbox'); await wait(450);
    const convRow = $('#convList .conv');
    convRow.click(); await wait(400);
    check('клик по диалогу открывает его', window.__state.conv !== null && Boolean($('#chatMsgs')));

    window.go('competitors'); await wait(450);
    await window.openCompetitorCard(id); await wait(350);
    $$('#modalBody .tabs button').find(b => /Сравнение цен/.test(b.textContent)).click(); await wait(450);
    check('вкладка карточки конкурента переключается кликом', window.__state.compTab === 'prices' && /Сравнение с нашим прайс-листом/.test($('#modalBody').textContent), $('#modalBody').textContent.replace(/\s+/g, ' ').slice(0, 90));
    window.closeModal();

    await window.openDealCard(dealId); await wait(400);
    $$('#modalBody .tabs button').find(b => /^Заметки/.test(b.textContent.trim())).click(); await wait(450);
    check('вкладка карточки сделки переключается кликом', window.__state.dealTab === 'notes' && /Новая заметка/.test($('#modalBody').textContent));
    await apiPost('/api/notes', { entity_type: 'deals', entity_id: dealId, body: 'Заметка для проверки' });
    await window.openDealCard(dealId); await wait(500);
    check('заметку можно изменить, а не только удалить', /Заметка для проверки/.test($('#modalBody').textContent) && /Изменить/.test($('#modalBody').textContent));
    $$('#modalBody button').find(b => /Изменить/.test(b.textContent)).click(); await wait(450);
    check('«Изменить» открывает текст заметки для правки', $('#modalBody textarea[name=body]')?.value === 'Заметка для проверки');
    window.closeModal();
  }

  // ── настройки: воронки, автоматизации, данные, команда ───────────────────
  window.__state.settingsTab = 'pipelines'; window.go('settings'); await wait(450);
  {
    const card = $('#view .pipe-card');
    check('воронка показана карточкой с этапами и числом сделок', Boolean(card) && /этапов · сделок:/.test(card.textContent));
    const actions = card && card.querySelector('.pipe-actions');
    check('кнопки управления воронкой — справа в карточке', Boolean(actions) && Boolean(actions.querySelector('button')) &&
      (card.querySelector('.pipe-main').compareDocumentPosition(actions) & window.Node.DOCUMENT_POSITION_FOLLOWING) > 0);
    check('кнопка справа подписана «Редактировать»', /Редактировать/.test(actions.textContent));
    check('тип этапа виден в карточке воронки', /успех|отказ/.test(card.textContent));
  }
  window.__state.settingsTab = 'automations'; window.go('settings'); await wait(700);
  {
    const bad = await fetch(BASE + '/api/automations', { method: 'POST', headers: authH(), body: JSON.stringify({ name: 'Плохое правило', trigger_type: 'deal_created', action_type: 'change_stage', action_value: 'этапа-нет' }) });
    const badBody = await bad.json();
    check('правило с несуществующим этапом не сохраняется', bad.status === 400 && /Такого этапа нет/.test(badBody.error || ''), badBody.error);
    const empty = await fetch(BASE + '/api/automations', { method: 'POST', headers: authH(), body: JSON.stringify({ name: 'Без значения', trigger_type: 'deal_created', action_type: 'create_task' }) });
    check('правило без значения действия отклоняется с понятным текстом', empty.status === 400 && /Напишите текст задачи/.test((await empty.json()).error || ''));
    const ok = await fetch(BASE + '/api/automations', { method: 'POST', headers: authH(), body: JSON.stringify({ name: 'Новый лид — позвонить', trigger_type: 'deal_created', action_type: 'create_task', action_value: 'Позвонить клиенту', active: 1 }) });
    check('понятное правило сохраняется', ok.status === 201);
    window.go('settings'); await wait(450);
    check('в списке правил событие и действие написаны по-человечески', /Появилась новая сделка/.test($('#view').textContent) && /Создать задачу «Позвонить клиенту»/.test($('#view').textContent), $('#view').textContent.replace(/\s+/g, ' ').slice(0, 120));
    check('у правила есть выключатель и кнопки изменения', Boolean($('#view input[type=checkbox]')) && /Изменить/.test($('#view').textContent));
    check('правила «что CRM делает сама» живут в автоматизациях', /Что CRM делает сама/.test($('#view').textContent) && Boolean($('#view select[name=AUTO_DEAL]')) && Boolean($('#view select[name=AUTO_ASSIGN]')), $('#view').textContent.replace(/\s+/g, ' ').slice(0, 120));
    check('список своих правил подписан отдельно от постоянных правил', /Свои правила \(/.test($('#view').textContent));
    await window.openAutomation(); await wait(350);
    check('в форме правила этап выбирается из списка воронки', Boolean($('#modalBody select[name=action_type]')) && /Создать задачу/.test($('#modalBody').textContent));
    $('#modalBody select[name=action_type]').value = 'change_stage';
    $('#modalBody select[name=action_type]').dispatchEvent(new window.Event('change', { bubbles: true })); await wait(80);
    check('при выборе «перевести на этап» появляется список этапов', Boolean($('#autoActionValue select[name=action_value]')) && $$('#autoActionValue option').length >= 2);
    window.closeModal();
    // правило с выдержкой: действие должно попасть в список запланированных,
    // иначе сотрудник не узнает, что CRM собирается сделать через три дня
    const txt0 = $('#view').textContent;
    check('в подсказке объяснены все действия правил', ['Создать задачу', 'Перевести на этап', 'Добавить тег', 'Отправить сообщение', 'Отправить письмо', 'Передать сделку', 'Выдержка'].every(w => txt0.includes(w)), ['Создать задачу', 'Перевести на этап', 'Добавить тег', 'Отправить сообщение', 'Отправить письмо', 'Передать сделку', 'Выдержка'].filter(w => !txt0.includes(w)).join(','));
    check('в подсказке названы подстановки имени клиента и сделки', txt0.includes('{name}') && txt0.includes('{deal}') && txt0.includes('{sum}') && txt0.includes('{company}'));
    const q0 = await window.api('/api/automation-queue');
    check('при пустой очереди блок запланированных действий не показывается', q0.length === 0 && !/Запланированные действия \(/.test(txt0), 'в очереди ' + q0.length + ' шт.');

    await window.api('/api/automations', { method: 'POST', body: JSON.stringify({ name: 'Отложить напоминание', trigger_type: 'stage_changed', trigger_value: 'offer', action_type: 'create_task', action_value: 'Позвонить позже', active: 1, delay_days: 3 }) });
    const cq = await window.api('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Очередь Тест', phone: '+7 900 000-00-01' }) });
    const dq = await window.api('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Сделка очереди', amount: 1000, stage: 'new', contact_id: cq.id }) });
    await window.api('/api/deals/' + dq.id, { method: 'PATCH', body: JSON.stringify({ stage: 'offer' }) });
    window.__state.settingsTab = 'automations'; window.go('settings'); await wait(700);
    const txt1 = $('#view').textContent;
    check('запланированное действие видно в настройках', /Запланированные действия \(1\)/.test(txt1) && txt1.includes('Отложить напоминание'), txt1.replace(/\s+/g, ' ').slice(0, 180));
    check('у запланированного действия названы срок, сделка и суть', txt1.includes('Позвонить позже') && txt1.includes('Сделка очереди') && /\d{2}\.\d{2}\.\d{4}/.test(txt1));
    check('запланированное действие можно отменить', typeof window.cancelQueued === 'function' && $$('#view button').some(b => /Отменить/.test(b.textContent)));
    check('выдержка видна и в самом правиле', /через 3 дн\./.test(txt1), txt1.replace(/\s+/g, ' ').match(/.{0,60}дн\./)?.[0] || '');
  }
  window.__state.settingsTab = 'data'; window.go('settings'); await wait(700);
  {
    check('в разделе данных нет сворачиваемого блока про другой сервер', !$('#view details.settings-more') && !/Копии на другом сервере/.test($('#view').textContent));
    check('срок и час ночной копии настраиваются в разделе данных', /Хранить копии, дней/.test($('#view').textContent) && /Час создания копии/.test($('#view').textContent));
    check('в данных компании нет автоправил — они во вкладке «Автоматизации»', !$('#view select[name=AUTO_DEAL]') && !$('#view select[name=AUTO_ASSIGN]') && /во вкладке «Автоматизации»/.test($('#view').textContent), $('#view').textContent.replace(/\s+/g, ' ').slice(0, 140));
  }
  window.__state.settingsTab = 'team'; window.go('settings'); await wait(500);
  {
    check('в команде виден последний вход сотрудника', /Последний вход/.test($('#view').textContent) && !/ещё не входил/.test($('#view').textContent), $('#view').textContent.replace(/\s+/g, ' ').slice(0, 80));
    check('в команде есть поиск по людям', Boolean($('#teamSearch')));
    check('права ролей объяснены простыми словами', /Наблюдатель/.test($('#view').textContent) && /Первый вход/.test($('#view').textContent));
  }
  window.__state.settingsTab = 'templates'; window.go('settings'); await wait(400);
  check('поиск есть в шаблонах', Boolean($('#tplSearch')));
  window.__state.settingsTab = 'competitors'; window.go('settings'); await wait(450);
  {
    const st = $('#view').textContent.replace(/\s+/g, ' ');
    check('в настройках разведки нет второго управления прайсом', !/Скачать CSV/.test(st) && !/Загрузить из файла/.test(st) && !/Показать весь прайс/.test(st), st.slice(0, 140));
    check('настройки разведки ведут за ценами в раздел «Каталог»', /«Каталог»/.test(st) && /Открыть каталог/.test(st) && Boolean($$('#view button').find(b => /Открыть каталог/.test(b.textContent))));
    check('объяснено, что ключи источников не обязательны', /не обязательны/.test(st) && /работает без ключа/.test(st));
    check('в настройках сказано, что официального API ФССП больше нет', /API ФССП закрыт/.test(st) && /банк исполнительных производств/.test(st));
    check('в настройках нет мёртвого поля токена ФССП', !/Токен ФССП/.test(st) && !/FSSP_TOKEN/.test($('#view').innerHTML));
    check('источники без рабочего API помечены как ручные', /данные по ссылке вручную/.test(st));
    check('для Google сохранена подсказка про действующий Places API (New)', /Places API \(New\)/.test(appJsRaw));
    check('есть проверка доступности источников', /Проверить доступность источников/.test(st));
  }

  // ── поиск есть в каждом разделе со списком ───────────────────────────────
  for (const [view, sel] of Object.entries({ contacts: '#contactSearch', companies: '#companySearch', products: '#productSearch', tasks: '#taskSearch', pipe: '#dealSearch', inbox: '#convSearch', competitors: '#compFilter' })) {
    window.go(view); await wait(400);
    check('поиск в разделе «' + view + '»', Boolean($(sel)), sel);
  }
  // ввод в каждое поле поиска: именно здесь человек видит «... is not a function»,
  // если обработчик ссылается на несуществующую функцию
  for (const [view, sel, text] of [['contacts', '#contactSearch', 'Ирина'], ['companies', '#companySearch', 'Строй'], ['products', '#productSearch', 'Баня'], ['tasks', '#taskSearch', 'Позвонить'], ['pipe', '#dealSearch', 'Дом'], ['inbox', '#convSearch', 'Ирина'], ['competitors', '#compFilter', 'Брус']]) {
    window.go(view); await wait(420);
    const input = $(sel);
    if (!input) { check('поле поиска «' + view + '» принимает ввод', false, 'нет ' + sel); continue }
    pageErrors.length = 0;
    input.value = text;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await wait(500);
    check('поиск в «' + view + '» фильтрует список без ошибок', pageErrors.length === 0 && $(sel) && $(sel).value === text, pageErrors.join(' | ').slice(0, 100));
  }
  for (const [tab, sel] of [['team', '#teamSearch'], ['templates', '#tplSearch']]) {
    window.__state.settingsTab = tab; window.go('settings'); await wait(450);
    const input = $(sel);
    if (!input) { check('поле поиска «' + tab + '» принимает ввод', false, 'нет ' + sel); continue }
    pageErrors.length = 0;
    input.value = 'а';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await wait(500);
    check('поиск в «' + tab + '» фильтрует список без ошибок', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 100));
  }
  ['taskQuery', 'dealQuery', 'companyQuery', 'productQuery', 'compQuery', 'teamQuery', 'tplQuery'].forEach(k => { window.__state[k] = '' });
  window.__state.contactFilter = {};
  window.__state.settingsTab = 'integrations';
  window.go('dashboard'); await wait(300);

  // ── тёмная тема и шрифты ─────────────────────────────────────────────────
  {
    const sizes = [...cssText.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].map(m => +m[1]);
    check('мелкого шрифта не осталось: всё не меньше 11.5px', sizes.length > 20 && Math.min(...sizes) >= 11.5, 'минимум ' + Math.min(...sizes) + 'px из ' + sizes.length);
    check('гарнитура задана переменной и не меняется от темы', cssText.includes('--font-ui') && cssText.includes('font:14px/1.55 var(--font-ui)') && !/data-theme=dark[^{]*\{[^}]*font-family/.test(cssText));
    check('в тёмной теме видно, какая вкладка настроек активна', cssText.includes('html[data-theme=dark] .tabs button.active{background:var(--green)') && cssText.includes('html[data-theme=dark] .tabs button.active:hover{color:#04170c}'));
    check('в тёмной теме непрочитанный диалог остаётся заметным', cssText.includes('html[data-theme=dark] .conv.unread{background:rgba(249,115,22,.09)}'));
    check('в тёмной теме докрашены каналы, приоритеты и цветные плашки',
      ['html[data-theme=dark] .chan{', 'html[data-theme=dark] .prio.high{', 'html[data-theme=dark] .card.tint-info{', 'html[data-theme=dark] pre.code-block{'].every(x => cssText.includes(x)));
    check('в интерфейсе не осталось разноцветных inline-плашек', !/background:#f0fdf4|background:#fff7ed|background:#fffbeb/.test(appJsRaw));
  }

  // ── роли ─────────────────────────────────────────────────────────────────
  await apiPost('/api/users', { name: 'Менеджер Тест', email: 'mgr_ui@example.com', password: 'password123', role: 'manager' });
  let mgrLogin = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'mgr_ui@example.com', password: 'password123' }) })).json();
  // временный пароль обязывает сменить его при первом входе: без этого любой
  // запрос менеджера отвечал 403 и проверки прав теряли смысл
  if (mgrLogin.user?.must_change_password) {
    const ch = await (await fetch(BASE + '/api/me/password', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mgrLogin.token }, body: JSON.stringify({ old_password: 'password123', new_password: 'password1234' }) })).json();
    mgrLogin = { ...mgrLogin, token: ch.token };
  }
  const mgrToken = mgrLogin.token;
  check('менеджер создаётся и входит', !!mgrToken);
  const set403 = await fetch(BASE + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mgrToken }, body: JSON.stringify({ COMPANY_NAME: 'Hack' }) });
  check('менеджеру запрещено менять настройки (403)', set403.status === 403);
  const logoGone = await fetch(BASE + '/api/logo', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mgrToken }, body: JSON.stringify({}) });
  check('загрузка фото-логотипа больше не существует (404)', logoGone.status === 404);
  await apiPost('/api/users', { name: 'Наблюдатель Тест', email: 'view_ui@example.com', password: 'password123', role: 'viewer' });
  const viewLogin = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'view_ui@example.com', password: 'password123' }) })).json();
  const view403 = await fetch(BASE + '/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + viewLogin.token }, body: JSON.stringify({ name: 'Hack' }) });
  check('наблюдатель не может создавать записи (403)', view403.status === 403);
  const auto403 = await fetch(BASE + '/api/automations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mgrToken }, body: JSON.stringify({ name: 'Правило менеджера' }) });
  check('менеджеру запрещено создавать автоматизации (403)', auto403.status === 403);

  // ── настройки команды глазами менеджера ──────────────────────────────────
  const admin = window.__state.me;
  window.__state.me = { id: 99, name: 'Менеджер', role: 'manager' };
  window.go('settings'); await wait(350);
  const mSet = $('#view').innerHTML;
  check('менеджер видит только доступные вкладки настроек', /Мой профиль/.test(mSet) && !/Интеграции и каналы/.test(mSet) && !/>Команда</.test(mSet) && !/>Воронки и этапы</.test(mSet));
  window.go('competitors'); await wait(400);
  check('менеджер видит прайс-лист и может проверять конкурентов', /Наш прайс-лист/.test($('#view').textContent) && /Найти и проверить/.test($('#view').textContent));
  const mgrOurs = await fetch(BASE + '/api/prices', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mgrToken }, body: JSON.stringify({ scope: 'ours', text: 'Дом;1000000;шт' }) });
  check('менеджер не может менять прайс-лист (403)', mgrOurs.status === 403);
  window.go('products'); await wait(420);
  check('менеджер видит прайс-лист без кнопок загрузки и удаления', !/Загрузить из файла/.test($('#view').textContent) && $$('#view .btn.danger').length === 0 && !/\+ Товар \/ проект/.test($('#view').textContent), $('#view').textContent.replace(/\s+/g, ' ').slice(0, 120));
  check('менеджеру объяснено, где взять позицию без каталога', /Добавьте её прямо в сделку/.test($('#view').textContent));
  await window.openProduct(); await wait(300);
  check('форма позиции у менеджера открывается на просмотр', Boolean($('#modalBody form input[name=name]')) && $('#modalBody form input[name=name]').disabled === true && /Прайс-лист меняет администратор/.test($('#modalBody').textContent));
  window.closeModal(); await wait(120);

  window.__state.me = { id: 98, name: 'Наблюдатель', role: 'viewer' };
  window.document.body.classList.add('role-viewer');
  window.go('contacts'); await wait(450);
  check('наблюдателю объяснено, что он только читает', /Режим просмотра/.test($('#view').textContent));
  check('наблюдатель не видит кнопок создания и удаления клиентов', !/Новый контакт/.test($('#view').innerHTML) && $$('#view .btn.danger').length === 0);
  window.go('tasks'); await wait(450);
  check('наблюдатель видит задачи без кнопок изменения', /Задач:/.test($('#view').textContent) && $$('#view .taskrow .btn').length === 0);
  window.go('inbox'); await wait(450);
  check('наблюдатель читает чаты без поля отправки', !$('#msgText') && /Режим просмотра/.test($('#view').textContent));
  check('в шапке наблюдателя кнопки создания скрыты', cssText.includes('body.role-viewer .head-create{display:none}') && cssText.includes('body.role-viewer .head-readonly{display:inline-block}'));
  window.closeModal();
  window.__state.me = admin; window.document.body.classList.remove('role-viewer');
  window.__state.settingsTab = 'integrations';

  // ── телефон: список диалогов и чат показываются по отдельности ───────────
  // на узком экране оба блока сразу не помещаются, поэтому работает кнопка «Назад»
  window.go('inbox'); await wait(450);
  check('в шапке чата есть возврат к списку: на телефоне виден, на десктопе скрыт',
    Boolean($('.chat-back')) && cssText.includes('.chat-back{display:none') && /max-width:900px[\s\S]{0,1200}\.chat-back\{display:inline-flex/.test(cssText));
  {
    const convs = window.__state.cache.convs || [];
    if (convs.length) {
      window.closeConv(); await wait(350);
      check('по кнопке «Назад» открывается список диалогов', window.__state.listOnly === true && Boolean($('.inbox.list-only')));
      window.openConv(convs[0].id); await wait(350);
      check('выбранный диалог снова открывает чат', window.__state.listOnly === false && !$('.inbox.list-only'));
    } else check('для проверки возврата к списку нужен хотя бы один диалог', false, 'диалогов нет');
  }

  // ── форма для сайта, скелетоны ───────────────────────────────────────────
  const code = window.siteFormCode();
  check('код формы для сайта ссылается на вебхук', /webhooks\/generic/.test(code) && /sendToKarkas/.test(code));
  check('скелетоны описаны для всех разделов', ['dashboard', 'pipe', 'inbox', 'contacts', 'tasks', 'analytics', 'competitors', 'settings'].every(v => typeof window.SKELETONS?.[v] === 'function'));

  // ── даты в формате СНГ и цифры KPI отдельной строкой ────────────────────
  check('дата показывается как дд.мм.гггг', window.dateText('2026-10-20') === '20.10.2026' && window.dateText('2026-10-20 09:30') === '20.10.2026 09:30');
  check('месяц записан как 10.2026, а подсказка по-русски', window.monthShort('2026-10') === '10.2026' && window.monthText('2026-10') === 'октябрь 2026');
  check('в дашборде и KPI нет сырых ISO-дат', !/\b20\d{2}-\d{2}-\d{2}\b/.test($('#view').textContent));
  window.go('analytics'); await wait(500);
  {
    const kpi = $$('#view .kpi').map(k => ({ title: k.querySelector('span')?.textContent.trim() || '', value: k.querySelector('b')?.textContent.trim() || '', note: [...k.querySelectorAll('small')].map(s2 => s2.textContent.trim()).join(' ') }));
    const plan = kpi.find(k => /Продано|План/i.test(k.title));
    check('в аналитике крупная цифра — факт продаж, план — подписью', Boolean(plan) && /₽/.test(plan.value) && /план/i.test(plan.note), JSON.stringify(plan));
    check('месяц в плане — в формате 10.2026', Boolean(plan) && /\b(0[1-9]|1[0-2])\.20\d{2}\b/.test(plan.title), plan && plan.title);
    check('подпись KPI не приклеена к цифре', kpi.every(k => !/\d\s?₽.*(?:успешных|план)/.test(k.value)));
  }
  window.go('dashboard'); await wait(400);

  // ── health без признака демонстрационных данных ──────────────────────────
  const h = await (await fetch(BASE + '/api/health')).json();
  check('health: версия из VERSION, без признака demo', h.version === VERSION && h.demo === undefined && h.schema >= 3, JSON.stringify({ v: h.version, want: VERSION, demo: h.demo }));

  // ── отсутствие эмодзи и версионного/демо-мусора в продукте ───────────────
  check('эмодзи нет в index.html', !hasEmojis(html));
  check('эмодзи нет в app.js', !hasEmojis(appJsRaw));
  check('эмодзи нет в style.css', !hasEmojis(cssText));
  check('эмодзи нет в server.js', !hasEmojis(serverJsRaw));
  check('эмодзи нет в competitors.js', !hasEmojis(competitorsJsRaw));
  const productText = html + appJsRaw + cssText;
  check('в интерфейсе нет технического мусора seed', !/SEED_DEMO|seed-demo/.test(productText));
  check('в интерфейсе нет номеров версий и патчей', !/2\.9|v2\.\d|karkascrm-v|KarkasCRM-\d/.test(productText));
  check('в интерфейсе нет кнопки-самолётика', !/icon\('send'/.test(appJsRaw));
  check('в интерфейсе нет пользовательского симулятора входящих', !/simulate\(\)/.test(appJsRaw));

  // ── упаковка ─────────────────────────────────────────────────────────────
  let isPackExec = false;
  try { accessSync(join(ROOT, 'scripts/pack.sh'), constants.X_OK); isPackExec = true } catch {}
  check('scripts/pack.sh исполняемый', isPackExec);
  const dlGone = await fetch(BASE + '/downloads/KarkasCRM-2.9.zip');
  check('версионные архивы не раздаются как файлы (неизвестные пути отдают SPA)', dlGone.status === 200 && (dlGone.headers.get('content-type') || '').includes('text/html'));

  // ── единый движок SVG-иконок ─────────────────────────────────────────────
  check('window.icon определён и рисует SVG', typeof window.icon === 'function' && window.icon('dashboard', 18).includes('<svg') && window.icon('dashboard', 18).includes('width="18"'));
  check('в навигации не меньше девяти SVG-иконок', $$('#nav button .nav-ico svg').length >= 9);

  // ── русские наименования вместо технических кодов ────────────────────────
  check('sourceLabel переводит коды источников', window.sourceLabel('avito') === 'Авито' && window.sourceLabel('wazzup-whatsapp') === 'WhatsApp (Wazzup)' && window.sourceLabel('manual') === 'Вручную');
  check('channelLabel переводит каналы', window.channelLabel('email') === 'Почта' && window.channelLabel('whatsapp') === 'WhatsApp' && window.channelLabel('any') === 'Любой канал');
  check('roleLabel переводит роли', window.roleLabel('manager') === 'Менеджер' && window.roleLabel('viewer') === 'Наблюдатель');
  check('транслит кириллицы даёт технический ключ поля', window.translit('Площадь участка') === 'ploschad_uchastka');
  // ── ни один обработчик в разметке не зовёт несуществующую функцию ─────────
  // именно так выглядит поломка глазами человека: клик — и ошибка в консоли
  {
    const HANDLER_RE = /\son[a-z]+=\\?"([^"]+)"/g;
    const handlers = [...appJsRaw.matchAll(HANDLER_RE), ...html.matchAll(HANDLER_RE)].map(m => m[1]);
    const BUILTIN = new Set(['if', 'return', 'typeof', 'new', 'delete', 'void', 'await', 'async', 'function',
      'document', 'window', 'event', 'this', 'Number', 'String', 'Boolean', 'JSON', 'Math', 'Date', 'Array', 'Object',
      'parseInt', 'parseFloat', 'isNaN', 'encodeURIComponent', 'decodeURIComponent', 'setTimeout', 'clearTimeout',
      'setInterval', 'Promise', 'RegExp', 'URL', 'Blob', 'FileReader', 'AbortSignal', 'console', 'location', 'fetch']);
    const declared = new Set([...appJsRaw.matchAll(/^(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
    const called = new Set();
    for (const h of handlers) {
      // имя функции без точки перед ним: вызовы методов (document.getElementById) не наши
      for (const m of h.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
        if (BUILTIN.has(m[1])) continue;
        called.add(m[1]);
      }
    }
    const missing = [...called].filter(n => typeof window[n] !== 'function' && !declared.has(n));
    check('все обработчики в разметке вызывают существующие функции', missing.length === 0, missing.length ? 'не найдено: ' + missing.join(', ') : `проверено ${called.size} имён в ${handlers.length} обработчиках`);
  }

  // технический сбой не должен показываться человеку как «$$(...).find is not a function»
  $('#toast').replaceChildren();
  window.toast('$$(...).find is not a function', 'err'); await wait(80);
  check('технический сбой объяснён по-человечески', /Обновите страницу/.test($('#toast').textContent) && /Действие не выполнено/.test($('#toast').textContent), $('#toast').textContent.replace(/\s+/g, ' ').slice(0, 120));
  $('#toast').replaceChildren();
  window.toast('Укажите название конкурента', 'err'); await wait(80);
  check('обычная ошибка показывается как есть', $('#toast').textContent.includes('Укажите название конкурента') && !/Обновите страницу/.test($('#toast').textContent), $('#toast').textContent.replace(/\s+/g, ' ').slice(0, 80));
  $('#toast').replaceChildren();
  check('ошибки в обработчиках кликов тоже видны пользователю', /window\.addEventListener\('error'/.test(appJsRaw));

  check('в app.js нет вызовов нативных confirm/prompt', !/\bconfirm\(\s*[`'"]/.test(appJsRaw) && !/\bprompt\(\s*[`'"]/.test(appJsRaw));

  // ── модальное окно подтверждения вместо confirm() ────────────────────────
  let confirmed = false;
  window.askConfirm('Удалить тестовую запись?', () => { confirmed = true; }, { okText: 'Удалить' });
  await wait(60);
  check('askConfirm открывает окно подтверждения', $('#modalBody').textContent.includes('Удалить тестовую запись?') && !$('#modal').classList.contains('hidden'));
  $('#askConfirmYes').click();
  await wait(60);
  check('askConfirm выполняет действие и закрывает окно', confirmed && $('#modal').classList.contains('hidden'));

  // ── модальное окно ввода вместо prompt() ─────────────────────────────────
  let inputVal = null;
  window.askInput({ title: 'Тег', label: 'Название', value: 'старый' }, v => { inputVal = v; });
  await wait(60);
  $('#askInputField').value = 'VIP-клиент';
  $('#modalBody form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(60);
  check('askInput возвращает введённое значение и закрывает окно', inputVal === 'VIP-клиент' && $('#modal').classList.contains('hidden'));

  // ── рендер источника контакта по-русски ──────────────────────────────────
  await apiPost('/api/contacts', { name: 'Авито Проверка', phone: '79001234567', source: 'avito' });
  window.go('contacts');
  for (let i = 0; i < 30 && !$('#view table'); i++) await wait(100);
  const contactsHtml = $('#view').innerHTML;
  check('источник контакта отображается русским названием', contactsHtml.includes('Авито') && !/>avito</.test(contactsHtml));
  check('в фильтре и форме контакта нет сырых кодов источников', !/value="manual"[^>]*>manual</.test(contactsHtml));

  // Широкие таблицы обёрнуты в прокручиваемый блок: без обёртки на телефоне
  // страница уезжает вбок целиком, вместе с меню и шапкой.
  for (const [view, tab, title] of [['contacts', null, 'Контакты'], ['companies', null, 'Компании'], ['products', null, 'Каталог'], ['competitors', null, 'Конкуренты'], ['settings', 'team', 'Команда']]) {
    window.go(view, tab); await wait(350);
    check(`в разделе «${title}» широкая таблица лежит внутри прокручиваемого блока`, Boolean($('#view .tbl-scroll > table')));
  }

  // ── вкладка интеграций: человеческие формулировки ────────────────────────
  window.go('settings', 'integrations');
  for (let i = 0; i < 60 && !$('#view').textContent.includes('это называется вебхук'); i++) await wait(100);
  const integText = $('#view').textContent;
  check('интеграции: вместо «Локальный режим» — «не подключено»', !integText.includes('Локальный режим') && integText.includes('не подключено'));
  // каналов у заказчика бывает по одному на сотрудника: карточка показывает их
  // число, а в список отправки по умолчанию попадают только работающие
  check('интеграции показывают число подключённых каналов', /Подключённые каналы \(/.test(integText));
  check('канал по умолчанию предлагается только из работающих', appJsRaw.includes('chans.filter(c => wzAlive(c) || c.external_id === s.wazzup.channel_id)'));
  check('интеграции: термин webhook объяснён по-русски', integText.includes('(это называется вебхук)') && integText.includes('Адрес, по которому Wazzup присылает сообщения'), integText.slice(0, 120));

  // ── адрес вебхука Wazzup: один для показа и для регистрации ──────────────
  // Wazzup делает проверочный запрос сразу при регистрации. Если показать человеку
  // адрес с кодом защиты, а зарегистрировать без него, проверка отвечает 403 и
  // вебхук не ставится — сообщения просто не приходят.
  check('адрес вебхука содержит код защиты и сохранённый публичный адрес',
    window.wazzupHookUrl({ public_url: 'https://crm.example.com/', wazzup: { webhook_secret: 'код 1' } }) === 'https://crm.example.com/webhooks/wazzup?secret=%D0%BA%D0%BE%D0%B4%201',
    window.wazzupHookUrl({ public_url: 'https://crm.example.com/', wazzup: { webhook_secret: 'код 1' } }));
  check('без кода защиты адрес вебхука остаётся чистым', window.wazzupHookUrl({ public_url: 'https://crm.example.com', wazzup: {} }) === 'https://crm.example.com/webhooks/wazzup');
  check('регистрация отправляет Wazzup тот же адрес, что показан человеку',
    /async function registerWazzupWebhook[\s\S]{0,1400}wazzupHookUrl\(st\)/.test(appJsRaw) && !/registerWazzupWebhook\(\)[^\n]{0,80}location\.origin/.test(appJsRaw));
  check('регистрация не уходит в Wazzup с несохранённым кодом защиты', /Сначала нажмите «Сохранить»/.test(appJsRaw));

  // ── кириллический домен: человеку читаемый адрес, машине — валидный ──────
  {
    const { domainToUnicode, domainToASCII } = await import('node:url');
    const cases = ['crm.xn--80aaamzedb7cml.xn--p1ai', 'xn--80akhbyknj4f.xn--p1ai', 'xn--mnchen-3ya.de', 'example.com', 'localhost'];
    const decoded = cases.map(c => c.split('.').map(window.punyDecodeLabel).join('.'));
    const refs = cases.map(c => domainToUnicode(c));
    check('декодер punycode совпадает с эталонной реализацией', decoded.every((d, i) => d === refs[i]), decoded.join(' | ') + ' ↔ ' + refs.join(' | '));
    check('продовый домен расшифровывается в читаемый', decoded[0] === 'crm.каркастайги.рф', decoded[0]);
    check('кириллический домен проходит туда и обратно', ['каркастайги', 'дом8х10', 'ёлка', 'тест-1', 'участки'].every(w => {
      const ascii = domainToASCII(w + '.рф');
      return ascii.split('.').map(window.punyDecodeLabel).join('.') === w + '.рф';
    }));
    check('человекочитаемый адрес сохраняет схему и порт', window.humanOrigin('https://crm.xn--80aaamzedb7cml.xn--p1ai') === 'https://crm.каркастайги.рф' && window.humanOrigin('http://localhost:8080') === 'http://localhost:8080');
    check('испорченный punycode не подменяется выдуманным адресом', window.humanOrigin('https://xn---abc') === 'https://xn---abc');
    check('машинный адрес вебхука остаётся в punycode: иначе Wazzup его не примет',
      window.wazzupHookUrl({ public_url: 'https://crm.xn--80aaamzedb7cml.xn--p1ai', wazzup: {} }).includes('xn--80aaamzedb7cml'));
    // расшифровка нужна только там, где адрес читает человек. Вебхук и код для
    // сайта уходят машинам: им нужен валидный домен, а не красивые буквы.
    // ── входящие из Wazzup: админ видит, доходят ли сообщения ────────────────
  await fetch(BASE + '/api/settings', { method: 'PUT', headers: authH(), body: JSON.stringify({ WAZZUP_API_KEY: 'f'.repeat(32), WAZZUP_WEBHOOK_SECRET: 'smoke-hook' }) });
  // ключ вставили, а адрес у Wazzup не зарегистрировали: в чатах пусто, и
  // человек должен видеть причину и выход, а не гадать
  window.go('inbox'); await wait(700);
  check('в чатах видна подсказка о незарегистрированном адресе', /входящий адрес этой CRM/.test($('#view').textContent), $('#view').textContent.replace(/\s+/g, ' ').slice(0, 180));
  check('подсказка ведёт в настройки одной кнопкой', /Открыть настройки/.test($('#view').textContent));
  const whTest = await fetch(BASE + '/webhooks/wazzup?secret=smoke-hook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"test":true}' });
  check('проверочный запрос Wazzup проходит', whTest.status === 200);
  const whMsg = await fetch(BASE + '/webhooks/wazzup?secret=smoke-hook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ messageId: 'smoke-wz-1', channelId: 'c1', chatType: 'whatsapp', chatId: '79000000009', type: 'text', text: 'Здравствуйте', contact: { name: 'Дым Incoming', phone: '+7 900 000-00-09' } }] }) });
  check('входящее сообщение принимается вебхуком', whMsg.status === 200);
  window.__state.settingsTab = 'integrations'; window.go('settings'); await wait(700);
  check('в карточке интеграций виден счётчик входящих', /Входящих получено: 1/.test($('#view').textContent), $('#view').textContent.replace(/\s+/g, ' ').slice(0, 160));
  window.go('inbox'); await wait(700);
  check('после первого входящего подсказка исчезает', !/входящий адрес этой CRM/.test($('#view').textContent));
  check('непрочитанный диалог помечен в списке меткой и фоном', Boolean($('.conv.unread')) && Boolean($('.conv.unread .badge')));
  check('под списком мессенджеров видно, с какого аккаунта уйдёт ответ', Boolean($('#sendAccountHint')) && /Ответ уйдёт с аккаунта|Рабочего аккаунта/.test($('#sendAccountHint').textContent), $('#sendAccountHint') ? $('#sendAccountHint').textContent : 'нет подсказки');
  // вложение в пузыре: чип с именем файла без технической подписи рядом
  check('вложение в пузыре не дублируется подписью «Вложение: …»', !window.msgHtml({ content_uri: 'https://cdn.example/f/otchet.pdf', body: 'Вложение: otchet.pdf', channel: 'maxgroup', direction: 'in' }).includes('Вложение:'));
  check('вложение без ссылки остаётся понятной строкой', window.msgHtml({ body: 'Вложение: otchet.pdf', channel: 'maxgroup', direction: 'in' }).includes('Вложение: otchet.pdf'));
  check('имя файла берётся из ссылки, когда имени нет', window.nameFromUri('https://cdn.example/files/prices%20final.pdf?x=1') === 'prices final.pdf');
  window.__state.channels = [
    { id: 1, external_id: 'w-alive', transport: 'whatsapp', state: 'active', label: 'WhatsApp — Ирина' },
    { id: 2, external_id: 'w-dead', transport: 'whatsapp', state: 'blocked', label: 'WhatsApp — склад' }
  ];
  check('ответ уходит с аккаунта, на который писал клиент', window.sendAccountFor({ channel_id: 'w-alive' }, 'whatsapp') === 'WhatsApp — Ирина');
  check('нерабочий аккаунт не подставляется, и чужой мессенджер тоже', window.sendAccountFor({ channel_id: 'w-dead' }, 'telegram') === '');
  window.__state.channels = [];
  // область диалогов «Мои»: на большой команде список всех чатов — простыня
  const realConvs = window.__state.cache.convs;
  window.__state.cache.convs = [
    { id: 9101, title: 'Мой клиент', unread: 1, assigned_id: window.__state.me.id, contact_responsible_id: null, last_body: 'привет', phone: '', channels: 'whatsapp', last_at: '2026-10-27 09:00' },
    { id: 9102, title: 'Чужой клиент', unread: 1, assigned_id: 99901, contact_responsible_id: 99902, last_body: 'здравствуйте', phone: '', channels: 'whatsapp', last_at: '2026-10-27 09:00' }
  ];
  window.setConvScope('mine'); await wait(300);
  let scopeText = $('#convList').textContent;
  check('в области «Мои» видны только свои диалоги', scopeText.includes('Мой клиент') && !scopeText.includes('Чужой клиент'), scopeText.slice(0, 140));
  check('переключатель области есть над поиском диалогов', Boolean($('.convs .tabs button')) && /Все чаты/.test($('.convs .tabs').textContent) && /Мои/.test($('.convs .tabs').textContent));
  window.setConvScope('all'); await wait(300);
  scopeText = $('#convList').textContent;
  check('область «Все чаты» возвращает полный список', scopeText.includes('Мой клиент') && scopeText.includes('Чужой клиент'));
  window.__state.cache.convs = [{ id: 9102, title: 'Чужой клиент', unread: 1, assigned_id: 99901, contact_responsible_id: 99902, last_body: 'здравствуйте', phone: '', channels: 'whatsapp', last_at: '2026-10-27 09:00' }];
  window.setConvScope('mine'); await wait(300);
  check('пустая область «Мои» объясняет, что делать', /переключитесь на «Все чаты»/.test($('#convList').textContent), $('#convList').textContent.slice(0, 120));
  window.setConvScope('all');
  window.__state.cache.convs = realConvs;
  await wait(300);
  // колокол и плашки говорят о личном, а не о всей компании сразу
  await window.openNotifications(); await wait(500);
  check('колокол показывает личные списки и объясняет компанию админу', /Мои просроченные задачи/.test($('#modalBody').textContent) && /Мои чаты без ответа/.test($('#modalBody').textContent), $('#modalBody').textContent.replace(/\s+/g, ' ').slice(0, 160));
  window.closeModal(); await wait(200);
  check('плашки дашборда считают личное', appJsRaw.includes('Мои непрочитанные чаты') && appJsRaw.includes('d.myTasksToday') && /navTasks.*myTasksOpen/.test(appJsRaw));
  // поле дублирования для второй CRM (параллельная работа с amoCRM)
  check('в карточке есть поле дублирования входящих', appJsRaw.includes('id="wzForward"') && appJsRaw.includes('WAZZUP_FORWARD_URL'));

  // недоступные каналы скрыты, но показываются одной кнопкой
  window.__state.settingsTab = 'integrations'; window.go('settings'); await wait(700);
  const realApi = window.api;
  window.__state.channels = []; // иначе настройка возьмёт список из кэша и подмена не сработает
  window.api = (pth, opt) => pth === '/api/channels' ? Promise.resolve([
    { id: 90001, provider: 'wazzup', external_id: 'w-alive', state: 'active', transport: 'whatsapp', name: '+79000000901' },
    { id: 90002, provider: 'wazzup', external_id: 'w-dead', state: 'blocked', transport: 'whatsapp', name: '+79000000902' }
  ]) : realApi(pth, opt);
  window.go('settings'); await wait(700);
  let chanText = $('#view').textContent.replace(/\s+/g, ' ');
  check('нерабочие каналы не показаны, а их число названо', chanText.includes('+79000000901') && !chanText.includes('+79000000902') && /Недоступных скрыто: 1/.test(chanText), [chanText.includes('+79000000901'), chanText.includes('+79000000902'), /Недоступных скрыто: 1/.test(chanText), /Показать недоступные/.test(chanText)].join('|'));
  window.toggleDeadChannels(); await wait(700);
  chanText = $('#view').textContent.replace(/\s+/g, ' ');
  check('кнопка показывает скрытые каналы вместе с причиной', chanText.includes('+79000000902') && /Скрыть недоступные \(1\)/.test(chanText), chanText.slice(Math.max(0, chanText.indexOf('Подключённые каналы')), Math.max(0, chanText.indexOf('Подключённые каналы')) + 1600));
  window.toggleDeadChannels(); await wait(700);
  chanText = $('#view').textContent.replace(/\s+/g, ' ');
  check('второе нажатие снова убирает нерабочие каналы', !chanText.includes('+79000000902') && /Показать недоступные \(1\)/.test(chanText), [chanText.includes('+79000000902'), /Показать недоступные \(1\)/.test(chanText), /Скрыть недоступные/.test(chanText)].join('|'));
  window.api = realApi;
  check('код формы для сайта и адрес вебхука не расшифровываются',
      !/function siteFormCode[\s\S]{0,800}humanOrigin/.test(appJsRaw) && !/function wazzupHookUrl[\s\S]{0,400}humanOrigin/.test(appJsRaw));
    check('человекочитаемый адрес применяется только в данных для входа', (appJsRaw.match(/humanOrigin\(/g) || []).length === 2, String((appJsRaw.match(/humanOrigin\(/g) || []).length));
  }

  // ── телефонная вёрстка: ничто не уезжает за край экрана ──────────────────
  check('в продукте не осталось сворачиваемых блоков', !/<details/i.test(appJsRaw + html) && !/<details/i.test($('#view').innerHTML));
  check('широкие таблицы прокручиваются сами, а не сдвигают страницу', cssText.includes('.tbl-scroll{overflow-x:auto') && (appJsRaw.match(/class="tbl-scroll"/g) || []).length >= 5);
  check('колонка с кнопками занимает столько места, сколько нужно кнопкам', !/<th style="width:210px"/.test(appJsRaw) && cssText.includes('.act{width:1%'));
  check('длинные почта, ссылка или ИНН не растягивают таблицу', cssText.includes('th,td{overflow-wrap:break-word}'));
  check('на телефоне список диалогов и чат не толкаются на одном экране', cssText.includes('.inbox .convs{display:none}') && cssText.includes('.inbox.list-only .chat{display:none}'));
  check('цели для касания на телефоне не меньше 40px, шрифт не мельчает', /\.tabs button\{padding:9px 13px;font-size:13\.5px;min-height:40px\}/.test(cssText));
  check('низ страницы не прячется под системную полосу телефона', cssText.includes('env(safe-area-inset-bottom') && html.includes('viewport-fit=cover'));
  check('редактор воронок раскладывается на телефоне в две строки', /\.stages-editor \.st\{grid-template-columns:22px 1fr 40px/.test(cssText));

  // ── в продукте нет упоминаний нейросетей и ИИ-помощников ─────────────────
  check('в интерфейсе и коде нет упоминаний нейросетей',
    !/нейросет|нейронн|искусственн\w*\s+интеллект|AI-powered|ChatGPT|GPT-4/i.test(appJsRaw + ' ' + $('#app').textContent));

  // ── палитра команд повторяет меню и его порядок ─────────────────────────
  {
    const navLabels = $$('#nav button').map(b => b.textContent.replace(/\s*\d+\s*$/, '').trim());
    const paletteLabels = (window.PALETTE_ACTIONS?.[0]?.items || []).map(i => i.title);
    check('палитра команд повторяет пункты и порядок меню', paletteLabels.join('|') === navLabels.join('|'), navLabels.join(' / ') + ' ↔ ' + paletteLabels.join(' / '));
  }

  // ── навигация работает на inline-обработчиках, не завися от boot() ───────
  check('все пункты меню несут inline-обработчик go()', $$('#nav button').length >= 9 && $$('#nav button').every(b => /^go\('/.test(b.getAttribute('onclick') || '')));

  // Полный сценарий: администратор выдаёт данные, сотрудник меняет пароль.
  await window.openUser();
  const createdForm = $('#modalBody form');
  createdForm.elements.name.value = 'Первый вход UI';
  createdForm.elements.email.value = 'onboard-ui@example.com';
  window.generateUserPassword(createdForm);
  const temporary = createdForm.elements.password.value;
  await window.saveUser({ preventDefault() {}, target: createdForm }, null);
  check('после создания показаны данные для входа', $('#createdCredentials')?.value.includes(temporary) && $('#createdCredentials')?.value.includes('onboard-ui@example.com'));
  check('адрес в данных для входа стоит вторым и читаемый', /^КаркасCRM — данные для входа\nАдрес: /.test($('#createdCredentials').value) && !/xn--/.test($('#createdCredentials').value), ($('#createdCredentials').value || '').split('\n')[1]);
  await window.copyCreatedCredentials();
  check('копирование даёт результат или понятную инструкцию', Boolean($('#copyCredentialsStatus')?.textContent));
  window.closeModal();
  check('временный пароль удалён из DOM после закрытия', !$('#createdCredentials'));
  await window.logout();
  $('#loginForm [name=email]').value = 'onboard-ui@example.com';
  $('#loginForm [name=password]').value = temporary;
  $('#loginForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(600);
  check('первый вход показывает смену пароля, а не CRM', !$('#passwordChange').classList.contains('hidden') && $('#app').classList.contains('hidden'));
  const changeForm = $('#passwordChangeForm');
  changeForm.elements.old_password.value = temporary;
  changeForm.elements.new_password.value = 'PersonalPassword2026!';
  changeForm.elements.confirm_password.value = 'MismatchPassword2026!';
  await changeForm.onsubmit({ preventDefault() {}, target: changeForm });
  check('несовпадение паролей объяснено', $('#passwordChangeErr').textContent.includes('не совпадают'));
  changeForm.elements.confirm_password.value = 'PersonalPassword2026!';
  await changeForm.onsubmit({ preventDefault() {}, target: changeForm });
  check('после смены пароля CRM открывается', $('#passwordChange').classList.contains('hidden') && !$('#app').classList.contains('hidden'));

} catch (e) { checks.push({ name: 'выполнение сценариев', ok: false, extra: e.message + '\n' + (e.stack || '') }) }

srv.kill('SIGKILL');
process.on('exit', () => { try { srv.kill('SIGKILL') } catch {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { srv.kill('SIGKILL') } catch {}; process.exit(1) });
process.on('uncaughtException', e => { console.error('Smoke-тест упал:', e.message); try { srv.kill('SIGKILL') } catch {}; process.exit(1) });
const failed = checks.filter(c => !c.ok);
// В CI журнал шага без загрузки не прочитать, а причина провала нужна сразу:
// продублируем провалившиеся проверки аннотациями — они видны в самой проверке.
if (process.env.GITHUB_ACTIONS) {
  for (const c of failed.slice(0, 12)) console.log(`::error::Проверка интерфейса не прошла: ${c.name}${c.extra ? ' — ' + String(c.extra).slice(0, 220).replace(/\r?\n/g, ' ') : ''}`);
}
console.log('\n=== Smoke-тест интерфейса КаркасCRM ===');
checks.forEach(c => console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.extra ? ' — ' + String(c.extra).slice(0, 160) : ''}`));
console.log(`\nИтого: ${checks.length - failed.length}/${checks.length} проверок пройдено`);
process.exit(failed.length ? 1 : 0);
