import { describe, expect, it } from 'vitest'
import {
  isGuideConnected,
  MCP_CONNECT_GUIDES,
  mcpServerUrl,
} from '../mcp/connect-guides'

const guide = (id: string) => {
  const found = MCP_CONNECT_GUIDES.find((g) => g.id === id)
  if (!found) throw new Error(id)
  return found
}
const grant = (redirectHost: string | null, workspaceId = 'ws1') => ({
  redirectHost,
  workspace: { id: workspaceId, name: 'A', slug: 'a' },
})

describe('mcpServerUrl()', () => {
  it('appends /api/mcp without doubling slashes', () => {
    expect(mcpServerUrl('https://steel.example.com/')).toBe(
      'https://steel.example.com/api/mcp',
    )
    expect(mcpServerUrl('https://steel.example.com')).toBe(
      'https://steel.example.com/api/mcp',
    )
  })
})

describe('isGuideConnected()', () => {
  it('matches by redirect host and workspace', () => {
    expect(isGuideConnected(guide('claude'), [grant('claude.ai')], 'ws1')).toBe(
      true,
    )
    expect(
      isGuideConnected(guide('claude'), [grant('CLAUDE.COM')], 'ws1'),
    ).toBe(true)
    expect(
      isGuideConnected(guide('chatgpt'), [grant('claude.ai')], 'ws1'),
    ).toBe(false)
    expect(
      isGuideConnected(guide('claude'), [grant('claude.ai', 'x')], 'ws1'),
    ).toBe(false)
  })

  it('never matches without a host, nor for loopback apps', () => {
    expect(isGuideConnected(guide('claude'), [grant(null)], 'ws1')).toBe(false)
    expect(isGuideConnected(guide('gemini'), [grant('localhost')], 'ws1')).toBe(
      false,
    )
  })
})

describe('MCP_CONNECT_GUIDES', () => {
  it('builds the commands with the server address', () => {
    const url = 'https://s.example.com/api/mcp'
    expect(guide('claude').command?.(url)).toBe(
      `claude mcp add --transport http steel ${url}`,
    )
    expect(guide('chatgpt').command).toBeNull()
  })
})
