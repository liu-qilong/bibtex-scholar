/**
 * Pure helpers for inline citation spans and cursor/decoration decisions.
 * No Obsidian / CodeMirror imports — unit-testable.
 */

/** Inline cite forms: `{id}` or `[id]` inside backticks. */
export const CITE_PATTERN = /\`[\{\[][^\}\]]+[\}\]]\`/g

export type CiteSpan = {
	/** Absolute doc offset of match start */
	from: number
	/** Absolute doc offset of match end (exclusive) */
	to: number
	/** Citation key without brackets */
	id: string
	/** True when form is `[id]` (expanded) */
	expand: boolean
}

/**
 * Find all cite spans on a single line.
 * @param line_text - Text of the line only
 * @param line_from - Absolute offset of the line start in the document
 */
export function find_cite_spans_in_line(line_text: string, line_from: number = 0): CiteSpan[] {
	const out: CiteSpan[] = []
	CITE_PATTERN.lastIndex = 0
	let m: RegExpExecArray | null
	while ((m = CITE_PATTERN.exec(line_text)) !== null) {
		const from = line_from + m.index
		const to = from + m[0].length
		out.push({
			from,
			to,
			id: m[0].slice(2, -2),
			expand: m[0][1] === '[',
		})
	}
	return out
}

/**
 * If `pos` sits inside a cite match on this line, return stable key `from:to`.
 * Inclusive on both ends to match historical editor behavior (cursor on fence counts as inside).
 */
export function cite_span_key_at_offset(line_text: string, line_from: number, pos: number): string | null {
	for (const s of find_cite_spans_in_line(line_text, line_from)) {
		if (pos >= s.from && pos <= s.to) {
			return `${s.from}:${s.to}`
		}
	}
	return null
}

/**
 * Whether a selection move should rebuild cite decorations.
 * Rebuild only when the caret enters or leaves a cite span (or jumps between different spans).
 */
export function selection_requires_decoration_rebuild(
	old_span_key: string | null,
	new_span_key: string | null,
): boolean {
	return old_span_key !== new_span_key
}

/**
 * Whether the caret is inside a span (inclusive ends).
 * Used when building replace decorations — inside → show raw text for editing.
 */
export function cursor_inside_span(pos: number, from: number, to: number): boolean {
	return pos >= from && pos <= to
}

/**
 * Cheap gate: skip expensive citekey-rename detection when the file cannot contain BibTeX blocks.
 */
export function text_may_contain_bibtex_block(text: string): boolean {
	return text.includes('```bibtex')
}
