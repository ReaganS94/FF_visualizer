# FF Linden Einsatzstatistik

Visualizes the alarms (Einsätze) of the Freiwillige Feuerwehr Hannover-Linden, taken from the public
[Aktivitätenliste](https://www.ff-linden.de/veranstaltungsliste/).

- `scraper/scrape.py`: reads the activity table and syncs it into `docs/data/alarms.json`. Standard
  library only. For each fetched year the site's rows replace ours, so corrections on the site don't
  leave duplicates; if the site suddenly shows far fewer rows for a year, nothing is removed.
- `.github/workflows/scrape.yml`: runs the scrapers twice a day and commits the data.
  It can also be started by hand under Actions → "Einsätze aktualisieren" → Run workflow.
- `scraper/weather.py`: daily weather for Hannover from Open-Meteo into `docs/data/weather.json`.
- `scraper/geocode.py`: looks up each street once via OpenStreetMap Nominatim, cached in `docs/data/geo.json`. Streets Nominatim can't match (typos, crossings like "NieschlagS/WittekindS", a different district) are retried with Photon, which tolerates typos; its answer only counts if the name is close and the place is in Hannover.
- `docs/`: the static site (no build step). Views: overview, calendar, time of day, keywords, districts,
  map (with a time-lapse that plays the alarms in date order), weather, searchable list, annual report, and an
  "Einsatz heute?" estimate that is explicitly only a guess.
- `docs/data/keywords.json`: names and groups for the keyword codes. Edit it directly on GitHub to fix a name.
- `docs/admin.html`: form for adding alarms before the website lists them (see below).
- `docs/manifest.webmanifest` and `docs/icons/`: let phones add the site to the home screen as an app (icon source: `icons/icon.svg`).

## Admin page

`/admin.html` saves alarms into `docs/data/manual.json` via the GitHub API. It needs a fine-grained personal
access token limited to this repository with "Contents: Read and write"; the token is stored only in that
browser. A manual entry is ignored once the website lists an alarm on the same day with the same keyword
within an hour of it, so nothing is counted twice.
The street field suggests the spellings the website uses, and "Strasse" or "Str." is saved as "Straße".
Entries can be edited in place (one commit). Before saving, the page asks for confirmation if the same keyword
within an hour is already on the website or among the hand entries.

## Run locally

```sh
python scraper/scrape.py              # fetch the current year
python scraper/scrape.py --all        # fetch the full history
python scraper/scrape.py --file x.html  # import a page saved from the browser
cd docs && python -m http.server      # then open http://localhost:8000
```

## Publish

Settings → Pages → Build and deployment → "Deploy from a branch" → `main` / `/docs`.

## Data cleaning (done in the browser, see `docs/app.js`)

- Only rows with category "Einsatz" are shown.
- An alarm listed twice (same date, time, keyword and street) is counted once.
- "Strasse" and "Str." are shown as "Straße", so one street spelled two ways is grouped and found as one.
  Map positions stay stored under the original spelling; a new spelling falls back to the known one.
- "vs" (Wachbesetzung, standby) is excluded unless the checkbox is ticked.
- The website's list is sometimes weeks behind. Everything that counts days without alarms (estimate,
  backtest, weather view, the Jahresrückblick comparison) stops at the day before its newest alarm, and the
  page says how far the list reaches when it's more than two days behind.
- A day with 10 or more alarms is a "Großlage" (e.g. the storm on 14.07.2026), except 01.01, which Silvester
  fills every year. The storm's rows were entered with the placeholder time 00:00, so they are left out of the
  time-of-day charts. The Jahresrückblick has its own "Großlagen mitzählen" checkbox and names the Großlage days.

## How "Einsatz heute?" works

Comparable days are past days with the same weekday within one month of today's month (all
same weekdays if there are fewer than 20). The page shows the share of those days that had at least
one alarm during the day (06–22) and at night (22–06). It is a rough guess, not a forecast.

The page shows the estimate for the current window in the middle of a 24-hour ring. Each hour of the
ring is shaded by how many alarms happened at that time of day since the data starts, and a hand
marks the current time. Below the tiles, a small table compares yesterday's day and night estimate
with the alarms entered since. One day proves nothing either way; the backtest table is the real check.

Silvester night (31.12., 22–06) is busy every year (20 alarms in 2024, 14 in 2025), so it gets no
percentage. On 31.12. the page shows how many alarms the same night had in earlier years, and that
night is left out when estimating ordinary nights and in the backtest. More such nights can be
added to `SPECIAL_NIGHTS` in `docs/app.js`.
