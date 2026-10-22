import { z } from 'zod'
import {
  CreateWhatsAppCloseStatusSchema,
  UpdateWhatsAppCloseStatusSchema,
} from '@/src/schemas/whatsapp-close-status.schema'
import { UpdateWhatsAppSettingsSchema } from '@/src/schemas/whatsapp-settings.schema'
import { UpdateWhatsAppUsageLimitsSchema } from '@/src/schemas/whatsapp-usage.schema'
import type { RouteConfig } from '../../registry'
import { MediaUrlDTO } from '../../schemas/core'
import {
  WhatsAppAssignableMemberDTO,
  WhatsAppBusinessHoursStatusDTO,
  WhatsAppCloseStatusDTO,
  WhatsAppCloseStatusOptionsDTO,
  WhatsAppSettingsDTO,
  WhatsAppUsageDTO,
} from '../../schemas/whatsapp'
import { PRIVILEGED, PRIVILEGED_ERRORS, perm, permErrors } from './shared'

const TAG = 'Comunicação · Configurações' as const

export const settingsRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/usage',
    tags: [TAG],
    summary: 'Consumo e limites mensais',
    description:
      'Conversas abertas/reabertas e mensagens enviadas no mês corrente (America/Sao_Paulo), com os limites mensais do workspace. Qualquer membro do workspace — todos recebem os avisos de 50%, 80% e 100% no inbox.',
    responses: {
      200: { description: 'Consumo do mês.', schema: WhatsAppUsageDTO },
    },
    errors: [
      { code: 'FORBIDDEN', when: 'Usuário não é membro do workspace' },
      'WORKSPACE_SUSPENDED',
    ],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/whatsapp/usage',
    tags: [TAG],
    summary: 'Definir limites mensais',
    description:
      'Upsert parcial (omitido = mantém; `null` = ilimitado, o padrão). Ao atingir 100%, envios (`WHATSAPP_MESSAGE_LIMIT_REACHED`) e conversas iniciadas ou reabertas pela equipe (`WHATSAPP_CONVERSATION_LIMIT_REACHED`) são recusados com 402 até virar o mês; mensagens e conversas recebidas continuam chegando. Vale só para as conexões do módulo Comunicação (não para o WhatsApp do ServiceDesk). Auditado. Restrito a OWNER/ADMIN do workspace.',
    body: UpdateWhatsAppUsageLimitsSchema,
    responses: {
      200: { description: 'Limites salvos.', schema: WhatsAppUsageDTO },
    },
    errors: [
      { code: 'FORBIDDEN', when: 'Não é membro ou não é OWNER/ADMIN' },
      'WORKSPACE_SUSPENDED',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/settings',
    tags: [TAG],
    summary: 'Configurações de atendimento',
    description: `Fechamento automático por inatividade e alerta de sentimento. Workspace que nunca salvou recebe os padrões (fechamento após 24 h). ${PRIVILEGED}`,
    responses: {
      200: { description: 'Configurações.', schema: WhatsAppSettingsDTO },
    },
    errors: PRIVILEGED_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/whatsapp/settings',
    tags: [TAG],
    summary: 'Atualizar configurações de atendimento',
    description: `Upsert parcial (omitido = mantém). Fila e distribuição (ADR 0047): \`unassignedAlertNotifyInApp\`/\`unassignedAlertNotifyEmail\` e \`unassignedReminderMinutes\` (0–1440; 0 desliga o lembrete) controlam o aviso aos supervisores de conversas sem atendente; \`distributionMode\` (\`OFF\`, \`ROUND_ROBIN\`, \`LEAST_LOADED\`), \`distributionMaxOpenPerAgent\` (1–500 ou \`null\`), \`distributionOnlyAvailable\` e \`distributionRespectBusinessHours\` controlam a entrega automática da fila. \`autoCloseAfterHours\`: 0 desliga, máximo 720 (30 dias) — o worker fecha conversas sem mensagem além dessa janela. Alerta de sentimento: quando a média da conversa cai abaixo de \`sentimentAlertThreshold\` (-1 a 0), avisa os destinatários (in-app e/ou e-mail; vazio = todos os OWNER/ADMIN), opcionalmente atribui a conversa a \`sentimentAlertAssignToId\` e respeita \`sentimentAlertCooldownHours\` (1–168) por conversa. Destinatários e supervisor precisam ser membros do workspace. Auditado. ${PRIVILEGED}`,
    body: UpdateWhatsAppSettingsSchema,
    responses: {
      200: {
        description: 'Configurações salvas.',
        schema: WhatsAppSettingsDTO,
      },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      {
        code: 'VALIDATION_ERROR',
        message:
          'Selecione apenas membros deste workspace para o alerta de sentimento',
        when: 'Destinatário ou supervisor não é membro do workspace',
      },
      {
        code: 'VALIDATION_ERROR',
        message:
          'O mínimo de status de fechamento não pode ser maior que o máximo',
        when: '`closeStatusMinSelections` acima de `closeStatusMaxSelections`',
      },
      {
        code: 'VALIDATION_ERROR',
        message:
          'O início e o fim do horário de atendimento devem ser diferentes',
        when: '`businessHoursStart` igual a `businessHoursEnd`',
      },
      {
        code: 'VALIDATION_ERROR',
        message: 'Escolha ao menos um dia de atendimento',
        when: 'Horário ligado sem nenhum dia em `businessHoursDays`',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/business-hours',
    tags: [TAG],
    summary: 'Horário de atendimento',
    description: `Janela de atendimento e se os envios estão liberados agora (\`open\`), com a próxima abertura — base do aviso na conversa. Fora do horário, envios de atendentes respondem \`WHATSAPP_OUTSIDE_BUSINESS_HOURS\`, a resposta da IA espera a abertura e o disparo automático dorme até lá. ${perm('conversations', 'VIEW')}`,
    responses: {
      200: {
        description: 'Horário de atendimento.',
        schema: WhatsAppBusinessHoursStatusDTO,
      },
    },
    errors: permErrors('conversations', 'VIEW'),
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/close-statuses',
    tags: [TAG],
    summary: 'Status de fechamento',
    description: `Opções de classificação oferecidas ao fechar uma conversa (só as ativas, na ordem de exibição) e quantas o atendente escolhe (\`minSelections\`/\`maxSelections\`, de \`PATCH .../whatsapp/settings\`). ${perm('conversations', 'VIEW')}`,
    responses: {
      200: {
        description: 'Opções e regras.',
        schema: WhatsAppCloseStatusOptionsDTO,
      },
    },
    errors: permErrors('conversations', 'VIEW'),
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/close-statuses',
    tags: [TAG],
    summary: 'Criar status de fechamento',
    description: `Cria uma opção de classificação (ex.: "Venda realizada" = \`SUCCESS\`, "Sem interesse" = \`FAILURE\`), no fim da lista. Até 50 ativos por workspace. Auditado. ${PRIVILEGED}`,
    body: CreateWhatsAppCloseStatusSchema,
    responses: {
      201: { description: 'Status criado.', schema: WhatsAppCloseStatusDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      {
        code: 'WHATSAPP_CLOSE_STATUS_LIMIT_REACHED',
        when: 'Já há 50 status ativos',
      },
    ],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/whatsapp/close-statuses/{statusId}',
    tags: [TAG],
    summary: 'Atualizar status de fechamento',
    description: `Renomeia, troca o resultado ou a posição. Conversas já fechadas guardam o rótulo antigo. Auditado. ${PRIVILEGED}`,
    params: { statusId: 'Id do status de fechamento.' },
    body: UpdateWhatsAppCloseStatusSchema,
    responses: {
      200: {
        description: 'Status atualizado.',
        schema: WhatsAppCloseStatusDTO,
      },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      {
        code: 'WHATSAPP_CLOSE_STATUS_NOT_FOUND',
        when: 'Status inexistente, arquivado ou de outro workspace',
      },
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/whatsapp/close-statuses/{statusId}',
    tags: [TAG],
    summary: 'Remover status de fechamento',
    description: `Arquiva o status: sai do diálogo de fechamento, mas o histórico das conversas continua legível. Auditado. ${PRIVILEGED}`,
    params: { statusId: 'Id do status de fechamento.' },
    responses: {
      200: {
        description: 'Status arquivado.',
        schema: z.object({ id: z.string() }),
      },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      {
        code: 'WHATSAPP_CLOSE_STATUS_NOT_FOUND',
        when: 'Status inexistente, arquivado ou de outro workspace',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/assignable-members',
    tags: [TAG],
    summary: 'Membros atribuíveis',
    description: `Membros do workspace que podem receber conversas (para \`PATCH .../conversations/{conversationId}/assign\` e o supervisor do alerta de sentimento). ${perm('conversations', 'VIEW')}`,
    responses: {
      200: {
        description: 'Membros.',
        schema: z.array(WhatsAppAssignableMemberDTO),
      },
    },
    errors: permErrors('conversations', 'VIEW'),
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/media/upload',
    tags: [TAG],
    summary: 'Enviar mídia para mensagens',
    description: `Hospeda um arquivo no MinIO (bucket \`whatsapp-media\`) e devolve a URL pública para usar em \`POST .../messages/media\`, transmissões e respostas rápidas. O corpo é o **binário cru** do arquivo (não multipart), com o \`Content-Type\` real (ex.: \`image/jpeg\`, \`application/pdf\`); máximo 16 MB, o limite do próprio WhatsApp. ${perm('conversations', 'CREATE')}`,
    rateLimit: 'upload',
    body: {
      contentType: '*/*',
      schema: { type: 'string', format: 'binary' },
      description:
        'Bytes do arquivo; o header `Content-Type` define o tipo e a extensão.',
    },
    responses: {
      201: { description: 'Arquivo hospedado.', schema: MediaUrlDTO },
    },
    errors: [
      ...permErrors('conversations', 'CREATE'),
      {
        code: 'BAD_REQUEST',
        message: 'Content-Type é obrigatório',
        when: 'Sem header `Content-Type`',
      },
      {
        code: 'BAD_REQUEST',
        message: 'Arquivo vazio',
        when: 'Corpo vazio',
      },
      {
        code: 'BAD_REQUEST',
        message: 'Arquivo muito grande. Máximo 16 MB',
        when: 'Arquivo acima de 16 MB',
      },
      { code: 'STORAGE_ERROR', when: 'Falha ao gravar no MinIO' },
    ],
  },
]
