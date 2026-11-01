import { env, InferenceSession, Tensor } from 'onnxruntime-web/webgpu';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { tokenize, adjustedScores, biasGradient, wordErrors } from './browser-decoder';

type Manifest = { version: number; graphs: Record<string, { file: string; sha256: string; external: string; chunks: { file: string; bytes: number; sha256: string }[] }>; tokens: string[]; pieces: [string, number][]; reference: number[][]; face: { file: string; sha256: string } };
type Encoded = { memory: Float32Array; frames: number; version: string };
type Example = Encoded & { id: string; text: string };
let encoder: InferenceSession | undefined, decoder: InferenceSession | undefined, face: FaceLandmarker | undefined;
let manifest: Manifest;
let frames: { gray: Uint8Array; width: number; height: number; x: number; y: number; anchors: number[][]; time: number }[] = [];
let cancelled = false;
let requestId = 0;
let modelVersion = '';
const lips = [0,13,14,17,37,39,40,61,78,80,81,82,84,87,88,91,95,146,178,181,185,191,267,269,270,291,308,310,311,312,314,317,318,321,324,375,402,405,409,415];
const groups = [[7,33,133,144,145,153,154,155,157,158,159,160,161,163,173,246], [249,263,362,373,374,380,381,382,384,385,386,387,388,390,398,466], [97,98,2,326,327], lips];

function progress(message: string, value = 0) { self.postMessage({ id: requestId, progress: value, message }); }
function check() { if (cancelled) throw new Error('Operation cancelled. Your saved examples are unchanged.'); }

async function asset(file: string, sha256: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(file)) throw new Error('Invalid model asset path.');
  const url = new URL(`/browser-model/${file}`, self.location.origin).href;
  const cache = await caches.open('wisprsight-model-v1');
  const key = `${url}?sha256=${sha256}`;
  let response = await cache.match(key);
  if (!response) {
    response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) throw new Error(`Model asset is unavailable: ${file}. Export and host the browser model files first.`);
    const bytes = await response.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
    if (hash !== sha256) throw new Error('Model checksum failed. Download the model again.');
    const storage = await self.navigator.storage.estimate();
    if (!storage.quota || (storage.usage ?? 0) + bytes.byteLength < storage.quota - 128 * 1024 * 1024) {
      try { await cache.put(key, new Response(bytes)); }
      catch (error) { if ((error as DOMException).name !== 'QuotaExceededError') throw error; }
    }
    return new Uint8Array(bytes);
  }
  const bytes = await response.arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== sha256) { await cache.delete(key); throw new Error('Cached model failed verification. Load it again.'); }
  return new Uint8Array(bytes);
}

