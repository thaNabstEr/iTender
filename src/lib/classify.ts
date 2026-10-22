// Deciding whether a tender is ours, with keyword rules for now. PLAN.md has Claude doing this
// after a keyword pre-filter; `classify` keeps the shape that Claude call would return, so it can
// be swapped in without touching the fetch job.

export type WorkType = 'website' | 'system' | 'design';

export interface Classification {
  relevant: boolean;
  workType: WorkType | null;
  /** One plain sentence saying why, shown on the tender. */
  reason: string;
}

// Physical kit and services that share words with our work ("fire detection system", "branded
// merchandise"). A match here rules a tender out unless it also names website or software work.
const NOT_OURS = [
  /\bfire (detection|protection|suppression)\b/, /\bcctv\b/, /\bcamera/, /\bups\b/, /uninterruptible power/,
  /\bvehicle tracking\b/, /\bfleet\b/, /\bsound system\b/, /\baudio\b/, /\bradio\b/,
  /\bintercom\b/, /\blift\b/, /\bpump/, /\bsolar\b/, /\bphotovoltaic\b/, /\bx-ray\b/, /\bweighbridge/,
  /\bmeter(ing)? /, /\bsmart meter/, /\bmetering\b/, /\bcontrol system/, /\bbiometric/, /\baccess control\b/,
  /\bfurniture\b/, /\bcatering\b/, /\bcleaning\b/, /\bsecurity (officers|guards|services)\b/, /\bfumigation\b/,
  /\bconstruction\b/, /\brefurbish/, /\bplumbing\b/, /\belectrical\b/, /\bgenerator/, /\bdiesel\b/, /\bfuel\b/,
  /\btank\b/, /\bmachinery\b/, /\bstationery\b/, /\bconsumables\b/, /\btoner/, /\blaptops?\b/, /\bdesktops?\b/,
  /\bservers?\b/, /\bprinters?\b/, /\bhardware\b/, /\bnetwork (cabling|infrastructure)\b/, /\bfibre\b/,
  /\bmerchandise\b/, /\bpromotional (items|material)/, /\bbranding (items|material)/, /\bbranded\b/,
  /\bsupply and deliver/, /\bsupply & deliver/, /\btraining\b/, /\bcourses?\b/, /\bmembership\b/,
  /\bsubscription\b/, /\blicen[cs]e (renewal|subscription)s?\b/, /\brenewal of\b/, /\bmedical\b/,
  /\bpanel of (experts|professionals)/, /\bindividual experts\b/, /\bfirewalls?\b/, /\btelecomm?s?\b/,
  /\bsoftware licen[cs]es\b/, /\bsd-wan\b/, /\bwide area network\b/, /\bwi-?fi\b/, /\badobe\b/, /\bnetwork management\b/, /\bdata loggers?\b/, /\boffice space\b/, /\blease\b/, /\blabels\b/, /\brelocation\b/,
  /\bcontravention/, /\bspeed (cameras|law)/, /\bticketing device/, /\bpoint-of-sale\b/, /\bpublication of names\b/,
];

