import { describe, expect, it } from 'vitest'
import type {
  CrmCompanySearchRow,
  CrmDocumentSearchRow,
  CrmLeadSearchRow,
  CrmOpportunitySearchRow,
  CrmPersonSearchRow,
  CrmProposalSearchRow,
  CrmTaskSearchRow,
  MemberSearchRow,
  SdConfigItemSearchRow,
  SdContactSearchRow,
  SdCustomerSearchRow,
  SdKbArticleSearchRow,
  SdTicketSearchRow,
  WhiteboardSearchRow,
  ZapContactSearchRow,
  ZapConversationSearchRow,
} from '@/src/repositories/search-source.repository'
import {
  toCrmCompanySearchDocument,
  toCrmDocumentSearchDocument,
  toCrmLeadSearchDocument,
  toCrmOpportunitySearchDocument,
  toCrmPersonSearchDocument,
  toCrmProposalSearchDocument,
  toCrmTaskSearchDocument,
  toMemberSearchDocument,
  toSdConfigItemSearchDocument,
  toSdContactSearchDocument,
  toSdCustomerSearchDocument,
  toSdKbArticleSearchDocument,
  toSdTicketSearchDocument,
  toSearchResultDTO,
  toWhiteboardSearchDocument,
  toZapContactSearchDocument,
  toZapConversationSearchDocument,
} from '../search-document.mapper'

const WS = 'ws1'
const T = new Date('2026-10-01T10:00:00.000Z')

function ticket(overrides: Partial<SdTicketSearchRow> = {}): SdTicketSearchRow {
  return {
    id: 't1',
    number: 123,
    type: 'INCIDENT',
    title: 'Impressora parada',
    description: '<p>Não imprime&nbsp;nada</p>',
    requesterId: 'req',
    assigneeId: 'agent',
    updatedAt: T,
    phase: { name: 'Em atendimento' },
    requester: { name: 'Maria' },
    customer: { name: 'Agro Telecom' },
    company: null,
    contact: { name: 'Contato', userId: 'cu' },
    participants: [{ userId: 'p1' }, { userId: 'req' }],
    ...overrides,
  }
}

