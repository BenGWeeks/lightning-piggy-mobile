// ISO 3166-1 alpha-2 country codes + English display names, for the Market
// checkout's "Ship to" picker (#948 Option A). Static rather than
// Intl.DisplayNames because Hermes doesn't implement DisplayNames — and a
// static table keeps the picker searchable, deterministic, and testable.
// Codes only, never free text: the selected CODE is what shipping options
// (kind 30406 `country` tags) are matched against.

export interface Country {
  /** ISO 3166-1 alpha-2, uppercase — the app's canonical country code. */
  code: string;
  /** ISO 3166-1 alpha-3, uppercase. Some merchants publish kind-30406
   * `country` tags in alpha-3 (Robotechy's live options use GBR/IRL/DEU…),
   * so option parsing normalises through this column. */
  alpha3: string;
  /** English short name (search + display). */
  name: string;
}

export const COUNTRIES: readonly Country[] = [
  { code: 'AF', alpha3: 'AFG', name: 'Afghanistan' },
  { code: 'AL', alpha3: 'ALB', name: 'Albania' },
  { code: 'DZ', alpha3: 'DZA', name: 'Algeria' },
  { code: 'AD', alpha3: 'AND', name: 'Andorra' },
  { code: 'AO', alpha3: 'AGO', name: 'Angola' },
  { code: 'AG', alpha3: 'ATG', name: 'Antigua and Barbuda' },
  { code: 'AR', alpha3: 'ARG', name: 'Argentina' },
  { code: 'AM', alpha3: 'ARM', name: 'Armenia' },
  { code: 'AU', alpha3: 'AUS', name: 'Australia' },
  { code: 'AT', alpha3: 'AUT', name: 'Austria' },
  { code: 'AZ', alpha3: 'AZE', name: 'Azerbaijan' },
  { code: 'BS', alpha3: 'BHS', name: 'Bahamas' },
  { code: 'BH', alpha3: 'BHR', name: 'Bahrain' },
  { code: 'BD', alpha3: 'BGD', name: 'Bangladesh' },
  { code: 'BB', alpha3: 'BRB', name: 'Barbados' },
  { code: 'BY', alpha3: 'BLR', name: 'Belarus' },
  { code: 'BE', alpha3: 'BEL', name: 'Belgium' },
  { code: 'BZ', alpha3: 'BLZ', name: 'Belize' },
  { code: 'BJ', alpha3: 'BEN', name: 'Benin' },
  { code: 'BT', alpha3: 'BTN', name: 'Bhutan' },
  { code: 'BO', alpha3: 'BOL', name: 'Bolivia' },
  { code: 'BA', alpha3: 'BIH', name: 'Bosnia and Herzegovina' },
  { code: 'BW', alpha3: 'BWA', name: 'Botswana' },
  { code: 'BR', alpha3: 'BRA', name: 'Brazil' },
  { code: 'BN', alpha3: 'BRN', name: 'Brunei' },
  { code: 'BG', alpha3: 'BGR', name: 'Bulgaria' },
  { code: 'BF', alpha3: 'BFA', name: 'Burkina Faso' },
  { code: 'BI', alpha3: 'BDI', name: 'Burundi' },
  { code: 'KH', alpha3: 'KHM', name: 'Cambodia' },
  { code: 'CM', alpha3: 'CMR', name: 'Cameroon' },
  { code: 'CA', alpha3: 'CAN', name: 'Canada' },
  { code: 'CV', alpha3: 'CPV', name: 'Cape Verde' },
  { code: 'CF', alpha3: 'CAF', name: 'Central African Republic' },
  { code: 'TD', alpha3: 'TCD', name: 'Chad' },
  { code: 'CL', alpha3: 'CHL', name: 'Chile' },
  { code: 'CN', alpha3: 'CHN', name: 'China' },
  { code: 'CO', alpha3: 'COL', name: 'Colombia' },
  { code: 'KM', alpha3: 'COM', name: 'Comoros' },
  { code: 'CG', alpha3: 'COG', name: 'Congo' },
  { code: 'CD', alpha3: 'COD', name: 'Congo (DRC)' },
  { code: 'CR', alpha3: 'CRI', name: 'Costa Rica' },
  { code: 'CI', alpha3: 'CIV', name: "Côte d'Ivoire" },
  { code: 'HR', alpha3: 'HRV', name: 'Croatia' },
  { code: 'CU', alpha3: 'CUB', name: 'Cuba' },
  { code: 'CY', alpha3: 'CYP', name: 'Cyprus' },
  { code: 'CZ', alpha3: 'CZE', name: 'Czechia' },
  { code: 'DK', alpha3: 'DNK', name: 'Denmark' },
  { code: 'DJ', alpha3: 'DJI', name: 'Djibouti' },
  { code: 'DM', alpha3: 'DMA', name: 'Dominica' },
  { code: 'DO', alpha3: 'DOM', name: 'Dominican Republic' },
  { code: 'EC', alpha3: 'ECU', name: 'Ecuador' },
  { code: 'EG', alpha3: 'EGY', name: 'Egypt' },
  { code: 'SV', alpha3: 'SLV', name: 'El Salvador' },
  { code: 'GQ', alpha3: 'GNQ', name: 'Equatorial Guinea' },
  { code: 'ER', alpha3: 'ERI', name: 'Eritrea' },
  { code: 'EE', alpha3: 'EST', name: 'Estonia' },
  { code: 'SZ', alpha3: 'SWZ', name: 'Eswatini' },
  { code: 'ET', alpha3: 'ETH', name: 'Ethiopia' },
  { code: 'FJ', alpha3: 'FJI', name: 'Fiji' },
  { code: 'FI', alpha3: 'FIN', name: 'Finland' },
  { code: 'FR', alpha3: 'FRA', name: 'France' },
  { code: 'GA', alpha3: 'GAB', name: 'Gabon' },
  { code: 'GM', alpha3: 'GMB', name: 'Gambia' },
  { code: 'GE', alpha3: 'GEO', name: 'Georgia' },
  { code: 'DE', alpha3: 'DEU', name: 'Germany' },
  { code: 'GH', alpha3: 'GHA', name: 'Ghana' },
  { code: 'GR', alpha3: 'GRC', name: 'Greece' },
  { code: 'GD', alpha3: 'GRD', name: 'Grenada' },
  { code: 'GT', alpha3: 'GTM', name: 'Guatemala' },
  { code: 'GN', alpha3: 'GIN', name: 'Guinea' },
  { code: 'GW', alpha3: 'GNB', name: 'Guinea-Bissau' },
  { code: 'GY', alpha3: 'GUY', name: 'Guyana' },
  { code: 'HT', alpha3: 'HTI', name: 'Haiti' },
  { code: 'HN', alpha3: 'HND', name: 'Honduras' },
  { code: 'HK', alpha3: 'HKG', name: 'Hong Kong' },
  { code: 'HU', alpha3: 'HUN', name: 'Hungary' },
  { code: 'IS', alpha3: 'ISL', name: 'Iceland' },
  { code: 'IN', alpha3: 'IND', name: 'India' },
  { code: 'ID', alpha3: 'IDN', name: 'Indonesia' },
  { code: 'IR', alpha3: 'IRN', name: 'Iran' },
  { code: 'IQ', alpha3: 'IRQ', name: 'Iraq' },
  { code: 'IE', alpha3: 'IRL', name: 'Ireland' },
  { code: 'IL', alpha3: 'ISR', name: 'Israel' },
  { code: 'IT', alpha3: 'ITA', name: 'Italy' },
  { code: 'JM', alpha3: 'JAM', name: 'Jamaica' },
  { code: 'JP', alpha3: 'JPN', name: 'Japan' },
  { code: 'JO', alpha3: 'JOR', name: 'Jordan' },
  { code: 'KZ', alpha3: 'KAZ', name: 'Kazakhstan' },
  { code: 'KE', alpha3: 'KEN', name: 'Kenya' },
  { code: 'KI', alpha3: 'KIR', name: 'Kiribati' },
  { code: 'KW', alpha3: 'KWT', name: 'Kuwait' },
  { code: 'KG', alpha3: 'KGZ', name: 'Kyrgyzstan' },
  { code: 'LA', alpha3: 'LAO', name: 'Laos' },
  { code: 'LV', alpha3: 'LVA', name: 'Latvia' },
  { code: 'LB', alpha3: 'LBN', name: 'Lebanon' },
  { code: 'LS', alpha3: 'LSO', name: 'Lesotho' },
  { code: 'LR', alpha3: 'LBR', name: 'Liberia' },
  { code: 'LY', alpha3: 'LBY', name: 'Libya' },
  { code: 'LI', alpha3: 'LIE', name: 'Liechtenstein' },
  { code: 'LT', alpha3: 'LTU', name: 'Lithuania' },
  { code: 'LU', alpha3: 'LUX', name: 'Luxembourg' },
  { code: 'MO', alpha3: 'MAC', name: 'Macao' },
  { code: 'MG', alpha3: 'MDG', name: 'Madagascar' },
  { code: 'MW', alpha3: 'MWI', name: 'Malawi' },
  { code: 'MY', alpha3: 'MYS', name: 'Malaysia' },
  { code: 'MV', alpha3: 'MDV', name: 'Maldives' },
  { code: 'ML', alpha3: 'MLI', name: 'Mali' },
  { code: 'MT', alpha3: 'MLT', name: 'Malta' },
  { code: 'MH', alpha3: 'MHL', name: 'Marshall Islands' },
  { code: 'MR', alpha3: 'MRT', name: 'Mauritania' },
  { code: 'MU', alpha3: 'MUS', name: 'Mauritius' },
  { code: 'MX', alpha3: 'MEX', name: 'Mexico' },
  { code: 'FM', alpha3: 'FSM', name: 'Micronesia' },
  { code: 'MD', alpha3: 'MDA', name: 'Moldova' },
  { code: 'MC', alpha3: 'MCO', name: 'Monaco' },
  { code: 'MN', alpha3: 'MNG', name: 'Mongolia' },
  { code: 'ME', alpha3: 'MNE', name: 'Montenegro' },
  { code: 'MA', alpha3: 'MAR', name: 'Morocco' },
  { code: 'MZ', alpha3: 'MOZ', name: 'Mozambique' },
  { code: 'MM', alpha3: 'MMR', name: 'Myanmar' },
  { code: 'NA', alpha3: 'NAM', name: 'Namibia' },
  { code: 'NR', alpha3: 'NRU', name: 'Nauru' },
  { code: 'NP', alpha3: 'NPL', name: 'Nepal' },
  { code: 'NL', alpha3: 'NLD', name: 'Netherlands' },
  { code: 'NZ', alpha3: 'NZL', name: 'New Zealand' },
  { code: 'NI', alpha3: 'NIC', name: 'Nicaragua' },
  { code: 'NE', alpha3: 'NER', name: 'Niger' },
  { code: 'NG', alpha3: 'NGA', name: 'Nigeria' },
  { code: 'KP', alpha3: 'PRK', name: 'North Korea' },
  { code: 'MK', alpha3: 'MKD', name: 'North Macedonia' },
  { code: 'NO', alpha3: 'NOR', name: 'Norway' },
  { code: 'OM', alpha3: 'OMN', name: 'Oman' },
  { code: 'PK', alpha3: 'PAK', name: 'Pakistan' },
  { code: 'PW', alpha3: 'PLW', name: 'Palau' },
  { code: 'PS', alpha3: 'PSE', name: 'Palestine' },
  { code: 'PA', alpha3: 'PAN', name: 'Panama' },
  { code: 'PG', alpha3: 'PNG', name: 'Papua New Guinea' },
  { code: 'PY', alpha3: 'PRY', name: 'Paraguay' },
  { code: 'PE', alpha3: 'PER', name: 'Peru' },
  { code: 'PH', alpha3: 'PHL', name: 'Philippines' },
  { code: 'PL', alpha3: 'POL', name: 'Poland' },
  { code: 'PT', alpha3: 'PRT', name: 'Portugal' },
  { code: 'PR', alpha3: 'PRI', name: 'Puerto Rico' },
  { code: 'QA', alpha3: 'QAT', name: 'Qatar' },
  { code: 'RO', alpha3: 'ROU', name: 'Romania' },
  { code: 'RU', alpha3: 'RUS', name: 'Russia' },
  { code: 'RW', alpha3: 'RWA', name: 'Rwanda' },
  { code: 'KN', alpha3: 'KNA', name: 'Saint Kitts and Nevis' },
  { code: 'LC', alpha3: 'LCA', name: 'Saint Lucia' },
  { code: 'VC', alpha3: 'VCT', name: 'Saint Vincent and the Grenadines' },
  { code: 'WS', alpha3: 'WSM', name: 'Samoa' },
  { code: 'SM', alpha3: 'SMR', name: 'San Marino' },
  { code: 'ST', alpha3: 'STP', name: 'São Tomé and Príncipe' },
  { code: 'SA', alpha3: 'SAU', name: 'Saudi Arabia' },
  { code: 'SN', alpha3: 'SEN', name: 'Senegal' },
  { code: 'RS', alpha3: 'SRB', name: 'Serbia' },
  { code: 'SC', alpha3: 'SYC', name: 'Seychelles' },
  { code: 'SL', alpha3: 'SLE', name: 'Sierra Leone' },
  { code: 'SG', alpha3: 'SGP', name: 'Singapore' },
  { code: 'SK', alpha3: 'SVK', name: 'Slovakia' },
  { code: 'SI', alpha3: 'SVN', name: 'Slovenia' },
  { code: 'SB', alpha3: 'SLB', name: 'Solomon Islands' },
  { code: 'SO', alpha3: 'SOM', name: 'Somalia' },
  { code: 'ZA', alpha3: 'ZAF', name: 'South Africa' },
  { code: 'KR', alpha3: 'KOR', name: 'South Korea' },
  { code: 'SS', alpha3: 'SSD', name: 'South Sudan' },
  { code: 'ES', alpha3: 'ESP', name: 'Spain' },
  { code: 'LK', alpha3: 'LKA', name: 'Sri Lanka' },
  { code: 'SD', alpha3: 'SDN', name: 'Sudan' },
  { code: 'SR', alpha3: 'SUR', name: 'Suriname' },
  { code: 'SE', alpha3: 'SWE', name: 'Sweden' },
  { code: 'CH', alpha3: 'CHE', name: 'Switzerland' },
  { code: 'SY', alpha3: 'SYR', name: 'Syria' },
  { code: 'TW', alpha3: 'TWN', name: 'Taiwan' },
  { code: 'TJ', alpha3: 'TJK', name: 'Tajikistan' },
  { code: 'TZ', alpha3: 'TZA', name: 'Tanzania' },
  { code: 'TH', alpha3: 'THA', name: 'Thailand' },
  { code: 'TL', alpha3: 'TLS', name: 'Timor-Leste' },
  { code: 'TG', alpha3: 'TGO', name: 'Togo' },
  { code: 'TO', alpha3: 'TON', name: 'Tonga' },
  { code: 'TT', alpha3: 'TTO', name: 'Trinidad and Tobago' },
  { code: 'TN', alpha3: 'TUN', name: 'Tunisia' },
  { code: 'TR', alpha3: 'TUR', name: 'Türkiye' },
  { code: 'TM', alpha3: 'TKM', name: 'Turkmenistan' },
  { code: 'TV', alpha3: 'TUV', name: 'Tuvalu' },
  { code: 'UG', alpha3: 'UGA', name: 'Uganda' },
  { code: 'UA', alpha3: 'UKR', name: 'Ukraine' },
  { code: 'AE', alpha3: 'ARE', name: 'United Arab Emirates' },
  { code: 'GB', alpha3: 'GBR', name: 'United Kingdom' },
  { code: 'US', alpha3: 'USA', name: 'United States' },
  { code: 'UY', alpha3: 'URY', name: 'Uruguay' },
  { code: 'UZ', alpha3: 'UZB', name: 'Uzbekistan' },
  { code: 'VU', alpha3: 'VUT', name: 'Vanuatu' },
  { code: 'VA', alpha3: 'VAT', name: 'Vatican City' },
  { code: 'VE', alpha3: 'VEN', name: 'Venezuela' },
  { code: 'VN', alpha3: 'VNM', name: 'Vietnam' },
  { code: 'YE', alpha3: 'YEM', name: 'Yemen' },
  { code: 'ZM', alpha3: 'ZMB', name: 'Zambia' },
  { code: 'ZW', alpha3: 'ZWE', name: 'Zimbabwe' },
];

