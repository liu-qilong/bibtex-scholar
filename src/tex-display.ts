/**
 * Display-time rendering of BibTeX field values.
 *
 * Stored fields stay in their original TeX-ish encoding (export / copy / parse
 * are untouched). UI surfaces call {@link display_bibtex_text} so readers see
 * Unicode rather than the special-character scheme.
 *
 * Special-character scheme (as used by most BibTeX providers): a left brace at
 * the current scan level, immediately followed by a backslash, through the
 * matching right brace — e.g. `{\'e}`, `{\"{u}}`, `{\ae}`, `{\&}`.
 *
 * Protective braces that do not start that scheme (`{GPU}`, `{:}`, `{de}`) are
 * stripped for display so titles read naturally.
 */

/** Combining marks applied after a TeX accent command + base letter. */
const ACCENT_MARK: Record<string, string> = {
	"'": '\u0301', // acute
	'`': '\u0300', // grave
	'^': '\u0302', // circumflex
	'"': '\u0308', // diaeresis / umlaut
	'~': '\u0303', // tilde
	'=': '\u0304', // macron
	'.': '\u0307', // dot above
	u: '\u0306', // breve
	v: '\u030C', // caron / háček
	H: '\u030B', // double acute
	c: '\u0327', // cedilla
	k: '\u0328', // ogonek
	r: '\u030A', // ring above
	b: '\u0331', // macron below
	d: '\u0323', // dot below
	t: '\u0361', // double inverted breve (tie)
}

/** Non-letter accent command characters: `\'` `\"` `\`` `\^` `\~` `\=` `\.` */
const ACCENT_SYMBOL = new Set(["'", '`', '^', '"', '~', '=', '.'])

/**
 * Letter accents that take an argument. Distinct from symbol commands of the
 * same letter when no argument follows (`\o` → ø vs `\o{o}` which is rare).
 */
const ACCENT_LETTER = new Set(['u', 'v', 'H', 'c', 'k', 'r', 'b', 'd', 't'])

/**
 * Single-token TeX symbol commands (no argument). Longer names first so
 * `\aa` wins over a hypothetical `\a`.
 */
const SYMBOL_COMMANDS: [string, string][] = [
	['copyright', '©'],
	['pounds', '£'],
	['ldots', '…'],
	['cdots', '⋯'],
	['dots', '…'],
	['textendash', '–'],
	['textemdash', '—'],
	['textquotesingle', '\u2019'],
	['textquotedblleft', '“'],
	['textquotedblright', '”'],
	['textquoteleft', '‘'],
	['textquoteright', '’'],
	['guillemotleft', '«'],
	['guillemotright', '»'],
	['AE', 'Æ'],
	['ae', 'æ'],
	['OE', 'Œ'],
	['oe', 'œ'],
	['AA', 'Å'],
	['aa', 'å'],
	['DH', 'Ð'],
	['dh', 'ð'],
	['TH', 'Þ'],
	['th', 'þ'],
	['NG', 'Ŋ'],
	['ng', 'ŋ'],
	['ss', 'ß'],
	['SS', 'SS'],
	['ij', 'ĳ'],
	['IJ', 'Ĳ'],
	['L', 'Ł'],
	['l', 'ł'],
	['O', 'Ø'],
	['o', 'ø'],
	['i', 'ı'], // dotless i (for accents: {\'{\i}})
	['j', 'ȷ'], // dotless j
	['S', '§'],
	['P', '¶'],
	['dag', '†'],
	['ddag', '‡'],
]

const SYMBOL_BY_LEN = [...SYMBOL_COMMANDS].sort((a, b) => b[0].length - a[0].length)

/** Single-character escapes after `\` (not accents). */
const ESCAPED_CHAR: Record<string, string> = {
	'&': '&',
	'%': '%',
	$: '$',
	'#': '#',
	_: '_',
	'{': '{',
	'}': '}',
	'\\': '\\',
	' ': ' ',
	',': '\u2009', // thin space
}

/**
 * Index of the matching `}` for a `{` at `open`, or -1 if unbalanced.
 */
export function find_matching_brace(s: string, open: number): number {
	if (s[open] !== '{') {
		return -1
	}
	let depth = 0
	for (let i = open; i < s.length; i++) {
		const c = s[i]
		if (c === '{') {
			depth++
		} else if (c === '}') {
			depth--
			if (depth === 0) {
				return i
			}
		}
	}
	return -1
}

