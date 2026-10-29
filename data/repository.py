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
        """SELECT r.route_number, r.truck_type, r.truck_number, r.destination, r.departs_at, ri.cases
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

QUEUE_STATUS_FOR_OUTCOME = {
    "IN_STOCK": "in_stock",
    "OUT_OF_STOCK": "out_of_stock",
    "NOT_FOUND": "not_found",
    "ALREADY_OFF": "already_off",
}


def start_check(lookup_result, queue_item_id=None):
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
            """INSERT INTO checks (started_at, completed_at, seconds, code_entered, product_id, result, action, queue_item_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (now, now if finished else None, 0 if finished else None, lookup_result["code"],
             product_id, RESULT_LABELS[outcome], initial_action, queue_item_id),
        )
        check_id = cur.lastrowid
        if queue_item_id:
            conn.execute(
                "UPDATE queue_items SET status = ?, product_id = ?, check_id = ?, updated_at = ? WHERE id = ?",
                (QUEUE_STATUS_FOR_OUTCOME[outcome], product_id, check_id, now, queue_item_id),
            )
        conn.commit()
        return check_id
    finally:
        conn.close()


def _finish_check(conn, check_id, action, complete=True):
    row = conn.execute("SELECT started_at, queue_item_id FROM checks WHERE id = ?", (check_id,)).fetchone()
    if row is None:
        return None
    now = _now()
    if complete:
        secs = int((now - _parse(row["started_at"])).total_seconds())
        conn.execute("UPDATE checks SET action = ?, completed_at = ?, seconds = ? WHERE id = ?",
                     (action, _fmt(now), secs, check_id))
    else:
        conn.execute("UPDATE checks SET action = ? WHERE id = ?", (action, check_id))
    return row["queue_item_id"]


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
            queue_id = _finish_check(conn, check_id, "Turned off - waiting for EMPTY SLOT", complete=False)
            if queue_id:
                conn.execute("UPDATE queue_items SET status = 'turned_off', updated_at = ? WHERE id = ?", (now, queue_id))
        conn.commit()
    finally:
        conn.close()


def confirm_empty_slot(check_id):
    now = _fmt(_now())
    conn = _connect()
    try:
        queue_id = _finish_check(conn, check_id, "Turned off + EMPTY SLOT confirmed")
        if queue_id:
            conn.execute("UPDATE queue_items SET status = 'empty_confirmed', updated_at = ? WHERE id = ?", (now, queue_id))
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
# Shift-start queue
# ---------------------------------------------------------------------------

def list_queue():
    conn = _connect()
    try:
        rows = conn.execute(
            """SELECT q.id, q.code, q.status, q.added_at, q.updated_at, q.check_id,
                      p.name, p.pack_size
               FROM queue_items q LEFT JOIN products p ON p.id = q.product_id
               ORDER BY q.id"""
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def add_to_queue(codes):
    now = _fmt(_now())
    conn = _connect()
    try:
        added = 0
        for raw in codes:
            code = _normalize_code(raw)
            if not code:
                continue
            product = _find_product_in_route_program(conn, code)
            conn.execute(
                "INSERT INTO queue_items (code, product_id, status, added_at, updated_at) VALUES (?, ?, 'pending', ?, ?)",
                (code, product["id"] if product else None, now, now),
            )
            added += 1
        conn.commit()
        return added
    finally:
        conn.close()


def get_queue_item(item_id):
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM queue_items WHERE id = ?", (item_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def remove_queue_item(item_id):
    conn = _connect()
    try:
        conn.execute("DELETE FROM queue_items WHERE id = ?", (item_id,))
        conn.commit()
    finally:
        conn.close()


def clear_queue(only_finished=False):
    conn = _connect()
    try:
        if only_finished:
            conn.execute("DELETE FROM queue_items WHERE status IN ('in_stock', 'empty_confirmed', 'not_found', 'already_off')")
        else:
            conn.execute("DELETE FROM queue_items")
        conn.commit()
    finally:
        conn.close()
