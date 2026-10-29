import { SubscribeCrmPersonNewsletterSchema } from '@/src/schemas/crm-newsletter-bridge.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import { CrmPersonNewslettersDTO } from '../../schemas/crm/newsletter-bridge'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/**
 * CRM · Newsletters — ponte com o CRM (ADR 0054, fase 2): o cartão
 * "Newsletters" da pessoa. Linha do tempo, pontuação de leads e gatilhos de
 * workflow não têm rotas próprias (vêm das regras e dos workflows).
 */

const TAGS: RouteConfig['tags'] = ['CRM · Newsletters']
const BASE = '/workspaces/{id}/crm/people/{personId}/newsletters'
const PERSON_ID = 'ID da pessoa do CRM.'

const PERSON_NOT_FOUND: ErrorEntry = {
  code: 'RESOURCE_NOT_FOUND',
  when: 'Pessoa inexistente (ou excluída) no workspace',
}

export const crmNewsletterBridgeRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: BASE,
    tags: TAGS,
    summary: 'Newsletters da pessoa',
    description: describe(
      'Inscrições ligadas à pessoa ou a um dos e-mails dela, com a situação de cada uma, e as newsletters ativas em que ela pode entrar.',
      crmAccess('email', 'VIEW'),
    ),
    params: { personId: PERSON_ID },
    responses: {
      200: {
        description: 'Inscrições da pessoa.',
        schema: CrmPersonNewslettersDTO,
      },
    },
    errors: [...CRM_ERRORS, PERSON_NOT_FOUND],
  },
  {
    method: 'post',
    path: BASE,
    tags: TAGS,
    summary: 'Inscrever a pessoa',
    description: describe(
      'Inscreve um e-mail da pessoa (o primeiro, se omitido) como na adição manual: `ACTIVE` na hora (o membro declara o consentimento) ou `PENDING` com `sendConfirmation`; quem tinha saído só volta confirmando. Auditado; entra na linha do tempo e dispara a pontuação e os workflows de inscrição.',
      crmAccess('email', 'CREATE'),
    ),
    params: { personId: PERSON_ID },
    consent: true,
    body: {
      schema: SubscribeCrmPersonNewsletterSchema,
      example: { newsletterId: 'ckw1nl00000ab7d3k1e5xyz' },
    },
    responses: {
      201: {
        description: 'Inscrições atualizadas.',
        schema: CrmPersonNewslettersDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      PERSON_NOT_FOUND,
      {
        code: 'CRM_NEWSLETTER_NOT_FOUND',
        when: 'Newsletter inexistente no workspace',
      },
      {
        code: 'CRM_NEWSLETTER_ARCHIVED',
        when: 'Newsletter arquivada',
      },
      {
        code: 'CRM_NEWSLETTER_SUBSCRIBER_EXISTS',
        when: 'O e-mail já está ativo ou aguardando confirmação',
      },
      {
        code: 'VALIDATION_ERROR',
        when: 'Pessoa sem e-mail, e-mail que não é dela, descadastro do workspace, retorno permanente ou denúncia de spam',
      },
    ],
  },
  {
    method: 'delete',
    path: `${BASE}/{subscriberId}`,
    tags: TAGS,
    summary: 'Descadastrar a pessoa',
    description: describe(
      'Tira a pessoa de uma newsletter (`UNSUBSCRIBED`, motivo "Descadastrado por um membro do workspace."). Não apaga o histórico. Auditado; entra na linha do tempo e dispara os workflows de descadastro.',
      crmAccess('email', 'EDIT'),
    ),
    params: { personId: PERSON_ID, subscriberId: 'ID do assinante.' },
    consent: true,
    responses: {
      200: {
        description: 'Inscrições atualizadas.',
        schema: CrmPersonNewslettersDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      PERSON_NOT_FOUND,
      {
        code: 'CRM_NEWSLETTER_SUBSCRIBER_NOT_FOUND',
        when: 'Inscrição inexistente ou de outra pessoa',
      },
      {
        code: 'VALIDATION_ERROR',
        when: 'A inscrição já não está ativa',
      },
    ],
  },
]