describe('search document mapper', () => {
  describe('sd-ticket', () => {
    it('should index code, number, requester and parties', () => {
      const doc = toSdTicketSearchDocument(WS, ticket(), { INCIDENT: 'CHM' })
      expect(doc).toMatchObject({
        workspaceId: WS,
        entityType: 'sd-ticket',
        entityId: 't1',
        module: 'SERVICE_DESK',
        audience: 'PARTIES',
        title: 'Impressora parada',
        subtitle:
          'CHM-000123 · Incidente · Em atendimento · Solicitante: Maria',
        body: 'Não imprime nada Agro Telecom Contato',
        keywords: 'CHM-000123 CHM 000123 123',
        codes: ['chm-123', '123'],
        path: '/servicedesk/tickets/123',
        updatedAt: T,
      })
      expect(doc.userIds).toEqual(['req', 'agent', 'cu', 'p1'])
    })

    it('should fall back to the contact and default prefixes', () => {
      const doc = toSdTicketSearchDocument(
        WS,
        ticket({ requester: null, description: null, customer: null }),
        null,
      )
      expect(doc.subtitle).toContain('Solicitante: Contato')
      expect(doc.codes[0]).toBe('inc-123')
      expect(doc.body).toBe('Contato')
    })

    it('should omit the requester when there is none', () => {
      const doc = toSdTicketSearchDocument(
        WS,
        ticket({
          requester: null,
          contact: null,
          description: null,
          customer: null,
        }),
        null,
      )
      expect(doc.subtitle).toBe('INC-000123 · Incidente · Em atendimento')
      expect(doc.body).toBeNull()
    })
  })

  describe('sd-kb-article', () => {
    const article: SdKbArticleSearchRow = {
      id: 'k1',
      title: 'Como configurar VPN',
      plainText: 'Passo a passo',
      status: 'PUBLISHED',
      visibility: 'PORTAL',
      archivedAt: null,
      tags: ['vpn', '  ', 'rede'],
      createdById: 'u1',
      updatedAt: T,
      category: { name: 'Rede' },
    }

    it('should be public when published on the portal', () => {
      expect(toSdKbArticleSearchDocument(WS, article)).toMatchObject({
        audience: 'PUBLIC',
        subtitle: 'Rede · Publicado · Portal',
        keywords: 'vpn rede',
        path: '/servicedesk/knowledge/k1',
      })
    })

    it('should be agent-only when internal or not published', () => {
      expect(
        toSdKbArticleSearchDocument(WS, {
          ...article,
          visibility: 'INTERNAL',
          category: null,
        }),
      ).toMatchObject({ audience: 'AGENTS', subtitle: 'Publicado · Interno' })
      expect(
        toSdKbArticleSearchDocument(WS, { ...article, status: 'DRAFT' })
          .audience,
      ).toBe('AGENTS')
      expect(
        toSdKbArticleSearchDocument(WS, { ...article, archivedAt: T }).audience,
      ).toBe('AGENTS')
    })
  })

  describe('sd directory', () => {
    const customer: SdCustomerSearchRow = {
      id: 'c1',
      kind: 'COMPANY',
      name: 'Agro Telecom',
      tradeName: 'Agro',
      document: '12345678000190',
      email: 'contato@agro.com.br',
      phone: null,
      whatsapp: '+55 11 99999-0000',
      city: 'Campinas',
      state: 'SP',
      notes: null,
      createdById: 'u1',
      updatedAt: T,
    }

    it('should route companies and clients to their pages', () => {
      const company = toSdCustomerSearchDocument(WS, customer)
      expect(company).toMatchObject({
        audience: 'AGENTS',
        subtitle: 'Empresa · Agro · 12345678000190 · Campinas/SP',
        path: '/servicedesk/companies?record=c1',
        body: null,
      })
      expect(company.codes).toEqual(
        expect.arrayContaining([
          '12345678000190',
          'contato@agro.com.br',
          '11999990000',
        ]),
      )
      expect(company.keywords).toContain('contato agro com br')
      const client = toSdCustomerSearchDocument(WS, {
        ...customer,
        kind: 'CLIENT',
        tradeName: null,
        city: null,
        state: null,
      })
      expect(client.path).toBe('/servicedesk/customers?record=c1')
      expect(client.subtitle).toBe('Cliente · 12345678000190')
    })

    it('should index contacts with their customers', () => {
      const row: SdContactSearchRow = {
        id: 'ct1',
        name: 'João',
        jobTitle: 'TI',
        email: 'joao@agro.com.br',
        phone: null,
        whatsapp: null,
        notes: 'VIP',
        userId: 'u9',
        updatedAt: T,
        customers: [
          { customer: { name: 'Agro' } },
          { customer: { name: 'B' } },
        ],
      }
      expect(toSdContactSearchDocument(WS, row)).toMatchObject({
        title: 'João',
        subtitle: 'TI · Agro, B · joao@agro.com.br',
        body: 'VIP',
        userIds: ['u9'],
        path: '/servicedesk/contacts?record=ct1',
      })
      expect(
        toSdContactSearchDocument(WS, {
          ...row,
          customers: [],
          jobTitle: null,
          email: null,
          userId: null,
        }).subtitle,
      ).toBeNull()
    })

    it('should index configuration items by code, serial and ip', () => {
      const row: SdConfigItemSearchRow = {
        id: 'ci1',
        name: 'Servidor de arquivos',
        code: 'PAT-0042',
        serialNumber: 'SN123',
        ipAddress: '10.0.0.5',
        manufacturer: 'Dell',
        model: 'R740',
        location: null,
        notes: null,
        ownerId: 'u1',
        updatedAt: T,
        type: { name: 'Servidor' },
        customer: null,
      }
      const doc = toSdConfigItemSearchDocument(WS, row)
      expect(doc).toMatchObject({
        subtitle: 'Servidor · PAT-0042',
        body: 'Dell R740',
        path: '/servicedesk/config-items?record=ci1',
      })
      expect(doc.codes).toEqual(['pat-42', 'sn-123', '10.0.0.5'])
    })
  })

  describe('crm', () => {
    it('should index leads with stage, e-mails and phones', () => {
      const row: CrmLeadSearchRow = {
        id: 'l1',
        name: 'Fazenda Boa Vista',
        emails: ['compras@boavista.com'],
        phones: ['(19) 3333-4444'],
        company: 'Boa Vista',
        jobTitle: null,
        city: 'Campinas',
        source: null,
        channel: 'WhatsApp',
        stage: 'QUALIFIED',
        ownerId: 'u1',
        updatedAt: T,
      }
      expect(toCrmLeadSearchDocument(WS, row)).toMatchObject({
        module: 'CRM',
        audience: 'PUBLIC',
        subtitle: 'Boa Vista · Qualificado',
        body: 'Campinas WhatsApp',
        codes: ['compras@boavista.com', '1933334444'],
        userIds: ['u1'],
        path: '/crm/leads?record=l1',
      })
    })

    it('should index opportunities, people and companies', () => {
      const opp: CrmOpportunitySearchRow = {
        id: 'o1',
        name: 'Link 1 Gbps',
        source: null,
        ownerId: null,
        createdById: 'u1',
        updatedAt: T,
        stage: { name: 'Negociação' },
        company: { name: 'Agro' },
        pointOfContact: null,
      }
      expect(toCrmOpportunitySearchDocument(WS, opp)).toMatchObject({
        subtitle: 'Agro · Negociação',
        body: null,
        userIds: ['u1'],
        path: '/crm/opportunities?record=o1',
      })

      const person: CrmPersonSearchRow = {
        id: 'p1',
        name: 'Ana',
        emails: ['ana@x.com'],
        phones: [],
        jobTitle: 'CEO',
        city: null,
        createdById: 'u1',
        updatedAt: T,
        company: null,
      }
      expect(toCrmPersonSearchDocument(WS, person)).toMatchObject({
        subtitle: 'CEO · ana@x.com',
        path: '/crm/people?record=p1',
      })

      const company: CrmCompanySearchRow = {
        id: 'co1',
        name: '',
        cnpj: null,
        domain: 'agro.com.br',
        accountOwnerId: 'u2',
        createdById: 'u1',
        updatedAt: T,
      }
      expect(toCrmCompanySearchDocument(WS, company)).toMatchObject({
        title: 'Empresa sem nome',
        subtitle: 'agro.com.br',
        userIds: ['u2', 'u1'],
      })
    })

    it('should index tasks with the most specific related record', () => {
      const base: CrmTaskSearchRow = {
        id: 'ta1',
        title: 'Ligar',
        body: 'Retornar proposta',
        status: 'TODO',
        assigneeId: 'u3',
        createdById: 'u1',
        updatedAt: T,
        company: { name: 'Co' },
        person: { name: 'Pe' },
        opportunity: { name: 'Op' },
      }
      expect(toCrmTaskSearchDocument(WS, base).subtitle).toBe('A fazer · Op')
      expect(
        toCrmTaskSearchDocument(WS, { ...base, opportunity: null }).subtitle,
      ).toBe('A fazer · Co')
      expect(
        toCrmTaskSearchDocument(WS, {
          ...base,
          opportunity: null,
          company: null,
        }).subtitle,
      ).toBe('A fazer · Pe')
    })

    it('should index proposals by status and counterpart', () => {
      const row: CrmProposalSearchRow = {
        id: 'pr1',
        name: 'Proposta Agro',
        status: 'SENT',
        responsibleId: 'u1',
        updatedAt: T,
        company: null,
        contact: { name: 'Ana' },
        lead: { name: 'Lead X' },
      }
      expect(toCrmProposalSearchDocument(WS, row)).toMatchObject({
        subtitle: 'Enviada · Lead X · Ana',
        path: '/crm/proposals/pr1',
      })
    })

    it('should index documents by kind, status or template and links', () => {
      const row: CrmDocumentSearchRow = {
        id: 'doc1',
        title: 'Proposta Agro 2027',
        kind: 'PROPOSAL',
        status: 'VIEWED',
        isTemplate: false,
        ownerId: 'u1',
        updatedAt: T,
        company: null,
        person: { name: 'Ana' },
        lead: { name: 'Lead X' },
        opportunity: { name: 'Implantação' },
      }
      expect(toCrmDocumentSearchDocument(WS, row)).toMatchObject({
        entityType: 'crm-document',
        title: 'Proposta Agro 2027',
        subtitle: 'Proposta · Visualizado · Lead X · Ana · Implantação',
        userIds: ['u1'],
        path: '/crm/documents/doc1',
      })
      expect(
        toCrmDocumentSearchDocument(WS, {
          ...row,
          kind: 'CONTRACT',
          isTemplate: true,
          company: { name: 'Agro' },
          person: null,
          lead: null,
          opportunity: null,
        }).subtitle,
      ).toBe('Contrato · Modelo · Agro')
    })
  })

  describe('whatsapp', () => {
    it('should index contacts by name or formatted phone', () => {
      const row: ZapContactSearchRow = {
        id: 'z1',
        name: null,
        waId: '5511999990000',
        description: null,
        updatedAt: T,
      }
      expect(toZapContactSearchDocument(WS, row)).toMatchObject({
        title: '+55 (11) 99999-0000',
        path: '/zap/contatos?q=5511999990000',
        codes: ['5511999990000', '11999990000'],
      })
      expect(
        toZapContactSearchDocument(WS, { ...row, name: 'Zé', waId: '123' })
          .subtitle,
      ).toBe('123')
    })

    it('should index conversations with the last visible message', () => {
      const row: ZapConversationSearchRow = {
        id: 'cv1',
        status: 'IN_PROGRESS',
        assignedUserId: 'u1',
        archivedAt: T,
        clearedAt: null,
        lastMessageAt: T,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        contact: { name: 'Zé', waId: '5511999990000' },
        messages: [{ text: 'Meu boleto venceu', createdAt: T }],
      }
      expect(toZapConversationSearchDocument(WS, row)).toMatchObject({
        title: 'Zé',
        subtitle: '+55 (11) 99999-0000 · Em atendimento · Arquivada',
        body: 'Meu boleto venceu',
        path: '/zap?conversa=cv1',
        updatedAt: T,
      })
      const cleared = toZapConversationSearchDocument(WS, {
        ...row,
        archivedAt: null,
        clearedAt: new Date('2026-10-02T00:00:00.000Z'),
        lastMessageAt: null,
        contact: { name: null, waId: '5511999990000' },
      })
      expect(cleared.body).toBeNull()
      expect(cleared.title).toBe('+55 (11) 99999-0000')
      expect(cleared.updatedAt).toEqual(row.updatedAt)
      expect(
        toZapConversationSearchDocument(WS, {
          ...row,
          clearedAt: new Date('2025-01-01T00:00:00.000Z'),
          messages: [],
        }).body,
      ).toBeNull()
      expect(
        toZapConversationSearchDocument(WS, {
          ...row,
          clearedAt: new Date('2025-01-01T00:00:00.000Z'),
        }).body,
      ).toBe('Meu boleto venceu')
    })
  })

  describe('member', () => {
    it('should index members by name, e-mail and username', () => {
      const row: MemberSearchRow = {
        userId: 'u1',
        role: 'ADMIN',
        updatedAt: T,
        user: {
          name: 'Ana Busca',
          email: 'ana@stratus.test',
          username: 'ana',
          updatedAt: new Date('2026-10-05T00:00:00.000Z'),
        },
      }
      const doc = toMemberSearchDocument(WS, row)
      expect(doc).toMatchObject({
        entityId: 'u1',
        module: null,
        subtitle: 'ana@stratus.test · Administrador',
        codes: ['ana@stratus.test', 'ana'],
        userIds: ['u1'],
        path: '/settings/members',
      })
      expect(doc.updatedAt).toEqual(row.user.updatedAt)
      expect(
        toMemberSearchDocument(WS, {
          ...row,
          user: { ...row.user, updatedAt: new Date('2020-01-01T00:00:00Z') },
        }).updatedAt,
      ).toEqual(T)
    })
  })

  describe('whiteboard', () => {
    it('should index the title and the live text of the board', () => {
      const row: WhiteboardSearchRow = {
        id: 'b1',
        title: 'Retro da sprint',
        scene: {
          elements: [
            { id: 'a', type: 'text', text: 'Melhorar deploy' },
            { id: 'b', type: 'text', text: 'apagado', isDeleted: true },
          ],
        },
        createdById: 'u1',
        updatedById: 'u2',
        editedAt: T,
        createdBy: { name: 'Ana' },
      }
      expect(toWhiteboardSearchDocument(WS, row)).toMatchObject({
        entityType: 'whiteboard',
        entityId: 'b1',
        module: null,
        title: 'Retro da sprint',
        subtitle: 'Quadro-branco · Ana',
        body: 'Melhorar deploy',
        userIds: ['u1', 'u2'],
        path: '/whiteboard/b1',
        updatedAt: T,
      })
      expect(
        toWhiteboardSearchDocument(WS, {
          ...row,
          title: '',
          scene: null,
          createdBy: null,
        }),
      ).toMatchObject({
        title: 'Quadro sem título',
        subtitle: 'Quadro-branco',
        body: null,
      })
    })
  })

  it('should map a ranked hit to the DTO with the workspace slug', () => {
    expect(
      toSearchResultDTO(
        {
          entityType: 'crm-lead',
          entityId: 'l1',
          module: 'CRM',
          title: 'Lead',
          subtitle: null,
          body: 'corpo',
          path: '/crm/leads?record=l1',
          updatedAt: T,
          exact: false,
          titlePrefix: true,
          titlePhrase: true,
          textRank: 0.5,
          similarity: 0.4,
          isMine: true,
          score: 412.5,
        },
        'agro',
      ),
    ).toEqual({
      type: 'crm-lead',
      id: 'l1',
      title: 'Lead',
      subtitle: null,
      snippet: 'corpo',
      href: '/agro/crm/leads?record=l1',
      module: 'CRM',
      group: 'Leads',
      score: 412.5,
      isMine: true,
      updatedAt: T.toISOString(),
    })
  })
})
