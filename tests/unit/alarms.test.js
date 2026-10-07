import { describe, test, expect } from "vitest";
import { tidyStreet, sameAlarm, matchedManual, mergeManual, clean } from "../../docs/lib/alarms.js";

const alarm = (date, time, keyword, more = {}) =>
  ({ date, time, category: "Einsatz", keyword, event: "Test", street: "Teststraße", district: "Linden-Mitte", remarks: "", ...more });

describe("tidyStreet", () => {
  test("writes Straße like the website", () => {
    expect(tidyStreet("Limmerstrasse")).toBe("Limmerstraße");
    expect(tidyStreet("Fössestr.")).toBe("Fössestraße");
    expect(tidyStreet("Fössestr. 12")).toBe("Fössestraße 12");
    expect(tidyStreet("Davenstedter Str.")).toBe("Davenstedter Straße");
    expect(tidyStreet("Davenstedter Strasse")).toBe("Davenstedter Straße");
  });

  test("leaves other names alone", () => {
    expect(tidyStreet("Straßburger Platz")).toBe("Straßburger Platz");
    expect(tidyStreet("Strandweg")).toBe("Strandweg");
    expect(tidyStreet("NieschlagS/WittekindS")).toBe("NieschlagS/WittekindS");
    expect(tidyStreet(undefined)).toBe("");
  });
});

describe("sameAlarm", () => {
  test("same keyword within an hour, also across midnight", () => {
    expect(sameAlarm(alarm("2026-09-20", "23:50", "th1"), alarm("2026-09-21", "00:10", "th1"))).toBe(true);
    expect(sameAlarm(alarm("2026-09-20", "10:00", "th1"), alarm("2026-09-20", "11:00", "TH1"))).toBe(true);
    expect(sameAlarm(alarm("2026-09-20", "10:00", "b2/öel"), alarm("2026-09-20", "10:30", "b2"))).toBe(true);
  });

  test("not with another keyword or more than an hour apart", () => {
    expect(sameAlarm(alarm("2026-09-20", "10:00", "th1"), alarm("2026-09-20", "11:01", "th1"))).toBe(false);
    expect(sameAlarm(alarm("2026-09-20", "10:00", "th1"), alarm("2026-09-20", "10:00", "th2"))).toBe(false);
  });
});

describe("matchedManual", () => {
  test("a website alarm stands in for one hand entry, the closest in time", () => {
    const near = alarm("2026-09-20", "10:00", "th1"), far = alarm("2026-09-20", "10:40", "th1");
    expect([...matchedManual([alarm("2026-09-20", "10:05", "th1")], [far, near])]).toEqual([near]);
  });

  test("two website alarms stand in for two hand entries", () => {
    const a = alarm("2026-09-20", "10:00", "th1"), b = alarm("2026-09-20", "10:40", "th1");
    const web = [alarm("2026-09-20", "10:45", "th1"), alarm("2026-09-20", "10:05", "th1", { street: "Kochstraße" })];
    expect(matchedManual(web, [a, b])).toEqual(new Set([a, b]));
  });

  test("an alarm the website lists twice counts once", () => {
    const web = [alarm("2026-09-20", "10:05", "th1"), alarm("2026-09-20", "10:05", "th1", { remarks: "Presse" })];
    expect(matchedManual(web, [alarm("2026-09-20", "10:00", "th1"), alarm("2026-09-20", "10:40", "th1")]).size).toBe(1);
  });

  test("only alarms on the website count, not its other entries", () => {
    const web = [alarm("2026-09-20", "10:05", "th1", { category: "Veranstaltung" })];
    expect(matchedManual(web, [alarm("2026-09-20", "10:00", "th1")]).size).toBe(0);
  });
});

test("mergeManual adds the hand entries the website doesn't list yet, newest first", () => {
  const web = [alarm("2026-09-28", "18:00", "b1"), alarm("2026-09-20", "10:05", "th1")];
  const listed = alarm("2026-09-20", "10:00", "th1"), pending = alarm("2026-09-29", "22:00", "b1");
  expect(mergeManual(web, [listed, pending]).map((r) => `${r.date} ${r.time}${r.manual ? " vorläufig" : ""}`)).toEqual([
    "2026-09-29 22:00 vorläufig",
    "2026-09-28 18:00",
    "2026-09-20 10:05",
  ]);
});

describe("clean", () => {
  const KW = {
    groups: { brand: "Brand", hilfe: "Technische Hilfe" },
    codes: { b2: { name: "Brand, mittel", group: "brand" }, th1: { name: "Hilfe, klein", group: "hilfe" } },
  };

  test("keeps each alarm once, with its keyword's name and group", () => {
    const rows = clean([
      alarm("2026-09-20", "10:05", "B2/öel", { street: "Limmerstrasse" }),
      alarm("2026-09-20", "10:05", "B2/öel", { street: "Limmerstraße", remarks: "Presse" }), // listed twice
      alarm("2026-09-20", "11:30", "xyz"),
      alarm("2026-09-21", "09:00", "b2", { category: "Veranstaltung" }),
    ], KW);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      street: "Limmerstraße", geoKey: "Limmerstrasse|Linden-Mitte", base: "b2", name: "Brand, mittel", group: "Brand",
      hour: 10, standby: false, bigDay: false,
    });
    expect(rows[1]).toMatchObject({ base: "xyz", name: "xyz", group: "Unbekannt", hour: 11 });
  });

  test("a day with 10 or more alarms is a Großlage, except Neujahr, and standbys don't count", () => {
    const day = (date, n, keyword = "th1", time = (i) => `${String(i).padStart(2, "0")}:15`) =>
      Array.from({ length: n }, (_, i) => alarm(date, time(i), keyword, { street: `Straße ${i}` }));
    const rows = clean([
      ...day("2026-07-14", 10, "th1", () => "00:00"), // the storm, entered with a placeholder time
      ...day("2026-01-01", 12),
      ...day("2026-07-15", 9), ...day("2026-07-15", 3, "vs"),
    ], KW);
    const big = (date) => [...new Set(rows.filter((r) => r.date === date).map((r) => r.bigDay))];
    expect(big("2026-07-14")).toEqual([true]);
    expect(big("2026-01-01")).toEqual([false]);
    expect(big("2026-07-15")).toEqual([false]);
    expect(rows.filter((r) => r.timeUnknown)).toHaveLength(10);
    expect(rows.filter((r) => r.standby)).toHaveLength(3);
  });
});
