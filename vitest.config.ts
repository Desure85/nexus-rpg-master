import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    env: {
      LLM_PROVIDER: 'mock',
      MOCK_LLM_DELAY_MS: '0',
      RATE_LIMIT_DISABLED: 'true',
      NODE_ENV: 'test',
    },
  },
});
