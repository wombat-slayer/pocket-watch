// ── Chart design-system palette ───────────────────────────────
export const CHART = {
  primary:   '#6366f1',
  secondary: '#8b5cf6',
  tertiary:  '#06b6d4',
  income:    '#10b981',
  expense:   '#ef4444',
  amber:     '#f59e0b',
  gridLine:  'rgba(255,255,255,0.06)',
  gridLabel: '#8b8fa8',
};

// ─── Categories ───────────────────────────────────────────────────────────────
export const CATEGORIES = [
  { name: 'Housing',       icon: '🏠', color: '#6366f1' },
  { name: 'Food & Dining', icon: '🍔', color: '#f59e0b' },
  { name: 'Transportation',icon: '🚗', color: '#3b82f6' },
  { name: 'Entertainment', icon: '🎬', color: '#ec4899' },
  { name: 'Healthcare',    icon: '💊', color: '#10b981' },
  { name: 'Insurance',     icon: '🛡️', color: '#0ea5e9' },
  { name: 'Shopping',      icon: '🛍️', color: '#8b5cf6' },
  { name: 'Utilities',     icon: '⚡', color: '#f97316' },
  { name: 'Subscriptions', icon: '📱', color: '#06b6d4' },
  { name: 'Technology',    icon: '💻', color: '#6366f1' },
  { name: 'Travel',        icon: '✈️', color: '#84cc16' },
  { name: 'Education',     icon: '📚', color: '#a78bfa' },
  { name: 'Personal Care', icon: '💆', color: '#fb7185' },
  { name: 'Savings',       icon: '🏦', color: '#34d399' },
  { name: 'Income',        icon: '💰', color: '#4ade80' },
  { name: 'Other',         icon: '📦', color: '#94a3b8' },
  { name: 'Split',         icon: '🔀', color: '#94a3b8' },
  { name: 'Transfer',      icon: '↔️', color: '#64748b' },
  { name: 'Adjustment',            icon: '📊', color: '#64748b' },
  { name: 'Business - Advertising',         icon: '📣', color: '#f97316' },
  { name: 'Business - Office Supplies',     icon: '📎', color: '#a78bfa' },
  { name: 'Business - Software & SaaS',     icon: '🖥️', color: '#38bdf8' },
  { name: 'Business - Professional Services', icon: '🤝', color: '#34d399' },
  { name: 'Business - Meals (50% deductible)', icon: '🍽️', color: '#fbbf24' },
  { name: 'Business - Travel',              icon: '✈️', color: '#60a5fa' },
  { name: 'Business - Vehicle & Mileage',   icon: '🚗', color: '#94a3b8' },
  { name: 'Business - Equipment',           icon: '🖨️', color: '#c084fc' },
  { name: 'Business - Utilities',           icon: '⚡', color: '#fb7185' },
  { name: 'Business - Other',               icon: '🏢', color: '#64748b' },
];

// ─── Account Types ────────────────────────────────────────────────────────────
export const ACCOUNT_TYPES = [
  { value: 'checking',   label: 'Checking',        color: '#3b82f6', isDebt: false },
  { value: 'savings',    label: 'Savings',          color: '#10b981', isDebt: false },
  { value: 'credit',     label: 'Credit Card',      color: '#f59e0b', isDebt: true  },
  { value: 'investment', label: 'Investment',       color: '#8b5cf6', isDebt: false },
  { value: 'asset',      label: 'Asset / Property', color: '#06b6d4', isDebt: false },
  { value: 'loan',       label: 'Loan / Debt',      color: '#f87171', isDebt: true  },
  { value: 'cash',       label: 'Cash',             color: '#34d399', isDebt: false },
  { value: 'other',      label: 'Other',            color: '#94a3b8', isDebt: false },
];

// ─── Category / Account helpers ───────────────────────────────────────────────
export const catColor  = (n) => CATEGORIES.find(c => c.name === n)?.color   ?? '#94a3b8';
export const catIcon   = (n) => CATEGORIES.find(c => c.name === n)?.icon    ?? '📦';
export const acctColor = (t) => ACCOUNT_TYPES.find(a => a.value === t)?.color ?? '#94a3b8';
export const acctLabel = (t) => ACCOUNT_TYPES.find(a => a.value === t)?.label ?? t;
export const isDebtType= (t) => ACCOUNT_TYPES.find(a => a.value === t)?.isDebt ?? false;
export const shouldFlipImportAmounts = (accountType) => accountType === 'credit';

