"""
Data layer: the ONLY place in the app that reads or writes the database.

The web server calls these plain functions and gets back plain Python
dicts/lists. If this prototype were ever pointed at different data, only
this file would change.
"""
import os
import sqlite3
from datetime import datetime, timedelta

from . import seed as seed_module

DB_PATH = seed_module.DB_PATH


def _now():
    return datetime.now()


def _fmt(dt):
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _parse(s):
    return datetime.strptime(s, "%Y-%m-%d %H:%M:%S")


def _today_start():
    return _now().replace(hour=0, minute=0, second=0, microsecond=0)


def _connect():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_database():
    """Create and seed the database the first time the app runs."""
    if not os.path.exists(DB_PATH):
        seed_module.seed()
        return
    # A database made by an older version (before truck routes had stores) is rebuilt.
    conn = sqlite3.connect(DB_PATH)
    try:
        has_stores = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='stores'").fetchone()
    finally:
        conn.close()
    if not has_stores:
        seed_module.seed()


def reset_demo_data():
    return seed_module.seed()


# ---------------------------------------------------------------------------
# The three-step lookup (replaces copy/paste between two systems)
# ---------------------------------------------------------------------------

def _normalize_code(code):
    code = (code or "").strip().upper().replace(" ", "")
    if code.isdigit() and len(code) == 5:
        code = "RT-" + code          # allow typing just the 5 digits
    return code


def _find_product_in_route_program(conn, code):
    """Step 1: the route program knows products by their route code."""
    row = conn.execute("SELECT * FROM products WHERE route_code = ?", (code,)).fetchone()
    if row is None:
        # Forgiving: also accept the inventory code if that's what was scanned.
        row = conn.execute("SELECT * FROM products WHERE inventory_code = ?", (code,)).fetchone()
    return row