// What counts as each kind of work. The first rule that matches wins, so the order matters:
// a "website and hosting" tender is website work, not systems.
const RULES: { type: WorkType; re: RegExp; label: string }[] = [
  { type: 'website', re: /\bweb ?sites?\b/, label: 'a website' },
  { type: 'website', re: /\bweb (portal|platform|presence)\b/, label: 'a web portal' },
  { type: 'website', re: /\bintranet\b/, label: 'an intranet' },
  { type: 'website', re: /\be-?commerce\b/, label: 'online selling' },
  { type: 'system', re: /\bmobile app(lication)?s?\b/, label: 'a mobile app' },
  { type: 'system', re: /\bweb (application|app|based system)s?\b/, label: 'a web application' },
  { type: 'system', re: /\b(software|application|system|systems) development\b/, label: 'software development' },
  { type: 'system', re: /\bdevelop(ment of|ing)?( and \w+)? (a|an|the)? ?([\w-]+ ){0,5}(system|platform|portal|application|app|database|dashboard|tool)\b/, label: 'building a system' },
  { type: 'system', re: /\b(design|redesign|build|implement|customi[sz]e|enhance|upgrade)( and \w+)? (of )?(a|an|the)? ?([\w-]+ ){0,5}(system|platform|portal|database|dashboard)\b/, label: 'building a system' },
  { type: 'system', re: /\b(management|information|records|document management|performance management|case management|reporting) system\b/, label: 'a management system' },
  { type: 'system', re: /\b(digital|online|electronic) (platform|portal|system|solution)\b/, label: 'a digital platform' },
  { type: 'system', re: /\bsoftware (solution|platform)\b/, label: 'a software solution' },
  { type: 'system', re: /\b(erp|crm)\b/, label: 'business software' },
  { type: 'system', re: /\bdata hub\b|\bdatabase\b|\bdashboard\b/, label: 'a data system' },
  { type: 'system', re: /\b(assessment|verification|kyc|billing|booking|payroll|learner|student|revenue|permit|queue|appointment|profiling|archiving|e-[a-z]+) (management )?(system|software)\b/, label: 'a software system' },
  { type: 'system', re: /\bsoftware\b/, label: 'software' },
  { type: 'design', re: /\bgraphic design\b/, label: 'graphic design' },
  { type: 'design', re: /\bcorporate identity\b|\bbrand identity\b|\blogo design\b/, label: 'corporate identity' },
  { type: 'design', re: /\bdesign(,)? (and|&) layout\b|\blayout and design\b/, label: 'design and layout' },
  { type: 'design', re: /\bbrochures?\b|\bannual report design\b|\bmagazine design\b/, label: 'publication design' },
  { type: 'design', re: /\bbranding (and|&) (marketing|communication)|\b(marketing|communication)s?,? (and |& )?branding\b/, label: 'branding work' },
];

const OVERRIDES_NOT_OURS = /\b(develop|redevelop|design|build|revamp)\w* (of )?(a |an |the )?([\w-]+ ){0,3}web ?sites?\b|\bsoftware development\b/;

// Where the tender is published or how to join a meeting, not the work itself.
const ABOUT_THE_TENDER = /\b(on|from|via|through|at) (the |our |its )?([\w-]+ ){0,2}(website|web site|e-?tenders? portal|portal)\b|\bhttps?:\/\/\S+|\bwww\.\S+|\b(teams|zoom) link\b/g;

/** Is this tender our kind of work? Reads the description only; the API's title is a reference. */
export function classify(description: string | null): Classification {
  const text = ` ${description ?? ''} `.toLowerCase().replace(/\s+/g, ' ').replace(ABOUT_THE_TENDER, ' ');
  const rule = RULES.find((r) => r.re.test(text));
  if (!rule) return { relevant: false, workType: null, reason: 'No website, systems or design work in the description.' };
  const blocker = NOT_OURS.find((re) => re.test(text));
  if (blocker && !OVERRIDES_NOT_OURS.test(text)) {
    const word = text.match(blocker)?.[0].trim();
    return { relevant: false, workType: rule.type, reason: `Mentions ${rule.label}, but it’s about ${word}.` };
  }
  return { relevant: true, workType: rule.type, reason: `The description asks for ${rule.label}.` };
}

// ---------- Readable titles ----------

// Kept in capitals when a description written in capitals is put into sentence case.
const ACRONYMS = new Set([
  'ict', 'it', 'erp', 'crm', 'sap', 'gis', 'hr', 'sms', 'api', 'ui', 'ux', 'cms', 'saas', 'aws', 'pms',
  'mis', 'kyc', 'sd', 'wan', 'tvet', 'seta', 'sassa', 'nhbrc', 'sanral', 'prasa', 'acsa', 'csir', 'saqa', 'nersa', 'irba',
  'sabs', 'dbsa', 'idc', 'sita', 'gpl', 'kzn', 'ec', 'wc', 'nw', 'fs', 'sa', 'rsa', 'dns', 'ai', 'bi',
  'cctv', 'rfq', 'rfp', 'rfi', 'ppe', 'sop', 'mscoa', 'idp', 'lm', 'dm', 'vat', 'faq',
]);

