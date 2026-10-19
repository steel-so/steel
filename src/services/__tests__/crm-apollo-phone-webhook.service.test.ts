import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmApolloImport } from '@/src/__tests__/factories/crm-apollo.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { crmApolloImportNotFound, databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/integrations/apollo-webhook', () => ({
  APOLLO_WEBHOOK_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  hashApolloWebhookToken: (token: string) => `hash-${token}`,
}))
vi.mock('@/src/repositories/crm-apollo-import.repository')
vi.mock('@/src/repositories/crm-lead.repository')
vi.mock('@/src/services/crm-lead.service', () => ({
  CrmLeadService: { intake: vi.fn() },
}))

import { CrmApolloImportRepository } from '@/src/repositories/crm-apollo-import.repository'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import { CrmLeadService } from '@/src/services/crm-lead.service'
import { CrmApolloPhoneWebhookService } from '../crm-apollo-phone-webhook.service'

const importRepo = vi.mocked(CrmApolloImportRepository)
const leadRepo = vi.mocked(CrmLeadRepository)
const intake = vi.mocked(CrmLeadService.intake)

const phone = (n: string, status_cd = 'valid_number') => ({
  sanitized_number: n,
  status_cd,
})
function payload(
  people: Array<{ id: string; phone_numbers: unknown[] }>,
  credits = 8,
) {
  return {
    webhook_result: { credits_consumed: credits, people },
  } as never
}

beforeEach(() => {
  vi.resetAllMocks()
  importRepo.findByWebhookTokenHash.mockResolvedValue(
    ok(
      createFakeCrmApolloImport({
        id: 'imp1',
        revealPhones: true,
        phoneOnlyPeople: [
          { id: 'p2', name: 'Sem Email', company: 'Acme', title: 'CTO' },
          { bad: true },
        ],
      }),
    ),
  )
  importRepo.addPhoneProgress.mockResolvedValue(ok(createFakeCrmApolloImport()))
  leadRepo.appendPhonesByExternalId.mockResolvedValue(
    ok({ found: true, added: 1 }),
  )
  intake.mockResolvedValue(ok({ lead: {} as never, created: true }))
})

