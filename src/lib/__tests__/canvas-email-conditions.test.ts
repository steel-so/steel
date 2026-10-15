import { describe, expect, it } from 'vitest'
import {
  emailDocument,
  renderEditing,
} from '@/src/__tests__/helpers/email-canvas'
import {
  applyConditionMarkers,
  applyEmailConditions,
  applyEmailConditionsToHtml,
  conditionMarkers,
  conditionOf,
  decodeEmailCondition,
  defaultEmailCondition,
  describeEmailCondition,
  type EmailCondition,
  type EmailRecipientFacts,
  emailConditionSchema,
  emailConditionsIn,
  encodeEmailCondition,
  evaluateEmailCondition,
  hasEmailConditions,
  needsListMembership,
  operatorTakesValue,
} from '@/src/lib/canvas-email/conditions'
import { renderEmailDocument } from '@/src/lib/canvas-email/render'
import { DEFAULT_EMAIL_BRAND } from '@/src/lib/canvas-email/theme'
import { validateEmailDocument } from '@/src/lib/canvas-email/validate'
import { contactToVariables } from '@/src/lib/crm-email-builder/variables'

const facts = (
  values: Record<string, string> = {},
  listIds: string[] = [],
): EmailRecipientFacts => ({ values, listIds })

const field = (
  op: Extract<EmailCondition, { kind: 'field' }>['op'],
  value = '',
  name: Extract<EmailCondition, { kind: 'field' }>['field'] = 'cidade',
): EmailCondition => ({ kind: 'field', field: name, op, value })

describe('evaluateEmailCondition()', () => {
  it('compares contact fields ignoring case, accents and spaces', () => {
    const contact = facts({ cidade: '  São Paulo ' })
    expect(evaluateEmailCondition(field('equals', 'sao paulo'), contact)).toBe(
      true,
    )
    expect(evaluateEmailCondition(field('equals', 'Campinas'), contact)).toBe(
      false,
    )
    expect(
      evaluateEmailCondition(field('not_equals', 'Campinas'), contact),
    ).toBe(true)
    expect(evaluateEmailCondition(field('contains', 'PAU'), contact)).toBe(true)
    expect(evaluateEmailCondition(field('not_contains', 'pau'), contact)).toBe(
      false,
    )
    expect(evaluateEmailCondition(field('empty'), contact)).toBe(false)
    expect(evaluateEmailCondition(field('not_empty'), contact)).toBe(true)
  })

  it('treats a missing field as empty', () => {
    expect(evaluateEmailCondition(field('empty'), facts())).toBe(true)
    expect(evaluateEmailCondition(field('not_empty'), facts())).toBe(false)
  })

  it('checks mailing-list membership', () => {
    const inList: EmailCondition = { kind: 'list', op: 'in', listId: 'l1' }
    const notIn: EmailCondition = { kind: 'list', op: 'not_in', listId: 'l1' }
    expect(evaluateEmailCondition(inList, facts({}, ['l1']))).toBe(true)
    expect(evaluateEmailCondition(inList, facts({}, ['l2']))).toBe(false)
    expect(evaluateEmailCondition(notIn, facts({}, ['l2']))).toBe(true)
  })

  it('never matches "in" a list that was not picked', () => {
    const empty: EmailCondition = { kind: 'list', op: 'in', listId: '' }
    expect(evaluateEmailCondition(empty, facts({}, ['']))).toBe(false)
    expect(
      evaluateEmailCondition({ ...empty, op: 'not_in' }, facts({}, [''])),
    ).toBe(true)
  })
})

describe('condition helpers', () => {
  it('starts with a field condition and knows which operators take a value', () => {
    expect(emailConditionSchema.parse(defaultEmailCondition())).toEqual(
      defaultEmailCondition(),
    )
    expect(operatorTakesValue('equals')).toBe(true)
    expect(operatorTakesValue('empty')).toBe(false)
    expect(operatorTakesValue('not_empty')).toBe(false)
  })

  it('reads only valid conditions from a node', () => {
    const node = (showIf: unknown) => ({
      id: 'n',
      type: 'email.text',
      props: { showIf },
    })
    expect(conditionOf(node(undefined))).toBeNull()
    expect(conditionOf(node(null))).toBeNull()
    expect(conditionOf(node({ kind: 'nope' }))).toBeNull()
    expect(conditionOf(node(field('equals', 'x')))).toEqual(
      field('equals', 'x'),
    )
  })

  it('describes conditions in pt-BR', () => {
    expect(describeEmailCondition(field('equals', ' Campinas '))).toBe(
      'Cidade é igual a “Campinas”',
    )
    expect(describeEmailCondition(field('empty', '', 'empresa'))).toBe(
      'Empresa está vazio',
    )
    expect(
      describeEmailCondition({ kind: 'list', op: 'in', listId: 'l1' }, (id) =>
        id === 'l1' ? 'Clientes VIP' : undefined,
      ),
    ).toBe('Está na lista “Clientes VIP”')
    expect(
      describeEmailCondition({ kind: 'list', op: 'not_in', listId: 'l9' }),
    ).toBe('Não está na lista “lista selecionada”')
    expect(describeEmailCondition({ kind: 'list', op: 'in', listId: '' })).toBe(
      'Está na lista “nenhuma lista escolhida”',
    )
  })

  it('encodes conditions safely for HTML comments and decodes them back', () => {
    const tricky = field('equals', "--> <b>'a'(x)*!~.{{nome}}")
    const encoded = encodeEmailCondition(tricky)
    expect(encoded).toMatch(/^[A-Za-z0-9%_]+$/)
    expect(decodeEmailCondition(encoded)).toEqual(tricky)
    expect(decodeEmailCondition('%E0%A4%A')).toBeNull()
    expect(decodeEmailCondition(encodeURIComponent('{"kind":"x"}'))).toBeNull()
  })

  it('builds marker values from sanitized ids', () => {
    const markers = conditionMarkers('a:b<c>', field('equals', 'x'))
    expect(markers.close).toBe('abc')
    expect(markers.open.startsWith('abc:')).toBe(true)
  })
})

