/* ============================================================================
   details.js — reads the full posting for a listing that arrived without one.

   Every listing on the board shows an overview taken from its own job
   description. Listings from the open dataset, or from a board that could
   not be polled, arrive with a title and a link only, so their description
   is read here, one posting at a time. A listing whose description cannot
   be read is left off the board (see build.js).

   Each posting is read the way its own job page reads it:
     Greenhouse  /v1/boards/{board}/jobs/{id}                public job board API
     Lever       /v0/postings/{board}/{id}                   public postings API
     Ashby       /posting-api/job-board/{board}              public job board API
     Workable    /api/v2/accounts/{board}/jobs/{code}        public jobs API
     Workday     /wday/cxs/{tenant}/{site}/job/...           the data behind every Workday job page
     BambooHR    /careers/{id}/detail                        the data behind every BambooHR job page
   Anything else (Paylocity, JOIN, iCIMS, an employer's own site), and any of
   the above that fails, is read from the job page itself: job pages publish
   their description for search engines as schema.org JobPosting data.

   Returns { html, pay, employmentType, via } or null.
   ========================================================================== */

import { getJson, getText, siteKey } from "./lib/http.js";
import { BASE, ashbyBoard, ashbyRaw } from "./adapters.js";
import { htmlToText } from "./lib/parse.js";

const enc = encodeURIComponent;
const pathParts = (url) => { try { return new URL(url).pathname.split("/").filter(Boolean); } catch { return []; } };
const hostOf = (url) => { try { return new URL(url).host.toLowerCase(); } catch { return ""; } };

/* A description is worth showing when it says more than a sentence or two. */
export const usable = (d) => Boolean(d && htmlToText(d.html || "").length >= 150);

/* --- Greenhouse ----------------------------------------------------------- */

async function greenhouse(raw) {
  const id = /[?&]gh_jid=(\d+)/.exec(raw.url)?.[1] || /\/jobs\/(\d+)/.exec(raw.url)?.[1];
  if (!id || !raw.token) return null;
  const base = /\.eu\.greenhouse\.io$/.test(hostOf(raw.url)) ? "https://boards-api.eu.greenhouse.io" : BASE.greenhouse;
  const d = await getJson("greenhouse", `${base}/v1/boards/${enc(raw.token)}/jobs/${id}?pay_transparency=true`);
  const range = (d.pay_input_ranges || []).find((r) => r.min_cents || r.max_cents);
  return {
    html: d.content || "",
    pay: range && (range.currency_type || "USD") === "USD" ? { min: Math.round((range.min_cents || 0) / 100), max: Math.round((range.max_cents || 0) / 100), extra: "" } : null,
    via: "greenhouse",
  };
}

/* --- Lever ---------------------------------------------------------------- */

async function lever(raw) {
  const id = pathParts(raw.url).find((p) => /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(p));
  if (!id || !raw.token) return null;
  const base = /\.eu\.lever\.co$/.test(hostOf(raw.url)) ? "https://api.eu.lever.co" : BASE.lever;
  const p = await getJson("lever", `${base}/v0/postings/${enc(raw.token)}/${id}`);
  const lists = (p.lists || []).map((l) => `<h3>${l.text || ""}</h3><ul>${l.content || ""}</ul>`).join("");
  const sr = p.salaryRange;
  return {
    html: `${p.description || ""}${lists}${p.additional || ""}`,
    pay: sr && sr.currency === "USD" && /year|annual/i.test(sr.interval || "") && sr.min && sr.max ? { min: sr.min, max: sr.max, extra: "" } : null,
    employmentType: p.categories?.commitment || "",
    via: "lever",
  };
}

/* --- Ashby: the board is read once per run and the posting found in it. --- */

async function ashby(raw) {
  const id = pathParts(raw.url).find((p) => /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(p)) || pathParts(raw.url)[1];
  if (!id || !raw.token) return null;
  const data = await ashbyBoard(raw.token);
  const j = (data?.jobs || []).find((x) => String(x.id) === id);
  if (!j) return null;
  const r = ashbyRaw({ token: raw.token }, j);
  return { html: r.html, pay: r.pay, employmentType: r.employmentType, via: "ashby" };
}

/* --- Workable ------------------------------------------------------------- */

async function workable(raw) {
  const code = /\/j\/([A-Za-z0-9]+)/.exec(raw.url)?.[1];
  if (!code || !raw.token) return null;
  const j = await getJson("workable", `${BASE.workable}/api/v2/accounts/${enc(raw.token)}/jobs/${code}`);
  return {
    html: [j.description, j.requirements && `<h3>Requirements</h3>${j.requirements}`, j.benefits && `<h3>Benefits</h3>${j.benefits}`].filter(Boolean).join(""),
    employmentType: j.type || j.employment_type || "",
    via: "workable",
  };
}

/* --- Workday ---------------------------------------------------------------
   Job page: https://{tenant}.wd{N}.myworkdayjobs.com[/{locale}]/{site}/job/{place}/{title}_{id}
   Its data: https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/job/{place}/{title}_{id} */

export function workdayDataUrl(postingUrl) {
  let u;
  try { u = new URL(postingUrl); } catch { return null; }
  const m = /^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/i.exec(u.host);
  if (!m) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  let i = /^[a-z]{2}-[a-z]{2}$/i.test(parts[0] || "") ? 1 : 0;
  const site = parts[i];
  const rest = parts.slice(i + 1);
  if (!site || rest.length < 2) return null;
  if (rest[0] === "details") rest[0] = "job";
  if (rest[0] !== "job") return null;
  return `https://${u.host}/wday/cxs/${m[1].toLowerCase()}/${site}/${rest.join("/")}`;
}

