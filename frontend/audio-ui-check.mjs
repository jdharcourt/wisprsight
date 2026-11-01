import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
const server = spawn(process.execPath, ['browser-server.mjs'], { env: { ...process.env, WISPRSIGHT_BROWSER_PORT: '8784' }, stdio: ['ignore', 'pipe', 'inherit'] });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-audio-capture=/private/tmp/wisprsight-teacher-audio.wav'] });
try {
  await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1600 }, permissions: ['camera', 'microphone'] });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.fixtureReliable = true; window.fixtureTrainingStarts = 0;
    window.Worker = class {
      constructor(url) { this.audio = String(url).includes('audio-teacher'); }
      postMessage(message) {
        let result = {};
        if (message.method === 'train') window.fixtureTrainingStarts++;
        if (this.audio) result = { text: 'Born in New York City and raised mostly in Chicago Nancy Davis', reliable: window.fixtureReliable, teacher: 'Whisper (UI fixture)' };
        else if (message.method === 'load') result = { vocabulary: 3, version: 'ui-fixture' };
        else if (message.method === 'encode') result = { memory: new Float32Array(25 * 768), frames: 25, version: 'ui-fixture' };
        else if (message.method === 'decode') result = 'BORN IN NEW YORK CITY AND RAISED MOSTLY IN CHICAGO NANCY';
        setTimeout(() => this.onmessage({ data: { id: message.id, result } }), 0);
      }
      terminate() {}
    };
  });
  await page.goto('https://localhost:8784/?runtime=browser');
  await page.getByRole('button', { name: 'Load browser model', exact: true }).click();
  await expect(page.getByText('Browser model ready. Recordings and learning stay on this laptop.', { exact: true })).toBeVisible();
  await page.getByLabel('Profile name', { exact: true }).fill('Audio UI fixture');
  await page.getByRole('button', { name: 'Create profile', exact: true }).click();
  await page.getByRole('button', { name: 'Add a custom sentence instead', exact: true }).click();
  for (const reliable of [true, false]) {
    await page.evaluate(reliable => { window.fixtureReliable = reliable; }, reliable);
    await page.getByRole('button', { name: 'Learn from speech', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Audio and visual comparison' })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Camera off', exact: true }).click();
    if (reliable) {
      await expect(page.getByText('Speech example saved. Local learning is queued automatically.', { exact: true })).toBeVisible();
      await page.getByLabel('Reference sentence', { exact: true }).fill('Born in New York City and raised mostly in Chicago Nancy Reagan');
      await page.getByRole('button', { name: 'Save reference correction', exact: true }).click();
      await expect(page.getByText('Reference corrected. Local learning is queued automatically.', { exact: true })).toBeVisible();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: '../.impeccable/review/audio-final-desktop.png', animations: 'disabled' });
      await page.setViewportSize({ width: 390, height: 1600 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: '../.impeccable/review/audio-final-mobile.png', animations: 'disabled' });
      await page.setViewportSize({ width: 1440, height: 1600 });
      const unsaved = 'Born in New York City and raised mostly in Chicago Nancy Reagan today';
      await page.getByLabel('Reference sentence', { exact: true }).fill(unsaved);
      const runtimeFile = readdirSync('dist/assets').find(file => file.startsWith('browser-runtime-') && file.endsWith('.js'));
      await page.evaluate(async file => {
        const runtime = await import('/assets/' + file), profile = (await runtime.browserRequest('/api/session')).profiles[0];
        for (let i = 0; i < 7; i++) await runtime.saveBrowserExample(profile.id, { memory: new Float32Array(25 * 768), frames: 25, version: 'ui-fixture' }, `Different reference ${String.fromCharCode(97 + i)} contains enough words to keep reserved sentences separate today`, false);
      }, runtimeFile);
      await page.waitForTimeout(35000);
      if (await page.evaluate(() => window.fixtureTrainingStarts) !== 0) throw new Error('Idle learning started while the reference had unsaved edits.');
      await expect(page.getByLabel('Reference sentence', { exact: true })).toHaveValue(unsaved);
      await page.getByRole('button', { name: 'Save reference correction', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Save reference correction', exact: true })).toBeDisabled();
    } else {
      await page.screenshot({ path: '../.impeccable/review/audio-review-desktop.png', animations: 'disabled' });
      await page.getByRole('button', { name: 'Save reviewed reference', exact: true }).click();
      await expect(page.getByText('Correction saved. Local learning is queued automatically.', { exact: true })).toBeVisible();
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('PASS: spoken UI auto-save, reference editing, uncertainty review, unsaved-edit idle protection and mobile width; model workers mocked.');
} finally { await browser.close(); server.kill('SIGTERM'); }