def _routes_for_product(conn, product_id):
    rows = conn.execute(
        """SELECT r.id, r.route_number, r.truck_type, r.truck_number, r.destination, r.departs_at, ri.cases
           FROM route_items ri JOIN routes r ON r.id = ri.route_id
           WHERE ri.product_id = ? ORDER BY r.departs_at""",
        (product_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def _translate_to_inventory_code(conn, route_code):
    """Step 2: the inventory site uses its own internal code."""
    row = conn.execute("SELECT inventory_code FROM products WHERE route_code = ?", (route_code,)).fetchone()
    return row["inventory_code"] if row else None


def _stock_by_inventory_code(conn, inventory_code):
    """Step 3: where is the product physically in the building?"""
    rows = conn.execute(
        """SELECT i.location_id, l.type, i.quantity
           FROM inventory i
           JOIN locations l ON l.id = i.location_id
           JOIN products p ON p.id = i.product_id
           WHERE p.inventory_code = ?
           ORDER BY CASE l.type WHEN 'pick' THEN 0 WHEN 'reserve' THEN 1 ELSE 2 END, i.quantity DESC""",
        (inventory_code,),
    ).fetchall()
    return [dict(r) for r in rows]


def lookup(code):
    code = _normalize_code(code)
    conn = _connect()
    try:
        product = _find_product_in_route_program(conn, code)
        if product is None:
            return {"code": code, "outcome": "NOT_FOUND"}

        product = dict(product)
        inventory_code = _translate_to_inventory_code(conn, product["route_code"])
        stock = _stock_by_inventory_code(conn, inventory_code)
        routes = _routes_for_product(conn, product["id"])

        elsewhere = [s for s in stock if s["type"] != "pick" and s["quantity"] > 0]
        pick_slot = next((s for s in stock if s["type"] == "pick"), None)
        total = sum(s["quantity"] for s in stock)

        if not product["is_active"]:
            outcome = "ALREADY_OFF"
        elif total > 0:
            outcome = "IN_STOCK"
        else:
            outcome = "OUT_OF_STOCK"

        # Where to send the picker: reserve/overflow first; if the system only
        # shows stock in the pick slot itself, the slot needs a recheck.
        send_to = elsewhere or ([pick_slot] if pick_slot and pick_slot["quantity"] > 0 else [])

        return {
            "code": code,
            "outcome": outcome,
            "product": product,
            "inventory_code": inventory_code,
            "routes": routes,
            "stock": stock,
            "send_to": send_to,
            "pick_slot": pick_slot,
            "total_cases": total,
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Activity log / actions
# ---------------------------------------------------------------------------

RESULT_LABELS = {
    "IN_STOCK": "IN STOCK",
    "OUT_OF_STOCK": "OUT OF STOCK",
    "NOT_FOUND": "NOT FOUND",
    "ALREADY_OFF": "ALREADY OFF",
}

def start_check(lookup_result):
    """Record a check the moment it's looked up. Returns the new check id."""
    outcome = lookup_result["outcome"]
    product_id = lookup_result.get("product", {}).get("id") if lookup_result.get("product") else None
    now = _fmt(_now())
    initial_action = {
        "IN_STOCK": "Location shown",
        "OUT_OF_STOCK": "Awaiting decision",
        "NOT_FOUND": "Code not found",
        "ALREADY_OFF": "Already turned off",
    }[outcome]
    finished = outcome in ("NOT_FOUND", "ALREADY_OFF")

    conn = _connect()
    try:
        cur = conn.execute(
            """INSERT INTO checks (started_at, completed_at, seconds, code_entered, product_id, result, action)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (now, now if finished else None, 0 if finished else None, lookup_result["code"],
             product_id, RESULT_LABELS[outcome], initial_action),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def _finish_check(conn, check_id, action, complete=True):
    row = conn.execute("SELECT started_at FROM checks WHERE id = ?", (check_id,)).fetchone()
    if row is None:
        return
    now = _now()
    if complete:
        secs = int((now - _parse(row["started_at"])).total_seconds())
        conn.execute("UPDATE checks SET action = ?, completed_at = ?, seconds = ? WHERE id = ?",
                     (action, _fmt(now), secs, check_id))
    else:
        conn.execute("UPDATE checks SET action = ? WHERE id = ?", (action, check_id))


def mark_location_relayed(check_id, location_text):
    conn = _connect()
    try:
        _finish_check(conn, check_id, f"Sent picker to {location_text}")
        conn.commit()
    finally:
        conn.close()


def turn_off_product(product_id, check_id=None):
    now = _fmt(_now())
    conn = _connect()
    try:
        conn.execute("UPDATE products SET is_active = 0, turned_off_at = ? WHERE id = ?", (now, product_id))
        if check_id:
            _finish_check(conn, check_id, "Turned off - waiting for EMPTY SLOT", complete=False)
        conn.commit()
    finally:
        conn.close()


def confirm_empty_slot(check_id):
    conn = _connect()
    try:
        _finish_check(conn, check_id, "Turned off + EMPTY SLOT confirmed")
        conn.commit()
    finally:
        conn.close()


def turn_on_product(product_id):
    now = _fmt(_now())
    conn = _connect()
    try:
        product = conn.execute("SELECT route_code FROM products WHERE id = ?", (product_id,)).fetchone()
        if product is None:
            return False
        conn.execute("UPDATE products SET is_active = 1, turned_off_at = NULL WHERE id = ?", (product_id,))
        conn.execute(
            """INSERT INTO checks (started_at, completed_at, seconds, code_entered, product_id, result, action)
               VALUES (?, ?, NULL, ?, ?, 'TURNED ON', 'Turned back on (delivery arrived)')""",
            (now, now, product["route_code"], product_id),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def activity_log(search="", limit=300):
    sql = """SELECT c.id, c.started_at, c.seconds, c.code_entered, c.result, c.action,
                    p.name, p.pack_size, p.route_code, p.inventory_code
             FROM checks c LEFT JOIN products p ON p.id = c.product_id"""
    params = []
    if search:
        like = f"%{search}%"
        sql += """ WHERE c.code_entered LIKE ? OR p.name LIKE ? OR p.inventory_code LIKE ?
                   OR c.result LIKE ? OR c.action LIKE ?"""
        params = [like] * 5
    sql += " ORDER BY c.started_at DESC, c.id DESC LIMIT ?"
    params.append(limit)
    conn = _connect()
    try:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


def turned_off_products():
    conn = _connect()
    try:
        rows = conn.execute(
            """SELECT id, route_code, inventory_code, name, pack_size, turned_off_at
               FROM products WHERE is_active = 0 ORDER BY turned_off_at DESC"""
        ).fetchall()
    finally:
        conn.close()
    today = _fmt(_today_start())
    return [dict(r, today=(r["turned_off_at"] or "") >= today) for r in rows]


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

def stats():
    today = _today_start()
    first_day = today - timedelta(days=seed_module.HISTORY_DAYS)
    conn = _connect()
    try:
        rows = conn.execute(
            """SELECT started_at, seconds, result FROM checks
               WHERE result != 'TURNED ON' AND started_at >= ?""",
            (_fmt(first_day),),
        ).fetchall()
    finally:
        conn.close()

    days = {}
    for r in rows:
        dt = _parse(r["started_at"])
        d = days.setdefault(dt.date().isoformat(), {"hours": [0] * 24, "seconds": [], "in_stock": 0})
        d["hours"][dt.hour] += 1
        d["in_stock"] += r["result"] == "IN STOCK"
        if r["seconds"]:
            d["seconds"].append(r["seconds"])

    today_key = today.date().isoformat()
    shift_start = seed_module.SHIFT_START_HOUR

    def summarize(key):
        d = days.get(key, {"hours": [0] * 24, "seconds": [], "in_stock": 0})
        total = sum(d["hours"])
        first_two = d["hours"][shift_start] + d["hours"][shift_start + 1]
        return {
            "date": key,
            "total": total,
            "in_stock": d["in_stock"],
            "hours": d["hours"],
            "avg_seconds": round(sum(d["seconds"]) / len(d["seconds"])) if d["seconds"] else None,
            "first_two_hours_share": round(100 * first_two / total) if total else None,
        }

    prior_keys = [(today - timedelta(days=n)).date().isoformat() for n in range(seed_module.HISTORY_DAYS, 0, -1)]
    prior = [summarize(k) for k in prior_keys]
    prior_avg_hours = [round(sum(p["hours"][h] for p in prior) / len(prior), 1) for h in range(24)] if prior else [0] * 24

    return {
        "today": summarize(today_key),
        "prior_days": prior,
        "prior_avg_hours": prior_avg_hours,
        "shift_start_hour": shift_start,
        "shift_end_hour": seed_module.SHIFT_END_HOUR,
        "current_hour": _now().hour,
    }


# ---------------------------------------------------------------------------
# Truck routes and store orders
# ---------------------------------------------------------------------------

def _product_pick_status(conn):
    """Where each product can be picked from right now.

    ok       - stock in its pick slot
    reserve  - pick slot empty, stock in reserve/overflow (picker must be sent there)
    out      - no stock anywhere, but still on in the route program
    off      - turned off in the route program (will ship short)
    """
    rows = conn.execute(
        """SELECT p.id, p.is_active,
                  COALESCE(SUM(CASE WHEN l.type = 'pick' THEN i.quantity END), 0) AS pick_qty,
                  COALESCE(SUM(CASE WHEN l.type != 'pick' THEN i.quantity END), 0) AS other_qty
           FROM products p
           LEFT JOIN inventory i ON i.product_id = p.id
           LEFT JOIN locations l ON l.id = i.location_id
           GROUP BY p.id"""
    ).fetchall()
    status = {}
    for r in rows:
        if not r["is_active"]:
            status[r["id"]] = "off"
        elif r["pick_qty"] > 0:
            status[r["id"]] = "ok"
        elif r["other_qty"] > 0:
            status[r["id"]] = "reserve"
        else:
            status[r["id"]] = "out"
    return status


def list_routes():
    """Tomorrow's trucks with stop, line and case totals and how many lines need attention."""
    conn = _connect()
    try:
        status = _product_pick_status(conn)
        routes = [dict(r) for r in conn.execute("SELECT * FROM routes ORDER BY departs_at")]
        lines = conn.execute(
            """SELECT s.route_id, s.id AS store_id, ol.product_id, ol.cases
               FROM order_lines ol JOIN stores s ON s.id = ol.store_id"""
        ).fetchall()
    finally:
        conn.close()
    by_route = {r["id"]: r for r in routes}
    for r in routes:
        r.update(stops=set(), lines=0, cases=0, short_lines=0, reserve_lines=0)
    for ln in lines:
        r = by_route[ln["route_id"]]
        r["stops"].add(ln["store_id"])
        r["lines"] += 1
        r["cases"] += ln["cases"]
        st = status[ln["product_id"]]
        r["short_lines"] += st in ("off", "out")
        r["reserve_lines"] += st == "reserve"
    for r in routes:
        r["stops"] = len(r["stops"])
    return routes


def route_detail(route_id):
    """One truck: its stops in delivery order, and every line on each store's order."""
    conn = _connect()
    try:
        route = conn.execute("SELECT * FROM routes WHERE id = ?", (route_id,)).fetchone()
        if route is None:
            return None
        status = _product_pick_status(conn)
        stores = [dict(s) for s in conn.execute(
            "SELECT id, stop_number, name, address, order_number FROM stores WHERE route_id = ? ORDER BY stop_number",
            (route_id,))]
        lines = conn.execute(
            """SELECT ol.store_id, ol.cases, p.id AS product_id, p.route_code, p.name, p.pack_size
               FROM order_lines ol
               JOIN stores s ON s.id = ol.store_id
               JOIN products p ON p.id = ol.product_id
               WHERE s.route_id = ?
               ORDER BY p.name, p.pack_size""",
            (route_id,),
        ).fetchall()
    finally:
        conn.close()
    by_store = {s["id"]: dict(s, lines=[], cases=0, short_lines=0) for s in stores}
    for ln in lines:
        s = by_store[ln["store_id"]]
        line = dict(ln, status=status[ln["product_id"]])
        del line["store_id"]
        s["lines"].append(line)
        s["cases"] += ln["cases"]
        s["short_lines"] += line["status"] in ("off", "out")
    return {"route": dict(route), "stores": list(by_store.values())}
