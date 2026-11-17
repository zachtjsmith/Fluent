#!/usr/bin/env node
/* ============================================================================
   build.js — the nightly collection run.

     node ingest/build.js                         poll the curated boards
     node ingest/build.js --snapshot <dir>        also read the open dataset
     node ingest/build.js --snapshot <dir> --no-poll   dataset only (offline)

   Options:
     --max-age <days>   oldest posting kept, in days (default 60)
     --strict           drop roles with no published salary
     --max-boards <n>   cap on boards polled per run (default 400)
     --out <dir>        where to write (default public)
     --force            write even if the board shrinks by more than half
     --demo             small run against the fixture server (see test/)

   Writes:
     <out>/jobs.json          the index the site loads first (light fields)
     <out>/jobs/d-XX.json     detail shards, loaded when a listing is opened

   Steps:
     1. Snapshot (optional): scan the open dataset for candidate titles.
     2. Poll: read the curated boards, plus every board where the snapshot
        has a posting that could make the board, busiest first. A polled
        board replaces its snapshot rows, because the poll brings the full
        posting and any published pay.
     3. Hand-checked notes (data/verified.json) are applied.
     4. Descriptions: every listing shows an overview from its own job
        description. A listing that arrived without one gets it from the last
        run if we already read it, or else from the posting (details.js). A
        listing whose description cannot be read is left off.
     5. Normalise, merge duplicates, sort, write.
   ========================================================================== */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADAPTERS, clearBoardCache } from "./adapters.js";
import { fetchDetail, resetDetailState } from "./details.js";
import { CURATED } from "./companies.js";
import { classify, SKIP_BOARDS, FAMILIES, FIELDS, LEVELS } from "./lib/classify.js";
import { normalize, stableId, SOURCE_LABEL } from "./lib/normalize.js";
import { dedupe } from "./lib/dedupe.js";
import { readSnapshot, snapshotDate } from "./snapshot.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHARDS = 16;
// Bump when the way descriptions are turned into overviews changes, so the
// next run reads every posting again instead of reusing old overviews.
export const DETAIL_VERSION = 2;

function args(argv) {
  const a = { maxAge: 60, strict: false, poll: true, snapshot: null, maxBoards: 400, out: path.join(HERE, "..", "public"), demo: false, now: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--strict") a.strict = true;
    else if (v === "--no-poll") a.poll = false;
    else if (v === "--demo") a.demo = true;
    else if (v === "--snapshot") a.snapshot = argv[++i];
    else if (v === "--max-age") a.maxAge = Number(argv[++i]);
    else if (v === "--max-boards") a.maxBoards = Number(argv[++i]);
    else if (v === "--out") a.out = argv[++i];
    else if (v === "--now") a.now = argv[++i];
    else if (v === "--force") a.force = true;
    else throw new Error(`Unknown option: ${v}`);
  }
  return a;
}

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const item = items[i++]; await fn(item); }
  }));
}

const boardKey = (b) => `${b.ats}:${String(b.token).toLowerCase()}`;

/* Descriptions already read on an earlier run, by listing id. */
export function loadPrevious(dir) {
  const map = new Map();
  try {
    const index = JSON.parse(fs.readFileSync(path.join(dir, "jobs.json"), "utf8"));
    if (index.detailVersion !== DETAIL_VERSION) return map;
    const shards = {};
    for (const j of index.jobs || []) {
      shards[j.s] ??= JSON.parse(fs.readFileSync(path.join(dir, "jobs", `d-${String(j.s).padStart(2, "0")}.json`), "utf8"));
      const detail = shards[j.s][j.id];
      if (detail?.summary) map.set(j.id, { detail, pay: j.min ? { min: j.min, max: j.max, extra: j.extra || "" } : null, level: j.level || "" });
    }
  } catch { /* no earlier run, or an unreadable one: read everything fresh */ }
  return map;
}

