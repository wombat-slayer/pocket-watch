/**
 * parseRSUStatement — extract unvested RSU data from Fidelity stock plan PDF text.
 * Returns null for any field that couldn't be parsed.
 */
export function parseRSUStatement(text) {
  if (!text) return { ticker: null, unvestedShares: null, currentPrice: null, unvestedValue: null, nextVestDate: null, nextVestShares: null, rawText: text ?? '' };

  const result = {
    ticker:        null,
    unvestedShares: null,
    currentPrice:  null,
    unvestedValue: null,
    nextVestDate:  null,
    nextVestShares: null,
    rawText:       text,
  };

  // ── Ticker ────────────────────────────────────────────────────────────────
  // Look for known tickers adjacent to company name keywords, or bare ticker symbols.
  const tickerMatch =
    text.match(/\b(AMZN|GOOG|GOOGL|META|MSFT|AAPL|NVDA|TSLA|NFLX|CRM|ORCL|IBM|ADBE|INTC|AMD|QCOM|CSCO|AVGO|TXN)\b/) ||
    text.match(/ticker[:\s]+([A-Z]{1,5})/i) ||
    text.match(/symbol[:\s]+([A-Z]{1,5})/i);
  if (tickerMatch) result.ticker = tickerMatch[1] ?? tickerMatch[0];

  // ── Unvested share count ──────────────────────────────────────────────────
  // Fidelity: "Unvested  412" / "Unissued  412" / "Unvested Shares  412"
  const unvestedSharesMatch =
    text.match(/unvested\s+shares?[:\s]+([\d,]+)/i) ||
    text.match(/unvested[:\s]+([\d,]+)\s+shares?/i) ||
    text.match(/unvested[:\s]+([\d,]+)/i) ||
    text.match(/unissued[:\s]+([\d,]+)/i);
  if (unvestedSharesMatch) {
    const n = parseFloat(unvestedSharesMatch[1].replace(/,/g, ''));
    if (!isNaN(n)) result.unvestedShares = n;
  }

  // ── Current price per share ───────────────────────────────────────────────
  // "Current Price  $201.50" / "Market Price  201.50" / "Price Per Share  201.50"
  const priceMatch =
    text.match(/current\s+price[:\s]+\$?([\d,]+\.?\d*)/i) ||
    text.match(/market\s+price[:\s]+\$?([\d,]+\.?\d*)/i) ||
    text.match(/price\s+per\s+share[:\s]+\$?([\d,]+\.?\d*)/i) ||
    text.match(/closing\s+price[:\s]+\$?([\d,]+\.?\d*)/i) ||
    text.match(/fair\s+market\s+value[:\s]+\$?([\d,]+\.?\d*)/i);
  if (priceMatch) {
    const n = parseFloat(priceMatch[1].replace(/,/g, ''));
    if (!isNaN(n) && n > 0) result.currentPrice = n;
  }

  // ── Unvested value (shares × price) ──────────────────────────────────────
  // Try to read it directly first; fall back to computing it.
  const valueMatch =
    text.match(/unvested\s+(?:market\s+)?value[:\s]+\$?([\d,]+\.?\d*)/i) ||
    text.match(/total\s+unvested[:\s]+\$?([\d,]+\.?\d*)/i);
  if (valueMatch) {
    const n = parseFloat(valueMatch[1].replace(/,/g, ''));
    if (!isNaN(n) && n > 0) result.unvestedValue = n;
  }
  if (!result.unvestedValue && result.unvestedShares != null && result.currentPrice != null) {
    result.unvestedValue = Math.round(result.unvestedShares * result.currentPrice * 100) / 100;
  }

  // ── Next vest date ────────────────────────────────────────────────────────
  // Look for the earliest future-looking date adjacent to vest/release language.
  // Fidelity grant schedule rows: "08/18/2025  17  RSU"
  const datePatterns = [
    /next\s+vest(?:ing)?\s+date[:\s]+([\d]{1,2}\/[\d]{1,2}\/[\d]{4})/i,
    /vest(?:ing)?\s+date[:\s]+([\d]{1,2}\/[\d]{1,2}\/[\d]{4})/i,
    /release\s+date[:\s]+([\d]{1,2}\/[\d]{1,2}\/[\d]{4})/i,
    // bare MM/DD/YYYY followed by a share quantity on the same line
    /([\d]{2}\/[\d]{2}\/[\d]{4})\s+([\d,]+)\s+(?:RSU|shares?|restricted)/i,
    // YYYY-MM-DD ISO format
    /(\d{4}-\d{2}-\d{2})/,
  ];
  for (const re of datePatterns) {
    const m = text.match(re);
    if (m) {
      // Convert MM/DD/YYYY to YYYY-MM-DD if needed
      const raw = m[1];
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        result.nextVestDate = raw;
      } else {
        const parts = raw.split('/');
        if (parts.length === 3) {
          result.nextVestDate = `${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`;
        }
      }
      // If there's a share count on the same match (pattern 4), capture it
      if (m[2]) {
        const n = parseFloat(m[2].replace(/,/g, ''));
        if (!isNaN(n)) result.nextVestShares = n;
      }
      break;
    }
  }

  // ── Next vest shares (if not yet captured) ────────────────────────────────
  if (!result.nextVestShares) {
    const nextVestSharesMatch =
      text.match(/next\s+vest(?:ing)?[:\s]+([\d,]+)\s+shares?/i) ||
      text.match(/shares?\s+vesting\s+next[:\s]+([\d,]+)/i);
    if (nextVestSharesMatch) {
      const n = parseFloat(nextVestSharesMatch[1].replace(/,/g, ''));
      if (!isNaN(n)) result.nextVestShares = n;
    }
  }

  return result;
}
