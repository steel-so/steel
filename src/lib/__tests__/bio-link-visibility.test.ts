import { describe, expect, it } from 'vitest'
import {
  BIO_ADD_OPTIONS,
  bioBlockProblem,
  createBioBlock,
  fromLocalInput,
  toLocalInput,
} from '@/src/lib/bio-link/blocks'
import {
  bioClickDestination,
  isBioBlockVisible,
  utmFromUrl,
  visibleBioBlocks,
} from '@/src/lib/bio-link/visibility'
import type { BioBlockDTO } from '@/src/schemas/bio-link.schema'

const NOW = new Date('2026-11-19T15:00:00.000Z')

function link(overrides: Partial<BioBlockDTO> = {}): BioBlockDTO {
  return {
    id: 'l1',
    type: 'link',
    active: true,
    network: 'custom',
    title: 'Loja',
    value: 'loja.com.br',
    ...overrides,
  } as BioBlockDTO
}

describe('isBioBlockVisible', () => {
  it('hides inactive blocks', () => {
    expect(isBioBlockVisible(link(), NOW)).toBe(true)
    expect(isBioBlockVisible(link({ active: false }), NOW)).toBe(false)
  })

  it('honours the schedule window (start inclusive, end exclusive)', () => {
    const future = link({ startsAt: '2026-11-20T00:00:00.000Z' })
    expect(isBioBlockVisible(future, NOW)).toBe(false)
    expect(
      isBioBlockVisible(future, new Date('2026-11-20T00:00:00.000Z')),
    ).toBe(true)

    const ended = link({ endsAt: '2026-11-19T15:00:00.000Z' })
    expect(isBioBlockVisible(ended, NOW)).toBe(false)
    expect(isBioBlockVisible(ended, new Date('2026-11-19T14:59:59.000Z'))).toBe(
      true,
    )

    const inside = link({
      startsAt: '2026-11-19T00:00:00.000Z',
      endsAt: '2026-11-20T00:00:00.000Z',
    })
    expect(isBioBlockVisible(inside, NOW)).toBe(true)
  })

  it('hides a button whose destination no longer resolves', () => {
    expect(isBioBlockVisible(link({ value: 'sem espaço.com' }), NOW)).toBe(
      false,
    )
  })
})

describe('visibleBioBlocks', () => {
  const header = (id: string): BioBlockDTO => ({
    id,
    type: 'header',
    active: true,
    title: id,
  })

  it('drops a section header with nothing visible below it', () => {
    const blocks = [
      header('h1'),
      link({ id: 'a' }),
      header('h2'),
      link({ id: 'b', active: false }),
      header('h3'),
    ]
    expect(visibleBioBlocks(blocks, NOW).map((block) => block.id)).toEqual([
      'h1',
      'a',
    ])
  })

  it('keeps the order of the visible blocks', () => {
    const blocks = [link({ id: 'a' }), link({ id: 'b' }), link({ id: 'c' })]
    expect(visibleBioBlocks(blocks, NOW).map((block) => block.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})

describe('bioClickDestination', () => {
  it('resolves buttons and form links, and refuses the rest', () => {
    expect(bioClickDestination(link(), NOW)).toBe('https://loja.com.br/')
    expect(
      bioClickDestination(
        {
          id: 'f',
          type: 'form',
          active: true,
          title: 'Contato',
          formToken: 'tok en',
          mode: 'link',
        },
        NOW,
      ),
    ).toBe('/f/tok%20en')
    expect(
      bioClickDestination(
        {
          id: 'f',
          type: 'form',
          active: true,
          title: 'Contato',
          formToken: 'tok',
          mode: 'embed',
        },
        NOW,
      ),
    ).toBeNull()
    expect(
      bioClickDestination(
        { id: 'h', type: 'header', active: true, title: 'x' },
        NOW,
      ),
    ).toBeNull()
    expect(bioClickDestination(link({ active: false }), NOW)).toBeNull()
  })
})

describe('utmFromUrl', () => {
  it('reads utm parameters from a page of the same host only', () => {
    const page =
      'https://app.exemplo.com/b/loja?utm_source=instagram&utm_medium=bio&utm_campaign=lancamento'
    expect(utmFromUrl(page, 'app.exemplo.com')).toEqual({
      utmSource: 'instagram',
      utmMedium: 'bio',
      utmCampaign: 'lancamento',
    })
    expect(utmFromUrl(page, 'outro.com')).toEqual({})
    expect(utmFromUrl(null, 'app.exemplo.com')).toEqual({})
    expect(utmFromUrl('lixo', 'app.exemplo.com')).toEqual({})
  })
})

describe('createBioBlock / bioBlockProblem', () => {
  it('creates a block of every kind with a stable shape', () => {
    for (const option of BIO_ADD_OPTIONS) {
      const block = createBioBlock(option.kind, `id-${option.kind}`)
      expect(block.id).toBe(`id-${option.kind}`)
      expect(block.active).toBe(true)
    }
    expect(createBioBlock('whatsapp', 'x')).toMatchObject({
      type: 'link',
      network: 'whatsapp',
    })
  })

  it('flags empty destinations and accepts filled ones', () => {
    const whatsapp = createBioBlock('whatsapp', 'x')
    expect(bioBlockProblem(whatsapp)).toMatch(/número/)
    if (whatsapp.type !== 'link') throw new Error('expected a link')
    expect(bioBlockProblem({ ...whatsapp, value: '11912345678' })).toBeNull()

    expect(bioBlockProblem(createBioBlock('video', 'v'))).toMatch(/YouTube/)
    expect(bioBlockProblem(createBioBlock('form', 'f'))).toMatch(/formulário/)
    expect(bioBlockProblem(createBioBlock('header', 'h'))).toBeNull()
  })

  it('flags a schedule that ends before it starts', () => {
    expect(
      bioBlockProblem(
        link({
          startsAt: '2026-11-20T00:00:00.000Z',
          endsAt: '2026-11-19T00:00:00.000Z',
        }),
      ),
    ).toMatch(/depois do início/)
  })
})

describe('datetime-local helpers', () => {
  it('round-trips an instant through the browser-local input value', () => {
    const iso = '2026-11-19T15:30:00.000Z'
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso)
  })

  it('handles empty and invalid values', () => {
    expect(toLocalInput(null)).toBe('')
    expect(toLocalInput('nope')).toBe('')
    expect(fromLocalInput('')).toBeNull()
    expect(fromLocalInput('nope')).toBeNull()
  })
})
