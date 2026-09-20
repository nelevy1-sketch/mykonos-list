// capitalCities.js - ISO 3166-1 alpha-2 country code -> national capital
// city name(s), in English and Hebrew, for the gamification achievement
// map's "capitals visited" statistic (achievements.html, stage 5). Classic
// script, window-attached - same pattern as legs.js/datetime.js/
// countryContinent.js (CLAUDE.md, "מבנה סקריפטים בין 6 העמודים").
//
// NOT YET LOADED BY ANY PAGE OTHER THAN achievements.html.
//
// SOURCE: Wikidata Query Service (query.wikidata.org/sparql), a public,
// unauthenticated, structured RDF database - not an LLM summary and not
// hand-typed. Query joins each country (P297, ISO 3166-1 alpha-2 code) to
// its capital(s) (P36), then reads that capital entity's own rdfs:label in
// "en" and "he" directly - not translated/guessed by anything here.
//
// Why not REST Countries (the other option considered): its v3/v4 API -
// the one that used to return capital+translations with no auth - was
// deprecated during this exact investigation; v5 requires creating an
// account and an API key, which this project's own safety rules prohibit
// doing on the user's behalf. Wikidata needs no account and no key.
//
// SOURCE MISMATCH WITH countryContinent.js, ON PURPOSE: countryContinent.js
// used UN M49 (English only) because continent grouping doesn't need a
// second language. Capitals need a Hebrew name too - one visit record's
// cityName can legitimately be typed in either language (already true for
// city-view points, stage 3) - and UN M49 has no capital-city column at
// all. Wikidata was the source that actually carries both languages for
// this specific fact, not a downgrade in rigor.
//
// COVERAGE: 238 of the 248 codes in countryContinent.js's own
// window.COUNTRY_CONTINENT (the established total for "what counts as a
// country" on this page - reused here, not redefined). The 10 missing
// codes have NO capital statement in Wikidata at all - not a lookup
// failure, a real absence, because none of them has a capital in the
// ordinary political sense: AQ (Antarctica), BQ (Caribbean Netherlands),
// BV (Bouvet Island, uninhabited), EH (Western Sahara), HK/MO (Hong
// Kong/Macao - special administrative regions, not "capital" the way a
// state has one), HM (Heard Island/McDonald Islands, uninhabited), SJ
// (Svalbard/Jan Mayen), TK (Tokelau), UM (US Minor Outlying Islands).
// These 10 simply have no entry below - the stat this file feeds treats a
// visited country with no key here as "can't be checked", not as zero.
//
// ONE VALUE DERIVED, NOT LOOKED UP DIRECTLY: AG's capital (St. John's,
// Wikidata Q36262) has no "en" rdfs:label at all in Wikidata (confirmed by
// querying the entity directly) - its English name here ("St. John's") is
// taken from that same entity's own enwiki sitelink title ("St. John's,
// Antigua and Barbuda"), with the disambiguating ", Antigua and Barbuda"
// suffix mechanically stripped. Still Wikidata's own data, not a guess.
//
// ONE GENUINE GAP: MP (Northern Mariana Islands, capital Saipan) has no
// Hebrew label and no Hebrew Wikipedia article in Wikidata either -
// confirmed, not a query bug. Its entry below has he: null - the fuzzy
// matcher (achievements.html) simply has nothing to compare against for
// that one country's Hebrew case, same shape as any other missing field
// elsewhere in this app (fall back, don't crash - CLAUDE.md's own rule).
//
// MULTIPLE CAPITALS, KEPT AS MULTIPLE ENTRIES (not one arbitrarily chosen):
// a few countries have more than one seat that Wikidata itself records as
// P36 - South Africa's three (administrative/judicial/legislative),
// Bolivia's two, Sri Lanka's two, Pakistan's two (Islamabad is current,
// Rawalpindi was the interim capital), Eswatini's two, Yemen's two (Sanaa
// is the constitutional capital, Aden the seat of the internationally
// recognized government during the civil war), Montserrat's two (Plymouth,
// abandoned after a volcanic eruption, and Brades, the de facto seat
// since), Mayotte's two, and Palestine's two. Visiting ANY one of a
// country's listed capitals counts for the stat - not just the first.
//
// KNOWN LIMITATION (documented, not fixed here - same spirit as city
// view's own duplicate-point limitation, stage 3): the statistic that
// consumes this file does simple substring/diacritic-insensitive matching
// against these exact strings. A capital typed in a script/spelling this
// file doesn't have an entry for (a transliteration variant, a historical
// name) won't be detected as a match. This file maximizes coverage (both
// languages, every code Wikidata actually has data for) - it doesn't
// attempt to enumerate every possible spelling.
window.CAPITAL_CITIES = {
  AD: [{ en: "Andorra la Vella", he: "אנדורה לה ולה" }],
  AE: [{ en: "Abu Dhabi", he: "אבו דאבי" }],
  AF: [{ en: "Kabul", he: "קאבול" }],
  AG: [{ en: "St. John's", he: "סנט ג'ונס" }],
  AI: [{ en: "The Valley", he: "הוואלי" }],
  AL: [{ en: "Tirana", he: "טירנה" }],
  AM: [{ en: "Yerevan", he: "ירוואן" }],
  AO: [{ en: "Luanda", he: "לואנדה" }],
  AR: [{ en: "Buenos Aires", he: "בואנוס איירס" }],
  AS: [{ en: "Pago Pago", he: "פאגו פאגו" }],
  AT: [{ en: "Vienna", he: "וינה" }],
  AU: [{ en: "Canberra", he: "קנברה" }],
  AW: [{ en: "Oranjestad", he: "אורנייסטאד" }],
  AX: [{ en: "Mariehamn", he: "מרייהאמן" }],
  AZ: [{ en: "Baku", he: "באקו" }],
  BA: [{ en: "Sarajevo", he: "סרייבו" }],
  BB: [{ en: "Bridgetown", he: "ברידג'טאון" }],
  BD: [{ en: "Dhaka", he: "דאקה" }],
  BE: [{ en: "Brussels", he: "בריסל" }],
  BF: [{ en: "Ouagadougou", he: "ואגאדוגו" }],
  BG: [{ en: "Sofia", he: "סופיה" }],
  BH: [{ en: "Manama", he: "מנאמה" }],
  BI: [{ en: "Gitega", he: "גיטגה" }],
  BJ: [{ en: "Porto-Novo", he: "פורטו נובו" }],
  BL: [{ en: "Gustavia", he: "גוסטביה" }],
  BM: [{ en: "Hamilton", he: "המילטון" }],
  BN: [{ en: "Bandar Seri Begawan", he: "בנדר סרי בגוואן" }],
  BO: [{ en: "La Paz", he: "לה פאס" }, { en: "Sucre", he: "סוקרה" }],
  BR: [{ en: "Brasília", he: "ברזיליה" }],
  BS: [{ en: "Nassau", he: "נסאו" }],
  BT: [{ en: "Thimphu", he: "טהימפהו" }],
  BW: [{ en: "Gaborone", he: "גאבורונה" }],
  BY: [{ en: "Minsk", he: "מינסק" }],
  BZ: [{ en: "Belmopan", he: "בלמופן" }],
  CA: [{ en: "Ottawa", he: "אוטווה" }],
  CC: [{ en: "West Island", he: "וסט איילנד" }],
  CD: [{ en: "Kinshasa", he: "קינשאסה" }],
  CF: [{ en: "Bangui", he: "בנגי" }],
  CG: [{ en: "Brazzaville", he: "ברזוויל" }],
  CH: [{ en: "Bern", he: "ברן" }],
  CI: [{ en: "Yamoussoukro", he: "יאמוסוקרו" }],
  CK: [{ en: "Avarua", he: "אוורואה" }],
  CL: [{ en: "Santiago", he: "סנטיאגו דה צ'ילה" }],
  CM: [{ en: "Yaoundé", he: "יאונדה" }],
  CN: [{ en: "Beijing", he: "בייג'ינג" }],
  CO: [{ en: "Bogotá", he: "בוגוטה" }],
  CR: [{ en: "San José", he: "סן חוסה" }],
  CU: [{ en: "Havana", he: "הוואנה" }],
  CV: [{ en: "Praia", he: "פראיה" }],
  CW: [{ en: "Willemstad", he: "וילמסטאד" }],
  CX: [{ en: "Flying Fish Cove", he: "פלאיינג פיש קואוב" }],
  CY: [{ en: "Nicosia", he: "ניקוסיה" }],
  CZ: [{ en: "Prague", he: "פראג" }],
  DE: [{ en: "Berlin", he: "ברלין" }],
  DJ: [{ en: "Djibouti", he: "ג'יבוטי" }],
  DK: [{ en: "Copenhagen", he: "קופנהגן" }],
  DM: [{ en: "Roseau", he: "רוזו" }],
  DO: [{ en: "Santo Domingo", he: "סנטו דומינגו" }],
  DZ: [{ en: "Algiers", he: "אלג'יר" }],
  EC: [{ en: "Quito", he: "קיטו" }],
  EE: [{ en: "Tallinn", he: "טאלין" }],
  EG: [{ en: "Cairo", he: "קהיר" }],
  ER: [{ en: "Asmara", he: "אסמרה" }],
  ES: [{ en: "Madrid", he: "מדריד" }],
  ET: [{ en: "Addis Ababa", he: "אדיס אבבה" }],
  FI: [{ en: "Helsinki", he: "הלסינקי" }],
  FJ: [{ en: "Suva", he: "סובה" }],
  FK: [{ en: "Stanley", he: "סטנלי" }],
  FM: [{ en: "Palikir", he: "פליקיר" }],
  FO: [{ en: "Tórshavn", he: "טורסהאבן" }],
  FR: [{ en: "Paris", he: "פריז" }],
  GA: [{ en: "Libreville", he: "ליברוויל" }],
  GB: [{ en: "London", he: "לונדון" }],
  GD: [{ en: "St. George's", he: "סנט ג'ורג'" }],
  GE: [{ en: "Tbilisi", he: "טביליסי" }],
  GF: [{ en: "Cayenne", he: "קאיין" }],
  GG: [{ en: "Saint Peter Port", he: "סנט פיטר פורט" }],
  GH: [{ en: "Accra", he: "אקרה" }],
  GI: [{ en: "Gibraltar", he: "גיברלטר" }],
  GL: [{ en: "Nuuk", he: "נוק" }],
  GM: [{ en: "Banjul", he: "בנג'ול" }],
  GN: [{ en: "Conakry", he: "קונאקרי" }],
  GP: [{ en: "Basse-Terre", he: "באס טר" }],
  GQ: [{ en: "Ciudad de la Paz", he: "סיודאד דה לה פאס" }],
  GR: [{ en: "Athens", he: "אתונה" }],
  GS: [{ en: "King Edward Point", he: "קינג אדוארד פוינט" }],
  GT: [{ en: "Guatemala City", he: "גואטמלה סיטי" }],
  GU: [{ en: "Hagåtña", he: "האגטנה" }],
  GW: [{ en: "Bissau", he: "ביסאו" }],
  GY: [{ en: "Georgetown", he: "ג'ורג'טאון" }],
  HN: [{ en: "Tegucigalpa", he: "טגוסיגלפה" }],
  HR: [{ en: "Zagreb", he: "זאגרב" }],
  HT: [{ en: "Port-au-Prince", he: "פורט-או-פרנס" }],
  HU: [{ en: "Budapest", he: "בודפשט" }],
  ID: [{ en: "Jakarta", he: "ג'קרטה" }],
  IE: [{ en: "Dublin", he: "דבלין" }],
  IL: [{ en: "Jerusalem", he: "ירושלים" }],
  IM: [{ en: "Douglas", he: "דאגלס" }],
  IN: [{ en: "New Delhi", he: "ניו דלהי" }],
  IO: [{ en: "Diego Garcia", he: "דייגו גרסיה" }],
  IQ: [{ en: "Baghdad", he: "בגדאד" }],
  IR: [{ en: "Tehran", he: "טהראן" }],
  IS: [{ en: "Reykjavík", he: "רייקיאוויק" }],
  IT: [{ en: "Rome", he: "רומא" }],
  JE: [{ en: "Saint Helier", he: "סנט הלייר" }],
  JM: [{ en: "Kingston", he: "קינגסטון" }],
  JO: [{ en: "Amman", he: "עמאן" }],
  JP: [{ en: "Tokyo", he: "טוקיו" }],
  KE: [{ en: "Nairobi", he: "ניירובי" }],
  KG: [{ en: "Bishkek", he: "בישקק" }],
  KH: [{ en: "Phnom Penh", he: "פנום פן" }],
  KI: [{ en: "South Tarawa", he: "דרום טאראווה" }],
  KM: [{ en: "Moroni", he: "מורוני" }],
  KN: [{ en: "Basseterre", he: "באסטר" }],
  KP: [{ en: "Pyongyang", he: "פיונגיאנג" }],
  KR: [{ en: "Seoul", he: "סיאול" }],
  KW: [{ en: "Kuwait City", he: "כווית סיטי" }],
  KY: [{ en: "George Town", he: "ג'ורג' טאון" }],
  KZ: [{ en: "Astana", he: "אסטנה" }],
  LA: [{ en: "Vientiane", he: "ויינטיאן" }],
  LB: [{ en: "Beirut", he: "ביירות" }],
  LC: [{ en: "Castries", he: "קסטריז" }],
  LI: [{ en: "Vaduz", he: "ואדוץ" }],
  LK: [{ en: "Colombo", he: "קולומבו" }, { en: "Sri Jayawardenepura Kotte", he: "סרי ג'ייוורדנפורה-קוטה" }],
  LR: [{ en: "Monrovia", he: "מונרוביה" }],
  LS: [{ en: "Maseru", he: "מסרו" }],
  LT: [{ en: "Vilnius", he: "וילנה" }],
  LU: [{ en: "Luxembourg", he: "לוקסמבורג" }],
  LV: [{ en: "Riga", he: "ריגה" }],
  LY: [{ en: "Tripoli", he: "טריפולי" }],
  MA: [{ en: "Rabat", he: "רבאט" }],
  MC: [{ en: "Monaco", he: "מונקו" }],
  MD: [{ en: "Chișinău", he: "קישינב" }],
  ME: [{ en: "Podgorica", he: "פודגוריצה" }],
  MF: [{ en: "Marigot", he: "מריגו" }],
  MG: [{ en: "Antananarivo", he: "אנטננריבו" }],
  MH: [{ en: "Majuro", he: "מג'ורו" }],
  MK: [{ en: "Skopje", he: "סקופיה" }],
  ML: [{ en: "Bamako", he: "במקו" }],
  MM: [{ en: "Naypyidaw", he: "נייפידאו" }],
  MN: [{ en: "Ulaanbaatar", he: "אולן בטור" }],
  MP: [{ en: "Saipan", he: null }],
  MQ: [{ en: "Fort-de-France", he: "פור-דה-פראנס" }],
  MR: [{ en: "Nouakchott", he: "נואקשוט" }],
  MS: [{ en: "Plymouth", he: "פלימות'" }, { en: "Brades", he: "בראדס" }],
  MT: [{ en: "Valletta", he: "ולטה" }],
  MU: [{ en: "Port Louis", he: "פור לואי" }],
  MV: [{ en: "Malé", he: "מאלה" }],
  MW: [{ en: "Lilongwe", he: "לילונגווה" }],
  MX: [{ en: "Mexico City", he: "מקסיקו סיטי" }],
  MY: [{ en: "Kuala Lumpur", he: "קואלה לומפור" }],
  MZ: [{ en: "Maputo", he: "מפוטו" }],
  NA: [{ en: "Windhoek", he: "וינדהוק" }],
  NC: [{ en: "Nouméa", he: "נומאה" }],
  NE: [{ en: "Niamey", he: "ניאמיי" }],
  NF: [{ en: "Kingston", he: "קינגסטון" }],
  NG: [{ en: "Abuja", he: "אבוג'ה" }],
  NI: [{ en: "Managua", he: "מנגואה" }],
  NL: [{ en: "Amsterdam", he: "אמסטרדם" }],
  NO: [{ en: "Oslo", he: "אוסלו" }],
  NP: [{ en: "Kathmandu", he: "קטמנדו" }],
  NR: [{ en: "Yaren District", he: "יארן" }],
  NU: [{ en: "Alofi", he: "אלופי" }],
  NZ: [{ en: "Wellington", he: "ולינגטון" }],
  OM: [{ en: "Muscat", he: "מסקט" }],
  PA: [{ en: "Panama City", he: "פנמה סיטי" }],
  PE: [{ en: "Lima", he: "לימה" }],
  PF: [{ en: "Papeete", he: "פפאטה" }],
  PG: [{ en: "Port Moresby", he: "פורט מורסבי" }],
  PH: [{ en: "Manila", he: "מנילה" }],
  PK: [{ en: "Islamabad", he: "אסלאמאבאד" }, { en: "Rawalpindi", he: "רוואלפינדי" }],
  PL: [{ en: "Warsaw", he: "ורשה" }],
  PM: [{ en: "Saint-Pierre", he: "סן-פייר" }],
  PN: [{ en: "Adamstown", he: "אדמסטאון" }],
  PR: [{ en: "San Juan", he: "סן חואן" }],
  PS: [{ en: "East Jerusalem", he: "מזרח ירושלים" }, { en: "Ramallah", he: "רמאללה" }],
  PT: [{ en: "Lisbon", he: "ליסבון" }],
  PW: [{ en: "Ngerulmud", he: "נגרולמוד" }],
  PY: [{ en: "Asunción", he: "אסונסיון" }],
  QA: [{ en: "Doha", he: "דוחה" }],
  RE: [{ en: "Saint-Denis", he: "סן-דני" }],
  RO: [{ en: "Bucharest", he: "בוקרשט" }],
  RS: [{ en: "Belgrade", he: "בלגרד" }],
  RU: [{ en: "Moscow", he: "מוסקבה" }],
  RW: [{ en: "Kigali", he: "קיגאלי" }],
  SA: [{ en: "Riyadh", he: "ריאד" }],
  SB: [{ en: "Honiara", he: "הוניארה" }],
  SC: [{ en: "Victoria", he: "ויקטוריה" }],
  SD: [{ en: "Khartoum", he: "ח'רטום" }],
  SE: [{ en: "Stockholm", he: "סטוקהולם" }],
  SG: [{ en: "Singapore", he: "סינגפור" }],
  SH: [{ en: "Jamestown", he: "ג'יימסטאון" }],
  SI: [{ en: "Ljubljana", he: "ליובליאנה" }],
  SK: [{ en: "Bratislava", he: "ברטיסלאבה" }],
  SL: [{ en: "Freetown", he: "פריטאון" }],
  SM: [{ en: "San Marino", he: "סן מרינו" }],
  SN: [{ en: "Dakar", he: "דקר" }],
  SO: [{ en: "Mogadishu", he: "מוגדישו" }],
  SR: [{ en: "Paramaribo", he: "פרמריבו" }],
  SS: [{ en: "Juba", he: "ג'ובה" }],
  ST: [{ en: "São Tomé", he: "סאו טומה" }],
  SV: [{ en: "San Salvador", he: "סן סלוודור" }],
  SX: [{ en: "Philipsburg", he: "פיליפסבורג" }],
  SY: [{ en: "Damascus", he: "דמשק" }],
  SZ: [{ en: "Mbabane", he: "מבבנה" }, { en: "Lobamba", he: "לובמבה" }],
  TC: [{ en: "Cockburn Town", he: "קוקבורן טאון" }],
  TD: [{ en: "N'Djamena", he: "נג'מנה" }],
  TF: [{ en: "Port-aux-Français", he: "פורט-או-פרנסה" }],
  TG: [{ en: "Lomé", he: "לומה" }],
  TH: [{ en: "Bangkok", he: "בנגקוק" }],
  TJ: [{ en: "Dushanbe", he: "דושנבה" }],
  TL: [{ en: "Dili", he: "דילי" }],
  TM: [{ en: "Ashgabat", he: "אשגבאט" }],
  TN: [{ en: "Tunis", he: "תוניס" }],
  TO: [{ en: "Nukuʻalofa", he: "נוקואלופה" }],
  TR: [{ en: "Ankara", he: "אנקרה" }],
  TT: [{ en: "Port of Spain", he: "פורט אוף ספיין" }],
  TV: [{ en: "Funafuti", he: "פנאפוטי" }],
  TZ: [{ en: "Dodoma", he: "דודומה" }],
  UA: [{ en: "Kyiv", he: "קייב" }],
  UG: [{ en: "Kampala", he: "קמפלה" }],
  US: [{ en: "Washington, D.C.", he: "וושינגטון די. סי." }],
  UY: [{ en: "Montevideo", he: "מונטווידאו" }],
  UZ: [{ en: "Tashkent", he: "טשקנט" }],
  VA: [{ en: "Vatican City", he: "קריית הוותיקן" }],
  VC: [{ en: "Kingstown", he: "קינגסטאון" }],
  VE: [{ en: "Caracas", he: "קראקס" }],
  VG: [{ en: "Road Town", he: "רואוד טאון" }],
  VI: [{ en: "Charlotte Amalie", he: "שארלוט אמאלי" }],
  VN: [{ en: "Hanoi", he: "האנוי" }],
  VU: [{ en: "Port Vila", he: "פורט וילה" }],
  WF: [{ en: "Mata-Utu", he: "מאטה אוטו" }],
  WS: [{ en: "Apia", he: "אפיה" }],
  YE: [{ en: "Sanaa", he: "צנעא" }, { en: "Aden", he: "עדן" }],
  YT: [{ en: "Mamoudzou", he: "מאמודזו" }, { en: "Dzaoudzi", he: "דזאודזי" }],
  ZA: [{ en: "Bloemfontein", he: "בלומפונטיין" }, { en: "Pretoria", he: "פרטוריה" }, { en: "Cape Town", he: "קייפטאון" }],
  ZM: [{ en: "Lusaka", he: "לוסקה" }],
  ZW: [{ en: "Harare", he: "הארארה" }]
};
