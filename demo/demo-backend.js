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
        queue_item_id: null,
      }));
    return {
      version: SEED.version,
      day: dayKey(now),
      products: SEED.products.map((p) => ({
        id: p.id, route_code: p.route_code, inventory_code: p.inventory_code,
        brand: p.brand, name: p.name, pack_size: p.pack_size, is_active: p.is_active,
        turned_off_at: p.off_time ? fmt(notFuture(at(0, p.off_time))) : null,
      })),
      locations: SEED.locations,
      inventory: SEED.inventory.map(([product_id, location_id, quantity]) => ({ product_id, location_id, quantity })),
      routes: SEED.routes.map((r) => ({ ...r, departs_at: fmt(at(r.depart_day, r.depart_time)) })),
      route_items: SEED.route_items.map(([route_id, product_id, cases]) => ({ route_id, product_id, cases })),
      checks,
      queue: [],
      nextCheckId: checks.length + 1,
      nextQueueId: 1,
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
    return state.products.find((p) => p.route_code === code) || state.products.find((p) => p.inventory_code === code);
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
        return { route_number: r.route_number, truck_type: r.truck_type, truck_number: r.truck_number, destination: r.destination, departs_at: r.departs_at, cases: ri.cases };
      })
      .sort((a, b) => (a.departs_at < b.departs_at ? -1 : 1));

    const elsewhere = stock.filter((s) => s.type !== 'pick' && s.quantity > 0);
    const pick_slot = stock.find((s) => s.type === 'pick') || null;
    const total = stock.reduce((n, s) => n + s.quantity, 0);
    const outcome = !product.is_active ? 'ALREADY_OFF' : total > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK';
    const send_to = elsewhere.length ? elsewhere : (pick_slot && pick_slot.quantity > 0 ? [pick_slot] : []);

    return { code, outcome, product: { ...product }, inventory_code, routes, stock, send_to, pick_slot, total_cases: total };
  }

  // ------------------------------------------------------------------ log & actions
  const RESULT_LABELS = { IN_STOCK: 'IN STOCK', OUT_OF_STOCK: 'OUT OF STOCK', NOT_FOUND: 'NOT FOUND', ALREADY_OFF: 'ALREADY OFF' };
  const QUEUE_STATUS = { IN_STOCK: 'in_stock', OUT_OF_STOCK: 'out_of_stock', NOT_FOUND: 'not_found', ALREADY_OFF: 'already_off' };
  const INITIAL_ACTION = { IN_STOCK: 'Location shown', OUT_OF_STOCK: 'Awaiting decision', NOT_FOUND: 'Code not found', ALREADY_OFF: 'Already turned off' };

  function startCheck(result, queueId) {
    const now = nowStr();
    const finished = result.outcome === 'NOT_FOUND' || result.outcome === 'ALREADY_OFF';
    const productId = result.product ? result.product.id : null;
    const check = {
      id: state.nextCheckId++, started_at: now, completed_at: finished ? now : null, seconds: finished ? 0 : null,
      code_entered: result.code, product_id: productId, result: RESULT_LABELS[result.outcome],
      action: INITIAL_ACTION[result.outcome], queue_item_id: queueId || null,
    };
    state.checks.push(check);
    const q = queueId && state.queue.find((x) => x.id === queueId);
    if (q) Object.assign(q, { status: QUEUE_STATUS[result.outcome], product_id: productId, check_id: check.id, updated_at: now });
    return check.id;
  }

  function finishCheck(checkId, action, complete = true) {
    const c = state.checks.find((x) => x.id === checkId);
    if (!c) return null;
    c.action = action;
    if (complete) {
      c.completed_at = nowStr();
      c.seconds = Math.round((Date.now() - parse(c.started_at)) / 1000);
    }
    return c.queue_item_id;
  }

  function setQueueStatus(queueId, status) {
    const q = queueId && state.queue.find((x) => x.id === queueId);
    if (q) Object.assign(q, { status, updated_at: nowStr() });
  }

  function turnOn(productId) {
    const p = productById(productId);
    if (!p) return false;
    p.is_active = 1;
    p.turned_off_at = null;
    const now = nowStr();
    state.checks.push({
      id: state.nextCheckId++, started_at: now, completed_at: now, seconds: null, code_entered: p.route_code,
      product_id: p.id, result: 'TURNED ON', action: 'Turned back on (delivery arrived)', queue_item_id: null,
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

  // ------------------------------------------------------------------ queue
  function listQueue() {
    return state.queue.map((q) => {
      const p = productById(q.product_id) || {};
      return { id: q.id, code: q.code, status: q.status, added_at: q.added_at, updated_at: q.updated_at, check_id: q.check_id || null,
        name: p.name || null, pack_size: p.pack_size || null };
    });
  }

  function addToQueue(codes) {
    let added = 0;
    const now = nowStr();
    (codes || []).forEach((raw) => {
      const code = normalize(raw);
      if (!code) return;
      const p = findInRouteProgram(code);
      state.queue.push({ id: state.nextQueueId++, code, product_id: p ? p.id : null, status: 'pending', added_at: now, updated_at: now, check_id: null });
      added++;
    });
    return added;
  }

  // ------------------------------------------------------------------ router (same paths as server.py)
  function route(path, body) {
    const url = new URL(path, 'http://demo.local');
    const q = Object.fromEntries(url.searchParams);
    const parts = url.pathname.split('/').filter(Boolean);

    if (body === undefined) {
      if (url.pathname === '/api/lookup') {
        const result = lookup(q.code);
        if (q.log !== '0') result.check_id = startCheck(result, q.queue_id ? Number(q.queue_id) : null);
        return result;
      }
      if (url.pathname === '/api/log') return activityLog(q.q);
      if (url.pathname === '/api/turned-off') return turnedOff();
      if (url.pathname === '/api/stats') return stats();
      if (url.pathname === '/api/queue') return listQueue();
    } else {
      if (parts[1] === 'checks' && parts.length === 4) {
        const id = Number(parts[2]);
        if (parts[3] === 'relayed') { finishCheck(id, `Sent picker to ${body.location || ''}`); return { ok: true }; }
        if (parts[3] === 'empty-slot') { setQueueStatus(finishCheck(id, 'Turned off + EMPTY SLOT confirmed'), 'empty_confirmed'); return { ok: true }; }
      }
      if (parts[1] === 'products' && parts.length === 4) {
        const id = Number(parts[2]);
        if (parts[3] === 'off') {
          const p = productById(id);
          Object.assign(p, { is_active: 0, turned_off_at: nowStr() });
          if (body.check_id) setQueueStatus(finishCheck(body.check_id, 'Turned off - waiting for EMPTY SLOT', false), 'turned_off');
          return { ok: true };
        }
        if (parts[3] === 'on') { turnOn(id); return { ok: true }; }
      }
      if (url.pathname === '/api/queue') { const added = addToQueue(body.codes); return { added, items: listQueue() }; }
      if (url.pathname === '/api/queue/clear') {
        const done = ['in_stock', 'empty_confirmed', 'not_found', 'already_off'];
        state.queue = body.only_finished ? state.queue.filter((x) => !done.includes(x.status)) : [];
        return listQueue();
      }
      if (parts[1] === 'queue' && parts[3] === 'remove') {
        state.queue = state.queue.filter((x) => x.id !== Number(parts[2]));
        return listQueue();
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
