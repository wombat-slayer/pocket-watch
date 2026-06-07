import { useContext } from 'react';
import { PrivacyContext } from '../context/PrivacyContext.jsx';
import { fmt } from '../constants.js';

const MASK = '••••';

/** Returns a formatter function. When privacy mode is on, every amount becomes ••••. */
export function useCurrency() {
  const privacy = useContext(PrivacyContext);
  return (amount, opts) => privacy ? MASK : fmt(amount, opts);
}
