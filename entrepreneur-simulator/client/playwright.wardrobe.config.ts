import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  globalTimeout:240000,
  testDir:'./e2e',testMatch:['wardrobe.spec.ts','inspirations.spec.ts'],fullyParallel:false,workers:1,
  reporter:[['list'],['html',{outputFolder:'playwright-report/wardrobe',open:'never'}]],
  use:{baseURL:'http://127.0.0.1:5178',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:[
    {command:'node ../server/tests/wardrobe.e2e-server.cjs',url:'http://127.0.0.1:3101/__test/health',timeout:120000,reuseExistingServer:false},
    {command:'npx vite --config e2e/wardrobe.vite.config.ts --host 127.0.0.1 --port 5178 --strictPort',url:'http://127.0.0.1:5178',timeout:120000,reuseExistingServer:false},
  ],
  projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'mobile-chromium',use:{...devices['Pixel 7']}}],
});
