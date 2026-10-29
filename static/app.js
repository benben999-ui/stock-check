/* Stock Check prototype - browser side. Plain JavaScript, no libraries. */

// ---------------------------------------------------------------- icons
const ICON = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M7 12.5l3.2 3.2L17 9"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 7v5l3 2"/></svg>',
  power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 3v8"/><path d="M6.3 7a8 8 0 1 0 11.4 0"/></svg>',
  headset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/><path d="M19 20c0 1.2-2 2-5 2"/></svg>',
  question: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.5 9a2.6 2.6 0 0 1 5 1c0 1.8-2.5 2.2-2.5 4"/><circle cx="12" cy="17.6" r=".6" fill="currentColor"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

const QUEUE_STATUS = {
  pending:         { label: 'Pending',              cls: 'neutral', icon: 'clock' },
  in_stock:        { label: 'In stock',             cls: 'good',    icon: 'check' },
  out_of_stock:    { label: 'Out: needs turn-off',  cls: 'bad',     icon: 'x' },
  turned_off:      { label: 'Turned off',           cls: 'warn',    icon: 'power' },
  empty_confirmed: { label: 'Empty slot confirmed', cls: 'info',    icon: 'headset' },
  not_found:       { label: 'Code not found',       cls: 'neutral', icon: 'question' },
  already_off:     { label: 'Already off',          cls: 'neutral', icon: 'power' },
};

const RESULT_PILL = {
  'IN STOCK':     { cls: 'good',    icon: 'check' },
  'OUT OF STOCK': { cls: 'bad',     icon: 'x' },
  'NOT FOUND':    { cls: 'neutral', icon: 'question' },
  'ALREADY OFF':  { cls: 'neutral', icon: 'power' },
  'TURNED ON':    { cls: 'info',    icon: 'power' },
};

// ---------------------------------------------------------------- helpers
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pill = (cls, icon, label) => `<span class="pill ${cls}">${ICON[icon]}${esc(label)}</span>`;

async function api(path, body) {
  const data = await apiCall(path, body);
  // Anything that records or changes a check also changes the sidebar counts.
  if (body !== undefined || path.startsWith('/api/lookup')) scheduleSidebar();
  return data;
}

async function apiCall(path, body) {
  if (window.demoApi) return window.demoApi(path, body);   // web demo: no server
  const opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function parseTs(s) { const [d, t] = s.split(' '); return new Date(`${d}T${t}`); }
function timeOf(s) { return parseTs(s).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function isToday(s) { return parseTs(s).toDateString() === new Date().toDateString(); }
function whenOf(s) {
  if (isToday(s)) return timeOf(s);
  return parseTs(s).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + timeOf(s);
}
function duration(sec) {
  if (sec == null) return '-';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}
function shortHour(h) { return `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`; }
function hourLabel(h) { const ampm = h < 12 ? 'AM' : 'PM'; return `${h % 12 || 12} ${ampm}`; }

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

function confirmDialog(title, bodyHtml, okLabel, okClass = 'btn-danger') {
  const dlg = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-body').innerHTML = bodyHtml;
  const ok = $('#confirm-ok');
  ok.textContent = okLabel;
  ok.className = `btn btn-lg ${okClass}`;
  const form = dlg.querySelector('form');
  dlg.showModal();
  ok.focus();
  // Resolve from the button press or Escape directly; the dialog's 'close' event isn't reliable in every browser.
  return new Promise((resolve) => {
    const finish = (value) => {
      form.removeEventListener('submit', onSubmit);
      dlg.removeEventListener('cancel', onCancel);
      if (dlg.open) dlg.close();
      resolve(value);
    };
    const onSubmit = (e) => { e.preventDefault(); finish(e.submitter && e.submitter.value === 'ok'); };
    const onCancel = (e) => { e.preventDefault(); finish(false); };
    form.addEventListener('submit', onSubmit);
    dlg.addEventListener('cancel', onCancel);
  });
}

// ---------------------------------------------------------------- tabs & clock
let currentView = 'check';
function showView(name) {
  currentView = name;
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === name);
    if (t.dataset.view === name) $('#crumb-label').textContent = t.dataset.label;
  });
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'check') $('#check-input').focus({ preventScroll: true });
  if (name === 'queue') { loadQueue(); $('#queue-input').focus({ preventScroll: true }); }
  if (name === 'log') loadLog();
  if (name === 'stats') loadStats();
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
$('#side-search').addEventListener('click', () => showView('check'));

