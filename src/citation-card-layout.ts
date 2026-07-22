/**
 * Pure floating-card placement math for the citation popup.
 * No DOM/React imports — unit-testable with plain rect objects.
 */

/** Anything shaped like a DOMRect (real getBoundingClientRect() results included). */
export type Rect = {
	top: number
	left: number
	width: number
	height: number
	bottom: number
	right: number
}

export type Viewport = { width: number, height: number }

/** Where the card sits relative to the anchor chip. */
export type CardPlacement = 'below' | 'above'

/** Gap between chip and floating card (px). */
export const CARD_GAP_PX = 4
/** Viewport edge padding when clamping (px). */
export const VIEWPORT_PAD_PX = 8

/**
 * Prefer placing the card below the anchor; flip above only when there is not
 * enough room below **and** there is more room above than below.
 */
export function compute_card_placement(
	anchor: Rect,
	card: Rect,
	viewport: Viewport,
	gap: number = CARD_GAP_PX,
	pad: number = VIEWPORT_PAD_PX,
): CardPlacement {
	const space_below = viewport.height - anchor.bottom - pad
	const space_above = anchor.top - pad
	const prefer_above = space_below < card.height + gap && space_above > space_below
	return prefer_above ? 'above' : 'below'
}

/** Fixed-position top/left for the card, clamped so it stays inside the viewport. */
export function compute_card_position(
	anchor: Rect,
	card: Rect,
	viewport: Viewport,
	placement: CardPlacement,
	gap: number = CARD_GAP_PX,
	pad: number = VIEWPORT_PAD_PX,
): { top: number, left: number } {
	const raw_top = placement === 'above'
		? anchor.top - card.height - gap
		: anchor.bottom + gap

	const left = Math.max(pad, Math.min(anchor.left, viewport.width - card.width - pad))
	const top = Math.max(pad, Math.min(raw_top, viewport.height - card.height - pad))

	return { top: Math.round(top), left: Math.round(left) }
}

/** Clamp an arbitrary (e.g. dragged) card position so it stays inside the viewport. */
export function clamp_card_position(
	pos: { top: number, left: number },
	size: { width: number, height: number },
	viewport: Viewport,
	pad: number = VIEWPORT_PAD_PX,
): { top: number, left: number } {
	const left = Math.max(pad, Math.min(pos.left, viewport.width - size.width - pad))
	const top = Math.max(pad, Math.min(pos.top, viewport.height - size.height - pad))
	return { top: Math.round(top), left: Math.round(left) }
}
