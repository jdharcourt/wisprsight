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
      postMessage(message) {
        let result = {};
        if (message.method === 'load') result = { vocabulary: 3, version: 'storage-test' };
        if (message.method === 'train') result = { bias: new Float32Array(3), visual: new Float32Array(96).fill(0.25), calibration: { accepted: true, baseline: { wer: 1 }, candidate: { wer: 0, words: 30 }, message: 'Fixture adapter' } };
        if (message.method === 'encode') result = { memory: new Float32Array(25 * 768), frames: 25, version: 'storage-test' };
        if (message.method === 'decode') {
          if (message.visual?.[0] !== 0.25) { this.onmessage({ data: { id: message.id, error: 'Persisted visual adapter was not passed to inference.' } }); return; }
          result = 'VISUAL ADAPTER WAS APPLIED';
        }
        setTimeout(() => this.onmessage({ data: { id: message.id, result } }), message.method === 'load' ? 200 : 0);
      }
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
        const sample = { id: crypto.randomUUID(), profile: first.id, text: `Unique example ${String.fromCharCode(97 + i)} has enough separate words to reserve for evaluation today`, memory: new Float32Array(150 * 768), frames: 150, version: 'storage-test' };
        transaction.objectStore('samples').put(sample);
        first.samples.push({ id: sample.id, text: sample.text, frames: sample.frames });
      }
      transaction.objectStore('profiles').put(first);
      transaction.objectStore('samples').put({ id: 'orphan', profile: first.id, memory: new Float32Array(3) });
      transaction.oncomplete = () => { clearTimeout(timer); resolve(); };
      transaction.onerror = () => { clearTimeout(timer); reject(new Error(transaction.error?.name)); };
      transaction.onabort = () => { clearTimeout(timer); reject(new Error('Storage aborted')); };
    }); db.close();
    const wait = async id => {
      for (let i = 0; i < 500; i++) {
        const job = await request('/api/jobs/' + id);
        if (job.status === 'error') throw new Error(job.message);
        if (job.status === 'done') return job.result;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Fixture operation timed out');
    };
    await wait((await request('/api/train/' + first.id, { method: 'POST' })).id);
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const context = canvas.getContext('2d'), stream = canvas.captureStream(25);
    const chunks = [], recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const timer = setInterval(() => { context.fillStyle = '#222'; context.fillRect(0, 0, 640, 480); }, 40);
    const blob = await new Promise(resolve => { recorder.ondataavailable = event => chunks.push(event.data); recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' })); recorder.start(); setTimeout(() => recorder.stop(), 1100); });
    clearInterval(timer); stream.getTracks().forEach(track => track.stop());
    const decoded = await wait((await request('/api/transcribe/' + first.id, { method: 'POST', body: blob })).id);
    if (decoded.text !== 'Visual Adapter Was Applied') throw new Error('Saved visual adapter was not used in dictation.');
    const original = first.samples[0].text;
    let blocked = false;
    try { await request('/api/samples/' + second.id + '/' + first.samples[0].id, { method: 'PATCH', body: JSON.stringify({ text: original }) }); } catch { blocked = true; }
    if (!blocked) throw new Error('Reference edit crossed profile boundaries.');
    await request('/api/profiles/' + first.id, { method: 'DELETE' });
    const state = await request('/api/session');
    if (state.profiles.length !== 1 || state.profiles[0].id !== second.id) throw new Error('Profile isolation failed.');
    const read = await new Promise((resolve, reject) => { const open = indexedDB.open('wisprsight-browser-v1'); open.onsuccess = () => resolve(open.result); open.onerror = reject; });
    const count = await new Promise(resolve => { const transaction = read.transaction('samples', 'readonly'); const request = transaction.objectStore('samples').count(); request.onsuccess = () => resolve(request.result); }); read.close();
    if (count !== 0) throw new Error('Deleted profile retained orphaned feature data.');
    return { snapshots: true, multi_store: true, isolated: true, features_deleted: true, visual_adapter_applied: true, reference_isolated: true };
  }, file);
  console.log('PASS:', JSON.stringify(result), '(model worker mocked; no inference claim).');
} finally { await browser.close(); child.kill('SIGTERM'); }
