// The myth tests and their pictures, shown on the Mythen-Check and in the quiz. The myths and their tests are
// in lib/myths.js. Each test draws 2000 times, so the results are kept until new data comes in.
import { addDays, isoDate, minDate } from "../lib/dates.js";
import { esc } from "../lib/text.js";
import { mythResults, mythVerdict, mythSentence } from "../lib/myths.js";
import { ALL, UPDATED, LISTED, FERIEN, HEIMSPIELE, WEATHER } from "../data.js";
import "./myths.css";

let mythCache = null;
export function myths() {
  const last = minDate(addDays(UPDATED, -1), addDays(LISTED, -1));
  const key = `${ALL.length}|${isoDate(last)}|${HEIMSPIELE.length}|${FERIEN.length}`;
  if (mythCache?.key !== key) mythCache = { key, ...mythResults(ALL, last, { ferien: FERIEN, heimspiele: HEIMSPIELE, weather: WEATHER }) };
  return mythCache;
}

// One myth's verdict, picture (dot, chance bar, legend) and sentence; the quiz shows the picture too.
export function mythParts(m) {
  const { t } = m;
  const dec = (x) => x.toFixed(2).replace(".", ",");
  const [cls, verdict] = mythVerdict(t, m.pick);
  const max = [0.5, 1, 2, 5, 10, 20, 50].find((v) => v >= 1.1 * Math.max(t.avg, t.hi)) || 100;
  const x = (v) => `${((100 * v) / max).toFixed(2)}%`;
  const picture = `<div class="myth-strip" role="img" aria-label="${esc(m.label)}: ${dec(t.avg)} pro Tag. ${esc(m.cmp)}: zufällig ${dec(t.lo)} bis ${dec(t.hi)}.">` +
    `<span class="myth-band" style="left:${x(t.lo)};width:calc(${x(t.hi - t.lo)} + 2px)"></span>` +
    `<span class="myth-base" style="left:${x(t.base)}"></span><span class="myth-dot" style="left:${x(t.avg)}"></span></div>` +
    `<div class="myth-axis">${[0, max / 2, max].map((v) => `<span style="left:${x(v)}">${String(v).replace(".", ",")}</span>`).join("")}</div>` +
    `<ul class="myth-legend"><li><i class="k-dot"></i>${esc(m.label)}: <b>${dec(t.avg)}</b> Einsätze pro Tag</li>` +
    `<li><i class="k-band"></i>${esc(m.cmp)}: <b>${dec(t.base)}</b>, durch Zufall zwischen ${dec(t.lo)} und ${dec(t.hi)}</li></ul>`;
  return { cls, verdict, picture, sentence: mythSentence(m) };
}
