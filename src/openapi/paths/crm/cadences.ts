import { z } from 'zod'
import {
  CreateCrmCadenceSchema,
  CrmCadenceEnrollmentActionSchema,
  EnrollCrmCadenceSchema,
  ListCrmCadenceEnrollmentsSchema,
  UpdateCrmCadenceSchema,
} from '@/src/schemas/crm-cadence.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  CrmCadenceDTO,
  CrmCadenceEnrollmentDTO,
  CrmCadenceEnrollResultDTO,
} from '../../schemas/crm/cadences'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/**
 * CRM · Cadências de vendas (slice c1-sales-cadences): sequências de passos
 * (e-mail, WhatsApp, tarefa) por lead, que param sozinhas quando o lead
 * responde. Recurso de permissão `leads`.
 */

const TAGS: RouteConfig['tags'] = ['CRM · Leads']
const BASE = '/workspaces/{id}/crm/cadences'
const ENROLLMENTS = '/workspaces/{id}/crm/cadence-enrollments'
const CADENCE_ID = 'ID da cadência.'

const NOT_FOUND: ErrorEntry = {
  code: 'CRM_CADENCE_NOT_FOUND',
  when: 'Cadência inexistente (ou arquivada) no workspace',
}
const INVALID: ErrorEntry = {
  code: 'CRM_CADENCE_INVALID',
  when: 'Falta o remetente, a conexão de WhatsApp ou um template aprovado da Meta',
}
const SENDER: ErrorEntry = {
  code: 'SENDING_DOMAIN_NOT_VERIFIED',
  when: 'O remetente não é de um domínio verificado do workspace',
}

