/*
 * Browser-only stand-in for server.py + data/repository.py, used by the
 * shareable web demo. Same API paths, same answers, but the data lives in
 * this browser (localStorage) instead of SQLite.
 *
 * window.DEMO_SEED is the mock data exported by build_demo.py.
 */
(function () {
  const SEED = window.DEMO_SEED;
  const KEY = 'stockcheck-demo';

  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const parse = (s) => new Date(s.replace(' ', 'T'));
  const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const dayKey = (d) => fmt(d).slice(0, 10);

  // A seed time is "N days from today at HH:MM:SS"; rebase it onto the viewer's calendar.
  function at(dayOffset, time) {
    const d = todayStart();
    d.setDate(d.getDate() + dayOffset);
    const [h, m, s] = time.split(':').map(Number);
    d.setHours(h, m, s, 0);
    return d;
  }

  // ------------------------------------------------------------------ state
  function fresh() {
    const now = new Date();
    const notFuture = (d) => (d > now ? new Date(Math.max(todayStart(), now - 15 * 60000)) : d);
    const checks = SEED.checks
      .map((c) => ({ ...c, startDate: at(c.day, c.start) }))
      .filter((c) => c.startDate <= now)
      .map((c, i) => ({
        id: i + 1,
        started_at: fmt(c.startDate),
        completed_at: fmt(new Date(+c.startDate + c.seconds * 1000)),
        seconds: c.seconds,
        code_entered: c.code,
        product_id: c.product_id,
        result: c.result,
        action: c.action,
      }));
    return {
      version: SEED.version,
      day: dayKey(now),
      products: SEED.products.map((p) => ({
        id: p.id, route_code: p.route_code, inventory_code: p.inventory_code,
        brand: p.brand, name: p.name, pack_size: p.pack_size, is_active: p.is_active,
        turned_off_at: p.off_time ? fmt(notFuture(at(0, p.off_time))) : null,
        material_number: p.material_number, material_status: p.material_status, procurement: p.procurement,
      })),
      other_stock: SEED.other_stock.map(([product_id, stock_type, quantity, etaDay, etaTime, reference]) => ({
        product_id, stock_type, quantity, reference, eta: etaTime ? fmt(at(etaDay, etaTime)) : null,
      })),
      locations: SEED.locations,
      inventory: SEED.inventory.map(([product_id, location_id, quantity]) => ({ product_id, location_id, quantity })),
      routes: SEED.routes.map((r) => ({ ...r, departs_at: fmt(at(r.depart_day, r.depart_time)) })),
      route_items: SEED.route_items.map(([route_id, product_id, cases]) => ({ route_id, product_id, cases })),
      stores: SEED.stores.map(([id, route_id, stop_number, name, address, order_number, sscc, picker]) => ({ id, route_id, stop_number, name, address, order_number, sscc, picker })),
      // Pick times are stored as "minutes before now" so the demo always looks like tonight's picking.
      order_lines: SEED.order_lines.map(([store_id, product_id, cases, zone, qty_picked, pick_status, picker, minutesAgo]) => ({
        store_id, product_id, cases, zone, qty_picked, pick_status, picker,
        picked_at: minutesAgo == null ? null : fmt(new Date(now - minutesAgo * 60000)),
      })),
      checks,
      nextCheckId: checks.length + 1,
      welcomed: false,
    };
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      // A new day (or a new build of the demo) starts from fresh sample data.
      if (s && s.version === SEED.version && s.day === dayKey(new Date())) return s;
    } catch (_) { /* storage blocked: run from memory */ }
    return fresh();
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) { /* fine: memory only */ }
  }

  let state = load();
  const nowStr = () => fmt(new Date());
  const productById = (id) => state.products.find((p) => p.id === id);

  // ------------------------------------------------------------------ lookup
  function normalize(code) {
    code = (code || '').trim().toUpperCase().replace(/\s+/g, '');
    if (/^\d{5}$/.test(code)) code = 'RT-' + code;
    return code;
  }

  // Step 1: the route program knows products by route code (inventory code also accepted).
  function findInRouteProgram(code) {
    return state.products.find((p) => p.route_code === code)
      || state.products.find((p) => p.inventory_code === code || p.material_number === code);
  }

  const TYPE_ORDER = { pick: 0, reserve: 1, overflow: 2 };

  function lookup(raw) {
    const code = normalize(raw);
    const product = findInRouteProgram(code);
    if (!product) return { code, outcome: 'NOT_FOUND' };

    // Step 2: translate to the inventory system's code. Step 3: find stock by that code.
    const inventory_code = product.inventory_code;
    const owner = state.products.find((p) => p.inventory_code === inventory_code);
    const stock = state.inventory
      .filter((i) => i.product_id === owner.id)
      .map((i) => ({ location_id: i.location_id, type: state.locations[i.location_id], quantity: i.quantity }))
      .sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || b.quantity - a.quantity);
    const routes = state.route_items
      .filter((ri) => ri.product_id === product.id)
      .map((ri) => {
        const r = state.routes.find((x) => x.id === ri.route_id);
        return { id: r.id, route_number: r.route_number, truck_type: r.truck_type, truck_number: r.truck_number, destination: r.destination, departs_at: r.departs_at, door: r.door, cases: ri.cases };
      })
      .sort((a, b) => (a.departs_at < b.departs_at ? -1 : 1));

    const elsewhere = stock.filter((s) => s.type !== 'pick' && s.quantity > 0);
    const pick_slot = stock.find((s) => s.type === 'pick') || null;
    const total = stock.reduce((n, s) => n + s.quantity, 0);
    const outcome = !product.is_active ? 'ALREADY_OFF' : total > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK';
    const send_to = elsewhere.length ? elsewhere : (pick_slot && pick_slot.quantity > 0 ? [pick_slot] : []);

    const OTHER_ORDER = { inbound: 0, quality: 1, blocked: 2 };
    const other_stock = state.other_stock
      .filter((o) => o.product_id === product.id)
      .map(({ stock_type, quantity, eta, reference }) => ({ stock_type, quantity, eta, reference }))
      .sort((a, b) => OTHER_ORDER[a.stock_type] - OTHER_ORDER[b.stock_type]);
    return { code, outcome, product: { ...product }, inventory_code, routes, stock, send_to, pick_slot, total_cases: total, other_stock };
  }

  // ------------------------------------------------------------------ log & actions
  const RESULT_LABELS = { IN_STOCK: 'IN STOCK', OUT_OF_STOCK: 'OUT OF STOCK', NOT_FOUND: 'NOT FOUND', ALREADY_OFF: 'ALREADY OFF' };
  const INITIAL_ACTION = { IN_STOCK: 'Location shown', OUT_OF_STOCK: 'Awaiting decision', NOT_FOUND: 'Code not found', ALREADY_OFF: 'Already turned off' };

  function startCheck(result) {
    const now = nowStr();
    const finished = result.outcome === 'NOT_FOUND' || result.outcome === 'ALREADY_OFF';
    const check = {
      id: state.nextCheckId++, started_at: now, completed_at: finished ? now : null, seconds: finished ? 0 : null,
      code_entered: result.code, product_id: result.product ? result.product.id : null,
      result: RESULT_LABELS[result.outcome], action: INITIAL_ACTION[result.outcome],
    };
    state.checks.push(check);
    return check.id;
  }

  function finishCheck(checkId, action, complete = true) {
    const c = state.checks.find((x) => x.id === checkId);
    if (!c) return;
    c.action = action;
    if (complete) {
      c.completed_at = nowStr();
      c.seconds = Math.round((Date.now() - parse(c.started_at)) / 1000);
    }
  }

  function turnOn(productId) {
    const p = productById(productId);
    if (!p) return false;
    p.is_active = 1;
    p.turned_off_at = null;
    const now = nowStr();
    state.checks.push({
      id: state.nextCheckId++, started_at: now, completed_at: now, seconds: null, code_entered: p.route_code,
      product_id: p.id, result: 'TURNED ON', action: 'Turned back on (delivery arrived)',
    });
    return true;
  }

  function activityLog(search) {
    const s = (search || '').toLowerCase();
    return state.checks
      .map((c) => {
        const p = productById(c.product_id) || {};
        return { id: c.id, started_at: c.started_at, seconds: c.seconds, code_entered: c.code_entered, result: c.result, action: c.action,
          name: p.name || null, pack_size: p.pack_size || null, route_code: p.route_code || null, inventory_code: p.inventory_code || null };
      })
      .filter((r) => !s || [r.code_entered, r.name, r.inventory_code, r.result, r.action].some((v) => (v || '').toLowerCase().includes(s)))
      .sort((a, b) => (a.started_at === b.started_at ? b.id - a.id : a.started_at < b.started_at ? 1 : -1))
      .slice(0, 300);
  }

  function turnedOff() {
    const today = fmt(todayStart());
    return state.products
      .filter((p) => !p.is_active)
      .sort((a, b) => ((a.turned_off_at || '') < (b.turned_off_at || '') ? 1 : -1))
      .map((p) => ({ id: p.id, route_code: p.route_code, inventory_code: p.inventory_code, name: p.name, pack_size: p.pack_size,
        turned_off_at: p.turned_off_at, today: (p.turned_off_at || '') >= today }));
  }

  // ------------------------------------------------------------------ stats
  function stats() {
    const today = todayStart();
    const first = new Date(today); first.setDate(first.getDate() - SEED.history_days);
    const days = {};
    state.checks.forEach((c) => {
      if (c.result === 'TURNED ON') return;
      const dt = parse(c.started_at);
      if (dt < first) return;
      const d = (days[dayKey(dt)] = days[dayKey(dt)] || { hours: Array(24).fill(0), seconds: [], in_stock: 0 });
      d.hours[dt.getHours()] += 1;
      if (c.result === 'IN STOCK') d.in_stock += 1;
      if (c.seconds) d.seconds.push(c.seconds);
    });
    const ss = SEED.shift_start;
    const summarize = (key) => {
      const d = days[key] || { hours: Array(24).fill(0), seconds: [], in_stock: 0 };
      const total = d.hours.reduce((a, b) => a + b, 0);
      const firstTwo = d.hours[ss] + d.hours[ss + 1];
      return {
        date: key, total, in_stock: d.in_stock, hours: d.hours,
        avg_seconds: d.seconds.length ? Math.round(d.seconds.reduce((a, b) => a + b, 0) / d.seconds.length) : null,
        first_two_hours_share: total ? Math.round((100 * firstTwo) / total) : null,
      };
    };
    const prior = [];
    for (let n = SEED.history_days; n >= 1; n--) { const d = new Date(today); d.setDate(d.getDate() - n); prior.push(summarize(dayKey(d))); }
    const priorAvg = Array.from({ length: 24 }, (_, h) => Math.round((10 * prior.reduce((a, p) => a + p.hours[h], 0)) / prior.length) / 10);
    return { today: summarize(dayKey(today)), prior_days: prior, prior_avg_hours: priorAvg,
      shift_start_hour: ss, shift_end_hour: SEED.shift_end, current_hour: new Date().getHours() };
  }

  // ------------------------------------------------------------------ truck routes and picking (same rules as repository.py)
  function productPickStatus() {
    const status = {};
    state.products.forEach((p) => {
      const stock = state.inventory.filter((i) => i.product_id === p.id);
      const pick = stock.filter((i) => state.locations[i.location_id] === 'pick').reduce((n, i) => n + i.quantity, 0);
      const other = stock.filter((i) => state.locations[i.location_id] !== 'pick').reduce((n, i) => n + i.quantity, 0);
      status[p.id] = !p.is_active ? 'off' : pick > 0 ? 'ok' : other > 0 ? 'reserve' : 'out';
    });
    return status;
  }

  const SHORT = ['stockout', 'off', 'nostock'];
  function lineStatus(pickStatus, stock) {
    if (pickStatus === 'completed') return 'picked';
    if (pickStatus === 'in_progress') return 'picking';
    if (pickStatus === 'stockout') return 'stockout';
    return { off: 'off', out: 'nostock', reserve: 'reserve', ok: 'ready' }[stock];
  }

  function listRoutes() {
    const stock = productPickStatus();
    const storeRoute = Object.fromEntries(state.stores.map((s) => [s.id, s.route_id]));
    const totals = {};
    state.routes.forEach((r) => {
      totals[r.id] = { stops: new Set(), lines: 0, cases: 0, cases_picked: 0, short_lines: 0, reserve_lines: 0, stockout_lines: 0 };
    });
    state.order_lines.forEach((ol) => {
      const t = totals[storeRoute[ol.store_id]];
      t.stops.add(ol.store_id);
      t.lines += 1;
      t.cases += ol.cases;
      t.cases_picked += ol.qty_picked;
      const st = lineStatus(ol.pick_status, stock[ol.product_id]);
      if (SHORT.includes(st)) t.short_lines += 1;
      if (st === 'reserve') t.reserve_lines += 1;
      if (st === 'stockout') t.stockout_lines += 1;
    });
    return state.routes
      .slice()
      .sort((a, b) => (a.departs_at < b.departs_at ? -1 : 1))
      .map((r) => {
        const t = totals[r.id];
        return { ...r, ...t, stops: t.stops.size, pct_picked: t.cases ? Math.round((100 * t.cases_picked) / t.cases) : 0 };
      });
  }

  function routeDetail(routeId) {
    const route = state.routes.find((r) => r.id === routeId);
    if (!route) return null;
    const stock = productPickStatus();
    const stores = state.stores
      .filter((s) => s.route_id === routeId)
      .sort((a, b) => a.stop_number - b.stop_number)
      .map((s) => {
        const lines = state.order_lines
          .filter((ol) => ol.store_id === s.id)
          .map((ol) => {
            const p = productById(ol.product_id);
            return {
              cases: ol.cases, zone: ol.zone, qty_picked: ol.qty_picked, pick_status: ol.pick_status, picker: ol.picker,
              picked_at: ol.picked_at, product_id: p.id, route_code: p.route_code, name: p.name, pack_size: p.pack_size,
              status: lineStatus(ol.pick_status, stock[p.id]),
            };
          })
          .sort((a, b) => (a.name + a.pack_size).localeCompare(b.name + b.pack_size));
        return {
          id: s.id, stop_number: s.stop_number, name: s.name, address: s.address, order_number: s.order_number, sscc: s.sscc, picker: s.picker, lines,
          cases: lines.reduce((n, l) => n + l.cases, 0),
          cases_picked: lines.reduce((n, l) => n + l.qty_picked, 0),
          short_lines: lines.filter((l) => SHORT.includes(l.status)).length,
        };
      });
    return { route, stores };
  }

  function pickProgress() {
    const blank = (zone) => ({ zone, cases: 0, available: 0, in_progress: 0, picked: 0, stockout: 0, lines: 0 });
    const zones = { BULK: blank('BULK'), LAYER: blank('LAYER'), FULL: blank('FULL') };
    const total = blank('TOTAL');
    state.order_lines.forEach((ol) => {
      [zones[ol.zone], total].forEach((b) => {
        b.cases += ol.cases;
        b.lines += 1;
        b.picked += ol.qty_picked;
        if (ol.pick_status === 'available') b.available += ol.cases;
        else if (ol.pick_status === 'in_progress') b.in_progress += ol.cases - ol.qty_picked;
        else if (ol.pick_status === 'stockout') b.stockout += ol.cases;
      });
    });
    [...Object.values(zones), total].forEach((b) => { b.pct_picked = b.cases ? Math.round((100 * b.picked) / b.cases) : 0; });
    return { total, zones: Object.values(zones) };
  }

  function stockouts() {
    const stock = productPickStatus();
    const storeById = Object.fromEntries(state.stores.map((s) => [s.id, s]));
    const routeById = Object.fromEntries(state.routes.map((r) => [r.id, r]));
    const byProduct = {};
    state.order_lines.filter((ol) => ol.pick_status === 'stockout').forEach((ol) => {
      const p = productById(ol.product_id);
      const item = (byProduct[p.id] = byProduct[p.id] || {
        product_id: p.id, route_code: p.route_code, name: p.name, pack_size: p.pack_size, stock: stock[p.id],
        stores: 0, cases_short: 0, routes: new Set(), last_reported: '', last_picker: null,
      });
      item.stores += 1;
      item.cases_short += ol.cases;
      item.routes.add(routeById[storeById[ol.store_id].route_id].route_number);
      if ((ol.picked_at || '') > item.last_reported) { item.last_reported = ol.picked_at; item.last_picker = ol.picker; }
    });
    return Object.values(byProduct)
      .sort((a, b) => b.cases_short - a.cases_short)
      .map((i) => ({ ...i, routes: [...i.routes].sort() }));
  }

  function findPalletOrOrder(query) {
    const q = (query || '').trim().toUpperCase().replace(/\s+/g, '');
    let store;
    if (q.startsWith('SO')) {
      const number = 'SO-' + q.slice(2).replace(/^-/, '');
      store = state.stores.find((s) => s.order_number === number);
    } else {
      const digits = q.replace(/\D/g, '');
      if (digits.length >= 18) store = state.stores.find((s) => s.sscc === digits || s.sscc === '00' + digits);
    }
    return store ? { route_id: store.route_id, store_id: store.id } : null;
  }

  // ------------------------------------------------------------------ pickers (same rules as repository.py)
  function buildAssignments(onlyPicker) {
    const stock = productPickStatus();
    const routeById = Object.fromEntries(state.routes.map((r) => [r.id, r]));
    const stores = state.stores
      .filter((s) => s.picker && (!onlyPicker || s.picker === onlyPicker))
      .sort((a, b) => {
        const ra = routeById[a.route_id], rb = routeById[b.route_id];
        return ra.departs_at === rb.departs_at ? a.stop_number - b.stop_number : (ra.departs_at < rb.departs_at ? -1 : 1);
      });
    const pickers = {};
    stores.forEach((s) => {
      const r = routeById[s.route_id];
      const lines = state.order_lines
        .filter((ol) => ol.store_id === s.id)
        .map((ol) => {
          const p = productById(ol.product_id);
          return { product_id: p.id, route_code: p.route_code, name: p.name, pack_size: p.pack_size, zone: ol.zone,
            cases: ol.cases, qty_picked: ol.qty_picked, pick_status: ol.pick_status, picked_at: ol.picked_at,
            status: lineStatus(ol.pick_status, stock[p.id]) };
        })
        .sort((a, b) => (a.name + a.pack_size).localeCompare(b.name + b.pack_size));
      const left = lines.filter((l) => ['available', 'in_progress'].includes(l.pick_status) && l.status !== 'off');
      const started = lines.some((l) => l.pick_status !== 'available');
      (pickers[s.picker] = pickers[s.picker] || []).push({
        store_id: s.id, stop_number: s.stop_number, store: s.name, address: s.address, order_number: s.order_number, sscc: s.sscc,
        route_id: r.id, route_number: r.route_number, truck_type: r.truck_type, truck_number: r.truck_number, door: r.door,
        departs_at: r.departs_at, lines,
        cases: lines.reduce((n, l) => n + l.cases, 0),
        cases_picked: lines.reduce((n, l) => n + l.qty_picked, 0),
        cases_left: left.reduce((n, l) => n + l.cases - l.qty_picked, 0),
        lines_left: left.length,
        short_lines: lines.filter((l) => SHORT.includes(l.status)).length,
        order_status: !left.length ? 'done' : started ? 'picking' : 'waiting',
      });
    });
    return pickers;
  }

  function pickerSummary(picker, orders) {
    const lines = orders.flatMap((o) => o.lines);
    const times = lines.map((l) => l.picked_at).filter(Boolean).sort();
    const current = orders.find((o) => o.order_status !== 'done');
    const cases = orders.reduce((n, o) => n + o.cases, 0);
    const picked = orders.reduce((n, o) => n + o.cases_picked, 0);
    return {
      picker, orders: orders.length, orders_done: orders.filter((o) => o.order_status === 'done').length,
      lines: lines.length, lines_left: orders.reduce((n, o) => n + o.lines_left, 0),
      cases, cases_picked: picked, cases_left: orders.reduce((n, o) => n + o.cases_left, 0),
      pct_picked: cases ? Math.round((100 * picked) / cases) : 0,
      stockouts: lines.filter((l) => l.pick_status === 'stockout').length,
      last_pick: times.length ? times[times.length - 1] : null,
      current: current ? { route_id: current.route_id, route_number: current.route_number, door: current.door,
        stop_number: current.stop_number, store: current.store, store_id: current.store_id } : null,
    };
  }

  function listPickers() {
    const all = buildAssignments();
    return Object.keys(all).sort().map((p) => pickerSummary(p, all[p]));
  }

  function pickerDetail(picker) {
    const orders = buildAssignments(picker)[picker];
    return orders ? { summary: pickerSummary(picker, orders), orders } : null;
  }

  // ------------------------------------------------------------------ router (same paths as server.py)
  function route(path, body) {
    const url = new URL(path, 'http://demo.local');
    const q = Object.fromEntries(url.searchParams);
    const parts = url.pathname.split('/').filter(Boolean);

    if (body === undefined) {
      if (url.pathname === '/api/lookup') {
        const result = lookup(q.code);
        result.check_id = startCheck(result);
        return result;
      }
      if (url.pathname === '/api/log') return activityLog(q.q);
      if (url.pathname === '/api/turned-off') return turnedOff();
      if (url.pathname === '/api/stats') return stats();
      if (url.pathname === '/api/routes') return listRoutes();
      if (url.pathname === '/api/progress') return pickProgress();
      if (url.pathname === '/api/stockouts') return stockouts();
      if (url.pathname === '/api/pickers') return listPickers();
      if (parts[1] === 'pickers' && parts.length === 3) {
        const detail = pickerDetail(decodeURIComponent(parts[2]));
        if (detail) return detail;
      }
      if (url.pathname === '/api/find') {
        const found = findPalletOrOrder(q.q);
        if (found) return found;
        throw new Error('No pallet or order found');
      }
      if (parts[1] === 'routes' && parts.length === 3) {
        const detail = routeDetail(Number(parts[2]));
        if (detail) return detail;
      }
    } else {
      if (parts[1] === 'checks' && parts.length === 4) {
        const id = Number(parts[2]);
        if (parts[3] === 'relayed') { finishCheck(id, `Sent picker to ${body.location || ''}`); return { ok: true }; }
        if (parts[3] === 'empty-slot') { finishCheck(id, 'Turned off + EMPTY SLOT confirmed'); return { ok: true }; }
      }
      if (parts[1] === 'products' && parts.length === 4) {
        const id = Number(parts[2]);
        if (parts[3] === 'off') {
          Object.assign(productById(id), { is_active: 0, turned_off_at: nowStr() });
          if (body.check_id) finishCheck(body.check_id, 'Turned off - waiting for EMPTY SLOT', false);
          return { ok: true };
        }
        if (parts[3] === 'on') { turnOn(id); return { ok: true }; }
      }
    }
    throw new Error('Not found: ' + url.pathname);
  }

  // app.js calls this instead of fetch() when it exists.
  window.demoApi = async function (path, body) {
    const out = route(path, body);
    save();
    return JSON.parse(JSON.stringify(out));
  };

  window.demoReset = function () { state = fresh(); state.welcomed = true; save(); };

  // True only the first time this browser opens the demo today.
  window.demoFirstVisit = function () {
    if (state.welcomed) return false;
    state.welcomed = true;
    save();
    return true;
  };
})();