async function load() {
  if (encoder && decoder && face) return { device: 'WebGPU', vocabulary: manifest.tokens.length, version: modelVersion };
  if (!self.navigator.gpu) throw new Error('This browser has no WebGPU support. Use a current Chrome browser on a supported laptop.');
  const adapter = await self.navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('A WebGPU graphics adapter is unavailable. Enable hardware acceleration or use Python mode.');
  env.wasm.wasmPaths = '/ort/';
  env.wasm.numThreads = 1;
  const device = await adapter.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize } });
  env.webgpu.device = device;
  device.lost.then(() => self.postMessage({ fatal: 'The GPU context was reset. Load the browser model again.' }));
  progress('Reading the browser model manifest…');
  const response = await fetch('/browser-model/manifest.json', { credentials: 'omit' });
  if (!response.ok || !response.headers.get('content-type')?.includes('json')) throw new Error('Browser model files are missing. Export and host /browser-model/ before using this mode.');
  manifest = await response.json();
  modelVersion = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(manifest)))), value => value.toString(16).padStart(2, '0')).join('');
  const total = Object.values(manifest.graphs).reduce((sum, graph) => sum + graph.chunks.reduce((size, chunk) => size + chunk.bytes, 0), 0);
  let downloaded = 0;
  for (const name of ['encoder', 'decoder']) {
    check();
    const graph = manifest.graphs[name];
    const weights = new Uint8Array(graph.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0));
    let offset = 0;
    for (const chunk of graph.chunks) {
      check();
      progress(`Loading model on this laptop · ${Math.round(downloaded / 1e6)} / ${Math.round(total / 1e6)} MB`, downloaded / total * 0.8);
      const bytes = await asset(chunk.file, chunk.sha256);
      if (bytes.length !== chunk.bytes) throw new Error('Model file size does not match its manifest.');
      weights.set(bytes, offset); offset += bytes.length; downloaded += bytes.length;
    }
    progress(`Preparing ${name} on the GPU…`, 0.85);
    const session = await InferenceSession.create(await asset(graph.file, graph.sha256), { executionProviders: ['webgpu', 'wasm'], externalData: [{ path: graph.external, data: weights }], graphOptimizationLevel: 'all' });
    if (name === 'encoder') encoder = session; else decoder = session;
  }
  progress('Loading local face tracking…', 0.95);
  const files = await FilesetResolver.forVisionTasks('/vision', true);
  const faceBytes = await asset(manifest.face.file, manifest.face.sha256);
  face = await FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetBuffer: faceBytes, delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 2 });
  return { device: 'WebGPU', bytes: total, vocabulary: manifest.tokens.length, version: modelVersion };
}

function collect(bitmap: ImageBitmap, time: number) {
  check();
  if (!face) throw new Error('Load the browser model first.');
  if (frames.length >= 180) { bitmap.close(); throw new Error('Keep each sentence under seven seconds.'); }
  const detected = face.detect(bitmap).faceLandmarks;
  if (detected.length !== 1) { bitmap.close(); throw new Error(detected.length ? 'Only one face should be visible.' : 'Keep your face in view in steady light.'); }
  const anchors = groups.map(indices => indices.reduce((sum, index) => [sum[0] + detected[0][index].x * bitmap.width / indices.length, sum[1] + detected[0][index].y * bitmap.height / indices.length], [0, 0]));
  const width = Math.min(bitmap.width, 400), height = Math.min(bitmap.height, 400);
  const x = Math.max(0, Math.min(bitmap.width - width, Math.round(anchors[3][0] - width / 2)));
  const y = Math.max(0, Math.min(bitmap.height - height, Math.round(anchors[3][1] - height / 2)));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(bitmap, -x, -y); bitmap.close();
  const rgba = context.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = Math.round(rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114);
  frames.push({ gray, width, height, x, y, anchors, time });
  return { frames: frames.length };
}

function transform(source: number[][], target: number[][]) {
  const center = (points: number[][]) => points.reduce((sum, p) => [sum[0] + p[0] / points.length, sum[1] + p[1] / points.length], [0, 0]);
  const s = center(source), t = center(target);
  let a = 0, b = 0, norm = 0;
  for (let i = 0; i < source.length; i++) {
    const x = source[i][0] - s[0], y = source[i][1] - s[1], u = target[i][0] - t[0], v = target[i][1] - t[1];
    a += x * u + y * v; b += x * v - y * u; norm += x * x + y * y;
  }
  if (norm < 1) throw new Error('Move closer to the camera.');
  a /= norm; b /= norm;
  return [a, b, t[0] - a * s[0] + b * s[1], t[1] - b * s[0] - a * s[1]];
}

