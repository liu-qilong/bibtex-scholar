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
import { App } from 'obsidian'
import {
    cite_span_key_at_offset,
    cursor_inside_span,
    find_cite_spans_in_line,
    selection_requires_decoration_rebuild,
} from 'src/cite-span'
import { HoverWidget } from 'src/hover'
import BibtexScholar from 'src/main'

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
 * Creates an editor plugin for BibTeX citation chips in editing mode (source + live preview).
 *
 * Cursor policy:
 * - Outside a cite span → replace decoration (chip widget)
 * - Inside a cite span → raw text for editing
 * - Selection-only updates rebuild decorations only when the caret enters/leaves a cite
 *   (or jumps between different cites) — avoids idle remount thrash
 */
export const createHoverWidgetPlugin = (plugin: BibtexScholar, app: App) => {
    class HoverWidgetPlugin implements PluginValue {
        decorations: DecorationSet

        constructor(view: EditorView) {
            this.decorations = this.buildDecorations(view)
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged) {
                this.decorations = this.buildDecorations(update.view)
                return
            }

            if (update.selectionSet) {
                const old_head = update.startState.selection.main.head
                const new_head = update.state.selection.main.head
                // Doc unchanged on pure selection updates — keys are comparable in the same doc.
                if (selection_requires_decoration_rebuild(
                    cite_span_key_at(update.view, old_head),
                    cite_span_key_at(update.view, new_head),
                )) {
                    this.decorations = this.buildDecorations(update.view)
                }
            }
        }

        destroy() {}

        buildDecorations(view: EditorView): DecorationSet {
            const builder = new RangeSetBuilder<Decoration>()
            const cursor_pos = view.state.selection.main.head
            // Live dict lookup — never snapshot at plugin construct time.
            const dict = plugin.cache.bibtex_dict

            for (const vr of view.visibleRanges) {
                const start_line = view.state.doc.lineAt(vr.from).number
                const end_line = view.state.doc.lineAt(vr.to).number

                for (let ln = start_line; ln <= end_line; ln++) {
                    const line = view.state.doc.line(ln)
                    for (const span of find_cite_spans_in_line(line.text, line.from)) {
                        if (cursor_inside_span(cursor_pos, span.from, span.to)) {
                            continue
                        }
                        const bibtex = dict[span.id]
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
