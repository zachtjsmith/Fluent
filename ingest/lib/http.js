/* ============================================================================
   http.js — polite HTTP for the collector.

   - Identifies itself with a contact address, so an employer or a hiring
     system that wants us to stop can say so.
   - Each hiring system (or, for Workday and employers' own sites, each
     address) gets its own small concurrency limit.
   - Only network errors, 5xx and 429 are retried, and 429 honours the
     server's Retry-After.
   ========================================================================== */

/* Set a real contact before the first live run (see README, "Before launch"). */
export const UA = process.env.COLLECTOR_UA || "FluentJobBoard/1.0 (contact: CHANGE-ME@example.com)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(status, url) { super(`HTTP ${status}`); this.status = status; this.url = url; }
}

export function semaphore(max) {
  let active = 0;
  const queue = [];
  return async (fn) => {
    if (active >= max) await new Promise((r) => queue.push(r));
    active++;
    try { return await fn(); }
    finally { active--; const next = queue.shift(); if (next) next(); }
  };
}

// Simultaneous requests allowed per key. Small on purpose. Keys not listed
// here (one per employer site, such as "site:acme.wd1.myworkdayjobs.com")
// get 2.
const LIMITS = { greenhouse: 4, lever: 3, ashby: 3, workable: 2 };
const gates = {};
const gate = (key) => (gates[key] ||= semaphore(LIMITS[key] || 2));

/* One key per address, for sites where every employer has its own. */
export const siteKey = (url) => { try { return `site:${new URL(url).host.toLowerCase()}`; } catch { return "site:unknown"; } };

/* The tests send every https:// request to a local stand-in server instead.
   Unset in normal use. */
function testRoute(url) {
  const base = process.env.COLLECTOR_TEST_SERVER;
  if (!base || !/^https:\/\//i.test(url)) return url;
  const u = new URL(url);
  return `${base}/${u.host}${u.pathname}${u.search}`;
}

async function request(key, url, { accept, read, timeout = 20000, retries = 2 }) {
  return gate(key)(async () => {
    const target = testRoute(url);
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const res = await fetch(target, { headers: { "User-Agent": UA, Accept: accept }, redirect: "follow", signal: ctrl.signal });
        if (res.ok) return await read(res);
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt >= retries) throw new HttpError(res.status, url);
        const wait = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 30) * 1000 : 800 * (attempt + 1));
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (attempt >= retries) throw err;
        await sleep(600 * (attempt + 1));
      } finally {
        clearTimeout(timer);
      }
    }
  });
}

export function getJson(key, url, opts = {}) {
  return request(key, url, { accept: "application/json", read: (r) => r.json(), ...opts });
}

export function getText(key, url, opts = {}) {
  return request(key, url, { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", read: (r) => r.text(), ...opts });
}
