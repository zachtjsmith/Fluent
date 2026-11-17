# Fluent — a job board for the non-engineering side of AI

A sibling of Renewal (renewalcs.com), built the same way: a small collector reads employers' own hiring systems every night and writes `public/jobs.json`; a React site displays it. The name, Fluent, was chosen on 15 November 2026; no domain or trademark check has been done yet.

## What is in here

| Folder | What it does |
| --- | --- |
| `src/` | The site (React + Vite), in the B1 · Slate theme. Settings are at the top of `src/App.jsx`; colours are variables at the top of `src/styles.css`. |
| `ingest/` | The collector. `build.js` runs it; `adapters.js` reads Greenhouse, Lever, Ashby and Workable boards; `snapshot.js` reads an open daily dataset that also covers Workday, iCIMS, BambooHR, Paylocity and JOIN; `details.js` reads the full description of any posting that arrived without one; `lib/` holds the rules. |
| `ingest/test/` | The test suite, with a local stand-in for the hiring systems. |
| `public/` | `jobs.json` and the detail files the site loads, rewritten by every run. `news.json` holds the News page: edit it by hand. |
| `.github/workflows/ingest.yml` | The nightly run. |

## Rules the collector enforces

- Only titles on the non-engineering side of AI (`ingest/lib/classify.js`): enablement and adoption, deployment and solutions, strategy, operations and automation, governance and risk, AI leads and specialists, AI product managers, and heads of AI. Switches at the top of that file turn each group on or off.
- Internships, graduate, junior and contract roles are kept and tagged "Entry level" or "Contract" from the title. Data-labelling gigs ("AI trainer", annotation, paid-by-the-task model training) stay out, as do unpaid and fellowship posts.
- Each listing is tagged with an industry when its title or employer makes that plain (healthcare, financial services, legal, HR, education, public sector).
- US roles only. A location that cannot be placed is dropped, not guessed.
- Every listing shows an overview of its own job description: the posting's own sentences about the role, plus what the job involves and what the employer asks for. A posting whose description cannot be read is not listed. Descriptions read on an earlier run are reused, so a site that is briefly down does not make a role disappear.
- Pay, tools and audience appear only when the employer published them. Nothing is estimated.
- Apply links must open the posting itself, never a careers homepage.
- A posting older than 60 days, or with no date, is dropped (`--max-age` changes it; `--strict` also drops roles with no published salary). The site applies the same 60-day limit when it loads, so listings age off even if a run is missed.
- Postings on an employer's internal-only careers site are skipped.
- Staffing-agency reposts and data-labelling gig boards are skipped.
- If a run finds fewer than half of the previous run's listings, it stops without replacing the board (`--force` overrides), so a source that breaks overnight cannot empty the site.

## Running it

```
npm install
npm test                                   # 31 tests
npm run dev                                # the site, at http://localhost:5173

# Collect listings (needs internet access to the hiring systems):
git clone --depth 1 https://github.com/Feashliaa/job-board-data /tmp/job-board-data
npm run ingest -- --snapshot /tmp/job-board-data

npm run build                              # the site, ready to host, in dist/
```

## Daily refresh

`.github/workflows/ingest.yml` is set up like Renewal's: every day at 06:00 UTC it installs, runs the tests, collects, checks the site still builds and commits `Board refresh: N live roles`. It can also be run by hand from the Actions tab ("Refresh job board" → Run workflow). The first run, on 16 November 2026 (UTC), polled 391 employer boards directly (9 failed and fell back to the open dataset) and published 503 listings, 118 with pay the employer published.

## Before launch

1. **Hosting.** In Netlify (as with Renewal), add a new site from this GitHub repository. `netlify.toml` already holds the build settings, so nothing needs typing in. Netlify then redeploys after every daily refresh. Vercel also works (`vercel.json`).
2. **Domain.** Point the domain at the host and set `BRAND.siteUrl` in `src/App.jsx`. The name is set in `BRAND.name`, `BRAND.title` and `index.html`.
3. **Collector contact.** In GitHub, add a repository variable `COLLECTOR_UA` (Settings → Secrets and variables → Actions → Variables), for example `FluentJobBoard/1.0 (contact: you@yourdomain.com)`. Employers' hiring systems see it with every request. Until then the collector sends a placeholder contact.
4. **Forms.** Set `BRAND.formEndpoint` (post a job) and `BRAND.newsletterEndpoint` (the email signup on the News page). Both are Formspree addresses, as on Renewal. Until then both forms say they are not connected, and nothing is sent.
5. **Contact and checkout.** Set `BRAND.contactEmail` and `BRAND.featuredCheckout` (Gumroad). Review the prices in `AD_OFFERS`: they are copied from Renewal.

## Hand-checked notes

`ingest/data/verified.json` holds pay ranges and short summaries that a person confirmed on a posting, with the date. They are applied only to a posting the collector also finds open, unless marked `standalone`. Remove a note when its posting closes.
