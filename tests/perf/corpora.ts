/**
 * Corpora for scale experiments: synthetic (always) + public-seed expansions.
 *
 * Public seeds are real bibliographic metadata (titles/authors/years/venues)
 * from well-known open scholarly records — used only as *templates* and then
 * expanded with unique citekeys so we can hit 1k–10k without shipping a giant
 * fixture or depending on live network in CI.
 */

import type { BibtexDict, BibtexElement } from 'src/bibtex'

/** Real-ish paper templates (public scholarly metadata; not copyrighted abstracts). */
export const PUBLIC_PAPER_SEEDS: ReadonlyArray<{
	title: string
	author: string
	year: string
	venue: string
	/** Short public abstract-like blurb (ASCII) — sized to stress free-text cost. */
	abstract_stub: string
}> = [
	{
		title: 'Attention Is All You Need',
		author: 'Vaswani, Ashish and Shazeer, Noam and Parmar, Niki',
		year: '2017',
		venue: 'NeurIPS',
		abstract_stub:
			'We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. ',
	},
	{
		title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
		author: 'Devlin, Jacob and Chang, Ming-Wei and Lee, Kenton and Toutanova, Kristina',
		year: '2019',
		venue: 'NAACL',
		abstract_stub:
			'We introduce a new language representation model called BERT, which stands for Bidirectional Encoder Representations from Transformers. ',
	},
	{
		title: 'Deep Residual Learning for Image Recognition',
		author: 'He, Kaiming and Zhang, Xiangyu and Ren, Shaoqing and Sun, Jian',
		year: '2016',
		venue: 'CVPR',
		abstract_stub:
			'Deeper neural networks are more difficult to train. We present a residual learning framework to ease the training of networks that are substantially deeper than those used previously. ',
	},
	{
		title: 'Generative Adversarial Nets',
		author: 'Goodfellow, Ian and Pouget-Abadie, Jean and Mirza, Mehdi',
		year: '2014',
		venue: 'NeurIPS',
		abstract_stub:
			'We propose a new framework for estimating generative models via an adversarial process, in which we simultaneously train two models. ',
	},
	{
		title: 'Adam: A Method for Stochastic Optimization',
		author: 'Kingma, Diederik P. and Ba, Jimmy',
		year: '2015',
		venue: 'ICLR',
		abstract_stub:
			'We introduce Adam, an algorithm for first-order gradient-based optimization of stochastic objective functions, based on adaptive estimates of lower-order moments. ',
	},
	{
		title: 'Dropout: A Simple Way to Prevent Neural Networks from Overfitting',
		author: 'Srivastava, Nitish and Hinton, Geoffrey and Krizhevsky, Alex',
		year: '2014',
		venue: 'JMLR',
		abstract_stub:
			'Deep neural nets with a large number of parameters are very powerful machine learning systems. However, overfitting is a serious problem in such networks. ',
	},
	{
		title: 'ImageNet Classification with Deep Convolutional Neural Networks',
		author: 'Krizhevsky, Alex and Sutskever, Ilya and Hinton, Geoffrey E.',
		year: '2012',
		venue: 'NeurIPS',
		abstract_stub:
			'We trained a large, deep convolutional neural network to classify the 1.2 million high-resolution images in the ImageNet LSVRC-2010 contest into the 1000 different classes. ',
	},
	{
		title: 'Long Short-Term Memory',
		author: 'Hochreiter, Sepp and Schmidhuber, J{\\"u}rgen',
		year: '1997',
		venue: 'Neural Computation',
		abstract_stub:
			'Learning to store information over extended time intervals by recurrent backpropagation takes a very long time, mostly because of insufficient, decaying error backflow. ',
	},
]

/** Inflate abstract_stub to ~`target_chars` so free-text cost is realistic. */
function pad_abstract(stub: string, target_chars: number): string {
	if (stub.length >= target_chars) return stub.slice(0, target_chars)
	const reps = Math.ceil(target_chars / stub.length)
	return stub.repeat(reps).slice(0, target_chars)
}

export type CorpusOptions = {
	/** Number of entries. */
	n: number
	/** Abstract length in characters (upstream free-text scans these every keystroke). */
	abstract_chars?: number
	/** Fraction of entries that share a DOI prefix pattern for clash experiments. */
	doi_collision_every?: number
}

/**
 * Build a library of `n` entries by cycling public seeds with unique citekeys.
 * Titles keep TeX-ish accents where seeds have them so normalize/search paths run.
 */
export function build_public_seed_dict(opts: CorpusOptions): BibtexDict {
	const n = opts.n
	const abstract_chars = opts.abstract_chars ?? 1800
	const doi_every = opts.doi_collision_every ?? 0
	const dict: BibtexDict = {}

	for (let i = 0; i < n; i++) {
		const seed = PUBLIC_PAPER_SEEDS[i % PUBLIC_PAPER_SEEDS.length]!
		const id = `Pub${String(i).padStart(5, '0')}${seed.year}`
		const path = `notes/lit/${id}.md`
		// Occasional shared DOI → realistic clash surface for index vs linear.
		const doi =
			doi_every > 0 && i % doi_every === 0
				? `10.5555/shared-${Math.floor(i / doi_every)}`
				: `10.5555/${id.toLowerCase()}`

		const entry: BibtexElement = {
			fields: {
				type: 'inproceedings',
				id,
				title: `${seed.title} (${i})`,
				author: seed.author,
				year: seed.year,
				booktitle: seed.venue,
				doi,
				// Long abstract stresses upstream "search all fields" path.
				abstract: pad_abstract(seed.abstract_stub, abstract_chars),
				url: `https://doi.org/${doi}`,
			},
			source: `@inproceedings{${id},\n  title={${seed.title}},\n  author={${seed.author}},\n  year={${seed.year}},\n}\n`,
			source_path: path,
		}
		dict[id] = entry
	}
	return dict
}

/**
 * Mock vault: one markdown file per entry with a ```bibtex fence + a few inline cites.
 * Used for Obsidian-coupled scan experiments (injected reader, no Electron).
 */
export function build_mock_vault_files(
	dict: BibtexDict,
): Map<string, string> {
	const files = new Map<string, string>()
	const ids = Object.keys(dict)
	for (let i = 0; i < ids.length; i++) {
		const id = ids[i]!
		const e = dict[id]!
		const neighbor = ids[(i + 1) % ids.length]!
		const body =
			`# ${e.fields.title}\n\n` +
			`See also \`${'{'}${neighbor}${'}'}\` and \`[${id}]\`.\n\n` +
			'```bibtex\n' +
			e.source +
			'```\n'
		files.set(e.source_path, body)
	}
	return files
}

/** Subset of paths that "changed" for incremental-rescan experiments. */
export function changed_path_set(
	paths: string[],
	fraction: number,
): Set<string> {
	const n = Math.max(1, Math.floor(paths.length * fraction))
	return new Set(paths.slice(0, n))
}
