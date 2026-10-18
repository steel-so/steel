import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { findBreakingChanges } from '../src/openapi/v1/compat'
import {
  generateOpenApiV1Json,
  OPENAPI_V1_OUTPUT,
} from '../src/openapi/v1/generate'

/**
 * Fails when the public API v1 (ADR 0035) changed incompatibly since a base
 * revision: compares `public/openapi.v1.json` as committed at `--base`
 * with the document the current code generates.
 *
 *   pnpm openapi:v1:compat                       # base = origin/main
 *   pnpm openapi:v1:compat --base <git-ref|sha>  # CI: the PR base or the previous push
 *
 * No v1 document at the base (first version) passes. Run in CI by the
 * "Lint & Type Check" job. A deliberate break needs a new version
 * (`/api/v2`), never an edit of v1.
 */
const root = join(__dirname, '..')

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function readAtBase(ref: string): string | null {
  try {
    return execFileSync('git', ['show', `${ref}:${OPENAPI_V1_OUTPUT}`], {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}

function main(): void {
  const base = argument('--base') ?? 'origin/main'
  const previous = readAtBase(base)
  if (previous === null) {
    console.log(
      `${OPENAPI_V1_OUTPUT} não existe em ${base}: primeira versão, nada a comparar.`,
    )
    return
  }

  const breaking = findBreakingChanges(
    JSON.parse(previous),
    JSON.parse(generateOpenApiV1Json(root)),
  )
  if (breaking.length === 0) {
    console.log(`API v1 compatível com ${base}.`)
    return
  }

  console.error(
    `API v1: ${breaking.length} mudança(s) incompatível(is) desde ${base} (ADR 0035):`,
  )
  for (const change of breaking) console.error(`  - ${change}`)
  console.error(
    'Campos e rotas só podem ser acrescentados na v1. Para remover, deprecie (Deprecation/Sunset por 6 meses) ou crie a v2.',
  )
  process.exit(1)
}

main()
