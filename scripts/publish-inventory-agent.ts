/**
 * Publica os binários do agente de inventário para a atualização automática.
 *
 *   pnpm inventory-agent:publish <versão> <pasta-com-os-binários>
 *
 * A pasta é a do artefato `steel-inventory-agent` do CI (arquivos
 * `steel-inventory-agent-<os>-<arch>[.exe]` + `SHA256SUMS`). Cada binário vai
 * para o bucket privado e vira uma versão consultável pelos agentes.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SdInventoryAgentUpdateService } from '@/src/services/sd-inventory-agent-update.service'

const FILE =
  /^steel-inventory-agent-(linux|windows|darwin)-(amd64|arm64|386|arm)(\.exe)?$/

async function main() {
  const [version, dir] = process.argv.slice(2)
  if (!version || !dir) {
    console.error('Uso: pnpm inventory-agent:publish <versão> <pasta>')
    process.exit(1)
  }

  let published = 0
  for (const name of (await readdir(dir)).sort()) {
    const match = FILE.exec(name)
    if (!match) continue
    const result = await SdInventoryAgentUpdateService.publish({
      version,
      os: match[1] as 'linux' | 'windows' | 'darwin',
      arch: match[2] as 'amd64' | 'arm64' | '386' | 'arm',
      binary: await readFile(join(dir, name)),
    })
    if (!result.ok) {
      console.error(`${name}: ${result.error.message}`)
      process.exit(1)
    }
    console.log(`${name} -> ${version} sha256=${result.value.sha256}`)
    published++
  }
  if (published === 0) {
    console.error('Nenhum binário do agente encontrado na pasta')
    process.exit(1)
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  },
)