// Page titles: "Stock check  Wed, Oct 28" and "October  2026", with the second half dimmed.
(function fillTitles() {
  const now = new Date();
  document.querySelectorAll('.js-date').forEach((e) => { e.textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); });
  document.querySelectorAll('.js-month-name').forEach((e) => { e.textContent = now.toLocaleDateString([], { month: 'long' }); });
  document.querySelectorAll('.js-year').forEach((e) => { e.textContent = now.getFullYear(); });
})();

// ---------------------------------------------------------------- sidebar counts
let sidebarTimer;
function scheduleSidebar() { clearTimeout(sidebarTimer); sidebarTimer = setTimeout(refreshSidebar, 150); }
async function refreshSidebar() {
  try {
    const [s, off, q] = await Promise.all([apiCall('/api/stats'), apiCall('/api/turned-off'), apiCall('/api/queue')]);
    $('#ss-checks').textContent = s.today.total;
    $('#ss-instock').textContent = s.today.in_stock;
    $('#ss-off').textContent = off.length;
    $('#ss-queue').textContent = q.filter((x) => x.status === 'pending').length;
    $('#off-count').textContent = off.length ? `${off.length} off` : '';
  } catch (_) { /* counts are a convenience; never block the page */ }
}
document.addEventListener('keydown', (e) => {
  const map = { F1: 'check', F2: 'queue', F3: 'log', F4: 'stats' };
  if (map[e.key]) { e.preventDefault(); showView(map[e.key]); }
  // Enter with nothing in particular focused runs the main button on the current card.
  if (e.key === 'Enter' && (document.activeElement === document.body || !document.activeElement) && !$('#confirm-dialog').open) {
    const primary = document.querySelector(`#view-${currentView} .result-area [data-primary]`);
    if (primary) { e.preventDefault(); primary.click(); }
  }
});
function tick() { $('#clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
tick(); setInterval(tick, 10000);

// ---------------------------------------------------------------- the result card
// An in-stock result is treated as "relayed to picker" when the next code is checked,
// so a certifier working fast through scans never has to click.
let pendingRelay = null;
async function flushPendingRelay() {
  if (!pendingRelay) return;
  const p = pendingRelay; pendingRelay = null;
  try { await api(`/api/checks/${p.check_id}/relayed`, { location: p.location }); } catch (_) { /* best effort */ }
}

function sendToText(data) {
  return data.send_to.map((s) => `${s.location_id} (${s.quantity} cs)`).join(', ');
}

function verdictHtml(cls, icon, title, sub) {
  return `<div class="verdict ${cls}"><span class="icon">${ICON[icon]}</span>
    <div><div class="verdict-text">${esc(title)}</div>${sub ? `<div class="verdict-sub">${sub}</div>` : ''}</div></div>`;
}

function detailsHtml(d) {
  const p = d.product;
  const routes = d.routes.length
    ? `<table class="table"><thead><tr><th>Route</th><th>Truck</th><th>Destination</th><th>Departs</th><th class="num">Cases</th></tr></thead><tbody>
        ${d.routes.map((r) => `<tr><td class="truck">${esc(r.route_number)}</td><td>${esc(r.truck_type)} · ${esc(r.truck_number)}</td>
          <td>${esc(r.destination)}</td><td>${timeOf(r.departs_at)}</td><td class="num">${r.cases}</td></tr>`).join('')}
      </tbody></table>`
    : '<p class="muted">Not on any of tomorrow\'s routes.</p>';
  const stock = `<table class="table"><thead><tr><th>Location</th><th>Type</th><th class="num">Cases</th></tr></thead><tbody>
      ${d.stock.map((s) => `<tr class="${s.quantity === 0 ? 'zero' : (s.type !== 'pick' ? 'highlight' : '')}">
        <td class="mono">${esc(s.location_id)}</td><td>${s.type === 'pick' ? 'Pick slot' : s.type === 'reserve' ? 'Reserve' : 'Overflow'}</td>
        <td class="num">${s.quantity === 0 ? '0 (empty)' : s.quantity}</td></tr>`).join('')}
      <tr><td colspan="2"><b>Total in building</b></td><td class="num"><b>${d.total_cases}</b></td></tr>
    </tbody></table>`;
  return `
    <div class="product-line"><span class="product-name">${esc(p.name)}</span><span class="product-pack">${esc(p.pack_size)}</span></div>
    <div class="codes">
      <div class="code-chip"><small>Route program code</small><span class="mono">${esc(p.route_code)}</span></div>
      <div class="code-chip"><small>Inventory system code</small><span class="mono">${esc(d.inventory_code)}</span></div>
    </div>
    <div class="lookup-steps">✓ Found in route program → ✓ translated to inventory code → ✓ checked reserve &amp; overflow (automatic)</div>
    <div class="two-col">
      <div><h3 class="section-title">Tomorrow's routes (${d.routes.length})</h3><div class="table-wrap">${routes}</div></div>
      <div><h3 class="section-title">Warehouse inventory</h3><div class="table-wrap">${stock}</div></div>
    </div>`;
}

/**
 * Draw a result card into `container`.
 * stage: show | relayed | decide | turned_off | empty_done | already_off | not_found
 * ctx.onChange() is called after any action (used by the queue to refresh).
 */
function renderResult(container, data, stage, ctx = {}) {
  const d = data;
  const rerender = (s) => renderResult(container, d, s, ctx);
  const nextBtn = ctx.nextButton ? `<button class="btn btn-primary btn-lg" data-act="next" ${stage === 'decide' ? '' : 'data-primary'}>Next pending ${ICON.arrow}</button>` : '';
  let top = '', actions = '';

  if (d.outcome === 'NOT_FOUND') {
    container.innerHTML = `<div class="result">${verdictHtml('neutral', 'question', 'CODE NOT FOUND',
      `<span class="mono">${esc(d.code)}</span> is not in the route program. Ask the picker to read the code again.`)}
      ${nextBtn ? `<div class="result-body"><div class="action-row">${nextBtn}</div></div>` : ''}</div>`;
    bind();
    return;
  }

  if (d.outcome === 'IN_STOCK') {
    const first = d.send_to[0];
    const inPickOnly = first && first.type === 'pick';
    top = verdictHtml('good', 'check', 'IN STOCK', `${d.total_cases} cases in the building`);
    actions = `
      <div class="send-to">
        <div class="send-to-label">Send picker to</div>
        ${d.send_to.map((s) => `<div class="send-to-row"><span class="send-loc">${esc(s.location_id)}</span>
          <span class="send-qty">${s.quantity} cases</span>
          <span class="send-type">${s.type === 'pick' ? 'Pick slot' : s.type === 'reserve' ? 'Reserve' : 'Overflow'}</span></div>`).join('')}
        ${inPickOnly ? '<div class="send-note">⚠ System shows stock in the pick slot itself. Have the picker recheck the slot, including behind and under it.</div>' : ''}
      </div>
      ${stage === 'relayed'
        ? `<div class="done-banner">${ICON.check} Location relayed to picker.</div><div class="action-row">${nextBtn}</div>`
        : `<div class="action-row"><button class="btn btn-good btn-lg" data-act="relayed">${ICON.check} Told picker: done</button>${nextBtn}
             <span class="muted">Checking the next code also marks this as done.</span></div>`}`;
  }

  if (d.outcome === 'OUT_OF_STOCK' || stage === 'turned_off' || stage === 'empty_done') {
    if (stage === 'decide') {
      top = verdictHtml('bad', 'x', 'OUT OF STOCK', 'No product in pick slot, reserve, or overflow.');
      actions = `<div class="action-row"><button class="btn btn-danger btn-lg" data-act="off">${ICON.power} Turn off product</button>${nextBtn}</div>`;
    } else if (stage === 'turned_off') {
      top = verdictHtml('bad', 'power', 'TURNED OFF', 'Product is now off in the route program.');
      actions = `<div class="reminder"><span class="icon">${ICON.headset}</span>
          <div class="reminder-text">Tell the picker to say <b>EMPTY SLOT</b> in their headset.</div>
          <button class="btn btn-good btn-lg" data-act="empty" data-primary>${ICON.check} Picker said it: mark done</button></div>`;
    } else {
      top = verdictHtml('bad', 'power', 'TURNED OFF', 'Product is off in the route program and the headset system.');
      actions = `<div class="done-banner">${ICON.headset} EMPTY SLOT confirmed. No other picker will be sent to this slot.</div>
        <div class="action-row">${nextBtn}</div>`;
    }
  }

  if (stage === 'already_off') {
    const at = d.product.turned_off_at ? `at ${whenOf(d.product.turned_off_at)}` : '';
    top = verdictHtml('neutral', 'power', 'ALREADY TURNED OFF', `This product was turned off ${at}.`);
    actions = `<div class="reminder"><span class="icon">${ICON.headset}</span>
        <div class="reminder-text">If the headset still sent the picker here, have them say <b>EMPTY SLOT</b>.</div></div>
      <div class="action-row"><button class="btn btn-lg" data-act="on">${ICON.power} Turn back on (delivery arrived)</button>${nextBtn}</div>`;
  }

  container.innerHTML = `<div class="result">${top}<div class="result-body">${actions}${detailsHtml(d)}</div></div>`;
  bind();

  function bind() {
    container.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
    const focusTarget = container.querySelector('[data-act="empty"]') || (ctx.nextButton && ['show', 'relayed', 'empty_done', 'not_found'].includes(stage) && container.querySelector('[data-act="next"]'));
    // Wait a tick so the confirm dialog's own focus handling has finished.
    if (focusTarget) setTimeout(() => focusTarget.isConnected && focusTarget.focus(), 0);
  }

  async function act(what) {
    try {
      if (what === 'next') { ctx.onNext && ctx.onNext(); return; }
      if (what === 'relayed') {
        if (pendingRelay && pendingRelay.check_id === d.check_id) pendingRelay = null;
        await api(`/api/checks/${d.check_id}/relayed`, { location: sendToText(d) });
        toast('Logged: picker sent to ' + sendToText(d));
        rerender('relayed');
      }
      if (what === 'off') {
        const ok = await confirmDialog('Turn off this product?',
          `<b>${esc(d.product.name)} · ${esc(d.product.pack_size)}</b><br>Route code <span class="mono">${esc(d.product.route_code)}</span> will be turned off in the route program for all of tomorrow's routes.`,
          'Yes, turn it off');
        if (!ok) return;
        await api(`/api/products/${d.product.id}/off`, { check_id: d.check_id });
        d.product.is_active = 0;
        toast('Product turned off');
        rerender('turned_off');
      }
      if (what === 'empty') {
        await api(`/api/checks/${d.check_id}/empty-slot`, {});
        toast('EMPTY SLOT confirmed and logged');
        rerender('empty_done');
      }
      if (what === 'on') {
        const ok = await confirmDialog('Turn this product back on?',
          `<b>${esc(d.product.name)} · ${esc(d.product.pack_size)}</b><br>Only do this if product has arrived and is in a slot.`,
          'Yes, turn it on', 'btn-good');
        if (!ok) return;
        await api(`/api/products/${d.product.id}/on`, {});
        toast('Product turned back on');
        container.innerHTML = `<div class="done-banner">${ICON.power} ${esc(d.product.name)} · ${esc(d.product.pack_size)} is back on in the route program.</div>`;
      }
      ctx.onChange && ctx.onChange();
      if (!ctx.nextButton && what !== 'off') $('#check-input').focus({ preventScroll: true });
    } catch (err) {
      toast('Error: ' + err.message);
    }
  }
}

function stageForOutcome(outcome) {
  return { IN_STOCK: 'show', OUT_OF_STOCK: 'decide', ALREADY_OFF: 'already_off', NOT_FOUND: 'not_found' }[outcome];
}

// ---------------------------------------------------------------- CHECK view
$('#check-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#check-input');
  const code = input.value.trim();
  if (!code) return;
  input.value = '';
  await flushPendingRelay();
  try {
    const data = await api(`/api/lookup?code=${encodeURIComponent(code)}`);
    if (data.outcome === 'IN_STOCK') pendingRelay = { check_id: data.check_id, location: sendToText(data) };
    renderResult($('#check-result'), data, stageForOutcome(data.outcome));
  } catch (err) {
    toast('Error: ' + err.message);
  }
  input.focus({ preventScroll: true });
});
$('#check-input').addEventListener('keydown', (e) => { if (e.key === 'Escape') e.target.value = ''; });

