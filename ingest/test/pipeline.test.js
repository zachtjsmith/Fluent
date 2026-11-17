/* End-to-end tests: the four adapters against a local stand-in for the hiring
   systems, then a whole collection run (including reading the descriptions of
   postings that came from the open dataset), then the files the site reads. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "./fixtures/server.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = path.join(HERE, "fixtures", "snapshot");
const NOW = "2026-11-13T12:00:00Z";

const fx = await startFixtureServer();
for (const v of ["GREENHOUSE", "LEVER", "ASHBY", "WORKABLE"]) process.env[`ATS_BASE_${v}`] = fx.url;
process.env.COLLECTOR_TEST_SERVER = fx.url;
process.env.COLLECTOR_UA = "RolloutJobBoard/test (contact: test@example.com)";
// Imported after the environment is set, because adapters read it on load.
const { greenhouse, lever, ashby, workable } = await import("../adapters.js");
const { run, write, DETAIL_VERSION } = await import("../build.js");
const { CURATED } = await import("../companies.js");
test.after(() => fx.close());

test("greenhouse: title-first, so full postings are fetched only for candidate titles", async () => {
  const before = fx.hits().length;
  const out = await greenhouse({ token: "northloop" });
  const hits = fx.hits().slice(before);
  assert.deepEqual(out.map((j) => j.title), ["AI Enablement Lead", "Staff AI Engineer", "AI Adoption Manager", "AI Adoption Manager", "Head of AI Transformation"]);
  assert.ok(!hits.some((h) => h.endsWith("/5006")), "the Account Executive posting was never fetched");
  assert.equal(out[0].companyName, "Northloop");
  assert.deepEqual(out[3].locations, ["Chicago, IL", "Austin, TX"]);
  assert.match(out[0].html, /AI Enablement Lead/);
});
test("lever: structured salary and every location", async () => {
  const out = await lever({ token: "kestrel" });
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].pay, { min: 160000, max: 210000, extra: "" });
  assert.deepEqual(out[0].locations, ["San Francisco, CA", "New York, NY"]);
  assert.equal(out[0].applyUrl, "https://jobs.lever.co/kestrel/lv-1/apply");
});
test("ashby: compensation, country and remote flag", async () => {
  const out = await ashby({ token: "ferrous" });
  assert.deepEqual(out[0].pay, { min: 210000, max: 250000, extra: "+ equity" });
  assert.deepEqual(out[0].locations, ["New York, United States"]);
  assert.deepEqual(out[1].locations, ["Toronto, Canada"]);
});
test("workable: company name and location", async () => {
  const out = await workable({ token: "havenpoint" });
  assert.equal(out[0].companyName, "Havenpoint");
  assert.deepEqual(out[0].locations, ["Denver, Colorado, United States"]);
});

test("a whole run: snapshot plus polling, with every rule applied", async () => {
  const saved = CURATED.splice(0, CURATED.length, { ats: "lever", token: "kestrel" }, { ats: "ashby", token: "ferrous" }, { ats: "workable", token: "havenpoint" }, { ats: "greenhouse", token: "flaky" });
  try {
    const result = await run({ snapshot: SNAPSHOT, poll: true, maxAge: 60, strict: false, maxBoards: 50, now: NOW, quiet: true, verified: null });
    const by = Object.fromEntries(result.jobs.map((j) => [`${j.company} | ${j.title}`, j]));
    const titles = Object.keys(by).sort();
    assert.deepEqual(titles, [
      "Acme | AI Transformation Lead",
      "Ferrous | Director, AI Strategy",
      "Harborline | AI Enablement Specialist",
      "Havenpoint | AI Enablement Program Manager",
      "Kestrel | AI Deployment Strategist",
      "Moog | AI Adoption & Enablement Leader",
      "Northloop | AI Adoption Manager",
      "Northloop | AI Enablement Lead",
      "Quillfield | AI Enablement Manager",
      "WRITER | AI adoption lead (West)",
    ]);
    // Every listing has an overview from its own description.
    for (const j of result.jobs) assert.ok(j.hasDetail && j.detail.summary.length > 40, `${j.title} has an overview`);
    // Polled board: full posting, published pay, tools and audience.
    const lead = by["Northloop | AI Enablement Lead"];
    assert.deepEqual([lead.min, lead.max, lead.extra], [150000, 185000, "+ bonus"]);
    assert.deepEqual(lead.detail.tools, ["Claude", "Glean"]);
    assert.equal(lead.detail.audience, "Internal");
    assert.equal(lead.detail.does.length, 3);
    // Same role in two cities: one listing.
    assert.deepEqual(by["Northloop | AI Adoption Manager"].locations.map((l) => l.label), ["Chicago, IL", "Austin, TX"]);
    assert.deepEqual(by["WRITER | AI adoption lead (West)"].locations.map((l) => l.label).sort(), ["San Francisco, CA", "Seattle, WA"]);
    // From the open dataset: the description is read from Workday's own data,
    // and the pay comes from the description. The dataset's estimate is never used.
    const moog = by["Moog | AI Adoption & Enablement Leader"];
    assert.deepEqual([moog.min, moog.max, moog.source], [120000, 150000, "Workday"]);
    assert.match(moog.detail.summary, /^The AI Adoption & Enablement Leader will help/);
    assert.equal(moog.detail.does.length, 3);
    // Workday's data was missing for Acme, so the job page's schema.org data was used.
    const acme = by["Acme | AI Transformation Lead"];
    assert.match(acme.detail.summary, /^As our AI Transformation Lead you will run/);
    assert.deepEqual([acme.min, acme.max, acme.level], [130000, 160000, "Contract"]);
    // BambooHR's own data, with the employer's pay field.
    const harbor = by["Harborline | AI Enablement Specialist"];
    assert.deepEqual([harbor.min, harbor.max, harbor.source], [90000, 110000, "BambooHR"]);
    // A Next.js page (JOIN) and an Ashby board that could not be polled.
    assert.match(by["Quillfield | AI Enablement Manager"].detail.summary, /^Quillfield is looking for an AI Enablement Manager/);
    assert.match(by["WRITER | AI adoption lead (West)"].detail.summary, /^You will lead AI adoption/);
    assert.equal(by["Acme | AI Transformation Lead"].locations[0].label, "Atlanta, GA + 1 more");
    // Dropped for the right reasons.
    const d = result.stats.drops;
    assert.ok(d["outside the US"] >= 2, "London and Toronto roles");
    assert.ok(d["older than 60 days"] >= 1, "80-day-old posting");
    assert.ok(d["apply link is not a posting"] >= 1, "homepage-only link");
    assert.ok(d["staffing or gig board"] >= 1, "jobgether repost");
    assert.ok(d["location could not be placed"] >= 1, "Spain's ESP-MD is not Maryland");
    assert.ok(result.stats.boardsFailed.some((b) => b.startsWith("greenhouse:flaky")), "a failing board is reported, not fatal");
    // A posting whose description cannot be read is left off, and counted.
    assert.equal(d["no job description could be read"], 1, "the Paylocity page has no description");
    assert.deepEqual(result.stats.details.missing, { Paylocity: 1 });
    // Boards are polled only when the dataset has a posting that could make the board.
    assert.ok(!fx.hits().some((h) => /job-board\/jobgether|postings\/jobgether/.test(h)), "staffing boards are never polled");
    // Every listing can be applied to.
    for (const j of result.jobs) assert.match(j.detail.applyUrl, /^https:\/\/.+\/.+/);

    // The files the site reads.
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "rollout-"));
    write(result, out);
    const index = JSON.parse(fs.readFileSync(path.join(out, "jobs.json"), "utf8"));
    assert.equal(index.count, 10);
    assert.equal(index.withPay, 6);
    assert.equal(index.detailVersion, DETAIL_VERSION);
    for (const j of index.jobs) {
      assert.equal(j.detail, undefined, "the index stays light");
      const shard = JSON.parse(fs.readFileSync(path.join(out, "jobs", `d-${String(j.s).padStart(2, "0")}.json`), "utf8"));
      assert.ok(shard[j.id] && shard[j.id].applyUrl, `${j.title} has a detail record with an apply link`);
    }
  } finally {
    CURATED.splice(0, CURATED.length, ...saved);
  }
});

test("descriptions read on an earlier run are reused; without them a listing is left off", async () => {
  const saved = CURATED.splice(0, CURATED.length);
  try {
    const opts = { snapshot: SNAPSHOT, poll: true, maxAge: 60, strict: false, maxBoards: 50, now: NOW, quiet: true, verified: null };
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "fluent-"));
    write(await run(opts), out);
    // Next day Moog's Workday site is down.
    fx.block("/moog.wd5.myworkdayjobs.com");
    const before = fx.hits().length;
    const again = await run({ ...opts, previous: out });
    const moog = again.jobs.find((j) => j.company === "Moog");
    assert.ok(moog, "still listed");
    assert.match(moog.detail.summary, /^The AI Adoption & Enablement Leader will help/);
    assert.equal(moog.min, 120000, "pay kept too");
    assert.ok(again.stats.details.reused >= 1);
    assert.ok(!fx.hits().slice(before).some((h) => h.includes("moog.wd5")), "a description we already have is not read again");
    // With no earlier run to fall back on, it is left off rather than shown without an overview.
    const fresh = await run(opts);
    assert.ok(!fresh.jobs.some((j) => j.company === "Moog"));
    assert.equal(fresh.stats.details.missing.Workday, 1);
  } finally {
    fx.block(null);
    CURATED.splice(0, CURATED.length, ...saved);
  }
});

test("a run that finds less than half of yesterday's listings does not replace the board", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fluent-"));
  const job = (i) => ({ id: `abc${String(i).padStart(9, "0")}`, title: `Role ${i}`, company: "Acme", family: "Enablement & Adoption", field: "", level: "", locations: [{ label: "Remote — US", mode: "Remote" }], mode: "Remote", min: null, max: null, extra: "", posted: "2026-11-12", ats: "greenhouse", source: "Greenhouse", board: "acme", featured: false, hasDetail: true, detail: { summary: "An overview.", does: [], wants: [], tools: [], audience: "", applyUrl: "https://example.com/jobs/1", postingUrl: "https://example.com/jobs/1" } });
  const result = (n) => ({ jobs: Array.from({ length: n }, (_, i) => job(i)), stats: { sources: {} }, generatedAt: NOW });
  write(result(100), out);
  assert.throws(() => write(result(30), out), /refusing to replace the board/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, "jobs.json"), "utf8")).count, 100, "yesterday's board is untouched");
  write(result(30), out, { force: true });
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, "jobs.json"), "utf8")).count, 30);
});

test("an empty run never overwrites the board", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "rollout-"));
  assert.throws(() => write({ jobs: [], stats: { sources: {} }, generatedAt: NOW }, out), /refusing to overwrite/);
});
