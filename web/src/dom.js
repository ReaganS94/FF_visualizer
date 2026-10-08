// Small helpers for the page itself.

export const $ = (s) => document.querySelector(s);
// Whether the device asks for less motion: animations then show their end at once.
export const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
