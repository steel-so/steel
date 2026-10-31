import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SteelAgentDetail } from '@/app/_components/steel-agents/steel-agent-detail'
import { SteelAgentNew } from '@/app/_components/steel-agents/steel-agent-new'
import { SteelAgentsList } from '@/app/_components/steel-agents/steel-agents-list'
import { renderSteelAi } from '@/app/_components/steel-ai/__tests__/steel-ai-test-utils'
import { SteelAiSkillsPage } from '@/app/_components/steel-ai-skills/steel-ai-skills-page'
import { fetchBody, mockFetch } from '@/src/__tests__/component-utils'
import type { AiSkillListDTO } from '@/types/ai-skill'
import type {
  AiSkillTemplateDTO,
  AiTemplatesDTO,
  SteelAgentTemplateDTO,
} from '@/types/ai-template'
import type { SteelAgentDTO } from '@/types/steel-agent'
import { SteelAiTemplateGallery } from '../steel-ai-template-gallery'
import {
  agentInputFromTemplate,
  matchesModuleFilter,
  skillInputFromTemplate,
} from '../template-prefill'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/acme/ai/agents',
}))

afterEach(() => push.mockClear())

function agentTemplate(
  over: Partial<SteelAgentTemplateDTO> = {},
): SteelAgentTemplateDTO {
  return {
    id: 'sd-sla-em-risco',
    name: 'SLA em risco',
    description: 'Aponta chamados com SLA em risco.',
    category: 'SERVICE_DESK',
    modules: ['SERVICE_DESK'],
    instructions: 'Monitore o SLA.',
    tools: [
      {
        toolName: 'sd_sla_at_risk',
        label: 'Consultando SLA em risco',
        module: 'SERVICE_DESK',
        kind: 'READ',
        mode: 'AUTO',
      },
      {
        toolName: 'sd_add_internal_note',
        label: 'Registrando nota interna',
        module: 'SERVICE_DESK',
        kind: 'CREATE',
        mode: 'APPROVAL',
      },
    ],
    available: true,
    unavailableReason: null,
    triggerType: 'SCHEDULE',
    cron: '*/30 8-18 * * 1-5',
    scheduleLabel: 'Dias úteis, a cada 30 min (8h às 18h)',
    timezone: 'America/Sao_Paulo',
    eventKey: null,
    maxToolRounds: 8,
    ...over,
  }
}

const ZAP_TEMPLATE = agentTemplate({
  id: 'zap-conexoes-desconectadas',
  name: 'Conexões do WhatsApp desconectadas',
  description: 'Verifica se algum número caiu.',
  category: 'COMMUNICATION',
  modules: ['COMMUNICATION'],
  tools: [
    {
      toolName: 'zap_connections_status',
      label: 'Verificando conexões do WhatsApp',
      module: 'COMMUNICATION',
      kind: 'READ',
      mode: 'AUTO',
    },
  ],
  available: false,
  unavailableReason: 'Requer o módulo Comunicação habilitado.',
  scheduleLabel: 'A cada hora',
})

const USAGE_TEMPLATE = agentTemplate({
  id: 'ia-consumo-acima-do-ritmo',
  name: 'Consumo de IA acima do ritmo',
  description: 'Compara o gasto com a cota.',
  category: 'GOVERNANCE',
  modules: [],
  tools: [
    {
      toolName: 'ws_ai_usage',
      label: 'Consultando o consumo de IA',
      module: null,
      kind: 'READ',
      mode: 'AUTO',
    },
  ],
  scheduleLabel: 'Todo dia às 9h',
})

function skillTemplate(
  over: Partial<AiSkillTemplateDTO> = {},
): AiSkillTemplateDTO {
  return {
    id: 'consumo-ia',
    slug: 'consumo-ia',
    name: 'Consumo de IA',
    description: 'Gasto de IA contra a cota.',
    category: 'GOVERNANCE',
    modules: [],
    instructions: 'Mostre o consumo.',
    tools: [
      {
        toolName: 'ws_ai_usage',
        label: 'Consultando o consumo de IA',
        module: null,
        kind: 'READ',
        mode: 'AUTO',
      },
    ],
    available: true,
    unavailableReason: null,
    mode: 'EXPLORE',
    ...over,
  }
}

