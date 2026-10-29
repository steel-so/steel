import { describe, expect, it } from 'vitest'
import {
  findSimulationPreset,
  isSimulationChannel,
  SIMULATION_CHANNELS,
  SIMULATION_PERSONA_PRESETS,
} from '@/src/lib/steel-agents/simulation/personas'
import {
  buildAgentConversationAddendum,
  buildCustomerSystemPrompt,
  buildGenerationSystemPrompt,
  buildGenerationUserMessage,
  buildJudgeSystemPrompt,
  buildJudgeUserMessage,
  computeVerdict,
  parseCustomerTurn,
  parseGeneratedScenarios,
  parseJudgement,
  renderToolEvents,
  renderTranscript,
} from '@/src/lib/steel-agents/simulation/prompts'

describe('simulation personas', () => {
  it('should ship presets with unique keys and valid channels', () => {
    const keys = SIMULATION_PERSONA_PRESETS.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const preset of SIMULATION_PERSONA_PRESETS) {
      expect(isSimulationChannel(preset.channel)).toBe(true)
      expect(preset.criteria.length).toBeGreaterThan(0)
      expect(preset.openingMessage.length).toBeGreaterThan(0)
    }
  })

  it('should find a preset by key and reject unknown ones', () => {
    expect(findSimulationPreset('cold_lead')?.channel).toBe('EMAIL')
    expect(findSimulationPreset('nope')).toBeUndefined()
  })

  it('should validate channels', () => {
    expect(SIMULATION_CHANNELS.every(isSimulationChannel)).toBe(true)
    expect(isSimulationChannel('SMS')).toBe(false)
    expect(isSimulationChannel(null)).toBe(false)
  })
})

describe('prompts', () => {
  it('should describe the customer, scenario, channel and turn limit', () => {
    const prompt = buildCustomerSystemPrompt({
      persona: 'Cliente irritado',
      scenario: 'Internet fora',
      channel: 'WHATSAPP',
      maxTurns: 4,
    })
    expect(prompt).toContain('Cliente irritado')
    expect(prompt).toContain('Internet fora')
    expect(prompt).toContain('WhatsApp')
    expect(prompt).toContain('no máximo 4 mensagens')
  })

  it('should tell the agent it is talking to a customer', () => {
    const addendum = buildAgentConversationAddendum({ channel: 'EMAIL' })
    expect(addendum).toContain('E-mail')
    expect(addendum).toContain('simulated')
  })

  it('should build the judge prompts with every input', () => {
    expect(buildJudgeSystemPrompt()).toContain('score')
    const message = buildJudgeUserMessage({
      agentName: 'Triagem',
      agentInstructions: 'Classifique.',
      persona: 'P',
      scenario: 'S',
      channel: 'CHAT',
      criteria: ['A', 'B'],
      transcript: [
        { role: 'customer', text: 'Oi' },
        { role: 'agent', text: 'Olá' },
      ],
      toolEvents: [],
      endReason: 'O cliente encerrou',
    })
    expect(message).toContain('1. A')
    expect(message).toContain('2. B')
    expect(message).toContain('CLIENTE: Oi')
    expect(message).toContain('AGENTE: Olá')
    expect(message).toContain('encerrada: O cliente encerrou')
    expect(message).toContain('(nenhuma ferramenta usada)')
    expect(
      buildJudgeUserMessage({
        agentName: 'T',
        agentInstructions: 'I',
        persona: 'P',
        scenario: 'S',
        channel: 'CHAT',
        criteria: ['A'],
        transcript: [],
        toolEvents: [],
        endReason: null,
      }),
    ).toContain('(sem mensagens)')
  })

  it('should render tool events by outcome', () => {
    const text = renderToolEvents([
      {
        turn: 1,
        toolName: 'a',
        kind: 'READ',
        status: 'OK',
        title: '2 chamados',
        error: null,
      },
      {
        turn: 1,
        toolName: 'b',
        kind: 'UPDATE',
        status: 'SIMULATED',
        title: 'Atualizar',
        error: null,
      },
      {
        turn: 2,
        toolName: 'c',
        kind: 'CREATE',
        status: 'FAILED',
        title: null,
        error: 'boom',
      },
      {
        turn: 2,
        toolName: 'd',
        kind: 'READ',
        status: 'OK',
        title: null,
        error: null,
      },
      {
        turn: 2,
        toolName: 'e',
        kind: 'UPDATE',
        status: 'SIMULATED',
        title: null,
        error: null,
      },
      {
        turn: 2,
        toolName: 'f',
        kind: 'UPDATE',
        status: 'FAILED',
        title: null,
        error: null,
      },
    ])
    expect(text).toContain('ok: 2 chamados')
    expect(text).toContain('simulada: Atualizar')
    expect(text).toContain('falhou: boom')
    expect(text).toContain('ok: sem resumo')
    expect(text).toContain('simulada: sem prévia')
    expect(text).toContain('falhou: erro')
    expect(renderTranscript([])).toBe('(sem mensagens)')
  })

  it('should build the generation prompts', () => {
    expect(buildGenerationSystemPrompt()).toContain('criteria')
    const one = buildGenerationUserMessage({
      agentName: 'A',
      instructions: 'I',
      toolLabels: [],
      count: 1,
    })
    expect(one).toContain('Crie 1 cenário.')
    expect(one).toContain('nenhuma')
    const many = buildGenerationUserMessage({
      agentName: 'A',
      instructions: 'I',
      toolLabels: ['Consultar chamados'],
      count: 3,
      focus: ' cobrança ',
    })
    expect(many).toContain('Crie 3 cenários.')
    expect(many).toContain('Consultar chamados')
    expect(many).toContain('Foco pedido pelo administrador: cobrança')
  })
})

