// Mythen-Check: popular beliefs tested against the alarms. The days of a myth are compared with similar days
// (by default the same weekday, at most 30 days from the same date in any year). Drawing one similar day
// for each myth day, many times over, shows how far the average moves by chance alone.
import { parseDate, isoDate, addDays, weekday, fmtDate } from "./dates.js";
import { einsaetze } from "./text.js";
import { isHot } from "./weather.js";

// Full moons after Meeus, "Astronomical Algorithms", ch. 49 (a few minutes off at most), as Hannover dates.
export function fullMoons(from, to) {
  const rad = Math.PI / 180, out = [];
  const berlin = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }); // "YYYY-MM-DD"
  for (let k = Math.floor((from.getFullYear() - 2000) * 12.3685) - 1.5; ; k++) {
    const T = k / 1236.85;
    const E = 1 - 0.002516 * T - 0.0000074 * T * T;
    const M = (2.5534 + 29.1053567 * k) * rad;
    const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T * T) * rad;
    const F = (160.7108 + 390.67050284 * k - 0.0016118 * T * T) * rad;
    const O = (124.7746 - 1.56375588 * k) * rad;
    const jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T
      - 0.40614 * Math.sin(Mp) + 0.17302 * E * Math.sin(M) + 0.01614 * Math.sin(2 * Mp) + 0.01043 * Math.sin(2 * F)
      + 0.00734 * E * Math.sin(Mp - M) - 0.00515 * E * Math.sin(Mp + M) + 0.00209 * E * E * Math.sin(2 * M)
      - 0.00111 * Math.sin(Mp - 2 * F) - 0.00057 * Math.sin(Mp + 2 * F) + 0.00056 * E * Math.sin(2 * Mp + M)
      - 0.00042 * Math.sin(3 * Mp) + 0.00042 * E * Math.sin(M + 2 * F) + 0.00038 * E * Math.sin(M - 2 * F)
      - 0.00024 * E * Math.sin(2 * Mp - M) - 0.00017 * Math.sin(O);
    const when = new Date((jde - 2440587.5) * 864e5);
    if (when > addDays(to, 1)) return out;
    if (when >= addDays(from, -1)) out.push(berlin.format(when));
  }
}

