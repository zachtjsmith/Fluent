/* ============================================================================
   snapshot.js — reads an open, daily-refreshed dataset of employer postings.

   The four adapters only see boards we already know about, and they cannot
   read Workday or iCIMS, where many large employers post. This reader fills
   both gaps. It walks a public dataset of postings collected from employers'
   own hiring systems (job-board-data, MIT licence: see data/NOTICE.md) and
   keeps the handful of titles that could belong on the board.

   What the dataset gives per posting: title, location, link, hiring system,
   board name and the date it was first seen. It carries no description, so a
   listing that comes only from here has no excerpts and no pay. Its salary
   field is an estimate, and this board never shows estimates, so it is
   ignored.

   Boards found here that one of the adapters can read are then polled
   directly by build.js, which brings back the full posting and any published
   pay.
   ========================================================================== */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { maybeRelevant } from "./lib/classify.js";

const ATS = { Greenhouse: "greenhouse", Lever: "lever", Ashby: "ashby", Workable: "workable", Workday: "workday", iCIMS: "icims", BambooHR: "bamboohr", Paylocity: "paylocity", Join: "join" };

export function chunkFiles(dir) {
  const chunks = path.join(dir, "data", "chunks");
  const base = fs.existsSync(chunks) ? chunks : dir;
  return fs.readdirSync(base).filter((f) => /\.json(\.gz)?$/.test(f) && /chunk/.test(f)).sort().map((f) => path.join(base, f));
}

export function snapshotDate(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "data", "metadata.json"), "utf8")).last_updated || null; } catch { return null; }
}

/* Reads every chunk and returns the raw postings worth classifying. */
export function readSnapshot(dir) {
  const out = [];
  let scanned = 0;
  for (const file of chunkFiles(dir)) {
    const buf = fs.readFileSync(file);
    const rows = JSON.parse(file.endsWith(".gz") ? zlib.gunzipSync(buf) : buf);
    for (const r of rows) {
      scanned++;
      if (!r || !r.title || !r.url || !maybeRelevant(r.title)) continue;
      const ats = ATS[r.ats];
      if (!ats) continue;
      out.push({
        fromSnapshot: true, recruiter: r.is_recruiter === true,
        ats, token: String(r.company || ""), externalId: String(r.url), title: String(r.title),
        department: "", locations: [String(r.location || "")],
        remoteFlag: r.remote === true ? true : null, workplace: r.workplaceType || "",
        html: "", postedAt: r.first_seen || r.scraped_at || null,
        url: r.url, applyUrl: r.url, pay: null, companyName: null,
      });
    }
  }
  return { rows: out, scanned };
}
