let browser = new URLSearchParams(location.search).get('runtime') === 'browser' || !['localhost', '127.0.0.1'].includes(location.hostname);
export function isBrowserRuntime() { return browser; }
export function faceModelPath() { return browser ? '/browser-model/face_landmarker.task' : '/api/face-model'; }

let csrf = "";

export async function request(path: string, options: RequestInit = {}) {
  if (browser) return (await import("./browser-runtime")).browserRequest(path, options);
  let response = await fetch(path, { ...options, headers: { "x-csrf-token": csrf, ...options.headers } });
  if (path === '/api/session' && response.status === 404) {
    browser = true;
    return (await import('./browser-runtime')).browserRequest(path, options);
  }
  if (!response.headers.get('content-type')?.includes('json')) {
    if (path === '/api/session' && response.ok && response.headers.get('content-type')?.includes('text/html')) {
      browser = true;
      return (await import('./browser-runtime')).browserRequest(path, options);
    }
    throw new Error('The local Python service is unavailable. Start it again, or open this page with ?runtime=browser.');
  }
  let data = await response.json();
  if (response.status === 403 && data.detail === "Reload the page to start a secure local session.") {
    const session = await fetch("/api/session");
    const fresh = await session.json();
    csrf = fresh.csrf;
    response = await fetch(path, { ...options, headers: { "x-csrf-token": csrf, ...options.headers } });
    data = await response.json();
  }
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Check the supplied values and try again.");
  if (path === "/api/session") csrf = data.csrf;
  return data;
}
