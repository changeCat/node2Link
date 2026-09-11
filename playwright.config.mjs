import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 30000,
	reporter: [['list'], ['html', { open: 'never' }]],
	use: {
		baseURL: 'http://127.0.0.1:8790',
		browserName: 'chromium',
		permissions: ['clipboard-read', 'clipboard-write'],
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [
		{ name: 'desktop', use: { viewport: { width: 1365, height: 900 } } },
		{ name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
	],
	webServer: {
		command: 'npm run dev',
		url: 'http://127.0.0.1:8790/login',
		reuseExistingServer: false,
		timeout: 60000,
		env: { NODE2LINK_DEV_PORT: '8790', NODE2LINK_DEV_API_SUBSCRIPTION_ENABLED: 'true', NODE2LINK_DEV_USERNAME: 'admin', NODE2LINK_DEV_PASSWORD: 'browser-test-password' }
	}
});
