// Quiz "Schätz mal": the questions are built in lib/quiz.js; this shows them, one card at a time. Nothing is
// saved: no names, no high score.

import { esc } from "../../lib/text.js";
import { QUIZ_LEN, quizRound, unitText } from "../../lib/quiz.js";
import { $ } from "../../dom.js";
import { ALL, KW, GEO, WEATHER, LISTED } from "../../data.js";
import { columnChart, barList } from "../../components/charts.js";
import { myths, mythParts } from "../../components/myths.js";
import "./quiz.css";

export const quiz = { qs: [], i: 0, got: [], guess: null, done: false, recent: new Set() };

// Charts are drawn at phone width at most and then scale with the card, so a big screen gets big labels.
function quizChart(chart) {
  if (chart.type === "myth") return `<div class="quiz-myth">${mythParts(chart.myth).picture}</div>`;
  const tmp = document.createElement("div");
  tmp.className = "chart";
  tmp.style.cssText = `position:absolute;left:-9999px;visibility:hidden;width:${Math.min(520, $("#quiz-card").clientWidth || 520)}px`;
  document.body.append(tmp);
  (chart.type === "bars" ? barList : columnChart)(tmp, chart.items, chart.opts);
  const html = tmp.innerHTML;
  tmp.remove();
  return `<div class="chart quiz-chart">${html}</div>`;
}

// A new round; this round's kinds go last in the next one.
function quizQuestions() {
  const { qs, used } = quizRound({ alarms: ALL, listedDate: LISTED, keywords: KW, geo: GEO, weather: WEATHER, myths }, quiz.recent);
  quiz.recent = used;
  return qs;
}

export function quizShow() {
  const card = $("#quiz-card"), n = quiz.qs.length;
  const total = quiz.got.reduce((a, b) => a + b, 0);
  $("#quiz-bar").innerHTML = quiz.qs.length && quiz.i < n
    ? quiz.qs.map((_, k) => `<i class="${k < quiz.i ? "done" : k === quiz.i ? "now" : ""}"></i>`).join("") : "";
  if (!n) {
    card.innerHTML = `<div class="quiz-kicker">Quiz</div><h2 class="quiz-title">Schätz mal!</h2>` +
      `<p>${QUIZ_LEN} Fragen zu den Einsätzen der FF Linden. Bei Zahlen gibt es 2 Punkte für einen Treffer und 1 Punkt, wenn du nah dran bist. ` +
      `Jede andere richtige Antwort bringt 2 Punkte. Nichts wird gespeichert.</p>` +
      `<div class="quiz-actions"><button type="button" class="primary" data-quiz="start">Los geht's</button></div>`;
    return;
  }
  if (quiz.i >= n) {
    const max = 2 * n, share = total / max;
    card.innerHTML = `<div class="quiz-kicker">Geschafft</div><div class="quiz-hero">${total} <span>von ${max} Punkten</span></div>` +
      `<p class="quiz-verdict">${share >= 0.85 ? "Stark! Du kennst die FF Linden richtig gut." : share >= 0.6 ? "Gut geschätzt!"
        : share >= 0.35 ? "Nicht schlecht, da geht noch was." : "Schwierig, oder? Auf dieser Seite stehen alle Zahlen zum Nachschauen."}</p>` +
      `<ol class="quiz-summary">${quiz.qs.map((q, k) => `<li class="p${quiz.got[k]}"><b>${quiz.got[k] ? `+${quiz.got[k]}` : "0"}</b>${q.text}</li>`).join("")}</ol>` +
      `<div class="quiz-actions"><button type="button" class="primary" data-quiz="start">Nochmal spielen</button></div>`;
    return;
  }
  const q = quiz.qs[quiz.i];
  const head = `<div class="quiz-kicker">Frage ${quiz.i + 1} von ${n}</div><h2 class="quiz-q">${q.text}</h2>`;
  if (!quiz.done) {
    if (q.kind === "choice") {
      card.innerHTML = head + `<div class="quiz-options${q.options.length > 2 ? "" : " two"}">` +
        q.options.map((o, k) => `<button type="button" data-quiz="pick" data-k="${k}"><span class="key">${k + 1}</span>${esc(o)}</button>`).join("") + "</div>";
    } else {
      quiz.guess ??= Math.round(q.max / 2);
      const step = q.max > 500 ? 5 : 1;
      card.innerHTML = head + `<div class="quiz-guess"><output id="quiz-val">${unitText(q, quiz.guess)}</output></div>` +
        `<div class="quiz-slider"><button type="button" data-quiz="step" data-d="-${step}" aria-label="weniger">−</button>` +
        `<input type="range" id="quiz-range" min="0" max="${q.max}" step="${step}" value="${quiz.guess}" aria-label="Deine Schätzung">` +
        `<button type="button" data-quiz="step" data-d="${step}" aria-label="mehr">+</button></div>` +
        `<div class="quiz-scale"><span>0</span><span>${q.max.toLocaleString("de-DE")}</span></div>` +
        `<div class="quiz-actions"><button type="button" class="primary" data-quiz="answer">Antworten</button></div>`;
    }
    return;
  }
  // the answer
  const got = quiz.got[quiz.i];
  let body;
  if (q.kind === "choice") {
    body = `<div class="quiz-options${q.options.length > 2 ? "" : " two"} shown">` + q.options.map((o, k) =>
      `<button type="button" disabled class="${o === q.right ? "right" : k === quiz.guess ? "wrong" : ""}"><span class="key">${k + 1}</span>${esc(o)}</button>`).join("") + "</div>";
  } else {
    // labels near an end are aligned to that end, so they stay inside the card
    const mark = (cls, v, text) => {
      const p = Math.min(100, (100 * v) / q.max);
      return `<span class="mark ${cls}${p < 15 ? " l" : p > 85 ? " r" : ""}" style="left:${p.toFixed(2)}%"><b>${text}</b></span>`;
    };
    body = `<div class="quiz-line" role="img" aria-label="Deine Schätzung ${unitText(q, quiz.guess)}, richtig ${unitText(q, q.answer)}">` +
      mark("you", quiz.guess, `Du: ${unitText(q, quiz.guess)}`) + mark("real", q.answer, `Richtig: ${unitText(q, q.answer)}`) + `</div>`;
  }
  const verdict = q.kind === "choice" ? (got ? "Richtig!" : "Leider falsch.") : got === 2 ? "Volltreffer!" : got ? "Nah dran!" : "Daneben.";
  card.innerHTML = head + body +
    `<p class="quiz-result p${got}"><b>${verdict}</b> ${got ? `+${got} ${got === 1 ? "Punkt" : "Punkte"}` : ""}</p>` +
    (q.kind === "number" ? `<p class="quiz-answer">Die richtige Antwort: <b>${unitText(q, q.answer)}</b>.${q.explain ? ` ${q.explain}` : ""}</p>`
      : q.explain ? `<p class="quiz-answer">${q.explain}</p>` : "") +
    (q.chart ? quizChart(q.chart) : "") +
    `<div class="quiz-actions"><button type="button" class="primary" data-quiz="next">${quiz.i + 1 < n ? "Weiter" : "Zum Ergebnis"}</button></div>`;
}

