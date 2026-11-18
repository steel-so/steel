import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { applySiteAiEvent } from '@/src/hooks/use-site-ai'
import { encodeSiteAiEvent } from '@/src/lib/site-ai/sse'
import type {
  SiteAiContextDTO,
  SiteAiEvent,
  SiteAiLinkDTO,
} from '@/types/site-ai'
import type { AiChatModelDTO } from '@/types/steel-ai'
import {
  displayLink,
  GenerateWithField,
  InspirationField,
  InspirationLinkStatus,
  normalizeInspirationLink,
} from '../ai/site-ai-inspiration'
import { toGenerateInput } from '../ai/site-ai-wizard'
import { NewSiteDialog } from '../new-site-dialog'
import { fakeSite, WS } from './harness'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

const BASE = `/api/workspaces/${WS}/crm/sites`

const CLAUDE: AiChatModelDTO = {
  key: 'anthropic:claude-sonnet-5',
  provider: 'anthropic',
  providerLabel: 'Anthropic (Claude)',
  label: 'Claude Sonnet 5',
  inputUsdPer1M: 2,
  outputUsdPer1M: 10,
}
const GPT: AiChatModelDTO = {
  key: 'openai:gpt-5-mini',
  provider: 'openai',
  providerLabel: 'OpenAI',
  label: 'GPT-5 mini',
  inputUsdPer1M: 0.25,
  outputUsdPer1M: 2,
}

const estimate = (usd: number, model: string) => ({
  planUsd: usd,
  pageUsd: usd,
  sectionUsd: usd,
  rewriteUsd: usd,
  imagesUsd: usd,
  model,
})

function context(overrides: Partial<SiteAiContextDTO> = {}): SiteAiContextDTO {
  return {
    available: true,
    unavailableReason: null,
    brand: {
      companyName: 'Padaria',
      logoUrl: '',
      primaryColor: '',
      website: '',
    },
    products: [],
    forms: [],
    canCreateForm: false,
    quota: { usedUsd: 0, quotaUsd: 50, remainingUsd: 50, exceeded: false },
    estimate: estimate(0.02, 'Claude Sonnet 5'),
    models: [CLAUDE, GPT],
    estimates: {
      [CLAUDE.key]: estimate(0.02, 'Claude Sonnet 5'),
      [GPT.key]: estimate(0.01, 'GPT-5 mini'),
    },
    defaultModelKey: CLAUDE.key,
    ...overrides,
  }
}

function Harness({
  initial = [],
  onChange,
}: {
  initial?: string[]
  onChange?: (links: string[], focus: string) => void
}) {
  const [links, setLinks] = useState<string[]>(initial)
  const [focus, setFocus] = useState('')
  return (
    <InspirationField
      links={links}
      images={[]}
      focus={focus}
      onLinksChange={(next) => {
        setLinks(next)
        onChange?.(next, focus)
      }}
      onImagesChange={() => {}}
      onFocusChange={(next) => {
        setFocus(next)
        onChange?.(links, next)
      }}
    />
  )
}