describe('CrmApolloPhoneWebhookService.handle', () => {
  it('rejects unknown tokens', async () => {
    importRepo.findByWebhookTokenHash.mockResolvedValue(
      err(crmApolloImportNotFound()),
    )
    const error = expectErr(
      await CrmApolloPhoneWebhookService.handle('nope', payload([])),
    )
    expect(error.code).toBe('CRM_APOLLO_IMPORT_NOT_FOUND')
    expect(importRepo.findByWebhookTokenHash).toHaveBeenCalledWith('hash-nope')
  })

  it('rejects tokens of imports finished more than 7 days ago', async () => {
    importRepo.findByWebhookTokenHash.mockResolvedValue(
      ok(
        createFakeCrmApolloImport({
          finishedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        }),
      ),
    )
    const error = expectErr(
      await CrmApolloPhoneWebhookService.handle('t', payload([])),
    )
    expect(error.code).toBe('CRM_APOLLO_IMPORT_NOT_FOUND')
  })

  it('accepts a recently finished import and an empty payload', async () => {
    importRepo.findByWebhookTokenHash.mockResolvedValue(
      ok(createFakeCrmApolloImport({ finishedAt: new Date() })),
    )
    expect(
      expectOk(await CrmApolloPhoneWebhookService.handle('t', payload([]))),
    ).toEqual({ received: 0, created: 0 })
    expect(
      expectOk(await CrmApolloPhoneWebhookService.handle('t', {} as never)),
    ).toEqual({ received: 0, created: 0 })
    expect(importRepo.addPhoneProgress).not.toHaveBeenCalled()
  })

  it('appends sanitized, deduplicated numbers to existing leads', async () => {
    const out = expectOk(
      await CrmApolloPhoneWebhookService.handle(
        't',
        payload([
          {
            id: 'p1',
            phone_numbers: [
              phone('+5581999990000'),
              { raw_number: '+55 (81) 99999-0000' },
              phone('+5581888880000', 'invalid_number'),
              phone('123'),
            ],
          },
          { id: 'none', phone_numbers: [] },
        ]),
      ),
    )
    expect(out).toEqual({ received: 1, created: 0 })
    expect(leadRepo.appendPhonesByExternalId).toHaveBeenCalledTimes(1)
    expect(leadRepo.appendPhonesByExternalId).toHaveBeenCalledWith(
      'ws1',
      'apollo',
      'p1',
      ['+5581999990000'],
    )
    expect(importRepo.addPhoneProgress).toHaveBeenCalledWith('imp1', {
      received: 1,
      created: 0,
      credits: 8,
    })
  })

  it('is a no-op on redelivery (nothing added, nothing charged)', async () => {
    leadRepo.appendPhonesByExternalId.mockResolvedValue(
      ok({ found: true, added: 0 }),
    )
    const out = expectOk(
      await CrmApolloPhoneWebhookService.handle(
        't',
        payload([{ id: 'p1', phone_numbers: [phone('+5581999990000')] }]),
      ),
    )
    expect(out.received).toBe(0)
    expect(importRepo.addPhoneProgress).not.toHaveBeenCalled()
  })

  it('creates the lead of a phone-only person through quiet intake', async () => {
    leadRepo.appendPhonesByExternalId.mockResolvedValue(
      ok({ found: false, added: 0 }),
    )
    const out = expectOk(
      await CrmApolloPhoneWebhookService.handle(
        't',
        payload([{ id: 'p2', phone_numbers: [phone('+5581999990000')] }], 7.6),
      ),
    )
    expect(out).toEqual({ received: 1, created: 1 })
    const [ws, actor, input, options] = intake.mock.calls[0]
    expect(ws).toBe('ws1')
    expect(actor).toMatchObject({
      kind: 'system',
      via: 'apollo',
      refId: 'imp1',
    })
    expect(input).toMatchObject({
      name: 'Sem Email',
      phones: ['+5581999990000'],
      company: 'Acme',
      jobTitle: 'CTO',
      source: 'Apollo',
    })
    expect(input.emails).toBeUndefined()
    expect(options).toEqual({
      quiet: true,
      external: { source: 'apollo', id: 'p2' },
    })
    expect(importRepo.addPhoneProgress).toHaveBeenCalledWith('imp1', {
      received: 1,
      created: 1,
      credits: 8,
    })
  })

  it('uses the number as name when the saved person has none', async () => {
    importRepo.findByWebhookTokenHash.mockResolvedValue(
      ok(
        createFakeCrmApolloImport({
          phoneOnlyPeople: [{ id: 'p2', name: '  ' }],
        }),
      ),
    )
    leadRepo.appendPhonesByExternalId.mockResolvedValue(
      ok({ found: false, added: 0 }),
    )
    expectOk(
      await CrmApolloPhoneWebhookService.handle(
        't',
        payload([{ id: 'p2', phone_numbers: [phone('+5581999990000')] }]),
      ),
    )
    expect(intake.mock.calls[0][2].name).toBe('+5581999990000')
  })

  it('ignores unknown people and survives intake / database failures', async () => {
    leadRepo.appendPhonesByExternalId
      .mockResolvedValueOnce(ok({ found: false, added: 0 }))
      .mockResolvedValueOnce(err(databaseError('x')))
      .mockResolvedValueOnce(ok({ found: false, added: 0 }))
      .mockResolvedValueOnce(ok({ found: false, added: 0 }))
    intake
      .mockResolvedValueOnce(err(databaseError('boom')))
      .mockResolvedValueOnce(ok({ lead: {} as never, created: false }))
    importRepo.findByWebhookTokenHash.mockResolvedValue(
      ok(
        createFakeCrmApolloImport({
          phoneOnlyPeople: [
            { id: 'p2', name: 'A' },
            { id: 'p3', name: 'B' },
          ],
        }),
      ),
    )
    const out = expectOk(
      await CrmApolloPhoneWebhookService.handle(
        't',
        payload([
          { id: 'ghost', phone_numbers: [phone('+5581999990000')] },
          { id: 'p9', phone_numbers: [phone('+5581999990001')] },
          { id: 'p2', phone_numbers: [phone('+5581999990002')] },
          { id: 'p3', phone_numbers: [phone('+5581999990003')] },
        ]),
      ),
    )
    expect(out).toEqual({ received: 0, created: 0 })
    expect(intake).toHaveBeenCalledTimes(2)
  })
})