async function encode(crops?: Uint8Array) {
  check();
  if (!encoder) throw new Error('Load the browser model first.');
  const length = crops ? crops.length / (96 * 96) : frames.length;
  if (!Number.isInteger(length) || length < 20 || length > 180) throw new Error('Record between one and seven seconds.');
  const input = new Float32Array(length * 88 * 88);
  if (crops) {
    for (let t = 0; t < length; t++) for (let y = 0; y < 88; y++) for (let x = 0; x < 88; x++) input[t * 88 * 88 + y * 88 + x] = (crops[t * 96 * 96 + (y + 4) * 96 + x + 4] / 255 - 0.421) / 0.165;
  } else {
    for (let t = 0; t < length; t++) {
      const frame = frames[t], margin = Math.min(6, t, length - t - 1);
      const smooth = frame.anchors.map((_, i) => [0, 0]);
      for (let n = t - margin; n <= t + margin; n++) for (let i = 0; i < 4; i++) for (let d = 0; d < 2; d++) smooth[i][d] += frames[n].anchors[i][d] / (2 * margin + 1);
      for (let d = 0; d < 2; d++) {
        const shift = frame.anchors.reduce((sum, point, i) => sum + (point[d] - smooth[i][d]) / 4, 0);
        for (const point of smooth) point[d] += shift;
      }
      const [a, b, tx, ty] = transform(smooth, manifest.reference);
      const cx = Math.round(Math.min(208, Math.max(48, a * smooth[3][0] - b * smooth[3][1] + tx)));
      const cy = Math.round(Math.min(208, Math.max(48, b * smooth[3][0] + a * smooth[3][1] + ty)));
      for (let y = 0; y < 88; y++) for (let x = 0; x < 88; x++) {
        const u = cx - 44 + x - tx, v = cy - 44 + y - ty;
        const sx = (a * u + b * v) / (a * a + b * b) - frame.x, sy = (-b * u + a * v) / (a * a + b * b) - frame.y;
        const ix = Math.floor(sx), iy = Math.floor(sy), dx = sx - ix, dy = sy - iy;
        let value = 0;
        for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) if (ix + xx >= 0 && iy + yy >= 0 && ix + xx < frame.width && iy + yy < frame.height) value += frame.gray[(iy + yy) * frame.width + ix + xx] * (xx ? dx : 1 - dx) * (yy ? dy : 1 - dy);
        input[t * 88 * 88 + y * 88 + x] = (value / 255 - 0.421) / 0.165;
      }
    }
  }
  frames = [];
  progress('Reading mouth movements on your GPU…', 0.5);
  const result = await encoder.run({ video: new Tensor('float32', input, [1, 1, length, 88, 88]) });
  const memory = new Float32Array(result.memory.data as Float32Array);
  const output = { memory, frames: result.memory.dims[1], version: modelVersion };
  result.memory.dispose(); result.logits.dispose();
  return output;
}

async function scores(tokens: number[], encoded: Encoded) {
  check();
  if (!decoder) throw new Error('Load the browser model first.');
  const output = await decoder.run({ tokens: new Tensor('int64', BigInt64Array.from(tokens, BigInt), [1, tokens.length]), memory: new Tensor('float32', encoded.memory, [1, encoded.frames, 768]) });
  const values = new Float32Array(output.scores.data as Float32Array); output.scores.dispose();
  return values;
}

async function decode(encoded: Encoded, bias: Float32Array = new Float32Array(manifest.tokens.length)) {
  if (encoded.version !== modelVersion) throw new Error('These examples belong to another browser model. Record new examples.');
  const eos = manifest.tokens.length - 1;
  let beam = [{ ids: [eos], score: 0 }];
  const finished: typeof beam = [];
  for (let step = 0; step < Math.min(80, encoded.frames); step++) {
    check();
    const next: typeof beam = [];
    for (const path of beam) {
      const probabilities = adjustedScores(await scores(path.ids, encoded), bias);
      const top: number[] = [];
      for (let id = 1; id < probabilities.length; id++) {
        if (manifest.tokens[id] === '<unk>') continue;
        if (id === eos && path.ids.length === 1) continue;
        top.push(id); top.sort((a, b) => probabilities[b] - probabilities[a]); if (top.length > 5) top.pop();
      }
      for (const id of top) {
        const candidate = { ids: [...path.ids, id], score: path.score + probabilities[id] };
        if (id === eos) finished.push(candidate); else next.push(candidate);
      }
    }
    next.sort((a, b) => b.score - a.score); beam = next.slice(0, 5);
    finished.sort((a, b) => b.score - a.score); finished.splice(5);
    if (!beam.length || (finished.length && finished[0].score >= beam[0].score)) break;
  }
  const best = finished[0] ?? beam[0];
  if (!best) throw new Error('No readable speech was detected. Try a shorter, clear sentence.');
  return best.ids.filter(id => id !== eos).map(id => manifest.tokens[id]).join('').replace(/▁/g, ' ').trim().replace(/\s+/g, ' ');
}

