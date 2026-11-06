#!/usr/bin/env python3
"""Build docs/stimuli.json. EVERY word comes from the Appendix of Bowers, Davis & Hanley (2005), Cognition 97, B45-B54.

The appendix has 40 pairs (pseudoword = one-letter change of a familiar six-letter real word); 39 are usable
(tools/bowers2005_appendix.csv; POTATO's neighbour is printed as "potato", a typo). Each usable pair gets exactly one role:

  items        15 pairs (tools/pairs.csv)   pseudoword studied, its real word is the LURE at test
  studyReals   10 pairs                     real word studied (so real words are sometimes OLD); its pseudoword is never shown
  foils        10 pairs                     real word AND pseudoword both shown at test as NEW, unrelated foils
  practice      3 pairs                     procedure practice  (1 usable pair is left over)

Roles are assigned by a seeded constructive search with these rules: natural and artefact items balanced within each role, and words
from different pairs at least 3 letter edits apart (so no foil or studied real word resembles a studied pseudoword).

Usage:  python build_stimuli.py [--seed 20261105]
No internet needed. If tools/wordlists/common.txt exists (from an earlier version) it adds a frequency rank for reporting.
"""
import argparse, collections, csv, itertools, json, math, random
from pathlib import Path

HERE = Path(__file__).resolve().parent
APPX = HERE / "bowers2005_appendix.csv"
PAIRS = HERE / "pairs.csv"
OUT = HERE.parent / "docs" / "stimuli.json"
REPORT = HERE / "stimuli_report.csv"
FREQ = HERE / "wordlists" / "common.txt"
# pseudowords that look like Hindi words (amchor ~ amchur, jankal ~ jangal), a common Indian surname (tandon) or known slang (nerdle): their pairs may only be a
# studied REAL word (the pseudoword is then never shown), never a foil or practice pseudoword
FLAGGED = {"amchor", "jankal", "nerdle", "tandon"}