// Public holidays in Lower Saxony, without 01.01 (that one is Silvester's)
export function holidays(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4; // Easter, Gauss/Meeus
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easter = new Date(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
  return [addDays(easter, -2), addDays(easter, 1), new Date(y, 4, 1), addDays(easter, 39), addDays(easter, 50),
    new Date(y, 9, 3), new Date(y, 9, 31), new Date(y, 11, 25), new Date(y, 11, 26)].map(isoDate);
}

// Seeded random numbers (mulberry32), so the result stays the same on every visit until new alarms come in
export function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// days: [{date, wd, doy, n}]. Returns the myth days' average and what similar days give by chance.
export function testMyth(days, is, similar, seed) {
  const hits = days.filter(is), others = days.filter((o) => !is(o));
  const paired = hits.map((h) => [h, others.filter((o) => similar(h, o)).map((o) => o.n)]).filter(([, p]) => p.length);
  const used = paired.map(([h]) => h), pools = paired.map(([, p]) => p);
  const n = used.length;
  if (!n) return null;
  const avg = used.reduce((a, d) => a + d.n, 0) / n;
  const rand = rng(seed), sims = [];
  for (let s = 0; s < 2000; s++) {
    let t = 0;
    for (const p of pools) t += p[Math.floor(rand() * p.length)];
    sims.push(t / n);
  }
  sims.sort((a, b) => a - b);
  return {
    hits: used, n, avg, base: sims.reduce((a, b) => a + b, 0) / sims.length,
    lo: sims[Math.floor(sims.length * 0.025)], hi: sims[Math.ceil(sims.length * 0.975) - 1],
    atLeast: sims.filter((v) => v >= avg - 1e-9).length / sims.length,
    atMost: sims.filter((v) => v <= avg + 1e-9).length / sims.length,
  };
}

// Every myth with its test. alarms: the cleaned alarms (oldest last), last: the last day to count,
// ferien: [[first, last], ...] school holidays, heimspiele: ["YYYY-MM-DD", ...], weather: data/weather.json's days.
export function mythResults(alarms, last, { ferien, heimspiele, weather }) {
  const first = alarms.length ? parseDate(alarms[alarms.length - 1].date) : new Date();
  const perDay = {}, big = new Set();
  for (const r of alarms) if (!r.standby) perDay[r.date] = (perDay[r.date] || 0) + 1;
  for (const r of alarms) if (r.bigDay) big.add(r.date);
  const all = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const date = isoDate(d);
    if (!big.has(date)) all.push({ date, wd: weekday(d), doy: Math.round((d - new Date(d.getFullYear(), 0, 1)) / 864e5), n: perDay[date] || 0 });
  }
  // 01.01 only counts for Silvester: with its dozen alarms it would make any winter comparison look busy.
  const days = all.filter((d) => d.date.slice(5) !== "01-01");
  const near = (a, b) => { const g = Math.abs(a.doy - b.doy); return Math.min(g, 365 - g) <= 30; };
  const alike = (a, b) => a.wd === b.wd && near(a, b);
  const moons = fullMoons(first, last);
  const moonDays = new Set(moons.flatMap((m) => [-1, 0, 1].map((o) => isoDate(addDays(parseDate(m), o)))));
  const hol = new Set();
  for (let y = first.getFullYear(); y <= last.getFullYear(); y++) holidays(y).forEach((d) => hol.add(d));
  const games = new Set(heimspiele);
  const list = (hits) => hits.map((h) => `${fmtDate(h.date)} (${einsaetze(h.n)})`).join(", ");
  const myths = [
    { title: "Bei Vollmond ist mehr los.", label: "Vollmond-Tage", on: "An Vollmond-Tagen", cmp: "Ähnliche Tage ohne Vollmond", vs: "an ähnlichen Tagen ohne Vollmond", pool: days,
      is: (d) => moonDays.has(d.date), similar: alike,
      about: (t) => `${t.n} Tage: jeweils der Tag mit Vollmond und die Tage davor und danach, dann ist der Mond fast voll.` },
    { title: "Am Freitag, dem 13., ist mehr los.", label: "Freitage, der 13.", on: "An Freitagen, dem 13.,", cmp: "Andere Freitage", vs: "an anderen Freitagen", pick: "andere Freitage", pool: days,
      is: (d) => d.wd === 4 && d.date.slice(8) === "13", similar: alike,
      about: (t) => `Bisher gab es erst ${t.n} solche Tage: ${list(t.hits)}.` },
    { title: "An Feiertagen ist mehr los.", label: "Feiertage", on: "An Feiertagen", cmp: "Ähnliche Tage ohne Feiertag", vs: "an ähnlichen Tagen ohne Feiertag", pool: days,
      is: (d) => hol.has(d.date), similar: alike,
      about: (t) => `${t.n} gesetzliche Feiertage in Niedersachsen. Neujahr zählt bei Silvester.` },
    ferien.length && { title: "In den Ferien ist mehr los.", label: "Ferientage", on: "In den Ferien", cmp: "Ähnliche Tage ohne Ferien", vs: "an ähnlichen Tagen ohne Ferien", pool: days,
      is: (d) => ferien.some(([a, b]) => d.date >= a && d.date <= b), similar: alike,
      about: (t) => `${t.n} Tage Schulferien in Niedersachsen, die Wochenenden in den Ferien eingeschlossen.` },
    games.size && { title: "Wenn 96 zu Hause spielt, ist mehr los.", label: "Heimspieltage", on: "An Heimspieltagen", cmp: "Ähnliche Tage ohne Heimspiel", vs: "an ähnlichen Tagen ohne Heimspiel", pool: days,
      is: (d) => games.has(d.date), similar: alike,
      about: (t) => `${t.n} Heimspiele von Hannover 96 in der Liga. Das Stadion liegt nah an Linden.` },
    { title: "Bei Hitze gibt es mehr Einsätze.", label: "Tage ab 30 °C", on: "An Tagen ab 30 °C", cmp: "Ähnliche Tage unter 30 °C", vs: "an ähnlichen Tagen unter 30 °C", pool: days.filter((d) => weather[d.date]),
      is: (d) => isHot(weather[d.date]), similar: alike,
      about: (t) => `${t.n} Tage mit mindestens 30 °C in Hannover (Daten: Open-Meteo).` },
    { title: "Am Wochenende ist mehr los.", label: "Samstage und Sonntage", on: "Am Wochenende", cmp: "Werktage", vs: "an Werktagen", pick: "Werktage", pool: days,
      is: (d) => d.wd >= 5, similar: (a, b) => b.wd < 5 && near(a, b),
      about: (t) => `${t.n} Samstage und Sonntage, verglichen mit Montag bis Freitag in derselben Jahreszeit.` },
    { title: "Silvester ist die Nacht des Jahres.", label: "Neujahrstage", on: "Am Neujahrstag", cmp: "Andere Tage um den Jahreswechsel", vs: "an anderen Tagen um den Jahreswechsel", pick: "andere Tage um den Jahreswechsel", pool: all,
      is: (d) => d.date.slice(5) === "01-01", similar: near,
      about: (t) => `Zum Vergleich, weil es jeder weiß: So sieht ein echter Unterschied aus. Gezählt wird der 01.01., ` +
        `weil die Silvester-Einsätze meist nach Mitternacht liegen: ${list(t.hits)}.` },
  ].filter(Boolean);
  const results = myths.map((m, i) => ({ ...m, t: testMyth(m.pool, m.is, m.similar, 1000 + i) })).filter((m) => m.t);
  return { results, first, last, days: all.length };
}

// p: how often chance gives at least as many alarms (or at most as few, for fewer) as the myth days had.
export function mythVerdict(t, pick = "ähnliche Tage") {
  const more = t.avg >= t.base, p = more ? t.atLeast : t.atMost;
  const k = Math.round(100 * p);
  const tries = `Wählt man ebenso viele zufällige ${pick}, kommen sie in ${k ? `${k} von 100` : "keinem von 100"} Versuchen auf ${more ? "mindestens" : "höchstens"} so ${more ? "viele" : "wenige"} Einsätze`;
  if (p < 0.025) return ["yes", more ? "Stimmt" : "Im Gegenteil", `${tries}. Da steckt also mehr dahinter als Zufall.`];
  if (t.n < 10) return ["few", "Zu wenige Tage", `${tries}. Bei nur ${t.n} Tagen reicht das nicht für eine Aussage.`];
  if (p < 0.1) return ["maybe", more ? "Vielleicht" : "Vielleicht weniger", `${tries}. Das ist ein Hinweis, aber noch kein Beleg.`];
  return ["none", "Kein Unterschied", `${tries}. Das ist also gut mit Zufall zu erklären.`];
}
