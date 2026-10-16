/* KarkasCRM v2 frontend — amoCRM-like SPA + Wazzup unified inbox */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
let token = localStorage.getItem('karkas_token') || '';
const state = { view: 'dashboard', settingsTab: 'integrations', pipeline: 1, conv: null, deals: [], stages: [], pipelines: [], contacts: [], companies: [], channels: [], cache: {}, dealTab: 'details' };
const fmt = n => new Intl.NumberFormat('ru-RU').format(Math.round(n || 0)) + ' ₽';
const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dt = s => s ? String(s).replace('T', ' ').slice(0, 16) : '';
const num = v => (String(v ?? '').replace(/[^\d.-]/g, '') || 0) * 1;
async function api(path, opt = {}) {
  const r = await fetch(path, { ...opt, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opt.headers || {}) } });
  if (r.status === 401) { logout(); throw new Error('Сессия истекла'); }
  if (String(opt.raw ? 0 : 1) && !(r.headers.get('content-type') || '').includes('json')) return r;
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Ошибка ' + r.status); return d;
}
const download = async (path, name) => { const r = await fetch(path, { headers: { Authorization: 'Bearer ' + token } }); const b = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); return false; };
function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('show'); setTimeout(() => e.classList.remove('show'), 2600) }
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden') }
function closeModal() { $('#modal').classList.add('hidden') }
function tmpl(name, obj = {}) { return (obj.body || '').replace(/{(\w+)}/g, (m, k) => esc(obj[k] || m)) }

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
  try {
    const me = await api('/api/me');
    $('#uName').textContent = me.user.name; $('#uEmail').textContent = me.user.email; $('#uAva').textContent = (me.user.name || 'A')[0].toUpperCase();
    $('#app').classList.remove('hidden'); $('#login').classList.add('hidden'); connectSSE(); render();
  } catch { $('#login').classList.remove('hidden'); $('#app').classList.add('hidden') }
}
$$('#nav button').forEach(b => b.onclick = () => go(b.dataset.view));
function go(v, tab) { state.view = v; if (tab) state.settingsTab = tab; $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === v)); render() }
const TITLES = {
  dashboard: ['Дашборд', 'Продажи, воронка и активность команды'], pipe: ['Сделки', 'Воронка продаж — перетаскивайте карточки между этапами'],
  inbox: ['Чаты Wazzup', 'WhatsApp, Telegram, Instagram и сайт — в одном окне клиента'], contacts: ['Контакты', 'База клиентов и всех, кто писал в мессенджеры'],
  companies: ['Компании', 'Юридические лица и организации'], tasks: ['Задачи', 'Звонки, встречи и письма по клиентам'],
  products: ['Товары и услуги', 'Прайс для быстрого наполнения сделок'], analytics: ['Аналитика', 'Конверсия, средний чек и источники'], settings: ['Настройки', 'Интеграции, воронки, автоматизации, команда и данные']
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
async function dashboard(v) {
  const d = await api('/api/dashboard'); navCounts(d);
  const max = Math.max(...d.stages.map(s => s.sum), 1);
  v.innerHTML = `<div class="grid">
   <div class="kpi"><i>💰</i><span>Выручка (успешно реализовано)</span><b class="green">${fmt(d.revenue)}</b></div>
   <div class="kpi"><i>▦</i><span>Активных сделок</span><b>${d.dealsTotal}</b></div>
   <div class="kpi"><i>◎</i><span>Контактов / компаний</span><b>${d.contacts} <small>/ ${d.companies}</small></b></div>
   <div class="kpi"><i>✉</i><span>Непрочитанных чатов</span><b class="accent">${d.unread}</b></div>
   <div class="kpi"><i>✓</i><span>Открытых задач</span><b>${d.tasksOpen}</b></div></div>
  <div class="cols"><div>
   <div class="card"><h3>Воронка продаж</h3>${d.stages.map(s => `<p style="display:flex;justify-content:space-between;margin:8px 0 2px"><span>${esc(s.name)} · ${s.count}</span><b>${fmt(s.sum)}</b></p><div class="bar"><i style="width:${Math.round(s.sum / max * 100)}%"></i></div>`).join('')}</div>
   <div class="card"><h3>Последние сделки</h3><table class="mini"><tr><th>Сделка</th><th>Клиент</th><th>Этап</th><th>Сумма</th></tr>${d.recentDeals.map(x => `<tr><td><b>${esc(x.title)}</b></td><td>${esc(x.contact_name || '—')}</td><td>${esc((d.stages.find(s => s.code === x.stage) || {}).name || x.stage)}</td><td><b>${fmt(x.amount)}</b></td></tr>`).join('')}</table></div></div>
  <div class="card"><h3>Лента активности</h3><div class="list">${d.activities.map(a => `<div class="row"><span>• ${esc(a.text)}<br><small>${esc(dt(a.created_at))}${a.user_name ? ' · ' + esc(a.user_name) : ''}</small></span></div>`).join('') || '<small>Пока пусто</small>'}</div><hr>
   <h3>Быстрые действия</h3><div style="display:flex;flex-direction:column;gap:8px">
   <button class="btn primary" onclick="openDeal()">+ Новая сделка</button>
   <button class="btn" onclick="openTask()">+ Задача</button>
   <button class="btn orange" onclick="go('settings','integrations')">⚙ Подключить Wazzup</button>
   <button class="btn ghost" onclick="simulate()">🧪 Тестовое входящее сообщение</button></div></div></div>`;
}

/* ---------- deals / kanban ---------- */
async function pipe(v) {
  const d = await api('/api/deals?pipeline=' + state.pipeline);
  Object.assign(state, { deals: d.deals, stages: d.stages, pipelines: d.pipelines });
  $('#navDeals').textContent = d.deals.filter(x => !['won', 'lost'].includes(x.stage)).length;
  const total = d.deals.filter(x => !['won', 'lost'].includes(x.stage)).reduce((a, x) => a + x.amount, 0);
  v.innerHTML = `<div class="card" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <b>Воронка:</b><select style="width:auto" onchange="state.pipeline=+this.value;render()">${d.pipelines.map(p => `<option value="${p.id}" ${p.id === state.pipeline ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <span class="tag">Сделок в работе: ${d.deals.filter(x => !['won', 'lost'].includes(x.stage)).length}</span><span class="tag orange">Сумма: ${fmt(total)}</span>
    <button class="btn sm" style="margin-left:auto" onclick="openPipelineEditor()">⚙ Настроить воронку</button></div>
  <div class="kanban">${d.stages.map(s => `<div class="col" ondragover="dragOver(event,this)" ondragleave="this.classList.remove('drag-over')" ondrop="dropDeal(event,'${s.code}',this)">
   <h3><span style="color:${esc(s.color)}">● ${esc(s.name)}</span><span>${d.deals.filter(x => x.stage === s.code).length}</span></h3>
   <div class="deals">${d.deals.filter(x => x.stage === s.code).map(x => `<article class="deal" draggable="true" ondragstart="event.dataTransfer.setData('text/plain',${x.id})" onclick="openDealCard(${x.id})" style="border-left-color:${esc(s.color)}">
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
  const users = await api('/api/users').catch(() => []);
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
    <label>Ответственный<input name="responsible" value="${esc(d.responsible || 'Администратор')}" list="usersList"><datalist id="usersList">${users.map(u => `<option value="${esc(u.name)}">`).join('')}</datalist></label>
    <label>Причина отказа (для закрытых)<input name="loss_reason" placeholder="дорого / выбрал конкурента" value="${esc(d.loss_reason || '')}"></label></div>
   <button class="btn primary w">Сохранить</button></form>`);
}
function selStages(pid) { const pl = state.pipelines.find(p => p.id == pid); if (pl) $('#dealStage').innerHTML = pl.stages.map(s => `<option value="${esc(s.code)}">${esc(s.name)}</option>`).join('') }
async function saveDeal(e, id) {
  e.preventDefault(); const data = Object.fromEntries(new FormData(e.target));
  data.amount = num(data.amount); data.pipeline_id = +data.pipeline_id; if (data.contact_id) data.contact_id = +data.contact_id; else delete data.contact_id;
  await api(id ? '/api/deals/' + id : '/api/deals', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(data) });
  closeModal(); toast('Сделка сохранена'); render(); return false;
}
async function openDealCard(id) {
  const d = await api('/api/deals/' + id); const x = d.deal; state.dealId = id;
  const tabs = { details: 'Карточка', products: 'Товары', tasks: 'Задачи', notes: 'Заметки', history: 'История' };
  openModal(`<h3>${esc(x.title)} <span class="tag orange">${fmt(x.amount)}</span></h3>
   <div class="tabs">${Object.entries(tabs).map(([k, n]) => `<button class="${state.dealTab === k ? 'active' : ''}" onclick="state.dealTab='${k}';openDealCard(${id})">${n}</button>`).join('')}</div>
   <div id="dealTab">${dealTab(d, id)}</div>
   <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn" onclick="openDeal(${id})">✎ Редактировать</button><button class="btn ghost" onclick="openTask(null,{deal_id:${id},contact_id:${x.contact_id || 'null'}})">+ Задача</button><button class="btn ghost" onclick="${x.contact_id ? `openContactCard(${x.contact_id})` : 'openContact()'}">◎ Контакт</button><button class="btn danger" onclick="del('deals',${id});closeModal()">Удалить</button></div>`);
}
function dealTab(d, id) {
  const x = d.deal;
  if (state.dealTab === 'details') return `<table class="mini"><tr><th>Клиент</th><td>${esc(x.contact_name || '—')} ${x.contact_phone ? '· ' + esc(x.contact_phone) : ''}</td></tr><tr><th>Этап</th><td>${esc(x.stage)}</td></tr><tr><th>Приоритет</th><td>${esc(x.priority)}</td></tr><tr><th>Дедлайн</th><td>${esc(x.deadline || '—')}</td></tr><tr><th>Создана</th><td>${esc(dt(x.created_at))}</td></tr><tr><th>Обновлена</th><td>${esc(dt(x.updated_at))}</td></tr>${x.loss_reason ? `<tr><th>Причина отказа</th><td>${esc(x.loss_reason)}</td></tr>` : ''}</table>`;
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
   <div class="chat">${cur ? `<div class="chat-head"><b>${esc(cur.title || '')}</b><small>${esc(cur.phone || '')} · ${chan(cur.chat_type || cur.channels)}</small></div>
    <div class="msgs" id="msgs">${msgs.map(m => `<div class="msg ${m.direction}"><span class="chan ${esc(m.channel)}">${esc(m.channel)}</span> ${esc(m.body)}<small>${esc(dt(m.created_at))}${m.author ? ' · ' + esc(m.author) : ''}${m.status === 'error' ? ' · ⚠ не доставлено' : m.status === 'read' ? ' · ✓✓' : ''}${m.content_uri ? ` · <a href="${esc(m.content_uri)}" target="_blank" rel="noopener">вложение</a>` : ''}</small></div>`).join('') || '<div class="empty">Нет сообщений</div>'}</div>
    <form class="composer" onsubmit="return sendMsg(event)">
     <select id="msgChannel" title="Канал отправки">${state.channels.filter(c => c.state === 'active' || !c.state).map(c => `<option value="${esc(c.external_id)}" data-type="${esc(c.transport || 'whatsapp')}">${esc(c.name || c.phone || c.transport || 'канал')}</option>`).join('') || '<option value="">локально</option>'}</select>
     <input id="msgText" placeholder="Написать клиенту…" required autocomplete="off">
     <select id="tplSel" style="width:auto" onchange="if(this.value){$('#msgText').value=$('#msgText').value||this.value;this.selectedIndex=0}" title="Шаблоны"><option value="">Шаблоны</option>${(state.cache.templates || []).map(t => `<option value="${esc(t.body)}">${esc(t.name)}</option>`).join('')}</select>
     <button class="btn primary">➤</button></form>` : '<div class="empty">Выберите чат слева</div>'}</div>
   <div class="profile">${cur ? `<h3>Клиент</h3><p><b>${esc(cur.title || '')}</b></p><p>📞 ${esc(cur.phone || '—')}<br>✉ ${esc(cur.email || '—')}</p><p>Каналы: ${chan(cur.channels)}</p><p><button class="btn sm" onclick="attachContact(${cur.contact_id})">Открыть карточку клиента</button></p><hr><h3>Быстрые действия</h3><div style="display:flex;flex-direction:column;gap:6px"><button class="btn sm" onclick="openTask(null,{contact_id:${cur.contact_id}})">+ Задача</button><button class="btn sm" onclick="quickDeal(${cur.contact_id})">+ Сделка</button><button class="btn sm" onclick="quickNote(${cur.contact_id})">+ Заметка</button></div>` : '<div class="empty">Выберите чат</div>'}</div></div>`;
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
async function simulate() { await api('/api/inbox/simulate', { method: 'POST', body: JSON.stringify({ channel: ['whatsapp', 'telegram', 'instagram'][Math.floor(Math.random() * 3)], phone: '+7 9' + Math.floor(100000000 + Math.random() * 899999999), name: 'Клиент ' + (Math.floor(Math.random() * 90) + 10), body: 'Здравствуйте! Интересует каркасный дом, пришлите расчёт, пожалуйста.' }) }); toast('Входящее сообщение получено'); if (state.view !== 'inbox') go('inbox'); else render() }

/* ---------- contacts / companies ---------- */
async function contacts(v) {
  const rows = await api('/api/contacts'); state.contacts = rows;
  const q = ($('#globalSearch').value || '').toLowerCase();
  const f = rows.filter(c => !q || JSON.stringify(c).toLowerCase().includes(q));
  v.innerHTML = `<div class="card"><div class="row" style="border:0"><b>Всего: ${rows.length}</b><span style="display:flex;gap:8px"><button class="btn sm" onclick="download('/api/export/contacts','contacts.csv')">⬇ CSV</button><button class="btn sm" onclick="importContacts()">⬆ Импорт CSV</button></span></div>
   <table><tr><th>Клиент</th><th>Контакты</th><th>Компания / источник</th><th>Теги</th><th></th></tr>${f.map(c => `<tr><td><b>${esc(c.name)}</b>${c.position ? `<br><small>${esc(c.position)}</small>` : ''}</td><td>${esc(c.phone || '')}<br><small>${esc(c.email || '')}</small></td><td>${esc(c.company || '—')} <span class="tag grey">${esc(c.source || '')}</span></td><td>${(c.tags || '').split(',').filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</td>
   <td><button class="btn sm" onclick="openContactCard(${c.id})">Открыть</button> <button class="btn sm" onclick="openContact(${c.id})">✎</button> <button class="btn sm danger" onclick="del('contacts',${c.id})">✕</button></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Контактов нет</div></td></tr>'}</table></div>`;
}
async function openContactCard(id) {
  const c = state.contacts.find(x => x.id === id) || await api('/api/contacts/' + id);
  const notes = await api(`/api/notes?type=contacts&entity=${id}`);
  const deals = (await api('/api/deals')).deals.filter(d => d.contact_id === id);
  openModal(`<h3>${esc(c.name)}</h3><table class="mini"><tr><th>Телефон</th><td>${esc(c.phone || '—')}</td></tr><tr><th>E-mail</th><td>${esc(c.email || '—')}</td></tr><tr><th>Компания</th><td>${esc(c.company || '—')}</td></tr><tr><th>Источник</th><td>${esc(c.source || '')}</td></tr><tr><th>Теги</th><td>${(c.tags || '').split(',').filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</td></tr></table>
   <h3 style="margin-top:14px">Сделки клиента</h3>${deals.map(d => `<div class="row"><span>${esc(d.title)}<br><small>${esc(d.stage)}</small></span><b>${fmt(d.amount)}</b></div>`).join('') || '<small>Сделок нет</small>'}
   <h3 style="margin-top:14px">Заметки</h3><form onsubmit="return addNote(event,'contacts',${id})"><textarea name="body" rows="2" placeholder="Заметка…"></textarea><button class="btn primary" style="margin-top:6px">Добавить</button></form>${notes.map(n => `<div class="row"><span>${esc(n.body)}<br><small>${esc(n.author || '')} · ${esc(dt(n.created_at))}</small></span></div>`).join('')}
   <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn" onclick="openContact(${id})">✎ Редактировать</button><button class="btn ghost" onclick="openTask(null,{contact_id:${id}});closeModal()">+ Задача</button><button class="btn ghost" onclick="quickDeal(${id})">+ Сделка</button></div>`);
}
async function openContact(id, preset = {}) {
  const c = id ? (state.contacts.find(x => x.id === id) || await api('/api/contacts/' + id)) : preset;
  openModal(`<h3>${id ? 'Контакт' : 'Новый контакт'}</h3><form onsubmit="return saveContact(event,${id || 'null'})">
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Имя*<input name="name" required value="${esc(c.name || '')}"></label><label>Телефон<input name="phone" value="${esc(c.phone || '')}"></label></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>E-mail<input name="email" value="${esc(c.email || '')}"></label><label>Должность<input name="position" value="${esc(c.position || '')}"></label></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Компания<input name="company" value="${esc(c.company || '')}"></label><label>Источник<input name="source" value="${esc(c.source || 'manual')}"></label></div>
   <label>Теги (через запятую)<input name="tags" value="${esc(c.tags || '')}"></label><label>Заметки<textarea name="notes" rows="2">${esc(c.notes || '')}</textarea></label>
   <button class="btn primary w">Сохранить</button></form>`);
}
async function saveContact(e, id) { e.preventDefault(); await api(id ? '/api/contacts/' + id : '/api/contacts', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) }); closeModal(); toast('Контакт сохранён'); render(); return false }
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
  const rows = await api('/api/tasks'); const g = t => t.filter(x => !x.done).concat();
  const groups = [['Просроченные', rows.filter(t => !t.done && (t.due || '').match(/^\d{4}/) && t.due < new Date().toISOString().slice(0, 10))], ['Активные', rows.filter(t => !t.done && !((t.due || '').match(/^\d{4}/) && t.due < new Date().toISOString().slice(0, 10)))], ['Выполненные', rows.filter(t => t.done)]];
  const types = { call: '📞 Звонок', meeting: '👥 Встреча', message: '✉ Сообщение', email: '📧 Письмо', other: '• Дело' };
  v.innerHTML = `<div class="card"><div class="row" style="border:0"><b>Задач: ${rows.length}</b><button class="btn sm primary" onclick="openTask()">+ Задача</button></div>
   ${groups.map(([t, list]) => list.length ? `<h3 style="margin-top:12px">${t} <small>${list.length}</small></h3>${list.map(x => `<div class="row"><label><input type="checkbox" ${x.done ? 'checked' : ''} onchange="toggleTask(${x.id},this.checked)"> <span style="${x.done ? 'text-decoration:line-through;color:#94a3b8' : ''}">${types[x.type] || '•'} ${esc(x.title)}</span> <small>${esc(x.due || '')}${x.contact_name ? ' · ' + esc(x.contact_name) : ''}${x.deal_title ? ' · ' + esc(x.deal_title) : ''}</small></label><button class="btn sm danger" onclick="del('tasks',${x.id})">✕</button></div>`).join('')}` : '').join('') || '<div class="empty">Задач нет — добавьте первую!</div>'}</div>`;
}
async function toggleTask(id, done, refreshId) { await api('/api/tasks/' + id, { method: 'PATCH', body: JSON.stringify({ done: done ? 1 : 0 }) }); toast(done ? 'Задача выполнена' : 'Задача возвращена'); if (refreshId) openDealCard(refreshId); else render() }
async function openTask(id, p = {}) {
  const t = id ? await api('/api/tasks/' + id) : p; if (!state.contacts.length) state.contacts = await api('/api/contacts');
  const deals = state.deals.length ? state.deals : (await api('/api/deals')).deals;
  openModal(`<h3>${id ? 'Задача' : 'Новая задача'}</h3><form onsubmit="return saveTask(event,${id || 'null'})">
   <label>Что сделать*<input name="title" required value="${esc(t.title || '')}"></label>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Тип<select name="type">${Object.entries({ call: 'Звонок', meeting: 'Встреча', message: 'Сообщение', email: 'Письмо', other: 'Другое' }).map(([k, n]) => `<option value="${k}" ${k === (t.type || 'call') ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
   <label>Срок<input name="due" type="datetime-local" value="${esc((t.due || '').slice(0, 16))}"></label></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Контакт<select name="contact_id"><option value="">—</option>${state.contacts.map(c => `<option value="${c.id}" ${c.id === t.contact_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
   <label>Сделка<select name="deal_id"><option value="">—</option>${deals.map(d => `<option value="${d.id}" ${d.id === t.deal_id ? 'selected' : ''}>${esc(d.title)}</option>`).join('')}</select></label></div>
   <label>Комментарий<textarea name="result" rows="2">${esc(t.result || '')}</textarea></label><button class="btn primary w">Сохранить</button></form>`);
}
async function saveTask(e, id) { e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); ['contact_id', 'deal_id'].forEach(k => { if (b[k]) b[k] = +b[k]; else delete b[k] }); await api(id ? '/api/tasks/' + id : '/api/tasks', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) }); closeModal(); toast('Задача сохранена'); render(); return false }

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
  v.innerHTML = `<div class="grid"><div class="kpi"><i>📈</i><span>Конверсия в успех</span><b class="green">${a.conversion}%</b></div>
   <div class="kpi"><i>💵</i><span>Средний чек (выигранные)</span><b>${fmt(a.avgCheck)}</b></div>
   <div class="kpi"><i>🔮</i><span>Прогноз выручки (в работе)</span><b class="accent">${fmt(a.forecast)}</b></div></div>
  <div class="cols"><div class="card"><h3>Выручка по этапам</h3><div class="chart">${a.stages.map(s => `<div><b style="color:var(--ink)">${s.count}</b><i style="height:${Math.max(4, Math.round(s.sum / max * 120))}px" title="${fmt(s.sum)}"></i><span>${esc(s.name.slice(0, 12))}</span></div>`).join('')}</div></div>
  <div class="card"><h3>Источники лидов</h3>${a.bySource.map(s => `<div class="row"><span>${esc(s.name)} <small>${s.count} сделок</small></span><b>${fmt(s.sum)}</b></div>`).join('') || '<small>Нет данных</small>'}<hr><h3>Причины отказов</h3>${a.byLoss.map(s => `<div class="row"><span>${esc(s.name)}</span><b>${s.count}</b></div>`).join('') || '<small>Отказов нет 🎉</small>'}</div></div>`;
}

/* ---------- settings ---------- */
async function settings(v) {
  const s = await api('/api/settings'); state.cache.settings = s; const origin = location.origin;
  const tabs = { integrations: '🔌 Интеграции и каналы', pipelines: '▦ Воронки и этапы', automations: '⚡ Автоматизации', templates: '💬 Шаблоны сообщений', team: '👥 Команда', data: '💾 Данные и компания', profile: '👤 Профиль' };
  let body = '';
  if (state.settingsTab === 'integrations') {
    const chans = state.channels.length ? state.channels : await api('/api/channels').catch(() => []); state.channels = chans;
    body = `<div class="settings-cols"><div>
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
      <label>Токен бота Telegram<input id="tgToken" placeholder="123456:ABC…"></label><button class="btn" onclick="saveTelegram()">Сохранить</button></div></div>
     <div><div class="card"><h3>Права и роли</h3><p><b>Администратор</b> — всё, включая настройки и команду.<br><b>Менеджер</b> — сделки, клиенты, чаты, задачи.<br><b>Наблюдатель</b> — только просмотр.</p><p><small>Создайте пользователей во вкладке «Команда».</small></p></div>
     <div class="card"><h3>Проверка работы</h3><button class="btn orange w" onclick="simulate()">🧪 Имитировать входящее сообщение</button><p style="margin-top:8px"><small>Проверит объединение чатов и создание сделки без реального мессенджера.</small></p><button class="btn w" onclick="fetch('/api/health').then(r=>r.json()).then(d=>toast('API '+d.version+' — OK'))">Проверить API</button></div></div></div>`;
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
    body = `<div class="card"><div class="row" style="border:0"><h3>Команда</h3><button class="btn sm primary" onclick="openUser()">+ Пользователь</button></div>
    <table><tr><th>Имя</th><th>E-mail</th><th>Роль</th><th>Активен</th><th></th></tr>${rows.map(x => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.email)}</td><td>${roles[x.role] || esc(x.role)}</td><td>${x.active ? '✅' : '—'}</td><td><button class="btn sm" onclick="openUser(${x.id})">✎</button></td></tr>`).join('')}</table></div>`;
  } else if (state.settingsTab === 'data') {
    body = `<div class="settings-cols"><div><div class="card"><h3>Название компании</h3><form onsubmit="return saveCompanySettings(event)"><div style="display:grid;grid-template-columns:2fr 1fr;gap:12px"><label>Название<input name="COMPANY_NAME" value="${esc(s.company.name)}"></label><label>Валюта<input name="CURRENCY" value="${esc(s.company.currency)}"></label></div>
     <label>Автосоздание сделки при первом обращении<select name="AUTO_DEAL"><option value="1" ${s.auto_deal === '1' ? 'selected' : ''}>Да — создавать сделку «Неразобранное»</option><option value="0" ${s.auto_deal !== '1' ? 'selected' : ''}>Нет</option></select></label>
     <button class="btn primary">Сохранить</button></form></div>
     <div class="card"><h3>Экспорт и импорт</h3><button class="btn w" onclick="download('/api/export/contacts','contacts.csv')">⬇ Контакты (CSV)</button><p></p><button class="btn w" onclick="download('/api/export/deals','deals.csv')">⬇ Сделки (CSV)</button><p></p><button class="btn w" onclick="download('/api/backup','karkas-backup.json')">⬇ Полный бэкап (JSON)</button>
     <hr><button class="btn w" onclick="importContacts()">⬆ Импорт контактов из CSV</button><p><small>Формат: <code>Имя;Телефон;E-mail;Компания</code> с заголовком в первой строке.</small></p></div></div>
     <div><div class="card"><h3>Обслуживание</h3><p><small>База — один файл SQLite в Docker-томе <code>karkascrm_data</code>. Бэкап = скачать JSON выше или скопировать <code>crm.db</code>.</small></p><code>docker compose exec crm sh -c "ls -la /data"</code></div>
     <div class="card"><h3>API для интеграций</h3><p><small>Все действия доступны по REST с токеном: <code>Authorization: Bearer …</code></small></p><p><small>Вебхуки: <code>/webhooks/wazzup</code>, <code>/webhooks/whatsapp</code>, <code>/webhooks/telegram</code>, <code>/webhooks/generic</code></small></p></div></div></div>`;
  } else {
    body = `<div class="card" style="max-width:480px"><h3>Смена пароля</h3><form onsubmit="return savePassword(event)"><label>Текущий пароль<input name="old" type="password" required></label><label>Новый пароль (мин. 8)<input name="next" type="password" minlength="8" required></label><button class="btn primary w">Сменить пароль</button></form></div>`;
  }
  v.innerHTML = `<div class="tabs">${Object.entries(tabs).map(([k, n]) => `<button class="${state.settingsTab === k ? 'active' : ''}" onclick="state.settingsTab='${k}';render()">${n}</button>`).join('')}</div>${body}`;
}
async function saveWazzup() { await api('/api/settings', { method: 'PUT', body: JSON.stringify({ WAZZUP_API_KEY: $('#wzKey').value, WAZZUP_CHANNEL_ID: $('#wzChannel').value, WAZZUP_WEBHOOK_SECRET: $('#wzSecret').value, WAZZUP_API_URL: $('#wzUrl').value }) }); toast('Ключ Wazzup сохранён'); render() }
async function saveWhatsApp() { await api('/api/settings', { method: 'PUT', body: JSON.stringify({ WHATSAPP_TOKEN: $('#waToken').value, WHATSAPP_PHONE_ID: $('#waPhone').value, WHATSAPP_VERIFY_TOKEN: $('#waVerify').value, MESSENGER_PROVIDER: $('#provider').value }) }); toast('Настройки WhatsApp сохранены'); render() }
async function saveTelegram() { await api('/api/settings', { method: 'PUT', body: JSON.stringify({ TELEGRAM_BOT_TOKEN: $('#tgToken').value }) }); toast('Токен сохранён'); render() }
async function testWazzup() {
  const r = await api('/api/integrations/wazzup/test', { method: 'POST' }).catch(e => ({ ok: false, error: e.message }));
  if (!r.ok) return toast('Ошибка: ' + r.error);
  const n = (r.channels || []).length; const sync = await api('/api/integrations/wazzup/sync', { method: 'POST' }).catch(e => ({ error: e.message }));
  toast(sync.error ? 'Ошибка синхронизации: ' + sync.error : `Каналов найдено и сохранено: ${sync.synced ?? n}`); state.channels = []; render();
}
async function registerWazzupWebhook() { const url = location.origin + '/webhooks/wazzup'; try { await api('/api/integrations/wazzup/webhook', { method: 'POST', body: JSON.stringify({ url }) }); toast('Вебхук зарегистрирован в Wazzup'); } catch (e) { toast(e.message); } }
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
   <label>Роль<select name="role">${Object.entries({ admin: 'Администратор', manager: 'Менеджер', viewer: 'Наблюдатель (только чтение)' }).map(([k, n]) => `<option value="${k}" ${k === (x.role || 'manager') ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
   <label>${id ? 'Новый пароль (оставьте пустым, чтобы не менять)' : 'Пароль (мин. 8 символов)'}<input name="password" type="text" ${id ? '' : 'required'}></label>
   <button class="btn primary w">Сохранить</button></form>`);
}
async function saveUser(e, id) { e.preventDefault(); const b = Object.fromEntries(new FormData(e.target)); if (!b.password) delete b.password; b.id = id; await api(id ? '/api/users/' + id : '/api/users', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(b) }); closeModal(); toast('Пользователь сохранён'); render(); return false }
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
  es.addEventListener('message', () => { if (state.view === 'inbox' || state.view === 'dashboard') render() });
  es.addEventListener('change', () => { if (['pipe', 'dashboard'].includes(state.view)) render() });
}
boot();
