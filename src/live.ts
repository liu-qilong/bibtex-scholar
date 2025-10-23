import { RangeSetBuilder } from '@codemirror/state'
import {
    WidgetType,
    Decoration,
    DecorationSet,
    EditorView,
    PluginSpec,
    PluginValue,
    ViewPlugin,
    ViewUpdate,
} from '@codemirror/view'

const EMOJI = "😊"
const PATTERN = /\`\{[^}]+\}\`/g

class EmojiWidget extends WidgetType {
	toDOM() {
		const span = document.createElement("span")
		span.textContent = EMOJI
		return span
	}

	eq() {
		return true
	}

	ignoreEvent() {
		return true
	}
}

class EmojiWidgetPlugin implements PluginValue {
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
		const cursorPos = view.state.selection.main.head
		console.log(cursorPos)

		for (const {from, to} of view.visibleRanges) {
			const startLine = view.state.doc.lineAt(from).number
			const endLine = view.state.doc.lineAt(to).number

			for (let ln = startLine; ln <= endLine; ln++) {
				const line = view.state.doc.line(ln)
				const text = line.text

				PATTERN.lastIndex = 0
				let m: RegExpExecArray | null
				while ((m = PATTERN.exec(text)) !== null) {
					const matchFrom = line.from + m.index
					const matchTo = matchFrom + m[0].length

					const cursorInside = cursorPos >= matchFrom && cursorPos <= matchTo
					console.log(matchFrom, matchTo, cursorInside)
					if (cursorInside) continue

					builder.add(
						matchFrom,
						matchTo,
						Decoration.replace({
							widget: new EmojiWidget(),
						})
					)
				}
			}
		}

        return builder.finish()
    }
}

const pluginSpec: PluginSpec<EmojiWidgetPlugin> = {
    decorations: (value: EmojiWidgetPlugin) => value.decorations,
}

export const emojiWidgetPlugin = ViewPlugin.fromClass(
    EmojiWidgetPlugin,
    pluginSpec
)