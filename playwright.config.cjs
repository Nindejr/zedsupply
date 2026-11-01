const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser', fullyParallel: true, workers: 2,
  reporter: 'list', outputDir: 'test-results',
  use: { baseURL: 'http://127.0.0.1:4173', channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    viewport: { width: 390, height: 844 }, serviceWorkers: 'block' },
  webServer: { command: 'node tests/static-server.cjs', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
  projects: [{ name: 'mobile-light', use: { colorScheme: 'light' } }, { name: 'mobile-dark', use: { colorScheme: 'dark' } }]
});
