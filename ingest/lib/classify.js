/* ============================================================================
   classify.js — decides whether a job title belongs on the board, and where.

   The board lists the non-engineering side of AI: the people who get AI
   adopted, deployed, governed and run, in any industry. It does not list the
   people who build models. Everything here works from the title alone, so it
   can run on a job list before any description is fetched.

   To widen or narrow the board, change CONFIG. Each switch is one group of
   roles.
   ========================================================================== */

export const CONFIG = {
  governance: true,        // AI governance, risk, compliance and policy (not lawyers)
  automation: true,        // AI operations, workflow and automation, AI program/project managers
  generalists: true,       // "AI Specialist", "AI Lead", "AI Manager" and similar
  aiLeadership: true,      // "Head of AI", "Director of AI", "Chief AI Officer"
  consultants: true,       // AI consultants, advisors and solutions specialists
  aiSuccess: true,         // "AI Success Manager" (not customer success at an AI company)
  forwardDeployedLeads: true, // forward deployed leads and strategists (never engineers)
  productManagers: true,   // AI product managers and product owners (the largest single group)
  entryLevel: true,        // internships, apprenticeships, graduate and junior roles (tagged "Entry level")
  contract: true,          // contract, freelance, temporary and part-time roles (tagged "Contract"); data-labelling gigs stay out
};

export const FAMILIES = [
  "Enablement & Adoption", "Deployment & Solutions", "Strategy & Transformation",
  "Operations & Automation", "Governance & Risk", "AI Leads & Specialists", "Leadership",
  ...(CONFIG.productManagers ? ["Product"] : []),
];

export const LEVELS = ["Entry level", "Contract"];

export const FIELDS = ["Healthcare & Life Sciences", "Financial Services", "Legal", "HR & People", "Education", "Public Sector"];

/* Staffing sites, research panels and data-labelling marketplaces post under
   their own boards. Their listings are reposts or gig work, so the whole
   board is skipped. */
export const SKIP_BOARDS = new Set([
  "agency", "jobgether", "10xteam", "lilt-production", "lilt", "mercor", "outlier", "outlierai",
  "turing", "alignerr", "mindrift", "dataannotation", "invisibletech", "invisible", "toloka",
  "appen", "appen-2", "welocalize", "telusinternational", "telus-digital", "oneforma", "crossover", "braintrust",
  "remotasks", "labelbox", "micro1", "g2i", "toptal", "andela", "supportyourapp", "peroptyx", "terac",
  "lindawernerassociates", "prolific", "lavendo",
]);

/* --- title normalisation -------------------------------------------------- */

export function tokens(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/\bartificial intelligence\b/g, " ai ")
    .replace(/\b(generative ai|gen[\s-]?ai|genai)\b/g, " ai ")
    .replace(/\bagentic(\s+ai)?\b/g, " ai ")
    .replace(/\ba\.i\.?(?=\s|$|[,/)-])/g, " ai ")
    .replace(/\bintelligent automation\b/g, " ai automation ")
    .replace(/\b(copilot|chatgpt|llm|llms)\b/g, " ai ")
    .replace(/\bl\s*&\s*d\b/g, " learning ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const has = (toks, re) => toks.some((t) => re.test(t));
const phrase = (toks, words) => {
  const w = words.split(" ");
  for (let i = 0; i + w.length <= toks.length; i++) {
    if (w.every((x, k) => toks[i + k] === x)) return i;
  }
  return -1;
};
/* True when a token matching `re` sits within `max` tokens of the word "ai". */
function nearAi(toks, re, max) {
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] !== "ai") continue;
    for (let j = Math.max(0, i - max); j <= Math.min(toks.length - 1, i + max); j++) {
      if (j !== i && re.test(toks[j])) return true;
    }
  }
  return false;
}

/* --- words that take a title off the board -------------------------------- */

