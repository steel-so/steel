import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRegistry } from '../src/openapi/document'
import { generateOpenApiJson, OPENAPI_OUTPUT } from '../src/openapi/generate'
import {
  isCoveredBy,
  listRouteOperations,
} from '../src/openapi/route-inventory'
import { createV1Registry } from '../src/openapi/v1/document'
import {
  generateOpenApiV1Json,
  OPENAPI_V1_OUTPUT,
} from '../src/openapi/v1/generate'

/**
 * Gera `public/openapi.json` (API do app) e `public/openapi.v1.json` (API
 * pública v1, ADR 0035) a partir das registrações em `src/openapi/`.
 *
 *   pnpm openapi:generate           # reescreve os arquivos
 *   pnpm openapi:generate --check   # só compara (exit 1 se algum estiver desatualizado)
 *
 * Ver docs/api.md.
 */
const root = join(__dirname, '..')

function coverage(): string {
  const routes = listRouteOperations(root)
  const documented = [
    ...createRegistry().listOperations(),
    ...createV1Registry()
      .listOperations()
      .map((op) => op.replace(' ', ' /v1')),
  ]
  const covered = routes.filter((route) =>
    documented.some((op) => isCoveredBy(route, op)),
  ).length
  return `${covered}/${routes.length} operações de rota documentadas (${documented.length} operações nos specs)`
}

function read(target: string): string {
  try {
    return readFileSync(target, 'utf-8')
  } catch {
    return ''
  }
}

function main(): void {
  const outputs = [
    { file: OPENAPI_OUTPUT, next: generateOpenApiJson(root) },
    { file: OPENAPI_V1_OUTPUT, next: generateOpenApiV1Json(root) },
  ]
  const check = process.argv.includes('--check')
  let stale = false

  for (const { file, next } of outputs) {
    const target = join(root, file)
    const current = read(target)
    if (current === next) {
      console.log(`${file} em dia`)
      continue
    }
    if (check) {
      console.error(
        `${file} está desatualizado — rode \`pnpm openapi:generate\`.`,
      )
      stale = true
      continue
    }
    writeFileSync(target, next)
    console.log(`${file} gerado`)
  }

  console.log(coverage())
  if (stale) process.exit(1)
}

main()
