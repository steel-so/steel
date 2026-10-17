import { describe, expect, it } from 'vitest'
import {
  createFakeAiActionLog,
  createFakeAiAttachment,
  createFakeAiConversation,
  createFakeAiMessage,
  createFakeAiPendingAction,
} from '@/src/__tests__/factories/steel-ai.factory'
import { toAiActionLogDTO } from '../ai-action-log.mapper'
import { aiAttachmentUrl, toAiAttachmentDTO } from '../ai-attachment.mapper'
import {
  toAiConversationDTO,
  toAiMessageDTOs,
  toAiToolCallDTO,
  toolCallStatusOf,
} from '../ai-conversation.mapper'
import { toAiPendingActionDTO } from '../ai-pending-action.mapper'

const meta = (name: string) =>
  name === 'sd_list'
    ? { label: 'Consultando chamados', module: 'SERVICE_DESK' as const }
    : { label: name, module: null }

const at = (minute: number) =>
  new Date(`2026-10-06T12:${String(minute).padStart(2, '0')}:00.000Z`)

describe('toAiConversationDTO()', () => {
  it('should serialize dates and keep nullable fields', () => {
    const row = createFakeAiConversation({
      id: 'c1',
      pinnedAt: at(5),
      modelKey: 'openai:gpt-4o-mini',
    })
    expect(toAiConversationDTO(row)).toEqual({
      id: 'c1',
      title: 'Chamados da semana',
      mode: 'EXPLORE',
      modelKey: 'openai:gpt-4o-mini',
      pinnedAt: '2026-10-06T12:05:00.000Z',
      createdAt: '2026-10-06T12:00:00.000Z',
      updatedAt: '2026-10-06T12:00:00.000Z',
    })
    expect(toAiConversationDTO({ ...row, pinnedAt: null }).pinnedAt).toBeNull()
  })
})

describe('toAiPendingActionDTO()', () => {
  it('should expose preview and the result summary', () => {
    const row = createFakeAiPendingAction({
      id: 'a1',
      status: 'EXECUTED',
      result: { summary: 'Tarefa criada' },
      decidedAt: at(1),
      executedAt: at(2),
    })
    expect(toAiPendingActionDTO(row)).toEqual(
      expect.objectContaining({
        id: 'a1',
        status: 'EXECUTED',
        preview: { title: 'Criar tarefa', summary: 'Ligar para o cliente' },
        resultSummary: 'Tarefa criada',
        decidedAt: '2026-10-06T12:01:00.000Z',
        executedAt: '2026-10-06T12:02:00.000Z',
        expiresAt: '2026-10-06T12:30:00.000Z',
      }),
    )
  })

  it('should return a null summary for missing or malformed results', () => {
    expect(
      toAiPendingActionDTO(createFakeAiPendingAction()).resultSummary,
    ).toBe(null)
    expect(
      toAiPendingActionDTO(
        createFakeAiPendingAction({ result: { summary: 1 } }),
      ).resultSummary,
    ).toBeNull()
    expect(
      toAiPendingActionDTO(createFakeAiPendingAction({ result: { other: 1 } }))
        .resultSummary,
    ).toBeNull()
  })
})

describe('toAiActionLogDTO()', () => {
  it('should map every column', () => {
    const row = createFakeAiActionLog({ id: 'l1' })
    expect(toAiActionLogDTO(row)).toEqual({
      id: 'l1',
      source: 'ASSISTANT',
      actorId: row.actorId,
      agentId: null,
      pendingActionId: row.pendingActionId,
      toolName: 'crm_create_task',
      kind: 'CREATE',
      module: 'CRM',
      targetType: 'crm_task',
      targetId: row.targetId,
      outcome: 'success',
      summary: 'Tarefa criada',
      error: null,
      oauthClientId: null,
      createdAt: '2026-10-06T12:00:00.000Z',
    })
  })

  it('should carry the MCP source and client', () => {
    expect(
      toAiActionLogDTO(
        createFakeAiActionLog({ source: 'MCP', oauthClientId: 'client1' }),
      ),
    ).toMatchObject({ source: 'MCP', oauthClientId: 'client1' })
  })

  it('should classify a legacy free-text outcome by the error column', () => {
    expect(
      toAiActionLogDTO(createFakeAiActionLog({ outcome: 'Tarefa criada' }))
        .outcome,
    ).toBe('success')
    const failed = toAiActionLogDTO(
      createFakeAiActionLog({ outcome: 'Falhou', summary: null, error: 'x' }),
    )
    expect(failed).toMatchObject({ outcome: 'failure', summary: null })
    expect(
      toAiActionLogDTO(createFakeAiActionLog({ outcome: 'failure' })).outcome,
    ).toBe('failure')
  })
})

