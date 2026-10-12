import { describe, test, expect } from "vitest";
import {
  isBMA, isRWM, addressGroups, dotKind, dotGroups, dotLayout, DOT_KINDS, DOT_ORDER, WACHE, KM_X, KM_Y, RADIUS_BINS, radiusPoints, radiusSummary,
} from "../../web/src/lib/places.js";

const alarm = (more = {}) => ({ date: "2026-10-07", hour: 12, timeUnknown: false, base: "th", event: "", group: "Brand", street: "", district: "", ...more });

test("fire alarm systems by keyword or event, smoke alarms by event", () => {
  expect([alarm({ base: "o" }), alarm({ event: "BMA Altenheim" }), alarm({ event: "Brandmeldeanlage" }), alarm({ event: "Brandmelder ausgelöst" })]
    .every(isBMA)).toBe(true);
  expect(isBMA(alarm({ event: "BMAX" }))).toBe(false);
  expect([alarm({ event: "RWM" }), alarm({ event: "Rauchwarnmelder piept" }), alarm({ event: "Rauchmelder" })].every(isRWM)).toBe(true);
  expect(isRWM(alarm({ event: "Rauch aus Fenster" }))).toBe(false);
});

test("addressGroups: streets with enough alarms, most first, then by name", () => {
  const rows = ["Limmerstraße", "Ärztehaus", "Limmerstraße", "Bahnhof", "Ärztehaus", "", "Bahnhof", "Ärztehaus", "Bahnhof", "Fössestraße"]
    .map((street) => alarm({ street }));
  expect(addressGroups(rows, 2).map(([s, l]) => [s, l.length])).toEqual([["Ärztehaus", 3], ["Bahnhof", 3], ["Limmerstraße", 2]]);
  expect(addressGroups(rows, 4)).toEqual([]);
});

test("dot colours: Brand, Technische Hilfe, Unwetter, the rest grey", () => {
  expect(["Brand", "Technische Hilfe", "Unwetter", "Gas & Gefahrstoffe"].map((group) => dotKind(alarm({ group }))))
    .toEqual(["brand", "hilfe", "unwetter", "other"]);
});

test("the dot wall's order holds every colour once, grey last", () => {
  expect(DOT_ORDER).toEqual([...DOT_KINDS.map(([kind]) => kind), "other"]);
});

describe("dotGroups", () => {
  test("by month and by hour, alarms without a time last", () => {
    const rows = [alarm({ date: "2026-01-05" }), alarm({ date: "2026-03-01", hour: 3 }), alarm({ date: "2026-03-02", timeUnknown: true, hour: 0 })];
    const months = dotGroups(rows, "month");
    expect([months.length, months[0].label, months[0].rows.length, months[2].rows.length]).toEqual([12, "Jan", 1, 2]);
    const hours = dotGroups(rows, "hour");
    expect([hours.length, hours[3].rows.length, hours[0].rows.length, hours.at(-1).label]).toEqual([25, 1, 0, "?"]);
    expect(dotGroups(rows.slice(0, 2), "hour").length).toBe(24);
  });

  test("by type, and the twelve busiest districts with the rest together", () => {
    const rows = Array.from({ length: 15 }, (_, k) => Array.from({ length: 20 - k }, () => alarm({ district: `D${k}`, group: k % 2 ? "Brand" : "Unwetter" }))).flat();
    expect(dotGroups(rows, "type").map((g) => g.label)).toEqual(["Unwetter", "Brand"]);
    const districts = dotGroups(rows, "district");
    expect(districts.map((g) => g.label)).toEqual([...Array.from({ length: 12 }, (_, k) => `D${k}`), "3 weitere"]);
    expect(districts.at(-1).rows.length).toBe(8 + 7 + 6);
  });
});

