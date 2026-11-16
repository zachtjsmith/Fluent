/* ============================================================================
   adapters.js — one small reader per hiring system.

   Each adapter reads an employer's public job board and returns postings in
   one common "raw" shape. Classifying, parsing pay and checking locations all
   happen later in lib/normalize.js, so adapters stay simple and are easy to
   fix when a vendor changes its JSON.

   Raw shape:
     { ats, token, externalId, title, department, locations: [string],
       remoteFlag, workplace, html, postedAt, url, applyUrl, pay, companyName }

   Greenhouse is read title-first: the job list is small, and the full posting
   is fetched only for titles that could end up on the board. A company with
   300 engineering roles costs one light request, not 300 heavy ones.
   ========================================================================== */

import { getJson } from "./lib/http.js";
import { maybeRelevant } from "./lib/classify.js";

/* Overridable so the pipeline can be tested against the local fixture server.
   Leave unset in normal use: these defaults are the real public endpoints. */
const BASE = {
  greenhouse: process.env.ATS_BASE_GREENHOUSE || "https://boards-api.greenhouse.io",
  lever: process.env.ATS_BASE_LEVER || "https://api.lever.co",
  ashby: process.env.ATS_BASE_ASHBY || "https://api.ashbyhq.com",
  workable: process.env.ATS_BASE_WORKABLE || "https://apply.workable.com",
};

const uniq = (list) => [...new Set(list.map((s) => String(s || "").trim()).filter(Boolean))];

/* --- Greenhouse ------------------------------------------------------------
   List:   /v1/boards/{token}/jobs
   Detail: /v1/boards/{token}/jobs/{id}?pay_transparency=true
   `content` is HTML-entity-escaped HTML. Pay is structured only on some
   boards (pay_input_ranges); otherwise it has to be read from the body.     */

export async function greenhouse(board) {
  const t = encodeURIComponent(board.token);
  const list = await getJson("greenhouse", `${BASE.greenhouse}/v1/boards/${t}/jobs`);
  const wanted = (list?.jobs || []).filter((j) => maybeRelevant(j.title));
  if (!wanted.length) return [];
  let companyName = null;
  try { companyName = (await getJson("greenhouse", `${BASE.greenhouse}/v1/boards/${t}`))?.name || null; } catch { /* name is optional */ }
  const out = [];
  for (const j of wanted) {
    let d = j;
    try { d = await getJson("greenhouse", `${BASE.greenhouse}/v1/boards/${t}/jobs/${j.id}?pay_transparency=true`); } catch { /* keep the list record */ }
    const range = (d.pay_input_ranges || []).find((r) => r.min_cents || r.max_cents);
    out.push({
      ats: "greenhouse", token: board.token, externalId: String(j.id), title: d.title || j.title || "",
      department: (d.departments || []).map((x) => x.name).join(", "),
      locations: uniq(String(d.location?.name || "").split(/\s*;\s*/)),
      remoteFlag: /remote/i.test(d.location?.name || "") ? true : null, workplace: "",
      html: d.content || "", postedAt: d.first_published || j.first_published || d.updated_at || j.updated_at || null,
      url: d.absolute_url || j.absolute_url, applyUrl: d.absolute_url || j.absolute_url,
      pay: range && (range.currency_type || "USD") === "USD" ? { min: Math.round((range.min_cents || 0) / 100), max: Math.round((range.max_cents || 0) / 100), extra: "" } : null,
      companyName,
    });
  }
  return out;
}

/* --- Lever -----------------------------------------------------------------
   /v0/postings/{token}?mode=json returns everything in one call, with a
   structured salaryRange on many accounts and tidy `lists` for the bullets. */

export async function lever(board) {
  const data = await getJson("lever", `${BASE.lever}/v0/postings/${encodeURIComponent(board.token)}?mode=json`);
  return (Array.isArray(data) ? data : []).filter((p) => maybeRelevant(p.text)).map((p) => {
    const lists = (p.lists || []).map((l) => `<h3>${l.text || ""}</h3><ul>${l.content || ""}</ul>`).join("");
    const sr = p.salaryRange;
    return {
      ats: "lever", token: board.token, externalId: String(p.id), title: p.text || "",
      department: [p.categories?.department, p.categories?.team].filter(Boolean).join(", "),
      locations: uniq(p.categories?.allLocations?.length ? p.categories.allLocations : [p.categories?.location]),
      remoteFlag: p.workplaceType === "remote" ? true : null, workplace: p.workplaceType || "",
      html: `${p.description || ""}${lists}${p.additional || ""}`,
      postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
      url: p.hostedUrl, applyUrl: p.applyUrl || p.hostedUrl,
      pay: sr && sr.currency === "USD" && /year|annual/i.test(sr.interval || "") && sr.min && sr.max ? { min: sr.min, max: sr.max, extra: "" } : null,
      companyName: null,
    };
  });
}

/* --- Ashby -----------------------------------------------------------------
   /posting-api/job-board/{token}?includeCompensation=true                   */

export async function ashby(board) {
  const data = await getJson("ashby", `${BASE.ashby}/posting-api/job-board/${encodeURIComponent(board.token)}?includeCompensation=true`);
  return (data?.jobs || []).filter((j) => j.isListed !== false && maybeRelevant(j.title)).map((j) => {
    const salary = (j.compensation?.summaryComponents || []).find((c) => c.compensationType === "Salary" && c.currencyCode === "USD" && /year/i.test(c.interval || "") && c.minValue && c.maxValue);
    const country = j.address?.postalAddress?.addressCountry || "";
    const withCountry = (loc) => (country && loc && !new RegExp(country, "i").test(loc) ? `${loc}, ${country}` : loc);
    return {
      ats: "ashby", token: board.token, externalId: String(j.id), title: j.title || "",
      department: [j.department, j.team].filter(Boolean).join(", "),
      locations: uniq([withCountry(j.location), ...(j.secondaryLocations || []).map((s) => s.location)]),
      remoteFlag: j.isRemote === true ? true : null, workplace: j.workplaceType || "",
      html: j.descriptionHtml || j.descriptionPlain || "", postedAt: j.publishedAt || null,
      url: j.jobUrl, applyUrl: j.applyUrl || j.jobUrl,
      pay: salary ? { min: salary.minValue, max: salary.maxValue, extra: (j.compensation.summaryComponents || []).some((c) => /equity/i.test(c.compensationType || "")) ? "+ equity" : "" } : null,
      companyName: null,
    };
  });
}

/* --- Workable --------------------------------------------------------------
   /api/v1/widget/accounts/{token}?details=true                              */

export async function workable(board) {
  const data = await getJson("workable", `${BASE.workable}/api/v1/widget/accounts/${encodeURIComponent(board.token)}?details=true`);
  return (data?.jobs || []).filter((j) => maybeRelevant(j.title)).map((j) => ({
    ats: "workable", token: board.token, externalId: String(j.shortcode || j.id), title: j.title || "",
    department: j.department || "",
    locations: uniq([[j.city, j.state, j.country].filter(Boolean).join(", ")]),
    remoteFlag: j.telecommuting === true ? true : null, workplace: j.telecommuting ? "remote" : "",
    html: j.description || "", postedAt: j.published_on || j.created_at || null,
    url: j.url || j.shortlink, applyUrl: j.application_url || j.url || j.shortlink,
    pay: null, companyName: data?.name || null,
  }));
}

export const ADAPTERS = { greenhouse, lever, ashby, workable };
