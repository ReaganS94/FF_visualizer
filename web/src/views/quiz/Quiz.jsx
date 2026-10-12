// Quiz "Schätz mal": the questions are built in lib/quiz.js; this shows them, one card at a time. Nothing is
// saved: no names, no high score.
import { Fragment, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { QUIZ_LEN, quizRound, unitText } from "../../lib/quiz.js";
import { ALL, KW, GEO, WEATHER, LISTED } from "../../data.js";
import { columnChart, barList } from "../../components/charts.js";
import { myths, mythParts } from "../../components/myths.js";
import "./quiz.css";

// The questions and explanations are page markup (lib/quiz.js escapes the data in them), and so is a myth's picture.
const html = (s) => ({ __html: s });

// Whether the page shows something full screen, for the button's label.
const onFullscreen = (cb) => {
  document.addEventListener("fullscreenchange", cb);
  return () => document.removeEventListener("fullscreenchange", cb);
};
const isFullscreen = () => !!document.fullscreenElement;

// Charts are drawn at phone width at most and then scale with the card, so a big screen gets big labels. Drawn
// once with the answer, not again for a new window width.
function QuizChart({ chart }) {
  const box = useRef(null);
  useLayoutEffect(() => {
    const width = Math.min(520, box.current.closest(".quiz-card").clientWidth || 520);
    const tmp = document.createElement("div");
    tmp.className = "chart";
    tmp.style.cssText = `position:absolute;left:-9999px;visibility:hidden;width:${width}px`;
    document.body.append(tmp);
    (chart.type === "bars" ? barList : columnChart)(tmp, chart.items, chart.opts);
    box.current.innerHTML = tmp.innerHTML;
    tmp.remove();
  }, [chart]);
  return <div className="chart quiz-chart" ref={box} />;
}

export default function Quiz() {
  // turn counts the cards shown so far: each start, answer and "Weiter" shows a new one.
  const [quiz, setQuiz] = useState({ turn: 0, qs: [], i: 0, got: [], guess: null, done: false });
  const recent = useRef(new Set()); // the kinds of the last round, which go last in the next one
  const box = useRef(null), card = useRef(null), range = useRef(null);
  const full = useSyncExternalStore(onFullscreen, isFullscreen);
  const { qs, i, got, done } = quiz, n = qs.length, q = qs[i];
  const start = q?.kind === "number" ? Math.round(q.max / 2) : null; // where the slider starts
  const guess = quiz.guess ?? start;

  // Every change is drawn at once, as before React: the focus moves to the new card right after it, and the
  // page's test plays rounds tap by tap without waiting.
  const update = (next) => flushSync(() => setQuiz(next));
  // A new card takes the focus off the old one first. Chrome lays out the page when the focused button goes,
  // and with the old card gone and the new one not there yet, the page is shorter: a phone scrolled down to the
  // quiz would jump up.
  function newCard(next) {
    if (card.current.contains(document.activeElement)) document.activeElement.blur();
    update({ ...next, turn: quiz.turn + 1 });
  }

  // A new round (this round's kinds go last in the next one), or the next question or the result.
  function go(round) {
    let next = { qs, i: i + 1, got };
    if (round) {
      const made = quizRound({ alarms: ALL, listedDate: LISTED, keywords: KW, geo: GEO, weather: WEATHER, myths }, recent.current);
      recent.current = made.used;
      next = { qs: made.qs, i: 0, got: [] };
    }
    newCard({ ...next, guess: null, done: false });
    box.current.scrollIntoView({ block: "nearest" });
    (range.current || card.current.querySelector("button:not([disabled])"))?.focus({ preventScroll: true });
  }

  // value: the option's number, or the slider's.
  function answer(value) {
    const off = Math.abs(value - q.answer);
    const scores = [...got];
    scores[i] = q.kind === "choice" ? (q.options[value] === q.right ? 2 : 0) : off <= q.near[0] ? 2 : off <= q.near[1] ? 1 : 0;
    newCard({ ...quiz, got: scores, guess: value, done: true });
    card.current.querySelector("[data-quiz=next]").focus({ preventScroll: true });
  }

  // − and + move the slider a step; it stops at its ends.
  function nudge(d) {
    range.current.value = Number(range.current.value) + d;
    update({ ...quiz, guess: Number(range.current.value) });
  }

  // Keys for a big screen: 1–4 answer, Enter goes on.
  const onKey = useEffectEvent((e) => {
    if (!box.current.closest("section").classList.contains("active") || e.altKey || e.ctrlKey || e.metaKey) return;
    if (q && !done && q.kind === "choice" && /^[1-4]$/.test(e.key) && Number(e.key) <= q.options.length) answer(Number(e.key) - 1);
    else if (e.key === "Enter" && !e.target.closest("button")) {
      const b = card.current.querySelector(".quiz-actions .primary");
      if (b) { e.preventDefault(); b.click(); }
    }
  });
  useEffect(() => {
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function cardBody() {
    if (!n) return (
      <>
        <div className="quiz-kicker">Quiz</div>
        <h2 className="quiz-title">Schätz mal!</h2>
        <p>{`${QUIZ_LEN} Fragen zu den Einsätzen der FF Linden. Bei Zahlen gibt es 2 Punkte für einen Treffer und 1 Punkt, wenn du nah dran bist. ` +
          "Jede andere richtige Antwort bringt 2 Punkte. Nichts wird gespeichert."}</p>
        <div className="quiz-actions">
          <button type="button" className="primary" data-quiz="start" onClick={() => go(true)}>Los geht's</button>
        </div>
      </>
    );
    if (i >= n) {
      const total = got.reduce((a, b) => a + b, 0), max = 2 * n, share = total / max;
      return (
        <>
          <div className="quiz-kicker">Geschafft</div>
          <div className="quiz-hero">{`${total} `}<span>{`von ${max} Punkten`}</span></div>
          <p className="quiz-verdict">{share >= 0.85 ? "Stark! Du kennst die FF Linden richtig gut." : share >= 0.6 ? "Gut geschätzt!"
            : share >= 0.35 ? "Nicht schlecht, da geht noch was." : "Schwierig, oder? Auf dieser Seite stehen alle Zahlen zum Nachschauen."}</p>
          <ol className="quiz-summary">
            {qs.map((q, k) => (
              <li className={`p${got[k]}`} key={k} dangerouslySetInnerHTML={html(`<b>${got[k] ? `+${got[k]}` : "0"}</b>${q.text}`)} />
            ))}
          </ol>
          <div className="quiz-actions">
            <button type="button" className="primary" data-quiz="start" onClick={() => go(true)}>Nochmal spielen</button>
          </div>
        </>
      );
    }
    const head = (
      <>
        <div className="quiz-kicker">{`Frage ${i + 1} von ${n}`}</div>
        <h2 className="quiz-q" dangerouslySetInnerHTML={html(q.text)} />
      </>
    );
    if (!done) {
      if (q.kind === "choice") return (
        <>
          {head}
          <div className={`quiz-options${q.options.length > 2 ? "" : " two"}`}>
            {q.options.map((o, k) => (
              <button type="button" data-quiz="pick" key={k} onClick={() => answer(k)}><span className="key">{k + 1}</span>{o}</button>
            ))}
          </div>
        </>
      );
      const step = q.max > 500 ? 5 : 1;
      return (
        <>
          {head}
          <div className="quiz-guess"><output id="quiz-val">{unitText(q, guess)}</output></div>
          <div className="quiz-slider">
            <button type="button" data-quiz="step" aria-label="weniger" onClick={() => nudge(-step)}>−</button>
            <input type="range" id="quiz-range" min="0" max={q.max} step={step} defaultValue={start} aria-label="Deine Schätzung" ref={range}
              onInput={(e) => update({ ...quiz, guess: Number(e.target.value) })} />
            <button type="button" data-quiz="step" aria-label="mehr" onClick={() => nudge(step)}>+</button>
          </div>
          <div className="quiz-scale"><span>0</span><span>{q.max.toLocaleString("de-DE")}</span></div>
          <div className="quiz-actions">
            <button type="button" className="primary" data-quiz="answer" onClick={() => answer(guess)}>Antworten</button>
          </div>
        </>
      );
    }
    // the answer
    const p = got[i];
    const verdict = q.kind === "choice" ? (p ? "Richtig!" : "Leider falsch.") : p === 2 ? "Volltreffer!" : p ? "Nah dran!" : "Daneben.";
    // labels near an end are aligned to that end, so they stay inside the card
    const mark = (cls, v, text) => {
      const at = Math.min(100, (100 * v) / q.max), end = at < 15 ? " l" : at > 85 ? " r" : "";
      return <span className={`mark ${cls}${end}`} style={{ left: `${at.toFixed(2)}%` }}><b>{text}</b></span>;
    };
    // the right number and what explains it
    const said = q.kind === "number" ? `Die richtige Antwort: <b>${unitText(q, q.answer)}</b>.${q.explain ? ` ${q.explain}` : ""}` : q.explain;
    return (
      <>
        {head}
        {q.kind === "choice" ? (
          <div className={`quiz-options${q.options.length > 2 ? "" : " two"} shown`}>
            {q.options.map((o, k) => (
              <button type="button" disabled className={o === q.right ? "right" : k === guess ? "wrong" : ""} key={k}>
                <span className="key">{k + 1}</span>{o}
              </button>
            ))}
          </div>
        ) : (
          <div className="quiz-line" role="img" aria-label={`Deine Schätzung ${unitText(q, guess)}, richtig ${unitText(q, q.answer)}`}>
            {mark("you", guess, `Du: ${unitText(q, guess)}`)}{mark("real", q.answer, `Richtig: ${unitText(q, q.answer)}`)}
          </div>
        )}
        <p className={`quiz-result p${p}`}><b>{verdict}</b>{` ${p ? `+${p} ${p === 1 ? "Punkt" : "Punkte"}` : ""}`}</p>
        {said && <p className="quiz-answer" dangerouslySetInnerHTML={html(said)} />}
        {q.chart && (q.chart.type === "myth" ? <div className="quiz-myth" dangerouslySetInnerHTML={html(mythParts(q.chart.myth).picture)} />
          : <QuizChart chart={q.chart} />)}
        <div className="quiz-actions">
          <button type="button" className="primary" data-quiz="next" onClick={() => go(false)}>{i + 1 < n ? "Weiter" : "Zum Ergebnis"}</button>
        </div>
      </>
    );
  }

  return (
    <div className="quiz" id="quiz" ref={box}>
      <div className="quiz-top">
        <div className="quiz-bar" id="quiz-bar">
          {i < n && qs.map((_, k) => <i className={k < i ? "done" : k === i ? "now" : ""} key={k} />)}
        </div>
        {/* full screen for a TV or projector (not offered where the browser can't do it, e.g. on iPhones) */}
        <button type="button" id="quiz-full" hidden={!document.fullscreenEnabled}
          onClick={() => (document.fullscreenElement ? document.exitFullscreen() : box.current.requestFullscreen())}>
          {full ? "Vollbild beenden" : "Vollbild"}
        </button>
      </div>
      {/* A new card on each turn, as when the page wrote the card afresh, so screen readers read out the whole card. */}
      <div className="quiz-card" id="quiz-card" aria-live="polite" ref={card}>
        <Fragment key={quiz.turn}>{cardBody()}</Fragment>
      </div>
    </div>
  );
}
