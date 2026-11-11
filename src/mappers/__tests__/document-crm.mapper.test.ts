import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { createFakeDocument } from '@/src/__tests__/factories/document-migration.factory'
import {
  crmDocumentPath,
  documentPublicPath,
  toCrmDocumentSummaryDTO,
} from '../document-crm.mapper'

describe('toCrmDocumentSummaryDTO', () => {
  it('maps a sent proposal with its links, money and dates', () => {
    const sentAt = new Date('2026-10-01T12:00:00.000Z')
    const dto = toCrmDocumentSummaryDTO(
      createFakeDocument({
        id: 'd1',
        status: 'ACCEPTED',
        publicToken: 'tok',
        totalValue: new Prisma.Decimal('1234.50'),
        validUntil: sentAt,
        sentAt,
        acceptedAt: sentAt,
        acceptedByName: 'Maria',
        leadId: 'le1',
      }),
    )
    expect(dto).toMatchObject({
      id: 'd1',
      kind: 'PROPOSAL',
      status: 'ACCEPTED',
      totalValue: 1234.5,
      validUntil: sentAt.toISOString(),
      sentAt: sentAt.toISOString(),
      acceptedAt: sentAt.toISOString(),
      acceptedByName: 'Maria',
      leadId: 'le1',
      path: '/crm/documents/d1',
      publicPath: '/d/tok',
    })
  })

  it('keeps nulls and gives templates no public link', () => {
    const dto = toCrmDocumentSummaryDTO(
      createFakeDocument({ id: 't1', isTemplate: true }),
    )
    expect(dto).toMatchObject({
      totalValue: null,
      validUntil: null,
      sentAt: null,
      acceptedAt: null,
      publicPath: null,
      isTemplate: true,
    })
  })

  it('builds the page and public paths', () => {
    expect(crmDocumentPath('x')).toBe('/crm/documents/x')
    expect(documentPublicPath('tok')).toBe('/d/tok')
  })
})
