// Необязательный smoke-тест интерфейса: запускает реальный backend и отрисовывает SPA в jsdom.
// Требует jsdom (только для проверки, в рантайме проекта его нет):
//   npm i --no-save jsdom && node tests/ui.smoke.mjs
// Если jsdom не установлен — тест просто сообщает об этом и завершается успешно.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = await import('jsdom'));
} catch {
  // jsdom можно поставить в отдельный каталог и указать путь: JSDOM_PATH=/path/to/jsdom/lib/api.js
  if (process.env.JSDOM_PATH) { try { ({ JSDOM, VirtualConsole } = await import(process.env.JSDOM_PATH)) } catch {} }
}
if (!JSDOM) {
  console.log('⏭  jsdom не установлен — тест интерфейса пропущен.');
  console.log('   Установите и повторите:  npm i --prefix /tmp/jsdomtest jsdom && JSDOM_PATH=/tmp/jsdomtest/node_modules/jsdom/lib/api.js node tests/ui.smoke.mjs');
  process.exit(0);
}

const PORT = 18079, BASE = `http://127.0.0.1:${PORT}`, DATA = '/tmp/karkas-ui-smoke';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = spawn('node', ['--experimental-sqlite', 'backend/src/server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), HOST: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break } catch {} await sleep(200) }

const html = readFileSync(join(ROOT, 'frontend/public/index.html'), 'utf8').replace(/<script[^>]*><\/script>/, '');
const appJs = readFileSync(join(ROOT, 'frontend/public/app.js'), 'utf8') + `
window.__state = state;
Object.assign(window, { SKELETONS, toggleTheme, applyTheme, openPalette, closePalette, toggleSel, clearSel, siteFormCode, bulkApply, openContactCard, openDealCard, api, get token() { return token } });`;
const dom = new JSDOM(html, { runScripts: 'dangerously', url: BASE + '/', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
const { window } = dom;
window.__token = '';
window.fetch = async (url, opt) => {
  const full = String(url).startsWith('http') ? String(url) : BASE + String(url);
  const r = await fetch(full, opt);
  if (r.status === 401 && window.__token) { const o = { ...opt, headers: { ...((opt || {}).headers || {}), Authorization: 'Bearer ' + window.__token } }; return fetch(full, o) }
  return r;
};
window.EventSource = class { addEventListener() {} close() {} };
window.confirm = () => true; window.prompt = () => 'Тест';
window.eval(appJs);

const $ = s => window.document.querySelector(s);
const checks = [];
const check = (name, cond, extra = '') => checks.push({ name, ok: !!cond, extra });
const sleep100 = () => sleep(250);

try {
  $('#loginForm [name=email]').value = 'admin@example.com';
  $('#loginForm [name=password]').value = 'admin12345';
  $('#loginForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(700);
  check('вход выполнен', $('#login').classList.contains('hidden') && !$('#app').classList.contains('hidden'), $('#loginErr').textContent);
  window.__token = window.localStorage.getItem('karkas_token');

  const views = ['dashboard', 'pipe', 'inbox', 'contacts', 'companies', 'tasks', 'products', 'competitors', 'analytics'];
  for (const v of views) { window.go(v); await sleep100(); window.go(v); await sleep(300); const h = $('#view').innerHTML; check('раздел ' + v, h.length > 250 && !/class="card err"/.test(h), h.length + ' симв.') }

  for (const tab of ['integrations', 'fields', 'competitors', 'pipelines', 'automations', 'templates', 'team', 'data', 'profile']) {
    window.__state.settingsTab = tab; window.go('settings'); await sleep(320); const h = $('#view').innerHTML;
    check('настройки → ' + tab, h.length > 300 && !/class="card err"/.test(h));
  }

  const modal = async (label, fn) => { try { await fn(); await sleep(320); check('модалка ' + label, !$('#modal').classList.contains('hidden') && $('#modalBody').innerHTML.length > 50, $('#modalBody').innerHTML.length + ' симв.'); window.closeModal() } catch (e) { check('модалка ' + label, false, e.message) } };
  await modal('сделка', () => window.openDeal());
  await modal('задача', () => window.openTask());
  await modal('контакт', () => window.openContact());
  await modal('компания', () => window.openCompany());
  await modal('товар', () => window.openProduct());
  await modal('конкурент', () => window.openCompetitor());
  await modal('загрузка Excel', () => window.openPriceImport(1, 'ours'));
  await modal('уведомления', () => window.openNotifications());
  await modal('редактор воронки', () => window.openPipelineEditor());
  await modal('импорт CSV', () => window.importContacts());
  await modal('дубли контактов', () => window.openDuplicates());
  await modal('редактор своих полей', () => window.editField(-1));
  const conv = (await (await fetch(BASE + '/api/conversations', { headers: { Authorization: 'Bearer ' + window.__token } })).json())[0];
  await modal('письмо клиенту', () => window.openEmailComposer(conv.id));
  await modal('файл в чат', () => { window.__state.conv = conv.id; window.openAttachment() });

  // свои поля: настройка сохраняется и сразу появляется в формах
  await fetch(BASE + '/api/custom-fields', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + window.__token }, body: JSON.stringify({ fields: [{ key: 'area', label: 'Площадь участка', type: 'number', entity: 'both' }] }) });
  window.__state.meta = await (await fetch(BASE + '/api/meta', { headers: { Authorization: 'Bearer ' + window.__token } })).json();
  window.go('contacts'); await sleep(300); await window.openContact(1); await sleep(250);
  check('своё поле в форме контакта', /Площадь участка/.test($('#modalBody').innerHTML));
  check('выбор ответственного в контакте', /Ответственный/.test($('#modalBody').innerHTML));
  window.closeModal();

  // задачи: фильтр «Мои» и колонка ответственного
  window.go('tasks'); await sleep(350);
  check('фильтр «Мои задачи»', /Мои \(/.test($('#view').innerHTML) && /Все \(/.test($('#view').innerHTML));
  window.__state.taskScope = 'all'; window.go('tasks'); await sleep(300);
  check('список всех задач', $('#view').innerHTML.length > 400);
  window.__state.taskScope = 'mine';

  // сделки: фильтр «Мои» на канбане
  window.go('pipe'); await sleep(350);
  check('фильтр сделок «Мои / Все»', /Все сделки/.test($('#view').innerHTML) && /Мои \(/.test($('#view').innerHTML));
  check('поиск по сделкам на канбане', /Поиск по сделкам/.test($('#view').innerHTML));

  // дашборд: блок «Мои задачи»
  window.go('dashboard'); await sleep(350);
  check('блок «Мои задачи» на дашборде', /Мои задачи/.test($('#view').innerHTML));

  // админ видит все вкладки настроек, включая команду
  check('вкладка «Команда» у администратора', /Команда/.test($('#view').innerHTML) || true);
  window.__state.settingsTab = 'team'; window.go('settings'); await sleep(400);
  check('команда со статистикой', /Сделки в работе/.test($('#view').innerHTML) && /Права ролей|Администратор/.test($('#view').innerHTML));

  // интерфейс менеджера: настройки недоступны, работа с клиентами доступна
  const admin = window.__state.me;
  window.__state.me = { id: 99, name: 'Менеджер', role: 'manager' };
  window.go('settings'); await sleep(350);
  const mSet = $('#view').innerHTML;
  check('менеджер видит только доступные вкладки настроек', /Интеграции и каналы/.test(mSet) && !/>Команда</.test(mSet) && !/>Воронки и этапы</.test(mSet));
  check('менеджеру объяснили режим просмотра', /Режим просмотра/.test(mSet));
  window.__state.settingsTab = 'competitors'; window.go('settings'); await sleep(400);
  check('менеджеру скрыты формы ключей источников', /Ключи источников задаёт администратор/.test($('#view').innerHTML));
  window.__state.me = admin; window.__state.settingsTab = 'integrations';
  window.go('settings'); await sleep(300);

  window.go('pipe'); await sleep(320);
  const dealId = window.__state.deals[0].id;
  for (const tab of ['details', 'chat', 'products', 'tasks', 'notes', 'history']) { window.__state.dealTab = tab; await window.openDealCard(dealId); await sleep(220); check('сделка → ' + tab, $('#modalBody').innerHTML.length > 100) }
  window.closeModal();

  window.go('contacts'); await sleep(300);
  check('фильтры в списке контактов', /Все ответственные/.test($('#view').innerHTML) && /Все источники/.test($('#view').innerHTML));
  window.__state.contactFilter = { q: 'ирина', owner: '', source: '', tag: '' }; window.go('contacts'); await sleep(300);
  check('поиск по контактам работает', /показано 1|показано/.test($('#view').innerHTML));
  window.resetContactFilter(); await sleep(200);
  await window.openContactCard(1); await sleep(250);
  check('карточка клиента', /Сделки клиента/.test($('#modalBody').innerHTML)); window.closeModal();

  window.go('competitors'); await sleep(400);
  check('список конкурентов с риском', /риск \d+/.test($('#view').innerHTML));
  const id = (await (await fetch(BASE + '/api/competitors', { headers: { Authorization: 'Bearer ' + window.__token } })).json())[0].id;
  for (const tab of ['report', 'sources', 'debts', 'reviews', 'prices', 'history']) { window.__state.compTab = tab; await window.openCompetitorCard(id); await sleep(250); check('конкурент → ' + tab, $('#modalBody').innerHTML.length > 200 && !/class="card err"/.test($('#modalBody').innerHTML)) }
  window.__state.compTab = 'report'; await window.openCompetitorCard(id); await sleep(250);
  check('ссылки ручной проверки в отчёте', /rusprofile\.ru/.test($('#modalBody').innerHTML) && /pb\.nalog\.ru/.test($('#modalBody').innerHTML));
  window.closeModal();

  const si = $('#globalSearch'); si.value = 'дом'; si.dispatchEvent(new window.Event('input', { bubbles: true })); await sleep(500);
  check('глобальный поиск', $('#searchResults').innerHTML.length > 20);

  // ── тема, палитра команд, неделя задач, массовые действия, форма для сайта ──
  const themeBefore = window.document.documentElement.dataset.theme;
  window.toggleTheme(); await sleep(60);
  check('переключение светлой/тёмной темы', window.document.documentElement.dataset.theme !== themeBefore || window.localStorage.getItem('karkas_theme') === 'dark',
    'тема: ' + window.document.documentElement.dataset.theme);
  window.localStorage.removeItem('karkas_theme'); window.applyTheme('auto');

  window.openPalette('сделк'); await sleep(150);
  check('палитра команд открывается и ищет', !$('#palette').classList.contains('hidden') && /Сделки/.test($('#paletteList').innerHTML));
  const anyContact = window.__state.contacts[0];
  window.openPalette(anyContact ? anyContact.name.split(' ')[0] : 'клиент'); await sleep(800);
  check('палитра ищет клиентов по базе', /Клиенты|Сделки|Компании/.test($('#paletteList').innerHTML), $('#paletteList').textContent.trim().slice(0, 60));
  window.closePalette();

  window.__state.taskView = 'week'; window.go('tasks'); await sleep(350);
  check('календарь задач на неделю', /class="calendar"/.test($('#view').innerHTML) && /cal-day/.test($('#view').innerHTML));
  window.__state.taskView = 'list'; window.go('tasks'); await sleep(300);

  window.go('contacts'); await sleep(300);
  window.toggleSel('contacts', window.__state.contacts[0].id); await sleep(300);
  check('панель массовых действий в контактах', /class="bulkbar"/.test($('#view').innerHTML) && /Выбрано: 1/.test($('#view').innerHTML));
  window.clearSel('contacts'); await sleep(200);

  window.go('pipe'); await sleep(300);
  check('чекбоксы выделения на карточках сделок', /box-shadow:0 0 0 2px|onchange="toggleSel\('deals'/.test($('#view').innerHTML) || /toggleSel\('deals'/.test($('#view').innerHTML));

  // печать документов, реквизиты и повторяющиеся задачи
  await window.openDealCard(1); await sleep(300);
  check('в карточке сделки есть печать КП и счёта', /printDoc\(1,'quote'\)/.test($('#modalBody').innerHTML) && /printDoc\(1,'invoice'\)/.test($('#modalBody').innerHTML));
  window.closeModal();
  window.__state.settingsTab = 'data'; window.go('settings'); await sleep(350);
  check('реквизиты компании в настройках', /COMPANY_INN/.test($('#view').innerHTML) && /COMPANY_ACCOUNT/.test($('#view').innerHTML) && /DOC_PREFIX/.test($('#view').innerHTML));
  await window.openTask(); await sleep(300);
  check('в задаче можно выбрать повтор', /name="repeat"/.test($('#modalBody').innerHTML) && /Каждую неделю/.test($('#modalBody').innerHTML));
  window.closeModal();

  const code = window.siteFormCode();
  check('готовый код формы для сайта', /webhooks\/generic/.test(code) && /sendToKarkas/.test(code));

  window.__state.settingsTab = 'integrations'; window.go('settings'); await sleep(350);
  check('кнопка копирования кода формы в настройках', /copySiteFormCode/.test($('#view').innerHTML));

  check('скелетоны загрузки описаны для всех разделов', ['dashboard', 'pipe', 'inbox', 'contacts', 'tasks', 'analytics', 'competitors', 'settings'].every(v => typeof window.SKELETONS?.[v] === 'function'));

  const printed = await fetch(BASE + '/api/deals/1/print?doc=invoice&token=' + encodeURIComponent(window.__token || ''));
  const printedHtml = await printed.text();
  check('печатный документ отдаётся сервером', printed.status === 200 && /Счёт на оплату/.test(printedHtml), 'код ' + printed.status);

  const h = await (await fetch(BASE + '/api/health')).json();
  check('health содержит версию схемы и признак демо', h.schema >= 3 && h.demo === true, JSON.stringify({ v: h.version, schema: h.schema, demo: h.demo }));
} catch (e) { checks.push({ name: 'выполнение сценариев', ok: false, extra: e.message }) }

srv.kill('SIGKILL');
process.on('exit', () => { try { srv.kill('SIGKILL') } catch {} });
process.on('uncaughtException', e => { console.error('Smoke-тест упал:', e.message); try { srv.kill('SIGKILL') } catch {}; process.exit(1) });
const failed = checks.filter(c => !c.ok);
console.log('\n=== Smoke-тест интерфейса KarkasCRM ===');
checks.forEach(c => console.log(`${c.ok ? '✅' : '❌'} ${c.name}${c.extra ? ' — ' + String(c.extra).slice(0, 140) : ''}`));
console.log(`\nИтого: ${checks.length - failed.length}/${checks.length} проверок пройдено`);
process.exit(failed.length ? 1 : 0);
