import '../apps/api/src/lib/env.js';
import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./e2e',testMatch:'**/*.pw.ts',fullyParallel:false,use:{headless:true,trace:'retain-on-failure',screenshot:'only-on-failure',...(process.env.PLAYWRIGHT_CHROME_CHANNEL?{channel:process.env.PLAYWRIGHT_CHROME_CHANNEL}:{})},reporter:'list',timeout:30000});
