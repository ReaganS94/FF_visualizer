// The warnings for Hannover, with both warning services answered by the test: on Übersicht while they are
// calm, at the very top of every tab as soon as one needs attention.
import { test, expect, json, openSite, device } from "./fixtures.js";
import { devices } from "@playwright/test";

const NOW = new Date("2026-10-07T12:00:00+02:00");

// Bright Sky's answer: the DWD's warnings for the city.
const dwdAlert = (o) => ({ status: "actual", category: "met", response_type: "prepare", certainty: "likely", instruction_de: null, ...o });
const DWD = {
  location: { warn_cell_id: 803241001, name: "Stadt Hannover" },
  alerts: [
    dwdAlert({ id: 1, onset: "2026-10-07T14:00:00+02:00", expires: "2026-10-07T20:00:00+02:00", severity: "severe",
      headline_de: "Amtliche UNWETTERWARNUNG vor HEFTIGEM STARKREGEN",
      description_de: "Es tritt heftiger Starkregen auf. <Test> & \"Quote\"",
      instruction_de: "ACHTUNG! Überflutungen von Kellern sind möglich." }),
    dwdAlert({ id: 2, onset: "2026-10-08T02:00:00+02:00", expires: "2026-10-08T09:00:00+02:00", severity: "minor",
      headline_de: "Amtliche WARNUNG vor FROST", description_de: "Es tritt leichter Frost auf." }),
    dwdAlert({ id: 3, onset: "2026-10-06T10:00:00+02:00", expires: "2026-10-06T20:00:00+02:00", severity: "moderate",
      headline_de: "ABGELAUFEN", description_de: "alt" }),
    dwdAlert({ id: 4, onset: "2026-10-07T09:00:00+02:00", expires: "2026-10-07T19:00:00+02:00", severity: "moderate",
      headline_de: "Amtliche WARNUNG vor STURMBÖEN", description_de: "Sturmböen um 70 km/h." }),
    dwdAlert({ id: 5, status: "test", onset: "2026-10-07T09:00:00+02:00", expires: "2026-10-07T19:00:00+02:00", severity: "extreme",
      headline_de: "NUR EIN TEST", description_de: "test" }),
  ],
};

// NINA's answer: everything for the Region Hannover, including its own copy of a DWD warning.
const ninaItem = (id, data, o) => ({ id, payload: { data: { msgType: "Alert", ...data } }, ...o });
const NINA = [
  ninaItem("dwd.1", { provider: "DWD", severity: "Moderate" }, { i18nTitle: { de: "NINA-KOPIE: Amtliche WARNUNG vor STURMBÖEN" },
    sent: "2026-10-07T09:00:00+02:00", expires: "2026-10-07T19:00:00+02:00" }),
  ninaItem("mow.1", { provider: "MOWAS", severity: "Severe" }, { i18nTitle: { de: "Brand in Linden-Nord: Fenster und Türen geschlossen halten" },
    sent: "2026-10-07T11:30:00+02:00" }),
  ninaItem("lhp.1", { provider: "LHP", severity: "Minor" }, { i18nTitle: { de: "ABGELAUFENES HOCHWASSER" },
    sent: "2026-10-01T09:00:00+02:00", expires: "2026-10-02T09:00:00+02:00" }),
  ninaItem("mow.2", { provider: "MOWAS", severity: "Minor", msgType: "Cancel" }, { i18nTitle: { de: "ENTWARNUNG" },
    sent: "2026-10-07T08:00:00+02:00" }),
];

// Routes both services (null = the browser can't load it) and opens the site.
async function openWarnings(page, { dwd = DWD, nina = NINA } = {}) {
  page.calls = { dwd: 0, nina: 0 };
  await page.clock.install({ time: NOW });
  await page.route("https://api.brightsky.dev/**", (r) => { page.calls.dwd++; return dwd === null ? r.abort() : r.fulfill(dwd.status ? dwd : json(dwd)); });
  await page.route("https://warnung.bund.de/**", (r) => { page.calls.nina++; return nina === null ? r.abort() : r.fulfill(json(nina)); });
  await openSite(page);
}
const top = (page) => page.locator("#warn-top"); // the very top of every tab
const box = (page) => page.locator("#warnings"); // on Übersicht
const titles = (el) => el.locator(".warn-title").allTextContents();
const source = (el) => el.locator(":scope > .note").textContent();
const moves = (el) => el.locator(".warn").evaluateAll((ws) => ws.map((w) => (/\b(shake|pulse)\b/.exec(w.className) || ["still"])[0]));
const FROST = { alerts: [DWD.alerts[1]] };
const GUSTS = { alerts: [DWD.alerts[3], DWD.alerts[1]] };

