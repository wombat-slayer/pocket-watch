import { createContext, useContext } from 'react';

export const PrivacyContext = createContext(false);

export function usePrivacy() {
  return useContext(PrivacyContext);
}
