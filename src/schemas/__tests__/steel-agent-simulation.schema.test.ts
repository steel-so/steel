import { describe, expect, it } from 'vitest'
import {
  CreateSteelAgentSimulationSchema,
  GenerateSteelAgentScenariosSchema,
  ListSteelAgentSimulationsQuerySchema,
  SteelAgentSimulationScenarioSchema,
} from '../steel-agent-simulation.schema'

const scenario = {
  label: 'Cliente irritado',
  persona: 'Sem paciência',
  scenario: 'Internet fora',
  openingMessage: 'Cadê minha internet?',
  criteria: ['Reconhece o problema'],
}

describe('SteelAgentSimulationScenarioSchema', () => {
  it('should apply the defaults', () => {
    const parsed = SteelAgentSimulationScenarioSchema.parse(scenario)
    expect(parsed.channel).toBe('WHATSAPP')
    expect(parsed.maxTurns).toBe(6)
  })

  it('should accept a preset key and null', () => {
    expect(
      SteelAgentSimulationScenarioSchema.safeParse({
        ...scenario,
        personaKey: 'cold_lead',
      }).success,
    ).toBe(true)
    expect(
      SteelAgentSimulationScenarioSchema.safeParse({
        ...scenario,
        personaKey: null,
      }).success,
    ).toBe(true)
    expect(
      SteelAgentSimulationScenarioSchema.safeParse({
        ...scenario,
        personaKey: 'nope',
      }).success,
    ).toBe(false)
  })

  it.each([
    ['label', ''],
    ['persona', ' '],
    ['scenario', ''],
    ['openingMessage', ''],
    ['criteria', []],
    ['channel', 'SMS'],
    ['maxTurns', 1],
    ['maxTurns', 11],
  ])('should reject an invalid %s', (field, value) => {
    expect(
      SteelAgentSimulationScenarioSchema.safeParse({
        ...scenario,
        [field]: value,
      }).success,
    ).toBe(false)
  })

  it('should cap the criteria', () => {
    const criteria = Array.from({ length: 9 }, (_, i) => `c${i}`)
    expect(
      SteelAgentSimulationScenarioSchema.safeParse({ ...scenario, criteria })
        .success,
    ).toBe(false)
  })
})

describe('CreateSteelAgentSimulationSchema', () => {
  it('should default the pass score', () => {
    const parsed = CreateSteelAgentSimulationSchema.parse({
      scenarios: [scenario],
    })
    expect(parsed.passScore).toBe(70)
    expect(parsed.name).toBeUndefined()
  })

  it('should require between 1 and 10 scenarios', () => {
    expect(
      CreateSteelAgentSimulationSchema.safeParse({ scenarios: [] }).success,
    ).toBe(false)
    expect(
      CreateSteelAgentSimulationSchema.safeParse({
        scenarios: Array.from({ length: 11 }, () => scenario),
      }).success,
    ).toBe(false)
    expect(
      CreateSteelAgentSimulationSchema.safeParse({
        scenarios: Array.from({ length: 10 }, () => scenario),
      }).success,
    ).toBe(true)
  })

  it('should bound the pass score', () => {
    for (const passScore of [0, 101, 70.5]) {
      expect(
        CreateSteelAgentSimulationSchema.safeParse({
          passScore,
          scenarios: [scenario],
        }).success,
      ).toBe(false)
    }
  })
})

describe('GenerateSteelAgentScenariosSchema', () => {
  it('should default and bound the count', () => {
    expect(GenerateSteelAgentScenariosSchema.parse({}).count).toBe(3)
    expect(
      GenerateSteelAgentScenariosSchema.safeParse({ count: 7 }).success,
    ).toBe(false)
    expect(
      GenerateSteelAgentScenariosSchema.safeParse({ count: 0 }).success,
    ).toBe(false)
    expect(
      GenerateSteelAgentScenariosSchema.parse({ focus: ' cobrança ' }).focus,
    ).toBe('cobrança')
  })
})

describe('ListSteelAgentSimulationsQuerySchema', () => {
  it('should coerce and default the limit', () => {
    expect(ListSteelAgentSimulationsQuerySchema.parse({}).limit).toBe(20)
    expect(
      ListSteelAgentSimulationsQuerySchema.parse({ limit: '50' }).limit,
    ).toBe(50)
    expect(
      ListSteelAgentSimulationsQuerySchema.safeParse({ limit: '500' }).success,
    ).toBe(false)
  })
})
