import { describe, expect, it, vi } from 'vitest'
import { createFakeAiMessage } from '@/src/__tests__/factories/steel-ai.factory'
import type { SteelAiStreamEvent } from '@/types/steel-ai'
import { encodeSseEvent, steelAiSseResponse } from '../ai/sse'
import {
  capHistory,
  compactToolContent,
  HISTORY_MAX_CHARS,
  HISTORY_MAX_TOKENS,
  HISTORY_TOOL_RESULT_MAX_CHARS,
  toProviderHistory,
} from '../ai/steel-ai-history'
import {
  buildSteelAiSystemPrompt,
  formatPromptDate,
} from '../ai/steel-ai-prompt'
import {
  actionResultCallId,
  parseToolResult,
  serializeToolResult,
} from '../ai/tools/tool-result'

describe('tool-result', () => {
  it('should keep small payloads intact', () => {
    const payload = { status: 'done' as const, summary: 'ok', data: { a: 1 } }
    expect(JSON.parse(serializeToolResult(payload))).toEqual(payload)
    expect(serializeToolResult({ status: 'error' }, 5)).toBe(
      '{"status":"error"}',
    )
  })

  it('should truncate large data under the byte budget (multi-byte safe)', () => {
    const data = { items: Array.from({ length: 2_000 }, (_, i) => `ção ${i}`) }
    const text = serializeToolResult(
      { status: 'done', summary: 's', data },
      2_000,
    )
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(2_000)
    const parsed = JSON.parse(text)
    expect(parsed.truncated).toBe(true)
    expect(parsed.summary).toBe('s')
    expect(parsed.data.endsWith('…')).toBe(true)

    const executed = JSON.parse(
      serializeToolResult(
        { status: 'executed', note: 'Confirmada.', data },
        2_000,
      ),
    )
    expect(executed.note.startsWith('Confirmada. Resultado truncado')).toBe(
      true,
    )
  })

  it('should parse payloads leniently', () => {
    expect(parseToolResult('{"status":"executed","summary":"x"}')).toEqual({
      status: 'executed',
      summary: 'x',
    })
    expect(parseToolResult('{"foo":1}')).toEqual({ status: 'done' })
    expect(parseToolResult('null')).toEqual({ status: 'done' })
    expect(parseToolResult('texto')).toEqual({ status: 'done' })
    expect(actionResultCallId('a1')).toBe('action:a1')
  })
})

describe('capHistory()', () => {
  it('should keep recent rows within the budget and start at a USER row', () => {
    const rows = [
      createFakeAiMessage({ id: 'u1', role: 'USER', content: 'x'.repeat(50) }),
      createFakeAiMessage({
        id: 'a1',
        role: 'ASSISTANT',
        content: 'y'.repeat(50),
      }),
      createFakeAiMessage({
        id: 'a2',
        role: 'ASSISTANT',
        content: 'z',
        toolCalls: [{ id: 'c', name: 'n', arguments: {} }],
        raw: { provider: 'openai', content: [] },
      }),
      createFakeAiMessage({ id: 't1', role: 'TOOL', content: 'r' }),
      createFakeAiMessage({ id: 'u2', role: 'USER', content: 'oi' }),
      createFakeAiMessage({ id: 'a3', role: 'ASSISTANT', content: 'olá' }),
    ]
    expect(capHistory(rows).map((r) => r.id)).toEqual([
      'u1',
      'a1',
      'a2',
      't1',
      'u2',
      'a3',
    ])
    expect(capHistory(rows, 120).map((r) => r.id)).toEqual(['u2', 'a3'])
    expect(capHistory(rows, 1)).toEqual([])
  })
})

describe('history token budget', () => {
  it('should size the history cap by tokens (~4 chars each)', () => {
    expect(HISTORY_MAX_CHARS).toBe(HISTORY_MAX_TOKENS * 4)
  })

  it('should cut earlier tool results and count them cut', () => {
    const big = 'x'.repeat(HISTORY_TOOL_RESULT_MAX_CHARS + 500)
    expect(compactToolContent('short')).toBe('short')
    expect(compactToolContent(big)).toBe(
      `${'x'.repeat(HISTORY_TOOL_RESULT_MAX_CHARS)}… [resultado truncado]`,
    )
    const rows = [
      createFakeAiMessage({ id: 'u1', role: 'USER', content: 'liste' }),
      createFakeAiMessage({
        id: 'a1',
        role: 'ASSISTANT',
        content: '',
        toolCalls: [{ id: 'c1', name: 'sd_list', arguments: {} }],
      }),
      createFakeAiMessage({
        id: 't1',
        role: 'TOOL',
        toolCallId: 'c1',
        toolName: 'sd_list',
        content: 'y'.repeat(50_000),
      }),
    ]
    // 50k chars of result would blow the cap; cut, the turn fits.
    expect(capHistory(rows).map((r) => r.id)).toEqual(['u1', 'a1', 't1'])
    const history = toProviderHistory(rows, 'e agora?')
    const tool = history.find((m) => m.role === 'tool') as { content: string }
    expect(tool.content.length).toBeLessThan(HISTORY_TOOL_RESULT_MAX_CHARS + 30)
  })
})

