/** The studio is laid out at a fixed design size and scaled to fit the window. */
export const STAGE_WIDTH = 1100
export const STAGE_HEIGHT = 756

export function stageScale(): number {
	return Math.min(innerWidth / STAGE_WIDTH, innerHeight / STAGE_HEIGHT)
}
