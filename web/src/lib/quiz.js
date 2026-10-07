// Quiz "Schätz mal": ten questions per round, drawn from a larger pool and built from the data so they stay
// current. A question is plain data: {kind: "number", text, answer, unit, max, near} to guess with a slider
// (2 points close to the answer, 1 point near it) or {kind: "choice", text, options, right} (2 points), each
// with `explain`, `chart` (shown with the answer: {type: "bars" | "columns", items, opts} or {type: "myth", myth})
// and `tags` (the topics it takes besides its own).
import { WEEKDAYS, WEEKDAYS_LONG, MONTHS, MONTHS_LONG, parseDate, isoDate, weekday, fmtDate, longestRun } from "./dates.js";
import { esc, einsaetze, fmtKm, dec, andList } from "./text.js";
import { topCounts, counted, pct, niceMax } from "./count.js";
import { stamp } from "./alarms.js";
import { HOT, GUST } from "./weather.js";
import { DAY_START, NIGHT_START } from "./estimate.js";
import { yearInfo } from "./year.js";
import { isBMA, isRWM, radiusPoints, radiusSummary, RADIUS_BINS } from "./places.js";
import { mythVerdict, mythSentence } from "./myths.js";

export const QUIZ_LEN = 10;
// The round's random numbers: Math.random on the page, a seeded one in the tests.
let random = Math.random;
const pick = (a) => a[Math.floor(random() * a.length)];
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// Charts to show with an answer, drawn by the page with its bar and column charts.
const bars = (items, opts) => ({ type: "bars", items, opts });
const columns = (items, opts) => ({ type: "columns", items, opts });

// A number to guess. unit: [one, many] or "%"; the slider ends at a round number well above the answer.
// near: how far off still gives 2 points and 1 point. tags: topics the question takes besides its own.
function numberQ(text, answer, unit, { max, near, explain = "", chart = null, tags = [] } = {}) {
  const percent = unit === "%";
  max ??= percent ? 100 : niceMax(Math.max(answer + 5, answer * (1.4 + random() * 1.2)));
  near ??= percent ? [5, 10] : [Math.max(1, answer * 0.1), Math.max(2, answer * 0.25)];
  return { kind: "number", text, answer, unit, max, near, explain, chart, tags };
}
// Multiple choice: the right answer and up to three others, shuffled.
function choiceQ(text, right, others, { explain = "", chart = null, tags = [] } = {}) {
  const options = shuffle([right, ...shuffle([...new Set(others)].filter((o) => o !== right)).slice(0, 3)]);
  return options.length < 2 ? null : { kind: "choice", text, options, right, explain, chart, tags };
}
// Two options, in the order the question names them.
function pairQ(text, a, b, right, opts) {
  const q = choiceQ(text, right, [a, b], opts);
  if (q) q.options = [a, b];
  return q;
}
// Months, weekdays and times of day read better in their natural order.
const inOrder = (q, list) => (q && q.options.sort((a, b) => list.indexOf(a) - list.indexOf(b)), q);
export const unitText = (q, n) => (q.unit === "%" ? `${n} %` : `${n.toLocaleString("de-DE")} ${n === 1 ? q.unit[0] : q.unit[1]}`);

