// The quiz draws 10 questions per round at random from a few dozen kinds, built from the current data. This
// plays 300 rounds inside the page and checks every question: it shows and answers without "NaN" or page
// markup in the text, a number's answer fits its slider, a choice offers the right answer once, and no
// question gives away the answer to another one in the same round.
import { test, expect, openSite } from "./fixtures.js";

test("300 rounds of questions show and answer cleanly", async ({ page }) => {
  await openSite(page);
  await page.click("nav button[data-view=quiz]");
  const result = await page.evaluate(() => {
    // Questions that would give each other away; the quiz keeps them in separate rounds. If one of these
    // questions is reworded, change its pattern here too.
    const DAY = /stärkste Tag|am Neujahrstag/; // questions on single days
    const DAY_NOTE = /allein am|Darin steckt die Großlage|Neujahrstag waren/; // answers that name a single day
    const HEAT_MYTH = /^Stimmt das\?.*Hitze/, WEATHER = /Bei welchem Wetter/;
    const WEEKEND_MYTH = /^Stimmt das\?.*Wochenende/, WEEKDAYS = /An welchem Wochentag|aufs Wochenende/;
    const problems = [];
    let dayQuestions = 0;
    for (let round = 0; round < 300; round++) {
      const qs = quizQuestions();
      const texts = qs.map((q) => q.text);
      const any = (re) => texts.some((t) => re.test(t));
      if (qs.length !== 10) problems.push(`a round with ${qs.length} questions`);
      if (new Set(texts).size !== texts.length) problems.push(`the same question twice: ${texts.join(" / ")}`);
      const days = qs.filter((q) => DAY.test(q.text) || DAY_NOTE.test(q.explain));
      dayQuestions += qs.filter((q) => DAY.test(q.text)).length;
      if (days.length > 1) problems.push(`single days in two questions: ${days.map((q) => q.text).join(" / ")}`);
      if (any(HEAT_MYTH) && any(WEATHER)) problems.push("the heat myth together with the weather question");
      if (any(WEEKEND_MYTH) && any(WEEKDAYS)) problems.push("the weekend myth together with a weekday question");
      for (const q of qs) {
        if (q.kind === "number" && !(Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= q.max))
          problems.push(`answer ${q.answer} doesn't fit the slider (0 to ${q.max}): ${q.text}`);
        if (q.kind === "choice" && (!q.options.includes(q.right) || new Set(q.options).size !== q.options.length || q.options.length < 2))
          problems.push(`options [${q.options.join(" | ")}] for "${q.right}": ${q.text}`);
        // show it on its own, answer it, and read the card before and after
        Object.assign(quiz, { qs: [q], i: 0, got: [], guess: null, done: false });
        quizShow();
        const asked = document.querySelector("#quiz-card").innerText;
        quizAnswer(q.kind === "choice" ? 0 : Math.round(q.max / 3));
        const answered = document.querySelector("#quiz-card").innerText;
        for (const text of [asked, answered]) {
          const bad = text.match(/.{0,40}\b(NaN|undefined|Infinity|null|\[object)\b.{0,40}/);
          if (bad) problems.push(`"${bad[0].replace(/\s+/g, " ")}" in: ${q.text}`);
        }
        if (/&lt;|&gt;|&amp;|<\/?[a-z]/.test(asked)) problems.push(`page markup in the text: ${q.text}`);
      }
    }
    Object.assign(quiz, { qs: [], i: 0, got: [], guess: null, done: false });
    quizShow();
    return { problems: [...new Set(problems)].slice(0, 20), dayQuestions };
  });
  expect(result.problems).toEqual([]);
  // the busiest day and Neujahr questions come up often; none at all means DAY above no longer finds them
  expect(result.dayQuestions).toBeGreaterThan(0);
  expect(page.errors).toEqual([]);
});
