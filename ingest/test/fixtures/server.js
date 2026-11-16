/* A tiny stand-in for the four hiring systems, so the whole pipeline can be
   tested without touching the real ones. Start it with startFixtureServer(),
   point the adapters at it with the ATS_BASE_* variables, and stop it after. */
import http from "node:http";

const days = (n) => new Date(Date.UTC(2026, 10, 13) - n * 864e5).toISOString();
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const body = ({ intro, does, wants, pay }) =>
  `<p>${intro}</p><h3>What you'll do</h3><ul>${does.map((d) => `<li>${d}</li>`).join("")}</ul><h3>What we're looking for</h3><ul>${wants.map((d) => `<li>${d}</li>`).join("")}</ul>${pay ? `<p>${pay}</p>` : ""}<p>We are an equal opportunity employer.</p>`;

const ENABLE = body({
  intro: "We are hiring an AI Enablement Lead to drive internal AI adoption across the company, working with tools such as Claude and Glean.",
  does: ["Build and run the company-wide AI enablement program", "Recruit and coach a network of AI champions across teams", "Report adoption to the executive team every month"],
  wants: ["5+ years in enablement, customer success or change management", "You have rolled out a software tool to a large audience"],
  pay: "The base salary range for this role is $150,000 - $185,000 plus a 15% annual bonus.",
});

export const GH = {
  name: "Northloop",
  jobs: [
    { id: 5001, title: "AI Enablement Lead", location: { name: "Remote - United States" }, first_published: days(1), content: esc(ENABLE) },
    { id: 5002, title: "Staff AI Engineer", location: { name: "San Francisco, CA" }, first_published: days(2), content: esc("<p>Build models. $200,000 - $260,000.</p>") },
    { id: 5003, title: "AI Adoption Manager", location: { name: "London, UK" }, first_published: days(3), content: esc("<p>London role.</p>") },
    { id: 5004, title: "AI Adoption Manager", location: { name: "Chicago, IL; Austin, TX" }, first_published: days(4), content: esc(body({ intro: "You will help our operations teams adopt AI tools.", does: ["Run weekly office hours", "Redesign three workflows a quarter"], wants: ["3+ years in change management", "Clear writer"] })) },
    { id: 5005, title: "Head of AI Transformation", location: { name: "New York, NY" }, first_published: days(80), content: esc("<p>Old posting.</p>") },
    { id: 5006, title: "Account Executive", location: { name: "Denver, CO" }, first_published: days(1), content: "" },
  ],
};
const lever = [
  { id: "lv-1", text: "AI Deployment Strategist", categories: { location: "San Francisco, CA", allLocations: ["San Francisco, CA", "New York, NY"], team: "Deployment" }, workplaceType: "hybrid", createdAt: Date.parse(days(2)), hostedUrl: "https://jobs.lever.co/kestrel/lv-1", applyUrl: "https://jobs.lever.co/kestrel/lv-1/apply", description: "<p>As our deployment strategist you will sit with our customers and get the product adopted.</p>", lists: [{ text: "What you'll do", content: "<li>Lead customer deployments from kickoff to steady use</li><li>Run executive check-ins</li>" }], salaryRange: { min: 160000, max: 210000, currency: "USD", interval: "per-year-salary" } },
  { id: "lv-2", text: "Freelance AI Trainer - Spanish", categories: { location: "Remote" }, createdAt: Date.parse(days(1)), hostedUrl: "https://jobs.lever.co/kestrel/lv-2" },
];
const ashby = { jobs: [
  { id: "ab-1", title: "Director, AI Strategy", location: "New York", address: { postalAddress: { addressCountry: "United States" } }, isRemote: false, workplaceType: "Hybrid", publishedAt: days(5), jobUrl: "https://jobs.ashbyhq.com/ferrous/ab-1", applyUrl: "https://jobs.ashbyhq.com/ferrous/ab-1/application", descriptionHtml: "<p>You will decide where we invest in AI across the company.</p>", compensation: { summaryComponents: [{ compensationType: "Salary", minValue: 210000, maxValue: 250000, currencyCode: "USD", interval: "1 YEAR" }, { compensationType: "EquityPercentage" }] } },
  { id: "ab-2", title: "AI Training Specialist", location: "Toronto", address: { postalAddress: { addressCountry: "Canada" } }, publishedAt: days(2), jobUrl: "https://jobs.ashbyhq.com/ferrous/ab-2" },
  { id: "ab-3", title: "AI Program Manager", location: "Remote", address: { postalAddress: { addressCountry: "United States" } }, isRemote: true, publishedAt: days(6), jobUrl: "https://jobs.ashbyhq.com/ferrous", descriptionHtml: "<p>Homepage link only.</p>" },
] };
const workable = { name: "Havenpoint", jobs: [
  { title: "AI Enablement Program Manager", shortcode: "WK1", city: "Denver", state: "Colorado", country: "United States", telecommuting: false, published_on: days(4).slice(0, 10), url: "https://apply.workable.com/havenpoint/j/WK1", application_url: "https://apply.workable.com/havenpoint/j/WK1/apply", description: "<p>Design and deliver the AI literacy curriculum for our staff.</p>" },
] };

export function startFixtureServer() {
  let hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    const send = (obj, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    const u = new URL(req.url, "http://x");
    const p = u.pathname;
    let m;
    if ((m = /^\/v1\/boards\/northloop\/jobs\/(\d+)$/.exec(p))) { const j = GH.jobs.find((x) => String(x.id) === m[1]); return j ? send({ ...j, absolute_url: `https://job-boards.greenhouse.io/northloop/jobs/${j.id}` }) : send({}, 404); }
    if (p === "/v1/boards/northloop/jobs") return send({ jobs: GH.jobs.map(({ content, ...j }) => ({ ...j, absolute_url: `https://job-boards.greenhouse.io/northloop/jobs/${j.id}` })) });
    if (p === "/v1/boards/northloop") return send({ name: GH.name });
    if (p === "/v0/postings/kestrel") return send(lever);
    if (p === "/posting-api/job-board/ferrous") return send(ashby);
    if (p === "/api/v1/widget/accounts/havenpoint") return send(workable);
    if (p === "/v1/boards/flaky/jobs") return send({ error: "boom" }, 500);
    return send({ error: "not found" }, 404);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, hits: () => hits, close: () => new Promise((r) => server.close(r)) })));
}
