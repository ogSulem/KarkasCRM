// Smoke-тест интерфейса: реальный backend + SPA, отрисованная в jsdom.
// Требует jsdom (в рантайме проекта его нет):
//   npm i --prefix /tmp/jsdomtest jsdom
//   JSDOM_PATH=/tmp/jsdomtest/node_modules/jsdom/lib/api.js node --experimental-sqlite tests/ui.smoke.mjs
// Если jsdom не установлен — тест сообщает об этом и завершается успешно.
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, accessSync, constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = await import('jsdom'));
} catch {
  if (process.env.JSDOM_PATH) { try { ({ JSDOM, VirtualConsole } = await import(process.env.JSDOM_PATH)) } catch {} }
}
if (!JSDOM) {
  console.log('⏭  jsdom не установлен — тест интерфейса пропущен.');
  console.log('   Установите и повторите:  npm i --prefix /tmp/jsdomtest jsdom');
  process.exit(0);
}

const PORT = 18079, BASE = `http://127.0.0.1:${PORT}`, DATA = '/tmp/karkas-ui-smoke';
rmSync(DATA, { recursive: true, force: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = spawn('node', ['--experimental-sqlite', 'backend/src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), HOST: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break } catch {} await sleep(200) }

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
  icon, normalizeDue, taskDueMeta, isAscii, readToken, endSession, togglePass,
  toggleUserMenu, closeUserMenu, toggleTaskSelect, ICON_PATHS, msgHtml, channelOptions,
  uploadChatFile, uploadLogo, deleteLogo, checkHealth, refreshLogo,
  sourceLabel, channelLabel, roleLabel, askConfirm, askInput, translit, SOURCE_LABELS, CHANNEL_LABELS, ROLE_LABELS
});`;
const dom = new JSDOM(htmlClean, { runScripts: 'dangerously', url: BASE + '/', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
const { window } = dom;
window.__token = '';
window.fetch = async (url, opt) => {
  const full = String(url).startsWith('http') ? String(url) : BASE + String(url);
  const r = await fetch(full, opt);
  if (r.status === 401 && window.__token) { const o = { ...opt, headers: { ...((opt || {}).headers || {}), Authorization: 'Bearer ' + window.__token } }; return fetch(full, o) }
  return r;
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
const wait = ms => sleep(ms);
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
  window.__token = window.localStorage.getItem('karkas_token');

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
  await modal('ссылка на файл', () => { window.__state.conv = conv.id; window.openAttachment() });

  // ── чат: компоновщик как в мессенджере ───────────────────────────────────
  window.go('inbox'); await wait(400);
  check('скрепка прикрепления файла стоит рядом с полем ввода', Boolean($('#chatFile')) && Boolean($('.composer-ico [data-lucide], .composer-ico svg')));
  check('кнопка отправки — круглая со стрелкой вверх, без бумажного самолётика', Boolean($('.send-btn svg')) && !appJsRaw.includes("icon('send'"));
  check('под полем ввода есть выбор канала и шаблонов', Boolean($('#msgChannel')) && Boolean($('#msgTmpl')));
  check('есть быстрый переход к настройке шаблонов', Boolean($('.tmpl-settings')));
  const opts = window.channelOptions({ channels: 'whatsapp,telegram' });
  check('channelOptions сначала показывает каналы клиента', opts.indexOf('whatsapp') < opts.indexOf('email'));
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

  // ── логотип компании ─────────────────────────────────────────────────────
  const logoUp = await (await fetch(BASE + '/api/logo', { method: 'POST', headers: authH(), body: JSON.stringify({ filename: 'logo.jpg', contentType: 'image/jpeg', dataBase64: PNG_B64 }) })).json();
  check('логотип загружается администратором', logoUp.saved === true && /^\/logo\.png/.test(logoUp.url));
  const logoServed = await fetch(BASE + '/logo.png?ts=1');
  const logoBytes = Buffer.from(await logoServed.arrayBuffer()).subarray(0, 4).toString('hex');
  check('формат логотипа определяется по содержимому, а не расширению', logoServed.status === 200 && (logoServed.headers.get('content-type') || '').includes('image/png') && logoBytes === '89504e47');
  const mgrCannotLogo = await fetch(BASE + '/api/logo', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer manager-token' }, body: '{}' });
  check('чужой токен не проходит авторизацию на загрузке логотипа', mgrCannotLogo.status === 401);
  const logoDel = await (await fetch(BASE + '/api/logo', { method: 'DELETE', headers: authH() })).json();
  check('логотип можно вернуть к стандартному', logoDel.saved === false);

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

  // ── конкуренты ───────────────────────────────────────────────────────────
  window.go('competitors'); await wait(400);
  check('список конкурентов показывает риск', /риск \d+/.test($('#view').innerHTML));
  const id = competitor.id;
  for (const tab of ['report', 'sources', 'debts', 'reviews', 'prices', 'history']) { window.__state.compTab = tab; await window.openCompetitorCard(id); await wait(250); check('конкурент → ' + tab, $('#modalBody').innerHTML.length > 150 && !/class="card err"/.test($('#modalBody').innerHTML)) }
  window.closeModal();

  // ── дашборд и внимание ───────────────────────────────────────────────────
  window.go('dashboard'); await wait(350);
  check('дашборд содержит блок «Требует внимания»', $('#view').innerHTML.includes('Требует внимания'));
  check('карточки внимания: сегодня, просрочено, чаты', $('#view .attn-card.today') && $('#view .attn-card.warn') && $('#view .attn-card.chat'));
  check('дашборд содержит кликабельные KPI', $$('#view .clickable-card, #view .kpi[onclick]').length >= 4);

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
  check('readToken отбрасывает не-ASCII токены', window.isAscii('valid_token_123') && !window.isAscii('bad_token_\u0000_тест'));
  window.localStorage.setItem('karkas_token', 'bad_token_\u0000\u0001');
  check('повреждённый токен очищается', window.readToken() === '' && !window.localStorage.getItem('karkas_token'));
  window.localStorage.setItem('karkas_token', window.__token);
  check('endSession определён', typeof window.endSession === 'function');
  check('normalizeDue/taskDueMeta работают', window.normalizeDue('сегодня 14:00').includes('14:00') && window.normalizeDue('15.10.2026 18:30') === '2026-10-15 18:30' && window.taskDueMeta('2020-01-01 10:00', false).overdue === true);

  // ── бренд, логотип, фавикон ──────────────────────────────────────────────
  const logoRes = await fetch(BASE + '/logo.png');
  check('/logo.png отдаёт встроенный JPEG', logoRes.status === 200 && (logoRes.headers.get('content-type') || '').includes('image/jpeg'));
  const favRes = await fetch(BASE + '/favicon.ico');
  check('/favicon.ico доступен', favRes.status === 200);
  check('бренд: Каркас + CRM', $('.brand-part-karkas')?.textContent === 'Каркас' && $('.brand-part-crm')?.textContent === 'CRM');
  check('клик по бренду ведёт на дашборд', ($('aside .brand')?.getAttribute('onclick') || '').includes("go('dashboard')"));
  check('логотип в бренде имеет класс logo-img', Boolean($('.brand img.logo-img')));
  check('CSS содержит реакцию бренда на наведение', cssText.includes('.brand:hover .brand-part-karkas'));

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

  // ── роли ─────────────────────────────────────────────────────────────────
  await apiPost('/api/users', { name: 'Менеджер Тест', email: 'mgr_ui@example.com', password: 'password123', role: 'manager' });
  const mgrLogin = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'mgr_ui@example.com', password: 'password123' }) })).json();
  const mgrToken = mgrLogin.token;
  check('менеджер создаётся и входит', !!mgrToken);
  const set403 = await fetch(BASE + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mgrToken }, body: JSON.stringify({ COMPANY_NAME: 'Hack' }) });
  check('менеджеру запрещено менять настройки (403)', set403.status === 403);
  const logo403 = await fetch(BASE + '/api/logo', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mgrToken }, body: JSON.stringify({}) });
  check('менеджеру запрещено менять логотип (403)', logo403.status === 403);
  await apiPost('/api/users', { name: 'Наблюдатель Тест', email: 'view_ui@example.com', password: 'password123', role: 'viewer' });
  const viewLogin = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'view_ui@example.com', password: 'password123' }) })).json();
  const view403 = await fetch(BASE + '/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + viewLogin.token }, body: JSON.stringify({ name: 'Hack' }) });
  check('наблюдатель не может создавать записи (403)', view403.status === 403);
  const sim403 = await fetch(BASE + '/api/inbox/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mgrToken }, body: JSON.stringify({ text: 'x' }) });
  check('служебный симулятор входящих доступен только администратору', sim403.status === 403);

  // ── настройки команды глазами менеджера ──────────────────────────────────
  const admin = window.__state.me;
  window.__state.me = { id: 99, name: 'Менеджер', role: 'manager' };
  window.go('settings'); await wait(350);
  const mSet = $('#view').innerHTML;
  check('менеджер видит только доступные вкладки настроек', /Мой профиль/.test(mSet) && !/Интеграции и каналы/.test(mSet) && !/>Команда</.test(mSet) && !/>Воронки и этапы</.test(mSet));
  window.__state.me = admin; window.__state.settingsTab = 'integrations';

  // ── форма для сайта, скелетоны ───────────────────────────────────────────
  const code = window.siteFormCode();
  check('код формы для сайта ссылается на вебхук', /webhooks\/generic/.test(code) && /sendToKarkas/.test(code));
  check('скелетоны описаны для всех разделов', ['dashboard', 'pipe', 'inbox', 'contacts', 'tasks', 'analytics', 'competitors', 'settings'].every(v => typeof window.SKELETONS?.[v] === 'function'));

  // ── health без признака демонстрационных данных ──────────────────────────
  const h = await (await fetch(BASE + '/api/health')).json();
  check('health: версия 1, без признака demo', h.version === '1' && h.demo === undefined && h.schema >= 3, JSON.stringify({ v: h.version, demo: h.demo }));

  // ── отсутствие эмодзи и версионного/демо-мусора в продукте ───────────────
  check('эмодзи нет в index.html', !hasEmojis(html));
  check('эмодзи нет в app.js', !hasEmojis(appJsRaw));
  check('эмодзи нет в style.css', !hasEmojis(cssText));
  check('эмодзи нет в server.js', !hasEmojis(serverJsRaw));
  check('эмодзи нет в competitors.js', !hasEmojis(competitorsJsRaw));
  const productText = html + appJsRaw + cssText;
  check('в интерфейсе нет упоминаний демонстрационного режима', !/демо|Демо|SEED_DEMO/.test(productText));
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

  // ── вкладка интеграций: человеческие формулировки ────────────────────────
  window.go('settings', 'integrations');
  for (let i = 0; i < 40 && !$('#view .settings-cols'); i++) await wait(100);
  const integText = $('#view').textContent;
  check('интеграции: вместо «Локальный режим» — «не подключено»', !integText.includes('Локальный режим') && integText.includes('не подключено'));
  check('интеграции: термин webhook объяснён по-русски', integText.includes('Адрес для уведомлений'));

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
process.on('uncaughtException', e => { console.error('Smoke-тест упал:', e.message); try { srv.kill('SIGKILL') } catch {}; process.exit(1) });
const failed = checks.filter(c => !c.ok);
console.log('\n=== Smoke-тест интерфейса КаркасCRM ===');
checks.forEach(c => console.log(`${c.ok ? '✅' : '❌'} ${c.name}${c.extra ? ' — ' + String(c.extra).slice(0, 160) : ''}`));
console.log(`\nИтого: ${checks.length - failed.length}/${checks.length} проверок пройдено`);
process.exit(failed.length ? 1 : 0);
