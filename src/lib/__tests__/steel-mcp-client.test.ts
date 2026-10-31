import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'

const sdk = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  listTools: vi.fn(),
  callTool: vi.fn(),
  transportArgs: [] as unknown[],
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = sdk.connect
    close = sdk.close
    listTools = sdk.listTools
    callTool = sdk.callTool
  },
}))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor(...args: unknown[]) {
      sdk.transportArgs = args
    }
  },
}))
vi.mock('@/src/lib/webhooks/url-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/webhooks/url-guard')>()),
  checkWebhookUrl: vi.fn(),
}))

import { checkWebhookUrl } from '@/src/lib/webhooks/url-guard'
import {
  callMcpTool,
  discoverMcpTools,
  MCP_RESULT_MAX_CHARS,
} from '../steel-agents/mcp-client'

const guard = vi.mocked(checkWebhookUrl)
const CONN = {
  url: 'https://mcp.example.com/mcp',
  headerName: 'Authorization',
  headerValue: 'Bearer t',
}

beforeEach(() => {
  sdk.connect.mockReset().mockResolvedValue(undefined)
  sdk.close.mockReset().mockResolvedValue(undefined)
  sdk.listTools.mockReset()
  sdk.callTool.mockReset()
  guard.mockReset().mockImplementation(async (raw) => ({
    ok: true,
    url: new URL(raw),
  }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}')),
  )
})

describe('discoverMcpTools', () => {
  it('should list tools with the auth header and no redirects', async () => {
    sdk.listTools.mockResolvedValue({
      tools: [
        {
          name: 'list_issues',
          description: 'Lista',
          inputSchema: { type: 'object', properties: {} },
          annotations: { readOnlyHint: true },
        },
        { name: 'create_issue' },
      ],
    })
    const tools = expectOk(await discoverMcpTools(CONN))
    expect(tools).toEqual([
      {
        name: 'list_issues',
        description: 'Lista',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
      },
      {
        name: 'create_issue',
        description: '',
        inputSchema: { type: 'object', properties: {} },
        readOnly: false,
      },
    ])
    const [url, options] = sdk.transportArgs as [
      URL,
      { requestInit: RequestInit; fetch: typeof fetch },
    ]
    expect(url.toString()).toBe('https://mcp.example.com/mcp')
    expect(options.requestInit).toEqual({
      redirect: 'error',
      headers: { Authorization: 'Bearer t' },
    })
    expect(sdk.close).toHaveBeenCalled()
  })

  it('should omit the header when there is no credential', async () => {
    sdk.listTools.mockResolvedValue({ tools: [] })
    expectOk(await discoverMcpTools({ ...CONN, headerValue: null }))
    expect(
      (sdk.transportArgs[1] as { requestInit: RequestInit }).requestInit,
    ).toEqual({ redirect: 'error' })
  })

  it('should refuse a blocked URL before connecting', async () => {
    guard.mockResolvedValue({ ok: false, reason: 'private_host' })
    const failed = await discoverMcpTools(CONN)
    expectErr(failed, 'STEEL_MCP_SERVER_UNREACHABLE')
    expect(failed.ok ? '' : failed.error.message).toContain('privado')
    expect(sdk.connect).not.toHaveBeenCalled()
  })

  it('should turn connection failures into an unreachable error', async () => {
    sdk.connect.mockRejectedValue(new Error('ECONNREFUSED'))
    const failed = await discoverMcpTools(CONN)
    expectErr(failed, 'STEEL_MCP_SERVER_UNREACHABLE')
    expect(failed.ok ? '' : failed.error.message).toContain('ECONNREFUSED')
    sdk.connect.mockRejectedValue('weird')
    expectErr(await discoverMcpTools(CONN), 'STEEL_MCP_SERVER_UNREACHABLE')
    sdk.connect.mockRejectedValue(new Error(''))
    expectErr(await discoverMcpTools(CONN), 'STEEL_MCP_SERVER_UNREACHABLE')
  })

  it('should survive a failing close', async () => {
    sdk.listTools.mockResolvedValue({ tools: [] })
    sdk.close.mockRejectedValue(new Error('x'))
    expectOk(await discoverMcpTools(CONN))
  })
})

describe('guarded fetch of the transport', () => {
  async function transportFetch() {
    sdk.listTools.mockResolvedValue({ tools: [] })
    await discoverMcpTools(CONN)
    return (sdk.transportArgs[1] as { fetch: typeof fetch }).fetch
  }

  it('should re-check every request and never follow redirects', async () => {
    const guarded = await transportFetch()
    await guarded('https://mcp.example.com/mcp', { method: 'POST' })
    await guarded(new URL('https://mcp.example.com/other'))
    await guarded(new Request('https://mcp.example.com/third'))
    expect(guard).toHaveBeenCalledWith('https://mcp.example.com/mcp')
    expect(guard).toHaveBeenCalledWith('https://mcp.example.com/other')
    expect(guard).toHaveBeenCalledWith('https://mcp.example.com/third')
    expect(vi.mocked(fetch).mock.calls[0][1]).toEqual(
      expect.objectContaining({ method: 'POST', redirect: 'error' }),
    )
  })

  it('should throw when a later request points somewhere blocked', async () => {
    const guarded = await transportFetch()
    guard.mockResolvedValue({ ok: false, reason: 'private_host' })
    await expect(guarded('https://169.254.169.254/')).rejects.toThrow(/privado/)
  })
})

describe('callMcpTool', () => {
  it('should join the text blocks and mark the others as omitted', async () => {
    sdk.callTool.mockResolvedValue({
      content: [
        { type: 'text', text: 'um' },
        { type: 'image', data: '...' },
        { type: 'text', text: 'dois' },
        null,
        { type: 'text' },
      ],
    })
    const out = expectOk(await callMcpTool(CONN, 'list_issues', { a: 1 }))
    expect(sdk.callTool).toHaveBeenCalledWith(
      { name: 'list_issues', arguments: { a: 1 } },
      undefined,
      { timeout: expect.any(Number) },
    )
    expect(out).toEqual({
      text: 'um\n[image omitido]\ndois\n[conteúdo omitido]\n',
      isError: false,
    })
  })

  it('should cap the text and carry the error flag', async () => {
    sdk.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'x'.repeat(MCP_RESULT_MAX_CHARS * 2) }],
      isError: true,
    })
    const out = expectOk(await callMcpTool(CONN, 't', {}))
    expect(out.text).toHaveLength(MCP_RESULT_MAX_CHARS)
    expect(out.isError).toBe(true)
  })

  it('should treat a missing content list as empty and report transport errors', async () => {
    sdk.callTool.mockResolvedValue({})
    expect(expectOk(await callMcpTool(CONN, 't', {}))).toEqual({
      text: '',
      isError: false,
    })
    sdk.callTool.mockRejectedValue(new Error('timeout'))
    expectErr(await callMcpTool(CONN, 't', {}), 'STEEL_MCP_SERVER_UNREACHABLE')
  })
})
