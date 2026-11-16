/* Tests for the rules: which titles are kept, where a job is, what a posting
   says about pay and tools. The titles are real ones seen in live postings. */
import test from "node:test";
import assert from "node:assert/strict";
import { classify, fieldOf, levelOf, maybeRelevant } from "../lib/classify.js";
import { readLocation } from "../lib/geo.js";
import { decodeEntities, htmlToText, parsePay, extractDetail, findTools, findAudience } from "../lib/parse.js";
import { normalize, isDeepLink, DROP } from "../lib/normalize.js";
import { dedupe } from "../lib/dedupe.js";
import { prettify, companyName } from "../companies.js";

const EA = "Enablement & Adoption", DS = "Deployment & Solutions", ST = "Strategy & Transformation", OA = "Operations & Automation", GR = "Governance & Risk", GEN = "AI Leads & Specialists";
const KEEP = [
  ["AI Enablement Lead", EA],
  ["Manager, Marketing AI Enablement", EA],
  ["Senior Manager, AI Training & Enablement", EA],
  ["Sales & AI Enablement Lead", EA],
  ["Senior Program Manager, AI Enablement", EA],
  ["AI Adoption Manager", EA],
  ["AI adoption lead (West)", EA],
  ["AI Adoption & Change Management Specialist", EA],
  ["Principal Enablement & Adoption Manager, Enterprise AI", EA],
  ["Senior Director - AI Enablement", EA],
  ["VP, AI Adoption", EA],
  ["Microsoft Digital Productivity Consultant - Copilot Adoption & Change Management", EA],
  ["Deployment Strategist", DS],
  ["AI Deployment Strategist, Enterprise", DS],
  ["AI Deployment Manager (Japanese-Speaking)", DS],
  ["AI Success Manager", DS],
  ["Clinical AI Implementation Manager", DS],
  ["AI Solutions Specialist", DS],
  ["AI transformation lead (Central)", ST],
  ["Sr. Principal Program Manager - AI Transformation", ST],
  ["Generative AI Strategist", ST],
  ["Artificial Intelligence Transformation Consultant", ST],
  ["Head of AI Transformation", ST],
  ["Director, AI Strategy & Transformation", ST],
  ["AI Program Manager", OA],
  ["Staff AI Operations Lead", OA],
  ["Senior Manager, AI Workflow", OA],
  ["Manager - Intelligent Automation", OA],
  ["Senior AI Project Manager", OA],
  ["AI Governance Lead", GR],
  ["Director, AI Compliance", GR],
  ["AI Risk Management Senior Associate", GR],
  ["A.I Governance Manager", GR],
  ["AI Policy Lead", GR],
  ["AI Specialist", GEN],
  ["Medical Affairs AI Lead", GEN],
  ["AI Product Manager", "Product"],
  ["Senior Product Manager, AI Assistant", "Product"],
  ["Principal AI Product Owner", "Product"],
  ["AI Strategy Intern", ST],
  ["AI Intern - Summer 2027", GEN],
  ["Deployment Strategist, New Grad", DS],
  ["Associate, AI Enablement & Adoption (8 Months Contract)", EA],
  ["Chief AI Officer", "Leadership"],
  ["Head of AI", "Leadership"],
  ["Director of Enterprise AI", "Leadership"],
];
const DROPPED = [
  "AI Enablement Engineer", "Staff AI Engineer", "Applied AI Research Scientist", "Machine Learning Engineer",
  "Freelance AI Trainer - Spanish", "LaTex Specialist (Fluent in Tagalog) - Freelance AI Trainer Project", "AI Training Contributor - Wolof - Remote",
  "AI Tutor", "AI Trainer (ML Engineering)", "Account Executive, AI", "AI Sales Specialist", "AI Engineering Intern", "Freelance Medical Expert - AI Training",
  "Director of Product Marketing - Agentic AI", "Product Manager, Payments", "AI Customer Success Intern", "AI Policy Fellow", "Technical Product Manager, AI Platform",
  "Customer Success Manager, AI-Native", "Strategy & Operations Manager, AI Products", "UEFI BIOS Firmware Program Manager for AI Servers",
  "Senior Data & AI Strategy Analyst", "Knowledge Manager - AI & Content Strategy", "Content Strategist - AI Training",
  "Customer Success Manager", "Software Engineer", "AI Recruiter", "Principal Solutions Strategist, Cloud & AI Platforms",
  "Legal Counsel, AI Governance", "AI-Enabled Paralegal", "Accounting Manager (AI-forward)", "Director, AI Security", "Senior Director of AI Diagnostics",
  "Director of SEO & AI Search", "AI Partnerships Manager", "Assistant Professor - AI in Agriculture", "Associate, Investment Strategy - Artificial Intelligence",
];

