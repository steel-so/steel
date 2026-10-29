import { describe, expect, it } from 'vitest'
import { validateEmailDocument } from '@/src/lib/canvas-email/validate'
import { createNewsletterStarterDocument } from '@/src/lib/crm-newsletter/starter'

describe('createNewsletterStarterDocument', () => {
  it('builds a valid document: header, title, content, signature, footer', () => {
    const doc = createNewsletterStarterDocument('Novidades da Acme')
    expect(validateEmailDocument(doc).ok).toBe(true)
    const root = doc.nodes[doc.rootId]
    // 4 sections + the required footer.
    expect(root.children).toHaveLength(5)
    expect(doc.nodes[root.children?.at(-1) as string].type).toBe('email.footer')
    const json = JSON.stringify(doc)
    expect(json).toContain('Título da edição')
    expect(json).toContain('Assunto principal')
    expect(json).toContain('Equipe Novidades da Acme')
  })

  it('falls back to a generic signature without a name', () => {
    expect(JSON.stringify(createNewsletterStarterDocument('  '))).toContain(
      'Nossa equipe',
    )
  })
})
