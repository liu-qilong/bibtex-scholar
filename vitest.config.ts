import { defineConfig } from 'vitest/config'
import { shared_alias } from './vitest.shared'

export default defineConfig({
	resolve: {
		alias: shared_alias,
	},
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
		// Scale A/B experiments (public-seed, N=5k) — run via `npm run test:perf`
		// (separate config: vitest.perf.config.ts). Excluded here so the default
		// `npm test` run stays fast; a CLI path filter does NOT override this
		// exclude in vitest 3.x, which is why perf has its own config file
		// instead of `vitest run tests/perf`.
		exclude: ['tests/perf/**'],
	},
})