// People who build, study or secure the technology.
const BUILDERS = /^(engineer|engineers|engineering|scientist|scientists|researcher|research|developer|developers|architect|architecture|programmer|sre|devops|mlops|ml|data|analytics|analyst|analysts|bi|qa|tester|testing|infrastructure|platform|platforms|software|fullstack|backend|frontend|firmware|bios|server|servers|silicon|chip|chips|gpu|cloud|network|networking|datacenter|hardware|robotics|roboticist|embedded|hpc|fae|vision|speech|nlp|quantitative|computational|biologist|chemist|statistician|validator|security|cybersecurity|cyber|secops|sdlc|safety|technical|technologist|tech|compute|diagnostics|drug|discovery|antibody|oncology|proteomics|genomics|biology|materials|lab|labs|laboratory|gateway|lifecycle|systems)$/;
// Gig, panel and data-labelling work.
const GIG = /^(contributor|contributors|tutor|tutors|rater|raters|annotator|annotators|annotation|labeling|labelling|evaluator|evaluators|evaluation|linguist|linguists|transcription|transcriber|crowd|gig|interview|survey)$/;
// Entry-level and contract wording. These no longer take a title off the
// board (unless the switch is off); they become a tag and a filter.
const ENTRY = /^(intern|interns|internship|internships|coop|apprentice|apprenticeship|student|students|graduate|grad|trainee|junior|jr|werkstudent|praktikant|stagiaire)$/;
const ENTRY_PHRASES = ["entry level", "early career", "early careers", "new grad", "co op", "level 1", "level i"];
const CONTRACT = /^(contract|contractor|contractors|contracted|freelance|freelancer|temporary|temp|interim|1099|c2h|w2)$/;
const CONTRACT_PHRASES = ["part time", "fixed term", "contract to hire", "short term"];
// Unpaid and academic posts are still left out.
const UNPAID = /^(volunteer|volunteers|fellow|fellows|fellowship|unpaid)$/;
// Contract wording next to these words means paid-by-the-task model training,
// which is data-labelling work whatever the title calls it.
const TASK_WORK = /^(training|trainer|trainers|model|models|expert|experts|quality|prompt|prompts|writing|review|reviewer)$/;
// Role nouns that are never this board, whatever else the title says.
const OTHER_ROLES = /^(recruiter|recruiting|sourcer|ae|bdr|sdr|seller|copywriter|writer|editor|designer|counsel|attorney|lawyer|paralegal|accountant|controller|administrator|admin|assistant|technician|nurse|physician|teacher|professor|faculty|adjunct|postdoc|postdoctoral|lecturer|instructor|cashier|driver|actor|photographer|videographer|translator|interpreter|founder|cofounder|underwriter)$/;
// Selling, marketing and support. Allowed only as the *home* of an enablement
// or adoption role ("Manager, Marketing AI Enablement"), never on their own.
const SELLING = /^(sales|selling|presales|marketing|marketer|seo|aeo|content|brand|creative|communications|pr|growth|demand|advertising|ads|partnerships|partnership|partner|partners|pricing|account|accounts|revenue|gtm|support|design|ux|search|visibility|events|ecommerce|commerce)$/;
const OTHER_PHRASES = ["account executive", "account manager", "account director", "business development", "customer support", "technical support", "voice actor", "machine learning", "trainer project", "training project", "post training", "quality assurance", "product marketing", "product designer", "product design", "product counsel", "investment strategy"];
const PRODUCT_PHRASES = ["product manager", "product owner", "product lead", "product management", "product director", "head of product", "director of product", "vp of product"];

const ROLE_NOUN = /^(intern|apprentice|trainee|graduate|manager|lead|leader|specialist|strategist|director|head|consultant|partner|coordinator|facilitator|officer|principal|owner|advisor|coach|vp|president|chief|associate|executive|expert|enabler)$/;
const SENIOR = /^(chief|vp|svp|evp|avp|president|head|director|officer|gm)$/;
const GENERIC_NOUN = /^(intern|apprentice|trainee|specialist|lead|leader|manager|director|officer|coordinator|associate|generalist|advisor|expert|champion|strategist)$/;

/* --- the role types -------------------------------------------------------- */

const EA = "Enablement & Adoption";
const DS = "Deployment & Solutions";
const ST = "Strategy & Transformation";
const OA = "Operations & Automation";
const GR = "Governance & Risk";
const GEN = "AI Leads & Specialists";

