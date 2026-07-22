/**
 * User-facing copy for notice toasts, tooltips, and source tags.
 * Kept pure (no Obsidian) so messages stay unit-testable and consistent.
 */

/** Tooltip on an unresolved inline cite (Reading view). Prefer this over a Notice. */
export function unknown_cite_title(paper_id: string): string {
	return (
		`Not in BibTeX cache: ${paper_id}. `
		+ 'Add a ```bibtex block for this key, or run “Recache all BibTeX entries from vault”.'
	)
}

/**
 * One toast for a codeblock that hit paint-time duplicates (first-wins losers).
 * Summarizes id and/or DOI clashes so a multi-entry block does not stack Notices.
 */
export function duplicate_block_notice(opts: {
	id_hits: number
	doi_hits: number
	/** First conflicting citekey (for a concrete example in the message). */
	example_id?: string
	/** Path of the cached owner of that example, when known. */
	example_owner_path?: string
}): string {
	const parts: string[] = []
	if (opts.id_hits > 0) {
		parts.push(
			opts.id_hits === 1
				? 'duplicate citekey'
				: `${opts.id_hits} duplicate citekeys`,
		)
	}
	if (opts.doi_hits > 0) {
		parts.push(
			opts.doi_hits === 1
				? 'duplicate DOI'
				: `${opts.doi_hits} duplicate DOIs`,
		)
	}
	const what = parts.join(' and ') || 'duplicates'
	const example = opts.example_id
		? (
			opts.example_owner_path
				? ` Example: “${opts.example_id}” is already cached from ${opts.example_owner_path}.`
				: ` Example: “${opts.example_id}”.`
		)
		: ''
	return (
		`Not cached (${what}): the first copy in the library wins.${example} `
		+ 'This block stays in your note; only the winner is in the plugin cache.'
	)
}

/** Source-tag paint for a paint-time loser (red “not cached”, not a rescan clash label). */
export function paint_duplicate_tag_state(owner_path?: string): {
	clashing: boolean
	text: string
	title: string
} {
	const where = owner_path ? ` Cached owner: ${owner_path}.` : ''
	return {
		clashing: true,
		text: 'not cached',
		title: (
			`Duplicate entry — first copy wins; this block is not written to the plugin cache.`
			+ where
			+ ' Edit the original or uncache it, then recache.'
		),
	}
}

/** Notice body when a vault delete removed cache rows (before Undo is clicked). */
export function delete_uncache_notice_text(count: number, path: string): string {
	const n = count === 1 ? '1 BibTeX entry' : `${count} BibTeX entries`
	return `Removed ${n} from cache (deleted “${path}”).`
}
