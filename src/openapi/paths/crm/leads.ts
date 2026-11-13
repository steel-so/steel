import { z } from 'zod'
import {
  CloseCrmLeadLostSchema,
  CloseCrmLeadWonSchema,
  CreateCrmLeadProposalSchema,
  CreateCrmLeadRoutingRuleSchema,
  CreateCrmLeadSchema,
  CreateCrmLeadScoringRuleSchema,
  ListCrmLeadsSchema,
  OpenCrmLeadWhatsappSchema,
  RegisterCrmLeadContactAttemptSchema,
  RegisterCrmLeadMeetingSchema,
  RegisterCrmLeadProposalPresentationSchema,
  ReopenCrmLeadSchema,
  ReorderCrmLeadsSchema,
  SetCrmLeadInterestProductsSchema,
  UpdateCrmLeadRoutingRuleSchema,
  UpdateCrmLeadSchema,
  UpdateCrmLeadScoringRuleSchema,
  UpsertCrmLeadQualificationSchema,
} from '@/src/schemas/crm-lead.schema'
import { dto } from '../../common'
import type { ErrorSpec, RouteConfig } from '../../registry'
import {
  CrmDocumentSummaryDTO,
  CrmLeadContactAttemptDTO,
  CrmLeadMeetingDTO,
  CrmLeadProposalPresentationDTO,
  CrmLeadQualificationDTO,
  CrmLeadReopeningDTO,
  CrmLeadRoutingRuleDTO,
  CrmLeadScoringRuleDTO,
  CrmLeadWithContactAttemptDTO,
  CrmLeadWithMeetingDTO,
  CrmLeadWithPresentationDTO,
  CrmLeadWithQualificationDTO,
} from '../../schemas/crm/leads'
import { CrmPersonDTO } from '../../schemas/crm/people'
import { CrmLeadDTO } from '../../schemas/public'
import { CRM_ERRORS, crmAccess, describe, notFoundError } from './shared'

/**
 * CRM · Leads — painel de leads (funil fixo de 6 etapas), ações de cada
 * etapa e regras de score/roteamento.
 */

const TAG = 'CRM · Leads' as const

const LEAD_ID = { leadId: 'ID do lead.' }
const RULE_ID = { ruleId: 'ID da regra.' }

const LEAD_NOT_FOUND = notFoundError('CrmLead', 'Lead inexistente no workspace')

const ALREADY_CLOSED: ErrorSpec = {
  code: 'CRM_LEAD_ALREADY_CLOSED',
  when: 'Lead já está na etapa `CLOSED`',
}

function transition(message: string, when: string): ErrorSpec {
  return { code: 'CRM_LEAD_STAGE_TRANSITION_INVALID', message, when }
}

function requirements(message: string, when: string): ErrorSpec {
  return { code: 'CRM_LEAD_STAGE_REQUIREMENTS_NOT_MET', message, when }
}

const FUNNEL = [
  'Funil fixo: `RECEIVED` → `IN_CONTACT` → `QUALIFIED` → `OPPORTUNITY` → `PROPOSAL` → `CLOSED`. A etapa nunca é definida diretamente: cada uma avança pela ação da etapa (tentativa de contato, qualificação, proposta, fechamento).',
].join('')

const RULE_SEMANTICS =
  'Condição: `field` (`email`/`phone` comparam o primeiro valor) × `operator` (`equals`, `not_equals`, `contains` — sensível a maiúsculas —, `is_empty`, `is_not_empty`) × `value` (ignorado nos operadores de vazio).'

