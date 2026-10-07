# FF Linden Einsatzstatistik

Visualizes the alarms (Einsätze) of the Freiwillige Feuerwehr Hannover-Linden, taken from the public
[Aktivitätenliste](https://www.ff-linden.de/veranstaltungsliste/).

- `scraper/scrape.py`: reads the activity table and syncs it into `docs/data/alarms.json`. Standard
  library only. For each fetched year the site's rows replace ours, so corrections on the site don't
  leave duplicates; if the site suddenly shows far fewer rows for a year, nothing is removed.
- `.github/workflows/scrape.yml`: runs the scrapers twice a day and commits the data.
  It can also be started by hand under Actions → "Einsätze aktualisieren" → Run workflow.
- `scraper/weather.py`: daily weather for Hannover from Open-Meteo into `docs/data/weather.json`, including the
  forecast for today and the next six days and a weather code per day for the outlook's symbols (if the codes
  can't be loaded, the rest is saved without them).
- `scraper/geocode.py`: looks up each street once via OpenStreetMap Nominatim, cached in `docs/data/geo.json`. Streets Nominatim can't match (typos, crossings like "NieschlagS/WittekindS", a different district) are retried with Photon, which tolerates typos; its answer only counts if the name is close and the place is in Hannover.
- `docs/`: the static site (no build step). Views: overview, dot wall (every alarm one dot, regrouped by month,
  type, district or hour with the dots moving to their new places), calendar, year spiral (one turn per year,
  one piece per day, the same date at the same angle every year), time of day, keywords, districts, repeat addresses
  (streets with three or more alarms, and fire alarm systems that go off more than once),
  map (with a time-lapse that plays the alarms in date order), Einsatzradius (see below), weather, searchable list, annual report (with a
  year comparison and the year as a story, see below), and an "Einsatz heute?" estimate that is explicitly only a guess.
- `docs/data/keywords.json`: names and groups for the keyword codes. Edit it directly on GitHub to fix a name.
- `docs/admin.html`: form for adding alarms before the website lists them (see below).
- `docs/manifest.webmanifest` and `docs/icons/`: let phones add the site to the home screen as an app (icon source: `icons/icon.svg`).

## Admin page

`/admin.html` saves alarms into `docs/data/manual.json` via the GitHub API. It needs a fine-grained personal
access token limited to this repository with "Contents: Read and write"; the token is stored only in that
browser. A manual entry is ignored once the website lists an alarm with the same keyword within an hour of
it, so nothing is counted twice. Each website alarm stands in for at most one hand entry (closest in time
first), so two alarms with the same keyword within an hour both stay until the website lists both.
The street field suggests the spellings the website uses, and "Strasse" or "Str." is saved as "Straße".
Entries can be edited in place (one commit). Before saving, the page asks for confirmation if the same keyword
within an hour is already on the website or among the hand entries.
Each entry's status is "auf der Website" once matched, "nur hier" while the website hasn't reached it, and
"bitte prüfen" when the website already lists later alarms but none matching this one (probably written with
another keyword or time; then it would count twice). On the statistics page, hand entries that
aren't matched yet are called "vorläufig" (tag in the list and on the "Letzter Einsatz" tile, and in the notes).

## Jahresrückblick

- "Jahresvergleich": one line per year with the alarms added up from 01.01. The chosen year is blue, the others
  grey, each with its total at the end. A running year's line stops at the website's newest alarm, the same cut
  the "+x %" tile uses. Hovering shows every year's count on that date.
- "Das Jahr als Story": full-screen cards to tap or swipe through (total, busiest day, busiest hour, night share,
  most common keyword, top places, longest quiet spell, comparison with the previous year, summary). Each card is
  sized for a phone screenshot and names the year, plus "Ohne Großlagen" and "Stand …" where that applies. The
  phone's back button closes it. The longest quiet spell always counts Großlage days as busy and stops at the
  website's newest alarm.
- Both follow the "Großlagen mitzählen" checkbox of the Jahresrückblick.

## Einsatzradius

A line from the Wache (Teichstraße 8) to every alarm with a known address, over a grey OpenStreetMap map
(dark in dark mode), with rings every 1, 2, 5 or 10 km depending on the zoom. "Abspielen" sends the lines out
in date order, and the tiles and the "Wie weit weg?" bars count along. Distances are straight lines, not
driving routes. The Wache's position (`WACHE` in `app.js`) is the middle of two map services' positions for
the address, which are 25 m apart. The view follows the filters above it.

## Mythen-Check

Tests popular beliefs (full moon, Friday the 13th, public holidays, school holidays, Hannover 96 home games,
days of 30 °C or more, weekends, and Silvester as a known "yes") against the alarms. The days of a myth are
compared with similar days: the same weekday at most 30 days from the same date in any year (weekends are
compared with weekdays of the same time of year, Silvester with any day around the turn of the year). For
every myth day one similar day is drawn at random, 2000 times over, which shows how far the average moves by
chance alone (the grey bar holds the middle 95 %). The card says "Stimmt" when chance reaches the myth days'
average in fewer than 2.5 % of the draws, "Vielleicht" below 10 %, and "Zu wenige Tage" under 10 days.
Großlage days and "vs" are always left out, and 01.01 only counts for Silvester.

- Full moons and public holidays in Lower Saxony are computed in the browser.
- `docs/data/ferien.json`: school holidays in Lower Saxony (first and last day). Add the next school year once
  a year from the Kultusministerium's list.
- `docs/data/heimspiele.json`: dates of Hannover 96 home games in the league. `scraper/football.py` refreshes
  the current and the previous season from OpenLigaDB in the daily job; a season it can't load stays as it is.

## Quiz "Schätz mal"

Ten questions per round, drawn at random from 38 kinds that are built from the data, so the answers stay
current: totals per year, per month and so far, this year against the last, the busiest and quietest month,
the busiest day, hour and weekday, the month of the 100th alarm, Silvester (alarms on Neujahr and the minutes
until the first one), the night and weekend shares, fires by time of day, keywords, districts (and the share
in Linden itself), streets and fire alarm systems, the reasons for alarms, distances from the Wache, the
weather with the most alarms, the longest pause and streak, days with an alarm, the average gap between
alarms, and one myth from the Mythen-Check. A round asks at most one question per topic, so a chart can't give
away a later answer, and the kinds from the round before come last, so playing again brings new questions.
Numbers are guessed with a slider: 2 points within 10 % (±5 points for percentages, ±2 minutes for the
Silvester minutes), 1 point within 25 % (±10 points, ±5 minutes). Every other correct answer gives 2 points.
After each answer the page shows the real number with a small chart. Nothing is saved. Keys 1–4 answer, Enter
goes on, and the "Vollbild" button shows the quiz full screen on a TV or projector (not offered where the
browser can't, e.g. on iPhones). "vs" is always left out.

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
  backtest, weather view) stops at the day before its newest alarm; the Jahresrückblick comparison, the weekly
  average and the calendar stop at that day itself. The page says how far the list reaches when it's more than
  two days behind. A year counts as complete only once the website lists an alarm from 31.12. or later.
- The weather view leaves out 31.12 and 01.01 (Silvester): the fireworks bring many alarms whatever the
  weather, and two stormy Neujahr days (2025 and 2026) made days with gusts of 60–80 km/h look twice as busy
  as calm days. Without them those days average 0.41 alarms against 0.53.
- A day with 10 or more alarms is a "Großlage" (e.g. the storm on 14.07.2026), except 01.01, which Silvester
  fills every year. The storm's rows were entered with the placeholder time 00:00, so they are left out of the
  time-of-day charts. The Jahresrückblick has its own "Großlagen mitzählen" checkbox and names the Großlage days.

## How "Einsatz heute?" works

Day (06–22): the share of past days with the same weekday that had at least one alarm during the day,
blended with the average of all days as if 10 average days were added. When 30 °C or more is forecast,
that value is blended again with the share of past days that hot. Night (22–06): the share of all past
nights with an alarm, the same for every night. It is a rough guess, not a forecast.

This was chosen on 01.10.2026 by replaying every day and night from July 2024 with only the alarms up to
two days earlier and comparing about 20 rules (Brier score). Weekday plus heat was the only day rule clearly
better than the old one (same weekday within one month of the date). At night no rule beat the plain
average, because the weekday and season patterns at night changed from one year to the next. Days with
gusts of 60 km/h or more had an alarm no more often than other days, so a storm only adds a note to the
page and does not change the percentage.

The page shows the estimate for the current window in the middle of a 24-hour ring. Each hour of the
ring is shaded by how many alarms happened at that time of day since the data starts, and a hand
marks the current time. Below the tiles, a small table compares yesterday's day and night estimate
with the alarms entered since. One day proves nothing either way; the backtest below is the real check.

The backtest replays the estimate for every day and night from six months after the data starts,
using only alarms up to two days earlier. The page shows it as three pictures of 100 dots: estimates under
10 %, 10–30 % and from 30 %, each with how many of 100 such days or nights really had an alarm (the group
today's estimate falls into is marked), plus a short verdict. The detailed table (0–10 %, 10–20 %, …, with
a "Passt?" column: Ja, zu niedrig, zu hoch, or too few cases below 50) sits behind "Genaue Zahlen".

"Die nächsten 7 Tage" shows the forecast for today and the next six days: a symbol (sun, cloud, rain, snow,
fog, thunderstorm), the highest and lowest temperature as a band coloured from cold blue to hot red, the
strongest gusts, and the day estimate as a small ring (darker = higher). Days of 30 °C or more glow orange;
days with gusts of 60 km/h or more or a thunderstorm are tinted violet, with a little movement (switched off
when the device asks for less motion). Days further ahead fade, because the forecast gets less sure. Notes
above it name the hot and stormy days and say how often past days with that weather had an alarm, against
the other days; only the temperature changes the estimate. A thunderstorm after tomorrow says "möglich".

"Warnungen für Hannover", above the ring, lists the current official warnings. Each visitor's browser loads
them when the page opens and again every 5 minutes while it stays open; nothing is stored in the repository.
Weather warnings of the Deutscher Wetterdienst for the city (warn cell "Stadt Hannover", 803241001) come from
Bright Sky (`api.brightsky.dev/alerts` at the Wache's position), which lets any website load them. Other
warnings for the Region Hannover (civil protection, floods, police, Katwarn, Biwapp) come from the NINA
dashboard (`warnung.bund.de/api31/dashboard/032410000000.json`); NINA's copies of the weather warnings are
skipped unless Bright Sky couldn't be loaded. NINA publishes no terms for this and may refuse to be loaded
by other websites; the box then says where to find those warnings instead. Warnings are sorted by level
(Stufe 1–4 in yellow, orange, red and violet, as on the DWD's map), expired and lifted ones are left out,
and the DWD is credited as its terms require. The warnings don't change the percentage.

Silvester night (31.12., 22–06) is busy every year (20 alarms in 2024, 14 in 2025), so it gets no
percentage. On 31.12. the page shows how many alarms the same night had in earlier years, and that
night is left out when estimating ordinary nights and in the backtest. More such nights can be
added to `SPECIAL_NIGHTS` in `docs/app.js`.
