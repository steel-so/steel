import { describe, expect, it } from 'vitest'
import {
  createFakeFusedChunk,
  createFakeKnowledgeDocument,
  createFakeKnowledgeResultDTO,
} from '@/src/__tests__/factories/ai-knowledge.factory'
import { knowledgeContentHash } from '@/src/lib/ai/knowledge/chunking'
import type {
  KnowledgeCrmNoteRow,
  KnowledgeCrmProposalRow,
  KnowledgeKbArticleRow,
  KnowledgeTicketRow,
  KnowledgeWikiPageRow,
  KnowledgeZapDocumentRow,
} from '@/src/repositories/ai-knowledge-source.repository'
import {
  toAiCitationDTO,
  toAiKnowledgeResultDTO,
  toCrmNoteKnowledge,
  toCrmProposalKnowledge,
  toEmbeddingInput,
  toKbArticleKnowledge,
  toKnowledgeChunks,
  toTicketKnowledge,
  toWikiPageKnowledge,
  toZapDocumentKnowledge,
} from '../ai-knowledge.mapper'

const T = new Date('2026-10-01T12:00:00.000Z')

function note(
  overrides: Partial<KnowledgeCrmNoteRow> = {},
): KnowledgeCrmNoteRow {
  return {
    id: 'n1',
    title: null,
    body: '<p>Cliente pediu desconto</p>',
    companyId: null,
    personId: null,
    opportunityId: null,
    leadId: null,
    updatedAt: T,
    company: null,
    person: null,
    opportunity: null,
    lead: null,
    ...overrides,
  }
}

describe('ai knowledge mapper — sources', () => {
  it('should map a KB article (portal = public, internal = agents)', () => {
    const row: KnowledgeKbArticleRow = {
      id: 'a1',
      title: 'Reset de senha',
      plainText: 'Passo 1',
      visibility: 'PORTAL',
      tags: ['senha', 'ad'],
      updatedAt: T,
      category: { name: 'Acesso' },
    }
    const doc = toKbArticleKnowledge('ws1', row)
    expect(doc).toMatchObject({
      sourceType: 'sd-kb-article',
      module: 'SERVICE_DESK',
      audience: 'PUBLIC',
      title: 'Reset de senha',
      path: '/servicedesk/knowledge/a1',
      text: 'Categoria: Acesso\nPasso 1\nTags: senha, ad',
    })
    expect(
      toKbArticleKnowledge('ws1', {
        ...row,
        visibility: 'INTERNAL',
        tags: [],
        category: null,
      }),
    ).toMatchObject({ audience: 'AGENTS', text: 'Passo 1' })
  })

  it('should map a wiki page from Plate, falling back to a JSON walk', () => {
    const row: KnowledgeWikiPageRow = {
      id: 'w1',
      title: '  ',
      content: [{ type: 'p', children: [{ text: 'Política de férias' }] }],
      updatedAt: T,
    }
    expect(toWikiPageKnowledge('ws1', row)).toMatchObject({
      sourceType: 'wiki-page',
      module: null,
      title: 'Sem título',
      text: 'Política de férias',
      path: '/wiki/w1',
    })
    expect(
      toWikiPageKnowledge('ws1', {
        ...row,
        title: 'Férias',
        content: { blocks: [{ value: 'texto solto' }] },
      }).text,
    ).toBe('texto solto')
  })

  it('should map a resolved ticket with its code, parties, problem and solution', () => {
    const row: KnowledgeTicketRow = {
      id: 't1',
      number: 42,
      type: 'INCIDENT',
      title: 'Impressora parada',
      description: '<p>Não imprime</p>',
      solution: '<p>Trocar o <b>toner</b></p>',
      requesterId: 'req',
      updatedAt: T,
      contact: { userId: 'contact-user' },
      participants: [{ userId: 'p1' }, { userId: 'req' }],
    }
    const doc = toTicketKnowledge('ws1', row, null)
    expect(doc.title).toMatch(/^INC-0*42 · Impressora parada$/)
    expect(doc).toMatchObject({
      audience: 'PARTIES',
      path: '/servicedesk/tickets/42',
      text: 'Problema: Não imprime\nSolução: Trocar o toner',
    })
    expect(doc.userIds.sort()).toEqual(['contact-user', 'p1', 'req'])
    expect(
      toTicketKnowledge(
        'ws1',
        { ...row, description: null, contact: null, participants: [] },
        null,
      ).text,
    ).toBe('Solução: Trocar o toner')
  })

  it('should map a WhatsApp AI document', () => {
    const row: KnowledgeZapDocumentRow = {
      id: 'd1',
      filename: 'manual.pdf',
      extractedText: 'Horário 9h-18h',
      updatedAt: T,
    }
    expect(toZapDocumentKnowledge('ws1', row)).toMatchObject({
      sourceType: 'zap-knowledge-doc',
      module: 'COMMUNICATION',
      title: 'manual.pdf',
      text: 'Horário 9h-18h',
      path: '/zap/configuracoes',
    })
    expect(
      toZapDocumentKnowledge('ws1', { ...row, extractedText: null }).text,
    ).toBe('')
  })

  it('should link a CRM note to the record it belongs to', () => {
    expect(
      toCrmNoteKnowledge(
        'ws1',
        note({ opportunityId: 'o1', opportunity: { name: 'Fibra 1G' } }),
      ),
    ).toMatchObject({
      title: 'Nota sobre Fibra 1G',
      path: '/crm/opportunities?record=o1',
      text: 'Registro: Fibra 1G\nCliente pediu desconto',
    })
    expect(
      toCrmNoteKnowledge('ws1', note({ leadId: 'l1', lead: { name: 'Lead' } }))
        .path,
    ).toBe('/crm/leads?record=l1')
    expect(
      toCrmNoteKnowledge(
        'ws1',
        note({ personId: 'p1', person: { name: 'Ana' }, title: 'Ligação' }),
      ),
    ).toMatchObject({ title: 'Ligação', path: '/crm/people?record=p1' })
    expect(
      toCrmNoteKnowledge(
        'ws1',
        note({ companyId: 'c1', company: { name: 'ACME' } }),
      ).path,
    ).toBe('/crm/companies?record=c1')
    expect(toCrmNoteKnowledge('ws1', note())).toMatchObject({
      title: 'Nota do CRM',
      path: '/crm',
      text: 'Cliente pediu desconto',
    })
    // Related row missing its name.
    expect(
      toCrmNoteKnowledge(
        'ws1',
        note({
          opportunityId: 'o2',
          leadId: 'l2',
          personId: 'p2',
          companyId: 'c2',
        }),
      ).title,
    ).toBe('Nota do CRM')
    for (const ids of [
      { leadId: 'l3' },
      { personId: 'p3' },
      { companyId: 'c3' },
    ]) {
      expect(toCrmNoteKnowledge('ws1', note(ids)).title).toBe('Nota do CRM')
    }
  })

  it('should map a proposal with the text of its sections', () => {
    const row: KnowledgeCrmProposalRow = {
      id: 'pr1',
      name: 'Proposta Fibra',
      status: 'SENT',
      updatedAt: T,
      company: null,
      lead: { name: 'Mercado Bom Preço' },
      sections: [{ type: 'SCOPE', content: { text: 'Instalação em 3 lojas' } }],
    }
    expect(toCrmProposalKnowledge('ws1', row)).toMatchObject({
      sourceType: 'crm-proposal',
      path: '/crm/proposals/pr1',
      text: 'Cliente: Mercado Bom Preço\nInstalação em 3 lojas',
    })
    expect(
      toCrmProposalKnowledge('ws1', {
        ...row,
        company: { name: 'ACME' },
        sections: [],
      }).text,
    ).toBe('Cliente: ACME')
    expect(
      toCrmProposalKnowledge('ws1', { ...row, lead: null, sections: [] }).text,
    ).toBe('')
  })
})

