import { z } from 'zod'
import {
  AiEvalCaseFromMessageSchema,
  AiEvalLatestQuerySchema,
  CreateAiEvalCaseSchema,
  CreateAiEvalSetSchema,
  StartAiEvalRunSchema,
  UpdateAiEvalCaseSchema,
  UpdateAiEvalSetSchema,
} from '@/src/schemas/ai-eval.schema'
import {
  AiQualityExportQuerySchema,
  AiQualityQuerySchema,
  ListMyAiFeedbackQuerySchema,
  UpsertAiFeedbackSchema,
} from '@/src/schemas/ai-feedback.schema'
import { WORKSPACE_MEMBER_ERRORS, WORKSPACE_PRIVILEGED_ERRORS } from '../common'
import type { ErrorEntry, OpenApiRegistry, RouteConfig } from '../registry'
import {
  AiEvalCaseDTO,
  AiEvalRunDetailDTO,
  AiEvalRunDTO,
  AiEvalSetDetailDTO,
  AiEvalSetDTO,
  AiFeedbackDTO,
  AiQualityDTO,
} from '../schemas/steel-ai-quality'

/**
 * Steel AI — avaliação e feedback (ADR 0039): 👍/👎 nas respostas de IA,
 * painel Qualidade em Análises e conjuntos de teste.
 */

const TAG = 'Steel AI' as const
const SET_PARAM = { description: 'ID do conjunto de teste.' }
const CASE_PARAM = { description: 'ID do caso de teste.' }
const RUN_PARAM = { description: 'ID da execução.' }
const DELETED = z.object({ id: z.string() })

const CLOCK =
  'Dias em **UTC**, como nas análises de uso; dinheiro em US$ pelo custo real do razão `ai_usage`.'

const SCOPE_ERRORS: ErrorEntry[] = [
  {
    code: 'FORBIDDEN',
    when: 'Não é membro, ou pediu `scope=workspace` sem ser OWNER/ADMIN',
  },
  'WORKSPACE_SUSPENDED',
]
const SET_NOT_FOUND: ErrorEntry = {
  code: 'AI_EVAL_SET_NOT_FOUND',
  when: 'Inexistente ou de outro workspace',
}