describe("dotLayout", () => {
  // newest first, as in the data: two Brand alarms and an Unwetter one in January, Technische Hilfe in March
  const rows = [
    alarm({ date: "2026-03-02", time: "10:00", hour: 10, group: "Technische Hilfe" }),
    alarm({ date: "2026-01-20", time: "08:00", hour: 8, group: "Brand" }),
    alarm({ date: "2026-01-05", time: "23:00", hour: 23, group: "Unwetter" }),
    alarm({ date: "2026-01-05", time: "09:00", hour: 9, group: "Brand" }),
  ];

  test("by month: a column per month, dots 9 px apart, by colour and then oldest first, numbers above", () => {
    const { pos, labels, H, r } = dotLayout(rows, "month", 1200);
    // columns 100 px wide with 10 dots per line, centred: January from x 5, March from x 205
    expect(rows.map((a) => pos.get(a))).toEqual([[209.5, 22.5], [18.5, 22.5], [27.5, 22.5], [9.5, 22.5]]);
    expect([H, r]).toEqual([18 + 9 + 22, 9 * 0.38]);
    expect(labels.slice(0, 5)).toEqual([
      { x: 50, y: 13, anchor: "middle", count: true, text: "3" }, { x: 50, y: 44, anchor: "middle", text: "Jan" },
      { x: 150, y: 44, anchor: "middle", text: "Feb" },
      { x: 250, y: 13, anchor: "middle", count: true, text: "1" }, { x: 250, y: 44, anchor: "middle", text: "Mär" },
    ]);
    expect(labels.filter((l) => !l.count).map((l) => l.text)).toHaveLength(12);
  });

  test("a full column grows upwards, and each number sits on its own column", () => {
    const many = Array.from({ length: 12 }, (_, k) => alarm({ date: `2026-01-${String(k + 1).padStart(2, "0")}`, time: "12:00" }));
    const { pos, labels, H } = dotLayout([...many, rows[0]], "month", 1200);
    expect(H).toBe(18 + 2 * 9 + 22);
    expect(many.map((a) => pos.get(a)[1])).toEqual([...Array(10).fill(31.5), 22.5, 22.5]);
    expect(labels.filter((l) => l.count).map((l) => [l.text, l.y])).toEqual([["12", 13], ["1", 22]]);
  });

  test("by hour: a column per hour and one for alarms without a time; a narrow chart has smaller dots and fewer labels", () => {
    const all = [...rows, alarm({ date: "2026-02-01", time: "00:00", hour: 0, timeUnknown: true })];
    const wide = dotLayout(all, "hour", 1200);
    expect(wide.labels.filter((l) => !l.count).map((l) => l.text)).toEqual([...Array.from({ length: 24 }, (_, h) => String(h)), "?"]);
    expect(wide.labels.filter((l) => l.count).map((l) => l.text)).toEqual(["1", "1", "1", "1", "1"]);
    const narrow = dotLayout(all, "hour", 390);
    expect(narrow.labels.map((l) => l.text)).toEqual(["0", "3", "6", "9", "12", "15", "18", "21", "?"]);
    expect([narrow.r, narrow.H]).toEqual([7 * 0.38, 18 + 7 + 22]);
  });

  test("by type and district: a line per group, its name before and its number after the dots", () => {
    const { pos, labels, H } = dotLayout(rows, "type", 1200);
    expect(rows.map((a) => pos.get(a))).toEqual([[184.5, 27.5], [193.5, 8.5], [184.5, 46.5], [184.5, 8.5]]);
    expect(labels.slice(0, 2)).toEqual([{ x: 172, y: 12.5, anchor: "end", text: "Brand" }, { x: 204, y: 12.5, count: true, text: "2" }]);
    expect(H).toBe(4 + 3 * (9 + 10));
    // on a phone: 30 dots in a line next to names at most 140 px wide, then the next line
    const street = Array.from({ length: 31 }, (_, k) => alarm({ date: `2026-05-${String(k + 1).padStart(2, "0")}`, time: "12:00", district: "Linden-Nord" }));
    const phone = dotLayout(street, "district", 390);
    expect([phone.pos.get(street[29]), phone.pos.get(street[30])]).toEqual([[140 + 29 * 7 + 3.5, 7.5], [143.5, 14.5]]);
    expect(phone.labels).toEqual([{ x: 132, y: 11.5, anchor: "end", text: "Linden-Nord" }, { x: 140 + 30 * 7 + 6, y: 11.5, count: true, text: "31" }]);
    expect(phone.H).toBe(4 + 2 * 7 + 10);
  });
});

describe("radius", () => {
  // 800 m north, 1.5 km east and 3.4 km west of the Wache
  const geo = {
    "Nord|Linden-Nord": [WACHE[0] + 0.8 / KM_Y, WACHE[1]],
    "Ost|Mitte": [WACHE[0], WACHE[1] + 1.5 / KM_X],
    "West|Davenstedt": [WACHE[0], WACHE[1] - 3.4 / KM_X],
  };
  const rows = [ // newest first, like the data
    alarm({ date: "2026-10-07", street: "Ost", district: "Mitte" }),
    alarm({ date: "2026-10-05", street: "Unbekannt", district: "Ahlem" }),
    alarm({ date: "2026-10-03", street: "West", district: "Davenstedt", geoKey: "West|Davenstedt", group: "Technische Hilfe" }),
    alarm({ date: "2026-10-01", street: "Nord", district: "Linden-Nord" }),
  ];

  test("radiusPoints: located alarms, oldest first, with distance and day", () => {
    const pts = radiusPoints(rows, geo);
    expect(pts.map((p) => [p.r.street, p.day, p.kind])).toEqual([["Nord", 0, "brand"], ["West", 2, "hilfe"], ["Ost", 6, "brand"]]);
    expect(pts.map((p) => p.km)).toEqual([expect.closeTo(0.8, 10), expect.closeTo(3.4, 10), expect.closeTo(1.5, 10)]);
  });

  test("radiusSummary: middle distance, within 2 km, the farthest, and the rings", () => {
    const s = radiusSummary(radiusPoints(rows, geo));
    expect([s.n, s.median, s.within2, s.far.r.street]).toEqual([3, expect.closeTo(1.5, 10), 2, "West"]);
    expect(s.bins).toEqual([0, 1, 1, 0, 1, 0]);
    expect(RADIUS_BINS.map(([, , label]) => label)).toEqual(["bis 500 m", "0,5–1 km", "1–2 km", "2–3 km", "3–5 km", "über 5 km"]);
    expect(radiusSummary([])).toEqual({ n: 0, median: null, within2: 0, far: null, bins: [0, 0, 0, 0, 0, 0] });
  });
});
