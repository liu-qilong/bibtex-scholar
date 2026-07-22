/**
 * Pure helper for EditorPrompt.onTrigger's line-matching + gating decision.
 * No Obsidian imports — unit-testable.
 */

export type PromptTriggerMatch = {
	query: string
	bracket_start: string
	bracket_end: string
	code_end: string
	content_start: number
	content_end: number
}

const TRIGGER_PATTERN = /(`)([{\[])([^}\]`\ ]*)([}\]]?)(`?)/g

/**
 * Find a `` `{id<cursor>` `` / `` `[id<cursor>` `` trigger on `line` at `cursor_ch`.
 *
 * `has_candidate(query)` gates the match: the id charset is otherwise unconstrained,
 * so this pattern also matches ordinary backtick code spans that happen to start with
 * `{`/`[` (JSON snippets, array literals, etc.) — very common in research notes.
 * Without the gate, landing the cursor there (e.g. a normal click to edit that code)
 * pops the suggestion modal and steals the next click meant for the editor. Only
 * trigger when at least one cached citekey could plausibly match `query`.
 */
export function find_prompt_trigger(
	line: string,
	cursor_ch: number,
	has_candidate: (query: string) => boolean,
): PromptTriggerMatch | null {
	TRIGGER_PATTERN.lastIndex = 0
	let match: RegExpExecArray | null

	while ((match = TRIGGER_PATTERN.exec(line)) !== null) {
		const query = match[3]
		const content_start = match.index + 2 // position after `{` or `[`
		const content_end = content_start + query.length

		if (cursor_ch !== content_end) {
			continue
		}

		const bracket_start = match[2]
		const bracket_end = match[4]
		const code_end = match[5]

		if (bracket_end && !code_end) {
			// e.g. `{test} without a closing backtick — cannot finish a valid cite.
			continue
		}

		if (!has_candidate(query)) {
			continue
		}

		return { query, bracket_start, bracket_end, code_end, content_start, content_end }
	}

	return null
}
