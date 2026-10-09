# FF Linden Einsatzstatistik

Visualizes the alarms (Einsätze) of the Freiwillige Feuerwehr Hannover-Linden, taken from the public
[Aktivitätenliste](https://www.ff-linden.de/veranstaltungsliste/).

- `scraper/scrape.py`: reads the activity table and syncs it into `web/public/data/alarms.json`. Standard
  library only. For each fetched year the site's rows replace ours, so corrections on the site don't
  leave duplicates; if the site suddenly shows far fewer rows for a year, nothing is removed.
- `.github/workflows/scrape.yml`: runs the scrapers twice a day and commits the data.
  It can also be started by hand under Actions → "Update data" → Run workflow.
- `scraper/weather.py`: daily weather for Hannover from Open-Meteo into `web/public/data/weather.json`, including the
  forecast for today and the next six days and a weather code per day for the outlook's symbols (if the codes
  can't be loaded, the rest is saved without them).
- `scraper/geocode.py`: looks up each street once via OpenStreetMap Nominatim, cached in `web/public/data/geo.json`. Streets Nominatim can't match (typos, crossings like "NieschlagS/WittekindS", a different district) are retried with Photon, which tolerates typos; its answer only counts if the name is close and the place is in Hannover.
- `web/`: the site. Vite builds it into `dist/`, which the "Publish site" workflow publishes (see
  Publish below). Views: overview, dot wall (every alarm one dot, regrouped by month,
  type, district or hour with the dots moving to their new places), calendar, year spiral (one turn per year,
  one piece per day, the same date at the same angle every year), time of day, keywords, districts, repeat addresses
  (streets with three or more alarms, and fire alarm systems that go off more than once),
  map (with a time-lapse that plays the alarms in date order), Einsatzradius (see below), weather, searchable list, annual report (with a
  year comparison and the year as a story, see below), and an "Einsatz heute?" estimate that is explicitly only a guess.
  Current official warnings for Hannover show on Übersicht, or at the very top of every tab when one needs
  attention (see Warnungen below).
- `web/index.html` and `web/src/`: the page and its code, see "Where is what" below.
- `web/public/data/keywords.json`: names and groups for the keyword codes. Edit it directly on GitHub to fix a name.
- `web/admin.html` and `web/src/admin.js`: form for adding alarms before the website lists them (see below).
- `web/public/`: files published as they are: the data in `web/public/data/` (written by the jobs above and the
  admin page), the icons and the app manifest.
- `web/public/manifest.webmanifest` and `web/public/icons/`: let phones add the site to the home screen as an app
  (icon source: `icons/icon.svg`). On phones and tablets, Übersicht shows an "Als App speichern" button while the
  site isn't saved yet. On Android (Chrome, Edge, Samsung Internet) it opens the browser's own install window,
  which the browser only offers while the app isn't installed. iPhones and iPads have no such window and can't
  tell whether the icon exists, so there the button opens a four-step guide; "Erledigt" or × hide it on that
  device. The guide starts with opening the page in Safari, because a page opened from a link in another app (a
  chat, say) has no "Zum Home-Bildschirm" in its list, only "In Safari öffnen". It names the buttons as the phone
  shows them (German, otherwise English). It never shows on computers, in Firefox, or when the site already runs
  from the home screen.

## Where is what

The site's code is in `web/src/`. Every tab has a folder of its own in `views/`, with its code and its styles.
The tabs are moving to [React](https://react.dev) one at a time; the list below marks those that are React
components.

- `main.js`: starts the page: loads the data, wires up the tab bar and the filters, and draws the tabs.
- `data.js`: the data every tab draws from (alarms, keyword names, map positions, weather, school holidays,
  home games), loaded once when the page opens, and the filters above the tabs.
- `dom.js`: two small helpers: `$` finds an element on the page, `calm()` says whether the device asks for
  less motion.
- `show.js`: draws the tabs that are React components, with the alarms `main.js` hands them. React is
  bundled into a file of its own, so browsers keep it when the site's own code changes.
- `components/`: pieces several tabs use, with their styles next to them: `charts.js` (bar charts, the blue
  heat colours and their legend), `Chart.jsx` (the box a React tab has those charts drawn into), `Legend.jsx`
  (the colour legend, for React tabs), `tooltip.js` (the box that follows the pointer), `warnings.js` (the
  warnings box, see Warnungen below), `myths.js` (the myth results and pictures, on the Mythen-Check and in
  the quiz) and `leaflet.js` (loads the map library for the Karte and the Einsatzradius).
- `views/`: one folder per tab, named like the tab's `data-view` in `index.html`, with its code and its
  styles: `overview/` (Übersicht, a React component: `Overview.jsx`, with `app-offer.js` for "Als App speichern"),
  `dots/` (Punktewand), `calendar/` (Kalender, a React component: `Calendar.jsx`), `spiral/` (Jahresspirale),
  `hours/` (Tageszeit, a React component: `Hours.jsx`),
  `keywords/` (Stichworte, a React component: `Keywords.jsx`), `districts/` (Stadtteile, a React component:
  `Districts.jsx`), `addresses/` (Stammadressen, a React component: `Addresses.jsx`), `map/` (Karte, with the
  Zeitraffer), `radius/` (Einsatzradius), `weather/` (Wetter, a React component: `Weather.jsx`), `myths/`
  (Mythen-Check), `quiz/` (Quiz), `list/` (Liste, a React component: `AlarmList.jsx`), `year/`
  (Jahresrückblick, with `story.js` for the year as a story and `race-chart.js` for the running totals both
  show) and `chance/` ("Einsatz heute?").
- `lib/`: the rules and calculations, without any page code, so they can be tested on their own (see Tests):
  `dates.js`, `text.js`, `alarms.js` (the cleaning and the matching of hand entries, which the admin page uses
  too), `estimate.js` ("Einsatz heute?" and its backtest), `weather.js`, `year.js` (what the Jahresrückblick
  counts and compares), `myths.js` (the Mythen-Check), `places.js` (Stammadressen, the dot wall's groups and
  colours, distances for the Einsatzradius), `count.js` (counting alarms by street, keyword, weekday and hour
  and so on) and `quiz.js` (the quiz questions).
- `style.css`: the colours, the layout and the styles several tabs share. The admin page uses it too.
- `admin.js`: the admin page (`web/admin.html`).

## Admin page

`/admin.html` saves alarms into `web/public/data/manual.json` via the GitHub API. It needs a fine-grained personal
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

The rules are in `web/src/lib/year.js`, with unit tests in `tests/unit/year.test.js`.

## Einsatzradius

A line from the Wache (Teichstraße 8) to every alarm with a known address, over a grey OpenStreetMap map
(dark in dark mode), with rings every 1, 2, 5 or 10 km depending on the zoom. "Abspielen" sends the lines out
in date order, and the tiles and the "Wie weit weg?" bars count along. Distances are straight lines, not
driving routes. The Wache's position (`WACHE` in `web/src/lib/places.js`) is the middle of two map services'
positions for the address, which are 25 m apart. The view follows the filters above it.

## Mythen-Check

Tests popular beliefs (full moon, Friday the 13th, public holidays, school holidays, Hannover 96 home games,
days of 30 °C or more, weekends, and Silvester as a known "yes") against the alarms. The days of a myth are
compared with similar days: the same weekday at most 30 days from the same date in any year (weekends are
compared with weekdays of the same time of year, Silvester with any day around the turn of the year). For
every myth day one similar day is drawn at random, 2000 times over, which shows how far the average moves by
chance alone (the grey bar holds the middle 95 %). The card says "Stimmt" when chance reaches the myth days'
average in fewer than 2.5 % of the draws, "Vielleicht" below 10 %, and "Zu wenige Tage" under 10 days.
Großlage days and "vs" are always left out, and 01.01 only counts for Silvester.

- The myths, their tests and the verdicts are in `web/src/lib/myths.js`, with unit tests in
  `tests/unit/myths.test.js`. Full moons and public holidays in Lower Saxony are computed there, in the browser.
- `web/public/data/ferien.json`: school holidays in Lower Saxony (first and last day). Add the next school year once
  a year from the Kultusministerium's list.
- `web/public/data/heimspiele.json`: dates of Hannover 96 home games in the league. `scraper/football.py` refreshes
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

The questions are built in `web/src/lib/quiz.js`. `tests/unit/quiz.test.js` plays 500 rounds of them on the
site's data; a reworded question may need its pattern updated there.

## Warnungen

Current official warnings for Hannover. Each visitor's browser loads them when the page opens and again every
5 minutes while it shows; nothing is stored in the repository. Weather warnings of the Deutscher Wetterdienst
for the city (warn cell "Stadt Hannover", 803241001) come from Bright Sky (`api.brightsky.dev/alerts` at the
Wache's position), which lets any website load them. Other warnings for the Region Hannover (civil protection,
floods, police, Katwarn, Biwapp) come from the NINA dashboard
(`warnung.bund.de/api31/dashboard/032410000000.json`) through a small relay, because NINA doesn't let other
websites load it (see "The NINA relay" below). NINA's copies of the weather warnings are skipped unless Bright
Sky couldn't be loaded. NINA publishes no terms for this. When the relay or NINA can't be reached, the page says
where to find those warnings instead. Expired and lifted warnings are left out, and the DWD is credited as its
terms require. The warnings don't change the "Einsatz heute?" percentage.

- Weather warnings come in four levels, Stufe 1–4 in yellow, orange, red and violet, as on the DWD's map.
- While there are only Stufe 1 warnings (frost, say), they stay on Übersicht and don't move. With no warnings
  at all, Übersicht says so in one line.
- As soon as a weather warning reaches Stufe 2 or any other warning comes in, all warnings move to the very
  top of every tab, the most urgent first, because the site reopens the tab a visitor used last.
- The first warning moves: Stufe 2 slides in and shakes once; Stufe 3, Stufe 4 and the other warnings pulse
  with a ring about every 1.6 seconds and a beating warning sign. Only the first one moves, so several
  warnings don't turn into a light show. The pulse is slow enough to be safe for people sensitive to flashing
  light, nothing moves when the device asks for less motion, and the warnings are left out when printing.

### The NINA relay

NINA's answer lacks the header that lets another website read it (`Access-Control-Allow-Origin`), so
browsers throw the list away when the site asks NINA directly. `relay/nina.js` is a
[Cloudflare Worker](https://developers.cloudflare.com/workers/) on the free plan (100,000 requests a day): it
fetches NINA's list for the Region Hannover and passes it on with that header. It forwards nothing else, keeps
the list for a minute so NINA gets at most one request a minute, and answers 502 when NINA fails. Any website
may read it, like Bright Sky: the list is public anyway, and the site keeps working if it moves to another
address. The site asks it at the address in `NINA_RELAY` in `web/src/components/warnings.js`;
`tests/unit/relay.test.js` tests it.

To put it online, or to update it after `relay/nina.js` changed:

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com) (a free account is enough).
2. Workers & Pages → Create application → start from the "Hello World" Worker, name it `ff-linden-nina`,
   and deploy it.
3. "Edit code", replace everything with the content of `relay/nina.js`, and deploy again.
4. Open the Worker's address, `https://ff-linden-nina.<your subdomain>.workers.dev`: it shows NINA's list,
   `[]` when there are no warnings. That address goes into `NINA_RELAY`.

## Run locally

```sh
python scraper/scrape.py              # fetch the current year
python scraper/scrape.py --all        # fetch the full history
python scraper/scrape.py --file x.html  # import a page saved from the browser
npm install                           # once (needs Node.js 22.12 or newer)
npm run dev                           # the site at http://localhost:5173, reloads on every save
npm run build                         # what gets published, into dist/; npm run preview shows it
```

## Tests

Two kinds of tests, both run by `npm test` (needs Node.js 22.12 or newer). They run on every pull request
and every change to `main` (Actions → "Tests"), and the pull request shows a red check with the failing
test when something broke.

- `tests/unit/`: the rules and calculations in `web/src/lib/`, and the NINA relay in `relay/`, run in Node
  with [Vitest](https://vitest.dev), in a second or so.
- `tests/browser/`: the site itself, built as for publishing, opened in Chromium with
  [Playwright](https://playwright.dev) and clicked through like a visitor. Nothing leaves the machine:
  Leaflet, map tiles, the warning services and GitHub are answered by the tests, so nothing is saved anywhere.

```sh
npm install                                      # once: Vite, Vitest, Playwright and the map library the tests serve
npx playwright install chromium                  # once: the browser
npm test                                         # all tests, about two minutes
npx vitest                                       # unit tests, again after every save
npx playwright test tests/browser/admin.spec.js  # one browser test file
npx playwright test --ui                         # watch the browser tests run step by step
```

- `site.spec.js`: every tab with every year and both filters, on a computer and two phone sizes: no
  errors, no "NaN" or "undefined" in the text, no empty tab, nothing that makes the page scroll sideways.
  Also the year as a story, and the message when the alarms can't be loaded.
- `warnings.spec.js`: the warnings with made-up ones: where they show, which one moves, and when a service is down.
- `overview.spec.js`: the Übersicht: a column for every month, even one without alarms; the weekly average up to
  the website's newest alarm while a made-up hand entry is newer, and over a whole chosen year; the share at night,
  the same as the Tageszeit's; and the labels under the columns on a phone and on a computer.
- `list.spec.js`: the list: the search, the filters, and a made-up hand entry marked "vorläufig".
- `addresses.spec.js`: the Stammadressen: the busiest streets and the fire alarm systems, rows that open to their
  alarms and stay open when a filter or the tab changes, and the note when no place has enough alarms.
- `keywords.spec.js`: the Stichworte: the alarm types and keywords ranked, their tooltips, the chosen year, and
  the long names above their bars on a narrow phone.
- `districts.spec.js`: the Stadtteile: the 20 busiest districts with their busiest streets in the tooltips, and
  the chosen year.
- `hours.spec.js`: the Tageszeit: the weekday × hour grid with the busiest hour in the key's darkest colour, the
  same alarms by hour, and the chosen year.
- `calendar.spec.js`: the Kalender: a square for every day up to today in the colour the key gives its alarms,
  a block per year, the Großlage days when "Großlagen mitzählen" is off, and the paler days the website
  doesn't list yet, with a made-up hand entry.
- `weather.spec.js`: the Wetter tab with made-up weather: each day in the range its weather falls in, with the
  Kalender's alarms of that day; without Silvester, Neujahr, days before the first alarm and from the website's
  newest day on; the chosen year, Großlage days and Wachbesetzungen; the days beside each range on a phone; and
  the note when there is no weather yet.
- `scrollbar.spec.js`: switching tabs on a computer screen, with the scrollbar showing: the page doesn't jump
  sideways between tabs that scroll and tabs that fit the window.
- `quiz.spec.js`: a round of the quiz played by tapping, and 100 more rounds checked for "NaN" or page
  markup in the questions and answers.
- `app-offer.spec.js`: the "Als App speichern" button on iPhone, iPad, Android and a computer.
- `admin.spec.js`: the admin page with a made-up website list and hand entries.
- `fixtures.js`: the setup every browser test shares.

## Publish

The "Publish site" workflow (`.github/workflows/deploy.yml`) builds the site and publishes it on
GitHub Pages after every change to `main` and after every data update. Actions → "Publish site" →
Run workflow publishes by hand. It needs Settings → Pages → Build and deployment → Source: "GitHub Actions".

## Data cleaning (done in the browser, see `web/src/lib/alarms.js` and `web/src/data.js`)

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

The rules are in `web/src/lib/estimate.js`, with unit tests in `tests/unit/estimate.test.js`.

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

Silvester night (31.12., 22–06) is busy every year (20 alarms in 2024, 14 in 2025), so it gets no
percentage. On 31.12. the page shows how many alarms the same night had in earlier years, and that
night is left out when estimating ordinary nights and in the backtest. More such nights can be
added to `SPECIAL_NIGHTS` in `web/src/lib/estimate.js`.
