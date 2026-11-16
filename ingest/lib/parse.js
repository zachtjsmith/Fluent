/* ============================================================================
   parse.js — pulls facts out of a posting's own text.

   The rule for everything here: report only what the employer wrote. A pay
   range, a tool or an audience appears on the board only when the posting
   states it. Nothing is estimated and nothing is inferred from context.
   ========================================================================== */

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", bull: "•", middot: "·" };

export function decodeEntities(s) {
  let out = String(s || "");
  // Greenhouse escapes its HTML, sometimes twice, so decode until stable.
  for (let i = 0; i < 3; i++) {
    const next = out
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&([a-z]+);/gi, (m, n) => (NAMED[n.toLowerCase()] !== undefined ? NAMED[n.toLowerCase()] : m));
    if (next === out) break;
    out = next;
  }
  return out;
}

/* HTML -> plain text, one block per line, list items marked with "• ". */
export function htmlToText(html) {
  let h = decodeEntities(html);
  if (!/<[a-z][\s\S]*>/i.test(h)) return h.replace(/\r/g, "").trim();
  h = h
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|section|article|header|footer)>/gi, "\n")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<h[1-6][^>]*>/gi, "\n## ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(h)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/* --- pay -------------------------------------------------------------------
   Looks for an annual USD range such as "$130,000 - $160,000" or "$130K–$160K".
   Hourly rates, single figures and funding amounts are ignored.             */

const NUM = String.raw`(\d{2,3}(?:,\d{3})+|\d{2,3}(?:\.\d)?\s?[kK]|\d{5,6})(?:\.\d{2})?`;
// The first figure may be bare ("$130-160K"): it borrows the K from the second.
const RANGE = new RegExp(String.raw`(?:USD\s?)?\$?\s?(?:${NUM}|(\d{2,3}))\s*(?:USD)?\s*(?:-|–|—|to|and)\s*(?:USD\s?)?\$?\s?${NUM}`, "g");

const toNumber = (s) => {
  const t = s.replace(/[, ]/g, "");
  return /k$/i.test(t) ? Math.round(parseFloat(t) * 1000) : Math.round(parseFloat(t));
};

export function parsePay(text) {
  const t = String(text || "");
  let m;
  RANGE.lastIndex = 0;
  while ((m = RANGE.exec(t))) {
    const raw = m[0];
    if (!/\$|USD/i.test(raw) && !/\$|USD|salary|base|compensation|pay range/i.test(t.slice(Math.max(0, m.index - 80), m.index + raw.length + 12))) continue;
    const around = t.slice(Math.max(0, m.index - 60), m.index + raw.length + 40).toLowerCase();
    if (/per hour|\/ ?hr|\/ ?hour|hourly|an hour|per day|daily rate|per month|monthly/.test(around)) continue;
    if (/raised|funding|revenue|valuation|arr\b|customers|series [a-f]\b|employees|budget|quota/.test(around.slice(0, 60 + raw.length))) continue;
    if (/\b(cad|c\$|gbp|£|eur|€|aud|sgd|inr|₹)\b/.test(around)) continue;
    let min = toNumber(m[1] || m[2]);
    const max = toNumber(m[3]);
    if (!m[1]) {
      if (!/k$/i.test(m[3].trim())) continue; // a bare first figure needs a K on the second
      min *= 1000;
    }
    if (min < 30000 || max > 1500000 || max < min || max > min * 4) continue;
    const after = t.slice(m.index + raw.length, m.index + raw.length + 140).toLowerCase();
    const before = t.slice(Math.max(0, m.index - 80), m.index).toLowerCase();
    let extra = "";
    if (/\bote\b|on-target earnings/.test(before + after.slice(0, 40))) extra = "OTE";
    else if (/bonus/.test(after) && /equity|stock|rsu/.test(after)) extra = "+ bonus and equity";
    else if (/bonus|variable/.test(after)) extra = "+ bonus";
    else if (/equity|stock|rsu/.test(after)) extra = "+ equity";
    return { min, max, extra };
  }
  return null;
}

/* --- excerpts --------------------------------------------------------------
   A short summary plus up to two bullet lists taken from the posting: what the
   job involves and what the employer asks for.                              */

