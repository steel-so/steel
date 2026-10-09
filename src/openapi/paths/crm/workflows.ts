import { z } from 'zod'
import {
  CreateCrmWorkflowSchema,
  ResumeCrmWorkflowRunSchema,
  TriggerCrmWorkflowManualRunSchema,
  UpdateCrmWorkflowDraftSchema,
  UpdateCrmWorkflowSchema,
} from '@/src/schemas/crm-workflow.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  CrmWorkflowDTO,
  CrmWorkflowVersionDTO,
} from '../../schemas/crm/workflows'
import { CrmWorkflowRunDTO } from '../../schemas/public'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/** CRM · Workflows — `workflows/**`. */

const TAG = ['CRM · Workflows'] as ['CRM · Workflows']

const WORKFLOW_ID = {
  description: 'Id do workflow.',
  example: 'ckw1wflw0000ab7d3k1e5xyz',
}
const RUN_ID = {
  description: 'Id da execução (run).',
  example: 'ckw1wrun0000ab7d3k1e5xyz',
}

const WORKFLOW_NOT_FOUND: ErrorEntry = {
  code: 'CRM_WORKFLOW_NOT_FOUND',
  when: 'Workflow inexistente, excluído ou de outro workspace',
}
const NO_DRAFT: ErrorEntry = {
  code: 'CRM_WORKFLOW_VERSION_NOT_DRAFT',
  when: 'O workflow não tem versão DRAFT',
}

/** Erros de rota que opera sobre um workflow existente. */
const ON_WORKFLOW: ErrorEntry[] = [...CRM_ERRORS, WORKFLOW_NOT_FOUND]

