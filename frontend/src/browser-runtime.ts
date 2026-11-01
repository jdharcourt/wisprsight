import type { Profile } from './app';
import { wordErrors } from './browser-decoder';

type Encoded = { memory: Float32Array; frames: number; version: string };
type LocalProfile = Profile & { bias?: Float32Array; model_version?: string; validation_keys?: string[] };
type Sample = Encoded & { id: string; profile: string; text: string };
type Job = { id: string; kind: string; status: string; message: string; progress: number; result?: unknown; cancelled: boolean };
const jobs = new Map<string, Job>();
const corrections = new Map<string, Encoded & { profile: string; expires: number }>();
let loaded = false, vocabulary = 0, modelVersion = '', lastActivity = Date.now();
let sequence = 0;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; progress?: (message: string, value: number) => void }>();
let worker: Worker | null = null;
const database = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('wisprsight-browser-v1', 2);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains('profiles')) request.result.createObjectStore('profiles', { keyPath: 'id' });
    const samples = request.result.objectStoreNames.contains('samples') ? request.transaction!.objectStore('samples') : request.result.createObjectStore('samples', { keyPath: 'id' });
    if (!samples.indexNames.contains('profile')) samples.createIndex('profile', 'profile');
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error('Browser storage is unavailable. Allow site storage to save your calibration.'));
});

async function store<T>(name: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await database;
  for (let attempt = 0;; attempt++) {
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(name, mode), request = operation(transaction.objectStore(name));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error ?? new Error('Storage transaction interrupted'));
      });
    } catch (error) {
      if (mode === 'readwrite' && attempt === 0 && (error as DOMException).name === 'QuotaExceededError' && await caches.delete('wisprsight-model-v1')) continue;
      throw new Error((error as DOMException).name === 'QuotaExceededError' ? 'Browser storage is full. Free site storage or remove an unused profile, then retry.' : `Browser data could not be committed (${(error as Error).name}).`);
    }
  }
}

function model(method: string, args: Record<string, unknown> = {}, progress?: (message: string, value: number) => void, transfer: Transferable[] = []) {
  if (!worker) {
    worker = new Worker(new URL('./browser-model.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = event => {
      if (event.data.fatal) { for (const call of pending.values()) call.reject(new Error(event.data.fatal)); pending.clear(); worker?.terminate(); worker = null; loaded = false; return; }
      const call = pending.get(event.data.id);
      if (!call) return;
      if ('progress' in event.data) { call.progress?.(event.data.message, event.data.progress); return; }
      pending.delete(event.data.id);
      if (event.data.error) call.reject(new Error(event.data.error)); else call.resolve(event.data.result);
    };
    worker.onerror = () => {
      for (const call of pending.values()) call.reject(new Error('The browser model worker stopped. Reload the page and load the model again.'));
      pending.clear(); worker?.terminate(); worker = null; loaded = false;
    };
  }
  const id = ++sequence;
  return new Promise<any>((resolve, reject) => { pending.set(id, { resolve, reject, progress }); worker!.postMessage({ id, method, ...args }, transfer); });
}

function running() { return [...jobs.values()].find(job => job.status === 'running'); }
function key(text: string) { return (text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? []).join(' '); }
function summary(profile: LocalProfile) { const { bias, ...metadata } = profile; return metadata; }
function check(job: Job) { if (job.cancelled) throw new Error('Operation cancelled. Your saved examples are unchanged.'); }

async function profile(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Choose a valid profile.');
  const value = await store<LocalProfile>('profiles', 'readonly', data => data.get(id));
  if (!value) throw new Error('Choose an existing browser profile.');
  return value;
}

function start(kind: string, operation: (job: Job) => Promise<unknown>) {
  if (running()) throw new Error('A local task is running. Wait or cancel it first.');
  jobs.clear();
  const job = { id: crypto.randomUUID(), kind, status: 'running', message: 'Processing in this browser…', progress: 0, cancelled: false } as Job;
  jobs.set(job.id, job);
  operation(job).then(result => { job.result = result; job.status = job.cancelled ? 'cancelled' : 'done'; }).catch(error => { job.status = job.cancelled ? 'cancelled' : 'error'; job.message = error.message; });
  return { id: job.id };
}

function videoEvent(video: HTMLVideoElement, event: string) {
  return new Promise<void>((resolve, reject) => {
    const finish = () => { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener('error', failed); };
    const done = () => { finish(); resolve(); };
    const failed = () => { finish(); reject(new Error('This browser could not decode the camera recording. Try Chrome.')); };
    const timer = window.setTimeout(() => { finish(); reject(new Error('Camera video decoding timed out. Try a shorter recording.')); }, 10000);
    video.addEventListener(event, done, { once: true }); video.addEventListener('error', failed, { once: true });
  });
}

async function extract(blob: Blob, job: Job): Promise<Encoded> {
  if (!loaded) throw new Error('Load the browser model first.');
  if (!(blob instanceof Blob) || blob.size > 20 * 1024 * 1024 || !/^video\/(webm|mp4)/.test(blob.type)) throw new Error('Use a camera video under 20 MB.');
  const magic = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (!(magic[0] === 0x1a && magic[1] === 0x45 && magic[2] === 0xdf && magic[3] === 0xa3) && String.fromCharCode(...magic.slice(4, 8)) !== 'ftyp') throw new Error('The recording is not a supported camera video.');
  const url = URL.createObjectURL(blob), video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto';
  try {
    const metadata = videoEvent(video, 'loadedmetadata'); video.src = url; await metadata;
    if (video.videoWidth > 1280 || video.videoHeight > 720) throw new Error('Use a camera resolution of 1280 × 720 or lower.');
    if (!Number.isFinite(video.duration)) { const seek = videoEvent(video, 'seeked'); video.currentTime = 1e8; await seek; }
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration < 0.8 || duration > 7.2) throw new Error('Keep each camera sentence between one and seven seconds.');
    await model('reset');
    for (let time = 0; time < duration - 0.02; time += 1 / 25) {
      check(job);
      if (Math.abs(video.currentTime - time) > 0.001 || video.readyState < 2) { const seek = videoEvent(video, 'seeked'); video.currentTime = time; await seek; }
      const bitmap = await createImageBitmap(video);
      await model('frame', { bitmap, time }, undefined, [bitmap]);
      job.message = `Aligning mouth frames locally · ${Math.round(time * 25) + 1}`;
      job.progress = time / duration * 0.4;
    }
    check(job);
    return await model('encode', {}, (message, value) => { job.message = message; job.progress = value; });
  } finally { video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); await model('reset').catch(() => undefined); }
}

