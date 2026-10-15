import { describe, expect, it } from 'vitest'
import { createSiteDocument } from '@/src/__tests__/factories/site.factory'
import {
  collectFormTokens,
  createEmptySiteDocument,
  describeSiteError,
  MAX_SITE_NODES,
  validateSiteDocument,
} from '@/src/lib/sites/document'

function problems(input: unknown): string[] {
  const result = validateSiteDocument(input)
  if (result.ok) throw new Error('expected invalid document')
  return result.error
}

describe('validateSiteDocument', () => {
  it('accepts a valid and an empty document', () => {
    expect(validateSiteDocument(createSiteDocument()).ok).toBe(true)
    expect(validateSiteDocument(createEmptySiteDocument()).ok).toBe(true)
  })

  it('rejects foreign documents with pt-BR messages', () => {
    expect(problems(null)[0]).toMatch(/^Documento inválido/)
    expect(
      problems({ catalog: 'email', version: 1, rootId: 'root', nodes: {} })[0],
    ).toContain('Documento inválido')
  })

  it('caps the number of nodes', () => {
    const doc = createEmptySiteDocument()
    for (let i = 0; i <= MAX_SITE_NODES; i++) {
      doc.nodes[`n${i}`] = { id: `n${i}`, type: 'site.text', props: {} }
    }
    expect(problems(doc)).toEqual([
      `O documento passa do limite de ${MAX_SITE_NODES} elementos`,
    ])
  })

  it('reports invalid props and unknown types', () => {
    const doc = createSiteDocument()
    doc.nodes.h1 = { ...doc.nodes.h1, props: { level: 'h9' } }
    expect(problems(doc).join(' ')).toContain(
      'Valores inválidos no elemento h1',
    )
    const unknown = createSiteDocument()
    unknown.nodes.h1 = { ...unknown.nodes.h1, type: 'site.nope' }
    expect(problems(unknown).join(' ')).toContain('site.nope')
  })
})

describe('describeSiteError', () => {
  it.each([
    [{ code: 'NODE_NOT_FOUND', id: 'x' }, 'Elemento não encontrado: x'],
    [
      {
        code: 'NOT_ACCEPTED',
        parentType: 'site.page',
        childType: 'site.heading',
      },
      '"Título" não pode ficar dentro de',
    ],
    [{ code: 'MAX_CHILDREN', parentType: 'site.nope', max: 2 }, 'no máximo 2'],
    [{ code: 'MIN_CHILDREN', parentType: 'site.nope', min: 1 }, 'pelo menos 1'],
    [{ code: 'REQUIRED', type: 'site.nope' }, 'precisa de'],
    [{ code: 'UNIQUE', type: 'site.nope' }, 'Só pode haver um'],
    [{ code: 'INVALID_PROPS', id: 'a', issues: ['x', 'y'] }, 'x; y'],
    [{ code: 'UNKNOWN_TYPE', type: 't' }, 'desconhecido: t'],
    [{ code: 'CYCLE', id: 'a' }, 'dois lugares'],
    [{ code: 'INVALID_DOCUMENT', reason: 'r' }, 'Documento inválido: r'],
    [{ code: 'LOCKED', id: 'a' }, 'Documento inválido (LOCKED)'],
  ] as const)('describes %o', (error, expected) => {
    expect(describeSiteError(error as never)).toContain(expected)
  })
})

describe('collectFormTokens', () => {
  it('collects unique form tokens of site.form nodes', () => {
    const a = createSiteDocument()
    a.nodes.f1 = { id: 'f1', type: 'site.form', props: { formToken: 'tok-1' } }
    a.nodes.f2 = { id: 'f2', type: 'site.form', props: { formToken: '' } }
    a.nodes.t = { id: 't', type: 'site.text', props: { formToken: 'nope' } }
    const b = createSiteDocument()
    b.nodes.f3 = { id: 'f3', type: 'site.form', props: { formToken: 'tok-1' } }
    b.nodes.f4 = { id: 'f4', type: 'site.form', props: { formToken: 'tok-2' } }
    expect(collectFormTokens([a, b])).toEqual(['tok-1', 'tok-2'])
  })
})
