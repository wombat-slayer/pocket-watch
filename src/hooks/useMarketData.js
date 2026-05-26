// src/hooks/useMarketData.js
// Live market quote fetcher with in-memory caching.
// Stocks  → Finnhub REST API (free tier, 60 req/min; requires user API key)
// Crypto  → CoinGecko public API (no key, 50 req/min)

import { useState, useEffect, useRef, useCallback } from 'react';

const STOCK_TTL_MS  = 60 * 60 * 1000; // 1 hour
const CRYPTO_TTL_MS =  5 * 60 * 1000; // 5 minutes

// Known crypto ticker → CoinGecko ID
const CRYPTO_MAP = {
  BTC:   'bitcoin',        ETH:   'ethereum',       SOL:   'solana',
  ADA:   'cardano',        DOGE:  'dogecoin',        DOT:   'polkadot',
  AVAX:  'avalanche-2',    MATIC: 'matic-network',   LINK:  'chainlink',
  LTC:   'litecoin',       UNI:   'uniswap',         XRP:   'ripple',
  ATOM:  'cosmos',         NEAR:  'near',            BNB:   'binancecoin',
  SHIB:  'shiba-inu',      FTM:   'fantom',          ALGO:  'algorand',
  VET:   'vechain',        SAND:  'the-sandbox',     MANA:  'decentraland',
};

export const isCryptoTicker = (t) => !!CRYPTO_MAP[t?.toUpperCase?.()];

/**
 * Fetch live quotes for an array of ticker symbols.
 *
 * @param {string[]} tickersInput  Array of tickers (e.g. ['AAPL', 'BTC'])
 * @param {string}   finnhubKey   Finnhub API key (empty string = skip stocks)
 * @returns {{ quotes, loading, error, refresh, lastUpdated }}
 *
 * quotes shape: { [TICKER]: { price, prevClose, changePct, source, timestamp } }
 */
export function useMarketData(tickersInput, finnhubKey) {
  // Stable string key — avoids infinite useEffect loops from array identity
  const tickersStr = [...new Set(
    (tickersInput ?? []).filter(Boolean).map(t => t.toUpperCase())
  )].sort().join(',');

  const cacheRef  = useRef({});
  const abortRef  = useRef(null);

  const [quotes,      setQuotes]      = useState({});
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchAll = useCallback(async (force = false) => {
    const tickers = tickersStr ? tickersStr.split(',') : [];
    if (!tickers.length) return;

    const now   = Date.now();
    const stale = tickers.filter(t => {
      if (force) return true;
      const hit = cacheRef.current[t];
      if (!hit) return true;
      const ttl = CRYPTO_MAP[t] ? CRYPTO_TTL_MS : STOCK_TTL_MS;
      return now - hit.timestamp > ttl;
    });

    if (!stale.length) {
      setQuotes({ ...cacheRef.current });
      return;
    }

    // Cancel previous in-flight request
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError('');

    const stocks  = stale.filter(t => !CRYPTO_MAP[t]);
    const cryptos = stale.filter(t =>  CRYPTO_MAP[t]);
    const newData = {};

    // ── Stocks via Finnhub ──────────────────────────────────────────────────
    if (stocks.length > 0 && finnhubKey?.trim()) {
      const key = finnhubKey.trim();
      // Fetch sequentially with small delay to stay under 60/min rate limit
      for (const ticker of stocks) {
        if (ctrl.signal.aborted) break;
        try {
          const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}`;
          const r = await fetch(url, {
            signal: ctrl.signal,
            headers: { 'X-Finnhub-Token': key },
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const d = await r.json();
          if (typeof d.c === 'number' && d.c > 0) {
            newData[ticker] = {
              price:     d.c,
              prevClose: d.pc,
              changePct: d.dp,    // % change from prev close
              changeDay: d.d,     // absolute change
              open:      d.o,
              high:      d.h,
              low:       d.l,
              timestamp: Date.now(),
              source:    'finnhub',
            };
          }
          // Small delay between requests (avoid burst rate-limiting)
          if (stocks.indexOf(ticker) < stocks.length - 1) {
            await new Promise(r => setTimeout(r, 150));
          }
        } catch (e) {
          if (e.name !== 'AbortError') {
            console.warn(`[market] ${ticker}: ${e.message}`);
          }
        }
      }
    }

    // ── Crypto via CoinGecko ────────────────────────────────────────────────
    if (cryptos.length > 0 && !ctrl.signal.aborted) {
      try {
        const ids = cryptos.map(t => CRYPTO_MAP[t]).join(',');
        const url = `https://api.coingecko.com/api/v3/simple/price`
          + `?ids=${encodeURIComponent(ids)}`
          + `&vs_currencies=usd&include_24hr_change=true`;
        const r = await fetch(url, { signal: ctrl.signal });
        if (r.ok) {
          const d = await r.json();
          cryptos.forEach(ticker => {
            const id = CRYPTO_MAP[ticker];
            if (d[id]?.usd > 0) {
              newData[ticker] = {
                price:     d[id].usd,
                changePct: d[id].usd_24h_change ?? 0,
                timestamp: Date.now(),
                source:    'coingecko',
              };
            }
          });
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.warn('[market] CoinGecko:', e.message);
        }
      }
    }

    if (!ctrl.signal.aborted) {
      Object.assign(cacheRef.current, newData);
      setQuotes({ ...cacheRef.current });
      setLastUpdated(Date.now());

      // Provide helpful error if we expected stocks but got nothing
      const gotSome = Object.keys(newData).length > 0;
      const wantedStocks = stocks.length > 0;
      if (!gotSome && wantedStocks) {
        if (!finnhubKey?.trim()) {
          setError('Add a Finnhub API key in Settings → API Keys to fetch live stock prices.');
        } else {
          setError('Could not fetch prices. Check your Finnhub API key and network connection.');
        }
      } else if (!gotSome && cryptos.length > 0 && stocks.length === 0) {
        setError('Could not reach CoinGecko. Check your network connection.');
      }
    }

    setLoading(false);
  }, [tickersStr, finnhubKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchAll(false);
    return () => { abortRef.current?.abort(); };
  }, [fetchAll]);

  const refresh = useCallback(() => fetchAll(true), [fetchAll]);

  return { quotes, loa