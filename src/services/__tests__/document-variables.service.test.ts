import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeDocument,
  createFakeDocumentRecipient,
  decimal,
} from '@/src/__tests__/factories/document-backend.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import {
  documentNotFound,
  documentRecipientNotFound,
} from '@/src/errors/app-error'
import { formatDocumentDate } from '@/src/lib/documents/format'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/document.repository')
vi.mock('@/src/repositories/document-recipient.repository')

import {
  DocumentRepository,
  type DocumentVariableContext,
} from '@/src/repositories/document.repository'
import { DocumentRecipientRepository } from '@/src/repositories/document-recipient.repository'
import { DocumentVariablesService } from '../document-variables.service'

const documentRepo = vi.mocked(DocumentRepository)
const recipientRepo = vi.mocked(DocumentRecipientRepository)

function variableContext(
  overrides?: Partial<DocumentVariableContext>,
): DocumentVariableContext {
  return {
    ...createFakeDocument({
      title: 'Proposta 2027',
      validUntil: new Date('2026-11-30T15:00:00.000Z'),
      totalValue: decimal(48000),
    }),
    person: {
      name: 'Maria Souza',
      emails: ['maria@cliente.com.br'],
      phones: ['11988887777'],
    },
    company: { name: 'Cliente Ltda', cnpj: '12345678000190' },
    opportunity: { name: 'Implantação', amount: decimal(1500.5) },
    lead: null,
    owner: { name: 'João Lima', email: 'joao@example.com' },
    workspace: { name: 'Stratus Telecom' },
    ...overrides,
  }
}

beforeEach(() => {
  documentRepo.findVariableContext.mockResolvedValue(ok(variableContext()))
})

describe('DocumentVariablesService.forDocument()', () => {
  it('formats the CRM values for pt-BR', async () => {
    const values = expectOk(
      await DocumentVariablesService.forDocument('d1', null),
    )
    expect(values).toEqual({
      'contato.nome': 'Maria Souza',
      'contato.email': 'maria@cliente.com.br',
      'contato.telefone': '(11) 98888-7777',
      'empresa.nome': 'Cliente Ltda',
      'empresa.cnpj': '12.345.678/0001-90',
      'oportunidade.titulo': 'Implantação',
      'oportunidade.valor': 'R$ 1.500,50',
      'responsavel.nome': 'João Lima',
      'responsavel.email': 'joao@example.com',
      'documento.titulo': 'Proposta 2027',
      'documento.validade': '30/11/2026',
      'documento.total': 'R$ 48.000,00',
      'workspace.nome': 'Stratus Telecom',
      'data.hoje': formatDocumentDate(new Date()),
    })
  })

  it('falls back to the lead, then to the recipient', async () => {
    recipientRepo.findById.mockResolvedValue(
      ok(
        createFakeDocumentRecipient({
          name: 'Ana',
          email: 'ana@example.com',
          phone: '1133334444',
        }),
      ),
    )
    documentRepo.findVariableContext.mockResolvedValue(
      ok(
        variableContext({
          person: null,
          lead: { name: 'Lead Bom', emails: [], phones: [] },
        }),
      ),
    )
    const fromLead = expectOk(
      await DocumentVariablesService.forDocument('d1', 'r1'),
    )
    expect(fromLead['contato.nome']).toBe('Lead Bom')
    expect(fromLead['contato.email']).toBe('ana@example.com')
    expect(fromLead['contato.telefone']).toBe('(11) 3333-4444')
    expect(fromLead['destinatario.nome']).toBe('Ana')
    expect(fromLead['destinatario.email']).toBe('ana@example.com')

    documentRepo.findVariableContext.mockResolvedValue(
      ok(
        variableContext({
          person: null,
          lead: null,
          company: null,
          opportunity: null,
          validUntil: null,
          totalValue: null,
        }),
      ),
    )
    const fromRecipient = expectOk(
      await DocumentVariablesService.forDocument('d1', 'r1'),
    )
    expect(fromRecipient['contato.nome']).toBe('Ana')
    expect(fromRecipient['empresa.nome']).toBeUndefined()
    expect(fromRecipient['documento.validade']).toBeUndefined()
    expect(fromRecipient['documento.total']).toBeUndefined()
    expect(fromRecipient['oportunidade.valor']).toBeUndefined()
  })

  it('omits empty values and a CNPJ that is not set', async () => {
    documentRepo.findVariableContext.mockResolvedValue(
      ok(
        variableContext({
          company: { name: '', cnpj: null },
          opportunity: { name: 'Sem valor', amount: null },
        }),
      ),
    )
    const values = expectOk(
      await DocumentVariablesService.forDocument('d1', null),
    )
    expect(values['empresa.nome']).toBeUndefined()
    expect(values['empresa.cnpj']).toBeUndefined()
    expect(values['oportunidade.valor']).toBeUndefined()
  })

  it('ignores a recipient that no longer exists', async () => {
    recipientRepo.findById.mockResolvedValue(err(documentRecipientNotFound()))
    const values = expectOk(
      await DocumentVariablesService.forDocument('d1', 'gone'),
    )
    expect(values['destinatario.nome']).toBeUndefined()
  })

  it('propagates database errors and a missing document', async () => {
    recipientRepo.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await DocumentVariablesService.forDocument('d1', 'r1'),
      'DATABASE_ERROR',
    )
    documentRepo.findVariableContext.mockResolvedValue(err(documentNotFound()))
    expectErr(
      await DocumentVariablesService.forDocument('d1', null),
      'DOCUMENT_NOT_FOUND',
    )
  })
})
