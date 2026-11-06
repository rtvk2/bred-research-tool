#!/usr/bin/env python3
"""End-to-end self-test: server + headless Chrome bots through the real app, then checks on the saved data.

  python selftest.py [--shots]      (needs Chrome and `pip install websocket-client`)
"""
import argparse, base64, collections, json, os, subprocess, sys, tempfile, time, urllib.error, urllib.request
from pathlib import Path
import websocket

APP = Path(__file__).resolve().parent.parent
CHROME = os.environ.get("CHROME", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
PORT, CDP_PORT = 8765, 9333
BASE = f"http://127.0.0.1:{PORT}"


class CDP:
    def __init__(self):
        page = None
        for _ in range(60):
            try:
                t = json.load(urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json"))
                page = next(x for x in t if x["type"] == "page")
                break
            except Exception:
                time.sleep(0.5)
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"], max_size=None)
        self.i = 0

    def call(self, method, **params):
        self.i += 1
        self.ws.send(json.dumps({"id": self.i, "method": method, "params": params}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == self.i:
                return m

    def ev(self, expr):
        r = self.call("Runtime.evaluate", expression=expr, returnByValue=True)
        return r.get("result", {}).get("result", {}).get("value")

    def go(self, url):
        self.call("Page.navigate", url=url)

    def shot(self, path):
        d = self.call("Page.captureScreenshot", format="png")["result"]["data"]
        Path(path).write_bytes(base64.b64decode(d))

    def wait(self, expr, timeout=120):
        t0 = time.time()
        while time.time() - t0 < timeout:
            v = self.ev(expr)
            if v:
                return v
            time.sleep(0.4)
        raise TimeoutError(expr)


def check_file(d, problems):
    tr = d["trials"]
    group = d["assignment"].get("group")

    def c(cond, msg):
        if not cond:
            problems.append(f"{d['participantCode']} ({group}): {msg}")
    SIZE = {"oldP": 15, "lure": 15, "oldW": 10, "foilW": 10, "foilP": 10}
    ISOLD = {"oldP": True, "oldW": True, "lure": False, "foilW": False, "foilP": False}
    CONDS = ("HO", "LO", "HN", "LN", "NC")
    c(group in ("cue", "control"), "group")
    c(len(tr) == 60, f"{len(tr)} trials")
    c(d["consent"]["agreed"], "no consent")
    kinds = collections.Counter(t["status"] for t in tr)
    c(all(kinds[k] == n for k, n in SIZE.items()), f"kinds {dict(kinds)}")
    c(all(t["isOld"] == ISOLD[t["status"]] for t in tr), "isOld flag")
    c(all(t["correct"] == (t["response"] == ("old" if t["isOld"] else "new")) for t in tr), "correct flag")
    run = 1
    for x, y in zip(tr, tr[1:]):
        run = run + 1 if x["status"] == y["status"] else 1
        c(run <= 3, "status run > 3")
    exp = {"HO": ({8, 9, 10}, "OLD"), "LO": ({1, 2, 3}, "OLD"), "HN": ({8, 9, 10}, "NEW"), "LN": ({1, 2, 3}, "NEW"), "NC": ({None}, None)}
    c(all(t["cueCount"] in exp[t["condition"]][0] and t["cueValence"] == exp[t["condition"]][1] for t in tr), "cue/condition mismatch")
    if group == "cue":
        cells = collections.Counter((t["status"], t["condition"]) for t in tr)
        c(all(cells[(k, cd)] == SIZE[k] // 5 for k in SIZE for cd in CONDS), "cells not balanced (3 or 2 per kind and condition)")
        for cd in ("HO", "LO", "HN", "LN"):
            nums = collections.Counter(t["cueCount"] for t in tr if t["condition"] == cd)
            c(sorted(nums.values()) == [4, 4, 4], f"cue numbers not balanced within {cd}: {dict(nums)}")
        c(len(d["catches"]) == 3, "catches")
        by_trial = {t["trial"]: t for t in tr}
        c(all(by_trial[x["afterTrial"]]["cueCount"] is not None for x in d["catches"]), "a check followed a no-cue trial")
        c({"believable", "influence"} <= set(d["questionnaire"]), "belief items")
    else:
        c(all(t["condition"] == "NC" for t in tr), "control trials carry a cue")
        c(len(d["catches"]) == 0, "control has catch trials")
        c(not ({"believable", "influence"} & set(d["questionnaire"])), "control has belief items")
    so = d["study"]["order"]
    c(len(set(so)) == 25 and len(d["study"]["kinds"]) == 25, "study list is not 25 distinct words")
    lex = {"oldP": "nonword", "oldW": "word"}
    run = 1
    for x, y in zip(so, so[1:]):
        run = run + 1 if lex[d["study"]["kinds"][x]] == lex[d["study"]["kinds"][y]] else 1
        c(run <= 3, "study lexicality run > 3")
    c(all(x["shownMs"] >= 90 for x in d["study"]["log"]) and len(d["study"]["log"]) == 25, "study timing")
    c(d.get("distractor", {}).get("n") == 60, "distractor missing")
    c(set(d["questionnaire"]) >= {"aboutOpen", "firstLanguage", "ageEnglish", "englishEase", "age", "gender", "priorParticipation"}, "questionnaire")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", action="store_true")
    ap.add_argument("--engine", choices=["custom", "jspsych"], default="custom", help="which page to run the bots through")
    ap.add_argument("--mock", action="store_true", help="test the GitHub Pages path: page on one origin, Apps-Script-like backend on another")
    a = ap.parse_args()
    data = tempfile.mkdtemp(prefix="wm_data_")
    prof = tempfile.mkdtemp(prefix="wm_chrome_")
    srv = subprocess.Popen([sys.executable, str(APP / "server.py"), "--port", str(PORT), "--data", data], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    chrome = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", f"--remote-debugging-port={CDP_PORT}", f"--user-data-dir={prof}", "--window-size=1100,760", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    problems = []
    page = "/jspsych/index.html" if a.engine == "jspsych" else "/"
    mock = None
    qs = "&backend=local"          # tests must never post to the live data inbox set in config.js
    if a.mock:
        data = tempfile.mkdtemp(prefix="wm_mock_")
        mock = subprocess.Popen([sys.executable, str(APP / "tools" / "mock_apps_script.py"), "--port", "8777", "--data", data], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        qs = "&backend=http://127.0.0.1:8777/exec"
    try:
        for _ in range(40):
            try:
                urllib.request.urlopen(BASE + "/api/health")
                break
            except Exception:
                time.sleep(0.25)
        time.sleep(0.5 if a.mock else 0)
        assign_url = "http://127.0.0.1:8777/exec?action=assign" if a.mock else BASE + "/api/assign"
        cells = [json.load(urllib.request.urlopen(assign_url)) for _ in range(20)]
        grp = collections.Counter(c["group"] for c in cells)
        cue_cells = collections.Counter((c["version"], c["keymap"]) for c in cells)
        ok = grp == {"cue": 20} and set(cue_cells.values()) == {2} and len(cue_cells) == 10
        print("assign: 20 calls ->", "all cue version, 10 cells (5 versions x 2 key maps) balanced, 2 each" if ok else f"UNBALANCED {dict(grp)} {dict(cue_cells)}")
        if not ok:
            problems.append("assign unbalanced")
        print("experiment.js content-type:", urllib.request.urlopen(BASE + "/experiment.js").headers["Content-Type"])
        for bad_path in ("/../server.py", "/data/", "/..%2fserver.py"):
            try:
                urllib.request.urlopen(BASE + bad_path)
                problems.append(f"{bad_path} readable")
            except Exception:
                pass
        if not a.mock:
            req = urllib.request.Request(BASE + "/api/save", data=b'{"schema":1}', headers={"Content-Type": "application/json"})
            try:
                urllib.request.urlopen(req)
                problems.append("bad save accepted")
            except urllib.error.HTTPError as e:
                print("bad payload rejected with", e.code)

        cdp = CDP()
        cdp.call("Page.enable")
        for v, k, g in [(0, 0, "cue"), (1, 0, "cue"), (2, 0, "cue"), (3, 0, "cue"), (4, 0, "cue"), (0, 1, "cue"), (3, 1, "cue"), (1, 0, "control")]:
            cdp.go(f"{BASE}{page}?bot=1&v={v}&k={k}&g={g}&seed={1000 + v * 7 + k}{qs}")
            res = cdp.wait("window.__done ? JSON.stringify(window.__result) : (window.__error || '')")
            print(f"bot v={v} k={k} {g}:", res[:120])
            if "trials" not in res:
                problems.append("bot run failed: " + res)
        # progress log: a Quit and a closed tab must leave only stage entries, never a participant file
        n_before = len(list(Path(data).glob("dev_*.json")))
        for how in ("quit", "close"):
            cdp.go(f"{BASE}{page}?bot=1&v=1&k=0&seed=555{qs}")
            time.sleep(2.0)
            if how == "quit":
                cdp.ev("(function(){var q=document.querySelector('#quit'); if (q) q.click();})()")
            else:
                cdp.go("about:blank")
            time.sleep(1.5)
        if len(list(Path(data).glob("dev_*.json"))) != n_before:
            problems.append("a quit or closed session left a participant file")
        if a.mock:  # one run that takes its cell from the backend
            cdp.go(f"{BASE}{page}?bot=1&seed=77{qs}")
            res = cdp.wait("window.__done ? JSON.stringify(window.__result) : (window.__error || '')")
            print("bot with backend-assigned cell:", res[:100])
            if "trials" not in res:
                problems.append("backend-assigned run failed: " + res)
        if a.shots:
            shots = APP / "tools" / "shots"
            shots.mkdir(exist_ok=True)
            cdp.go(f"{BASE}/?dev=1&v=0&k=0&backend=local")
            cdp.wait("document.querySelector('#agree') ? 1 : 0")
            cdp.shot(shots / "1_consent.png")
            cdp.ev("document.querySelector('#agree').click(); document.querySelector('[data-next]').click()")
            def screen(title, timeout=30):
                cdp.wait(f"(document.querySelector('.card h2')||{{}}).textContent === {json.dumps(title)} ? 1 : 0", timeout)
                time.sleep(0.2)
            for title in ("Before you start", "Other participants", "A short practice", "Practice: learn these words"):
                screen(title)
                if title == "Other participants":
                    cdp.shot(shots / "2_cue_explain.png")
                cdp.ev("document.querySelector('[data-next]').click()")
            cdp.wait("document.querySelector('.word') ? 1 : 0")
            time.sleep(0.8)
            cdp.shot(shots / "3_study_word.png")
            screen("Practice: OLD or NEW?")
            cdp.ev("document.querySelector('[data-next]').click()")
            cdp.wait("document.querySelector('.cue') ? 1 : 0", 30)
            time.sleep(0.4)
            cdp.shot(shots / "4_test_trial.png")
            cdp.ev("window.__t.form('About your languages','These help us interpret the results.', window.__t.F_LANG)")
            time.sleep(0.5)
            cdp.shot(shots / "5_language_form.png")
            print("screenshots in", shots)
        cdp.ws.close()

        real = sorted(Path(data).glob("WM-*.json"))
        devs = sorted(Path(data).glob("dev_*.json"))
        print(f"saved: {len(real)} real-prefixed, {len(devs)} dev-prefixed files (7 cue + 1 control expected" + (" + 1 backend-assigned)" if a.mock else ")"))
        lure_cond = collections.defaultdict(set)
        for f in devs:
            d = json.loads(f.read_text(encoding="utf8"))
            check_file(d, problems)
            if a.mock and d["assignment"]["source"] == "server":
                print("assignment came from the backend:", d["assignment"]["version"], d["assignment"]["keymap"])
            for t in d["trials"]:
                if t["status"] == "lure" and d["assignment"]["group"] == "cue":
                    lure_cond[t["word"]].add(t["condition"])
        full = all(len(v) == 5 for v in lure_cond.values()) if lure_cond else False
        print("each lure seen under all 5 conditions across the 5 versions:", full)
        if not full:
            problems.append("rotation incomplete")
        pj = Path(data) / "progress.jsonl"
        ev = [json.loads(x) for x in pj.read_text(encoding="utf8").splitlines() if x.strip()] if pj.exists() else []
        lastev = {}
        for e in sorted(ev, key=lambda e: (e["sid"], e["seq"])):
            lastev[e["sid"]] = e
        ends = collections.Counter(e["stage"] for e in lastev.values())
        print("progress log, sessions by last entry:", dict(ends))
        if ends["complete"] != len(devs):
            problems.append(f"progress log shows {ends['complete']} complete sessions but {len(devs)} files were saved")
        if ends["quit"] < 1:
            problems.append("no quit entry in the progress log")
        if ends["closed"] < 1:
            problems.append("no closed-tab entry in the progress log")
        allowed = {"sid", "seq", "stage", "n", "dev", "group", "version", "keymap", "t", "last"}
        if any(set(e) - allowed for e in ev):
            problems.append("progress log carries unexpected fields")
        print("--- summarise.py --include-dev ---")
        print(subprocess.run([sys.executable, str(APP / "tools" / "summarise.py"), "--data", data, "--out", data, "--include-dev"], capture_output=True, text=True).stdout)
    finally:
        chrome.terminate()
        srv.terminate()
        if mock:
            mock.terminate()
    print("PROBLEMS:" if problems else "ALL CHECKS PASSED", *problems, sep="\n  ")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