export const crmWorkflowsRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/crm/workflows',
    tags: TAG,
    summary: 'Listar workflows',
    description: describe(
      'Workflows do workspace (excluídos ficam de fora).',
      crmAccess('workflows', 'VIEW'),
    ),
    responses: {
      200: { description: 'Workflows.', schema: z.array(CrmWorkflowDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/workflows',
    tags: TAG,
    summary: 'Criar workflow',
    description: describe(
      'Cria o workflow em `DRAFT` com uma versão DRAFT vazia (trigger sem configuração, sem nodes). Monte o fluxo com `PATCH .../draft` e ative com `POST .../activate`.',
      crmAccess('workflows', 'CREATE'),
    ),
    consent: true,
    body: CreateCrmWorkflowSchema,
    responses: {
      201: { description: 'Workflow criado.', schema: CrmWorkflowDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/workflows/{workflowId}',
    tags: TAG,
    summary: 'Detalhe do workflow',
    description: crmAccess('workflows', 'VIEW'),
    params: { workflowId: WORKFLOW_ID },
    responses: { 200: { description: 'Workflow.', schema: CrmWorkflowDTO } },
    errors: ON_WORKFLOW,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/workflows/{workflowId}',
    tags: TAG,
    summary: 'Atualizar workflow',
    description: describe(
      'Atualiza nome, descrição e/ou `status` (informe ao menos um). Para editar o fluxo use `PATCH .../draft`; para ativar com validação do trigger, prefira `POST .../activate`.',
      crmAccess('workflows', 'EDIT'),
    ),
    params: { workflowId: WORKFLOW_ID },
    consent: true,
    body: UpdateCrmWorkflowSchema,
    responses: {
      200: { description: 'Workflow atualizado.', schema: CrmWorkflowDTO },
    },
    errors: ON_WORKFLOW,
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/workflows/{workflowId}',
    tags: TAG,
    summary: 'Excluir workflow',
    description: describe(
      'Exclusão lógica (soft delete): o workflow some das listagens e deixa de ser disparado.',
      crmAccess('workflows', 'DELETE'),
    ),
    params: { workflowId: WORKFLOW_ID },
    consent: true,
    responses: { 200: { description: 'Workflow excluído.', schema: null } },
    errors: ON_WORKFLOW,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/workflows/{workflowId}/activate',
    tags: TAG,
    summary: 'Ativar workflow',
    description: describe(
      'Promove a versão DRAFT a `ACTIVE` (a ativa anterior vira `ARCHIVED`), cria um novo DRAFT com a mesma definição para as próximas edições e marca o workflow como `ACTIVE`. Exige o trigger configurado no draft.',
      crmAccess('workflows', 'EDIT'),
    ),
    params: { workflowId: WORKFLOW_ID },
    consent: true,
    responses: {
      200: { description: 'Workflow ativado.', schema: CrmWorkflowDTO },
    },
    errors: [
      ...ON_WORKFLOW,
      NO_DRAFT,
      {
        code: 'CRM_WORKFLOW_INVALID_DEFINITION',
        message: 'Configure o trigger antes de ativar',
        when: 'Draft sem trigger configurado',
      },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/workflows/{workflowId}/deactivate',
    tags: TAG,
    summary: 'Desativar workflow',
    description: describe(
      'Muda o `status` para `DEACTIVATED` — os gatilhos param de disparar. As versões não são alteradas.',
      crmAccess('workflows', 'EDIT'),
    ),
    params: { workflowId: WORKFLOW_ID },
    consent: true,
    responses: {
      200: { description: 'Workflow desativado.', schema: CrmWorkflowDTO },
    },
    errors: ON_WORKFLOW,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/workflows/{workflowId}/discard',
    tags: TAG,
    summary: 'Descartar alterações do draft',
    description: describe(
      'Restaura a definição do DRAFT a partir da versão `ACTIVE` (ou para uma definição vazia, se nunca foi ativado). Devolve o draft resultante.',
      crmAccess('workflows', 'EDIT'),
    ),
    params: { workflowId: WORKFLOW_ID },
    consent: true,
    responses: {
      200: { description: 'Draft restaurado.', schema: CrmWorkflowVersionDTO },
    },
    errors: [...ON_WORKFLOW, NO_DRAFT],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/workflows/{workflowId}/draft',
    tags: TAG,
    summary: 'Obter draft do workflow',
    description: describe(
      'Versão DRAFT (editável) com a definição do canvas.',
      crmAccess('workflows', 'VIEW'),
    ),
    params: { workflowId: WORKFLOW_ID },
    responses: {
      200: { description: 'Draft.', schema: CrmWorkflowVersionDTO },
    },
    errors: [
      ...ON_WORKFLOW,
      {
        code: 'CRM_WORKFLOW_VERSION_NOT_FOUND',
        when: 'O workflow não tem versão DRAFT',
      },
    ],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/workflows/{workflowId}/draft',
    tags: TAG,
    summary: 'Salvar draft do workflow',
    description: describe(
      'Autosave do editor: substitui a `definition` (trigger, nodes e edges) do DRAFT. Ids de node duplicados, edges apontando para nodes inexistentes ou `leadEvent` fora da entidade `lead` respondem `422 VALIDATION_ERROR`. A versão `ACTIVE` só muda ao ativar.',
      crmAccess('workflows', 'EDIT'),
    ),
    params: { workflowId: WORKFLOW_ID },
    consent: true,
    body: UpdateCrmWorkflowDraftSchema,
    responses: {
      200: { description: 'Draft salvo.', schema: CrmWorkflowVersionDTO },
    },
    errors: [
      ...ON_WORKFLOW,
      NO_DRAFT,
      {
        code: 'CRM_WORKFLOW_INVALID_DEFINITION',
        message: 'Definição inválida',
        when: 'Definição rejeitada na revalidação do service',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/workflows/{workflowId}/versions',
    tags: TAG,
    summary: 'Listar versões do workflow',
    description: describe(
      'Histórico de versões (DRAFT, ACTIVE e ARCHIVED) com as definições.',
      crmAccess('workflows', 'VIEW'),
    ),
    params: { workflowId: WORKFLOW_ID },
    responses: {
      200: {
        description: 'Versões.',
        schema: z.array(CrmWorkflowVersionDTO),
      },
    },
    errors: ON_WORKFLOW,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/workflows/{workflowId}/runs',
    tags: TAG,
    summary: 'Listar execuções do workflow',
    description: describe(
      'As 50 execuções (runs) mais recentes do workflow, sem os steps — use o detalhe da execução para vê-los.',
      crmAccess('workflows', 'VIEW'),
    ),
    params: { workflowId: WORKFLOW_ID },
    responses: {
      200: { description: 'Execuções.', schema: z.array(CrmWorkflowRunDTO) },
    },
    errors: ON_WORKFLOW,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/workflows/{workflowId}/runs/{runId}',
    tags: TAG,
    summary: 'Detalhe da execução',
    description: describe(
      'Execução com os steps (entrada, saída e erro de cada node).',
      crmAccess('workflows', 'VIEW'),
    ),
    params: { workflowId: WORKFLOW_ID, runId: RUN_ID },
    responses: { 200: { description: 'Execução.', schema: CrmWorkflowRunDTO } },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'CRM_WORKFLOW_NOT_FOUND',
        when: 'Workflow ou execução inexistente (ou execução de outro workflow)',
      },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/workflows/{workflowId}/runs/{runId}/resume',
    tags: TAG,
    summary: 'Retomar execução pausada',
    description: describe(
      'Retoma uma execução em `WAITING` num node `form`, com as respostas do formulário em `payload`. A execução continua de forma síncrona e a resposta traz o estado final.',
      crmAccess('workflows', 'EDIT'),
    ),
    params: { workflowId: WORKFLOW_ID, runId: RUN_ID },
    consent: true,
    body: ResumeCrmWorkflowRunSchema,
    responses: {
      200: { description: 'Execução retomada.', schema: CrmWorkflowRunDTO },
    },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'CRM_WORKFLOW_NOT_FOUND',
        when: 'Workflow ou execução inexistente',
      },
      {
        code: 'CRM_WORKFLOW_VERSION_NOT_FOUND',
        when: 'Versão usada pela execução não existe mais',
      },
      {
        code: 'CRM_WORKFLOW_EXECUTION_FAILED',
        message: 'A execução não está aguardando resposta',
        when: 'Execução não está em WAITING',
      },
      {
        code: 'CRM_WORKFLOW_EXECUTION_FAILED',
        message: 'Falha ao retomar o workflow',
        when: 'Erro durante a execução',
      },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/workflows/{workflowId}/trigger',
    tags: TAG,
    summary: 'Executar workflow manualmente',
    description: describe(
      'Cria uma execução `launch-manually` e roda o fluxo de forma síncrona; a resposta traz a execução já processada. `test: true` executa a versão DRAFT em modo de teste (sem efeitos irreversíveis); senão, a versão `ACTIVE`.',
      crmAccess('workflows', 'EDIT'),
    ),
    params: { workflowId: WORKFLOW_ID },
    consent: true,
    body: TriggerCrmWorkflowManualRunSchema,
    responses: {
      201: { description: 'Execução criada.', schema: CrmWorkflowRunDTO },
    },
    errors: [
      ...ON_WORKFLOW,
      {
        code: 'CRM_WORKFLOW_VERSION_NOT_FOUND',
        when: 'Sem versão ACTIVE (ou DRAFT, em `test`)',
      },
      {
        code: 'CRM_WORKFLOW_EXECUTION_FAILED',
        when: 'Erro durante a execução',
      },
    ],
  },
]
