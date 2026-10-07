// Builds the site in web/ into dist/, which the "Website veröffentlichen" workflow publishes on GitHub Pages.
// `npm run dev` serves web/ on your computer and reloads on every save. Files in web/public/ (the data, the
// icons and the app manifest) are copied as they are; everything in web/src/ is bundled.
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const page = (name) => fileURLToPath(new URL(`web/${name}`, import.meta.url));

export default defineConfig({
  root: "web",
  base: "./", // relative links, so the site works under /FF_visualizer/ on GitHub Pages and anywhere else
  appType: "mpa", // two pages; a missing file is a 404, as on GitHub Pages
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rolldownOptions: { input: { main: page("index.html"), admin: page("admin.html") } },
  },
});
