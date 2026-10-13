// The page around the tabs (App.jsx): the "Stand" line, the tab bar, the filters above the tabs and the tab
// shown last time. The alarms are made up by the test, so every number is known.
import { test, expect, json, openSite } from "./fixtures.js";
import { ADMIN } from "../../web/src/lib/links.js";

const alarm = (date, keyword = "b1", o) => ({ date, time: "10:00", category: "Einsatz", keyword, event: "Testeinsatz",
  street: "Teststraße", district: "Linden-Mitte", remarks: "", ...o });
const ALARMS = {
  updated: "2026-10-12T12:00:00+00:00",
  rows: [
    alarm("2024-03-01"), alarm("2024-07-02", "th1"),
    alarm("2025-05-05"), alarm("2025-05-06", "vs"),
    alarm("2026-09-20", "th1"),
    ...Array.from({ length: 10 }, (_, i) => alarm("2024-08-10", "th1", { time: `1${i}:00` })), // a Großlage
    alarm("2026-10-30", "", { category: "Veranstaltung", event: "Tag der offenen Tür" }), // listed ahead, not an alarm
  ],
};
const HAND = alarm("2026-10-01", "b2", { event: "Von Hand" });

async function openApp(page, { alarms = ALARMS, hand = [HAND] } = {}) {
  await page.route("**/data/alarms.json*", (r) => r.fulfill(json(alarms)));
  await page.route("**/data/manual.json*", (r) => r.fulfill(json({ rows: hand })));
  await openSite(page);
}
const count = (page) => page.textContent("#list-count").then((t) => Number(t.match(/^\d+/)[0]));
const active = (page) => page.evaluate(() => [
  [...document.querySelectorAll("nav button.active")].map((b) => b.dataset.view).join(","),
  [...document.querySelectorAll("main > section.active")].map((s) => s.dataset.view).join(","),
]);

test("says when the data was updated and how far the website's list goes", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("#updated")).toHaveText("12.10.2026");
  await expect(page.locator("#listed")).toHaveText(" · Die Website listet Einsätze bis 20.09.2026, neuere sind vorläufig eingetragen.");
  // the years of the alarms, newest first
  expect(await page.$$eval("#f-year option", (o) => o.map((x) => x.textContent))).toEqual(["Alle", "2026", "2025", "2024"]);
  expect(page.errors).toEqual([]);
});

test("no note about the website's list when it is up to date, and none about hand entries without newer ones", async ({ page }) => {
  await openApp(page, { alarms: { ...ALARMS, updated: "2026-09-21T12:00:00+00:00" } });
  await expect(page.locator("#updated")).toHaveText("21.09.2026");
  await expect(page.locator("#listed")).toHaveText("");
  await openApp(page, { hand: [] });
  await expect(page.locator("#listed")).toHaveText(" · Die Website listet Einsätze bis 20.09.2026.");
});

test("waits for the alarms before the tabs can be opened, and says so when they can't be loaded", async ({ page }) => {
  let answer;
  const waiting = new Promise((resolve) => (answer = resolve));
  await page.route("**/data/alarms.json*", async (r) => { await waiting; r.fulfill(json(ALARMS)); });
  await page.goto("/index.html");
  await expect(page.locator("#updated")).toHaveText("…");
  await expect(page.locator("#listed")).toHaveText("");
  await page.click("nav button[data-view=list]");
  expect(await active(page)).toEqual(["overview", "overview"]);
  answer();
  await expect(page.locator("#updated")).toHaveText("12.10.2026");
  await page.click("nav button[data-view=list]");
  expect(await active(page)).toEqual(["list", "list"]);

  await page.unroute("**/data/alarms.json*");
  await page.route("**/data/alarms.json*", (r) => r.fulfill({ status: 500, body: "" }));
  await page.reload();
  await expect(page.locator("#updated")).toHaveText("–");
  await expect(page.locator("#listed")).toHaveText(" · Die Einsätze konnten nicht geladen werden. Bitte die Seite neu laden.");
  await page.click("nav button[data-view=list]");
  expect(await active(page)).toEqual(["overview", "overview"]);
  expect(page.errors).toEqual([]);
});

