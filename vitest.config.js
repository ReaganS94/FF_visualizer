// Unit tests for the rules and calculations in web/src/lib/ (files in tests/unit/). They run in Node, without
// a browser, in Berlin time like the site's visitors.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.js"],
    env: { TZ: "Europe/Berlin" },
  },
});