function coreFamily(toks) {
  // Deployment strategists are the business-side counterpart of forward
  // deployed engineers. The title rarely says "AI", so it is matched alone.
  if (phrase(toks, "deployment strategist") >= 0 || phrase(toks, "deployment strategy") >= 0) return DS;

  const ai = toks.indexOf("ai");
  if (ai < 0) return null;
  // "AI-enabled paralegal", "AI-native startup", "AI-forward accounting
  // manager": the AI describes the product or the company, not the job.
  if (/^(enabled|based|driven|powered|native|natives|first|forward|assisted|x|products)$/.test(toks[ai + 1] || "")) return null;

  // Enablement, adoption, training and change management.
  if (nearAi(toks, /^(enablement|enable|enabler|champion|champions|fluency|productivity|upskilling|adoption|adopt|literacy)$/, 3)) return EA;
  if (phrase(toks, "change management") >= 0 || phrase(toks, "change manager") >= 0 || phrase(toks, "change lead") >= 0) return EA;
  if (nearAi(toks, /^(learning|training|curriculum)$/, 2) && has(toks, ROLE_NOUN)) return EA;

  // Deployment, implementation and customer-facing solutions work.
  if (nearAi(toks, /^(deployment|deployments|implementation|implementations|rollout|onboarding|integration)$/, 2) && has(toks, ROLE_NOUN)) return DS;
  if (CONFIG.forwardDeployedLeads && phrase(toks, "forward deployed") >= 0 && has(toks, ROLE_NOUN)) return DS;
  // "AI Success Manager" yes; "Customer Success Manager, AI-Native" no: the
  // second is a customer success job at an AI company, which is Renewal's.
  const su = toks.indexOf("success");
  if (su >= 0) {
    if (CONFIG.aiSuccess && su - ai === 1 && has(toks, ROLE_NOUN)) return DS;
    return null;
  }
  if (CONFIG.consultants && nearAi(toks, /^(solutions|solution)$/, 2) && has(toks, /^(specialist|consultant|consulting|advisor|lead|leader|director|manager|strategist)$/)) return DS;

  if (CONFIG.governance && nearAi(toks, /^(governance|responsible|ethics|ethical|risk|compliance|policy|trust|audit)$/, 2)) return GR;

  if (nearAi(toks, /^(strategy|strategist|strategic|transformation|innovation|initiatives)$/, 2)) return ST;
  if (CONFIG.consultants && nearAi(toks, /^(consultant|consulting|advisor|advisory)$/, 1)) return ST;

  if (CONFIG.automation) {
    const pm = Math.max(phrase(toks, "program manager"), phrase(toks, "programme manager"), phrase(toks, "program lead"), phrase(toks, "program director"), phrase(toks, "project manager"), phrase(toks, "project lead"));
    if (pm >= 0 && (Math.abs(ai - pm) <= 2 || Math.abs(ai - (pm + 1)) <= 2)) return OA;
    if (nearAi(toks, /^(operations|ops|workflow|workflows|automation|finops|delivery|pmo)$/, 2) && has(toks, ROLE_NOUN)) return OA;
  }

  if (phrase(toks, "chief ai officer") >= 0) return "Leadership";
  if (CONFIG.aiLeadership) {
    // "Head of AI", "Director of AI", "VP, Digital & AI": a senior word, then
    // "ai" within a few filler words.
    for (let i = 0; i < ai; i++) {
      if (!SENIOR.test(toks[i]) && toks[i] !== "vice") continue;
      const between = toks.slice(i + 1, ai);
      const after = toks[ai + 1] || "";
      if (between.length <= 4 && between.every((w) => /^(of|the|for|and|global|enterprise|corporate|digital|applied|president|coe|group)$/.test(w)) && !/^(pm|products|product|vendor|architects|scouts)$/.test(after)) return "Leadership";
    }
  }
  if (CONFIG.generalists) {
    if (GENERIC_NOUN.test(toks[ai + 1] || "")) return GEN;
    if (phrase(toks, "conversational ai") >= 0 && has(toks, ROLE_NOUN)) return GEN;
  }
  return null;
}

/**
 * classify(title) -> { family } when the title belongs on the board,
 * or { drop: reason } when it does not.
 */
/**
 * levelOf(title) -> "Entry level", "Contract" or "" from the title's wording.
 */
export function levelOf(title) {
  const toks = tokens(title);
  if (has(toks, ENTRY) || ENTRY_PHRASES.some((p) => phrase(toks, p) >= 0)) return "Entry level";
  if (has(toks, CONTRACT) || CONTRACT_PHRASES.some((p) => phrase(toks, p) >= 0)) return "Contract";
  return "";
}

/**
 * classify(title) -> { family, level } when the title belongs on the board,
 * or { drop: reason } when it does not.
 */
