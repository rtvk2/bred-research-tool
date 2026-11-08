#!/usr/bin/env python3
"""Flatten saved participant JSON files, apply the preregistered exclusion flags and print the key tables.

  python summarise.py [--data ../data] [--include-dev] [--out ../analysis]

Writes trials.csv and participants.csv (nothing is dropped from them; `excluded` and the flag columns say who/what would be).
Word kinds: oldP studied pseudoword, oldW studied real word, lure unseen real neighbour, foilW unrelated unseen real word,
foilP unrelated unseen pseudoword. Conditions: HO high-OLD, LO low-OLD, HN high-NEW, LN low-NEW, NC no cue shown (within-person baseline).
These are descriptive checks; the confirmatory mixed models in the preregistered analysis plan are run in R.
"""
import argparse, json
from pathlib import Path
import numpy as np
import pandas as pd
from scipy import stats

ap = argparse.ArgumentParser()
ap.add_argument("--data", default=str(Path(__file__).resolve().parent.parent / "data"))
ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "analysis"))
ap.add_argument("--include-dev", action="store_true")
ap.add_argument("--keep-restarts", action="store_true", help="do not exclude people whose earlier attempt had reached the test (sensitivity check)")
a = ap.parse_args()

N_TEST = 60
LATE_STAGES = ("test", "questions", "saving")
KINDS = ["oldP", "oldW", "lure", "foilW", "foilP"]
rows, parts = [], []
for p in sorted(Path(a.data).glob("*.json")):
    d = json.loads(p.read_text(encoding="utf8"))
    if d.get("devMode") and not a.include_dev:
        continue
    code, asg = d["participantCode"], d["assignment"]
    grp = asg.get("group", "cue")
    for t in d["trials"]:
        rows.append({"pid": code, "group": grp, "version": asg["version"], "keymap": asg["keymap"], **t})
    q, dist = d.get("questionnaire", {}), d.get("distractor") or {}
    parts.append({"pid": code, "group": grp, "version": asg["version"], "keymap": asg["keymap"], "n_trials": len(d["trials"]),
                  "catch_correct": d["attention"]["catchCorrect"], "catch_total": d["attention"]["catchTotal"],
                  "distractor_acc": round((dist.get("hits", 0) + dist.get("correctRejections", 0)) / dist["n"], 3) if dist.get("n") else None,
                  "duration_min": round(d["timing"]["durationMs"] / 60000, 1), "frame_ms": d["device"].get("frameMs"),
                  "device": "touch" if d["device"].get("coarsePointer") else "keyboard/mouse", "data_sharing": d.get("consent", {}).get("dataSharing"),
                  "attempt": (d.get("session") or {}).get("attempt"), "prior_stage": (d.get("session") or {}).get("priorStage") or "",
                  "believable": q.get("believable"), "influence": q.get("influence"), "first_language": q.get("firstLanguage"),
                  "prior": q.get("priorParticipation"), "english_ease": q.get("englishEase"), "age_english": q.get("ageEnglish"),
                  "english_share": q.get("englishShare")})
if not rows:
    raise SystemExit("no (non-dev) participant files found")
tr, pt = pd.DataFrame(rows), pd.DataFrame(parts)
tr["resp_old"] = (tr.response == "old").astype(int)
tr["rt_flag"] = (tr.rt < 300) | (tr.rt > 5000)

# anonymous stage-only progress log (progress.jsonl, or the Apps Script "progress" tab exported as progress.csv): where did sessions end?
prog_json, prog_csv = Path(a.data) / "progress.jsonl", Path(a.data) / "progress.csv"
events = []
if prog_json.exists():
    events = [json.loads(x) for x in prog_json.read_text(encoding="utf8").splitlines() if x.strip()]
elif prog_csv.exists():
    events = pd.read_csv(prog_csv).to_dict("records")
if events:
    pe = pd.DataFrame(events)
    if not a.include_dev and "dev" in pe:
        pe = pe[pe.dev.astype(str).str.lower() != "true"]
    ends = {}
    for sid, g in pe.sort_values("seq").groupby("sid"):
        fin = g.iloc[-1]
        if fin.stage in ("complete", "downloaded"):
            ends[sid] = "finished"
        elif fin.stage == "quit":
            ends[sid] = "clicked Quit at " + (g.iloc[-2].stage if len(g) > 1 else "consent")
        elif fin.stage == "closed":
            ends[sid] = "closed the tab at " + (fin["last"] if isinstance(fin.get("last"), str) and fin["last"] else "?")
        else:
            ends[sid] = "no end signal after " + str(fin.stage)
    if ends:
        print(f"progress log: {len(ends)} sessions started; how they ended:")
        print(pd.Series(ends).value_counts().to_string())
        print()