function conditionalDocument() {
  return emailDocument([
    [
      [
        {
          type: 'email.heading',
          props: {
            text: 'Para Campinas',
            showIf: field('equals', 'Campinas'),
          },
        },
        { type: 'email.heading', id: 'always', props: { text: 'Para todos' } },
        {
          type: 'email.heading',
          id: 'vip',
          props: {
            text: 'Só VIP',
            showIf: { kind: 'list', op: 'in', listId: 'vip' },
          },
        },
      ],
    ],
    [
      [
        {
          type: 'email.text',
          id: 'nested',
          props: {
            html: '<p>Dentro da seção condicional</p>',
            showIf: field('not_empty', '', 'empresa'),
          },
        },
      ],
    ],
  ])
}

async function render(doc = conditionalDocument()) {
  return renderEmailDocument(doc, {
    brand: DEFAULT_EMAIL_BRAND,
    subject: 'Teste',
  })
}

describe('conditional content in the output', () => {
  it('validates `showIf` with the props schemas', () => {
    const doc = conditionalDocument()
    expect(validateEmailDocument(doc).ok).toBe(true)
    doc.nodes.s1.props.showIf = { kind: 'field', field: 'nope', op: 'x' }
    expect(validateEmailDocument(doc).ok).toBe(false)
  })

  it('wraps conditional nodes in comment markers, never spans', async () => {
    const email = await render()
    expect(hasEmailConditions(email.html)).toBe(true)
    expect(email.html).not.toContain('data-ec-if')
    expect(email.html).not.toContain('data-ec-endif')
    expect(email.html).toContain('<!--ec-endif:b0-->')
    expect(emailConditionsIn(email.html)).toHaveLength(3)
    expect(needsListMembership(email.html)).toBe(true)
  })

  it('keeps or drops each span per recipient and derives the text again', async () => {
    const email = await render()
    const campinas = applyEmailConditions(
      email,
      facts(contactToVariables({ email: 'a@x.com', city: 'Campinas' }), []),
    )
    expect(campinas.html).toContain('Para Campinas')
    expect(campinas.html).toContain('Para todos')
    expect(campinas.html).not.toContain('Só VIP')
    expect(campinas.html).not.toContain('Dentro da seção condicional')
    expect(campinas.html).not.toContain('ec-if')
    expect(campinas.text).toContain('Para Campinas')
    expect(campinas.text).not.toContain('Só VIP')

    const vip = applyEmailConditions(
      email,
      facts(
        contactToVariables({
          email: 'b@x.com',
          city: 'Santos',
          company: 'ACME',
        }),
        ['vip'],
      ),
    )
    expect(vip.html).not.toContain('Para Campinas')
    expect(vip.html).toContain('Só VIP')
    expect(vip.html).toContain('Dentro da seção condicional')
  })

  it('shows everything without facts (preview with raw variables)', async () => {
    const email = await render()
    const all = applyEmailConditions(email, null)
    expect(all.html).toContain('Para Campinas')
    expect(all.html).toContain('Só VIP')
    expect(all.html).not.toContain('ec-if')
  })

  it('keeps the content of a malformed marker', () => {
    const html = '<p>a</p><!--ec-if:x:bad%-->kept<!--ec-endif:x-->'
    expect(applyEmailConditionsToHtml(html, facts())).toBe('<p>a</p>kept')
  })

  it('handles nested spans and HTML without conditions', () => {
    const outer = encodeEmailCondition(field('not_empty'))
    const inner = encodeEmailCondition(field('equals', 'x', 'nome'))
    const html = `<!--ec-if:o:${outer}-->A<!--ec-if:i:${inner}-->B<!--ec-endif:i-->C<!--ec-endif:o-->`
    expect(applyEmailConditionsToHtml(html, facts({ cidade: 'y' }))).toBe('AC')
    expect(
      applyEmailConditionsToHtml(html, facts({ cidade: 'y', nome: 'X' })),
    ).toBe('ABC')
    expect(applyEmailConditionsToHtml(html, facts())).toBe('')
    expect(applyEmailConditionsToHtml('<p>x</p>', facts())).toBe('<p>x</p>')
    const plain = { subject: 's', html: '<p>x</p>', text: 'x' }
    expect(applyEmailConditions(plain, facts())).toBe(plain)
  })

  it('converts marker spans into comments', () => {
    expect(
      applyConditionMarkers(
        '<span data-ec-if="a:b%22"></span>x<span data-ec-endif="a"></span>',
      ),
    ).toBe('<!--ec-if:a:b%22-->x<!--ec-endif:a-->')
  })

  it('reports no list need when only field conditions exist', async () => {
    const doc = emailDocument([
      [[{ type: 'email.heading', props: { showIf: field('empty') } }]],
    ])
    const email = await render(doc)
    expect(needsListMembership(email.html)).toBe(false)
  })

  it('shows a "Mostrar se" badge only in the editor', () => {
    const markup = renderEditing(conditionalDocument())
    expect(markup).toContain(
      'data-ec-cond="Mostrar se: Cidade é igual a “Campinas”"',
    )
    expect(markup).not.toContain('data-ec-if')
  })
})
