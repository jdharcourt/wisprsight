import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(`${root}public`, { recursive: true });
cpSync(`${root}node_modules/@mediapipe/tasks-vision/wasm`, `${root}public/vision`, { recursive: true });
mkdirSync(`${root}public/ort`, { recursive: true });
for (const file of readdirSync(`${root}node_modules/onnxruntime-web/dist`)) if (/^ort-wasm-simd-threaded\.(jsep|asyncify)\.(wasm|mjs)$/.test(file)) cpSync(`${root}node_modules/onnxruntime-web/dist/${file}`, `${root}public/ort/${file}`);

mkdirSync(`${root}public/speech-ort`, { recursive: true });
for (const file of readdirSync(`${root}node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist`)) if (/^ort-wasm-simd-threaded.*\.(wasm|mjs)$/.test(file)) cpSync(`${root}node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/${file}`, `${root}public/speech-ort/${file}`);

if (process.env.BROWSER_MODEL_URL) {
  const { createHash } = await import('node:crypto');
  const { readFileSync, writeFileSync, existsSync, renameSync } = await import('node:fs');
  const base = new URL(process.env.BROWSER_MODEL_URL.endsWith('/') ? process.env.BROWSER_MODEL_URL : process.env.BROWSER_MODEL_URL + '/');
  if (base.protocol !== 'https:' || base.username || base.password) throw new Error('BROWSER_MODEL_URL must be an HTTPS model-bundle directory URL.');
  const response = await fetch(new URL('manifest.json', base));
  if (!response.ok) throw new Error('Could not download the browser model manifest.');
  const text = await response.text();
  if (text.length > 2 * 1024 * 1024) throw new Error('Browser model manifest exceeds its size limit.');
  const manifest = JSON.parse(text);
  if (manifest.version !== 1 || !manifest.graphs?.encoder || !manifest.graphs?.decoder || !manifest.face) throw new Error('Unsupported browser model manifest.');
  const speechResponse = await fetch(new URL('speech-manifest.json', base));
  if (!speechResponse.ok) throw new Error('Audio teacher assets are missing. Run scripts/prepare_audio_teacher.py and upload its speech folder and speech-manifest.json to the model bucket.');
  const speechText = await speechResponse.text();
  if (speechText.length > 100000) throw new Error('Audio teacher manifest exceeds its size limit.');
  const speech = JSON.parse(speechText);
  if (speech.version !== 1 || !Array.isArray(speech.files)) throw new Error('Unsupported audio teacher manifest.');
  const files = [manifest.face, ...speech.files];
  for (const graph of Object.values(manifest.graphs)) files.push({ file: graph.file, sha256: graph.sha256 }, ...graph.chunks);
  if (files.length > 100) throw new Error('Browser model contains too many files.');
  const folder = `${root}public/browser-model`;
  mkdirSync(folder, { recursive: true });
  for (const file of files) {
    if (!/^(?:speech\/whisper-base\.en\/(?:onnx\/)?)?[a-zA-Z0-9._-]+$/.test(file.file) || file.file.split('/').some(part => part === '.' || part === '..') || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid browser model file metadata.');
    const path = `${folder}/${file.file}`;
    if (existsSync(path) && createHash('sha256').update(readFileSync(path)).digest('hex') === file.sha256) continue;
    const asset = await fetch(new URL(file.file, base));
    if (!asset.ok) throw new Error(`Could not download browser model asset ${file.file}.`);
    const bytes = Buffer.from(await asset.arrayBuffer());
    if (bytes.length > 64 * 1024 * 1024 || (file.bytes && bytes.length !== file.bytes) || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Browser model asset failed verification: ${file.file}`);
    mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    writeFileSync(path + '.tmp', bytes); renameSync(path + '.tmp', path);
  }
  writeFileSync(`${folder}/speech-manifest.json`, speechText);
  writeFileSync(`${folder}/manifest.json.tmp`, text); renameSync(`${folder}/manifest.json.tmp`, `${folder}/manifest.json`);
}
if (process.env.VERCEL === '1') {
  const { existsSync } = await import('node:fs');
  if (!existsSync(`${root}public/browser-model/manifest.json`) || !existsSync(`${root}public/browser-model/speech-manifest.json`)) throw new Error('Browser model assets are missing. Set BROWSER_MODEL_URL to your exported, hosted bundle directory before deploying.');
}
