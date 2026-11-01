import { createServer } from 'node:https';
import { createReadStream, readFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { chromium, expect } from '@playwright/test';
const runtimeFile = readdirSync('dist/assets').find(file => file.startsWith('browser-runtime-') && file.endsWith('.js'));
const root = resolve('dist'), fixture = resolve('../.local/browser-check'), origin = 'https://localhost:8780';
const server = createServer({ cert: readFileSync('../.local/localhost.pem'), key: readFileSync('../.local/localhost-key.pem') }, (request, response) => {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=' 'sha256-StEaX+se6YS7pqjzrzMIA0KaX9zF/8zAhvQXZAe5epY='; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  response.setHeader('Permissions-Policy', 'camera=(self), microphone=()'); response.setHeader('X-Content-Type-Options', 'nosniff');
  let pathname = decodeURIComponent(new URL(request.url, origin).pathname);
  if (pathname.startsWith('/api/')) { response.writeHead(404); response.end('No Python API exists here.'); return; }
  const base = pathname.startsWith('/test/') ? fixture : root;
  pathname = pathname.startsWith('/test/') ? pathname.slice(6) : pathname.slice(1);
  const path = resolve(base, pathname || 'index.html');
  if (!path.startsWith(base + sep)) { response.writeHead(403); response.end(); return; }
  try {
    const type = /\.(m?js)$/.test(path) ? 'text/javascript' : path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : path.endsWith('.json') ? 'application/json' : 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type, 'Content-Length': statSync(path).size }); createReadStream(path).pipe(response);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(8780, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=/private/tmp/wisprsight-calibration-camera.y4m'] });
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, permissions: ['camera'] });
  const page = await context.newPage(), requests = [], errors = [];
  page.on('request', request => { if (new URL(request.url()).origin !== origin || new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.text().startsWith('MODEL')) console.log('BROWSER:', message.text().slice(0, 1500)); });
  await page.addInitScript(() => {
    const remove = caches.delete.bind(caches);
    caches.delete = async name => { console.log('MODEL TEST: evicting cache', name); return remove(name); };
    const Original = Worker;
    window.Worker = class extends Original { constructor(...args) { super(...args); if (String(args[0]).includes('browser-model.worker')) { window.testModelWorker = this; this.addEventListener('message', event => { if (event.data.error) { window.testWorkerError = event.data.error; console.log('MODEL ERROR:', event.data.error); } else if ('progress' in event.data) console.log('MODEL:', event.data.message); }); } } };
  });
  await page.goto(origin + '/?runtime=browser');
  console.log('GPU:', await page.evaluate(async () => ({ available: !!navigator.gpu, adapter: !!(await navigator.gpu?.requestAdapter()) })));
  await page.getByRole('button', { name: 'Load browser model', exact: true }).click();
  await expect.poll(async () => { const error = await page.evaluate(() => window.testWorkerError); if (error) throw new Error(error); return page.getByText('Browser model ready. Recordings and learning stay on this laptop.', { exact: true }).isVisible(); }, { timeout: 240000, intervals: [1000] }).toBe(true);
  console.log('PASS: browser model loaded with no Python API.');
  const result = await page.evaluate(async () => {
    let sequence = -1;
    const call = (method, data = {}) => new Promise((resolve, reject) => {
      const id = sequence--;
      const handler = event => { if (event.data.id !== id || 'progress' in event.data) return; window.testModelWorker.removeEventListener('message', handler); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result); };
      window.testModelWorker.addEventListener('message', handler); window.testModelWorker.postMessage({ id, method, ...data });
    });
    const encoded = await call('encode', { crops: new Uint8Array(await (await fetch('/test/crops.bin')).arrayBuffer()) });
    const expected = new Float32Array(await (await fetch('/test/memory.bin')).arrayBuffer());
    const metadata = await (await fetch('/test/expected.json')).json();
    let maximum = 0;
    for (let i = 0; i < expected.length; i++) maximum = Math.max(maximum, Math.abs(expected[i] - encoded.memory[i]));
    const manifest = await (await fetch('/browser-model/manifest.json')).json();
    const scores = await call('scores', { encoded, tokens: [manifest.tokens.length - 1, 10, 20, 30] });
    let decoderMaximum = 0;
    for (let i = 0; i < scores.length; i++) decoderMaximum = Math.max(decoderMaximum, Math.abs(scores[i] - metadata.decoder[0][i]));
    const text = await call('decode', { encoded });
    return { encoder_max_error: maximum, decoder_max_error: decoderMaximum, text, frames: encoded.frames };
  });
  console.log(JSON.stringify(result));
  if (result.encoder_max_error > 0.005 || result.decoder_max_error > 0.005) throw new Error('Browser numerical parity failed.');
  if (!result.text || result.text.length < 15) throw new Error('No real browser transcript was produced.');
  await page.getByLabel('Profile name', { exact: true }).fill('Browser-only test');
  await page.getByRole('button', { name: 'Create profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Calibration', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dictate', exact: true }).click();
  await page.getByRole('button', { name: /^Record sentence/ }).click();
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect.poll(async () => { const alert = page.locator('[role=alert].text-destructive'); if (await alert.count()) throw new Error(await alert.innerText()); return page.getByLabel('Transcript', { exact: true }).inputValue(); }, { timeout: 180000, intervals: [1000] }).not.toBe('');
  const cameraText = await page.getByLabel('Transcript', { exact: true }).inputValue();
  console.log('Camera pipeline transcript:', cameraText);
  if (!/New York City/i.test(cameraText)) throw new Error('Camera alignment failed to preserve the known fixture phrase.');
  await page.getByLabel('Transcript', { exact: true }).fill('Born In New York City And Raised Mostly In Chicago Nancy Davis');
  await page.getByRole('button', { name: 'Save correction', exact: true }).click();
  await expect(page.getByText('Correction saved. Local learning is queued automatically.', { exact: true })).toBeVisible();
  console.log('PASS: recorded browser video, face alignment, inference and persistent correction.');
  await page.getByRole('button', { name: 'Camera off', exact: true }).click();
  if (process.env.BROWSER_PERSONALIZATION_CHECK === '1') {
    const learning = await page.evaluate(async file => {
      const runtime = await import('/assets/' + file);
      const profile = await runtime.browserRequest('/api/profiles', { method: 'POST', body: JSON.stringify({ name: 'Browser learning test' }) });
      const fixtures = await (await fetch('/test/personalization.json')).json();
      console.log('MODEL TEST: preparing eight local feature fixtures');
      let sequence = -1000;
      const call = (method, data) => new Promise((resolve, reject) => {
        const id = sequence--;
        const handler = event => { if (event.data.id !== id || 'progress' in event.data) return; window.testModelWorker.removeEventListener('message', handler); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result); };
        window.testModelWorker.addEventListener('message', handler); window.testModelWorker.postMessage({ id, method, ...data });
      });
      const samples = [];
      for (const fixture of fixtures) {
        const encoded = await call('encode', { crops: new Uint8Array(await (await fetch('/test/' + fixture.file)).arrayBuffer()) });
        samples.push({ ...encoded, id: crypto.randomUUID(), profile: profile.id, text: fixture.text });
        console.log('MODEL TEST: encoded fixture', samples.length);
      }
      console.log('MODEL TEST: saving real features with application storage', JSON.stringify(await navigator.storage.estimate()));
      for (const sample of samples) {
        console.log('MODEL TEST: feature shape', sample.frames, sample.memory.length, sample.memory.buffer.constructor.name);
        await runtime.saveBrowserExample(profile.id, sample, sample.text, false);
      }
      console.log('MODEL TEST: fixture database saved; starting actual browser training');
      const task = await runtime.browserRequest('/api/train/' + profile.id, { method: 'POST' });
      const deadline = Date.now() + 600000;
      let lastMessage = '';
      for (;;) {
        if (Date.now() > deadline) throw new Error('Actual browser training timed out');
        const job = await runtime.browserRequest('/api/jobs/' + task.id);
        if (job.message !== lastMessage) { console.log('MODEL TEST JOB:', job.message); lastMessage = job.message; }
        if (job.status === 'error') throw new Error(job.message);
        if (job.status === 'done') return job.result;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }, runtimeFile);
    console.log('Actual browser personalization:', JSON.stringify(learning));
    if (!learning.history?.length || !learning.baseline.words || !Number.isFinite(learning.history[0].loss)) throw new Error('Browser training did not complete real model checks.');
  }
  await page.reload();
  await expect(page.getByLabel('Your profile', { exact: true })).toContainText(/Browser/);
  const names = await page.evaluate(async file => (await (await import('/assets/' + file)).browserRequest('/api/session')).profiles.map(profile => profile.name), runtimeFile);
  if (!names.includes('Browser-only test')) throw new Error('IndexedDB profile did not persist.');
  if (requests.length) throw new Error('Unexpected API/external requests: ' + requests.join(', '));
  if (errors.length) throw new Error(errors.join('\n'));
  await page.screenshot({ path: '../.impeccable/review/browser-only.png', fullPage: false, animations: 'disabled' });
  console.log('PASS: browser GPU inference, graph parity, transcript, IndexedDB persistence; zero Python API/external requests.');
} catch (error) { console.error('TEST FAILURE:', error); throw error; } finally { await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10000))]); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