// ---------------------------------------------------------------- QUEUE view
let queue = [];
let currentQueueId = null;
const queueResults = new Map();   // queue item id -> { data, stage }

async function loadQueue() {
  queue = await api('/api/queue');
  renderQueue();
}

function renderQueue() {
  const counts = {};
  queue.forEach((q) => { counts[q.status] = (counts[q.status] || 0) + 1; });
  const pending = counts.pending || 0;
  const badge = $('#queue-badge');
  badge.hidden = pending === 0;
  badge.textContent = pending;
  $('#queue-title-count').textContent = queue.length ? `${pending} pending` : 'empty';
  $('#ss-queue').textContent = pending;
  $('#queue-summary').textContent = queue.length
    ? `${queue.length} in queue · ${pending} pending · ${queue.length - pending} worked`
    : 'Queue is empty.';
  $('#queue-list').innerHTML = queue.map((q, i) => {
    const st = QUEUE_STATUS[q.status] || QUEUE_STATUS.pending;
    return `<li class="queue-item ${q.id === currentQueueId ? 'current' : ''}" data-id="${q.id}">
      <span class="queue-num">${i + 1}</span>
      <span><div class="queue-code">${esc(q.code)}</div><div class="queue-name">${q.name ? esc(q.name + ' · ' + q.pack_size) : 'Unknown code'}</div>
        <div class="queue-status">${pill(st.cls, st.icon, st.label)}</div></span>
      <button class="queue-remove" title="Remove from queue" data-remove="${q.id}">×</button></li>`;
  }).join('');
  $('#queue-next').disabled = pending === 0;
}

