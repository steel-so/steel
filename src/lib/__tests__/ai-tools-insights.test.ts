import { describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/services/ai-insight.service')

import { STEEL_AI_TOOLS } from '@/src/lib/ai/tools'
import { wsInsightsTool } from '@/src/lib/ai/tools/insights'
import { validateToolRegistry } from '@/src/lib/ai/tools/registry'
import { AiInsightService } from '@/src/services/ai-insight.service'

const service = vi.mocked(AiInsightService)
const ctx = { workspaceId: 'ws1', actorId: 'u1', source: 'assistant' as const }

const INSIGHT = {
  id: 'i1',
  kind: 'SD_SLA_BREACH_FORECAST' as const,
  module: 'SERVICE_DESK' as const,
  severity: 'CRITICAL' as const,
  title: 'A fila de N1 deve estourar o SLA às 15:00',
  body: '3 chamados.',
  facts: [{ label: 'Chamados', value: '3' }],
  href: '/acme/servicedesk/risk',
  prompt: 'Quais chamados?',
  state: 'active' as const,
  snoozedUntil: null,
  firstSeenAt: '2026-10-18T12:00:00.000Z',
  lastSeenAt: '2026-10-18T12:00:00.000Z',
}

describe('ws_insights tool', () => {
  it('is a valid platform-level read tool in the registry', () => {
    expect(STEEL_AI_TOOLS).toContain(wsInsightsTool)
    expect(validateToolRegistry([wsInsightsTool])).toEqual([])
    expect(wsInsightsTool).toMatchObject({
      name: 'ws_insights',
      kind: 'READ',
      module: null,
    })
  })

  it('validates the arguments', () => {
    expect(expectOk(wsInsightsTool.parse({ module: 'CRM', limit: 5 }))).toEqual(
      { module: 'CRM', limit: 5 },
    )
    expect(
      expectOk(
        wsInsightsTool.parse(undefined as unknown as Record<string, unknown>),
      ),
    ).toEqual({})
    expectErr(wsInsightsTool.parse({ limit: 99 }), 'VALIDATION_ERROR')
  })

  it('returns the caller active insights with pt-BR labels', async () => {
    service.list.mockResolvedValue(
      ok({
        enabled: true,
        items: [INSIGHT],
        counts: { active: 4, snoozed: 0, dismissed: 1 },
      }),
    )
    const output = expectOk(
      await wsInsightsTool.execute(ctx, { module: 'SERVICE_DESK' }),
    )
    expect(service.list).toHaveBeenCalledWith('u1', 'ws1', {
      state: 'active',
      module: 'SERVICE_DESK',
      limit: 10,
    })
    expect(output).toEqual({
      data: {
        enabled: true,
        total: 4,
        insights: [
          {
            module: 'ServiceDesk',
            severity: 'Urgente',
            title: INSIGHT.title,
            body: INSIGHT.body,
            facts: INSIGHT.facts,
            href: INSIGHT.href,
          },
        ],
      },
      summary: '4 alerta(s) ativo(s)',
    })
  })

  it('explains an empty or disabled feed and propagates errors', async () => {
    service.list.mockResolvedValue(
      ok({
        enabled: true,
        items: [],
        counts: { active: 0, snoozed: 0, dismissed: 0 },
      }),
    )
    expect(expectOk(await wsInsightsTool.execute(ctx, {})).summary).toBe(
      'Nenhum alerta ativo',
    )
    service.list.mockResolvedValue(
      ok({
        enabled: false,
        items: [],
        counts: { active: 0, snoozed: 0, dismissed: 0 },
      }),
    )
    expect(
      expectOk(await wsInsightsTool.execute(ctx, { limit: 2 })).summary,
    ).toBe('IA proativa desligada no workspace')
    expect(service.list).toHaveBeenLastCalledWith(
      'u1',
      'ws1',
      expect.objectContaining({ limit: 2 }),
    )
    service.list.mockResolvedValue(
      err({ code: 'FORBIDDEN', message: 'Acesso negado' }),
    )
    expectErr(await wsInsightsTool.execute(ctx, {}), 'FORBIDDEN')
  })
})