const NAME_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c.name]));
const ALPHA2_BY_ALPHA3 = new Map(COUNTRIES.map((c) => [c.alpha3, c.code]));

/**
 * Normalise a country token to the canonical alpha-2 code: alpha-2 passes
 * through, alpha-3 maps down (GBR → GB), anything else is returned upper-cased
 * unchanged (an unknown token then simply never matches a picker selection).
 */
export function toAlpha2(code: string): string {
  const upper = code.trim().toUpperCase();
  return ALPHA2_BY_ALPHA3.get(upper) ?? upper;
}

/** Display name for a code, or the code itself for one we don't know. */
export function countryName(code: string): string {
  return NAME_BY_CODE.get(code.trim().toUpperCase()) ?? code.trim().toUpperCase();
}

/** True when `code` is a country this picker knows. */
export function isKnownCountry(code: string): boolean {
  return NAME_BY_CODE.has(code.trim().toUpperCase());
}

/**
 * Best-effort ISO country code from the device locale — the picker's
 * pre-selection (user can always change it). Dependency-free: Hermes'
 * `Intl.DateTimeFormat().resolvedOptions().locale` yields a BCP-47 tag like
 * "en-GB"; the region subtag is the alpha-2 code. Returns null when the
 * locale carries no known region (then the picker just starts empty).
 */
export function deviceCountryCode(): string | null {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
    // Skip the language subtag (index 0); the region is the first 2-alpha
    // subtag after it ("en-GB" → GB, "zh-Hans-CN" → CN, bare "en" → none).
    const region = locale
      .split('-')
      .slice(1)
      .find((part) => /^[A-Za-z]{2}$/.test(part));
    if (!region) return null;
    const code = region.toUpperCase();
    return isKnownCountry(code) ? code : null;
  } catch {
    return null;
  }
}
