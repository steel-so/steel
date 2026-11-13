import { z } from 'zod'
import {
  CreateSdAutomationRuleSchema,
  ListSdAutomationRulesSchema,
  UpdateSdAutomationRuleSchema,
} from '@/src/schemas/sd-automation-rule.schema'
import {
  CreateSdCalendarSchema,
  UpdateSdCalendarSchema,
} from '@/src/schemas/sd-calendar.schema'
import {
  CreateSdCannedResponseSchema,
  ListSdCannedResponsesSchema,
  UpdateSdCannedResponseSchema,
} from '@/src/schemas/sd-canned-response.schema'
import {
  CreateSdCategorySchema,
  ListSdCategoriesSchema,
  UpdateSdCategorySchema,
} from '@/src/schemas/sd-category.schema'
import {
  CreateSdClassificationSchema,
  ListSdClassificationsSchema,
  UpdateSdClassificationSchema,
} from '@/src/schemas/sd-classification.schema'
import {
  ListSdAgentsSchema,
  ReorderSdConfigSchema,
} from '@/src/schemas/sd-config.schema'
import {
  CreateSdCustomFieldSchema,
  ListSdCustomFieldsSchema,
  UpdateSdCustomFieldSchema,
} from '@/src/schemas/sd-custom-field.schema'
import {
  AddSdDepartmentMemberSchema,
  CreateSdDepartmentSchema,
  ListSdDepartmentsSchema,
  UpdateSdDepartmentMemberSchema,
  UpdateSdDepartmentSchema,
} from '@/src/schemas/sd-department.schema'
import {
  CreateSdEscalationRuleSchema,
  UpdateSdEscalationRuleSchema,
} from '@/src/schemas/sd-escalation-rule.schema'
import {
  CreateSdPartSchema,
  ListSdPartsSchema,
  UpdateSdPartSchema,
} from '@/src/schemas/sd-part.schema'
import {
  CreateSdPhaseSchema,
  ListSdPhasesSchema,
  ReorderSdPhasesSchema,
  SaveSdPhaseTransitionsSchema,
  SdPhaseTransitionsQuerySchema,
  SeedSdPhasesSchema,
  UpdateSdPhaseSchema,
} from '@/src/schemas/sd-phase.schema'
import {
  CreateSdScaleItemSchema,
  SaveSdPriorityMatrixSchema,
  UpdateSdScaleItemSchema,
} from '@/src/schemas/sd-priority.schema'
import { UpdateSdSettingsSchema } from '@/src/schemas/sd-settings.schema'
import {
  CreateSdSlaPolicySchema,
  UpdateSdSlaPolicySchema,
} from '@/src/schemas/sd-sla-policy.schema'
import {
  CreateSdTicketTemplateSchema,
  ListSdTicketTemplatesSchema,
  UpdateSdTicketTemplateSchema,
} from '@/src/schemas/sd-ticket-template.schema'
import type { ErrorEntry, RouteConfig, SchemaSource } from '../../registry'
import {
  SdAgentDTO,
  SdAutomationRuleDTO,
  SdBusinessCalendarDTO,
  SdCannedResponseDTO,
  SdCategoryDTO,
  SdClassificationDTO,
  SdConfigBootstrapDTO,
  SdCustomFieldDefinitionDTO,
  SdDepartmentDTO,
  SdEscalationRuleDTO,
  SdMeDTO,
  SdPartDTO,
  SdPhaseDTO,
  SdPhaseTransitionDTO,
  SdPriorityMatrixCellDTO,
  SdScaleItemDTO,
  SdSeedPhasesSummaryDTO,
  SdSeedSummaryDTO,
  SdSettingsDTO,
  SdSlaPolicyDTO,
  SdTicketTemplateDTO,
} from '../../schemas/servicedesk-config'

const TAG = 'ServiceDesk · Configurações' as const
const BASE = '/workspaces/{id}/servicedesk'

const MEMBER =
  'Acesso: sessão + membro do workspace com o módulo **ServiceDesk** habilitado (agentes e solicitantes).'
const AGENT =
  'Acesso: sessão + módulo **ServiceDesk** habilitado; só **agentes** (membros de um departamento) e admins do módulo.'