export async function run(opts) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const log = opts.quiet ? () => {} : (...m) => console.log(...m);
  // Reading descriptions needs the network, so it follows polling unless set.
  const fetchDetails = opts.fetchDetails ?? opts.poll;
  const requireDetail = opts.requireDetail ?? fetchDetails;
  const raws = [];
  const stats = { scanned: 0, candidates: 0, boardsPolled: 0, boardsFailed: [], drops: {}, sources: {}, details: { read: {}, reused: 0, missing: {}, via: {}, examples: [] } };
  const drop = (reason) => { stats.drops[reason] = (stats.drops[reason] || 0) + 1; };
  clearBoardCache();
  resetDetailState();

  // 1. Snapshot
  let snapshotRows = [];
  let snapshotAt = null;
  if (opts.snapshot) {
    const { rows, scanned } = readSnapshot(opts.snapshot);
    snapshotRows = rows; stats.scanned = scanned; snapshotAt = snapshotDate(opts.snapshot);
    log(`snapshot: ${scanned.toLocaleString()} postings scanned, ${rows.length.toLocaleString()} with a candidate title`);
  }

  // 2. Poll the curated boards, plus every board where the snapshot has a
  //    posting that could make the board (title, US location, age), busiest
  //    first. Boards with nothing but foreign or old postings are skipped.
  const polled = new Set();
  if (opts.poll) {
    const boards = new Map(CURATED.map((b) => [boardKey(b), b]));
    const relevant = new Map();
    for (const r of snapshotRows) {
      if (!ADAPTERS[r.ats] || r.recruiter || SKIP_BOARDS.has(r.token.toLowerCase())) continue;
      if (normalize(r, { now, maxAgeDays: opts.maxAge }).drop) continue;
      const k = boardKey(r);
      const e = relevant.get(k) || { ats: r.ats, token: r.token, n: 0 };
      e.n++;
      relevant.set(k, e);
    }
    for (const b of [...relevant.values()].sort((x, y) => y.n - x.n)) {
      if (boards.size >= opts.maxBoards) break;
      boards.set(boardKey(b), { ats: b.ats, token: b.token });
    }
    const list = [...boards.values()].filter((b) => ADAPTERS[b.ats]);
    log(`polling ${list.length} boards`);
    await pool(list, 8, async (b) => {
      try {
        const postings = await ADAPTERS[b.ats](b);
        polled.add(boardKey(b)); stats.boardsPolled++;
        raws.push(...postings);
      } catch (err) {
        stats.boardsFailed.push(`${boardKey(b)} (${err.message})`);
      }
    });
    if (stats.boardsFailed.length) log(`  ${stats.boardsFailed.length} boards could not be read; their snapshot rows are kept`);
  }
  for (const r of snapshotRows) if (!polled.has(boardKey(r))) raws.push(r);
  stats.candidates = raws.length;

  // 3. Hand-checked notes: pay and excerpts confirmed by a person on a date.
  const verifiedFile = opts.verified === undefined ? path.join(HERE, "data", "verified.json") : opts.verified;
  const verified = verifiedFile && fs.existsSync(verifiedFile) ? JSON.parse(fs.readFileSync(verifiedFile, "utf8")) : [];
  const byUrl = new Map(raws.map((r) => [String(r.url).split("?")[0], r]));
  for (const v of verified) {
    const hit = byUrl.get(String(v.url).split("?")[0]);
    if (hit) {
      if (!hit.pay && v.pay) hit.pay = v.pay;
      if (!hit.html && v.detail) hit.detailNote = v.detail;
      if (v.companyName) hit.companyName = v.companyName;
    } else if (v.standalone) {
      raws.push({ ats: v.ats, token: v.token, externalId: v.url, title: v.title, department: "", locations: v.locations, remoteFlag: v.remote === true ? true : null, workplace: v.workplace || "", html: "", postedAt: v.checked, url: v.url, applyUrl: v.url, pay: v.pay || null, companyName: v.companyName || null, detailNote: v.detail || null });
    }
  }

  // 4. Every rule except the description one first, so descriptions are read
  //    only for postings that will otherwise make the board.
  const kept = [];
  for (const raw of raws) {
    const res = normalize(raw, { now, maxAgeDays: opts.maxAge, geoFilter: true });
    if (res.drop) drop(res.drop);
    else kept.push({ raw, job: res.job });
  }
  const label = (raw) => SOURCE_LABEL[raw.ats] || raw.ats;
  const missing = kept.filter((k) => !k.job.detail.summary);
  if (missing.length) {
    const previous = opts.previous ? loadPrevious(opts.previous) : new Map();
    const toRead = [];
    for (const k of missing) {
      const cached = previous.get(stableId(k.raw));
      if (cached) { k.raw.cached = cached; stats.details.reused++; }
      else toRead.push(k);
    }
    if (fetchDetails && toRead.length) {
      // Newest first, so that if a source stops answering partway through,
      // the freshest roles are the ones already read.
      toRead.sort((a, b) => String(b.job.posted).localeCompare(String(a.job.posted)));
      log(`reading ${toRead.length} job descriptions`);
      await pool(toRead, 10, async (k) => {
        const d = await fetchDetail(k.raw).catch(() => null);
        if (!d) return;
        k.raw.html = d.html;
        if (!k.raw.pay && d.pay) k.raw.pay = d.pay;
        if (d.employmentType && !k.raw.employmentType) k.raw.employmentType = d.employmentType;
        stats.details.read[label(k.raw)] = (stats.details.read[label(k.raw)] || 0) + 1;
        stats.details.via[d.via] = (stats.details.via[d.via] || 0) + 1;
      });
    }
  }

  // 5. The full rules, including the description one; merge, sort.
  const jobs = [];
  for (const { raw } of kept) {
    const res = normalize(raw, { now, maxAgeDays: opts.maxAge, requireSalary: opts.strict, geoFilter: true, requireDetail });
    if (res.drop) {
      drop(res.drop);
      if (res.drop === "no job description could be read") {
        stats.details.missing[label(raw)] = (stats.details.missing[label(raw)] || 0) + 1;
        if (stats.details.examples.length < 12) stats.details.examples.push(`${label(raw)} ${raw.url} (${raw.detailError || "not read"})`);
      }
      continue;
    }
    jobs.push(res.job);
  }
  const merged = dedupe(jobs).sort((a, b) => String(b.posted || "").localeCompare(String(a.posted || "")) || a.company.localeCompare(b.company));
  for (const j of merged) stats.sources[j.source] = (stats.sources[j.source] || 0) + 1;

  return { jobs: merged, stats, generatedAt: now.toISOString(), snapshotAt, maxAgeDays: opts.maxAge };
}