describe('toProviderHistory()', () => {
  it('should rebuild rounds, inline decisions and answer interrupted calls', () => {
    const rows = [
      createFakeAiMessage({ role: 'TOOL', toolCallId: 'stray', content: '{}' }),
      createFakeAiMessage({ role: 'USER', content: 'Crie a tarefa' }),
      createFakeAiMessage({
        role: 'ASSISTANT',
        content: '',
        toolCalls: [
          { id: 'c1', name: 'crm_create_task', arguments: { t: 1 } },
          { id: 'c2', name: 'crm_list', arguments: {} },
        ],
        raw: { provider: 'anthropic', content: [{ type: 'tool_use' }] },
      }),
      createFakeAiMessage({
        role: 'TOOL',
        toolCallId: 'c1',
        toolName: 'crm_create_task',
        content: '{"status":"pending_confirmation"}',
      }),
      createFakeAiMessage({
        role: 'ASSISTANT',
        content: 'Propus.',
        raw: { x: 1 },
      }),
      createFakeAiMessage({
        role: 'TOOL',
        toolCallId: 'action:a1',
        toolName: 'crm_create_task',
        content: `{"status":"executed","data":"${'d'.repeat(3_000)}"}`,
      }),
    ]

    const history = toProviderHistory(rows, 'E agora?')

    expect(history[0]).toEqual({ role: 'user', content: 'Crie a tarefa' })
    expect(history[1]).toEqual({
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: 'c1', name: 'crm_create_task', arguments: { t: 1 } },
        { id: 'c2', name: 'crm_list', arguments: {} },
      ],
      raw: { provider: 'anthropic', content: [{ type: 'tool_use' }] },
    })
    expect(history[2]).toEqual({
      role: 'tool',
      toolCallId: 'c1',
      name: 'crm_create_task',
      content: '{"status":"pending_confirmation"}',
    })
    // c2 had no result row: a synthetic error keeps providers happy.
    expect(history[3]).toEqual(
      expect.objectContaining({
        role: 'tool',
        toolCallId: 'c2',
        name: 'crm_list',
      }),
    )
    expect(JSON.parse((history[3] as { content: string }).content).status).toBe(
      'error',
    )
    expect(history[4]).toEqual({ role: 'assistant', content: 'Propus.' })
    const last = history[5] as { role: string; content: string }
    expect(last.role).toBe('user')
    expect(last.content).toContain(
      '[Atualização do sistema sobre a ação proposta "crm_create_task"]',
    )
    expect(last.content.endsWith('\n\nE agora?')).toBe(true)
    expect(last.content.length).toBeLessThan(2_200)
    expect(history).toHaveLength(6)
  })

  it('should start a fresh conversation with just the user message', () => {
    expect(toProviderHistory([], 'Oi')).toEqual([
      { role: 'user', content: 'Oi' },
    ])
    expect(
      toProviderHistory(
        [
          createFakeAiMessage({
            role: 'TOOL',
            toolCallId: 'action:a',
            toolName: null,
            content: '{}',
          }),
        ],
        'Oi',
      )[0],
    ).toEqual({
      role: 'user',
      content: '[Atualização do sistema sobre a ação proposta ""] {}\n\nOi',
    })
  })
})

