import { z } from 'zod'
import { PABX_RECORDING_MAX_BYTES } from '@/src/schemas/whatsapp-phone-call.schema'
import type { RouteConfig } from '../../registry'
import { CONVERSATION_PARAM, PRIVILEGED_ERRORS, permErrors } from './shared'

const TAG = 'Comunicação · Ligações' as const
const MAX_MB = Math.round(PABX_RECORDING_MAX_BYTES / (1024 * 1024))

/** Live fields of a call (the same as the conversation `/call` route). */
export const WhatsAppPhoneCallFields = {
  id: z.string(),
  conversationId: z.string(),
  userId: z.string().nullable(),
  extension: z.string().meta({ description: 'Ramal que toca primeiro.' }),
  destination: z.string().meta({
    description: 'Número discado pelo PABX (DDD + número, sem o 55).',
  }),
  status: z.enum([
    'QUEUED',
    'DIALING',
    'IN_PROGRESS',
    'COMPLETED',
    'BUSY',
    'NO_ANSWER',
    'CANCELED',
    'EXTENSION_NO_ANSWER',
    'FAILED',
  ]),
  answeredAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  createdAt: z.string(),
  recordingNotice: z.string().nullable().meta({
    description:
      'Aviso de gravação que o atendente lê ao contato (só em ligação gravada; o texto mostrado fica registrado).',
  }),
  hasRecording: z.boolean(),
  aiStatus: z
    .enum(['NONE', 'PENDING', 'PROCESSING', 'DONE', 'SKIPPED', 'FAILED'])
    .meta({
      description:
        'Transcrição + resumo: `PENDING` (na fila) → `PROCESSING` → `DONE`; `SKIPPED`/`FAILED` com o motivo em `aiSkipReason`.',
    }),
}

const PhoneCallRecordDTO = z.object({
  ...WhatsAppPhoneCallFields,
  userName: z.string().nullable(),
  contactName: z.string().nullable(),
  recording: z
    .object({
      mimeType: z.string(),
      sizeBytes: z.number().int(),
      expiresAt: z.string().nullable().meta({
        description: 'O job de retenção apaga o áudio depois desta data.',
      }),
    })
    .nullable(),
  transcript: z.string().nullable(),
  summary: z.string().nullable(),
  sentiment: z.enum(['NEGATIVE', 'NEUTRAL', 'POSITIVE']).nullable(),
  sentimentScore: z.number().nullable().meta({ description: '-1 a 1.' }),
  nextSteps: z.array(z.string()),
  aiModel: z.string().nullable(),
  aiSkipReason: z.string().nullable().meta({
    description:
      '`transcription_disabled`, `ai_disabled`, `no_transcription_provider`, `ai_quota_exceeded`, `ai_provider_unavailable`, `empty_transcript`, `no_recording`, `transcription_failed` ou `summary_failed`.',
  }),
  aiProcessedAt: z.string().nullable(),
  sdTicketId: z.string().nullable(),
  crmPersonId: z.string().nullable(),
  crmOpportunityId: z.string().nullable(),
})

const LIST_NOTE =
  'Ligações do "Ligar" (click-to-call pelo PABX), mais recentes primeiro (até 50), com gravação, transcrição, resumo, sentimento e próximos passos (ADR 0043).'