function skip_ws(s: string, i: number): number {
	while (i < s.length && (s[i] === ' ' || s[i] === '\t')) {
		i++
	}
	return i
}

/**
 * Render the inside of a `{…}` argument group.
 * Nested specials often appear without an extra outer brace layer here
 * (e.g. `{\'{\i}}` → arg body `\i`), so try {@link convert_tex_special} first.
 */
function render_group_body(inner: string): string {
	if (inner.startsWith('\\')) {
		const converted = convert_tex_special(inner)
		if (converted !== null) {
			return converted
		}
	}
	return display_bibtex_text(inner)
}

/**
 * Take a TeX command argument: `{…}` (recursively display-rendered) or one character.
 */
function take_arg(s: string, i: number): { arg: string; next: number } | null {
	i = skip_ws(s, i)
	if (i >= s.length) {
		return null
	}
	if (s[i] === '{') {
		const end = find_matching_brace(s, i)
		if (end < 0) {
			return null
		}
		return { arg: render_group_body(s.slice(i + 1, end)), next: end + 1 }
	}
	return { arg: s[i], next: i + 1 }
}

function apply_accent(mark: string, base: string): string {
	if (!base) {
		return base
	}
	// TeX uses \i / \j (dotless) under upper accents so the dot does not
	// collide; Unicode precomposed forms are built from ordinary i/j.
	let b = base
	if (b === 'ı') b = 'i'
	if (b === 'ȷ') b = 'j'
	const chars = [...b]
	return (chars[0] + mark + chars.slice(1).join('')).normalize('NFC')
}

/**
 * Parse one TeX special starting at `start` (must point at `\`).
 * Returns Unicode + index after the command, or `null` if unrecognized.
 *
 * Consumes only the command itself (not trailing prose), so bare mid-string
 * accents like `Gaji\'{c}` / `\v{z}ivkovic` work without eating the rest.
 */
export function consume_tex_special(
	s: string,
	start: number,
): { text: string; next: number } | null {
	if (s[start] !== '\\' || start + 1 >= s.length) {
		return null
	}

	const i = start + 1 // after '\'
	const ch = s[i]

	// --- Escaped single characters: \& \% \$ \# \_ \{ \} \  \, ---
	if (ch in ESCAPED_CHAR) {
		return { text: ESCAPED_CHAR[ch], next: i + 1 }
	}

	// --- Non-letter accents: \'e  \'{e}  \"{u}  \`a  \^o  \~n  \=o  \.z ---
	if (ACCENT_SYMBOL.has(ch)) {
		const got = take_arg(s, i + 1)
		if (!got) {
			// Bare `\~` / `\^` sometimes appear as spacing/escapes.
			if (ch === '~') return { text: '~', next: i + 1 }
			if (ch === '^') return { text: '^', next: i + 1 }
			return null
		}
		return { text: apply_accent(ACCENT_MARK[ch], got.arg), next: got.next }
	}

	// --- Letter-named commands: read the full command name first ---
	if (!/[a-zA-Z]/.test(ch)) {
		return null
	}

	let name_end = i
	while (name_end < s.length && /[a-zA-Z]/.test(s[name_end])) {
		name_end++
	}
	const name = s.slice(i, name_end)
	const after = s.slice(name_end)

	// Named symbols (\ae, \ss, \ldots, \i, \o, …) — only when no TeX argument
	// follows for names that are also letter-accents. \c{c} is an accent; \o alone is ø.
	const symbol = SYMBOL_BY_LEN.find(([n]) => n === name)
	if (symbol) {
		const is_accent_with_arg =
			name.length === 1 && ACCENT_LETTER.has(name) && has_tex_arg(after)
		if (!is_accent_with_arg) {
			return { text: symbol[1], next: name_end }
		}
	}

	// Single-letter accents with argument: \c{c}, \v{s}, \u{o}, \H{o}, \'{c}, …
	if (name.length === 1 && ACCENT_LETTER.has(name) && has_tex_arg(after)) {
		const got = take_arg(s, name_end)
		if (!got) {
			return null
		}
		return { text: apply_accent(ACCENT_MARK[name], got.arg), next: got.next }
	}

	// Unknown multi-letter command (\unknowncmd, \textbf{…}, …)
	return null
}

/**
 * Convert the body of a special-character group (content inside `{…}`, which
 * begins with `\`). Returns Unicode on success, or `null` to keep the original
 * braced form when the command is unrecognized.
 *
 * If the body is a command plus trailing text (`\v{z}foo`), the command is
 * converted and the rest is run through {@link display_bibtex_text}.
 */