function templates(over: Partial<AiTemplatesDTO> = {}): AiTemplatesDTO {
  return {
    canUse: true,
    agentModeEnabled: true,
    agents: [agentTemplate(), ZAP_TEMPLATE, USAGE_TEMPLATE],
    skills: [
      skillTemplate(),
      skillTemplate({
        id: 'membros',
        slug: 'membros',
        name: 'Membros e convites',
        description: 'Quem está no workspace.',
      }),
    ],
    ...over,
  }
}

const CATALOG = {
  tools: [
    {
      name: 'sd_sla_at_risk',
      label: 'Consultando SLA em risco',
      description: 'SLA',
      module: 'SERVICE_DESK',
      kind: 'READ',
    },
    {
      name: 'sd_add_internal_note',
      label: 'Registrando nota interna',
      description: 'Nota',
      module: 'SERVICE_DESK',
      kind: 'CREATE',
    },
    {
      name: 'ws_ai_usage',
      label: 'Consultando o consumo de IA',
      description: 'Uso',
      module: null,
      kind: 'READ',
    },
  ],
  events: [],
  agentModeEnabled: true,
  canManage: true,
}

function agent(over: Partial<SteelAgentDTO> = {}): SteelAgentDTO {
  return {
    id: 'a1',
    name: 'SLA em risco',
    description: null,
    instructions: 'Monitore o SLA.',
    triggerType: 'SCHEDULE',
    cron: '*/30 8-18 * * 1-5',
    timezone: 'America/Sao_Paulo',
    eventKey: null,
    enabled: false,
    owner: { id: 'u1', name: 'Ana', email: 'ana@acme.com', image: null },
    createdById: 'u1',
    maxToolRounds: 8,
    monthlyRunCap: null,
    lastRunAt: null,
    nextRunAt: null,
    tools: [],
    lastRun: null,
    evalSetId: null,
    evalMinPassRate: 0.8,
    simGateEnabled: false,
    simGateMinPassRate: 0.8,
    delegateAgentIds: [],
    publishedVersionId: null,
    challengerVersionId: null,
    createdAt: '2026-10-08T12:00:00.000Z',
    updatedAt: '2026-10-08T12:00:00.000Z',
    ...over,
  }
}

describe('template helpers', () => {
  it('filters by module, platform and all', () => {
    expect(matchesModuleFilter({ modules: ['CRM'] }, 'ALL')).toBe(true)
    expect(matchesModuleFilter({ modules: ['CRM'] }, 'CRM')).toBe(true)
    expect(matchesModuleFilter({ modules: ['CRM'] }, 'SERVICE_DESK')).toBe(
      false,
    )
    expect(matchesModuleFilter({ modules: [] }, 'PLATFORM')).toBe(true)
    expect(matchesModuleFilter({ modules: ['CRM'] }, 'PLATFORM')).toBe(false)
  })

  it('pre-fills a paused agent owned by the current user', () => {
    expect(agentInputFromTemplate(agentTemplate(), 'u1')).toEqual({
      name: 'SLA em risco',
      description: 'Aponta chamados com SLA em risco.',
      instructions: 'Monitore o SLA.',
      triggerType: 'SCHEDULE',
      cron: '*/30 8-18 * * 1-5',
      timezone: 'America/Sao_Paulo',
      eventKey: null,
      enabled: false,
      ownerId: 'u1',
      maxToolRounds: 8,
      monthlyRunCap: null,
      tools: [
        { toolName: 'sd_sla_at_risk', mode: 'AUTO' },
        { toolName: 'sd_add_internal_note', mode: 'APPROVAL' },
      ],
    })
  })

  it('pre-fills a workspace skill', () => {
    expect(skillInputFromTemplate(skillTemplate())).toEqual({
      scope: 'WORKSPACE',
      slug: 'consumo-ia',
      name: 'Consumo de IA',
      description: 'Gasto de IA contra a cota.',
      instructions: 'Mostre o consumo.',
      mode: 'EXPLORE',
      toolNames: ['ws_ai_usage'],
    })
  })
})