const addLink = (value: string) => {
  fireEvent.change(screen.getByLabelText('Link de inspiração'), {
    target: { value },
  })
  fireEvent.click(screen.getByRole('button', { name: /Adicionar/ }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('InspirationField', () => {
  it('adds links as removable chips and normalizes a bare domain', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    addLink('exemplo.com.br/loja')
    expect(screen.getByText('exemplo.com.br/loja')).toBeTruthy()
    expect(onChange).toHaveBeenLastCalledWith(
      ['https://exemplo.com.br/loja'],
      '',
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Remover exemplo.com.br/loja' }),
    )
    expect(screen.queryByText('exemplo.com.br/loja')).toBeNull()
  })

  it('adds with Enter', () => {
    render(<Harness />)
    const input = screen.getByLabelText('Link de inspiração')
    fireEvent.change(input, { target: { value: 'https://a.example.com' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('a.example.com')).toBeTruthy()
  })

  it.each([
    'texto solto',
    'ftp://example.com',
    'javascript:alert(1)',
    'https://user:pw@example.com',
    'https://example.com:8443',
  ])('refuses %s with a message', (value) => {
    render(<Harness />)
    addLink(value)
    expect(screen.getByRole('alert').textContent).toBeTruthy()
    expect(
      screen.queryByRole('list', { name: 'Links de inspiração' }),
    ).toBeNull()
  })

  it('refuses a repeated link', () => {
    render(<Harness initial={['https://a.example.com/']} />)
    addLink('https://a.example.com/')
    expect(screen.getByRole('alert').textContent).toBe(
      'Este link já foi adicionado.',
    )
  })

  it('stops at five links', () => {
    render(
      <Harness
        initial={[1, 2, 3, 4, 5].map((n) => `https://s${n}.example.com/`)}
      />,
    )
    const input = screen.getByLabelText(
      'Link de inspiração',
    ) as HTMLInputElement
    expect(input.disabled).toBe(true)
    expect(input.placeholder).toBe('Limite de 5 links')
    expect(
      (screen.getByRole('button', { name: /Adicionar/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('shows the "o que aproveitar" note only once there is a link', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    expect(screen.queryByLabelText(/O que aproveitar/)).toBeNull()
    addLink('https://a.example.com')
    fireEvent.change(screen.getByLabelText(/O que aproveitar/), {
      target: { value: 'cores' },
    })
    expect(onChange).toHaveBeenLastCalledWith(
      ['https://a.example.com'],
      'cores',
    )
  })
})

describe('link helpers', () => {
  it('normalizes and displays links', () => {
    expect(normalizeInspirationLink(' exemplo.com ')).toBe(
      'https://exemplo.com',
    )
    expect(normalizeInspirationLink('http://x.com')).toBe('http://x.com')
    expect(displayLink('https://www.x.com/a/b?q=1')).toBe('www.x.com/a/b')
    expect(displayLink('https://www.x.com/')).toBe('www.x.com')
    expect(displayLink('lixo')).toBe('lixo')
  })
})

describe('InspirationLinkStatus', () => {
  it('shows reading, read and could-not-read with the reason', () => {
    const links: SiteAiLinkDTO[] = [
      { url: 'https://a.example', status: 'reading', message: null },
      { url: 'https://b.example', status: 'read', message: null },
      {
        url: 'https://c.example',
        status: 'failed',
        message: 'O site demorou demais para responder.',
      },
    ]
    render(<InspirationLinkStatus links={links} />)
    const items = screen.getAllByRole('listitem')
    expect(items.map((item) => item.getAttribute('data-status'))).toEqual([
      'reading',
      'read',
      'failed',
    ])
    expect(items[0].textContent).toContain('lendo…')
    expect(items[1].textContent).toContain('lido')
    expect(items[2].textContent).toContain('não foi possível ler')
    expect(items[2].textContent).toContain('O site demorou demais')
  })

  it('renders nothing without links', () => {
    const { container } = render(<InspirationLinkStatus links={[]} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('GenerateWithField', () => {
  it('shows a single model as plain text, not a menu', () => {
    render(
      <GenerateWithField models={[GPT]} value={GPT.key} onChange={vi.fn()} />,
    )
    expect(screen.getByText('OpenAI · GPT-5 mini')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('offers a picker when there are several models', () => {
    render(
      <GenerateWithField
        models={[CLAUDE, GPT]}
        value={CLAUDE.key}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Modelo: Claude Sonnet 5')).toBeTruthy()
  })

  it('renders nothing without models', () => {
    const { container } = render(
      <GenerateWithField models={[]} value='' onChange={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })
})

describe('toGenerateInput — inspiration and model', () => {
  const brief = {
    name: 'Pão',
    business: 'Padaria artesanal',
    audience: '',
    goal: 'leads' as const,
    tone: 'friendly' as const,
    pages: [],
    style: 'auto' as const,
    primaryColor: '',
    useLogo: false,
    productIds: [],
    form: 'none',
    eventDate: '',
    extra: '',
    inspirationLinks: ['https://a.example.com/'],
    inspirationImages: [],
    inspirationFocus: ' cores ',
    modelKey: GPT.key,
  }

  it('sends the links, the trimmed note and the chosen model', () => {
    expect(toGenerateInput(brief, context())).toMatchObject({
      inspirationLinks: ['https://a.example.com/'],
      inspirationFocus: 'cores',
      modelKey: GPT.key,
    })
  })

  it('omits the inspiration without links and the model when unknown', () => {
    const body = toGenerateInput(
      { ...brief, inspirationLinks: [], modelKey: 'openai:unlisted' },
      context(),
    )
    expect(body).not.toHaveProperty('inspirationLinks')
    expect(body).not.toHaveProperty('inspirationFocus')
    expect(body).not.toHaveProperty('modelKey')
  })
})

describe('applySiteAiEvent — links', () => {
  it('tracks each link and keeps the final list on done', () => {
    let state = applySiteAiEvent(
      { status: 'idle' },
      { type: 'steps', steps: [] },
    )
    state = applySiteAiEvent(state, {
      type: 'link',
      index: 1,
      link: { url: 'https://b.example', status: 'reading', message: null },
    })
    expect(state.status === 'running' && state.links[1]?.status).toBe('reading')
    const final: SiteAiLinkDTO[] = [
      { url: 'https://a.example', status: 'read', message: null },
      { url: 'https://b.example', status: 'failed', message: 'erro' },
    ]
    state = applySiteAiEvent(state, {
      type: 'done',
      site: fakeSite({ id: 's' }),
      costUsd: 0,
      warnings: [],
      links: final,
      modelKey: CLAUDE.key,
    })
    expect(state).toMatchObject({ status: 'done', links: final })
    const failed = applySiteAiEvent(state, {
      type: 'error',
      code: 'X',
      message: 'm',
    })
    expect(failed).toMatchObject({ status: 'error', links: final })
  })
})

// ─── wizard integration ──────────────────────────────────────────────────

function stream(events: SiteAiEvent[]): Response {
  return new Response(events.map(encodeSiteAiEvent).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function openWizard(ctx: SiteAiContextDTO, events: SiteAiEvent[] = []) {
  const spy = mockFetch([
    {
      method: 'POST',
      match: `${BASE}/ai/generate`,
      handler: () => stream(events),
    },
    { match: `${BASE}/ai`, data: ctx },
  ])
  renderWithQuery(
    <NewSiteDialog open onOpenChange={vi.fn()} workspaceId={WS} slug='acme' />,
  )
  fireEvent.click(screen.getByTestId('site-template-ai'))
  return spy
}

describe('Gerar com IA — inspiration and model in the dialog', () => {
  it('sends links and the default model, and shows per-link status', async () => {
    const spy = openWizard(context(), [
      {
        type: 'steps',
        steps: [
          {
            id: 'inspiration',
            label: 'Lendo as referências…',
            status: 'pending',
          },
        ],
      },
      {
        type: 'link',
        index: 0,
        link: { url: 'https://a.example.com', status: 'read', message: null },
      },
      {
        type: 'link',
        index: 1,
        link: {
          url: 'https://b.example.com',
          status: 'failed',
          message: 'Este endereço não é um site público.',
        },
      },
      {
        type: 'done',
        site: fakeSite({ id: 'site_ai' }),
        costUsd: 0.1,
        warnings: ['Não foi possível ler a referência https://b.example.com'],
        links: [
          { url: 'https://a.example.com', status: 'read', message: null },
          {
            url: 'https://b.example.com',
            status: 'failed',
            message: 'Este endereço não é um site público.',
          },
        ],
        modelKey: CLAUDE.key,
      },
    ])
    await screen.findByTestId('site-ai-form')
    expect(screen.getByLabelText('Modelo: Claude Sonnet 5')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('O que a empresa faz?'), {
      target: { value: 'Padaria artesanal com fermentação natural' },
    })
    addLink('a.example.com')
    addLink('b.example.com')
    fireEvent.click(screen.getByTestId('site-ai-submit'))

    const list = await screen.findByTestId('site-ai-links')
    await waitFor(() => {
      expect(list.textContent).toContain('não foi possível ler')
    })
    expect(list.textContent).toContain('Este endereço não é um site público.')
    expect(list.textContent).toContain('lido')

    const body = fetchBody(spy, `${BASE}/ai/generate`) as Record<
      string,
      unknown
    >
    expect(body.inspirationLinks).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ])
    expect(body.modelKey).toBe(CLAUDE.key)
  })

  it('shows a read-only model when the workspace has one provider', async () => {
    openWizard(
      context({
        models: [GPT],
        estimates: { [GPT.key]: estimate(0.01, 'GPT-5 mini') },
        defaultModelKey: GPT.key,
      }),
    )
    await screen.findByTestId('site-ai-form')
    expect(screen.getByText('OpenAI · GPT-5 mini')).toBeTruthy()
    expect(screen.queryByLabelText(/^Modelo:/)).toBeNull()
  })

  it('prices the estimate with the selected model', async () => {
    openWizard(
      context({
        models: [GPT],
        estimates: { [GPT.key]: estimate(0.01, 'GPT-5 mini') },
        defaultModelKey: GPT.key,
      }),
    )
    const cost = await screen.findByTestId('site-ai-cost')
    // plan + (1 home + 3 default pages) x US$ 0,01
    expect((cost.textContent ?? '').replace(/\s+/g, ' ')).toContain(
      'Custo estimado ≈ US$ 0,05',
    )
  })
})
