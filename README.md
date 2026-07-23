# BibTeX Scholar 🎓

**BibTeX Scholar** is a reference management plugin built entirely on [Obsidian](https://obsidian.md/) to supercharge your research workflow. Replace cluttered folder-based libraries with contextual, flexible, Markdown-powered literature notes--directly in your knowledge base 🧠

![img](/gallery/bibtex-scholar.png)

## Why choose BibTeX Scholar? 💡

Traditional reference managers organize papers in flat folders, leading to the lack of context:

- Which paper builds upon which? 🧐
- How are concepts and methods evolving? 🔄
- What are the key contributions and relationships? 🔑
- How do research trajectories and comparisons look? 📈
- **There is a paper mentioning [...], but I can't find it now! 😩**

As your library grows, it’s easy to lose track. **BibTeX Scholar** lets you manage your literature the way researchers actually think--using *context-rich, narrative notes*:

```markdown
### New LLM papers from ICLR 2025

- Transfusion `{ChuntingZhou2025ICLR}` Combines next-token prediction for text and diffusion-based learning for images in a single transformer. Bridges the modality gap without image quantization #🧠

- Embedding
    - `{AlexIacob2025ICLR}` Decouples embedding layers for robust multi-lingual training, improving generalization
    - `{ZiyueLi2025ICLR+}` Studies decoder-only embeddings and MoE layers. Weighted sum > concatenation
    - `{KihoPark2025ICLR}` Shows hierarchical concepts are orthogonally encoded in representations #🧠
```

With BibTeX Scholar, you can:

- Use nested bullets, tables, or flowcharts for relationships and comparisons 📊
- Summarize insights and connections in context 💡
- Manage citations seamlessly as you write and think ✍️
- **Grow your literature knowledge base organically 🪴**

> *See real examples of top AI conference notes at [liu-qilong.github.io/note](https://liu-qilong.github.io/note)*


## Core features 🚀

- **Add BibTeX anywhere**: Insert BibTeX code blocks in any note.
- **Cite anywhere**: Instantly cite papers via smart ``` `{ID}` ``` or ``` `[ID]` ``` inline formats with autocomplete
- **Rich citation popover**: Hover for title, authors, abstract & quick actions (open associated paper note, attach PDF, search mentions, copy BibTeX/LaTeX keys, etc.) — pin a card to keep it open across notes and drag it around, e.g. to compare two papers side by side
- **Global search/filter panel**: Browse your library in a discover (random sample) or list (sortable, virtualized) view, filter/search, and spot citekey/DOI collisions or references missing a PDF
- **Copy & export**: Copy BibTeX to the clipboard, or export it to a `.bib` file — for the whole library, one note, or a whole folder (everything it sources or cites)
- **PDF & notes management**: Attach PDFs and link notes to each entry

## Getting started ⚙️

### Installation

![img](/gallery/install.png)

- Install [Obsidian](https://obsidian.md/) and create your vault
- Go to Settings > Community plugins > Browse > Search for "BibTeX Scholar"
- Install and enable the plugin
- Start adding and managing BibTeX references as Markdown!

> If you'd like to install it manually:

- Clone this repository and place it under your Obsidian vault's `.obsidian/plugins` directory
- `npm install` to install dependencies
- `npm run dev` to compile the plugin
- Enable the plugin in Obsidian settings

### Fetch BibTeX entries

![img](/gallery/fetch-with-doi.png)

- Click the ![antenna](/gallery/antenna.jpeg) icon in the left ribbon
- Enter a DOI. Optionally add a custom ID suffix or abstract (For example, you can add conference names as suffixes)
- Fetches BibTeX from online sources, copies it to clipboard
- Paste the fetched BibTeX into your note (see next section)

![img](/gallery/fetch-manually.png)

You can switch to Manual mode to paste BibTeX code directly. Sometimes copying BibTeX from [DBLP](https://dblp.org/) and [Google Scholar](https://scholar.google.com/) is even more convenient than finding the DOI.

You can change the default mode in the plugin settings.

### Add BibTeX entries

![img](/gallery/bibtex-block.png)

Create a ```` ```bibtex ```` code block in any note. You can add multiple entries per block.

_P.S. If you use [live preview](https://help.obsidian.md/Live+preview+update) editing mode, you are not recommended to put too many entries in the same block. It may not render properly._

````markdown
```bibtex
@inproceedings{ChuntingZhou2025ICLR,
  title = {Transfusion{:} Predict the Next Token and Diffuse Images with One Multi-Modal Model},
  author = {Chunting Zhou and LILI YU and Arun Babu and Kushal Tirumala and Michihiro Yasunaga and Leonid Shamis and Jacob Kahn and Xuezhe Ma and Luke Zettlemoyer and Omer Levy},
  booktitle = {The Thirteenth International Conference on Learning Representations},
  year = {2025},
  url = {https://openreview.net/forum?id=SI2hI0frk6},
  abstract = {We introduce Transfusion, a recipe for training a multi-modal model over discrete and continuous data.Transfusion combines the language modeling loss function (next token prediction) with diffusion to train a single transformer over mixed-modality sequences.We pretrain multiple Transfusion models up to 7B parameters from scratch on a mixture of text and image data, establishing scaling laws with respect to a variety of uni- and cross-modal benchmarks.Our experiments show that Transfusion scales significantly better than quantizing images and training a language model over discrete image tokens.By introducing modality-specific encoding and decoding layers, we can further improve the performance of Transfusion models, and even compress each image to just 16 patches.We further demonstrate that scaling our Transfusion recipe to 7B parameters and 2T multi-modal tokens produces a model that can generate images and text on a par with similar scale diffusion models and language models, reaping the benefits of both worlds.},
}

@inproceedings{TianzhuYe2025ICLR,
  title = {Differential Transformer},
  author = {Tianzhu Ye and Li Dong and Yuqing Xia and Yutao Sun and Yi Zhu and Gao Huang and Furu Wei},
  booktitle = {The Thirteenth International Conference on Learning Representations},
  year = {2025},
  url = {https://openreview.net/forum?id=OvoCm1gGhN},
  abstract = {Transformer tends to overallocate attention to irrelevant context. In this work, we introduce Diff Transformer, which amplifies attention to the relevant context while canceling noise. Specifically, the differential attention mechanism calculates attention scores as the difference between two separate softmax attention maps. The subtraction cancels noise, promoting the emergence of sparse attention patterns. Experimental results on language modeling show that Diff Transformer outperforms Transformer in various settings of scaling up model size and training tokens. More intriguingly, it offers notable advantages in practical applications, such as long-context modeling, key information retrieval, hallucination mitigation, in-context learning, and reduction of activation outliers. By being less distracted by irrelevant context, Diff Transformer can mitigate hallucination in question answering and text summarization. For in-context learning, Diff Transformer not only enhances accuracy but is also more robust to order permutation, which was considered as a chronic robustness issue. The results position Diff Transformer as a highly effective and promising architecture for large language models.},
}
```
````

Edit the block to update entries. Reload the note if changes don’t display.

P.S. I've scraped all papers from some top AI conferences in [this repo](https://github.com/liu-qilong/top-ai-conf-scrape), with both `.bib` and `.md` formats. The `.md` files are fully compatible for this plugin. You can give it a try.

_P.S. I personally don't like to add all papers from those conferences, as each of them contains thoughts of papers. Usually, I only keep the Oral section for skimming them through._

### Inline citation

- Use `` `{ID}` `` for a compact, hoverable reference
- Use `` `[ID]` `` to open the details card when the cite is shown

![img](/gallery/bibtex-hover.png)

Citation details open in a **floating card** (not inline in the paragraph), so the note layout does not jump:

- **Hover** a chip for ~250 ms to open (or **click** the chip for immediate open / toggle)
- Move onto the card to keep it open; leave chip and card to close
- Press **Esc** to dismiss without losing focus for typing (stays dismissed until you leave the chip)
- Click **outside** the card to close
- Click the pin button beside × to **pin** the card: it stays open even if you switch notes, and you can **drag it** by its title bar. A pinned card only closes when you unpin it, click its ×, or press Esc (which closes the front-most pin first if several are open). Pins don't survive restarting Obsidian.

The bottom of the card always shows a short reminder of how to close it, so this isn't something you need to memorize.

The card has 3 groups of utilities:

- Copyable:
  - `id`: Copy paper's ID
  - `bibtex`: Copy paper's BibTeX source (omitting abstract)
  - ``` `{}` ```: Copy paper's ID in ``` `{ID}` ``` format (collapsed paper element)
  - ``` [] ```: Copy paper's ID in ``` [ID] ``` format (expanded paper element)
  - `\autocite{}`: Copy paper's ID in `\autocite{ID}` format (LaTeX citation)
- Related resources:
  - **note**: Create/open the paper's associated note (You can change the default folder to place your paper notes in the plugin's setting)
  - **pdf**: Attach PDF to the paper (You can change the default folder to place your PDFs in the plugin's setting)
  - **source**: Open the Obsidian note that contains the paper's source BibTeX code
  - **mentions**: Search all mentions of the paper, including the inline citations and the [Obsidian internal links](https://help.obsidian.md/links) to the associated paper notes
- **uncache**: Remove paper from cache
  - _P.S. The paper will be removed from the database. However, its source BibTeX code and all mentions won't be removed automatically_
  - **P.S. If you reopen the note containing the paper's BibTeX code, it will be re-added to the database**

#### Custom template for paper notes

The **note** button creates/opens the associated paper note. If you want, you can overwrite the default template for the paper note: plugin settings > *Custom note template path*. When filled, the plugin uses the template to create the next note in the folder specified as *Default paper note folder*.

You can also use [Templater](https://github.com/SilentVoid13/Templater) plugin for more advanced functionality and customizability. Please make sure that [Templater](https://github.com/SilentVoid13/Templater) plugin is installed and enabled, and the setting *Trigger Templater on new file creation* is enabled in the Templater plugin settings.

Example template: [paper-note-template.md](/gallery/paper-note-template.md)

### Copy & export BibTeX

When writing a LaTeX manuscript, it's very convenient to copy all BibTeX entries at once. Click the button ![img](/gallery/scroll-text.jpeg) on the left ribbon to copy your whole library to the clipboard, or open **Copy / export** from the paper panel's corner buttons (see [Paper panel](#paper-panel)) for the same clipboard actions plus writing a `.bib` file straight into your vault.

Right-click a note in the file explorer for per-file actions: copy it as standard markdown (cites become links) or with `\autocite{}`, or uncache just that note's entries. Right-click a **folder** to export a `.bib` file for everything sourced from or cited anywhere in that folder — including citations to papers whose BibTeX block actually lives elsewhere in the vault.

### Excluding a note from BibTeX

Add a `bibtex-ignore` property (checked/`true`) to a note's frontmatter to keep the plugin from ever reading it: its ```bibtex blocks are shown as plain text instead of being cached, and the note is skipped by rescans, citekey-rename scans, and folder export. Useful for templates or draft notes with example/dummy BibTeX you don't want polluting your library. If the note was already cached before you added the property, run **Recache from vault** (paper panel's cache-management corner button) once to drop its entries.

### Paper panel

You can click ![img](/gallery/scan-search.jpeg) on the left ribbon to open the paper panel to the right sidebar. From there, you can search and filter your papers easily:

- You can search with various queries separated with `;`: e.g. `John;2020`
- You can filter specific fields: e.g. `author:John;year:2020`

The switch at the top of the panel toggles between **Discover** (a random, re-rollable sample of your library — good for browsing) and **List** (every match, sortable A–Z or by **Most cited**, virtualized so it stays fast at any library size). Either view, hovering a citekey opens the same floating card described above.

You can open multiple paper panels and draw them to the place you want.

The compare-icon button in the panel recaches from the vault and lists citekey/DOI collisions.
Enabling **Missing PDF panel** in settings adds a second toggle beside it that lists cached
references with no matching PDF file — an occasional cleanup check, off by default.

Two more icons sit in the bottom-right corner of the panel: one opens **cache management** (recache, hard reset, or explicitly uncache the current file / the whole cache), the other opens **copy / export** (see [Copy & export BibTeX](#copy--export-bibtex) above).

## Future plan 🤖

AI-powered features and more workflow enhancements are on the way!

## Feedback & issues ❌

Please report bugs, suggest features, or ask questions on [GitHub Issues](https://github.com/liu-qilong/bibtex-scholar/issues).