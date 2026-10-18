import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { calVerToSemver, isCalVerTag } from '../lib/version'

/**
 * Alinha `package.json` (`version`) e `public/openapi.json` + `public/openapi.v1.json` (`info.version`)
 * à tag CalVer informada — ou, sem argumento, à última tag do repositório.
 *
 *   pnpm version:sync              # usa `git describe --tags --abbrev=0`
 *   pnpm version:sync 2026.09.18   # tag explícita
 *
 * Só reescreve o campo de versão; o resto dos arquivos fica intacto.
 */
const root = join(__dirname, '..')

function latestTag(): string {
  return execFileSync('git', ['describe', '--tags', '--abbrev=0'], {
    cwd: root,
    encoding: 'utf-8',
  }).trim()
}

function replaceVersionField(
  path: string,
  pattern: RegExp,
  version: string,
): void {
  const source = readFileSync(path, 'utf-8')
  if (!pattern.test(source)) throw new Error(`version field not found: ${path}`)
  writeFileSync(path, source.replace(pattern, `$1"${version}"`))
}

function main(): void {
  const tag = process.argv[2] ?? latestTag()
  if (!isCalVerTag(tag)) {
    throw new Error(`"${tag}" não é uma tag CalVer (YYYY.MM.DD[.N]).`)
  }

  const semver = calVerToSemver(tag)
  replaceVersionField(
    join(root, 'package.json'),
    /^(\s{2}"version":\s*)"[^"]*"/m,
    semver,
  )
  // Primeiro "version" do arquivo é o de `info` (logo após "openapi").
  replaceVersionField(
    join(root, 'public/openapi.json'),
    /("info":\s*\{[^}]*?"version":\s*)"[^"]*"/,
    tag,
  )
  replaceVersionField(
    join(root, 'public/openapi.v1.json'),
    /("info":\s*\{[^}]*?"version":\s*)"[^"]*"/,
    tag,
  )

  console.log(`package.json → ${semver} | openapi info.version → ${tag}`)
}

main()
