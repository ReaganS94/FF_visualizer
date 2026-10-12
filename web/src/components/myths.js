// The results of the myth tests, for the Mythen-Check and the quiz. The myths and their tests are in lib/myths.js,
// a myth's picture is MythPicture.jsx. Each test draws 2000 times, so the results are kept until new data comes in.
import { addDays, isoDate, minDate } from "../lib/dates.js";
import { mythResults } from "../lib/myths.js";
import { ALL, UPDATED, LISTED, FERIEN, HEIMSPIELE, WEATHER } from "../data.js";

let mythCache = null;
export function myths() {
  const last = minDate(addDays(UPDATED, -1), addDays(LISTED, -1));
  const key = `${ALL.length}|${isoDate(last)}|${HEIMSPIELE.length}|${FERIEN.length}`;
  if (mythCache?.key !== key) mythCache = { key, ...mythResults(ALL, last, { ferien: FERIEN, heimspiele: HEIMSPIELE, weather: WEATHER }) };
  return mythCache;
}
