// Builds the site in web/ into dist/, which the "Publish site" workflow publishes on GitHub Pages.
// `npm run dev` serves web/ on your computer and reloads on every save. Files in web/public/ (the data, the
// icons and the app manifest) are copied as they are; everything in web/src/ is bundled.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const page = (name) => fileURLToPath(new URL(`web/${name}`, import.meta.url));

export default defineConfig({
  root: "web",
  base: "./", // relative links, so the site works under /FF_visualizer/ on GitHub Pages and anywhere else
  appType: "mpa", // two pages; a missing file is a 404, as on GitHub Pages
  plugins: [react()], // the tabs that moved to React (so far the Liste) are written in JSX
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rolldownOptions: {
      input: { main: page("index.html"), admin: page("admin.html") },
      // React gets a file of its own. It only changes with React's version, so browsers keep it cached
      // when the site's own code changes.
      output: { codeSplitting: { groups: [{ name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }] } },
    },
  },
});
