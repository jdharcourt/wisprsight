import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
const child = spawn(process.execPath, ['browser-server.mjs'], { env: { ...process.env, WISPRSIGHT_BROWSER_PORT: '8781' }, stdio: ['ignore', 'pipe', 'pipe'] });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', code => reject(new Error(`Static preview exited ${code}`))); child.once('error', reject); });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.Worker = class {
      postMessage(message) { if (message.method === 'load') setTimeout(() => this.onmessage({ data: { id: message.id, result: { vocabulary: 3, version: 'storage-test' } } }), 200); }
      terminate() {}
    };
  });
  await page.goto('https://localhost:8781/?runtime=browser');
  const file = readdirSync('dist/assets').find(file => file.startsWith('browser-runtime-') && file.endsWith('.js'));
  const result = await page.evaluate(async file => {
    const { browserRequest: request } = await import('/assets/' + file);
    const task = await request('/api/browser/load', { method: 'POST' });
    const snapshot = await request('/api/jobs/' + task.id);
    await new Promise(resolve => setTimeout(resolve, 400));
    const completed = await request('/api/jobs/' + task.id);
    if (snapshot.status !== 'running' || completed.status !== 'done') throw new Error('Mutable job response changed an earlier React snapshot.');
    const first = await request('/api/profiles', { method: 'POST', body: JSON.stringify({ name: 'Storage one' }) });
    const second = await request('/api/profiles', { method: 'POST', body: JSON.stringify({ name: 'Storage two' }) });
    const db = await new Promise((resolve, reject) => { const open = indexedDB.open('wisprsight-browser-v1'); open.onsuccess = () => resolve(open.result); open.onerror = reject; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Multi-store fixture transaction timed out')), 5000);
      const transaction = db.transaction(['profiles', 'samples'], 'readwrite');
      for (let i = 0; i < 8; i++) {
        const sample = { id: crypto.randomUUID(), profile: first.id, text: `Sample sentence ${i}`, memory: new Float32Array(150 * 768), frames: 150, version: 'storage-test' };
        transaction.objectStore('samples').put(sample);
        first.samples.push({ id: sample.id, text: sample.text, frames: sample.frames });
      }
      transaction.objectStore('profiles').put(first);
      transaction.objectStore('samples').put({ id: 'orphan', profile: first.id, memory: new Float32Array(3) });
      transaction.oncomplete = () => { clearTimeout(timer); resolve(); };
      transaction.onerror = () => { clearTimeout(timer); reject(new Error(transaction.error?.name)); };
      transaction.onabort = () => { clearTimeout(timer); reject(new Error('Storage aborted')); };
    }); db.close();
    await request('/api/profiles/' + first.id, { method: 'DELETE' });
    const state = await request('/api/session');
    if (state.profiles.length !== 1 || state.profiles[0].id !== second.id) throw new Error('Profile isolation failed.');
    const read = await new Promise((resolve, reject) => { const open = indexedDB.open('wisprsight-browser-v1'); open.onsuccess = () => resolve(open.result); open.onerror = reject; });
    const count = await new Promise(resolve => { const transaction = read.transaction('samples', 'readonly'); const request = transaction.objectStore('samples').count(); request.onsuccess = () => resolve(request.result); }); read.close();
    if (count !== 0) throw new Error('Deleted profile retained orphaned feature data.');
    return { snapshots: true, multi_store: true, isolated: true, features_deleted: true };
  }, file);
  console.log('PASS:', JSON.stringify(result), '(model worker mocked; no inference claim).');
} finally { await browser.close(); child.kill('SIGTERM'); }