export async function saveBrowserExample(id: string, encoded: Encoded, text: string, corrected: boolean) {
  if (text.length > 300 || wordErrors(text, '').words < 3 || !/^[\x20-\x7e]+$/.test(text)) throw new Error('Use an English sentence with at least three words and at most 300 characters.');
  if (!(encoded.memory instanceof Float32Array) || encoded.memory.length !== encoded.frames * 768 || encoded.frames < 20 || encoded.frames > 180 || encoded.memory.some(value => !Number.isFinite(value))) throw new Error('The GPU produced invalid mouth features. Try a shorter recording or Python mode.');
  const current = await profile(id);
  if (current.samples.length >= 50) throw new Error('This browser prototype supports 50 saved examples per profile.');
  const sample = { ...encoded, id: crypto.randomUUID(), profile: id, text: text.trim() };
  await store('samples', 'readwrite', data => data.put(sample));
  current.samples.push({ id: sample.id, text: sample.text, frames: sample.frames });
  if (corrected) current.learning_pending = true;
  await store('profiles', 'readwrite', data => data.put(current));
  return summary(current);
}

async function train(id: string, job: Job) {
  if (!loaded) throw new Error('Load the browser model before starting local learning.');
  const current = await profile(id);
  try {
    const groups = new Map<string, string[]>();
    for (const sample of current.samples) groups.set(key(sample.text), [...(groups.get(key(sample.text)) ?? []), sample.id]);
    if (groups.size < 8) throw new Error('Save eight different sentences before browser learning.');
    if (!current.validation_keys) {
      const hashes = await Promise.all([...groups.keys()].map(async text => ({ text, hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), value => value.toString(16).padStart(2, '0')).join('') })));
      hashes.sort((a, b) => a.hash.localeCompare(b.hash));
      const reserved = []; let words = 0;
      for (const item of hashes.slice(0, -5)) { reserved.push(item.text); words += wordErrors(item.text, '').words; if (reserved.length >= 3 && words >= 30) break; }
      if (reserved.length < 3 || words < 30) throw new Error('Use longer or more varied sentences: thirty reserved words and five training sentences are needed.');
      current.validation_keys = reserved;
      await store('profiles', 'readwrite', data => data.put(current));
    }
    const training: Sample[] = [], validation: Sample[] = [];
    for (const sample of current.samples) {
      const stored = await store<Sample>('samples', 'readonly', data => data.get(sample.id));
      if (!stored) throw new Error('A browser training example is missing. Record it again.');
      (current.validation_keys.includes(key(sample.text)) ? validation : training).push(stored);
    }
    check(job);
    const result = await model('train', { training, validation, bias: current.model_version === modelVersion && current.bias ? current.bias : new Float32Array(vocabulary) }, (message, progress) => { job.message = message; job.progress = progress; });
    check(job);
    current.calibration = result.calibration;
    if (result.calibration.accepted) { current.bias = result.bias; current.model_version = modelVersion; }
    await store('profiles', 'readwrite', data => data.put(current));
    return result.calibration;
  } finally {
    current.learning_pending = false;
    await store('profiles', 'readwrite', data => data.put(current));
  }
}

