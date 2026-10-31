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
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
};
// One icon set, one stroke.
Object.keys(ICON).forEach((k) => { ICON[k] = ICON[k].replace(/stroke-width="[\d.]+"/, 'stroke-width="1.5"'); });

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

// Material record status (from the stock system's material master).
const MATERIAL_STATUS = {
  'Active':           { cls: 'good', icon: 'check' },
  'Costing complete': { cls: 'info', icon: 'check' },
  'Costing required': { cls: 'warn', icon: 'question' },
  'BOM required':     { cls: 'warn', icon: 'question' },
  'Inactive':         { cls: 'bad',  icon: 'x' },
};
// Stock that exists but can't be picked.
const OTHER_STOCK = {
  inbound: { label: 'Inbound',        cls: 'info', icon: 'clock' },
  quality: { label: 'Quality hold',   cls: 'warn', icon: 'power' },
  blocked: { label: 'Blocked',        cls: 'warn', icon: 'power' },
};
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
  if (name === 'pickers') loadPickers();
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
    const [s, off, routes, pickers] = await Promise.all([
      apiCall('/api/stats'), apiCall('/api/turned-off'), apiCall('/api/routes'), apiCall('/api/pickers')]);
    $('#pickers-count').textContent = pickers.length;
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

const LOC_TYPE = { pick: 'Pick slot', reserve: 'Reserve', overflow: 'Overflow' };

// Signature: a location code with a strip of yellow rack tape.
const locChip = (id, empty = false) => `<span class="loc${empty ? ' empty' : ''}">${esc(id)}</span>`;

// A decorative barcode drawn from the location code (it looks like a rack label, it isn't a real symbology).
function barcodeSvg(text) {
  const widths = [2, 1, 1, 2];
  [...text].forEach((ch) => {
    const n = ch.charCodeAt(0) * 7 + 13;
    widths.push((n % 3) + 1, ((n >> 2) % 2) + 1, ((n >> 3) % 3) + 1, ((n >> 1) % 2) + 1, ((n >> 4) % 3) + 1, 1);
  });
  widths.push(2, 3, 1, 1);
  let x = 0;
  const bars = widths.map((w, i) => { const r = i % 2 === 0 ? `<rect x="${x}" width="${w}" height="40"/>` : ''; x += w; return r; }).join('');
  return `<svg viewBox="0 0 ${x} 40" preserveAspectRatio="none" fill="currentColor" aria-hidden="true">${bars}</svg>`;
}

// The moment: where to send the picker, drawn as the label on the rack beam.
function rackLabel(s) {
  return `<div class="rack-label">
    <div class="rack-loc">${esc(s.location_id)}</div>
    <div class="rack-meta"><span>${LOC_TYPE[s.type]}</span><span><b>${s.quantity}</b> cases</span></div>
    <div class="rack-barcode">${barcodeSvg(s.location_id)}<span>${esc(s.location_id.replace(/-/g, ''))}</span></div>
  </div>`;
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
          <td>${r.door ? locChip(r.door) : ''}</td><td>${esc(r.destination)}</td><td>${timeOf(r.departs_at)}</td><td class="num">${r.cases}</td></tr>`).join('')}
      </tbody></table>`
    : '<p class="muted">Not on any of tomorrow\'s routes</p>';
  const stock = `<table class="table"><thead><tr><th>Location</th><th>Type</th><th class="num">Cases</th></tr></thead><tbody>
      ${d.stock.map((s) => `<tr class="${s.quantity === 0 ? 'zero' : (s.type !== 'pick' ? 'highlight' : '')}">
        <td>${locChip(s.location_id, s.quantity === 0)}</td><td>${LOC_TYPE[s.type]}</td>
        <td class="num">${s.quantity === 0 ? '0 (empty)' : s.quantity}</td></tr>`).join('')}
      <tr><td colspan="2"><b>Pickable in building</b></td><td class="num"><b>${d.total_cases}</b></td></tr>
    </tbody></table>`;
  const other = (d.other_stock || []).length
    ? `<h3 class="section-title held-title">Not pickable yet</h3>
      <table class="table"><thead><tr><th>Stock type</th><th>Details</th><th class="num">Cases</th></tr></thead><tbody>
        ${d.other_stock.map((o) => `<tr><td>${pill(OTHER_STOCK[o.stock_type].cls, OTHER_STOCK[o.stock_type].icon, OTHER_STOCK[o.stock_type].label)}</td>
          <td>${esc(o.reference || '')}${o.eta ? ` · expected <b>${whenOf(o.eta)}</b>` : ''}</td><td class="num">${o.quantity}</td></tr>`).join('')}
      </tbody></table>`
    : '';
  const ms = MATERIAL_STATUS[p.material_status] || MATERIAL_STATUS.Active;
  return `
    <div class="product-line"><span class="product-name">${esc(p.name)}</span><span class="product-pack">${esc(p.pack_size)}</span></div>
    <div class="codes">
      <div class="code-chip"><small>Route program code</small><span class="mono">${esc(p.route_code)}</span></div>
      <div class="code-chip"><small>Inventory system code</small><span class="mono">${esc(d.inventory_code)}</span></div>
      <div class="code-chip"><small>Material number</small><span class="mono">${esc(p.material_number || '')}</span></div>
      <div class="code-chip"><small>Material status</small>${pill(ms.cls, ms.icon, p.material_status)}</div>
      <div class="code-chip"><small>Procurement</small><span class="chip-text">${esc(p.procurement || '')}</span></div>
    </div>
    <div class="lookup-steps">Looked up automatically: route program, inventory code, material record, then reserve, overflow, holds and inbound stock</div>
    <div class="two-col">
      <div><h3 class="section-title">Tomorrow's routes (${d.routes.length})</h3><div class="table-wrap">${routes}</div></div>
      <div><h3 class="section-title">Warehouse inventory</h3><div class="table-wrap">${stock}${other}</div></div>
    </div>`;
}