function quizAnswer(value) {
  const q = quiz.qs[quiz.i];
  quiz.guess = value;
  const off = Math.abs(value - q.answer);
  quiz.got[quiz.i] = q.kind === "choice" ? (q.options[value] === q.right ? 2 : 0) : off <= q.near[0] ? 2 : off <= q.near[1] ? 1 : 0;
  quiz.done = true;
  quizShow();
  $("#quiz-card [data-quiz=next]").focus({ preventScroll: true });
}

function quizGo(k) {
  Object.assign(quiz, k === "start" ? { qs: quizQuestions(), i: 0, got: [] } : { i: quiz.i + 1 }, { guess: null, done: false });
  quizShow();
  $("#quiz").scrollIntoView({ block: "nearest" });
  ($("#quiz-range") || $("#quiz-card button:not([disabled])"))?.focus({ preventScroll: true });
}

$("#quiz-card").addEventListener("click", (e) => {
  const b = e.target.closest("[data-quiz]");
  if (!b) return;
  const act = b.dataset.quiz;
  if (act === "start" || act === "next") quizGo(act);
  else if (act === "pick") quizAnswer(Number(b.dataset.k));
  else if (act === "answer") quizAnswer(quiz.guess);
  else if (act === "step") {
    const r = $("#quiz-range");
    r.value = Number(r.value) + Number(b.dataset.d);
    r.dispatchEvent(new Event("input", { bubbles: true })); // up to the card, which keeps the guess
  }
});
$("#quiz-card").addEventListener("input", (e) => {
  if (e.target.id !== "quiz-range") return;
  quiz.guess = Number(e.target.value);
  $("#quiz-val").textContent = unitText(quiz.qs[quiz.i], quiz.guess);
});
// Keys for a big screen: 1–4 answer, Enter goes on.
document.addEventListener("keydown", (e) => {
  if (!$("section[data-view=quiz]").classList.contains("active") || e.altKey || e.ctrlKey || e.metaKey) return;
  const q = quiz.qs[quiz.i];
  if (q && !quiz.done && q.kind === "choice" && /^[1-4]$/.test(e.key) && Number(e.key) <= q.options.length) quizAnswer(Number(e.key) - 1);
  else if (e.key === "Enter" && !e.target.closest("button")) {
    const b = $("#quiz-card .quiz-actions .primary");
    if (b) { e.preventDefault(); b.click(); }
  }
});
// Full screen for a TV or projector (not offered where the browser can't do it, e.g. on iPhones).
$("#quiz-full").hidden = !document.fullscreenEnabled;
$("#quiz-full").addEventListener("click", () => (document.fullscreenElement ? document.exitFullscreen() : $("#quiz").requestFullscreen()));
document.addEventListener("fullscreenchange", () => {
  $("#quiz-full").textContent = document.fullscreenElement ? "Vollbild beenden" : "Vollbild";
});