test("titles the board keeps, and the role type each gets", () => {
  for (const [title, family] of KEEP) assert.equal(classify(title).family, family, title);
});
test("titles the board drops", () => {
  for (const title of DROPPED) assert.equal(classify(title).family, undefined, `${title} -> ${JSON.stringify(classify(title))}`);
});
test("entry-level and contract roles are kept and tagged", () => {
  assert.equal(classify("AI Strategy Intern").level, "Entry level");
  assert.equal(classify("Junior AI Specialist").level, "Entry level");
  assert.equal(classify("AI Enablement Lead (6-month contract)").level, "Contract");
  assert.equal(classify("AI Enablement Lead").level, "");
  assert.equal(levelOf("Part-Time AI Adoption Coordinator"), "Contract");
});
test("industry comes from the title, or from an employer that is plainly in one", () => {
  assert.equal(fieldOf("Clinical AI Implementation Manager", "Northwell"), "Healthcare & Life Sciences");
  assert.equal(fieldOf("AI Governance Lead", "Western Alliance Bank"), "Financial Services");
  assert.equal(fieldOf("Senior Legal Operations Specialist (AI & Automation)", "Samsara"), "Legal");
  assert.equal(fieldOf("AI Enablement Lead", "Northloop"), "");
});
test("the cheap pre-filter never hides a title the board would keep", () => {
  for (const [title] of KEEP) assert.equal(maybeRelevant(title), true, title);
  assert.equal(maybeRelevant("Customer Success Manager"), false);
});

test("locations: US or not, and work mode only when stated", () => {
  const cases = [
    ["Remote - United States", true, "Remote", "Remote — US"],
    ["USA - Remote", true, "Remote", "Remote — US"],
    ["San Francisco, CA", true, "", "San Francisco, CA"],
    ["New York City", true, "", "New York City"],
    ["Hybrid New York", true, "Hybrid", "Hybrid New York"],
    ["Colorado Springs, CO - ONSITE", true, "Onsite", "Colorado Springs, CO - ONSITE"],
    ["London, UK", false, "", null],
    ["Toronto, CA", false, "", null],
    ["Bangalore, IN", false, "", null],
    ["Remote (Brazil)", false, "Remote", null],
    ["Remote", null, "Remote", null],
    ["Not specified", null, "", null],
    ["Saskatoon", null, "", null],
  ];
  for (const [raw, us, mode, label] of cases) {
    const r = readLocation(raw);
    assert.equal(r.us, us, `${raw} us`);
    assert.equal(r.mode, mode, `${raw} mode`);
    if (label) assert.equal(r.label, label, `${raw} label`);
  }
});
test("locations: Workday's 'N Locations' is read from the link, and country codes are not towns", () => {
  const a = readLocation("2 Locations", { url: "https://acme.wd1.myworkdayjobs.com/ext/job/Atlanta-GA/AI-Lead_R-2" });
  assert.deepEqual([a.us, a.label], [true, "Atlanta, GA + 1 more"]);
  const b = readLocation("2 Locations", { url: "https://dxc.wd1.myworkdayjobs.com/ext/job/ESP-MD/AI-Consultant_R-3" });
  assert.equal(b.us, null);
});

test("pay: annual USD ranges only, never hourly, single figures or funding", () => {
  assert.deepEqual(parsePay("The base salary range for this role is $150,000 - $185,000 plus a 15% annual bonus."), { min: 150000, max: 185000, extra: "+ bonus" });
  assert.deepEqual(parsePay("Salary: $110K – $130K + equity"), { min: 110000, max: 130000, extra: "+ equity" });
  assert.deepEqual(parsePay("Compensation: $130-160K base"), { min: 130000, max: 160000, extra: "" });
  assert.deepEqual(parsePay("begin at $138,000.00 and up to $190,000.00. Eligible for a bonus, competitive equity package"), null, "one figure then another sentence is not a range");
  assert.equal(parsePay("Pay: $55.75/hr - $83.07/hr"), null);
  assert.equal(parsePay("We raised $40,000,000 - $60,000,000 in funding"), null);
  assert.equal(parsePay("We serve 10,000 - 50,000 customers"), null);
  assert.equal(parsePay("Salary up to $150,000"), null);
  assert.equal(parsePay("£70,000 - £90,000 GBP"), null);
  assert.equal(parsePay(""), null);
});