test("puts all warnings at the very top of every tab once one needs attention, most urgent first", async ({ page }) => {
  await openWarnings(page);
  await expect(top(page)).toBeVisible();
  await expect(box(page)).toBeHidden();
  // old, lifted, test and doubled ones are left out
  expect(await titles(top(page))).toEqual([
    "Brand in Linden-Nord: Fenster und Türen geschlossen halten",
    "Amtliche UNWETTERWARNUNG vor HEFTIGEM STARKREGEN",
    "Amtliche WARNUNG vor STURMBÖEN",
    "Amtliche WARNUNG vor FROST",
  ]);
  expect(await top(page).locator(".warn-meta").allInnerTexts()).toEqual([
    "Bevölkerungsschutz\nseit heute 11:30 Uhr",
    "Wetter · Stufe 3 von 4\nheute 14:00 bis 20:00 Uhr",
    "Wetter · Stufe 2 von 4\nbis heute 19:00 Uhr",
    "Wetter · Stufe 1 von 4\nmorgen 02:00 bis 09:00 Uhr",
  ].map((t) => expect.stringMatching(t.replace(/\n/, "\\s+"))));
  // only the first one moves, so several warnings don't turn into a light show
  expect(await moves(top(page))).toEqual(["pulse", "still", "still", "still"]);
  expect(await top(page).locator(".warn").first().evaluate((w) => getComputedStyle(w).animationName)).toBe("warn-ring");
  // text from the services shows as text, never as page markup
  await expect(top(page)).toContainText('<Test> & "Quote"');
  expect(await top(page).locator("test").count()).toBe(0);
  expect(await source(top(page))).toBe("Quellen: Deutscher Wetterdienst (Stadt Hannover) und Warn-App NINA (Region Hannover). Stand: 12:00 Uhr.");
  expect(await top(page).evaluate((el) => el === document.body.firstElementChild)).toBe(true);
  for (const view of ["calendar", "chance", "overview"]) {
    await page.click(`nav button[data-view=${view}]`);
    await expect(top(page)).toBeVisible();
    await expect(top(page).locator(".warn")).toHaveCount(4);
  }
  await expect(box(page)).toBeHidden();
  expect(page.errors).toEqual([]);
});

test("loads when the page opens and again every 5 minutes, keeping an opened \"Was tun?\" open", async ({ page }) => {
  await openWarnings(page);
  await expect(top(page)).toBeVisible();
  expect(page.calls).toEqual({ dwd: 1, nina: 1 });
  await page.click("#warn-top details summary");
  await page.click("nav button[data-view=calendar]");
  await page.click("nav button[data-view=chance]");
  expect(page.calls).toEqual({ dwd: 1, nina: 1 });
  await page.clock.runFor(5 * 60 * 1000 + 1000);
  await expect.poll(() => page.calls.dwd).toBe(2);
  await expect(top(page).locator(":scope > .note")).toContainText("Stand: 12:05 Uhr.");
  expect(await top(page).locator("details").evaluate((d) => d.open)).toBe(true);
});

test("a Stufe 2 warning goes to the top too, and only shakes once", async ({ page }) => {
  await openWarnings(page, { dwd: GUSTS, nina: [] });
  await expect(top(page)).toBeVisible();
  expect(await titles(top(page))).toEqual(["Amtliche WARNUNG vor STURMBÖEN", "Amtliche WARNUNG vor FROST"]);
  expect(await moves(top(page))).toEqual(["shake", "still"]);
  expect(await top(page).locator(".warn").first().evaluate((w) => getComputedStyle(w).animationIterationCount)).toBe("1, 2");
  await expect(box(page)).toBeHidden();
});

test("Stufe 1 warnings stay calm on Übersicht", async ({ page }) => {
  await openWarnings(page, { dwd: FROST, nina: [] });
  await expect(box(page)).toBeVisible();
  expect(await titles(box(page))).toEqual(["Amtliche WARNUNG vor FROST"]);
  expect(await moves(box(page))).toEqual(["still"]);
  await expect(top(page)).toBeHidden();
  await page.click("nav button[data-view=calendar]");
  await expect(box(page)).toBeHidden();
  await expect(top(page)).toBeHidden();
});

test("says on Übersicht when there are no warnings", async ({ page }) => {
  await openWarnings(page, { dwd: { alerts: [] }, nina: [] });
  await expect(box(page).locator(".warn-none")).toHaveText(/Für Hannover gibt es gerade keine amtlichen Warnungen\./);
  await expect(top(page)).toBeHidden();
});

test("points to the NINA app when the browser can't load NINA", async ({ page }) => {
  await openWarnings(page, { dwd: { alerts: [] }, nina: null });
  await expect(box(page).locator(".warn-none")).toHaveText(/keine Wetterwarnungen\./);
  expect(await source(box(page))).toBe("Quelle: Deutscher Wetterdienst (Stadt Hannover). Andere Warnungen, etwa zu Bränden mit starkem Rauch oder zu Evakuierungen, stehen in der Warn-App NINA. Stand: 12:00 Uhr.");
});

test("uses NINA's copy of the weather warnings when the DWD list can't be loaded", async ({ page }) => {
  await openWarnings(page, { dwd: { status: 503, body: "down" } });
  await expect(top(page)).toBeVisible();
  expect(await titles(top(page))).toEqual(["Brand in Linden-Nord: Fenster und Türen geschlossen halten", "NINA-KOPIE: Amtliche WARNUNG vor STURMBÖEN"]);
  await expect(top(page).locator(".warn-tag").nth(1)).toHaveText("Wetter · Stufe 2 von 4");
  expect(await source(top(page))).toMatch(/^Quelle: Warn-App NINA \(Region Hannover\), mit den Wetterwarnungen des Deutschen Wetterdienstes\. Stand/);
});

test("says so when neither service can be loaded", async ({ page }) => {
  await openWarnings(page, { dwd: null, nina: null });
  await expect(box(page)).toBeVisible();
  expect(await source(box(page))).toBe("Die Warnungen konnten gerade nicht geladen werden. Sie stehen beim Deutschen Wetterdienst und in der Warn-App NINA.");
  expect(await page.locator(".warn").count()).toBe(0);
  await expect(top(page)).toBeHidden();
});

test.describe("when the device asks for less motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });
  test("nothing moves", async ({ page }) => {
    await openWarnings(page);
    await expect(top(page)).toBeVisible();
    const first = top(page).locator(".warn").first();
    expect(await first.evaluate((w) => getComputedStyle(w).animationName)).toBe("none");
    expect(await first.locator(".warn-icon").evaluate((w) => getComputedStyle(w).animationName)).toBe("none");
  });
});

test.describe("on a phone", () => {
  test.use(device(devices["iPhone 13"]));
  test("fits the screen", async ({ page }) => {
    await openWarnings(page);
    await expect(top(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
});
