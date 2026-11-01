import { createServer } from 'node:https';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const folder = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(folder, 'dist');
const port = Number(process.env.WISPRSIGHT_BROWSER_PORT ?? 8780);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use a port between 1024 and 65535.');
const policy = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
const server = createServer({ cert: readFileSync(process.env.WISPRSIGHT_CERT ?? resolve(folder, '../.local/localhost.pem')), key: readFileSync(process.env.WISPRSIGHT_KEY ?? resolve(folder, '../.local/localhost-key.pem')) }, (request, response) => {
  for (const header of policy.headers[0].headers) response.setHeader(header.key, header.value);
  if (![ `localhost:${port}`, `127.0.0.1:${port}` ].includes(request.headers.host)) { response.writeHead(400); response.end(); return; }
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
  let path;
  try { path = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'https://localhost').pathname)); }
  catch { response.writeHead(400); response.end(); return; }
  if (path === root) path = resolve(root, 'index.html');
  if (!path.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
  try {
    const file = statSync(path);
    if (!file.isFile()) throw new Error('Not a file');
    const type = /\.(m?js)$/.test(path) ? 'text/javascript' : path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : path.endsWith('.json') ? 'application/json' : 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type, 'Content-Length': file.size });
    if (request.method === 'HEAD') response.end(); else createReadStream(path).pipe(response);
  } catch { response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Browser-only Wisprsight: https://localhost:${port}/?runtime=browser`));
