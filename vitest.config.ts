import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	resolve: {
		alias: [
			// More specific first: break bibtex → hover (React) import for pure tests.
			{ find: 'src/hover', replacement: path.resolve(__dirname, 'tests/mocks/hover.ts') },
			{ find: /^src\//, replacement: path.resolve(__dirname, 'src') + '/' },
			{ find: 'obsidian', replacement: path.resolve(__dirname, 'tests/mocks/obsidian.ts') },
		],
	},
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
	},
})
