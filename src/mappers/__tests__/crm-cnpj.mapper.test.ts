import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  createFakeCnpjProfile,
  createFakeCnpjRun,
  createFakeCompanyEnrichment,
} from '@/src/__tests__/factories/nov-c2-cnpj-enrichment.factory'
import {
  toCrmCnpjProfileDTO,
  toCrmCnpjRunDTO,
  toCrmCompanyEnrichmentDTO,
  toEnrichmentData,
} from '../crm-cnpj.mapper'

describe('crm-cnpj mapper', () => {
  it('copies a provider profile into a DTO', () => {
    const profile = createFakeCnpjProfile()
    expect(toCrmCnpjProfileDTO(profile)).toEqual(profile)
  })

  it('maps a profile to enrichment columns', () => {
    const data = toEnrichmentData(createFakeCnpjProfile(), 'brasilapi')
    expect(data).toMatchObject({
      cnpj: '11222333000181',
      legalName: 'ACME COMERCIO DE ALIMENTOS LTDA',
      size: 'EPP',
      source: 'brasilapi',
    })
    expect(data.openedAt).toEqual(new Date('2015-03-02T00:00:00Z'))
    expect(
      toEnrichmentData(createFakeCnpjProfile({ openedAt: null }), 's').openedAt,
    ).toBeNull()
  })

  it('maps a stored enrichment row', () => {
    const row = createFakeCompanyEnrichment({
      shareCapital: new Prisma.Decimal('1500.5'),
    })
    expect(toCrmCompanyEnrichmentDTO(row)).toMatchObject({
      id: row.id,
      companyId: row.companyId,
      openedAt: '2015-03-02',
      shareCapital: 1500.5,
      fetchedAt: row.fetchedAt.toISOString(),
      partners: [{ name: 'MARIA DA SILVA' }],
    })
  })

  it('keeps nulls and empty lists in a sparse row', () => {
    const dto = toCrmCompanyEnrichmentDTO(
      createFakeCompanyEnrichment({
        openedAt: null,
        shareCapital: null,
        secondaryCnaes: null as never,
        partners: null as never,
      }),
    )
    expect(dto).toMatchObject({
      openedAt: null,
      shareCapital: null,
      secondaryCnaes: [],
      partners: [],
    })
  })

  it('maps a run with and without timestamps', () => {
    const idle = createFakeCnpjRun()
    expect(toCrmCnpjRunDTO(idle)).toMatchObject({
      id: idle.id,
      status: 'QUEUED',
      cancelRequested: false,
      startedAt: null,
      finishedAt: null,
    })
    expect(
      toCrmCnpjRunDTO(createFakeCnpjRun({ cancelRequestedAt: new Date() }))
        .cancelRequested,
    ).toBe(true)
    const started = new Date('2026-11-03T10:00:00Z')
    const done = createFakeCnpjRun({
      status: 'COMPLETED',
      startedAt: started,
      finishedAt: started,
    })
    expect(toCrmCnpjRunDTO(done)).toMatchObject({
      startedAt: started.toISOString(),
      finishedAt: started.toISOString(),
    })
  })
})
