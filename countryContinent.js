// countryContinent.js - ISO 3166-1 alpha-2 country code -> continent, for
// the gamification achievement map's country/city/continent view toggle
// (investigation, not yet in docs/schema-legs.md - see roadmap once the
// feature itself lands). Classic script, window-attached - same pattern as
// legs.js/datetime.js/legGeocode.js (CLAUDE.md, "מבנה סקריפטים בין 6
// העמודים").
//
// NOT YET LOADED BY ANY PAGE. This file exists on its own, ahead of the
// achievement-map screen that will actually consume it - which page(s) load
// it is a decision for that later commit (a new dedicated screen, per the
// investigation), not this one. Flagging this explicitly: unlike this
// session's other prep commits (legGeocode.js's cityName/region), adding
// unused exports to an ALREADY-loaded file, this is a brand-new file loaded
// nowhere yet - genuinely inert until wired up.
//
// SOURCE: UN Statistics Division, M49 standard, full overview table -
// https://unstats.un.org/unsd/methodology/m49/overview/ - the official UN
// classification of countries/areas into continents (their term:
// "continental regions") and sub-regions, chosen specifically because it
// already keys on ISO 3166-1 alpha-2 (what `countryCode` already stores
// everywhere in this app) in the same table as the continent grouping - no
// secondary alpha-3<->alpha-2 join needed. Parsed directly and
// deterministically from the page's own server-rendered HTML table (its
// English-language tab, id="ENG_Overview") via a one-time script, NOT
// retyped by hand and NOT summarized by an LLM - both would risk exactly
// the kind of silent misclassification a country-metadata table is prone to
// (a wrong entry looks identical to a right one until someone notices a
// country in the wrong place). 248 rows, zero duplicate codes, verified
// against the parsed page.
//
// THREE BORDER CASES, CHECKED DIRECTLY AGAINST THE OFFICIAL TABLE (not
// assumed from popular/informal geography) - because each one differs from
// how it's commonly described outside this specific UN classification:
// - Russia (RU) -> Europe (Eastern Europe). Despite most of its land area
//   being geographically in Asia, the UN M49 table places the whole
//   country under Europe.
// - Kazakhstan (KZ) -> Asia (Central Asia). Sometimes informally grouped
//   with Europe/CIS in other contexts; M49 places it in Asia.
// - Türkiye (TR) -> Asia (Western Asia). Despite a small European portion
//   (the part west of the Bosphorus) and frequent informal association
//   with Europe (EU accession discussions, etc.), M49 assigns the whole
//   country to Asia, not split.
// If any of these three ever looks "wrong" to someone reading the map,
// this is the source of truth being followed and why - not a bug to fix
// silently.
//
// ONE NAMING SURPRISE, ALSO CONFIRMED GENUINE (grepped the raw source page
// directly - not a parsing artifact): NR is labelled "Naoero" in the UN's
// own English-language table, not "Nauru" - the UN's official English name
// for that country as of this table's current revision. Left as-is
// (correct per the authoritative source), noted here so it isn't mistaken
// for a typo later.
//
// Antarctica (AQ) is its own top-level M49 region (code 010), a peer of
// Africa/Americas/Asia/Europe/Oceania in the hierarchy rather than nested
// under one - mapped to "Antarctica" itself rather than left blank or
// dropped, so a lookup for it still returns something rather than
// undefined.
//
// Values are the English continent name as a stable key (matching this
// app's existing convention for tripCharacter/vibes - an English key
// stored/compared, translated only at display time via tr()) - Hebrew
// labels for the 6 possible values (Africa/Americas/Asia/Europe/Oceania/
// Antarctica) belong in whichever page's tr() ends up rendering the
// continent toggle, not duplicated here.
window.COUNTRY_CONTINENT = {
  AD: "Europe", // Andorra
  AE: "Asia", // United Arab Emirates
  AF: "Asia", // Afghanistan
  AG: "Americas", // Antigua and Barbuda
  AI: "Americas", // Anguilla
  AL: "Europe", // Albania
  AM: "Asia", // Armenia
  AO: "Africa", // Angola
  AQ: "Antarctica", // Antarctica
  AR: "Americas", // Argentina
  AS: "Oceania", // American Samoa
  AT: "Europe", // Austria
  AU: "Oceania", // Australia
  AW: "Americas", // Aruba
  AX: "Europe", // Åland Islands
  AZ: "Asia", // Azerbaijan
  BA: "Europe", // Bosnia and Herzegovina
  BB: "Americas", // Barbados
  BD: "Asia", // Bangladesh
  BE: "Europe", // Belgium
  BF: "Africa", // Burkina Faso
  BG: "Europe", // Bulgaria
  BH: "Asia", // Bahrain
  BI: "Africa", // Burundi
  BJ: "Africa", // Benin
  BL: "Americas", // Saint Barthélemy
  BM: "Americas", // Bermuda
  BN: "Asia", // Brunei Darussalam
  BO: "Americas", // Bolivia (Plurinational State of)
  BQ: "Americas", // Bonaire, Sint Eustatius and Saba
  BR: "Americas", // Brazil
  BS: "Americas", // Bahamas
  BT: "Asia", // Bhutan
  BV: "Americas", // Bouvet Island
  BW: "Africa", // Botswana
  BY: "Europe", // Belarus
  BZ: "Americas", // Belize
  CA: "Americas", // Canada
  CC: "Oceania", // Cocos (Keeling) Islands
  CD: "Africa", // Democratic Republic of the Congo
  CF: "Africa", // Central African Republic
  CG: "Africa", // Congo
  CH: "Europe", // Switzerland
  CI: "Africa", // Côte d’Ivoire
  CK: "Oceania", // Cook Islands
  CL: "Americas", // Chile
  CM: "Africa", // Cameroon
  CN: "Asia", // China
  CO: "Americas", // Colombia
  CR: "Americas", // Costa Rica
  CU: "Americas", // Cuba
  CV: "Africa", // Cabo Verde
  CW: "Americas", // Curaçao
  CX: "Oceania", // Christmas Island
  CY: "Asia", // Cyprus
  CZ: "Europe", // Czechia
  DE: "Europe", // Germany
  DJ: "Africa", // Djibouti
  DK: "Europe", // Denmark
  DM: "Americas", // Dominica
  DO: "Americas", // Dominican Republic
  DZ: "Africa", // Algeria
  EC: "Americas", // Ecuador
  EE: "Europe", // Estonia
  EG: "Africa", // Egypt
  EH: "Africa", // Western Sahara
  ER: "Africa", // Eritrea
  ES: "Europe", // Spain
  ET: "Africa", // Ethiopia
  FI: "Europe", // Finland
  FJ: "Oceania", // Fiji
  FK: "Americas", // Falkland Islands (Malvinas)
  FM: "Oceania", // Micronesia (Federated States of)
  FO: "Europe", // Faroe Islands
  FR: "Europe", // France
  GA: "Africa", // Gabon
  GB: "Europe", // United Kingdom of Great Britain and Northern Ireland
  GD: "Americas", // Grenada
  GE: "Asia", // Georgia
  GF: "Americas", // French Guiana
  GG: "Europe", // Guernsey
  GH: "Africa", // Ghana
  GI: "Europe", // Gibraltar
  GL: "Americas", // Greenland
  GM: "Africa", // Gambia
  GN: "Africa", // Guinea
  GP: "Americas", // Guadeloupe
  GQ: "Africa", // Equatorial Guinea
  GR: "Europe", // Greece
  GS: "Americas", // South Georgia and the South Sandwich Islands
  GT: "Americas", // Guatemala
  GU: "Oceania", // Guam
  GW: "Africa", // Guinea-Bissau
  GY: "Americas", // Guyana
  HK: "Asia", // China, Hong Kong Special Administrative Region
  HM: "Oceania", // Heard Island and McDonald Islands
  HN: "Americas", // Honduras
  HR: "Europe", // Croatia
  HT: "Americas", // Haiti
  HU: "Europe", // Hungary
  ID: "Asia", // Indonesia
  IE: "Europe", // Ireland
  IL: "Asia", // Israel
  IM: "Europe", // Isle of Man
  IN: "Asia", // India
  IO: "Africa", // British Indian Ocean Territory
  IQ: "Asia", // Iraq
  IR: "Asia", // Iran (Islamic Republic of)
  IS: "Europe", // Iceland
  IT: "Europe", // Italy
  JE: "Europe", // Jersey
  JM: "Americas", // Jamaica
  JO: "Asia", // Jordan
  JP: "Asia", // Japan
  KE: "Africa", // Kenya
  KG: "Asia", // Kyrgyzstan
  KH: "Asia", // Cambodia
  KI: "Oceania", // Kiribati
  KM: "Africa", // Comoros
  KN: "Americas", // Saint Kitts and Nevis
  KP: "Asia", // Democratic People's Republic of Korea
  KR: "Asia", // Republic of Korea
  KW: "Asia", // Kuwait
  KY: "Americas", // Cayman Islands
  KZ: "Asia", // Kazakhstan
  LA: "Asia", // Lao People's Democratic Republic
  LB: "Asia", // Lebanon
  LC: "Americas", // Saint Lucia
  LI: "Europe", // Liechtenstein
  LK: "Asia", // Sri Lanka
  LR: "Africa", // Liberia
  LS: "Africa", // Lesotho
  LT: "Europe", // Lithuania
  LU: "Europe", // Luxembourg
  LV: "Europe", // Latvia
  LY: "Africa", // Libya
  MA: "Africa", // Morocco
  MC: "Europe", // Monaco
  MD: "Europe", // Republic of Moldova
  ME: "Europe", // Montenegro
  MF: "Americas", // Saint Martin (French Part)
  MG: "Africa", // Madagascar
  MH: "Oceania", // Marshall Islands
  MK: "Europe", // North Macedonia
  ML: "Africa", // Mali
  MM: "Asia", // Myanmar
  MN: "Asia", // Mongolia
  MO: "Asia", // China, Macao Special Administrative Region
  MP: "Oceania", // Northern Mariana Islands
  MQ: "Americas", // Martinique
  MR: "Africa", // Mauritania
  MS: "Americas", // Montserrat
  MT: "Europe", // Malta
  MU: "Africa", // Mauritius
  MV: "Asia", // Maldives
  MW: "Africa", // Malawi
  MX: "Americas", // Mexico
  MY: "Asia", // Malaysia
  MZ: "Africa", // Mozambique
  NA: "Africa", // Namibia
  NC: "Oceania", // New Caledonia
  NE: "Africa", // Niger
  NF: "Oceania", // Norfolk Island
  NG: "Africa", // Nigeria
  NI: "Americas", // Nicaragua
  NL: "Europe", // Netherlands (Kingdom of the)
  NO: "Europe", // Norway
  NP: "Asia", // Nepal
  NR: "Oceania", // Naoero (UN's official name for Nauru - see file header)
  NU: "Oceania", // Niue
  NZ: "Oceania", // New Zealand
  OM: "Asia", // Oman
  PA: "Americas", // Panama
  PE: "Americas", // Peru
  PF: "Oceania", // French Polynesia
  PG: "Oceania", // Papua New Guinea
  PH: "Asia", // Philippines
  PK: "Asia", // Pakistan
  PL: "Europe", // Poland
  PM: "Americas", // Saint Pierre and Miquelon
  PN: "Oceania", // Pitcairn
  PR: "Americas", // Puerto Rico
  PS: "Asia", // State of Palestine
  PT: "Europe", // Portugal
  PW: "Oceania", // Palau
  PY: "Americas", // Paraguay
  QA: "Asia", // Qatar
  RE: "Africa", // Réunion
  RO: "Europe", // Romania
  RS: "Europe", // Serbia
  RU: "Europe", // Russian Federation (see the border-case note above)
  RW: "Africa", // Rwanda
  SA: "Asia", // Saudi Arabia
  SB: "Oceania", // Solomon Islands
  SC: "Africa", // Seychelles
  SD: "Africa", // Sudan
  SE: "Europe", // Sweden
  SG: "Asia", // Singapore
  SH: "Africa", // Saint Helena
  SI: "Europe", // Slovenia
  SJ: "Europe", // Svalbard and Jan Mayen Islands
  SK: "Europe", // Slovakia
  SL: "Africa", // Sierra Leone
  SM: "Europe", // San Marino
  SN: "Africa", // Senegal
  SO: "Africa", // Somalia
  SR: "Americas", // Suriname
  SS: "Africa", // South Sudan
  ST: "Africa", // Sao Tome and Principe
  SV: "Americas", // El Salvador
  SX: "Americas", // Sint Maarten (Dutch part)
  SY: "Asia", // Syrian Arab Republic
  SZ: "Africa", // Eswatini
  TC: "Americas", // Turks and Caicos Islands
  TD: "Africa", // Chad
  TF: "Africa", // French Southern Territories
  TG: "Africa", // Togo
  TH: "Asia", // Thailand
  TJ: "Asia", // Tajikistan
  TK: "Oceania", // Tokelau
  TL: "Asia", // Timor-Leste
  TM: "Asia", // Turkmenistan
  TN: "Africa", // Tunisia
  TO: "Oceania", // Tonga
  TR: "Asia", // Türkiye (see the border-case note above)
  TT: "Americas", // Trinidad and Tobago
  TV: "Oceania", // Tuvalu
  TZ: "Africa", // United Republic of Tanzania
  UA: "Europe", // Ukraine
  UG: "Africa", // Uganda
  UM: "Oceania", // United States Minor Outlying Islands
  US: "Americas", // United States of America
  UY: "Americas", // Uruguay
  UZ: "Asia", // Uzbekistan
  VA: "Europe", // Holy See
  VC: "Americas", // Saint Vincent and the Grenadines
  VE: "Americas", // Venezuela (Bolivarian Republic of)
  VG: "Americas", // British Virgin Islands
  VI: "Americas", // United States Virgin Islands
  VN: "Asia", // Viet Nam
  VU: "Oceania", // Vanuatu
  WF: "Oceania", // Wallis and Futuna Islands
  WS: "Oceania", // Samoa
  YE: "Asia", // Yemen
  YT: "Africa", // Mayotte
  ZA: "Africa", // South Africa
  ZM: "Africa", // Zambia
  ZW: "Africa" // Zimbabwe
};