def lev(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def ngr(w):
    s = f"^{w}$"
    return collections.Counter(s[i:i + n] for n in (2, 3) for i in range(len(s) - n + 1))


def cos(a, b):
    num = sum(v * b.get(k, 0) for k, v in a.items())
    den = math.sqrt(sum(v * v for v in a.values())) * math.sqrt(sum(v * v for v in b.values()))
    return num / den if den else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20261105)
    args = ap.parse_args()
    rng = random.Random(args.seed)

    appx = [tuple(r) for r in list(csv.reader(open(APPX, encoding="utf8")))[1:]]          # (category, pseudo, real)
    cat_of = {r: c for c, p, r in appx}
    main_pairs = [tuple(x.strip().lower() for x in r[:2]) for r in csv.reader(open(PAIRS, encoding="utf8")) if r]
    assert len(main_pairs) == 15, "pairs.csv needs 15 rows"
    main_set = {x for pr in main_pairs for x in pr}
    rest = [t for t in appx if t[1] not in main_set and t[2] not in main_set]
    assert len(rest) == 24, f"expected 24 remaining pairs, got {len(rest)}"
    nat = [t for t in rest if t[0] == "natural"]
    art = [t for t in rest if t[0] == "artefact"]
    main_nat = sum(cat_of[r] == "natural" for _, r in main_pairs)
    assert main_nat == 7 and len(nat) == 12 and len(art) == 12, (main_nat, len(nat), len(art))

    cache = {}

    def d(a, b):
        k = (a, b) if a < b else (b, a)
        if k not in cache:
            cache[k] = lev(a, b)
        return cache[k]

    def shown(role, t):                      # words of a pair that are actually displayed in that role
        return [t[2]] if role == "S" else [t[1], t[2]]

    main_groups = [("M", ("main", p, r)) for p, r in main_pairs]

    def compat(ra, ta, rb, tb, need):
        return all(d(x, y) >= need for x in shown(ra, ta) for y in shown(rb, tb))

    def sim_max_of(w, studied):
        return max(cos(ngr(w), ngr(x)) for x in studied)

    def solve(min_lev, tries, keep):
        sols = []
        for _ in range(tries):
            chosen, used = [], set()
            ok = True
            for role in ("S", "F"):
                for cat, pool in (("natural", nat), ("artefact", art)):
                    got = 0
                    for t in rng.sample(pool, len(pool)):
                        if t in used or (role == "F" and t[1] in FLAGGED):
                            continue
                        if all(compat(role, t, r2, t2, min_lev) for r2, t2 in chosen + main_groups):
                            chosen.append((role, t)); used.add(t); got += 1
                            if got == 5:
                                break
                    if got < 5:
                        ok = False
                        break
                if not ok:
                    break
            if not ok:
                continue
            sr_, foil_ = [t for r, t in chosen if r == "S"], [t for r, t in chosen if r == "F"]
            prac_ = [t for t in rest if t not in used and t[1] not in FLAGGED][:3]     # one usable pair is left over
            if len(prac_) < 3:
                continue
            # practice items are not analysed: they only need to be 2+ edits from everything shown
            if not all(compat("P", t, r2, t2, 2) for t in prac_ for r2, t2 in chosen + main_groups):
                continue
            studied = [p for p, _ in main_pairs] + [t[2] for t in sr_]
            sc = [sim_max_of(w, studied) for t in foil_ for w in (t[1], t[2])]
            sols.append((max(sc), sum(sc) / len(sc), sr_, foil_, prac_))
            if len(sols) >= keep:
                break
        return sols

    found = None
    for min_lev in (3, 2):
        sols = solve(min_lev, 4000, 150)
        if sols:
            sols.sort(key=lambda x: (x[0], x[1]))
            found = (min_lev, sols[0][2], sols[0][3], sols[0][4], len(sols))
            break
    assert found, "no role assignment satisfies even 2 letter edits"
    min_lev, sr, foil, prac, nsol = found
    print(f"roles assigned: words of different pairs at least {min_lev} letter edits apart; best of {nsol} valid assignments (lowest foil-to-studied similarity)")

    rng.shuffle(sr)
    rng.shuffle(foil)
    studied_words = [p for p, _ in main_pairs] + [r for _, _, r in sr]
    sims_lure = [cos(ngr(r), ngr(p)) for p, r in main_pairs]
    sim_max = lambda w: max(cos(ngr(w), ngr(s)) for s in studied_words)
    rank = {}
    if FREQ.exists():
        rank = {w.strip().lower(): i + 1 for i, w in enumerate(FREQ.read_text(encoding="utf8").splitlines())}

    items = [{"id": i, "pseudo": p.upper(), "real": r.upper(), "cat": cat_of[r], "len": len(r), "sim": round(sims_lure[i], 3), "rank": rank.get(r)}
             for i, (p, r) in enumerate(main_pairs)]
    study_reals = [{"id": j, "word": r.upper(), "cat": c, "rank": rank.get(r)} for j, (c, p, r) in enumerate(sr)]
    foils = [{"id": k, "real": r.upper(), "pseudo": p.upper(), "cat": c, "simReal": round(sim_max(r), 3), "simPseudo": round(sim_max(p), 3), "rank": rank.get(r)}
             for k, (c, p, r) in enumerate(foil)]
    out = {
        "builtWith": "tools/build_stimuli.py", "seed": args.seed,
        "source": "All words from the Appendix of Bowers, Davis & Hanley (2005), Cognition 97, B45-B54 (39 usable pairs; roles assigned by seeded rule search)",
        "similarity": "cosine of letter 2- and 3-gram profiles with word-boundary markers",
        "items": items, "studyReals": study_reals, "foils": foils,
        "practice": {"study": [p.upper() for _, p, _ in prac], "old": [p.upper() for _, p, _ in prac[:2]],
                     "new": [prac[0][2].upper(), prac[2][2].upper()]},
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1), encoding="utf8")
    with open(REPORT, "w", newline="", encoding="utf8") as fh:
        w = csv.writer(fh)
        w.writerow(["role", "id", "word", "category", "sim_to_studied", "freq_rank"])
        for it in items:
            w.writerow(["studied pseudoword", it["id"], it["pseudo"], it["cat"], 1, ""])
            w.writerow(["lure", it["id"], it["real"], it["cat"], it["sim"], it["rank"] or ""])
        for s in study_reals:
            w.writerow(["studied real word", s["id"], s["word"], s["cat"], "", s["rank"] or ""])
        for f in foils:
            w.writerow(["foil real word", f["id"], f["real"], f["cat"], f["simReal"], f["rank"] or ""])
            w.writerow(["foil pseudoword", f["id"], f["pseudo"], f["cat"], f["simPseudo"], ""])

    mean = lambda xs: sum(xs) / len(xs)
    print("studied pseudoword -> lure :", ", ".join(f"{i['pseudo']}->{i['real']}" for i in items))
    print("studied real words         :", ", ".join(s["word"] for s in study_reals))
    print("foil real / pseudo         :", ", ".join(f"{f['real']}/{f['pseudo']}" for f in foils))
    print("practice                   :", out["practice"])
    print(f"lure similarity to its studied word {mean(sims_lure):.2f}; foil real {mean([f['simReal'] for f in foils]):.2f} (max {max(f['simReal'] for f in foils):.2f}); foil pseudo {mean([f['simPseudo'] for f in foils]):.2f} (max {max(f['simPseudo'] for f in foils):.2f}) to any studied word")
    print("REVIEW BY EYE for offensive or Hindi/Telugu-looking strings:", ", ".join(f["pseudo"] for f in foils), "|", ", ".join(out["practice"]["study"]))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
