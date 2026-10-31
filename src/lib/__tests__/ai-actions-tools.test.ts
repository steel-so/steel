import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeAiActionConnector } from '@/src/__tests__/factories/nov-ai-actions.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { aiActionsDisabled, databaseError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/services/ai-action.service')

import { AiActionService } from '@/src/services/ai-action.service'
import {
  ACTION_AI_TOOLS,
  actListConnectorsTool,
  actLookupTool,
  actRunTool,
} from '../ai/tools/actions'
import { STEEL_AI_TOOLS } from '../ai/tools'

const service = vi.mocked(AiActionService)
const CTX = { workspaceId: 'ws1', actorId: 'u1', source: 'assistant' as const }

beforeEach(() => vi.clearAllMocks())

describe('act_* tools', () => {
  it('should be registered with the right kinds and flags', () => {
    expect(ACTION_AI_TOOLS.map((t) => [t.name, t.kind])).toEqual([
      ['act_list_connectors', 'READ'],
      ['act_lookup', 'READ'],
      ['act_run', 'ACTION'],
    ])
    for (const tool of ACTION_AI_TOOLS) {
      expect(STEEL_AI_TOOLS).toContain(tool)
      expect(tool.module).toBeNull()
    }
    expect(actRunTool.customerFacing).toBe(true)
    expect(actRunTool.annotations).toMatchObject({
      destructiveHint: true,
      openWorldHint: true,
    })
  })

  it('should list connectors for the model without secrets', async () => {
    service.listForAi.mockResolvedValue(
      ok([
        {
          ...createFakeAiActionConnector(),
          createdAt: 'x',
          updatedAt: 'y',
          headerNames: [],
          params: [{ name: 'orderId', description: 'N', required: true }],
        } as never,
      ]),
    )
    const out = expectOk(await actListConnectorsTool.execute(CTX, {}))
    expect(out.summary).toBe('1 conector(es) disponível(is)')
    expect(JSON.stringify(out.data)).toContain('consultar_pedido')
    expect(JSON.stringify(out.data)).not.toContain('urlTemplate')
    expect(expectOk(actListConnectorsTool.parse({}))).toEqual({})
  })

  it('should propagate a disabled workspace', async () => {
    service.listForAi.mockResolvedValue(err(aiActionsDisabled()))
    expectErr(
      await actListConnectorsTool.execute(CTX, {}),
      'AI_ACTIONS_DISABLED',
    )
  })

  it('should parse and delegate lookups and actions', async () => {
    const args = expectOk(
      actLookupTool.parse({ connector: 'consultar_pedido', params: { id: 1 } }),
    )
    expect(args).toEqual({ connector: 'consultar_pedido', params: { id: 1 } })
    expectErr(actLookupTool.parse({ params: {} }), 'VALIDATION_ERROR')

    service.invoke.mockResolvedValue(ok({ data: {}, summary: 's' }))
    await actLookupTool.execute(CTX, args)
    expect(service.invoke).toHaveBeenLastCalledWith(CTX, args, 'LOOKUP')
    await actRunTool.execute(CTX, args)
    expect(service.invoke).toHaveBeenLastCalledWith(CTX, args, 'ACTION')
  })

  it('should preview an action with the declared arguments', async () => {
    service.describe.mockResolvedValue(
      ok(
        createFakeAiActionConnector({
          id: 'c9',
          name: 'Redefinir senha',
          kind: 'ACTION',
          method: 'POST',
          params: [
            { name: 'email', description: '', required: true },
            { name: 'nota', description: '', required: false },
          ],
        }),
      ),
    )
    const preview = expectOk(
      await actRunTool.preview?.(CTX, {
        connector: 'redefinir_senha',
        params: { email: 'a@b.com' },
      }) ?? err(databaseError()),
    )
    expect(preview.title).toBe('Executar “Redefinir senha”')
    expect(preview.fields).toEqual([
      { label: 'email', after: 'a@b.com' },
      { label: 'nota', after: '—' },
    ])
    expect(preview.target?.id).toBe('c9')
  })

  it('should fail the preview of an unknown connector', async () => {
    service.describe.mockResolvedValue(err(databaseError()))
    expectErr(
      await (actRunTool.preview?.(CTX, { connector: 'x', params: {} }) ??
        err(databaseError())),
    )
  })
})
