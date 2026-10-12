// The quiz draws 10 questions per round at random from a few dozen kinds; tests/unit/quiz.test.js checks the
// questions themselves. These play rounds through the page: one by tapping the buttons like a person, then
// 100 more inside the page, reading every card before and after the answer for "NaN" or page markup. Then the
// keys, the slider, the result, the game kept while other tabs change, full screen, and a round on a phone.
import { devices } from "@playwright/test";
import { test, expect, openSite, device } from "./fixtures.js";

// The same questions on every run for the site's data: Math.random from a fixed seed.
const seeded = (page) => page.addInitScript(() => {
  let a = 7;
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
});
// the progress bar, one entry per question
const bar = (page) => page.$$eval("#quiz-bar i", (is) => is.map((i) => i.className));
// the points an answer brought, from the line under it
const points = async (card) => {
  const text = await card.locator(".quiz-result").textContent();
  return text.includes("+2 Punkte") ? 2 : text.includes("+1 Punkt") ? 1 : 0;
};
// A number as the page writes it (1.234 Einsätze, 50 %), as a pattern for the start of a text, after `before`
const startsWith = (n, before = "") => new RegExp(`^${before}${n.toLocaleString("de-DE").replaceAll(".", "\\.")} `);

test("a round by tapping: answer, go on, see the points, play again", async ({ page }) => {
  await openSite(page);
  await page.click("nav button[data-view=quiz]");
  const card = page.locator("#quiz-card");
  await card.locator("[data-quiz=start]").click();
  for (let k = 1; k <= 10; k++) {
    await expect(card.locator(".quiz-kicker")).toHaveText(`Frage ${k} von 10`);
    const pick = card.locator("[data-quiz=pick]");
    if (await pick.count()) await pick.first().click();
    else {
      const guess = await card.locator("#quiz-val").innerText();
      await card.locator("[data-quiz=step]").last().click(); // one step up from the middle
      await expect(card.locator("#quiz-val")).not.toHaveText(guess);
      await card.locator("[data-quiz=answer]").click();
    }
    await expect(card.locator(".quiz-result")).toBeVisible();
    await card.locator("[data-quiz=next]").click();
  }
  await expect(card.locator(".quiz-hero")).toContainText("von 20 Punkten");
  await expect(card.locator(".quiz-summary li")).toHaveCount(10);
  await card.locator("[data-quiz=start]").click(); // "Nochmal spielen"
  await expect(card.locator(".quiz-kicker")).toHaveText("Frage 1 von 10");
  expect(page.errors).toEqual([]);
});