async function workday(raw) {
  const url = workdayDataUrl(raw.url);
  if (!url) return null;
  const data = await getJson(siteKey(url), url);
  const info = data?.jobPostingInfo;
  if (!info?.jobDescription) return null;
  return { html: info.jobDescription, employmentType: info.timeType || "", via: "workday" };
}

/* --- BambooHR --------------------------------------------------------------
   Job page: https://{company}.bamboohr.com/careers/{id}   (or /jobs/view.php?id={id})
   Its data: https://{company}.bamboohr.com/careers/{id}/detail                    */

export function bamboohrDataUrl(postingUrl) {
  let u;
  try { u = new URL(postingUrl); } catch { return null; }
  if (!/\.bamboohr\.com$/i.test(u.host)) return null;
  const id = /\/careers\/(\d+)/.exec(u.pathname)?.[1] || u.searchParams.get("id");
  return id && /^\d+$/.test(id) ? `https://${u.host}/careers/${id}/detail` : null;
}

async function bamboohr(raw) {
  const url = bamboohrDataUrl(raw.url);
  if (!url) return null;
  const data = await getJson(siteKey(url), url);
  const job = data?.result?.jobOpening;
  if (!job?.description) return null;
  // The employer's own pay field, when filled in, is shown as written.
  const comp = typeof job.compensation === "string" && job.compensation.trim() ? `<p>Compensation: ${job.compensation.trim()}</p>` : "";
  return { html: `${job.description}${comp}`, employmentType: job.employmentStatusLabel || "", via: "bamboohr" };
}

/* --- Any job page: schema.org JobPosting, or the page's own data ---------- */

const parseLoose = (text) => {
  try { return JSON.parse(text); } catch { /* fall through */ }
  // Some pages put raw line breaks inside their JSON strings.
  try { return JSON.parse(text.replace(/[\u0000-\u001f]+/g, " ")); } catch { return null; }
};

function findJobPosting(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) { const f = findJobPosting(n, depth + 1); if (f) return f; }
    return null;
  }
  const type = node["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return node;
  for (const k of ["@graph", "mainEntity", "itemListElement"]) {
    const f = findJobPosting(node[k], depth + 1);
    if (f) return f;
  }
  return null;
}

function payFromBaseSalary(bs) {
  const b = Array.isArray(bs) ? bs[0] : bs;
  if (!b || typeof b !== "object") return null;
  const currency = String(b.currency || b.value?.currency || "").toUpperCase();
  const v = b.value || {};
  const unit = String(v.unitText || b.unitText || "").toUpperCase();
  const min = Number(v.minValue ?? v.value), max = Number(v.maxValue ?? v.value);
  if (currency && currency !== "USD") return null;
  if (unit && unit !== "YEAR") return null;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0) return null;
  return { min: Math.round(min), max: Math.round(max), extra: "" };
}

/* The longest "description"-like text anywhere in some data. */
function longestDescription(node, depth = 0, best = "") {
  if (!node || typeof node !== "object" || depth > 12) return best;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === "string") {
      if (/^(description|jobDescription|descriptionHtml|job_description|content)$/i.test(k) && v.length > best.length) best = v;
    } else if (v && typeof v === "object") {
      best = longestDescription(v, depth + 1, best);
    }
  }
  return best;
}

export function jobPostingFromHtml(html) {
  const page = String(html || "");
  // 1. schema.org JobPosting, which job pages publish for search engines.
  for (const m of page.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const posting = findJobPosting(parseLoose(m[1].trim()));
    if (posting?.description) {
      const type = Array.isArray(posting.employmentType) ? posting.employmentType.join(",") : String(posting.employmentType || "");
      return { html: String(posting.description), pay: payFromBaseSalary(posting.baseSalary), employmentType: type, via: "job page (schema.org)" };
    }
  }
  // 2. The page's own data (Next.js sites such as JOIN).
  const next = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(page);
  if (next) {
    const text = longestDescription(parseLoose(next[1]));
    if (text.length >= 150) return { html: text, via: "job page (page data)" };
  }
  // 3. A description field in any data written into the page.
  let best = "";
  for (const m of page.matchAll(/"(?:description|jobDescription|JobDescription|Description|descriptionHtml)"\s*:\s*("(?:\\.|[^"\\]){150,}")/g)) {
    try { const text = JSON.parse(m[1]); if (text.length > best.length) best = text; } catch { /* not JSON */ }
  }
  if (best) return { html: best, via: "job page (page data)" };
  return null;
}

async function jobPage(raw) {
  const html = await getText(siteKey(raw.url), raw.url);
  return jobPostingFromHtml(html);
}

/* --- the reader -------------------------------------------------------------- */

const READERS = { greenhouse, lever, ashby, workable, workday, bamboohr };

/**
 * fetchDetail(raw) -> { html, pay, employmentType, via } | null
 * Tries the hiring system's own data first, then the job page. When nothing
 * works, the reasons are left on raw.detailError for the run log.
 */
export async function fetchDetail(raw) {
  const why = [];
  const reader = READERS[raw.ats];
  if (reader) {
    try {
      const d = await reader(raw);
      if (usable(d)) return d;
      why.push(`${raw.ats}: ${d ? "description too short" : "no description"}`);
    } catch (err) { why.push(`${raw.ats}: ${err.message}`); }
  }
  try {
    const d = await jobPage(raw);
    if (usable(d)) return d;
    why.push(`job page: ${d ? "description too short" : "no description found"}`);
  } catch (err) { why.push(`job page: ${err.message}`); }
  raw.detailError = why.join("; ");
  return null;
}
