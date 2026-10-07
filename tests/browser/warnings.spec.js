// The "Warnungen für Hannover" box on "Einsatz heute?", with both warning services answered by the test.
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

// Routes both services (null = the browser can't load it) and opens "Einsatz heute?".
async function openWarnings(page, { dwd = DWD, nina = NINA } = {}) {
  page.calls = { dwd: 0, nina: 0 };
  await page.clock.install({ time: NOW });
  await page.route("https://api.brightsky.dev/**", (r) => { page.calls.dwd++; return dwd === null ? r.abort() : r.fulfill(dwd.status ? dwd : json(dwd)); });
  await page.route("https://warnung.bund.de/**", (r) => { page.calls.nina++; return nina === null ? r.abort() : r.fulfill(json(nina)); });
  await openSite(page);
  await page.click("nav button[data-view=chance]");
  await expect(page.locator("#warnings")).toBeVisible();
}
const titles = (page) => page.locator("#warnings .warn-title").allTextContents();
const source = (page) => page.locator("#warnings > .note").textContent();

test("shows current warnings, most severe first, and leaves out old, lifted, test and doubled ones", async ({ page }) => {
  await openWarnings(page);
  expect(await titles(page)).toEqual([
    "Brand in Linden-Nord: Fenster und Türen geschlossen halten",
    "Amtliche UNWETTERWARNUNG vor HEFTIGEM STARKREGEN",
    "Amtliche WARNUNG vor STURMBÖEN",
    "Amtliche WARNUNG vor FROST",
  ]);
  expect(await page.locator("#warnings .warn-meta").allInnerTexts()).toEqual([
    "Bevölkerungsschutz\nseit heute 11:30 Uhr",
    "Wetter · Stufe 3 von 4\nheute 14:00 bis 20:00 Uhr",
    "Wetter · Stufe 2 von 4\nbis heute 19:00 Uhr",
    "Wetter · Stufe 1 von 4\nmorgen 02:00 bis 09:00 Uhr",
  ].map((t) => expect.stringMatching(t.replace(/\n/, "\\s+"))));
  // text from the services shows as text, never as page markup
  await expect(page.locator("#warnings")).toContainText('<Test> & "Quote"');
  expect(await page.locator("#warnings test").count()).toBe(0);
  expect(await source(page)).toBe("Wetterwarnungen für die Stadt Hannover: Deutscher Wetterdienst. Andere Warnungen für die Region Hannover: NINA, die Warn-App des Bundes. Stand: 12:00 Uhr.");
  expect(page.errors).toEqual([]);
});

test("loads once when the tab opens and again every 5 minutes, keeping an opened \"Was tun?\" open", async ({ page }) => {
  await openWarnings(page);
  expect(page.calls).toEqual({ dwd: 1, nina: 1 });
  await page.click("#warnings details summary");
  await page.click("nav button[data-view=overview]");
  await page.click("nav button[data-view=chance]");
  expect(page.calls).toEqual({ dwd: 1, nina: 1 });
  await page.clock.runFor(5 * 60 * 1000 + 1000);
  await expect.poll(() => page.calls.dwd).toBe(2);
  await expect(page.locator("#warnings > .note")).toContainText("Stand: 12:05 Uhr.");
  expect(await page.locator("#warnings details").evaluate((d) => d.open)).toBe(true);
});

test("says when there are no warnings", async ({ page }) => {
  await openWarnings(page, { dwd: { alerts: [] }, nina: [] });
  await expect(page.locator("#warnings .warn-none")).toHaveText(/Für Hannover gibt es gerade keine amtlichen Warnungen\./);
});

test("points to the NINA app when the browser can't load NINA", async ({ page }) => {
  await openWarnings(page, { dwd: { alerts: [] }, nina: null });
  await expect(page.locator("#warnings .warn-none")).toHaveText(/keine Wetterwarnungen\./);
  expect(await source(page)).toContain("Andere Warnungen, etwa zu Bränden mit starkem Rauch oder zu Evakuierungen, stehen in der Warn-App NINA.");
});

test("uses NINA's copy of the weather warnings when the DWD list can't be loaded", async ({ page }) => {
  await openWarnings(page, { dwd: { status: 503, body: "down" } });
  expect(await titles(page)).toEqual(["Brand in Linden-Nord: Fenster und Türen geschlossen halten", "NINA-KOPIE: Amtliche WARNUNG vor STURMBÖEN"]);
  await expect(page.locator("#warnings .warn-tag").nth(1)).toHaveText("Wetter · Stufe 2 von 4");
  expect(await source(page)).toMatch(/^Warnungen für die Region Hannover: NINA, die Warn-App des Bundes, mit den Wetterwarnungen des Deutschen Wetterdienstes\. Stand/);
});

test("says so when neither service can be loaded", async ({ page }) => {
  await openWarnings(page, { dwd: null, nina: null });
  expect(await source(page)).toBe("Die Warnungen konnten gerade nicht geladen werden. Sie stehen beim Deutschen Wetterdienst und in der Warn-App NINA.");
  expect(await page.locator("#warnings .warn").count()).toBe(0);
});

test.describe("on a phone", () => {
  test.use(device(devices["iPhone 13"]));
  test("fits the screen", async ({ page }) => {
    await openWarnings(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
});
