// Bundles the extension into dist/ (load it unpacked from there, or zip it).
// Runs on CI; the version comes from EXTENSION_VERSION (the release tag) or,
// failing that, from package.json.
import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'

const root = new URL('..', import.meta.url).pathname
const dist = `${root}dist`
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'))
const version = process.env.EXTENSION_VERSION ?? pkg.version
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`The extension version must be x.y.z, got "${version}"`)
}

rmSync(dist, { recursive: true, force: true })
mkdirSync(`${dist}/icons`, { recursive: true })

const common = {
  bundle: true,
  platform: 'browser',
  target: 'chrome116',
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
  outdir: dist,
}

// The service worker is an ES module (manifest: "type": "module").
await build({
  ...common,
  format: 'esm',
  entryPoints: { background: `${root}src/background.ts` },
})

// Content scripts and the side panel are classic scripts.
await build({
  ...common,
  format: 'iife',
  entryPoints: {
    sidepanel: `${root}src/sidepanel/panel.ts`,
    'content-whatsapp': `${root}src/content/whatsapp.ts`,
    'content-gmail': `${root}src/content/gmail.ts`,
    'content-linkedin': `${root}src/content/linkedin.ts`,
  },
})

cpSync(`${root}src/sidepanel/index.html`, `${dist}/sidepanel.html`)
cpSync(`${root}src/sidepanel/panel.css`, `${dist}/sidepanel.css`)

const manifest = JSON.parse(readFileSync(`${root}manifest.json`, 'utf8'))
manifest.version = version
writeFileSync(`${dist}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)

/* ---------------------------------- icons --------------------------------- */
// Placeholder artwork drawn here so the build needs no binary asset: a rounded
// dark square with three bars. The final icon is the owner's to supply for the
// store listing (see docs/browser-extension.md); replace extension/icons/ with
// PNGs of the same names and this step copies them instead.

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}

function icon(size) {
  const radius = size * 0.22
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4)
    for (let x = 0; x < size; x++) {
      const cx = Math.min(x + 0.5, size - x - 0.5)
      const cy = Math.min(y + 0.5, size - y - 0.5)
      const inCorner = cx < radius && cy < radius
      const inside = !inCorner || Math.hypot(radius - cx, radius - cy) <= radius
      const fy = (y + 0.5) / size
      const fx = (x + 0.5) / size
      const bar =
        fx > 0.25 &&
        fx < 0.75 &&
        [
          [0.26, 0.36],
          [0.45, 0.55],
          [0.64, 0.74],
        ].some(([a, b]) => fy > a && fy < b)
      const [r, g, b, a] = !inside ? [0, 0, 0, 0] : bar ? [236, 240, 250, 255] : [36, 59, 107, 255]
      row.set([r, g, b, a], 1 + x * 4)
    }
    rows.push(row)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of [16, 32, 48, 128]) {
  const supplied = `${root}icons/icon-${size}.png`
  if (existsSync(supplied)) cpSync(supplied, `${dist}/icons/icon-${size}.png`)
  else writeFileSync(`${dist}/icons/icon-${size}.png`, icon(size))
}

console.log(`Built the extension ${version} into ${dist}`)
