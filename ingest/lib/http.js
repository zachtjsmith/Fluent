/* ============================================================================
   http.js — polite HTTP for the collector.

   - Identifies itself with a contact address, so an employer or a hiring
     system that wants us to stop can say so.
   - Each hiring system gets its own small concurrency limit.
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

// Simultaneous requests allowed per vendor. Small on purpose.
const LIMITS = { greenhouse: 4, lever: 3, ashby: 3, workable: 2 };
const gates = {};
const gate = (vendor) => (gates[vendor] ||= semaphore(LIMITS[vendor] || 2));

export async function getJson(vendor, url, { timeout = 20000, retries = 2 } = {}) {
  return gate(vendor)(async () => {
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctrl.signal });
        if (res.ok) return await res.json();
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
