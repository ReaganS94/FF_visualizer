// The tabs move to React one at a time; a tab that moved is a component in its folder in views/ (the Liste is
// views/list/AlarmList.jsx). Until all have moved, main.js hands the React ones their data through show().
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

const roots = new WeakMap(); // element -> its React root, made on first use

// Draws Component with props into el, replacing what React drew there before. It finishes before
// returning, like setting innerHTML, so code that measures or reads the page afterwards sees the result.
export function show(el, Component, props) {
  let root = roots.get(el);
  if (!root) roots.set(el, (root = createRoot(el)));
  flushSync(() => root.render(createElement(Component, props)));
}
