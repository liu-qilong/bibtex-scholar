import path from 'path'

/** Resolve aliases shared by the default and perf vitest configs. */
export const shared_alias = [
	// More specific first: break bibtex → hover (React) import for pure tests.
	{ find: 'src/hover', replacement: path.resolve(__dirname, 'tests/mocks/hover.ts') },
	{ find: /^src\//, replacement: path.resolve(__dirname, 'src') + '/' },
	{ find: 'obsidian', replacement: path.resolve(__dirname, 'tests/mocks/obsidian.ts') },
]
