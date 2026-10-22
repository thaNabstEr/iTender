// Rules for South African business details, in one place. The Settings form uses `html` (the
// browser checks as you type and on submit) and the save action uses `check` (the server, which
// can't be skipped). Each rule has a plain-language `hint` shown when it fails.

export interface Rule {
  /** Matches a valid value, after `clean`. */
  test: RegExp;
  /** Tidies what was typed before testing and storing. */
  clean?: (s: string) => string;
  /** Said when the value is wrong. */
  hint: string;
  /** The same rule as an HTML pattern, which the browser anchors itself. Browsers compile it with the
   *  strict `v` flag, so ( ) - inside [...] must be escaped; a pattern that fails to compile is
   *  silently ignored, which would let anything through. */
  html: string;
}

const spaces = (s: string) => s.replace(/\s+/g, ' ').trim();
const noSpaces = (s: string) => s.replace(/[\s-]/g, '');

export const RULES = {
  name: {
    test: /^.{2,100}$/,
    clean: spaces,
    hint: 'Enter the company name as it is registered, at least 2 letters.',
    html: '.{2,100}',
  },
  initials: {
    test: /^[A-Z]{1,3}$/,
    clean: (s) => s.replace(/[\s.]/g, '').toUpperCase(),
    hint: 'Use 1 to 3 letters, like AD.',
    html: '[A-Za-z]{1,3}',
  },
  registrationNumber: {
    test: /^\d{4}\/\d{6}\/\d{2}$/,
    clean: noSpaces,
    hint: 'A CIPC registration number looks like 2019/123456/07.',
    html: '\\s*\\d{4}/\\d{6}/\\d{2}\\s*',
  },
  csdNumber: {
    test: /^MAAA\d{7}$/,
    clean: (s) => noSpaces(s).toUpperCase(),
    hint: 'A CSD supplier number is MAAA followed by 7 digits, like MAAA0123456.',
    html: '\\s*[Mm][Aa][Aa][Aa]\\d{7}\\s*',
  },
  taxPin: {
    test: /^[A-Z0-9]{10}$/,
    clean: (s) => noSpaces(s).toUpperCase(),
    hint: 'A tax compliance PIN is 10 letters and numbers, as on your SARS compliance status.',
    html: '\\s*[A-Za-z0-9]{10}\\s*',
  },
  vatNumber: {
    test: /^4\d{9}$/,
    clean: noSpaces,
    hint: 'A VAT number is 10 digits and starts with 4, like 4123456789.',
    html: '\\s*4[0-9 ]{9,12}\\s*',
  },
  address: {
    test: /^.{8,200}$/,
    clean: spaces,
    hint: 'Enter the full physical address: street, suburb, city and postal code.',
    html: '.{8,200}',
  },
  contactPerson: {
    test: /^[\p{L}][\p{L} .'’-]{1,59}$/u,
    clean: spaces,
    hint: 'Enter a name using letters only, like Thandi Nkosi.',
    html: "[A-Za-z\\u00C0-\\u024F][A-Za-z\\u00C0-\\u024F .'’\\-]{1,59}",
  },
  phone: {
    // A South African number: 0 and 9 digits, or +27 and 9 digits, with spaces, dashes or brackets.
    test: /^(\+27|0)\d{9}$/,
    clean: (s) => s.replace(/[\s\-()]/g, ''),
    hint: 'Enter a South African number, like 011 555 0123, 082 555 0123 or +27 82 555 0123.',
    html: '[+0][0-9 \\(\\)\\-]{9,20}',
  },
  email: {
    test: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
    clean: (s) => s.trim().toLowerCase(),
    hint: 'Enter an email address like name@company.co.za.',
    html: '[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}',
  },
} satisfies Record<string, Rule>;

export type RuleName = keyof typeof RULES;

/** Tidies a value for storing, or returns null if it's empty. */
export function tidy(rule: Rule, value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? (rule.clean ? rule.clean(v) : v) : null;
}

/** Null when the value is empty or valid, otherwise the hint. */
export function check(rule: Rule, value: string | null | undefined): string | null {
  const v = tidy(rule, value);
  return v === null || rule.test.test(v) ? null : rule.hint;
}

/** How a phone number is stored and shown: 011 555 0123, or +27 11 555 0123. */
export function formatPhone(clean: string): string {
  if (clean.startsWith('+27')) return `+27 ${clean.slice(3, 5)} ${clean.slice(5, 8)} ${clean.slice(8)}`;
  return `${clean.slice(0, 3)} ${clean.slice(3, 6)} ${clean.slice(6)}`;
}

/** The text the form shows for a stored value (registration numbers etc. are stored tidy). */
export function display(name: RuleName, value: string | null | undefined): string {
  if (!value) return '';
  return name === 'phone' && RULES.phone.test.test(value) ? formatPhone(value) : value;
}
