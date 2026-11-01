import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
const preview = spawn(process.execPath, ['browser-server.mjs'], { env: { ...process.env, WISPRSIGHT_BROWSER_PORT: '8783' }, stdio: ['ignore', 'pipe', 'inherit'] });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  await new Promise((resolve, reject) => { preview.stdout.once('data', resolve); preview.once('error', reject); preview.once('exit', code => reject(new Error(`Preview exited ${code}`))); });
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  const outside = [];
  page.on('request', request => { if (new URL(request.url()).origin !== 'https://localhost:8783') outside.push(request.url()); });
  page.on('console', message => { if (message.type() === 'error') console.log('Browser:', message.text()); });
  await page.goto('https://localhost:8783/?runtime=browser');
  const file = readdirSync('dist/assets').find(file => file.startsWith('audio-teacher.worker-') && file.endsWith('.js'));
  const bytes = readFileSync('../.local/browser-check/audio.f32');
  const result = await page.evaluate(async ({ file, audio }) => {
    const worker = new Worker('/assets/' + file, { type: 'module' });
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Audio teacher timed out')); }, 180000);
      worker.onmessage = event => { if ('progress' in event.data) return; clearTimeout(timer); worker.terminate(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result); };
      worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
      const samples = Float32Array.from(audio); worker.postMessage({ id: 1, audio: samples }, [samples.buffer]);
    });
  }, { file, audio: Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)) });
  if (!/new york city/i.test(result.text)) throw new Error(`Unexpected actual Whisper output: ${result.text}`);
  if (outside.length) throw new Error('Audio teacher contacted an external service');
  console.log('PASS: actual local browser Whisper, zero external requests:', JSON.stringify(result));
} finally { await browser.close(); preview.kill('SIGTERM'); }
