/* KarkasCRM v2 frontend — amoCRM-like SPA + Wazzup unified inbox */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
let token = localStorage.getItem('karkas_token') || '';
const state = { view: 'dashboard', settingsTab: 'integrations', pipeline: 1, conv: null, deals: [], stages: [], pipelines: [], contacts: [], companies: [], channels: [], cache: {}, dealTab: 'details', meta: null, dupes: null, me: null, users: [], taskScope: 'mine', dealScope: 'all' };
const CUR = () => (state.meta && state.meta.company && state.meta.company.currency) || '₽';
const fmt = n => new Intl.NumberFormat('ru-RU').format(Math.round(n || 0)) + ' ' + CUR();
const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dt = s => s ? String(s).replace('T', ' ').slice(0, 16) : '';
const num = v => (String(v ?? '').replace(/[^\d.-]/g, '') || 0) * 1;
async function api(path, opt = {}) {
  const r = await fetch(path, { ...opt, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opt.headers || {}) } });
  if (r.status === 401) { if (token) logout(); throw new Error('Требуется вход'); }
  if (String(opt.raw ? 0 : 1) && !(r.headers.get('content-type') || '').includes('json')) return r;
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Ошибка ' + r.status); return d;
}
const download = async (path, name) => { const r = await fetch(path, { headers: { Authorization: 'Bearer ' + token } }); const b = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); return false; };
function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('show'); setTimeout(() => e.classList.remove('show'), 2600) }
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden') }
function closeModal() { $('#modal').classList.add('hidden') }
function tmpl(name, obj = {}) { return (obj.body || '').replace(/{(\w+)}/g, (m, k) => esc(obj[k] || m)) }
/* команда: список ответственных для выбора в карточках */
async function team() { if (!state.users.length) state.users = await api('/api/users').catch(() => []); return state.users.filter(u => u.active !== 0) }
const meId = () => (state.me && state.me.id) || null;
function userOptions(selected, placeholder = '— не назначен —') {
  return `<option value="">${placeholder}</option>${state.users.map(u => `<option value="${u.id}" ${Number(selected) === u.id ? 'selected' : ''}>${esc(u.name)}${u.role === 'admin' ? ' (админ)' : ''}</option>`).join('')}`;
}
function myTasksBlock() {
  const today = new Date().toISOString().slice(0, 10);
  if (!__myTasks.length) return '<small>На сегодня задач нет — можно заняться продажами 🎯</small>';
  const types = { call: '📞', meeting: '👥', message: '✉', email: '📧', other: '•' };
  return __myTasks.map(t => `<div class="row"><label><input type="checkbox" onchange="toggleTask(${t.id},true)"> <span>${types[t.type] || '•'} ${esc(t.title)}<br><small>${esc(t.due || 'без срока')}${(t.due || '').match(/^\d{4}/) && t.due < today ? ' · <b style="color:#dc2626">просрочено</b>' : ''}${t.contact_name ? ' · ' + esc(t.contact_name) : ''}${t.deal_title ? ' · ' + esc(t.deal_title) : ''}</small></span></label></div>`).join('');
}
const MSG_STATUS = { sent: ' · ✓ отправлено', delivered: ' · ✓✓ доставлено', read: ' · ✓✓ прочитано', error: ' · ⚠ не доставлено', inbound: '', received: '', local: ' · локально' };

/* настраиваемые поля: определения берём из /api/meta (Настройки → Поля карточек) */
const cfFor = entity => ((state.meta && state.meta.customFields) || []).filter(f => f.entity === 'both' || f.entity === entity);
const cfValues = (obj = {}) => { try { const v = typeof obj === 'string' ? JSON.parse(obj || '{}') : (obj || {}); return v && typeof v === 'object' ? v : {} } catch { return {} } };
function cfInputs(entity, obj = {}, grid = 2) {
  const fields = cfFor(entity); if (!fields.length) return '';
  const val = cfValues(obj.custom);
  return `<div style="display:grid;grid-template-columns:repeat(${grid},1fr);gap:12px">${fields.map(f => {
    const v = esc(val[f.key] ?? '');
    const label = `${esc(f.label)}${f.required ? ' *' : ''}`;
    if (f.type === 'select') return `<label>${label}<select name="cf_${esc(f.key)}">${['', ...(f.options || [])].map(o => `<option value="${esc(o)}" ${String(val[f.key] ?? '') === o ? 'selected' : ''}>${esc(o || '—')}</option>`).join('')}</select></label>`;
    const t = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text';
    return `<label>${label}<input name="cf_${esc(f.key)}" type="${t}" value="${v}"></label>`;
  }).join('')}</div>`;
}
function cfCollect(form) {
  const data = Object.fromEntries(new FormData(form)); const custom = {};
  for (const k of Object.keys(data)) if (k.startsWith('cf_')) { custom[k.slice(3)] = data[k]; delete data[k] }
  data.custom = JSON.stringify(custom);
  return data;
}
function cfTable(entity, obj = {}) {
  const fields = cfFor(entity); const val = cfValues(obj.custom);
  const rows = fields.filter(f => String(val[f.key] ?? '') !== '').map(f => `<tr><th>${esc(f.label)}</th><td>${esc(val[f.key])}</td></tr>`).join('');
  return rows ? rows : '';
}

/* ---------- boot ---------- */
$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const d = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
    token = d.token; localStorage.setItem('karkas_token', token); boot();
  } catch (err) { $('#loginErr').textContent = err.message }
};
$('#logout').onclick = logout;
function logout() { token = ''; localStorage.removeItem('karkas_token'); location.reload() }
async function boot() {
  if (!token) { $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); return }
  try {
    const me = await api('/api/me');
    $('#uName').textContent = me.user.name; $('#uEmail').textContent = me.user.email; $('#uAva').textContent = (me.user.name || 'A')[0].toUpperCase();
    state.meta = await api('/api/meta').catch(() => null);
    state.me = me.user;
    state.users = await api('/api/users').catch(() => []);
    $('#app').classList.remove('hidden'); $('#login').classList.add('hidden'); connectSSE(); render();
  } catch { $('#login').classList.remove('hidden'); $('#app').classList.add('hidden') }
}
$$('#nav button').forEach(b => b.onclick = () => go(b.dataset.view));
function go(v, tab) { state.view = v; if (tab) state.settingsTab = tab; $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === v)); render() }
const TITLES = {
  dashboard: ['Дашборд', 'Продажи, воронка и активность команды'], pipe: ['Сделки', 'Воронка продаж — перетаскивайте карточки между этапами'],
  inbox: ['Чаты Wazzup', 'WhatsApp, Telegram, Instagram и сайт — в одном окне клиента'], contacts: ['Контакты', 'База клиентов и всех, кто писал в мессенджеры'],
  companies: ['Компании', 'Юридические лица и организации'], tasks: ['Задачи', 'Звонки, встречи и письма по клиентам'],
  products: ['Товары и услуги', 'Прайс для быстрого наполнения сделок'], competitors: ['Конкуренты', 'Разведка: долги, суды, банкротство, отзывы и цены — по одному названию'], analytics: ['Аналитика', 'Конверсия, средний чек и источники'], settings: ['Настройки', 'Интеграции, воронки, автоматизации, команда и данные']
};
async function render() {
  const [t, s] = TITLES[state.view] || ['', '']; $('#title').textContent = t; $('#subtitle').textContent = s;
  const v = $('#view'); v.innerHTML = '<div class="card empty">Загрузка…</div>';
  try {
    if (state.view === 'dashboard') return await dashboard(v);
    if (state.view === 'pipe') return await pipe(v);
    if (state.view === 'inbox') return await inbox(v);
    if (state.view === 'contacts') return await contacts(v);
    if (state.view === 'companies') return await companies(v);
    if (state.view === 'tasks') return await tasks(v);
    if (state.view === 'products') return await products(v);
    if (state.view === 'competitors') return await competitorsView(v);
    if (state.view === 'analytics') return await analytics(v);
    if (state.view === 'settings') return await settings(v);
  } catch (e) { v.innerHTML = `<div class="card err">${esc(e.message)}</div>` }
}
async function openNotifications() {
  const rows = await api('/api/tasks'); const today = new Date().toISOString().slice(0, 10);
  const over = rows.filter(t => !t.done && (t.due || '').match(/^\d{4}/) && t.due < today);
  const now = rows.filter(t => !t.done && (t.due || '').startsWith(today));
  openModal(`<h3>🔔 Уведомления и сегодняшние дела</h3>
   <h4 style="margin:12px 0 4px;color:#dc2626">Просрочено: ${over.length}</h4>${over.map(t => `<div class="row"><span>${esc(t.title)}<br><small>${esc(t.due || '')} · ${esc(t.contact_name || '')}</small></span><button class="btn sm" onclick="toggleTask(${t.id},true);closeModal()">✓ Готово</button></div>`).join('') || '<small>Нет просроченных задач 🎉</small>'}
   <h4 style="margin:16px 0 4px;color:var(--green)">На сегодня: ${now.length}</h4>${now.map(t => `<div class="row"><span>${esc(t.title)}<br><small>${esc(t.due || '')} · ${esc(t.contact_name || '')}</small></span><button class="btn sm" onclick="toggleTask(${t.id},true);closeModal()">✓ Готово</button></div>`).join('') || '<small>Планов на сегодня нет</small>'}
   <h3 style="margin-top:16px">Непрочитанные чаты</h3><div id="notifConvs">…</div>`);
  const convs = (await api('/api/conversations')).filter(c => c.unread);
  $('#notifConvs').innerHTML = convs.map(c => `<div class="row"><span>${esc(c.title)}<br><small>${esc(c.last_body || '')}</small></span><button class="btn sm" onclick="closeModal();state.conv=${c.id};go('inbox')">Открыть</button></div>`).join('') || '<small>Всё прочитано 👍</small>';
}
async function navCounts(d) { $('#navUnread').textContent = d.unread || ''; $('#navTasks').textContent = d.tasksOpen || ''; $('#navDeals').textContent = d.dealsTotal || ''; const b = $('#bellCount'); if (b) b.textContent = d.tasksOverdue || '' }

/* ---------- dashboard ---------- */
let __myTasks = [];
async function dashboard(v) {
  const d = await api('/api/dashboard'); navCounts(d);
  __myTasks = (await api('/api/tasks').catch(() => [])).filter(t => !t.done && (t.responsible_id === meId() || !t.responsible_id)).slice(0, 6);
  const max = Math.max(...d.stages.map(s => s.sum), 1);
  v.innerHTML = `<div class="grid">
   <div class="kpi"><i>💰</i><span>Выручка (успешно реализовано)</span><b class="green">${fmt(d.revenue)}</b></div>
   <div class="kpi"><i>▦</i><span>Активных сделок</span><b>${d.dealsTotal}</b></div>
   <div class="kpi"><i>◎</i><span>Контактов / компаний</span><b>${d.contacts} <small>/ ${d.companies}</small></b></div>
   <div class="kpi"><i>✉</i><span>Непрочитанных чатов</span><b class="accent">${d.unread}</b></div>
   <div class="kpi"><i>✓</i><span>Открытых задач</span><b>${d.tasksOpen}</b></div></div>
  ${d.contacts === 0 && d.dealsTotal === 0 ? `<div class="card" style="box-shadow:none;border-color:#bbf7d0;background:#f0fdf4"><b>База пустая — самое время начать 🚀</b><br><small>Добавьте первый контакт — сделка, задачи и чаты появятся сами. Кнопки «+ Контакт» и «+ Сделка» вверху. Если хотите посмотреть, как всё устроено, включите демо-данные переменной <code>SEED_DEMO=1</code> и перезапустите контейнер.</small></div>` : ''}
  <div class="cols"><div>
   <div class="card"><h3>Воронка продаж</h3>${d.stages.map(s => `<p style="display:flex;justify-content:space-between;margin:8px 0 2px"><span>${esc(s.name)} · ${s.count}</span><b>${fmt(s.sum)}</b></p><div class="bar"><i style="width:${Math.round(s.sum / max * 100)}%"></i></div>`).join('')}</div>
   <div class="card"><h3>Последние сделки</h3><table class="mini"><tr><th>Сделка</th><th>Клиент</th><th>Этап</th><th>Сумма</th></tr>${d.recentDeals.map(x => `<tr><td><b>${esc(x.title)}</b></td><td>${esc(x.contact_name || '—')}</td><td>${esc((d.stages.find(s => s.code === x.stage) || {}).name || x.stage)}</td><td><b>${fmt(x.amount)}</b></td></tr>`).join('')}</table></div></div>
  <div class="card"><h3>Лента активности</h3><div class="list">${d.activities.map(a => `<div class="row"><span>• ${esc(a.text)}<br><small>${esc(dt(a.created_at))}${a.user_name ? ' · ' + esc(a.user_name) : ''}</small></span></div>`).join('') || '<small>Пока пусто</small>'}</div><hr>
   <h3>Мои задачи</h3><div class="list">${myTasksBlock()}</div><hr>
   <h3>Быстрые действия</h3><div style="display:flex;flex-direction:column;gap:8px">
   <button class="btn primary" onclick="openDeal()">+ Новая сделка</button>
   <button class="btn" onclick="openTask()">+ Задача</button>
   <button class="btn orange" onclick="go('settings','integrations')">⚙ Подключить Wazzup</button>
   <button class="btn" onclick="go('competitors')">🕵 Проверить конкурента</button>
   <button class="btn ghost" onclick="simulate()">🧪 Тестовое входящее сообщение</button></div></div></div>`;
}