describe('ai knowledge mapper — chunks and results', () => {
  it('should chunk a document and hash every chunk', () => {
    const doc = createFakeKnowledgeDocument({
      workspaceId: 'ws1',
      sourceId: 's1',
      audience: 'PARTIES',
      userIds: ['u1'],
    })
    const chunks = toKnowledgeChunks(doc)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({
      workspaceId: 'ws1',
      sourceId: 's1',
      chunkIndex: 0,
      audience: 'PARTIES',
      userIds: ['u1'],
      contentHash: knowledgeContentHash(doc.title, doc.text),
    })
    expect(toKnowledgeChunks({ ...doc, text: '' })).toEqual([])
    expect(toEmbeddingInput({ title: 'T', content: 'C' })).toBe('T\n\nC')
  })

  it('should build the result DTO and its citation', () => {
    const entry = createFakeFusedChunk(
      { sourceType: 'crm-note', sourceId: 'n1', path: '/crm?x=1' },
      { score: 0.0327868, ranks: { text: 1, vector: 1 } },
    )
    const dto = toAiKnowledgeResultDTO(entry, 'demo', ['roteador'])
    expect(dto).toMatchObject({
      sourceType: 'crm-note',
      sourceLabel: 'Nota do CRM',
      sourceId: 'n1',
      href: '/demo/crm?x=1',
      score: 0.032787,
      matchedBy: ['text', 'vector'],
      updatedAt: '2026-10-01T12:00:00.000Z',
    })
    expect(
      toAiKnowledgeResultDTO(
        createFakeFusedChunk({}, { ranks: { vector: 2 } }),
        'demo',
        [],
      ).matchedBy,
    ).toEqual(['vector'])
    expect(toAiCitationDTO(createFakeKnowledgeResultDTO())).toEqual({
      sourceType: 'wiki-page',
      label: 'Página da Wiki',
      title: 'Como trocar a senha do Wi-Fi',
      href: '/demo/wiki/page1',
    })
  })
})
