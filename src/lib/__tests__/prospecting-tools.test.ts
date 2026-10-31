import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmCompanyDTO } from '@/src/__tests__/factories/crm-company.factory'
import { createFakeWorkspaceDTO } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/services/crm-prospecting.service')
vi.mock('@/src/services/crm-company.service')
vi.mock('@/src/services/workspace.service')

import { CreateSteelAgentSchema } from '@/src/schemas/steel-agent.schema'
import { CrmCompanyService } from '@/src/services/crm-company.service'
import { CrmProspectingService } from '@/src/services/crm-prospecting.service'
import { WorkspaceService } from '@/src/services/workspace.service'
import { STEEL_AI_TOOLS } from '../ai/tools'
import {
  CRM_PROSPECTING_TOOLS,
  crmProspectEnrichCompanyTool,
  crmProspectFindContactsTool,
  crmProspectLookupCnpjTool,
  crmProspectSaveDraftTool,
  webFetchTool,
  webSearchTool,
} from '../ai/tools/crm/prospecting'
import { assertValidToolRegistry, findTool } from '../ai/tools/registry'
import {
  PROSPECTING_AGENT_INSTRUCTIONS,
  PROSPECTING_AGENT_TOOLS,
} from '../prospecting/agent-preset'

const ctx = {
  workspaceId: 'ws1',
  actorId: 'u1',
  source: 'agent' as const,
  agentId: 'agent1',
}
const service = vi.mocked(CrmProspectingService)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(WorkspaceService.getById).mockResolvedValue(
    ok(createFakeWorkspaceDTO({ slug: 'acme' })),
  )
})

describe('registration', () => {
  it('should be part of the registry, valid and CRM-scoped', () => {
    expect(() => assertValidToolRegistry(CRM_PROSPECTING_TOOLS)).not.toThrow()
    for (const tool of CRM_PROSPECTING_TOOLS) {
      expect(findTool(tool.name, STEEL_AI_TOOLS)).toBe(tool)
      expect(tool.module).toBe('CRM')
    }
  })

  it('should keep reads read-only and never mark the draft as customer-facing', () => {
    expect(webSearchTool.kind).toBe('READ')
    expect(webFetchTool.kind).toBe('READ')
    expect(crmProspectLookupCnpjTool.kind).toBe('READ')
    expect(crmProspectFindContactsTool.kind).toBe('READ')
    expect(crmProspectSaveDraftTool.kind).toBe('CREATE')
    expect(crmProspectSaveDraftTool.customerFacing).toBeUndefined()
    expect(crmProspectEnrichCompanyTool.kind).toBe('UPDATE')
  })
})

describe('agent preset', () => {
  it('should only use tools that exist and be a valid agent', () => {
    for (const spec of PROSPECTING_AGENT_TOOLS) {
      expect(findTool(spec.toolName, STEEL_AI_TOOLS), spec.toolName).toBeDefined()
    }
    const parsed = CreateSteelAgentSchema.safeParse({
      name: 'Prospecção',
      instructions: PROSPECTING_AGENT_INSTRUCTIONS,
      triggerType: 'MANUAL',
      ownerId: 'u1',
      tools: PROSPECTING_AGENT_TOOLS.map((tool) => ({ ...tool })),
    })
    expect(parsed.success).toBe(true)
  })

  it('should start every write in approval', () => {
    for (const spec of PROSPECTING_AGENT_TOOLS) {
      const tool = findTool(spec.toolName, STEEL_AI_TOOLS)
      if (tool?.kind !== 'READ') expect(spec.mode).toBe('APPROVAL')
    }
  })
})

describe('crm_web_search', () => {
  it('should validate and default the arguments', () => {
    expect(expectOk(webSearchTool.parse({ query: 'acme logística' }))).toEqual({
      query: 'acme logística',
      limit: 5,
    })
    expectErr(webSearchTool.parse({ query: 'a' }), 'VALIDATION_ERROR')
    expectErr(webSearchTool.parse({ query: 'acme', limit: 50 }), 'VALIDATION_ERROR')
  })

  it('should search through the service', async () => {
    service.webSearch.mockResolvedValue(
      ok({ query: 'acme', results: [{ title: 'A', url: 'https://a.com', snippet: '' }] }),
    )
    const out = expectOk(await webSearchTool.execute(ctx, { query: 'acme', limit: 3 }))
    expect(service.webSearch).toHaveBeenCalledWith('u1', 'ws1', 'acme', 3)
    expect(out.summary).toBe('1 resultado(s) para “acme”')
  })

  it('should return the service error', async () => {
    service.webSearch.mockResolvedValue(
      err({ code: 'CRM_PROSPECTING_DISABLED', message: 'off' }),
    )
    expectErr(
      await webSearchTool.execute(ctx, { query: 'acme', limit: 3 }),
      'CRM_PROSPECTING_DISABLED',
    )
  })
})