/* ---------- deals / kanban ---------- */
async function pipe(v) {
  const d = await api('/api/deals?pipeline=' + state.pipeline);
  Object.assign(state, { deals: d.deals, stages: d.stages, pipelines: d.pipelines });
  $('#navDeals').textContent = d.deals.filter(x => !['won', 'lost'].includes(x.stage)).length;
  const shown = state.dealScope === 'mine' ? d.deals.filter(x => x.responsible_id === meId()) : d.deals;
  v.innerHTML = `<div class="card" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <b>Воронка:</b><select style="width:auto" onchange="state.pipeline=+this.value;render()">${d.pipelines.map(p => `<option value="${p.id}" ${p.id === state.pipeline ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <span class="tabs" style="margin:0"><button class="${state.dealScope !== 'mine' ? 'active' : ''}" onclick="state.dealScope='all';render()">Все сделки</button><button class="${state.dealScope === 'mine' ? 'active' : ''}" onclick="state.dealScope='mine';render()">Мои (${d.deals.filter(x => x.responsible_id === meId()).length})</button></span>
    <span class="tag">В работе: ${shown.length}</span><span class="tag orange">Сумма: ${fmt(shown.filter(x => !['won', 'lost'].includes(x.stage)).reduce((a, x) => a + x.amount, 0))}</span>
    ${(state.me && state.me.role) === 'admin' ? '<button class="btn sm" style="margin-left:auto" onclick="openPipelineEditor()">⚙ Настроить воронку</button>' : ''}</div>
  <div class="kanban">${d.stages.map(s => `<div class="col" ondragover="dragOver(event,this)" ondragleave="this.classList.remove('drag-over')" ondrop="dropDeal(event,'${s.code}',this)">
   <h3><span style="color:${esc(s.color)}">● ${esc(s.name)}</span><span>${shown.filter(x => x.stage === s.code).length}</span></h3>
   <div class="deals">${shown.filter(x => x.stage === s.code).map(x => `<article class="deal" draggable="true" ondragstart="event.dataTransfer.setData('text/plain',${x.id})" onclick="openDealCard(${x.id})" style="border-left-color:${esc(s.color)}">
    <b>${esc(x.title)}</b><span class="sum">${fmt(x.amount)}</span>
    <small>👤 ${esc(x.contact_name || 'Без контакта')}${x.deadline ? ' · ⏰ ' + esc(x.deadline) : ''}</small>
    <div class="deal-foot"><span class="prio ${esc(x.priority)}">${x.priority === 'high' ? 'высокий' : x.priority === 'low' ? 'низкий' : 'обычный'}</span><span><button class="btn sm" onclick="event.stopPropagation();moveDeal(${x.id},1)">→</button></span></div></article>`).join('') || '<small style="padding:6px">Пусто</small>'}</div></div>`).join('')}</div>`;
}
function dragOver(e, el) { e.preventDefault(); el.classList.add('drag-over') }
async function dropDeal(e, stage, el) { e.preventDefault(); el.classList.remove('drag-over'); await moveDeal(e.dataTransfer.getData('text/plain'), 0, stage) }
async function moveDeal(id, dir, stage) {
  if (!stage) { const cur = state.deals.find(x => x.id == id); const i = state.stages.findIndex(s => s.code === cur.stage); stage = state.stages[Math.min(state.stages.length - 1, i + dir)].code }
  await api('/api/deals/' + id, { method: 'PATCH', body: JSON.stringify({ stage }) }); toast('Сделка переведена: ' + ((state.stages.find(s => s.code === stage) || {}).name || stage)); render();
}
async function openDeal(id) {
  if (!state.contacts.length) state.contacts = await api('/api/contacts');
  if (!state.pipelines.length) state.pipelines = await api('/api/pipelines');
  const d = id ? state.deals.find(x => x.id === id) || {} : { stage: 'new', pipeline_id: state.pipeline };
  const pid = d.pipeline_id || state.pipeline || 1;
  const st = (state.pipelines.find(x => x.id === pid) || {}).stages || state.stages;
  const users = await team();
  openModal(`<h3>${id ? 'Сделка' : 'Новая сделка'}</h3><form onsubmit="return saveDeal(event,${id || 'null'})">
   <label>Название*<input name="title" required value="${esc(d.title || '')}"></label>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Сумма, ₽<input name="amount" type="number" value="${d.amount || 0}"></label><label>Дедлайн<input name="deadline" type="date" value="${esc((d.deadline || '').slice(0, 10))}"></label></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    <label>Контакт<select name="contact_id"><option value="">— не выбран —</option>${state.contacts.map(c => `<option value="${c.id}" ${c.id === d.contact_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label>Воронка<select name="pipeline_id" onchange="selStages(this.value)">${state.pipelines.map(p => `<option value="${p.id}" ${p.id === (d.pipeline_id || state.pipeline) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    <label>Этап<select name="stage" id="dealStage">${st.map(s => `<option value="${esc(s.code)}" ${s.code === d.stage ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <label>Приоритет<select name="priority">${['low', 'normal', 'high'].map(x => `<option value="${x}" ${x === (d.priority || 'normal') ? 'selected' : ''}>${{ low: 'Низкий', normal: 'Обычный', high: 'Высокий' }[x]}</option>`).join('')}</select></label></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    <label>Ответственный<select name="responsible_id" onchange="window.__respName=this.selectedOptions[0].dataset.name">${userOptions(d.responsible_id, '— не назначен —')}</select>
     <input type="hidden" name="responsible" value="${esc(d.responsible || '')}" id="dealRespName"></label>
    <label>Причина отказа (для закрытых)<input name="loss_reason" placeholder="дорого / выбрал конкурента" value="${esc(d.loss_reason || '')}"></label></div>
   ${cfInputs('deals', d) ? `<h4 style="margin:12px 0 6px">Дополнительные поля</h4>${cfInputs('deals', d)}` : ''}
   <button class="btn primary w">Сохранить</button></form>`);
}
function selStages(pid) { const pl = state.pipelines.find(p => p.id == pid); if (pl) $('#dealStage').innerHTML = pl.stages.map(s => `<option value="${esc(s.code)}">${esc(s.name)}</option>`).join('') }
async function saveDeal(e, id) {
  e.preventDefault(); const data = cfCollect(e.target);
  data.amount = num(data.amount); data.pipeline_id = +data.pipeline_id; if (data.contact_id) data.contact_id = +data.contact_id; else delete data.contact_id;
  if (data.responsible_id) { data.responsible_id = +data.responsible_id; const u = state.users.find(x => x.id === data.responsible_id); if (u) data.responsible = u.name } else { delete data.responsible_id; delete data.responsible }
  await api(id ? '/api/deals/' + id : '/api/deals', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(data) });
  closeModal(); toast('Сделка сохранена'); render(); return false;
}
async function openDealCard(id) {
  const d = await api('/api/deals/' + id); const x = d.deal; state.dealId = id;
  const tabs = { details: 'Карточка', chat: `Переписка${d.messages && d.messages.length ? ' (' + d.messages.length + ')' : ''}`, products: 'Товары', tasks: 'Задачи', notes: 'Заметки', history: 'История' };
  openModal(`<h3>${esc(x.title)} <span class="tag orange">${fmt(x.amount)}</span></h3>
   <div class="tabs">${Object.entries(tabs).map(([k, n]) => `<button class="${state.dealTab === k ? 'active' : ''}" onclick="state.dealTab='${k}';openDealCard(${id})">${n}</button>`).join('')}</div>
   <div id="dealTab">${dealTab(d, id)}</div>
   <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn" onclick="openDeal(${id})">✎ Редактировать</button>${d.conversation ? `<button class="btn orange" onclick="closeModal();state.conv=${d.conversation.id};go('inbox')">💬 Переписка клиента</button>` : ''}<button class="btn ghost" onclick="openTask(null,{deal_id:${id},contact_id:${x.contact_id || 'null'}})">+ Задача</button><button class="btn ghost" onclick="${x.contact_id ? `openContactCard(${x.contact_id})` : 'openContact()'}">◎ Контакт</button><button class="btn danger" onclick="del('deals',${id});closeModal()">Удалить</button></div>`);
}
function dealTab(d, id) {
  const x = d.deal;
  if (state.dealTab === 'details') return `<table class="mini"><tr><th>Клиент</th><td>${esc(x.contact_name || '—')} ${x.contact_phone ? '· ' + esc(x.contact_phone) : ''}</td></tr><tr><th>Этап</th><td>${esc(x.stage)}</td></tr><tr><th>Приоритет</th><td>${esc(x.priority)}</td></tr><tr><th>Дедлайн</th><td>${esc(x.deadline || '—')}</td></tr><tr><th>Создана</th><td>${esc(dt(x.created_at))}</td></tr><tr><th>Обновлена</th><td>${esc(dt(x.updated_at))}</td></tr>${x.loss_reason ? `<tr><th>Причина отказа</th><td>${esc(x.loss_reason)}</td></tr>` : ''}${cfTable('deals', x)}</table>`;
  if (state.dealTab === 'chat') {
    const ch = (d.conversation && d.conversation.channels) || d.conversation?.chat_type || '';
    if (!d.conversation) return '<div class="empty">У сделки нет клиента с перепиской.<br><small>Прикрепите контакт — и все сообщения из WhatsApp, Telegram и почты появятся здесь.</small></div>';
    return `<div class="row" style="border:0"><b>Переписка клиента</b><button class="btn sm orange" onclick="closeModal();state.conv=${d.conversation.id};go('inbox')">Открыть чат и ответить</button></div>
     <small>Каналы: ${esc(ch || '—')}</small>
     <div class="list" style="margin-top:8px">${(d.messages || []).map(m => `<div class="row"><span><span class="chan ${esc(m.channel)}">${esc(m.channel)}</span> ${m.subject ? `<b>${esc(m.subject)}</b><br>` : ''}${esc(m.body)}<br><small>${esc(dt(m.created_at))}${m.author ? ' · ' + esc(m.author) : ''}${MSG_STATUS[m.status] || ''}</small></span></div>`).join('') || '<small>Сообщений пока нет — напишите клиенту из чата.</small>'}</div>`;
  }
  if (state.dealTab === 'products') return `<div class="row"><b>Позиции</b><button class="btn sm primary" onclick="addDealProduct(${id})">+ Добавить товар</button></div><table class="mini"><tr><th>Название</th><th>Цена</th><th>Кол-во</th><th>Сумма</th><th></th></tr>${(d.products || []).map(p => `<tr><td>${esc(p.name)}</td><td>${fmt(p.price)}</td><td>${p.qty}</td><td><b>${fmt(p.price * p.qty)}</b></td><td><button class="btn sm danger" onclick="delRow('deal_products',${p.id},${id})">✕</button></td></tr>`).join('') || '<tr><td colspan="5"><small>Позиций нет — добавьте товар из прайса</small></td></tr>'}</table>`;
  if (state.dealTab === 'tasks') return `<div class="row"><b>Задачи по сделке</b><button class="btn sm primary" onclick="openTask(null,{deal_id:${id}});closeModal()">+ Задача</button></div>${(d.tasks || []).map(t => `<div class="row"><label><input type="checkbox" ${t.done ? 'checked' : ''} onchange="toggleTask(${t.id},this.checked,${id})"> ${esc(t.title)} <small>${esc(t.due || '')}</small></label></div>`).join('') || '<small>Задач нет</small>'}`;
  if (state.dealTab === 'notes') return `<form onsubmit="return addNote(event,'deals',${id})"><label>Новая заметка<textarea name="body" rows="3" placeholder="Итоги звонка, договорённости…"></textarea></label><button class="btn primary">Добавить заметку</button></form>${(d.notes || []).map(n => `<div class="row"><span>${esc(n.body)}<br><small>${esc(n.author || '')} · ${esc(dt(n.created_at))}</small></span><button class="btn sm danger" onclick="delRow('notes',${n.id},${id})">✕</button></div>`).join('')}`;
  return `<div class="list">${(d.history || []).map(h => `<div class="row">• ${esc(h.text)}<small>${esc(dt(h.created_at))}</small></div>`).join('') || '<small>История пуста</small>'}</div>`;
}
async function addNote(e, type, id) { e.preventDefault(); await api('/api/notes', { method: 'POST', body: JSON.stringify({ entity_type: type, entity_id: id, body: new FormData(e.target).get('body') }) }); toast('Заметка добавлена'); openDealCard(id); return false }
async function addDealProduct(dealId) {
  const pr = await api('/api/products'); if (!pr.length) return toast('Сначала добавьте товары в разделе «Товары»');
  openModal(`<h3>Добавить товар в сделку</h3><form onsubmit="return saveDealProduct(event,${dealId})"><label>Товар<select name="product_id">${pr.map(p => `<option value="${p.id}">${esc(p.name)} — ${fmt(p.price)}</option>`).join('')}</select></label><label>Количество<input name="qty" type="number" value="1" min="0.1" step="0.1"></label><button class="btn primary w">Добавить</button></form>`);
}
async function saveDealProduct(e, dealId) { e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); b.product_id = +b.product_id; b.qty = +b.qty; await api(`/api/deals/${dealId}/products`, { method: 'POST', body: JSON.stringify(b) }); toast('Товар добавлен, сумма сделки обновлена'); state.dealTab = 'products'; openDealCard(dealId); return false }
async function delRow(table, id, refresh) { await api(`/api/${table}/${id}`, { method: 'DELETE' }); toast('Удалено'); if (refresh) openDealCard(refresh); else render() }

/* ---------- inbox ---------- */
async function inbox(v) {
  const convs = await api('/api/conversations');
  if (!state.channels.length) state.channels = await api('/api/channels').catch(() => []);
  const unread = convs.reduce((a, c) => a + c.unread, 0); $('#navUnread').textContent = unread || '';
  if (state.conv && !convs.find(c => c.id === state.conv)) state.conv = null;
  if (!state.conv && convs[0]) state.conv = convs[0].id;
  const cur = convs.find(c => c.id === state.conv);
  const msgs = cur ? await api(`/api/conversations/${cur.id}/messages`) : [];
  const chan = c => (c || 'whatsapp').split(',').map(x => `<span class="chan ${esc(x)}">${esc(x)}</span>`).join(' ');
  v.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap"><input id="convSearch" style="max-width:280px" placeholder="🔍 Поиск по чатам" oninput="filterConvs(this.value)">
   <button class="btn orange" onclick="simulate()">+ Тестовое входящее</button><button class="btn" onclick="go('settings','integrations')">⚙ Настроить Wazzup</button></div>
  <div class="inbox">
   <div id="convList">${convs.map(c => `<div class="conv ${c.id === state.conv ? 'active' : ''}" data-name="${esc((c.title || '').toLowerCase() + ' ' + (c.phone || ''))}" onclick="state.conv=${c.id};render()"><b>${esc(c.title || 'Клиент')} ${c.unread ? `<span class="badge">${c.unread}</span>` : ''}</b><p>${esc(c.last_body || '')}</p><small>${chan(c.channels)} · ${esc(dt(c.last_at).slice(0, 10))}</small></div>`).join('') || '<div class="empty">Чатов пока нет.<br><small>Подключите Wazzup или нажмите «Тестовое входящее».</small></div>'}</div>
   <div class="chat">${cur ? `<div class="chat-head"><b>${esc(cur.title || '')}</b><small>${esc(cur.phone || '')} · ${chan(cur.chat_type || cur.channels)}</small><span style="margin-left:auto;display:flex;gap:6px"><button class="btn sm" onclick="openEmailComposer(${cur.id})" title="Написать письмо с e-mail компании">✉ Письмо</button></span></div>
    <div class="msgs" id="msgs">${msgs.map(m => `<div class="msg ${m.direction}"><span class="chan ${esc(m.channel)}">${esc(m.channel)}</span> ${m.subject ? `<b>${esc(m.subject)}</b><br>` : ''}${esc(m.body)}<small>${esc(dt(m.created_at))}${m.author ? ' · ' + esc(m.author) : ''}${MSG_STATUS[m.status] || ''}${m.content_uri ? ` · <a href="${esc(m.content_uri)}" target="_blank" rel="noopener">вложение</a>` : ''}</small></div>`).join('') || '<div class="empty">Нет сообщений</div>'}</div>
    <form class="composer" onsubmit="return sendMsg(event)">
     <select id="msgChannel" title="Канал отправки">${state.channels.filter(c => c.state === 'active' || !c.state).map(c => `<option value="${esc(c.external_id)}" data-type="${esc(c.transport || 'whatsapp')}">${esc(c.name || c.phone || c.transport || 'канал')}</option>`).join('') || '<option value="">локально</option>'}</select>
     <input id="msgText" placeholder="Написать клиенту…" required autocomplete="off">
     <select id="tplSel" style="width:auto" onchange="if(this.value){$('#msgText').value=$('#msgText').value||this.value;this.selectedIndex=0}" title="Шаблоны"><option value="">Шаблоны</option>${(state.cache.templates || []).map(t => `<option value="${esc(t.body)}">${esc(t.name)}</option>`).join('')}</select>
     <button class="btn" title="Прикрепить файл ссылкой" onclick="openAttachment()">📎</button>
     <button class="btn primary">➤</button></form>` : '<div class="empty">Выберите чат слева</div>'}</div>
   <div class="profile">${cur ? `<h3>Клиент</h3><p><b>${esc(cur.title || '')}</b></p><p>📞 ${esc(cur.phone || '—')}<br>✉ ${esc(cur.email || '—')}</p><p>Каналы: ${chan(cur.channels)}${(cur.channels || '').includes('email') ? ' <span class="tag grey">почта подключена</span>' : ''}</p><p><button class="btn sm" onclick="attachContact(${cur.contact_id})">Открыть карточку клиента</button></p><hr><h3>Быстрые действия</h3><div style="display:flex;flex-direction:column;gap:6px"><button class="btn sm" onclick="openTask(null,{contact_id:${cur.contact_id}})">+ Задача</button><button class="btn sm" onclick="quickDeal(${cur.contact_id})">+ Сделка</button><button class="btn sm" onclick="quickNote(${cur.contact_id})">+ Заметка</button></div>` : '<div class="empty">Выберите чат</div>'}</div></div>`;
  if (!state.cache.templates) state.cache.templates = await api('/api/templates'), render();
  const m = $('#msgs'); if (m) m.scrollTop = m.scrollHeight;
}
function filterConvs(q) { q = q.toLowerCase(); $$('#convList .conv').forEach(el => el.style.display = !q || el.dataset.name.includes(q) ? '' : 'none') }
async function attachContact(id) { go('contacts'); setTimeout(() => openContact(id), 250) }
async function quickDeal(contactId) { await api('/api/deals', { method: 'POST', body: JSON.stringify({ title: 'Новая сделка', stage: 'new', contact_id: contactId, pipeline_id: state.pipeline }) }); toast('Сделка создана'); go('pipe') }
async function quickNote(contactId) { openModal(`<h3>Заметка о клиенте</h3><form onsubmit="return saveQuickNote(event,${contactId})"><label>Текст<textarea name="body" rows="3"></textarea></label><button class="btn primary w">Сохранить</button></form>`) }
async function saveQuickNote(e, id) { e.preventDefault(); await api('/api/notes', { method: 'POST', body: JSON.stringify({ entity_type: 'contacts', entity_id: id, body: new FormData(e.target).get('body') }) }); closeModal(); toast('Заметка сохранена'); return false }
async function sendMsg(e) {
  e.preventDefault(); const body = $('#msgText').value; const sel = $('#msgChannel');
  const d = await api(`/api/conversations/${state.conv}/messages`, { method: 'POST', body: JSON.stringify({ body, channel_id: sel?.value || '', chat_type: sel?.selectedOptions?.[0]?.dataset.type || 'whatsapp' }) });
  toast(d.send.delivered ? 'Отправлено: ' + d.send.mode : 'Сохранено локально (' + d.send.mode + ')'); render(); return false;
}
function openAttachment() {
  openModal(`<h3>📎 Прикрепить файл к сообщению</h3><p><small>Wazzup отправляет файлы по ссылке: загрузите файл на любой доступный по ссылке диск (Яндекс.Диск, Google Drive, ваш сайт) и вставьте ссылку. Для изображений WhatsApp покажет превью.</small></p>
   <form onsubmit="return sendAttachment(event)">
    <label>Ссылка на файл (https://…)<input name="contentUri" required placeholder="https://disk.yandex.ru/i/…"></label>
    <label>Подпись<input name="body" placeholder="Необязательно: смета во вложении"></label>
    <button class="btn primary w">Отправить в чат</button></form>`);
}
async function sendAttachment(e) {
  e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); const sel = $('#msgChannel');
  try {
    const d = await api(`/api/conversations/${state.conv}/messages`, { method: 'POST', body: JSON.stringify({ ...b, channel_id: sel?.value || '', chat_type: sel?.selectedOptions?.[0]?.dataset.type || 'whatsapp' }) });
    closeModal(); toast(d.send.delivered ? 'Файл отправлен' : 'Файл сохранён в чате (' + d.send.mode + ')'); render();
  } catch (err) { toast('Ошибка: ' + err.message) }
  return false;
}
async function openEmailComposer(convId) {
  const conv = (await api('/api/conversations')).find(c => c.id === convId) || {};
  openModal(`<h3>✉ Письмо клиенту</h3><p><small>Уходит с адреса компании (Настройки → Интеграции → Почта). Ответ клиента вернётся в этот же чат, если настроена пересылка входящих на вебхук CRM.</small></p>
   <form onsubmit="return sendEmail(event,${convId})">
    <label>Кому<input name="to" type="email" required value="${esc(conv.email || '')}" placeholder="client@mail.ru"></label>
    <label>Тема<input name="subject" required value="Предложение от ${esc((state.meta && state.meta.company && state.meta.company.name) || 'компании')}"></label>
    <label>Текст письма<textarea name="body" rows="7" required placeholder="Здравствуйте! Отправляю расчёт…"></textarea></label>
    <button class="btn primary w">Отправить письмо</button></form>`);
}
async function sendEmail(e, convId) {
  e.preventDefault(); const b = Object.fromEntries(new FormData(e.target));
  toast('Отправляем письмо…');
  try { const r = await api(`/api/conversations/${convId}/email`, { method: 'POST', body: JSON.stringify(b) }); closeModal(); toast(r.send.delivered ? 'Письмо отправлено: ' + b.to : 'Письмо сохранено в чате (' + r.send.mode + ')'); render() }
  catch (err) { toast('Ошибка: ' + err.message) }
  return false;
}
async function simulate() { await api('/api/inbox/simulate', { method: 'POST', body: JSON.stringify({ channel: ['whatsapp', 'telegram', 'instagram'][Math.floor(Math.random() * 3)], phone: '+7 9' + Math.floor(100000000 + Math.random() * 899999999), name: 'Клиент ' + (Math.floor(Math.random() * 90) + 10), body: 'Здравствуйте! Интересует каркасный дом, пришлите расчёт, пожалуйста.' }) }); toast('Входящее сообщение получено'); if (state.view !== 'inbox') go('inbox'); else render() }

/* ---------- contacts / companies ---------- */
async function contacts(v) {
  const rows = await api('/api/contacts'); state.contacts = rows;
  const q = ($('#globalSearch').value || '').toLowerCase();
  const f = rows.filter(c => !q || JSON.stringify(c).toLowerCase().includes(q));
  v.innerHTML = `<div class="card"><div class="row" style="border:0"><b>Всего: ${rows.length}</b><span style="display:flex;gap:8px"><button class="btn sm" onclick="openDuplicates()">🔁 Дубли</button><button class="btn sm" onclick="download('/api/export/contacts','contacts.csv')">⬇ CSV</button><button class="btn sm" onclick="importContacts()">⬆ Импорт CSV</button></span></div>
   <table><tr><th>Клиент</th><th>Контакты</th><th>Компания / источник</th><th>Теги</th><th></th></tr>${f.map(c => `<tr><td><b>${esc(c.name)}</b>${c.position ? `<br><small>${esc(c.position)}</small>` : ''}</td><td>${esc(c.phone || '')}<br><small>${esc(c.email || '')}</small></td><td>${esc(c.company || '—')} <span class="tag grey">${esc(c.source || '')}</span></td><td>${(c.tags || '').split(',').filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</td>
   <td><button class="btn sm" onclick="openContactCard(${c.id})">Открыть</button> <button class="btn sm" onclick="openContact(${c.id})">✎</button> <button class="btn sm danger" onclick="del('contacts',${c.id})">✕</button></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Контактов нет</div></td></tr>'}</table></div>`;
}
async function openContactCard(id) {
  const c = state.contacts.find(x => x.id === id) || await api('/api/contacts/' + id);
  const notes = await api(`/api/notes?type=contacts&entity=${id}`);
  const deals = (await api('/api/deals')).deals.filter(d => d.contact_id === id);
  const conv = (await api('/api/conversations').catch(() => [])).find(x => x.contact_id === id);
  openModal(`<h3>${esc(c.name)}</h3><table class="mini"><tr><th>Телефон</th><td>${esc(c.phone || '—')}</td></tr><tr><th>E-mail</th><td>${esc(c.email || '—')}</td></tr><tr><th>Компания</th><td>${esc(c.company || '—')}</td></tr><tr><th>Источник</th><td>${esc(c.source || '')}</td></tr><tr><th>Теги</th><td>${(c.tags || '').split(',').filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</td></tr>${cfTable('contacts', c)}</table>
   <h3 style="margin-top:14px">Сделки клиента</h3>${deals.map(d => `<div class="row"><span>${esc(d.title)}<br><small>${esc(d.stage)}</small></span><b>${fmt(d.amount)}</b></div>`).join('') || '<small>Сделок нет</small>'}
   <h3 style="margin-top:14px">Заметки</h3><form onsubmit="return addNote(event,'contacts',${id})"><textarea name="body" rows="2" placeholder="Заметка…"></textarea><button class="btn primary" style="margin-top:6px">Добавить</button></form>${notes.map(n => `<div class="row"><span>${esc(n.body)}<br><small>${esc(n.author || '')} · ${esc(dt(n.created_at))}</small></span></div>`).join('')}
   <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">${conv ? `<button class="btn primary" onclick="closeModal();state.conv=${conv.id};go('inbox')">💬 Переписка (${conv.unread ? '+' + conv.unread + ' новых' : esc((conv.channels || '').split(',').join(', '))})</button>` : ''}<button class="btn" onclick="openContact(${id})">✎ Редактировать</button><button class="btn ghost" onclick="openTask(null,{contact_id:${id}});closeModal()">+ Задача</button><button class="btn ghost" onclick="quickDeal(${id})">+ Сделка</button></div>`);
}
async function openContact(id, preset = {}) {
  const c = id ? (state.contacts.find(x => x.id === id) || await api('/api/contacts/' + id)) : preset;
  await team();
  openModal(`<h3>${id ? 'Контакт' : 'Новый контакт'}</h3><form onsubmit="return saveContact(event,${id || 'null'})">
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Имя*<input name="name" required value="${esc(c.name || '')}"></label><label>Телефон<input name="phone" value="${esc(c.phone || '')}"></label></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>E-mail<input name="email" value="${esc(c.email || '')}"></label><label>Должность<input name="position" value="${esc(c.position || '')}"></label></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Компания<input name="company" value="${esc(c.company || '')}"></label><label>Источник<input name="source" value="${esc(c.source || 'manual')}"></label></div>
   <label>Ответственный<select name="responsible_id">${userOptions(c.responsible_id, '— не назначен —')}</select></label>
   <label>Теги (через запятую)<input name="tags" value="${esc(c.tags || '')}"></label><label>Заметки<textarea name="notes" rows="2">${esc(c.notes || '')}</textarea></label>
   ${cfInputs('contacts', c) ? `<h4 style="margin:12px 0 6px">Дополнительные поля</h4>${cfInputs('contacts', c)}` : ''}
   <button class="btn primary w">Сохранить</button></form>`);
}
async function saveContact(e, id) { e.preventDefault(); const b = cfCollect(e.target); if (b.responsible_id) b.responsible_id = +b.responsible_id; else delete b.responsible_id; await api(id ? '/api/contacts/' + id : '/api/contacts', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) }); closeModal(); toast('Контакт сохранён'); render(); return false }

/* ---------- дубли контактов ---------- */
async function openDuplicates() {
  const d = await api('/api/contacts/duplicates'); state.dupes = d;
  openModal(`<h3>🔁 Дубли контактов <span class="tag orange">${d.total}</span></h3>
   <p><small>CRM нашла контакты с одинаковым телефоном или e-mail. Выберите, какую карточку оставить основной — сделки, задачи, заметки и всю переписку перенесём в неё, лишние карточки удалим.</small></p>
   ${d.groups.map((g, gi) => `<div class="card" style="box-shadow:none"><b>${g.type === 'phone' ? '📞 одинаковый телефон' : '✉ одинаковый e-mail'}: ${esc(g.key.split(':')[1])}</b>
     <div style="margin-top:8px">${g.contacts.map(c => `<label style="display:flex;gap:8px;align-items:center;padding:4px 0"><input type="radio" name="keep_${gi}" value="${c.id}" style="width:auto" ${c.id === g.contacts[0].id ? 'checked' : ''}><span>${esc(c.name)} <small>${esc(c.phone || '')} ${esc(c.email || '')} · источник ${esc(c.source || '')} · создан ${esc(dt(c.created_at))}</small></span></label>`).join('')}</div>
     <button class="btn sm primary" onclick="mergeGroup(${gi})">Объединить в выбранную</button></div>`).join('') || '<div class="empty">Дублей не найдено — база аккуратная 👍</div>'}`);
}
async function mergeGroup(gi) {
  const g = state.dupes.groups[gi]; const keep = +($(`input[name="keep_${gi}"]:checked`) || {}).value || 0;
  if (!keep) return toast('Выберите основную карточку');
  const ids = g.contacts.map(c => c.id);
  if (!confirm('Объединить контакты в выбранную карточку?')) return;
  const r = await api('/api/contacts/merge', { method: 'POST', body: JSON.stringify({ keep, ids }) });
  toast(`Объединено карточек: ${r.merged}`); state.contacts = []; openDuplicates(); render();
}
async function companies(v) {
  const rows = await api('/api/companies'); state.companies = rows;
  v.innerHTML = `<div class="card"><div class="row" style="border:0"><b>Компаний: ${rows.length}</b><button class="btn sm primary" onclick="openCompany()">+ Компания</button></div>
   <table><tr><th>Название</th><th>Телефон / e-mail</th><th>ИНН</th><th>Сайт</th><th></th></tr>${rows.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.phone || '')}<br><small>${esc(c.email || '')}</small></td><td>${esc(c.inn || '')}</td><td>${esc(c.site || '')}</td><td><button class="btn sm" onclick="openCompany(${c.id})">✎</button> <button class="btn sm danger" onclick="del('companies',${c.id})">✕</button></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Компаний нет</div></td></tr>'}</table></div>`;
}
async function openCompany(id) {
  const c = id ? (state.companies.find(x => x.id === id) || await api('/api/companies/' + id)) : {};
  openModal(`<h3>${id ? 'Компания' : 'Новая компания'}</h3><form onsubmit="return saveCompany(event,${id || 'null'})">
   <label>Название*<input name="name" required value="${esc(c.name || '')}"></label>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>ИНН<input name="inn" value="${esc(c.inn || '')}"></label><label>Телефон<input name="phone" value="${esc(c.phone || '')}"></label></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>E-mail<input name="email" value="${esc(c.email || '')}"></label><label>Сайт<input name="site" value="${esc(c.site || '')}"></label></div>
   <label>Заметки<textarea name="notes" rows="2">${esc(c.notes || '')}</textarea></label><button class="btn primary w">Сохранить</button></form>`);
}
async function saveCompany(e, id) { e.preventDefault(); await api(id ? '/api/companies/' + id : '/api/companies', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) }); closeModal(); toast('Компания сохранена'); render(); return false }

/* ---------- tasks ---------- */
async function tasks(v) {
  const all = await api('/api/tasks'); await team();
  const today = new Date().toISOString().slice(0, 10);
  const rows = state.taskScope === 'mine' ? all.filter(t => t.responsible_id === meId() || (!t.responsible_id && !t.done && false)) : all;
  const groups = [['Просроченные', rows.filter(t => !t.done && (t.due || '').match(/^\d{4}/) && t.due < today)], ['Сегодня', rows.filter(t => !t.done && (t.due || '').startsWith(today))], ['Активные', rows.filter(t => !t.done && !((t.due || '').match(/^\d{4}/) && t.due < today) && !(t.due || '').startsWith(today))], ['Выполненные', rows.filter(t => t.done)]];
  const types = { call: '📞 Звонок', meeting: '👥 Встреча', message: '✉ Сообщение', email: '📧 Письмо', other: '• Дело' };
  const mineOpen = all.filter(t => !t.done && (t.responsible_id === meId() || !t.responsible_id)).length;
  v.innerHTML = `<div class="card"><div class="row" style="border:0;flex-wrap:wrap;gap:8px"><b>Задач: ${rows.length}</b>
   <span class="tabs" style="margin:0"><button class="${state.taskScope === 'mine' ? 'active' : ''}" onclick="state.taskScope='mine';render()">Мои (${mineOpen})</button><button class="${state.taskScope === 'all' ? 'active' : ''}" onclick="state.taskScope='all';render()">Все (${all.filter(t => !t.done).length})</button></span>
   <button class="btn sm primary" style="margin-left:auto" onclick="openTask()">+ Задача</button></div>
   <p><small>«Мои» — задачи, назначенные на вас (${esc((state.me && state.me.name) || '')})${state.taskScope === 'mine' ? '; неназначенные задачи тоже попадают в список' : ''}.</small></p>
   ${groups.map(([t, list]) => list.length ? `<h3 style="margin-top:12px">${t} <small>${list.length}</small></h3>${list.map(x => `<div class="row"><label><input type="checkbox" ${x.done ? 'checked' : ''} onchange="toggleTask(${x.id},this.checked)"> <span style="${x.done ? 'text-decoration:line-through;color:#94a3b8' : ''}">${types[x.type] || '•'} ${esc(x.title)}</span> <small>${esc(x.due || '')}${x.contact_name ? ' · ' + esc(x.contact_name) : ''}${x.deal_title ? ' · ' + esc(x.deal_title) : ''}${x.responsible_name ? ' · 👤 ' + esc(x.responsible_name) : ''}</small></label><span style="display:flex;gap:6px"><button class="btn sm" onclick="openTask(${x.id})">✎</button><button class="btn sm danger" onclick="del('tasks',${x.id})">✕</button></span></div>`).join('')}` : '').join('') || '<div class="empty">Задач нет — добавьте первую!</div>'}</div>`;
}
async function toggleTask(id, done, refreshId) { await api('/api/tasks/' + id, { method: 'PATCH', body: JSON.stringify({ done: done ? 1 : 0 }) }); toast(done ? 'Задача выполнена' : 'Задача возвращена'); if (refreshId) openDealCard(refreshId); else render() }
async function openTask(id, p = {}) {
  const t = id ? await api('/api/tasks/' + id) : p; if (!state.contacts.length) state.contacts = await api('/api/contacts');
  await team();
  const deals = state.deals.length ? state.deals : (await api('/api/deals')).deals;
  openModal(`<h3>${id ? 'Задача' : 'Новая задача'}</h3><form onsubmit="return saveTask(event,${id || 'null'})">
   <label>Что сделать*<input name="title" required value="${esc(t.title || '')}"></label>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Тип<select name="type">${Object.entries({ call: 'Звонок', meeting: 'Встреча', message: 'Сообщение', email: 'Письмо', other: 'Другое' }).map(([k, n]) => `<option value="${k}" ${k === (t.type || 'call') ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
   <label>Срок<input name="due" type="datetime-local" value="${esc((t.due || '').slice(0, 16))}"></label></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Контакт<select name="contact_id"><option value="">—</option>${state.contacts.map(c => `<option value="${c.id}" ${c.id === t.contact_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
   <label>Сделка<select name="deal_id"><option value="">—</option>${deals.map(d => `<option value="${d.id}" ${d.id === t.deal_id ? 'selected' : ''}>${esc(d.title)}</option>`).join('')}</select></label></div>
   <label>Ответственный<select name="responsible_id">${userOptions(t.responsible_id ?? meId(), '— как в сделке —')}</select></label>
   <label>Комментарий<textarea name="result" rows="2">${esc(t.result || '')}</textarea></label><button class="btn primary w">Сохранить</button></form>`);
}
async function saveTask(e, id) { e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); ['contact_id', 'deal_id', 'responsible_id'].forEach(k => { if (b[k]) b[k] = +b[k]; else delete b[k] }); await api(id ? '/api/tasks/' + id : '/api/tasks', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) }); closeModal(); toast('Задача сохранена'); render(); return false }

/* ---------- products ---------- */
async function products(v) {
  const rows = await api('/api/products');
  v.innerHTML = `<div class="card"><div class="row" style="border:0"><b>Позиций: ${rows.length}</b><button class="btn sm primary" onclick="openProduct()">+ Товар/услуга</button></div>
  <table><tr><th>Название</th><th>Артикул</th><th>Цена</th><th>Ед.</th><th></th></tr>${rows.map(p => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.sku || '')}</td><td>${fmt(p.price)}</td><td>${esc(p.unit || '')}</td><td><button class="btn sm" onclick="openProduct(${p.id})">✎</button> <button class="btn sm danger" onclick="del('products',${p.id})">✕</button></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Прайс пуст</div></td></tr>'}</table>
  <p><small>Цены подставляются в сделки: карточка сделки → вкладка «Товары» → сумма сделки пересчитывается автоматически.</small></p></div>`;
}
async function openProduct(id) {
  const rows = await api('/api/products'); const p = id ? (rows.find(x => x.id === id) || {}) : {};
  openModal(`<h3>${id ? 'Товар' : 'Новый товар'}</h3><form onsubmit="return saveProduct(event,${id || 'null'})">
   <label>Название*<input name="name" required value="${esc(p.name || '')}"></label>
   <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px"><label>Артикул<input name="sku" value="${esc(p.sku || '')}"></label><label>Цена, ₽<input name="price" type="number" value="${p.price || 0}"></label><label>Ед.<input name="unit" value="${esc(p.unit || 'шт')}"></label></div>
   <button class="btn primary w">Сохранить</button></form>`);
}
async function saveProduct(e, id) { e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); b.price = num(b.price); await api(id ? '/api/products/' + id : '/api/products', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) }); closeModal(); toast('Сохранено'); render(); return false }