describe('toProviderHistory() — attachments', () => {
  it('should append attachment notes to earlier user messages', () => {
    const rows = [
      createFakeAiMessage({ id: 'u1', role: 'USER', content: 'Leia' }),
      createFakeAiMessage({ role: 'ASSISTANT', content: 'Li.' }),
    ]
    const history = toProviderHistory(
      rows,
      'E o prazo?',
      new Map([['u1', '<anexo nome="a.txt">x</anexo>']]),
    )
    expect(history[0]).toEqual({
      role: 'user',
      content: 'Leia\n\n<anexo nome="a.txt">x</anexo>',
    })
  })

  it('should send content parts and prefix decision notes to the text part', () => {
    const decision = createFakeAiMessage({
      role: 'TOOL',
      toolCallId: 'action:a',
      toolName: 't',
      content: '{}',
    })
    const parts = [
      { type: 'text' as const, text: 'Veja' },
      { type: 'image' as const, url: 'data:image/png;base64,AA' },
    ]
    expect(toProviderHistory([], parts)).toEqual([
      { role: 'user', content: parts },
    ])
    const [withNote] = toProviderHistory([decision], parts)
    const content = withNote.content as typeof parts
    expect(content[0].type).toBe('text')
    expect((content[0] as { text: string }).text).toMatch(
      /^\[Atualização do sistema[\s\S]*\n\nVeja$/,
    )
    expect(content[1]).toEqual(parts[1])

    const imageFirst = [{ type: 'image' as const, url: 'https://x/y.png' }]
    const [note] = toProviderHistory([decision], imageFirst)
    expect(note.content).toEqual([
      {
        type: 'text',
        text: '[Atualização do sistema sobre a ação proposta "t"] {}',
      },
      imageFirst[0],
    ])
  })
})

describe('buildSteelAiSystemPrompt()', () => {
  const base = {
    userName: 'Ana',
    workspaceName: 'Acme',
    now: new Date('2026-10-06T14:30:00.000Z'),
    timezone: 'America/Sao_Paulo',
  }

  it('should describe the context, modules and explore rules', () => {
    const prompt = buildSteelAiSystemPrompt({
      ...base,
      modules: ['COMMUNICATION', 'SERVICE_DESK'],
      mode: 'EXPLORE',
    })
    expect(prompt).toContain('Usuário: Ana')
    expect(prompt).toContain('Workspace: Acme')
    // Knowledge questions go to steel_search, with linked citations.
    expect(prompt).toContain('steel_search')
    expect(prompt).toContain('[Título](href)')
    expect(prompt).toContain('6 de outubro de 2026')
    expect(prompt).toContain('11:30')
    expect(prompt.indexOf('- ServiceDesk (')).toBeLessThan(
      prompt.indexOf('- Comunicação ('),
    )
    expect(prompt.indexOf('- ServiceDesk (')).toBeGreaterThan(0)
    expect(prompt).not.toContain('CRM (leads')
    expect(prompt).toContain('Modo atual: EXPLORAR')
  })

  it('should state the agent rules and the no-module case', () => {
    const prompt = buildSteelAiSystemPrompt({
      ...base,
      modules: [],
      mode: 'AGENT',
    })
    expect(prompt).toContain('Modo atual: BUILD')
    expect(prompt).toContain('nunca pergunte "posso prosseguir?"')
    expect(prompt).toContain('Nenhum módulo')
  })

  it('should state the autopilot rules and append extra sections', () => {
    const prompt = buildSteelAiSystemPrompt({
      ...base,
      modules: ['CRM'],
      mode: 'AUTOPILOT',
      sections: ['', '  Skills: /my-work ', 'Memória: x'],
    })
    expect(prompt).toContain('Modo atual: AUTOPILOT')
    expect(prompt).toContain('EXECUTA NA HORA')
    expect(prompt).toContain('<anexo nome="...">')
    expect(prompt.endsWith('\n\nSkills: /my-work\n\nMemória: x')).toBe(true)
  })

  it('should fall back to São Paulo for an invalid timezone', () => {
    expect(formatPromptDate(base.now, 'Not/AZone')).toBe(
      formatPromptDate(base.now, 'America/Sao_Paulo'),
    )
  })
})

describe('steelAiSseResponse()', () => {
  async function* events(
    list: SteelAiStreamEvent[],
    fail?: Error,
  ): AsyncGenerator<SteelAiStreamEvent> {
    for (const event of list) yield event
    if (fail) throw fail
  }

  it('should encode each event as an SSE frame', async () => {
    const response = steelAiSseResponse(
      events([
        { type: 'text.delta', delta: 'Olá' },
        { type: 'conversation.title', title: 'T' },
      ]),
    )
    expect(response.headers.get('Content-Type')).toBe(
      'text/event-stream; charset=utf-8',
    )
    expect(response.headers.get('X-Accel-Buffering')).toBe('no')
    expect(await response.text()).toBe(
      'event: text.delta\ndata: {"type":"text.delta","delta":"Olá"}\n\n' +
        'event: conversation.title\ndata: {"type":"conversation.title","title":"T"}\n\n',
    )
  })

  it('should turn a thrown iterator into an error frame', async () => {
    const onError = vi.fn()
    const response = steelAiSseResponse(events([], new Error('boom')), onError)
    const text = await response.text()
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
    expect(text).toContain('event: error')
    expect(text).toContain('INTERNAL_SERVER_ERROR')
    // Without a handler the error is still framed.
    expect(
      await steelAiSseResponse(events([], new Error('x'))).text(),
    ).toContain('event: error')
  })

  it('should keep draining after the client goes away', async () => {
    const seen: string[] = []
    async function* slow(): AsyncGenerator<SteelAiStreamEvent> {
      for (const delta of ['a', 'b', 'c']) {
        seen.push(delta)
        await new Promise((resolve) => setTimeout(resolve, 5))
        yield { type: 'text.delta', delta }
      }
    }
    const response = steelAiSseResponse(slow())
    const reader = response.body?.getReader()
    await reader?.read()
    await reader?.cancel()
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(seen).toEqual(['a', 'b', 'c'])
    expect(encodeSseEvent({ type: 'text.delta', delta: 'x' })).toBe(
      'event: text.delta\ndata: {"type":"text.delta","delta":"x"}\n\n',
    )
  })
})
