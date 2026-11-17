// Temporary: measures how fast Workday's job data can be read before it says 429.
import fs from "node:fs";
import { workdayDataUrl } from "../details.js";
const UA = process.env.COLLECTOR_UA || "FluentJobBoard/1.0 (contact: CHANGE-ME@example.com)";
const index = JSON.parse(fs.readFileSync("public/jobs.json", "utf8"));
const urls = [];
for (const j of index.jobs.filter((x) => x.source === "Workday")) {
  const shard = JSON.parse(fs.readFileSync(`public/jobs/d-${String(j.s).padStart(2, "0")}.json`, "utf8"));
  const u = workdayDataUrl(shard[j.id].postingUrl);
  if (u) urls.push(u);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let k = 0;
async function phase(name, n, gap) {
  console.log(`\n--- ${name}: ${n} requests, one every ${gap} ms`);
  for (let i = 0; i < n && k < urls.length; i++, k++) {
    const t0 = Date.now();
    let line;
    try {
      const res = await fetch(urls[k], { headers: { "User-Agent": UA, Accept: "application/json" } });
      const h = (x) => res.headers.get(x);
      const body = await res.text();
      line = `${res.status} ${Date.now() - t0}ms retry-after=${h("retry-after")} ratelimit=${h("x-ratelimit-remaining") ?? h("ratelimit-remaining")} server=${h("server")} cf=${h("cf-ray") ? "yes" : "no"} len=${body.length}${res.ok ? "" : " body=" + body.slice(0, 100).replace(/\s+/g, " ")}`;
    } catch (e) { line = `ERR ${e.message}`; }
    console.log(`${new Date().toISOString().slice(11, 19)} ${new URL(urls[k]).host} ${line}`);
    await sleep(gap);
  }
}
console.log(`${urls.length} Workday postings`);
await phase("A", 12, 1000);
await phase("pause", 0, 0);
await sleep(30000);
await phase("B", 12, 3000);
await sleep(30000);
await phase("C", 12, 6000);