export function convert_tex_special(body: string): string | null {
	if (!body.startsWith('\\') || body.length < 2) {
		return null
	}
	const got = consume_tex_special(body, 0)
	if (!got) {
		return null
	}
	const rest = body.slice(got.next)
	return rest ? got.text + display_bibtex_text(rest) : got.text
}

/**
 * True when `after` (text following a command name) looks like a TeX argument.
 */
function has_tex_arg(after: string): boolean {
	const j = skip_ws(after, 0)
	if (j >= after.length) {
		return false
	}
	const c = after[j]
	return c === '{' || /[A-Za-z0-9]/.test(c)
}

/**
 * Render a BibTeX field value for humans.
 *
 * - Special-character groups `{…}` starting with `\` → Unicode where known
 * - Bare TeX specials mid-string (`\v{z}`, `\'{c}`) → Unicode (same commands)
 * - Other braces (case protection / grouping) → stripped, contents kept
 * - Unbalanced or unknown specials → left unchanged so data is not inventively altered
 *
 * Pure and cheap; safe to call on every paint.
 */
export function display_bibtex_text(raw: string): string {
	if (!raw) {
		return raw
	}
	// Fast path: nothing brace- or backslash-like to rewrite.
	if (!raw.includes('{') && !raw.includes('\\')) {
		return raw
	}

	let out = ''
	let i = 0
	while (i < raw.length) {
		if (raw[i] === '{') {
			const end = find_matching_brace(raw, i)
			if (end < 0) {
				out += raw.slice(i)
				break
			}
			const inner = raw.slice(i + 1, end)
			if (inner.startsWith('\\')) {
				const converted = convert_tex_special(inner)
				if (converted !== null) {
					out += converted
				} else {
					// Unknown command: keep original braces so nothing is invented.
					out += raw.slice(i, end + 1)
				}
			} else {
				// Protective / grouping braces — drop them, render inside
				// (may still contain bare `\v{z}` / `{\'e}` nested specials).
				out += display_bibtex_text(inner)
			}
			i = end + 1
			continue
		}
		if (raw[i] === '\\') {
			const got = consume_tex_special(raw, i)
			if (got) {
				out += got.text
				i = got.next
				continue
			}
			// Unknown bare command — keep the backslash literally.
			out += raw[i]
			i++
			continue
		}
		out += raw[i]
		i++
	}
	return out
}

export type DisplaySegment = { text: string, italic: boolean }

/** Matches only bare `<i>…</i>` / `<em>…</em>` — no attributes, so nothing but the tag name is ever trusted. */
const ITALIC_TAG_RE = /<(i|em)>([\s\S]*?)<\/\1>/gi

/**
 * Split display-ready text into segments, marking DBLP-style `<i>…</i>` /
 * `<em>…</em>` spans (used for genus/species names in titles) so callers can
 * render real italics instead of literal tag text. TeX specials are converted
 * first via {@link display_bibtex_text}. Only bare `<i>`/`<em>` (no attributes)
 * are recognized; unmatched or malformed tags are left as literal text —
 * nothing invented, same policy as `display_bibtex_text`.
 */
export function display_bibtex_segments(raw: string): DisplaySegment[] {
	const text = display_bibtex_text(raw)
	if (!text || !/<(i|em)>/i.test(text)) {
		return [{ text, italic: false }]
	}

	const segments: DisplaySegment[] = []
	let last = 0
	ITALIC_TAG_RE.lastIndex = 0
	let match: RegExpExecArray | null
	while ((match = ITALIC_TAG_RE.exec(text))) {
		if (match.index > last) {
			segments.push({ text: text.slice(last, match.index), italic: false })
		}
		segments.push({ text: match[2], italic: true })
		last = ITALIC_TAG_RE.lastIndex
	}
	if (last < text.length) {
		segments.push({ text: text.slice(last), italic: false })
	}
	return segments
}

/** Flattened plain text of {@link display_bibtex_segments} — for `title=` tooltips and other plain-text-only spots. */
export function display_bibtex_plain_text(raw: string): string {
	return display_bibtex_segments(raw).map((seg) => seg.text).join('')
}

/**
 * Append {@link display_bibtex_segments} to `el` as real DOM nodes — italic
 * segments become `<em>` elements (never `innerHTML`, so no markup beyond the
 * exact `<i>`/`<em>` pair this module recognizes can ever reach the DOM).
 * Appends only; call on a freshly created element.
 */