// Advice drawn from the material record and from stock that can't be picked yet.
function adviceHtml(d) {
  const notes = [];
  const p = d.product;
  const inbound = (d.other_stock || []).filter((o) => o.stock_type === 'inbound');
  const held = (d.other_stock || []).filter((o) => o.stock_type !== 'inbound');
  if (p.material_status === 'Inactive') {
    notes.push(['bad', 'x', '<b>Material is inactive.</b> No more deliveries are expected for this item, so turn it off rather than waiting.']);
  } else if (['Costing required', 'BOM required'].includes(p.material_status)) {
    notes.push(['warn', 'question', `<b>Material not fully set up (${esc(p.material_status.toLowerCase())}).</b> Stock may not be receivable yet. Let inventory control know.`]);
  }
  inbound.forEach((o) => notes.push(['info', 'clock',
    `<b>${o.quantity} cases inbound</b> (${esc(o.reference || 'inbound load')}), expected <b>${whenOf(o.eta)}</b>. ` +
    (p.is_active ? 'Turn it off for now, then back on once it is received.' : 'Turn it back on once it is received.')]));
  held.forEach((o) => notes.push(['warn', 'power',
    `<b>${o.quantity} cases ${o.stock_type === 'quality' ? 'on quality hold' : 'blocked'}</b> (${esc(o.reference || '')}). They can't be picked unless released.`]));
  return notes.map(([cls, icon, text]) => `<div class="advice ${cls}">${ICON[icon]}<span>${text}</span></div>`).join('');
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
    container.innerHTML = `<div class="result">${verdictHtml('neutral', 'question', 'Code not found',
      `<span class="mono">${esc(d.code)}</span> is not in the route program. Ask the picker to read the code again.`)}</div>`;
    return;
  }

  if (d.outcome === 'IN_STOCK') {
    const first = d.send_to[0];
    const inPickOnly = first && first.type === 'pick';
    top = verdictHtml('good', 'check', 'In stock', `${d.total_cases} cases in the building`);
    const [main, ...more] = d.send_to;
    actions = `
      <div class="send-to">
        <div class="send-to-label">Send picker to</div>
        ${rackLabel(main)}
        ${more.length ? `<div class="send-more"><span>Also</span>${more.map((s) =>
          `<span>${locChip(s.location_id)} ${s.quantity} cases · ${LOC_TYPE[s.type]}</span>`).join('')}</div>` : ''}
        ${inPickOnly ? `<div class="send-note">${ICON.alert}<span>System shows stock in the pick slot itself. Have the picker recheck the slot, including behind and under it</span></div>` : ''}
      </div>
      ${adviceHtml(d)}
      ${stage === 'relayed'
        ? `<div class="done-banner">${ICON.check} Location relayed to picker</div>`
        : `<div class="action-row"><button class="btn btn-good btn-lg" data-act="relayed">${ICON.check} Told picker: done</button>
             <span class="muted">Checking the next code also marks this as done</span></div>`}`;
  }

  if (d.outcome === 'OUT_OF_STOCK' || stage === 'turned_off' || stage === 'empty_done') {
    if (stage === 'decide') {
      top = verdictHtml('bad', 'x', 'Out of stock', 'No pickable product in pick slot, reserve or overflow');
      actions = `${adviceHtml(d)}<div class="action-row"><button class="btn btn-danger btn-lg" data-act="off">${ICON.power} Turn off product</button></div>`;
    } else if (stage === 'turned_off') {
      top = verdictHtml('bad', 'power', 'Turned off', 'Product is now off in the route program');
      actions = `<div class="reminder"><span class="icon">${ICON.headset}</span>
          <div class="reminder-text">Tell the picker to say <b>EMPTY SLOT</b> in their headset.</div>
          <button class="btn btn-good btn-lg" data-act="empty" data-primary>${ICON.check} Picker said it: mark done</button></div>`;
    } else {
      top = verdictHtml('bad', 'power', 'Turned off', 'Product is off in the route program and the headset system');
      actions = `<div class="done-banner">${ICON.headset} EMPTY SLOT confirmed. No other picker will be sent to this slot.</div>`;
    }
  }

  if (stage === 'already_off') {
    const at = d.product.turned_off_at ? `at ${whenOf(d.product.turned_off_at)}` : '';
    top = verdictHtml('neutral', 'power', 'Already turned off', `This product was turned off ${at}`);
    actions = `<div class="reminder"><span class="icon">${ICON.headset}</span>
        <div class="reminder-text">If the headset still sent the picker here, have them say <b>EMPTY SLOT</b>.</div></div>
      ${adviceHtml(d)}
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
        container.innerHTML = `<div class="done-banner">${ICON.power} ${esc(d.product.name)} · ${esc(d.product.pack_size)} is back on in the route program</div>`;
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
      $('#check-result').innerHTML = `<div class="result">${verdictHtml('neutral', 'question', 'Not found',
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
          <tbody>${stockoutRows}</tbody></table></div>` : '<p class="muted">No stockouts reported tonight</p>'}
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
              <td>${r.door ? locChip(r.door) : ''}</td>
              <td>${esc(r.destination)}</td>
              <td class="mono">${timeOf(r.departs_at)}</td>
              <td class="num">${r.stops}</td><td class="num">${r.cases}</td>
              <td class="pct-cell">${bar(r.pct_picked)}<span class="mono">${r.pct_picked}%</span></td>
              <td>${attentionPills(r.short_lines, r.reserve_lines)}</td></tr>`).join('')
              || '<tr><td colspan="9" class="muted">No routes match</td></tr>'}
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
    <button class="btn btn-ghost back-btn" data-back>${ICON.back} All routes</button>
    <div class="card route-head">
      <div class="route-head-main">
        <div class="card-label">Route</div>
        <div class="route-number">${esc(route.route_number)}</div>
        <div class="muted">${esc(route.truck_type)} · truck <span class="mono">${esc(route.truck_number)}</span> · ${esc(route.destination)}</div>
      </div>
      <div class="route-facts">
        <div><div class="card-label">Door</div><div class="fact">${route.door ? locChip(route.door) : ''}</div></div>
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
            <div class="pallet">Pallet <span class="mono">${esc(palletLabel(s.sscc))}</span> ·
              ${s.picker ? `Picker <button class="code-link small" data-picker="${esc(s.picker)}" title="See ${esc(s.picker)}'s assignment">${esc(s.picker)}</button>` : 'Not released to a picker yet'}</div>
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
          : '<p class="muted stop-empty">Nothing on this order needs attention</p>'}
      </div>`;
    }).join('')}`;
  highlightStoreId = null;
}