describe('toAiToolCallDTO() / toolCallStatusOf()', () => {
  it('should resolve label/module and omit an undefined summary', () => {
    expect(
      toAiToolCallDTO({ id: 'c', name: 'sd_list' }, meta, 'running'),
    ).toEqual({
      id: 'c',
      name: 'sd_list',
      label: 'Consultando chamados',
      module: 'SERVICE_DESK',
      status: 'running',
    })
  })

  it('should map payload statuses', () => {
    expect(toolCallStatusOf({ status: 'pending_confirmation' })).toBe(
      'pending_confirmation',
    )
    expect(toolCallStatusOf({ status: 'error' })).toBe('error')
    expect(toolCallStatusOf({ status: 'failed' })).toBe('error')
    expect(toolCallStatusOf({ status: 'canceled' })).toBe('error')
    expect(toolCallStatusOf({ status: 'executed' })).toBe('done')
    expect(toolCallStatusOf({ status: 'done' })).toBe('done')
  })
})

describe('toAiMessageDTOs()', () => {
  it('should fold tool rounds into one assistant turn per user message', () => {
    const rows = [
      createFakeAiMessage({ id: 'u1', role: 'USER', content: 'Quantos?' }),
      createFakeAiMessage({
        id: 'a1',
        role: 'ASSISTANT',
        content: 'Vou ver.',
        toolCalls: [
          { id: 'c1', name: 'sd_list', arguments: {} },
          { id: 'c2', name: 'crm_create_task', arguments: {} },
          { bogus: true },
        ],
        createdAt: at(1),
      }),
      createFakeAiMessage({
        id: 't1',
        role: 'TOOL',
        toolCallId: 'c1',
        content: JSON.stringify({ status: 'done', summary: '3 chamados' }),
      }),
      createFakeAiMessage({
        id: 't2',
        role: 'TOOL',
        toolCallId: 'c2',
        content: JSON.stringify({
          status: 'pending_confirmation',
          summary: 'Criar tarefa',
        }),
      }),
      createFakeAiMessage({ id: 'a2', role: 'ASSISTANT', content: '  ' }),
      createFakeAiMessage({ id: 'a3', role: 'ASSISTANT', content: 'São 3.' }),
      createFakeAiMessage({
        id: 't3',
        role: 'TOOL',
        toolCallId: 'action:act1',
        content: JSON.stringify({ status: 'executed', summary: 'Criada' }),
      }),
      createFakeAiMessage({ id: 'u2', role: 'USER', content: 'Valeu' }),
    ]
    const actions = [
      createFakeAiPendingAction({ id: 'act1', toolCallId: 'c2' }),
      createFakeAiPendingAction({ id: 'act2', toolCallId: null }),
    ]

    const dtos = toAiMessageDTOs(rows, actions, meta)

    expect(dtos.map((m) => [m.id, m.role])).toEqual([
      ['u1', 'USER'],
      ['a1', 'ASSISTANT'],
      ['u2', 'USER'],
    ])
    const turn = dtos[1]
    expect(turn.content).toBe('Vou ver.\n\nSão 3.')
    expect(turn.createdAt).toBe('2026-10-06T12:01:00.000Z')
    expect(turn.toolCalls).toEqual([
      expect.objectContaining({
        id: 'c1',
        status: 'done',
        summary: '3 chamados',
      }),
      expect.objectContaining({ id: 'c2', status: 'done', summary: 'Criada' }),
    ])
    expect(turn.pendingActions.map((a) => a.id)).toEqual(['act1'])
    expect(dtos[0].pendingActions).toEqual([])
  })

  it('should handle cancellations, errors, orphans and interrupted calls', () => {
    const rows = [
      createFakeAiMessage({ id: 'u1', role: 'USER' }),
      createFakeAiMessage({
        id: 'a1',
        role: 'ASSISTANT',
        content: '',
        toolCalls: [
          { id: 'c1', name: 'x', arguments: {} },
          { id: 'c2', name: 'y', arguments: {} },
          { id: 'c3', name: 'z', arguments: {} },
        ],
      }),
      createFakeAiMessage({
        role: 'TOOL',
        toolCallId: 'c2',
        content: JSON.stringify({
          status: 'error',
          error: { code: 'FORBIDDEN', message: 'Sem permissão' },
        }),
      }),
      createFakeAiMessage({
        role: 'TOOL',
        toolCallId: 'c3',
        content: 'texto solto',
      }),
      createFakeAiMessage({
        role: 'TOOL',
        toolCallId: 'unknown',
        content: '{}',
      }),
      createFakeAiMessage({
        role: 'TOOL',
        toolCallId: 'action:missing',
        content: JSON.stringify({ status: 'canceled' }),
      }),
      createFakeAiMessage({
        role: 'TOOL',
        toolCallId: 'action:act1',
        content: JSON.stringify({ status: 'canceled' }),
      }),
    ]
    const actions = [
      createFakeAiPendingAction({ id: 'act1', toolCallId: 'c3' }),
    ]

    const [, turn] = toAiMessageDTOs(rows, actions, meta)

    expect(turn.toolCalls.map((c) => [c.id, c.status, c.summary])).toEqual([
      ['c1', 'error', undefined],
      ['c2', 'error', 'Sem permissão'],
      ['c3', 'error', 'Ação cancelada'],
    ])
  })

  it('should open a turn for a leading TOOL row and tolerate null call ids', () => {
    const dtos = toAiMessageDTOs(
      [
        createFakeAiMessage({
          id: 't0',
          role: 'TOOL',
          toolCallId: null,
          content: '{}',
        }),
      ],
      [],
      meta,
    )
    expect(dtos).toEqual([
      expect.objectContaining({ id: 't0', role: 'ASSISTANT', content: '' }),
    ])
  })

  it('should keep the summary when the payload has none', () => {
    const [, turn] = toAiMessageDTOs(
      [
        createFakeAiMessage({ role: 'USER' }),
        createFakeAiMessage({
          role: 'ASSISTANT',
          toolCalls: [{ id: 'c1', name: 'x', arguments: {} }],
        }),
        createFakeAiMessage({
          role: 'TOOL',
          toolCallId: 'c1',
          content: JSON.stringify({ status: 'done' }),
        }),
      ],
      [],
      meta,
    )
    expect(turn.toolCalls[0]).not.toHaveProperty('summary')
    expect(turn.toolCalls[0].status).toBe('done')
  })
})

