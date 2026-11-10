import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['apps/api/src/core.test.ts','tests/integration/**/*.test.ts'],fileParallelism:false,testTimeout:20000,hookTimeout:30000}});
