import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['server/src/__tests__/**/*.test.ts', 'proxy/src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['server/src/**/*.ts', 'proxy/src/**/*.ts'],
      exclude: ['**/__tests__/**', '**/node_modules/**'],
    },
    testTimeout: 30000,
  },
});
