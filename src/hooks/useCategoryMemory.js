// src/hooks/useCategoryMemory.js
import { useMemo, useCallback } from 'react';

/**
 * Build a category memory map from existing transactions.
 * Maps normalized description tokens to the most-used category for that pattern.
 * Returns a lookup function: suggest(description) → category string or null
 */
export function useCategoryMemory(transactions) {
  const memoryMap = useMemo(() => {
    const freq = {}; // key: normalizedDesc, value: {category: count}
    transactions
      .slice(-2000) // cap to most recent 2000 for performance on large datasets
      .filter(t => t.type === 'expense' && t.category && t.category !== 'Other' && t.category !== 'Transfer' && t.category !== 'Adjustment')
      .forEach(t => {
        const key = normalizeDesc(t.description);
        if (!key) return;
        if (!freq[key]) freq[key] = {};
        freq[key][t.category] = (freq[key][t.category] || 0) + 1;
      });
    // For each key, pick the most-used category
    const map = {};
    Object.entries(freq).forEach(([key, cats]) => {
      map[key] = Object.entries(cats).sort((a, b) => b[1] - a[1])[0][0];
    });
    return map;
  }, [transactions]);

  const suggest = useCallback((description) => {
    if (!description) return null;
    const key = normalizeDesc(description);
    if (memoryMap[key]) return memoryMap[key];
    // Partial match: check if any stored key is a substring of this description
    const descLower = key;
    for (const [stored, cat] of Object.entries(memoryMap)) {
      if (stored.length >= 4 && (descLower.includes(stored) || stored.includes(descLower))) {
        return cat;
      }
    }
    return null;
  }, [memoryMap]);

  return { suggest, memoryMap };
}

function normalizeDesc(desc) {
  return desc
    .toLowerCase()
    .replace(/[#*_\-–—]/g, ' ')
    .replace(/\d{4,}/g, '')   // strip long numbers (card numbers, ref numbers)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}