const DO_HINTS = /what you('|’)?ll do|what you will do|responsibilit|the role|in this role|your impact|what you('|’)?ll be doing|day[- ]to[- ]day|you will|key duties|the work|what you('|’)?ll own|accountabilities/i;
const WANT_HINTS = /requirement|qualification|what you bring|what we('|’)?re looking for|who you are|about you|you have|you('|’)?ll need|must have|experience|skills|what you('|’)?ll bring|ideal candidate/i;
const SKIP_HINTS = /benefit|perks|compensation|equal opportunity|eeo|about us|about the company|our values|why join|what we offer|diversity|accommodation|privacy|disclaimer|how to apply|interview process|pay transparency|nice to have|bonus points/i;
const BOILERPLATE = /equal opportunity|regardless of race|reasonable accommodation|e-verify|background check|privacy policy|sponsorship|recruitment fraud|we do not accept unsolicited/i;

const clip = (s, n) => (s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, "") + "…");

export function extractDetail(html) {
  const lines = htmlToText(html).split("\n");
  const sections = [];
  let current = null;
  const paragraphs = [];
  for (const line of lines) {
    const isBullet = line.startsWith("• ");
    const isHeading = line.startsWith("## ") || (!isBullet && line.length <= 70 && (/:$/.test(line) || /^[A-Z0-9 &'’/,-]{6,}$/.test(line)));
    if (isHeading) {
      current = { heading: line.replace(/^## /, "").replace(/:$/, "").trim(), items: [] };
      sections.push(current);
    } else if (isBullet) {
      if (!current) { current = { heading: "", items: [] }; sections.push(current); }
      const item = line.slice(2).trim();
      if (item.length >= 12 && !BOILERPLATE.test(item)) current.items.push(clip(item, 220));
    } else if (line.length >= 60 && !BOILERPLATE.test(line)) {
      paragraphs.push({ text: line, heading: current ? current.heading : "" });
    }
  }

  const pickList = (hint) => {
    const s = sections.find((x) => x.items.length >= 2 && hint.test(x.heading) && !SKIP_HINTS.test(x.heading));
    return s ? s.items.slice(0, 6) : [];
  };
  let does = pickList(DO_HINTS);
  let wants = pickList(WANT_HINTS);
  if (!does.length && !wants.length) {
    // No recognisable headings: fall back to the first real list.
    const first = sections.find((x) => x.items.length >= 3 && !SKIP_HINTS.test(x.heading));
    if (first) does = first.items.slice(0, 6);
  }
  if (does.length && wants.length && does[0] === wants[0]) wants = [];

  const roleLine = paragraphs.find((p) => /\b(this role|the role|you will|you'll|you’ll|we are (looking|hiring|seeking)|we're (looking|hiring)|we’re (looking|hiring)|as (a|an|our) )/i.test(p.text) && !SKIP_HINTS.test(p.heading));
  const lead = roleLine || paragraphs.find((p) => !SKIP_HINTS.test(p.heading));
  const summary = lead ? clip(lead.text, 520) : "";
  return { summary, does, wants };
}

/* --- tools -----------------------------------------------------------------
   AI tools the posting names. A company is never tagged with its own product. */

const TOOLS = [
  ["Claude Code", /\bclaude code\b/i], ["Claude", /\bclaude\b(?! code)/i], ["ChatGPT", /\bchatgpt\b/i],
  ["Microsoft Copilot", /\b(microsoft|m365|office 365) copilot\b|\bcopilot studio\b/i], ["GitHub Copilot", /\bgithub copilot\b/i],
  ["Gemini", /\b(google )?gemini\b/i], ["Glean", /\bglean\b/i], ["Cursor", /\bCursor\b/],
  ["NotebookLM", /\bnotebooklm\b/i], ["Perplexity", /\bperplexity\b/i], ["Zapier", /\bzapier\b/i], ["n8n", /\bn8n\b/i],
  ["Make", /\bmake\.com\b/i], ["Notion AI", /\bnotion ai\b/i], ["Agentforce", /\bagentforce\b/i], ["Writer", /\bWRITER\b/],
  ["Amazon Q", /\bamazon q\b/i], ["Vertex AI", /\bvertex ai\b/i], ["Azure OpenAI", /\bazure openai\b/i], ["Codex", /\bcodex\b/i],
];

export function findTools(text, company = "") {
  const t = String(text || "");
  const own = String(company).toLowerCase();
  const found = [];
  for (const [name, re] of TOOLS) {
    if (!re.test(t)) continue;
    const first = name.split(" ")[0].toLowerCase();
    if (own && (own.includes(first) || first.includes(own))) continue;
    if (name === "Claude" && found.includes("Claude Code") && !/\bclaude\b(?! code)/i.test(t)) continue;
    found.push(name);
  }
  return found.slice(0, 6);
}

/* --- audience --------------------------------------------------------------
   Whether the role serves the company's own staff or its customers. Reported
   only when the posting says so in plain words, and never when it says both. */

export function findAudience(text) {
  const t = String(text || "").toLowerCase();
  const internal = /\b(internal (ai|teams|employees|adoption|enablement|stakeholders)|our (employees|workforce|own teams)|across the (company|organization|organisation|business)|company-wide|employee adoption)\b/.test(t);
  const customer = /\b(customer-facing|client-facing|our (customers|clients)|for (customers|clients)|customer deployments?|with (customers|clients))\b/.test(t);
  if (internal && !customer) return "Internal";
  if (customer && !internal) return "Customer-facing";
  return "";
}