// Returns [{imported, existing}] pairs — only the surplus duplicates (M2a).
// If the import contains 2 rows with the same date+amount and only 1 existing
// match exists, only the first imported row is flagged; the second is allowed through.
export function detectImportDuplicates(importedRows, existingTxs, accountId) {
  const acctTxs = existingTxs.filter(t => t.account === accountId);
  const existingByKey = {};
  acctTxs.forEach(e => {
    const key = `${e.date}|${e.amount.toFixed(2)}`;
    (existingByKey[key] ??= []).push(e);
  });
  const usedCount = {};
  const result = [];
  importedRows.forEach(row => {
    const key = `${row.date}|${row.amount.toFixed(2)}`;
    const used = usedCount[key] ?? 0;
    const matches = existingByKey[key];
    if (matches && used < matches.length) {
      result.push({ imported: row, existing: matches[used] });
      usedCount[key] = used + 1;
    }
  });
  return result;
}
export const acctEmoji = (t) => ({ checking:'🏦', savings:'💰', credit:'💳', investment:'📈', asset:'🏠', loan:'📋', other:'💼' }[t] ?? '💼');

// ─── Formatting helpers ───────────────────────────────────────────────────────
export const fmt     = (n, opts = {}) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', ...opts }).format(n ?? 0);
export const fmtDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export const today   = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const thisMonth  = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export const nextMonth  = (m) => { const d = new Date(m + '-01'); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 7); };
export const prevMonth  = (m) => { const d = new Date(m + '-01'); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
export const uid     = () => self.crypto.randomUUID();

// ─── File download helper ─────────────────────────────────────────────────────
export const download = (filename, content, type = 'text/plain') => {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// ─── Security helpers ─────────────────────────────────────────────────────────
// Strips HTML tags only; does NOT decode entities (&amp; stays &amp;). Not a safety boundary.
export const sanitizeText = (s, maxLen = 500) => String(s ?? '')
  .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '') // drop script/style elements incl. content
  .replace(/<[^>]*>/g, '')
  .slice(0, maxLen);
export const safeNum      = (v, fallback = 0) => { const n = parseFloat(v); return isFinite(n) ? n : fallback; };
export const safeDate     = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : today();

// ─── CSV helpers ──────────────────────────────────────────────────────────────
export function parseCSVLine(line) {
  const result = [];
  let field = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { field += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      result.push(field.trim()); field = '';
    } else {
      field += ch;
    }
  }
  result.push(field.trim());
  return result;
}

// Handles: 1234.56, -1234.56, (1234.56), $1,234.56, ($1,234.56)
// Always returns a value rounded to 2 decimal places so float artifacts from
// CSV data (e.g. '$29.990000001') never propagate into stored amounts or keys.
export function parseAmount(str) {
  if (!str && str !== 0) return NaN;
  const s = String(str).trim();
  if (s === '') return NaN;
  const neg = s.startsWith('-') || s.startsWith('(');
  const clean = s.replace(/[$\s,()\-]/g, '');
  const val = parseFloat(clean);
  if (isNaN(val)) return NaN;
  const signed = neg ? -Math.abs(val) : val;
  return Math.round(signed * 100) / 100;
}

// ─── Recurring transaction helpers ───────────────────────────────────────────
export const FREQUENCIES = [
  { value: 'weekly',    label: 'Weekly',        days: 7   },
  { value: 'biweekly',  label: 'Every 2 weeks', days: 14  },
  { value: 'monthly',   label: 'Monthly',       days: null },
  { value: 'quarterly', label: 'Quarterly',     days: null },
  { value: 'yearly',    label: 'Yearly',        days: null },
];