window.setInterval(async () => {
  for (const [id, correction] of corrections) if (correction.expires < Date.now()) corrections.delete(id);
  if (!loaded || running() || Date.now() - lastActivity < 30000) return;
  const profiles = await store<LocalProfile[]>('profiles', 'readonly', data => data.getAll());
  const next = profiles.find(value => value.learning_pending && new Set(value.samples.map(sample => key(sample.text))).size >= 8);
  if (next) start('train', job => train(next.id, job));
}, 10000);

export async function browserRequest(path: string, options: RequestInit = {}) {
  const method = options.method ?? 'GET';
  if (method !== 'GET') lastActivity = Date.now();
  if (path === '/api/session') return { csrf: 'browser', models_ready: loaded, profiles: (await store<LocalProfile[]>('profiles', 'readonly', data => data.getAll())).map(summary), auto_job: running() ? structuredClone(running()) : null, runtime: 'browser' };
  if (path === '/api/browser/load') return start('load', async job => { const info = await model('load', {}, (message, progress) => { job.message = message; job.progress = progress; }); loaded = true; vocabulary = info.vocabulary; modelVersion = info.version; return info; });
  if (path === '/api/activity') { if (running()) throw new Error('Wait for local learning or cancel it before recording.'); return { recording: true }; }
  if (path === '/api/profiles' && method === 'POST') {
    const name = JSON.parse(String(options.body)).name;
    if (typeof name !== 'string' || !name.trim() || name.length > 60) throw new Error('Use a profile name of 1–60 characters.');
    if ((await store<LocalProfile[]>('profiles', 'readonly', data => data.getAll())).length >= 10) throw new Error('This browser supports ten local profiles.');
    const created = { id: crypto.randomUUID(), name: name.trim(), samples: [], calibration: null };
    await store('profiles', 'readwrite', data => data.put(created)); return created;
  }
  const parts = path.split('/'), id = parts[3];
  if (parts[2] === 'profiles') {
    if (running()) throw new Error('Wait for the current task before changing a profile.');
    const current = await profile(id);
    if (method === 'PATCH') { const name = JSON.parse(String(options.body)).name; if (typeof name !== 'string' || !name.trim() || name.length > 60) throw new Error('Use a profile name of 1–60 characters.'); current.name = name.trim(); await store('profiles', 'readwrite', data => data.put(current)); return summary(current); }
    if (method === 'DELETE') { for (const sample of await store('samples', 'readonly', data => data.index('profile').getAllKeys(id))) await store('samples', 'readwrite', data => data.delete(sample)); await store('profiles', 'readwrite', data => data.delete(id)); for (const [token, value] of corrections) if (value.profile === id) corrections.delete(token); return { deleted: true }; }
  }
  if (parts[2] === 'jobs') {
    const job = jobs.get(id); if (!job) throw new Error('Browser task was lost when the page closed. Your saved examples remain.');
    if (parts[4] === 'cancel') { job.cancelled = true; worker?.postMessage({ method: 'cancel' }); job.message = 'Cancelling the current local operation…'; return { requested: true }; }
    return structuredClone(job);
  }
  if (parts[2] === 'train') return start('train', job => train(id, job));
  if (parts[2] === 'corrections') {
    const body = JSON.parse(String(options.body)), correction = corrections.get(body.token);
    if (!correction || correction.profile !== id || correction.expires < Date.now()) throw new Error('This take has expired. Record it again before saving a correction.');
    return start('correction', async () => { const saved = await saveBrowserExample(id, correction, body.text, true); corrections.delete(body.token); return saved; });
  }
  if (parts[2] === 'transcribe' || parts[2] === 'samples') {
    await profile(id);
    let payload = options.body as Blob | null;
    const reference = new Headers(options.headers).get('x-reference') ?? '';
    return start(parts[2] === 'samples' ? 'sample' : 'transcribe', async job => {
      const started = performance.now(), encoded = await extract(payload!, job); payload = null;
      check(job);
      if (parts[2] === 'samples') return saveBrowserExample(id, encoded, reference, false);
      job.message = 'Decoding your sentence locally…';
      const current = await profile(id), text = await model('decode', { encoded, bias: current.model_version === modelVersion && current.bias ? current.bias : new Float32Array(vocabulary) });
      check(job);
      while (corrections.size >= 3) corrections.delete(corrections.keys().next().value!);
      const token = crypto.randomUUID(); corrections.set(token, { ...encoded, profile: id, expires: Date.now() + 300000 });
      return { text: text.toLowerCase().replace(/(^|\s)[a-z]/g, (letter: string) => letter.toUpperCase()), inference_seconds: Math.round((performance.now() - started) / 10) / 100, correction_id: token, device: 'WebGPU' };
    });
  }
  if (parts[2] === 'label') throw new Error('Spoken-reference labeling is available in Python mode. Type the reference sentence for browser calibration.');
  throw new Error('Unknown browser operation.');
}
