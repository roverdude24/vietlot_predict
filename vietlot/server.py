"""Localhost JSON API + the web UI in web/. Standard library only."""
import json
import mimetypes
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import db, lab, ledger, plan, sync

WEB = db.ROOT / "web"
_sync_lock = threading.Lock()
_lab_cache = {}  # (game, window, last draw id) -> result; the backtest takes ~2 s


def state(con):
    games = {}
    for g in db.GAMES:
        rows = db.draws(con, g, limit=1)
        m = db.model(con, g)
        games[g] = {
            "draws": con.execute("SELECT COUNT(*) FROM draws WHERE game = ?", (g,)).fetchone()[0],
            "last": rows[-1] if rows else None,
            "next": m["next"] if m else None,
            "alpha": m["alpha"] if m else None,
            "model_updated": m["updated"] if m else None,
        }
    return {"synced_at": db.get_meta(con, "synced_at"), "games": games, "ledger": ledger.totals(con), "plan": plan.status(con)}


class Handler(BaseHTTPRequestHandler):
    server_version = "vietlot"

    def log_message(self, fmt, *args):  # keep the launchd log for errors only
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False, default=lambda o: o.item()).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _guard(self):
        # Localhost only: refuse DNS-rebinding hosts; writes must be JSON so other sites can't post cross-origin.
        host = (self.headers.get("Host") or "").split(":")[0]
        if host not in ("127.0.0.1", "localhost"):
            self._send(403, {"error": "forbidden host"})
            return False
        if self.command == "POST" and not (self.headers.get("Content-Type") or "").startswith("application/json"):
            self._send(415, {"error": "Content-Type must be application/json"})
            return False
        return True

    def _route(self):
        if not self._guard():
            return
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        parts = [p for p in url.path.split("/") if p]
        if parts[:1] != ["api"]:
            return self._static(url.path) if self.command == "GET" else self._send(405, {"error": "method"})
        con = db.connect()
        try:
            game = q.get("game", "655")
            if game not in db.GAMES:
                return self._send(400, {"error": "game phải là 655 hoặc 645"})
            route = (self.command, "/".join(parts[1:2]))
            if route == ("GET", "state"):
                return self._send(200, state(con))
            if route == ("GET", "draws"):
                rows = db.draws(con, game, limit=int(q["limit"]) if "limit" in q else None)
                return self._send(200, rows[::-1])
            if route == ("GET", "lab"):
                window = int(q.get("window", 30))
                key = (game, window, con.execute("SELECT MAX(id) FROM draws WHERE game = ?", (game,)).fetchone()[0])
                if key not in _lab_cache:
                    _lab_cache[key] = lab.run(con, game, window)
                return self._send(200, _lab_cache[key])
            if route == ("GET", "purchases"):
                return self._send(200, ledger.list_all(con))
            if route == ("POST", "purchases"):
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
                try:
                    p = ledger.add(con, str(body.get("game", "")), body.get("tickets"), body.get("draw_id"),
                                   body.get("code") or None, body.get("bought_at") or None)
                except ValueError as e:
                    return self._send(400, {"error": str(e)})
                return self._send(201, p)
            if route == ("DELETE", "purchases") and len(parts) == 3 and parts[2].isdigit():
                ok = ledger.delete(con, int(parts[2]))
                return self._send(200 if ok else 404, {"ok": ok})
            if route == ("POST", "sync"):
                if not _sync_lock.acquire(blocking=False):
                    return self._send(409, {"error": "đang cập nhật"})
                try:
                    return self._send(200, sync.run(con))
                finally:
                    _sync_lock.release()
            return self._send(404, {"error": "not found"})
        except Exception as e:
            return self._send(500, {"error": "{}: {}".format(type(e).__name__, e)})
        finally:
            con.close()

    def _static(self, path):
        f = (WEB / path.lstrip("/")).resolve()
        if f.is_dir():
            f = f / "index.html"
        if WEB.resolve() not in f.parents or not f.is_file():
            return self._send(404, b"not found", "text/plain")
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self._send(200, f.read_bytes(), ctype)

    do_GET = do_POST = do_DELETE = _route


def serve(port=8655):
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("Vietlott: http://127.0.0.1:%d" % port, flush=True)
    httpd.serve_forever()
