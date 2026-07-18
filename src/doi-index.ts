/**
 * O(1) DOI → citekey index for paint-path clash checks.
 * First owner wins (matches rebuild_dict_from_hits first-DOI policy).
 */

import type { BibtexDict, BibtexElement } from 'src/bibtex'

/** doi → owning citation key */
export type DoiIndex = Map<string, string>

export function build_doi_index(dict: BibtexDict): DoiIndex {
	const index: DoiIndex = new Map()
	for (const id of Object.keys(dict)) {
		const doi = dict[id]?.fields?.doi
		if (doi && !index.has(doi)) {
			index.set(doi, id)
		}
	}
	return index
}

/**
 * Same semantics as legacy linear check_duplicate_doi:
 * clash if another entry owns this DOI, unless it is the same id from the same path.
 */
export function doi_is_duplicate(
	index: DoiIndex,
	dict: BibtexDict,
	doi: string | undefined,
	id: string,
	file_path: string,
): boolean {
	if (!doi) {
		return false
	}
	const owner = index.get(doi)
	if (!owner) {
		return false
	}
	if (owner === id) {
		const entry = dict[id]
		// Same key re-rendered from same file is fine.
		return !(entry && entry.source_path === file_path)
	}
	return true
}

/** After removing `id` (or changing its DOI), drop ownership if we still own `doi`. */
export function doi_index_clear_owner(index: DoiIndex, id: string, doi: string | undefined): void {
	if (!doi) return
	if (index.get(doi) === id) {
		index.delete(doi)
	}
}

/** Claim DOI for id (call only when clash checks already passed). */
export function doi_index_claim(index: DoiIndex, id: string, doi: string | undefined): void {
	if (!doi) return
	if (!index.has(doi)) {
		index.set(doi, id)
	} else if (index.get(doi) === id) {
		// already ours
	} else {
		// should not happen if caller checked duplicates
		index.set(doi, id)
	}
}

/**
 * Keep index in sync when replacing an entry (upsert / rename).
 * Removes previous DOI ownership, claims the next.
 */
export function doi_index_on_upsert(
	index: DoiIndex,
	id: string,
	prev: BibtexElement | undefined,
	next_doi: string | undefined,
): void {
	const prev_doi = prev?.fields?.doi
	if (prev_doi && prev_doi !== next_doi) {
		doi_index_clear_owner(index, id, prev_doi)
	}
	doi_index_claim(index, id, next_doi)
}

/** Remove one entry from dict + index. */
export function doi_index_on_delete(index: DoiIndex, id: string, entry: BibtexElement | undefined): void {
	doi_index_clear_owner(index, id, entry?.fields?.doi)
}

/** Drop all DOI ownership for entries matching path (before/while deleting them). */
export function doi_index_on_remove_path(index: DoiIndex, dict: BibtexDict, path: string): void {
	for (const id of Object.keys(dict)) {
		if (dict[id].source_path === path) {
			doi_index_on_delete(index, id, dict[id])
		}
	}
}
