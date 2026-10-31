// Fails when dist/ is not a loadable extension: every file the manifest names
// must exist, the version must be valid and nothing unexpected may ship.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'

const dist = new URL('../dist/', import.meta.url).pathname
const manifest = JSON.parse(readFileSync(`${dist}manifest.json`, 'utf8'))
const problems = []

const referenced = new Set([
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
  ...(manifest.content_scripts ?? []).flatMap((script) => script.js ?? []),
])
for (const file of referenced) {
  if (!file || !existsSync(`${dist}${file}`)) problems.push(`missing file: ${file}`)
}

if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3')
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) problems.push(`bad version: ${manifest.version}`)
if (manifest.host_permissions?.length) {
  problems.push('host_permissions must stay empty: hosts are requested at runtime')
}

const html = readFileSync(`${dist}sidepanel.html`, 'utf8')
for (const asset of ['sidepanel.js', 'sidepanel.css']) {
  if (!html.includes(asset)) problems.push(`sidepanel.html does not load ${asset}`)
}

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = `${dir}${name}`
    if (statSync(path).isDirectory()) walk(`${path}/`)
    else files.push(path.slice(dist.length))
  }
}
walk(dist)
for (const file of files) {
  if (file.endsWith('.map')) problems.push(`source map in the package: ${file}`)
}
for (const file of files.filter((name) => name.endsWith('.js'))) {
  if (/\beval\(|new Function\(/.test(readFileSync(`${dist}${file}`, 'utf8'))) {
    problems.push(`${file} uses eval or new Function (blocked by the extension CSP)`)
  }
}

if (problems.length > 0) {
  console.error(problems.map((problem) => `- ${problem}`).join('\n'))
  process.exit(1)
}
console.log(`Package ok: ${files.length} files, version ${manifest.version}`)