test("100 more rounds show and answer without NaN or page markup", async ({ page }) => {
  await openSite(page);
  await page.click("nav button[data-view=quiz]");
  const problems = await page.evaluate(() => {
    const card = document.querySelector("#quiz-card");
    const tap = (selector) => card.querySelector(selector).click();
    const problems = [];
    const check = (text, where) => {
      const bad = text.match(/.{0,40}\b(NaN|undefined|Infinity|null|\[object)\b.{0,40}/);
      if (bad) problems.push(`"${bad[0].replace(/\s+/g, " ")}" in: ${where}`);
      if (/&lt;|&gt;|&amp;|<\/?[a-z]/.test(text)) problems.push(`page markup in the text: ${where}`);
    };
    for (let round = 0; round < 100; round++) {
      tap("[data-quiz=start]");
      for (let k = 0; k < 10; k++) {
        const question = card.querySelector(".quiz-q").innerText;
        check(card.innerText, question);
        tap(card.querySelector("[data-quiz=pick]") ? "[data-quiz=pick]" : "[data-quiz=answer]");
        check(card.innerText, question);
        tap("[data-quiz=next]");
      }
      if (!card.querySelector(".quiz-hero")) problems.push(`no result after round ${round + 1}`);
      check(card.innerText, "the result");
    }
    return [...new Set(problems)].slice(0, 20);
  });
  expect(problems).toEqual([]);
  expect(page.errors).toEqual([]);
});

test("keys play a round: Enter starts and goes on, 1–4 answer, only for options there are, not with Ctrl and not on another tab", async ({ page }) => {
  await seeded(page);
  await openSite(page);
  await page.click("nav button[data-view=list]");
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Enter");
  await page.click("nav button[data-view=quiz]");
  const card = page.locator("#quiz-card");
  await expect(card.locator(".quiz-title")).toHaveText("Schätz mal!");
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("1");
  await expect(card.locator(".quiz-title")).toHaveText("Schätz mal!");
  await page.keyboard.press("Enter");
  const asked = [], got = [];
  for (let k = 0; k < 10; k++) {
    await expect(card.locator(".quiz-kicker")).toHaveText(`Frage ${k + 1} von 10`);
    expect(await bar(page)).toEqual(Array.from({ length: 10 }, (_, j) => (j < k ? "done" : j === k ? "now" : "")));
    asked.push(await card.locator(".quiz-q").textContent());
    const n = await card.locator("[data-quiz=pick]").count();
    if (n) {
      await expect(card.locator("[data-quiz=pick]").first()).toBeFocused();
      await page.keyboard.press(String(n + 1)); // no such option
      await page.keyboard.press("Control+1");
      await page.click("nav button[data-view=list]");
      await page.keyboard.press("1");
      await page.click("nav button[data-view=quiz]");
      await expect(card.locator("[data-quiz=pick]")).toHaveCount(n); // not answered yet
      await page.keyboard.press(String(1 + (k % n)));
      const picked = await card.locator(".quiz-options.shown button").nth(k % n).getAttribute("class");
      expect(["right", "wrong"]).toContain(picked);
      await expect(card.locator(".quiz-result b")).toHaveText(picked === "right" ? "Richtig!" : "Leider falsch.");
    } else {
      const range = card.locator("#quiz-range");
      await expect(range).toBeFocused();
      await page.keyboard.press("ArrowRight"); // one step up
      await expect(card.locator("#quiz-val")).toHaveText(startsWith(Number(await range.inputValue())));
      await page.keyboard.press("Enter");
      await expect(card.locator(".quiz-result b")).toHaveText(/^(Volltreffer!|Nah dran!|Daneben\.)$/);
    }
    got.push(await points(card));
    await expect(card.locator("[data-quiz=next]")).toBeFocused();
    await expect(card.locator("[data-quiz=next]")).toHaveText(k < 9 ? "Weiter" : "Zum Ergebnis");
    await page.keyboard.press("Enter"); // on the button itself: once, not twice
  }
  // the result: every answer's points and the total
  const total = got.reduce((a, b) => a + b, 0);
  await expect(card.locator(".quiz-hero")).toHaveText(`${total} von 20 Punkten`);
  await expect(card.locator(".quiz-verdict")).toHaveText(total >= 17 ? "Stark! Du kennst die FF Linden richtig gut." : total >= 12 ? "Gut geschätzt!"
    : total >= 7 ? "Nicht schlecht, da geht noch was." : "Schwierig, oder? Auf dieser Seite stehen alle Zahlen zum Nachschauen.");
  await expect(card.locator(".quiz-summary li")).toHaveText(asked.map((q, k) => `${got[k] ? `+${got[k]}` : "0"}${q}`));
  expect(await card.locator(".quiz-summary li").evaluateAll((lis) => lis.map((li) => li.className))).toEqual(got.map((p) => `p${p}`));
  expect(await bar(page)).toEqual([]);
  // "Nochmal spielen" has the focus; the next round asks other questions, not the same ones with other numbers
  await expect(card.locator("[data-quiz=start]")).toBeFocused();
  await page.keyboard.press("Enter");
  const kind = (text) => text.replace(/\d+/g, "#");
  for (let k = 0; k < 10; k++) {
    await expect(card.locator(".quiz-kicker")).toHaveText(`Frage ${k + 1} von 10`);
    expect(asked.map(kind)).not.toContain(kind(await card.locator(".quiz-q").textContent()));
    const n = await card.locator("[data-quiz=pick]").count();
    if (n) {
      await page.keyboard.press(String(n + 1)); // no such option: this round has questions with two
      await expect(card.locator("[data-quiz=pick]")).toHaveCount(n);
      await card.locator("[data-quiz=pick]").first().click();
    } else await card.locator("[data-quiz=answer]").click();
    await card.locator("[data-quiz=next]").click();
  }
  expect(page.errors).toEqual([]);
});

test("the slider starts in the middle and stops at its ends; a far guess scores nothing, the same round without a mistake 20 points", async ({ page }) => {
  await seeded(page);
  await openSite(page);
  await page.click("nav button[data-view=quiz]");
  const card = page.locator("#quiz-card"), range = card.locator("#quiz-range"), guess = card.locator("#quiz-val");
  const optionText = (b) => b.textContent.slice(b.querySelector(".key").textContent.length);
  // A round with every number guessed at an end of its slider, the first at 0, the next at the top and so on, and
  // the first option picked; the right answers noted.
  const asked = [], right = [];
  await card.locator("[data-quiz=start]").click();
  for (let k = 0; k < 10; k++) {
    asked.push(await card.locator(".quiz-q").textContent());
    if (!(await range.count())) {
      await card.locator("[data-quiz=pick]").first().click();
      right.push(await card.locator(".quiz-options.shown button.right").evaluate(optionText));
      await card.locator("[data-quiz=next]").click();
      continue;
    }
    const numbers = right.filter((r) => typeof r === "number").length;
    await expect(range).toBeFocused();
    const max = Number(await range.getAttribute("max")), step = Number(await range.getAttribute("step"));
    expect(step).toBe(max > 500 ? 5 : 1);
    const middle = Math.round(max / 2);
    await expect(guess).toHaveText(startsWith(middle));
    await expect(range).toHaveValue(String(Math.round(middle / step) * step));
    await expect(card.locator(".quiz-scale span")).toHaveText(["0", max.toLocaleString("de-DE")]);
    // the top end, and + there
    await page.keyboard.press("End");
    await card.locator("[data-quiz=step]").last().click();
    await expect(range).toHaveValue(String(max));
    await expect(guess).toHaveText(startsWith(max));
    // Enter on − presses it once, and not "Antworten"
    await card.locator("[data-quiz=step]").first().focus();
    await page.keyboard.press("Enter");
    await expect(range).toHaveValue(String(max - step));
    await expect(guess).toHaveText(startsWith(max - step));
    // the bottom end, and − there
    await range.focus();
    await page.keyboard.press("Home");
    await card.locator("[data-quiz=step]").first().click();
    await expect(range).toHaveValue("0");
    await expect(guess).toHaveText(startsWith(0));
    const at = numbers % 2 ? max : 0;
    if (at) {
      await range.focus();
      await page.keyboard.press("End");
    }
    await card.locator("[data-quiz=answer]").click();
    const you = card.locator(".quiz-line .mark.you"), real = card.locator(".quiz-line .mark.real");
    await expect(you).toHaveClass(`mark you ${at ? "r" : "l"}`);
    expect(await you.evaluate((m) => m.style.left)).toBe(at ? "100%" : "0%");
    await expect(you).toHaveText(startsWith(at, "Du: "));
    await expect(real).toHaveText(/^Richtig: \d/);
    const answer = Number((await real.textContent()).match(/^Richtig: ([\d.]+)/)[1].replaceAll(".", ""));
    expect(parseFloat(await real.evaluate((m) => m.style.left))).toBeCloseTo(Math.min(100, (100 * answer) / max), 2);
    expect(await card.locator(".quiz-line").getAttribute("aria-label")).toMatch(/^Deine Schätzung .+, richtig .+$/);
    await expect(card.locator(".quiz-answer b")).toHaveText((await real.textContent()).replace("Richtig: ", ""));
    // further off than any question allows for a point (10 percentage points, 5 minutes, a quarter of the answer)
    if (Math.abs(at - answer) > Math.max(10, answer / 4)) await expect(card.locator(".quiz-result")).toHaveText("Daneben.");
    right.push(answer);
    await card.locator("[data-quiz=next]").click();
  }
  expect(right.filter((r) => typeof r === "number").length).toBeGreaterThan(1); // a second slider, after the first ended at 0
  // The same round again (the random numbers start over with the page), every answer right.
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#f-year option + option"));
  await page.click("nav button[data-view=quiz]");
  await card.locator("[data-quiz=start]").click();
  for (let k = 0; k < 10; k++) {
    await expect(card.locator(".quiz-q")).toHaveText(asked[k]);
    if (typeof right[k] === "number") {
      const step = Number(await range.getAttribute("step")); // a big number is guessed in steps of 5: close enough
      await range.fill(String(Math.round(right[k] / step) * step));
      await expect(guess).toHaveText(startsWith(Number(await range.inputValue())));
      await card.locator("[data-quiz=answer]").click();
      await expect(card.locator(".quiz-result")).toHaveText("Volltreffer! +2 Punkte");
    } else {
      const options = await card.locator("[data-quiz=pick]").evaluateAll((bs) => bs.map((b) => b.textContent.slice(b.querySelector(".key").textContent.length)));
      await card.locator("[data-quiz=pick]").nth(options.indexOf(right[k])).click();
      await expect(card.locator(".quiz-result")).toHaveText("Richtig! +2 Punkte");
    }
    await card.locator("[data-quiz=next]").click();
  }
  await expect(card.locator(".quiz-hero")).toHaveText("20 von 20 Punkten");
  await expect(card.locator(".quiz-verdict")).toHaveText("Stark! Du kennst die FF Linden richtig gut.");
  expect(page.errors).toEqual([]);
});

test("a question keeps its guess while other tabs, the filters and the window change; an answer's chart is drawn once; full screen", async ({ page }) => {
  await seeded(page);
  await openSite(page);
  await page.click("nav button[data-view=quiz]");
  const card = page.locator("#quiz-card");
  await card.locator("[data-quiz=start]").click();
  for (let k = 0; k < 9 && !(await card.locator("#quiz-range").count()); k++) {
    await card.locator("[data-quiz=pick]").first().click();
    await card.locator("[data-quiz=next]").click();
  }
  await card.locator("[data-quiz=step]").last().click();
  await card.locator("[data-quiz=step]").last().click();
  const kicker = await card.locator(".quiz-kicker").textContent(), guess = await card.locator("#quiz-val").textContent();
  const value = await card.locator("#quiz-range").inputValue(), progress = await bar(page);
  await page.click("nav button[data-view=list]");
  await page.selectOption("#f-year", "2025");
  await page.setChecked("#f-standby", true);
  await page.setViewportSize({ width: 700, height: 800 });
  await page.click("nav button[data-view=quiz]");
  await expect(card.locator(".quiz-kicker")).toHaveText(kicker);
  await expect(card.locator("#quiz-val")).toHaveText(guess);
  await expect(card.locator("#quiz-range")).toHaveValue(value);
  expect(await bar(page)).toEqual(progress);
  // the first chart with an answer: drawn at the card's width (at most 520), and not again for a new width
  await card.locator("[data-quiz=answer]").click();
  for (let k = 0; k < 9 && !(await card.locator(".quiz-chart svg").count()); k++) {
    await card.locator("[data-quiz=next]").click();
    if (await card.locator("[data-quiz=pick]").count()) await card.locator("[data-quiz=pick]").first().click();
    else await card.locator("[data-quiz=answer]").click();
  }
  const width = await card.evaluate((c) => c.clientWidth);
  const svg = card.locator(".quiz-chart svg");
  await expect(svg).toHaveAttribute("viewBox", new RegExp(`^0 0 ${Math.min(520, width)} `));
  const drawn = await card.locator(".quiz-chart").innerHTML();
  await page.setViewportSize({ width: 420, height: 800 });
  await page.waitForTimeout(400); // the tabs are drawn again 150 ms after the window settles
  expect(await card.locator(".quiz-chart").innerHTML()).toBe(drawn);
  // full screen and back
  const full = page.locator("#quiz-full");
  await expect(full).toHaveText("Vollbild");
  await full.click();
  await expect(full).toHaveText("Vollbild beenden");
  expect(await page.evaluate(() => document.fullscreenElement?.id)).toBe("quiz");
  await full.click();
  await expect(full).toHaveText("Vollbild");
  expect(await page.evaluate(() => document.fullscreenElement)).toBe(null);
  expect(page.errors).toEqual([]);
});

test.describe("on a phone", () => {
  test.use(device(devices["iPhone 13"]));

  test("a round by taps keeps the page where it is on every answer, with charts as wide as the card", async ({ page }) => {
    await seeded(page);
    await openSite(page);
    await page.click("nav button[data-view=quiz]");
    const card = page.locator("#quiz-card");
    await card.locator("[data-quiz=start]").tap();
    let charts = 0;
    for (let k = 0; k < 10; k++) {
      const pick = card.locator("[data-quiz=pick]");
      const button = (await pick.count()) ? pick.nth(k % 2) : card.locator("[data-quiz=answer]");
      await button.scrollIntoViewIfNeeded();
      const y = await page.evaluate(() => scrollY);
      await button.tap();
      await expect(card.locator(".quiz-result")).toBeVisible();
      expect(await page.evaluate(() => scrollY)).toBe(y);
      if (await card.locator(".quiz-chart svg").count()) {
        charts++;
        await expect(card.locator(".quiz-chart svg")).toHaveAttribute("viewBox", new RegExp(`^0 0 ${await card.evaluate((c) => c.clientWidth)} `));
      }
      await card.locator("[data-quiz=next]").tap();
    }
    expect(charts).toBeGreaterThan(0);
    await expect(card.locator(".quiz-hero")).toContainText("von 20 Punkten");
    expect(page.errors).toEqual([]);
  });
});
