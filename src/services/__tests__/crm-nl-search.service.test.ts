import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import { createFakeCrmLead } from '@/src/__tests__/factories/crm-lead.factory'
import { createFakeCrmOpportunity } from '@/src/__tests__/factories/crm-opportunity.factory'
import { createFakeCrmPerson } from '@/src/__tests__/factories/crm-person.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { aiQuotaExceeded, databaseError, featureNotEnabled } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-opportunity.repository')
vi.mock('@/src/repositories/crm-lead.repository')
vi.mock('@/src/repositories/crm-person.repository')
vi.mock('@/src/repositories/crm-company.repository')
vi.mock('@/src/services/ai-usage.service')
vi.mock('@/src/services/feature-flag.service')
vi.mock('@/src/services/crm-custom-field-sync', () => ({
  withCustomFieldsList: vi.fn(async (list: unknown[]) => ok(list)),
}))

import { logger } from '@/lib/axiom/logger'
import { CrmCompanyRepository } from '@/src/repositories/crm-company.repository'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { AiUsageService } from '@/src/services/ai-usage.service'
import { assertFeature } from '@/src/services/feature-flag.service'
import {
  CRM_NL_SEARCH_LIMIT,
  CrmNlSearchService,
} from '../crm-nl-search.service'

const membership = vi.mocked(MembershipRepository)
const ai = vi.mocked(AiUsageService)
const feature = vi.mocked(assertFeature)
const repo = vi.mocked(CrmOpportunityRepository)

const WS = 'ws1'
const ACTOR = 'u1'
const NOW = new Date('2026-10-29T12:00:00Z')
const provider = { id: 'anthropic' as const, chat: vi.fn() }

function chat(text: string) {
  return {
    text,
    toolCalls: [],
    message: { role: 'assistant' as const, content: text },
    usage: { inputTokens: 100, outputTokens: 40 },
    stopReason: 'end' as const,
  }
}

const FILTER = JSON.stringify({
  status: 'OPEN',
  amountMin: 10000,
  stalledForDays: 15,
  stageContains: null,
})

const ask = () =>
  CrmNlSearchService.searchOpportunities(
    ACTOR,
    WS,
    { query: 'negócios parados há 15 dias acima de 10 mil' },
    NOW,
  )

beforeEach(() => {
  vi.clearAllMocks()
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  feature.mockResolvedValue(ok(true))
  ai.prepare.mockResolvedValue(
    ok({
      feature: 'CRM_ASSISTANT',
      provider: provider as never,
      model: {
        key: 'anthropic:claude',
        provider: 'anthropic',
        model: 'claude-x',
        label: 'Claude',
      } as never,
    }),
  )
  ai.record.mockResolvedValue(undefined)
  provider.chat.mockResolvedValue(chat(FILTER))
  repo.search.mockResolvedValue(
    ok([createFakeCrmOpportunity({ name: 'Acme' })]),
  )
})

