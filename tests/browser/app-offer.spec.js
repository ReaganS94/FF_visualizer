// The "Als App speichern" button on Übersicht. Android gets the browser's own install window, iPhones and
// iPads a step-by-step guide, computers nothing, and it never shows once the site runs as an app.
import { test, expect, openSite, device } from "./fixtures.js";
import { devices } from "@playwright/test";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

// What Chrome does when the site can be installed. The fake prompt() counts how often the install window
// would open; the return value says whether the page kept Chrome's own install bar away.
const offerInstall = (page) => page.evaluate(() => {
  window.prompted ||= 0;
  const e = new Event("beforeinstallprompt", { cancelable: true });
  e.prompt = () => { window.prompted++; return Promise.resolve(); };
  e.userChoice = Promise.resolve({ outcome: "dismissed", platform: "" });
  window.dispatchEvent(e);
  return e.defaultPrevented;
});
const offer = (page) => page.locator("#app-offer");
const guide = (page) => page.locator("#app-offer-guide");

test.describe("iPhone", () => {
  test.use(device(devices["iPhone 13"]));

  test("shows the guide on Übersicht until Erledigt is tapped", async ({ page }) => {
    await openSite(page);
    await expect(offer(page)).toBeVisible();
    await expect(page.locator("#app-offer-sub")).toHaveText("Mit eigenem Symbol auf dem Home-Bildschirm.");
    await page.click("nav button[data-view=calendar]");
    await expect(offer(page)).toBeHidden();
    await page.click("nav button[data-view=overview]");
    await page.click("#app-offer-btn");
    await expect(guide(page)).toBeVisible();
    await expect(page.locator("#app-offer-btn")).toHaveAttribute("aria-expanded", "true");
    await page.click("#app-offer-btn");
    await expect(guide(page)).toBeHidden();
    await expect(page.locator("#app-offer-btn")).toHaveAttribute("aria-expanded", "false");
    await page.click("#app-offer-btn");
    await page.click("#app-offer-done");
    await expect(offer(page)).toBeHidden();
    await openSite(page);
    await expect(offer(page)).toBeHidden();
    expect(page.errors).toEqual([]);
  });

  test("names the buttons as a German iPhone shows them", async ({ page }) => {
    await openSite(page);
    await page.click("#app-offer-btn");
    const text = await guide(page).innerText();
    for (const name of ["In Safari öffnen", "Teilen", "Zum Home-Bildschirm", "Hinzufügen"]) expect(text).toContain(name);
    for (const name of ["Open in Safari", "Share", "Add to Home Screen"]) expect(text).not.toContain(name);
  });

  test.describe("set to English", () => {
    test.use({ locale: "en-US" });
    test("names the buttons as an English iPhone shows them", async ({ page }) => {
      await openSite(page);
      await page.click("#app-offer-btn");
      const text = await guide(page).innerText();
      for (const name of ["Open in Safari", "Share", "Add to Home Screen", "Add."]) expect(text).toContain(name);
      for (const name of ["In Safari öffnen", "Teilen", "Zum Home-Bildschirm", "Hinzufügen"]) expect(text).not.toContain(name);
    });
  });

  test("stays hidden when opened from the home screen", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
    await openSite(page);
    await expect(offer(page)).toBeHidden();
  });
});

test.describe("small iPhone", () => {
  test.use(device(devices["iPhone SE"]));
  test("the open guide fits the screen", async ({ page }) => {
    await openSite(page);
    await page.click("#app-offer-btn");
    await expect(guide(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
});

test.describe("iPad", () => {
  // iPads say "Macintosh" like a Mac; the touch screen tells them apart.
  test.use({ viewport: { width: 820, height: 1180 }, userAgent: MAC, hasTouch: true });
  test("shows the guide", async ({ page }) => {
    // a real iPad reports 5 touch points, Playwright's touch emulation only 1
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "maxTouchPoints", { get: () => 5 }));
    await openSite(page);
    await expect(offer(page)).toBeVisible();
  });
});

test.describe("Mac", () => {
  test.use({ viewport: { width: 1280, height: 900 }, userAgent: MAC });
  test("shows nothing", async ({ page }) => {
    await openSite(page);
    await expect(offer(page)).toBeHidden();
  });
});

test.describe("Android", () => {
  test.use(device(devices["Pixel 7"]));

  test("opens the browser's install window once the browser offers it", async ({ page }) => {
    await openSite(page);
    await expect(offer(page)).toBeHidden();
    expect(await offerInstall(page)).toBe(true);
    await expect(offer(page)).toBeVisible();
    await expect(page.locator("#app-offer-sub")).toHaveText("Mit eigenem Symbol auf dem Startbildschirm.");
    await page.click("#app-offer-btn");
    await expect(offer(page)).toBeHidden();
    expect(await page.evaluate(() => window.prompted)).toBe(1);
    await expect(guide(page)).toBeHidden();
    // closed without installing: the browser offers it again, until the app is installed
    await offerInstall(page);
    await expect(offer(page)).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await expect(offer(page)).toBeHidden();
    expect(page.errors).toEqual([]);
  });

  test("× hides it on this phone for good", async ({ page }) => {
    await openSite(page);
    await offerInstall(page);
    await page.click("#app-offer-close");
    await expect(offer(page)).toBeHidden();
    await openSite(page);
    await offerInstall(page);
    await expect(offer(page)).toBeHidden();
  });

  test("stays hidden when running as the installed app", async ({ page }) => {
    await page.addInitScript(() => {
      const matchMedia = window.matchMedia.bind(window);
      window.matchMedia = (q) => (/display-mode/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : matchMedia(q));
    });
    await openSite(page);
    await offerInstall(page);
    await expect(offer(page)).toBeHidden();
  });
});

test.describe("computer", () => {
  test("shows nothing and leaves the browser's own install symbol alone", async ({ page }) => {
    await openSite(page);
    expect(await offerInstall(page)).toBe(false);
    await expect(offer(page)).toBeHidden();
  });

  test("the browser can install the site", async ({ page }) => {
    await openSite(page);
    const cdp = await page.context().newCDPSession(page);
    expect((await cdp.send("Page.getInstallabilityErrors")).installabilityErrors).toEqual([]);
  });
});