hit = tr[tr.isOld].groupby("pid").resp_old.mean().rename("hit_rate")
fa = tr[~tr.isOld].groupby("pid").resp_old.mean().rename("fa_rate_new")
hid = tr.groupby("pid").hidden.sum().rename("hidden_trials")
pt = pt.merge(hit, on="pid").merge(fa, on="pid").merge(hid, on="pid")
pt["flag_incomplete"] = pt.n_trials != N_TEST
pt["flag_attention"] = (pt.group == "cue") & (pt.catch_correct < 2)
pt["flag_hits_not_above_fa"] = pt.hit_rate <= pt.fa_rate_new
pt["flag_prior"] = pt.prior == "Yes"
pt["flag_hidden"] = pt.hidden_trials > 0.1 * N_TEST            # tab hidden on more than 10% of test trials
pt["flag_restart_late"] = pt.prior_stage.isin(LATE_STAGES)      # an earlier attempt in this browser had reached the test (test words already seen)
flags = ["flag_incomplete", "flag_attention", "flag_hits_not_above_fa", "flag_prior", "flag_hidden"] + ([] if a.keep_restarts else ["flag_restart_late"])
n_restart = int((pt.attempt > 1).sum())
print(f"restarts (this browser began the study before): {n_restart} of {len(pt)}; earlier attempt had reached the test: {int(pt.flag_restart_late.sum())}"
      + ("  [--keep-restarts: these are kept]" if a.keep_restarts else "  [excluded; run with --keep-restarts for the sensitivity check]"))
print("   by furthest earlier stage:", pt[pt.attempt > 1].prior_stage.value_counts().to_dict(), "| people who say they took part before:", int(pt.flag_prior.sum()), "(also excluded)")
print("optional data-sharing box ticked:", pt.data_sharing.value_counts(dropna=False).to_dict())
print("devices:", pt.device.value_counts().to_dict(), "| how answers were given:", tr.input.value_counts().to_dict(), "(phones and computers differ in timing; use device as a covariate in a sensitivity check)")
pt["excluded"] = pt[flags].any(axis=1)
tr = tr.merge(pt[["pid", "excluded"]], on="pid")

out = Path(a.out)
out.mkdir(exist_ok=True)
tr.to_csv(out / "trials.csv", index=False)
pt.to_csv(out / "participants.csv", index=False)

use = tr[(~tr.excluded) & (~tr.rt_flag)]
print("participants (total / usable):", (len(pt), int((~pt.excluded).sum())),
      f"| trials kept {len(use)} of {len(tr)}")
print("flags:", ", ".join(f"{f[5:]} {int(pt[f].sum())}" for f in flags))
print("distractor accuracy (median):", pt.distractor_acc.median())

cue = use[use.group == "cue"]
COLS = ["HO", "LO", "LN", "HN", "NC"]
if len(cue):
    print("\nP('old') by word kind and condition (HO high-OLD, LO low-OLD, LN low-NEW, HN high-NEW, NC no cue); mean of participant means")
    cell = cue.groupby(["pid", "status", "condition"]).resp_old.mean().groupby(["status", "condition"]).mean().unstack()
    print(cell.reindex(index=KINDS, columns=COLS).round(3).to_string())

# descriptive participant-level tests (the confirmatory mixed models are run in R, see the preregistered analysis plan)
lure_c = cue[cue.status == "lure"].groupby(["pid", "condition"]).resp_old.mean().unstack() if len(cue) else pd.DataFrame()
if len(lure_c) > 2 and set(COLS) <= set(lure_c.columns):
    cl = lambda x: x.clip(0.5 / 3, 1 - 0.5 / 3)
    lg = lambda p: np.log(p / (1 - p))
    val = (lg(cl(lure_c.HO)) + lg(cl(lure_c.LO)) - lg(cl(lure_c.HN)) - lg(cl(lure_c.LN))) / 2
    inter = (lg(cl(lure_c.HO)) - lg(cl(lure_c.LO))) - (lg(cl(lure_c.HN)) - lg(cl(lure_c.LN)))
    print(f"\nlures  H1 valence (logit): mean {val.mean():.2f}, p {stats.ttest_1samp(val, 0).pvalue:.3f}   "
          f"H2 strength x valence (logit): mean {inter.mean():.2f}, p {stats.ttest_1samp(inter, 0).pvalue:.3f}   n={len(val)}")
    diag = lure_c.LO - lure_c.LN
    print(f"H6 diagnostic LO - LN (proportion): mean {diag.mean():.3f} (positive: displayed answer drives; negative: implied votes drive), p {stats.ttest_1samp(diag, 0).pvalue:.3f}")
    for name, cond in (("H3a high-OLD", "HO"), ("H3b high-NEW", "HN")):
        dd = lure_c[cond] - lure_c.NC
        print(f"{name} vs no-cue lures (paired, proportion): mean {dd.mean():+.3f}, p {stats.ttest_1samp(dd, 0).pvalue:.3f}")
if len(cue) > 2:
    allw = cue[cue.status.isin(["lure", "foilW"])].groupby(["pid", "status"]).resp_old.mean().unstack()
    ncw = cue[(cue.condition == "NC") & cue.status.isin(["lure", "foilW"])].groupby(["pid", "status"]).resp_old.mean().unstack()
    print(f"H0 lure vs real foil, all trials: {allw.lure.mean():.3f} vs {allw.foilW.mean():.3f}, paired p {stats.ttest_rel(allw.lure, allw.foilW).pvalue:.3f}"
          f" (by-participant only; the item-level test is in the R models)")
    if len(ncw.dropna()) > 2:
        print(f"   no-cue trials only: {ncw.lure.mean():.3f} vs {ncw.foilW.mean():.3f}")
print("\nmedian RT (ms) by kind:", use.groupby("status").rt.median().round(0).to_dict())
print("wrote", out / "trials.csv", "and", out / "participants.csv")