/* ---------- analytics ---------- */
async function analytics(v) {
  const a = await api('/api/analytics'); const max = Math.max(...a.stages.map(s => s.sum), 1);
  const plan = a.plan || { target: 0, fact: 0, percent: null };
  const planBlock = plan.target ? `<div class="card"><h3 style="display:flex;justify-content:space-between;align-items:center">План на месяц <button class="btn sm" onclick="setSalesPlan(${plan.target})">✎ Изменить</button></h3>
   <p style="display:flex;justify-content:space-between;margin:6px 0 4px"><span>Факт: <b>${fmt(plan.fact)}</b> из ${fmt(plan.target)}</span><b class="${plan.percent >= 100 ? 'green' : 'accent'}">${plan.percent}%</b></p>
   <div class="bar"><i style="width:${Math.min(100, plan.percent || 0)}%"></i></div>
   <p><small>Успешных сделок в этом месяце: ${plan.deals}. Осталось выполнить: ${fmt(Math.max(0, plan.target - plan.fact))}.</small></p></div>`
    : `<div class="card"><h3>План продаж на месяц</h3><p><small>Задайте план — CRM покажет выполнение в процентах и подскажет, сколько осталось до цели.</small></p><button class="btn orange" onclick="setSalesPlan(0)">🎯 Задать план продаж</button></div>`;
  v.innerHTML = `<div class="grid"><div class="kpi"><i>📈</i><span>Конверсия в успех</span><b class="green">${a.conversion}%</b></div>
   <div class="kpi"><i>💵</i><span>Средний чек (выигранные)</span><b>${fmt(a.avgCheck)}</b></div>
   <div class="kpi"><i>🔮</i><span>Прогноз выручки (в работе)</span><b class="accent">${fmt(a.forecast)}</b></div></div>
  ${planBlock}
  <div class="cols"><div class="card"><h3>Выручка по этапам</h3><div class="chart">${a.stages.map(s => `<div><b style="color:var(--ink)">${s.count}</b><i style="height:${Math.max(4, Math.round(s.sum / max * 120))}px" title="${fmt(s.sum)}"></i><span>${esc(s.name.slice(0, 12))}</span></div>`).join('')}</div></div>
  <div class="card"><h3>Источники лидов</h3>${a.bySource.map(s => `<div class="row"><span>${esc(s.name)} <small>${s.count} сделок</small></span><b>${fmt(s.sum)}</b></div>`).join('') || '<small>Нет данных</small>'}<hr><h3>Причины отказов</h3>${a.byLoss.map(s => `<div class="row"><span>${esc(s.name)}</span><b>${s.count}</b></div>`).join('') || '<small>Отказов нет 🎉</small>'}</div></div>`;
}

