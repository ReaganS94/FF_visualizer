// The quiz draws 10 questions per round at random from a few dozen kinds; tests/unit/quiz.test.js checks the
// questions themselves. These play rounds through the page: one by tapping the buttons like a person, then
// 100 more inside the page, reading every card before and after the answer for "NaN" or page markup.
import { test, expect, openSite } from "./fixtures.js";

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
