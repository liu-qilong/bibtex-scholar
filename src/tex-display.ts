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
 * Convert the body of a special-character group (content inside `{…}`, which
 * begins with `\`). Returns Unicode on success, or `null` to keep the original
 * braced form when the command is unrecognized.
 */
export function convert_tex_special(body: string): string | null {
	if (!body.startsWith('\\') || body.length < 2) {
		return null
	}

	const i = 1 // after '\'
	const ch = body[i]

	// --- Escaped single characters: \& \% \$ \# \_ \{ \} \  \, ---
	if (ch in ESCAPED_CHAR) {
		const rest = body.slice(i + 1)
		return ESCAPED_CHAR[ch] + (rest ? display_bibtex_text(rest) : '')
	}

	// --- Non-letter accents: \'e  \'{e}  \"{u}  \`a  \^o  \~n  \=o  \.z ---
	if (ACCENT_SYMBOL.has(ch)) {
		const got = take_arg(body, i + 1)
		if (!got) {
			// Bare `\~` / `\^` sometimes appear as spacing/escapes.
			if (ch === '~') return '~'
			if (ch === '^') return '^'
			return null
		}
		const rest = body.slice(got.next)
		return apply_accent(ACCENT_MARK[ch], got.arg) + (rest ? display_bibtex_text(rest) : '')
	}

	// --- Letter-named commands: read the full command name first ---
	if (!/[a-zA-Z]/.test(ch)) {
		return null
	}

	let name_end = i
	while (name_end < body.length && /[a-zA-Z]/.test(body[name_end])) {
		name_end++
	}
	const name = body.slice(i, name_end)
	const after = body.slice(name_end)

	// Named symbols (\ae, \ss, \ldots, \i, \o, …) — only when no TeX argument
	// follows for names that are also letter-accents. \c{c} is an accent; \o alone is ø.
	const symbol = SYMBOL_BY_LEN.find(([n]) => n === name)
	if (symbol) {
		const is_accent_with_arg =
			name.length === 1 && ACCENT_LETTER.has(name) && has_tex_arg(after)
		if (!is_accent_with_arg) {
			const rendered_rest = after ? display_bibtex_text(after.replace(/^\s+/, '')) : ''
			return symbol[1] + rendered_rest
		}
	}

	// Single-letter accents with argument: \c{c}, \v{s}, \u{o}, \H{o}, …
	if (name.length === 1 && ACCENT_LETTER.has(name) && has_tex_arg(after)) {
		const got = take_arg(body, name_end)
		if (!got) {
			return null
		}
		const rest = body.slice(got.next)
		return apply_accent(ACCENT_MARK[name], got.arg) + (rest ? display_bibtex_text(rest) : '')
	}

	// Unknown multi-letter command (\unknowncmd, \textbf{…}, …)
	return null
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
 * - Other braces (case protection / grouping) → stripped, contents kept
 * - Unbalanced or unknown specials → left unchanged so data is not inventively altered
 *
 * Pure and cheap; safe to call on every paint.
 */
export function display_bibtex_text(raw: string): string {
	if (!raw) {
		return raw
	}
	// Fast path: nothing brace-like to rewrite.
	if (!raw.includes('{')) {
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
				// Protective / grouping braces — drop them, render inside.
				out += display_bibtex_text(inner)
			}
			i = end + 1
			continue
		}
		// Bare TeX outside the brace+backslash scheme is left alone (encoding stays raw).
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
 * Whether `token` matches a single normalized dictionary word.
 *
 * Order of checks (cheap → expensive):
 * 1. exact equality / word contains token / token is a prefix (antibio → antibiofilm)
 * 2. full-word Levenshtein within budget (magepix ≈ manogepix)
 * 3. fuzzy **prefix**: token ≈ some prefix of word (antbio ≈ antibio…, magepi ≈ manoge…)
 *
 * Prefix fuzzy is what full-word-only Levenshtein misses: length gates reject
 * short stubs against long title words.
 */
export function token_matches_word(token: string, word: string): boolean {
	if (!token || !word) return false
	if (word === token || word.includes(token)) return true
	// Pure prefix (order-independent multi-token search relies on this heavily).
	if (token.length >= 2 && word.startsWith(token)) return true
	// Query longer than word but word is a stem the user finished typing past.
	if (word.length >= 3 && token.startsWith(word)) return true

	const budget = fuzzy_edit_budget(token.length)
	if (budget <= 0) return false

	// Full-word typo (similar length only).
	if (Math.abs(word.length - token.length) <= budget) {
		if (levenshtein_within(token, word, budget) <= budget) return true
	}

	// Fuzzy prefix: allow insertions/deletions at the start of a longer word.
	// e.g. antbio ≈ antibio(film), magepix already caught above as full-word.
	if (word.length + budget >= token.length) {
		const lo = Math.max(1, token.length - budget)
		const hi = Math.min(word.length, token.length + budget)
		for (let n = lo; n <= hi; n++) {
			if (levenshtein_within(token, word.slice(0, n), budget) <= budget) {
				return true
			}
		}
	}

	return false
}

/**
 * Whether a normalized query token matches a normalized field/corpus string.
 *
 * 1. Exact substring of the whole haystack (fast path)
 * 2. Per-word match via {@link token_matches_word} (prefix + fuzzy)
 *
 * Multi-token queries are AND'd by the caller; order never matters.
 */
export function token_matches_haystack(token: string, hay: string): boolean {
	if (!token) return true
	if (!hay) return false
	// Contiguous substring anywhere (covers antibio ⊂ antibiofilm in title/id).
	if (hay.includes(token)) return true

	for (const word of search_words(hay)) {
		if (token_matches_word(token, word)) return true
	}
	return false
}
