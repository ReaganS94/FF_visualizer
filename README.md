# FF Linden Einsatzstatistik

Visualizes the alarms (Einsätze) of the Freiwillige Feuerwehr Hannover-Linden, taken from the public
[Aktivitätenliste](https://www.ff-linden.de/veranstaltungsliste/).

- `scraper/scrape.py`: reads the activity table and merges new rows into `docs/data/alarms.json`.
  Standard library only. Rows are never deleted, and exact duplicates are skipped.
- `.github/workflows/scrape.yml`: runs the scraper daily and commits when there are new alarms.
  It can also be started by hand under Actions → "Einsätze aktualisieren" → Run workflow.
- `docs/`: the static site (no build step). Views: overview, calendar, time of day, keywords,
  districts, searchable list, and an "Einsatz heute?" estimate that is explicitly only a guess.

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
- "vs" (Wachbesetzung, standby) is excluded unless the checkbox is ticked.
- A day with 10 or more alarms is a "Großlage" (e.g. the storm on 14.07.2026). Those rows were entered with the
  placeholder time 00:00, so they are left out of the time-of-day charts.

## How "Einsatz heute?" works

Comparable days are past days with the same weekday within one month of today's month (all
same weekdays if there are fewer than 20). The page shows the share of those days that had at least
one alarm during the day (06–22) and at night (22–06). It is a rough guess, not a forecast.
