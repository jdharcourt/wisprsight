let csrf = "";

export async function request(path: string, options: RequestInit = {}) {
  let response = await fetch(path, { ...options, headers: { "x-csrf-token": csrf, ...options.headers } });
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
