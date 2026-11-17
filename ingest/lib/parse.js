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
    // A block that is nothing but bold text is a heading: "<p><b>Responsibilities</b></p>".
    .replace(/<(p|div|span)\b[^>]*>\s*(?:<(?:b|strong|u)\b[^>]*>\s*)+([^<]{2,90}?)\s*(?:<\/(?:b|strong|u)>\s*)+:?\s*<\/\1>/gi, "\n<h4>$2</h4>\n")
    // So is a bold line that ends at a line break: "<b>Requirements:</b><br>".
    .replace(/<(b|strong)\b[^>]*>([^<.]{2,80})<\/\1>\s*:?\s*(?=<br\s*\/?>)/gi, "\n<h4>$2</h4>\n")
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
   An overview of the role plus up to two bullet lists, all in the posting's
   own words: what the job involves and what the employer asks for.

   The overview is chosen, never written. It is made of the posting's own
   sentences that describe the role, preferring a section headed like "About
   the role" or a paragraph that says "you will" or "this role", and leaving
   out greetings, office logistics, pay, legal text and the company's
   history.                                                                  */

const DO_HINTS = /what you('|’)?ll do|what you will do|responsibilit|the role|in this role|your impact|what you('|’)?ll be doing|day[- ]to[- ]day|you will|key duties|duties|the work|what you('|’)?ll own|accountabilities|essential functions/i;
const WANT_HINTS = /requirement|qualification|what you bring|what we('|’)?re looking for|who you are|about you|you have|you('|’)?ll need|must have|experience|skills|what you('|’)?ll bring|ideal candidate/i;
const SKIP_HINTS = /benefit|perks|compensation|equal opportunity|eeo|about us|about the company|our values|why join|what we offer|diversity|accommodation|privacy|disclaimer|how to apply|interview process|pay transparency|nice to have|bonus points|salary|pay range|total rewards/i;
const BOILERPLATE = /equal opportunity|regardless of race|reasonable accommodation|e-verify|background check|privacy policy|sponsorship|recruitment fraud|we do not accept unsolicited|protected veteran|affirmative action|drug[- ]free|at-will/i;
const KNOWN_HEADING = /^(about (the |this )?(role|position|job|opportunity|team|company|us)|the (role|position|opportunity|team)|role (overview|summary|description)|position (overview|summary|description|purpose)|job (overview|summary|description|purpose)|overview|summary|description|your role|(key )?responsibilities|essential (duties|functions)( and responsibilities)?|duties( and responsibilities)?|what you('|’)?ll do|what you will do|what you('|’)?ll be doing|(basic |minimum |required |preferred )?qualifications|requirements|what we('|’)?re looking for|what you bring|what you('|’)?ll bring|who you are|about you|benefits|perks|compensation|nice to have|bonus points)$/i;

const ROLE_HEADING = /\b(role|position|job|overview|summary|opportunity|what you('|’)?ll do|what you will do|your impact|description|responsibilit)/i;
const isCompanyHeading = (h) => /^(about\b|who we are|our (company|mission|story|culture|values)|company (overview|description|summary|information)|why (join|work)|life at|the company)/i.test(h) && !/\b(role|position|job|opportunity|you|team)\b/i.test(h);
const ROLE_WORDS = /\b(this role|the role|this position|the position|in this (role|position|job)|you will|you('|’)ll|you would|as (a|an|the|our) |we are (looking|hiring|seeking)|we('|’)re (looking|hiring|seeking)|(is|are) (looking|hiring|seeking) (for|a|an)|is seeking|seeks|responsible for|will (lead|own|drive|partner|work|be responsible|support|help|manage|serve|report|design|build|run|guide|oversee|develop|deliver))\b/i;
const GREETING = /^(hey|hi|hello|greetings|howdy|welcome)\b/i;
const NOTE = /^(please note|note\b|important\b|location\b|work location|schedule\b|shift\b|travel\b|reports? to\b|job (title|type|id|code)\b|requisition\b|department\b|salary\b|pay\b|position type\b)/i;
const LOGISTICS = /\b(\d|one|two|three|four|five)\s*(days?|x)\s*(\/|a|per|each)\s*week\b|\bon-?site (in|at)\b|\bin[- ]office\b|\brelocat|\bvisa\b|\bcommut|\btime ?zones?\b|\bworking hours\b/i;
const MONEY = /\$\s?\d|\b(salary|compensation|pay range|base pay|401\s?\(?k\)?|paid time off|pto|health insurance|medical, dental|benefits package|bonus|incentive (program|plan|compensation)|eligible (to participate|for (a|an|the) (bonus|incentive|benefits|annual)))\b/i;
// A first sentence that only points back at something earlier ("That question is this seat.").
const DANGLING = /^(that|this|these|those|it|they|which|such)\b/i;
const COMPANY_INTRO = /\b(founded in|headquartered|is a leading|we are a leading|is the leading|the world('|’)?s (leading|largest)|fortune \d+|our mission is|backed by|series [a-f]\b|publicly traded|award-winning|trusted by|serving (more than|over)|offices in|since \d{4})\b/i;
const TITLE_STOP = new Set(["senior", "junior", "lead", "manager", "director", "head", "principal", "staff", "associate", "chief", "officer", "the", "and", "for", "global", "remote", "hybrid", "usa", "intern", "specialist"]);

const clip = (s, n) => (s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, "") + "…");

/* Splits text into sentences, without breaking "U.S." or "e.g.". */
export function toSentences(text) {
  return String(text || "").replace(/\s+/g, " ").trim()
    .replace(/(?<!\b(?:e\.g|i\.e|U\.S|U\.K|Inc|Corp|Co|Ltd|Jr|Sr|Mr|Mrs|Ms|Dr|St|No|vs|etc|approx))([.!?]["”’)]?)\s+(?=[A-Z0-9“"‘'(])/g, "$1\u0000")
    .split("\u0000").map((x) => x.trim()).filter(Boolean);
}

function scoreParagraph(p, words) {
  const t = p.text, h = p.heading || "";
  let s = 0;
  if (h && isCompanyHeading(h)) s -= 4;
  else if (h && ROLE_HEADING.test(h)) s += 4;
  if (h && SKIP_HINTS.test(h)) s -= 6;
  if (ROLE_WORDS.test(t)) s += 3;
  const lower = t.toLowerCase();
  if (words.some((w) => lower.includes(w))) s += 1;
  if (COMPANY_INTRO.test(t)) s -= 2;
  if (GREETING.test(t) || NOTE.test(t)) s -= 5;
  if (MONEY.test(t) && !ROLE_WORDS.test(t)) s -= 4;
  return s;
}

function overview(paragraphs, title, lists) {
  const words = String(title || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 3 && !TITLE_STOP.has(w));
  const scored = paragraphs.map((p, i) => ({ ...p, i, score: scoreParagraph(p, words) }));
  const ranked = scored.filter((p) => p.score > -4).sort((a, b) => b.score - a.score || a.i - b.i);
  const picked = [];
  let length = 0;
  const take = (p) => {
    for (let sentence of toSentences(p.text)) {
      if (picked.length >= 3 || length >= 300) return;
      // "About the role: We are looking for..." keeps only the sentence.
      sentence = sentence.replace(/^[A-Z][\w’'&/ -]{2,40}:\s+(?=[A-Z])/, "");
      if (sentence.length < 25 || BOILERPLATE.test(sentence) || NOTE.test(sentence) || GREETING.test(sentence) || MONEY.test(sentence) || LOGISTICS.test(sentence)) continue;
      // A lead-in to a list ("...with the grit to:") is not an overview.
      if (/:$/.test(sentence)) continue;
      if (!picked.length && DANGLING.test(sentence) && sentence.length < 60) continue;
      if (picked.includes(sentence)) continue;
      picked.push(sentence);
      length += sentence.length + 1;
    }
  };
  if (ranked.length) {
    const best = ranked[0];
    take(best);
    // A short lead borrows from the next paragraphs that describe the role.
    for (const p of scored.filter((x) => x.i > best.i && x.score >= 1)) { if (length >= 160) break; take(p); }
  }
  if (!picked.length) {
    // No paragraph describes the role: use the posting's own first list items.
    for (const item of lists) {
      if (picked.length >= 2) break;
      picked.push(/[.!?]$/.test(item) ? item : `${item}.`);
    }
  }
  return clip(picked.join(" "), 520);
}

/**
 * extractDetail(html, { title }) -> { summary, does, wants }
 * summary: an overview of the role in the posting's own sentences.
 */
export function extractDetail(html, { title = "" } = {}) {
  const lines = htmlToText(html).split("\n");
  const sections = [];
  let current = null;
  const paragraphs = [];
  for (const line of lines) {
    const isBullet = line.startsWith("• ");
    const bare = line.replace(/^## /, "").replace(/[:.]$/, "").trim();
    const isHeading = line.startsWith("## ") || (!isBullet && line.length <= 70 && (/:$/.test(line) || /^[A-Z0-9 &'’/,-]{6,}$/.test(line) || KNOWN_HEADING.test(bare)));
    if (isHeading) {
      current = { heading: bare, items: [] };
      sections.push(current);
    } else if (isBullet) {
      if (!current) { current = { heading: "", items: [] }; sections.push(current); }
      const item = line.slice(2).trim();
      if (item.length >= 12 && !BOILERPLATE.test(item)) current.items.push(clip(item, 220));
    } else if (line.length >= 40 && !BOILERPLATE.test(line)) {
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

  const anyList = sections.find((x) => x.items.length && !SKIP_HINTS.test(x.heading))?.items || [];
  const summary = overview(paragraphs, title, does.length ? does : wants.length ? wants : anyList);
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
