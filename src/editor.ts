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
import { HoverWidget } from 'src/hover'
import BibtexScholar from 'src/main'

/** Inline cite forms: `{id}` or `[id]` inside backticks. */
const CITE_PATTERN = /\`[\{\[][^\}\]]+[\}\]]\`/g

/**
 * If `pos` sits inside a cite match on its line, return a stable key `from:to`.
 * Used to detect enter/leave of cite spans without rebuilding all decorations.
 */
function cite_span_key_at(view: EditorView, pos: number): string | null {
    if (pos < 0 || pos > view.state.doc.length) {
        return null
    }
    const line = view.state.doc.lineAt(pos)
    CITE_PATTERN.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = CITE_PATTERN.exec(line.text)) !== null) {
        const match_from = line.from + m.index
        const match_to = match_from + m[0].length
        if (pos >= match_from && pos <= match_to) {
            return `${match_from}:${match_to}`
        }
    }
    return null
}

/**
 * Creates an editor plugin for BibTeX citation chips in editing mode (source + live preview).
 *
 * When the cursor is outside a match (`` `{id}` `` / `` `[id]` ``), a {@link HoverWidget}
 * replace decoration shows the chip; when the cursor is inside, raw text is editable.
 *
 * Phase 3: decorations rebuild on doc/viewport changes always, but on selection only when
 * the caret enters or leaves a cite span — so arrowing past citations does not remount
 * React chips or thrash the floating popup. {@link HoverWidget.eq} keeps DOM when the set
 * is rebuilt with the same cite id + expand mode.
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
                // Doc is unchanged; only rebuild when caret enter/leave of a cite span changes
                // which widgets should exist. Pure motion outside cites keeps widgets mounted.
                const old_head = update.startState.selection.main.head
                const new_head = update.state.selection.main.head
                if (cite_span_key_at(update.view, old_head) !== cite_span_key_at(update.view, new_head)) {
                    this.decorations = this.buildDecorations(update.view)
                }
            }
        }

        destroy() {}

        buildDecorations(view: EditorView): DecorationSet {
            const builder = new RangeSetBuilder<Decoration>()
            const cursor_pos = view.state.selection.main.head

            for (const { from, to } of view.visibleRanges) {
                const start_line = view.state.doc.lineAt(from).number
                const end_line = view.state.doc.lineAt(to).number

                for (let ln = start_line; ln <= end_line; ln++) {
                    const line = view.state.doc.line(ln)
                    const text = line.text
                    CITE_PATTERN.lastIndex = 0
                    let m: RegExpExecArray | null
                    while ((m = CITE_PATTERN.exec(text)) !== null) {
                        const match_from = line.from + m.index
                        const match_to = match_from + m[0].length
                        const cursor_inside = cursor_pos >= match_from && cursor_pos <= match_to

                        if (!cursor_inside) {
                            const bibtex_id = m[0].slice(2, -2)
                            const expand = m[0][1] === '['
                            const bibtex = plugin.cache.bibtex_dict[bibtex_id]

                            if (bibtex) {
                                builder.add(
                                    match_from,
                                    match_to,
                                    Decoration.replace({
                                        widget: new HoverWidget(bibtex, plugin, app, expand),
                                    }),
                                )
                            }
                        }
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