export function getNextRecurDate(dateStr, frequency) {
  const d = new Date(dateStr + 'T00:00:00');
  switch (frequency) {
    case 'weekly':    d.setDate(d.getDate() + 7);  break;
    case 'biweekly':  d.setDate(d.getDate() + 14); break;
    case 'monthly':
    case 'quarterly': {
      // setMonth(+N) on a month-end date (e.g. Jan 31) overflows to Mar 2/3.
      // Clamp to the last valid day of the target month instead.
      const months = frequency === 'monthly' ? 1 : 3;
      const origDay = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + months);
      const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(origDay, maxDay));
      break;
    }
    case 'yearly':    d.setFullYear(d.getFullYear() + 1);  break;
    default: break;
  }
  return d.toISOString().split('T')[0];
}

export const freqLabel = (v) => FREQUENCIES.find(f => f.value === v)?.label ?? v;

// Auto-categorize by merchant keyword matching
export function autoCategory(desc, amount) {
  const d = (desc ?? '').replace(/^aplpay\s*/i, '').toLowerCase();
  if (/payment - thank you|payment thank you|payment to [\w\s]* card ending|payment to chase|payment to amex/i.test(d)) return 'Transfer';
  if (amount < 0 && /mobile payment|online payment|autopay/i.test(d)) return 'Transfer';
  if (amount > 0) return 'Income';
  if (/grocery|safeway|whole foods|trader joe|kroger|publix|aldi|wegmans|instacart|buc-ee|buc ee|365 market|five star food|canteen vend/i.test(d)) return 'Food & Dining';
  if (/restaurant|cafe|pizza|burger|sushi|taco|chipotle|mcdonald|starbucks|dunkin|doordash|grubhub|uber eats|chick-fil|panera|subway|domino|public hou|panca|ihop|waffle house|cracker barrel/i.test(d)) return 'Food & Dining';
  // Insurance before Transportation so GEICO/State Farm/etc. land in Insurance not Transportation.
  if (/liberty mutual|state farm|allstate|geico|progressive|safeco|nationwide|farmers|usaa|aaa insurance|travelers ins|aflac|metlife|cigna|aetna|humana|anthem|blue cross|blue shield|bwi aviation|skywatch/i.test(d)) return 'Insurance';
  if (/shell|chevron|\bbp\b|exxon|mobil|sunoco|circle k|speedway|caseys|casey's general|gas station/i.test(d)) return 'Transportation';
  // 'enterprise rent' before Housing so Enterprise Rent-A-Car → Transportation not Housing.
  if (/uber|lyft|parking|metro|transit|mta |bart |fare|toll|zipcar|enterprise rent/i.test(d)) return 'Transportation';
  if (/auto |car insurance|jiffy lube|oil change/i.test(d)) return 'Transportation';
  if (/netflix|hulu|disney|spotify|youtube premium|youtubepremi|amazon prime|hbo|apple tv|peacock|paramount|crunchyroll/i.test(d)) return 'Subscriptions';
  // Technology (aws/amazon web) before Shopping (amazon) so AWS → Technology not Shopping.
  if (/adobe|microsoft|apple\.com|google one|github|namecheap|godaddy|cloudflare|aws |amazon web|digitalocean|heroku|vercel|netlify|zoom |slack |notion|figma|1password|lastpass|dropbox|icloud|antivirus|norton|mcafee/i.test(d)) return 'Technology';
  if (/amazon|target|walmart|wal-mart|costco|best buy|ebay|etsy|wayfair|home depot|lowe|ikea|marshalls|tj maxx|gamestop/i.test(d)) return 'Shopping';
  if (/electric|water bill|internet|comcast|xfinity|at&t|verizon|t-mobile|utility|pg&e|con ed|spectrum/i.test(d)) return 'Utilities';
  if (/pharmacy|cvs|walgreens|rite aid|doctor|hospital|urgent care|health|dental|vision|optometrist|therapy/i.test(d)) return 'Healthcare';
  // \brent\b anchored so 'Monthly Rent' → Housing but 'Enterprise Rent-A-Car' doesn't (caught above).
  if (/\brent\b|mortgage|hoa|apartment|condo|lease/i.test(d))                           return 'Housing';
  if (/gym|planet fitness|la fitness|24 hour|crossfit|peloton|movie|amc |regal |concert|ticketmaster|bar |club |bowling|ryman auditor|ryman auditorium/i.test(d)) return 'Entertainment';
  if (/hotel|airbnb|vrbo|flight|airline|united|delta|american air|southwest|spirit|expedia|booking.com|kayak/i.test(d)) return 'Travel';
  if (/payroll|direct deposit|salary|paycheck|employer|freelance|consulting|client payment/i.test(d)) return 'Income';
  if (/venmo|zelle|cashapp|paypal/i.test(d)) return amount > 0 ? 'Income' : 'Other';
  if (/tuition|university|college|student loan|coursera|udemy|skillshare|psi exam|prometric|pearson vue|testing center/i.test(d)) return 'Education';
  if (/salon|haircut|spa|massage|barber|nail|beauty/i.test(d)) return 'Personal Care';
  if (/^store [a-z]|^the store/i.test(d)) return 'Shopping';
  return 'Other';
}

// Auto-categorize business transactions by merchant keyword matching
export function autoCategoryBusiness(desc) {
  const d = (desc ?? '').toLowerCase();
  if (/facebook ads|google ads|meta ads|linkedin ads|twitter ads|advertising|mailchimp|constant contact|klaviyo/i.test(d))                                   return 'Business - Advertising';
  if (/staples|office depot|officemax|amazon business|paper|printer|toner|binder|folder|whiteboard/i.test(d))                                                  return 'Business - Office Supplies';
  if (/adobe|github|atlassian|salesforce|hubspot|quickbooks|slack|notion|figma|zoom |dropbox|aws |google cloud|azure|digitalocean|heroku|vercel|netlify|linear |jira|confluence|1password|lastpass|namecheap|godaddy|cloudflare|twilio|stripe|sendgrid/i.test(d)) return 'Business - Software & SaaS';
  if (/lawyer|attorney|cpa |accountant|consultant|contractor|freelancer|legal |consulting|professional services/i.test(d))                                      return 'Business - Professional Services';
  if (/restaurant|cafe|pizza|burger|sushi|taco|chipotle|mcdonald|starbucks|dunkin|doordash|grubhub|uber eats|chick-fil|panera|subway|domino|lunch|dinner|breakfast/i.test(d)) return 'Business - Meals (50% deductible)';
  if (/hotel|airbnb|vrbo|flight|airline|united air|delta air|american air|southwest air|spirit air|expedia|booking\.com|kayak|car rental|enterprise rent/i.test(d)) return 'Business - Travel';
  if (/shell|chevron|bp |exxon|mobil|sunoco|circle k|speedway|gas station|autozone|advance auto|mileage|fuel/i.test(d))                                        return 'Business - Vehicle & Mileage';
  if (/apple\.com\/bill|apple store|amazon\.com|best buy|newegg|dell |hp |lenovo|microsoft store|b&h|adorama|equipment|hardware/i.test(d))                    return 'Business - Equipment';
  if (/electric|water bill|internet|comcast|xfinity|at&t|verizon|t-mobile|utility|pg&e|con ed|spectrum/i.test(d))                                             return 'Business - Utilities';
  return 'Business - Other';
}

// Schedule C line numbers for each business category
export const SCHEDULE_C_LINES = {
  'Business - Advertising':              8,
  'Business - Office Supplies':         22,
  'Business - Software & SaaS':         27,
  'Business - Professional Services':   11,
  'Business - Meals (50% deductible)': 24,
  'Business - Travel':                  24,
  'Business - Vehicle & Mileage':        9,
  'Business - Equipment':               13,
  'Business - Utilities':               25,
  'Business - Other':                   27,
};

// ─── Recurring monthly equivalent ────────────────────────────────────────────
/** Convert a recurrence's amount to its monthly equivalent value */
export function monthlyEquivalent(r) {
  switch (r.frequency) {
    case 'weekly':    return r.amount * 52 / 12;
    case 'biweekly':  return r.amount * 26 / 12;
    case 'monthly':   return r.amount;
    case 'quarterly': return r.amount / 3;
    case 'yearly':    return r.amount / 12;
    default:          return r.amount;
  }
}

// ─── Balance helpers ──────────────────────────────────────────────────────────
/**
 * Compute account balance from transaction history.
 * Returns null for investment/asset accounts (manual balance expected).
 */
export function computeBalance(accountId, transactions, accountType) {
  if (accountType === 'investment' || accountType === 'asset') return null;
  const raw = transactions
    .filter(t => t.account === accountId && t.type !== 'adjustment')
    .reduce((s, t) => s + t.amount, 0);
  return Math.round(raw * 100) / 100;
}

// ─── Dynamic category helpers ────────────────────────────────────────────
/** Returns built-in + user-defined categories merged */
export function getAllCategories(userCategories = []) {
  return [...CATEGORIES, ...userCategories];
}

// ─── Transfer pair detection ───────────────────────────────────────────────
/**
 * Auto-detect credit-card-payment transfer pairs and silently mark both sides
 * as "Transfer". A pair matches when:
 *   - abs(amount) matches within $0.01
 *   - dates within 4 calendar days of each other
 *   - different account IDs
 *   - neither side already has category "Transfer"
 * Returns a new transactions array; does not mutate the input.
 */
export function detectAndMarkTransferPairs(transactions) {
  const txs = transactions.map(t => ({ ...t }));
  const matched = new Set();
  for (let i = 0; i < txs.length; i++) {
    if (txs[i].category === 'Transfer') continue;
    if (matched.has(i)) continue;
    for (let j = i + 1; j < txs.length; j++) {
      if (txs[j].category === 'Transfer') continue;
      if (matched.has(j)) continue;
      if (txs[i].account === txs[j].account) continue;
      if (Math.abs(Math.abs(txs[i].amount) - Math.abs(txs[j].amount)) > 0.01) continue;
      const daysDiff = Math.abs(
        new Date(txs[i].date + 'T00:00:00') - new Date(txs[j].date + 'T00:00:00')
      ) / 86400000;
      if (daysDiff > 4) continue;
      const pairId = uid();
      txs[i].category      = 'Transfer';
      txs[i]._transferPair = true;
      txs[i].transferPairId = pairId;
      txs[j].category      = 'Transfer';
      txs[j]._transferPair = true;
      txs[j].transferPairId = pairId;
      matched.add(i);
      matched.add(j);
      break;
    }
  }
  return txs;
}

// ── Compensation profile ──────────────────────────────────────────────────────

export const DEFAULT_COMPENSATION_PROFILE = {
  grossMonthlySalary: 0,
  retirement401kPct: 0,
  hsaMonthly: 0,
  effectiveTaxRate: 0,
  medicalMonthly: 0,
  dentalMonthly: 0,
  visionMonthly: 0,
  otherBenefitsMonthly: 0,
  notes: '',
};

// ── XLSX / CSV header-row detection ──────────────────────────────────────────

const _HEADER_TOKENS = [
  /^date$/i, /^posted$/i, /^trans[\s.]?date$/i, /settlement/i,
  /^desc(ription)?$/i, /^merchant$/i, /^payee$/i, /^memo$/i, /^details?$/i, /^narrative$/i,
  /^amount$/i, /^amt$/i, /^transaction\s?amount$/i,
  /^debit$/i, /^withdrawal$/i, /^charge$/i,
  /^credit$/i, /^deposit$/i,
];
const _DATE_LIKE = /^\d{1,4}[/\-]\d{1,2}[/\-]\d{1,4}$|^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}$/;
const _NUM_LIKE  = /^-?[\d,]+(\.\d+)?$/;

