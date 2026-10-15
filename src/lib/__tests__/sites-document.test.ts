import { describe, expect, it } from 'vitest'
import { createSiteDocument } from '@/src/__tests__/factories/site.factory'
import {
  collectFormIds,
  createEmptySiteDocument,
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

  it('rejects non-objects and a wrong envelope', () => {
    expect(problems(null)).toEqual(['O documento precisa ser um objeto'])
    expect(problems([])).toEqual(['O documento precisa ser um objeto'])
    expect(
      problems({ catalog: 'email', version: 2, rootId: 'x', nodes: [] }),
    ).toEqual([
      'O catálogo do documento precisa ser "site"',
      'A versão do documento precisa ser 1',
      'A raiz do documento precisa ser "root"',
      'O documento não tem elementos',
    ])
  })

  it('caps the number of nodes', () => {
    const doc = createEmptySiteDocument()
    for (let i = 0; i < MAX_SITE_NODES; i++) {
      doc.nodes[`n${i}`] = { id: `n${i}`, type: 'site.text', props: {} }
    }
    expect(problems(doc)).toEqual([
      `O documento passa do limite de ${MAX_SITE_NODES} elementos`,
    ])
  })

  it.each([
    ['not an object', 'x'],
    ['id mismatch', { id: 'other', type: 'site.text', props: {} }],
    ['foreign type', { id: 'n', type: 'email.text', props: {} }],
    ['props not an object', { id: 'n', type: 'site.text', props: [] }],
    ['meta not an object', { id: 'n', type: 'site.text', props: {}, meta: 1 }],
    [
      'children not strings',
      { id: 'n', type: 'site.text', props: {}, children: [1] },
    ],
    [
      'children not array',
      { id: 'n', type: 'site.text', props: {}, children: 'a' },
    ],
  ])('rejects a malformed node (%s)', (_label, node) => {
    const doc = createEmptySiteDocument()
    ;(doc.nodes as Record<string, unknown>).n = node
    expect(problems(doc)).toEqual(['Elemento malformado: n'])
  })

  it('rejects a missing or wrong root', () => {
    const missing = createSiteDocument()
    delete (missing.nodes as Record<string, unknown>).root
    expect(problems(missing)).toEqual(['O documento não tem o elemento raiz'])

    const wrong = createSiteDocument()
    wrong.nodes.root = { ...wrong.nodes.root, type: 'site.section' }
    expect(problems(wrong)).toEqual(['O elemento raiz precisa ser "site.page"'])
  })

  it('rejects dangling, repeated and orphan nodes', () => {
    const doc = createSiteDocument()
    doc.nodes.root.children = ['s1', 'ghost', 's1']
    doc.nodes.orphan = { id: 'orphan', type: 'site.text', props: {} }
    expect(problems(doc)).toEqual([
      'Elemento não encontrado: ghost',
      'O elemento s1 aparece em dois lugares',
      'Elemento solto: orphan',
    ])
  })
})

describe('collectFormIds', () => {
  it('collects unique form ids of site.form nodes', () => {
    const a = createSiteDocument()
    a.nodes.f1 = { id: 'f1', type: 'site.form', props: { formId: 'form-1' } }
    a.nodes.f2 = { id: 'f2', type: 'site.form', props: { formId: '' } }
    a.nodes.t = { id: 't', type: 'site.text', props: { formId: 'nope' } }
    const b = createSiteDocument()
    b.nodes.f3 = { id: 'f3', type: 'site.form', props: { formId: 'form-1' } }
    b.nodes.f4 = { id: 'f4', type: 'site.form', props: { formId: 'form-2' } }
    expect(collectFormIds([a, b])).toEqual(['form-1', 'form-2'])
  })
})
