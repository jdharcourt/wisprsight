import { chromium, expect } from "@playwright/test";

const target = process.argv[2] ?? "https://localhost:8765";
if (!["localhost", "127.0.0.1"].includes(new URL(target).hostname)) throw new Error("Use a local Wisprsight URL.");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.goto(target);
await expect(page.getByRole("heading", { name: "Dictate", exact: true })).toBeVisible();
await page.getByRole("button", { name: "Dictate", exact: true }).hover();
await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
if (errors.length) throw new Error(errors.join("\n"));
await page.screenshot({ path: "../.impeccable/review/live-notra.png", fullPage: false, animations: "disabled" });
console.log("PASS: fresh local load and Notra tooltip render without runtime errors.");
await browser.close();
