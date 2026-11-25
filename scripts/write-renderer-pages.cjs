const fs = require("node:fs")
const path = require("node:path")

const outputDirectory = path.resolve(__dirname, "../renderer-build")
const securityPolicy = [
	"default-src 'self'",
	"img-src 'self' data:",
	"style-src 'self' 'unsafe-inline'",
	"script-src 'self'",
	// Tauri's IPC goes through its own origins.
	"connect-src ipc: http://ipc.localhost",
].join("; ")

const TITLES = { pet: "Desktop Pet", studio: "Studio & Collection", room: "Room Pets" }

for (const page of Object.keys(TITLES)) {
	const title = TITLES[page]
	const document = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${securityPolicy}">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Wuwa Tappo · ${title}</title>
    <link rel="stylesheet" href="./assets/style.css">
  </head>
  <body class="locale-en">
    <div id="root"></div>
    <script type="module" src="./assets/${page}.js"></script>
  </body>
</html>
`
	fs.writeFileSync(path.join(outputDirectory, `${page}.html`), document)
}
