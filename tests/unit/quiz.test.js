// The quiz draws 10 questions per round at random from a few dozen kinds, built from the current data. This
// plays 500 rounds on the site's own data files and checks every question: a number's answer fits its
// slider, a choice offers the right answer once, the texts and charts hold no "NaN", and no question gives
// away the answer to another one in the same round. The random numbers are seeded, so a failure repeats.
import { test, expect } from "vitest";
import fs from "node:fs";
import { parseDate, addDays, minDate } from "../../docs/lib/dates.js";
import { mergeManual, clean } from "../../docs/lib/alarms.js";
import { mythResults, rng } from "../../docs/lib/myths.js";
import { QUIZ_LEN, quizRound, unitText } from "../../docs/lib/quiz.js";

// The data as the page loads and cleans it.
const read = (f) => JSON.parse(fs.readFileSync(new URL(`../../docs/data/${f}`, import.meta.url), "utf8"));
const data = read("alarms.json"), keywords = read("keywords.json"), weather = read("weather.json").days;
const alarms = clean(mergeManual(data.rows, read("manual.json").rows), keywords);
const newest = data.rows.reduce((m, r) => (r.category === "Einsatz" && r.date > m ? r.date : m), "");
const listedDate = parseDate(newest);
const myths = mythResults(alarms, minDate(addDays(new Date(data.updated), -1), addDays(listedDate, -1)),
  { ferien: read("ferien.json").ranges, heimspiele: Object.values(read("heimspiele.json").seasons).flat(), weather });
const input = { alarms, listedDate, keywords, geo: read("geo.json"), weather, myths: () => myths };

// Questions that would give each other away; the quiz keeps them in separate rounds. If one of these
// questions is reworded, change its pattern here too.
const DAY = /stärkste Tag|am Neujahrstag/; // questions on single days
const DAY_NOTE = /allein am|Darin steckt die Großlage|Neujahrstag waren/; // answers that name a single day
const HEAT_MYTH = /^Stimmt das\?.*Hitze/, WEATHER = /Bei welchem Wetter/;
const WEEKEND_MYTH = /^Stimmt das\?.*Wochenende/, WEEKDAYS = /An welchem Wochentag|aufs Wochenende/;
const BAD = /\b(NaN|undefined|Infinity|null|\[object)\b/;

test("500 rounds of questions fit together and answer cleanly", () => {
  const random = rng(1), problems = [];
  let recent = new Set(), dayQuestions = 0;
  for (let round = 0; round < 500; round++) {
    const { qs, used } = quizRound(input, recent, random);
    recent = used;
    const texts = qs.map((q) => q.text);
    const any = (re) => texts.some((t) => re.test(t));
    if (qs.length !== QUIZ_LEN) problems.push(`a round with ${qs.length} questions`);
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
      const words = [q.text, q.explain, ...(q.options || []), q.kind === "number" ? unitText(q, q.answer) : ""].join(" ");
      if (BAD.test(words)) problems.push(`"${words.match(BAD)[0]}" in: ${q.text}`);
      if (q.chart && q.chart.type !== "myth" && !q.chart.items.every((i) => Number.isFinite(i.value)))
        problems.push(`a chart without a number: ${q.text}`);
    }
  }
  expect([...new Set(problems)].slice(0, 20)).toEqual([]);
  // the busiest day and Neujahr questions come up often; none at all means DAY above no longer finds them
  expect(dayQuestions).toBeGreaterThan(0);
}, 60_000);

test("the same seed gives the same round, and the last round's kinds go last", () => {
  const a = quizRound(input, new Set(), rng(5)), b = quizRound(input, new Set(), rng(5));
  expect(b.qs.map((q) => q.text)).toEqual(a.qs.map((q) => q.text));
  const next = quizRound(input, a.used, rng(5));
  expect([...next.used].filter((k) => a.used.has(k))).toEqual([]);
});
