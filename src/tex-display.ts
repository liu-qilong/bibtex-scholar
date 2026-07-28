/**
 * Display-time rendering of BibTeX field values.
 *
 * Stored fields stay in their original TeX-ish encoding (export / copy / parse
 * are untouched). UI surfaces call {@link display_bibtex_text} /
 * {@link display_bibtex_segments} so readers see Unicode and font styles rather
 * than raw TeX.
 *
 * Handled for display (not a full TeX engine):
 * - Special-character groups / bare accents: `{\'e}`, `{\"{u}}`, `\v{z}`, …
 * - Symbols: `{\ae}`, `\&`, `\%`, …
 * - Font switches: `{\itshape …}`, `{\em …}`, `\textit{…}`, `{\bfseries …}`, `\textbf{…}`, …
 * - Bare `~` → U+00A0 (BibTeX non-breaking space)
 * - DBLP-style bare `<i>` / `<em>` tags
 * - Protective braces (`{GPU}`, `{:}`, `{de}`) stripped
 *
 * Structural BibTeX grammar (`@string`, crossref, quoted fields) lives in
 * `parse_bibtex` — a separate, custom parser — not here.
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
 * Used by accent/symbol consumption where the argument should already be Unicode.
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

/**
 * Take a raw TeX argument (brace body or one character) without display-rendering.
 * Used by font commands so nested markup can be walked with style.
 */
