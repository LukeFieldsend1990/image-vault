// Canonical list of jurisdictions a production can operate in. Picking one of
// these (home country, or an additional country in scope) commits the
// production to the corresponding data-protection regime for performer data
// handled there. Ported from the design prototype so the wording stays
// consistent across the wizard and the production detail page.

export interface CountryTopLevel {
  id: string;
  label: string;
  sub: string; // short descriptor of the regime, e.g. "UK GDPR"
}

export const COUNTRY_TOP_LEVEL: CountryTopLevel[] = [
  { id: "UK", label: "United Kingdom", sub: "UK GDPR" },
  { id: "EU", label: "European countries on GDPR", sub: "EU 27 + Iceland + Norway" },
  { id: "CH", label: "Switzerland", sub: "Swiss FADP" },
  { id: "US", label: "United States", sub: "50 states + DC" },
  { id: "CA", label: "Canada", sub: "PIPEDA" },
  { id: "AU", label: "Australia", sub: "Privacy Act" },
  { id: "NZ", label: "New Zealand", sub: "Privacy Act" },
  { id: "MA", label: "Morocco", sub: "Law 09-08" },
  { id: "JO", label: "Jordan", sub: "PDPL" },
  { id: "AE", label: "United Arab Emirates", sub: "PDPL" },
  { id: "MX", label: "Mexico", sub: "LFPDPPP" },
  { id: "TH", label: "Thailand", sub: "PDPA" },
  { id: "ZA", label: "South Africa", sub: "POPIA" },
];

export const EU_COUNTRIES = [
  "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czech Republic",
  "Denmark", "Estonia", "Finland", "France", "Germany", "Greece", "Hungary",
  "Iceland", "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg", "Malta",
  "Netherlands", "Norway", "Poland", "Portugal", "Romania", "Slovakia",
  "Slovenia", "Spain", "Sweden",
];

export const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
  "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
  "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia",
  "Washington", "West Virginia", "Wisconsin", "Wyoming",
];

const STATEMENTS: Record<string, string | ((sub: string) => string)> = {
  UK: "Adding the United Kingdom means data activity here is subject to the UK GDPR and the Data Protection Act 2018. Performer biometric data is special category data under Article 9.",
  EU: (sub) => `Adding ${sub} means data activity there is subject to the EU GDPR. Performer biometric data is special category data under Article 9.`,
  CH: "Adding Switzerland means data activity here is subject to the Swiss Federal Act on Data Protection.",
  US: (sub) => `Adding ${sub} means data activity there is subject to applicable US federal law and ${sub}'s state privacy regime. SAG-AFTRA 2026 §39H/I/J obligations may also apply.`,
  CA: "Adding Canada means data activity here is subject to PIPEDA and any applicable provincial regulations.",
  AU: "Adding Australia means data activity here is subject to the Privacy Act and the Australian Privacy Principles.",
  NZ: "Adding New Zealand means data activity here is subject to the Privacy Act 2020.",
  MA: "Adding Morocco means data activity here is subject to Law 09-08 on the protection of personal data.",
  JO: "Adding Jordan means data activity here is subject to the Personal Data Protection Law.",
  AE: "Adding the United Arab Emirates means data activity here is subject to the federal PDPL and any free zone regulations that apply.",
  MX: "Adding Mexico means data activity here is subject to the LFPDPPP and any applicable state laws.",
  TH: "Adding Thailand means data activity here is subject to the Personal Data Protection Act B.E. 2562.",
  ZA: "Adding South Africa means data activity here is subject to POPIA, the Protection of Personal Information Act.",
};

// The compliance commitment shown on the confirm step. `sub` is the picked
// label — for top-levels with sub-picks (EU, US) it's the country/state name;
// for everything else it's the top-level label itself.
export function complianceStatement(topLevelId: string, sub: string): string {
  const s = STATEMENTS[topLevelId];
  if (!s) return "";
  return typeof s === "function" ? s(sub) : s;
}

export function topLevelById(id: string): CountryTopLevel | undefined {
  return COUNTRY_TOP_LEVEL.find((c) => c.id === id);
}

// True when picking the top-level needs a second pick (which country / state).
export function hasSubPick(topLevelId: string): boolean {
  return topLevelId === "EU" || topLevelId === "US";
}

export function subPickList(topLevelId: string): string[] {
  if (topLevelId === "EU") return EU_COUNTRIES;
  if (topLevelId === "US") return US_STATES;
  return [];
}

export function subPickLabel(topLevelId: string): string {
  if (topLevelId === "EU") return "European country";
  if (topLevelId === "US") return "US state";
  return "";
}