export function render_display_text(el: HTMLElement, raw: string): void {
	for (const seg of display_bibtex_segments(raw)) {
		if (seg.text.length === 0) continue
		if (seg.italic) {
			const em = document.createElement('em')
			em.textContent = seg.text
			el.appendChild(em)
		} else {
			el.appendChild(document.createTextNode(seg.text))
		}
	}
}

/**
 * Combining marks (Mn) used by NFD decomposition of Latin accents.
 * Avoid `\p{M}` so we stay portable on older JS targets / TS libs.
 */
const COMBINING_MARKS = /[\u0300-\u036f]/g

/**
 * Normalize a string for search comparison (not for display).
 *
 * Pipeline:
 * 1. TeX specials / protective braces → Unicode (`display_bibtex_text`)
 * 2. strip simple HTML tags (DBLP-style `<i>Candida</i>` in titles)
 * 3. lowercase
 * 4. accent-fold (NFD + strip combining marks) so Muller ≡ Müller ≡ M{\"u}ller
 * 5. collapse whitespace
 *
 * Pure, idempotent, and safe to run on every keystroke over slim fields.
 */
export function normalize_for_search(text: string): string {
	if (!text) {
		return ''
	}
	const folded = display_bibtex_text(text)
		// Tags → space so words do not glue across markup.
		.replace(/<[^>]+>/g, ' ')
		.toLowerCase()
		.normalize('NFD')
		.replace(COMBINING_MARKS, '')
	// Collapse runs of whitespace so noisy abstracts / multi-space titles still match.
	return folded.replace(/\s+/g, ' ').trim()
}

/**
 * Split a free-text clause into normalized search tokens (whitespace-separated).
 * Empty input → `[]`.
 */
export function search_tokens(query: string): string[] {
	const norm = normalize_for_search(query)
	if (!norm) {
		return []
	}
	return norm.split(' ').filter((t) => t.length > 0)
}

/**
 * Max Levenshtein distance allowed for a query token of length `n`.
 * Short tokens stay exact-only (avoids `cat` ≈ `cut` noise on large libraries).
 *
 * - n < 4 → 0 (exact / substring only)
 * - 4–6 → 1
 * - 7+ → 2  (covers magepix ≈ manogepix)
 */
export function fuzzy_edit_budget(token_len: number): number {
	if (token_len < 4) return 0
	if (token_len < 7) return 1
	return 2
}

/**
 * Bounded Levenshtein distance. Returns `max + 1` as soon as the distance
 * cannot be ≤ `max` (early exit for search hot path).
 */
export function levenshtein_within(a: string, b: string, max: number): number {
	if (a === b) return 0
	const la = a.length
	const lb = b.length
	if (max < 0) return 0
	if (Math.abs(la - lb) > max) return max + 1
	if (la === 0) return lb <= max ? lb : max + 1
	if (lb === 0) return la <= max ? la : max + 1

	// Two-row DP; only band within `max` of the diagonal is needed, but for
	// token lengths (~5–20) a full row is cheaper than band bookkeeping.
	let prev = new Array<number>(lb + 1)
	let curr = new Array<number>(lb + 1)
	for (let j = 0; j <= lb; j++) prev[j] = j

	for (let i = 1; i <= la; i++) {
		curr[0] = i
		let row_min = curr[0]
		const ca = a.charCodeAt(i - 1)
		for (let j = 1; j <= lb; j++) {
			const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
			curr[j] = Math.min(
				prev[j] + 1, // deletion
				curr[j - 1] + 1, // insertion
				prev[j - 1] + cost, // substitution
			)
			if (curr[j] < row_min) row_min = curr[j]
		}
		if (row_min > max) return max + 1
		const tmp = prev
		prev = curr
		curr = tmp
	}
	return prev[lb]
}

/** Alphanumeric words from a normalized haystack (hyphens/underscores split). */
export function search_words(hay: string): string[] {
	if (!hay) return []
	return hay.split(/[^a-z0-9]+/).filter((w) => w.length > 0)
}

/**
 * Match-quality ranks for a single query token against one dictionary word.
 * Higher = better for ranking. {@link MATCH_Q.NONE} means no match.
 *
 * Exact and true-prefix beats mid-word substring, which beats reverse-stem
 * ("typed past a short word"), which beats pure fuzzy (edit distance).
 */
