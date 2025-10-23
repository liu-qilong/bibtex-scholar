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

/**
 * Creates an editor plugin for displaying inline BibTeX entry hover popups, under the editing mode (including the live preview mode).
 *
 * When the cursor is outside the matched pattern (`{<id>}` or `[<id>]`), the hover widget will be displayed as a decoration; otherwise, the original text remains visible for editing.
 *
 * @param plugin - The BibtexScholar plugin instance.
 * @param app - The Obsidian App instance.
 * @returns A CodeMirror ViewPlugin for the hover widget.
 */
export const createHoverWidgetPlugin = (plugin: BibtexScholar, app: App) => {
    class HoverWidgetPlugin implements PluginValue {
        decorations: DecorationSet

        constructor(view: EditorView) {
            this.decorations = this.buildDecorations(view)
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged || update.selectionSet) {
                this.decorations = this.buildDecorations(update.view)
            }
        }

        destroy() {}

        buildDecorations(view: EditorView): DecorationSet {
            const builder = new RangeSetBuilder<Decoration>()
            const cursor_pos = view.state.selection.main.head

            for (const {from, to} of view.visibleRanges) {
                const start_line = view.state.doc.lineAt(from).number
                const end_line = view.state.doc.lineAt(to).number

                for (let ln = start_line; ln <= end_line; ln++) {
                    const line = view.state.doc.line(ln)
                    const text = line.text
                    const PATTERN = /\`[\{\[][^\}\]]+[\}\]]\`/g
                    PATTERN.lastIndex = 0
                    let m: RegExpExecArray | null
                    while ((m = PATTERN.exec(text)) !== null) {
                        // determine if cursor is inside the match
                        const match_from = line.from + m.index
                        const match_to = match_from + m[0].length
                        const cursor_inside = cursor_pos >= match_from && cursor_pos <= match_to

                        if (!cursor_inside) {
                            // if cursor is not inside, add decoration
                            const bibtex_id = m[0].slice(2, -2)
                            const expand = ((m[0][1] === '['))?(true):(false)
                            const bibtex = plugin.cache.bibtex_dict[bibtex_id]
                            
                            if (bibtex) {
                                builder.add(
                                    match_from,
                                    match_to,
                                    Decoration.replace({
                                       widget: new HoverWidget(bibtex, plugin, app, expand),
                                    })
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