describe('toAiAttachmentDTO()', () => {
  it('should expose the file with its same-origin url', () => {
    const row = createFakeAiAttachment({
      id: 'a1',
      conversationId: 'c1',
      messageId: 'm1',
      kind: 'IMAGE',
      filename: 'foto.png',
      contentType: 'image/png',
      sizeBytes: 42,
    })
    expect(toAiAttachmentDTO(row, 'ws1')).toEqual({
      id: 'a1',
      conversationId: 'c1',
      messageId: 'm1',
      kind: 'IMAGE',
      filename: 'foto.png',
      contentType: 'image/png',
      sizeBytes: 42,
      url: '/api/workspaces/ws1/ai/conversations/c1/attachments/a1',
      createdAt: '2026-10-07T12:00:00.000Z',
    })
    expect(aiAttachmentUrl('w', { id: 'x', conversationId: 'y' })).toBe(
      '/api/workspaces/w/ai/conversations/y/attachments/x',
    )
  })
})

describe('Steel AI 2 fields', () => {
  it('should flag autopilot actions', () => {
    expect(
      toAiPendingActionDTO(createFakeAiPendingAction({ autoExecuted: true }))
        .autoExecuted,
    ).toBe(true)
  })

  it('should attach files only to their user message and default to none', () => {
    const user = createFakeAiMessage({
      id: 'm1',
      role: 'USER',
      createdAt: at(1),
    })
    const other = createFakeAiMessage({
      id: 'm2',
      role: 'USER',
      createdAt: at(2),
    })
    const loose = createFakeAiAttachment({ id: 'a0', messageId: null })
    const sent = createFakeAiAttachment({ id: 'a1', messageId: 'm1' })
    const dtos = toAiMessageDTOs([user, other], [], meta, {
      workspaceId: 'ws1',
      attachments: [loose, sent],
    })
    expect(dtos[0].attachments.map((a) => a.id)).toEqual(['a1'])
    expect(dtos[1].attachments).toEqual([])
    expect(toAiMessageDTOs([user], [], meta)[0].attachments).toEqual([])
  })
})