export const MATCH_Q = {
	NONE: 0,
	FUZZY: 1,
	REVERSE_STEM: 2,
	SUBSTRING: 3,
	PREFIX: 4,
	EXACT: 5,
} as const

export type MatchQuality = (typeof MATCH_Q)[keyof typeof MATCH_Q]

/**
 * Quality of `token` against one normalized dictionary word (0 = no match).
 *
 * Order of checks (cheap → expensive, quality high → low):
 * 1. exact equality
 * 2. true prefix (`antibio` → `antibiofilm`) / mid-word substring
 * 3. reverse stem: token continues past a short word by at most a small
 *    budget (`smithh` ≈ `smith`) — NOT `liush` ≈ `liu` (too much extra)
 * 4. full-word Levenshtein within budget (`magepix` ≈ `manogepix`)
 * 5. fuzzy prefix: token ≈ some prefix of word (`antbio` ≈ `antibio…`)
 *
 * Fuzzy steps require a shared first character so `unite` cannot latch onto
 * `nitesh` via a one-edit prefix of an unrelated word.
 */
export function token_match_quality(token: string, word: string): MatchQuality {
	if (!token || !word) return MATCH_Q.NONE
	if (word === token) return MATCH_Q.EXACT
	// True prefix (order-independent multi-token search relies on this heavily).
	if (token.length >= 2 && word.startsWith(token)) return MATCH_Q.PREFIX
	if (word.includes(token)) return MATCH_Q.SUBSTRING

	const budget = fuzzy_edit_budget(token.length)
	// Reverse stem: user typed a little past a complete short word.
	// Cap extra length so "liush" does not claim author/citekey stem "liu".
	const reverse_extra = Math.max(budget, 1)
	if (
		word.length >= 3 &&
		token.startsWith(word) &&
		token.length - word.length <= reverse_extra
	) {
		return MATCH_Q.REVERSE_STEM
	}

	if (budget <= 0) return MATCH_Q.NONE
	// Anchor fuzzy on first character — kills unite≈nitesh while keeping
	// antbio≈antibiofilm and magepix≈manogepix.
	if (token.charCodeAt(0) !== word.charCodeAt(0)) return MATCH_Q.NONE

	// Full-word typo (similar length only).
	if (Math.abs(word.length - token.length) <= budget) {
		if (levenshtein_within(token, word, budget) <= budget) return MATCH_Q.FUZZY
	}

	// Fuzzy prefix: allow insertions/deletions at the start of a longer word.
	// e.g. antbio ≈ antibio(film), magepix already caught above as full-word.
	if (word.length + budget >= token.length) {
		const lo = Math.max(1, token.length - budget)
		const hi = Math.min(word.length, token.length + budget)
		for (let n = lo; n <= hi; n++) {
			if (levenshtein_within(token, word.slice(0, n), budget) <= budget) {
				return MATCH_Q.FUZZY
			}
		}
	}

	return MATCH_Q.NONE
}

/**
 * Whether `token` matches a single normalized dictionary word.
 * See {@link token_match_quality} for the ranked rules.
 */
export function token_matches_word(token: string, word: string): boolean {
	return token_match_quality(token, word) > MATCH_Q.NONE
}

/**
 * Best match quality of `token` against a normalized field/corpus string.
 *
 * 1. Per-word match via {@link token_match_quality}
 * 2. Contiguous substring of the whole haystack (covers `antibio` ⊂ title
 *    even when split edges differ) — at least {@link MATCH_Q.SUBSTRING}
 *
 * Multi-token queries are AND'd by the caller; order never matters.
 */
export function token_match_quality_haystack(token: string, hay: string): MatchQuality {
	if (!token) return MATCH_Q.EXACT
	if (!hay) return MATCH_Q.NONE

	let best: MatchQuality = MATCH_Q.NONE
	for (const word of search_words(hay)) {
		const q = token_match_quality(token, word)
		if (q > best) best = q
		if (best === MATCH_Q.EXACT) return best
	}
	// Contiguous substring anywhere (citekey fragments spanning `_`, etc.).
	if (best === MATCH_Q.NONE && hay.includes(token)) {
		return MATCH_Q.SUBSTRING
	}
	return best
}

/**
 * Whether a normalized query token matches a normalized field/corpus string.
 * Multi-token queries are AND'd by the caller; order never matters.
 */
export function token_matches_haystack(token: string, hay: string): boolean {
	return token_match_quality_haystack(token, hay) > MATCH_Q.NONE
}
