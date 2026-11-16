# Fluent — a job board for the non-engineering side of AI

A sibling of Renewal (renewalcs.com), built the same way: a small collector reads employers' own hiring systems every night and writes `public/jobs.json`; a React site displays it. The name, Fluent, was chosen on 15 November 2026; no domain or trademark check has been done yet.

## What is in here

| Folder | What it does |
| --- | --- |
| `src/` | The site (React + Vite), in the B1 · Slate theme. Settings are at the top of `src/App.jsx`; colours are variables at the top of `src/styles.css`. |
| `ingest/` | The collector. `build.js` runs it; `adapters.js` reads Greenhouse, Lever, Ashby and Workable; `snapshot.js` reads an open daily dataset that also covers Workday and iCIMS; `lib/` holds the rules. |
| `ingest/test/` | The test suite, with a local stand-in for the hiring systems. |
| `public/` | `jobs.json` and the detail files the site loads, rewritten by every run. `news.json` holds the News page: edit it by hand. |
| `.github/workflows/ingest.yml` | The nightly run. |

## Rules the collector enforces

- Only titles on the non-engineering side of AI (`ingest/lib/classify.js`): enablement and adoption, deployment and solutions, strategy, operations and automation, governance and risk, AI leads and specialists, AI product managers, and heads of AI. Switches at the top of that file turn each group on or off.
- Internships, graduate, junior and contract roles are kept and tagged "Entry level" or "Contract" from the title. Data-labelling gigs ("AI trainer", annotation, paid-by-the-task model training) stay out, as do unpaid and fellowship posts.
- Each listing is tagged with an industry when its title or employer makes that plain (healthcare, financial services, legal, HR, education, public sector).
- US roles only. A location that cannot be placed is dropped, not guessed.
- Pay, tools and audience appear only when the employer published them. Nothing is estimated.
- Apply links must open the posting itself, never a careers homepage.
- A posting older than 60 days, or with no date, is dropped (`--max-age` changes it; `--strict` also drops roles with no published salary). The site applies the same 60-day limit when it loads, so listings age off even if a run is missed.
- Postings on an employer's internal-only careers site are skipped.
- Staffing-agency reposts and data-labelling gig boards are skipped.

## Running it

```
npm install
npm test                                   # 25 tests
npm run dev                                # the site, at http://localhost:5173

# Collect listings (needs internet access to the hiring systems):
git clone --depth 1 https://github.com/Feashliaa/job-board-data /tmp/job-board-data
npm run ingest -- --snapshot /tmp/job-board-data

npm run build                              # the site, ready to host, in dist/
```

## Before launch

1. **Name and domain.** Change `BRAND.name` and `BRAND.title` in `src/App.jsx`, and the title in `index.html`. Set `BRAND.siteUrl`.
1. **Daily refresh.** Put this folder in a GitHub repository. `.github/workflows/ingest.yml` is set up like Renewal's: once a day at 06:00 UTC it tests, collects, checks the build and commits `Board refresh: N live roles`. Connect the repository to your host (Vercel or Netlify, as with Renewal) so each commit redeploys the site.
2. **Collector contact.** In GitHub, add a repository variable `COLLECTOR_UA`, for example `FluentJobBoard/1.0 (contact: you@yourdomain.com)`. Until then the collector sends a placeholder contact.
3. **Forms.** Set `BRAND.formEndpoint` (post a job) and `BRAND.newsletterEndpoint` (the email signup on the News page). Both are Formspree addresses, as on Renewal. Until then both forms say they are not connected, and nothing is sent.
4. **Contact and checkout.** Set `BRAND.contactEmail` and `BRAND.featuredCheckout` (Gumroad). Review the prices in `AD_OFFERS`: they are copied from Renewal.
5. **First live run.** Run the "Refresh listings" workflow by hand from the Actions tab and read its summary. The four adapters are tested against stand-ins here; this is their first contact with the real systems.

## Hand-checked notes

`ingest/data/verified.json` holds pay ranges and short summaries that a person confirmed on a posting, with the date. They are applied only to a posting the collector also finds open, unless marked `standalone`. Remove a note when its posting closes.
