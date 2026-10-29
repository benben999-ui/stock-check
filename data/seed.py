"""
Builds (or rebuilds) the demo database with realistic MOCK data.

Nothing here comes from a real company system. Every code, route, location
and quantity is made up.

Run directly to reset the demo:   python data/seed.py
"""
import os
import random
import sqlite3
import sys
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stockcheck.db")

SHIFT_START_HOUR = 6      # shift starts 6:00 AM
SHIFT_END_HOUR = 16       # last check hour is 4 PM
HISTORY_DAYS = 3          # full days of history before today

SCHEMA = """
DROP TABLE IF EXISTS queue_items;
DROP TABLE IF EXISTS checks;
DROP TABLE IF EXISTS order_lines;
DROP TABLE IF EXISTS stores;
DROP TABLE IF EXISTS route_items;
DROP TABLE IF EXISTS routes;
DROP TABLE IF EXISTS inventory;
DROP TABLE IF EXISTS locations;
DROP TABLE IF EXISTS products;

CREATE TABLE products (
    id              INTEGER PRIMARY KEY,
    route_code      TEXT UNIQUE NOT NULL,   -- code used by the route program / headsets
    inventory_code  TEXT UNIQUE NOT NULL,   -- internal code used by the inventory website
    brand           TEXT NOT NULL,
    name            TEXT NOT NULL,
    pack_size       TEXT NOT NULL,
    is_active       INTEGER NOT NULL DEFAULT 1,  -- 1 = on in route program, 0 = turned off
    turned_off_at   TEXT
);

CREATE TABLE locations (
    id     TEXT PRIMARY KEY,                -- e.g. P-14-03, R-B2-04, OF-07
    type   TEXT NOT NULL CHECK (type IN ('pick', 'reserve', 'overflow'))
);

CREATE TABLE inventory (
    product_id   INTEGER NOT NULL REFERENCES products(id),
    location_id  TEXT NOT NULL REFERENCES locations(id),
    quantity     INTEGER NOT NULL,           -- cases
    PRIMARY KEY (product_id, location_id)
);

CREATE TABLE routes (
    id            INTEGER PRIMARY KEY,
    route_number  TEXT NOT NULL,
    truck_type    TEXT NOT NULL CHECK (truck_type IN ('Bulk', 'Route', 'Transport')),
    truck_number  TEXT NOT NULL,
    destination   TEXT NOT NULL,
    departs_at    TEXT NOT NULL              -- tomorrow, local time
);

CREATE TABLE stores (
    id            INTEGER PRIMARY KEY,
    route_id      INTEGER NOT NULL REFERENCES routes(id),
    stop_number   INTEGER NOT NULL,          -- delivery order on the truck
    name          TEXT NOT NULL,
    address       TEXT NOT NULL,
    order_number  TEXT NOT NULL
);

CREATE TABLE order_lines (
    store_id    INTEGER NOT NULL REFERENCES stores(id),
    product_id  INTEGER NOT NULL REFERENCES products(id),
    cases       INTEGER NOT NULL,
    PRIMARY KEY (store_id, product_id)
);

-- Total cases of each product on each truck (the sum of that truck's store orders).
CREATE TABLE route_items (
    route_id    INTEGER NOT NULL REFERENCES routes(id),
    product_id  INTEGER NOT NULL REFERENCES products(id),
    cases       INTEGER NOT NULL,
    PRIMARY KEY (route_id, product_id)
);

CREATE TABLE checks (
    id             INTEGER PRIMARY KEY,
    started_at     TEXT NOT NULL,
    completed_at   TEXT,
    seconds        INTEGER,
    code_entered   TEXT NOT NULL,
    product_id     INTEGER REFERENCES products(id),
    result         TEXT NOT NULL,           -- IN STOCK / OUT OF STOCK / NOT FOUND / ALREADY OFF / TURNED ON
    action         TEXT NOT NULL            -- what the certifier did
);

CREATE INDEX idx_checks_started ON checks(started_at);
"""

