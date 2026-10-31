import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--use-file-for-fake-video-capture=/private/tmp/wisprsight-calibration-camera.y4m"] });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, colorScheme: "dark", permissions: ["camera"] });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error" && !message.text().startsWith("INFO: Created TensorFlow Lite")) errors.push(message.text()); });
const id = "33333333-3333-4333-8333-333333333333";
const sampleJob = "44444444-4444-4444-8444-444444444444";
const trainJob = "55555555-5555-4555-8555-555555555555";
const profile = { id, name: "Automatic calibration test", samples: Array.from({ length: 21 }, (_, index) => ({ id: String(index), text: `Existing example ${String.fromCharCode(97 + index)} includes enough different words for calibration today`, frames: 80 })), calibration: null };
let saved = 0;
let trained = 0;
await page.route("**/api/activity", route => route.fulfill({ json: { recording: true } }));
await page.route("**/api/session", route => route.fulfill({ json: { csrf: "fixture", models_ready: true, profiles: [profile] } }));
await page.route(`**/api/samples/${id}`, async route => { saved += 1; if (!route.request().headers()["x-reference"]) throw new Error("Missing reference label"); await route.fulfill({ json: { id: sampleJob } }); });
await page.route(`**/api/jobs/${sampleJob}`, route => route.fulfill({ json: { id: sampleJob, kind: "sample", status: "done", result: { ...profile, samples: [...profile.samples, { id: "new", text: "Recorded calibration sentence", frames: 100 }] } } }));
await page.route(`**/api/train/${id}`, route => { trained += 1; return route.fulfill({ json: { id: trainJob } }); });
await page.route(`**/api/jobs/${trainJob}`, route => route.fulfill({ json: { id: trainJob, kind: "train", status: "done", result: { accepted: true, message: "Test calibration completed." } } }));
await page.goto(process.env.WISPRSIGHT_TEST_URL ?? "https://localhost:8770");
await page.getByRole("button", { name: "Calibration", exact: true }).click();
await page.getByRole("button", { name: "Start calibration", exact: true }).click();
await expect(page.getByRole("region", { name: "Full-screen calibration" })).toBeVisible();
await expect(page.getByText("Mouth this sentence silently", { exact: true })).toBeVisible();
await page.screenshot({ path: "../.impeccable/review/calibration-fullscreen.png", fullPage: false, animations: "disabled" });
let retries = 0;
await expect.poll(async () => {
  const retry = page.getByRole("button", { name: "Retry sentence", exact: true });
  if (await retry.isVisible()) {
    if (++retries > 3) throw new Error("Fake camera failed to supply articulation after three retries.");
    await retry.click();
  }
  return page.getByRole("heading", { name: "Calibration complete", exact: true }).isVisible();
}, { timeout: 60000, intervals: [500] }).toBe(true);
if (saved !== 3 || trained !== 1) throw new Error(`Expected three automatic takes and one training start, got ${saved}/${trained}`);
if (errors.length) throw new Error(errors.join("\n"));
console.log("PASS: real local WASM mouth tracking, automatic sentence completion, automatic saves, sentence progression and automatic training start; backend fitting mocked, real camera/microphone off.");
await expect(page.getByRole("button", { name: "Start dictating", exact: true })).toBeVisible();
await expect.poll(() => page.locator(".session-progress [data-slot=progress-indicator]").evaluate(element => element.getBoundingClientRect().width / element.parentElement.getBoundingClientRect().width)).toBeGreaterThan(0.999);
await page.screenshot({ path: "../.impeccable/review/calibration-complete.png", fullPage: false, animations: "disabled" });
await browser.close();