async function addCodes(codes) {
  codes = codes.map((c) => c.trim()).filter(Boolean);
  if (!codes.length) return;
  const res = await api('/api/queue', { codes });
  queue = res.items;
  renderQueue();
  toast(`Added ${res.added} code${res.added === 1 ? '' : 's'} to queue`);
}

$('#queue-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#queue-input');
  const code = input.value;
  input.value = '';
  await addCodes([code]);
  input.focus({ preventScroll: true });
});
$('#queue-paste-btn').addEventListener('click', async () => {
  const ta = $('#queue-paste');
  await addCodes(ta.value.split(/[\s,;]+/));
  ta.value = '';
});

$('#queue-list').addEventListener('click', async (e) => {
  const rm = e.target.closest('[data-remove]');
  if (rm) {
    e.stopPropagation();
    const id = Number(rm.dataset.remove);
    queue = await api(`/api/queue/${id}/remove`, {});
    queueResults.delete(id);
    if (id === currentQueueId) { currentQueueId = null; $('#queue-result').innerHTML = '<div class="empty-state">Removed. Pick another item.</div>'; }
    renderQueue();
    return;
  }
  const li = e.target.closest('.queue-item');
  if (li) openQueueItem(Number(li.dataset.id));
});

async function openQueueItem(id) {
  const item = queue.find((q) => q.id === id);
  if (!item) return;
  currentQueueId = id;
  renderQueue();
  const container = $('#queue-result');
  const ctx = { nextButton: true, onNext: workNext, onChange: refreshQueueKeepResult };

  if (item.status === 'pending') {
    await flushPendingRelay();
    const data = await api(`/api/lookup?code=${encodeURIComponent(item.code)}&queue_id=${id}`);
    if (data.outcome === 'IN_STOCK') pendingRelay = { check_id: data.check_id, location: sendToText(data) };
    queueResults.set(id, { data, stage: stageForOutcome(data.outcome) });
    await loadQueue();
  } else if (!queueResults.has(id)) {
    // Worked earlier (e.g. before a page refresh): rebuild the card without logging a new check.
    const data = await api(`/api/lookup?code=${encodeURIComponent(item.code)}&log=0`);
    data.check_id = item.check_id;
    const stage = { in_stock: 'relayed', out_of_stock: 'decide', turned_off: 'turned_off', empty_confirmed: 'empty_done', not_found: 'not_found', already_off: 'already_off' }[item.status];
    if (stage === 'turned_off' || stage === 'empty_done' || stage === 'decide') data.outcome = 'OUT_OF_STOCK';
    queueResults.set(id, { data, stage });
  }
  const r = queueResults.get(id);
  renderResult(container, r.data, r.stage, ctx);
}

