# How the tabs work

[Back to the README](../README.md)

The rules behind the tabs that need more than a chart to explain. Each tab's code is in `web/src/views/`, the
rules and calculations are in `web/src/lib/`, with unit tests in `tests/unit/`.

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

## "Als App speichern"

`web/public/manifest.webmanifest` and `web/public/icons/` let phones add the site to the home screen as an app (icon source: `icons/icon.svg`). On phones and tablets, Übersicht shows an "Als App speichern" button while the site isn't saved yet. On Android (Chrome, Edge, Samsung Internet) it opens the browser's own install window, which the browser only offers while the app isn't installed. iPhones and iPads have no such window and can't tell whether the icon exists, so there the button opens a four-step guide; "Erledigt" or × hide it on that device. The guide starts with opening the page in Safari, because a page opened from a link in another app (a chat, say) has no "Zum Home-Bildschirm" in its list, only "In Safari öffnen". It names the buttons as the phone shows them (German, otherwise English). It never shows on computers, in Firefox, or when the site already runs from the home screen.