describe('crm_web_fetch', () => {
  const output = {
    url: 'https://a.com',
    finalUrl: 'https://a.com',
    title: null,
    text: 'x',
    truncated: false,
    warning: null,
  }

  it('should require a URL', () => {
    expectErr(webFetchTool.parse({ url: 'nao é url' }), 'VALIDATION_ERROR')
    expectOk(webFetchTool.parse({ url: 'https://a.com' }))
  })

  it('should summarize the signals found', async () => {
    service.webFetch.mockResolvedValue(
      ok({
        ...output,
        signals: [{ type: 'HIRING', label: 'Contratando', snippet: 's', match: 'm' }],
      }),
    )
    const out = expectOk(await webFetchTool.execute(ctx, { url: 'https://a.com' }))
    expect(out.summary).toBe('Página lida · 1 sinal(is) de compra')
  })

  it('should keep the summary short without signals and return errors', async () => {
    service.webFetch.mockResolvedValue(ok({ ...output, signals: [] }))
    expect(
      expectOk(await webFetchTool.execute(ctx, { url: 'https://a.com' })).summary,
    ).toBe('Página lida')
    service.webFetch.mockResolvedValue(
      err({ code: 'CRM_PROSPECT_WEB_FAILED', message: 'x' }),
    )
    expectErr(
      await webFetchTool.execute(ctx, { url: 'https://a.com' }),
      'CRM_PROSPECT_WEB_FAILED',
    )
  })
})

describe('crm_prospect_lookup_cnpj', () => {
  it('should look the CNPJ up', async () => {
    service.lookupCnpj.mockResolvedValue(
      ok({ cnpj: '11222333000181', tradeName: 'Acme', legalName: 'Acme Ltda' } as never),
    )
    const out = expectOk(
      await crmProspectLookupCnpjTool.execute(ctx, { cnpj: '11.222.333/0001-81' }),
    )
    expect(service.lookupCnpj).toHaveBeenCalledWith('u1', 'ws1', '11.222.333/0001-81')
    expect(out.summary).toBe('CNPJ 11222333000181: Acme')
  })

  it('should fall back to the legal name, then to a placeholder', async () => {
    service.lookupCnpj.mockResolvedValue(
      ok({ cnpj: '1', tradeName: null, legalName: 'Acme Ltda' } as never),
    )
    expect(
      expectOk(await crmProspectLookupCnpjTool.execute(ctx, { cnpj: '12345678901234' }))
        .summary,
    ).toBe('CNPJ 1: Acme Ltda')
    service.lookupCnpj.mockResolvedValue(
      ok({ cnpj: '1', tradeName: null, legalName: null } as never),
    )
    expect(
      expectOk(await crmProspectLookupCnpjTool.execute(ctx, { cnpj: '12345678901234' }))
        .summary,
    ).toBe('CNPJ 1: sem nome')
    service.lookupCnpj.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await crmProspectLookupCnpjTool.execute(ctx, { cnpj: '12345678901234' }),
      'DATABASE_ERROR',
    )
  })

  it('should validate the length', () => {
    expectErr(crmProspectLookupCnpjTool.parse({ cnpj: '123' }), 'VALIDATION_ERROR')
  })
})

