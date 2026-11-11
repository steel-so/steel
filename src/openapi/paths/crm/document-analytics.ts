import { DocumentAnalyticsQuerySchema } from '@/src/schemas/document-analytics.schema'
import { DocumentTrackSchema } from '@/src/schemas/document.schema'
import type { RouteConfig } from '../../registry'
import { DocumentAnalyticsDTO } from '../../schemas/crm/document-analytics'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/**
 * Reading analytics of CRM > Documentos (ADR 0063): the panel of a document
 * (or the aggregate of a template) and the beacon of the public link.
 */

const TAG = 'CRM · Leitura de documentos' as const
const PUBLIC_TAG = 'CRM público · Leitura de documentos' as const

export const crmDocumentAnalyticsRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/crm/documents/{documentId}/analytics',
    tags: [TAG],
    summary: 'Analytics de leitura do documento',
    description: describe(
      'Tempo total e médio, leitores únicos, % que chegou ao fim, revisitas, encaminhamentos, tempo e alcance por seção da versão atual, dispositivos, leitores e a série diária (dias no fuso America/Sao_Paulo). Num **modelo**, soma os documentos criados a partir dele. Os números chegam com até 1 minuto de atraso (buffer de leitura).',
      crmAccess('documents', 'VIEW'),
    ),
    params: { documentId: 'ID do documento ou do modelo.' },
    query: DocumentAnalyticsQuerySchema,
    responses: {
      200: {
        description: 'Analytics de leitura.',
        schema: DocumentAnalyticsDTO,
      },
    },
    errors: [...CRM_ERRORS, 'DOCUMENT_NOT_FOUND'],
  },
  {
    method: 'post',
    path: '/documents/{token}/track',
    auth: 'public',
    rateLimit: 'ip',
    tags: [PUBLIC_TAG],
    summary: 'Registrar leitura do documento',
    description:
      'Sinal do rastreador do link público `/d/<token>` (a cada ~15 s e ao sair, via `navigator.sendBeacon`, por isso o corpo pode chegar como `text/plain`). O primeiro sinal da sessão grava o evento `OPENED` e avisa o dono; os demais só somam tempo, rolagem e seções. O IP é guardado apenas como hash e o referrer só como domínio.',
    params: {
      token: 'Token do destinatário (link pessoal) ou `publicToken` do documento.',
    },
    body: {
      schema: DocumentTrackSchema,
      example: {
        sessionKey: 'aba-exemplo-0001',
        visitorId: 'navegador-exemplo-0001',
        activeMs: 14000,
        sections: { 'sec-intro': 9000, 'sec-precos': 5000 },
        entered: ['sec-precos'],
        scrollPct: 42,
        reachedEnd: false,
        first: false,
        device: 'mobile',
        events: [
          {
            type: 'link_clicked',
            target: 'https://cliente.com.br',
            sectionId: 'sec-intro',
          },
        ],
      },
    },
    responses: { 200: { description: 'Sinal registrado.', schema: null } },
    errors: [
      {
        code: 'DOCUMENT_LINK_UNAVAILABLE',
        when: 'Token desconhecido, documento nunca enviado, arquivado ou excluído, ou link genérico desligado',
      },
      {
        code: 'MODULE_DISABLED',
        when: 'O workspace está com o CRM desabilitado',
      },
      { code: 'BAD_REQUEST', when: 'Corpo acima de 64 KB' },
    ],
  },
]
