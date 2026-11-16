/* End-to-end tests: the four adapters against a local stand-in for the hiring
   systems, then a whole collection run, then the files the site reads. */
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
process.env.COLLECTOR_UA = "RolloutJobBoard/test (contact: test@example.com)";
// Imported after the environment is set, because adapters read it on load.
const { greenhouse, lever, ashby, workable } = await import("../adapters.js");
const { run, write } = await import("../build.js");
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
      "Havenpoint | AI Enablement Program Manager",
      "Kestrel | AI Deployment Strategist",
      "Moog | AI Adoption & Enablement Leader",
      "Northloop | AI Adoption Manager",
      "Northloop | AI Enablement Lead",
      "WRITER | AI adoption lead (West)",
    ]);
    // Polled board: full posting, published pay, tools and audience.
    const lead = by["Northloop | AI Enablement Lead"];
    assert.deepEqual([lead.min, lead.max, lead.extra], [150000, 185000, "+ bonus"]);
    assert.deepEqual(lead.detail.tools, ["Claude", "Glean"]);
    assert.equal(lead.detail.audience, "Internal");
    assert.equal(lead.detail.does.length, 3);
    // Same role in two cities: one listing.
    assert.deepEqual(by["Northloop | AI Adoption Manager"].locations.map((l) => l.label), ["Chicago, IL", "Austin, TX"]);
    assert.deepEqual(by["WRITER | AI adoption lead (West)"].locations.map((l) => l.label).sort(), ["San Francisco, CA", "Seattle, WA"]);
    // Snapshot-only listing: no description, so no pay. The dataset's salary estimate is never used.
    const moog = by["Moog | AI Adoption & Enablement Leader"];
    assert.deepEqual([moog.min, moog.hasDetail, moog.source], [null, false, "Workday"]);
    assert.equal(by["Acme | AI Transformation Lead"].locations[0].label, "Atlanta, GA + 1 more");
    // Dropped for the right reasons.
    const d = result.stats.drops;
    assert.ok(d["outside the US"] >= 2, "London and Toronto roles");
    assert.ok(d["older than 60 days"] >= 1, "80-day-old posting");
    assert.ok(d["apply link is not a posting"] >= 1, "homepage-only link");
    assert.ok(d["staffing or gig board"] >= 1, "jobgether repost");
    assert.ok(d["location could not be placed"] >= 1, "Spain's ESP-MD is not Maryland");
    assert.ok(result.stats.boardsFailed.some((b) => b.startsWith("greenhouse:flaky")), "a failing board is reported, not fatal");
    // Every listing can be applied to.
    for (const j of result.jobs) assert.match(j.detail.applyUrl, /^https:\/\/.+\/.+/);

    // The files the site reads.
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "rollout-"));
    write(result, out);
    const index = JSON.parse(fs.readFileSync(path.join(out, "jobs.json"), "utf8"));
    assert.equal(index.count, 8);
    assert.equal(index.withPay, 3);
    for (const j of index.jobs) {
      assert.equal(j.detail, undefined, "the index stays light");
      const shard = JSON.parse(fs.readFileSync(path.join(out, "jobs", `d-${String(j.s).padStart(2, "0")}.json`), "utf8"));
      assert.ok(shard[j.id] && shard[j.id].applyUrl, `${j.title} has a detail record with an apply link`);
    }
  } finally {
    CURATED.splice(0, CURATED.length, ...saved);
  }
});

test("an empty run never overwrites the board", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "rollout-"));
  assert.throws(() => write({ jobs: [], stats: { sources: {} }, generatedAt: NOW }, out), /refusing to overwrite/);
});
