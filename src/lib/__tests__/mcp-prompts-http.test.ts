import { describe, expect, it } from 'vitest'
import { forbidden, rateLimited, unauthorized } from '@/src/errors'
import { databaseError } from '@/src/errors/app-error'
import { STEEL_AI_TOOLS } from '@/src/lib/ai/tools'
import {
  isStaleGrantError,
  mcpBearerChallenge,
  mcpMethodNotAllowed,
  mcpUnauthorized,
} from '@/src/lib/mcp/http'
import {
  getMcpPrompt,
  listMcpPrompts,
  MCP_PROMPTS,
} from '@/src/lib/mcp/prompts'
import { mcpAccess, mcpGrant } from './mcp.fixtures'

describe('MCP prompts', () => {
  it('should offer at most three prompts per module', () => {
    const perModule = new Map<string, number>()
    for (const p of MCP_PROMPTS) {
      perModule.set(p.module, (perModule.get(p.module) ?? 0) + 1)
    }
    expect([...perModule.values()].every((n) => n <= 3)).toBe(true)
  })

  it('should only reference existing READ tools', () => {
    for (const prompt of MCP_PROMPTS) {
      const referenced = [...prompt.text.matchAll(/`([a-z]+_[a-z_]+)`/g)].map(
        (m) => m[1],
      )
      expect(referenced.length).toBeGreaterThan(0)
      for (const name of referenced) {
        const tool = STEEL_AI_TOOLS.find((t) => t.name === name)
        expect(tool?.kind, name).toBe('READ')
        expect(tool?.module, name).toBe(prompt.module)
      }
    }
  })

  it('should list the prompts of granted and enabled modules', () => {
    const names = (r: ReturnType<typeof listMcpPrompts>) =>
      r.prompts.map((p) => p.name)
    expect(names(listMcpPrompts(mcpGrant(), mcpAccess()))).toEqual([
      'servicedesk_daily_summary',
      'crm_weekly_pipeline',
      'whatsapp_unanswered_conversations',
    ])
    expect(
      names(listMcpPrompts(mcpGrant({ modules: ['CRM'] }), mcpAccess())),
    ).toEqual(['crm_weekly_pipeline'])
    expect(
      names(listMcpPrompts(mcpGrant(), mcpAccess({ modules: ['CRM'] }))),
    ).toEqual(['crm_weekly_pipeline'])
  })

  it('should get a prompt as a user message', () => {
    const result = getMcpPrompt(mcpGrant(), mcpAccess(), 'crm_weekly_pipeline')
    expect(result.description).toContain('funil')
    expect(result.messages[0].content).toMatchObject({ type: 'text' })
  })

  it('should reject unknown and out-of-grant prompts', () => {
    expect(() => getMcpPrompt(mcpGrant(), mcpAccess(), 'nope')).toThrow(
      'Prompt desconhecido',
    )
    expect(() =>
      getMcpPrompt(
        mcpGrant({ modules: ['CRM'] }),
        mcpAccess(),
        'servicedesk_daily_summary',
      ),
    ).toThrow('Prompt desconhecido')
  })
})

describe('MCP HTTP edges', () => {
  const metadata =
    'resource_metadata="https://app.steel.test/.well-known/oauth-protected-resource"'

  it('should build the bearer challenge from the app origin', () => {
    expect(mcpBearerChallenge('https://app.steel.test/some/path', false)).toBe(
      `Bearer ${metadata}`,
    )
    expect(mcpBearerChallenge('https://app.steel.test', true)).toBe(
      `Bearer error="invalid_token", ${metadata}`,
    )
  })

  it('should answer 401 with WWW-Authenticate', async () => {
    const noToken = mcpUnauthorized(
      new Request('http://x/api/mcp', { method: 'POST' }),
      'https://app.steel.test',
    )
    expect(noToken.status).toBe(401)
    expect(noToken.headers.get('www-authenticate')).toBe(`Bearer ${metadata}`)
    expect((await noToken.json()).error.code).toBe('UNAUTHORIZED')

    const badToken = mcpUnauthorized(
      new Request('http://x/api/mcp', {
        method: 'POST',
        headers: { authorization: 'Bearer abc' },
      }),
      'https://app.steel.test',
    )
    expect(badToken.headers.get('www-authenticate')).toContain(
      'error="invalid_token"',
    )
  })

  it('should answer 405 with Allow: POST', () => {
    const response = mcpMethodNotAllowed()
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
  })

  it('should treat 401/403/404 access failures as a stale grant', () => {
    expect(isStaleGrantError(unauthorized())).toBe(true)
    expect(isStaleGrantError(forbidden())).toBe(true)
    expect(isStaleGrantError(databaseError('x'))).toBe(false)
    expect(isStaleGrantError(rateLimited(1))).toBe(false)
  })
})
