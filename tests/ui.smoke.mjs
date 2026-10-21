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
  uploadChatFile, uploadLogo, deleteLogo, checkHealth, refreshLogo,
  sourceLabel, channelLabel, roleLabel, askConfirm, askInput, translit, SOURCE_LABELS, CHANNEL_LABELS, ROLE_LABELS,
  isoDate, todayISO, fmtDayMonth, kindStage, fld, grid2, formLegend, pushToast, notify, captureFocus, restoreFocus, PALETTE_ACTIONS,
  openMenu, closeMenu, contactsMoreMenu, openOurPrices, comparePrices, setBuiltinTab, BUILTIN_FIELDS, amAdmin, canEdit,
  ourPriceRows, filterOurPrices, toggleAutomation, openAutomation, noteRow, editNote, lockFormsForViewer, AUTO_TRIGGERS, AUTO_ACTIONS
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
  window.__state.settingsTab = 'integrations'; window.go('settings'); await wait(400);
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
      check('для встроенных полей объяснено, где их менять', /Меняются в карточке клиента/.test($('#view').textContent) && /Удалить встроенное поле нельзя/.test($('#view').textContent));
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
  check('непроверенный конкурент честно помечен, а не «риск 0»', /не проверялся/.test($('#view').innerHTML) && !/риск 0 \(/.test($('#view').innerHTML));
  check('в списке конкурентов есть поиск и наша таблица цен', Boolean($('#compFilter')) && /Наш прайс-лист/.test($('#view').textContent));
  const id = competitor.id;
  for (const tab of ['report', 'sources', 'debts', 'reviews', 'prices', 'history']) { window.__state.compTab = tab; await window.openCompetitorCard(id); await wait(250); check('конкурент → ' + tab, $('#modalBody').innerHTML.length > 150 && !/class="card err"/.test($('#modalBody').innerHTML)) }
  window.closeModal();
  // наша таблица цен: загружена — значит кнопка показывает её, а не просит файл
  await fetch(BASE + '/api/prices', { method: 'POST', headers: authH(), body: JSON.stringify({ scope: 'ours', text: 'Каркасный дом 8×10;2950000;шт\nБаня 4×6;890000;шт' }) });
  await fetch(BASE + '/api/competitors/' + id + '/prices', { method: 'POST', headers: authH(), body: JSON.stringify({ scope: 'competitor', text: 'Каркасный дом 8×10;3200000;шт' }) });
  window.__state.ourPrices = null;
  window.go('competitors'); await wait(450);
  {
    const priceBtn = $$('#view button').find(b => /Наш прайс-лист/.test(b.textContent));
    check('кнопка прайс-листа показывает число позиций', Boolean(priceBtn) && /\(2\)/.test(priceBtn.textContent), priceBtn && priceBtn.textContent.trim());
    priceBtn.click(); await wait(400);
    check('прайс-лист открывается таблицей, а не просьбой загрузить файл', /Наша таблица цен/.test($('#modalBody').textContent) && $$('#ourPriceTable tr').length === 3 && !$('#modalBody input[type=file]'), $('#modalBody').textContent.replace(/\s+/g, ' ').slice(0, 90));
    check('таблицу цен можно скачать и заменить', /Скачать таблицу/.test($('#modalBody').textContent) && /Загрузить нашу таблицу цен/.test($('#modalBody').textContent));
    check('в таблице цен есть поиск по позициям', Boolean($('#ourPriceFilter')));
    window.filterOurPrices('баня'); await wait(60);
    check('поиск по таблице цен работает', $$('#ourPriceTable tr').length === 2 && /Баня/.test($('#ourPriceTable').textContent));
    window.closeModal();
    window.__state.compTab = 'prices'; await window.openCompetitorCard(id); await wait(350);
    check('сравнение цен считается по текущим таблицам', /мы дешевле на/.test($('#modalBody').textContent) && /Сопоставлено позиций/.test($('#modalBody').textContent), $('#modalBody').textContent.replace(/\s+/g, ' ').slice(0, 120));
    window.closeModal();
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
    check('лента событий объясняет, зачем она', /что недавно меняли коллеги/.test($('#view').textContent));
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

  // ── интерфейс реагирует на клики, а не только на прямые вызовы ───────────
  {
    window.go('settings'); await wait(600);
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
    check('вкладка карточки конкурента переключается кликом', window.__state.compTab === 'prices' && /Сравнение с нашей таблицей цен/.test($('#modalBody').textContent));
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
  window.__state.settingsTab = 'automations'; window.go('settings'); await wait(450);
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
    await window.openAutomation(); await wait(350);
    check('в форме правила этап выбирается из списка воронки', Boolean($('#modalBody select[name=action_type]')) && /Создать задачу/.test($('#modalBody').textContent));
    $('#modalBody select[name=action_type]').value = 'change_stage';
    $('#modalBody select[name=action_type]').dispatchEvent(new window.Event('change', { bubbles: true })); await wait(80);
    check('при выборе «перевести на этап» появляется список этапов', Boolean($('#autoActionValue select[name=action_value]')) && $$('#autoActionValue option').length >= 2);
    window.closeModal();
  }
  window.__state.settingsTab = 'data'; window.go('settings'); await wait(450);
  {
    check('в разделе данных нет сворачиваемого блока про другой сервер', !$('#view details.settings-more') && !/Копии на другом сервере/.test($('#view').textContent));
    check('короткая подсказка про вторую копию осталась', /DEPLOY\.md/.test($('#view').textContent));
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
    check('наша таблица цен видна в настройках', /Наша таблица цен/.test($('#view').textContent) && $$('#view table.mini tr').length > 2);
    check('таблицу цен в настройках можно скачать и заменить', /Скачать CSV/.test($('#view').textContent) && /Загрузить или заменить/.test($('#view').textContent));
    check('объяснено, что ключи источников не обязательны', /не обязательны/.test($('#view').textContent) && /работает без ключа/.test($('#view').textContent));
    check('есть проверка доступности источников', /Проверить доступность источников/.test($('#view').textContent));
  }

  // ── поиск есть в каждом разделе со списком ───────────────────────────────
  for (const [view, sel] of Object.entries({ contacts: '#contactSearch', companies: '#companySearch', products: '#productSearch', tasks: '#taskSearch', pipe: '#dealSearch', inbox: '#convSearch', competitors: '#compFilter' })) {
    window.go(view); await wait(400);
    check('поиск в разделе «' + view + '»', Boolean($(sel)), sel);
  }
  window.go('dashboard'); await wait(300);

  // ── тёмная тема и шрифты ─────────────────────────────────────────────────
  {
    const sizes = [...cssText.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].map(m => +m[1]);
    check('мелкого шрифта не осталось: всё не меньше 11.5px', sizes.length > 20 && Math.min(...sizes) >= 11.5, 'минимум ' + Math.min(...sizes) + 'px из ' + sizes.length);
    check('гарнитура задана переменной и не меняется от темы', cssText.includes('--font-ui') && cssText.includes('font:14px/1.55 var(--font-ui)') && !/data-theme=dark[^{]*\{[^}]*font-family/.test(cssText));
    check('в тёмной теме докрашены каналы, приоритеты и цветные плашки',
      ['html[data-theme=dark] .chan{', 'html[data-theme=dark] .prio.high{', 'html[data-theme=dark] .card.tint-info{', 'html[data-theme=dark] pre.code-block{'].every(x => cssText.includes(x)));
    check('в интерфейсе не осталось разноцветных inline-плашек', !/background:#f0fdf4|background:#fff7ed|background:#fffbeb/.test(appJsRaw));
  }

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
  check('менеджер не может менять нашу таблицу цен (403)', mgrOurs.status === 403);

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
  check('health: версия 1, без признака demo', h.version === '1' && h.demo === undefined && h.schema >= 3, JSON.stringify({ v: h.version, demo: h.demo }));

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
  for (let i = 0; i < 60 && !$('#view').textContent.includes('это называется вебхук'); i++) await wait(100);
  const integText = $('#view').textContent;
  check('интеграции: вместо «Локальный режим» — «не подключено»', !integText.includes('Локальный режим') && integText.includes('не подключено'));
  check('интеграции: термин webhook объяснён по-русски', integText.includes('(это называется вебхук)') && integText.includes('Адрес, по которому Wazzup присылает сообщения'), integText.slice(0, 120));

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
console.log('\n=== Smoke-тест интерфейса КаркасCRM ===');
checks.forEach(c => console.log(`${c.ok ? '✅' : '❌'} ${c.name}${c.extra ? ' — ' + String(c.extra).slice(0, 160) : ''}`));
console.log(`\nИтого: ${checks.length - failed.length}/${checks.length} проверок пройдено`);
process.exit(failed.length ? 1 : 0);