/**
 * Given a 2-D array of strings (rows × cols), return the index of the row most
 * likely to be the CSV header. Scans up to maxScan rows.
 * Returns 0 if the first row already looks like the header, or if confidence is low.
 */
export function detectHeaderRow(rows2d, maxScan = 15) {
  const scan = rows2d.slice(0, maxScan);
  let bestScore = -1;
  let bestIdx   = 0;

  for (let i = 0; i < scan.length; i++) {
    const row = scan[i].map(c => String(c ?? '').trim());
    let score = 0;
    for (const cell of row) {
      for (const tok of _HEADER_TOKENS) {
        if (tok.test(cell)) { score++; break; }
      }
    }
    if (score === 0) continue;
    // Bonus: the row after this one has date-like and number-like values (confirms it's a data row)
    if (i + 1 < rows2d.length) {
      const nextRaw = rows2d[i + 1].map(c => String(c ?? '').trim());
      if (nextRaw.some(c => _DATE_LIKE.test(c))) score += 2;
      if (nextRaw.map(c => c.replace(/[$,\s]/g, '')).some(c => c.length > 0 && _NUM_LIKE.test(c))) score += 1;
    }
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }

  return bestScore >= 3 ? bestIdx : 0;
}

// ── Budget suggestions from spending history ──────────────────────────────────

