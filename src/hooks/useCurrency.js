import { useCallback, useContext } from 'react';
import { PrivacyContext } from '../context/PrivacyContext.jsx';
import { fmt } from '../constants.js';

const MASK = '••••';

/** Returns a stable formatter function. When privacy mode is on, every amount becomes ••••. */
export function useCurrency() {
  const privacy = useContext(PrivacyContext);
  return useCallback((amount, opts) => privacy ? MASK : fmt(amount, opts), [privacy]);
}
