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
 * If `pos` sits inside a cite match on its line, return a stable key `from:to`.
 * Thin wrapper over pure helpers (kept for editor-local call sites / tests).
 */
export function cite_span_key_at(view: EditorView, pos: number): string | null {
    if (pos < 0 || pos > view.state.doc.length) {
        return null
    }
    const line = view.state.doc.lineAt(pos)
    return cite_span_key_at_offset(line.text, line.from, pos)
}

/**
 * Cite chips/cards belong in Live Preview and Reading view only — never pure Source mode.
 * (Reading uses markdown post-processors; this flag gates the CM editor extension.)
 */
export function should_render_cite_widgets(live_preview: boolean): boolean {
    return live_preview === true
}

function is_live_preview(view: EditorView): boolean {
    return should_render_cite_widgets(view.state.field(editorLivePreviewField))
}

/**
 * Creates an editor plugin for BibTeX citation chips in **Live Preview** only.
 *
 * Pure Source mode: no decorations — raw `` `{id}` `` / `` `[id]` `` text.
 * Reading view: unchanged (markdown post-processors, not this plugin).
 *
 * Cursor policy (live preview):
 * - Outside a cite span → replace decoration (chip widget)
 * - Inside a cite span → raw text for editing
 * - Selection-only updates rebuild decorations only when the caret enters/leaves a cite
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

            // Toggle Source ↔ Live Preview: drop or rebuild chips immediately.
            if (was_lp !== is_lp) {
                this.decorations = this.buildDecorations(update.view)
                return
            }

            if (!is_lp) {
                // Stay decoration-free in pure source mode.
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
                // Doc is unchanged here (docChanged returned above). Still resolve
                // old_head against startState so a future combined transaction
                // cannot mis-attribute the pre-edit caret to the post-edit line map.
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

            for (const vr of view.visibleRanges) {
                const start_line = view.state.doc.lineAt(vr.from).number
                const end_line = view.state.doc.lineAt(vr.to).number

                for (let ln = start_line; ln <= end_line; ln++) {
                    const line = view.state.doc.line(ln)
                    // Caret inside a span → raw text for edit; all other spans chip.
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

    // Deliberately NOT using EditorView.atomicRanges here: the plugin's own edit
    // affordance depends on the caret being able to land *inside* [from, to) so
    // cursor_inside_span() derenders the chip back to raw text. Atomic ranges
    // would make CM skip over the whole span in one step, breaking arrow-key
    // entry into edit mode (and doing so asymmetrically left-vs-right).
    return ViewPlugin.fromClass(HoverWidgetPlugin, pluginSpec)
}