describe('CrmNlSearchService.searchOpportunities()', () => {
  it('turns the question into a filter and returns the matches', async () => {
    const result = expectOk(await ask())

    expect(result.interpretation).toContain('Parados há 15 dias ou mais')
    expect(result.filter.amountMin).toBe(10000)
    expect(result.opportunities.map((o) => o.name)).toEqual(['Acme'])
    expect(result.truncated).toBe(false)
    expect(repo.search).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, deletedAt: null }),
      [{ position: 'asc' }],
      CRM_NL_SEARCH_LIMIT + 1,
    )
    expect(ai.record).toHaveBeenCalledTimes(1)
  })

  it('sends only the question to the provider', async () => {
    await ask()
    const request = provider.chat.mock.calls[0][0]
    expect(request.messages).toEqual([
      { role: 'user', content: 'negócios parados há 15 dias acima de 10 mil' },
    ])
    expect(request.system).toContain('Hoje é 2026-10-29')
  })

  it('flags truncation and caps the rows', async () => {
    repo.search.mockResolvedValue(
      ok(
        Array.from({ length: CRM_NL_SEARCH_LIMIT + 1 }, (_, i) =>
          createFakeCrmOpportunity({ name: `Deal ${i}` }),
        ),
      ),
    )
    const result = expectOk(await ask())
    expect(result.truncated).toBe(true)
    expect(result.opportunities).toHaveLength(CRM_NL_SEARCH_LIMIT)
  })

  it('denies a non-member without calling the provider', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expect(expectErr(await ask()).code).toBe('FORBIDDEN')
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('denies a member without the opportunities VIEW permission', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(
      ok(
        createFakeMembership({
          role: 'MEMBER',
          profile: {
            isSystem: false,
            systemKey: null,
            permissions: { opportunities: ['CREATE'] },
          } as never,
        }),
      ),
    )
    expect(expectErr(await ask()).code).toBe('FORBIDDEN')
  })

  it('propagates a disabled feature', async () => {
    feature.mockResolvedValue(err(featureNotEnabled('crm.aiAssistant')))
    expect(expectErr(await ask()).code).toBe('FEATURE_NOT_ENABLED')
  })

  it('propagates an exhausted quota', async () => {
    ai.prepare.mockResolvedValue(err(aiQuotaExceeded(10, 10)))
    expect(expectErr(await ask()).code).toBe('AI_QUOTA_EXCEEDED')
  })

  it('maps a provider failure to CRM_NL_SEARCH_FAILED', async () => {
    provider.chat.mockRejectedValue(new Error('down'))
    expect(expectErr(await ask()).code).toBe('CRM_NL_SEARCH_FAILED')
    expect(logger.error).toHaveBeenCalled()
  })

  it('maps non-JSON or invalid output to CRM_NL_SEARCH_FAILED', async () => {
    provider.chat.mockResolvedValue(chat('não sei'))
    expect(expectErr(await ask()).code).toBe('CRM_NL_SEARCH_FAILED')
    provider.chat.mockResolvedValue(
      chat(JSON.stringify({ probabilityMin: 999 })),
    )
    expect(expectErr(await ask()).code).toBe('CRM_NL_SEARCH_FAILED')
    expect(logger.warn).toHaveBeenCalled()
  })

  it('propagates a repository failure', async () => {
    repo.search.mockResolvedValue(err(databaseError('x')))
    expect(expectErr(await ask()).code).toBe('DATABASE_ERROR')
  })

  it('propagates a custom-fields failure', async () => {
    const sync = await import('@/src/services/crm-custom-field-sync')
    vi.mocked(sync.withCustomFieldsList).mockResolvedValueOnce(
      err(databaseError('cf')),
    )
    expect(expectErr(await ask()).code).toBe('DATABASE_ERROR')
  })
})

/** What the three entity results share, as the table below reads it. */
interface NlEntityResult {
  interpretation: string[]
  truncated: boolean
  items: { name: string }[]
}

interface NlEntityCase {
  name: string
  resource: string
  repo: { search: ReturnType<typeof vi.fn> }
  row: () => unknown
  ask: (query: string) => Promise<Result<NlEntityResult>>
  filter: Record<string, unknown>
  chip: string
  schemaName: string
  invalid: Record<string, unknown>
  expected: string[]
}

const ENTITY_CASES: NlEntityCase[] = [
  {
    name: 'searchLeads',
    resource: 'leads',
    repo: vi.mocked(CrmLeadRepository) as unknown as NlEntityCase['repo'],
    row: () => createFakeCrmLead({ name: 'Lead Acme' }),
    ask: (q: string) =>
      CrmNlSearchService.searchLeads(ACTOR, WS, { query: q }, NOW),
    filter: { status: 'OPEN', scoreMin: 50, stalledForDays: 7 },
    chip: 'Parados há 7 dias ou mais',
    schemaName: 'crm_lead_filter',
    invalid: { scoreMin: -3 },
    expected: ['Lead Acme'],
  },
  {
    name: 'searchPeople',
    resource: 'people',
    repo: vi.mocked(CrmPersonRepository) as unknown as NlEntityCase['repo'],
    row: () => createFakeCrmPerson({ name: 'Maria' }),
    ask: (q: string) =>
      CrmNlSearchService.searchPeople(ACTOR, WS, { query: q }, NOW),
    filter: { hasEmail: true, jobTitleContains: 'diretor' },
    chip: 'Cargo com “diretor”',
    schemaName: 'crm_person_filter',
    invalid: { sort: 'DROP' },
    expected: ['Maria'],
  },
  {
    name: 'searchCompanies',
    resource: 'companies',
    repo: vi.mocked(CrmCompanyRepository) as unknown as NlEntityCase['repo'],
    row: () => createFakeCrmCompany({ name: 'Acme' }),
    ask: (q: string) =>
      CrmNlSearchService.searchCompanies(ACTOR, WS, { query: q }, NOW),
    filter: { icp: true, activityContains: 'alimentos' },
    chip: 'Atividade com “alimentos”',
    schemaName: 'crm_company_filter',
    invalid: { employeesMin: -1 },
    expected: ['Acme'],
  },
]