// Keep the cached card in sync with the stage it has moved to.
async function refreshQueueKeepResult() {
  const item = queue.find((q) => q.id === currentQueueId);
  await loadQueue();
  const updated = queue.find((q) => q.id === currentQueueId);
  if (item && updated && queueResults.has(updated.id)) {
    const stage = { in_stock: 'relayed', out_of_stock: 'decide', turned_off: 'turned_off', empty_confirmed: 'empty_done' }[updated.status];
    if (stage) queueResults.get(updated.id).stage = stage;
  }
}

function workNext() {
  const next = queue.find((q) => q.status === 'pending');
  if (!next) {
    toast('No pending codes left in the queue');
    $('#queue-input').focus({ preventScroll: true });
    return;
  }
  openQueueItem(next.id);
}
$('#queue-next').addEventListener('click', workNext);
$('#queue-clear-done').addEventListener('click', async () => {
  queue = await api('/api/queue/clear', { only_finished: true });
  renderQueue();
});
$('#queue-clear-all').addEventListener('click', async () => {
  if (!queue.length) return;
  const ok = await confirmDialog('Clear the whole queue?', 'This removes every code from the list. The activity log is not affected.', 'Clear queue');
  if (!ok) return;
  queue = await api('/api/queue/clear', {});
  queueResults.clear();
  currentQueueId = null;
  $('#queue-result').innerHTML = '<div class="empty-state">Queue cleared.</div>';
  renderQueue();
});

