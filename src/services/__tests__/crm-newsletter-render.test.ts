import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { createBlankEmailDocument } from '@/src/lib/canvas-email/presets'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/crm-email-builder.repository', () => ({
  CrmEmailBuilderRepository: {
    findBrand: vi.fn(),
    findWorkspaceIdentity: vi.fn(),
    findProducts: vi.fn(),
    findContacts: vi.fn(),
  },
}))
vi.mock('@/src/repositories/crm-email-condition.repository', () => ({
  CrmEmailConditionRepository: { findListMemberships: vi.fn() },
}))
const needsLists = vi.hoisted(() => ({ value: false }))
vi.mock('@/src/lib/canvas-email/conditions', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  needsListMembership: () => needsLists.value,
}))

import { CrmEmailBuilderRepository } from '@/src/repositories/crm-email-builder.repository'
import { CrmEmailConditionRepository } from '@/src/repositories/crm-email-condition.repository'
import {
  issueChecklist,
  loadRecipientFacts,
  personalizeIssue,
  renderIssueBase,
  validateIssueDocument,
  webVersionOf,
} from '../crm-newsletter-render'

const builder = vi.mocked(CrmEmailBuilderRepository)
const conditions = vi.mocked(CrmEmailConditionRepository)

/** Blank document with a text block that uses `{{primeiro_nome}}`. */
function documentWithName() {
  const doc = createBlankEmailDocument()
  const section = doc.nodes[doc.rootId].children?.[0] as string
  const column = doc.nodes[section].children?.[0]
  const text = Object.values(doc.nodes).find((n) => n.type === 'email.text')
  if (text) {
    ;(text.props as { html: string }).html = '<p>Olá, {{primeiro_nome}}!</p>'
  }
  return { doc, column }
}

describe('crm-newsletter-render', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    needsLists.value = false
    builder.findBrand.mockResolvedValue(ok(null))
    builder.findWorkspaceIdentity.mockResolvedValue(
      ok({ name: 'Acme', logoUrl: null }),
    )
    builder.findProducts.mockResolvedValue(ok([]))
    builder.findContacts.mockResolvedValue(ok([]))
    conditions.findListMemberships.mockResolvedValue(ok(new Map()))
  })

  it('validates the document', () => {
    expect(
      expectOk(validateIssueDocument(createBlankEmailDocument())),
    ).toBeTruthy()
    const error = expectErr(
      validateIssueDocument({ nope: true }),
      'CRM_NEWSLETTER_ISSUE_INCOMPLETE',
    )
    expect(error.message).toBeTruthy()
    expectErr(validateIssueDocument(null), 'CRM_NEWSLETTER_ISSUE_INCOMPLETE')
  })

  it('renders the base with the workspace brand and personalizes per subscriber', async () => {
    const { doc } = documentWithName()
    const base = expectOk(
      await renderIssueBase('ws1', doc, 'Oi {{nome}}', 'Novidades'),
    )
    expect(base.brand.companyName).toBe('Acme')

    const email = personalizeIssue(base, {
      newsletterName: 'Novidades',
      contact: { email: 'ana@example.com', name: 'Ana Souza' },
      links: {
        unsubscribeUrl: 'https://x/sair/t',
        preferencesUrl: 'https://x/pref/t',
      },
    })
    expect(email.subject).toBe('Oi Ana Souza')
    // One footer: the newsletter subscription text with both links, never
    // the campaign "base de contatos" sentence.
    expect(email.html).toContain(
      'Você recebe a newsletter Novidades porque se inscreveu para recebê-la.',
    )
    expect(email.html).not.toContain('base de contatos')
    expect(email.html).toContain('href="https://x/pref/t"')
    expect(email.html).toContain('href="https://x/sair/t"')
    expect(email.html).toContain('Preferências')
    expect(email.html).toContain('Descadastrar')
    expect(email.html).not.toContain('%%steel_newsletter_preferences%%')
    expect(email.text).toContain('https://x/sair/t')
    expect(email.text).toContain('https://x/pref/t')

    const web = webVersionOf(base, 'Novidades')
    expect(web.html).not.toContain('https://x/')
    expect(web.html).not.toContain('Ana')
    expect(web.html).toContain('Você recebe a newsletter Novidades')
    // The archive has no subscriber links.
    expect(web.html).not.toContain('Preferências')
    expect(web.html).not.toContain('Descadastrar')
    expect(web.html).not.toContain('data-newsletter-links')

    const checklist = issueChecklist(base, '')
    expect(checklist.some((item) => item.code === 'SUBJECT_EMPTY')).toBe(true)
  })

  it('reports invalid documents and repository failures', async () => {
    expectErr(
      await renderIssueBase('ws1', {}, 's', 'N'),
      'CRM_NEWSLETTER_ISSUE_INCOMPLETE',
    )
    const doc = createBlankEmailDocument()
    builder.findBrand.mockResolvedValueOnce(err(databaseError()))
    expectErr(await renderIssueBase('ws1', doc, 's', 'N'), 'DATABASE_ERROR')
    builder.findWorkspaceIdentity.mockResolvedValueOnce(err(databaseError()))
    expectErr(await renderIssueBase('ws1', doc, 's', 'N'), 'DATABASE_ERROR')
    builder.findProducts.mockResolvedValueOnce(err(databaseError()))
    expectErr(await renderIssueBase('ws1', doc, 's', 'N'), 'DATABASE_ERROR')
  })

  it('loads CRM profiles and, when needed, list memberships of a batch', async () => {
    const base = expectOk(
      await renderIssueBase('ws1', createBlankEmailDocument(), 's', 'N'),
    )
    builder.findContacts.mockResolvedValue(
      ok([
        {
          id: 'p1',
          name: 'Ana',
          emails: ['ana@example.com'],
          phones: [],
          city: 'Recife',
          jobTitle: null,
          companyName: 'Acme',
        },
      ]),
    )
    const recipients = [
      { email: 'ana@example.com', personId: 'p1' },
      { email: 'bia@example.com', personId: null },
      { email: 'ana2@example.com', personId: 'p1' },
    ]
    const facts = expectOk(await loadRecipientFacts('ws1', base, recipients))
    expect(builder.findContacts).toHaveBeenCalledWith('ws1', ['p1'])
    expect(facts.people.get('p1')?.city).toBe('Recife')
    expect(conditions.findListMemberships).not.toHaveBeenCalled()

    needsLists.value = true
    conditions.findListMemberships.mockResolvedValueOnce(
      ok(new Map([['ana@example.com', ['l1']]])),
    )
    const withLists = expectOk(
      await loadRecipientFacts('ws1', base, recipients),
    )
    expect(withLists.lists.get('ana@example.com')).toEqual(['l1'])

    conditions.findListMemberships.mockResolvedValueOnce(err(databaseError()))
    expectErr(await loadRecipientFacts('ws1', base, recipients))
    builder.findContacts.mockResolvedValueOnce(err(databaseError()))
    expectErr(await loadRecipientFacts('ws1', base, recipients))
  })
})