# (brand, name, pack sizes)
CATALOG = [
    ("Pepsi", "Pepsi", ["12pk 12oz Cans", "24pk 12oz Cans", "20oz Bottle 24ct", "2L Bottle 8ct", "6pk 16.9oz Bottles"]),
    ("Pepsi", "Diet Pepsi", ["12pk 12oz Cans", "24pk 12oz Cans", "20oz Bottle 24ct", "2L Bottle 8ct"]),
    ("Pepsi", "Pepsi Zero Sugar", ["12pk 12oz Cans", "20oz Bottle 24ct", "2L Bottle 8ct"]),
    ("Pepsi", "Pepsi Wild Cherry", ["12pk 12oz Cans", "20oz Bottle 24ct"]),
    ("Mountain Dew", "Mountain Dew", ["12pk 12oz Cans", "24pk 12oz Cans", "20oz Bottle 24ct", "2L Bottle 8ct", "6pk 16.9oz Bottles"]),
    ("Mountain Dew", "Diet Mountain Dew", ["12pk 12oz Cans", "20oz Bottle 24ct", "2L Bottle 8ct"]),
    ("Mountain Dew", "Mountain Dew Code Red", ["12pk 12oz Cans", "20oz Bottle 24ct"]),
    ("Mountain Dew", "Mountain Dew Baja Blast", ["12pk 12oz Cans", "20oz Bottle 24ct"]),
    ("Gatorade", "Gatorade Fruit Punch", ["28oz Bottle 15ct", "20oz Bottle 24ct", "12oz Bottle 24ct"]),
    ("Gatorade", "Gatorade Cool Blue", ["28oz Bottle 15ct", "20oz Bottle 24ct", "12oz Bottle 24ct"]),
    ("Gatorade", "Gatorade Lemon-Lime", ["28oz Bottle 15ct", "20oz Bottle 24ct"]),
    ("Gatorade", "Gatorade Zero Glacier Freeze", ["28oz Bottle 15ct", "20oz Bottle 24ct"]),
    ("Aquafina", "Aquafina Water", ["24pk 16.9oz Bottles", "20oz Bottle 24ct", "1L Bottle 15ct"]),
    ("Starry", "Starry Lemon Lime", ["12pk 12oz Cans", "20oz Bottle 24ct", "2L Bottle 8ct"]),
    ("Starry", "Starry Zero Sugar", ["12pk 12oz Cans", "20oz Bottle 24ct"]),
    ("Bubly", "Bubly Lime", ["8pk 12oz Cans"]),
    ("Bubly", "Bubly Blackberry", ["8pk 12oz Cans"]),
    ("Bubly", "Bubly Grapefruit", ["8pk 12oz Cans"]),
    ("Mug", "Mug Root Beer", ["12pk 12oz Cans", "2L Bottle 8ct"]),
    ("Brisk", "Brisk Lemon Iced Tea", ["12pk 12oz Cans", "1L Bottle 12ct"]),
    ("Pure Leaf", "Pure Leaf Sweet Tea", ["18.5oz Bottle 12ct", "6pk 16.9oz Bottles"]),
    ("Lipton", "Lipton Green Tea Citrus", ["16.9oz Bottle 12ct"]),
    ("Rockstar", "Rockstar Original", ["16oz Can 12ct"]),
    ("Propel", "Propel Berry", ["24oz Bottle 12ct", "16.9oz Bottle 24ct"]),
]

AREAS = [
    "Walker / Standale", "Grandville / Jenison", "Wyoming / Kentwood", "Holland", "Zeeland / Hudsonville",
    "Muskegon", "Grand Haven / Spring Lake", "Rockford / Cedar Springs", "Allendale / Coopersville",
    "Lowell / Ada", "Caledonia / Byron Center", "Greenville", "Ionia", "Big Rapids",
    "Lansing DC (transfer)", "Kalamazoo DC (transfer)", "Downtown Grand Rapids", "Cascade / Forest Hills",
]


# Made-up store names: "<place> <kind>", e.g. "Riverside Food Mart".
STORE_PLACES = [
    "Maple", "Riverside", "Lakeshore", "Northgate", "Pine Hill", "Cedar", "Harbor", "Westside", "Oak Street",
    "Meadow", "Sunrise", "Valley", "Bridge Street", "Lakeview", "Elm", "Summit", "Country", "Corner",
    "Parkside", "Hillcrest", "Orchard", "Union", "Mill Creek", "Prairie", "Birch", "Station",
]
STORE_KINDS = [
    "Market", "Grocery", "Food Mart", "Fuel & Food", "Party Store", "Express", "Pharmacy", "Foods",
    "Mini Mart", "Travel Plaza", "Deli", "Beverage & Spirits", "Fresh Market", "Quick Stop",
]
BIG_STORE_KINDS = ["Supercenter", "Warehouse Club", "Superstore", "Hypermarket"]
STREETS = ["Maple St", "Center Ave", "Lake Rd", "Main St", "Division Ave", "Park Dr", "River St", "Elm Ave",
           "Market St", "Ridge Rd", "Airport Rd", "Chicago Dr", "State St", "Washington Ave", "Pine St"]


def make_route_code(rng, used):
    while True:
        c = f"RT-{rng.randint(10000, 99999)}"
        if c not in used:
            used.add(c)
            return c


def make_inventory_code(rng, used):
    letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        c = "INV-" + "".join(rng.choice(letters) for _ in range(4)) + f"-{rng.randint(0, 9999):04d}"
        if c not in used:
            used.add(c)
            return c


