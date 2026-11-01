import "./prepare-static.mjs";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { Agent } from "node:https";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const port = Number(process.env.WISPRSIGHT_FRONTEND_PORT ?? 8765);
const backendPort = Number(process.env.WISPRSIGHT_PORT ?? 8767);
const cert = readFileSync(process.env.WISPRSIGHT_CERT);
const nonce = randomBytes(24).toString("base64");
const server = await createServer({
  configFile: false,
  worker: { format: "es" },
  cacheDir: fileURLToPath(new URL(`./node_modules/.vite-wisprsight-${port}`, import.meta.url)),
  plugins: [react(), tailwind(), {
    name: "external-refresh-preamble",
    configureServer(vite) {
      vite.middlewares.use("/@wisprsight/refresh-preamble", (_request, response) => {
        for (const [name, value] of Object.entries(vite.config.server.headers ?? {})) response.setHeader(name, value);
        response.setHeader("Content-Type", "text/javascript");
        response.end(react.preambleCode.replaceAll("__BASE__", "/"));
      });
    },
    transformIndexHtml: { order: "post", handler(html) {
      return html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/g, (tag, code) => (code.includes("injectIntoGlobalHook") && code.includes("@react-refresh")) ? '<script type="module" src="/@wisprsight/refresh-preamble"></script>' : tag);
    } },
  }],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  root: import.meta.dirname,
  html: { cspNonce: nonce },
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    allowedHosts: ["localhost", "127.0.0.1"],
    https: { cert, key: readFileSync(process.env.WISPRSIGHT_KEY) },
    hmr: { host: "localhost", protocol: "wss", clientPort: port },
    headers: {
      "Content-Security-Policy": `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'nonce-${nonce}' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=' 'sha256-StEaX+se6YS7pqjzrzMIA0KaX9zF/8zAhvQXZAe5epY='; connect-src 'self' wss://localhost:${port}; img-src 'self' blob: data:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
      "Strict-Transport-Security": "max-age=31536000",
      "X-Content-Type-Options": "nosniff",
      "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    },
    proxy: {
      "/vision": { target: `https://127.0.0.1:${backendPort}`, changeOrigin: true, secure: true, agent: new Agent({ ca: cert }) },
      "/api": {
        target: `https://127.0.0.1:${backendPort}`,
        changeOrigin: true,
        secure: true,
        agent: new Agent({ ca: cert }),
      },
    },
  },
});
await server.listen();
console.log(`Wisprsight live UI: https://localhost:${port}`);
