/* ============================================================================
   dedupe.js — one listing per role.

   Employers often post the same role once per city, and the same posting can
   reach us twice (once from the snapshot, once from a direct poll). Listings
   with the same company and title are merged into one, keeping every
   location. The richest copy wins: one with published pay beats one without,
   and one with excerpts beats a bare title.
   ========================================================================== */

// "Exadel" and "Exadel Inc" are the same employer.
const companyKey = (c) => c.toLowerCase().replace(/[,.]?\s+(inc|llc|ltd|limited|corp|corporation|co|plc|gmbh|ab|sa|ag)\.?$/, "").replace(/[^a-z0-9]+/g, "");
const key = (j) => `${companyKey(j.company)}|${j.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
const richness = (j) => (j.min ? 4 : 0) + (j.hasDetail ? 2 : 0) + (j.detail.tools.length ? 1 : 0);

export function dedupe(jobs) {
  const groups = new Map();
  for (const j of jobs) {
    const k = key(j);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(j);
  }
  const out = [];
  for (const group of groups.values()) {
    group.sort((a, b) => richness(b) - richness(a) || String(b.posted || "").localeCompare(String(a.posted || "")));
    const best = { ...group[0], detail: { ...group[0].detail } };
    const seen = new Set();
    best.locations = group.flatMap((j) => j.locations).filter((l) => !seen.has(l.label.toLowerCase()) && seen.add(l.label.toLowerCase()));
    best.mode = best.mode || best.locations.find((l) => l.mode)?.mode || "";
    const dates = group.map((j) => j.posted).filter(Boolean).sort();
    if (dates.length) best.posted = dates[dates.length - 1];
    best.featured = group.some((j) => j.featured);
    out.push(best);
  }
  return out;
}