$('#view-routes').addEventListener('click', (e) => {
  if (e.target.closest('[data-back]')) { renderRouteList(); window.scrollTo({ top: 0 }); return; }
  const picker = e.target.closest('[data-picker]');
  if (picker) { goToPicker(picker.dataset.picker); return; }
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

// ---------------------------------------------------------------- PICKERS view
// Each picker's assignment: the store orders they've been given, in pick order, what's left,
// and which truck, door and stop every order belongs to.
let pickersCache = [];
let currentPickerId = null;
let pickerDetailCache = null;

const ORDER_STATUS = {
  done:    { label: 'Done',        cls: 'good',    icon: 'check' },
  picking: { label: 'Picking now', cls: 'info',    icon: 'clock' },
  waiting: { label: 'Up next',     cls: 'neutral', icon: 'clock' },
};
const LEFT_STATUSES = ['ready', 'reserve', 'picking', 'nostock'];

function goToPicker(id) {
  currentPickerId = id;
  showView('pickers');
}

async function loadPickers() {
  pickersCache = await api('/api/pickers');
  const left = pickersCache.reduce((n, p) => n + p.cases_left, 0);
  $('#pickers-title-count').textContent = `${pickersCache.length} on the floor · ${left.toLocaleString()} cases left`;
  if (currentPickerId) await openPicker(currentPickerId);
  else renderPickerList();
}

const whereText = (c) => `Route ${esc(c.route_number)} · ${esc(c.door || '')} · Stop ${c.stop_number}`;

function renderPickerList() {
  currentPickerId = null;
  $('#pickers-body').innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table class="table picker-table">
          <thead><tr><th>Picker</th><th class="num">Orders done</th><th>Picked</th><th class="num">Cases left</th>
            <th class="num">Lines left</th><th class="num">Stockouts</th><th>Working on now</th><th>Last pick</th></tr></thead>
          <tbody>
            ${pickersCache.map((p) => `<tr class="route-row" data-picker-row="${esc(p.picker)}" tabindex="0" role="button" aria-label="Open picker ${esc(p.picker)}">
              <td class="truck">${esc(p.picker)}</td>
              <td class="num">${p.orders_done} / ${p.orders}</td>
              <td class="pct-cell">${bar(p.pct_picked)}<span class="mono">${p.pct_picked}%</span></td>
              <td class="num">${p.cases_left}</td>
              <td class="num">${p.lines_left}</td>
              <td class="num">${p.stockouts ? `<span class="bad-text">${p.stockouts}</span>` : '0'}</td>
              <td>${p.current ? `<span class="mono now-where">${whereText(p.current)}</span><div class="muted now-store">${esc(p.current.store)}</div>` : pill('good', 'check', 'All orders done')}</td>
              <td class="mono muted">${p.last_pick ? timeOf(p.last_pick) : ''}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <p class="muted pickers-note">Orders on the last trucks of the night haven't been released to pickers yet, so they aren't listed here.</p>`;
}

async function openPicker(id) {
  currentPickerId = id;
  pickerDetailCache = await api(`/api/pickers/${encodeURIComponent(id)}`);
  renderPickerDetail();
  window.scrollTo({ top: 0 });
}

function renderPickerDetail() {
  const { summary: s, orders } = pickerDetailCache;
  const onlyLeft = $('#picker-left') && $('#picker-left').checked;
  $('#pickers-body').innerHTML = `
    <button class="btn btn-ghost back-btn" data-picker-back>${ICON.back} All pickers</button>
    <div class="card route-head">
      <div class="route-head-main">
        <div class="card-label">Picker</div>
        <div class="route-number">${esc(s.picker)}</div>
        <div class="muted">${s.current
          ? `Working on <button class="code-link" data-open-route="${s.current.route_id}" data-store="${s.current.store_id}">${whereText(s.current)}</button> · ${esc(s.current.store)}`
          : 'All assigned orders are done'}</div>
      </div>
      <div class="route-facts">
        <div><div class="card-label">Orders done</div><div class="fact">${s.orders_done} / ${s.orders}</div></div>
        <div><div class="card-label">Cases left</div><div class="fact">${s.cases_left}</div></div>
        <div><div class="card-label">Lines left</div><div class="fact">${s.lines_left}</div></div>
        <div><div class="card-label">Stockouts</div><div class="fact">${s.stockouts}</div></div>
        <div><div class="card-label">Picked</div><div class="fact">${s.pct_picked}%</div>${bar(s.pct_picked)}</div>
      </div>
      <div class="route-attention">
        <span class="muted">${s.cases_picked} of ${s.cases} cases picked${s.last_pick ? ` · last pick ${timeOf(s.last_pick)}` : ''}</span>
        <label class="toggle"><input type="checkbox" id="picker-left" ${onlyLeft ? 'checked' : ''}> Only what's left to pick</label>
      </div>
    </div>
    ${orders.map((o, i) => {
      const st = ORDER_STATUS[o.order_status];
      const shown = onlyLeft ? o.lines.filter((l) => LEFT_STATUSES.includes(l.status)) : o.lines;
      if (onlyLeft && !shown.length) return '';
      return `<div class="card stop-card ${o.order_status === 'picking' ? 'highlight-stop' : ''}">
        <div class="stop-head">
          <span class="stop-num" aria-label="Order ${i + 1} of ${orders.length}">${i + 1}</span>
          <div class="stop-info">
            <div class="stop-name">${esc(o.store)}</div>
            <div class="truck-link"><button class="code-link" data-open-route="${o.route_id}" data-store="${o.store_id}"
              title="Open this stop on route ${esc(o.route_number)}">Route ${esc(o.route_number)} · ${esc(o.door || '')} · Stop ${o.stop_number}</button>
              <span class="muted">· ${esc(o.truck_type)} · truck <span class="mono">${esc(o.truck_number)}</span> · departs ${timeOf(o.departs_at)}</span></div>
            <div class="pallet">Order <span class="mono">${esc(o.order_number)}</span> · Pallet <span class="mono">${esc(palletLabel(o.sscc))}</span></div>
          </div>
          <div class="stop-totals">${pill(st.cls, st.icon, st.label)}
            <span class="mono">${o.lines_left ? `${o.lines_left} lines · ${o.cases_left} cs left` : `${o.cases_picked}/${o.cases} cs`}</span>
            ${o.short_lines ? pill('bad', 'x', `${o.short_lines} short`) : ''}</div>
        </div>
        <div class="table-wrap"><table class="table line-table">
          <thead><tr><th>Product</th><th>Code</th><th>Zone</th><th class="num">Picked / Req</th><th>Status</th><th>Picked at</th></tr></thead>
          <tbody>${shown.map((l) => {
            const ls = LINE_STATUS[l.status];
            return `<tr class="${SHORT_STATUSES.includes(l.status) ? 'short' : ''}">
              <td><b>${esc(l.name)}</b> <span class="muted">${esc(l.pack_size)}</span></td>
              <td><button class="code-link" data-code="${esc(l.route_code)}" title="Run a stock check on ${esc(l.route_code)}">${esc(l.route_code)}</button></td>
              <td class="mono zone">${esc(l.zone)}</td>
              <td class="num">${l.qty_picked} / ${l.cases}</td>
              <td>${pill(ls.cls, ls.icon, ls.label)}</td>
              <td class="muted picker">${l.picked_at && l.pick_status !== 'available' ? timeOf(l.picked_at) : ''}</td></tr>`;
          }).join('')}</tbody></table></div>
      </div>`;
    }).join('') || '<p class="muted">Nothing left to pick</p>'}`;
}

$('#view-pickers').addEventListener('click', (e) => {
  if (e.target.closest('[data-picker-back]')) { renderPickerList(); window.scrollTo({ top: 0 }); return; }
  const route = e.target.closest('[data-open-route]');
  if (route) { goToRoute(Number(route.dataset.openRoute), Number(route.dataset.store) || null); return; }
  const code = e.target.closest('[data-code]');
  if (code) { checkCode(code.dataset.code); return; }
  const row = e.target.closest('[data-picker-row]');
  if (row) openPicker(row.dataset.pickerRow);
});
$('#view-pickers').addEventListener('keydown', (e) => {
  const row = e.target.closest('[data-picker-row]');
  if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPicker(row.dataset.pickerRow); }
});
$('#view-pickers').addEventListener('change', (e) => { if (e.target.id === 'picker-left') renderPickerDetail(); });

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
    : '<p class="muted">No products are turned off</p>';

  $('#log-body').innerHTML = log.map((r) => {
    const rp = RESULT_PILL[r.result] || { cls: 'neutral', icon: 'question' };
    return `<tr><td>${whenOf(r.started_at)}</td>
      <td>${r.name ? `<b>${esc(r.name)}</b><br><span class="muted">${esc(r.pack_size)}</span>` : '<span class="muted">Unknown code</span>'}</td>
      <td class="mono">${esc(r.code_entered)}</td><td>${pill(rp.cls, rp.icon, r.result.charAt(0) + r.result.slice(1).toLowerCase())}</td>
      <td>${esc(r.action)}</td><td class="num">${duration(r.seconds)}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">No matching checks</td></tr>';
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
        <stop offset="0" style="stop-color: var(--accent-soft)"/><stop offset="1" style="stop-color: var(--accent-soft); stop-opacity: 0"/>
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