export const crmCadenceRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: BASE,
    tags: TAGS,
    summary: 'Listar cadências',
    description: describe(
      'Cadências do workspace (sem as arquivadas), com os passos e os números: inscritos, ativos, respostas e envios por passo.',
      crmAccess('leads', 'VIEW'),
    ),
    responses: {
      200: { description: 'Cadências.', schema: z.array(CrmCadenceDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: BASE,
    tags: TAGS,
    summary: 'Criar cadência',
    description: describe(
      'Cria a cadência com todos os passos. O primeiro passo conta o intervalo a partir da inscrição; os seguintes, a partir do passo anterior. Passos de e-mail pedem remetente de domínio verificado; passos de WhatsApp pedem a conexão e, na Meta, um template aprovado.',
      crmAccess('leads', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: CreateCrmCadenceSchema,
      example: {
        name: 'Prospecção outbound',
        emailFrom: 'vendas@empresa.com.br',
        steps: [
          {
            type: 'EMAIL',
            delayValue: 0,
            delayUnit: 'DAYS',
            subject: 'Olá, {{primeiro_nome}}',
            body: 'Vi que a {{empresa}} cresce rápido…',
          },
          {
            type: 'TASK',
            delayValue: 2,
            delayUnit: 'DAYS',
            subject: 'Ligar para {{nome}}',
          },
        ],
      },
    },
    responses: {
      201: { description: 'Cadência criada.', schema: CrmCadenceDTO },
    },
    errors: [...CRM_ERRORS, INVALID, SENDER],
  },
  {
    method: 'get',
    path: `${BASE}/{cadenceId}`,
    tags: TAGS,
    summary: 'Detalhar cadência',
    description: describe(
      'Uma cadência com passos e números.',
      crmAccess('leads', 'VIEW'),
    ),
    params: { cadenceId: CADENCE_ID },
    responses: { 200: { description: 'Cadência.', schema: CrmCadenceDTO } },
    errors: [...CRM_ERRORS, NOT_FOUND],
  },
  {
    method: 'patch',
    path: `${BASE}/{cadenceId}`,
    tags: TAGS,
    summary: 'Editar, pausar ou reativar a cadência',
    description: describe(
      '`status` aceita `ACTIVE` ou `PAUSED` (pausada, nenhuma inscrição executa passos e novas inscrições são recusadas). `steps`, quando enviado, substitui a lista inteira; quem já está na cadência segue pela posição do passo.',
      crmAccess('leads', 'EDIT'),
    ),
    consent: true,
    params: { cadenceId: CADENCE_ID },
    body: { schema: UpdateCrmCadenceSchema, example: { status: 'PAUSED' } },
    responses: {
      200: { description: 'Cadência atualizada.', schema: CrmCadenceDTO },
    },
    errors: [...CRM_ERRORS, NOT_FOUND, INVALID, SENDER],
  },
  {
    method: 'delete',
    path: `${BASE}/{cadenceId}`,
    tags: TAGS,
    summary: 'Arquivar cadência',
    description: describe(
      'Arquiva a cadência e encerra as inscrições em andamento (motivo `CADENCE_ARCHIVED`). O histórico fica.',
      crmAccess('leads', 'DELETE'),
    ),
    consent: true,
    params: { cadenceId: CADENCE_ID },
    responses: { 200: { description: 'Cadência arquivada.' } },
    errors: [...CRM_ERRORS, NOT_FOUND],
  },
  {
    method: 'get',
    path: ENROLLMENTS,
    tags: TAGS,
    summary: 'Listar inscrições em cadências',
    description: describe(
      'Inscrições (lead × cadência) com o histórico dos últimos passos. Filtre por cadência, lead ou situação. Até 500, das mais recentes.',
      crmAccess('leads', 'VIEW'),
    ),
    query: ListCrmCadenceEnrollmentsSchema,
    responses: {
      200: {
        description: 'Inscrições.',
        schema: z.array(CrmCadenceEnrollmentDTO),
      },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: ENROLLMENTS,
    tags: TAGS,
    summary: 'Inscrever leads na cadência',
    description: describe(
      'Inscreve até 200 leads. Quem não pode entrar (já está na cadência, lead fechado, sem e-mail e telefone, inexistente) volta em `skipped` com o motivo; o resto entra em `enrolled`. Quem terminou a cadência pode entrar de novo.',
      crmAccess('leads', 'EDIT'),
    ),
    consent: true,
    body: {
      schema: EnrollCrmCadenceSchema,
      example: {
        cadenceId: 'ckw1cad00000ab7d3k1e5xyz',
        leadIds: ['ckw1led00000ab7d3k1e5abc'],
      },
    },
    responses: {
      201: {
        description: 'Resultado da inscrição.',
        schema: CrmCadenceEnrollResultDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      NOT_FOUND,
      {
        code: 'CRM_CADENCE_STATE_CONFLICT',
        when: 'A cadência está pausada ou não tem passos',
      },
    ],
  },
  {
    method: 'patch',
    path: `${ENROLLMENTS}/{enrollmentId}`,
    tags: TAGS,
    summary: 'Parar, pausar ou retomar uma inscrição',
    description: describe(
      '`stop` encerra (motivo `MANUAL`), `replied` registra que o lead respondeu, `pause` congela e `resume` volta a executar o passo na hora.',
      crmAccess('leads', 'EDIT'),
    ),
    consent: true,
    params: { enrollmentId: 'ID da inscrição.' },
    body: {
      schema: CrmCadenceEnrollmentActionSchema,
      example: { action: 'pause' },
    },
    responses: {
      200: {
        description: 'Inscrição atualizada.',
        schema: CrmCadenceEnrollmentDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'CRM_CADENCE_ENROLLMENT_NOT_FOUND',
        when: 'Inscrição inexistente no workspace',
      },
      {
        code: 'CRM_CADENCE_STATE_CONFLICT',
        when: 'A inscrição já terminou ou não está na situação que a ação pede',
      },
    ],
  },

  /* ------------------------------- públicas ------------------------------- */
  {
    method: 'get',
    path: '/crm/cadences/c/{token}',
    tags: ['CRM público · Campanhas'],
    summary: 'Link rastreado de e-mail de cadência',
    description:
      'Registra o clique e redireciona (302) para o endereço `u`, que o token assina: só links escritos pela própria cadência são seguidos. Com `stopOnClick` ligado na cadência, o clique encerra a inscrição (motivo `CLICKED`), exceto nos primeiros segundos após o envio, que costumam ser filtros de segurança do destinatário.',
    auth: 'public',
    rateLimit: 'ip',
    params: { token: 'Token assinado `<runId>.<assinatura>`.' },
    query: z.object({
      u: z.string().meta({
        description: 'Endereço de destino (http ou https), o mesmo do token.',
      }),
    }),
    queryValidationError: false,
    responses: {
      302: { description: 'Redireciona ao destino.', envelope: false },
    },
    errors: [
      {
        code: 'CRM_CAMPAIGN_LINK_INVALID',
        when: 'Token inválido ou destino diferente do assinado',
      },
    ],
  },
  {
    method: 'get',
    path: '/crm/cadences/o/{token}',
    tags: ['CRM público · Campanhas'],
    summary: 'Pixel de abertura de e-mail de cadência',
    description:
      'Imagem GIF 1×1 do e-mail do passo; conta a abertura. Sempre responde a imagem.',
    auth: 'public',
    rateLimit: false,
    params: { token: 'Token assinado do passo de e-mail.' },
    responses: { 200: { description: 'GIF 1×1.', envelope: false } },
  },
]