// ---------------------------------------------------------------- LOG view
async function loadLog() {
  const [off, log] = await Promise.all([
    api('/api/turned-off'),
    api(`/api/log?q=${encodeURIComponent($('#log-search').value.trim())}`),
  ]);
  $('#turned-off-list').innerHTML = off.length
    ? off.map((p) => `<div class="off-row">
        ${pill('bad', 'power', 'OFF')}
        <div class="off-info"><div class="off-name">${esc(p.name)} · ${esc(p.pack_size)}</div>
          <div class="muted"><span class="mono">${esc(p.route_code)}</span> · <span class="mono">${esc(p.inventory_code)}</span> ·
          turned off ${p.turned_off_at ? whenOf(p.turned_off_at) : ''}${p.today ? ' (today)' : ''}</div></div>
        <button class="btn btn-good" data-on="${p.id}" data-name="${esc(p.name + ' · ' + p.pack_size)}">${ICON.power} Turn back on</button>
      </div>`).join('')
    : '<p class="muted">No products are turned off.</p>';

  $('#log-body').innerHTML = log.map((r) => {
    const rp = RESULT_PILL[r.result] || { cls: 'neutral', icon: 'question' };
    return `<tr><td>${whenOf(r.started_at)}</td>
      <td>${r.name ? `<b>${esc(r.name)}</b><br><span class="muted">${esc(r.pack_size)}</span>` : '<span class="muted">Unknown code</span>'}</td>
      <td class="mono">${esc(r.code_entered)}</td><td>${pill(rp.cls, rp.icon, r.result)}</td>
      <td>${esc(r.action)}</td><td class="num">${duration(r.seconds)}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">No matching checks.</td></tr>';
}

$('#turned-off-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-on]');
  if (!b) return;
  const ok = await confirmDialog('Turn this product back on?',
    `<b>${esc(b.dataset.name)}</b><br>Only do this if product has arrived and is in a slot.`, 'Yes, turn it on', 'btn-good');
  if (!ok) return;
  await api(`/api/products/${b.dataset.on}/on`, {});
  toast('Product turned back on');
  loadLog();
});
let searchTimer;
$('#log-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadLog, 250); });

// ---------------------------------------------------------------- STATS view
async function loadStats() {
  const s = await api('/api/stats');
  const t = s.today;
  const priorAvgSecs = s.prior_days.filter((d) => d.avg_seconds).map((d) => d.avg_seconds);
  const priorAvg = priorAvgSecs.length ? Math.round(priorAvgSecs.reduce((a, b) => a + b, 0) / priorAvgSecs.length) : null;
  const peakHour = t.total ? t.hours.indexOf(Math.max(...t.hours)) : null;

  $('#stat-tiles').innerHTML = [
    ['Checks today', t.total, `${s.prior_days.length ? Math.round(s.prior_days.reduce((a, d) => a + d.total, 0) / s.prior_days.length) : '-'} per day, previous 3 days`],
    ['Avg time per check', duration(t.avg_seconds), priorAvg ? `${duration(priorAvg)} previous 3 days` : ''],
    ['Busiest hour today', peakHour == null ? '-' : `${hourLabel(peakHour)}`, peakHour == null ? '' : `${t.hours[peakHour]} checks`],
    ['First 2 hours of shift', t.first_two_hours_share == null ? '-' : `${t.first_two_hours_share}%`, `of today's checks (shift starts ${hourLabel(s.shift_start_hour)})`],
  ].map(([label, value, sub]) => `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div><div class="tile-sub">${sub}</div></div>`).join('');

  $('#chart-total').textContent = `${t.total} checks today`;
  lastStats = s;
  drawHourChart(s);

  const hours = chartHours(s);
  $('#hour-table').innerHTML = `<table class="table"><thead><tr><th>Hour</th><th class="num">Today</th><th class="num">Prev. 3-day avg</th></tr></thead><tbody>
    ${hours.map((h) => `<tr><td>${hourLabel(h)}</td><td class="num">${t.hours[h]}</td><td class="num">${s.prior_avg_hours[h]}</td></tr>`).join('')}</tbody></table>`;

  $('#day-table').innerHTML = `<table class="table"><thead><tr><th>Date</th><th class="num">Checks</th><th class="num">Avg time per check</th><th class="num">In first 2 hours</th></tr></thead><tbody>
    ${s.prior_days.slice().reverse().map((d) => `<tr><td>${new Date(d.date + 'T12:00').toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</td>
      <td class="num">${d.total}</td><td class="num">${duration(d.avg_seconds)}</td><td class="num">${d.first_two_hours_share ?? '-'}%</td></tr>`).join('')}</tbody></table>`;
}

// The shift's hours, stretched to include any checks made before or after it.
function chartHours(s) {
  const used = s.today.hours.map((v, h) => (v > 0 ? h : null)).filter((h) => h != null);
  const first = Math.min(s.shift_start_hour - 1, ...used);
  const last = Math.max(s.shift_end_hour + 1, ...used);
  const hours = [];
  for (let h = first; h <= last; h++) hours.push(h);
  return hours;
}

// Smooth curve through the points using horizontal tangents, so it never overshoots a real value.
function smoothPath(pts) {
  return pts.map(([x, y], i) => {
    if (i === 0) return `M${x},${y}`;
    const [px, py] = pts[i - 1];
    const mx = (px + x) / 2;
    return `C${mx},${py} ${mx},${y} ${x},${y}`;
  }).join(' ');
}

let lastStats = null;
function drawHourChart(s) {
  const el = $('#hour-chart');
  const hours = chartHours(s);
  const today = s.today.hours, prior = s.prior_avg_hours;
  const W = Math.max(280, el.clientWidth), H = el.clientHeight || 300;
  const m = { l: 34, r: 14, t: 22, b: 26 };
  const maxVal = Math.max(5, ...hours.map((h) => Math.max(today[h], prior[h])));
  const step = maxVal > 30 ? 10 : 5;
  const top = Math.ceil(maxVal / step) * step;
  const x = (i) => m.l + (i * (W - m.l - m.r)) / Math.max(1, hours.length - 1);
  const y = (v) => m.t + (1 - v / top) * (H - m.t - m.b);
  const narrow = W < 560;

  let grid = '';
  for (let v = 0; v <= top; v += step) {
    grid += `<line class="grid-line" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis-label" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  const labelEvery = narrow ? 2 : 1;
  const xLabels = hours.map((h, i) => (i % labelEvery ? '' :
    `<text class="axis-label ${h === s.current_hour ? 'now' : ''}" x="${x(i)}" y="${H - 6}" text-anchor="middle">${narrow ? shortHour(h) : hourLabel(h)}</text>`)).join('');

  const todayPts = hours.map((h, i) => [x(i), y(today[h])]);
  const priorPts = hours.map((h, i) => [x(i), y(prior[h])]);
  const line = smoothPath(todayPts);
  const area = `${line} L${x(hours.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const peakI = hours.reduce((best, h, i) => (today[h] > today[hours[best]] ? i : best), 0);
  const peakV = today[hours[peakI]];

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Checks per hour today compared with the previous 3-day average">
      <defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color: var(--chart-fill)"/><stop offset="1" style="stop-color: var(--chart-fill); stop-opacity: 0"/>
      </linearGradient></defs>
      ${grid}${xLabels}
      <path d="${area}" fill="url(#chart-fill)"/>
      <path class="line-avg" d="${smoothPath(priorPts)}"/>
      <path class="line-today" d="${line}"/>
      ${peakV > 0 ? `<circle class="pt" cx="${x(peakI)}" cy="${y(peakV)}" r="4"/>
        <text class="pt-label" x="${x(peakI)}" y="${y(peakV) - 10}" text-anchor="middle">${peakV}</text>` : ''}
      <line class="crosshair" id="chart-cross" x1="0" x2="0" y1="${m.t}" y2="${y(0)}" visibility="hidden"/>
      <circle class="pt" id="chart-dot" r="4" visibility="hidden"/>
      ${hours.map((h, i) => `<rect class="hit" data-i="${i}" x="${x(i) - (W - m.l - m.r) / Math.max(1, hours.length - 1) / 2}" y="0"
          width="${(W - m.l - m.r) / Math.max(1, hours.length - 1)}" height="${H}"/>`).join('')}
    </svg><div class="tooltip" id="chart-tip"></div>`;

  const tip = $('#chart-tip'), cross = $('#chart-cross'), dot = $('#chart-dot');
  const hide = () => { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
  el.querySelectorAll('.hit').forEach((r) => {
    r.addEventListener('mouseenter', () => {
      const i = Number(r.dataset.i), h = hours[i];
      const scale = el.clientWidth / W;
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(today[h])); dot.setAttribute('visibility', 'visible');
      tip.innerHTML = `<b>${hourLabel(h)}–${hourLabel((h + 1) % 24)}</b><br>Today: ${today[h]} checks<br>Prev. 3-day avg: ${prior[h]}`;
      tip.style.display = 'block';
      tip.style.left = `${Math.min(el.clientWidth - 80, Math.max(80, x(i) * scale))}px`;
      tip.style.top = `${y(Math.max(today[h], prior[h])) * scale}px`;
    });
    r.addEventListener('mouseleave', hide);
  });
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (currentView === 'stats' && lastStats) drawHourChart(lastStats); }, 150);
});

// ---------------------------------------------------------------- start
refreshSidebar();
loadQueue();
$('#check-input').focus({ preventScroll: true });
