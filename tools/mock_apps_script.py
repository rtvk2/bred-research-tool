#!/usr/bin/env python3
"""Stand-in for backend/Code.gs, used by selftest.py --mock to test the GitHub Pages path without a Google account.

Mimics the parts of Apps Script that matter to the browser: no handling of CORS preflight (OPTIONS -> 405), a
different origin from the page, JSON replies with Access-Control-Allow-Origin: *, always HTTP 200 with {ok, error}.
"""
import argparse, json, random, secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

DATA = Path(".")
ISSUED = []  # (group, version, keymap)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):                       # Apps Script cannot answer preflights
        self.send_response(405)
        self.end_headers()

    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)
        if q.get("action") == ["assign"]:
            n_cue = sum(1 for g, _, _ in ISSUED if g == "cue")
            n_ctl = sum(1 for g, _, _ in ISSUED if g == "control")
            group = "cue"            # no between-participants control group
            counts = {(v, k): 0 for v in range(5) for k in range(2)}
            for g, v, k in ISSUED:
                if g == group:
                    counts[(v, k)] += 1
            low = min(counts.values())
            v, k = random.choice([c for c, n in counts.items() if n == low])
            ISSUED.append((group, v, k))
            return self._send({"group": group, "version": v, "keymap": k, "ticket": secrets.token_hex(8)})
        self._send({"ok": True, "service": "mock"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length", "0"))
        try:
            d = json.loads(self.rfile.read(n).decode("utf8"))
        except Exception:
            return self._send({"ok": False, "error": "bad json"})
        if d.get("type") == "progress":
            with open(DATA / "progress.jsonl", "a", encoding="utf8") as fh:
                fh.write(json.dumps({k: d.get(k) for k in ("sid", "seq", "stage", "n", "dev", "group", "version", "keymap", "t", "last")}) + "\n")
            return self._send({"ok": True})
        if d.get("schema") != 1 or not d.get("trials") or not (d.get("consent") or {}).get("agreed"):
            return self._send({"ok": False, "error": "bad schema"})
        p = DATA / (("dev_" if d.get("devMode") else "") + d["participantCode"] + ".json")
        if p.exists():
            return self._send({"ok": False, "error": "duplicate code"})
        p.write_text(json.dumps(d), encoding="utf8")
        self._send({"ok": True})


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8777)
    ap.add_argument("--data", required=True)
    a = ap.parse_args()
    DATA = Path(a.data)
    DATA.mkdir(parents=True, exist_ok=True)
    ThreadingHTTPServer(("127.0.0.1", a.port), H).serve_forever()