export function classify(title) {
  const toks = tokens(title);
  if (!toks.length) return { drop: "empty title" };
  const level = levelOf(title);

  if (has(toks, GIG)) return { drop: "gig or data-labelling work" };
  if (phrase(toks, "ai trainer") >= 0 || phrase(toks, "ai tutor") >= 0) return { drop: "gig or data-labelling work" };
  if (level === "Contract" && has(toks, TASK_WORK)) return { drop: "gig or data-labelling work" };
  if (has(toks, UNPAID)) return { drop: "unpaid or academic post" };
  if (level === "Entry level" && !CONFIG.entryLevel) return { drop: "entry-level role (switched off)" };
  if (level === "Contract" && !CONFIG.contract) return { drop: "contract role (switched off)" };
  if (has(toks, BUILDERS)) return { drop: "engineering, research or data role" };
  if (["product marketing", "product designer", "product design", "product counsel"].some((p) => phrase(toks, p) >= 0)) return { drop: "different profession" };
  if (PRODUCT_PHRASES.some((p) => phrase(toks, p) >= 0)) {
    if (!CONFIG.productManagers) return { drop: "product management (switched off)" };
    // The AI has to belong to the job, not sit at the far end of the title.
    return nearAi(toks, /^product$/, 4) ? { family: "Product", level } : { drop: "not an AI adoption title" };
  }
  if (has(toks, OTHER_ROLES)) return { drop: "different profession" };
  for (const p of OTHER_PHRASES) if (phrase(toks, p) >= 0) return { drop: "different profession" };

  const core = coreFamily(toks);
  if (!core) return { drop: "not an AI adoption title" };

  // Enablement and adoption roles often sit inside a sales or marketing team
  // ("Manager, Marketing AI Enablement"). Other role types may not.
  const enablement = core === EA && has(toks, /^(enablement|adoption|enabler|fluency|upskilling|literacy)$/);
  if (!enablement && has(toks, SELLING)) return { drop: "sales, marketing or support role" };

  // A senior title stays with its function ("Director, AI Governance" is a
  // governance job). "Leadership" is only for people who run AI as a whole.
  return { family: core, level };
}

/* --- field -----------------------------------------------------------------
   The industry a role sits in: taken from the title when the title says, and
   otherwise from the employer when the employer is plainly in one industry.
   Used as a tag and a filter; empty when neither says.                      */

const FIELD_RULES = [
  ["Healthcare & Life Sciences",
    /\b(clinical|clinician|medical|health|healthcare|patient|pharma|pharmaceutical|nursing|hospital|rcm|biotech|life sciences?|ambulatory)\b/i,
    /\b(health|healthcare|hospital|clinic|medical|pharma|pharmaceuticals?|therapeutics|biosciences?|lifesciences|fertility|cancer|pfizer|astrazeneca|msd|merck|gilead|sanofi|sandoz|novartis|gsk|medtronic|insulet|natera|centene|cigna|devoted|vizient|commure|thermofisher|johnson & johnson|abbvie|amgen|humana|elevance|cvs)\b/i],
  ["Financial Services",
    /\b(finance|financial|banking|bank|insurance|underwriting|tax|accounting|investment|investments|fintech|wealth|treasury|actuarial|fund)\b/i,
    /\b(bank|bancorp|financial|insurance|credit union|mutual|capital one|wealth|investments|blackrock|robinhood|bmo|huntington|fifththird|fifth third|t\. rowe|lpl|guardian life|unum|axiscapital|axos|okx|mercury|mtb|cna|rga|pru|prudential|mfs|wells fargo|wf|morgan stanley|nelnet|fis|key|baker tilly|cfgi|coinbase|stripe|visa|mastercard|american express)\b/i],
  ["Legal", /\b(legal|law|litigation|contracts)\b/i, /\b(llp|law firm|legal|epiq|intapp)\b/i],
  ["HR & People", /\b(hr|people|talent|workforce|total rewards|human resources|compensation)\b/i, null],
  ["Education", /\b(education|curriculum|academic|k-?12|higher ed)\b/i, /\b(university|college|school|schools|academy|education|wgu|mines)\b/i],
  ["Public Sector", /\b(federal|government|public sector|defense|space force|dod|civilian)\b/i, /\b(federal|government|county|city of|state of|department of|caci|rtx|imf|leidos|booz allen)\b/i],
];

export function fieldOf(title, company = "") {
  for (const [name, inTitle, inCompany] of FIELD_RULES) {
    if (inTitle.test(title) || (inCompany && inCompany.test(company))) return name;
  }
  return "";
}

/* A cheap pre-filter for big boards: could this title possibly be kept?
   Used to decide which postings are worth fetching in full. */
export function maybeRelevant(title) {
  const toks = tokens(title);
  return toks.includes("ai") || phrase(toks, "deployment strategist") >= 0;
}