test("text: entities are decoded even when escaped twice", () => {
  assert.equal(decodeEntities("&amp;lt;p&amp;gt;A &amp;amp; B&amp;lt;/p&amp;gt;"), "<p>A & B</p>");
  assert.equal(htmlToText("&lt;p&gt;Hello&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;/ul&gt;"), "Hello\n• One");
});
test("excerpts: summary and the two lists, without boilerplate", () => {
  const html = "<p>We are hiring an AI Enablement Lead to drive internal AI adoption across the company.</p><h3>What you'll do</h3><ul><li>Build and run the enablement program</li><li>Coach a network of champions</li></ul><h3>Requirements</h3><ul><li>5+ years in enablement or change management</li><li>You have rolled out a tool to a large audience</li></ul><h3>Benefits</h3><ul><li>Unlimited vacation and more</li><li>Health cover for everyone</li></ul><p>We are an equal opportunity employer and value diversity at our company.</p>";
  const d = extractDetail(html);
  assert.match(d.summary, /^We are hiring an AI Enablement Lead/);
  assert.deepEqual(d.does, ["Build and run the enablement program", "Coach a network of champions"]);
  assert.equal(d.wants.length, 2);
  assert.ok(!JSON.stringify(d).includes("vacation"));
});
test("tools: only tools the posting names, never the company's own product", () => {
  assert.deepEqual(findTools("covering Claude, Cowork, and Claude Code, plus Glean", "Juniper Square"), ["Claude Code", "Claude", "Glean"]);
  assert.deepEqual(findTools("We use Glean every day", "Glean"), []);
  assert.deepEqual(findTools("Move your cursor to the button"), []);
});
test("audience: only when stated, and never when the posting says both", () => {
  assert.equal(findAudience("drive internal AI adoption across the company"), "Internal");
  assert.equal(findAudience("a customer-facing role working with our customers"), "Customer-facing");
  assert.equal(findAudience("internal teams and our customers"), "");
  assert.equal(findAudience("a great job"), "");
});

test("apply links must open a posting, not a careers homepage", () => {
  assert.equal(isDeepLink("https://job-boards.greenhouse.io/northloop/jobs/5001"), true);
  assert.equal(isDeepLink("https://jobs.ashbyhq.com/ferrous/ab-1/application"), true);
  assert.equal(isDeepLink("https://jobs.ashbyhq.com/ferrous"), false);
  assert.equal(isDeepLink("https://northloop.com/"), false);
  assert.equal(isDeepLink("https://northloop.com/careers"), false);
  assert.equal(isDeepLink("https://northloop.com/careers?gh_jid=5001"), true);
  assert.equal(isDeepLink("not a url"), false);
});

const raw = (over = {}) => ({ ats: "greenhouse", token: "northloop", externalId: "5001", title: "AI Enablement Lead", locations: ["Remote - United States"], remoteFlag: true, workplace: "", html: "<p>We are hiring an AI Enablement Lead to drive internal AI adoption across the company with Claude.</p><p>The base salary range for this role is $150,000 - $185,000.</p>", postedAt: "2026-11-10T00:00:00Z", url: "https://job-boards.greenhouse.io/northloop/jobs/5001", applyUrl: "https://job-boards.greenhouse.io/northloop/jobs/5001", pay: null, companyName: "Northloop", ...over });
const NOW = { now: new Date("2026-11-13T12:00:00Z") };

