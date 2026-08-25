/**
 * Upstream-shaped baselines for A/B scale experiments.
 *
 * Faithfully mirrors the *semantics* of `liu-qilong/bibtex-scholar` at the
 * merge-base tip used for this fork's rebase (`upstream/main` when experiments
 * were written): free-text scans **every** field (including abstract), panel
 * open mounts **every** entry, search returns the full match list with no cap,
 * DOI clash checks walk the dict linearly.
 *
 * This is not a git checkout of upstream — it is a frozen behavioural clone so
 * experiments stay runnable without dual worktrees. Re-diff against
 * `upstream/main:src/bibtex.ts` `match_query` if upstream changes materially.
 */

import type { BibtexDict, BibtexElement } from 'src/bibtex'

/**
 * Upstream `match_query` (pre-fork): lowercase includes over all fields;
 * `key:value` via first colon split; semicolon AND. No TeX fold, no fuzzy,
 * no corpus cache — abstract is always free-text-searchable.
 */
export function upstream_match_query(bibtex: BibtexElement, query: string): boolean {
	function match_query_single(q: string): boolean {
		const q_low_trim = q.toLowerCase().trim()
		if (q_low_trim.length === 0) return true

		if (q_low_trim.includes(':')) {
			let [key, value] = q_low_trim.split(':')
			key = (key ?? '').trim()
			value = (value ?? '').trim()
			if (key in bibtex.fields) {
				return String(bibtex.fields[key]).toLowerCase().includes(value)
			}
			return false
		}

		for (const key in bibtex.fields) {
			if (String(bibtex.fields[key]).toLowerCase().includes(q_low_trim)) {
				return true
			}
		}
		return false
	}

	for (const q of query.split(';')) {
		if (q.length > 0 && !match_query_single(q)) {
			return false
		}
	}
	return true
}

/** Upstream panel: filter whole dict, no mount cap (every match becomes a chip). */
export function upstream_list_ids(dict: BibtexDict, query: string): {
	ids: string[]
	/** Proxy for DOM mounts = every returned id. */
	mounts: number
} {
	const q = query.trim()
	const ids: string[] = []
	for (const id of Object.keys(dict)) {
		const entry = dict[id]
		if (!entry) continue
		if (q.length === 0 || upstream_match_query(entry, q)) {
			ids.push(id)
		}
	}
	// Empty open in upstream mounts *every* entry (panel onOpen loops dict).
	return { ids, mounts: ids.length }
}

/**
 * Upstream paint-path DOI check: linear scan of the whole dict.
 * Returns how many entries were examined (work counter).
 */
export function upstream_check_duplicate_doi(
	dict: BibtexDict,
	doi: string | undefined,
	id: string,
	file_path: string,
): { clash: boolean; examined: number } {
	if (!doi) return { clash: false, examined: 0 }
	let examined = 0
	for (const cached_id of Object.keys(dict)) {
		examined++
		const entry = dict[cached_id]
		if (!entry) continue
		if (
			entry.fields.doi === doi &&
			!(cached_id === id && entry.source_path === file_path)
		) {
			return { clash: true, examined }
		}
	}
	return { clash: false, examined }
}

/**
 * Naive full vault re-read: touch every path (upstream rescan shape before
 * fingerprints / chunking). `read` is the injected vault reader.
 */
export async function upstream_full_vault_read(
	paths: string[],
	read: (path: string) => Promise<string>,
): Promise<{ bytes: number; files: number }> {
	let bytes = 0
	for (const p of paths) {
		const text = await read(p)
		bytes += text.length
	}
	return { bytes, files: paths.length }
}
