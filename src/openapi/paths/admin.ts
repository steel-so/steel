import { z } from 'zod'
import {
  BackupDownloadQuerySchema,
  ChangeWorkspacePlanSchema,
  ConfirmedWorkspaceActionSchema,
  DeleteWorkspaceSchema,
  ListBackupsQuerySchema,
  SetWorkspaceAllowedIpsSchema,
  SetWorkspaceStatusSchema,
  TriggerBackupSchema,
} from '@/src/schemas/admin.schema'
import { AnalyticsQuerySchema } from '@/src/schemas/admin-analytics.schema'
import { CreateChangelogSchema } from '@/src/schemas/changelog.schema'
import { SetFeatureOverrideSchema } from '@/src/schemas/feature-flag.schema'
import { UpdatePlatformAiSettingsSchema } from '@/src/schemas/platform-ai-settings.schema'
import {
  CreateProfileSchema,
  UpdateProfileSchema,
} from '@/src/schemas/profile.schema'
import { ReleaseDraftRequestSchema } from '@/src/schemas/release-notes.schema'
import { SetWorkspaceModuleAccessSchema } from '@/src/schemas/workspace-module-access.schema'
import { flag, PLATFORM_ADMIN_ERRORS } from '../common'
import type { ErrorEntry, OpenApiRegistry, RouteConfig } from '../registry'
import {
  AdminAnalyticsDTO,
  AdminAuditEntryDTO,
  AdminBackupDTO,
  AdminFeatureDTO,
  AdminMetricsDTO,
  AdminOperationDTO,
  AdminOverviewDTO,
  AdminWorkspaceDetailDTO,
  AdminWorkspaceRecordDTO,
  AdminWorkspaceSummaryDTO,
  ChangelogDetailDTO,
  ChangelogReleaseDraftDTO,
  ChangelogSummaryDTO,
  PlatformAiSettingsDTO,
} from '../schemas/admin'
import {
  MediaUrlDTO,
  ModuleAccessDTO,
  ModuleAccessSummaryDTO,
  ProfileDTO,
  WorkspaceMemberDTO,
} from '../schemas/core'

/**
 * Painel do admin global (`/admin`). Todas as rotas exigem sessão de um
 * admin da plataforma (`assertPlatformAdmin`); as ações destrutivas exigem
 * motivo (vai para a auditoria) e, quando irreversíveis, a confirmação do slug.
 */

const ADMIN_NOTE = 'Só admin global da plataforma.'
const WORKSPACE_NOT_FOUND: ErrorEntry = {
  code: 'RESOURCE_NOT_FOUND',
  message: 'Workspace not found',
  when: 'Workspace inexistente',
}

function admin(
  route: Omit<RouteConfig, 'errors'> & { errors?: ErrorEntry[] },
): RouteConfig {
  return {
    ...route,
    description: route.description
      ? `${route.description}\n\n${ADMIN_NOTE}`
      : ADMIN_NOTE,
    errors: [...PLATFORM_ADMIN_ERRORS, ...(route.errors ?? [])],
  }
}

const SetProfileSchema = z.object({
  profileId: z
    .string()
    .min(1)
    .nullable()
    .meta({ description: '`null` remove o perfil.' }),
})

