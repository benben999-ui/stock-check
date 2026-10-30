"""
Stock Check prototype - local web server.

Uses only Python's standard library. Serves the page in /static and a small
JSON API. All data access goes through data/repository.py.
"""
import json
import mimetypes
import os
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from data import repository as repo

HOST = "127.0.0.1"
PORT = 8765
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

# Windows can report odd types for these from the registry; pin them.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")


class Handler(BaseHTTPRequestHandler):
    # ---- helpers -----------------------------------------------------------
    def _send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8") or "{}")

    def _serve_static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        full = os.path.normpath(os.path.join(STATIC_DIR, path.lstrip("/")))
        if not full.startswith(STATIC_DIR) or not os.path.isfile(full):
            self.send_error(404)
            return
        with open(full, "rb") as f:
            body = f.read()
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass  # keep the console window quiet

    # ---- routes ------------------------------------------------------------
    def do_GET(self):
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            if url.path == "/api/lookup":
                result = repo.lookup(q.get("code", ""))
                result["check_id"] = repo.start_check(result)
                return self._send_json(result)
            if url.path == "/api/log":
                return self._send_json(repo.activity_log(q.get("q", "")))
            if url.path == "/api/turned-off":
                return self._send_json(repo.turned_off_products())
            if url.path == "/api/stats":
                return self._send_json(repo.stats())
            if url.path == "/api/routes":
                return self._send_json(repo.list_routes())
            if url.path == "/api/progress":
                return self._send_json(repo.pick_progress())
            if url.path == "/api/stockouts":
                return self._send_json(repo.stockouts())
            if url.path == "/api/find":
                found = repo.find_pallet_or_order(q.get("q", ""))
                return self._send_json(found) if found else self._send_json({"error": "No pallet or order found"}, 404)
            # /api/routes/<id>
            parts = url.path.strip("/").split("/")
            if parts[:2] == ["api", "routes"] and len(parts) == 3:
                detail = repo.route_detail(int(parts[2]))
                return self._send_json(detail) if detail else self._send_json({"error": "No such route"}, 404)
            if url.path.startswith("/api/"):
                return self._send_json({"error": "Not found"}, 404)
            return self._serve_static(url.path)
        except Exception as exc:  # show errors instead of hanging the page
            return self._send_json({"error": str(exc)}, 500)

    def do_POST(self):
        url = urlparse(self.path)
        parts = url.path.strip("/").split("/")
        try:
            body = self._read_json()
            # /api/checks/<id>/relayed | /api/checks/<id>/empty-slot
            if parts[:2] == ["api", "checks"] and len(parts) == 4:
                check_id = int(parts[2])
                if parts[3] == "relayed":
                    repo.mark_location_relayed(check_id, body.get("location", ""))
                elif parts[3] == "empty-slot":
                    repo.confirm_empty_slot(check_id)
                else:
                    return self._send_json({"error": "Unknown action"}, 404)
                return self._send_json({"ok": True})
            # /api/products/<id>/off | /api/products/<id>/on
            if parts[:2] == ["api", "products"] and len(parts) == 4:
                product_id = int(parts[2])
                if parts[3] == "off":
                    repo.turn_off_product(product_id, body.get("check_id"))
                elif parts[3] == "on":
                    repo.turn_on_product(product_id)
                else:
                    return self._send_json({"error": "Unknown action"}, 404)
                return self._send_json({"ok": True})
            if url.path == "/api/reset":
                return self._send_json(repo.reset_demo_data())
            return self._send_json({"error": "Not found"}, 404)
        except Exception as exc:
            return self._send_json({"error": str(exc)}, 500)


def main():
    repo.ensure_database()
    url = f"http://localhost:{PORT}"
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        print(f"The app already seems to be running. Opening {url} ...")
        webbrowser.open(url)
        return
    print("=" * 60)
    print("  Stock Check prototype is running (mock data only)")
    print(f"  Open in your browser:  {url}")
    print("  To stop the app, close this window.")
    print("=" * 60)
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
