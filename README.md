# Crime Against Women — Public Feedback Dashboard

A static, GitHub-Pages-ready dashboard for Chittoor District Police's monthly
"District / Mandal / Location Wise Analysis Report" (public feedback on crime
against women). It turns each month's Excel upload into Month / Quarter / Year
performance views, police-station rankings, a Mandal comparison, trend lines,
and a heatmap — all computed in the browser, no backend required.

## Files

```
index.html            the dashboard (open this)
app.js                 all the logic: parsing, scoring, charts, tabs
data/                  put each month's raw .xlsx report straight in here
```

## 1. Host it on GitHub Pages

1. Create a new GitHub repository (e.g. `caw-dashboard`, or `<username>.github.io`
   for a root-domain site).
2. Upload `index.html`, `app.js`, and the `data` folder to the repo root.
3. In the repo, go to **Settings → Pages**, set **Source** to your default
   branch (`main`) and folder `/ (root)`, then save.
4. GitHub will publish it at your Pages URL.

That's it — the page is fully static (HTML/CSS/JS), so no server setup is needed.

## 2. Admin access (Data & Upload tab)

The **Data & Upload** tab is hidden from ordinary visitors. Only someone who
enters the admin password can see it and use the local-preview upload tool —
everyone else just sees the read-only dashboard tabs (Overview, PS Rankings,
Heatmap, PS Detail, Methodology).

- Click **🔒 Admin Login** in the top bar and enter the password.
- The default password is `Chittoor@CAW2026`. **Change this before you
  publish the site** — anyone who reads `app.js` (which is public on GitHub
  Pages, like all client-side code) can see the current password if you
  leave it as-is.
- To change it: pick a new password, then run this once (Node.js) to get
  its hash:
  ```
  node -e "console.log(require('crypto').createHash('sha256').update('YOUR-NEW-PASSWORD').digest('hex'))"
  ```
  Copy the printed hash into the `ADMIN_HASH` constant near the top of
  `app.js`, replacing the existing value. Commit & push.
- Once unlocked, admin status is remembered in that browser (via
  localStorage) until you click **🚪 Logout**.

**Important limitation:** this is a static site with no server, so this gate
only *hides the button* from casual visitors — it cannot stop someone
determined from reading the password hash in `app.js` and trying to crack
it offline, or from editing the page's own code in their browser to reveal
the tab.

## 3. Your monthly workflow

Every month, once you have the new "District / Mandal / Location Wise
Analysis Report" Excel file:

1. In your GitHub repo, open the `data` folder → **Add file → Upload files**.
2. Upload the `.xlsx` file as-is — no renaming or conversion needed. Just
   make sure the month name (or a 3-letter abbreviation) and the year both
   appear somewhere in the filename, e.g.:
   - `PPP_Crime Against Women_July2026.xlsx`
   - `PPP_Crime Against Women_Aug2026.xlsx`
3. Commit. GitHub Pages rebuilds within a minute or two.

That's the whole workflow — **no export step, no manifest file to edit.**
On every page load, the dashboard asks the GitHub API what's inside the
`data` folder, downloads every `.xlsx`/`.xls` file it finds, and parses each
one in the visitor's browser. Anyone who opens the site sees every month
that's currently sitting in `data/` — no re-uploading needed on their end.

If a file's month can't be worked out from its filename, it's silently
skipped (check the browser console for a warning) — just make sure a month
name/abbreviation and a 4-digit year both appear in the filename.

You can still use the **Data & Upload** tab (admin-only) to preview a file
locally in your own browser before publishing it, and it has an **Export
JSON** button as an optional backup/debugging format — but for normal
monthly publishing you don't need either.

## 4. Expected Excel format

One sheet with a header row containing `Mandal`, `Location`, `Total`, and one
column pair per feedback question, headed:

```
<question text> +ve(%)
<question text> -ve(%)
```

Column order, exact question wording, and the number of questions can change
between months — the app detects the `+ve(%)` / `-ve(%)` pairs from the
header text automatically, so you don't need to keep the layout identical
forever, just keep those markers in the headers.

## 5. How the scores are calculated

- **Per station, per question**: taken straight from the uploaded file.
- **Combining months** (quarter/half-year/year): all station rows across
  the months in that window are pooled, and a response-weighted average
  (weighted by the `Total` respondent count) is taken per question — so a
  station with more responses counts proportionally more.
- **Overall score**: the plain average of the per-question positive
  percentages for that period.
- **Rankings**: stations/mandals ranked by that overall score for the
  selected period.

See the **Methodology** tab in the dashboard itself for the same explanation,
written for anyone viewing the live site.

## Notes

- All parsing happens client-side (SheetJS for reading `.xlsx`). The list of
  files in `data/` is fetched from the public GitHub API
  (`api.github.com/repos/<owner>/<repo>/contents/data`), and each file is then
  downloaded and parsed in the browser. Nothing is uploaded to any server
  other than GitHub itself.
- This auto-discovery only works once the site is actually live at a
  `*.github.io` address (it reads the current hostname to figure out which
  repo to query) — opening `index.html` locally via `file://` will show 0
  GitHub-published months, which is expected.
- With only one month loaded, Month/Quarter/Year will show identical numbers
  — that's expected, and resolves itself as more months are published.
