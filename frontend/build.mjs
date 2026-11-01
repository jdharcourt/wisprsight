import "./prepare-static.mjs";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

await build({ configFile: false, worker: { format: "es" }, root: import.meta.dirname, resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } }, plugins: [react(), tailwind()] });
