import { McpError } from '@modelcontextprotocol/sdk/types.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mcpGrant } from './mcp.fixtures'

const env = vi.hoisted(() => ({ dsn: undefined as string | undefined }))
const sentry = vi.hoisted(() => ({ captureException: vi.fn() }))

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/env/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env/env')>()
  return {
    ...actual,
    get NEXT_PUBLIC_SENTRY_DSN() {
      return env.dsn
    },
  }
})
vi.mock('@sentry/nextjs', () => sentry)

import { logger } from '@/lib/axiom/logger'
import {
  logMcpRejected,
  logMcpToolCall,
  logMcpToolsList,
  MCP_INTERNAL_ERROR_MESSAGE,
  reportMcpError,
  withMcpErrorReport,
} from '@/src/lib/mcp/telemetry'

beforeEach(() => {
  vi.clearAllMocks()
  env.dsn = undefined
})

describe('logMcpToolCall()', () => {
  it('should log the call columns and keep payload-free detail', () => {
    logMcpToolCall(mcpGrant(), {
      tool: { name: 'sd_list', kind: 'READ', module: 'SERVICE_DESK' },
      outcome: 'ok',
      durationMs: 12,
      via: 'steel_call_tool',
    })
    expect(logger.info).toHaveBeenCalledWith('mcp.tool_call', {
      component: 'McpServer',
      event: 'tool_call',
      source: 'mcp',
      workspaceId: 'ws1',
      userId: 'u1',
      clientId: 'client1',
      toolName: 'sd_list',
      kind: 'READ',
      module: 'SERVICE_DESK',
      outcome: 'ok',
      durationMs: 12,
      detail: JSON.stringify({
        grantId: 'g1',
        clientName: 'Claude',
        via: 'steel_call_tool',
      }),
    })
  })

  it('should log failures at error level with the code and PLATFORM module', () => {
    logMcpToolCall(mcpGrant(), {
      tool: { name: 'ws_overview', kind: 'READ', module: null },
      outcome: 'failed',
      errorCode: 'INTERNAL_SERVER_ERROR',
      durationMs: 3,
    })
    const [message, fields] = vi.mocked(logger.error).mock.calls[0]
    expect(message).toBe('mcp.tool_call')
    expect(fields).toMatchObject({
      module: 'PLATFORM',
      outcome: 'failed',
      errorCode: 'INTERNAL_SERVER_ERROR',
    })
    expect(JSON.parse(String(fields?.detail))).toEqual({
      grantId: 'g1',
      clientName: 'Claude',
    })
  })
})

describe('logMcpToolsList() / logMcpRejected()', () => {
  it('should log the listing size', () => {
    logMcpToolsList(mcpGrant(), { listed: 29, hidden: 15 })
    expect(logger.info).toHaveBeenCalledWith(
      'mcp.tools_list',
      expect.objectContaining({ count: 29, detail: '{"hidden":15}' }),
    )
  })

  it('should log a rejection with and without a grant', () => {
    logMcpRejected({ reason: 'invalid_token', errorCode: 'UNAUTHORIZED' })
    expect(logger.warn).toHaveBeenLastCalledWith('mcp.rejected', {
      component: 'McpServer',
      event: 'rejected',
      source: 'mcp',
      reason: 'invalid_token',
      errorCode: 'UNAUTHORIZED',
    })

    logMcpRejected({ reason: 'rate_limited_client', grant: mcpGrant() })
    expect(logger.warn).toHaveBeenLastCalledWith('mcp.rejected', {
      component: 'McpServer',
      event: 'rejected',
      source: 'mcp',
      reason: 'rate_limited_client',
      workspaceId: 'ws1',
      userId: 'u1',
      clientId: 'client1',
    })
  })
})

describe('reportMcpError()', () => {
  it('should stay inert without a DSN', async () => {
    await reportMcpError(new Error('x'), { method: 'tools/call', client: 'c' })
    expect(sentry.captureException).not.toHaveBeenCalled()
  })

  it('should capture with tags only', async () => {
    env.dsn = 'https://k@sentry.example/1'
    const cause = new Error('boom')
    await reportMcpError(cause, {
      method: 'tools/call',
      tool: 'sd_list',
      client: 'c1',
    })
    expect(sentry.captureException).toHaveBeenCalledWith(cause, {
      tags: {
        component: 'mcp',
        'mcp.method': 'tools/call',
        'mcp.client': 'c1',
        'mcp.tool': 'sd_list',
      },
    })

    await reportMcpError(cause, { method: 'resources/list', client: 'c1' })
    expect(sentry.captureException).toHaveBeenLastCalledWith(cause, {
      tags: {
        component: 'mcp',
        'mcp.method': 'resources/list',
        'mcp.client': 'c1',
      },
    })
  })

  it('should never throw when Sentry fails', async () => {
    env.dsn = 'https://k@sentry.example/1'
    sentry.captureException.mockImplementationOnce(() => {
      throw new Error('sdk down')
    })
    await expect(
      reportMcpError(new Error('x'), { method: 'm', client: 'c' }),
    ).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      'mcp.sentry_report_failed',
      expect.objectContaining({ message: 'sdk down' }),
    )
  })
})

describe('withMcpErrorReport()', () => {
  it('should pass results and protocol errors through', async () => {
    const grant = mcpGrant()
    await expect(
      withMcpErrorReport(grant, 'tools/list', {}, async () => 1),
    ).resolves.toBe(1)
    const protocol = new McpError(-32602, 'bad')
    await expect(
      withMcpErrorReport(grant, 'tools/call', {}, async () => {
        throw protocol
      }),
    ).rejects.toBe(protocol)
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('should report anything else and answer a generic internal error', async () => {
    env.dsn = 'https://k@sentry.example/1'
    const run = withMcpErrorReport(
      mcpGrant(),
      'tools/call',
      { params: { name: 'sd_list', arguments: { cpf: '123' } } },
      async () => {
        throw new Error('db exploded')
      },
    )
    await expect(run).rejects.toMatchObject({
      code: -32603,
      message: expect.stringContaining(MCP_INTERNAL_ERROR_MESSAGE),
    })
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ 'mcp.tool': 'sd_list' }),
      }),
    )
    expect(JSON.stringify(sentry.captureException.mock.calls)).not.toContain(
      '123',
    )
    expect(logger.error).toHaveBeenCalledWith(
      'mcp.handler_failed',
      expect.objectContaining({ toolName: 'sd_list', message: 'db exploded' }),
    )
  })

  it('should not tag a tool outside tools/call and accept non-Error throws', async () => {
    await expect(
      withMcpErrorReport(
        mcpGrant(),
        'prompts/get',
        { params: { name: 'p' } },
        async () => {
          throw 'plain'
        },
      ),
    ).rejects.toBeInstanceOf(McpError)
    expect(logger.error).toHaveBeenCalledWith(
      'mcp.handler_failed',
      expect.objectContaining({ toolName: undefined, message: 'plain' }),
    )
  })
})