test("normalize: a good posting becomes a listing with only published facts", () => {
  const { job } = normalize(raw(), NOW);
  assert.equal(job.family, "Enablement & Adoption");
  assert.deepEqual([job.min, job.max], [150000, 185000]);
  assert.deepEqual(job.locations, [{ label: "Remote — US", mode: "Remote" }]);
  assert.deepEqual(job.detail.tools, ["Claude"]);
  assert.equal(job.detail.audience, "Internal");
  assert.equal(job.posted, "2026-11-10");
});
test("normalize: no pay in the posting means no pay on the board", () => {
  const { job } = normalize(raw({ html: "<p>We are hiring an AI Enablement Lead for our company in the US.</p>" }), NOW);
  assert.deepEqual([job.min, job.max, job.extra], [null, null, ""]);
});
test("normalize: drop reasons", () => {
  assert.equal(normalize(raw({ postedAt: "2026-08-01T00:00:00Z" }), NOW).drop, DROP.STALE);
  // 60 days is the limit: day 59 stays, day 61 goes, and no date at all goes too.
  assert.ok(normalize(raw({ postedAt: "2026-09-15T12:00:00Z" }), NOW).job, "59 days old");
  assert.equal(normalize(raw({ postedAt: "2026-09-13T00:00:00Z" }), NOW).drop, DROP.STALE);
  assert.equal(normalize(raw({ postedAt: null }), NOW).drop, DROP.NO_DATE);
  // An hourly rate sent as structured pay is never shown as a salary. If the
  // posting's own text gives a yearly range, that is used instead.
  assert.equal(normalize(raw({ pay: { min: 50, max: 55 }, html: "<p>We are hiring an AI enablement lead.</p>" }), NOW).job.min, null);
  assert.equal(normalize(raw({ pay: { min: 50, max: 55 } }), NOW).job.min, 150000);
  assert.equal(normalize(raw({ pay: { min: 160000, max: 190000 } }), NOW).job.min, 160000);
  assert.equal(normalize(raw({ ats: "workday", url: "https://acme.wd1.myworkdayjobs.com/internaljobs/job/New-York/AI-Enablement-Lead_R1", applyUrl: null }), NOW).drop, DROP.INTERNAL);
  assert.ok(normalize(raw({ ats: "workday", url: "https://acme.wd1.myworkdayjobs.com/external/job/New-York/AI-Enablement-Lead_R1", applyUrl: null }), NOW).job);
  assert.equal(normalize(raw({ locations: ["London, UK"] }), NOW).drop, DROP.GEO);
  assert.equal(normalize(raw({ locations: ["Remote"] }), NOW).drop, DROP.GEO_UNCLEAR);
  assert.equal(normalize(raw({ title: "AI Adoption Specialist – Australia", locations: ["Richmond"] }), NOW).drop, DROP.GEO);
  assert.equal(normalize(raw({ url: "https://jobs.ashbyhq.com/ferrous", applyUrl: "https://jobs.ashbyhq.com/ferrous" }), NOW).drop, DROP.LINK);
  assert.equal(normalize(raw({ token: "jobgether" }), NOW).drop, DROP.STAFFING);
  assert.equal(normalize(raw({ recruiter: true }), NOW).drop, DROP.STAFFING);
  assert.equal(normalize(raw({ html: "<p>No pay here, role is in the US.</p>" }), { ...NOW, requireSalary: true }).drop, DROP.NO_SALARY);
  assert.match(normalize(raw({ title: "Staff AI Engineer" }), NOW).drop, /engineering/);
});
test("normalize: a mixed-country posting keeps only its US locations", () => {
  const { job } = normalize(raw({ locations: ["New York, NY", "London, UK", "Austin, TX"] }), NOW);
  assert.deepEqual(job.locations.map((l) => l.label), ["New York, NY", "Austin, TX"]);
});

test("dedupe: the same role in three cities is one listing with three locations, and the copy with pay wins", () => {
  const a = normalize(raw({ externalId: "1", locations: ["New York, NY"], html: "" , url: "https://job-boards.greenhouse.io/northloop/jobs/1", applyUrl: "https://job-boards.greenhouse.io/northloop/jobs/1" }), NOW).job;
  const b = normalize(raw({ externalId: "2", locations: ["Austin, TX"], url: "https://job-boards.greenhouse.io/northloop/jobs/2", applyUrl: "https://job-boards.greenhouse.io/northloop/jobs/2" }), NOW).job;
  const c = normalize(raw({ externalId: "3", locations: ["New York, NY"], html: "", url: "https://job-boards.greenhouse.io/northloop/jobs/3", applyUrl: "https://job-boards.greenhouse.io/northloop/jobs/3" }), NOW).job;
  const out = dedupe([a, b, c]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].locations.map((l) => l.label), ["Austin, TX", "New York, NY"]);
  assert.equal(out[0].min, 150000);
});

test("company names: fixes, the open list, then a tidy fallback", () => {
  assert.equal(companyName("greenhouse", "doordashusa"), "DoorDash");
  assert.equal(companyName("ashby", "some-new-startup"), "Some New Startup");
  assert.equal(companyName("greenhouse", "anything", "Real Name Inc"), "Real Name Inc");
  assert.equal(companyName("greenhouse", "anything", "Exadel Inc (Website)"), "Exadel Inc");
  assert.equal(prettify("acme-health"), "Acme Health");
});
