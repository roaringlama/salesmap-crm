import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/**/*.test.ts', 'cloud-server/tests/**/*.test.ts'] } });
