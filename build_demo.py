"""
Builds the shareable web demo: one self-contained HTML page that runs the
same screens with no server, using the same mock data as the local app.

    python build_demo.py

Writes:
  docs/index.html                  complete page; GitHub Pages serves the docs/ folder as the live demo
  demo/stock-check-artifact.html   page body only (for publishing as a Claude artifact; not committed)
"""
import hashlib
import json
import os
import re
import sqlite3
import tempfile
from datetime import datetime

from data import seed as seed_module

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
DEMO = os.path.join(ROOT, "demo")
DOCS = os.path.join(ROOT, "docs")

TITLE = "Stock Check"
DESCRIPTION = "Prototype that combines a multi-system warehouse out-of-stock check into one screen. All data is made up."


def read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as f:
        return f.read()


def export_seed():
    """Seed a throwaway database as if it were the end of the day, then export it as JSON."""
    end_of_day = datetime.now().replace(hour=23, minute=59, second=59, microsecond=0)
    today = end_of_day.date()
    tmp = os.path.join(tempfile.mkdtemp(), "demo.db")
    seed_module.seed(tmp, now=end_of_day)
    conn = sqlite3.connect(tmp)
    conn.row_factory = sqlite3.Row

    def split(ts):
        dt = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
        return (dt.date() - today).days, dt.strftime("%H:%M:%S")

    products = []
    for p in conn.execute("SELECT * FROM products ORDER BY id"):
        products.append({
            "id": p["id"], "route_code": p["route_code"], "inventory_code": p["inventory_code"],
            "brand": p["brand"], "name": p["name"], "pack_size": p["pack_size"], "is_active": p["is_active"],
            "off_time": split(p["turned_off_at"])[1] if p["turned_off_at"] else None,
        })
    routes = []
    for r in conn.execute("SELECT * FROM routes ORDER BY id"):
        day, time = split(r["departs_at"])
        routes.append({"id": r["id"], "route_number": r["route_number"], "truck_type": r["truck_type"],
                       "truck_number": r["truck_number"], "destination": r["destination"],
                       "depart_day": day, "depart_time": time})
    checks = []
    for c in conn.execute("SELECT * FROM checks ORDER BY started_at"):
        day, time = split(c["started_at"])
        checks.append({"day": day, "start": time, "seconds": c["seconds"], "code": c["code_entered"],
                       "product_id": c["product_id"], "result": c["result"], "action": c["action"]})
    data = {
        "products": products,
        "locations": {row["id"]: row["type"] for row in conn.execute("SELECT * FROM locations")},
        "inventory": [list(row) for row in conn.execute("SELECT product_id, location_id, quantity FROM inventory")],
        "routes": routes,
        "route_items": [list(row) for row in conn.execute("SELECT route_id, product_id, cases FROM route_items")],
        "checks": checks,
        "shift_start": seed_module.SHIFT_START_HOUR,
        "shift_end": seed_module.SHIFT_END_HOUR,
        "history_days": seed_module.HISTORY_DAYS,
    }
    conn.close()
    data["version"] = hashlib.sha1(json.dumps(data, sort_keys=True).encode()).hexdigest()[:10]
    return data


def build():
    index = read(STATIC, "index.html")
    fonts = re.search(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>', index).group(0)
    body =re.search(r"<body>(.*)</body>", index, re.S).group(1)
    body = body.replace('<script src="app.js"></script>', "")
    body = body.replace("<!--DEMO-INTRO-->", read(DEMO, "demo-intro.html"), 1)

    seed_json = json.dumps(export_seed(), separators=(",", ":"))
    scripts = "\n".join([
        f"<script>window.DEMO_SEED = {seed_json};</script>",
        f"<script>{read(DEMO, 'demo-backend.js')}</script>",
        f"<script>{read(STATIC, 'app.js')}</script>",
        f"<script>{read(DEMO, 'demo-extras.js')}</script>",
    ])
    head = (f"<title>{TITLE}</title>\n"
            '<meta name="claude:viewport-fit-sides" content="cover">\n'
            f'<meta name="description" content="{DESCRIPTION}">\n'
            f"{fonts}\n<style>\n{read(STATIC, 'app.css')}\n</style>\n")

    os.makedirs(DEMO, exist_ok=True)
    artifact = os.path.join(DEMO, "stock-check-artifact.html")
    with open(artifact, "w", encoding="utf-8") as f:
        f.write(head + body + scripts + "\n")

    os.makedirs(DOCS, exist_ok=True)
    full = os.path.join(DOCS, "index.html")
    with open(full, "w", encoding="utf-8") as f:
        f.write('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
                '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
                + head + "</head>\n<body>\n" + body + scripts + "\n</body>\n</html>\n")
    print(f"Built {os.path.relpath(artifact, ROOT)} and {os.path.relpath(full, ROOT)} "
          f"({os.path.getsize(full) // 1024} KB)")


if __name__ == "__main__":
    build()
