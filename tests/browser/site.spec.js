// A tour of every tab with every year and filter, on a computer and two phone sizes. It catches what
// breaks most often when the data or a chart changes: errors, "NaN"/"undefined" in the text, empty
// tabs, and anything that makes the page scroll sideways. It runs at the real current date, like a visitor.
import { test, expect, openSite } from "./fixtures.js";

const VIEWS = ["overview", "dots", "calendar", "spiral", "hours", "keywords", "districts", "addresses", "map",
  "radius", "weather", "myths", "quiz", "list", "year", "chance"];

const SCREENS = [
  ["computer, light", { viewport: { width: 1280, height: 900 }, colorScheme: "light" }],
  ["phone, dark", { viewport: { width: 390, height: 844 }, colorScheme: "dark", hasTouch: true }],
  ["small phone, light", { viewport: { width: 360, height: 740 }, colorScheme: "light", hasTouch: true }],
];

// What's wrong with the open tab, or null.
function checkActiveView() {
  const sec = document.querySelector("section.active");
  const text = sec ? sec.innerText : "";
  const over = document.documentElement.scrollWidth - innerWidth;
  // elements sticking out of the screen sideways, unless they sit in a box that scrolls or clips
  const wide = [...sec.querySelectorAll("*")].filter((e) => {
    const r = e.getBoundingClientRect();
    if (!r.width) return false;
    for (let p = e.parentElement; p; p = p.parentElement) if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowX)) return false;
    return r.right > innerWidth + 1 || r.left < -1;
  }).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}`);
  const bad = (text.match(/.{0,30}\b(NaN|undefined|Infinity|null|\[object)\b.{0,30}/) || [""])[0];
  const problems = [];
  if (over > 0) problems.push(`page scrolls sideways by ${over}px`);
  if (wide.length) problems.push(`sticks out: ${wide.join(", ")}`);
  if (bad) problems.push(`text "${bad}"`);
  if (text.length < 20) problems.push("almost empty");
  return problems.length ? problems.join("; ") : null;
}

for (const [screen, options] of SCREENS) {
  test.describe(screen, () => {
    test.use(options);

    test("every tab works for every year and filter", async ({ page }) => {
      await openSite(page);
      const years = await page.$$eval("#f-year option", (o) => o.map((x) => x.value).filter(Boolean));
      const combos = [
        { year: "", standby: false, storm: true },
        { year: "", standby: true, storm: false },
        ...years.map((year) => ({ year, standby: false, storm: true })),
      ];
      const problems = [];
      for (const combo of combos) {
        await page.click("nav button[data-view=overview]");
        await page.selectOption("#f-year", combo.year);
        await page.setChecked("#f-standby", combo.standby);
        await page.setChecked("#f-storm", combo.storm);
        for (const view of VIEWS) {
          await page.click(`nav button[data-view=${view}]`);
          await page.waitForTimeout(view === "map" || view === "radius" ? 600 : 150);
          const problem = await page.evaluate(checkActiveView);
          if (problem) problems.push(`${view} ${JSON.stringify(combo)}: ${problem}`);
        }
      }
      expect(problems).toEqual([]);
      expect(page.errors).toEqual([]);
    });

    test("the year story goes on, and closes with Escape or the back button", async ({ page }) => {
      await openSite(page);
      await page.click("nav button[data-view=year]");
      await page.click("#y-story");
      await expect(page.locator("#story")).toBeVisible();
      await expect(page.locator("#story-bar i:nth-child(1)")).toHaveClass("now");
      await page.keyboard.press("ArrowRight");
      await expect(page.locator("#story-bar i:nth-child(2)")).toHaveClass("now");
      await page.keyboard.press("Escape");
      await expect(page.locator("#story")).toBeHidden();
      // the back button closes the story but stays on the page
      await page.click("#y-story");
      await expect(page.locator("#story")).toBeVisible();
      await page.goBack();
      await expect(page.locator("#story")).toBeHidden();
      expect(page.url()).toMatch(/\/index\.html$/);
      expect(page.errors).toEqual([]);
    });
  });
}

test("says so when the alarms can't be loaded", async ({ page }) => {
  await page.route("**/data/alarms.json*", (r) => r.fulfill({ status: 404, body: "" }));
  await page.goto("/index.html");
  await expect(page.locator("#listed")).toContainText("konnten nicht geladen werden");
  expect(page.errors).toEqual([]);
});
