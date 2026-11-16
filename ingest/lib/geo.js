/* ============================================================================
   geo.js — reads a location string as the employer wrote it.

   Two jobs:
     1. Decide whether the role is in the United States. The board is US-only
        for now, and a location that cannot be placed is dropped rather than
        guessed.
     2. Produce the label and work mode shown on the listing. Work mode is
        shown only when the posting states it. "Onsite" is never assumed.
   ========================================================================== */

const STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
const STATE_CODES = Object.keys(STATES).join("|");
const STATE_NAMES = Object.values(STATES).filter((n) => n !== "Georgia" && n !== "Washington").join("|");

const US_WORDS = /\b(united states( of america)?|u\.s\.a?\.?|usa|us|america|americas? ?- ?us|nationwide|conus)\b/i;
const US_CITIES = /\b(new york( city)?|nyc|brooklyn|manhattan|san francisco|sf bay area|bay area|silicon valley|palo alto|mountain view|menlo park|sunnyvale|san jose|san mateo|redwood city|oakland|berkeley|los angeles|santa monica|culver city|san diego|irvine|sacramento|seattle|bellevue|redmond|portland|denver|boulder|salt lake city|lehi|phoenix|scottsdale|tempe|las vegas|austin|dallas|plano|houston|san antonio|chicago|minneapolis|st\.? louis|kansas city|detroit|ann arbor|columbus|cincinnati|cleveland|indianapolis|nashville|atlanta|alpharetta|charlotte|raleigh|durham|miami|tampa|orlando|jacksonville|boston|cambridge, ma|philadelphia|pittsburgh|baltimore|washington,? d\.?c\.?|arlington|reston|mclean|tysons|new jersey|jersey city|hoboken|stamford|hartford|providence|honolulu|omaha|madison|milwaukee|boise|richmond|newport beach)\b/i;

// Anything here means the role is outside the US, even if a US-looking code follows.
const FOREIGN = /\b(canada|toronto|vancouver|montreal|ottawa|calgary|waterloo|ontario|quebec|british columbia|alberta|mexico|mexico city|guadalajara|monterrey|brazil|brasil|sao paulo|são paulo|argentina|buenos aires|chile|santiago|colombia|bogota|bogotá|peru|lima|costa rica|latam|latin america|united kingdom|uk|u\.k\.|england|scotland|wales|london|manchester|edinburgh|bristol|leeds|ireland|dublin|cork|france|paris|lyon|germany|deutschland|berlin|munich|münchen|hamburg|frankfurt|cologne|köln|stuttgart|netherlands|amsterdam|rotterdam|utrecht|belgium|brussels|luxembourg|spain|madrid|barcelona|portugal|lisbon|porto|italy|milan|rome|switzerland|zurich|zürich|geneva|austria|vienna|sweden|stockholm|norway|oslo|denmark|copenhagen|finland|helsinki|poland|warsaw|krakow|kraków|wroclaw|czech|prague|hungary|budapest|romania|bucharest|bulgaria|sofia|greece|athens|turkey|türkiye|istanbul|ukraine|kyiv|serbia|belgrade|croatia|zagreb|estonia|tallinn|latvia|riga|lithuania|vilnius|israel|tel aviv|uae|dubai|abu dhabi|saudi|riyadh|qatar|doha|egypt|cairo|south africa|cape town|johannesburg|nigeria|lagos|kenya|nairobi|ghana|morocco|india|bangalore|bengaluru|hyderabad|mumbai|pune|chennai|gurgaon|gurugram|noida|delhi|kolkata|pakistan|karachi|lahore|bangladesh|dhaka|sri lanka|china|beijing|shanghai|shenzhen|hong kong|taiwan|taipei|japan|tokyo|osaka|korea|seoul|singapore|malaysia|kuala lumpur|indonesia|jakarta|thailand|bangkok|vietnam|hanoi|ho chi minh|philippines|manila|cebu|australia|sydney|melbourne|brisbane|perth|new zealand|auckland|wellington|emea|apac|europe|european|eu|asia|africa|middle east|anz|worldwide|world|global|anywhere|international|senegal|slovakia|slovenia|iceland|malta|cyprus|georgia \(country\)|tbilisi|armenia|yerevan|kazakhstan|uzbekistan)\b/i;

