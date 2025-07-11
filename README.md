# BibTeX Scholar 🎓

This is a *BibTeX reference management tool* built **entirely on Obsidian**, designed to boost your paper reading & writing workflow. 

## Why you should try this? 🧐

When using traditional reference management tools, papers are added to folders. However, a list of titles **lacks context**:

- Which paper follows which?
- What's the development trajectories?
- How do different papers relate to each other?
- What are the key contributions of each paper?
- ...

When the number of papers grows, you may soon be clueless, especially after a while. Instead of organizing your papers into folders, a more effective approach is *nature language literature notes*, like this:

> ### New LLM papers from ICLR 2025
> 
> - Transfusion [ChuntingZhou2025ICLR](https://openreview.net/forum?id=SI2hI0frk6) combines _next-token prediction_ for text and _diffusion-based learning_ for images within a single transformer architecture, bridging the modality gap without quantizing images into discrete tokens #🧠 
> - Embedding
>	- [AlexIacob2025ICLR](https://openreview.net/forum?id=vf5aUZT0Fz) introduces a pre-training framework that decouples embedding layers from the transformer body, enabling robust training on heterogeneous data _(avoiding the curse of multi-linguality)_, improving generalization, and reducing memory footprint
>	- [ZiyueLi2025ICLR+](https://openreview.net/forum?id=eFGQ97z5Cd) investigates the limitation of using decoder-only models for embedding and finds that a good embedding can be acquired from the MoE layer, by combining routing weights (RW) and hidden states (HS)
>	  _They found that weighted sum of RW and HS outperforms concatenation, similar to Transformer's positional embedding_
>	- [KihoPark2025ICLR](https://openreview.net/forum?id=bVTM2QKYuA) extend the _linear representation hypothesis_ to general concepts and show that hierarchical relationships are encoded as orthogonality #🧠 
> 
> ...
>
> (I release top AI conferences paper reading notes in my homepage, all in this format. You can find them [here](https://liu-qilong.github.io/note))

That is, you can create a [Markdown](https://www.markdownguide.org) note for each research topic, and express relationship of the related papers relationship as you please:

- Nested bullet points to reflect paper relationships ✅
- Explain the major takeaways & insights in context ✅
- Tables for comparison ✅
- Flowcharts to represent research trajectories ✅
- ...

What ever you want. Streamlined, flexible, and powerful.

## Core features ⚙️

In this case, the only 2 core features of a **note-oriented** reference management tool include:

- Add BibTeX entry anywhere, like this:

![img](/gallery/bibtex-block.png)

- Cite it anywhere, like this:

![img](/gallery/bibtex-inline.png)

> Just type ` and { to trigger autocomplete if you want to search & cite a paper, in any Obsidian note.

Of course, we provide a bunch of other features to turbocharge your research workflow 🚀:

- Hover on citations to see paper details (title, authors, abstract, etc.)
  - Button to create/open a paper's note
  - Button to attach PDF to a paper
  - Button to search all mentions of a paper
- When you are writing LaTeX manuscript
  - Copy BibTeX ID or `\autocite{<ID>}`
  - Copy one or all BibTeX source code
- A paper panel for search/filter papers from all BibTeX entries
- ...

## Usage 🔧

Install and enable this plugin. Then you can start adding and managing your BibTeX references seamlessly within your Obsidian notes.

### Fetch BibTeX online ![img](/gallery/antenna.png)

Click the button ![img](/gallery/antenna.png) on the left ribbon. You can fill in the ID suffix (optional), abstract (optional), and DOI. It will fetch the BibTeX entry from online sources and push to the clipboard. You can then add it to your note (see the next section).

![img](/gallery/fetch-with-doi.png)

- ID suffix is string that will be added to the end of the paper's ID. I usually add the conferences or journals' abbreviation. You can leave it blank as well.
- If there is duplicated paper ID, `+` will be added to the end to make sure every paper has a unique ID.
- The abstract field is also optional. If you add it, it will be shown in the paper details when hovering.

You can change the Mode dropdown manual from `DOI` to `Manual` to enter the BibTeX entry manually:

![img](/gallery/fetch-manually.png)

This is useful if you'd like to search the paper from [dblp](https://dblp.uni-trier.de) or [Google Scholar](https://scholar.google.com) and copy the BibTeX directly. In some cases, this is actually more convenient than finding the papers' DOI.

### Adding BibTeX entries

To add a new BibTeX entry, simply create a `bibtex` code block in your note with the following format:

![img](/gallery/bibtex-block.png)

You can add multiple BibTeX entries in one `bibtex` code block as you please.

_P.S. To edit the added BibTeX entry, just edit the code block and rerender the note. If it doesn't change, reload the Obsidian_

BTW, in [Top AI conferences scraping](https://github.com/liu-qilong/top-ai-conf-scrape), I've scraped all papers from some top AI conferences, in both `.bib` and `.md` formats. The `.md` files are fully compatible for this plugin. You can give it a try.

_P.S. I personally don't like to add all papers from those conferences, as each of them contains thoughts of papers. Usually, I only keep the Oral section for skimming them through._

### Cite a paper

The inline-citation format is:

- Collapsed paper element \`{ID}\`: Only shows a button with paper ID. Hover to show paper details and utilities.
- Expanded paper element \`[ID]\`: Shows full paper details and utilities without hover.

![img](/gallery/bibtex-hover.png)

As you can see here, following the title are the utility buttons and paper details. There are 3 groups of utilities:

- Copyable:
  - id: Copy paper's ID
  - bibtex: Copy paper's BibTeX source (omitting abstract)
  - \`{}\`: Copy paper's ID in \`{}\` format (collapsed paper element)
  - \`[]\`: Copy paper's ID in \`[]\` format (expanded paper element)
  - \autocite{}: Copy paper's ID in \autocite{} format (LaTeX citation)
- Related resources:
  - note: Create/open the paper's associated note (You can change the default folder to place your paper notes in the plugin's setting)
  - pdf: Attach PDF to the paper (You can change the default folder to place your PDFs in the plugin's setting)
  - source: Open the Obsidian note that contains the paper's source BibTeX code
  - mentions: Search all mentions of the paper
- uncache: Remove paper from cache
  - _P.S. The paper will be removed from the database. However, its source BibTeX code and all mentions won't be removed automatically._
  - **P.S. If you reopen the note containing the paper's BibTeX code, it will be re-added to the database.**

### Copy all BibTeX ![img](/gallery/scroll-text.png)

When writing LaTeX manuscript, it's very convenient to copy all BibTeX entries at once and place it to your `.bib` file. Just click the button ![img](/gallery/scroll-text.png) on the left ribbon.

### Paper panel ![img](/gallery/scan-search.png)

You can click ![img](/gallery/scan-search.png) on the left ribbon to open the paper panel to the right sidebar. From there, you can search and filter your papers easily:

- You can search with various queries separated with `;`: e.g. `John;2020`
- You can filter specific fields: e.g. `author:John;year:2020`

You can open multiple paper panels and draw them to the place you want.

## Future plan

Adding AI features to this plugin seems promising. Coming soon...