// A new round. data: the cleaned alarms, the day of the website's newest alarm, keywords.json, geo.json,
// weather.json's days, and a function giving mythResults(). recent: the kinds of the last round, which go
// last. Returns the questions and the kinds used.
export function quizRound({ alarms, listedDate, keywords, geo, weather, myths }, recent = new Set(), rand = Math.random) {
  random = rand;
  const rows = alarms.filter((r) => !r.standby);
  if (!rows.length) return { qs: [], used: recent };
  const calm = rows.filter((r) => !r.bigDay);
  const listed = isoDate(listedDate), first = rows.at(-1).date;
  const years = [...new Set(rows.map((r) => r.date.slice(0, 4)))].sort();
  const full = years.filter((y) => !yearInfo(y, true, alarms, listedDate).partial);
  const E = ["Einsatz", "Einsätze"], T = ["Tag", "Tage"];
  const plainName = (r) => r.name.replace(/\s*\(.*\)$/, "");
  const top = (list) => (list.length > 1 && list[0][1] === list[1][1] ? null : list[0]); // only a clear winner
  const inYear = (y) => rows.filter((r) => r.date.startsWith(y));
  const bigIn = (list) => topCounts(list.filter((r) => r.bigDay), (r) => r.date, 1)[0]; // the largest Großlage in it
  const yearBars = (hi) => bars(years.map((y) => {
    const info = yearInfo(y, true, alarms, listedDate);
    return { label: info.partial ? `${y} (bis ${fmtDate(info.cutDate).slice(0, 6)})` : y, value: info.rows.length, hi: !hi || y === hi, tip: "" };
  }), { labelWidth: 150 });
  // Whole months the website has listed, oldest first.
  const months = [];
  for (let d = parseDate(`${first.slice(0, 7)}-01`); isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)) < listed; d = new Date(d.getFullYear(), d.getMonth() + 1, 1))
    months.push(isoDate(d).slice(0, 7));
  const perMonth = Object.fromEntries(months.map((ym) => [ym, 0]));
  for (const r of rows) if (r.date.slice(0, 7) in perMonth) perMonth[r.date.slice(0, 7)]++;
  const avgMonth = months.length ? Math.round(months.reduce((a, ym) => a + perMonth[ym], 0) / months.length) : 0;
  const monthName = (ym) => `${MONTHS_LONG[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
  // A note on a Großlage or on Neujahr would give away the questions on single days, so a question with
  // such a note takes the "days" topic too, and leaves it out when that topic is taken.
  const dayBound = (list) => list.some((r) => r.bigDay || r.date.endsWith("-01-01"));
  const monthBars = (hi) => columns(months.map((ym) =>
    ({ tick: ym.endsWith("-01") ? ym.slice(0, 4) : "", value: perMonth[ym], hi: ym === hi, tip: "" })), { height: 160 });
  const known = rows.filter((r) => !r.timeUnknown);
  const hours = Array.from({ length: 24 }, (_, h) => known.filter((r) => r.hour === h).length);
  const hourBars = (hi) => columns(hours.map((n, h) => ({ tick: h % 6 ? "" : `${h}`, value: n, hi: hi(h), tip: "" })), { height: 150 });
  const districts = counted(rows.filter((r) => r.district && r.district !== "unbekannt"), (r) => r.district);
  const streets = counted(rows.filter((r) => r.street), (r) => r.street);
  // Days with an alarm, for the longest runs of days with and without one. Großlage days count as busy,
  // and the count stops at the website's newest alarm.
  const dates = new Set(rows.map((r) => r.date));
  const reasons = [
    { label: "Rauchwarnmelder", is: isRWM, text: "Wie oft wurde die FF Linden bisher wegen eines Rauchwarnmelders alarmiert?" },
    { label: "Brandmeldeanlage", is: isBMA, text: "Wie oft hat bisher eine Brandmeldeanlage die FF Linden alarmiert?" },
    { label: "Containerbrand", is: (r) => /container/i.test(r.event), text: "Wie oft brannte bisher ein Container?" },
    { label: "Gas & Gefahrstoffe", is: (r) => r.group === "Gas & Gefahrstoffe", text: "Wie oft ging es bisher um Gas oder andere Gefahrstoffe?" },
    { label: "Technische Hilfe", is: (r) => r.group === "Technische Hilfe",
      text: "Wie oft war bisher technische Hilfe gefragt, zum Beispiel nach einem Unfall oder bei Wasser im Keller?" },
    { label: "Unwetter", is: (r) => r.group === "Unwetter", text: "Wie oft wurde die FF Linden bisher wegen eines Unwetters alarmiert?" },
  ].map((x) => ({ ...x, list: rows.filter(x.is) })).filter((x) => x.list.length >= 5);
  // A Großlage can make up most of a reason (the Unwetter of 14.07.2026), so the answer says so.
  const reasonNote = (x, named) => {
    const big = bigIn(x.list);
    return big && big[1].length >= x.list.length / 3 ? ` ${named ? `${x.label}: ` : ""}${big[1].length} davon allein am ${fmtDate(big[0])}.` : "";
  };

  // [topic, question]. A round has one question per topic, so a chart or note can't give away a later answer.
  const gens = [
    ["years", () => {
      if (!full.length) return null;
      const y = pick(full), n = inYear(y).length;
      return numberQ(`Wie viele Einsätze hatte die FF Linden im ganzen Jahr ${y}?`, n, E, {
        explain: `Im Schnitt ${dec(n / 52.18)} pro Woche.`, chart: yearBars(y),
      });
    }],
    ["years", () => {
      const days = Math.round((listedDate - parseDate(first)) / 864e5) + 1;
      return numberQ(`Wie viele Einsätze hatte die FF Linden insgesamt seit dem ${fmtDate(first)}?`, rows.length, E, {
        explain: `Im Schnitt ${dec((7 * rows.length) / days)} pro Woche.`, chart: yearBars(),
      });
    }],
    ["years", () => {
      // a year against the one before, up to the same date while it isn't complete
      const ys = years.filter((y) => `${y - 1}-01-01` >= first);
      if (!ys.length) return null;
      const y = pick(ys), info = yearInfo(y, true, alarms, listedDate);
      const now = info.cmpRows.length, before = info.prevSame.length;
      if ((info.partial && info.cut < "03-01") || !before || now === before) return null;
      const when = info.partial ? ` bis zum ${fmtDate(info.cutDate).slice(0, 6)}` : "";
      const big = info.cmpRows.filter((r) => r.bigDay).length, bigBefore = info.prevSame.filter((r) => r.bigDay).length;
      return pairQ(`Gab es ${y}${when} mehr oder weniger Einsätze als ${y - 1}${when ? " im gleichen Zeitraum" : ""}?`, "Mehr", "Weniger",
        now > before ? "Mehr" : "Weniger", {
          explain: `${y}: ${einsaetze(now)}, ${y - 1}: ${einsaetze(before)}.` + (big || bigBefore ? ` Ohne Großlagen: ${now - big} zu ${before - bigBefore}.` : ""),
          chart: bars([[y, now], [String(y - 1), before]].map(([yy, value]) => ({ label: `${yy}${when}`, value, tip: "" })), { labelWidth: 150 }),
        });
    }],
    ["months", (taken) => {
      if (!full.length) return null;
      const y = pick(full), ry = inYear(y);
      const per = MONTHS.map((_, m) => ry.filter((r) => Number(r.date.slice(5, 7)) === m + 1).length);
      const best = top(per.map((n, m) => [m, n]).sort((a, b) => b[1] - a[1]));
      if (!best) return null;
      const list = ry.filter((r) => Number(r.date.slice(5, 7)) === best[0] + 1), big = bigIn(list), bound = dayBound(list);
      if (bound && taken.has("days")) return null;
      return inOrder(choiceQ(`In welchem Monat gab es ${y} die meisten Einsätze?`, MONTHS_LONG[best[0]], MONTHS_LONG, {
        explain: `${MONTHS_LONG[best[0]]} ${y}: ${einsaetze(best[1])}.` + (big ? ` Darin steckt die Großlage am ${fmtDate(big[0])} mit ${einsaetze(big[1].length, true)}.` : ""),
        chart: columns(per.map((n, m) => ({ tick: MONTHS[m][0], value: n, hi: m === best[0], tip: "" })), { height: 170 }),
        tags: bound ? ["days"] : [],
      }), MONTHS_LONG);
    }],
    ["months", (taken) => {
      const inMonth = (ym) => rows.filter((r) => r.date.startsWith(ym));
      const pool = months.filter((ym) => !taken.has("days") || !dayBound(inMonth(ym)));
      if (pool.length < 3) return null;
      const ym = pick(pool), list = inMonth(ym);
      const big = bigIn(list), ny = list.filter((r) => r.date.endsWith("-01-01")).length;
      return numberQ(`Wie viele Einsätze gab es im ${monthName(ym)}?`, perMonth[ym], E, {
        explain: `Im Schnitt sind es ${avgMonth} pro Monat.` + (big ? ` Darin steckt die Großlage am ${fmtDate(big[0])} mit ${einsaetze(big[1].length, true)}.` : "") +
          (ny ? ` Allein am Neujahrstag waren es ${ny}.` : ""),
        chart: monthBars(ym), tags: dayBound(list) ? ["days"] : [],
      });
    }],
    ["months", () => {
      const sorted = months.map((ym) => [ym, perMonth[ym]]).sort((a, b) => a[1] - b[1]);
      if (sorted.length < 6 || sorted[0][1] === sorted[1][1]) return null;
      const [ym, n] = sorted[0], [most, mostN] = sorted.at(-1);
      return numberQ(`Der ruhigste Monat bisher war der ${monthName(ym)}. Wie viele Einsätze gab es da?`, n, E, {
        explain: `Im Schnitt sind es ${avgMonth} pro Monat, im stärksten Monat (${monthName(most)}) waren es ${mostN}.`,
        chart: monthBars(ym),
      });
    }],
    ["months", () => {
      const ys = years.filter((y) => inYear(y).length >= 100);
      if (!ys.length) return null;
      const at = (y) => inYear(y).at(-100).date; // the list is newest first
      const y = pick(ys), d = at(y), m = Number(d.slice(5, 7)) - 1;
      const others = ys.filter((yy) => yy !== y).map((yy) => fmtDate(at(yy)));
      return inOrder(choiceQ(`In welchem Monat kam ${y} der 100. Einsatz des Jahres?`, MONTHS_LONG[m],
        [m - 2, m - 1, m + 1, m + 2].filter((k) => k >= 0 && k < 12).map((k) => MONTHS_LONG[k]), {
          explain: `Am ${fmtDate(d)}.` + (rows.some((r) => r.bigDay && r.date === d) ? " Das war mitten in einer Großlage." : "") +
            (others.length ? ` Zum Vergleich: ${andList(others)}.` : ""),
        }), MONTHS_LONG);
    }],
    ["months", () => {
      if (full.length < 2) return null;
      const per = MONTHS.map((_, m) => rows.filter((r) => full.includes(r.date.slice(0, 4)) && Number(r.date.slice(5, 7)) === m + 1).length);
      const best = top(per.map((n, m) => [m, n]).sort((a, b) => a[1] - b[1]));
      if (!best) return null;
      // February is shorter, so per day too
      const perDay = per.map((n, m) => n / full.reduce((a, y) => a + new Date(Number(y), m + 1, 0).getDate(), 0));
      const calmest = perDay.indexOf(Math.min(...perDay));
      return inOrder(choiceQ(`In welchem Monat ist am wenigsten los? Gezählt sind die ganzen Jahre ${andList(full)}.`, MONTHS_LONG[best[0]], MONTHS_LONG, {
        explain: `${MONTHS_LONG[best[0]]}: zusammen nur ${einsaetze(best[1])}. ` +
          (calmest === best[0] ? "Auch pro Tag gerechnet ist er der ruhigste." : `Pro Tag gerechnet ist der ${MONTHS_LONG[calmest]} am ruhigsten.`),
        chart: columns(per.map((n, m) => ({ tick: MONTHS[m][0], value: n, hi: m === best[0], tip: "" })), { height: 160 }),
      }), MONTHS_LONG);
    }],
    ["days", () => {
      const days = counted(rows, (r) => r.date);
      const best = top(days);
      if (!best || best[1] < 5) return null;
      const [d, n] = best;
      const [ev, evl] = topCounts(rows.filter((r) => r.date === d), (r) => r.event, 1)[0];
      return numberQ(`Der stärkste Tag bisher war ${WEEKDAYS_LONG[weekday(parseDate(d))]}, der ${fmtDate(d)}. Wie viele Einsätze gab es an diesem Tag?`, n, E, {
        explain: evl.length > n / 2 ? `${evl.length} davon: „${esc(ev)}“.` : "",
        chart: bars(days.slice(0, 5).map(([dd, nn]) => ({ label: fmtDate(dd), value: nn, hi: dd === d, tip: "" })), { labelWidth: 110 }),
      });
    }],
    ["days", () => {
      const ny = years.filter((y) => `${y}-01-01` <= listed);
      if (!ny.length) return null;
      const y = pick(ny), n = rows.filter((r) => r.date === `${y}-01-01`).length;
      const usual = rows.filter((r) => !r.bigDay && r.date.slice(5) !== "01-01").length / ((listedDate - parseDate(years[0] + "-01-01")) / 864e5 + 1);
      return numberQ(`Silvester ${y - 1}: Wie viele Einsätze gab es am Neujahrstag, dem 01.01.${y}?`, n, E, {
        explain: `An einem normalen Tag sind es im Schnitt ${dec(usual)}.`,
        chart: bars(ny.map((yy) => ({ label: `01.01.${yy}`, value: rows.filter((r) => r.date === `${yy}-01-01`).length, hi: yy === y, tip: "" })), { labelWidth: 110 }),
      });
    }],
    ["", () => {
      const firsts = years.map((y) => inYear(y).at(-1)).filter((r) => r.date.endsWith("-01-01") && !r.timeUnknown && r.hour === 0);
      if (!firsts.length) return null;
      const r = pick(firsts), y = Number(r.date.slice(0, 4));
      const others = firsts.filter((o) => o !== r).map((o) => `${o.date.slice(0, 4)} um ${o.time} Uhr`);
      return numberQ(`Silvester ${y - 1}: Wie viele Minuten nach Mitternacht kam der erste Einsatz des Jahres ${y}?`, Number(r.time.slice(3, 5)), ["Minute", "Minuten"], {
        max: 60, near: [2, 5],
        explain: `Um ${r.time} Uhr: „${esc(r.event)}“.` + (others.length ? ` Zum Vergleich: ${andList(others)}.` : ""),
      });
    }],
    ["hours", () => {
      if (known.length < 50) return null;
      const night = known.filter((r) => r.hour >= NIGHT_START || r.hour < DAY_START).length, share = pct(night, known.length);
      const more = night / 8 > (known.length - night) / 16;
      return numberQ("Wie viel Prozent der Einsätze kommen nachts, zwischen 22 und 6 Uhr?", share, "%", {
        explain: `Die Nacht hat 8 von 24 Stunden, also 33 %. Pro Stunde ist nachts also ${more ? "mehr" : "weniger"} los als tagsüber.`,
        chart: hourBars((h) => h >= NIGHT_START || h < DAY_START),
      });
    }],
    ["hours", () => {
      const best = top(hours.map((n, h) => [h, n]).sort((a, b) => b[1] - a[1]));
      if (!best) return null;
      const label = (h) => `${h}–${h + 1} Uhr`;
      return choiceQ("In welcher Stunde wird am häufigsten alarmiert?", label(best[0]),
        hours.map((n, h) => (n <= best[1] * 0.75 ? label(h) : null)).filter(Boolean), {
          explain: `${label(best[0])}: ${einsaetze(best[1])}.`,
          chart: hourBars((h) => h === best[0]),
        });
    }],
    ["hours", () => {
      const fires = known.filter((r) => r.group === "Brand");
      if (fires.length < 50) return null;
      const parts = [["Nachts (0–6 Uhr)", 0], ["Morgens (6–12 Uhr)", 6], ["Nachmittags (12–18 Uhr)", 12], ["Abends (18–24 Uhr)", 18]]
        .map(([label, h]) => [label, fires.filter((r) => r.hour >= h && r.hour < h + 6).length]);
      const best = top([...parts].sort((a, b) => b[1] - a[1]));
      if (!best) return null;
      return inOrder(choiceQ("Zu welcher Tageszeit wird die FF Linden am häufigsten zu einem Brand alarmiert?", best[0], parts.map(([l]) => l), {
        explain: `${best[0]}: ${best[1]} von ${fires.length} Brandeinsätzen. Ausgelöste Rauchwarnmelder und Brandmeldeanlagen zählen mit.`,
        chart: bars(parts.map(([label, value]) => ({ label, value, hi: label === best[0], tip: "" })), { labelWidth: 190 }),
      }), parts.map(([l]) => l));
    }],
    ["weekdays", () => {
      // Großlagen would decide this on their own (the storm fell on a Tuesday), so they stay out.
      const per = WEEKDAYS_LONG.map((_, k) => calm.filter((r) => weekday(parseDate(r.date)) === k).length);
      const most = random() < 0.5;
      const best = top(per.map((n, k) => [k, n]).sort((a, b) => (most ? b[1] - a[1] : a[1] - b[1])));
      if (!best) return null;
      return inOrder(choiceQ(`An welchem Wochentag gibt es die ${most ? "meisten" : "wenigsten"} Einsätze?`, WEEKDAYS_LONG[best[0]], WEEKDAYS_LONG, {
        explain: `${WEEKDAYS_LONG[best[0]]}: ${einsaetze(best[1])} (ohne Großlagen).`,
        chart: columns(per.map((n, k) => ({ tick: WEEKDAYS[k], value: n, hi: k === best[0], tip: "" })), { height: 150 }),
      }), WEEKDAYS_LONG);
    }],
    ["weekdays", () => {
      if (calm.length < 50) return null;
      const per = WEEKDAYS.map((_, k) => calm.filter((r) => weekday(parseDate(r.date)) === k).length);
      const end = per[5] + per[6], more = end / 2 > (calm.length - end) / 5;
      return numberQ("Ohne Großlagen gezählt: Wie viel Prozent der Einsätze fallen aufs Wochenende, also auf Samstag oder Sonntag?", pct(end, calm.length), "%", {
        explain: `Samstag und Sonntag sind 2 von 7 Tagen, also 29 %. Pro Tag ist am Wochenende also ${more ? "mehr" : "weniger"} los als unter der Woche.`,
        chart: columns(per.map((n, k) => ({ tick: WEEKDAYS[k], value: n, hi: k >= 5, tip: "" })), { height: 150 }),
      });
    }],
    ["keywords", () => {
      const kws = counted(rows, plainName);
      const best = top(kws);
      if (!best) return null;
      return choiceQ("Welches Alarmstichwort kommt am häufigsten vor?", best[0], kws.slice(1, 7).map(([k]) => k), {
        explain: `${einsaetze(best[1])}, das sind ${pct(best[1], rows.length)} % aller Einsätze.`,
        chart: bars(kws.slice(0, 5).map(([k, n]) => ({ label: k, value: n, hi: k === best[0], tip: "" }))),
      });
    }],
    ["keywords", () => {
      const kws = counted(rows.filter((r) => keywords.codes[r.base]), (r) => r.base);
      if (kws.length < 5) return null;
      const once = kws.filter(([, n]) => n === 1).length;
      return numberQ("Wie viele verschiedene Alarmstichwörter kamen bisher vor?", kws.length, ["Stichwort", "Stichwörter"], {
        explain: `Am häufigsten „${esc(plainName(rows.find((r) => r.base === kws[0][0])))}“ mit ${einsaetze(kws[0][1], true)}.` +
          (once ? ` ${once === 1 ? "Ein Stichwort kam" : `${once} Stichwörter kamen`} nur ein einziges Mal vor.` : ""),
      });
    }],
    ["districts", () => {
      const best = top(districts);
      if (!best) return null;
      return choiceQ("In welchem Stadtteil gab es bisher die meisten Einsätze?", best[0], districts.slice(1, 6).map(([k]) => k), {
        explain: `${esc(best[0])}: ${einsaetze(best[1])}, das sind ${pct(best[1], rows.length)} %.`,
        chart: bars(districts.slice(0, 6).map(([k, n]) => ({ label: k, value: n, hi: k === best[0], tip: "" }))),
      });
    }],
    ["districts", () => {
      const options = districts.filter(([, n]) => n >= 10);
      if (!options.length) return null;
      const [d, n] = pick(options), rank = districts.findIndex(([k]) => k === d) + 1;
      return numberQ(`Wie viele Einsätze gab es bisher im Stadtteil ${esc(d)}?`, n, E, {
        explain: `Platz ${rank} von ${districts.length} Stadtteilen.`,
        chart: bars(districts.slice(0, Math.max(8, rank)).map(([k, v]) => ({ label: k, value: v, hi: k === d, tip: "" }))),
      });
    }],
    ["districts", () => {
      if (districts.length < 5) return null;
      const few = districts.filter(([, n]) => n <= 2).length;
      return numberQ("In wie vielen verschiedenen Stadtteilen war die FF Linden bisher im Einsatz?", districts.length, ["Stadtteil", "Stadtteile"], {
        explain: few ? `In ${few} davon nur ein- oder zweimal.` : "",
      });
    }],
    ["districts", () => {
      const ds = districts.filter(([, n]) => n >= 10), pairs = [];
      for (const a of ds) for (const b of ds) if (a[1] >= b[1] * 1.2) pairs.push(random() < 0.5 ? [a, b] : [b, a]);
      if (!pairs.length) return null;
      const [a, b] = pick(pairs);
      return pairQ(`Wo gab es bisher mehr Einsätze: ${esc(a[0])} oder ${esc(b[0])}?`, a[0], b[0], a[1] > b[1] ? a[0] : b[0], {
        explain: `${esc(a[0])}: ${einsaetze(a[1])}, ${esc(b[0])}: ${einsaetze(b[1])}.`,
      });
    }],
    ["districts", () => {
      const linden = ["Linden-Nord", "Linden-Mitte", "Linden-Süd"];
      const all = districts.reduce((a, [, n]) => a + n, 0), n = districts.filter(([k]) => linden.includes(k)).reduce((a, [, v]) => a + v, 0);
      if (all < 50 || !n) return null;
      const rest = districts.filter(([k]) => !linden.includes(k)).slice(0, 2);
      return numberQ("Wie viel Prozent ihrer Einsätze hatte die FF Linden in Linden selbst, also in Linden-Nord, Linden-Mitte und Linden-Süd?", pct(n, all), "%", {
        explain: `Von den übrigen lagen die meisten in den Stadtteilen ${andList(rest.map(([k, v]) => `${esc(k)} (${v})`))}.`,
        chart: bars(districts.slice(0, 7).map(([k, v]) => ({ label: k, value: v, hi: linden.includes(k), tip: "" }))),
      });
    }],
    ["streets", () => {
      if (streets.length < 8) return null;
      const most = streets[0][1];
      const right = pick(streets.filter(([, n]) => n === most))[0];
      const others = streets.filter(([, n]) => n <= most - 3 && n >= 2).map(([k]) => k);
      const q = choiceQ("Welche dieser Straßen hatte bisher die meisten Einsätze?", right, others, {
        explain: `${esc(right)}: ${einsaetze(most)}.` + (streets[1][1] === most ? ` Genauso viele: ${esc(streets.filter(([k, n]) => n === most && k !== right).map(([k]) => k).join(", "))}.` : ""),
      });
      if (q) q.chart = bars(q.options.map((o) => [o, streets.find(([k]) => k === o)[1]]).sort((a, b) => b[1] - a[1])
        .map(([k, n]) => ({ label: k, value: n, hi: k === right, tip: "" })));
      return q;
    }],
    ["streets", () => {
      if (streets.length < 20) return null;
      const once = streets.filter(([, n]) => n === 1).length;
      return numberQ("In wie vielen verschiedenen Straßen war die FF Linden bisher im Einsatz?", streets.length, ["Straße", "Straßen"], {
        explain: `In ${once} davon nur ein einziges Mal. Mitgezählt sind auch Plätze, Bahnhöfe und Stücke der Autobahn.`,
      });
    }],
    ["streets", () => {
      for (const [d] of shuffle(districts.filter(([, n]) => n >= 30))) {
        const st = counted(rows.filter((r) => r.district === d && r.street), (r) => r.street);
        const best = top(st);
        if (!best || best[1] < 3) continue;
        const less = st.filter(([, n]) => n < best[1]); // streets with a few alarms first, they are the better known ones
        const others = [...shuffle(less.filter(([, n]) => n >= 2)), ...shuffle(less.filter(([, n]) => n < 2))].slice(0, 3).map(([k]) => k);
        const q = choiceQ(`Wo im Stadtteil ${esc(d)} gab es bisher die meisten Einsätze?`, best[0], others, { explain: `${esc(best[0])}: ${einsaetze(best[1])}.` });
        if (q) q.chart = bars(q.options.map((o) => [o, st.find(([k]) => k === o)[1]]).sort((a, b) => b[1] - a[1])
          .map(([k, n]) => ({ label: k, value: n, hi: k === best[0], tip: "" })));
        return q;
      }
      return null;
    }],
    ["bma", () => {
      const bma = counted(rows.filter((r) => r.street && isBMA(r)), (r) => r.street);
      const best = top(bma);
      if (!best || best[1] < 3) return null;
      const q = choiceQ("An welchem dieser Orte hat eine Brandmeldeanlage am häufigsten ausgelöst?", best[0], bma.slice(1, 8).map(([k]) => k), {
        explain: `${esc(best[0])}: ${best[1]}-mal.`,
      });
      if (q) q.chart = bars(q.options.map((o) => [o, bma.find(([k]) => k === o)[1]]).sort((a, b) => b[1] - a[1])
        .map(([k, n]) => ({ label: k, value: n, hi: k === best[0], tip: "" })));
      return q;
    }],
    ["reasons", () => {
      const groups = counted(rows, (r) => r.group);
      const brand = groups.find(([g]) => g === "Brand");
      if (!brand) return null;
      return numberQ("Wie viel Prozent aller Einsätze sind Brände, vom Rauchmelder bis zum Wohnungsbrand?", pct(brand[1], rows.length), "%", {
        chart: bars(groups.slice(0, 5).map(([g, n]) => ({ label: g, value: n, display: `${pct(n, rows.length)} %`, hi: g === "Brand", tip: "" }))),
      });
    }],
    ["reasons", (taken) => {
      const pool = reasons.filter((x) => !taken.has("days") || !reasonNote(x));
      if (!pool.length) return null;
      const x = pick(pool), n = x.list.length;
      return numberQ(x.text, n, ["Mal", "Mal"], {
        explain: `Das ist ungefähr jeder ${Math.round(rows.length / n)}. Einsatz.` + reasonNote(x, false),
        chart: bars([...reasons].sort((a, b) => b.list.length - a.list.length)
          .map((y) => ({ label: y.label, value: y.list.length, hi: y === x, tip: "" })), { labelWidth: 190 }),
        tags: reasonNote(x) ? ["days"] : [],
      });
    }],
    ["reasons", (taken) => {
      const pool = reasons.filter((x) => !taken.has("days") || !reasonNote(x)), pairs = [];
      for (const a of pool) for (const b of pool) if (a.list.length >= b.list.length * 1.2) pairs.push(random() < 0.5 ? [a, b] : [b, a]);
      if (!pairs.length) return null;
      const [a, b] = pick(pairs);
      return pairQ(`Was kam bisher öfter vor: ${a.label} oder ${b.label}?`, a.label, b.label, a.list.length > b.list.length ? a.label : b.label, {
        explain: `${a.label}: ${a.list.length}-mal, ${b.label}: ${b.list.length}-mal.` + reasonNote(a, true) + reasonNote(b, true),
        tags: reasonNote(a) || reasonNote(b) ? ["days"] : [],
      });
    }],
    ["radius", () => {
      const { n, far } = radiusSummary(radiusPoints(rows, geo));
      if (n < 20) return null;
      return numberQ("Wie viele Kilometer Luftlinie lag der bisher weiteste Einsatz von der Wache entfernt?", Math.round(far.km), ["Kilometer", "Kilometer"], {
        explain: `Genau ${fmtKm(far.km)}, am ${fmtDate(far.r.date)}: „${esc(far.r.event)}“ (${esc(far.r.street)}, ${esc(far.r.district)}).`,
      });
    }],
    ["radius", () => {
      const { n, median, within2, bins } = radiusSummary(radiusPoints(rows, geo));
      if (n < 50) return null;
      return numberQ("Wie viel Prozent der Einsätze lagen höchstens 2 km Luftlinie von der Wache entfernt?", pct(within2, n), "%", {
        explain: `Die Hälfte lag sogar näher als ${fmtKm(median)}.`,
        chart: bars(RADIUS_BINS.map(([, hi, label], i) => ({ label, value: bins[i], hi: hi <= 2, tip: "" })), { labelWidth: 110 }),
      });
    }],
    ["weather", () => {
      // like the Wetter view: Silvester/Neujahr and Großlagen left out
      const per = {}, big = new Set(rows.filter((r) => r.bigDay).map((r) => r.date));
      for (const r of calm) per[r.date] = (per[r.date] || 0) + 1;
      const days = Object.keys(weather).filter((d) => d >= first && d <= listed && !big.has(d) && !["12-31", "01-01"].includes(d.slice(5)));
      if (days.length < 200) return null;
      const avg = (ds) => ds.reduce((a, d) => a + (per[d] || 0), 0) / ds.length;
      const kinds = [
        [`Hitze ab ${HOT} °C`, (w) => w.tmax >= HOT], ["Frost", (w) => w.tmin < 0],
        [`Sturm mit Böen ab ${GUST} km/h`, (w) => w.gust >= GUST], ["Viel Regen, ab 10 mm", (w) => w.rain >= 10],
      ].map(([label, is]) => { const ds = days.filter((d) => is(weather[d])); return { label, n: ds.length, avg: avg(ds) }; }).filter((k) => k.n >= 10);
      const sorted = [...kinds].sort((a, b) => b.avg - a.avg);
      if (kinds.length < 3 || sorted[0].avg < sorted[1].avg * 1.2) return null;
      return inOrder(choiceQ("Bei welchem Wetter gibt es pro Tag die meisten Einsätze?", sorted[0].label, kinds.map((k) => k.label), {
        explain: `${sorted[0].label}: ${dec(sorted[0].avg)} Einsätze pro Tag, im Schnitt aller Tage sind es ${dec(avg(days))}. Silvester und Großlagen zählen nicht mit.`,
        chart: bars(sorted.map((k) => ({ label: k.label, value: k.avg, display: dec(k.avg), hi: k === sorted[0], tip: "" })), { labelWidth: 210 }),
      }), kinds.map((k) => k.label));
    }],
    ["", () => {
      const best = longestRun(dates, first, listed, false);
      if (!best || best.len < 3) return null;
      return numberQ("Die längste Pause bisher: Wie viele Tage hintereinander gab es keinen einzigen Einsatz?", best.len, T, {
        explain: `Die längste Pause ging vom ${fmtDate(best.from)} bis zum ${fmtDate(best.to)}.`,
      });
    }],
    ["", () => {
      const best = longestRun(dates, first, listed, true);
      if (!best || best.len < 3) return null;
      return numberQ("Die längste Serie bisher: An wie vielen Tagen hintereinander gab es jeden Tag mindestens einen Einsatz?", best.len, T, {
        explain: `Die Serie ging vom ${fmtDate(best.from)} bis zum ${fmtDate(best.to)}.`,
      });
    }],
    ["", () => {
      if (!full.length) return null;
      const y = pick(full), n = new Set(inYear(y).map((r) => r.date)).size;
      const len = new Date(Number(y), 1, 29).getDate() === 29 ? 366 : 365;
      return numberQ(`An wie vielen Tagen im Jahr ${y} gab es mindestens einen Einsatz?`, n, T, {
        max: len, explain: `Das ist ungefähr jeder ${Math.round(len / n)}. Tag. An den anderen ${len - n} Tagen blieb es ruhig.`,
      });
    }],
    ["", () => {
      const ts = calm.map(stamp).sort((a, b) => a - b);
      if (ts.length < 50) return null;
      const gaps = ts.slice(1).map((t, k) => (t - ts[k]) / 36e5).sort((a, b) => a - b);
      const h = Math.round((ts.at(-1) - ts[0]) / 36e5 / gaps.length), mid = Math.round(gaps[Math.floor(gaps.length / 2)]);
      return numberQ("Ohne Großlagen gezählt: Wie viele Stunden liegen im Schnitt zwischen zwei Einsätzen?", h, ["Stunde", "Stunden"], {
        explain: `Das sind etwa ${dec(h / 24)} Tage.` + (mid < h * 0.8 ? ` Die Hälfte der Abstände ist aber kürzer als ${mid} Stunden.` : ""),
      });
    }],
    ["myth", (taken) => {
      // the heat and weekend myths and the weather and weekday questions give each other away
      const tag = (m) => (/Hitze/.test(m.title) ? "weather" : /Wochenende/.test(m.title) ? "weekdays" : "");
      const ms = myths().results.filter((m) => !/^Silvester/.test(m.title) && ["yes", "none"].includes(mythVerdict(m.t)[0]) && m.t.n >= 10 && !taken.has(tag(m)));
      if (!ms.length) return null;
      const m = pick(ms);
      return { kind: "choice", text: `Stimmt das? „${m.title}“`, options: ["Stimmt", "Stimmt nicht"],
        right: mythVerdict(m.t, m.pick)[0] === "yes" && m.t.avg > m.t.base ? "Stimmt" : "Stimmt nicht",
        explain: mythSentence(m), chart: { type: "myth", myth: m }, tags: [tag(m)] };
    }],
  ];
  // Kinds from the last round go to the back, so the next round brings new ones.
  const order = shuffle(gens.map((_, k) => k)).sort((a, b) => recent.has(a) - recent.has(b));
  const qs = [], taken = new Set(), used = new Set();
  for (const k of order) {
    if (qs.length === QUIZ_LEN) break;
    const [topic, make] = gens[k];
    if (taken.has(topic)) continue;
    const q = make(taken);
    if (!q) continue;
    qs.push(q);
    used.add(k);
    for (const t of [topic, ...q.tags]) if (t) taken.add(t);
  }
  return { qs, used };
}
