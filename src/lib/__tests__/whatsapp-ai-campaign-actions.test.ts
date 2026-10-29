import { describe, expect, it } from 'vitest'
import {
  AI_CAMPAIGN_MAX_ACTIONS_PER_REPLY,
  buildAiCampaignActionTools,
  buildAiCampaignSystemSection,
  isAiCampaignActionTool,
  parseAiCampaignActionCall,
  selectAiCampaignActionRequests,
} from '@/src/lib/whatsapp/ai-campaign-actions'
import type { AiCampaignAction } from '@/src/schemas/whatsapp-ai-campaign.schema'

const actions: AiCampaignAction[] = [
  {
    id: 'a1',
    kind: 'CLOSE',
    label: 'Pago',
    when: 'Cliente confirmou pagamento',
    statusIds: ['s1'],
  },
  {
    id: 'a2',
    kind: 'TRANSFER_TEAM',
    label: 'Negociação',
    when: 'Quer negociar',
    teamId: 't1',
  },
  { id: 'a3', kind: 'ADD_NOTE', label: 'Anotar', when: 'Informou preferência' },
  {
    id: 'a4',
    kind: 'WEBHOOK',
    label: 'Registrar nota',
    when: 'Deu a nota',
    url: 'https://hooks.example.com/nps',
    fields: [{ key: 'nota', description: 'Nota de 0 a 10' }],
  },
]

describe('buildAiCampaignActionTools()', () => {
  it('should create one tool per action with the rule in the description', () => {
    const tools = buildAiCampaignActionTools(actions)

    expect(tools.map((tool) => tool.name)).toEqual([
      'acao_campanha_1',
      'acao_campanha_2',
      'acao_campanha_3',
      'acao_campanha_4',
    ])
    expect(tools[0].description).toContain(
      'Use quando: Cliente confirmou pagamento',
    )
    expect(tools[0].parameters).toEqual(
      expect.objectContaining({ required: ['motivo'] }),
    )
    expect(tools[2].parameters).toEqual(
      expect.objectContaining({ required: ['motivo', 'nota'] }),
    )
    expect(tools[3].parameters).toEqual(
      expect.objectContaining({ required: ['motivo', 'nota'] }),
    )
  })
})

describe('parseAiCampaignActionCall()', () => {
  it('should map a tool call back to its action with what the AI filled', () => {
    expect(
      parseAiCampaignActionCall(actions, {
        id: 'c1',
        name: 'acao_campanha_4',
        arguments: { motivo: 'Respondeu 9', nota: '9' },
      }),
    ).toEqual({
      action: actions[3],
      reason: 'Respondeu 9',
      fields: { nota: '9' },
    })
    expect(
      parseAiCampaignActionCall(actions, {
        id: 'c2',
        name: 'acao_campanha_3',
        arguments: { motivo: 'x', nota: 'Prefere manhã' },
      })?.note,
    ).toBe('Prefere manhã')
  })

  it('should ignore unknown tools and default a missing reason', () => {
    expect(
      parseAiCampaignActionCall(actions, {
        id: 'c3',
        name: 'acao_campanha_9',
        arguments: {},
      }),
    ).toBeNull()
    expect(isAiCampaignActionTool('consultar_exame_agendado')).toBe(false)
    expect(
      parseAiCampaignActionCall(actions, {
        id: 'c4',
        name: 'acao_campanha_1',
        arguments: {},
      })?.reason,
    ).toBe('Sem motivo informado')
  })
})

describe('selectAiCampaignActionRequests()', () => {
  const request = (action: AiCampaignAction) => ({
    action,
    reason: 'r',
    fields: {},
  })

  it('should keep one terminal action and drop repeats', () => {
    const selected = selectAiCampaignActionRequests([
      request(actions[0]),
      request(actions[1]),
      request(actions[0]),
      request(actions[2]),
    ])
    expect(selected.map((item) => item.action.id)).toEqual(['a1', 'a3'])
  })

  it('should cap the actions per reply', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      request({ ...actions[2], id: `n${i}` }),
    )
    expect(selectAiCampaignActionRequests(many)).toHaveLength(
      AI_CAMPAIGN_MAX_ACTIONS_PER_REPLY,
    )
  })
})

describe('buildAiCampaignSystemSection()', () => {
  it('should carry the name, objective, instructions and the action rule', () => {
    const section = buildAiCampaignSystemSection({
      name: 'Cobrança outubro',
      objective: 'Receber as faturas',
      instructions: 'Seja cordial.',
      actions,
    })
    expect(section).toContain('## Campanha: Cobrança outubro')
    expect(section).toContain('Objetivo da campanha: Receber as faturas')
    expect(section).toContain('Seja cordial.')
    expect(section).toContain('acao_campanha_')
  })

  it('should not mention tools without actions', () => {
    expect(
      buildAiCampaignSystemSection({
        name: 'X',
        objective: null,
        instructions: '',
        actions: [],
      }),
    ).not.toContain('acao_campanha_')
  })
})

describe('SEND_PIX action', () => {
  const pix: AiCampaignAction = {
    id: 'p1',
    kind: 'SEND_PIX',
    label: 'Cobrar adesão',
    when: 'O cliente aceitou a proposta',
    amount: 99.9,
    description: 'Taxa de adesão',
  }

  it('is a tool the AI only has to justify: amount and text are fixed', () => {
    const [tool] = buildAiCampaignActionTools([pix])
    expect(tool.description).toContain('Enviar cobrança Pix')
    expect(tool.description).toContain('Use quando: O cliente aceitou')
    expect(tool.parameters).toEqual(
      expect.objectContaining({ required: ['motivo'] }),
    )
  })

  it('is not terminal: the AI keeps the conversation after charging', () => {
    const requests = selectAiCampaignActionRequests([
      { action: pix, reason: 'Aceitou', fields: {} },
      {
        action: {
          id: 'c1',
          kind: 'CLOSE',
          label: 'Fechar',
          when: 'x',
          statusIds: [],
        },
        reason: 'Fim',
        fields: {},
      },
    ])
    expect(requests.map((r) => r.action.id)).toEqual(['p1', 'c1'])
  })
})
