import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ============================================================================
   SETTINGS — everything you are likely to change is in this block.
   ========================================================================== */

const BRAND = {
  name: "fluent", // the wordmark in the header. To rename: change these two lines and index.html
  title: "Fluent", // the name as written in page titles and sentences
  tagline: "AI adoption jobs and everything in between.",
  siteUrl: "", // e.g. "https://www.yourdomain.com" (used for canonical links)
  contactEmail: "", // shown on Advertise and Privacy once set
  formEndpoint: "", // Formspree address for the post-a-job form
  newsletterEndpoint: "", // Formspree (or similar) address for the email signup on the News page
  featuredCheckout: "", // Gumroad link for the featured listing
};

/* Rate card. Copied from Renewal as a starting point: change freely. */
const AD_OFFERS = [
  { name: "Featured listing", price: "$39", unit: "", line: "Your role pinned at the top of the board." },
  { name: "News sponsor", price: "$89", unit: "a week", line: "The sponsor line at the top of the News page." },
  { name: "Board rail", price: "$299", unit: "a month", line: "The 300 × 250 space beside the listings." },
];

/* Role types and industries, in the order the filters show them. They must
   match ingest/lib/classify.js. */
const FAMILIES = ["Enablement & Adoption", "Deployment & Solutions", "Strategy & Transformation", "Operations & Automation", "Governance & Risk", "AI Leads & Specialists", "Leadership", "Product"];
const FIELDS = ["Healthcare & Life Sciences", "Financial Services", "Legal", "HR & People", "Education", "Public Sector"];
const LEVELS = ["Entry level", "Contract"];
const PAGE_SIZE = 20; // rows shown before "Show more"
const MAX_AGE_DAYS = 60; // a listing older than this is never shown, even if the nightly run stalls
const BASE = import.meta.env.BASE_URL;
const HASH_ROUTER = typeof __HASH_ROUTER__ !== "undefined" && __HASH_ROUTER__;

const PATHS = { jobs: "/", news: "/news", blog: "/blog", advertise: "/advertise", about: "/about", privacy: "/privacy" };
const OLD_PATHS = { newsletter: "news", templates: "blog" }; // earlier addresses still land somewhere sensible
const NAV = [["jobs", "Jobs"], ["news", "News"], ["blog", "Blog"], ["advertise", "Advertise"]];
const TITLES = {
  jobs: `${BRAND.title} — AI adoption jobs and everything in between`,
  news: `AI at work: this week's news — ${BRAND.title}`,
  blog: `Blog — ${BRAND.title}`,
  advertise: `Advertise or post an AI job — ${BRAND.title}`,
  about: `About ${BRAND.title} — a job board for the non-engineering side of AI`,
  privacy: `Privacy — ${BRAND.title}`,
};

/* Shown only if jobs.json cannot be loaded (first deploy, local preview).
   These are made-up examples, and the page says so. */
const SAMPLE = [
  { id: "s1", title: "AI Enablement Lead", company: "Northloop", family: "Enablement & Adoption", field: "", locations: [{ label: "Remote — US", mode: "Remote" }], mode: "Remote", min: 150000, max: 185000, extra: "+ bonus", posted: null, source: "Greenhouse", featured: true, hasDetail: false },
  { id: "s2", title: "AI Adoption Manager", company: "Parcelay", family: "Enablement & Adoption", field: "Financial Services", locations: [{ label: "Chicago, IL", mode: "Hybrid" }], mode: "Hybrid", min: null, max: null, extra: "", posted: null, source: "Lever", featured: false, hasDetail: false },
  { id: "s3", title: "Deployment Strategist", company: "Kestrel AI", family: "Deployment & Solutions", field: "", locations: [{ label: "San Francisco, CA", mode: "" }], mode: "", min: 160000, max: 210000, extra: "+ equity", posted: null, source: "Ashby", featured: false, hasDetail: false },
];

/* ============================================================================
   Small helpers
   ========================================================================== */

