import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    // Tests hit the real Upstash Redis over REST — generous timeouts, and one
    // file at a time to keep ordering deterministic and avoid rate limits.
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
