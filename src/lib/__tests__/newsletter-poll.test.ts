import { describe, expect, it } from 'vitest'
import {
  emailDocument,
  renderEditing,
} from '@/src/__tests__/helpers/email-canvas'
import { validateDocument } from '@/src/lib/canvas/ops'
import {
  createEmailCatalog,
  emailCatalog,
} from '@/src/lib/canvas-email/catalog'
import { pollSchema } from '@/src/lib/canvas-email/components/poll'
import { renderEmailDocument } from '@/src/lib/canvas-email/render'
import { DEFAULT_EMAIL_BRAND } from '@/src/lib/canvas-email/theme'
import {
  applyPollLinks,
  extractPolls,
  hasPollLinks,
  newsletterPollUrl,
  POLL_BLOCK,
  pollMarkerHref,
} from '@/src/lib/newsletter/poll-links'
import {
  createPollVoteToken,
  verifyPollVoteToken,
} from '@/src/lib/newsletter/poll-token'

const brand = { ...DEFAULT_EMAIL_BRAND, primaryColor: '#112233' }

function pollDoc(props: Record<string, unknown> = {}) {
  return emailDocument([
    [[{ type: POLL_BLOCK, id: 'poll1', props }, { type: 'email.text' }]],
  ])
}

describe('poll block', () => {
  it('validates question and 2–5 non-empty options', () => {
    const base = emailCatalog.components[POLL_BLOCK].defaultProps()
    expect(pollSchema.safeParse(base).success).toBe(true)
    const one = pollSchema.safeParse({ ...base, options: [{ label: 'A' }] })
    expect(one.success).toBe(false)
    const six = pollSchema.safeParse({
      ...base,
      options: Array.from({ length: 6 }, (_, i) => ({ label: `O${i}` })),
    })
    expect(six.success).toBe(false)
    expect(
      pollSchema.safeParse({
        ...base,
        options: [{ label: 'A' }, { label: ' ' }],
      }).success,
    ).toBe(false)
    expect(pollSchema.safeParse({ ...base, question: '' }).success).toBe(false)
  })

  it('is offered in the palette only with allowPoll, but always validates', () => {
    expect(emailCatalog.components[POLL_BLOCK].category).toBeUndefined()
    const newsletter = createEmailCatalog({ allowPoll: true })
    expect(newsletter.components[POLL_BLOCK].category).toBe('Relacionamento')
    expect(validateDocument(pollDoc(), emailCatalog).ok).toBe(true)
  })

  it('renders one placeholder link per option, plus a hint', async () => {
    const doc = pollDoc({
      question: 'Qual o melhor dia?',
      options: [{ label: 'Segunda' }, { label: 'Sexta' }],
    })
    const { html, text } = await renderEmailDocument(doc, {
      brand,
      subject: 'Oi',
    })
    expect(html).toContain('Qual o melhor dia?')
    expect(html).toContain(`href="${pollMarkerHref('poll1', 0)}"`)
    expect(html).toContain(`href="${pollMarkerHref('poll1', 1)}"`)
    expect(html).toContain('Um clique registra o seu voto.')
    expect(text).toContain(pollMarkerHref('poll1', 1))
    expect(hasPollLinks(html)).toBe(true)
  })

  it('shows placeholders in the editor for empty texts', () => {
    const html = renderEditing(
      pollDoc({ question: '', options: [{ label: '' }, { label: 'B' }] }),
    )
    expect(html).toContain('Escreva a pergunta da enquete')
    expect(html).toContain('Opção 1')
  })
})

describe('applyPollLinks', () => {
  const email = {
    subject: 'S',
    html: `<p><a href="${pollMarkerHref('b-1', 0)}" style="x">Sim</a> <a href="${pollMarkerHref('b-1', 1)}">Não</a> <a href="https://acme.example">site</a></p>`,
    text: `Sim ${pollMarkerHref('b-1', 0)}\nNão ${pollMarkerHref('b-1', 1)}\nsite https://acme.example`,
  }

  it('swaps placeholders for the recipient links (escaped)', () => {
    const out = applyPollLinks(
      email,
      (block, index) => `https://x.test/v?b=${block}&o=${index}`,
    )
    expect(out.html).toContain('href="https://x.test/v?b=b-1&amp;o=0"')
    expect(out.html).toContain('href="https://x.test/v?b=b-1&amp;o=1"')
    expect(out.text).toContain('Sim https://x.test/v?b=b-1&o=0')
    expect(out.html).toContain('href="https://acme.example"')
    expect(hasPollLinks(out.html)).toBe(false)
  })

  it('strips the placeholders without a link builder (static options)', () => {
    const out = applyPollLinks(email)
    expect(out.html).toContain('<a style="x">Sim</a>')
    expect(out.html).toContain('<a>Não</a>')
    expect(out.text).toBe('Sim\nNão\nsite https://acme.example')
    expect(out.subject).toBe('S')
  })

  it('returns the same e-mail when there is no poll', () => {
    const plain = { subject: 'S', html: '<p>x</p>', text: 'x' }
    expect(applyPollLinks(plain)).toBe(plain)
  })
})

