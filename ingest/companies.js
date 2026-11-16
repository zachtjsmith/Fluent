/* ============================================================================
   companies.js — which boards to read, and what each company is called.

   CURATED: boards polled directly on every run. Each token below was taken
   from a real posting URL (jobs.ashbyhq.com/{token}/…,
   job-boards.greenhouse.io/{token}/…), so it is known to exist. Add a company
   by copying the token from one of its job links.

   Boards the snapshot turns up are polled too; they do not need listing here.

   Company names come from an open list of boards (data/boards/*.csv,
   MIT licence: see data/NOTICE.md). A board that is not on the list falls
   back to a tidied version of its token.
   ========================================================================== */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const CURATED = [
  // Ashby
  ...["openai", "writer", "junipersquare", "legora", "omnea", "eliseai", "forgepoint", "moment", "probook", "retell-ai", "aiuc", "david-ai", "simile", "praecipio", "butterflymx", "raspberry", "owner", "climb-ai", "cresta", "replicant"].map((token) => ({ ats: "ashby", token })),
  // Greenhouse
  ...["doordashusa", "scaleai", "litmos", "chime", "globalizationpartners", "justworks", "thenewyorktimes", "gitlab"].map((token) => ({ ats: "greenhouse", token })),
];

/* Names that the open list gets wrong or does not have. Token -> name. */
const NAME_FIXES = {
  doordashusa: "DoorDash", scaleai: "Scale AI", globalizationpartners: "G-P", thenewyorktimes: "The New York Times",
  "retell-ai": "Retell AI", "david-ai": "David AI", "climb-ai": "Climb", aiuc: "Artificial Intelligence Underwriting Company",
  jj: "Johnson & Johnson", hpe: "Hewlett Packard Enterprise", ucf: "University of Central Florida", capitalone: "Capital One",
  guardianlife: "Guardian Life", roberthalf: "Robert Half", dxctechnology: "DXC Technology", thomsonreuters: "Thomson Reuters",
  accenturefederalservices: "Accenture Federal Services", astrazeneca: "AstraZeneca", paypal: "PayPal", mckesson: "McKesson",
  uipath: "UiPath", netdocuments: "NetDocuments", openai: "OpenAI", writer: "WRITER", eliseai: "EliseAI", junipersquare: "Juniper Square",
  wf: "Wells Fargo", mtb: "M&T Bank", fifththird: "Fifth Third Bank", djeholdings: "Edelman", globalhr: "RTX", alliancedata: "Bread Financial",
  relx: "RELX", tamus: "Texas A&M University System", ncr: "NCR", kla: "KLA", bmo: "BMO", pru: "Prudential", msd: "Merck", ms: "Morgan Stanley",
  livenation: "Live Nation", xcelenergy: "Xcel Energy", washingtonpost: "The Washington Post", jeffersonhealth: "Jefferson Health",
  thermofisher: "Thermo Fisher Scientific", axiscapital: "AXIS Capital", zoominfo: "ZoomInfo", redventures: "Red Ventures", blackrock: "BlackRock",
  troweprice: "T. Rowe Price", gsk: "GSK", wgu: "WGU", n8n: "n8n", project44: "project44",
  fis: "FIS", sec: "Samsung Electronics America", butterflymx: "ButterflyMX", "wealth-com": "Wealth.com", invenergyllc: "Invenergy", orioninnovation: "Orion Innovation",
};

function parseCsvLine(line) {
  const cells = []; let cur = ""; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}

/* "acme-health-inc" -> "Acme Health Inc" */
export function prettify(token) {
  const t = String(token || "").split("/")[0].replace(/[_.]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!t) return "";
  if (/[A-Z ]/.test(t)) return t.trim(); // already a display name
  return t.split("-").map((w) => (w.length <= 3 && !/[aeiou]/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}

let cache = null;
export function loadNames(dir = path.join(HERE, "data", "boards")) {
  if (cache) return cache;
  const names = new Map();
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".csv"))) {
      const ats = file.replace(/\.csv$/, "");
      const lines = fs.readFileSync(path.join(dir, file), "utf8").split(/\r?\n/);
      const head = parseCsvLine(lines[0] || "").map((h) => h.trim().toLowerCase());
      const iName = head.indexOf("name"); const iSlug = head.indexOf("slug");
      if (iName < 0 || iSlug < 0) continue;
      for (const line of lines.slice(1)) {
        if (!line) continue;
        const c = parseCsvLine(line);
        const slug = String(c[iSlug] || "").split("/")[0].toLowerCase();
        const name = String(c[iName] || "").replace(/\s+/g, " ").trim();
        if (slug && name && !names.has(`${ats}:${slug}`)) names.set(`${ats}:${slug}`, name);
      }
    }
  }
  cache = names;
  return names;
}

export function companyName(ats, token, fromPosting = null) {
  const key = String(token || "").toLowerCase();
  if (NAME_FIXES[key]) return NAME_FIXES[key];
  // Board names sometimes carry the careers-site name in brackets
  // ("Pfizer (Internaljobs)", "Exadel Inc (Website)"); that is not part of
  // the employer's name.
  const tidy = (n) => String(n || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (fromPosting && tidy(fromPosting)) return tidy(fromPosting);
  const listed = tidy(loadNames().get(`${ats}:${key}`));
  const name = listed || prettify(token);
  return /^[a-z]/.test(name) && !/\d/.test(name) ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}
