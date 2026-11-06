# Word memory study: the online app

Online version of the experiment: a study list of 15 pseudowords and 10 real words, a 60 s shape task, then a 60-word OLD/NEW test in which most words carry a simulated "others' answers" cue (9 or 2 of 10 said OLD or NEW; one word in five has no cue, a within-person baseline). Every word comes from the Appendix of Bowers, Davis & Hanley (2005). The full design document, reasoning and power simulations are kept outside this repository.

## Two engines, one design
Same stimuli, same counterbalancing code (`docs/shared.js`), same questionnaires, same saved data format. **Use only one engine for the whole sample** (mixing them would be a confound).

| | Standard library: `docs/jspsych/` | Custom: `docs/` (index.html) |
|---|---|---|
| Built on | jsPsych 7.3.4 and its standard plugins (pinned copy in `docs/jspsych/lib/`, no CDN) | Plain JS written for this study |
| Why pick it | Published, widely used toolkit; timing and RT come from the standard plugin; easiest to defend to a prof who likes standardisation | Also lets people answer by clicking; fewer moving parts |
| Answers | Keyboard F / J only | F / J or buttons |

Link to give participants: `https://<user>.github.io/<repo>/jspsych/` (standard) or `https://<user>.github.io/<repo>/` (custom).

## Where the page and the data can live
GitHub Pages only serves files, so something else must receive the data.

| Route | Page | Data | Notes |
|---|---|---|---|
| **A. github.io + Google Apps Script** (set up here) | GitHub Pages | Google Sheet + Drive folder | No server to run. Steps below and in `backend/README.md`. Tested here against a mock of the Apps Script contract, **not** against a live Google deployment |
| B. Python server | `python server.py` on a laptop (plus a tunnel), VPS or IIIT-H server | `data/` folder | Simplest to control; the machine must stay up |
| C. JATOS or Pavlovia (standard research hosts) | Upload the `docs/jspsych/` page as a study | Their database | Not wired up: the save call would need a few lines for their API (`jatos.submitResultData`, or the Pavlovia plugin). Ask me if you pick this |
| D. Gorilla, Qualtrics, PsychoPy | Rebuild in their editor | Their export | Use the fixed lists in `trial_lists/` (`study.csv`, `test_v0..v4.csv`: word, kind, condition, cue text, correct answer). Check pricing and IIIT-H licences yourself |

## Run it locally
```
cd app
python server.py                 # http://127.0.0.1:8000  (custom)   and  /jspsych/  (jsPsych)
```
Test mode, no real data (saved as `data/dev_*.json`): add `?dev=1`. `&fast=1` runs timers 50x faster; `?bot=1` auto-plays a whole session; `&v=0..3&k=0|1` force version and key map.

## Publish on github.io (route A)
1. Do the Apps Script setup in `backend/README.md`; paste its `/exec` URL into `docs/config.js` as `backend`.
2. Create a **public** GitHub repository. In the `app/` folder:
```
git init
git add .
git commit -m "word memory study"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```
3. Repo Settings > Pages > Build and deployment > Deploy from a branch > `main` and `/docs` > Save. After a minute the site is at `https://<user>.github.io/<repo>/`.
4. Open `https://<user>.github.io/<repo>/jspsych/?dev=1&bot=1` and check that a `dev_*.json` file reaches the Drive folder.
Real data never go into the repo (`data/` is git-ignored). Do not change files during data collection (Pages caches for a few minutes).

## Before real participants (the app refuses to run until you do the first two)
1. `docs/content/consent.html` is drafted from your submitted consent form and updated to the final procedure. Resolve its 3 yellow `[CONFIRM]` notes (compensation, open data sharing), then delete the marker comment on its first line.
2. `docs/content/debrief.html` is written (keep `{{CODE}}`); read it once and edit anything that does not fit.
3. Stimuli: already built from the paper (`tools/pairs.csv` lists the 15 lure pairs; rebuild with `python tools/build_stimuli.py`, no internet needed). Read the printed list.
4. Run the automated checks (Chrome and `pip install websocket-client`): `python tools/selftest.py`, `python tools/selftest.py --engine jspsych`, and with `--mock` for the GitHub-Pages path. Each plays 8 bot sessions (7 cue-version, 1 optional control) through headless Chrome and checks the saved data against the design (60 trials, five word kinds, balanced cells, rotation across 5 versions).
5. Pilot with a few people, check timing and false-recognition rates, then freeze `config.js` and `stimuli.json`.

## Data
One JSON file per completed participant (`WM-XXXXXXXX.json`; `dev_*` = test). Nothing from the task is saved if a participant quits. A separate anonymous stage-only log (`progress.jsonl`, or the `progress` tab of the Apps Script sheet; no answers, timings or identity) records how far each session got, including Quit and closed tabs, and `summarise.py` reports where people dropped out (for the Apps Script tab, export it as `data/progress.csv`). Put the files in `data/` (from the Drive folder, or written there by `server.py`), back them up, then:
```
python tools/summarise.py        # writes analysis/trials.csv and participants.csv, prints the cell table
```

## Where things are
| File | What |
|---|---|
| `docs/config.js` | timings, cue values (`cueHigh`, `cueLow`), catch trials, data `backend`, all instruction wording |
| `docs/shared.js` | counterbalancing, cue assignment, questionnaires, helpers (used by both engines) |
| `docs/experiment.js`, `docs/jspsych/experiment-jspsych.js` | the two engines |
| `docs/stimuli.json` | items (built by `tools/build_stimuli.py`; QC list in `tools/stimuli_report.csv`) |
| `tools/bowers2005_appendix.csv`, `tools/pairs.csv` | the paper's 39 valid pairs; the 12 used |
| `trial_lists/` | fixed trial lists for other platforms (`tools/export_trial_lists.py`) |
| `backend/` | Google Apps Script data inbox for github.io |
| `server.py` | Python static server + data inbox (route B) |
| `tools/selftest.py`, `tools/summarise.py`, `tools/mock_apps_script.py` | automated check, data flattening, test stand-in |