async function train(training: Example[], validation: Example[], previous: Float32Array) {
  const evaluate = async (samples: Example[], bias: Float32Array) => {
    let errors = 0, words = 0;
    for (const sample of samples) { const count = wordErrors(sample.text, await decode(sample, bias)); errors += count.errors; words += count.words; }
    return { errors, words, wer: errors / Math.max(words, 1) };
  };
  progress('Checking your current browser model…');
  const baseline = await evaluate(validation, previous), replay = training.slice(-3), replayBaseline = await evaluate(replay, previous);
  const rows: { scores: Float32Array; target: number }[] = [];
  const eos = manifest.tokens.length - 1;
  for (let i = 0; i < training.length; i++) {
    progress(`Preparing local correction learning · example ${i + 1} of ${training.length}`, 0.2);
    const targets = [...tokenize(training[i].text, manifest.pieces, manifest.tokens), eos];
    for (let token = 0; token < targets.length; token++) rows.push({ scores: await scores([eos, ...targets.slice(0, token)], training[i]), target: targets[token] });
  }
  let best = previous, candidate = baseline, replayCandidate = replayBaseline;
  const bias = new Float32Array(previous), history = [];
  for (let step = 0; step < 12; step++) {
    check();
    const { gradient, loss } = biasGradient(rows, bias);
    for (let i = 0; i < bias.length; i++) bias[i] = Math.max(-2, Math.min(2, bias[i] - 2 * gradient[i]));
    if ((step + 1) % 4) continue;
    progress(`Validating browser personalization · check ${(step + 1) / 4} of 3`, 0.4 + step / 24);
    const measured = await evaluate(validation, bias), replayMeasured = await evaluate(replay, bias);
    history.push({ step: step + 1, loss, validation: measured, replay: replayMeasured });
    if ((baseline.errors - measured.errors >= 2 || (measured.errors <= baseline.errors && replayBaseline.errors - replayMeasured.errors >= 2)) && (best === previous || measured.errors < candidate.errors || (measured.errors === candidate.errors && replayMeasured.errors < replayCandidate.errors))) { best = new Float32Array(bias); candidate = measured; replayCandidate = replayMeasured; }
  }
  return { bias: best, calibration: { baseline, candidate, replay_baseline: replayBaseline, replay_candidate: replayCandidate, history, accepted: best !== previous, message: best !== previous ? 'Browser personalization activated.' : 'Previous browser model kept. No measured improvement without a validation regression.', validation_sentences: validation.length, training_sentences: training.length } };
}

self.onmessage = async (event: MessageEvent) => {
  const { id, method, ...args } = event.data;
  if (method === 'cancel') { cancelled = true; return; }
  requestId = id; cancelled = false;
  try {
    let result;
    if (method === 'load') result = await load();
    else if (method === 'reset') { frames = []; result = {}; }
    else if (method === 'frame') result = collect(args.bitmap, args.time);
    else if (method === 'encode') result = await encode(args.crops);
    else if (method === 'decode') result = await decode(args.encoded, args.bias);
    else if (method === 'train') result = await train(args.training, args.validation, args.bias);
    else if (method === 'scores') result = await scores(args.tokens, args.encoded);
    else throw new Error('Unknown browser model operation.');
    self.postMessage({ id, result });
  } catch (error) {
    frames = [];
    if (method === 'load') { await encoder?.release(); await decoder?.release(); face?.close(); encoder = undefined; decoder = undefined; face = undefined; }
    self.postMessage({ id, error: (error as Error).message });
  }
};