export function write(result, outDir, { force = false } = {}) {
  const { jobs } = result;
  if (!jobs.length) throw new Error("The run produced no listings; refusing to overwrite the board with an empty file.");
  // A source that breaks overnight should not empty the board. If today's
  // board is less than half of yesterday's, keep yesterday's and fail loudly.
  let before = 0;
  try { before = JSON.parse(fs.readFileSync(path.join(outDir, "jobs.json"), "utf8")).count || 0; } catch { /* first run */ }
  if (!force && before >= 40 && jobs.length < before / 2) throw new Error(`The run found ${jobs.length} listings against ${before} last time; refusing to replace the board. Run with --force if the drop is expected.`);
  fs.mkdirSync(path.join(outDir, "jobs"), { recursive: true });
  const shards = Array.from({ length: SHARDS }, () => ({}));
  const index = jobs.map((j) => {
    const s = parseInt(j.id.slice(0, 2), 16) % SHARDS;
    shards[s][j.id] = j.detail;
    const { detail, board, ats, ...light } = j;
    return { ...light, s };
  });
  const families = Object.fromEntries(FAMILIES.map((f) => [f, jobs.filter((j) => j.family === f).length]));
  const fields = Object.fromEntries(FIELDS.map((f) => [f, jobs.filter((j) => j.field === f).length]));
  fs.writeFileSync(path.join(outDir, "jobs.json"), JSON.stringify({ generatedAt: result.generatedAt, snapshotAt: result.snapshotAt, maxAgeDays: result.maxAgeDays, detailVersion: DETAIL_VERSION, count: jobs.length, withPay: jobs.filter((j) => j.min).length, families, fields, sources: result.stats.sources, jobs: index }));
  for (const f of fs.readdirSync(path.join(outDir, "jobs"))) if (/^d-\d+\.json$/.test(f)) fs.unlinkSync(path.join(outDir, "jobs", f));
  shards.forEach((s, i) => fs.writeFileSync(path.join(outDir, "jobs", `d-${String(i).padStart(2, "0")}.json`), JSON.stringify(s)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = args(process.argv.slice(2));
  if (opts.demo) { opts.snapshot = opts.snapshot || path.join(HERE, "test", "fixtures", "snapshot"); }
  opts.previous = opts.out;
  run(opts).then((result) => {
    write(result, opts.out, { force: opts.force });
    const { stats, jobs } = result;
    console.log(`\n${stats.candidates.toLocaleString()} candidates → ${jobs.length} listings (${jobs.filter((j) => j.min).length} with published pay)`);
    console.log("by source:", stats.sources);
    console.log("by role type:", Object.fromEntries(FAMILIES.map((f) => [f, jobs.filter((j) => j.family === f).length])));
    console.log("by industry:", Object.fromEntries(FIELDS.map((f) => [f, jobs.filter((j) => j.field === f).length])));
    console.log("by job type:", Object.fromEntries(LEVELS.map((f) => [f, jobs.filter((j) => j.level === f).length])));
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    const d = stats.details;
    console.log(`descriptions: ${sum(d.read)} read from postings today`, d.read, `| ${d.reused} reused from the last run`);
    console.log("  read through:", d.via);
    if (sum(d.missing)) {
      console.log(`  ${sum(d.missing)} could not be read, so those listings were left off:`, d.missing);
      for (const e of d.examples) console.log(`    ${e}`);
    }
    console.log("dropped:", stats.drops);
    // The open dataset is refreshed daily. If its date is old, say so loudly
    // so a stalled source shows up in the run log.
    if (result.snapshotAt && (Date.now() - Date.parse(result.snapshotAt)) / 864e5 > 3) console.warn(`WARNING: the open dataset was last updated ${result.snapshotAt}; listings may be behind.`);
    console.log(`boards polled: ${stats.boardsPolled}, failed: ${stats.boardsFailed.length}`);
  }).catch((err) => { console.error(err.message); process.exit(1); });
}
