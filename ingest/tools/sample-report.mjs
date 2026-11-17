// Temporary: prints sample overviews per source from a collector output folder.
import fs from "node:fs";
import path from "node:path";
const dir = process.argv[2];
const index = JSON.parse(fs.readFileSync(path.join(dir, "jobs.json"), "utf8"));
const shards = {};
const detail = (j) => (shards[j.s] ??= JSON.parse(fs.readFileSync(path.join(dir, "jobs", `d-${String(j.s).padStart(2, "0")}.json`), "utf8")))[j.id];
console.log(`listings ${index.count} | with pay ${index.withPay} | detailVersion ${index.detailVersion}`);
console.log("by source", index.sources);
const lv = {}; for (const j of index.jobs) lv[j.level || "-"] = (lv[j.level || "-"] || 0) + 1; console.log("by job type", lv);
const bySource = {};
for (const j of index.jobs) (bySource[j.source] ??= []).push(j);
for (const [src, list] of Object.entries(bySource)) {
  console.log(`\n=== ${src} (${list.length})`);
  const step = Math.max(1, Math.floor(list.length / 5));
  for (const j of list.filter((_, i) => i % step === 0).slice(0, 5)) {
    const d = detail(j);
    console.log(`- ${j.company} | ${j.title} | pay ${j.min ? `${j.min}-${j.max} ${j.extra}` : "-"} | ${j.level || ""}`);
    console.log(`  OVERVIEW (${d.summary.length}): ${d.summary}`);
    console.log(`  does ${d.does.length}: ${(d.does[0] || "").slice(0, 110)} | wants ${d.wants.length}: ${(d.wants[0] || "").slice(0, 110)}`);
  }
}
const lens = index.jobs.map((j) => detail(j).summary.length).sort((a, b) => a - b);
console.log(`\noverview length: min ${lens[0]}, median ${lens[Math.floor(lens.length / 2)]}, max ${lens[lens.length - 1]}`);
const short = index.jobs.filter((j) => detail(j).summary.length < 90);
console.log(`short overviews (<90 chars): ${short.length}`);
for (const j of short.slice(0, 12)) console.log(`  ${j.source} | ${j.company} | ${j.title} | ${detail(j).summary}`);
const odd = index.jobs.filter((j) => /^(we are|at [A-Z]|about|our |join )/i.test(detail(j).summary) && !/\b(you|this role|the role|position)\b/i.test(detail(j).summary));
console.log(`overviews that may be company intros: ${odd.length}`);
for (const j of odd.slice(0, 12)) console.log(`  ${j.source} | ${j.company} | ${detail(j).summary.slice(0, 200)}`);
