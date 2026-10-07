import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // Integration suites each create their own SQLite DB + FFmpeg jobs; run files serially.
    fileParallelism: false,
    env: { NODE_ENV: 'test' },
  },
});