export const phoneCallRoutes: RouteConfig[] = [
  {
    method: 'post',
    path: '/pabx/calls/webhook/recording',
    tags: [TAG],
    summary: 'Gravação da ligação (PABX)',
    description: `Enviado pelo PABX ao fim de uma ligação gravada (\`MixMonitor\` + \`curl\`, ver \`docs/runbooks/pabx-call-recording.md\`). Multipart com \`token\` (o \`callback_token\` da ligação, o mesmo do webhook de status) e \`file\` (WAV, MP3 ou OGG, conferido pelos bytes, até ${MAX_MB} MB). Só aceita ligação que pediu gravação (\`gravar=1\`), não terminou sem atender e foi criada há menos de 24 h; uma gravação por ligação. Depois enfileira a transcrição e o resumo (\`phone-call-ai\`) e publica \`phone-call.updated\` no SSE.`,
    auth: 'public',
    rateLimit: 'ip',
    body: {
      contentType: 'multipart/form-data',
      schema: {
        type: 'object',
        required: ['token', 'file'],
        properties: {
          token: { type: 'string', description: 'callback_token da ligação.' },
          file: {
            type: 'string',
            format: 'binary',
            description: `Áudio da ligação (até ${MAX_MB} MB).`,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Gravação guardada.',
        schema: z.object({
          callId: z.string(),
          aiStatus: z.enum(['PENDING', 'SKIPPED']),
        }),
      },
    },
    errors: [
      { code: 'PABX_CALLBACK_INVALID', when: 'Token de callback desconhecido' },
      {
        code: 'PABX_RECORDING_NOT_ACCEPTED',
        when: 'A ligação não pediu gravação, não foi atendida ou o prazo acabou',
      },
      { code: 'PABX_RECORDING_DUPLICATE', when: 'A ligação já tem gravação' },
      {
        code: 'PABX_RECORDING_TOO_LARGE',
        when: `Arquivo acima de ${MAX_MB} MB`,
      },
      {
        code: 'PABX_RECORDING_UNSUPPORTED',
        when: 'O arquivo não é WAV, MP3 nem OGG',
      },
      'VALIDATION_ERROR',
      'STORAGE_ERROR',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/conversations/{conversationId}/calls',
    tags: [TAG],
    summary: 'Ligações da conversa',
    description: `${LIST_NOTE} Visibilidade da conversa (equipes e responsável); fora do alcance responde 404. Módulo **Comunicação** e \`conversations\` × \`VIEW\`.`,
    params: { conversationId: CONVERSATION_PARAM },
    rateLimit: false,
    responses: {
      200: { description: 'Ligações.', schema: z.array(PhoneCallRecordDTO) },
    },
    errors: [
      ...permErrors('conversations', 'VIEW'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/servicedesk/tickets/{ticketId}/calls',
    tags: [TAG],
    summary: 'Ligações do chamado',
    description: `${LIST_NOTE} Ligações feitas na conversa do WhatsApp vinculada ao chamado (o vínculo é resolvido quando a gravação é processada). Só agentes do ServiceDesk (\`sd-tickets\` × \`VIEW\`); o solicitante não ouve gravações.`,
    params: { ticketId: 'Id ou código do chamado (ex.: `INC-42`).' },
    rateLimit: false,
    responses: {
      200: { description: 'Ligações.', schema: z.array(PhoneCallRecordDTO) },
    },
    errors: [
      { code: 'FORBIDDEN', when: 'Não é membro ou sem `sd-tickets` × `VIEW`' },
      'WORKSPACE_SUSPENDED',
      'MODULE_DISABLED',
      { code: 'SD_NOT_AGENT', when: 'Solicitante (sem departamento)' },
      'SD_TICKET_NOT_FOUND',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/opportunities/{opportunityId}/calls',
    tags: [TAG],
    summary: 'Ligações da oportunidade',
    description: `${LIST_NOTE} Ligações cujo contato tem o telefone da pessoa que é o contato principal da oportunidade aberta. Módulo **CRM** e \`opportunities\` × \`VIEW\`.`,
    params: { opportunityId: 'Id da oportunidade.' },
    rateLimit: false,
    responses: {
      200: { description: 'Ligações.', schema: z.array(PhoneCallRecordDTO) },
    },
    errors: [...permErrors('opportunities', 'VIEW')],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/people/{personId}/calls',
    tags: [TAG],
    summary: 'Ligações da pessoa',
    description: `${LIST_NOTE} Ligações para um número que casa com um telefone da pessoa (DDD + 8 últimos dígitos, com ou sem o nono dígito). Módulo **CRM** e \`people\` × \`VIEW\`.`,
    params: { personId: 'Id da pessoa.' },
    rateLimit: false,
    responses: {
      200: { description: 'Ligações.', schema: z.array(PhoneCallRecordDTO) },
    },
    errors: [...permErrors('people', 'VIEW')],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/phone-calls/{callId}/recording',
    tags: [TAG],
    summary: 'Áudio da ligação',
    description:
      'Áudio da gravação para o player, com suporte a `Range` (206). Libera para quem vê qualquer registro da ligação: a conversa, o chamado vinculado (agentes) ou a pessoa/oportunidade do CRM. Ligação que o usuário não vê responde 404.',
    params: { callId: 'Id da ligação.' },
    rateLimit: false,
    headers: {
      Range: {
        description: 'Um intervalo `bytes=início-fim` (opcional).',
      },
    },
    responses: {
      200: {
        description: 'Áudio inteiro.',
        envelope: false,
        contentType: 'audio/mpeg',
        schema: { type: 'string', format: 'binary' },
      },
      206: {
        description: 'Trecho pedido em `Range`.',
        envelope: false,
        contentType: 'audio/mpeg',
        schema: { type: 'string', format: 'binary' },
      },
    },
    errors: [
      'PHONE_CALL_NOT_FOUND',
      {
        code: 'PHONE_CALL_RECORDING_NOT_FOUND',
        when: 'A ligação não tem gravação (ou ela já foi apagada pela retenção)',
      },
      'STORAGE_ERROR',
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/phone-calls/{callId}/recording',
    tags: [TAG],
    summary: 'Apagar o áudio da ligação',
    description:
      'Apaga o áudio agora (pedido LGPD); a transcrição e o resumo continuam na ligação. Auditado. Restrito a OWNER/ADMIN com o módulo **Comunicação**.',
    params: { callId: 'Id da ligação.' },
    responses: {
      200: {
        description: 'Áudio apagado.',
        schema: z.object({ deleted: z.literal(true) }),
      },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      'PHONE_CALL_RECORDING_NOT_FOUND',
      'STORAGE_ERROR',
    ],
  },
]