function take_raw_arg(s: string, i: number): { arg: string; next: number } | null {
	i = skip_ws(s, i)
	if (i >= s.length) {
		return null
	}
	if (s[i] === '{') {
		const end = find_matching_brace(s, i)
		if (end < 0) {
			return null
		}
		return { arg: s.slice(i + 1, end), next: end + 1 }
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
 * Render a BibTeX field value for humans (plain Unicode, markup stripped).
 *
 * - Special-character groups `{…}` starting with `\` → Unicode where known
 * - Bare TeX specials mid-string (`\v{z}`, `\'{c}`) → Unicode (same commands)
 * - Font switches (`{\itshape …}`, `\textit{…}`, `{\bfseries …}`, …) → body only
 * - Bare `~` → non-breaking space (BibTeX convention)
 * - Other braces (case protection / grouping) → stripped, contents kept
 * - Unbalanced or unknown specials → left unchanged so data is not inventively altered
 *
 * Pure and cheap; safe to call on every paint. For styled UI use
 * {@link display_bibtex_segments}.
 */
export function display_bibtex_text(raw: string): string {
	if (!raw) {
		return raw
	}
	// Fast path: nothing that needs a walk.
	if (!raw.includes('{') && !raw.includes('\\') && !raw.includes('~') && !/<[ie]/i.test(raw)) {
		return raw
	}
	return display_bibtex_plain_text(raw)
}

export type DisplaySegment = { text: string, italic: boolean, bold: boolean }

type DisplayStyle = { italic: boolean, bold: boolean }

const STYLE_PLAIN: DisplayStyle = { italic: false, bold: false }

/**
 * Font-declaration switches used as `{\itshape body}` / `{\bfseries body}`.
 * After the control word, TeX skips whitespace; the rest of the group is the body.
 */
const FONT_DECL: Record<string, Partial<DisplayStyle>> = {
	itshape: { italic: true },
	it: { italic: true },
	em: { italic: true },
	slshape: { italic: true },
	bfseries: { bold: true },
	bf: { bold: true },
}

/**
 * Font commands that take a TeX argument: `\textit{…}`, `\emph{…}`, `\textbf{…}`.
 * Also accepted as the body of a special group (`{\textit{…}}`).
 */
const FONT_ARG: Record<string, Partial<DisplayStyle>> = {
	textit: { italic: true },
	emph: { italic: true },
	textsl: { italic: true },
	textbf: { bold: true },
}

/** Matches only bare `<i>…</i>` / `<em>…</em>` — no attributes. */
const ITALIC_TAG_RE = /<(i|em)>([\s\S]*?)<\/\1>/gi

function merge_style(base: DisplayStyle, add: Partial<DisplayStyle>): DisplayStyle {
	return {
		italic: add.italic === true ? true : base.italic,
		bold: add.bold === true ? true : base.bold,
	}
}

function push_seg(out: DisplaySegment[], text: string, style: DisplayStyle): void {
	if (!text) {
		return
	}
	const last = out[out.length - 1]
	if (last && last.italic === style.italic && last.bold === style.bold) {
		last.text += text
		return
	}
	out.push({ text, italic: style.italic, bold: style.bold })
}

/**
 * Read a letter-named TeX control sequence starting at `\` (index `start`).
 * Returns null for symbol commands (`\'`, `\&`, …).
 */
function read_control_word(
	s: string,
	start: number,
): { name: string, next: number } | null {
	if (s[start] !== '\\' || start + 1 >= s.length) {
		return null
	}
	if (!/[a-zA-Z]/.test(s[start + 1])) {
		return null
	}
	let j = start + 1
	while (j < s.length && /[a-zA-Z]/.test(s[j])) {
		j++
	}
	return { name: s.slice(start + 1, j), next: j }
}

/**
 * Walk raw BibTeX field text into styled display segments (TeX specials + font
 * markup). Does not handle DBLP HTML tags — see {@link expand_html_italic_tags}.
 */
function walk_display(raw: string, style: DisplayStyle): DisplaySegment[] {
	const out: DisplaySegment[] = []
	let i = 0
	while (i < raw.length) {
		const ch = raw[i]

		if (ch === '{') {
			const end = find_matching_brace(raw, i)
			if (end < 0) {
				push_seg(out, raw.slice(i), style)
				break
			}
			const inner = raw.slice(i + 1, end)
			if (inner.startsWith('\\')) {
				const word = read_control_word(inner, 0)
				if (word && FONT_DECL[word.name]) {
					// `{\itshape body}` / `{\bfseries body}` — body after command + space.
					const body = inner.slice(skip_ws(inner, word.next))
					for (const seg of walk_display(body, merge_style(style, FONT_DECL[word.name]))) {
						push_seg(out, seg.text, { italic: seg.italic, bold: seg.bold })
					}
				} else if (word && FONT_ARG[word.name]) {
					// `{\textit{body}}` or `{\textit body}` inside outer braces.
					const got = take_raw_arg(inner, word.next)
					if (got) {
						for (const seg of walk_display(got.arg, merge_style(style, FONT_ARG[word.name]))) {
							push_seg(out, seg.text, { italic: seg.italic, bold: seg.bold })
						}
						const rest = inner.slice(got.next)
						if (rest) {
							for (const seg of walk_display(rest, style)) {
								push_seg(out, seg.text, { italic: seg.italic, bold: seg.bold })
							}
						}
					} else {
						// No arg — treat remainder after command as body (rare).
						const body = inner.slice(skip_ws(inner, word.next))
						for (const seg of walk_display(body, merge_style(style, FONT_ARG[word.name]))) {
							push_seg(out, seg.text, { italic: seg.italic, bold: seg.bold })
						}
					}
				} else {
					const converted = convert_tex_special(inner)
					if (converted !== null) {
						push_seg(out, converted, style)
					} else {
						// Unknown command: keep original braces so nothing is invented.
						push_seg(out, raw.slice(i, end + 1), style)
					}
				}
			} else {
				// Protective / grouping braces — drop them, walk inside.
				for (const seg of walk_display(inner, style)) {
					push_seg(out, seg.text, { italic: seg.italic, bold: seg.bold })
				}
			}
			i = end + 1
			continue
		}

		if (ch === '\\') {
			const word = read_control_word(raw, i)
			if (word && FONT_ARG[word.name]) {
				const got = take_raw_arg(raw, word.next)
				if (got) {
					for (const seg of walk_display(got.arg, merge_style(style, FONT_ARG[word.name]))) {
						push_seg(out, seg.text, { italic: seg.italic, bold: seg.bold })
					}
					i = got.next
					continue
				}
			}
			if (word && FONT_DECL[word.name]) {
				// Bare `{\itshape` is normal; bare `\itshape` mid-string is rare —
				// consume the command + following space only (no body scope without braces).
				i = skip_ws(raw, word.next)
				continue
			}
			const got = consume_tex_special(raw, i)
			if (got) {
				push_seg(out, got.text, style)
				i = got.next
				continue
			}
			// Unknown bare command — keep the backslash literally.
			push_seg(out, ch, style)
			i++
			continue
		}

		// BibTeX non-breaking space (not the accent command `\~`).
		if (ch === '~') {
			push_seg(out, '\u00A0', style)
			i++
			continue
		}

		// Run of plain characters until the next special.
		let j = i + 1
		while (j < raw.length) {
			const c = raw[j]
			if (c === '{' || c === '\\' || c === '~') {
				break
			}
			j++
		}
		push_seg(out, raw.slice(i, j), style)
		i = j
	}
	return out
}

/**
 * Expand DBLP-style bare `<i>`/`<em>` tags inside segment text into italic
 * segments. Attributed / mismatched / unclosed tags stay literal.
 */
function expand_html_italic_tags(segments: DisplaySegment[]): DisplaySegment[] {
	const out: DisplaySegment[] = []
	for (const seg of segments) {
		if (!seg.text || !/<(i|em)>/i.test(seg.text)) {
			push_seg(out, seg.text, { italic: seg.italic, bold: seg.bold })
			continue
		}
		let last = 0
		let any = false
		ITALIC_TAG_RE.lastIndex = 0
		let match: RegExpExecArray | null
		while ((match = ITALIC_TAG_RE.exec(seg.text))) {
			any = true
			if (match.index > last) {
				push_seg(out, seg.text.slice(last, match.index), {
					italic: seg.italic,
					bold: seg.bold,
				})
			}
			push_seg(out, match[2], { italic: true, bold: seg.bold })
			last = ITALIC_TAG_RE.lastIndex
		}
		if (!any) {
			push_seg(out, seg.text, { italic: seg.italic, bold: seg.bold })
		} else if (last < seg.text.length) {
			push_seg(out, seg.text.slice(last), { italic: seg.italic, bold: seg.bold })
		}
	}
	return out
}

/**
 * Split a BibTeX field into display segments with style flags.
 *
 * Handles:
 * - TeX specials → Unicode
 * - Font switches (`{\itshape …}`, `\textit{…}`, `{\bfseries …}`, …)
 * - Bare `~` → nbsp
 * - DBLP-style bare `<i>`/`<em>` (no attributes)
 *
 * Unknown TeX is left literal. Pure and cheap enough for paint paths.
 */
export function display_bibtex_segments(raw: string): DisplaySegment[] {
	if (!raw) {
		return [{ text: raw, italic: false, bold: false }]
	}
	if (!raw.includes('{') && !raw.includes('\\') && !raw.includes('~') && !/<[ie]/i.test(raw)) {
		return [{ text: raw, italic: false, bold: false }]
	}
	const tex = walk_display(raw, STYLE_PLAIN)
	return expand_html_italic_tags(tex)
}

/**
 * Flattened plain Unicode of {@link display_bibtex_segments}.
 * Use for tooltips and **clipboard** from the card UI (TeX → Unicode, tags
 * and font markup stripped). Do not use for BibTeX export / “copy bibtex” —
 * those keep the raw stored encoding.
 */
export function display_bibtex_plain_text(raw: string): string {
	return display_bibtex_segments(raw).map((seg) => seg.text).join('')
}

/**
 * Append {@link display_bibtex_segments} to `el` as real DOM nodes — italic
 * → `<em>`, bold → `<strong>`, both → nested (never `innerHTML`).
 * Appends only; call on a freshly created element.
 */
export function render_display_text(el: HTMLElement, raw: string): void {
	for (const seg of display_bibtex_segments(raw)) {
		if (seg.text.length === 0) continue
		if (seg.italic && seg.bold) {
			const strong = document.createElement('strong')
			const em = document.createElement('em')
			em.textContent = seg.text
			strong.appendChild(em)
			el.appendChild(strong)
		} else if (seg.italic) {
			const em = document.createElement('em')
			em.textContent = seg.text
			el.appendChild(em)
		} else if (seg.bold) {
			const strong = document.createElement('strong')
			strong.textContent = seg.text
			el.appendChild(strong)
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