describe('crm_prospect_enrich_company', () => {
  const company = createFakeCrmCompanyDTO({ id: 'c1', name: 'Acme', cnpj: '11222333000181' })

  beforeEach(() => {
    vi.mocked(CrmCompanyService.list).mockResolvedValue(ok([company]))
  })

  it('should preview what will be filled', async () => {
    const preview = expectOk(
      (await crmProspectEnrichCompanyTool.preview?.(ctx, { company: 'Acme' })) ??
        err(databaseError('no preview')),
    )
    expect(preview.title).toContain('Acme')
    expect(preview.target).toMatchObject({ type: 'crm_company', id: 'c1' })
    expect(preview.fields?.map((field) => field.label)).toEqual(['Empresa', 'CNPJ'])
  })

  it('should name an unnamed company in the preview', async () => {
    vi.mocked(CrmCompanyService.list).mockResolvedValue(
      ok([createFakeCrmCompanyDTO({ id: 'c2', name: '' })]),
    )
    const preview = expectOk(
      (await crmProspectEnrichCompanyTool.preview?.(ctx, { company: 'c2' })) ??
        err(databaseError('no preview')),
    )
    expect(preview.title).toBe('Preencher “empresa” pelo CNPJ')
  })

  it('should fail the preview and the run for an unknown company', async () => {
    vi.mocked(CrmCompanyService.list).mockResolvedValue(ok([]))
    const preview = await crmProspectEnrichCompanyTool.preview?.(ctx, {
      company: 'Nada',
    })
    expect(preview?.ok).toBe(false)
    expect(
      (await crmProspectEnrichCompanyTool.execute(ctx, { company: 'Nada' })).ok,
    ).toBe(false)
    expect(service.enrichCompany).not.toHaveBeenCalled()
  })

  it('should report the fields it filled', async () => {
    service.enrichCompany.mockResolvedValue(
      ok({ applied: ['name', 'address'], company: { id: 'c1', name: 'Acme Ltda' } } as never),
    )
    const out = expectOk(
      await crmProspectEnrichCompanyTool.execute(ctx, { company: 'Acme' }),
    )
    expect(service.enrichCompany).toHaveBeenCalledWith('u1', 'ws1', 'c1')
    expect(out.summary).toBe('Empresa “Acme Ltda” preenchida (name, address)')
    expect(out.target?.href).toContain('/acme/crm/companies')
  })

  it('should say when there was nothing to fill, and return service errors', async () => {
    service.enrichCompany.mockResolvedValue(
      ok({ applied: [], company: { id: 'c1', name: 'Acme' } } as never),
    )
    expect(
      expectOk(await crmProspectEnrichCompanyTool.execute(ctx, { company: 'Acme' }))
        .summary,
    ).toContain('nada a preencher')
    service.enrichCompany.mockResolvedValue(
      err({ code: 'CRM_CNPJ_INVALID', message: 'x' }),
    )
    expectErr(
      await crmProspectEnrichCompanyTool.execute(ctx, { company: 'Acme' }),
      'CRM_CNPJ_INVALID',
    )
  })
})

describe('crm_prospect_find_contacts', () => {
  it('should default the arguments and cap the page', () => {
    expect(expectOk(crmProspectFindContactsTool.parse({}))).toEqual({
      domains: [],
      titles: [],
      keywords: '',
      limit: 10,
    })
    expectErr(crmProspectFindContactsTool.parse({ limit: 99 }), 'VALIDATION_ERROR')
  })

  it('should search Apollo through the service', async () => {
    service.findContacts.mockResolvedValue(
      ok({ totalEntries: 2, people: [{ id: 'p1' }, { id: 'p2' }] } as never),
    )
    const out = expectOk(
      await crmProspectFindContactsTool.execute(ctx, {
        domains: ['acme.com.br'],
        titles: ['CTO'],
        keywords: '',
        limit: 5,
      }),
    )
    expect(service.findContacts).toHaveBeenCalledWith('u1', 'ws1', {
      domains: ['acme.com.br'],
      titles: ['CTO'],
      keywords: '',
      perPage: 5,
    })
    expect(out.summary).toBe('2 pessoa(s) na Apollo')
    expect(out.data).toMatchObject({ total: 2 })
  })

  it('should return the service error', async () => {
    service.findContacts.mockResolvedValue(
      err({ code: 'CRM_APOLLO_NOT_CONNECTED', message: 'x' }),
    )
    expectErr(
      await crmProspectFindContactsTool.execute(ctx, {
        domains: [],
        titles: [],
        keywords: '',
        limit: 5,
      }),
      'CRM_APOLLO_NOT_CONNECTED',
    )
  })
})

