# Where the data comes from

[Back to the README](../README.md)

The alarms come from the public [Aktivitätenliste](https://www.ff-linden.de/veranstaltungsliste/) of the
FF Linden website. The job "Update data" (`.github/workflows/scrape.yml`) fetches it twice a day, together
with the weather, the Hannover 96 home games and the map positions of new streets, and commits the files in
`web/public/data/`. It can also be started by hand under Actions → "Update data" → Run workflow.

- `scraper/scrape.py`: reads the activity table and syncs it into `web/public/data/alarms.json`. Standard
  library only. For each fetched year the site's rows replace ours, so corrections on the site don't
  leave duplicates; if the site suddenly shows far fewer rows for a year, nothing is removed.
- `scraper/weather.py`: daily weather for Hannover from Open-Meteo into `web/public/data/weather.json`, including the
  forecast for today and the next six days and a weather code per day for the outlook's symbols (if the codes
  can't be loaded, the rest is saved without them).
- `scraper/geocode.py`: looks up each street once via OpenStreetMap Nominatim, cached in `web/public/data/geo.json`. Streets Nominatim can't match (typos, crossings like "NieschlagS/WittekindS", a different district) are retried with Photon, which tolerates typos; its answer only counts if the name is close and the place is in Hannover.
- `scraper/football.py`: Hannover 96 home games from OpenLigaDB into `web/public/data/heimspiele.json`.
- `web/public/data/manual.json`: the hand entries from the admin page, see [admin.md](admin.md).

## Things to update by hand

- `web/public/data/keywords.json`: names and groups for the keyword codes. Edit it directly on GitHub to fix a
  name.
- `web/public/data/ferien.json`: school holidays in Lower Saxony (first and last day). Add the next school year
  once a year from the Kultusministerium's list.

## Data cleaning

Done in the browser, in `web/src/lib/alarms.js` and `web/src/data.js`.

- Only rows with category "Einsatz" are shown.
- An alarm listed twice (same date, time, keyword and street) is counted once.
- "Strasse" and "Str." are shown as "Straße", so one street spelled two ways is grouped and found as one.
  Map positions stay stored under the original spelling; a new spelling falls back to the known one.
- "vs" (Wachbesetzung, standby) is excluded unless the checkbox is ticked.
- The website's list is sometimes weeks behind. Everything that counts days without alarms (estimate,
  backtest, weather view) stops at the day before its newest alarm; the Jahresrückblick comparison, the weekly
  average and the calendar stop at that day itself. The page says how far the list reaches when it's more than
  two days behind. A year counts as complete only once the website lists an alarm from 31.12. or later.
- The weather view leaves out 31.12 and 01.01 (Silvester): the fireworks bring many alarms whatever the
  weather, and two stormy Neujahr days (2025 and 2026) made days with gusts of 60–80 km/h look twice as busy
  as calm days. Without them those days average 0.41 alarms against 0.53.
- A day with 10 or more alarms is a "Großlage" (e.g. the storm on 14.07.2026), except 01.01, which Silvester
  fills every year. The storm's rows were entered with the placeholder time 00:00, so they are left out of the
  time-of-day charts. The Jahresrückblick has its own "Großlagen mitzählen" checkbox and names the Großlage days.

## Publishing

The "Publish site" workflow (`.github/workflows/deploy.yml`) builds the site and publishes it on GitHub Pages
after every change to `main` and after every data update. Actions → "Publish site" → Run workflow publishes by
hand. It needs Settings → Pages → Build and deployment → Source: "GitHub Actions". The admin page has its own
workflow, "Publish admin page", see [admin.md](admin.md).

To fetch alarms by hand: `python scraper/scrape.py` (the current year), `--all` (the full history) or
`--file x.html` (a page saved from the browser).
