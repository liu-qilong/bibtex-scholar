import { IconName, ItemView, WorkspaceLeaf } from 'obsidian'

export const PAPER_PANEL_VIEW_TYPE = 'paper-panel-view'

export class PaperPanelView extends ItemView {
    constructor(leaf: WorkspaceLeaf) {
        super(leaf)
    }

    getViewType() {
        return PAPER_PANEL_VIEW_TYPE
    }

    getDisplayText() {
        return 'Paper Panel'
    }

    getIcon(): IconName {
        // return 'document'
        return 'scroll-text'
    }

    async onOpen() {
        const container = this.containerEl.children[1]
        container.empty()
        container.createEl('div', { text: 'BibTeX Scholar - Paper Panel' })
    }

    async onClose() {

    }
}