/**
 * Check budget alert thresholds for the given month.
 * Returns an array of { category, pct, type ('warn'|'alert'), spent, budget } objects.
 */
export function checkBudgetAlerts(budgets, transactions, month, warnAt = 80, alertAt = 100) {
  const monthBudgets = budgets.filter(b => b.month === month);
  if (!monthBudgets.length) return [];
  const spend = {};
  transactions
    .filter(t => t.type === 'expense' && t.date.startsWith(month) && t.category !== 'Transfer')
    .forEach(t => { spend[t.category] = (spend[t.category] || 0) + (-t.amount); });
  const results = [];
  for (const b of monthBudgets) {
    if (!b.amount || b.amount <= 0) continue;
    const spent = spend[b.category] || 0;
    const pct   = (spent / b.amount) * 100;
    if (pct >= alertAt) {
      results.push({ category: b.category, pct: Math.round(pct), type: 'alert', spent, budget: b.amount });
    } else if (pct >= warnAt) {
      results.push({ category: b.category, pct: Math.round(pct), type: 'warn', spent, budget: b.amount });
    }
  }
  return results;
}

export function computeVestEvents(grant) {
  const { grantDate, totalShares, cliffMonths, vestingMonths, vestFrequency, grantPrice, currentPrice } = grant;
  if (!grantDate || !totalShares || !vestingMonths) return [];

  const start = new Date(grantDate + 'T00:00:00');
  const cliff = new Date(start);
  cliff.setMonth(cliff.getMonth() + (cliffMonths ?? 12));

  const freqMonths = vestFrequency === 'quarterly' ? 3 : 1;
  const periods    = Math.floor(vestingMonths / freqMonths);
  const perPeriod  = totalShares / periods;
  const events     = [];

  for (let i = 1; i <= periods; i++) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + i * freqMonths);
    if (d < cliff) continue;
    const dateStr   = d.toISOString().split('T')[0];
    const costBasis = perPeriod * (grantPrice ?? 0);
    const mktValue  = perPeriod * (currentPrice ?? grantPrice ?? 0);
    events.push({ date: dateStr, shares: perPeriod, costBasis, mktValue, vested: dateStr <= today() });
  }

  return events;
}

