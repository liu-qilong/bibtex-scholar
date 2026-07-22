import { describe, expect, it } from 'vitest'
import {
	CARD_GAP_PX,
	VIEWPORT_PAD_PX,
	clamp_card_position,
	compute_card_placement,
	compute_card_position,
	type Rect,
} from 'src/citation-card-layout'

const VIEWPORT = { width: 1000, height: 800 }

function rect(partial: Partial<Rect> & { top: number, left: number, width: number, height: number }): Rect {
	return {
		...partial,
		right: partial.left + partial.width,
		bottom: partial.top + partial.height,
	}
}

describe('compute_card_placement', () => {
	it('prefers below when there is enough room', () => {
		const anchor = rect({ top: 100, left: 50, width: 40, height: 20 })
		const card = rect({ top: 0, left: 0, width: 300, height: 200 })
		expect(compute_card_placement(anchor, card, VIEWPORT)).toBe('below')
	})

	it('flips above when there is not enough room below and more room above', () => {
		// Anchor near the bottom of an 800px-tall viewport, tall card.
		const anchor = rect({ top: 760, left: 50, width: 40, height: 20 })
		const card = rect({ top: 0, left: 0, width: 300, height: 400 })
		expect(compute_card_placement(anchor, card, VIEWPORT)).toBe('above')
	})

	it('stays below on an exact tie between above/below room, even if neither fully fits', () => {
		// space_above === space_below here; ties favor below (strictly-greater check above).
		const anchor = rect({ top: 390, left: 50, width: 40, height: 20 })
		const card = rect({ top: 0, left: 0, width: 300, height: 380 })
		expect(compute_card_placement(anchor, card, VIEWPORT)).toBe('below')
	})
})

describe('compute_card_position', () => {
	it('places the card gap-px below the anchor, left-aligned to it', () => {
		const anchor = rect({ top: 100, left: 50, width: 40, height: 20 })
		const card = rect({ top: 0, left: 0, width: 300, height: 200 })
		const { top, left } = compute_card_position(anchor, card, VIEWPORT, 'below')
		expect(top).toBe(anchor.bottom + CARD_GAP_PX)
		expect(left).toBe(anchor.left)
	})

	it('places the card gap-px above the anchor when flipped', () => {
		const anchor = rect({ top: 760, left: 50, width: 40, height: 20 })
		const card = rect({ top: 0, left: 0, width: 300, height: 400 })
		const { top } = compute_card_position(anchor, card, VIEWPORT, 'above')
		expect(top).toBe(anchor.top - card.height - CARD_GAP_PX)
	})

	it('clamps left so the card never crosses the right viewport edge', () => {
		const anchor = rect({ top: 100, left: 950, width: 40, height: 20 })
		const card = rect({ top: 0, left: 0, width: 300, height: 200 })
		const { left } = compute_card_position(anchor, card, VIEWPORT, 'below')
		expect(left).toBe(VIEWPORT.width - card.width - VIEWPORT_PAD_PX)
	})

	it('clamps top so the card never crosses the top viewport edge when flipped', () => {
		const anchor = rect({ top: 50, left: 50, width: 40, height: 20 })
		const card = rect({ top: 0, left: 0, width: 300, height: 400 })
		const { top } = compute_card_position(anchor, card, VIEWPORT, 'above')
		expect(top).toBe(VIEWPORT_PAD_PX)
	})

	it('clamps left at the left viewport edge', () => {
		const anchor = rect({ top: 100, left: -20, width: 40, height: 20 })
		const card = rect({ top: 0, left: 0, width: 300, height: 200 })
		const { left } = compute_card_position(anchor, card, VIEWPORT, 'below')
		expect(left).toBe(VIEWPORT_PAD_PX)
	})
})

describe('clamp_card_position (dragging a pinned card)', () => {
	const size = { width: 300, height: 200 }

	it('leaves a position already inside bounds unchanged', () => {
		expect(clamp_card_position({ top: 100, left: 100 }, size, VIEWPORT)).toEqual({ top: 100, left: 100 })
	})

	it('clamps off the left/top edges to the pad', () => {
		expect(clamp_card_position({ top: -50, left: -50 }, size, VIEWPORT)).toEqual({
			top: VIEWPORT_PAD_PX,
			left: VIEWPORT_PAD_PX,
		})
	})

	it('clamps off the right/bottom edges to viewport - size - pad', () => {
		expect(clamp_card_position({ top: 5000, left: 5000 }, size, VIEWPORT)).toEqual({
			top: VIEWPORT.height - size.height - VIEWPORT_PAD_PX,
			left: VIEWPORT.width - size.width - VIEWPORT_PAD_PX,
		})
	})
})
