import { z } from 'zod'
import {
  CreateAiProcedureSchema,
  ListAiProcedureRunsQuerySchema,
  PreviewAiProcedureSchema,
  RestoreAiProcedureVersionSchema,
  UpdateAiProcedureSchema,
} from '@/src/schemas/ai-procedure.schema'
import { WORKSPACE_MEMBER_ERRORS } from '../common'
import type { ErrorEntry, OpenApiRegistry, RouteConfig } from '../registry'
import {
  AiProcedureCatalogDTO,
  AiProcedureDTO,
  AiProcedurePreviewDTO,
  AiProcedureRunDetailDTO,
  AiProcedureRunDTO,
  AiProcedureVersionDTO,
} from '../schemas/ai-procedures'

/** Procedimentos com passos obrigatórios (`/workspaces/{id}/ai-procedures/**`). */

const TAG = 'Steel Agents' as const
const PROCEDURE_PARAM = { description: 'ID do procedimento.' }
const MANAGE: ErrorEntry = {
  code: 'FORBIDDEN',
  when: 'Sem a permissão `steel-agents` (criar/editar/excluir é de admin)',
}
const NOT_FOUND: ErrorEntry = {
  code: 'AI_PROCEDURE_NOT_FOUND',
  when: 'Procedimento inexistente ou de outro workspace',
}
const INVALID: ErrorEntry[] = ['AI_PROCEDURE_INVALID']