describe('parseCustomerTurn', () => {
  it('should read the JSON turn', () => {
    expect(
      parseCustomerTurn(
        JSON.stringify({ message: ' Oi ', end: false, reason: '' }),
      ),
    ).toEqual({ message: 'Oi', end: false, reason: '' })
    expect(
      parseCustomerTurn(
        JSON.stringify({ message: 'Valeu', end: true, reason: 'resolvido' }),
      ),
    ).toEqual({ message: 'Valeu', end: true, reason: 'resolvido' })
  })

  it('should extract JSON wrapped in text', () => {
    expect(
      parseCustomerTurn('Segue: {"message":"Oi","end":false,"reason":""} ok')
        .message,
    ).toBe('Oi')
  })

  it('should fall back to the raw text and tolerate wrong types', () => {
    expect(parseCustomerTurn('  só texto ')).toEqual({
      message: 'só texto',
      end: false,
      reason: '',
    })
    expect(parseCustomerTurn('[1,2]').message).toBe('[1,2]')
    expect(parseCustomerTurn('{ quebrado }').message).toBe('{ quebrado }')
    expect(parseCustomerTurn('{"message":5,"end":"sim"}')).toEqual({
      message: '',
      end: false,
      reason: '',
    })
  })
})

describe('parseJudgement and computeVerdict', () => {
  const criteria = ['A', 'B']

  it('should parse, clamp the score and align criteria', () => {
    const judged = parseJudgement(
      JSON.stringify({
        score: 130.4,
        goalAchieved: true,
        criteria: [{ criterion: 'x', met: true, evidence: 'trecho' }],
        summary: ' ok ',
      }),
      criteria,
    )
    expect(judged).toEqual({
      score: 100,
      goalAchieved: true,
      criteria: [
        { criterion: 'A', met: true, evidence: 'trecho' },
        { criterion: 'B', met: false, evidence: '' },
      ],
      summary: 'ok',
    })
    expect(parseJudgement('{"score":-5,"criteria":"x"}', criteria)?.score).toBe(
      0,
    )
  })

  it('should return null for unusable answers', () => {
    expect(parseJudgement('nada', criteria)).toBeNull()
    expect(parseJudgement('{"score":"alto"}', criteria)).toBeNull()
  })

  it('should pass only with the minimum score and every criterion met', () => {
    const met = [
      { criterion: 'A', met: true, evidence: '' },
      { criterion: 'B', met: true, evidence: '' },
    ]
    expect(computeVerdict({ score: 70, criteria: met }, 70)).toBe('PASS')
    expect(computeVerdict({ score: 69, criteria: met }, 70)).toBe('FAIL')
    expect(
      computeVerdict(
        { score: 95, criteria: [met[0], { ...met[1], met: false }] },
        70,
      ),
    ).toBe('FAIL')
  })
})

describe('parseGeneratedScenarios', () => {
  const valid = {
    label: 'Irritado',
    persona: 'P',
    scenario: 'S',
    channel: 'EMAIL',
    openingMessage: 'Oi',
    criteria: ['a', ' ', 'b'],
  }

  it('should keep valid drafts, cap them and default the channel', () => {
    const text = JSON.stringify({
      scenarios: [
        valid,
        { ...valid, channel: 'SMS', label: 'Outro' },
        { ...valid, label: 'Terceiro' },
      ],
    })
    const drafts = parseGeneratedScenarios(text, 2)
    expect(drafts).toHaveLength(2)
    expect(drafts[0]).toEqual({
      label: 'Irritado',
      persona: 'P',
      scenario: 'S',
      channel: 'EMAIL',
      openingMessage: 'Oi',
      criteria: ['a', 'b'],
    })
    expect(drafts[1].channel).toBe('WHATSAPP')
  })

  it('should drop incomplete drafts and malformed answers', () => {
    const text = JSON.stringify({
      scenarios: [
        null,
        'x',
        { ...valid, label: '' },
        { ...valid, criteria: [] },
        { ...valid, criteria: 'texto' },
      ],
    })
    expect(parseGeneratedScenarios(text, 5)).toEqual([])
    expect(parseGeneratedScenarios('nada', 5)).toEqual([])
    expect(parseGeneratedScenarios('{"scenarios":1}', 5)).toEqual([])
  })
})