const routes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/ai/feedback',
    tags: [TAG],
    summary: 'Minhas avaliações de respostas',
    description:
      'As avaliações (👍/👎) do próprio usuário para um lote de respostas de uma superfície — para pintar os botões. Cada pessoa só vê as suas.',
    query: ListMyAiFeedbackQuerySchema,
    responses: {
      200: { description: 'Avaliações.', schema: z.array(AiFeedbackDTO) },
    },
    errors: WORKSPACE_MEMBER_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/ai/feedback',
    tags: [TAG],
    summary: 'Avaliar uma resposta de IA',
    description:
      'Cria ou substitui a avaliação do usuário (uma por resposta). O servidor confere que a resposta existe e que o usuário a vê com as mesmas regras da tela (conversa do Steel AI só do dono; chamado só de agente; WhatsApp pela visibilidade da equipe) e grava o modelo que respondeu. O motivo só vale no 👎. Auditado sem o texto do comentário.',
    consent: true,
    body: {
      schema: UpsertAiFeedbackSchema,
      example: {
        surface: 'SD_COPILOT',
        targetId: 'clx0ticket',
        variant: 'summary',
        rating: 'DOWN',
        reason: 'incomplete',
        comment: 'Não citou o prazo de SLA.',
      },
    },
    responses: { 200: { description: 'Avaliação.', schema: AiFeedbackDTO } },
    errors: [
      ...WORKSPACE_MEMBER_ERRORS,
      {
        code: 'AI_FEEDBACK_TARGET_NOT_FOUND',
        when: 'Resposta inexistente, de outro workspace ou fora do acesso do usuário',
      },
      'SD_NOT_AGENT',
      'MODULE_DISABLED',
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/ai/feedback/{feedbackId}',
    tags: [TAG],
    summary: 'Desfazer uma avaliação',
    description: 'Só o autor remove a própria avaliação.',
    params: { feedbackId: { description: 'ID da avaliação.' } },
    consent: true,
    responses: { 200: { description: 'Removida.', schema: DELETED } },
    errors: [
      ...WORKSPACE_MEMBER_ERRORS,
      {
        code: 'AI_FEEDBACK_NOT_FOUND',
        when: 'Inexistente ou de outra pessoa',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/ai/quality',
    tags: [TAG],
    summary: 'Qualidade da IA',
    description: `Aprovação das respostas por superfície, modelo e dia e os 👎 mais recentes. \`scope=workspace\` (OWNER/ADMIN) soma todo o espaço, mostra quem avaliou e acrescenta a resolução sem humano (WhatsApp: conversas fechadas em que só a IA respondeu; ServiceDesk: pré-atendimentos resolvidos pela base) e o custo por resolução. ${CLOCK}`,
    query: AiQualityQuerySchema,
    responses: { 200: { description: 'Qualidade.', schema: AiQualityDTO } },
    errors: SCOPE_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/ai/quality/export',
    tags: [TAG],
    summary: 'Exportar qualidade da IA (CSV)',
    description: `CSV em UTF-8 com BOM, transmitido em partes. \`view=feedback\`: uma linha por avaliação (\`data_utc, usuario, email, superficie, codigo_superficie, variacao, id_resposta, avaliacao, motivo, comentario, modelo\`; usuário e e-mail só no escopo \`workspace\`). \`surface\` / \`model\`: \`chave, nome, positivas, negativas, total, aprovacao_percentual\`. Células que começam com \`=\`, \`+\`, \`-\` ou \`@\` ganham \`'\` na frente. Auditado. ${CLOCK}`,
    query: AiQualityExportQuerySchema,
    responses: {
      200: {
        description: 'Arquivo CSV.',
        envelope: false,
        contentType: 'text/csv',
        schema: { type: 'string' },
        headers: {
          'Content-Disposition': {
            description:
              '`attachment; filename="steel-ai-qualidade-<pessoal|workspace>-<view>-<de>_<até>.csv"`',
          },
        },
      },
    },
    errors: SCOPE_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/ai/evals',
    tags: [TAG],
    summary: 'Listar conjuntos de teste',
    description:
      'Conjuntos de teste do workspace com a última execução. Só OWNER/ADMIN (a execução gasta a cota de IA).',
    responses: {
      200: { description: 'Conjuntos.', schema: z.array(AiEvalSetDTO) },
    },
    errors: WORKSPACE_PRIVILEGED_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/ai/evals',
    tags: [TAG],
    summary: 'Criar conjunto de teste',
    description:
      'Alvo `STEEL_ASSISTANT` (prompt do Steel AI, skill opcional) ou `WHATSAPP_REPLY` (prompt e documentos da resposta automática). Até 20 conjuntos por workspace.',
    consent: true,
    body: {
      schema: CreateAiEvalSetSchema,
      example: { name: 'Perguntas do suporte', target: 'STEEL_ASSISTANT' },
    },
    responses: { 201: { description: 'Conjunto.', schema: AiEvalSetDTO } },
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      'AI_EVAL_LIMIT_REACHED',
      'AI_SKILL_NOT_FOUND',
      { code: 'VALIDATION_ERROR', when: 'Skill num conjunto do WhatsApp' },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/ai/evals/latest',
    tags: [TAG],
    summary: 'Última avaliação por alvo',
    description:
      'Cada conjunto do alvo com a última execução concluída — o "rodar avaliação antes de trocar" das telas de modelo, prompt e skill.',
    query: AiEvalLatestQuerySchema,
    responses: {
      200: { description: 'Conjuntos.', schema: z.array(AiEvalSetDTO) },
    },
    errors: WORKSPACE_PRIVILEGED_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/ai/evals/cases/from-message',
    tags: [TAG],
    summary: 'Salvar resposta do chat como caso de teste',
    description:
      'A pergunta é a mensagem do usuário anterior à resposta; a resposta vira a esperada. Só para conversas do próprio usuário.',
    consent: true,
    body: {
      schema: AiEvalCaseFromMessageSchema,
      example: { setId: 'clx0set', messageId: 'clx0msg' },
    },
    responses: { 201: { description: 'Caso.', schema: AiEvalCaseDTO } },
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      SET_NOT_FOUND,
      'AI_EVAL_LIMIT_REACHED',
      'AI_FEEDBACK_TARGET_NOT_FOUND',
      {
        code: 'VALIDATION_ERROR',
        when: 'A resposta não tem pergunta em texto',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/ai/evals/{setId}',
    tags: [TAG],
    summary: 'Conjunto de teste',
    params: { setId: SET_PARAM },
    responses: {
      200: { description: 'Conjunto com casos.', schema: AiEvalSetDetailDTO },
    },
    errors: [...WORKSPACE_PRIVILEGED_ERRORS, SET_NOT_FOUND],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/ai/evals/{setId}',
    tags: [TAG],
    summary: 'Editar conjunto de teste',
    description: 'Nome, descrição e skill. O alvo não muda.',
    params: { setId: SET_PARAM },
    consent: true,
    body: { schema: UpdateAiEvalSetSchema, example: { name: 'FAQ' } },
    responses: { 200: { description: 'Conjunto.', schema: AiEvalSetDTO } },
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      SET_NOT_FOUND,
      'AI_SKILL_NOT_FOUND',
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/ai/evals/{setId}',
    tags: [TAG],
    summary: 'Excluir conjunto de teste',
    description: 'Apaga o conjunto com os casos e as execuções.',
    params: { setId: SET_PARAM },
    consent: true,
    responses: { 200: { description: 'Excluído.', schema: DELETED } },
    errors: [...WORKSPACE_PRIVILEGED_ERRORS, SET_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/ai/evals/{setId}/cases',
    tags: [TAG],
    summary: 'Adicionar caso de teste',
    description:
      'Pergunta com ao menos uma forma de correção: resposta esperada, critério, "deve conter" ou "não pode conter" (sem diferenciar maiúsculas e acentos). Até 50 casos por conjunto.',
    params: { setId: SET_PARAM },
    consent: true,
    body: {
      schema: CreateAiEvalCaseSchema,
      example: {
        input: 'Qual o prazo de atendimento de um incidente crítico?',
        expected: 'Quatro horas úteis.',
        mustContain: ['quatro horas'],
      },
    },
    responses: { 201: { description: 'Caso.', schema: AiEvalCaseDTO } },
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      SET_NOT_FOUND,
      'AI_EVAL_LIMIT_REACHED',
    ],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/ai/evals/{setId}/cases/{caseId}',
    tags: [TAG],
    summary: 'Editar caso de teste',
    params: { setId: SET_PARAM, caseId: CASE_PARAM },
    consent: true,
    body: {
      schema: UpdateAiEvalCaseSchema,
      example: { criteria: 'Citar o SLA' },
    },
    responses: { 200: { description: 'Caso.', schema: AiEvalCaseDTO } },
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      SET_NOT_FOUND,
      'AI_EVAL_CASE_NOT_FOUND',
      {
        code: 'VALIDATION_ERROR',
        when: 'O caso ficaria sem forma de correção',
      },
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/ai/evals/{setId}/cases/{caseId}',
    tags: [TAG],
    summary: 'Excluir caso de teste',
    description: 'Execuções antigas guardam a pergunta e o resultado.',
    params: { setId: SET_PARAM, caseId: CASE_PARAM },
    consent: true,
    responses: { 200: { description: 'Excluído.', schema: DELETED } },
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      SET_NOT_FOUND,
      'AI_EVAL_CASE_NOT_FOUND',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/ai/evals/{setId}/runs',
    tags: [TAG],
    summary: 'Execuções do conjunto',
    description: 'As 20 execuções mais recentes.',
    params: { setId: SET_PARAM },
    responses: {
      200: { description: 'Execuções.', schema: z.array(AiEvalRunDTO) },
    },
    errors: [...WORKSPACE_PRIVILEGED_ERRORS, SET_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/ai/evals/{setId}/runs',
    tags: [TAG],
    summary: 'Rodar avaliação',
    description:
      'Enfileira a execução (fila `ai-eval` do worker). Cada caso é respondido sem ferramentas pelo modelo pedido (ou o padrão), passa pelas verificações de texto e, com resposta esperada ou critério, recebe do juiz uma nota de 0 a 1; passa com nota ≥ 0,7 e todas as verificações. Aceita um rascunho — `modelKey`, `skillId` e `promptOverride` (WhatsApp) — para testar antes de salvar. O consumo entra na cota como `AI_EVAL`.',
    params: { setId: SET_PARAM },
    consent: true,
    body: {
      schema: StartAiEvalRunSchema,
      example: {
        modelKey: 'anthropic:claude-sonnet-5',
        reason: 'model_change',
      },
    },
    responses: {
      202: { description: 'Execução na fila.', schema: AiEvalRunDTO },
    },
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      SET_NOT_FOUND,
      'AI_EVAL_SET_EMPTY',
      'AI_EVAL_RUN_IN_PROGRESS',
      'AI_DISABLED',
      'AI_MODEL_NOT_ENABLED',
      'AI_SKILL_NOT_FOUND',
      {
        code: 'VALIDATION_ERROR',
        when: '`promptOverride` num conjunto que não é do WhatsApp',
      },
      { code: 'INTERNAL_SERVER_ERROR', when: 'Fila indisponível' },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/ai/evals/{setId}/runs/{runId}',
    tags: [TAG],
    summary: 'Resultado da avaliação',
    description:
      'A execução com a correção de cada caso (resposta, verificações, nota e justificativa do juiz).',
    params: { setId: SET_PARAM, runId: RUN_PARAM },
    responses: {
      200: { description: 'Execução.', schema: AiEvalRunDetailDTO },
    },
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      {
        code: 'AI_EVAL_RUN_NOT_FOUND',
        when: 'Inexistente ou de outro conjunto',
      },
    ],
  },
]

export function registerSteelAiQualityPaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