const LEADING_NOISE = [
  /^(re-?advert(isement)?|readvert|re-?advertised)\s*[:\-–]?\s*/i,
  /^(formal tender|request for (quotation|proposals?|information|bid)s?( \((rfq|rfp|rfi)\))?|terms of reference|tender|bid|rfq|rfp|rfi)\s*[:\-–]?\s*/i,
  /^(?:[A-Z]{1,6}\s?)?[A-Z0-9][A-Z0-9/\-_.()]*\d[A-Z0-9/\-_.()]*\s*[:\-–]\s*/i, // a reference number and a colon
  /^(for )?the\s+/i,
  /^[\w\s-]{0,30}\bcontract\s*:\s*/i,
  /^.{0,120}?\b(service providers?|partners?|company|companies|bidders?|consultants?|firms?)( who (is|are) [^,]+?)?\s+(to|for|that will)\s+(the\s+)?/i,
  /^(a|an|the)\s+/i,
  /^(for the |for )/i,
  /^(provision|procurement|establishment) of (an? |the )?/i,
];

const TRAILING_NOISE = /\s*(,|\.|:)?\s*(for|over|during|within)? ?(a|the)? ?period (of|ending).*$|\s+for (a|the) (duration|term) of.*$|\s+for (\w+ )?\(?\d+\)? (months|years).*$|\s*\(\d+ ?(months|years)\).*$/i;

