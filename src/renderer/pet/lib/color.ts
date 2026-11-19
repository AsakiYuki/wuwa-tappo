function parseHex(color: string): [number, number, number] | null {
	const channels = color
		.slice(1)
		.match(/.{2}/g)
		?.map(value => Number.parseInt(value, 16) / 255)
	return channels?.length === 3 ? (channels as [number, number, number]) : null
}

function luminance(color: string): number {
	const channels = parseHex(color)
	if (!channels) return 1
	const [red, green, blue] = channels.map(value =>
		value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
	)
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/** Keeps the hue and saturation of `color` but replaces its HSL lightness. */
function withLightness(color: string, lightness: number): string {
	const channels = parseHex(color)
	if (!channels) return color
	const [red, green, blue] = channels
	const maximum = Math.max(red, green, blue)
	const minimum = Math.min(red, green, blue)
	const delta = maximum - minimum
	let hue = 0
	if (delta) {
		if (maximum === red) hue = ((green - blue) / delta) % 6
		else if (maximum === green) hue = (blue - red) / delta + 2
		else hue = (red - green) / delta + 4
		hue = (hue * 60 + 360) % 360
	}
	const sourceLightness = (maximum + minimum) / 2
	const saturation = delta ? delta / (1 - Math.abs(2 * sourceLightness - 1)) : 0
	const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
	const section = hue / 60
	const secondary = chroma * (1 - Math.abs((section % 2) - 1))
	const sectors: Array<[number, number, number]> = [
		[chroma, secondary, 0],
		[secondary, chroma, 0],
		[0, chroma, secondary],
		[0, secondary, chroma],
		[secondary, 0, chroma],
		[chroma, 0, secondary],
	]
	const offset = lightness - chroma / 2
	return (
		"#" +
		sectors[Math.min(5, Math.floor(section))]
			.map(value =>
				Math.max(0, Math.min(255, Math.round((value + offset) * 255)))
					.toString(16)
					.padStart(2, "0"),
			)
			.join("")
	)
}

/** Picks the same-hue shade with the highest contrast against the bubble background. */
export function bubbleTextColor(background: string): string {
	const backgroundLuminance = luminance(background)
	const contrast = (foreground: string) => {
		const foregroundLuminance = luminance(foreground)
		return (
			(Math.max(backgroundLuminance, foregroundLuminance) + 0.05) /
			(Math.min(backgroundLuminance, foregroundLuminance) + 0.05)
		)
	}
	let bestColor = background
	let bestContrast = 0
	for (let index = 0; index <= 20; index++) {
		const candidate = withLightness(background, 0.1 + index * 0.04)
		const candidateContrast = contrast(candidate)
		if (candidateContrast > bestContrast) {
			bestColor = candidate
			bestContrast = candidateContrast
		}
	}
	return bestColor
}