const money = (n) => "$" + Math.round(n / 1000) + "k";
const payLabel = (j) => (j.min ? `${money(j.min)}–${money(j.max)}` : "See job listing");
const MARKS = ["#35506F", "#6B5530", "#5A4B78", "#2E5A63", "#7A3E2B", "#1F5A44", "#4A5A26", "#6B2C4D"];
const markColor = (name) => MARKS[[...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % MARKS.length];
const initials = (name) => name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";

function ageDays(posted, today) {
  if (!posted) return null;
  // Whole calendar days, so a role first seen this morning reads "today".
  return Math.max(0, Math.round((Date.parse(String(today).slice(0, 10)) - Date.parse(String(posted).slice(0, 10))) / 864e5));
}
const ageLabel = (d) => (d === null ? "" : d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`);
const whereLabel = (j) => {
  const first = j.locations[0]?.label || "";
  return j.locations.length > 1 && !/more$/.test(first) ? `${first} + ${j.locations.length - 1} more` : first;
};
const isRemote = (j) => j.mode === "Remote" || j.locations.some((l) => l.mode === "Remote");

function tabFromLocation() {
  if (HASH_ROUTER) {
    const h = window.location.hash.replace(/^#/, "");
    return PATHS[h] ? h : OLD_PATHS[h] || "jobs";
  }
  const p = window.location.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  return Object.keys(PATHS).find((k) => PATHS[k] === p) || OLD_PATHS[p.slice(1)] || "jobs";
}
const hrefFor = (tab) => (HASH_ROUTER ? (tab === "jobs" ? "#jobs" : `#${tab}`) : PATHS[tab]);

/* A real link that switches tab without reloading the page. */
function TabLink({ to, go, className, children, current }) {
  return (
    <a href={hrefFor(to)} className={className} aria-current={current ? "page" : undefined}
      onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); go(to); }}>
      {children}
    </a>
  );
}

async function postJson(url, payload) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(String(res.status));
}

/* ============================================================================
   Jobs
   ========================================================================== */

function Subscribe({ idPrefix, primary }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState("idle"); // idle | sending | done | error | off | invalid
  const submit = async (e) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setState("invalid");
    if (!BRAND.newsletterEndpoint) return setState("off");
    setState("sending");
    try { await postJson(BRAND.newsletterEndpoint, { email }); setState("done"); } catch { setState("error"); }
  };
  return (
    <form onSubmit={submit} noValidate>
      <div className="row">
        <div className="field" style={{ flex: "999 1 220px" }}>
          <label htmlFor={`${idPrefix}-email`}>Email address</label>
          <input id={`${idPrefix}-email`} className="input inset" type="email" autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => { setEmail(e.target.value); setState("idle"); }} />
        </div>
        <button type="submit" className={`btn ${primary ? "primary" : ""}`}>{state === "sending" ? "Sending…" : "Subscribe free"}</button>
      </div>
      <p role="status" className={`status ${state === "done" ? "" : "warn"}`} style={{ marginTop: 10, minHeight: 22 }}>
        {state === "done" && "You're on the list."}
        {state === "invalid" && "That doesn't look like an email address."}
        {state === "error" && "That didn't go through. Please try again."}
        {state === "off" && "Signups open at launch: this form isn't connected yet."}
      </p>
    </form>
  );
}

