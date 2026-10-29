// Loads the built bundle the way n8n does (require) and fails when anything
// but n8n-workflow or a Node built-in is left to resolve at runtime.
const { readdirSync, readFileSync, statSync } = require('node:fs')
const { builtinModules } = require('node:module')
const { join, resolve } = require('node:path')

const dist = resolve(__dirname, '..', 'dist')

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else if (path.endsWith('.js')) yield path
  }
}

const unexpected = new Set()
for (const file of files(dist)) {
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(/\brequire\("([^"]+)"\)/g)) {
    const name = match[1].replace(/^node:/, '')
    if (name !== 'n8n-workflow' && !builtinModules.includes(name)) {
      unexpected.add(name)
    }
  }
}
if (unexpected.size > 0) {
  throw new Error(`runtime dependencies left: ${[...unexpected].join(', ')}`)
}

const { Steel } = require(join(dist, 'nodes/Steel/Steel.node.js'))
const { SteelTrigger } = require(
  join(dist, 'nodes/SteelTrigger/SteelTrigger.node.js'),
)
const { SteelApi } = require(join(dist, 'credentials/SteelApi.credentials.js'))
const names = [
  new Steel().description.name,
  new SteelTrigger().description.name,
  new SteelApi().name,
].join()
if (names !== 'steel,steelTrigger,steelApi') {
  throw new Error(`unexpected names: ${names}`)
}
console.log(`bundle ok: ${names}`)