export function computeUnvestedRSUValue(grants) {
  if (!grants || !grants.length) return 0;
  return grants.reduce((sum, g) => {
    const events       = computeVestEvents(g);
    const vestedShares = events.filter(e => e.vested).reduce((s, e) => s + e.shares, 0);
    const unvested     = Math.max(0, (g.totalShares || 0) - vestedShares);
    const price        = g.currentPrice || g.grantPrice || 0;
    return sum + unvested * price;
  }, 0);
}

// Canonical vested net worth. Each non-debt account contributes (balance − unvestedRSUValue)
// so locked RSU value parked in an investment balance is excluded from the headline figure.
// Vested grant equity (totalGrantValue − computeUnvestedRSUValue) is added on top.
// No-double-count rule: account.unvestedRSUValue and grant shares are mutually exclusive
// representations — a position must appear in one place, never both.
export function computeNetWorth(accounts, grants) {
  const vestedAssets = (accounts || [])
    .filter(a => !isDebtType(a.type))
    .reduce((s, a) => s + a.balance - (a.unvestedRSUValue || 0), 0);
  const debts = (accounts || [])
    .filter(a => isDebtType(a.type))
    .reduce((s, a) => s + a.balance, 0);
  const totalGrantEquity = (grants || []).reduce(
    (s, g) => s + (g.totalShares || 0) * (g.currentPrice || g.grantPrice || 0), 0,
  );
  return vestedAssets - debts + (totalGrantEquity - computeUnvestedRSUValue(grants));
}

// Total locked (unvested) value shown as a separate breakout below the headline figure.
// Sums per-account unvestedRSUValue fields plus unvested grant equity.
export function computeUnvestedTotal(accounts, grants) {
  const accountUnvested = (accounts || []).reduce((s, a) => s + (a.unvestedRSUValue || 0), 0);
  return accountUnvested + computeUnvestedRSUValue(grants);
}