const routes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/ai-procedures',
    tags: [TAG],
    summary: 'Listar procedimentos',
    description:
      'Roteiros com condições e passos obrigatórios usados pela resposta automática do WhatsApp e pelos Steel Agents. Inclui a contagem de execuções do mês.',
    responses: {
      200: { description: 'Procedimentos.', schema: z.array(AiProcedureDTO) },
    },
    errors: WORKSPACE_MEMBER_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/ai-procedures',
    tags: [TAG],
    summary: 'Criar procedimento',
    description:
      'Cada passo é `COLLECT` (pede e valida um dado do cliente), `HTTP` (consulta um endereço HTTPS público), `TOOL` (ferramenta de leitura do Steel AI, com as permissões do responsável), `MESSAGE` (texto fixo ou instrução) ou `HANDOFF`. O motor executa na ordem e não deixa pular passo obrigatório; falha de passo obrigatório transfere para um humano. Variáveis `{{nome}}` só valem depois de um passo que as defina.',
    consent: true,
    body: {
      schema: CreateAiProcedureSchema,
      example: {
        name: 'Segunda via de boleto',
        whenToUse: 'O cliente pede a segunda via de um boleto',
        status: 'ACTIVE',
        steps: [
          {
            key: 'cpf',
            kind: 'COLLECT',
            title: 'Validar CPF',
            variable: 'cpf',
            prompt: 'o CPF do titular',
            validation: 'CPF',
            required: true,
          },
          {
            key: 'consulta',
            kind: 'HTTP',
            title: 'Consultar boleto',
            method: 'GET',
            url: 'https://api.exemplo.com.br/boletos?cpf={{cpf}}',
            saves: [{ variable: 'link', path: 'link' }],
            required: true,
          },
          {
            key: 'envio',
            kind: 'MESSAGE',
            title: 'Enviar boleto',
            text: 'Aqui está sua segunda via: {{link}}',
            required: true,
          },
        ],
      },
    },
    responses: {
      201: { description: 'Procedimento criado.', schema: AiProcedureDTO },
    },
    errors: [
      ...WORKSPACE_MEMBER_ERRORS,
      MANAGE,
      ...INVALID,
      {
        code: 'AI_PROCEDURE_LIMIT_REACHED',
        when: 'O workspace atingiu o limite de procedimentos',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/ai-procedures/catalog',
    tags: [TAG],
    summary: 'Catálogo do editor de procedimentos',
    description:
      'Validações, operadores de condição, ferramentas de leitura disponíveis, agentes e limites.',
    responses: {
      200: { description: 'Catálogo.', schema: AiProcedureCatalogDTO },
    },
    errors: WORKSPACE_MEMBER_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/ai-procedures/runs',
    tags: [TAG],
    summary: 'Execuções de procedimentos do workspace',
    query: ListAiProcedureRunsQuerySchema,
    responses: {
      200: { description: 'Execuções.', schema: z.array(AiProcedureRunDTO) },
    },
    errors: WORKSPACE_MEMBER_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/ai-procedures/runs/{runId}',
    tags: [TAG],
    summary: 'Detalhar execução de procedimento',
    description:
      'A linha do tempo dos passos: o que o motor executou, dispensou (condição falsa) ou bloqueou (fora de ordem).',
    params: { runId: { description: 'ID da execução.' } },
    responses: {
      200: { description: 'Execução.', schema: AiProcedureRunDetailDTO },
    },
    errors: [
      ...WORKSPACE_MEMBER_ERRORS,
      {
        code: 'AI_PROCEDURE_RUN_NOT_FOUND',
        when: 'Execução inexistente ou de outro workspace',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/ai-procedures/{procedureId}',
    tags: [TAG],
    summary: 'Detalhar procedimento',
    params: { procedureId: PROCEDURE_PARAM },
    responses: { 200: { description: 'Procedimento.', schema: AiProcedureDTO } },
    errors: [...WORKSPACE_MEMBER_ERRORS, NOT_FOUND],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/ai-procedures/{procedureId}',
    tags: [TAG],
    summary: 'Atualizar procedimento',
    description:
      'Atualização parcial. Mudar passos, quando usar, tentativas ou a mensagem de transferência cria uma nova **versão** (`changeNote` entra no histórico); as conversas em andamento terminam na versão em que começaram.',
    consent: true,
    params: { procedureId: PROCEDURE_PARAM },
    body: UpdateAiProcedureSchema,
    responses: {
      200: { description: 'Procedimento atualizado.', schema: AiProcedureDTO },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, MANAGE, NOT_FOUND, ...INVALID],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/ai-procedures/{procedureId}',
    tags: [TAG],
    summary: 'Excluir procedimento',
    description: 'Exclui o procedimento, as versões e as execuções.',
    consent: true,
    params: { procedureId: PROCEDURE_PARAM },
    responses: {
      200: { description: 'Procedimento excluído.', schema: AiProcedureDTO },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, MANAGE, NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/ai-procedures/{procedureId}/preview',
    tags: [TAG],
    summary: 'Pré-visualizar procedimento',
    description:
      'Sem IA e sem efeitos: devolve problemas de estrutura e quais passos rodariam, dadas as variáveis informadas.',
    params: { procedureId: PROCEDURE_PARAM },
    body: PreviewAiProcedureSchema,
    responses: {
      200: { description: 'Plano.', schema: AiProcedurePreviewDTO },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, NOT_FOUND],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/ai-procedures/{procedureId}/versions',
    tags: [TAG],
    summary: 'Histórico de versões',
    params: { procedureId: PROCEDURE_PARAM },
    responses: {
      200: {
        description: 'Versões, da mais nova para a mais antiga.',
        schema: z.array(AiProcedureVersionDTO),
      },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/ai-procedures/{procedureId}/versions/{versionId}/restore',
    tags: [TAG],
    summary: 'Restaurar versão',
    description:
      'Traz uma versão antiga de volta como uma nova versão; o histórico nunca é reescrito.',
    consent: true,
    params: {
      procedureId: PROCEDURE_PARAM,
      versionId: { description: 'ID da versão.' },
    },
    body: RestoreAiProcedureVersionSchema,
    responses: {
      200: { description: 'Procedimento restaurado.', schema: AiProcedureDTO },
    },
    errors: [
      ...WORKSPACE_MEMBER_ERRORS,
      MANAGE,
      NOT_FOUND,
      {
        code: 'AI_PROCEDURE_VERSION_NOT_FOUND',
        when: 'Versão inexistente ou de outro procedimento',
      },
      ...INVALID,
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/ai-procedures/{procedureId}/runs',
    tags: [TAG],
    summary: 'Execuções do procedimento',
    params: { procedureId: PROCEDURE_PARAM },
    query: ListAiProcedureRunsQuerySchema,
    responses: {
      200: { description: 'Execuções.', schema: z.array(AiProcedureRunDTO) },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, NOT_FOUND],
  },
]

export function registerAiProceduresPaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
