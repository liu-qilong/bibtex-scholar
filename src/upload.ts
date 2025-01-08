import { App, Modal, Notice } from 'obsidian'

export class UploadPdfModal extends Modal {
    folder: string
    fname: string

    constructor(app: App, folder: string = 'paper/pdf', fname: string = 'paper.pdf') {
        super(app)
        this.folder = folder
        this.fname = fname
    }

    onOpen() {
        const { contentEl } = this
        contentEl.createEl('h4', { text: 'Upload PDF' })

        const file_input = contentEl.createEl('input', { type: 'file' })
        file_input.addEventListener('change', (event: Event) => {
            const target = event.target as HTMLInputElement
            if (target.files && target.files.length > 0) {
                const file = target.files[0]
                this.handleFileUpload(file)
            }
        })
    }

    handleFileUpload(file: File) {
        // read the file as an ArrayBuffer
        const reader = new FileReader()
        reader.onload = async (event) => {
            const { result } = event.target as FileReader
            const data = result as ArrayBuffer
            const file_path = `${this.folder}/${this.fname}`

            // ensure the folder exists
            if (!await this.app.vault.adapter.exists(this.folder)) {
                await this.app.vault.createFolder(this.folder)
            }

            // save the file to the vault
            await this.app.vault.createBinary(file_path, data)
            this.app.workspace.openLinkText(this.fname, this.fname, true)
            // new Notice(`File saved to ${file_path}`)
        }
        reader.readAsArrayBuffer(file)

        this.close()
    }

    onClose() {
        const { contentEl } = this
        contentEl.empty()
    }
}