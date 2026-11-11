import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  createFakeCrmLead,
  createFakeCrmLeadContactAttempt,
  createFakeCrmLeadMeeting,
  createFakeCrmLeadProposalPresentation,
  createFakeCrmLeadQualification,
  createFakeCrmLeadReopening,
  createFakeCrmLeadRoutingRule,
  createFakeCrmLeadScoringRule,
} from '@/src/__tests__/factories/crm-lead.factory'
import {
  toCrmLeadContactAttemptDTO,
  toCrmLeadDTO,
  toCrmLeadMeetingDTO,
  toCrmLeadProposalPresentationDTO,
  toCrmLeadQualificationDTO,
  toCrmLeadReopeningDTO,
  toCrmLeadRoutingRuleDTO,
  toCrmLeadScoringRuleDTO,
} from '../crm-lead.mapper'

describe('toCrmLeadDTO()', () => {
  it('should map all fields correctly', () => {
    const lead = createFakeCrmLead({ id: 'l-1', name: 'Jane', score: 25 })
    const dto = toCrmLeadDTO(lead)
    expect(dto.id).toBe('l-1')
    expect(dto.score).toBe(25)
  })
})

describe('toCrmLeadScoringRuleDTO()', () => {
  it('should map all fields correctly', () => {
    const rule = createFakeCrmLeadScoringRule({ id: 'r-1', points: 15 })
    const dto = toCrmLeadScoringRuleDTO(rule)
    expect(dto.id).toBe('r-1')
    expect(dto.points).toBe(15)
  })
})

describe('toCrmLeadRoutingRuleDTO()', () => {
  it('should map all fields correctly', () => {
    const rule = createFakeCrmLeadRoutingRule({ id: 'rr-1', ownerId: 'u1' })
    const dto = toCrmLeadRoutingRuleDTO(rule)
    expect(dto.id).toBe('rr-1')
    expect(dto.ownerId).toBe('u1')
  })
})

describe('toCrmLeadContactAttemptDTO()', () => {
  it('should map all fields correctly', () => {
    const attempt = createFakeCrmLeadContactAttempt({
      id: 'ca-1',
      outcome: 'REACHED',
    })
    const dto = toCrmLeadContactAttemptDTO(attempt)
    expect(dto.id).toBe('ca-1')
    expect(dto.outcome).toBe('REACHED')
  })
})

describe('toCrmLeadQualificationDTO()', () => {
  it('should map all fields correctly', () => {
    const qualification = createFakeCrmLeadQualification({
      id: 'q-1',
      decisionMakerName: 'Carlos',
    })
    const dto = toCrmLeadQualificationDTO(qualification)
    expect(dto.id).toBe('q-1')
    expect(dto.decisionMakerName).toBe('Carlos')
  })
})

describe('toCrmLeadMeetingDTO()', () => {
  it('should map all fields correctly', () => {
    const meeting = createFakeCrmLeadMeeting({ id: 'm-1', format: 'IN_PERSON' })
    const dto = toCrmLeadMeetingDTO(meeting)
    expect(dto.id).toBe('m-1')
    expect(dto.format).toBe('IN_PERSON')
  })
})

describe('toCrmLeadProposalPresentationDTO()', () => {
  it('should convert the Decimal amount to a number', () => {
    const presentation = createFakeCrmLeadProposalPresentation({
      id: 'pp-1',
      amount: new Prisma.Decimal(2500),
      documentId: 'doc-1',
    })
    const dto = toCrmLeadProposalPresentationDTO(presentation)
    expect(dto.id).toBe('pp-1')
    expect(dto.amount).toBe(2500)
    expect(dto.documentId).toBe('doc-1')
    expect(dto.proposalId).toBeNull()
  })
})

describe('toCrmLeadReopeningDTO()', () => {
  it('should map the reopening with the snapshot of the undone loss', () => {
    const closedAt = new Date('2026-09-01T12:00:00.000Z')
    const reopening = createFakeCrmLeadReopening({
      id: 'r1',
      leadId: 'l1',
      toStage: 'QUALIFIED',
      previousClosedAt: closedAt,
      previousRetryAt: null,
    })

    const dto = toCrmLeadReopeningDTO(reopening)

    expect(dto).toMatchObject({
      id: 'r1',
      leadId: 'l1',
      toStage: 'QUALIFIED',
      reason: reopening.reason,
      previousLostReason: 'Preço',
      previousClosedAt: closedAt.toISOString(),
      previousRetryAt: null,
      createdAt: reopening.createdAt.toISOString(),
    })
  })
})
