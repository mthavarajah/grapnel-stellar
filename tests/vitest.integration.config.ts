import { defineConfig } from 'vitest/config';
if(process.env.API_TEST_DATABASE_URL && !process.env.SUPPLY_RUNTIME_TEST_DATABASE_URL)process.env.SUPPLY_RUNTIME_TEST_DATABASE_URL=process.env.API_TEST_DATABASE_URL;
export default defineConfig({test:{include:['apps/api/src/core.test.ts','tests/integration/**/*.test.ts','tests/review/authorization-review.test.ts','apps/api/src/modules/lending/runtime.test.ts'],fileParallelism:false,testTimeout:20000,hookTimeout:30000}});