const routes: RouteConfig[] = [
  admin({
    method: 'get',
    path: '/admin/overview',
    tags: ['Admin · Métricas'],
    summary: 'Visão geral da plataforma',
    description:
      'Mesmos dados da página `/admin`: workspaces, usuários, MRR, cadastros e ações recentes, filas, status, backups e operações.',
    responses: {
      200: { description: 'Visão geral.', schema: AdminOverviewDTO },
    },
  }),
  admin({
    method: 'get',
    path: '/admin/metrics',
    tags: ['Admin · Métricas'],
    summary: 'Métricas de uso e receita',
    description:
      'Clientes ativos, MRR, churn por mês e uso por módulo/workspace na janela.',
    responses: { 200: { description: 'Métricas.', schema: AdminMetricsDTO } },
  }),
  admin({
    method: 'get',
    path: '/admin/analytics',
    tags: ['Admin · Métricas'],
    summary: 'Analytics de requisições (Axiom) e filas',
    description:
      'Uma aba por chamada: `overview` (req/min, erros 4xx/5xx, latência p50/p95/p99, usuários/workspaces únicos), `routes` (rotas normalizadas), `route` (detalhe de uma rota — exige `route`), `errors`, `access` (país/cidade, navegador, dispositivo) e `jobs` (BullMQ). Os dados vêm dos logs de requisição no Axiom (APL) com cache de 45 s; cada painel falha sozinho. Sem `AXIOM_QUERY_TOKEN` responde `unconfigured: true`.',
    query: AnalyticsQuerySchema,
    responses: {
      200: { description: 'Aba do painel.', schema: AdminAnalyticsDTO },
    },
    errors: [
      {
        code: 'RESOURCE_NOT_FOUND',
        message: 'Workspace not found',
        when: 'Filtro `workspace` inexistente (aba `access`)',
      },
    ],
  }),
  admin({
    method: 'get',
    path: '/admin/workspaces',
    tags: ['Admin · Workspaces'],
    summary: 'Listar todos os workspaces',
    responses: {
      200: {
        description: 'Workspaces.',
        schema: z.array(AdminWorkspaceSummaryDTO),
      },
    },
  }),
  admin({
    method: 'get',
    path: '/admin/workspaces/{id}',
    tags: ['Admin · Workspaces'],
    summary: 'Detalhe de um workspace',
    responses: {
      200: { description: 'Workspace.', schema: AdminWorkspaceRecordDTO },
    },
    errors: [WORKSPACE_NOT_FOUND],
  }),
  admin({
    method: 'get',
    path: '/admin/workspaces/{id}/members',
    tags: ['Admin · Workspaces'],
    summary: 'Membros de um workspace',
    responses: {
      200: { description: 'Membros.', schema: z.array(WorkspaceMemberDTO) },
    },
    errors: [WORKSPACE_NOT_FOUND],
  }),
  admin({
    method: 'patch',
    path: '/admin/workspaces/{id}/members/{userId}/profile',
    tags: ['Admin · Workspaces'],
    summary: 'Atribuir perfil a um membro',
    params: { userId: 'ID do usuário membro.' },
    consent: true,
    body: SetProfileSchema,
    responses: {
      200: { description: 'Perfil atribuído.', schema: flag('updated') },
    },
    errors: ['PROFILE_NOT_FOUND', WORKSPACE_NOT_FOUND],
  }),
  admin({
    method: 'get',
    path: '/admin/workspaces/{id}/profiles',
    tags: ['Admin · Workspaces'],
    summary: 'Perfis de acesso de um workspace',
    responses: { 200: { description: 'Perfis.', schema: z.array(ProfileDTO) } },
    errors: [WORKSPACE_NOT_FOUND],
  }),
  admin({
    method: 'post',
    path: '/admin/workspaces/{id}/profiles',
    tags: ['Admin · Workspaces'],
    summary: 'Criar perfil de acesso num workspace',
    consent: true,
    body: CreateProfileSchema,
    responses: { 201: { description: 'Perfil criado.', schema: ProfileDTO } },
    errors: ['PROFILE_NAME_TAKEN', WORKSPACE_NOT_FOUND],
  }),
  admin({
    method: 'patch',
    path: '/admin/workspaces/{id}/profiles/{profileId}',
    tags: ['Admin · Workspaces'],
    summary: 'Atualizar perfil de acesso',
    params: { profileId: 'ID do perfil.' },
    consent: true,
    body: UpdateProfileSchema,
    responses: {
      200: { description: 'Perfil atualizado.', schema: ProfileDTO },
    },
    errors: [
      'PROFILE_NOT_FOUND',
      'PROFILE_NAME_TAKEN',
      'PROFILE_SYSTEM_PROTECTED',
    ],
  }),
  admin({
    method: 'delete',
    path: '/admin/workspaces/{id}/profiles/{profileId}',
    tags: ['Admin · Workspaces'],
    summary: 'Excluir perfil de acesso',
    params: { profileId: 'ID do perfil.' },
    consent: true,
    responses: { 200: { description: 'Perfil excluído.', schema: null } },
    errors: ['PROFILE_NOT_FOUND', 'PROFILE_SYSTEM_PROTECTED', 'PROFILE_IN_USE'],
  }),
  admin({
    method: 'get',
    path: '/admin/workspaces/{id}/module-access',
    tags: ['Admin · Workspaces'],
    summary: 'Módulos do workspace',
    description:
      'Os três módulos (SERVICE_DESK, CRM, COMMUNICATION), incluindo os nunca concedidos.',
    responses: {
      200: {
        description: 'Acesso por módulo.',
        schema: z.array(ModuleAccessSummaryDTO),
      },
    },
    errors: [WORKSPACE_NOT_FOUND],
  }),
  admin({
    method: 'patch',
    path: '/admin/workspaces/{id}/module-access',
    tags: ['Admin · Workspaces'],
    summary: 'Habilitar/desabilitar módulo',
    consent: true,
    body: SetWorkspaceModuleAccessSchema,
    responses: {
      200: { description: 'Acesso atualizado.', schema: ModuleAccessDTO },
    },
    errors: [WORKSPACE_NOT_FOUND],
  }),
  admin({
    method: 'get',
    path: '/admin/workspaces/{id}/features',
    tags: ['Admin · Workspaces'],
    summary: 'Feature flags do workspace',
    description:
      'Catálogo de features com o default do plano, o override vigente (ou expirado) e o valor efetivo.',
    responses: {
      200: { description: 'Features.', schema: z.array(AdminFeatureDTO) },
    },
    errors: [WORKSPACE_NOT_FOUND],
  }),
  admin({
    method: 'patch',
    path: '/admin/workspaces/{id}/features',
    tags: ['Admin · Workspaces'],
    summary: 'Override de feature flag',
    description:
      '`enabled: true|false` força a feature; `enabled: null` remove o override (volta ao default do plano). `expiresAt` opcional (no futuro) faz o override deixar de valer sozinho.',
    consent: true,
    body: {
      schema: SetFeatureOverrideSchema,
      example: {
        key: 'crm.aiAssistant',
        enabled: true,
        note: 'Piloto comercial',
        expiresAt: '2026-12-31T23:59:59-03:00',
      },
    },
    responses: {
      200: {
        description: 'Features atualizadas.',
        schema: z.array(AdminFeatureDTO),
      },
    },
    errors: [WORKSPACE_NOT_FOUND],
  }),
  admin({
    method: 'patch',
    path: '/admin/workspaces/{id}/plan',
    tags: ['Admin · Workspaces'],
    summary: 'Trocar plano manualmente',
    description:
      'Para contratos fora da AbacatePay. Motivo obrigatório (auditoria).',
    consent: true,
    body: ChangeWorkspacePlanSchema,
    responses: {
      200: {
        description: 'Workspace com o novo plano.',
        schema: AdminWorkspaceDetailDTO,
      },
    },
    errors: [WORKSPACE_NOT_FOUND, 'WORKSPACE_STATUS_CONFLICT'],
  }),
  admin({
    method: 'patch',
    path: '/admin/workspaces/{id}/allowed-ips',
    tags: ['Admin · Workspaces'],
    summary: 'Definir IPs permitidos do workspace',
    description:
      'Allowlist de IPs/CIDRs de origem. Fora dela, app e API respondem `WORKSPACE_IP_NOT_ALLOWED`; lista vazia libera qualquer rede. Motivo obrigatório (auditoria).',
    consent: true,
    body: {
      schema: SetWorkspaceAllowedIpsSchema,
      example: {
        allowedIps: ['200.1.2.3', '200.1.2.0/24'],
        reason: 'Cliente bancário: acesso só pelas redes internas',
      },
    },
    responses: {
      200: {
        description: 'Workspace com a allowlist atualizada.',
        schema: AdminWorkspaceDetailDTO,
      },
    },
    errors: [WORKSPACE_NOT_FOUND, 'WORKSPACE_STATUS_CONFLICT'],
  }),
  admin({
    method: 'patch',
    path: '/admin/workspaces/{id}/status',
    tags: ['Admin · Workspaces'],
    summary: 'Suspender ou reativar workspace',
    description:
      '`suspend` bloqueia todos os membros (UI e API respondem `WORKSPACE_SUSPENDED`); `reactivate` libera. Motivo obrigatório (auditoria).',
    consent: true,
    body: {
      schema: SetWorkspaceStatusSchema,
      example: { action: 'suspend', reason: 'Inadimplência há 60 dias' },
    },
    responses: {
      200: {
        description: 'Workspace atualizado.',
        schema: AdminWorkspaceDetailDTO,
      },
    },
    errors: [
      WORKSPACE_NOT_FOUND,
      'WORKSPACE_STATUS_CONFLICT',
      'WORKSPACE_OPERATION_IN_PROGRESS',
    ],
  }),
  admin({
    method: 'post',
    path: '/admin/workspaces/{id}/deletion',
    tags: ['Admin · Workspaces'],
    summary: 'Excluir workspace definitivamente',
    description:
      'Assíncrono (202): o worker faz um backup de segurança do workspace, cancela as assinaturas ativas na AbacatePay e só então apaga dados e arquivos. Se algum cancelamento falhar a operação é barrada e nada é apagado — reenvie com `ignoreSubscriptionCancelFailure: true` para seguir mesmo assim (as assinaturas ficam registradas para cancelamento manual). Confirme digitando o slug em `confirmSlug`. Acompanhe por `GET /admin/operations/{id}`.',
    consent: true,
    body: {
      schema: DeleteWorkspaceSchema,
      example: {
        confirmSlug: 'acme',
        reason: 'Encerramento de contrato a pedido do cliente',
        ignoreSubscriptionCancelFailure: false,
      },
    },
    responses: {
      202: { description: 'Exclusão enfileirada.', schema: AdminOperationDTO },
    },
    errors: [
      WORKSPACE_NOT_FOUND,
      'WORKSPACE_CONFIRMATION_MISMATCH',
      'WORKSPACE_OPERATION_IN_PROGRESS',
      'WORKSPACE_STATUS_CONFLICT',
    ],
  }),
  admin({
    method: 'get',
    path: '/admin/workspaces/{id}/audit',
    tags: ['Admin · Workspaces'],
    summary: 'Trilha de auditoria do admin no workspace',
    description:
      'Ações do admin global sobre o workspace, mais recentes primeiro.',
    responses: {
      200: {
        description: 'Entradas de auditoria.',
        schema: z.array(AdminAuditEntryDTO),
      },
    },
  }),
  admin({
    method: 'get',
    path: '/admin/operations',
    tags: ['Admin · Backups e operações'],
    summary: 'Operações recentes',
    description:
      'Exclusões e restaurações de workspace, mais recentes primeiro.',
    query: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Filtra por workspace.' },
      },
    },
    responses: {
      200: { description: 'Operações.', schema: z.array(AdminOperationDTO) },
    },
  }),
  admin({
    method: 'get',
    path: '/admin/operations/{id}',
    tags: ['Admin · Backups e operações'],
    summary: 'Progresso de uma operação',
    description: 'Usado em polling pela UI durante exclusões/restaurações.',
    params: { id: 'ID da operação.' },
    responses: { 200: { description: 'Operação.', schema: AdminOperationDTO } },
    errors: ['RESOURCE_NOT_FOUND'],
  }),
  admin({
    method: 'get',
    path: '/admin/backups',
    tags: ['Admin · Backups e operações'],
    summary: 'Listar backups',
    description:
      'Backups FULL e por workspace, mais recentes primeiro, com a localização (MinIO local e/ou cópia offsite).',
    query: ListBackupsQuerySchema,
    responses: {
      200: {
        description: 'Backups.',
        schema: z.object({
          backups: z.array(AdminBackupDTO),
          offsiteConfigured: z
            .boolean()
            .meta({ description: '`BACKUP_OFFSITE_*` configurado.' }),
        }),
      },
    },
  }),
  admin({
    method: 'post',
    path: '/admin/backups',
    tags: ['Admin · Backups e operações'],
    summary: 'Disparar backup',
    description:
      '`{ "scope": "FULL" }` ou `{ "scope": "WORKSPACE", "workspaceId": "..." }`. Assíncrono (202): o worker roda o `pg_dump`.',
    consent: true,
    body: {
      schema: TriggerBackupSchema,
      example: { scope: 'WORKSPACE', workspaceId: 'ckv9x2p0h0000ws7d3k1e5abc' },
    },
    responses: {
      202: {
        description: 'Backup enfileirado.',
        schema: z.object({ jobId: z.string() }),
      },
    },
    errors: [
      WORKSPACE_NOT_FOUND,
      { code: 'CONFLICT', when: 'Já há backup em andamento' },
      'INTERNAL_SERVER_ERROR',
    ],
  }),
  admin({
    method: 'post',
    path: '/admin/backups/{id}/download-link',
    tags: ['Admin · Backups e operações'],
    summary: 'Gerar link de download',
    description:
      'Link assinado (`exp` + `sig`), válido por 5 minutos, para `GET /admin/backups/{id}/download`.',
    params: { id: 'ID do backup.' },
    responses: {
      200: {
        description: 'Link assinado.',
        schema: z.object({ url: z.string(), expiresAt: z.iso.datetime() }),
      },
    },
    errors: ['BACKUP_NOT_FOUND'],
  }),
  admin({
    method: 'get',
    path: '/admin/backups/{id}/download',
    tags: ['Admin · Backups e operações'],
    summary: 'Baixar arquivo do backup',
    description:
      'Transmite o arquivo como está no MinIO (cifrado com `CONNECTION_SECRETS`). Exige a sessão do admin **e** a assinatura gerada em `download-link`.',
    params: { id: 'ID do backup.' },
    query: BackupDownloadQuerySchema,
    queryValidationError: false,
    responses: {
      200: {
        description: 'Arquivo do backup (`Content-Disposition: attachment`).',
        envelope: false,
        contentType: 'application/octet-stream',
        schema: { type: 'string', format: 'binary' },
      },
    },
    errors: [
      {
        code: 'BACKUP_DOWNLOAD_LINK_INVALID',
        message: 'Link de download inválido ou expirado',
      },
      'BACKUP_NOT_FOUND',
      { code: 'STORAGE_ERROR', message: 'Arquivo do backup indisponível' },
    ],
  }),
  admin({
    method: 'post',
    path: '/admin/backups/{id}/restore',
    tags: ['Admin · Backups e operações'],
    summary: 'Restaurar workspace a partir de backup',
    description:
      'Só backups `WORKSPACE` concluídos. Assíncrono (202): o worker faz um backup de segurança do estado atual e restaura. Confirme com o slug em `confirmSlug`.',
    params: { id: 'ID do backup.' },
    consent: true,
    body: ConfirmedWorkspaceActionSchema,
    responses: {
      202: {
        description: 'Restauração enfileirada.',
        schema: AdminOperationDTO,
      },
    },
    errors: [
      'BACKUP_NOT_FOUND',
      'BACKUP_NOT_RESTORABLE',
      'WORKSPACE_CONFIRMATION_MISMATCH',
      'WORKSPACE_OPERATION_IN_PROGRESS',
      'WORKSPACE_STATUS_CONFLICT',
    ],
  }),
  admin({
    method: 'get',
    path: '/admin/changelog',
    tags: ['Admin · Changelog'],
    summary: 'Listar e-mails de novidades',
    responses: {
      200: { description: 'Changelogs.', schema: z.array(ChangelogSummaryDTO) },
    },
  }),
  admin({
    method: 'post',
    path: '/admin/changelog',
    tags: ['Admin · Changelog'],
    summary: 'Criar e-mail de novidades (rascunho)',
    description:
      'Destinatários por `userIds` e/ou `emails` avulsos (até 5.000 cada). Fica em `DRAFT` até `POST /admin/changelog/{id}/start`.',
    body: CreateChangelogSchema,
    responses: {
      201: { description: 'Rascunho criado.', schema: ChangelogDetailDTO },
    },
  }),
  admin({
    method: 'get',
    path: '/admin/changelog/{id}',
    tags: ['Admin · Changelog'],
    summary: 'Detalhe do e-mail de novidades',
    description: 'Itens e destinatários com o status de envio de cada um.',
    params: { id: 'ID do changelog.' },
    responses: {
      200: { description: 'Changelog.', schema: ChangelogDetailDTO },
    },
    errors: ['CHANGELOG_NOT_FOUND'],
  }),
  admin({
    method: 'post',
    path: '/admin/changelog/{id}/start',
    tags: ['Admin · Changelog'],
    summary: 'Disparar envio',
    description:
      'Enfileira o envio (`QUEUED`); o worker envia e atualiza os contadores.',
    params: { id: 'ID do changelog.' },
    responses: {
      200: { description: 'Envio iniciado.', schema: ChangelogDetailDTO },
    },
    errors: [
      'CHANGELOG_NOT_FOUND',
      { code: 'CHANGELOG_LOCKED', when: 'Já disparado' },
    ],
  }),
  admin({
    method: 'post',
    path: '/admin/changelog/release-draft',
    tags: ['Admin · Changelog'],
    summary: 'Gerar rascunho a partir de release',
    description:
      '`source: github` usa a última release do GitHub (ou os commits, se as notas estiverem vazias); `source: manual` converte notas coladas. Não grava nada — o admin revisa antes de criar.',
    body: ReleaseDraftRequestSchema,
    responses: {
      200: { description: 'Rascunho.', schema: ChangelogReleaseDraftDTO },
    },
    errors: ['RELEASE_NOTES_UNAVAILABLE'],
  }),
  admin({
    method: 'post',
    path: '/admin/changelog/images/upload',
    tags: ['Admin · Changelog'],
    summary: 'Enviar imagem para item de changelog',
    description:
      'Corpo **binário** (não multipart) com o `Content-Type` da imagem. JPEG, PNG ou WebP até 5 MB.',
    rateLimit: 'upload',
    body: {
      contentType: 'image/*',
      schema: { type: 'string', format: 'binary' },
      description: 'Bytes da imagem.',
    },
    responses: { 201: { description: 'Imagem salva.', schema: MediaUrlDTO } },
    errors: [
      { code: 'BAD_REQUEST', message: 'Arquivo muito grande. Máximo 5 MB' },
      {
        code: 'VALIDATION_ERROR',
        message: 'Formato não suportado. Use JPEG, PNG ou WebP',
      },
      'STORAGE_ERROR',
    ],
  }),
  admin({
    method: 'get',
    path: '/admin/changelog/users/search',
    tags: ['Admin · Changelog'],
    summary: 'Buscar usuários para destinatários',
    description: 'Busca global por nome ou e-mail.',
    query: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Termo de busca (vazio lista os primeiros).',
        },
      },
    },
    responses: {
      200: {
        description: 'Usuários.',
        schema: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            email: z.string(),
            image: z.string().nullable(),
          }),
        ),
      },
    },
  }),
  admin({
    method: 'get',
    path: '/admin/ai',
    tags: ['Admin · Steel IA'],
    summary: 'Ajustes de IA da plataforma',
    description:
      'Margem da plataforma e o preço de cada modelo do catálogo (do provedor e cobrado, por 1M tokens).',
    responses: {
      200: { description: 'Ajustes.', schema: PlatformAiSettingsDTO },
    },
  }),
  admin({
    method: 'patch',
    path: '/admin/ai',
    tags: ['Admin · Steel IA'],
    summary: 'Alterar a margem de IA',
    description:
      'Custo de cada chamada = preço do provedor × margem, congelado no consumo. Vale para as chamadas seguintes (até 1 min para todos os processos).',
    consent: true,
    body: {
      schema: UpdatePlatformAiSettingsSchema,
      example: { costMargin: 1.3, reason: 'Cobrir impostos e infraestrutura' },
    },
    responses: {
      200: {
        description: 'Ajustes atualizados.',
        schema: PlatformAiSettingsDTO,
      },
    },
  }),
]

export function registerAdminPaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