const ADMIN =
  'Acesso: sessão + módulo **ServiceDesk** habilitado; só **admins do módulo** (OWNER/ADMIN ou perfil com `sd-settings` × `EDIT`).'

const MEMBER_ERRORS: ErrorEntry[] = [
  { code: 'FORBIDDEN', when: 'Não é membro do workspace' },
  'WORKSPACE_SUSPENDED',
  { code: 'MODULE_DISABLED', when: 'Módulo ServiceDesk desabilitado' },
]
const AGENT_ERRORS: ErrorEntry[] = [
  ...MEMBER_ERRORS,
  { code: 'SD_NOT_AGENT', when: 'Solicitante (sem departamento)' },
]
const ADMIN_ERRORS: ErrorEntry[] = [
  {
    code: 'FORBIDDEN',
    message:
      'Apenas administradores do ServiceDesk podem alterar a configuração',
    when: 'Não é membro ou não é admin do módulo',
  },
  'WORKSPACE_SUSPENDED',
  { code: 'MODULE_DISABLED', when: 'Módulo ServiceDesk desabilitado' },
]
const REF_ERROR: ErrorEntry = {
  code: 'SD_CONFIG_NOT_FOUND',
  when: 'Registro ausente ou id referenciado de outra workspace (`details.missing`)',
}
const CONFLICT: ErrorEntry = {
  code: 'SD_CONFIG_CONFLICT',
  when: 'Violação de unicidade ou de regra da configuração',
}

type Access = 'member' | 'agent' | 'admin'
const ACCESS_TEXT: Record<Access, string> = {
  member: MEMBER,
  agent: AGENT,
  admin: ADMIN,
}
const ACCESS_ERRORS: Record<Access, ErrorEntry[]> = {
  member: MEMBER_ERRORS,
  agent: AGENT_ERRORS,
  admin: ADMIN_ERRORS,
}

interface CrudSpec {
  /** Segmento da coleção (`departments`). */
  path: string
  /** Nome do parâmetro do item (`departmentId`). */
  param: string
  /** Rótulo no singular, em minúsculas (`departamento`). */
  label: string
  dto: SchemaSource
  create: SchemaSource
  update: SchemaSource
  listQuery?: z.ZodType
  listAccess?: Access
  createAccess?: Access
  writeAccess?: Access
  listNote?: string
  createNote?: string
  updateNote?: string
  deleteNote?: string
  extraErrors?: ErrorEntry[]
  deleteErrors?: ErrorEntry[]
  reorder?: boolean
}

function describe(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join('\n\n')
}

function crud(spec: CrudSpec): RouteConfig[] {
  const listAccess = spec.listAccess ?? 'member'
  const createAccess = spec.createAccess ?? 'admin'
  const writeAccess = spec.writeAccess ?? 'admin'
  const item = `${BASE}/${spec.path}/{${spec.param}}`
  const params = { [spec.param]: `Id do(a) ${spec.label}.` }
  const routes: RouteConfig[] = [
    {
      method: 'get',
      path: `${BASE}/${spec.path}`,
      tags: [TAG],
      summary: `Listar ${spec.label}s`,
      description: describe(spec.listNote, ACCESS_TEXT[listAccess]),
      ...(spec.listQuery && { query: spec.listQuery }),
      responses: {
        200: { description: 'Lista.', schema: z.array(spec.dto as z.ZodType) },
      },
      errors: ACCESS_ERRORS[listAccess],
    },
    {
      method: 'post',
      path: `${BASE}/${spec.path}`,
      tags: [TAG],
      summary: `Criar ${spec.label}`,
      description: describe(spec.createNote, ACCESS_TEXT[createAccess]),
      consent: true,
      body: spec.create,
      responses: { 201: { description: 'Criado.', schema: spec.dto } },
      errors: [
        ...ACCESS_ERRORS[createAccess],
        REF_ERROR,
        ...(spec.extraErrors ?? []),
      ],
    },
    {
      method: 'patch',
      path: item,
      tags: [TAG],
      summary: `Atualizar ${spec.label}`,
      description: describe(
        spec.updateNote ?? 'Atualização parcial — informe ao menos um campo.',
        ACCESS_TEXT[writeAccess],
      ),
      consent: true,
      params,
      body: spec.update,
      responses: { 200: { description: 'Atualizado.', schema: spec.dto } },
      errors: [
        ...ACCESS_ERRORS[writeAccess],
        REF_ERROR,
        ...(spec.extraErrors ?? []),
      ],
    },
    {
      method: 'delete',
      path: item,
      tags: [TAG],
      summary: `Excluir ${spec.label}`,
      description: describe(spec.deleteNote, ACCESS_TEXT[writeAccess]),
      consent: true,
      params,
      responses: { 200: { description: 'Excluído.', schema: null } },
      errors: [
        ...ACCESS_ERRORS[writeAccess],
        REF_ERROR,
        ...(spec.deleteErrors ?? []),
      ],
    },
  ]
  if (spec.reorder !== false) {
    routes.push({
      method: 'patch',
      path: `${BASE}/${spec.path}/reorder`,
      tags: [TAG],
      summary: `Reordenar ${spec.label}s`,
      description: describe(
        '`orderedIds` na nova ordem (a posição é o índice).',
        ADMIN,
      ),
      consent: true,
      body: ReorderSdConfigSchema,
      responses: { 200: { description: 'Reordenado.', schema: null } },
      errors: [...ADMIN_ERRORS, REF_ERROR],
    })
  }
  return routes
}

