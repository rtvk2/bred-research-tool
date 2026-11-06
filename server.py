#!/usr/bin/env python3
"""Zero-dependency server for the experiment (Python 3.8+).

  python server.py                       # http://127.0.0.1:8000
  python server.py --host 0.0.0.0 --port 8000 --data data

Serves docs/, assigns each new participant a group (cue vs no-cue control, 2:1) and a counterbalancing cell (5 versions
x 2 key maps, least-filled first), and stores one JSON file per completed participant in the data folder. The data folder is never served.
The app only posts at the very end, so participants who quit leave nothing behind. Client IPs are not logged
by this server (the host, proxy or tunnel may still log them: say so in the IRB form if it applies).
"""
import argparse, json, os, random, re, secrets, sys, tempfile, threading, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "docs"
LOCK = threading.Lock()
PENDING = {}                      # ticket -> (group, version, keymap, time handed out)
PENDING_TTL = 45 * 60
MAX_BODY = 1_000_000
CONTROL_ENABLED = False          # the no-cue baseline is within each person; a between-participants control group is not used
CODE_RE = re.compile(r"^[A-Z0-9-]{6,24}$")
DATA = ROOT / "data"


def cell_counts():
    counts = {(g, v, k): 0 for g in ("cue", "control") for v in range(5) for k in range(2)}
    for p in DATA.glob("WM-*.json"):          # real participants only (dev files are prefixed dev_)
        try:
            a = json.loads(p.read_text(encoding="utf8"))["assignment"]
            counts[(a.get("group", "cue"), a["version"], a["keymap"])] += 1
        except Exception:
            pass
    now = time.time()
    for t in [t for t, (_, _, _, ts) in PENDING.items() if now - ts > PENDING_TTL]:
        del PENDING[t]
    for g, v, k, _ in PENDING.values():
        counts[(g, v, k)] += 1
    return counts


def assign():
    """Group first (cue : no-cue control = 2 : 1), then the least-filled cell (4 versions x 2 key maps) inside the group."""
    with LOCK:
        counts = cell_counts()
        n_cue = sum(n for (g, _, _), n in counts.items() if g == "cue")
        n_ctl = sum(n for (g, _, _), n in counts.items() if g == "control")
        group = "control" if CONTROL_ENABLED and n_ctl * 2 < n_cue else "cue"
        cells = {(v, k): n for (g, v, k), n in counts.items() if g == group}
        low = min(cells.values())
        v, k = random.choice([c for c, n in cells.items() if n == low])
        ticket = secrets.token_hex(8)
        PENDING[ticket] = (group, v, k, time.time())
        return {"group": group, "version": v, "keymap": k, "ticket": ticket}


def validate(d):
    if not isinstance(d, dict) or d.get("schema") != 1:
        return "bad schema"
    if not isinstance(d.get("participantCode"), str) or not CODE_RE.match(d["participantCode"]):
        return "bad participantCode"
    for key in ("assignment", "trials", "questionnaire", "consent"):
        if key not in d:
            return "missing " + key
    if not isinstance(d["trials"], list) or not 1 <= len(d["trials"]) <= 200:
        return "bad trials"
    if not (isinstance(d["consent"], dict) and d["consent"].get("agreed") is True):
        return "no consent"
    if not isinstance(d["assignment"], dict) or d["assignment"].get("group", "cue") not in ("cue", "control"):
        return "bad group"
    return None


def save(d):
    err = validate(d)
    if err:
        return 400, {"ok": False, "error": err}
    DATA.mkdir(exist_ok=True)
    name = ("dev_" if d.get("devMode") else "") + d["participantCode"] + ".json"
    path = DATA / name
    with LOCK:
        if path.exists():
            return 409, {"ok": False, "error": "duplicate code"}
        fd, tmp = tempfile.mkstemp(dir=DATA, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf8") as fh:
            json.dump(d, fh)
        os.replace(tmp, path)
        PENDING.pop(d.get("ticket"), None)
    return 200, {"ok": True}


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".json": "application/json",
                      ".css": "text/css", ".html": "text/html"}

    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(PUBLIC), **k)

    def log_message(self, fmt, *args):          # no client address
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/assign":
            return self._json(200, assign())
        if path == "/api/health":
            return self._json(200, {"ok": True})
        if path.startswith("/api/"):
            return self._json(404, {"ok": False})
        super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/api/save":
            return self._json(404, {"ok": False})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if not 0 < n <= MAX_BODY:
                return self._json(413, {"ok": False, "error": "size"})
            d = json.loads(self.rfile.read(n).decode("utf8"))
        except Exception:
            return self._json(400, {"ok": False, "error": "bad json"})
        code, obj = save(d)
        self._json(code, obj)


def main():
    global DATA
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--data", default=str(ROOT / "data"))
    a = ap.parse_args()
    DATA = Path(a.data).resolve()
    DATA.mkdir(parents=True, exist_ok=True)
    for f in ("consent", "debrief"):
        if "PLACEHOLDER-NOT-FOR-PARTICIPANTS" in (PUBLIC / "content" / f"{f}.html").read_text(encoding="utf8"):
            print(f"WARNING: content/{f}.html is still the placeholder; the app will refuse real participants (use ?dev=1 to test).")
    print(f"Serving {PUBLIC} at http://{a.host}:{a.port}/   data -> {DATA}")
    ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
