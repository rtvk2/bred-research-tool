#!/usr/bin/env python3
"""Export fixed, counterbalanced trial lists as CSV, for rebuilding the study in another platform
(Gorilla, PsychoPy/Pavlovia, Qualtrics, lab.js ...) without re-inventing the design.

  python export_trial_lists.py            # writes ../trial_lists/study.csv and test_v0.csv ... test_v4.csv

Same stimuli and the same condition rotation as the app: cond = (item index + version + offset) % 5 over
HO, LO, HN, LN, NC (NC = no cue shown), offsets oldP 0, lure 1, foilW 2, foilP 3, oldW 2. The order in each file is ONE fixed
pseudo-random order (seeded; same run-length limits as the app), so for strict standardisation every participant in that
version sees the same order. The app itself uses a new random order per participant. After the study list comes a 60 s
go/no-go shape task (circle = press, square = do not press; 1 shape per second, 75% circles).
"""
import csv, json, random
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
stim = json.loads((APP / "docs" / "stimuli.json").read_text(encoding="utf8"))
COND = ["HO", "LO", "HN", "LN", "NC"]
INFO = {"HO": (9, "OLD"), "LO": (2, "OLD"), "HN": (9, "NEW"), "LN": (2, "NEW"), "NC": (None, None)}
OFF = {"oldP": 0, "lure": 1, "foilW": 2, "foilP": 3, "oldW": 2}
ISOLD = {"oldP": True, "oldW": True, "lure": False, "foilW": False, "foilP": False}
LEX = {"oldP": "nonword", "oldW": "word", "lure": "word", "foilW": "word", "foilP": "nonword"}
words = {
    "oldP": [it["pseudo"] for it in stim["items"]],
    "lure": [it["real"] for it in stim["items"]],
    "oldW": [s["word"] for s in stim["studyReals"]],
    "foilW": [f["real"] for f in stim["foils"]],
    "foilP": [f["pseudo"] for f in stim["foils"]],
}
out = APP / "trial_lists"
out.mkdir(exist_ok=True)
for old in out.glob("*.csv"):
    old.unlink()


def run_ok(rows, key, mx):
    run = 1
    for a, b in zip(rows, rows[1:]):
        run = run + 1 if a[key] == b[key] else 1
        if run > mx:
            return False
    return True


rng = random.Random(20261106)
study = [(w, "oldP") for w in words["oldP"]] + [(w, "oldW") for w in words["oldW"]]
for _ in range(5000):
    rng.shuffle(study)
    if run_ok([{"lex": LEX[k]} for _, k in study], "lex", 3):
        break
with open(out / "study.csv", "w", newline="", encoding="utf8") as fh:
    w = csv.writer(fh)
    w.writerow(["position", "word", "kind", "duration_ms"])
    for i, (word, kind) in enumerate(study, 1):
        w.writerow([i, word, kind, 5000])

for v in range(5):
    rows = []
    for kind, ws in words.items():
        for i, word in enumerate(ws):
            cond = COND[(i + v + OFF[kind]) % 5]
            n, val = INFO[cond]
            rows.append({"word": word, "kind": kind, "lexicality": LEX[kind], "condition": cond, "cue_count": n if n is not None else "",
                         "cue_valence": val or "", "cue_text": f"{n} of 10 other participants said {val}" if n is not None else "(no cue shown)",
                         "correct_answer": "OLD" if ISOLD[kind] else "NEW"})
    for _ in range(20000):
        rng.shuffle(rows)
        if run_ok(rows, "kind", 3) and run_ok(rows, "cue_valence", 4):
            break
    with open(out / f"test_v{v}.csv", "w", newline="", encoding="utf8") as fh:
        w = csv.DictWriter(fh, fieldnames=["position"] + list(rows[0]))
        w.writeheader()
        for i, r in enumerate(rows, 1):
            w.writerow({"position": i, **r})
print("wrote", sorted(p.name for p in out.glob("*.csv")), "in", out)
