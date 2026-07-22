import { RangeSetBuilder } from '@codemirror/state'
import {
	Decoration,
	DecorationSet,
	EditorView,
	PluginSpec,
	PluginValue,
	ViewPlugin,
	ViewUpdate,
} from '@codemirror/view'
import { App, editorLivePreviewField } from 'obsidian'
import {
	cite_span_key_at_offset,
	selection_requires_decoration_rebuild,
	spans_showing_chips,
} from 'src/cite-span'
import { resolve_id } from 'src/citekey-index'
import { HoverWidget } from 'src/hover'
import type BibtexScholar from 'src/main'

/**
 * Stable `from:to` key if `pos` sits inside a cite on its line; otherwise null.
 * Thin wrapper over pure helpers for editor call sites and tests.
 */
export function cite_span_key_at(view: EditorView, pos: number): string | null {
	if (pos < 0 || pos > view.state.doc.length) {
		return null
	}
	const line = view.state.doc.lineAt(pos)
	return cite_span_key_at_offset(line.text, line.from, pos)
}

/**
 * Cite chips belong in Live Preview only (Reading view uses markdown post-processors).
 * Pure Source mode shows raw `` `{id}` `` / `` `[id]` `` text.
 */
export function should_render_cite_widgets(live_preview: boolean): boolean {
	return live_preview === true
}

function is_live_preview(view: EditorView): boolean {
	return should_render_cite_widgets(view.state.field(editorLivePreviewField))
}

/**
 * Live Preview editor extension: replace known cites with chip widgets.
 *
 * Cursor policy:
 * - Caret **outside** a cite → chip
 * - Caret **inside** a cite → raw text so the user can edit the key
 * - Selection-only updates rebuild only when the caret enters/leaves a cite
 *
 * We intentionally do **not** use `EditorView.atomicRanges`: edit-a-citation
 * needs the caret to land inside `[from, to)`. Atomic ranges would skip the
 * whole span in one arrow step.
 */
export const createHoverWidgetPlugin = (plugin: BibtexScholar, app: App) => {
	class HoverWidgetPlugin implements PluginValue {
		decorations: DecorationSet

		constructor(view: EditorView) {
			this.decorations = this.buildDecorations(view)
		}

		update(update: ViewUpdate) {
			const was_lp = update.startState.field(editorLivePreviewField)
			const is_lp = update.state.field(editorLivePreviewField)

			if (was_lp !== is_lp) {
				this.decorations = this.buildDecorations(update.view)
				return
			}

			if (!is_lp) {
				if (this.decorations.size > 0) {
					this.decorations = Decoration.none
				}
				return
			}

			if (update.docChanged || update.viewportChanged) {
				this.decorations = this.buildDecorations(update.view)
				return
			}

			if (update.selectionSet) {
				// Doc is unchanged (docChanged handled above). Resolve old/new
				// heads against their own states for a correct enter/leave check.
				const old_head = update.startState.selection.main.head
				const new_head = update.state.selection.main.head
				const old_line = update.startState.doc.lineAt(old_head)
				const new_line = update.state.doc.lineAt(new_head)
				if (selection_requires_decoration_rebuild(
					cite_span_key_at_offset(old_line.text, old_line.from, old_head),
					cite_span_key_at_offset(new_line.text, new_line.from, new_head),
				)) {
					this.decorations = this.buildDecorations(update.view)
				}
			}
		}

		destroy() {}

		buildDecorations(view: EditorView): DecorationSet {
			if (!is_live_preview(view)) {
				return Decoration.none
			}

			const builder = new RangeSetBuilder<Decoration>()
			const cursor_pos = view.state.selection.main.head
			const dict = plugin.cache.bibtex_dict

			for (const visible of view.visibleRanges) {
				const start_line = view.state.doc.lineAt(visible.from).number
				const end_line = view.state.doc.lineAt(visible.to).number

				for (let line_no = start_line; line_no <= end_line; line_no++) {
					const line = view.state.doc.line(line_no)
					for (const span of spans_showing_chips(line.text, line.from, cursor_pos)) {
						const canonical_id = resolve_id(plugin.id_index, span.id)
						const bibtex = canonical_id !== undefined ? dict[canonical_id] : undefined
						if (!bibtex) {
							continue
						}
						builder.add(
							span.from,
							span.to,
							Decoration.replace({
								widget: new HoverWidget(bibtex, plugin, app, span.expand),
							}),
						)
					}
				}
			}
			return builder.finish()
		}
	}

	const pluginSpec: PluginSpec<HoverWidgetPlugin> = {
		decorations: (value: HoverWidgetPlugin) => value.decorations,
	}

	return ViewPlugin.fromClass(HoverWidgetPlugin, pluginSpec)
}
