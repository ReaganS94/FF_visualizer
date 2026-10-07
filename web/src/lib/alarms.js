// The rules that turn the website's list and the hand entries from the admin page into the alarms the site
// counts. The admin page uses the same rules to show which hand entries the website lists already.

export const BIG_DAY = 10; // a day with this many alarms or more counts as a Großlage (e.g. storm), except 01.01

// The website writes "Straße"; entries typed by hand may say "Strasse" or "Str.". One spelling keeps
// the street lists and the search together.
export const tidyStreet = (s) => (s || "")
  .replace(/strasse/g, "straße").replace(/Strasse/g, "Straße")
  .replace(/(^|[\s-])Str\.?(?=$|[\s/])/g, "$1Straße")
  .replace(/([a-zäöüß])str\.?(?=$|[\s/])/g, "$1straße");

// A manual entry (admin page) is dropped once the website lists the same alarm: same keyword,
// time within an hour. Until then it fills the gap.
// Full timestamps, so 23:50 and 00:10 the next day still match.
export const stamp = (r) => new Date(`${r.date}T${r.time}`).getTime();
export function sameAlarm(a, b) {
  const base = (k) => k.split("/")[0].trim().toLowerCase();
  return base(a.keyword) === base(b.keyword) && Math.abs(stamp(a) - stamp(b)) <= 60 * 60 * 1000;
}

// Each website alarm stands in for at most one hand entry (closest in time first): two "th" alarms
// 40 minutes apart both stay until the website lists both. Returns the hand entries the website lists.
export function matchedManual(scraped, manual) {
  const seen = new Set();
  const web = scraped.filter((r) => {
    const k = [r.date, r.time, r.keyword, tidyStreet(r.street)].join("|");
    if (r.category !== "Einsatz" || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const pairs = [];
  web.forEach((r, i) => manual.forEach((m, j) => { if (sameAlarm(r, m)) pairs.push([Math.abs(stamp(r) - stamp(m)), i, j]); }));
  pairs.sort((a, b) => a[0] - b[0]);
  const usedWeb = new Set(), matched = new Set();
  for (const [, i, j] of pairs) {
    if (usedWeb.has(i) || matched.has(manual[j])) continue;
    usedWeb.add(i);
    matched.add(manual[j]);
  }
  return matched;
}

// The website's rows plus the hand entries it doesn't list yet (marked manual: true), newest first.
export function mergeManual(scraped, manual) {
  const matched = matchedManual(scraped, manual);
  const pending = manual.filter((m) => !matched.has(m));
  return [...scraped, ...pending.map((m) => ({ ...m, manual: true }))]
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
}

// Keeps the alarms (category "Einsatz") once each and adds what the views need: the keyword's base code,
// name and group from keywords.json (kw), the hour, whether it was a standby ("vs"), and whether its day
// was a Großlage.
export function clean(rows, kw) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (r.category !== "Einsatz") continue;
    // The site sometimes lists one alarm twice with slightly different remarks.
    const street = tidyStreet(r.street);
    const k = [r.date, r.time, r.keyword, street].join("|");
    if (seen.has(k)) continue;
    seen.add(k);
    const base = r.keyword.split("/")[0].trim().toLowerCase() || "?";
    const info = kw.codes[base] || {};
    out.push({
      ...r, street, geoKey: `${r.street}|${r.district}`, base, standby: base === "vs", hour: Number(r.time.slice(0, 2)),
      name: info.name || base, group: kw.groups[info.group] || "Unbekannt",
    });
  }
  const perDay = {};
  for (const r of out) if (!r.standby) perDay[r.date] = (perDay[r.date] || 0) + 1;
  for (const r of out) {
    // Silvester fills 01.01 every year; that's part of a normal year, not an outlier like a storm.
    r.bigDay = perDay[r.date] >= BIG_DAY && r.date.slice(5) !== "01-01";
    r.timeUnknown = r.bigDay && r.time === "00:00"; // bulk-entered with a placeholder time
  }
  return out;
}
