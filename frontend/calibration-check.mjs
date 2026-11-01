import { chromium, expect } from "@playwright/test";

const spoken = process.env.SPOKEN_CALIBRATION_CHECK === '1';
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--use-file-for-fake-video-capture=/private/tmp/wisprsight-calibration-camera.y4m"] });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, colorScheme: "dark", permissions: spoken ? ["camera", "microphone"] : ["camera"] });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error" && !message.text().startsWith("INFO: Created TensorFlow Lite")) errors.push(message.text()); });
const id = "33333333-3333-4333-8333-333333333333";
const sampleJob = "44444444-4444-4444-8444-444444444444";
const trainJob = "55555555-5555-4555-8555-555555555555";
const profile = { id, name: "Automatic calibration test", samples: Array.from({ length: 5 }, (_, index) => ({ id: String(index), text: `Existing example ${String.fromCharCode(97 + index)} includes enough different words for calibration today`, frames: 80 })), calibration: null };
let saved = 0;
let trained = 0;
let reviewed = 0;
let reference = "";
await page.route("**/api/activity", route => route.fulfill({ json: { recording: true } }));
await page.route("**/api/session", route => route.fulfill({ json: { csrf: "fixture", models_ready: true, profiles: [profile] } }));
await page.route(`**/api/${spoken ? "teach" : "samples"}/${id}`, async route => { saved += 1; reference = route.request().headers()["x-reference"]; if (!route.request().headers()["x-reference"]) throw new Error("Missing reference label"); await route.fulfill({ json: { id: sampleJob } }); });
await page.route(`**/api/jobs/${sampleJob}`, route => route.fulfill({ json: { id: sampleJob, kind: spoken ? "teach" : "sample", status: "done", result: spoken ? { saved: saved > 1, text: reference, visual_text: "The visual model made a mistake", correction_id: sampleJob, comparison: { errors: 3, words: 10, wer: 0.3 }, teacher: "Fixture Whisper" } : { ...profile, samples: [...profile.samples, { id: "new", text: "Recorded calibration sentence", frames: 100 }] } } }));
await page.route(`**/api/train/${id}`, route => { trained += 1; return route.fulfill({ json: { id: trainJob } }); });
await page.route(`**/api/jobs/${trainJob}`, route => route.fulfill({ json: { id: trainJob, kind: "train", status: "done", result: { accepted: true, message: "Test calibration completed." } } }));
await page.route(`**/api/corrections/${id}`, route => { reviewed++; return route.fulfill({ json: { id: trainJob } }); });
if (process.env.CALIBRATION_PERMISSION_DENIED === '1') await page.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied by test fixture', 'NotAllowedError'); };
});
await page.goto(process.env.WISPRSIGHT_TEST_URL ?? "https://localhost:8770");
await page.getByRole("button", { name: "Calibration", exact: true }).click();
await page.getByRole("button", { name: spoken ? "Spoken calibration" : "Start calibration", exact: true }).click();
await expect(page.getByRole("region", { name: "Full-screen calibration" })).toBeVisible();
await expect(page.getByText(spoken ? "Read this sentence aloud" : "Mouth this sentence silently", { exact: true })).toBeVisible();
await page.screenshot({ path: "../.impeccable/review/calibration-fullscreen.png", fullPage: false, animations: "disabled" });
if (process.env.CALIBRATION_PERMISSION_DENIED === '1') {
  await expect(page.getByText('Camera off · Microphone off', { exact: true })).toBeVisible();
  await expect(page.getByText('Camera or microphone access was denied. Allow access in your browser settings, then exit and restart calibration.', { exact: true })).toBeVisible();
  await page.screenshot({ path: '../.impeccable/review/spoken-calibration-denied.png', animations: 'disabled' });
  console.log('PASS: denied spoken calibration reports both devices off and permission recovery.');
  await browser.close();
  process.exit(0);
}
let retries = 0;
await expect.poll(async () => {
  if (spoken && await page.getByRole("button", { name: "Save reviewed sentence", exact: true }).isVisible()) {
    await page.getByLabel("Whisper reference", { exact: true }).fill("I would like to write a short message to my friend");
    await page.screenshot({ path: "../.impeccable/review/spoken-calibration-review.png", animations: "disabled" });
    await page.getByRole("button", { name: "Save reviewed sentence", exact: true }).click();
  }
  const retry = page.getByRole("button", { name: "Retry sentence", exact: true });
  if (await retry.isVisible()) {
    if (++retries > 3) throw new Error("Fake camera failed to supply articulation after three retries.");
    await retry.click();
  }
  return page.getByRole("heading", { name: "Calibration complete", exact: true }).isVisible();
}, { timeout: 60000, intervals: [500] }).toBe(true);
if (saved !== 3 || trained !== 1 || spoken && reviewed !== 1) throw new Error(`Expected three automatic takes and one training start, got ${saved}/${trained}`);
if (errors.length) throw new Error(errors.join("\n"));
console.log(spoken ? "PASS: spoken full-screen calibration, uncertain-label review, automatic saves/progression and one training start; teacher/fitting mocked." : "PASS: real local WASM mouth tracking, automatic sentence completion, automatic saves, sentence progression and automatic training start; backend fitting mocked, real camera/microphone off.");
await expect(page.getByRole("button", { name: "Start dictating", exact: true })).toBeVisible();
await expect.poll(() => page.locator(".session-progress [data-slot=progress-indicator]").evaluate(element => element.getBoundingClientRect().width / element.parentElement.getBoundingClientRect().width)).toBeGreaterThan(0.999);
await page.screenshot({ path: "../.impeccable/review/calibration-complete.png", fullPage: false, animations: "disabled" });
await browser.close();