function scale(
  path: string,
  param: string,
  label: string,
  note: string,
): RouteConfig[] {
  return crud({
    path,
    param,
    label,
    dto: SdScaleItemDTO,
    create: CreateSdScaleItemSchema,
    update: UpdateSdScaleItemSchema,
    reorder: false,
    listNote: `${note} Ordenado por \`level\` (crescente); \`level\` é único na workspace.`,
    deleteNote:
      'Remove o item (células da matriz e metas de SLA ligadas saem junto; chamados ficam sem o valor).',
    extraErrors: [
      {
        code: 'SD_CONFIG_CONFLICT',
        message: 'Já existe um item com este nível',
        when: 'Nível repetido',
      },
    ],
  })
}

export const sdConfigRoutes: RouteConfig[] = [
  // Bootstrap e contexto
  {
    method: 'get',
    path: `${BASE}/config`,
    tags: [TAG],
    summary: 'Pacote de configuração da UI',
    description: describe(
      'Tudo o que a UI de chamados precisa num pedido só: configuração pública, departamentos (árvore), catálogo (árvore), classificações, escalas, matriz, fluxos por tipo com transições, campos customizados, modelos, respostas prontas e políticas de SLA (resumo). Itens inativos vêm com `active: false`. Solicitantes recebem só o que é visível no portal, departamentos sem membros e nenhuma resposta pronta/política.',
      MEMBER,
    ),
    responses: {
      200: { description: 'Configuração.', schema: SdConfigBootstrapDTO },
    },
    errors: MEMBER_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/me`,
    tags: [TAG],
    summary: 'Meu papel no ServiceDesk',
    description: describe(
      'Se o usuário é agente e/ou admin do módulo e em quais departamentos (e como líder).',
      MEMBER,
    ),
    responses: { 200: { description: 'Contexto.', schema: SdMeDTO } },
    errors: MEMBER_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/agents`,
    tags: [TAG],
    summary: 'Listar agentes',
    description: describe(
      'Agentes (admins do módulo + membros de departamentos ativos) com seus departamentos, para os seletores de responsável. `includeRequesters=true` traz todos os membros do workspace (com `isAgent`).',
      AGENT,
    ),
    query: ListSdAgentsSchema,
    responses: {
      200: { description: 'Agentes.', schema: z.array(SdAgentDTO) },
    },
    errors: AGENT_ERRORS,
  },
  // Configuração geral
  {
    method: 'get',
    path: `${BASE}/settings`,
    tags: [TAG],
    summary: 'Obter configuração geral',
    description: describe(
      'Configuração 1:1 do módulo (prefixos, padrões, portal, exigências, SLA em risco, IA). Criada com os padrões na primeira leitura.',
      MEMBER,
    ),
    responses: { 200: { description: 'Configuração.', schema: SdSettingsDTO } },
    errors: MEMBER_ERRORS,
  },
  {
    method: 'patch',
    path: `${BASE}/settings`,
    tags: [TAG],
    summary: 'Atualizar configuração geral',
    description: describe(
      'Atualização parcial. `ticketPrefixes` é mesclado com os atuais; `defaultSlaPolicyId` também marca a política como padrão; `whatsappConnectionId` precisa ser uma conexão do módulo ServiceDesk. `requesterWhatsappTemplates` substitui o mapa inteiro de modelos de aviso ao solicitante.',
      ADMIN,
    ),
    consent: true,
    body: UpdateSdSettingsSchema,
    responses: {
      200: { description: 'Configuração salva.', schema: SdSettingsDTO },
    },
    errors: [...ADMIN_ERRORS, REF_ERROR],
  },
  {
    method: 'post',
    path: `${BASE}/settings/restore-defaults`,
    tags: [TAG],
    summary: 'Restaurar padrões ITIL',
    description: describe(
      'Recria o que falta dos padrões ITIL (fases, escalas, matriz, calendários com feriados, SLAs, tipos de CI, departamentos, catálogo de exemplo, modelos e regras) sem alterar o que já foi customizado. Idempotente.',
      ADMIN,
    ),
    consent: true,
    responses: {
      200: { description: 'Itens criados.', schema: SdSeedSummaryDTO },
    },
    errors: ADMIN_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/settings/seed-phases`,
    tags: [TAG],
    summary: 'Criar as fases padrão de um tipo',
    description: describe(
      'Cria as fases padrão ITIL do tipo informado, casadas por nome, mantendo as que já existem e continuando a ordem depois delas — a saída para um fluxo sem fase nenhuma (quadro vazio), sem restaurar todos os padrões. Idempotente.',
      ADMIN,
    ),
    consent: true,
    body: SeedSdPhasesSchema,
    responses: {
      200: { description: 'Fases criadas.', schema: SdSeedPhasesSummaryDTO },
    },
    errors: ADMIN_ERRORS,
  },
  // Departamentos
  ...crud({
    path: 'departments',
    param: 'departmentId',
    label: 'departamento',
    dto: SdDepartmentDTO,
    create: CreateSdDepartmentSchema,
    update: UpdateSdDepartmentSchema,
    listQuery: ListSdDepartmentsSchema,
    listNote:
      'Lista plana (use `parentId` para montar a árvore de 2 níveis) com os membros. `includeInactive=true` inclui os inativos.',
    createNote:
      'Departamento ou sub-departamento (`parentId`). No máximo dois níveis.',
    deleteNote: 'Exclusão lógica; leva junto os sub-departamentos.',
    extraErrors: [
      'SD_DEPARTMENT_NOT_FOUND',
      {
        code: 'SD_DEPARTMENT_DEPTH_EXCEEDED',
        when: 'Pai é sub-departamento, ou departamento com filhos virando sub-departamento',
      },
    ],
    deleteErrors: ['SD_DEPARTMENT_NOT_FOUND'],
  }),
  {
    method: 'post',
    path: `${BASE}/departments/{departmentId}/members`,
    tags: [TAG],
    summary: 'Adicionar membro ao departamento',
    description: describe(
      'Adiciona (ou atualiza o `isLead` de) um membro do workspace. Quem está em ao menos um departamento vira **agente**.',
      ADMIN,
    ),
    consent: true,
    params: { departmentId: 'Id do departamento.' },
    body: AddSdDepartmentMemberSchema,
    responses: {
      201: { description: 'Departamento atualizado.', schema: SdDepartmentDTO },
    },
    errors: [...ADMIN_ERRORS, REF_ERROR, 'SD_DEPARTMENT_NOT_FOUND'],
  },
  {
    method: 'patch',
    path: `${BASE}/departments/{departmentId}/members/{userId}`,
    tags: [TAG],
    summary: 'Marcar/desmarcar líder',
    description: describe('Alvo do escalonamento hierárquico.', ADMIN),
    consent: true,
    params: {
      departmentId: 'Id do departamento.',
      userId: 'Id do usuário.',
    },
    body: UpdateSdDepartmentMemberSchema,
    responses: {
      200: { description: 'Departamento atualizado.', schema: SdDepartmentDTO },
    },
    errors: [...ADMIN_ERRORS, REF_ERROR, 'SD_DEPARTMENT_NOT_FOUND'],
  },
  {
    method: 'delete',
    path: `${BASE}/departments/{departmentId}/members/{userId}`,
    tags: [TAG],
    summary: 'Remover membro do departamento',
    description: ADMIN,
    consent: true,
    params: {
      departmentId: 'Id do departamento.',
      userId: 'Id do usuário.',
    },
    responses: {
      200: { description: 'Departamento atualizado.', schema: SdDepartmentDTO },
    },
    errors: [...ADMIN_ERRORS, 'SD_DEPARTMENT_NOT_FOUND'],
  },
  // Catálogo
  ...crud({
    path: 'categories',
    param: 'categoryId',
    label: 'item do catálogo',
    dto: SdCategoryDTO,
    create: CreateSdCategorySchema,
    update: UpdateSdCategorySchema,
    listQuery: ListSdCategoriesSchema,
    listNote:
      'Catálogo categoria > subcategoria > serviço (lista plana ordenada; `parentId` monta a árvore). `ticketType` filtra os nós do tipo (ou de todos). Solicitantes veem só nós ativos e visíveis no portal.',
    createNote:
      '`level` precisa casar com o pai: raiz = CATEGORY, filho de categoria = SUBCATEGORY, filho de subcategoria = SERVICE.',
    deleteNote: 'Remove o nó e a subárvore (chamados ficam sem a categoria).',
    extraErrors: ['SD_CATEGORY_NOT_FOUND', 'SD_CATEGORY_LEVEL_INVALID'],
    deleteErrors: ['SD_CATEGORY_NOT_FOUND'],
  }),
  // Classificações
  ...crud({
    path: 'classifications',
    param: 'classificationId',
    label: 'classificação',
    dto: SdClassificationDTO,
    create: CreateSdClassificationSchema,
    update: UpdateSdClassificationSchema,
    listQuery: ListSdClassificationsSchema,
    listNote: 'Classificações do chamado (`TICKET`) e da solução (`SOLUTION`).',
  }),
  // Escalas ITIL + matriz
  ...scale('impacts', 'impactId', 'impacto', 'Impacto (ITIL).'),
  ...scale('urgencies', 'urgencyId', 'urgência', 'Urgência (ITIL).'),
  ...scale(
    'priorities',
    'priorityId',
    'prioridade',
    'Prioridade (nome, cor, peso); `isDefault` marca a padrão (uma só).',
  ),
  ...scale(
    'severities',
    'severityId',
    'severidade',
    'Severidade técnica (independente da prioridade).',
  ),
  {
    method: 'get',
    path: `${BASE}/priority-matrix`,
    tags: [TAG],
    summary: 'Obter a matriz de prioridade',
    description: describe(
      'Células impacto × urgência → prioridade usadas na abertura do chamado.',
      MEMBER,
    ),
    responses: {
      200: {
        description: 'Células.',
        schema: z.array(SdPriorityMatrixCellDTO),
      },
    },
    errors: MEMBER_ERRORS,
  },
  {
    method: 'put',
    path: `${BASE}/priority-matrix`,
    tags: [TAG],
    summary: 'Salvar a matriz de prioridade',
    description: describe(
      'Substitui a grade inteira. Células ausentes = sem prioridade automática.',
      ADMIN,
    ),
    consent: true,
    body: SaveSdPriorityMatrixSchema,
    responses: {
      200: {
        description: 'Matriz salva.',
        schema: z.array(SdPriorityMatrixCellDTO),
      },
    },
    errors: [...ADMIN_ERRORS, REF_ERROR],
  },
  // Fases e transições
  {
    method: 'get',
    path: `${BASE}/phases`,
    tags: [TAG],
    summary: 'Listar fases',
    description: describe(
      'Fases do fluxo (por `ticketType`, ordenadas). `includeInactive=true` inclui as inativas.',
      MEMBER,
    ),
    query: ListSdPhasesSchema,
    responses: { 200: { description: 'Fases.', schema: z.array(SdPhaseDTO) } },
    errors: MEMBER_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/phases`,
    tags: [TAG],
    summary: 'Criar fase',
    description: describe(
      'Nome, cor, semântica (`category`), % de conclusão (0–100), pausa de SLA, aprovação exigida, campos obrigatórios e limite WIP. A primeira fase do tipo vira a inicial; `isInitial: true` desmarca as demais do tipo.',
      ADMIN,
    ),
    consent: true,
    body: CreateSdPhaseSchema,
    responses: { 201: { description: 'Fase criada.', schema: SdPhaseDTO } },
    errors: [...ADMIN_ERRORS, CONFLICT],
  },
  {
    method: 'patch',
    path: `${BASE}/phases/reorder`,
    tags: [TAG],
    summary: 'Reordenar fases de um tipo',
    description: describe('Colunas do kanban na nova ordem.', ADMIN),
    consent: true,
    body: ReorderSdPhasesSchema,
    responses: { 200: { description: 'Reordenado.', schema: null } },
    errors: [...ADMIN_ERRORS, REF_ERROR],
  },
  {
    method: 'patch',
    path: `${BASE}/phases/{phaseId}`,
    tags: [TAG],
    summary: 'Atualizar fase',
    description: describe(
      'O tipo é imutável. A fase inicial não pode ser desmarcada (marque outra) nem desativada.',
      ADMIN,
    ),
    consent: true,
    params: { phaseId: 'Id da fase.' },
    body: UpdateSdPhaseSchema,
    responses: { 200: { description: 'Fase atualizada.', schema: SdPhaseDTO } },
    errors: [...ADMIN_ERRORS, 'SD_PHASE_NOT_FOUND', CONFLICT],
  },
  {
    method: 'delete',
    path: `${BASE}/phases/{phaseId}`,
    tags: [TAG],
    summary: 'Excluir fase',
    description: describe(
      'Só fases sem chamados e que não são a inicial — as demais, desative.',
      ADMIN,
    ),
    consent: true,
    params: { phaseId: 'Id da fase.' },
    responses: { 200: { description: 'Fase excluída.', schema: null } },
    errors: [...ADMIN_ERRORS, 'SD_PHASE_NOT_FOUND', CONFLICT],
  },
  {
    method: 'get',
    path: `${BASE}/phases/transitions`,
    tags: [TAG],
    summary: 'Listar transições de um tipo',
    description: describe(
      'Transições permitidas entre fases. Sem nenhuma, o fluxo do tipo é livre.',
      MEMBER,
    ),
    query: SdPhaseTransitionsQuerySchema,
    responses: {
      200: {
        description: 'Transições.',
        schema: z.array(SdPhaseTransitionDTO),
      },
    },
    errors: MEMBER_ERRORS,
  },
  {
    method: 'put',
    path: `${BASE}/phases/transitions`,
    tags: [TAG],
    summary: 'Salvar a matriz de transições de um tipo',
    description: describe(
      'Substitui todas as transições do tipo. `allowedDepartmentIds` restringe quem pode mover (vazio = qualquer agente). Lista vazia volta ao fluxo livre.',
      ADMIN,
    ),
    consent: true,
    query: SdPhaseTransitionsQuerySchema,
    body: SaveSdPhaseTransitionsSchema,
    responses: {
      200: {
        description: 'Transições salvas.',
        schema: z.array(SdPhaseTransitionDTO),
      },
    },
    errors: [
      ...ADMIN_ERRORS,
      { code: 'SD_PHASE_NOT_FOUND', when: 'Fase de outro tipo ou workspace' },
      REF_ERROR,
    ],
  },
  // Calendários e SLA
  ...crud({
    path: 'calendars',
    param: 'calendarId',
    label: 'calendário',
    dto: SdBusinessCalendarDTO,
    create: CreateSdCalendarSchema,
    update: UpdateSdCalendarSchema,
    reorder: false,
    listNote: 'Calendários de expediente (padrão primeiro).',
    createNote:
      'Fuso IANA, expediente semanal (intervalos HH:MM sem sobreposição), feriados e 24×7. O primeiro vira o padrão; `isDefault` desmarca os demais.',
    extraErrors: [CONFLICT],
    deleteErrors: [
      { code: 'SD_CONFIG_CONFLICT', when: 'É o calendário padrão' },
    ],
  }),
  ...crud({
    path: 'sla-policies',
    param: 'policyId',
    label: 'política de SLA',
    dto: SdSlaPolicyDTO,
    create: CreateSdSlaPolicySchema,
    update: UpdateSdSlaPolicySchema,
    listNote:
      'Políticas SLA/OLA por `position`, com metas por prioridade (minutos úteis).',
    createNote:
      '`conditions` decide quando a política se aplica (a primeira ativa que casar, senão a padrão). `targets` traz as metas por prioridade. A primeira vira a padrão.',
    updateNote:
      'Atualização parcial; `targets` (quando enviado) substitui todas as metas. A padrão não pode ser desmarcada/desativada.',
    extraErrors: [CONFLICT],
    deleteErrors: [{ code: 'SD_CONFIG_CONFLICT', when: 'É a política padrão' }],
  }),
  // Regras
  ...crud({
    path: 'escalation-rules',
    param: 'ruleId',
    label: 'regra de escalonamento',
    dto: SdEscalationRuleDTO,
    create: CreateSdEscalationRuleSchema,
    update: UpdateSdEscalationRuleSchema,
    listAccess: 'agent',
    listNote: 'Regras disparadas pelo tick de SLA do worker, por `position`.',
    createNote:
      '`thresholdMinutes` é obrigatório no gatilho `NO_UPDATE`. Usuários/departamentos das ações precisam ser da workspace.',
    extraErrors: ['VALIDATION_ERROR'],
  }),
  ...crud({
    path: 'automation-rules',
    param: 'ruleId',
    label: 'regra de automação',
    dto: SdAutomationRuleDTO,
    create: CreateSdAutomationRuleSchema,
    update: UpdateSdAutomationRuleSchema,
    listQuery: ListSdAutomationRulesSchema,
    listAccess: 'agent',
    listNote:
      'Evento → condições → ações, avaliadas por `position` (`stopProcessing` interrompe as seguintes).',
    createNote:
      'Ids referenciados pelas ações (departamentos, usuários, modelos) precisam ser da workspace.',
  }),
  // Campos, modelos, respostas, peças
  ...crud({
    path: 'custom-fields',
    param: 'fieldId',
    label: 'campo customizado',
    dto: SdCustomFieldDefinitionDTO,
    create: CreateSdCustomFieldSchema,
    update: UpdateSdCustomFieldSchema,
    listQuery: ListSdCustomFieldsSchema,
    listNote:
      'Definições por entidade (chamado, cliente, contato, CI). Solicitantes veem só as ativas visíveis no portal.',
    createNote:
      '`key` única por entidade (`^[a-zA-Z][a-zA-Z0-9_]*$`). Seleções exigem opções; `defaultValue` é validado contra o tipo.',
    updateNote: 'Atualização parcial; `entity`, `key` e `type` são imutáveis.',
    extraErrors: ['SD_CUSTOM_FIELD_INVALID', CONFLICT],
  }),
  ...crud({
    path: 'ticket-templates',
    param: 'templateId',
    label: 'modelo de chamado',
    dto: SdTicketTemplateDTO,
    create: CreateSdTicketTemplateSchema,
    update: UpdateSdTicketTemplateSchema,
    listQuery: ListSdTicketTemplatesSchema,
    listNote:
      'Modelos (requisição/mudança padrão…). Solicitantes veem só os ativos marcados para o portal.',
    createNote:
      '`defaults` são aplicados na abertura; `tasks` vira o checklist do chamado.',
  }),
  ...crud({
    path: 'canned-responses',
    param: 'responseId',
    label: 'resposta pronta',
    dto: SdCannedResponseDTO,
    create: CreateSdCannedResponseSchema,
    update: UpdateSdCannedResponseSchema,
    listQuery: ListSdCannedResponsesSchema,
    listAccess: 'agent',
    createAccess: 'agent',
    writeAccess: 'agent',
    reorder: false,
    listNote:
      '`departmentId` traz as do departamento + as gerais; `q` busca no título, atalho e texto.',
    updateNote: 'Agentes alteram as próprias; admins do módulo, qualquer uma.',
  }),
  ...crud({
    path: 'parts',
    param: 'partId',
    label: 'peça',
    dto: SdPartDTO,
    create: CreateSdPartSchema,
    update: UpdateSdPartSchema,
    listQuery: ListSdPartsSchema,
    listAccess: 'agent',
    reorder: false,
    listNote: 'Catálogo de peças (`q` busca por nome/SKU).',
    createNote:
      '`unitCost` aceita número ou string decimal; volta como string (`"49.90"`).',
  }),
]
