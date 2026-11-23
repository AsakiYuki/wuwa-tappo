const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

/*
 * `npm run assets:thumbnails`: shrinks the catalog's thumbnails (assets/<type>/<id>/thumbnail.png)
 * to SIZE×SIZE palette PNGs. They are shown at most ~120 CSS px (atlas cards, chests, presets), but
 * were downloaded at 560×560, and a WebView keeps every image it showed decoded at full size: the
 * studio's atlas alone held hundreds of MB. Already small thumbnails are skipped, so re-run it after
 * adding items. Needs ImageMagick (`magick`) and pngquant (on Nix: `nix-shell -p imagemagick pngquant`).
 */

const SIZE = 256
const projectRoot = path.resolve(__dirname, "..")
const ASSET_DIRS = ["characters", "accessories", "emotes"]

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file) {
	const header = Buffer.alloc(24)
	const fd = fs.openSync(file, "r")
	try {
		fs.readSync(fd, header, 0, 24, 0)
	} finally {
		fs.closeSync(fd)
	}
	return [header.readUInt32BE(16), header.readUInt32BE(20)]
}

const thumbnails = ASSET_DIRS.flatMap(dir =>
	fs
		.readdirSync(path.join(projectRoot, "assets", dir))
		.map(id => path.join(projectRoot, "assets", dir, id, "thumbnail.png"))
		.filter(file => fs.existsSync(file)),
)
const large = thumbnails.filter(file => Math.max(...pngSize(file)) > SIZE)
console.log(`${large.length} of ${thumbnails.length} thumbnails are larger than ${SIZE}px`)

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "wuwa-thumbnails-"))
try {
	for (const [index, file] of large.entries()) {
		const resized = path.join(scratch, "resized.png")
		execFileSync("magick", [file, "-filter", "Lanczos", "-resize", `${SIZE}x${SIZE}`, "-strip", resized])
		try {
			execFileSync("pngquant", [
				"--quality",
				"85-100",
				"--speed",
				"1",
				"--strip",
				"--force",
				"--output",
				file,
				resized,
			])
		} catch (error) {
			// 98/99: a palette would not reach the quality floor; keep the full-colour resize.
			if (error.status !== 98 && error.status !== 99) throw error
			fs.copyFileSync(resized, file)
		}
		if ((index + 1) % 100 === 0) console.log(`${index + 1}/${large.length}`)
	}
} finally {
	fs.rmSync(scratch, { recursive: true, force: true })
}
console.log("Done")
