import { describe, expect, it } from 'vitest'
import {
  commitMessagesToMarkdown,
  parseCompareRange,
  releaseNotesToDraft,
} from '../release-notes'

describe('releaseNotesToDraft()', () => {
  it('groups conventional entries and strips internal commit types', () => {
    const draft = releaseNotesToDraft(
      [
        "## What's Changed",
        '* feat(crm): add lead triggers to the workflow editor by @castro in https://github.com/steel-so/steel/pull/12',
        '* fix(whatsapp): keep media when a message is retried (#13)',
        '* chore(deps): bump next from 16.0.1 to 16.0.2',
        '* ci: cache pnpm store',
        '* test(crm): add lead pipeline test factory',
        '* perf: speed up the conversations list',
        '* build: bump node image',
        '',
        '**Full Changelog**: https://github.com/steel-so/steel/compare/2026.08.28.4...2026.08.31',
      ].join('\n'),
      { tag: '2026.08.31' },
    )

    expect(draft.subject).toBe('Novidades no Steel — 2026.08.31')
    expect(draft.items).toEqual([
      {
        title: 'Novidades',
        body: '• CRM: Add lead triggers to the workflow editor',
      },
      {
        title: 'Correções',
        body: '• WhatsApp: Keep media when a message is retried',
      },
      {
        title: 'Melhorias de desempenho',
        body: '• Speed up the conversations list',
      },
    ])
    expect(draft.skipped).toBe(4)
  })

  it('drops whole internal sections and keeps hand-written ones', () => {
    const draft = releaseNotesToDraft(
      [
        '## Destaques',
        'Nova tela de **métricas** no [painel admin](https://steel.app/admin).',
        '',
        '### Chores',
        '- Atualiza dependências',
        '- Ajusta pipeline',
        '',
        '## Dependencies',
        '* Bump zod',
        '',
        '## Integrações',
        '- Conexão com o `Google Ads` revisada',
        '',
        '## New Contributors',
        '* @fulano made their first contribution in https://github.com/x/y/pull/1',
      ].join('\n'),
    )

    expect(draft.subject).toBe('Novidades no Steel')
    expect(draft.items).toEqual([
      {
        title: 'Destaques',
        body: 'Nova tela de métricas no painel admin.',
      },
      {
        title: 'Integrações',
        body: '• Conexão com o Google Ads revisada',
      },
    ])
    expect(draft.skipped).toBe(4)
  })

  it('puts unscoped non-conventional bullets in "Outras melhorias"', () => {
    const draft = releaseNotesToDraft('- Melhorias gerais de estabilidade')
    expect(draft.items).toEqual([
      { title: 'Outras melhorias', body: '• Melhorias gerais de estabilidade' },
    ])
  })

  it('ignores HTML comments, rules and a breaking-change marker', () => {
    const draft = releaseNotesToDraft(
      [
        '<!-- Release notes generated using configuration in .github/release.yml -->',
        '<!--',
        'feat: hidden',
        '-->',
        '---',
        '- feat(admin)!: redesign the workspaces list',
      ].join('\n'),
    )
    expect(draft.items).toEqual([
      { title: 'Novidades', body: '• Admin: Redesign the workspaces list' },
    ])
  })

  it('returns no items when everything is internal', () => {
    const draft = releaseNotesToDraft(
      '- chore: bump deps\n- ci: fix cache\n**Full Changelog**: https://x/compare/a...b',
    )
    expect(draft.items).toEqual([])
    expect(draft.skipped).toBe(2)
  })

  it('prefers the release name over the tag in the subject', () => {
    expect(
      releaseNotesToDraft('- feat: x', { tag: '2026.09.01', name: 'Setembro' })
        .subject,
    ).toBe('Novidades no Steel — Setembro')
  })

  it('caps each item body to the e-mail schema limit', () => {
    const many = Array.from(
      { length: 400 },
      (_, i) =>
        `- feat: item número ${i} com uma descrição razoavelmente longa`,
    ).join('\n')
    const [item] = releaseNotesToDraft(many).items
    expect(item.body.length).toBeLessThanOrEqual(5000)
    expect(item.body.endsWith('…')).toBe(true)
  })
})

describe('commitMessagesToMarkdown()', () => {
  it('keeps only the header of each commit message', () => {
    expect(
      commitMessagesToMarkdown([
        'feat(crm): add x\n\nlong body\n\nCo-Authored-By: someone',
        '',
        'fix: y',
      ]),
    ).toBe('- feat(crm): add x\n- fix: y')
  })
})

describe('parseCompareRange()', () => {
  it('extracts CalVer tags with dots from the Full Changelog link', () => {
    expect(
      parseCompareRange(
        '**Full Changelog**: https://github.com/steel-so/steel/compare/2026.08.28.4...2026.08.31',
      ),
    ).toEqual({ base: '2026.08.28.4', head: '2026.08.31' })
  })

  it('returns null without a compare link', () => {
    expect(parseCompareRange('nada aqui')).toBeNull()
  })
})