function sentenceCase(s: string): string {
  const letters = s.replace(/[^a-z]/gi, '');
  const caps = letters.replace(/[^A-Z]/g, '').length;
  const mostlyCaps = letters.length > 0 && caps / letters.length > 0.6;
  const out = mostlyCaps
    ? s.toLowerCase().replace(/\b[a-z]+\b/g, (w) => (ACRONYMS.has(w) ? w.toUpperCase() : w))
    : s;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** A description written in capitals, in sentence case. Mixed-case text is left as it is. */
export function readableText(s: string | null): string | null {
  return s ? sentenceCase(s.replace(/\s+/g, ' ').trim()) : s;
}

/** "APPOINTMENT OF A SERVICE PROVIDER TO REDEVELOP THE WEBSITE FOR THE GPL FOR A PERIOD…" -> "Redevelop the website for the GPL" */
export function readableTitle(description: string | null, reference: string | null): string | null {
  let s = (description ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return reference;
  if (reference && s.toUpperCase().startsWith(reference.toUpperCase())) s = s.slice(reference.length).replace(/^\s*[:\-–]?\s*/, '');
  for (let pass = 0; pass < 3; pass++) for (const re of LEADING_NOISE) s = s.replace(re, '');
  s = s.replace(TRAILING_NOISE, '');
  // The first sentence only, and at most about 90 characters, cut at a word.
  s = s.split(/(?<=[a-z0-9)])\.\s/i)[0].replace(/[.,;:\s]+$/, '');
  if (s.length > 90) s = s.slice(0, 90).replace(/\s+\S*$/, '') + '…';
  return s ? sentenceCase(s) : reference;
}

// ---------- Province ----------

export const PROVINCE_NAMES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'] as const;

// Place names, mostly metros, districts and the larger towns, each with its province. Checked
// against buyer names and descriptions. Unknown places leave the province for the user to set.
const PLACES: [RegExp, string][] = [
  [/\beastern cape\b|\bnelson mandela bay\b|\bgqeberha\b|\bport elizabeth\b|\bbuffalo city\b|\beast london\b|\bmthatha\b|\bkouga\b|\bndlambe\b|\bmatatiele\b|\belundini\b|\bjoe gqabi\b|\bsundays river\b|\binxuba yethemba\b|\bingquza\b|\bumzimvubu\b|\bamathole\b|\bchris hani\b|\bo\.?r\.? tambo\b|\balfred nzo\b|\bsarah baartman\b|\bmakana\b|\bmakhanda\b|\bgrahamstown\b|\bqueenstown\b|\bkomani\b|\benoch mgijima\b|\bwalter sisulu\b|\bdr beyers naude\b|\bking sabata\b|\bmnquma\b|\bwinnie madikizela/, 'Eastern Cape'],
  [/\bfree state\b|\bmangaung\b|\bbloemfontein\b|\bmatjhabeng\b|\bwelkom\b|\bmaluti-?a-?phofung\b|\bmoqhaka\b|\bkroonstad\b|\bmetsimaholo\b|\bsasolburg\b|\bdihlabeng\b|\bbethlehem\b|\bcentlec\b|\bthabo mofutsanyana\b|\blejweleputswa\b|\bfezile dabi\b|\bxhariep\b|\bnala local\b|\bmafube\b|\bngwathe\b|\bsetsoto\b|\bnketoana\b|\bmantsopa\b|\bmasilonyana\b|\btokologo\b|\btswelopele\b|\bkopanong\b|\bmohokare\b|\bletsemeng\b/, 'Free State'],
  [/\bgauteng\b|\bjohannesburg\b|\bjoburg\b|\btshwane\b|\bpretoria\b|\bekurhuleni\b|\bsoweto\b|\bmidvaal\b|\bemfuleni\b|\bvanderbijlpark\b|\bvereeniging\b|\bmogale\b|\bkrugersdorp\b|\brand west\b|\bmerafong\b|\blesedi\b|\bsedibeng\b|\bwest rand\b|\bcity power\b|\bjra\b|\bthaba tshwane\b|\bmidrand\b|\bcenturion\b|\bsandton\b|\bgautrain\b/, 'Gauteng'],
  [/\bkwa-?zulu[- ]natal\b|\bkzn\b|\bethekwini\b|\bdurban\b|\bpietermaritzburg\b|\bmsunduzi\b|\bking shaka\b|\babaqulusi\b|\bumzinyathi\b|\bamajuba\b|\bnewcastle\b|\bumzimkhulu\b|\bnkandla\b|\bumlalazi\b|\bharry gwala\b|\bugu district\b|\bray nkonyeni\b|\bumhlathuze\b|\brichards bay\b|\bking cetshwayo\b|\bzululand\b|\bilembe\b|\bumgungundlovu\b|\buthukela\b|\bumkhanyakude\b|\bladysmith\b|\balfred duma\b|\bezemvelo\b|\bplayhouse company\b|\bmngeni\b|\belangeni\b|\bmajuba tvet\b|\bkokstad\b|\bport shepstone\b|\bulundi\b|\bvryheid\b|\bdundee\b|\bestcourt\b|\bmtubatuba\b/, 'KwaZulu-Natal'],
  [/\blimpopo\b|\bpolokwane\b|\bmopani\b|\bvhembe\b|\bcapricorn district\b|\bsekhukhune\b|\bwaterberg\b|\bba-?phalaborwa\b|\bbela[- ]bela\b|\bmakhuduthamaga\b|\bthulamela\b|\bthohoyandou\b|\bmakhado\b|\blouis trichardt\b|\bgreater tzaneen\b|\btzaneen\b|\bmogalakwena\b|\bmokopane\b|\blephalale\b|\bmodimolle\b|\bthabazimbi\b|\bfetakgomo\b|\belias motsoaledi\b|\bephraim mogale\b|\bmolemole\b|\bblouberg\b|\blepelle-?nkumpi\b|\bmusina\b|\bcollins chabane\b|\bgreater giyani\b|\bgreater letaba\b|\bmaruleng\b/, 'Limpopo'],
  [/\bmpumalanga\b|\bmbombela\b|\bnelspruit\b|\bmsukaligwa\b|\bermelo\b|\bnkangala\b|\bgert sibande\b|\behlanzeni\b|\bchief albert luthuli\b|\bemalahleni\b|\bwitbank\b|\bsteve tshwete\b|\bmiddelburg\b|\bgovan mbeki\b|\bsecunda\b|\bbushbuckridge\b|\bthaba chweu\b|\bnkomazi\b|\bmkhondo\b|\bpixley ka seme\b|\blekwa\b|\bdipaleseng\b|\bdr js moroka\b|\bthembisile hani\b|\bvictor khanye\b|\bemakhazeni\b|\bdr pixley\b/, 'Mpumalanga'],
  [/\bnorth[- ]west\b|\bmahikeng\b|\bmafikeng\b|\brustenburg\b|\bmoses kotane\b|\bkgetlengrivier\b|\bkagisano\b|\bnaledi - nw\b|\bmatlosana\b|\bklerksdorp\b|\bpotchefstroom\b|\bjb marks\b|\bmadibeng\b|\bbrits\b|\bbojanala\b|\bngaka modiri molema\b|\bdr kenneth kaunda\b|\bdr ruth segomotsi mompati\b|\bvryburg\b|\bditsobotla\b|\bramotshere\b|\bratlou\b|\btswaing\b|\bmaquassi\b|\bgreater taung\b|\blekwa-teemane\b|\bmamusa\b/, 'North West'],
  [/\bnorthern cape\b|\bkimberley\b|\bsol plaatje\b|\bupington\b|\bdawid kruiper\b|\bnama khoi\b|\bspringbok\b|\bumsobomvu\b|\bfrances baard\b|\bzf mgcawu\b|\bjohn taolo gaetsewe\b|\bnamakwa\b|\bpixley ka seme district\b|\bkuruman\b|\bga-segonyana\b|\bdikgatlong\b|\bmagareng\b|\bphokwane\b|\bemthanjeni\b|\bde aar\b|\bhantam\b|\bkaroo hoogland\b|\bkhai-ma\b|\bkamiesberg\b|\brichtersveld\b/, 'Northern Cape'],
  [/\bwestern cape\b|\bcape town\b|\bgeorge municipality\b|\bgeorge\b(?= local| municipality)|\bswellendam\b|\boudtshoorn\b|\bcango caves\b|\bmossel bay\b|\bcape winelands\b|\blangeberg\b|\bdrakenstein\b|\bpaarl\b|\bstellenbosch\b|\boverberg\b|\bbeaufort west\b|\bknysna\b|\bbitou\b|\bplettenberg\b|\bhessequa\b|\bgarden route\b|\bsaldanha\b|\bswartland\b|\bbergrivier\b|\bcederberg\b|\bmatzikama\b|\bwitzenberg\b|\bbreede valley\b|\bworcester\b|\btheewaterskloof\b|\bcape agulhas\b|\boverstrand\b|\bhermanus\b|\bwest coast district\b|\bcentral karoo\b|\bprince albert\b|\blaingsburg\b|\bkannaland\b|\biziko\b|\bartscape\b|\bnorthlink\b|\bsouth cape tvet\b/, 'Western Cape'],
];

const LOCAL_BODY = /\bmunicipal|\bmunicipality|\bmunicipality\b|\bdistrict\b|\bmetro\b|\bcity of\b|\bcity council\b|\btvet\b|\bcollege\b|\bwater board\b/;

export interface ProvinceGuess {
  province: string | null;
  source: 'lookup' | 'read' | null;
}

function placeIn(text: string): string | null {
  const t = text.toLowerCase();
  return PLACES.find(([re]) => re.test(t))?.[1] ?? null;
}

/** The buyer's own province, for the buyers table: a "Limpopo - …" prefix, a place in the name, or National. */
export function buyerProvince(name: string | null): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (/^national\b/.test(n)) return 'National';
  const place = placeIn(name);
  if (place) return place;
  // A municipality, college or water board we don't know: leave it for the user.
  if (LOCAL_BODY.test(n)) return null;
  return 'National';
}

/**
 * The tender's province: a place named in the description wins over the buyer's province
 * ("read"), because a national department can advertise work in one city.
 */
export function tenderProvince(buyerProv: string | null, description: string | null): ProvinceGuess {
  const read = description ? placeIn(description) : null;
  if (read && read !== buyerProv) return { province: read, source: 'read' };
  if (buyerProv) return { province: buyerProv, source: 'lookup' };
  if (read) return { province: read, source: 'read' };
  return { province: null, source: null };
}