test("the filters choose the alarms of every tab, and hide on tabs with choices of their own", async ({ page }) => {
  await openApp(page);
  await page.click("nav button[data-view=list]");
  expect(await count(page)).toBe(15); // the Wachbesetzung and the event don't count
  await page.check("#f-standby");
  expect(await count(page)).toBe(16);
  await page.uncheck("#f-storm");
  expect(await count(page)).toBe(6);
  await page.selectOption("#f-year", "2025");
  expect(await count(page)).toBe(2);
  await page.uncheck("#f-standby");
  expect(await count(page)).toBe(1);
  // the other tabs use the same choice
  await page.click("nav button[data-view=keywords]");
  await page.selectOption("#f-year", "");
  await page.check("#f-storm");
  await page.click("nav button[data-view=list]");
  expect(await count(page)).toBe(15);

  for (const view of ["chance", "year", "myths", "quiz"]) {
    await page.click(`nav button[data-view=${view}]`);
    await expect(page.locator("#filters")).toBeHidden();
  }
  await page.click("nav button[data-view=dots]");
  await expect(page.locator("#filters")).toBeVisible();
  expect(page.errors).toEqual([]);
});

test("one tab shows at a time, and the page opens on the tab shown last time", async ({ page }) => {
  await openApp(page);
  expect(await active(page)).toEqual(["overview", "overview"]);
  const views = await page.$$eval("nav button", (bs) => bs.map((b) => b.dataset.view));
  expect(await page.$$eval("main > section", (ss) => ss.map((s) => s.dataset.view).sort())).toEqual([...views].sort());
  for (const view of views) {
    await page.click(`nav button[data-view=${view}]`);
    expect(await active(page)).toEqual([view, view]);
  }
  await page.click("nav button[data-view=hours]");
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#f-year option + option"));
  expect(await active(page)).toEqual(["hours", "hours"]);
  expect(page.errors).toEqual([]);
});

test("a new width draws the charts again, a new height doesn't", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await openApp(page);
  await page.click("nav button[data-view=dots]");
  const wall = () => page.$eval("#c-dots svg", (s) => `${s.dataset.mark || "new"} ${s.viewBox.baseVal.width}/${s.parentElement.clientWidth}`);
  const mark = () => page.$eval("#c-dots svg", (s) => (s.dataset.mark = "old"));
  expect(await wall()).toMatch(/^new (\d+)\/\1$/);
  await mark();
  await page.setViewportSize({ width: 1000, height: 500 });
  await page.waitForTimeout(300); // a new width redraws after 150 ms
  expect(await wall()).toMatch(/^old (\d+)\/\1$/);
  await page.setViewportSize({ width: 600, height: 500 });
  await expect.poll(wall).toMatch(/^new (\d+)\/\1$/);
  expect(Number((await wall()).split(" ")[1].split("/")[0])).toBeLessThan(600);
  // showing a tab draws it again too
  await mark();
  await page.click("nav button[data-view=dots]");
  expect(await wall()).toMatch(/^new /);
  expect(page.errors).toEqual([]);
});

test("the link to the admin page shows only on a device that came from there", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("#admin-link")).toBeHidden();
  // "Zur Statistik" on the admin page leads to #admin, which the page remembers and takes off the address
  await page.goto("about:blank");
  await page.goto("/index.html#admin");
  await expect(page.locator("#admin-link")).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  await expect(page.locator("#admin-link a")).toHaveAttribute("href", ADMIN);
  await page.reload();
  await expect(page.locator("#admin-link")).toBeVisible();
  expect(page.errors).toEqual([]);
});

test("a device with the old admin key keeps the link, and the key is removed", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => localStorage.setItem("gh-token", "x"));
  await page.reload();
  await expect(page.locator("#admin-link")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("gh-token"))).toBeNull();
  expect(page.errors).toEqual([]);
});