describe.each(ENTITY_CASES)('CrmNlSearchService.$name()', (c) => {
  beforeEach(() => {
    provider.chat.mockResolvedValue(chat(JSON.stringify(c.filter)))
    c.repo.search.mockResolvedValue(ok([c.row()]))
  })

  it('turns the question into a filter and runs it through the repository', async () => {
    const result = expectOk(await c.ask('a pergunta'))

    expect(result.interpretation).toContain(c.chip)
    expect(result.items.map((item) => item.name)).toEqual(c.expected)
    expect(result.truncated).toBe(false)
    expect(c.repo.search).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, deletedAt: null }),
      expect.any(Array),
      CRM_NL_SEARCH_LIMIT + 1,
    )
    expect(ai.record).toHaveBeenCalledTimes(1)
  })

  it('sends only the question and the date to the provider', async () => {
    await c.ask('a pergunta')
    const request = provider.chat.mock.calls[0][0]
    expect(request.messages).toEqual([{ role: 'user', content: 'a pergunta' }])
    expect(request.system).toContain('Hoje é 2026-10-29')
    expect(request.jsonSchema.name).toBe(c.schemaName)
  })

  it('flags truncation and caps the rows', async () => {
    c.repo.search.mockResolvedValue(
      ok(Array.from({ length: CRM_NL_SEARCH_LIMIT + 1 }, () => c.row())),
    )
    const result = expectOk(await c.ask('a pergunta'))
    expect(result.truncated).toBe(true)
    expect(result.items).toHaveLength(CRM_NL_SEARCH_LIMIT)
  })

  it('denies a non-member without calling the provider', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expect(expectErr(await c.ask('a pergunta')).code).toBe('FORBIDDEN')
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('denies a member without VIEW on the resource', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(
      ok(
        createFakeMembership({
          role: 'MEMBER',
          profile: {
            isSystem: false,
            systemKey: null,
            permissions: { [c.resource]: ['CREATE'] },
          } as never,
        }),
      ),
    )
    expect(expectErr(await c.ask('a pergunta')).code).toBe('FORBIDDEN')
    expect(provider.chat).not.toHaveBeenCalled()
  })

  it('propagates a disabled feature and an exhausted quota', async () => {
    feature.mockResolvedValue(err(featureNotEnabled('crm.aiAssistant')))
    expect(expectErr(await c.ask('a pergunta')).code).toBe(
      'FEATURE_NOT_ENABLED',
    )
    feature.mockResolvedValue(ok(true))
    ai.prepare.mockResolvedValue(err(aiQuotaExceeded(10, 10)))
    expect(expectErr(await c.ask('a pergunta')).code).toBe('AI_QUOTA_EXCEEDED')
  })

  it('maps provider failures and invalid output to CRM_NL_SEARCH_FAILED', async () => {
    provider.chat.mockRejectedValue(new Error('down'))
    expect(expectErr(await c.ask('a pergunta')).code).toBe(
      'CRM_NL_SEARCH_FAILED',
    )
    provider.chat.mockResolvedValue(chat('não sei'))
    expect(expectErr(await c.ask('a pergunta')).code).toBe(
      'CRM_NL_SEARCH_FAILED',
    )
    provider.chat.mockResolvedValue(chat(JSON.stringify(c.invalid)))
    expect(expectErr(await c.ask('a pergunta')).code).toBe(
      'CRM_NL_SEARCH_FAILED',
    )
    expect(c.repo.search).not.toHaveBeenCalled()
  })

  it('propagates a repository failure', async () => {
    c.repo.search.mockResolvedValue(err(databaseError('x')))
    expect(expectErr(await c.ask('a pergunta')).code).toBe('DATABASE_ERROR')
  })
})

describe('CrmNlSearchService custom fields of people and companies', () => {
  it('propagates a custom-fields failure', async () => {
    const sync = await import('@/src/services/crm-custom-field-sync')
    provider.chat.mockResolvedValue(chat('{}'))
    vi.mocked(CrmPersonRepository.search).mockResolvedValue(
      ok([createFakeCrmPerson()]),
    )
    vi.mocked(CrmCompanyRepository.search).mockResolvedValue(
      ok([createFakeCrmCompany()]),
    )
    vi.mocked(sync.withCustomFieldsList).mockResolvedValueOnce(
      err(databaseError('cf')),
    )
    expect(
      expectErr(
        await CrmNlSearchService.searchPeople(ACTOR, WS, { query: 'ab' }, NOW),
      ).code,
    ).toBe('DATABASE_ERROR')
    vi.mocked(sync.withCustomFieldsList).mockResolvedValueOnce(
      err(databaseError('cf')),
    )
    expect(
      expectErr(
        await CrmNlSearchService.searchCompanies(
          ACTOR,
          WS,
          { query: 'ab' },
          NOW,
        ),
      ).code,
    ).toBe('DATABASE_ERROR')
  })
})
