import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/env/env', () => ({ NEXT_PUBLIC_URL: 'https://steel.test' }))

import {
  buildLlmsFullTxt,
  buildLlmsTxt,
  devPageMarkdown,
} from '@/src/lib/seo/llms'
import type { ChangelogEntryDTO } from '@/types/changelog-entry'

const ENTRY: ChangelogEntryDTO = {
  slug: 'busca-global',
  title: 'Busca global',
  date: '2026-10-08T00:00:00.000Z',
  summary: 'Uma busca que atravessa os três módulos.',
  tags: ['PLATAFORMA'],
  version: null,
  cover: null,
  source: '## Como usar',
  headings: [],
}

const GUIDE = {
  section: 'fundamentos' as const,
  slug: 'respostas-e-erros',
  href: '/dev/respostas-e-erros',
  title: 'Formato de resposta e erros',
  description: 'O envelope e os códigos de erro.',
  order: 2,
  source:
    '## O envelope\n\nBase: <BaseUrl />.\n\n## Códigos de erro\n\n<ErrorCodeTable />',
  headings: [],
}

describe('llms files with the developer guides', () => {
  it('lists the guides, the landing and the reference in llms.txt', () => {
    const txt = buildLlmsTxt([ENTRY], [], [GUIDE])
    expect(txt).toContain('## Desenvolvedores (guias da API)')
    expect(txt).toContain('- [Visão geral](https://steel.test/dev)')
    expect(txt).toContain(
      '- [Fundamentos: Formato de resposta e erros](https://steel.test/dev/respostas-e-erros): O envelope e os códigos de erro.',
    )
    expect(txt).toContain('[OpenAPI](https://steel.test/dev/api/openapi.json)')
    expect(txt.indexOf('## Desenvolvedores')).toBeLessThan(
      txt.indexOf('## Changelog recente'),
    )
  })

  it('leaves the developer block out when there are no guides', () => {
    expect(buildLlmsTxt([ENTRY])).not.toContain('guias da API')
    expect(buildLlmsFullTxt([ENTRY])).not.toContain('# Desenvolvedores')
  })

  it('inlines every guide in llms-full.txt, with the error table as markdown', () => {
    const txt = buildLlmsFullTxt([ENTRY], [], [GUIDE])
    expect(txt).toContain(
      '# Desenvolvedores\n\n## Fundamentos: Formato de resposta e erros',
    )
    expect(txt).toContain('### O envelope')
    expect(txt).toContain('Base: `https://steel.test/api`.')
    expect(txt).toContain('| `RATE_LIMITED` | Muitas requisições |')
    expect(txt).not.toContain('<ErrorCodeTable')
    expect(txt.indexOf('# Desenvolvedores')).toBeLessThan(
      txt.indexOf('# Changelog'),
    )
  })
})

describe('devPageMarkdown', () => {
  it('only swaps a table that stands on its own line', () => {
    expect(devPageMarkdown('Use `<ErrorCodeTable />` aqui.')).toBe(
      'Use `<ErrorCodeTable />` aqui.',
    )
    expect(devPageMarkdown('<ErrorCodeTable />')).toMatch(/^#### 400 — /)
  })

  it('swaps the MCP server url and the generated MCP tool table', () => {
    expect(devPageMarkdown('Servidor: <McpServerUrl />.')).toBe(
      'Servidor: `https://steel.test/api/mcp`.',
    )
    expect(devPageMarkdown('<McpToolTable />', '| tabela |')).toBe('| tabela |')
    expect(devPageMarkdown('<McpToolTable />')).toBe(
      'Lista de ferramentas: https://steel.test/dev/mcp',
    )
    expect(devPageMarkdown('Use `<McpToolTable />` aqui.', 'x')).toBe(
      'Use `<McpToolTable />` aqui.',
    )
  })

  it('passes the MCP tool table through to the guides in llms-full.txt', () => {
    const mcp = { ...GUIDE, source: '## Ferramentas\n\n<McpToolTable />' }
    const txt = buildLlmsFullTxt([ENTRY], [], [mcp], '#### ServiceDesk')
    expect(txt).toContain('### Ferramentas\n\n##### ServiceDesk')
    expect(txt).not.toContain('<McpToolTable')
  })
})
