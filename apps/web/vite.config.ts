import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const outputRoot = fileURLToPath(new URL("./dist", import.meta.url));

export default defineConfig({
  root: repositoryRoot,
  base: "./",
  plugins: [
    {
      name: "harbourline-release-2-entry",
      transformIndexHtml: {
        order: "pre",
        handler(html) {
          return html.replace(
            "</body>",
            '  <script type="module" src="/apps/web/src/release2.ts"></script>\n</body>'
          );
        }
      }
    },
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.ico",
        "favicon.svg",
        "assets/harbourline-mark.svg",
        "assets/harbourline-logo.svg"
      ],
      manifest: {
        name: "Harbourline",
        short_name: "Harbourline",
        description: "Household payday, bills, savings and debt planning.",
        theme_color: "#0b2520",
        background_color: "#f3f7f5",
        display: "standalone",
        start_url: "./",
        icons: [
          {
            src: "assets/harbourline-mark.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,jpg,webp}"]
      }
    })
  ],
  build: {
    outDir: outputRoot,
    emptyOutDir: true
  },
  server: {
    fs: {
      allow: [repositoryRoot]
    }
  }
});
