/* ============================================================================
   normalize.js — turns one raw posting into a listing, or says why not.

   Every rule the board promises lives here:
     - only titles on the non-engineering side of AI (lib/classify.js)
     - US roles only, and a location that cannot be placed is dropped
     - the Apply link must open the posting itself, never a careers homepage
     - a posting older than 60 days, or with no date at all, is dropped
     - pay, tools and audience appear only when the employer published them
   ========================================================================== */

import crypto from "node:crypto";
import { classify, fieldOf, SKIP_BOARDS } from "./classify.js";
import { readLocation } from "./geo.js";
import { htmlToText, parsePay, extractDetail, findTools, findAudience } from "./parse.js";
import { companyName } from "../companies.js";

export const DROP = {
  STAFFING: "staffing or gig board",
  GEO: "outside the US",
  GEO_UNCLEAR: "location could not be placed",
  LINK: "apply link is not a posting",
  STALE: "older than 60 days",
  NO_DATE: "no posting date",
  INTERNAL: "internal-only careers site",
  NO_SALARY: "no published salary (strict mode)",
};

const INTERNAL_SITE = /myworkdayjobs\.com\/(?:[a-z]{2}-[a-z]{2}\/)?[^/]*(internal|redeploy|employee|alumni)[^/]*\//i;

export const SOURCE_LABEL = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workable: "Workable", workday: "Workday", icims: "iCIMS", bamboohr: "BambooHR", paylocity: "Paylocity", join: "JOIN", direct: "Direct" };

const FOREIGN_IN_TITLE = /\b(emea|apac|latam|anz|uk|canada|australia|india|germany|france|japan|korea|singapore|mexico|brazil|europe|ireland|netherlands|spain|italy|israel|china|philippines|scotland|london|toronto|sydney|dubai|monterrey|tokyo|berlin|paris)\b/i;

/* A posting link must have a real path: a board's front page is not a job. */
export function isDeepLink(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return false;
  if (/[?&](gh_jid|jobId|job_id|jid|lever-origin)=/.test(u.search)) return true;
  if (parts.length === 1) return /\d{3,}|[0-9a-f]{8}-[0-9a-f]{4}/i.test(parts[0]);
  const last = parts[parts.length - 1];
  return !/^(jobs?|careers?|openings|positions|search|all)$/i.test(last);
}

const tidyTitle = (t) => String(t || "").replace(/\s+/g, " ").replace(/\s+([,)])/g, "$1").trim();
const stableId = (raw) => crypto.createHash("sha1").update(`${raw.ats}|${String(raw.token).toLowerCase()}|${raw.externalId || raw.url}`).digest("hex").slice(0, 12);

/**
 * normalize(raw, opts) -> { job } | { drop }
 * opts: { now: Date, maxAgeDays: number, requireSalary: boolean, geoFilter: boolean }
 */
export function normalize(raw, { now = new Date(), maxAgeDays = 60, requireSalary = false, geoFilter = true } = {}) {
  if (raw.recruiter || SKIP_BOARDS.has(String(raw.token || "").toLowerCase())) return { drop: DROP.STAFFING };

  const title = tidyTitle(raw.title);
  const c = classify(title);
  if (c.drop) return { drop: c.drop };

  // Where is it? Keep the US locations; drop the listing if there are none.
  const read = (raw.locations || []).filter(Boolean).map((l) => readLocation(l, { url: raw.url, remoteFlag: raw.remoteFlag, workplace: raw.workplace }));
  if (!read.length) read.push(readLocation("", { url: raw.url, remoteFlag: raw.remoteFlag, workplace: raw.workplace }));
  let places = read;
  if (geoFilter) {
    if (FOREIGN_IN_TITLE.test(title) && !/\b(us|usa|united states|americas|north america)\b/i.test(title)) return { drop: DROP.GEO };
    places = read.filter((l) => l.us === true);
    if (!places.length) return { drop: read.some((l) => l.us === false) ? DROP.GEO : DROP.GEO_UNCLEAR };
  }
  const seen = new Set();
  const locations = places.filter((l) => l.label && !seen.has(l.label.toLowerCase()) && seen.add(l.label.toLowerCase())).map((l) => ({ label: l.label, mode: l.mode }));
  if (!locations.length) return { drop: DROP.GEO_UNCLEAR };
  const mode = locations.find((l) => l.mode)?.mode || "";

  const applyUrl = isDeepLink(raw.applyUrl) ? raw.applyUrl : isDeepLink(raw.url) ? raw.url : null;
  if (!applyUrl) return { drop: DROP.LINK };
  // Some employers run a second careers site for current staff only.
  if (INTERNAL_SITE.test(applyUrl)) return { drop: DROP.INTERNAL };

  // Age. A posting with no readable date cannot be shown to be inside the
  // window, so it is dropped too.
  const d = raw.postedAt ? new Date(raw.postedAt) : null;
  if (!d || Number.isNaN(d.getTime())) return { drop: DROP.NO_DATE };
  if ((now - d) / 864e5 > maxAgeDays) return { drop: DROP.STALE };
  const posted = d.toISOString().slice(0, 10);

  const company = companyName(raw.ats, raw.token, raw.companyName);
  const text = raw.html ? htmlToText(raw.html) : "";
  const pay = raw.pay && raw.pay.min > 0 && raw.pay.max >= raw.pay.min ? raw.pay : parsePay(text);
  if (requireSalary && !pay) return { drop: DROP.NO_SALARY };
  const detail = raw.html ? extractDetail(raw.html) : { summary: "", does: [], wants: [] };

  return {
    job: {
      id: stableId(raw),
      title, company, family: c.family, field: fieldOf(title, company), level: c.level || "",
      locations, mode,
      min: pay ? pay.min : null, max: pay ? pay.max : null, extra: pay ? pay.extra || "" : "",
      posted,
      ats: raw.ats, source: SOURCE_LABEL[raw.ats] || raw.ats, board: String(raw.token || ""),
      featured: false,
      hasDetail: Boolean(detail.summary || detail.does.length || detail.wants.length),
      detail: {
        summary: detail.summary, does: detail.does, wants: detail.wants,
        tools: text ? findTools(text, company) : [],
        audience: text ? findAudience(text) : "",
        applyUrl, postingUrl: isDeepLink(raw.url) ? raw.url : applyUrl,
      },
    },
  };
}
