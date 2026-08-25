import { defineConfig } from 'vitest/config'
import { shared_alias } from './vitest.shared'

/**
 * Scale A/B experiments (upstream-shaped baseline vs this fork). Separate
 * config from vitest.config.ts because vitest 3.x's config `exclude` wins
 * over a CLI positional path filter — `vitest run tests/perf` under the
 * default config matched 0 files. Run via `npm run test:perf`.
 */
export default defineConfig({
	resolve: {
		alias: shared_alias,
	},
	test: {
		environment: 'node',
		include: ['tests/perf/**/*.perf.test.ts'],
	},
})
