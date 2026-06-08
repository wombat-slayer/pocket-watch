import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.{js,jsx}'],
    globals: true,
    environmentMatchGlobs: [
      ['src/__tests__/smoke/**', 'jsdom'],
    ],
  },
});