// Build a month → latest-snapshot map from netWorthHistory, excluding legacy rows that
// lack the `unvested` field. Rows without `unvested` were written before the vested-basis
// change (Wave 1) and their netWorth includes unvested RSU value — using them as
// reconstruction anchors would re-introduce the inflated figure into the NW trend.
// Vested-basis rows (h.unvested != null) are used normally.
export function buildSnapMap(netWorthHistory) {
  const map = {};
  (netWorthHistory || []).forEach(h => {
    if (h.unvested == null) return; // legacy pre-vested-basis — not a reliable anchor
    const mo = h.date.slice(0, 7);
    if (!map[mo] || h.date > map[mo].date) map[mo] = h;
  });
  return map;
}

export function suggestBudgetsFromActuals(transactions, referenceMonths) {
  const totals = {};
  referenceMonths.forEach(m => {
    transactions
      .filter(t => t.type === 'expense' && t.date.startsWith(m))
      .forEach(t => {
        totals[t.category] = (totals[t.category] || 0) + (-t.amount);
      });
  });
  return Object.entries(totals)
    .map(([category, total]) => ({
      category,
      suggested: Math.round((total / referenceMonths.length) / 5) * 5,
    }))
    .sort((a, b) => b.suggested - a.suggested);
}

// Monthly P&I payment: P * [r(1+r)^n] / [(1+r)^n - 1]
export function computeMortgagePI(principal, annualRatePct, years) {
  if (principal <= 0 || annualRatePct <= 0 || years <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// ── Import helpers (extracted for testability) ────────────────────────────────

// H5: pure OFX/QFX batches are already correctly signed per the OFX spec
// (debits negative) so they must not be flipped again. A mixed OFX+CSV batch
// falls back to flipSign, which applies to all rows — per-file flip is BACKLOG.
export function computeEffectiveFlip(anyOFX, anyCSV, flipSign) {
  return anyOFX && !anyCSV ? false : flipSign;
}

// H6: upsert Plaid modifications against existing transactions.
// Unmatched updates (pending→posted) are inserted; matched updates patch in-place.
// The u.id guard prevents a keyless update (id=undefined/null) from false-matching
// transactions that also lack a fitid.
export function applyPlaidModifications(existingTxs, updates) {
  if (!updates?.length) return existingTxs;
  const existingKeys = new Set(existingTxs.flatMap(t => [t.id, t.fitid].filter(Boolean)));
  const toInsert = updates.filter(u => !existingKeys.has(u.id));
  const updated = existingTxs.map(t => {
    const u = updates.find(u => u.id && (u.id === t.fitid || u.id === t.id));
    return u ? { ...t, ...u } : t;
  });
  if (!toInsert.length) return updated;
  return [...toInsert, ...updated].sort((a, b) => b.date.localeCompare(a.date));
}

// Data-model migration — applies backfill defaults for fields added across versions.
// Extracted from App.jsx for unit-testability. Pure function; no side effects.
export function migrateData(data) {
  const accounts = (data.accounts ?? []).map(a => ({
    holdings: [],
    isBusiness: false,
    unvestedRSUValue: 0,
    ...a,
  }));
  const transactions = (data.transactions ?? []).map(t => ({
    tags: [],
    splits: undefined,
    recurringId: undefined,
    transferId: undefined,
    transferDirection: undefined,
    transferPairId: undefined,
    type: t.amount >= 0 ? 'income' : 'expense',
    cleared: false,
    receipts: [],
    ...t,
  }));
  const budgets = (data.budgets ?? []).map(b => ({
    rollover: false,
    ...b,
  }));
  const goals = (data.goals ?? []).map(g => ({
    linkedAccountId: null,
    ...g,
  }));
  return {
    ...data, accounts, transactions, budgets, goals,
    compensationProfile: { ...DEFAULT_COMPENSATION_PROFILE, ...(data.compensationProfile ?? {}) },
    budgetAlerts: data.budgetAlerts ?? { enabled: true, warnAt: 80, alertAt: 100 },
    plaidCursors: data.plaidCursors ?? {},
    version: 10,
  };
}
