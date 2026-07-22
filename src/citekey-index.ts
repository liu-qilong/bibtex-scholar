/**
 * O(1) normalized-citekey → canonical-citekey index.
 * Backs case-insensitive duplicate checks and inline-cite resolution while
 * `bibtex_dict` keys stay exactly as the user typed them (matches doi-index.ts).
 */

import { normalize_id, type BibtexDict } from 'src/bibtex'

/** normalized citekey → canonical (as-stored) citekey */
export type IdIndex = Map<string, string>

export function build_id_index(dict: BibtexDict): IdIndex {
	const index: IdIndex = new Map()
	for (const id of Object.keys(dict)) {
		const norm = normalize_id(id)
		if (!index.has(norm)) index.set(norm, id)
	}
	return index
}

/** Resolve a user-typed (possibly differently-cased) citekey to its canonical stored id. */
export function resolve_id(index: IdIndex, raw_id: string): string | undefined {
	return index.get(normalize_id(raw_id))
}

/** Drop ownership if `id` is still the owner of its normalized slot. */
export function id_index_clear_owner(index: IdIndex, id: string): void {
	const norm = normalize_id(id)
	if (index.get(norm) === id) {
		index.delete(norm)
	}
}

/** Claim the normalized slot for `id` (call only when duplicate checks already passed). */
export function id_index_claim(index: IdIndex, id: string): void {
	index.set(normalize_id(id), id)
}