async function setSalesPlan(current) {
  const v = prompt('План продаж на месяц, ₽:', current || 1000000);
  if (v === null) return;
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ SALES_TARGET: v }) });
  toast('План сохранён'); render();
}

/* ---------- конкуренты ---------- */
const RISK_CLASS = l => ({ 'низкий': 'ok', 'умеренный': 'mid', 'повышенный': 'warn', 'высокий': 'bad' }[l] || 'mid');
const STATUS_LABEL = { ok: '✅ получено', skipped: '🔑 нужен ключ', blocked: '⛔ сайт не отдал', error: '⚠ ошибка' };
async function competitorsView(v) {
  const list = await api('/api/competitors');
  const badge = c => c.risk === null ? '<span class="risk mid">не проверен</span>' : `<span class="risk ${RISK_CLASS(c.level)}">риск ${c.risk} · ${esc(c.level)}</span>`;
  v.innerHTML = `<div class="card">
   <h3>Кого проверяем?</h3>
   <div class="row" style="border:0;flex-wrap:wrap;gap:8px">
    <input id="compQuery" style="flex:1;min-width:240px" placeholder="Название конкурента или ИНН/ОГРН — например «КаркасСтрой» или 7701234567">
    <input id="compCity" style="max-width:170px" placeholder="Город (для отзывов)">
    <button class="btn primary" onclick="findCompetitor()">🔎 Проверить конкурента</button>
    <button class="btn" onclick="openCompetitor()">+ Вручную</button>
    <button class="btn ghost" onclick="openPriceImport(null,'ours')">📊 Загрузить нашу таблицу</button></div>
   <small>Проверяем: ФНС (статус, недоимки, руководители) · ФССП (долги приставов) · Федресурс (банкротство) · арбитражные суды · Rusprofile (связи) · отзывы с Google/Яндекс/2ГИС и Авито · цены из Excel-таблиц. Часть источников требует ключ — они честно помечаются, а ручные ссылки на проверку есть всегда.</small>
  </div>
  <div class="grid">${list.map(c => `<div class="kpi" style="display:flex;flex-direction:column;gap:6px">
    <div style="display:flex;justify-content:space-between;align-items:start;gap:8px"><b style="font-size:15px">${esc(c.name)}</b>${badge(c)}</div>
    <small>${c.inn ? 'ИНН ' + esc(c.inn) : 'ИНН не указан'}${c.city ? ' · ' + esc(c.city) : ''}</small>
    <small>${c.reviews ? '⭐ ' + (c.avg_rating ?? '—') + ' · отзывов ' + c.reviews : 'отзывов нет'}${c.prices ? ' · цен ' + c.prices : ''}${c.checked_at ? ' · проверен ' + esc(dt(c.checked_at)) : ''}</small>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px"><button class="btn sm primary" onclick="openCompetitorCard(${c.id})">Отчёт</button><button class="btn sm" onclick="checkCompetitor(${c.id})">↻ Проверить</button><button class="btn sm" onclick="openCompetitor(${c.id})">✎</button><button class="btn sm danger" onclick="delCompetitor(${c.id})">✕</button></div>
    ${c.verdict ? `<small style="color:var(--muted)">${esc(c.verdict.slice(0, 150))}</small>` : ''}</div>`).join('') || '<div class="card empty">Список пуст — впишите название конкурента выше и нажмите «Проверить». CRM соберёт отчёт по 8 источникам и сравнит цены с нашей таблицей.</div>'}</div>`;
}
async function findCompetitor() {
  const name = $('#compQuery').value.trim(); if (!name) return toast('Введите название конкурента или ИНН');
  toast('Проверяем источники… это может занять до 20 секунд');
  try {
    const r = await api('/api/competitors/find', { method: 'POST', body: JSON.stringify({ name, city: $('#compCity').value.trim() }) });
    const risky = r.report.factors.filter(f => f.type === 'risk').length;
    toast(`Отчёт готов: риск ${r.report.risk} (${r.report.level}), негативных факторов ${risky}`);
    await render(); openCompetitorCard(r.competitor.id);
  } catch (e) { toast('Ошибка: ' + e.message) }
}
async function checkCompetitor(id) { toast('Обновляем данные…'); try { const r = await api(`/api/competitors/${id}/check`, { method: 'POST', body: JSON.stringify({}) }); toast(`Готово: риск ${r.report.risk} (${r.report.level})${r.changes.length ? ' · ' + r.changes.join(' · ') : ''}`); if (!$('#modal').classList.contains('hidden') && state.compId === id) openCompetitorCard(id); else render(); } catch (e) { toast('Ошибка: ' + e.message) } }
async function delCompetitor(id) { if (!confirm('Удалить конкурента и его отчёты?')) return; await api('/api/competitors/' + id, { method: 'DELETE' }); toast('Удалено'); render() }
async function openCompetitor(id) {
  const c = id ? await api('/api/competitors/' + id) : {};
  openModal(`<h3>${id ? 'Конкурент' : 'Новый конкурент для разведки'}</h3><form onsubmit="return saveCompetitor(event,${id || 'null'})">
   <label>Название*<input name="name" required value="${esc(c.name || '')}" placeholder="ООО «КаркасСтрой»"></label>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>ИНН<input name="inn" value="${esc(c.inn || '')}" placeholder="10–12 цифр"></label><label>ОГРН<input name="ogrn" value="${esc(c.ogrn || '')}"></label></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Город<input name="city" value="${esc(c.city || '')}"></label><label>Телефон<input name="phone" value="${esc(c.phone || '')}"></label></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Сайт<input name="website" value="${esc(c.website || '')}"></label><label>Ссылка на его таблицу цен (CSV/Google Sheets)<input name="price_url" value="${esc(c.price_url || '')}"></label></div>
   <label>Заметки<textarea name="notes" rows="2">${esc(c.notes || '')}</textarea></label>
   <button class="btn primary w">Сохранить</button></form>`);
}
async function saveCompetitor(e, id) { e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); const r = await api(id ? '/api/competitors/' + id : '/api/competitors', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) }); closeModal(); toast('Сохранено'); if (!id && r.id) return openCompetitorCard(r.id); render(); return false }
async function openCompetitorCard(id) {
  state.compId = id; state.compTab = state.compTab || 'report';
  const c = await api('/api/competitors/' + id);
  const rep = c.report || {};
  const tabs = { report: 'Отчёт', sources: 'Источники', debts: 'Долги и суды', reviews: 'Отзывы', prices: 'Цены и Excel', history: 'История' };
  openModal(`<h3 style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">${esc(c.name)}
    ${rep.risk !== undefined ? `<span class="risk ${RISK_CLASS(rep.level)}">риск ${rep.risk} · ${esc(rep.level)}</span>` : '<span class="risk mid">не проверен</span>'}
    <button class="btn sm primary" onclick="checkCompetitor(${id})">↻ Проверить заново</button></h3>
   <div class="tabs">${Object.entries(tabs).map(([k, n]) => `<button class="${state.compTab === k ? 'active' : ''}" onclick="state.compTab='${k}';openCompetitorCard(${id})">${n}</button>`).join('')}</div>
   <div id="compTab">${competitorTab(c, rep)}</div>
   <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn" onclick="openCompetitor(${id})">✎ Реквизиты</button><button class="btn ghost" onclick="openPriceImport(${id},'competitor')">📊 Его прайс</button><button class="btn ghost" onclick="openPriceImport(${id},'ours')">📊 Наша таблица</button><button class="btn danger" onclick="delCompetitor(${id});closeModal()">Удалить</button></div>`);
}
const RISK_COLORS = { 'низкий': '#16a34a', 'умеренный': '#eab308', 'повышенный': '#f97316', 'высокий': '#dc2626' };
function competitorTab(c, rep) {
  if (state.compTab === 'report') {
    if (!rep.risk && rep.risk !== 0) return '<div class="empty">Ещё не проверяли. Нажмите «Проверить заново» — соберём данные из 8 источников.</div>';
    const color = RISK_COLORS[rep.level] || '#eab308';
    const f = rep.found || {};
    return `${rep.noData ? '<div class="card" style="box-shadow:none;border-color:#fde68a;background:#fffbeb"><b>⚠ Пока мало данных</b><br><small>Ни один источник не отдал данные автоматически: нет ключей или сайты ограничили запросы. Нажмите Настройки → «Конкуренты и источники», чтобы задать ключи, добавьте отзывы вручную и загрузите прайс — отчёт станет содержательным.</small></div>' : ''}
     <div class="card" style="box-shadow:none"><div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
      <div style="min-width:120px;text-align:center"><div style="font-size:34px;font-weight:800;color:${color}">${rep.risk}</div><small>риск 0–100 · ${esc(rep.level)}</small><div class="bar" style="margin-top:6px"><i style="width:${rep.risk}%;background:${color}"></i></div></div>
      <div style="flex:1;min-width:240px"><b>Вердикт:</b><br>${esc(rep.verdict || '')}</div></div></div>
     ${f.name ? `<table class="mini"><tr><th>Компания</th><td>${esc(f.name)}</td></tr>${f.inn ? `<tr><th>ИНН / ОГРН</th><td>${esc(f.inn)} / ${esc(f.ogrn || '—')}</td></tr>` : ''}${f.director ? `<tr><th>Руководитель</th><td>${esc(f.director)}</td></tr>` : ''}${f.address ? `<tr><th>Адрес</th><td>${esc(f.address)}</td></tr>` : ''}</table>` : ''}
     <h3 style="margin-top:14px">Что говорит в нашу пользу</h3>${(rep.talking_points || []).map(t => `<div class="row"><span>${esc(t)}</span></div>`).join('') || '<small>Нет данных — проверьте источники с ключами</small>'}
     ${rep.factors?.length ? `<h3 style="margin-top:14px">Все факторы</h3><table class="mini">${rep.factors.map(x => `<tr><td>${x.type === 'risk' ? '⚠' : x.type === 'plus' ? '✅' : 'ℹ'} ${esc(x.text)}</td><td style="white-space:nowrap"><small>${esc(x.source)}${x.weight ? ' · ' + (x.weight > 0 ? '+' : '') + x.weight : ''}</small></td></tr>`).join('')}</table>` : ''}
     ${rep.summary?.length ? `<p><small>${rep.summary.map(esc).join('<br>')}</small></p>` : ''}
     <h3 style="margin-top:14px">Проверить вручную (откроется в новой вкладке)</h3><div style="display:flex;flex-wrap:wrap;gap:6px">${(rep.links || []).map(l => `<a class="btn sm" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('')}</div>`;
  }
  if (state.compTab === 'sources') return `<table><tr><th>Источник</th><th>Статус</th><th>Результат</th><th>Проверен</th><th></th></tr>${c.checks.map(ch => `<tr><td><b>${esc(ch.title || ch.source)}</b></td><td><span class="risk ${ch.status === 'ok' ? 'ok' : ch.status === 'skipped' ? 'mid' : 'bad'}">${STATUS_LABEL[ch.status] || ch.status}</span></td><td><small>${esc(ch.summary)}</small></td><td><small>${esc(dt(ch.checked_at))}</small></td><td>${(ch.links || []).slice(0, 3).map(l => `<a class="btn sm" href="${esc(l.url)}" target="_blank" rel="noopener">↗</a>`).join(' ')}</td></tr>`).join('')}</table>
    <p><small>Без ключей источники работают в режиме ссылок: данные всё равно попадут в CRM, если менеджер вставит их в отзывы или заметки. Ключи задаются в Настройки → Конкуренты и источники.</small></p>`;
  if (state.compTab === 'debts') {
    const g = k => c.checks.find(x => x.source === k) || {};
    const fssp = g('fssp').data || {}, fed = g('fedresurs').data || {}, kad = g('kad').data || {}, fns = g('fns').data || {}, rp = g('rusprofile').data || {};
    return `<h3>ФССП: исполнительные производства</h3>${(fssp.productions || []).length ? `<table class="mini"><tr><th>№</th><th>Предмет</th><th>Сумма</th><th>Пристав / отдел</th></tr>${fssp.productions.map(p => `<tr><td>${esc(p.number || '')}</td><td>${esc(p.subject || '')}</td><td><b>${fmt(p.sum)}</b></td><td><small>${esc(p.bailiff || '')} ${esc(p.department || '')}</small></td></tr>`).join('')}</table><p><b>Итого долгов: ${fmt(fssp.total || 0)}</b></p>` : `<p><small>${esc(g('fssp').summary || 'нет данных')}</small></p>`}
     <h3 style="margin-top:14px">Федресурс: банкротство</h3>${(fed.cases || []).length ? `<table class="mini"><tr><th>Должник</th><th>Дело</th><th>Статус</th><th>Дата</th></tr>${fed.cases.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.case)}</td><td>${esc(x.status)}</td><td>${esc(x.date)}</td></tr>`).join('')}</table>` : `<p><small>${esc(g('fedresurs').summary || 'нет данных')}</small></p>`}
     <h3 style="margin-top:14px">Арбитражные дела ${kad.total ? `(${kad.total})` : ''}</h3>${(kad.cases || []).length ? `<table class="mini"><tr><th>Дело</th><th>Дата</th><th>Роль</th><th></th></tr>${kad.cases.map(x => `<tr><td>${esc(x.number)}</td><td>${esc(x.date)}</td><td>${esc(x.role)}</td><td>${x.url ? `<a class="btn sm" href="${esc(x.url)}" target="_blank" rel="noopener">↗</a>` : ''}</td></tr>`).join('')}</table>` : `<p><small>${esc(g('kad').summary || 'нет данных')}</small></p>`}
     <h3 style="margin-top:14px">ФНС и Rusprofile</h3><table class="mini">${Object.entries(fns.card || {}).filter(([, v]) => v && typeof v !== 'object').map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}${Object.entries(rp.card || {}).filter(([, v]) => v && typeof v !== 'object').map(([k, v]) => `<tr><th>Rusprofile: ${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
     <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">${(g('fssp').links || []).slice(0, 2).map(l => `<a class="btn sm" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('')}</div>`;
  }
  if (state.compTab === 'reviews') {
    const bySource = c.reviews.reduce((a, r) => { a[r.source] = a[r.source] || { n: 0, sum: 0 }; a[r.source].n++; a[r.source].sum += r.rating || 0; return a }, {});
    const avg = c.reviews.filter(r => r.rating).length ? (c.reviews.reduce((a, r) => a + (r.rating || 0), 0) / c.reviews.filter(r => r.rating).length).toFixed(1) : '—';
    const bad = c.reviews.filter(r => (r.rating || 5) <= 3);
    return `<div class="grid">${Object.entries(bySource).map(([s, v]) => `<div class="kpi"><i>⭐</i><span>${esc(s)}</span><b>${(v.sum / v.n).toFixed(1)} <small>· ${v.n} шт</small></b></div>`).join('')}<div class="kpi"><i>Σ</i><span>Средний рейтинг / всего</span><b class="accent">${avg} <small>· ${c.reviews.length}</small></b></div></div>
     ${bad.length ? `<div class="card" style="box-shadow:none;border-color:#fecaca;background:#fef2f2"><b>⚠ Негатив для аргументации (${bad.length})</b>${bad.slice(0, 5).map(r => `<div class="row"><span>${esc(r.text || '')}<br><small>${esc(r.source)} · ${r.rating}★</small></span></div>`).join('')}</div>` : ''}
     <form onsubmit="return addReview(event,${c.id})" style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin:10px 0">
      <label style="flex:1;min-width:180px">Отзыв<input name="text" required placeholder="Что пишут клиенты"></label>
      <label style="width:150px">Источник<input name="source" value="Авито" list="revSources"><datalist id="revSources"><option>Авито</option><option>Яндекс Карты</option><option>Google</option><option>2ГИС</option><option>Отзовик</option><option>из разговора</option></datalist></label>
      <label style="width:100px">Оценка<input name="rating" type="number" min="1" max="5" step="0.5" value="3"></label>
      <label style="flex:1;min-width:150px">Ссылка<input name="url" placeholder="https://…"></label>
      <button class="btn primary">Добавить</button></form>
     <table><tr><th>Источник</th><th>Оценка</th><th>Отзыв</th><th>Автор</th><th></th></tr>${c.reviews.map(r => `<tr><td>${esc(r.source)}</td><td>${r.rating ?? '—'}</td><td><small>${esc(r.text || '')} ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">↗</a>` : ''}</small></td><td><small>${esc(r.author || '')}</small></td><td><button class="btn sm danger" onclick="delReview(${r.id},${c.id})">✕</button></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Отзывов пока нет. Добавьте вручную или подключите ключи Google/2ГИС/Яндекс в настройках.</div></td></tr>'}</table>`;
  }
  if (state.compTab === 'prices') {
    const pr = rep.pricing;
    return `<div class="row" style="border:0"><b>Прайс конкурента: ${c.prices.length} позиций</b><span style="display:flex;gap:6px"><button class="btn sm primary" onclick="openPriceImport(${c.id},'competitor')">📊 Загрузить его прайс</button><button class="btn sm" onclick="openPriceImport(${c.id},'ours')">📊 Наша таблица</button></span></div>
     ${pr ? `<div class="card" style="box-shadow:none"><b>Сравнение с нашими ценами:</b> ${pr.avgDiff > 0 ? `конкурент дороже в среднем на ${pr.avgDiff}%` : pr.avgDiff < 0 ? `конкурент дешевле в среднем на ${Math.abs(pr.avgDiff)}%` : 'цены сопоставимы'} · дороже у него в ${pr.expensive} поз., дешевле в ${pr.cheaper} поз.<br><small>Наша сумма по сопоставимым позициям: ${fmt(pr.ourSum)} · его: ${fmt(pr.theirSum)}</small></div>
      <table class="mini"><tr><th>Позиция</th><th>Наша цена</th><th>Его цена</th><th>Разница</th></tr>${pr.pairs.map(p => { const d = Math.round((p.theirs - p.ours) / (p.ours || 1) * 100); return `<tr><td>${esc(p.item)}</td><td>${fmt(p.ours)}</td><td>${fmt(p.theirs)}</td><td><b style="color:${d > 0 ? '#dc2626' : '#16a34a'}">${d > 0 ? '+' : ''}${d}%</b></td></tr>` }).join('')}</table>` : '<small>Сравнение появится, когда загрузите нашу таблицу и прайс конкурента (или укажете ссылку на его таблицу в реквизитах).</small>'}
     <table class="mini" style="margin-top:12px"><tr><th>Позиция конкурента</th><th>Цена</th><th>Ед.</th><th>Комментарий</th></tr>${c.prices.slice(0, 40).map(p => `<tr><td>${esc(p.item)}</td><td>${fmt(p.price)}</td><td>${esc(p.unit || '')}</td><td><small>${esc(p.note || '')}</small></td></tr>`).join('') || '<tr><td colspan="4"><div class="empty">Его прайс не загружен</div></td></tr>'}</table>`;
  }
  return `<div class="list">${(c.history || []).map(h => `<div class="row"><span><b style="color:${RISK_COLORS[h.level] || '#333'}">риск ${h.risk}</b> · ${esc(h.level)}<br><small>${esc(h.verdict || '')}</small></span><small>${esc(dt(h.created_at))}</small></div>`).join('') || '<small>Проверок ещё не было</small>'}</div>`;
}
async function addReview(e, id) { e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); b.rating = b.rating ? num(b.rating) : null; await api(`/api/competitors/${id}/reviews`, { method: 'POST', body: JSON.stringify(b) }); toast('Отзыв добавлен'); openCompetitorCard(id); return false }
async function delReview(id, compId) { await api('/api/reviews/' + id, { method: 'DELETE' }); toast('Удалено'); openCompetitorCard(compId) }
function openPriceImport(compId, scope) {
  const isOurs = scope === 'ours';
  openModal(`<h3>${isOurs ? 'Наша таблица цен' : 'Прайс конкурента'} — Excel или CSV</h3>
   <p><small>Поддерживается <b>.xlsx</b> (обычный Excel), <b>.csv</b> и вставка строк. Нужны колонки с названием и ценой — например «Наименование» и «Цена». Дополнительно читаются «Артикул», «Ед.», «Комментарий/наличие/срок».</small></p>
   <form onsubmit="return importPriceFile(event,${compId || 'null'},'${scope}')">
     <label>Файл .xlsx или .csv<input type="file" name="file" accept=".xlsx,.csv,.txt,.tsv" required></label>
     <button class="btn primary w">Загрузить файл</button></form>
   <hr><form onsubmit="return importPriceText(event,${compId || 'null'},'${scope}')">
     <label>…или вставьте строки таблицы (разделитель ; или Tab)<textarea name="csv" rows="6" placeholder="Наименование;Цена&#10;Каркасный дом 8×10;3850000&#10;Баня 4×6;890000"></textarea></label>
     <button class="btn w">Импортировать текст</button></form>
   <hr><form onsubmit="return importPriceUrl(event,${compId || null},'${scope}')">
     <label>…или ссылка на таблицу (опубликованный Google Sheets / CSV)${isOurs ? ' — будет сохраняться как источник нашей цены' : ''}<input name="url" placeholder="https://docs.google.com/spreadsheets/d/…/export?format=csv"></label>
     <button class="btn w">Загрузить из ссылки</button></form>`);
}
async function importPriceFile(e, compId, scope) {
  e.preventDefault(); const file = e.target.file.files[0]; if (!file) return false;
  toast('Читаем файл…');
  const base64 = await new Promise(r => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',').pop()); f.readAsDataURL(file) });
  try { const r = await api(compId ? `/api/competitors/${compId}/prices` : '/api/prices', { method: 'POST', body: JSON.stringify({ base64, filename: file.name, scope }) }); toast(`Загружено позиций: ${r.imported}`); closeModal(); if (compId) openCompetitorCard(compId); else render(); } catch (err) { toast(err.message) }
  return false;
}
async function importPriceText(e, compId, scope) { e.preventDefault(); const csv = new FormData(e.target).get('csv'); try { const r = await api(compId ? `/api/competitors/${compId}/prices` : '/api/prices', { method: 'POST', body: JSON.stringify({ csv, filename: 'вставленная таблица', scope }) }); toast(`Импортировано: ${r.imported}`); closeModal(); if (compId) openCompetitorCard(compId); else render(); } catch (err) { toast(err.message) } return false }
async function importPriceUrl(e, compId, scope) {
  e.preventDefault(); const url = new FormData(e.target).get('url');
  if (!compId) { try { const r = await api('/api/prices/load', { method: 'POST', body: JSON.stringify({ url }) }); toast(`Загружено из таблицы: ${r.imported}`); closeModal(); render(); } catch (err) { toast(err.message) } return false }
  await api('/api/competitors/' + compId, { method: 'PATCH', body: JSON.stringify({ price_url: url }) });
  toast('Ссылка сохранена'); await checkCompetitor(compId); return false;
}