function Detail({ job, detail, loading, today, onBack }) {
  const facts = [
    ["Pay", job.min ? `${payLabel(job)}${job.extra ? ` ${job.extra}` : ""}` : "See job listing"],
    [job.locations.length > 1 ? "Locations" : "Location", job.locations.map((l) => l.label).join(" · ")],
    ["Work mode", job.mode],
    ["Audience", detail?.audience],
    ["Tools named", detail?.tools?.join(", ")],
    ["Area of AI", job.family],
    ["Industry", job.field],
    ["Job type", job.level],
    ["First seen", ageLabel(ageDays(job.posted, today))],
    ["Source", job.source === "Direct" ? "Sent by the employer" : `Employer's ${job.source} board`],
  ].filter(([, v]) => v);
  return (
    <article className="detail" aria-label="Selected role">
      <button type="button" className="btn small back" onClick={onBack}>← All roles</button>
      <div className="detail-top">
        <span className="mark" aria-hidden="true" style={{ background: markColor(job.company) }}>{initials(job.company)}</span>
        <div style={{ flex: "999 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <h2>{job.title}</h2>
          <p className="company">{job.company}</p>
        </div>
      </div>
      <dl className="facts">
        {facts.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
      </dl>
      {loading && <p className="meta-line">Loading the posting…</p>}
      {detail?.summary && <p style={{ maxWidth: "68ch" }}>{detail.summary}</p>}
      {(detail?.does?.length > 0 || detail?.wants?.length > 0) && (
        <div className="two-col">
          {detail.does.length > 0 && (<div><h3>From the posting: the work</h3><ul>{detail.does.map((d) => <li key={d}>{d}</li>)}</ul></div>)}
          {detail.wants.length > 0 && (<div><h3>From the posting: what they ask for</h3><ul>{detail.wants.map((d) => <li key={d}>{d}</li>)}</ul></div>)}
        </div>
      )}
      {detail && !job.hasDetail && (
        <p className="meta-line" style={{ maxWidth: "68ch" }}>We have this role's title, location and link from the employer's {job.source} board. The full description, and any pay the employer published, are on the posting itself.</p>
      )}
      <div className="actions">
        {detail?.applyUrl
          ? <a className="btn primary" href={detail.applyUrl} target="_blank" rel="noopener noreferrer">Apply on the employer's site</a>
          : !loading && <span className="meta-line">This is a sample listing, so there is nothing to apply to.</span>}
        {detail?.postingUrl && detail.postingUrl !== detail.applyUrl && <a className="btn" href={detail.postingUrl} target="_blank" rel="noopener noreferrer">Read the posting</a>}
      </div>
    </article>
  );
}

function JobsPage({ feed, news, go }) {
  const [q, setQ] = useState("");
  const [family, setFamily] = useState("All roles");
  const [field, setField] = useState("");
  const [level, setLevel] = useState("");
  const [sort, setSort] = useState("new");
  const [remote, setRemote] = useState(false);
  const [payOnly, setPayOnly] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [detail, setDetail] = useState({ id: null, data: null, loading: false });
  const shards = useRef(new Map());
  const today = feed.generatedAt || new Date().toISOString();

  const base = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return feed.jobs.filter((j) => {
      if (remote && !isRemote(j)) return false;
      if (payOnly && !j.min) return false;
      if (field && j.field !== field) return false;
      if (level && j.level !== level) return false;
      if (!words.length) return true;
      const hay = `${j.title} ${j.company} ${j.family} ${j.field || ""} ${j.level || ""} ${j.source} ${j.mode} ${j.locations.map((l) => l.label).join(" ")}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [feed.jobs, q, remote, payOnly, field, level]);

  const list = useMemo(() => {
    const rows = base.filter((j) => family === "All roles" || j.family === family);
    return [...rows].sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      if (sort === "pay") return (b.max || 0) - (a.max || 0);
      return String(b.posted || "").localeCompare(String(a.posted || ""));
    });
  }, [base, family, sort]);

  useEffect(() => { setShown(PAGE_SIZE); }, [q, family, field, level, sort, remote, payOnly]);

  const selected = list.find((j) => j.id === selectedId) || list[0] || null;

  // Load the selected role's detail from its shard (each shard is fetched once).
  useEffect(() => {
    if (!selected) return undefined;
    if (feed.sample) { setDetail({ id: selected.id, data: { summary: "", does: [], wants: [], tools: [], audience: "" }, loading: false }); return undefined;
    }
    let live = true;
    const key = String(selected.s).padStart(2, "0");
    const done = (shard) => { if (live) setDetail({ id: selected.id, data: shard[selected.id] || null, loading: false }); };
    if (shards.current.has(key)) { done(shards.current.get(key)); return undefined; }
    setDetail({ id: selected.id, data: null, loading: true });
    fetch(`${BASE}jobs/d-${key}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((shard) => { shards.current.set(key, shard); done(shard); });
    return () => { live = false; };
  }, [selected?.id, feed.sample]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearAll = () => { setQ(""); setFamily("All roles"); setField(""); setLevel(""); setRemote(false); setPayOnly(false); };
  const splitRef = useRef(null);
  const openRole = (id) => {
    setSelectedId(id); setSheetOpen(true);
    // On a phone the role opens as a full-width sheet: bring its top into view.
    if (window.matchMedia("(max-width: 900px)").matches) requestAnimationFrame(() => splitRef.current?.scrollIntoView({ block: "start" }));
  };
  const families = FAMILIES.filter((f) => feed.jobs.some((j) => j.family === f));
  const fields = FIELDS.filter((f) => feed.jobs.some((j) => j.field === f));
  const levels = LEVELS.filter((f) => feed.jobs.some((j) => j.level === f));
  const count = (name) => (name === "All roles" ? base.length : base.filter((j) => j.family === name).length);
  const updated = feed.generatedAt ? new Date(feed.generatedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";

  return (
    <main>
      <section className="wrap hero">
        <h1>{BRAND.tagline}</h1>
        <p className="meta-line">
          {feed.loading ? "Loading roles…" : `${feed.jobs.length.toLocaleString()} open roles · every one links to the employer's own posting · nothing older than ${MAX_AGE_DAYS} days${updated ? ` · updated ${updated}` : ""}`}
        </p>
      </section>

      <section className="wrap controls" aria-label="Find a role">
        <div className="row">
          <div className="field" style={{ flex: "999 1 280px" }}>
            <label htmlFor="q">Search roles</label>
            <input id="q" className="input" type="search" placeholder="Title, company or city" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="field" style={{ flex: "1 1 190px" }}>
            <label htmlFor="sort">Sort by</label>
            <select id="sort" className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="new">Newest first</option>
              <option value="pay">Highest pay first</option>
            </select>
          </div>
        </div>
        <div className="row">
          <div className="field" style={{ flex: "1 1 240px" }}>
            <label htmlFor="family">Area of AI</label>
            <select id="family" className="input" value={family} onChange={(e) => setFamily(e.target.value)}>
              {["All roles", ...families].map((name) => <option key={name} value={name}>{name === "All roles" ? "All areas" : name} ({count(name)})</option>)}
            </select>
          </div>
          {fields.length > 0 && (
            <div className="field" style={{ flex: "1 1 200px" }}>
              <label htmlFor="field">Industry</label>
              <select id="field" className="input" value={field} onChange={(e) => setField(e.target.value)}>
                <option value="">All industries</option>
                {fields.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          )}
          {levels.length > 0 && (
            <div className="field" style={{ flex: "1 1 170px" }}>
              <label htmlFor="level">Job type</label>
              <select id="level" className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="">All job types</option>
                {levels.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          )}
          <button type="button" className="btn" aria-pressed={remote} onClick={() => setRemote(!remote)}>Remote only</button>
          <button type="button" className="btn" aria-pressed={payOnly} onClick={() => setPayOnly(!payOnly)}>Pay listed</button>
        </div>
        <p className="meta-line" role="status">{list.length === 1 ? "1 role" : `${list.length.toLocaleString()} roles`}{list.length !== feed.jobs.length ? " match" : ""}</p>
      </section>

      <section ref={splitRef} className={`wrap split ${sheetOpen && selected ? "open" : ""}`}>
        <div className="list">
          {list.slice(0, shown).map((j) => {
            const days = ageDays(j.posted, today);
            const isNew = !j.featured && days !== null && days <= 2;
            return (
              <button key={j.id} type="button" className="job-row" aria-pressed={selected?.id === j.id} onClick={() => openRole(j.id)}>
                <span className="job-main">
                  <span className="job-title" title={j.title}>{j.title}</span>
                  <span className="job-sub">{j.company} · {whereLabel(j)}{j.mode && !new RegExp(j.mode, "i").test(whereLabel(j)) ? ` · ${j.mode}` : ""}</span>
                </span>
                <span className="job-side">
                  <span className={`pay ${j.min ? "" : "none"}`}>{payLabel(j)}</span>
                  <span className="ago">
                    {j.featured && <span className="tag featured">Featured</span>}
                    {isNew && <span className="tag new">New</span>}
                    {j.level && <span className="tag topic">{j.level}</span>}
                    {ageLabel(days)}
                  </span>
                </span>
              </button>
            );
          })}
          {list.length > shown && (
            <button type="button" className="btn show-more" onClick={() => setShown(shown + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, list.length - shown)} more <span>{shown} of {list.length.toLocaleString()} shown</span>
            </button>
          )}
          {!feed.loading && list.length === 0 && (
            <div className="empty">
              <p>No roles match that search.</p>
              <button type="button" className="btn small" onClick={clearAll}>Clear search and filters</button>
            </div>
          )}
        </div>
        {selected && <Detail job={selected} detail={detail.id === selected.id ? detail.data : null} loading={detail.id !== selected.id || detail.loading} today={today} onBack={() => setSheetOpen(false)} />}
      </section>

      <section className="wrap band" aria-label="News and advertising">
        <div className="card" style={{ flex: "999 1 420px" }}>
          <h2>AI at work: this week</h2>
          {news.items.length > 0
            ? <ul className="headlines">{news.items.slice(0, 3).map((n) => (<li key={n.url}><a href={n.url} target="_blank" rel="noopener noreferrer">{n.title}</a><span>{n.source}</span></li>))}</ul>
            : <p>Short overviews of the week's news on AI at work, each linked to the original article.</p>}
          <TabLink to="news" go={go} className="link-btn left">All news</TabLink>
        </div>
        <div className="ad-slot">
          <p>Available ad space</p>
          <p className="meta-line">300 × 250</p>
          <TabLink to="advertise" go={go} className="link-btn">See the rate card</TabLink>
        </div>
      </section>
    </main>
  );
}

/* ============================================================================
   Other pages
   ========================================================================== */

/* "2026-11-12" -> "Nov 12, 2026"; "2026-08" -> "Aug 2026"; anything else is shown as written. */
function longDate(iso) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(iso || "");
  if (!m) return iso || "";
  const d = new Date(`${m[1]}-${m[2]}-${m[3] || "01"}T12:00:00Z`);
  return d.toLocaleDateString("en-US", m[3] ? { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" } : { month: "short", year: "numeric", timeZone: "UTC" });
}

function NewsItem({ n }) {
  return (
    <article className="news-item">
      <p className="news-meta">{n.tag && <span className="tag topic">{n.tag}</span>}<span>{n.source}</span><span>{longDate(n.date)}</span></p>
      <h3><a href={n.url} target="_blank" rel="noopener noreferrer">{n.title}</a></h3>
      <p>{n.summary}</p>
      <a className="read" href={n.url} target="_blank" rel="noopener noreferrer">Read the article at {n.source} <span aria-hidden="true">↗</span></a>
    </article>
  );
}

/* The articles live in public/news.json: add, edit or remove entries there.
   Each overview is written in our own words and links to the original. */
function NewsPage({ news }) {
  const latest = news.items.filter((n) => n.group !== "background");
  const background = news.items.filter((n) => n.group === "background");
  return (
    <main className="wrap narrow page">
      <h1>AI at work: the news</h1>
      <p className="lede">A short overview of each story on how companies are adopting AI and hiring for it, with a link to the full article.</p>
      {news.updated && <p className="meta-line">Last updated {longDate(news.updated)} · overviews are ours, the reporting is theirs</p>}
      {news.loading && <p className="meta-line">Loading the news…</p>}
      {!news.loading && news.items.length === 0 && <p>No articles to show yet.</p>}
      {latest.length > 0 && <div className="news-list">{latest.map((n) => <NewsItem key={n.url} n={n} />)}</div>}
      {background.length > 0 && (<><h2>Background reading</h2><div className="news-list">{background.map((n) => <NewsItem key={n.url} n={n} />)}</div></>)}
      <div className="card" style={{ marginTop: 14 }}>
        <h2 style={{ marginTop: 0 }}>Get it by email</h2>
        <p>The week's news and new roles, once a week. One email, no account.</p>
        <Subscribe idPrefix="news" primary />
      </div>
    </main>
  );
}

function BlogPage() {
  return (
    <main className="wrap narrow page">
      <h1>Blog</h1>
      <p className="lede">Coming soon.</p>
    </main>
  );
}

function PostJobForm() {
  const [f, setF] = useState({ title: "", company: "", url: "", location: "", min: "", max: "", email: "" });
  const [errors, setErrors] = useState({});
  const [state, setState] = useState("idle");
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setState("idle"); };
  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    const min = Number(String(f.min).replace(/[$,\s]/g, "")); const max = Number(String(f.max).replace(/[$,\s]/g, ""));
    if (!f.title.trim()) er.title = "Add the job title.";
    if (!f.company.trim()) er.company = "Add the company name.";
    if (!/^https:\/\/[^/\s]+\/\S+/.test(f.url.trim())) er.url = "Link to the posting itself, starting with https://";
    if (!f.location.trim()) er.location = "Add a city and state, or Remote — US.";
    if (!(min >= 20000)) er.min = "A yearly figure in USD, for example 130000.";
    if (!(max >= min) || !max) er.max = "The top of the range, at least the bottom.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) er.email = "An email we can confirm the listing with.";
    setErrors(er);
    if (Object.keys(er).length) return;
    if (!BRAND.formEndpoint) return setState("off");
    setState("sending");
    try { await postJson(BRAND.formEndpoint, { ...f, min, max }); setState("done"); } catch { setState("error"); }
  };
  const field = (k, label, props = {}) => (
    <div className="field">
      <label htmlFor={`pj-${k}`}>{label}</label>
      <input id={`pj-${k}`} className="input inset" value={f[k]} onChange={set(k)} aria-invalid={errors[k] ? "true" : undefined} aria-describedby={errors[k] ? `pj-${k}-err` : undefined} {...props} />
      {errors[k] && <span id={`pj-${k}-err`} className="err">{errors[k]}</span>}
    </div>
  );
  return (
    <form className="card" onSubmit={submit} noValidate>
      <h2 style={{ marginTop: 0 }}>Post a job, free</h2>
      <p style={{ maxWidth: "62ch", fontSize: 14.5 }}>Roles sent this way need a salary range. We check each one by hand before it goes live.</p>
      <div className="form-grid">
        {field("title", "Job title", { placeholder: "AI Enablement Lead" })}
        {field("company", "Company")}
        {field("url", "Link to the posting", { type: "url", placeholder: "https://" })}
        {field("location", "Location", { placeholder: "Remote — US, or Austin, TX" })}
        {field("min", "Base salary, bottom", { inputMode: "numeric", placeholder: "130000" })}
        {field("max", "Base salary, top", { inputMode: "numeric", placeholder: "160000" })}
        {field("email", "Your email", { type: "email", placeholder: "you@company.com" })}
      </div>
      <div className="actions">
        <button type="submit" className="btn primary">{state === "sending" ? "Sending…" : "Submit listing"}</button>
        <p role="status" className={`status ${state === "done" ? "" : "warn"}`}>
          {state === "done" && "Thanks. We'll check it and email you when it's live."}
          {state === "error" && "That didn't go through. Please try again."}
          {state === "off" && "Submissions open at launch: this form isn't connected yet."}
        </p>
      </div>
    </form>
  );
}

function AdvertisePage() {
  return (
    <main className="wrap page">
      <h1 style={{ maxWidth: "24ch" }}>Reach the people who put AI to work</h1>
      <p className="lede">Post a role free, or book one of three paid placements.</p>
      <div className="grid3">
        {AD_OFFERS.map((o) => (
          <div className="card" key={o.name} style={{ gap: 6 }}>
            <h2 style={{ fontSize: 16, marginTop: 0 }}>{o.name}</h2>
            <p className="price">{o.price} {o.unit && <small>{o.unit}</small>}</p>
            <p style={{ fontSize: 14 }}>{o.line}</p>
            {o.name === "Featured listing" && BRAND.featuredCheckout
              ? <a className="btn small" style={{ marginTop: 8 }} href={BRAND.featuredCheckout} target="_blank" rel="noopener noreferrer">Book this slot</a>
              : BRAND.contactEmail
                ? <p className="meta-line" style={{ marginTop: 8 }}>To book, email <a href={`mailto:${BRAND.contactEmail}`}>{BRAND.contactEmail}</a></p>
                : <p className="meta-line" style={{ marginTop: 8 }}>Booking opens at launch.</p>}
          </div>
        ))}
      </div>
      <PostJobForm />
    </main>
  );
}

const COMPARE = [
  ["What's listed", "The non-engineering side of AI, in any industry: enablement and adoption, deployment, strategy, operations and automation, governance and risk, product management, and the people who lead AI. Internships, entry-level and contract roles are included and labelled.", "Every job in every field. You do the filtering."],
  ["Where listings come from", "Employers' own hiring systems, such as Greenhouse, Lever, Ashby, Workable and Workday, or the employer directly.", "Employers mixed in with reposts, staffing agencies and third-party recruiters."],
  ["Pay and tools", "Shown only when the employer published them. Never estimated.", "Pay is often missing, or estimated by the site."],
  ["Old and closed roles", `A posting older than ${MAX_AGE_DAYS} days is removed, and the board is rebuilt every day.`, "Can stay up long after the job is filled."],
  ["Applying", "One click to the posting on the employer's own site.", "Often through the board's own profile and application forms first."],
  ["Your information", "No account, no resume upload, no cookies.", "Often an account and a resume upload before you can apply."],
];

function AboutPage() {
  return (
    <main className="wrap page">
      <h1>About {BRAND.title}</h1>
      <p className="lede">A job board for the people who put AI to work without building the models: inside a company, or for its customers. It comes from Baseline, the makers of <a href="https://www.renewalcs.com" target="_blank" rel="noopener noreferrer">Renewal</a>, the customer success job board, and it follows the same rules.</p>
      <h2>How it differs from most big job boards</h2>
      <div className="table-box">
        <table className="compare">
          <thead><tr><th scope="col"><span className="sr-only">Topic</span></th><th scope="col">{BRAND.title}</th><th scope="col">Most big job boards</th></tr></thead>
          <tbody>{COMPARE.map(([a, b, c]) => (<tr key={a}><td>{a}</td><td>{b}</td><td>{c}</td></tr>))}</tbody>
        </table>
      </div>
      <h2>How a listing gets here</h2>
      <ol className="steps">
        <li>Every day we read job boards that employers run on their own hiring systems, directly and through an open dataset of those boards.</li>
        <li>We keep titles on the non-engineering side of AI and drop the rest: engineering, research and data roles, sales and marketing jobs at AI companies, data-labelling gigs and staffing-agency reposts.</li>
        <li>We tag the industry when the title or the employer makes it plain, so you can filter to healthcare, financial services, legal and others. Internships, junior and contract roles are labelled the same way, from the title.</li>
        <li>We keep roles in the United States. A location we cannot place is dropped, not guessed.</li>
        <li>We check that every Apply button opens the posting itself, not a careers homepage, and we remove anything first seen more than {MAX_AGE_DAYS} days ago.</li>
        <li>Employers can also send a role directly. Those need a salary range, and each one is checked by hand.</li>
      </ol>
    </main>
  );
}

function PrivacyPage() {
  return (
    <main className="wrap narrow page">
      <h1>Privacy</h1>
      <p className="lede">This site has no accounts, sets no cookies and runs no tracking scripts.</p>
      <h2>Applying</h2>
      <p>Apply buttons open the employer's own posting. Anything you send there goes to the employer, not to us.</p>
      <h2>Email signup and forms</h2>
      <p>If you sign up for the weekly email or send us a listing, we keep the email address you gave so we can reply or send that email. Every email has an unsubscribe link, and your address is never sold or shared.</p>
      <h2>News links</h2>
      <p>Articles on the News page open on the publisher's own site, which has its own privacy policy.</p>
      {BRAND.contactEmail && (<><h2>Your information</h2><p>Email <a href={`mailto:${BRAND.contactEmail}`}>{BRAND.contactEmail}</a> to ask what we hold about you, to correct it, or to have it deleted.</p></>)}
      <p className="meta-line">Last updated November 2026.</p>
    </main>
  );
}

/* ============================================================================
   App
   ========================================================================== */

export default function App() {
  const [tab, setTabState] = useState(tabFromLocation);
  const [feed, setFeed] = useState({ jobs: [], loading: true, sample: false, generatedAt: null });
  const [news, setNews] = useState({ items: [], updated: "", loading: true });

  const go = useCallback((next) => {
    const t = PATHS[next] ? next : "jobs";
    setTabState(t);
    if (HASH_ROUTER) { if (window.location.hash !== `#${t}`) window.location.hash = t; }
    else if (window.location.pathname !== PATHS[t]) window.history.pushState(null, "", PATHS[t]);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const sync = () => setTabState(tabFromLocation());
    window.addEventListener(HASH_ROUTER ? "hashchange" : "popstate", sync);
    return () => window.removeEventListener(HASH_ROUTER ? "hashchange" : "popstate", sync);
  }, []);

  // Each tab has its own title and canonical address; odd addresses are tidied.
  useEffect(() => {
    document.title = TITLES[tab];
    if (HASH_ROUTER) return;
    if (window.location.pathname !== PATHS[tab]) window.history.replaceState(null, "", PATHS[tab]);
    if (BRAND.siteUrl) {
      let link = document.querySelector('link[rel="canonical"]');
      if (!link) { link = document.createElement("link"); link.rel = "canonical"; document.head.appendChild(link); }
      link.href = BRAND.siteUrl.replace(/\/$/, "") + PATHS[tab];
    }
  }, [tab]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${BASE}jobs.json`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!Array.isArray(data.jobs) || data.jobs.length === 0) throw new Error("empty feed");
        // The collector already drops old postings. This is the second lock:
        // if a nightly run is missed, listings still age off the page.
        const fresh = data.jobs.filter((j) => { const d = ageDays(j.posted, new Date().toISOString()); return d !== null && d <= MAX_AGE_DAYS; });
        if (fresh.length === 0) throw new Error("every listing is too old");
        if (live) setFeed({ jobs: fresh, loading: false, sample: false, generatedAt: data.generatedAt || null });
      } catch {
        // No jobs.json yet (local preview, first deploy, or the collector has
        // not run). Show the sample board and say so, not an empty page.
        if (live) setFeed({ jobs: SAMPLE, loading: false, sample: true, generatedAt: null });
      }
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    fetch(`${BASE}news.json`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] })).then((data) => {
      const items = (Array.isArray(data.items) ? data.items : []).filter((n) => n && n.title && n.summary && /^https:\/\//.test(n.url || ""));
      items.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      if (live) setNews({ items, updated: data.updated || "", loading: false });
    });
    return () => { live = false; };
  }, []);

  const pages = {
    jobs: <JobsPage feed={feed} news={news} go={go} />,
    news: <NewsPage news={news} />,
    blog: <BlogPage />,
    advertise: <AdvertisePage />,
    about: <AboutPage />,
    privacy: <PrivacyPage />,
  };

  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <TabLink to="jobs" go={go} className="brand"><i aria-hidden="true" />{BRAND.name}</TabLink>
          <nav className="tabs" aria-label="Main">
            {NAV.map(([k, label]) => <TabLink key={k} to={k} go={go} className="tab" current={tab === k}>{label}</TabLink>)}
          </nav>
          <TabLink to="advertise" go={go} className="btn primary small">Post a job</TabLink>
        </div>
      </header>
      {feed.sample && <div className="notice">Sample listings from made-up companies, shown because the real listings could not be loaded. These are not real openings.</div>}
      {pages[tab] || pages.jobs}
      <footer className="site-footer">
        <div className="wrap">
          <p>{BRAND.title} · a job board for the non-engineering side of AI, from Baseline, the makers of Renewal · no account, no resume upload, no cookies</p>
          <nav aria-label="Footer">
            {[...NAV, ["about", "About"], ["privacy", "Privacy"]].map(([k, label]) => <TabLink key={k} to={k} go={go} className="foot-link">{label}</TabLink>)}
          </nav>
        </div>
      </footer>
    </>
  );
}
