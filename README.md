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
data/manifest.json     list of months published on GitHub Pages
data/months/2026-07.json   one month's data (sample: your July report)
```

## 1. Host it on GitHub Pages

1. Create a new GitHub repository (e.g. `caw-dashboard`).
2. Upload `index.html`, `app.js`, and the whole `data/` folder to the repo root.
3. In the repo, go to **Settings → Pages**, set **Source** to your default
   branch (`main`) and folder `/ (root)`, then save.
4. GitHub will publish it at `https://<your-username>.github.io/caw-dashboard/`.

That's it — the page is fully static (HTML/CSS/JS), so no server setup is needed.

## 2. Admin access (Data & Upload tab)

The **Data & Upload** tab is hidden from ordinary visitors. Only someone who
enters the admin password can see it and use the upload/export tools —
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
the tab. It's meant to keep the upload tools out of the way of the public,
not to be bulletproof security. Note also that a visitor uploading a file
through their *own* browser only affects what *they* see locally — it can
never change what's published to everyone else. Only pushing files to the
GitHub repo (Section 3) does that, and that already requires real GitHub
repo access.

## 3. Your monthly workflow

Every month, once you have the new "District / Mandal / Location Wise
Analysis Report" Excel file:

1. Open the live dashboard → **Data & Upload** tab.
2. Drag the `.xlsx` file into the upload box (or click to choose it).
3. Confirm the reporting month in the popup that appears.
4. The dashboard immediately shows that month's numbers, and folds it into
   the Quarter/Year rollups — this happens instantly in your browser.

This local upload is enough for **your own** browsing session, but it only
lives in that browser. To make the new month visible to everyone who visits
your GitHub Pages link (and to keep the history safe long-term), publish it:

5. Still on the **Data & Upload** tab, click **Export JSON** next to that
   month — it downloads a file like `2026-08.json`.
6. In your GitHub repo, add that file to `data/months/`.
7. Open `data/manifest.json` and add the new month key to the `months` list, e.g.:
   ```json
   { "months": ["2026-07", "2026-08"] }
   ```
   (Tip: the **Export manifest.json** button on the same tab regenerates this
   file automatically from everything currently loaded, so you can just
   download and replace it instead of hand-editing.)
8. Commit and push both files. GitHub Pages updates within a minute or two.

From then on, everyone who opens the dashboard sees every published month —
no re-uploading needed on their end.

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

- All parsing and storage happens client-side (SheetJS for reading `.xlsx`,
  `localStorage` for keeping your uploads between visits). Nothing is
  uploaded to any server other than GitHub Pages hosting the static files.
- With only one month loaded, Month/Quarter/Year will show identical numbers
  — that's expected, and resolves itself as more months are published.
