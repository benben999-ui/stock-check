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

// A line on a store's order: where it is in picking, or where it can be picked from.
const LINE_STATUS = {
  picked:   { label: 'Picked',            cls: 'good',    icon: 'check' },
  picking:  { label: 'Picking now',       cls: 'info',    icon: 'clock' },
  stockout: { label: 'Stockout',          cls: 'bad',     icon: 'x' },
  off:      { label: 'Turned off',        cls: 'bad',     icon: 'power' },
  nostock:  { label: 'No stock',          cls: 'bad',     icon: 'x' },
  reserve:  { label: 'Pick from reserve', cls: 'warn',    icon: 'arrow' },
  ready:    { label: 'Ready to pick',     cls: 'neutral', icon: 'clock' },
};
const SHORT_STATUSES = ['stockout', 'off', 'nostock'];
const CALM_STATUSES = ['picked', 'picking', 'ready'];

// What a product can be picked from right now (for the stockout list).
const STOCK_STATUS = {
  ok:      { label: 'Back in pick slot',      cls: 'good', icon: 'check' },
  reserve: { label: 'In reserve: send picker', cls: 'warn', icon: 'arrow' },
  out:     { label: 'No stock: needs turn-off', cls: 'bad', icon: 'x' },
  off:     { label: 'Turned off',             cls: 'neutral', icon: 'power' },
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
  if (name === 'routes') loadRoutes();
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
    const [s, off, routes] = await Promise.all([apiCall('/api/stats'), apiCall('/api/turned-off'), apiCall('/api/routes')]);
    $('#ss-checks').textContent = s.today.total;
    $('#ss-instock').textContent = s.today.in_stock;
    $('#ss-off').textContent = off.length;
    $('#ss-short').textContent = routes.reduce((n, r) => n + r.short_lines, 0);
    $('#routes-count').textContent = routes.length;
    $('#off-count').textContent = off.length ? `${off.length} off` : '';
  } catch (_) { /* counts are a convenience; never block the page */ }
}
document.addEventListener('keydown', (e) => {
  const map = { F1: 'check', F2: 'routes', F3: 'log', F4: 'stats' };
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
    ? `<table class="table"><thead><tr><th>Route</th><th>Truck</th><th>Door</th><th>Destination</th><th>Departs</th><th class="num">Cases</th></tr></thead><tbody>
        ${d.routes.map((r) => `<tr><td class="truck"><button class="code-link" data-open-route="${r.id}" title="Open route ${esc(r.route_number)}">${esc(r.route_number)}</button></td><td>${esc(r.truck_type)} · ${esc(r.truck_number)}</td>
          <td>${esc(r.door || '')}</td><td>${esc(r.destination)}</td><td>${timeOf(r.departs_at)}</td><td class="num">${r.cases}</td></tr>`).join('')}
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
 */
function renderResult(container, data, stage) {
  const d = data;
  const rerender = (s) => renderResult(container, d, s);
  let top = '', actions = '';

  if (d.outcome === 'NOT_FOUND') {
    container.innerHTML = `<div class="result">${verdictHtml('neutral', 'question', 'CODE NOT FOUND',
      `<span class="mono">${esc(d.code)}</span> is not in the route program. Ask the picker to read the code again.`)}</div>`;
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
        ? `<div class="done-banner">${ICON.check} Location relayed to picker.</div>`
        : `<div class="action-row"><button class="btn btn-good btn-lg" data-act="relayed">${ICON.check} Told picker: done</button>
             <span class="muted">Checking the next code also marks this as done.</span></div>`}`;
  }

  if (d.outcome === 'OUT_OF_STOCK' || stage === 'turned_off' || stage === 'empty_done') {
    if (stage === 'decide') {
      top = verdictHtml('bad', 'x', 'OUT OF STOCK', 'No product in pick slot, reserve, or overflow.');
      actions = `<div class="action-row"><button class="btn btn-danger btn-lg" data-act="off">${ICON.power} Turn off product</button></div>`;
    } else if (stage === 'turned_off') {
      top = verdictHtml('bad', 'power', 'TURNED OFF', 'Product is now off in the route program.');
      actions = `<div class="reminder"><span class="icon">${ICON.headset}</span>
          <div class="reminder-text">Tell the picker to say <b>EMPTY SLOT</b> in their headset.</div>
          <button class="btn btn-good btn-lg" data-act="empty" data-primary>${ICON.check} Picker said it: mark done</button></div>`;
    } else {
      top = verdictHtml('bad', 'power', 'TURNED OFF', 'Product is off in the route program and the headset system.');
      actions = `<div class="done-banner">${ICON.headset} EMPTY SLOT confirmed. No other picker will be sent to this slot.</div>`;
    }
  }

  if (stage === 'already_off') {
    const at = d.product.turned_off_at ? `at ${whenOf(d.product.turned_off_at)}` : '';
    top = verdictHtml('neutral', 'power', 'ALREADY TURNED OFF', `This product was turned off ${at}.`);
    actions = `<div class="reminder"><span class="icon">${ICON.headset}</span>
        <div class="reminder-text">If the headset still sent the picker here, have them say <b>EMPTY SLOT</b>.</div></div>
      <div class="action-row"><button class="btn btn-lg" data-act="on">${ICON.power} Turn back on (delivery arrived)</button></div>`;
  }

  container.innerHTML = `<div class="result">${top}<div class="result-body">${actions}${detailsHtml(d)}</div></div>`;
  bind();

  function bind() {
    container.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
    container.querySelectorAll('[data-open-route]').forEach((b) => b.addEventListener('click', () => goToRoute(Number(b.dataset.openRoute))));
    const focusTarget = container.querySelector('[data-act="empty"]');
    // Wait a tick so the confirm dialog's own focus handling has finished.
    if (focusTarget) setTimeout(() => focusTarget.isConnected && focusTarget.focus(), 0);
  }

  async function act(what) {
    try {
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
      if (what !== 'off') $('#check-input').focus({ preventScroll: true });
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
  // A pallet label (SSCC barcode) or store order number opens that store's stop on its truck.
  if (/^\d{18,20}$/.test(code.replace(/\s/g, '')) || /^SO-?\d{6}$/i.test(code)) {
    try {
      const found = await api(`/api/find?q=${encodeURIComponent(code)}`);
      goToRoute(found.route_id, found.store_id);
    } catch (_) {
      $('#check-result').innerHTML = `<div class="result">${verdictHtml('neutral', 'question', 'NOT FOUND',
        `No pallet or store order matches <span class="mono">${esc(code)}</span>.`)}</div>`;
    }
    return;
  }
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

// ---------------------------------------------------------------- ROUTES view
// Tonight's picking for tomorrow's trucks: an overview (progress by zone, stockouts pickers
// reported), then the trucks. Click a truck to see each store stop and what that store ordered.
let routesCache = [];
let progressCache = null;
let stockoutsCache = [];
let currentRouteId = null;
let routeDetailCache = null;
let highlightStoreId = null;

// Run a full stock check on a code from anywhere (route detail, stockout list, demo intro).
function checkCode(code) {
  showView('check');
  $('#check-input').value = code;
  $('#check-form').requestSubmit();
}

// Open one truck (optionally scrolling to one of its stops) from anywhere in the app.
function goToRoute(routeId, storeId = null) {
  currentRouteId = routeId;
  highlightStoreId = storeId;
  showView('routes');
}

async function loadRoutes() {
  [routesCache, progressCache, stockoutsCache] = await Promise.all([
    api('/api/routes'), api('/api/progress'), api('/api/stockouts'),
  ]);
  updateRoutesTitle();
  if (currentRouteId) await openRoute(currentRouteId, { keepScroll: !highlightStoreId });
  else renderRouteList();
}

function updateRoutesTitle() {
  $('#routes-title-count').textContent = `${routesCache.length} trucks · ${progressCache.total.pct_picked}% picked`;
}

const bar = (pct) => `<span class="bar" aria-hidden="true"><i style="width:${Math.min(100, pct)}%"></i></span>`;
const palletLabel = (sscc) => (sscc ? `${sscc.slice(0, 2)} ${sscc.slice(2)}` : '');

function attentionPills(shortLines, reserveLines) {
  const out = [];
  if (shortLines) out.push(pill('bad', 'x', `${shortLines} short`));
  if (reserveLines) out.push(pill('warn', 'arrow', `${reserveLines} from reserve`));
  return out.length ? out.join(' ') : pill('good', 'check', 'Nothing short');
}

function overviewHtml() {
  const t = progressCache.total;
  const shortLines = routesCache.reduce((n, r) => n + r.short_lines, 0);
  const needCheck = stockoutsCache.filter((s) => s.stock !== 'off').length;
  const tiles = [
    ['Cases picked', `${t.pct_picked}%`, `${t.picked.toLocaleString()} of ${t.cases.toLocaleString()} cases`],
    ['Cases left to pick', (t.available + t.in_progress).toLocaleString(), `${t.in_progress.toLocaleString()} being picked now`],
    ['Stockouts reported', stockoutsCache.length, `${needCheck} product${needCheck === 1 ? '' : 's'} still need a check`],
    ['Lines shipping short', shortLines, 'Stockouts, no stock, or turned off'],
  ].map(([label, value, sub]) => `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div><div class="tile-sub">${sub}</div></div>`).join('');

  const zoneRow = (z, cls = '') => `<tr class="${cls}"><td><b>${z.zone}</b></td>
      <td class="num">${z.cases.toLocaleString()}</td><td class="num">${z.available.toLocaleString()}</td>
      <td class="num">${z.in_progress.toLocaleString()}</td><td class="num">${z.picked.toLocaleString()}</td>
      <td class="pct-cell">${bar(z.pct_picked)}<span class="mono">${z.pct_picked}%</span></td>
      <td class="num">${z.stockout ? `<span class="bad-text">${z.stockout.toLocaleString()}</span>` : '0'}</td></tr>`;

  const stockoutRows = stockoutsCache.map((s) => {
    const st = STOCK_STATUS[s.stock];
    return `<tr>
      <td><b>${esc(s.name)}</b> <span class="muted">${esc(s.pack_size)}</span></td>
      <td><button class="code-link" data-code="${esc(s.route_code)}" title="Run a stock check on ${esc(s.route_code)}">${esc(s.route_code)}</button></td>
      <td class="num">${s.stores}</td><td class="num">${s.cases_short}</td>
      <td class="mono routes-cell" title="${esc(s.routes.join(', '))}">${s.routes.slice(0, 3).map(esc).join(', ')}${s.routes.length > 3 ? ` <span class="muted">+${s.routes.length - 3}</span>` : ''}</td>
      <td>${pill(st.cls, st.icon, st.label)}</td>
      <td class="muted">${s.last_reported ? whenOf(s.last_reported) : ''}${s.last_picker ? ` · <span class="mono">${esc(s.last_picker)}</span>` : ''}</td></tr>`;
  }).join('');

  return `
    <div class="tiles">${tiles}</div>
    <div class="overview-grid">
      <div class="card">
        <div class="card-head"><div><h2>Pick progress by zone</h2><div class="muted card-sub">Cases on tomorrow's trucks</div></div></div>
        <div class="table-wrap"><table class="table zone-table">
          <thead><tr><th>Zone</th><th class="num">Cases</th><th class="num">Available</th><th class="num">In progress</th>
            <th class="num">Picked</th><th>% picked</th><th class="num">Stockout</th></tr></thead>
          <tbody>${zoneRow(t, 'total-row')}${progressCache.zones.map((z) => zoneRow(z)).join('')}</tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Stockouts reported by pickers</h2>
          <div class="muted card-sub">Each one is a picker who found an empty slot. Click a code to check it.</div></div></div>
        ${stockoutsCache.length ? `<div class="table-wrap"><table class="table stockout-table">
          <thead><tr><th>Product</th><th>Code</th><th class="num">Stores</th><th class="num">Cases short</th><th>Routes</th><th>Stock now</th><th>Last report</th></tr></thead>
          <tbody>${stockoutRows}</tbody></table></div>` : '<p class="muted">No stockouts reported tonight.</p>'}
      </div>
    </div>`;
}

function renderRouteList() {
  currentRouteId = null;
  const q = $('#routes-search').value.trim().toLowerCase();
  const type = $('#routes-type').value;
  const rows = routesCache.filter((r) => (!type || r.truck_type === type) &&
    (!q || [r.route_number, r.truck_number, r.destination, r.door || ''].some((v) => v.toLowerCase().includes(q))));
  $('#routes-overview').innerHTML = overviewHtml();
  $('#routes-overview').hidden = false;
  $('#routes-toolbar').hidden = false;
  $('#routes-body').innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table class="table route-table">
          <thead><tr><th>Route</th><th>Truck</th><th>Door</th><th>Destination</th><th>Departs</th>
            <th class="num">Stops</th><th class="num">Cases</th><th>Picked</th><th>Needs attention</th></tr></thead>
          <tbody>
            ${rows.map((r) => `<tr class="route-row" data-route="${r.id}" tabindex="0" role="button" aria-label="Open route ${esc(r.route_number)}">
              <td class="truck">${esc(r.route_number)}</td>
              <td>${esc(r.truck_type)} · <span class="mono">${esc(r.truck_number)}</span></td>
              <td class="mono">${esc(r.door || '')}</td>
              <td>${esc(r.destination)}</td>
              <td class="mono">${timeOf(r.departs_at)}</td>
              <td class="num">${r.stops}</td><td class="num">${r.cases}</td>
              <td class="pct-cell">${bar(r.pct_picked)}<span class="mono">${r.pct_picked}%</span></td>
              <td>${attentionPills(r.short_lines, r.reserve_lines)}</td></tr>`).join('')
              || '<tr><td colspan="9" class="muted">No routes match.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function openRoute(id, opts = {}) {
  currentRouteId = id;
  routeDetailCache = await api(`/api/routes/${id}`);
  renderRouteDetail();
  const target = highlightStoreId && document.querySelector(`.stop-card[data-store="${highlightStoreId}"]`);
  if (target) target.scrollIntoView({ block: 'start' });
  else if (!opts.keepScroll) window.scrollTo({ top: 0 });
}

function renderRouteDetail() {
  const { route, stores } = routeDetailCache;
  const onlyAttention = $('#routes-attention') && $('#routes-attention').checked;
  const all = stores.flatMap((s) => s.lines);
  const cases = stores.reduce((n, s) => n + s.cases, 0);
  const picked = stores.reduce((n, s) => n + s.cases_picked, 0);
  const pct = cases ? Math.round((100 * picked) / cases) : 0;
  const shortLines = all.filter((l) => SHORT_STATUSES.includes(l.status)).length;
  const reserveLines = all.filter((l) => l.status === 'reserve').length;

  $('#routes-overview').hidden = true;
  $('#routes-toolbar').hidden = true;
  $('#routes-body').innerHTML = `
    <button class="btn btn-ghost back-btn" data-back>← All routes</button>
    <div class="card route-head">
      <div class="route-head-main">
        <div class="card-label">Route</div>
        <div class="route-number">${esc(route.route_number)}</div>
        <div class="muted">${esc(route.truck_type)} · truck <span class="mono">${esc(route.truck_number)}</span> · ${esc(route.destination)}</div>
      </div>
      <div class="route-facts">
        <div><div class="card-label">Door</div><div class="fact mono">${esc(route.door || '')}</div></div>
        <div><div class="card-label">Departs</div><div class="fact mono">${timeOf(route.departs_at)}</div></div>
        <div><div class="card-label">Stops</div><div class="fact">${stores.length}</div></div>
        <div><div class="card-label">Cases</div><div class="fact">${cases}</div></div>
        <div><div class="card-label">Picked</div><div class="fact">${pct}%</div>${bar(pct)}</div>
      </div>
      <div class="route-attention">${attentionPills(shortLines, reserveLines)}
        <label class="toggle"><input type="checkbox" id="routes-attention" ${onlyAttention ? 'checked' : ''}> Only lines that need attention</label>
      </div>
    </div>
    ${stores.map((s) => {
      const shown = onlyAttention ? s.lines.filter((l) => !CALM_STATUSES.includes(l.status)) : s.lines;
      return `<div class="card stop-card ${s.id === highlightStoreId ? 'highlight-stop' : ''}" data-store="${s.id}">
        <div class="stop-head">
          <span class="stop-num" aria-label="Stop ${s.stop_number}">${s.stop_number}</span>
          <div class="stop-info">
            <div class="stop-name">${esc(s.name)}</div>
            <div class="muted">${esc(s.address)} · Order <span class="mono">${esc(s.order_number)}</span></div>
            <div class="pallet">Pallet <span class="mono">${esc(palletLabel(s.sscc))}</span></div>
          </div>
          <div class="stop-totals"><span class="mono">${s.lines.length} lines · ${s.cases_picked}/${s.cases} cs picked</span>
            ${s.short_lines ? pill('bad', 'x', `${s.short_lines} short`) : ''}</div>
        </div>
        ${shown.length ? `<div class="table-wrap"><table class="table line-table">
          <thead><tr><th>Product</th><th>Code</th><th>Zone</th><th class="num">Picked / Req</th><th>Status</th><th>Picker</th></tr></thead>
          <tbody>${shown.map((l) => {
            const st = LINE_STATUS[l.status];
            return `<tr class="${SHORT_STATUSES.includes(l.status) ? 'short' : ''}">
              <td><b>${esc(l.name)}</b> <span class="muted">${esc(l.pack_size)}</span></td>
              <td><button class="code-link" data-code="${esc(l.route_code)}" title="Run a stock check on ${esc(l.route_code)}">${esc(l.route_code)}</button></td>
              <td class="mono zone">${esc(l.zone)}</td>
              <td class="num">${l.qty_picked} / ${l.cases}</td>
              <td>${pill(st.cls, st.icon, st.label)}</td>
              <td class="muted picker">${l.picker ? `<span class="mono">${esc(l.picker)}</span> · ${timeOf(l.picked_at)}` : ''}</td></tr>`;
          }).join('')}</tbody></table></div>`
          : '<p class="muted stop-empty">Nothing on this order needs attention.</p>'}
      </div>`;
    }).join('')}`;
  highlightStoreId = null;
}

$('#view-routes').addEventListener('click', (e) => {
  if (e.target.closest('[data-back]')) { renderRouteList(); window.scrollTo({ top: 0 }); return; }
  const code = e.target.closest('[data-code]');
  if (code) { checkCode(code.dataset.code); return; }
  const row = e.target.closest('[data-route]');
  if (row) openRoute(Number(row.dataset.route));
});
$('#routes-body').addEventListener('keydown', (e) => {
  const row = e.target.closest('[data-route]');
  if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openRoute(Number(row.dataset.route)); }
});
$('#routes-body').addEventListener('change', (e) => { if (e.target.id === 'routes-attention') renderRouteDetail(); });
$('#routes-search').addEventListener('input', renderRouteList);
$('#routes-type').addEventListener('change', renderRouteList);

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
$('#check-input').focus({ preventScroll: true });