describe('crm_prospect_save_draft', () => {
  const args = expectOk(
    crmProspectSaveDraftTool.parse({
      leadId: 'lead1',
      channel: 'EMAIL',
      subject: 'Uma ideia',
      body: 'Olá, Ana. Vi que a Acme abriu vagas de TI e posso ajudar.',
      signals: [{ type: 'HIRING', evidence: 'Estamos contratando' }],
      sources: [{ url: 'https://acme.com.br/vagas' }],
    }),
  )

  it('should validate the arguments', () => {
    expectErr(
      crmProspectSaveDraftTool.parse({ channel: 'EMAIL', body: 'x'.repeat(30) }),
      'VALIDATION_ERROR',
    )
  })

  it('should preview the exact text and say nothing is sent', async () => {
    service.previewDraft.mockResolvedValue(
      ok({ targetName: 'Ana Souza', toEmail: 'ana@acme.com.br', toPhone: null }),
    )
    const preview = expectOk(
      (await crmProspectSaveDraftTool.preview?.(ctx, args)) ??
        err(databaseError('no preview')),
    )
    expect(preview.title).toBe('Salvar rascunho de e-mail para “Ana Souza”')
    expect(preview.summary).toContain('Nada é enviado')
    const byLabel = Object.fromEntries(
      (preview.fields ?? []).map((field) => [field.label, field.after]),
    )
    expect(byLabel.Para).toBe('ana@acme.com.br')
    expect(byLabel.Assunto).toBe('Uma ideia')
    expect(byLabel.Mensagem).toContain('Olá, Ana')
    expect(byLabel.Sinais).toBe('HIRING: Estamos contratando')
    expect(byLabel.Fontes).toBe('https://acme.com.br/vagas')
  })

  it('should title a WhatsApp preview and address the phone', async () => {
    service.previewDraft.mockResolvedValue(
      ok({ targetName: 'Ana', toEmail: null, toPhone: '11999990000' }),
    )
    const preview = expectOk(
      (await crmProspectSaveDraftTool.preview?.(ctx, {
        ...args,
        channel: 'WHATSAPP',
      })) ?? err(databaseError('no preview')),
    )
    expect(preview.title).toContain('WhatsApp')
    expect(preview.fields?.find((f) => f.label === 'Para')?.after).toBe('11999990000')
    expect(preview.fields?.some((f) => f.label === 'Assunto')).toBe(false)
  })

  it('should fail the preview when the service refuses', async () => {
    service.previewDraft.mockResolvedValue(
      err({ code: 'CRM_PROSPECT_DRAFT_DUPLICATE', message: 'x' }),
    )
    const preview = await crmProspectSaveDraftTool.preview?.(ctx, args)
    expect(preview?.ok).toBe(false)
  })

  it('should save the draft as the agent and link the inbox', async () => {
    service.saveDraft.mockResolvedValue(
      ok({ id: 'd1', status: 'PENDING', targetName: 'Ana Souza' } as never),
    )
    const out = expectOk(await crmProspectSaveDraftTool.execute(ctx, args))
    expect(service.saveDraft).toHaveBeenCalledWith('u1', 'ws1', args, 'agent1')
    expect(out.summary).toBe('Rascunho para “Ana Souza” salvo para revisão')
    expect(out.target).toMatchObject({
      type: 'crm_prospect_draft',
      id: 'd1',
      href: '/acme/crm/prospecting',
    })
  })

  it('should save without an agent id outside Steel Agents and without a link when the workspace is unknown', async () => {
    vi.mocked(WorkspaceService.getById).mockResolvedValue(
      err(databaseError('x')),
    )
    service.saveDraft.mockResolvedValue(
      ok({ id: 'd1', status: 'PENDING', targetName: 'Ana' } as never),
    )
    const out = expectOk(
      await crmProspectSaveDraftTool.execute(
        { workspaceId: 'ws1', actorId: 'u1', source: 'assistant' },
        args,
      ),
    )
    expect(service.saveDraft).toHaveBeenCalledWith('u1', 'ws1', args, null)
    expect(out.target?.href).toBeUndefined()
  })

  it('should return the service error', async () => {
    service.saveDraft.mockResolvedValue(
      err({ code: 'CRM_PROSPECT_LIMIT_REACHED', message: 'x' }),
    )
    expectErr(
      await crmProspectSaveDraftTool.execute(ctx, args),
      'CRM_PROSPECT_LIMIT_REACHED',
    )
  })
})
