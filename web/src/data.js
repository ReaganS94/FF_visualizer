// The data every tab draws from, loaded once when the page opens, and the filters above the tabs.
// The values below only change in loadData(); the tabs import and read them.
import { parseDate, addDays } from "./lib/dates.js";
import { mergeManual, clean } from "./lib/alarms.js";
import { $ } from "./dom.js";

export let ALL = [];             // cleaned alarms
export let KW = { groups: {}, codes: {} }; // keyword names, from data/keywords.json
export let GEO = {};             // "street|district" -> [lat, lon], from data/geo.json
export let WEATHER = {};         // "YYYY-MM-DD" -> {tmax, tmin, rain, gust}, from data/weather.json
export let UPDATED = new Date(); // when the data was last scraped
// The website's list isn't always current (in September 2026 it stopped at 13.09. for weeks). Days
// after its newest entry would look alarm-free, so counts of empty days end the day before it.
export let LISTED = new Date();  // newest date on the website's list
export let FERIEN = [];         // school holidays in Lower Saxony, [[first, last], ...] from data/ferien.json
export let HEIMSPIELE = [];     // Hannover 96 home games, from data/heimspiele.json
export const listBehind = () => addDays(LISTED, 2) < UPDATED; // the website hasn't listed anything for days

// ---------- filters ----------
export function selection() {
  const year = $("#f-year").value;
  const standby = $("#f-standby").checked;
  const storm = $("#f-storm").checked;
  return ALL.filter((r) =>
    (!year || r.date.startsWith(year)) && (standby || !r.standby) && (storm || !r.bigDay));
}

// GitHub Pages lets browsers cache files for 10 minutes; "no-cache" revalidates so new alarms show promptly.
const getJSON = (u, fallback) => fetch(u, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : fallback)).catch(() => fallback);

// Loads every data file and fills in the values above. Resolves to when the alarms were last updated and
// the date of the website's newest alarm, or to null when the alarms couldn't be loaded.
export function loadData() {
  return Promise.all([
    getJSON("data/alarms.json", null), getJSON("data/keywords.json", KW), getJSON("data/manual.json", { rows: [] }),
    getJSON("data/geo.json", {}), getJSON("data/weather.json", { days: {} }),
    getJSON("data/ferien.json", { ranges: [] }), getJSON("data/heimspiele.json", { seasons: {} }),
  ])
    .then(([data, kw, manual, geo, weather, ferien, heimspiele]) => {
      if (!data) return null;
      KW = kw;
      GEO = geo;
      WEATHER = weather.days;
      FERIEN = ferien.ranges || [];
      HEIMSPIELE = Object.values(heimspiele.seasons || {}).flat();
      ALL = clean(mergeManual(data.rows, manual.rows), KW);
      UPDATED = new Date(data.updated);
      // Only alarms: events (Veranstaltung) can be listed ahead of time.
      const newest = data.rows.reduce((m, r) => (r.category === "Einsatz" && r.date > m ? r.date : m), "");
      LISTED = newest ? parseDate(newest) : UPDATED;
      return { updated: data.updated, newest };
    });
}
