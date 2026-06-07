export function parsePayStub(text) {
  const findAmount = (patterns) => {
    for (const pattern of patterns) {
      const m = text.match(pattern);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0) return val;
      }
    }
    return null;
  };

  return {
    grossPerPeriod: findAmount([
      /total\s+gross\s+[\$]?([\d,]+\.?\d*)/i,
      /gross\s+pay\s+[\$]?([\d,]+\.?\d*)/i,
      /gross\s+earnings\s+[\$]?([\d,]+\.?\d*)/i,
    ]),
    retirement401k: findAmount([
      /401\s*\(?\s*k\s*\)?\s+[\$]?([\d,]+\.?\d*)/i,
      /retirement\s+[\$]?([\d,]+\.?\d*)/i,
    ]),
    hsa: findAmount([
      /hsa\s+[\$]?([\d,]+\.?\d*)/i,
      /health\s+savings\s+[\$]?([\d,]+\.?\d*)/i,
    ]),
    federalTax: findAmount([
      /federal\s+income\s+tax\s+[\$]?([\d,]+\.?\d*)/i,
      /fed\s+income\s+tax\s+[\$]?([\d,]+\.?\d*)/i,
    ]),
    stateTax: findAmount([
      /state\s+income\s+tax\s+[\$]?([\d,]+\.?\d*)/i,
      /state\s+tax\s+[\$]?([\d,]+\.?\d*)/i,
    ]),
    netPay: findAmount([
      /net\s+pay\s+[\$]?([\d,]+\.?\d*)/i,
      /total\s+net\s+[\$]?([\d,]+\.?\d*)/i,
    ]),
  };
}

export function toMonthly(amount, frequency) {
  if (!amount) return 0;
  switch (frequency) {
    case 'biweekly':    return amount * 26 / 12;
    case 'semimonthly': return amount * 2;
    case 'monthly':     return amount;
    case 'weekly':      return amount * 52 / 12;
    default:            return amount;
  }
}

export function calcEffectiveTaxRate(federal, state, gross) {
  if (!gross || gross === 0) return 0;
  return Math.round(((federal || 0) + (state || 0)) / gross * 100 * 10) / 10;
}