const clean = (s) => String(s || "").replace(/\s+/g, " ").replace(/\s*[|•·]\s*/g, " · ").trim();

/* Workday puts the first location in the URL path: /job/Atlanta-GA/Title_R123 */
function fromWorkdayUrl(url) {
  const m = /\/job\/([^/]+)\//.exec(String(url || ""));
  if (!m) return null;
  const slug = decodeURIComponent(m[1]).replace(/_/g, " ");
  const st = new RegExp(`^(.*?)[- ](${STATE_CODES})(?:[- ]|$)`).exec(slug);
  if (st && !FOREIGN.test(slug.replace(/-/g, " "))) {
    const city = st[1].replace(/-/g, " ").replace(/\s+/g, " ").trim();
    // "ESP-MD" is Spain/Madrid, not a town in Maryland: skip country codes.
    if (city && !/\d/.test(city) && !/^[A-Za-z]{2,3}$/.test(city)) return `${city}, ${st[2]}`;
  }
  if (/united[- ]states|\busa?\b/i.test(slug.replace(/-/g, " "))) return "United States";
  return null;
}

/**
 * readLocation(raw, { url, remoteFlag, workplace })
 *   -> { label, mode, us }
 *   us:   true | false | null (null = could not be placed)
 *   mode: "Remote" | "Hybrid" | "Onsite" | "" (empty = the posting does not say)
 */
export function readLocation(raw, { url = "", remoteFlag = null, workplace = "" } = {}) {
  let label = clean(raw);
  let extra = "";

  const multi = /^(\d+)\s+locations?$/i.exec(label);
  if (multi || !label || /^(not specified|multiple locations?|various|n\/a|tbd)$/i.test(label)) {
    const fromUrl = fromWorkdayUrl(url);
    if (fromUrl) {
      extra = multi ? ` + ${Number(multi[1]) - 1} more` : "";
      label = fromUrl;
    } else {
      return { label: label || "", mode: "", us: null };
    }
  }

  const text = label.replace(/[()[\]]/g, " ");
  let us = null;
  if (FOREIGN.test(text)) us = false;
  else if (US_WORDS.test(text) || US_CITIES.test(text)) us = true;
  else if (new RegExp(`(^|[\\s,/-])(${STATE_CODES})(?=$|[\\s,/)-])`).test(text)) us = true;
  else if (new RegExp(`\\b(${STATE_NAMES})\\b`, "i").test(text)) us = true;

  // A posting that lists both a US place and a foreign one is a multi-country
  // role; keep it only when the US part comes first.
  if (us === false && (US_WORDS.test(text) || US_CITIES.test(text))) {
    const firstUs = Math.min(...[US_WORDS, US_CITIES].map((re) => { const m = re.exec(text); return m ? m.index : Infinity; }));
    const firstForeign = FOREIGN.exec(text).index;
    if (firstUs < firstForeign) us = true;
  }

  const w = `${workplace} ${text}`.toLowerCase();
  let mode = "";
  if (/hybrid/.test(w)) mode = "Hybrid";
  else if (remoteFlag === true || /\b(remote|virtual|work from home|wfh|telecommute|distributed)\b/.test(w)) mode = "Remote";
  else if (/\b(on-?site|in-?office|in person)\b/.test(w)) mode = "Onsite";

  // Tidy the label: "USA - Remote" and friends read better as "Remote — US".
  if (mode === "Remote" && us === true && /^(remote|virtual)?[\s,·()-]*(united states( of america)?|usa?|u\.s\.a?\.?)?[\s,·()-]*(remote|virtual)?[\s,·()-]*$/i.test(label)) {
    label = "Remote — US";
  }
  return { label: label + extra, mode, us };
}
