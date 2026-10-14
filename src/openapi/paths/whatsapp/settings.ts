import { z } from 'zod'
import { UpdateWhatsAppSettingsSchema } from '@/src/schemas/whatsapp-settings.schema'
import { UpdateWhatsAppUsageLimitsSchema } from '@/src/schemas/whatsapp-usage.schema'
import type { RouteConfig } from '../../registry'
import { MediaUrlDTO } from '../../schemas/core'
import {
  WhatsAppAssignableMemberDTO,
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
    description: `Upsert parcial (omitido = mantém). \`autoCloseAfterHours\`: 0 desliga, máximo 720 (30 dias) — o worker fecha conversas sem mensagem além dessa janela. Alerta de sentimento: quando a média da conversa cai abaixo de \`sentimentAlertThreshold\` (-1 a 0), avisa os destinatários (in-app e/ou e-mail; vazio = todos os OWNER/ADMIN), opcionalmente atribui a conversa a \`sentimentAlertAssignToId\` e respeita \`sentimentAlertCooldownHours\` (1–168) por conversa. Destinatários e supervisor precisam ser membros do workspace. Auditado. ${PRIVILEGED}`,
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