describe('<SteelAiTemplateGallery />', () => {
  it('groups by category, explains tools and disables unavailable templates', () => {
    const onPick = vi.fn()
    renderSteelAi(
      <SteelAiTemplateGallery
        kind='agents'
        open
        onOpenChange={vi.fn()}
        templates={templates().agents}
        onPick={onPick}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Modelos de agentes' })
    expect(
      within(dialog).getByRole('region', { name: 'ServiceDesk' }),
    ).toBeTruthy()
    expect(
      within(dialog).getByRole('region', { name: 'Governança' }),
    ).toBeTruthy()

    const sla = within(dialog).getByRole('listitem', { name: 'SLA em risco' })
    expect(sla.textContent).toContain('Faz sozinho: Consultando SLA em risco')
    expect(sla.textContent).toContain(
      'Pede aprovação: Registrando nota interna',
    )
    expect(sla.textContent).toContain('Dias úteis, a cada 30 min (8h às 18h)')
    fireEvent.click(
      within(sla).getByRole('button', { name: 'Usar o modelo SLA em risco' }),
    )
    expect(onPick).toHaveBeenCalledWith(templates().agents[0])

    const zap = within(dialog).getByRole('listitem', {
      name: 'Conexões do WhatsApp desconectadas',
    })
    expect(zap.textContent).toContain('Requer o módulo Comunicação habilitado.')
    expect(
      (
        within(zap).getByRole('button', {
          name: 'Usar o modelo Conexões do WhatsApp desconectadas',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)

    const usage = within(dialog).getByRole('listitem', {
      name: 'Consumo de IA acima do ritmo',
    })
    expect(usage.textContent).toContain('Qualquer workspace')
  })

  it('filters by module', () => {
    renderSteelAi(
      <SteelAiTemplateGallery
        kind='agents'
        open
        onOpenChange={vi.fn()}
        templates={templates().agents}
        onPick={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Plataforma' }))
    expect(
      screen.getByRole('listitem', { name: 'Consumo de IA acima do ritmo' }),
    ).toBeTruthy()
    expect(screen.queryByRole('listitem', { name: 'SLA em risco' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'CRM' }))
    expect(screen.getByText('Nenhum modelo para este filtro.')).toBeTruthy()
  })

  it('warns that writes do not run with the agent mode off', () => {
    renderSteelAi(
      <SteelAiTemplateGallery
        kind='agents'
        open
        onOpenChange={vi.fn()}
        agentModeEnabled={false}
        templates={[agentTemplate()]}
        onPick={vi.fn()}
      />,
    )
    expect(
      screen.getByText('Com o modo agente desligado, só as leituras rodam.'),
    ).toBeTruthy()
  })

  it('shows skill commands and the ones already added', () => {
    const onPick = vi.fn()
    renderSteelAi(
      <SteelAiTemplateGallery
        kind='skills'
        open
        onOpenChange={vi.fn()}
        templates={templates().skills}
        takenSlugs={new Set(['membros'])}
        onPick={onPick}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Modelos de skills' })
    const usage = within(dialog).getByRole('listitem', {
      name: 'Consumo de IA',
    })
    expect(usage.textContent).toContain('/consumo-ia')
    expect(usage.textContent).toContain('Ask')
    expect(usage.textContent).toContain('Consulta: Consultando o consumo de IA')
    expect(usage.textContent).not.toContain('Já adicionada')
    const members = within(dialog).getByRole('listitem', {
      name: 'Membros e convites',
    })
    expect(members.textContent).toContain('Já adicionada')
    fireEvent.click(
      within(usage).getByRole('button', {
        name: 'Usar o modelo Consumo de IA',
      }),
    )
    expect(onPick).toHaveBeenCalledWith(templates().skills[0])
  })
})

describe('agents page entry point', () => {
  it('opens the gallery for admins and goes to the pre-filled editor', async () => {
    mockFetch([
      { match: /\/agents$/, data: [agent()] },
      { match: '/agents/catalog', data: CATALOG },
      { match: '/ai/templates', data: templates() },
    ])
    renderSteelAi(<SteelAgentsList workspaceId='ws_1' slug='acme' />)

    fireEvent.click(await screen.findByRole('button', { name: 'Modelos' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Modelos de agentes',
    })
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'Usar o modelo SLA em risco',
      }),
    )
    expect(push).toHaveBeenCalledWith(
      '/acme/ai/agents/new?template=sd-sla-em-risco',
    )
  })

  it('offers templates in the empty state', async () => {
    mockFetch([
      { match: /\/agents$/, data: [] },
      { match: '/agents/catalog', data: CATALOG },
      { match: '/ai/templates', data: templates() },
    ])
    renderSteelAi(<SteelAgentsList workspaceId='ws_1' slug='acme' />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Criar a partir de modelo' }),
    )
    expect(
      await screen.findByRole('dialog', { name: 'Modelos de agentes' }),
    ).toBeTruthy()
  })

  it('hides the entry point from members', async () => {
    mockFetch([
      { match: /\/agents$/, data: [agent()] },
      { match: '/agents/catalog', data: { ...CATALOG, canManage: false } },
      {
        match: '/ai/templates',
        data: templates({ canUse: false, agents: [], skills: [] }),
      },
    ])
    renderSteelAi(<SteelAgentsList workspaceId='ws_1' slug='acme' />)
    expect(await screen.findByText('SLA em risco')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Modelos' })).toBeNull()
    expect(screen.queryByText('Criar a partir de modelo')).toBeNull()
  })
})

describe('new agent from a template', () => {
  function setup() {
    return mockFetch([
      { match: '/agents/catalog', data: CATALOG },
      { match: '/ai/templates', data: templates() },
      {
        match: '/members',
        data: [{ userId: 'u1', name: 'Ana', email: 'ana@acme.com' }],
      },
      { method: 'POST', match: /\/agents$/, status: 201, data: agent() },
    ])
  }

  it('pre-fills the editor and creates the agent paused', async () => {
    const spy = setup()
    renderSteelAi(
      <SteelAgentNew
        workspaceId='ws_1'
        slug='acme'
        currentUserId='u1'
        templateId='sd-sla-em-risco'
      />,
    )
    expect(await screen.findByText('Modelo: SLA em risco.')).toBeTruthy()
    const name = (await screen.findByLabelText('Nome')) as HTMLInputElement
    expect(name.value).toBe('SLA em risco')
    expect(
      (screen.getByLabelText('Expressão cron') as HTMLInputElement).value,
    ).toBe('*/30 8-18 * * 1-5')
    expect(screen.getByText('Pausado')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Criar agente' }))
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/acme/ai/agents/a1?from=template'),
    )
    expect(fetchBody(spy, /\/agents$/)).toMatchObject({
      name: 'SLA em risco',
      triggerType: 'SCHEDULE',
      cron: '*/30 8-18 * * 1-5',
      enabled: false,
      ownerId: 'u1',
      tools: [
        { toolName: 'sd_sla_at_risk', mode: 'AUTO' },
        { toolName: 'sd_add_internal_note', mode: 'APPROVAL' },
      ],
    })
  })

  it('falls back to a blank editor for an unknown or unavailable template', async () => {
    setup()
    renderSteelAi(
      <SteelAgentNew
        workspaceId='ws_1'
        slug='acme'
        currentUserId='u1'
        templateId='zap-conexoes-desconectadas'
      />,
    )
    expect(
      await screen.findByText(
        'Modelo indisponível neste workspace. Comece do zero.',
      ),
    ).toBeTruthy()
    const name = (await screen.findByLabelText('Nome')) as HTMLInputElement
    expect(name.value).toBe('')
  })
})

describe('agent created from a template', () => {
  it('nudges to test first and can be dismissed', async () => {
    const spy = mockFetch([
      { match: /\/agents\/a1$/, data: agent() },
      { match: '/agents/catalog', data: CATALOG },
      { match: '/agents/a1/runs', data: [] },
      {
        method: 'POST',
        match: '/agents/a1/test',
        status: 202,
        data: { id: 'r1' },
      },
    ])
    renderSteelAi(
      <SteelAgentDetail
        workspaceId='ws_1'
        slug='acme'
        agentId='a1'
        currentUserId='u1'
        fromTemplate
      />,
    )
    const note = await screen.findByRole('note', {
      name: 'Teste o agente antes de ativar',
    })
    fireEvent.click(within(note).getByRole('button', { name: 'Testar agente' }))
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/acme/ai/agents/a1/runs/r1'),
    )
    expect(
      spy.mock.calls.some(([url]) => String(url).endsWith('/agents/a1/test')),
    ).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Dispensar aviso' }))
    expect(
      screen.queryByRole('note', { name: 'Teste o agente antes de ativar' }),
    ).toBeNull()
  })
})

describe('skills page templates', () => {
  function skills(canManageWorkspace: boolean): AiSkillListDTO {
    return {
      canManageWorkspace,
      skills: [
        {
          id: 'w1',
          kind: 'WORKSPACE',
          slug: 'membros',
          name: 'Membros',
          description: 'Membros',
          instructions: 'x',
          mode: null,
          toolNames: [],
          enabled: true,
          canEdit: canManageWorkspace,
          canToggle: false,
          canDelete: canManageWorkspace,
          updatedAt: '2026-10-08T12:00:00.000Z',
        },
      ],
    }
  }

  it('pre-fills the new skill form from a template', async () => {
    const spy = mockFetch([
      { match: /\/ai\/skills$/, data: skills(true) },
      { match: '/agents/catalog', data: CATALOG },
      { match: '/ai/templates', data: templates() },
      {
        method: 'POST',
        match: /\/ai\/skills$/,
        status: 201,
        data: skills(true).skills[0],
      },
    ])
    renderSteelAi(<SteelAiSkillsPage workspaceId='ws_1' slug='acme' />)

    fireEvent.click(await screen.findByRole('button', { name: 'Modelos' }))
    const gallery = await screen.findByRole('dialog', {
      name: 'Modelos de skills',
    })
    expect(
      within(gallery).getByRole('listitem', { name: 'Membros e convites' })
        .textContent,
    ).toContain('Já adicionada')
    fireEvent.click(
      within(gallery).getByRole('button', {
        name: 'Usar o modelo Consumo de IA',
      }),
    )

    const form = await screen.findByRole('dialog', { name: 'Nova skill' })
    expect(form.textContent).toContain('A partir do modelo “Consumo de IA”')
    expect(
      (within(form).getByLabelText('Nome') as HTMLInputElement).value,
    ).toBe('Consumo de IA')
    fireEvent.click(within(form).getByRole('button', { name: 'Criar skill' }))
    await waitFor(() =>
      expect(fetchBody(spy, /\/ai\/skills$/)).toMatchObject({
        scope: 'WORKSPACE',
        slug: 'consumo-ia',
        name: 'Consumo de IA',
        mode: 'EXPLORE',
        toolNames: ['ws_ai_usage'],
      }),
    )
  })

  it('hides templates from members', async () => {
    mockFetch([
      { match: /\/ai\/skills$/, data: skills(false) },
      { match: '/agents/catalog', data: { ...CATALOG, canManage: false } },
      {
        match: '/ai/templates',
        data: templates({ canUse: false, agents: [], skills: [] }),
      },
    ])
    renderSteelAi(<SteelAiSkillsPage workspaceId='ws_1' slug='acme' />)
    expect(await screen.findByText('/membros')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Modelos' })).toBeNull()
    expect(screen.queryByText('Criar a partir de modelo')).toBeNull()
  })
})
