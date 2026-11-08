# Data inbox for GitHub Pages (Google Apps Script)

GitHub Pages only serves files; it cannot store what participants submit. This 100-line script is the inbox: the website stays on github.io, the script only receives the data and balances the versions. (Hosting the whole app inside Apps Script is worse: it runs the page in a sandboxed iframe, adds Google's banner, and is slower.)

## One-time setup (about 10 minutes)
1. Make a Google Sheet (name it e.g. `wm-study`). Use the Google account that should own the data.
2. Extensions > Apps Script. Delete the sample code, paste all of `Code.gs`, save.
3. Select the function `setup` and Run. Accept the permission prompts (Sheets and Drive). It creates the tabs and a Drive folder `wm_study_data`.
4. Deploy > New deployment > type **Web app**. Execute as: **Me**. Who has access: **Anyone**. Deploy and copy the URL that ends in `/exec`.
   - If "Anyone" is not offered, your institute's Google Workspace blocks public web apps: use a personal Google account for the script instead (and say so in the IRB form), or ask IT.
5. Paste that URL into `docs/config.js` as `backend: "https://script.google.com/macros/s/.../exec"`.
6. Test: open your github.io page with `?dev=1414&bot=1&backend=<the same URL>` (test mode lets the URL override the backend). After about 10 seconds a `dev_WM-....json` file should be in the Drive folder and a row in the `done` tab.

After changing `Code.gs` you must make a **new deployment version** (Deploy > Manage deployments > edit > New version), otherwise the old code keeps running.

## Getting the data out
Download the Drive folder `wm_study_data`, drop the files into `app/data/`, then `python tools/summarise.py`. Delete or ignore `dev_*` files.

## Things to state in the IRB form
- Data are stored in Google Drive/Sheets under the owner's account (not an institute server).
- The script cannot see IP addresses, but GitHub (hosting) and Google keep their own server logs.
- The web-app URL is visible in the page source, so anyone could send junk to it. Real submissions are told apart by the schema check, the attention checks and `devMode: false`; delete the rest.

## Limits
Apps Script free quotas are far above what 100 participants need. It is a cheap, working option rather than a robust one: do not edit the deployment during data collection, and download a backup of the folder after each batch.