export const crmLeadsRoutes: RouteConfig[] = [
  /* --------------------------------- leads -------------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/leads',
    tags: [TAG],
    summary: 'Listar leads',
    description: describe(
      'Leads do workspace na ordem do painel (`position`). Filtre por etapa com `stage`.',
      FUNNEL,
      crmAccess('leads', 'VIEW'),
    ),
    query: ListCrmLeadsSchema,
    responses: {
      200: { description: 'Leads.', schema: z.array(CrmLeadDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/leads',
    tags: [TAG],
    summary: 'Criar lead',
    description: describe(
      'Todo lead nasce em `RECEIVED`. Exige ao menos um e-mail ou telefone. Antes de criar, procura um lead **em aberto** do workspace com o mesmo e-mail (sem caixa/espaços) ou telefone (só dígitos) — se houver, responde `409 CRM_LEAD_DUPLICATE`. Na criação calcula o `score` pelas regras de pontuação ativas e define o `ownerId` pela primeira regra de roteamento ativa que casar; dispara os workflows de "lead criado".',
      crmAccess('leads', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: CreateCrmLeadSchema,
      example: {
        name: 'Carlos Lima',
        emails: ['carlos@empresa.com.br'],
        phones: ['+5511999990000'],
        company: 'Empresa Exemplo Ltda',
        source: 'Indicação',
      },
    },
    responses: { 201: { description: 'Lead criado.', schema: CrmLeadDTO } },
    errors: [...CRM_ERRORS, 'CRM_LEAD_DUPLICATE'],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/leads/reorder',
    tags: [TAG],
    summary: 'Reordenar leads',
    description: describe(
      '`orderedIds` define a nova `position` de cada lead (índice no array). IDs de outro workspace fazem a operação inteira falhar.',
      crmAccess('leads', 'EDIT'),
    ),
    consent: true,
    body: ReorderCrmLeadsSchema,
    responses: { 200: { description: 'Ordem salva.', schema: null } },
    errors: [...CRM_ERRORS, 'DATABASE_ERROR'],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/leads/{leadId}',
    tags: [TAG],
    summary: 'Detalhe do lead',
    description: crmAccess('leads', 'VIEW'),
    params: LEAD_ID,
    responses: { 200: { description: 'Lead.', schema: CrmLeadDTO } },
    errors: [...CRM_ERRORS, LEAD_NOT_FOUND],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/leads/{leadId}',
    tags: [TAG],
    summary: 'Atualizar lead',
    description: describe(
      'Atualização parcial dos dados cadastrais e do responsável (`ownerId: null` remove o dono). A etapa não muda por aqui. Alterar nome, contatos, empresa, cargo, origem ou cidade recalcula o `score`.',
      crmAccess('leads', 'EDIT'),
    ),
    consent: true,
    params: LEAD_ID,
    body: UpdateCrmLeadSchema,
    responses: {
      200: { description: 'Lead atualizado.', schema: CrmLeadDTO },
    },
    errors: [...CRM_ERRORS, LEAD_NOT_FOUND],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/leads/{leadId}',
    tags: [TAG],
    summary: 'Excluir lead',
    description: describe(
      'Exclusão lógica (soft delete); dispara os workflows de "lead excluído".',
      crmAccess('leads', 'DELETE'),
    ),
    consent: true,
    params: LEAD_ID,
    responses: { 200: { description: 'Lead excluído.', schema: null } },
    errors: [...CRM_ERRORS, LEAD_NOT_FOUND],
  },

  {
    method: 'post',
    path: '/workspaces/{id}/crm/leads/{leadId}/whatsapp',
    tags: [TAG],
    summary: 'Abrir a conversa de WhatsApp do lead',
    description: describe(
      'Devolve a conversa aberta do telefone do lead no módulo Comunicação ou, se não houver, abre uma nova. O telefone vira contato do WhatsApp ("Lead do CRM") quando ainda não é. Sem `phone`, usa o primeiro telefone do lead; sem `connectionId`, escolhe uma linha conectada (Z-API antes de Meta). Exige também o módulo Comunicação e a permissão de criar conversas.',
      crmAccess('leads', 'VIEW'),
    ),
    params: LEAD_ID,
    body: OpenCrmLeadWhatsappSchema,
    responses: {
      200: {
        description: 'Conversa a abrir.',
        schema: dto(
          'CrmLeadWhatsappConversation',
          z.object({ conversationId: z.string(), contactId: z.string() }),
        ),
      },
    },
    errors: [
      ...CRM_ERRORS,
      LEAD_NOT_FOUND,
      'MODULE_DISABLED',
      'VALIDATION_ERROR',
      {
        code: 'WHATSAPP_CONNECTION_NOT_FOUND',
        when: 'O workspace não tem conexão de WhatsApp',
      },
    ],
  },

  /* ------------------------- 01/02 · contato ------------------------------ */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/leads/{leadId}/contact-attempts',
    tags: [TAG],
    summary: 'Listar tentativas de contato',
    description: describe(
      'Mais recentes primeiro (`occurredAt`).',
      crmAccess('leads', 'VIEW'),
    ),
    params: LEAD_ID,
    responses: {
      200: {
        description: 'Tentativas de contato.',
        schema: z.array(CrmLeadContactAttemptDTO),
      },
    },
    errors: [...CRM_ERRORS, LEAD_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/leads/{leadId}/contact-attempts',
    tags: [TAG],
    summary: 'Registrar tentativa de contato',
    description: describe(
      'Avança o funil: em `RECEIVED` qualquer registro leva a `IN_CONTACT`; em `IN_CONTACT`, um registro com `outcome: REACHED` leva a `QUALIFIED`. Nas demais etapas abertas só registra. Devolve o lead (já com a etapa nova) e a tentativa.',
      crmAccess('leads', 'EDIT'),
    ),
    consent: true,
    params: LEAD_ID,
    body: RegisterCrmLeadContactAttemptSchema,
    responses: {
      201: {
        description: 'Tentativa registrada.',
        schema: CrmLeadWithContactAttemptDTO,
      },
    },
    errors: [...CRM_ERRORS, LEAD_NOT_FOUND, ALREADY_CLOSED],
  },
  {
    method: 'put',
    path: '/workspaces/{id}/crm/leads/{leadId}/interest-products',
    tags: [TAG],
    summary: 'Definir produtos de interesse',
    description: describe(
      'Substitui a lista de produtos/serviços do catálogo em que o lead tem interesse (ao menos um). Não muda a etapa.',
      crmAccess('leads', 'EDIT'),
    ),
    consent: true,
    params: LEAD_ID,
    body: SetCrmLeadInterestProductsSchema,
    responses: { 200: { description: 'Lead.', schema: CrmLeadDTO } },
    errors: [
      ...CRM_ERRORS,
      LEAD_NOT_FOUND,
      {
        code: 'DATABASE_ERROR',
        when: 'Algum `productId` não existe',
      },
    ],
  },

  /* ------------------------- 03 · qualificação ---------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/leads/{leadId}/qualification',
    tags: [TAG],
    summary: 'Obter qualificação do lead',
    description: describe(
      '`data: null` quando o lead ainda não foi qualificado.',
      crmAccess('leads', 'VIEW'),
    ),
    params: LEAD_ID,
    responses: {
      200: {
        description: 'Qualificação (ou `null`).',
        schema: CrmLeadQualificationDTO.nullable(),
      },
    },
    errors: [...CRM_ERRORS, LEAD_NOT_FOUND],
  },
  {
    method: 'put',
    path: '/workspaces/{id}/crm/leads/{leadId}/qualification',
    tags: [TAG],
    summary: 'Qualificar lead',
    description: describe(
      'Cria ou atualiza a qualificação (decisor e previsão de fechamento). A primeira qualificação só é aceita na etapa `QUALIFIED` e leva o lead a `OPPORTUNITY`; depois disso pode ser editada em qualquer etapa aberta.',
      crmAccess('leads', 'EDIT'),
    ),
    consent: true,
    params: LEAD_ID,
    body: UpsertCrmLeadQualificationSchema,
    responses: {
      200: {
        description: 'Lead e qualificação.',
        schema: CrmLeadWithQualificationDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      LEAD_NOT_FOUND,
      ALREADY_CLOSED,
      transition(
        'Qualifique o lead somente a partir da etapa "Lead Qualificado"',
        'Primeira qualificação fora da etapa `QUALIFIED`',
      ),
    ],
  },

  /* ------------------------- 04 · oportunidade ---------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/leads/{leadId}/meetings',
    tags: [TAG],
    summary: 'Listar reuniões do lead',
    description: describe(
      'Mais recentes primeiro (`scheduledAt`).',
      crmAccess('leads', 'VIEW'),
    ),
    params: LEAD_ID,
    responses: {
      200: { description: 'Reuniões.', schema: z.array(CrmLeadMeetingDTO) },
    },
    errors: [...CRM_ERRORS, LEAD_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/leads/{leadId}/meetings',
    tags: [TAG],
    summary: 'Registrar reunião',
    description: describe(
      'Só na etapa `OPPORTUNITY`. Ao menos uma reunião é pré-requisito para criar a proposta. Não muda a etapa.',
      crmAccess('leads', 'EDIT'),
    ),
    consent: true,
    params: LEAD_ID,
    body: RegisterCrmLeadMeetingSchema,
    responses: {
      201: {
        description: 'Reunião registrada.',
        schema: CrmLeadWithMeetingDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      LEAD_NOT_FOUND,
      transition(
        'Registre reuniões somente na etapa "Interesse/Oportunidade"',
        'Lead fora da etapa `OPPORTUNITY`',
      ),
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/leads/{leadId}/proposal',
    tags: [TAG],
    summary: 'Obter proposta ativa do lead',
    description: describe(
      'A proposta mais recente vinculada ao lead — um documento do tipo `PROPOSAL` (ADR 0063); `data: null` se não houver. Uma proposta antiga ainda não migrada é convertida na hora.',
      crmAccess('documents', 'VIEW'),
    ),
    params: LEAD_ID,
    responses: {
      200: {
        description: 'Documento da proposta (ou `null`).',
        schema: CrmDocumentSummaryDTO.nullable(),
      },
    },
    errors: [...CRM_ERRORS, LEAD_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/leads/{leadId}/proposal',
    tags: [TAG],
    summary: 'Criar proposta do lead',
    description: describe(
      'Transição `OPPORTUNITY` → `PROPOSAL`: exige o lead em `OPPORTUNITY` com ao menos uma reunião registrada. Cria a proposta como documento do tipo `PROPOSAL` em rascunho (`templateId` opcional: um modelo de documento) com o usuário como responsável; sem `validUntil`, a validade é hoje + a validade padrão das configurações do CRM.',
      crmAccess('documents', 'CREATE'),
    ),
    consent: true,
    params: LEAD_ID,
    body: CreateCrmLeadProposalSchema,
    responses: {
      201: {
        description: 'Lead (em `PROPOSAL`) e o documento da proposta.',
        schema: z.object({ lead: CrmLeadDTO, proposal: CrmDocumentSummaryDTO }),
      },
    },
    errors: [
      ...CRM_ERRORS,
      LEAD_NOT_FOUND,
      {
        code: 'DOCUMENT_TEMPLATE_NOT_FOUND',
        when: '`templateId` não é um modelo de documento do workspace',
      },
      transition(
        'Crie a proposta somente a partir da etapa "Interesse/Oportunidade"',
        'Lead fora da etapa `OPPORTUNITY`',
      ),
      requirements(
        'Registre ao menos uma reunião antes de criar a proposta',
        'Nenhuma reunião registrada',
      ),
    ],
  },

  /* ---------------------------- 05 · proposta ----------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/leads/{leadId}/proposal/{proposalId}/presentations',
    tags: [TAG],
    summary: 'Listar apresentações de proposta',
    description: describe(
      'Apresentações do documento da proposta `proposalId` (mais recentes primeiro). O documento precisa ser uma proposta do lead.',
      crmAccess('leads', 'VIEW'),
    ),
    params: { ...LEAD_ID, proposalId: 'ID do documento da proposta.' },
    responses: {
      200: {
        description: 'Apresentações.',
        schema: z.array(CrmLeadProposalPresentationDTO),
      },
    },
    errors: [
      ...CRM_ERRORS,
      LEAD_NOT_FOUND,
      {
        code: 'CRM_LEAD_PROPOSAL_NOT_FOUND',
        when: 'Documento inexistente, de outro lead ou que não é proposta',
      },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/leads/{leadId}/proposal/{proposalId}/presentations',
    tags: [TAG],
    summary: 'Registrar apresentação da proposta',
    description: describe(
      'Só na etapa `PROPOSAL`, para uma proposta vinculada ao lead. Registra valor apresentado e termômetro de interesse — pré-requisito para fechar como ganho.',
      crmAccess('leads', 'EDIT'),
    ),
    consent: true,
    params: { ...LEAD_ID, proposalId: 'ID do documento da proposta.' },
    body: RegisterCrmLeadProposalPresentationSchema,
    responses: {
      201: {
        description: 'Apresentação registrada.',
        schema: CrmLeadWithPresentationDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      LEAD_NOT_FOUND,
      {
        code: 'CRM_LEAD_PROPOSAL_NOT_FOUND',
        when: 'Documento inexistente, de outro lead ou que não é proposta',
      },
      transition(
        'Registre apresentações somente na etapa "Proposta"',
        'Lead fora da etapa `PROPOSAL`',
      ),
    ],
  },

  /* ---------------------------- 06 · fechamento --------------------------- */
  {
    method: 'post',
    path: '/workspaces/{id}/crm/leads/{leadId}/close-won',
    tags: [TAG],
    summary: 'Fechar lead como ganho',
    description: describe(
      'Só a partir de `PROPOSAL` e com ao menos uma apresentação registrada. Move para `CLOSED` com `closeResult: WON`, grava os dados do contrato e converte o lead em pessoa — reaproveita a já vinculada, ou uma pessoa com o mesmo e-mail/telefone, antes de criar uma nova. Devolve a **pessoa**.',
      crmAccess('leads', 'EDIT'),
    ),
    consent: true,
    params: LEAD_ID,
    body: CloseCrmLeadWonSchema,
    responses: {
      201: { description: 'Pessoa do lead convertido.', schema: CrmPersonDTO },
    },
    errors: [
      ...CRM_ERRORS,
      LEAD_NOT_FOUND,
      ALREADY_CLOSED,
      transition(
        'Só é possível fechar como ganho a partir da etapa "Proposta"',
        'Lead fora da etapa `PROPOSAL`',
      ),
      requirements(
        'Registre a apresentação da proposta antes de fechar como ganho',
        'Nenhuma apresentação registrada',
      ),
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/leads/{leadId}/close-lost',
    tags: [TAG],
    summary: 'Fechar lead como perdido',
    description: describe(
      'Aceito em qualquer etapa aberta (em `PROPOSAL`, só depois de registrar a apresentação). Move para `CLOSED` com `closeResult: LOST`, motivo e, opcionalmente, a data para tentar de novo (`retryAt`).',
      crmAccess('leads', 'EDIT'),
    ),
    consent: true,
    params: LEAD_ID,
    body: CloseCrmLeadLostSchema,
    responses: {
      201: { description: 'Lead fechado como perdido.', schema: CrmLeadDTO },
    },
    errors: [
      ...CRM_ERRORS,
      LEAD_NOT_FOUND,
      ALREADY_CLOSED,
      requirements(
        'Registre a apresentação da proposta antes de registrar o resultado',
        'Em `PROPOSAL` sem apresentação registrada',
      ),
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/leads/{leadId}/reopen',
    tags: [TAG],
    summary: 'Reabrir lead perdido',
    description: describe(
      'Só leads com `closeResult: LOST` (ganhos não reabrem). Volta para a etapa configurada em CRM > Configurações (`leadReopenStage`), limitada à etapa mais avançada que os registros do lead sustentam; limpa motivo/data da perda e guarda o snapshot no histórico de reaberturas.',
      crmAccess('leads', 'EDIT'),
    ),
    consent: true,
    params: LEAD_ID,
    body: ReopenCrmLeadSchema,
    responses: { 200: { description: 'Lead reaberto.', schema: CrmLeadDTO } },
    errors: [
      ...CRM_ERRORS,
      LEAD_NOT_FOUND,
      { code: 'CRM_LEAD_REOPEN_NOT_ALLOWED', when: 'Lead não está perdido' },
      {
        code: 'CRM_LEAD_REOPEN_NOT_ALLOWED',
        message:
          'Leads ganhos não podem ser reabertos — o negócio já foi fechado',
        when: 'Lead ganho',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/leads/{leadId}/reopenings',
    tags: [TAG],
    summary: 'Histórico de reaberturas',
    description: describe(
      'Mais recentes primeiro.',
      crmAccess('leads', 'VIEW'),
    ),
    params: LEAD_ID,
    responses: {
      200: {
        description: 'Reaberturas.',
        schema: z.array(CrmLeadReopeningDTO),
      },
    },
    errors: [...CRM_ERRORS, LEAD_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/leads/{leadId}/convert',
    tags: [TAG],
    summary: 'Obter pessoa do lead ganho (legado)',
    description: describe(
      'Rota legada: a conversão em pessoa acontece em `close-won`. Para um lead ganho devolve (de forma idempotente) a pessoa vinculada, recriando o vínculo se ela tiver sido excluída; para os demais responde `409 CRM_LEAD_STAGE_TRANSITION_INVALID`.',
      crmAccess('leads', 'EDIT'),
    ),
    consent: true,
    params: LEAD_ID,
    responses: {
      200: { description: 'Pessoa do lead.', schema: CrmPersonDTO },
    },
    errors: [
      ...CRM_ERRORS,
      LEAD_NOT_FOUND,
      transition(
        'A conversão em pessoa acontece ao fechar o lead como ganho na etapa "Proposta"',
        'Lead não foi ganho',
      ),
    ],
  },

  /* ------------------------- regras de score ------------------------------ */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/lead-scoring-rules',
    tags: [TAG],
    summary: 'Listar regras de pontuação',
    description: describe(
      'Na ordem de `position`. O `score` de um lead é a soma dos `points` de todas as regras ativas que casam.',
      crmAccess('leads', 'VIEW'),
    ),
    responses: {
      200: { description: 'Regras.', schema: z.array(CrmLeadScoringRuleDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/lead-scoring-rules',
    tags: [TAG],
    summary: 'Criar regra de pontuação',
    description: describe(
      RULE_SEMANTICS,
      'Vale para leads criados ou editados depois; o score dos existentes não é recalculado.',
      crmAccess('leads', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: CreateCrmLeadScoringRuleSchema,
      example: {
        field: 'jobTitle',
        operator: 'contains',
        value: 'Diretor',
        points: 20,
      },
    },
    responses: {
      201: { description: 'Regra criada.', schema: CrmLeadScoringRuleDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/lead-scoring-rules/{ruleId}',
    tags: [TAG],
    summary: 'Atualizar regra de pontuação',
    description: describe(RULE_SEMANTICS, crmAccess('leads', 'EDIT')),
    consent: true,
    params: RULE_ID,
    body: UpdateCrmLeadScoringRuleSchema,
    responses: {
      200: { description: 'Regra atualizada.', schema: CrmLeadScoringRuleDTO },
    },
    errors: [...CRM_ERRORS, notFoundError('CrmLeadScoringRule')],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/lead-scoring-rules/{ruleId}',
    tags: [TAG],
    summary: 'Excluir regra de pontuação',
    description: crmAccess('leads', 'DELETE'),
    consent: true,
    params: RULE_ID,
    responses: { 200: { description: 'Regra excluída.', schema: null } },
    errors: [...CRM_ERRORS, notFoundError('CrmLeadScoringRule')],
  },

  /* ----------------------- regras de roteamento --------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/lead-routing-rules',
    tags: [TAG],
    summary: 'Listar regras de roteamento',
    description: describe(
      'Na ordem de `position`. Na criação de um lead, a **primeira** regra ativa que casar define o `ownerId`; sem nenhuma, o lead fica sem dono.',
      crmAccess('leads', 'VIEW'),
    ),
    responses: {
      200: { description: 'Regras.', schema: z.array(CrmLeadRoutingRuleDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/lead-routing-rules',
    tags: [TAG],
    summary: 'Criar regra de roteamento',
    description: describe(
      RULE_SEMANTICS,
      '`ownerId` é o usuário que recebe os leads que casam.',
      crmAccess('leads', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: CreateCrmLeadRoutingRuleSchema,
      example: {
        field: 'city',
        operator: 'equals',
        value: 'São Paulo',
        ownerId: 'ckv9x2p0h0000us7d3k1e5abc',
      },
    },
    responses: {
      201: { description: 'Regra criada.', schema: CrmLeadRoutingRuleDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/lead-routing-rules/{ruleId}',
    tags: [TAG],
    summary: 'Atualizar regra de roteamento',
    description: describe(RULE_SEMANTICS, crmAccess('leads', 'EDIT')),
    consent: true,
    params: RULE_ID,
    body: UpdateCrmLeadRoutingRuleSchema,
    responses: {
      200: { description: 'Regra atualizada.', schema: CrmLeadRoutingRuleDTO },
    },
    errors: [...CRM_ERRORS, notFoundError('CrmLeadRoutingRule')],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/lead-routing-rules/{ruleId}',
    tags: [TAG],
    summary: 'Excluir regra de roteamento',
    description: crmAccess('leads', 'DELETE'),
    consent: true,
    params: RULE_ID,
    responses: { 200: { description: 'Regra excluída.', schema: null } },
    errors: [...CRM_ERRORS, notFoundError('CrmLeadRoutingRule')],
  },
]