describe('extractPolls', () => {
  it('lists visible poll blocks in reading order', () => {
    const doc = emailDocument([
      [[{ type: POLL_BLOCK, id: 'p1', props: { showResults: false } }]],
      [
        [
          { type: POLL_BLOCK, id: 'hidden', meta: { hidden: true } },
          { type: POLL_BLOCK, id: 'p2' },
        ],
      ],
    ])
    const polls = extractPolls(doc)
    expect(polls.map((poll) => poll.blockId)).toEqual(['p1', 'p2'])
    expect(polls[0].showResults).toBe(false)
    expect(polls[1].showResults).toBe(true)
    expect(polls[1].options).toHaveLength(3)
  })

  it('tolerates malformed props', () => {
    const doc = emailDocument([[[{ type: POLL_BLOCK, id: 'p1' }]]])
    doc.nodes.p1 = {
      ...doc.nodes.p1,
      props: { question: 3, options: [null, { label: 'A' }] },
    }
    expect(extractPolls(doc)[0]).toEqual({
      blockId: 'p1',
      question: '',
      options: ['', 'A'],
      showResults: true,
    })
    doc.nodes.p1 = { ...doc.nodes.p1, props: {} }
    expect(extractPolls(doc)[0].options).toEqual([])
  })
})

describe('poll vote token', () => {
  it('round-trips and builds the public URL', () => {
    const token = createPollVoteToken({
      recipientId: 'r1',
      blockId: 'b1',
      optionIndex: 2,
    })
    expect(verifyPollVoteToken(token)).toEqual({
      ok: true,
      value: { recipientId: 'r1', blockId: 'b1', optionIndex: 2 },
    })
    expect(newsletterPollUrl('https://app.test/', token)).toBe(
      `https://app.test/newsletter/enquete/${token}`,
    )
  })

  it('rejects tampered, malformed and foreign tokens', () => {
    const token = createPollVoteToken({
      recipientId: 'r1',
      blockId: 'b1',
      optionIndex: 0,
    })
    const [payload, signature] = token.split('.')
    const forged = Buffer.from(
      JSON.stringify({ r: 'r2', b: 'b1', o: 0 }),
    ).toString('base64url')
    for (const bad of [
      `${forged}.${signature}`,
      `${payload}.x${signature}`,
      payload,
      `${payload}.`,
      'a.b.c',
      '',
    ]) {
      expect(verifyPollVoteToken(bad).ok).toBe(false)
    }
  })

  it('rejects signed payloads with the wrong shape', async () => {
    const { createHmac } = await import('node:crypto')
    const { BETTER_AUTH_SECRET } = await import('@/lib/env/server')
    const sign = (raw: string) => {
      const b64 = Buffer.from(raw).toString('base64url')
      const sig = createHmac('sha256', BETTER_AUTH_SECRET)
        .update(`crm-newsletter-poll-vote:v1:${b64}`)
        .digest('base64url')
      return `${b64}.${sig}`
    }
    for (const raw of [
      'not json',
      'null',
      JSON.stringify({ r: '', b: 'b', o: 0 }),
      JSON.stringify({ r: 'r', b: '', o: 0 }),
      JSON.stringify({ r: 'r', b: 'b', o: -1 }),
      JSON.stringify({ r: 'r', b: 'b', o: 1.5 }),
      JSON.stringify({ r: 'r', b: 'b', o: '1' }),
    ]) {
      expect(verifyPollVoteToken(sign(raw)).ok, raw).toBe(false)
    }
    expect(
      verifyPollVoteToken(sign(JSON.stringify({ r: 'r', b: 'b', o: 1 }))).ok,
    ).toBe(true)
  })
})
