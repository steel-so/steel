import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  toCustomer360CallDTO,
  toCustomer360CompanyDTO,
  toCustomer360ConversationDTO,
  toCustomer360DocumentDTO,
  toCustomer360HealthDTO,
  toCustomer360LeadDTO,
  toCustomer360OpportunityDTO,
  toCustomer360PersonDTO,
  toCustomer360TicketDTO,
} from '../customer-360.mapper'

const at = new Date('2026-11-13T12:00:00Z')
const iso = at.toISOString()

describe('customer 360 mapper', () => {
  it('maps the person', () => {
    expect(
      toCustomer360PersonDTO({
        id: 'p',
        name: 'Ana',
        jobTitle: null,
        emails: ['a@b.c'],
        phones: ['1'],
        companyId: 'c',
      }),
    ).toEqual({
      id: 'p',
      name: 'Ana',
      jobTitle: null,
      emails: ['a@b.c'],
      phones: ['1'],
      companyId: 'c',
    })
  })

  it('maps the company with and without ARR and owner', () => {
    const base = {
      id: 'c',
      name: 'Acme',
      cnpj: null,
      accountOwnerId: null,
    }
    expect(
      toCustomer360CompanyDTO({
        ...base,
        arr: new Prisma.Decimal('1200.5'),
        accountOwnerId: 'u',
        accountOwner: { name: 'Bia' },
      }),
    ).toMatchObject({ arr: 1200.5, accountOwnerName: 'Bia' })
    expect(
      toCustomer360CompanyDTO({ ...base, arr: null, accountOwner: null }),
    ).toMatchObject({ arr: null, accountOwnerName: null })
  })

  it('maps the health with the label, the inverted score and the action', () => {
    expect(
      toCustomer360HealthDTO({
        riskScore: 75,
        level: 'HIGH',
        nextAction: { key: 'k', label: 'Ligar hoje', detail: 'd' },
        computedAt: at,
      }),
    ).toEqual({
      level: 'HIGH',
      levelLabel: 'Risco alto',
      riskScore: 75,
      healthScore: 25,
      nextActionLabel: 'Ligar hoje',
      computedAt: iso,
    })
    expect(
      toCustomer360HealthDTO({
        riskScore: 10,
        level: 'LOW',
        nextAction: 'garbage',
        computedAt: at,
      }).nextActionLabel,
    ).toBe('Sem ação sugerida')
  })

  it('maps the opportunity', () => {
    const row = {
      id: 'o',
      name: 'Plano',
      amount: new Prisma.Decimal('99'),
      closeDate: at,
      updatedAt: at,
      stage: { name: 'Qualificação', category: 'OPEN' },
      pipeline: { name: 'Vendas' },
      owner: { name: 'Bia' },
    }
    expect(toCustomer360OpportunityDTO(row)).toEqual({
      id: 'o',
      name: 'Plano',
      amount: 99,
      stageName: 'Qualificação',
      stageCategory: 'OPEN',
      pipelineName: 'Vendas',
      ownerName: 'Bia',
      closeDate: iso,
      updatedAt: iso,
    })
    expect(
      toCustomer360OpportunityDTO({
        ...row,
        amount: null,
        closeDate: null,
        owner: null,
      }),
    ).toMatchObject({ amount: null, closeDate: null, ownerName: null })
  })

  it('maps the lead', () => {
    expect(
      toCustomer360LeadDTO({
        id: 'l',
        name: 'Lead',
        stage: 'RECEIVED',
        createdAt: at,
        owner: null,
      }),
    ).toEqual({
      id: 'l',
      name: 'Lead',
      stage: 'RECEIVED',
      ownerName: null,
      createdAt: iso,
    })
  })

  it('maps the ticket flags', () => {
    const row = {
      id: 't',
      number: 7,
      title: 'Sem internet',
      type: 'INCIDENT',
      createdAt: at,
      closedAt: null,
      resolvedAt: null,
      resolutionDueAt: at,
      resolutionBreached: false,
      firstResponseBreached: false,
      csatScore: null,
      phase: { name: 'Novo', category: 'NEW' },
      priority: { name: 'Alta' },
    }
    expect(toCustomer360TicketDTO(row)).toMatchObject({
      open: true,
      slaBreached: false,
      priorityName: 'Alta',
      resolutionDueAt: iso,
    })
    expect(
      toCustomer360TicketDTO({
        ...row,
        closedAt: at,
        firstResponseBreached: true,
        resolutionDueAt: null,
        priority: null,
        csatScore: 4,
      }),
    ).toMatchObject({
      open: false,
      slaBreached: true,
      priorityName: null,
      resolutionDueAt: null,
      csatScore: 4,
    })
    expect(
      toCustomer360TicketDTO({ ...row, resolvedAt: at, resolutionBreached: true }),
    ).toMatchObject({ open: false, slaBreached: true })
  })

  it('maps the conversation', () => {
    const row = {
      id: 'v',
      status: 'NEW',
      lastMessageAt: at,
      contact: { name: 'Ana', waId: '5511988887777' },
      connection: { label: 'Oficial' },
    }
    expect(toCustomer360ConversationDTO(row)).toEqual({
      id: 'v',
      contactName: 'Ana',
      contactPhone: '5511988887777',
      status: 'NEW',
      connectionLabel: 'Oficial',
      lastMessageAt: iso,
    })
    expect(
      toCustomer360ConversationDTO({ ...row, lastMessageAt: null }).lastMessageAt,
    ).toBeNull()
  })

  it('maps the call', () => {
    expect(
      toCustomer360CallDTO({
        id: 'k',
        direction: 'INBOUND',
        status: 'COMPLETED',
        durationSeconds: 61,
        summary: 'Resumo',
        conversationId: 'v',
        createdAt: at,
      }),
    ).toEqual({
      id: 'k',
      direction: 'INBOUND',
      status: 'COMPLETED',
      durationSeconds: 61,
      summary: 'Resumo',
      conversationId: 'v',
      createdAt: iso,
    })
  })

  it('maps the document value', () => {
    const row = {
      id: 'd',
      title: 'Proposta',
      kind: 'PROPOSAL',
      status: 'SENT',
      totalValue: new Prisma.Decimal('10.5'),
      updatedAt: at,
    }
    expect(toCustomer360DocumentDTO(row).totalValue).toBe(10.5)
    expect(toCustomer360DocumentDTO({ ...row, totalValue: null }).totalValue)
      .toBeNull()
  })
})
