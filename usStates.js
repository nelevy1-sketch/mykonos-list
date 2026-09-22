// usStates.js - ISO 3166-2:US subdivision code -> English/Hebrew name, for
// achievements.html's US-states drill-down (investigation, not yet in
// docs/schema-legs.md - see roadmap once the feature lands). Classic
// script, window-attached - same pattern as legs.js/datetime.js/
// countryContinent.js/capitalCities.js (CLAUDE.md, "מבנה סקריפטים בין 6
// העמודים").
//
// NOT YET LOADED BY ANY PAGE - this is commit 1/4 of the feature (data +
// schema only). The geocoding integration (commit 2), the aggregation
// function (commit 3) and the globe/UI (commit 4) all come later.
//
// SOURCE, PART 1 (which codes exist): Wikipedia's ISO_3166-2:US article -
// https://en.wikipedia.org/wiki/ISO_3166-2:US - 50 states, the District of
// Columbia, and 6 outlying/insular areas (American Samoa, Guam, Northern
// Mariana Islands, Puerto Rico, US Minor Outlying Islands, US Virgin
// Islands) = 57 codes total. Every code is "US-" + the USPS postal
// abbreviation, except US-UM (Minor Outlying Islands has no postal
// abbreviation - confirmed on the same page).
//
// SOURCE, PART 2 (English/Hebrew names): Wikidata Query Service
// (query.wikidata.org/sparql) - same source and same reason as
// capitalCities.js (needs a real Hebrew name per entry, which
// Intl.DisplayNames cannot supply - confirmed empirically:
// Intl.DisplayNames(['he'],{type:'region'}).of('US-TX') throws
// "invalid_argument" in every browser tested here, unlike a plain
// ISO 3166-1 country code - the API has no concept of subdivision codes at
// all). Query: every Wikidata item with a P300 (ISO 3166-2 code) value
// starting "US-", joined to its English and Hebrew rdfs:label. Returned
// 56 of the 57 codes directly - not hand-typed, not LLM-summarized.
//
// ONE MANUAL ENTRY, DOCUMENTED: US-VI (Virgin Islands) is missing from
// that query's results not because Wikidata lacks it, but because its P300
// value is stored as bare "VI" (it also has its own top-level ISO 3166-1
// alpha-2 code, being large/populous enough for one) rather than "US-VI" -
// confirmed directly by looking up its Wikidata item (Q11703) by ID. Its
// English/Hebrew names below are copied from that same item's own labels,
// same source, just found via a different query than the other 56.
//
// `kind` distinguishes the three ISO categories - a future feature (e.g. a
// "visited N real states" badge that should NOT count DC or a territory
// toward the total) may need this distinction; nothing in this commit
// reads it yet.
window.US_STATES = {
  "US-AL": { nameEn: "Alabama", nameHe: "אלבמה", kind: "state" },
  "US-AK": { nameEn: "Alaska", nameHe: "אלסקה", kind: "state" },
  "US-AZ": { nameEn: "Arizona", nameHe: "אריזונה", kind: "state" },
  "US-AR": { nameEn: "Arkansas", nameHe: "ארקנסו", kind: "state" },
  "US-CA": { nameEn: "California", nameHe: "קליפורניה", kind: "state" },
  "US-CO": { nameEn: "Colorado", nameHe: "קולורדו", kind: "state" },
  "US-CT": { nameEn: "Connecticut", nameHe: "קונטיקט", kind: "state" },
  "US-DE": { nameEn: "Delaware", nameHe: "דלאוור", kind: "state" },
  "US-FL": { nameEn: "Florida", nameHe: "פלורידה", kind: "state" },
  "US-GA": { nameEn: "Georgia", nameHe: "ג'ורג'יה", kind: "state" },
  "US-HI": { nameEn: "Hawaii", nameHe: "הוואי", kind: "state" },
  "US-ID": { nameEn: "Idaho", nameHe: "איידהו", kind: "state" },
  "US-IL": { nameEn: "Illinois", nameHe: "אילינוי", kind: "state" },
  "US-IN": { nameEn: "Indiana", nameHe: "אינדיאנה", kind: "state" },
  "US-IA": { nameEn: "Iowa", nameHe: "איווה", kind: "state" },
  "US-KS": { nameEn: "Kansas", nameHe: "קנזס", kind: "state" },
  "US-KY": { nameEn: "Kentucky", nameHe: "קנטקי", kind: "state" },
  "US-LA": { nameEn: "Louisiana", nameHe: "לואיזיאנה", kind: "state" },
  "US-ME": { nameEn: "Maine", nameHe: "מיין", kind: "state" },
  "US-MD": { nameEn: "Maryland", nameHe: "מרילנד", kind: "state" },
  "US-MA": { nameEn: "Massachusetts", nameHe: "מסצ'וסטס", kind: "state" },
  "US-MI": { nameEn: "Michigan", nameHe: "מישיגן", kind: "state" },
  "US-MN": { nameEn: "Minnesota", nameHe: "מינסוטה", kind: "state" },
  "US-MS": { nameEn: "Mississippi", nameHe: "מיסיסיפי", kind: "state" },
  "US-MO": { nameEn: "Missouri", nameHe: "מיזורי", kind: "state" },
  "US-MT": { nameEn: "Montana", nameHe: "מונטנה", kind: "state" },
  "US-NE": { nameEn: "Nebraska", nameHe: "נברסקה", kind: "state" },
  "US-NV": { nameEn: "Nevada", nameHe: "נבדה", kind: "state" },
  "US-NH": { nameEn: "New Hampshire", nameHe: "ניו המפשייר", kind: "state" },
  "US-NJ": { nameEn: "New Jersey", nameHe: "ניו ג'רזי", kind: "state" },
  "US-NM": { nameEn: "New Mexico", nameHe: "ניו מקסיקו", kind: "state" },
  "US-NY": { nameEn: "New York", nameHe: "ניו יורק", kind: "state" },
  "US-NC": { nameEn: "North Carolina", nameHe: "קרוליינה הצפונית", kind: "state" },
  "US-ND": { nameEn: "North Dakota", nameHe: "דקוטה הצפונית", kind: "state" },
  "US-OH": { nameEn: "Ohio", nameHe: "אוהיו", kind: "state" },
  "US-OK": { nameEn: "Oklahoma", nameHe: "אוקלהומה", kind: "state" },
  "US-OR": { nameEn: "Oregon", nameHe: "אורגון", kind: "state" },
  "US-PA": { nameEn: "Pennsylvania", nameHe: "פנסילבניה", kind: "state" },
  "US-RI": { nameEn: "Rhode Island", nameHe: "רוד איילנד", kind: "state" },
  "US-SC": { nameEn: "South Carolina", nameHe: "קרוליינה הדרומית", kind: "state" },
  "US-SD": { nameEn: "South Dakota", nameHe: "דקוטה הדרומית", kind: "state" },
  "US-TN": { nameEn: "Tennessee", nameHe: "טנסי", kind: "state" },
  "US-TX": { nameEn: "Texas", nameHe: "טקסס", kind: "state" },
  "US-UT": { nameEn: "Utah", nameHe: "יוטה", kind: "state" },
  "US-VT": { nameEn: "Vermont", nameHe: "ורמונט", kind: "state" },
  "US-VA": { nameEn: "Virginia", nameHe: "וירג'יניה", kind: "state" },
  "US-WA": { nameEn: "Washington", nameHe: "וושינגטון", kind: "state" },
  "US-WV": { nameEn: "West Virginia", nameHe: "וירג'יניה המערבית", kind: "state" },
  "US-WI": { nameEn: "Wisconsin", nameHe: "ויסקונסין", kind: "state" },
  "US-WY": { nameEn: "Wyoming", nameHe: "ויומינג", kind: "state" },

  "US-DC": { nameEn: "District of Columbia", nameHe: "מחוז קולומביה", kind: "district" },

  "US-AS": { nameEn: "American Samoa", nameHe: "סמואה האמריקנית", kind: "territory" },
  "US-GU": { nameEn: "Guam", nameHe: "גואם", kind: "territory" },
  "US-MP": { nameEn: "Northern Mariana Islands", nameHe: "איי מריאנה הצפוניים", kind: "territory" },
  "US-PR": { nameEn: "Puerto Rico", nameHe: "פוארטו ריקו", kind: "territory" },
  "US-UM": { nameEn: "United States Minor Outlying Islands", nameHe: "איים קטנים מרוחקים של ארצות הברית", kind: "territory" },
  "US-VI": { nameEn: "United States Virgin Islands", nameHe: "איי הבתולה של ארצות הברית", kind: "territory" }
};