def fmt(dt):
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def build_products(rng):
    rows = []
    for brand, name, packs in CATALOG:
        for pack in packs:
            rows.append((brand, name, pack))
    rng.shuffle(rows)
    return rows[:50]


def seed(db_path=DB_PATH, now=None):
    rng = random.Random(4127)   # fixed seed: the demo data is the same every reset
    now = now or datetime.now()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)

    # --- products -----------------------------------------------------------
    used_rt, used_inv = set(), set()
    products = []
    for i, (brand, name, pack) in enumerate(build_products(rng), start=1):
        products.append((i, make_route_code(rng, used_rt), make_inventory_code(rng, used_inv), brand, name, pack))
    conn.executemany(
        "INSERT INTO products (id, route_code, inventory_code, brand, name, pack_size) VALUES (?,?,?,?,?,?)",
        products,
    )

    # --- locations & inventory ----------------------------------------------
    # Stock mix: 30 in pick slot, 12 empty pick slot but in reserve/overflow, 8 fully out.
    ids = [p[0] for p in products]
    rng.shuffle(ids)
    in_pick = set(ids[:30])
    reserve_only = set(ids[30:42])
    fully_out = set(ids[42:])

    reserve_locs = [f"R-{a}{b}-{c:02d}" for a in "ABCD" for b in range(1, 5) for c in range(1, 7)]
    overflow_locs = [f"OF-{n:02d}" for n in range(1, 13)]
    rng.shuffle(reserve_locs)
    rng.shuffle(overflow_locs)

    locations, inventory = [], []
    for aisle_idx, pid in enumerate(sorted(ids)):
        pick = f"P-{10 + aisle_idx // 6:02d}-{aisle_idx % 6 + 1:02d}"
        locations.append((pick, "pick"))
        if pid in in_pick:
            inventory.append((pid, pick, rng.randint(4, 40)))
            if rng.random() < 0.5:
                inventory.append((pid, reserve_locs.pop(), rng.randint(20, 120)))
        elif pid in reserve_only:
            inventory.append((pid, pick, 0))
            inventory.append((pid, reserve_locs.pop(), rng.randint(10, 90)))
            if rng.random() < 0.4:
                inventory.append((pid, overflow_locs.pop(), rng.randint(5, 40)))
        else:
            inventory.append((pid, pick, 0))
    used_locs = {loc for _, loc, _ in inventory}
    for loc in [l for l in used_locs if not l.startswith("P-")]:
        locations.append((loc, "reserve" if loc.startswith("R-") else "overflow"))
    conn.executemany("INSERT INTO locations (id, type) VALUES (?,?)", locations)
    conn.executemany("INSERT INTO inventory (product_id, location_id, quantity) VALUES (?,?,?)", inventory)

    # --- tomorrow's routes --------------------------------------------------
    tomorrow = today + timedelta(days=1)
    routes = []
    for i, area in enumerate(AREAS, start=1):
        if "transfer" in area:
            ttype = "Transport"
        elif i % 5 == 0:
            ttype = "Bulk"
        else:
            ttype = "Route"
        depart = tomorrow + timedelta(hours=3, minutes=30 + 15 * i + rng.choice([0, 5, 10]))
        routes.append((i, f"{400 + i * 7}", ttype, f"T-{rng.randint(100, 399)}", area, fmt(depart)))
    conn.executemany(
        "INSERT INTO routes (id, route_number, truck_type, truck_number, destination, departs_at) VALUES (?,?,?,?,?,?)",
        routes,
    )
    # --- stores on each route and what each store ordered ---------------------
    stores, order_lines = [], []
    used_names, used_orders = set(), set()
    store_id = 0
    for rid, _, ttype, _, area, _ in routes:
        towns = [t.replace(" (transfer)", "").replace(" DC", "") for t in area.split(" / ")]
        if ttype == "Transport":
            plan = [("dc", 1)]                      # one stop: another distribution center
        elif ttype == "Bulk":
            plan = [("big", 1)] * rng.randint(2, 3)  # a few large stores, big orders
        else:
            plan = [("small", 1)] * rng.randint(5, 9)
        for stop, (kind, _) in enumerate(plan, start=1):
            store_id += 1
            town = rng.choice(towns)
            if kind == "dc":
                name = f"{town} Distribution Center, Dock {rng.randint(2, 14)}"
                lines, case_range = rng.randint(22, 32), (20, 120)
            else:
                while True:
                    kinds = BIG_STORE_KINDS if kind == "big" else STORE_KINDS
                    name = f"{rng.choice(STORE_PLACES)} {rng.choice(kinds)}"
                    if name not in used_names:
                        used_names.add(name)
                        break
                name = f"{name}, {town}"
                lines, case_range = ((rng.randint(10, 18), (10, 70)) if kind == "big" else (rng.randint(4, 11), (1, 24)))
            while True:
                order_number = f"SO-{rng.randint(100000, 999999)}"
                if order_number not in used_orders:
                    used_orders.add(order_number)
                    break
            address = f"{rng.randint(100, 9899)} {rng.choice(STREETS)}, {town}"
            stores.append((store_id, rid, stop, name, address, order_number))
            for pid in rng.sample(ids, lines):
                order_lines.append((store_id, pid, rng.randint(*case_range)))
    conn.executemany(
        "INSERT INTO stores (id, route_id, stop_number, name, address, order_number) VALUES (?,?,?,?,?,?)", stores)
    conn.executemany("INSERT INTO order_lines (store_id, product_id, cases) VALUES (?,?,?)", order_lines)
    conn.execute(
        """INSERT INTO route_items (route_id, product_id, cases)
           SELECT s.route_id, ol.product_id, SUM(ol.cases)
           FROM order_lines ol JOIN stores s ON s.id = ol.store_id
           GROUP BY s.route_id, ol.product_id""")

    # --- check history: heavy at shift start, rare later ---------------------
    # Relative weight of checks per hour of the shift.
    hour_weights = {6: 34, 7: 20, 8: 7, 9: 4, 10: 3, 11: 2, 12: 3, 13: 2, 14: 2, 15: 1, 16: 1}
    status_by_pid = {pid: ("pick" if pid in in_pick else "reserve" if pid in reserve_only else "out") for pid in ids}
    code_by_pid = {p[0]: p[1] for p in products}
    location_by_pid = {}
    for pid, loc, qty in inventory:
        if qty > 0 and not loc.startswith("P-"):
            location_by_pid.setdefault(pid, loc)

    checks = []

    def add_check(start, pid, force_result=None):
        status = status_by_pid[pid]
        if force_result == "OUT":
            status = "out"
        if status == "out":
            result, action = "OUT OF STOCK", "Turned off + EMPTY SLOT confirmed"
            secs = rng.randint(70, 150)
        else:
            loc = location_by_pid.get(pid, "pick slot")
            result, action = "IN STOCK", f"Sent picker to {loc}"
            secs = rng.randint(35, 95)
        # The morning rush makes each check a bit slower.
        if start.hour in (6, 7):
            secs = int(secs * 1.25)
        end = start + timedelta(seconds=secs)
        checks.append((fmt(start), fmt(end), secs, code_by_pid[pid], pid, result, action))

    # Checks mostly happen on empty pick slots, so pick from reserve-only and out products.
    check_pool = list(reserve_only) * 3 + list(fully_out) * 2 + list(in_pick)

    for day_offset in range(HISTORY_DAYS, -1, -1):
        day = today - timedelta(days=day_offset)
        day_scale = rng.uniform(0.85, 1.15)
        for hour, weight in hour_weights.items():
            n = max(0, round(weight * day_scale + rng.uniform(-1.5, 1.5)))
            for _ in range(n):
                start = day + timedelta(hours=hour, minutes=rng.randint(0, 59), seconds=rng.randint(0, 59))
                if start >= now - timedelta(minutes=2):
                    continue      # no fake checks in the future
                pid = rng.choice(check_pool)
                # On history days fully-out items were turned off; today we leave most for the demo.
                if day_offset == 0 and status_by_pid[pid] == "out":
                    pid = rng.choice(list(reserve_only))
                add_check(start, pid)

    # Two products already turned off earlier today (so "turned off today" has something to turn back on).
    already_off = sorted(fully_out)[:2]
    for n, pid in enumerate(already_off):
        start = max(today + timedelta(hours=SHIFT_START_HOUR, minutes=12 + n * 9), today)
        if start > now - timedelta(minutes=5):
            start = max(today, now - timedelta(minutes=20 - n * 8))
        add_check(start, pid, force_result="OUT")
        off_time = start + timedelta(seconds=40)
        conn.execute("UPDATE products SET is_active = 0, turned_off_at = ? WHERE id = ?", (fmt(off_time), pid))

    checks.sort(key=lambda c: c[0])
    conn.executemany(
        "INSERT INTO checks (started_at, completed_at, seconds, code_entered, product_id, result, action) VALUES (?,?,?,?,?,?,?)",
        checks,
    )
    conn.commit()
    conn.close()
    return {"products": len(products), "routes": len(routes), "stores": len(stores),
            "order_lines": len(order_lines), "checks": len(checks)}


if __name__ == "__main__":
    info = seed()
    print(f"Demo data reset: {info['products']} products, {info['routes']} routes, {info['stores']} store stops "
          f"({info['order_lines']} order lines), {info['checks']} logged checks.")
    if "--pause" in sys.argv:
        input("Press Enter to close...")