/* ---------- settings ---------- */
async function settings(v) {
  const s = await api('/api/settings'); state.cache.settings = s; const origin = location.origin;
  const isAdmin = (state.me && state.me.role) === 'admin';
  const allTabs = { integrations: '🔌 Интеграции и каналы', fields: '🧩 Поля карточек', competitors: '🕵 Конкуренты и источники', pipelines: '▦ Воронки и этапы', automations: '⚡ Автоматизации', templates: '💬 Шаблоны сообщений', team: '👥 Команда', data: '💾 Данные и компания', profile: '👤 Профиль' };
  const adminOnly = ['fields', 'pipelines', 'automations', 'templates', 'team', 'data'];
  const tabs = Object.fromEntries(Object.entries(allTabs).filter(([k]) => isAdmin || !adminOnly.includes(k)));
  if (!tabs[state.settingsTab]) state.settingsTab = 'integrations';
  let body = '';
  if (state.settingsTab === 'integrations') {
    const chans = state.channels.length ? state.channels : await api('/api/channels').catch(() => []); state.channels = chans;
    body = `${(state.me && state.me.role) !== 'admin' ? '<div class="card" style="box-shadow:none;border-color:#fde68a;background:#fffbeb"><b>Режим просмотра</b><br><small>Ключи и настройки интеграций меняет администратор. Вы можете работать с чатами, сделками и задачами — всё остальное доступно.</small></div>' : ''}<div class="settings-cols"><div>
     <div class="card"><h3>🟢 Wazzup — WhatsApp, Telegram, Instagram, Viber в одном окне</h3>
      <p>Статус: <b class="${s.wazzup.configured ? 'green' : ''}" style="${s.wazzup.configured ? 'color:var(--green)' : 'color:var(--orange)'}">${s.wazzup.configured ? 'Ключ сохранён' : 'Не настроено — работает локальный режим'}</b></p>
      <label>API-ключ Wazzup<input id="wzKey" placeholder="${esc(s.wazzup.api_key || 'из ЛК Wazzup → Интеграции CRM → API → Подключить')}"></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Канал по умолчанию<select id="wzChannel"><option value="">— синхронизируйте каналы —</option>${chans.map(c => `<option value="${esc(c.external_id)}" ${c.external_id === s.wazzup.channel_id ? 'selected' : ''}>${esc(c.name || c.phone || c.transport || c.external_id)}</option>`).join('')}</select></label>
      <label>Секрет вебхука (необязательно)<input id="wzSecret" value="${esc(s.wazzup.webhook_secret || '')}"></label></div>
      <label>Базовый URL API (менять не нужно)<input id="wzUrl" value="${esc(s.wazzup.api_url)}"></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" onclick="saveWazzup()">Сохранить ключ</button><button class="btn" onclick="testWazzup()">🔍 Проверить и синхронизировать каналы</button></div>
      <hr><p><b>Callback URL для Wazzup</b> (ЛК Wazzup → Интеграции CRM → вебхуки, либо кнопкой ниже):</p><code>${origin}/webhooks/wazzup${s.wazzup.webhook_secret ? '?secret=' + esc(s.wazzup.webhook_secret) : ''}</code>
      <p><button class="btn sm" onclick="registerWazzupWebhook()">Отправить адрес вебхука в Wazzup автоматически</button></p>
      <p><small>Поддерживаются оба формата вебхуков Wazzup (v2 <code>messages[]</code> и новый <code>message.add</code>) — сообщения WhatsApp, Telegram, Instagram и Viber попадают в <b>один чат клиента</b> по телефону/chatId. Исходящие из CRM уходят через Wazzup из вашего номера.</small></p>
      <hr><h3>Каналы (${chans.length})</h3>${chans.map(c => `<div class="row"><span>${esc(c.name || c.transport || c.external_id)}<br><small>${esc(c.transport || '')} ${esc(c.phone || '')} · ${esc(c.state || '—')}</small></span><span class="tag ${c.state === 'active' ? '' : 'grey'}">${esc(c.state || 'неизвестно')}</span></div>`).join('') || '<small>Каналов нет. Нажмите «Проверить и синхронизировать».</small>'}</div>
     <div class="card"><h3>💬 WhatsApp Cloud API (Meta) — прямой канал, без Wazzup</h3><p><small>Используется, если в поле ниже выбрано «Прямой WhatsApp». При настроенном Wazzup он не нужен.</small></p>
      <label>Провайдер мессенджеров<select id="provider"><option value="wazzup" ${s.messenger_provider === 'wazzup' ? 'selected' : ''}>Wazzup (рекомендуется)</option><option value="whatsapp" ${s.messenger_provider === 'whatsapp' ? 'selected' : ''}>Прямой WhatsApp Cloud API (Meta)</option></select></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Phone Number ID<input id="waPhone" value="${esc(s.whatsapp.phone_id)}"></label><label>Verify Token<input id="waVerify" value="${esc(s.whatsapp.verify_token)}"></label></div>
      <label>Access Token<input id="waToken" placeholder="${esc(s.whatsapp.token || 'EAA…')}"></label>
      <button class="btn primary" onclick="saveWhatsApp()">Сохранить WhatsApp</button><hr><p>Callback URL Meta: <code>${origin}/webhooks/whatsapp</code></p></div>
     <div class="card"><h3>✈ Telegram (свой бот) и сайт</h3><p>Вебхук бота: <code>${origin}/webhooks/telegram</code><br>Универсальный вебхук для сайта/формы: <code>${origin}/webhooks/generic</code> (JSON <code>{channel, phone, name, body}</code>)</p>
      <label>Токен бота Telegram<input id="tgToken" placeholder="123456:ABC…"></label><button class="btn" onclick="saveTelegram()">Сохранить</button></div>
     <div class="card"><h3>✉ Почта — письма клиентам прямо из CRM</h3>
      <p>Статус: <b style="color:${s.email.configured ? 'var(--green)' : 'var(--orange)'}">${s.email.configured ? 'SMTP настроен' : 'не настроено'}</b></p>
      <form onsubmit="return saveEmail(event)">
       <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px"><label>SMTP-сервер<input name="SMTP_HOST" value="${esc(s.email.host || '')}" placeholder="smtp.yandex.ru / smtp.mail.ru"></label><label>Порт<input name="SMTP_PORT" value="${esc(s.email.port || '587')}"></label></div>
       <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Шифрование<select name="SMTP_SECURE"><option value="" ${!s.email.secure ? 'selected' : ''}>STARTTLS (587, авто)</option><option value="1" ${s.email.secure === '1' ? 'selected' : ''}>SSL/TLS (465)</option><option value="0" ${s.email.secure === '0' ? 'selected' : ''}>без шифрования (внутренний релей)</option></select></label>
       <label>Логин<input name="SMTP_USER" value="${esc(s.email.user || '')}" placeholder="crm@company.ru"></label></div>
       <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Пароль<input name="SMTP_PASS" type="password" placeholder="${s.email.pass ? '•••••• (сохранён)' : 'пароль приложения'}"></label>
       <label>Адрес отправителя<input name="MAIL_FROM" value="${esc(s.email.from || '')}" placeholder="crm@company.ru"></label></div>
       <label>Куда отправить проверочное письмо<input name="SMTP_TEST_TO" value="${esc(s.email.test_to || '')}" placeholder="owner@company.ru"></label>
       <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary">Сохранить почту</button><button class="btn" type="button" onclick="testEmail(this.form)">✈ Отправить проверочное письмо</button></div></form>
      <hr><p><b>Приём входящих писем</b> — в тот же чат клиента. Укажите этот адрес в правиле пересылки вашего почтового ящика (или в почтовом шлюзе/скрипте):</p>
      <code>${origin}/webhooks/email</code>
      <label style="margin-top:8px">Секрет вебхука (необязательно, добавится как <code>?secret=…</code>)<input id="mailSecret" value="${esc(s.email.webhook_secret || '')}"></label>
      <button class="btn sm" onclick="saveMailSecret()">Сохранить секрет</button>
      <p><small>Входящее письмо создаёт/находит контакт по e-mail, а тема и текст появляются в едином диалоге клиента рядом с WhatsApp и Telegram.</small></p></div></div>
     <div><div class="card"><h3>Права и роли</h3><p><b>Администратор</b> — всё, включая настройки и команду.<br><b>Менеджер</b> — сделки, клиенты, чаты, задачи.<br><b>Наблюдатель</b> — только просмотр.</p><p><small>Создайте пользователей во вкладке «Команда».</small></p></div>
     <div class="card"><h3>Проверка работы</h3><button class="btn orange w" onclick="simulate()">🧪 Имитировать входящее сообщение</button><p style="margin-top:8px"><small>Проверит объединение чатов и создание сделки без реального мессенджера.</small></p><button class="btn w" onclick="fetch('/api/health').then(r=>r.json()).then(d=>toast('API '+d.version+' — OK'))">Проверить API</button></div></div></div>`;
  } else if (state.settingsTab === 'fields') {
    const cf = await api('/api/custom-fields');
    const rows = cf.fields;
    body = `<div class="settings-cols"><div class="card"><div class="row" style="border:0"><h3>🧩 Свои поля для контактов и сделок</h3><button class="btn sm primary" onclick="editField(-1)">+ Поле</button></div>
     <table><tr><th>Название</th><th>Где</th><th>Тип</th><th>Обязательное</th><th></th></tr>${rows.map((f, i) => `<tr><td><b>${esc(f.label)}</b><br><small>${esc(f.key)}</small></td><td>${({ contacts: 'Контакты', deals: 'Сделки', both: 'Везде' })[f.entity] || esc(f.entity)}</td><td>${({ text: 'Текст', number: 'Число', date: 'Дата', select: 'Список', phone: 'Телефон', email: 'E-mail' })[f.type] || esc(f.type)}${f.options && f.options.length ? '<br><small>' + f.options.map(esc).join(', ') + '</small>' : ''}</td><td>${f.required ? '✅' : '—'}</td><td><button class="btn sm" onclick="editField(${i})">✎</button> <button class="btn sm danger" onclick="delField(${i})">✕</button></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Своих полей пока нет</div></td></tr>'}</table>
     <p><small>Например: «ИНН», «Площадь участка», «Тип фундамента», «Дата замера». Поля сразу появляются в формах и карточках — код менять не нужно.</small></p></div>
     <div><div class="card"><h3>Как это работает</h3><ol style="padding-left:18px;margin:0"><li>Добавьте поле: название видит менеджер, ключ — для выгрузок и API.</li><li>Выберите, где показывать: в контактах, сделках или везде.</li><li>Тип поля влияет на ввод: текст, число, дата, e-mail, список вариантов.</li><li>Значения хранятся в карточке и попадают в API как <code>custom: {"ключ": "значение"}</code>.</li></ol>
     <hr><p><small>Удаление поля не стирает данные карточек — значения просто перестают показываться.</small></p></div>
     <div class="card"><h3>Настройка из интерфейса</h3><p><small>Этот же принцип действует для воронок и этапов, шаблонов сообщений, автоматизаций, ключей интеграций, плана продаж и резервных копий — всё меняется из CRM, без правок кода и пересборки Docker.</small></p></div></div></div>`;
  } else if (state.settingsTab === 'competitors') {
    const cs = await api('/api/competitor-sources');
    const ours = await api('/api/prices?scope=ours');
    const KEY_FIELDS = [['FNS_API_KEY', 'Ключ api-fns.ru (ФНС: ЕГРЮЛ, недоимки, руководители)', 'получить: api-fns.ru → тариф «Базовый»'], ['FSSP_TOKEN', 'Токен ФССП (суммы долгов приставов)', 'получить: api-ip.fssprus.ru → регистрация'], ['GOOGLE_PLACES_KEY', 'Ключ Google Places (рейтинг и тексты отзывов)', 'console.cloud.google.com → Places API'], ['TWOGIS_KEY', 'Ключ 2ГИС (рейтинг и число отзывов)', 'dev.2gis.ru → Places API'], ['YANDEX_API_KEY', 'Ключ Яндекс Геопоиска (карточка организации)', 'developer.tech.yandex.ru → Geosearch']];
    body = `<div class="settings-cols"><div>
     <div class="card"><h3>Статус источников</h3><table class="mini"><tr><th>Источник</th><th>Что даёт</th><th>Готовность</th></tr>${cs.sources.map(s => `<tr><td><b>${esc(s.name)}</b>${s.needs.length ? `<br><small>нужен ключ</small>` : '<br><small>без ключа</small>'}</td><td><small>${esc(s.about)}</small></td><td><span class="risk ${s.configured ? 'ok' : 'mid'}">${s.configured ? 'готов' : s.needs.length ? 'нет ключа (ссылки работают)' : 'по ссылкам'}</span></td></tr>`).join('')}</table>
      <p><small>Все источники работают и без ключей — CRM сформирует прямые ссылки (Rusprofile, ФНС, ФССП, Федресурс, Кад.Арбитр, Яндекс/2ГИС/Авито). С ключами данные подтягиваются в отчёт автоматически. Сайты госорганов иногда отвечают блокировкой автоматических запросов — тогда в отчёте будет статус «сайт не отдал» и ссылка для ручной проверки.</small></p></div>
     ${(state.me && state.me.role) === 'admin' ? `<div class="card"><h3>Ключи источников (хранятся на сервере)</h3><form onsubmit="return saveCompetitorKeys(event)">${KEY_FIELDS.map(([k, label, hint]) => `<label>${esc(label)}<input name="${k}" placeholder="${cs.keys[k] ? '•••••• (сохранён)' : esc(hint)}"></label>`).join('')}
      <label>Таймаут запросов к источникам, мс<input name="COMPETITOR_TIMEOUT_MS" value="${esc(cs.timeout)}"></label>
      <button class="btn primary">Сохранить ключи</button></form></div>` : `<div class="card"><h3>Ключи источников</h3><p><small>Ключи источников задаёт администратор: Настройки → Конкуренты и источники. Отчёты и ссылки доступны всем — можно проверять конкурентов прямо сейчас.</small></p></div>`}
     <div class="card"><h3>Наша таблица цен (Excel/CSV)</h3><p><small>Загружается один раз и используется для сравнения с конкурентами во всех отчётах. Поддерживается .xlsx, .csv и ссылка на опубликованный Google Sheets.</small></p>
      ${ours.rows.length ? `<p><b>Загружено позиций: ${ours.rows.length}</b> <small>${cs.ourPriceUrl ? '· источник: ' + esc(cs.ourPriceUrl) : ''}</small></p>` : '<p><small>Пока не загружена.</small></p>'}
      <button class="btn primary w" onclick="openPriceImport(null,'ours')">📊 Загрузить нашу таблицу</button></div>
     <div class="card"><h3>Наши цены в базе</h3><table class="mini"><tr><th>Позиция</th><th>Цена</th><th>Ед.</th></tr>${ours.rows.slice(0, 15).map(r => `<tr><td>${esc(r.item)}</td><td>${fmt(r.price)}</td><td>${esc(r.unit || '')}</td></tr>`).join('') || '<tr><td colspan="3"><small>Пусто</small></td></tr>'}</table></div>
     </div><div>
     <div class="card"><h3>Как это работает</h3><ol style="padding-left:18px;margin:0"><li>Открываете вкладку <b>Конкуренты</b> и пишете название или ИНН.</li><li>CRM параллельно опрашивает 8 источников и считает <b>риск-скор 0–100</b>.</li><li>Смотрит отзывы с карт и Авито, собирает негатив для аргументов.</li><li>Сравнивает цены с нашей Excel-таблицей: где мы дешевле, где дороже.</li><li>Даёт вердикт и готовые фразы для менеджера. Каждая проверка сохраняется в историю.</li></ol></div>
     ${(state.me && state.me.role) === 'admin' ? `<div class="card"><h3>Адреса API источников</h3><p><small>Меняются только для корпоративного прокси или собственного зеркала данных.</small></p><form onsubmit="return saveCompetitorUrls(event)">${[['FNS_API_URL', 'ФНС API'], ['FSSP_API_URL', 'ФССП API'], ['FEDRESURS_API_URL', 'Федресурс'], ['KAD_API_URL', 'Арбитр'], ['RUSPROFILE_URL', 'Rusprofile'], ['GOOGLE_API_URL', 'Google Places'], ['TWOGIS_API_URL', '2ГИС'], ['YANDEX_API_URL', 'Яндекс Геопоиск']].map(([k, n]) => `<label>${n}<input name="${k}" value="${esc((cs.urls || {})[k] || '')}"></label>`).join('')}<button class="btn">Сохранить адреса</button></form></div>` : ''}
     <div class="card"><h3>Для разработчиков</h3><p><small>API: <code>POST /api/competitors/find</code> · <code>POST /api/competitors/:id/check</code> · <code>POST /api/competitors/:id/prices</code> (base64 .xlsx или CSV) · <code>GET /api/prices?scope=ours</code></small></p></div></div></div>`;
  } else if (state.settingsTab === 'pipelines') {
    const pl = await api('/api/pipelines');
    body = `<div class="card"><div class="row" style="border:0"><h3>Воронки продаж</h3><button class="btn sm primary" onclick="addPipeline()">+ Воронка</button></div>
    ${pl.map(p => `<div class="card" style="box-shadow:none"><b>${esc(p.name)}</b> <small>${p.stages.length} этапов</small> <button class="btn sm" onclick="editPipeline(${p.id})">✎ Редактировать этапы</button> ${pl.length > 1 ? `<button class="btn sm danger" onclick="del('pipelines',${p.id})">✕</button>` : ''}
     <div style="margin-top:8px">${p.stages.map(s => `<span class="tag" style="background:${esc(s.color)}22;color:${esc(s.color)}">● ${esc(s.name)}</span>`).join(' ')}</div></div>`).join('')}
    <p><small>Этапы настраиваются свободно: название, цвет и тип (обычный / успех / отказ). Сделки на канбане перетаскиваются между этапами мышью.</small></p></div>`;
  } else if (state.settingsTab === 'automations') {
    const rows = await api('/api/automations');
    const trg = { deal_created: 'Создана сделка', message_in: 'Входящее сообщение', stage_changed: 'Смена этапа' };
    const act = { create_task: 'Создать задачу', change_stage: 'Перевести на этап', add_tag: 'Добавить тег' };
    body = `<div class="card"><div class="row" style="border:0"><h3>Автоматизации</h3><button class="btn sm primary" onclick="openAutomation()">+ Правило</button></div>
    <table><tr><th>Название</th><th>Когда</th><th>Что сделать</th><th>Вкл.</th><th></th></tr>${rows.map(a => `<tr><td><b>${esc(a.name)}</b></td><td>${trg[a.trigger_type] || esc(a.trigger_type)}</td><td>${act[a.action_type] || esc(a.action_type)}: <small>${esc(a.action_value || '')}</small></td>
     <td><input type="checkbox" style="width:auto" ${a.active ? 'checked' : ''} onchange="api('/api/automations/${a.id}',{method:'PATCH',body:JSON.stringify({active:this.checked?1:0})}).then(()=>toast('Обновлено'))"></td>
     <td><button class="btn sm" onclick="openAutomation(${a.id})">✎</button> <button class="btn sm danger" onclick="del('automations',${a.id})">✕</button></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Правил нет</div></td></tr>'}</table>
    <p><small>Примеры: «Создана сделка → создать задачу позвонить», «Входящее сообщение → создать задачу ответить», «Смена этапа → добавить тег».</small></p></div>`;
  } else if (state.settingsTab === 'templates') {
    const rows = await api('/api/templates');
    body = `<div class="card"><div class="row" style="border:0"><h3>Шаблоны сообщений</h3><button class="btn sm primary" onclick="openTemplate()">+ Шаблон</button></div>
    ${rows.map(t => `<div class="card" style="box-shadow:none"><b>${esc(t.name)}</b> <span class="tag grey">${esc(t.channel)}</span><button class="btn sm" style="float:right" onclick="openTemplate(${t.id})">✎</button><p>${esc(t.body)}</p></div>`).join('') || '<div class="empty">Шаблонов нет</div>'}
    <p><small>Используйте переменную <code>{name}</code> — подставится имя клиента. Шаблоны доступны в чате: выпадающий список «Шаблоны» у поля ввода.</small></p></div>`;
  } else if (state.settingsTab === 'team') {
    const rows = await api('/api/users'); const roles = { admin: 'Администратор', manager: 'Менеджер', viewer: 'Наблюдатель' };
    const allDeals = (await api('/api/deals')).deals; const allTasks = await api('/api/tasks');
    const stat = id => {
      const my = allDeals.filter(d => d.responsible_id === id);
      const open = my.filter(d => !['won', 'lost'].includes(d.stage));
      const tasks = allTasks.filter(t => t.responsible_id === id && !t.done);
      return { open: open.length, sum: open.reduce((a, d) => a + d.amount, 0), won: my.filter(d => d.stage === 'won').length, tasks: tasks.length };
    };
    body = `<div class="card"><div class="row" style="border:0"><h3>Команда</h3><button class="btn sm primary" onclick="openUser()">+ Пользователь</button></div>
    <table><tr><th>Сотрудник</th><th>E-mail</th><th>Роль</th><th>Сделки в работе</th><th>Задачи</th><th>Вход</th><th></th></tr>${rows.map(x => { const st = stat(x.id); return `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.email)}</td><td>${roles[x.role] || esc(x.role)}</td><td>${st.open} на ${fmt(st.sum)}<br><small>успешных: ${st.won}</small></td><td>${st.tasks}</td><td>${x.active ? '✅ разрешён' : '⛔ отключён'}</td><td><button class="btn sm" onclick="openUser(${x.id})">✎</button></td></tr>` }).join('')}</table>
    <p><small><b>Администратор</b> настраивает всё: воронки, поля, шаблоны, автоматизации, интеграции, план продаж, команду и резервные копии. <b>Менеджер</b> ведёт клиентов, сделки, задачи и переписку, но не может менять настройки. <b>Наблюдатель</b> видит данные без права правок — удобно для собственника или бухгалтера.</small></p></div>`;
  } else if (state.settingsTab === 'data') {
    body = `<div class="settings-cols"><div><div class="card"><h3>Название компании</h3><form onsubmit="return saveCompanySettings(event)"><div style="display:grid;grid-template-columns:2fr 1fr;gap:12px"><label>Название<input name="COMPANY_NAME" value="${esc(s.company.name)}"></label><label>Валюта<input name="CURRENCY" value="${esc(s.company.currency)}"></label></div>
     <label>Автосоздание сделки при обращении<select name="AUTO_DEAL"><option value="1" ${s.auto_deal === '1' ? 'selected' : ''}>Да — создавать сделку «Неразобранное»</option><option value="0" ${s.auto_deal !== '1' ? 'selected' : ''}>Нет</option></select></label>
     <label>Распределять новые обращения между менеджерами<select name="AUTO_ASSIGN"><option value="0" ${s.auto_assign !== '1' ? 'selected' : ''}>Нет — оставлять без ответственного</option><option value="1" ${s.auto_assign === '1' ? 'selected' : ''}>Да — отдавать наименее загруженному менеджеру</option></select></label>
     <button class="btn primary">Сохранить</button></form></div>
     <div class="card"><h3>🎯 План продаж и уведомления</h3><form onsubmit="return savePlanSettings(event)">
      <label>План продаж на месяц, ${esc((s.company && s.company.currency) || '₽')}<input name="SALES_TARGET" value="${esc(s.sales_target || 0)}"></label>
      <label>Webhook о просроченных задачах (необязательно — уведомление придёт в Telegram/Slack/CRM-бот)<input name="NOTIFY_WEBHOOK" value="${esc((s.maintenance || {}).notify_webhook || '')}" placeholder="https://hooks.slack.com/services/…"></label>
      <button class="btn primary">Сохранить</button></form>
      <p><small>План показывается в «Аналитике» с процентом выполнения. Напоминания о просроченных задачах CRM присылает во всплывающее окно (🔔) и на webhook, если он задан.</small></p></div>
     <div class="card"><h3>🔐 Безопасность и доступ</h3><form onsubmit="return saveAdvancedSettings(event)">
      <label>Попыток входа с одного IP за 5 минут<input name="LOGIN_RATE_LIMIT" value="${esc((s.advanced || {}).login_rate_limit || '12')}"></label>
      <label>Встраивание в iframe (пусто — запрещено, <code>*</code> или домен портала — разрешено только ему)<input name="FRAME_ANCESTORS" value="${esc((s.advanced || {}).frame_ancestors || '')}" placeholder="https://portal.company.ru"></label>
      <button class="btn primary">Сохранить</button></form>
      <p><small>Смена этих параметров применяется сразу, без перезапуска контейнера. Пароль администратора — во вкладке «Профиль», сотрудники и роли — во вкладке «Команда».</small></p></div>
     <div class="card"><h3>💾 Резервные копии</h3><p><small>CRM сама делает копию базы раз в сутки и хранит ${esc(((s.maintenance || {}).backup_keep_days) || '7')} дней. Копии лежат в томе Docker <code>/data/backups</code> — их видно и снаружи контейнера.</small></p>
      <div id="backupList">…</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn primary sm" onclick="makeBackup()">Создать копию сейчас</button><button class="btn sm" onclick="download('/api/backup','karkas-backup.json')">⬇ Скачать текущую базу (JSON)</button></div></div>
     <div class="card"><h3>🧪 Демо-данные</h3><p><small>В демо-режиме CRM показывает примеры (клиенты, сделки, чаты, конкурент). Нажмите кнопку, когда заведёте свои данные — примеры удалятся, рабочие данные не тронем.</small></p>
      <button class="btn danger" onclick="cleanDemo()">Удалить демо-данные</button>
      <p style="margin-top:8px"><small>Чистая установка без примеров: <code>SEED_DEMO=0</code> в docker-compose.</small></p></div>
     <div class="card"><h3>Экспорт и импорт</h3><button class="btn w" onclick="download('/api/export/contacts','contacts.csv')">⬇ Контакты (CSV)</button><p></p><button class="btn w" onclick="download('/api/export/deals','deals.csv')">⬇ Сделки (CSV)</button><p></p><button class="btn w" onclick="download('/api/backup','karkas-backup.json')">⬇ Полный бэкап (JSON)</button>
     <hr><button class="btn w" onclick="importContacts()">⬆ Импорт контактов из CSV</button><p><small>Формат: <code>Имя;Телефон;E-mail;Компания</code> с заголовком в первой строке.</small></p></div></div>
     <div><div class="card"><h3>Обслуживание</h3><p><small>Версия CRM: <b>${esc(s.version || '')}</b> · база — один файл SQLite в Docker-томе <code>karkascrm_data</code> (каталог <code>/data</code>), резервные копии — в <code>/data/backups</code>.</small></p><code>docker compose exec crm ls -la /data /data/backups</code>
      <p style="margin-top:8px"><small>Обновление CRM: <code>docker compose pull && docker compose up -d</code> — база и настройки в томе сохраняются.</small></p>
      <button class="btn sm" onclick="fetch('/api/health').then(r=>r.json()).then(d=>toast('API '+d.version+' · база '+(d.dbSizeBytes/1024|0)+' КБ · контактов '+d.counts.contacts))">Проверить состояние системы</button></div>
     <div class="card"><h3>API для интеграций</h3><p><small>Все действия доступны по REST с токеном: <code>Authorization: Bearer …</code></small></p><p><small>Вебхуки: <code>/webhooks/wazzup</code>, <code>/webhooks/whatsapp</code>, <code>/webhooks/telegram</code>, <code>/webhooks/generic</code></small></p></div></div></div>`;
  } else {
    body = `<div class="settings-cols"><div class="card"><h3>Смена пароля</h3><form onsubmit="return savePassword(event)"><label>Текущий пароль<input name="old" type="password" required></label><label>Новый пароль (мин. 8)<input name="next" type="password" minlength="8" required></label><button class="btn primary w">Сменить пароль</button></form>
     <hr><p><small>Вы вошли как <b>${esc((state.me && state.me.name) || '')}</b> (${esc((state.me && state.me.email) || '')}), роль: <b>${({ admin: 'Администратор — доступны все настройки', manager: 'Менеджер — работа с клиентами и сделками', viewer: 'Наблюдатель — только просмотр' })[state.me && state.me.role] || '—'}</b>.</small></p></div>
     <div><div class="card"><h3>Права ролей</h3><p><small><b>Администратор</b> — всё, включая настройки, команду, интеграции и данные.<br><b>Менеджер</b> — контакты, компании, сделки, задачи, заметки и все чаты; настройки и справочники меняет админ.<br><b>Наблюдатель</b> — только чтение и выгрузки.</small></p><p><small>Нужен менеджеру доступ к настройкам — попросите администратора сменить роль в Настройки → Команда.</small></p></div></div></div>`;
  }
  v.innerHTML = `<div class="tabs">${Object.entries(tabs).map(([k, n]) => `<button class="${state.settingsTab === k ? 'active' : ''}" onclick="state.settingsTab='${k}';render()">${n}</button>`).join('')}</div>${body}`;
  if (state.settingsTab === 'data') loadBackups();
}
async function saveWazzup() { await api('/api/settings', { method: 'PUT', body: JSON.stringify({ WAZZUP_API_KEY: $('#wzKey').value, WAZZUP_CHANNEL_ID: $('#wzChannel').value, WAZZUP_WEBHOOK_SECRET: $('#wzSecret').value, WAZZUP_API_URL: $('#wzUrl').value }) }); toast('Ключ Wazzup сохранён'); render() }
async function saveWhatsApp() { await api('/api/settings', { method: 'PUT', body: JSON.stringify({ WHATSAPP_TOKEN: $('#waToken').value, WHATSAPP_PHONE_ID: $('#waPhone').value, WHATSAPP_VERIFY_TOKEN: $('#waVerify').value, MESSENGER_PROVIDER: $('#provider').value }) }); toast('Настройки WhatsApp сохранены'); render() }
let __fields = null;
async function loadFields() { if (!__fields) __fields = (await api('/api/custom-fields')).fields; return __fields }
async function editField(i) {
  const list = await loadFields(); const f = i >= 0 ? list[i] : { key: '', label: '', type: 'text', entity: 'both', options: [], required: false };
  openModal(`<h3>${i >= 0 ? 'Поле' : 'Новое поле карточки'}</h3><form onsubmit="return saveField(event,${i})">
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Название для менеджера*<input name="label" required value="${esc(f.label)}" placeholder="Площадь участка"></label>
   <label>Ключ (латиницей)*<input name="key" required value="${esc(f.key)}" placeholder="area"></label></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Тип<select name="type">${[['text', 'Текст'], ['number', 'Число'], ['date', 'Дата'], ['email', 'E-mail'], ['phone', 'Телефон'], ['select', 'Список вариантов']].map(([k, n]) => `<option value="${k}" ${k === f.type ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
   <label>Где показывать<select name="entity">${[['both', 'Везде'], ['contacts', 'Только контакты'], ['deals', 'Только сделки']].map(([k, n]) => `<option value="${k}" ${k === f.entity ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
   <label>Варианты для списка (через запятую)<input name="options" value="${esc((f.options || []).join(', '))}" placeholder="каркас, брус, газобетон"></label>
   <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="required" style="width:auto" ${f.required ? 'checked' : ''}> Показывать как важное поле</label>
   <button class="btn primary w">Сохранить</button></form>`);
}
async function saveField(e, i) {
  e.preventDefault(); const list = (await loadFields()).slice();
  const b = Object.fromEntries(new FormData(e.target));
  const field = { key: b.key.replace(/[^a-zA-Z0-9_]/g, ''), label: b.label, type: b.type, entity: b.entity, required: !!b.required, options: (b.options || '').split(',').map(x => x.trim()).filter(Boolean) };
  if (!field.key) return toast('Ключ должен содержать латинские буквы');
  if (i >= 0) list[i] = field; else list.push(field);
  __fields = null; state.meta = null;
  await api('/api/custom-fields', { method: 'PUT', body: JSON.stringify({ fields: list }) });
  state.meta = await api('/api/meta').catch(() => null); closeModal(); toast('Поле сохранено'); render(); return false;
}
async function delField(i) {
  if (!confirm('Убрать поле из карточек?')) return;
  const list = (await loadFields()).slice(); list.splice(i, 1); __fields = null;
  await api('/api/custom-fields', { method: 'PUT', body: JSON.stringify({ fields: list }) });
  state.meta = await api('/api/meta').catch(() => null); toast('Поле удалено'); render();
}
async function saveEmail(e) {
  e.preventDefault(); const b = Object.fromEntries(new FormData(e.target));
  await api('/api/settings', { method: 'PUT', body: JSON.stringify(b) });
  toast('Настройки почты сохранены'); render(); return false;
}
async function testEmail(form) {
  const b = Object.fromEntries(new FormData(form)); toast('Отправляем проверочное письмо…');
  try { const r = await api('/api/integrations/email/test', { method: 'POST', body: JSON.stringify(b) }); toast('Письмо ушло на ' + r.to + ' — проверьте ящик'); }
  catch (err) { toast('Не получилось: ' + err.message) }
  return false;
}
async function saveMailSecret() { await api('/api/settings', { method: 'PUT', body: JSON.stringify({ EMAIL_WEBHOOK_SECRET: $('#mailSecret').value }) }); toast('Секрет сохранён'); render() }
async function saveTelegram() { await api('/api/settings', { method: 'PUT', body: JSON.stringify({ TELEGRAM_BOT_TOKEN: $('#tgToken').value }) }); toast('Токен сохранён'); render() }
async function testWazzup() {
  const r = await api('/api/integrations/wazzup/test', { method: 'POST' }).catch(e => ({ ok: false, error: e.message }));
  if (!r.ok) return toast('Ошибка: ' + r.error);
  const n = (r.channels || []).length; const sync = await api('/api/integrations/wazzup/sync', { method: 'POST' }).catch(e => ({ error: e.message }));
  toast(sync.error ? 'Ошибка синхронизации: ' + sync.error : `Каналов найдено и сохранено: ${sync.synced ?? n}`); state.channels = []; render();
}
async function registerWazzupWebhook() { const url = location.origin + '/webhooks/wazzup'; try { await api('/api/integrations/wazzup/webhook', { method: 'POST', body: JSON.stringify({ url }) }); toast('Вебхук зарегистрирован в Wazzup'); } catch (e) { toast(e.message); } }
async function saveCompetitorKeys(e) { e.preventDefault(); const b = {}; for (const [k, v] of new FormData(e.target)) if (v && !String(v).includes('•')) b[k] = v; await api('/api/competitor-sources', { method: 'PUT', body: JSON.stringify(b) }); toast('Ключи сохранены'); render(); return false }
async function saveCompetitorUrls(e) { e.preventDefault(); const b = {}; for (const [k, v] of new FormData(e.target)) if (v) b[k] = v; await api('/api/competitor-sources', { method: 'PUT', body: JSON.stringify(b) }); toast('Адреса сохранены'); render(); return false }
async function saveCompanySettings(e) { e.preventDefault(); await api('/api/settings', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) }); toast('Сохранено'); return false }
async function savePassword(e) { e.preventDefault(); try { await api('/api/me/password', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) }); toast('Пароль изменён'); closeModal(); } catch (err) { toast(err.message) } return false }
async function addPipeline() { const name = prompt('Название воронки:', 'Новая воронка'); if (!name) return; await api('/api/pipelines', { method: 'POST', body: JSON.stringify({ name }) }); toast('Воронка создана'); render() }
function openPipelineEditor() { editPipeline(state.pipeline || 1) }
async function editPipeline(id) {
  const pl = (await api('/api/pipelines')).find(p => p.id === id); const stages = JSON.parse(JSON.stringify(pl.stages));
  const row = (s, i) => `<div class="st" data-i="${i}"><span>${i + 1}</span><input value="${esc(s.name)}" oninput="pkStage(${i},'name',this.value)"><input type="color" value="${esc(s.color)}" oninput="pkStage(${i},'color',this.value)"><select onchange="pkStage(${i},'kind',this.value)">${['open', 'won', 'lost'].map(k => `<option value="${k}" ${k === (s.kind || 'open') ? 'selected' : ''}>${({ open: 'обычный', won: 'успех', lost: 'отказ' })[k]}</option>`).join('')}</select><button class="btn sm danger" onclick="pkDel(${i})">✕</button></div>`;
  window.__pk = { id, name: pl.name, stages };
  openModal(`<h3>Воронка «${esc(pl.name)}»</h3>
   <label>Название воронки<input id="pkName" value="${esc(pl.name)}" oninput="window.__pk.name=this.value"></label>
   <div class="stages-editor" id="pkList">${stages.map(row).join('')}</div>
   <p><button class="btn sm" onclick="pkAdd()">+ Добавить этап</button></p>
   <button class="btn primary w" onclick="pkSave()">Сохранить воронку</button>`);
}
function pkStage(i, k, v) { window.__pk.stages[i][k] = v }
function pkDel(i) { if (window.__pk.stages.length <= 2) return toast('Нужно минимум 2 этапа'); window.__pk.stages.splice(i, 1); editPipelineRefresh() }
function pkAdd() { window.__pk.stages.push({ code: 's' + Date.now(), name: 'Новый этап', color: '#16a34a', kind: 'open' }); editPipelineRefresh() }
function editPipelineRefresh() { const stages = window.__pk.stages; $('#pkList').innerHTML = stages.map((s, i) => `<div class="st"><span>${i + 1}</span><input value="${esc(s.name)}" oninput="pkStage(${i},'name',this.value)"><input type="color" value="${esc(s.color)}" oninput="pkStage(${i},'color',this.value)"><select onchange="pkStage(${i},'kind',this.value)">${['open', 'won', 'lost'].map(k => `<option value="${k}" ${k === (s.kind || 'open') ? 'selected' : ''}>${({ open: 'обычный', won: 'успех', lost: 'отказ' })[k]}</option>`).join('')}</select><button class="btn sm danger" onclick="pkDel(${i})">✕</button></div>`).join('') }
async function pkSave() { await api('/api/pipelines/' + window.__pk.id, { method: 'PUT', body: JSON.stringify(window.__pk) }); closeModal(); toast('Воронка сохранена'); state.pipelines = []; render() }
async function openAutomation(id) {
  const rows = await api('/api/automations'); const a = id ? (rows.find(x => x.id === id) || {}) : {};
  openModal(`<h3>${id ? 'Правило' : 'Новая автоматизация'}</h3><form onsubmit="return saveAutomation(event,${id || 'null'})">
   <label>Название<input name="name" required value="${esc(a.name || '')}"></label>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Когда<select name="trigger_type">${Object.entries({ deal_created: 'Создана сделка', message_in: 'Входящее сообщение', stage_changed: 'Смена этапа' }).map(([k, n]) => `<option value="${k}" ${k === a.trigger_type ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
   <label>Что сделать<select name="action_type">${Object.entries({ create_task: 'Создать задачу', change_stage: 'Перевести сделку на этап', add_tag: 'Добавить тег контакту' }).map(([k, n]) => `<option value="${k}" ${k === a.action_type ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
   <label>Значение действия (текст задачи, код этапа или тег)<input name="action_value" value="${esc(a.action_value || '')}"></label>
   <button class="btn primary w">Сохранить</button></form>`);
}
async function saveAutomation(e, id) { e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); await api(id ? '/api/automations/' + id : '/api/automations', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) }); closeModal(); toast('Правило сохранено'); render(); return false }
async function openTemplate(id) {
  const rows = await api('/api/templates'); const t = id ? (rows.find(x => x.id === id) || {}) : {};
  openModal(`<h3>${id ? 'Шаблон' : 'Новый шаблон'}</h3><form onsubmit="return saveTemplate(event,${id || 'null'})"><label>Название<input name="name" required value="${esc(t.name || '')}"></label>
   <label>Текст сообщения<textarea name="body" rows="4" required>${esc(t.body || '')}</textarea></label><label>Канал<select name="channel">${['whatsapp', 'telegram', 'instagram', 'viber', 'any'].map(c => `<option value="${c}" ${c === t.channel ? 'selected' : ''}>${c}</option>`).join('')}</select></label><button class="btn primary w">Сохранить</button></form>`);
}
async function saveTemplate(e, id) { e.preventDefault(); await api(id ? '/api/templates/' + id : '/api/templates', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) }); state.cache.templates = null; closeModal(); toast('Шаблон сохранён'); render(); return false }
async function openUser(id) {
  const rows = await api('/api/users'); const x = id ? (rows.find(u => u.id === id) || {}) : {};
  openModal(`<h3>${id ? 'Пользователь' : 'Новый пользователь'}</h3><form onsubmit="return saveUser(event,${id || 'null'})">
   <label>Имя<input name="name" required value="${esc(x.name || '')}"></label><label>E-mail<input name="email" type="email" required value="${esc(x.email || '')}"></label>
   <label>Роль<select name="role">${Object.entries({ admin: 'Администратор — всё, включая настройки', manager: 'Менеджер — клиенты, сделки, задачи, чаты', viewer: 'Наблюдатель — только просмотр' }).map(([k, n]) => `<option value="${k}" ${k === (x.role || 'manager') ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
   <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="active" style="width:auto" ${x.active === 0 ? '' : 'checked'}> Сотрудник может входить в CRM</label>
   <label>${id ? 'Новый пароль (оставьте пустым, чтобы не менять)' : 'Пароль (мин. 8 символов)'}<input name="password" type="text" ${id ? '' : 'required'}></label>
   <button class="btn primary w">Сохранить</button></form>`);
}
async function saveUser(e, id) { e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); if (!b.password) delete b.password; b.active = b.active ? 1 : 0; b.id = id; await api(id ? '/api/users/' + id : '/api/users', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) }); closeModal(); toast('Пользователь сохранён'); render(); return false }
async function loadBackups() {
  const host = $('#backupList'); if (!host) return;
  try { const d = await api('/api/backups');
    host.innerHTML = `<table class="mini"><tr><th>Файл</th><th>Размер</th><th>Создан</th></tr>${(d.files || []).slice(0, 8).map(f => `<tr><td>${esc(f.name)}</td><td>${(f.sizeBytes / 1024 | 0)} КБ</td><td><small>${esc(dt(f.created_at))}</small></td></tr>`).join('') || '<tr><td colspan="3"><small>Копий пока нет — создайте первую</small></td></tr>'}</table>`;
  } catch (e) { host.innerHTML = `<small>${esc(e.message)}</small>` }
}
async function makeBackup() { const r = await api('/api/backups', { method: 'POST' }); toast('Копия создана: ' + r.created); loadBackups() }
async function cleanDemo() {
  if (!confirm('Удалить демонстрационные данные? Ваши собственные клиенты, сделки и чаты останутся.')) return;
  const r = await api('/api/demo/clean', { method: 'POST' });
  toast(`Удалено: контактов ${r.cleaned.contacts}, сделок ${r.cleaned.deals}, задач ${r.cleaned.tasks}, чатов ${r.cleaned.conversations}`);
  state.contacts = []; render();
}
async function saveAdvancedSettings(e) { e.preventDefault(); await api('/api/settings', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) }); toast('Сохранено'); layoutRefreshFramePolicy(); return false }
async function layoutRefreshFramePolicy() { try { const s = await api('/api/settings'); if (s.advanced && s.advanced.frame_ancestors) console.info('iframe разрешён для', s.advanced.frame_ancestors) } catch {} }
async function savePlanSettings(e) { e.preventDefault(); await api('/api/settings', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) }); toast('Сохранено'); return false }
async function importContacts() { openModal(`<h3>Импорт контактов из CSV</h3><p><small>Первая строка — заголовки: <code>Имя;Телефон;E-mail;Компания</code>. Разделитель — <code>;</code> или <code>,</code>.</small></p><form onsubmit="return doImport(event)"><label>Вставьте CSV<textarea name="csv" rows="8" placeholder="Имя;Телефон;E-mail;Компания&#10;Иван Петров;+7 900 111-22-33;ivan@mail.ru;ООО Иван"></textarea></label><label>…или выберите файл<input type="file" accept=".csv,text/csv" onchange="csvFromFile(this)"></label><button class="btn primary w">Импортировать</button></form>`) }
function csvFromFile(input) { const f = input.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { $('#modalBody textarea').value = r.result }; r.readAsText(f) }
async function doImport(e) { e.preventDefault(); const d = await api('/api/import/contacts', { method: 'POST', body: JSON.stringify({ csv: new FormData(e.target).get('csv') }) }); closeModal(); toast('Импортировано контактов: ' + d.imported); render(); return false }
async function del(table, id) { if (!confirm('Удалить запись?')) return; await api(`/api/${table}/${id}`, { method: 'DELETE' }); toast('Удалено'); render() }

/* ---------- global search + realtime ---------- */
let searchT;
$('#globalSearch').oninput = e => {
  clearTimeout(searchT); const q = e.target.value.trim(); const box = $('#searchResults');
  if (q.length < 2) { box.classList.add('hidden'); if (state.view === 'contacts') render(); return }
  searchT = setTimeout(async () => {
    const r = await api('/api/search?q=' + encodeURIComponent(q));
    box.innerHTML = [['Контакты', r.contacts, c => `openContactCard(${c.id})`, c => `${esc(c.name)} <small>${esc(c.phone || '')}</small>`], ['Сделки', r.deals, d => `openDealCard(${d.id})`, d => `${esc(d.title)} <small>${fmt(d.amount)}</small>`], ['Компании', r.companies, c => `openCompany(${c.id})`, c => esc(c.name)]]
      .filter(([, list]) => list.length).map(([t, list, fn, txt]) => `<h4>${t}</h4>${list.map(x => `<div onclick="$('#searchResults').classList.add('hidden');${fn(x)}">${txt(x)}</div>`).join('')}`).join('') || '<div>Ничего не найдено</div>';
    box.classList.remove('hidden');
  }, 200);
};
document.addEventListener('click', e => { if (!e.target.closest('.searchbox')) $('#searchResults')?.classList.add('hidden') });
function connectSSE() {
  const es = new EventSource('/api/events?token=' + encodeURIComponent(token));
  es.addEventListener('message', e => {
    if (state.view === 'inbox' || state.view === 'dashboard') render();
    else {
      let d = {}; try { d = JSON.parse(e.data) } catch {}
      const cur = $('#navUnread'); if (cur) cur.classList.add('pulse');
      setTimeout(() => cur && cur.classList.remove('pulse'), 2000);
      toast('💬 Новое сообщение в чате клиента');
      api('/api/dashboard').then(navCounts).catch(() => {});
    }
  });
  es.addEventListener('change', () => { if (['pipe', 'dashboard'].includes(state.view)) render() });
  es.addEventListener('notify', e => {
    let d = {}; try { d = JSON.parse(e.data) } catch {}
    if (d.type === 'overdue_tasks') toast(`⏰ Просроченных задач: ${d.count}. Нажмите 🔔, чтобы посмотреть`);
    api('/api/dashboard').then(navCounts).catch(() => {});
  });
}
boot();
