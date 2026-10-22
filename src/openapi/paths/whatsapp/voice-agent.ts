import { z } from 'zod'
import {
  CreateVoiceAgentRouteSchema,
  UpdateVoiceAgentRouteSchema,
  UpdateVoiceAgentSettingsSchema,
} from '@/src/schemas/voice-agent.schema'
import type { ResponseSpec, RouteConfig } from '../../registry'
import { PRIVILEGED, PRIVILEGED_ERRORS } from './shared'

const TAG = 'Comunicação · Atendente de voz' as const

function text(description: string, example: string): ResponseSpec {
  return {
    description,
    envelope: false,
    contentType: 'text/plain',
    schema: { type: 'string' },
    example,
  }
}

const VoiceAgentSettingsDTO = z.object({
  workspaceId: z.string(),
  enabled: z.boolean(),
  noticeText: z.string().nullable(),
  effectiveNotice: z.string().meta({
    description:
      'Aviso falado: o texto do workspace ou o padrão da plataforma.',
  }),
  instructions: z.string().nullable(),
  voice: z.string(),
  maxCallSeconds: z.number().int(),
  monthlyMinutesCap: z.number().int(),
  silenceTimeoutSeconds: z.number().int(),
  runAsUserId: z.string().nullable(),
  canOpenTickets: z.boolean(),
  canLookupTickets: z.boolean(),
  fallbackTarget: z.string().nullable(),
  pabxSecretConfigured: z.boolean(),
  pabxSecretHint: z.string().nullable(),
  serverReady: z.boolean().meta({
    description:
      'O servidor tem a chave da OpenAI e a porta do AudioSocket configuradas.',
  }),
})

const VoiceAgentRouteDTO = z.object({
  id: z.string(),
  kind: z.enum(['QUEUE', 'DID']),
  value: z.string(),
  label: z.string().nullable(),
  enabled: z.boolean(),
  transferTarget: z.string().nullable(),
})

const VoiceAgentUsageDTO = z.object({
  minutesUsed: z.number().int(),
  minutesCap: z.number().int(),
  calls: z.number().int(),
  periodStart: z.string(),
})

const ROUTE_ID = 'Id da fila ou do número.'
const DOC = 'ADR 0046 e `docs/runbooks/pabx-voice-agent.md`.'

export const voiceAgentRoutes: RouteConfig[] = [
  {
    method: 'post',
    path: '/pabx/voice-agent/session',
    tags: [TAG],
    summary: 'Abrir sessão do atendente de voz (PABX)',
    description: `Primeira pergunta do dialplan (\`CURL()\` do Asterisk) quando entra uma ligação numa fila ou DID: a IA pode atender? Autentica com o segredo do workspace (gerado em Comunicação › Configurações › Atendente de voz; só o SHA-256 fica gravado). Responde em texto puro \`OK:<uuid>\` — o id de uso único que o dialplan entrega ao \`AudioSocket()\` — ou \`NO:<motivo>\` (\`disabled\`, \`no_route\`, \`not_ready\`, \`no_minutes\`, \`no_quota\`, \`invalid_caller\`, \`no_connection\`), e o dialplan segue o caminho humano. Cria a ligação (\`voiceAgent\`) já com o aviso de atendimento automatizado. ${DOC}`,
    auth: 'public',
    rateLimit: 'ip',
    body: {
      contentType: 'application/x-www-form-urlencoded',
      schema: {
        type: 'object',
        required: ['workspace', 'secret', 'caller'],
        properties: {
          workspace: { type: 'string', description: 'Id do workspace.' },
          secret: { type: 'string', description: 'Segredo do PABX.' },
          caller: {
            type: 'string',
            description: 'Número de quem ligou (`CALLERID(num)`).',
          },
          queue: { type: 'string', description: 'Fila de origem.' },
          did: { type: 'string', description: 'Número discado.' },
        },
      },
    },
    responses: {
      200: text(
        'Decisão do atendente.',
        'OK:0b6f6f4e-7a1d-4a58-9a3e-6b5b2f7a9c11',
      ),
    },
    errors: [
      {
        code: 'VOICE_AGENT_SECRET_INVALID',
        when: 'Workspace ou segredo inválido',
      },
      'VALIDATION_ERROR',
    ],
  },
  {
    method: 'post',
    path: '/pabx/voice-agent/outcome',
    tags: [TAG],
    summary: 'Destino da ligação depois do atendente (PABX)',
    description: `Segunda pergunta do dialplan, quando \`AudioSocket()\` retorna: para onde vai a ligação? Responde \`TRANSFER|<ramal ou fila>\` (o contexto — resumo e chamado — já está na ligação) ou \`HANGUP\`. A transferência é sempre feita pelo Asterisk. ${DOC}`,
    auth: 'public',
    rateLimit: 'ip',
    body: {
      contentType: 'application/x-www-form-urlencoded',
      schema: {
        type: 'object',
        required: ['workspace', 'secret', 'session'],
        properties: {
          workspace: { type: 'string', description: 'Id do workspace.' },
          secret: { type: 'string', description: 'Segredo do PABX.' },
          session: {
            type: 'string',
            format: 'uuid',
            description: 'O uuid devolvido por `/pabx/voice-agent/session`.',
          },
        },
      },
    },
    responses: {
      200: text('Destino.', 'TRANSFER|200'),
    },
    errors: [
      {
        code: 'VOICE_AGENT_SECRET_INVALID',
        when: 'Workspace, segredo ou sessão inválidos',
      },
      'VALIDATION_ERROR',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/voice-agent/settings',
    tags: [TAG],
    summary: 'Configurações do atendente de voz',
    description: `Workspace que nunca salvou recebe os padrões (desligado, 5 min por ligação, 300 min por mês). ${PRIVILEGED}`,
    responses: {
      200: { description: 'Configurações.', schema: VoiceAgentSettingsDTO },
    },
    errors: PRIVILEGED_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/voice-agent/settings',
    tags: [TAG],
    summary: 'Atualizar o atendente de voz',
    description: `Upsert parcial (omitido = mantém). Ligar exige \`runAsUserId\`, um membro do workspace em nome de quem o atendente age (as permissões dele valem para as ferramentas). Auditado. ${PRIVILEGED}`,
    body: UpdateVoiceAgentSettingsSchema,
    responses: {
      200: {
        description: 'Configurações salvas.',
        schema: VoiceAgentSettingsDTO,
      },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      {
        code: 'VOICE_AGENT_NOT_READY',
        when: 'Ligar sem escolher em nome de quem o atendente age',
      },
      'VALIDATION_ERROR',
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/voice-agent/secret',
    tags: [TAG],
    summary: 'Gerar o segredo do PABX',
    description: `Gera (ou troca) o segredo que o dialplan envia ao Steel. O valor aparece **uma única vez** na resposta; o anterior deixa de valer. Auditado. ${PRIVILEGED}`,
    responses: {
      200: {
        description: 'Segredo gerado.',
        schema: z.object({
          secret: z.string(),
          hint: z.string().meta({ description: 'Últimos 4 caracteres.' }),
        }),
      },
    },
    errors: PRIVILEGED_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/voice-agent/usage',
    tags: [TAG],
    summary: 'Minutos do atendente de voz no mês',
    description: `Minutos falados pelo atendente no mês (UTC, como a cota de IA) contra o teto do workspace. O custo também aparece no uso de IA como "Atendente de voz (URA)". ${PRIVILEGED}`,
    responses: {
      200: { description: 'Uso do mês.', schema: VoiceAgentUsageDTO },
    },
    errors: PRIVILEGED_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/voice-agent/routes',
    tags: [TAG],
    summary: 'Filas e números atendidos',
    description: `Filas do PABX e números discados (DID) em que o atendente entra. ${PRIVILEGED}`,
    responses: {
      200: { description: 'Rotas.', schema: z.array(VoiceAgentRouteDTO) },
    },
    errors: PRIVILEGED_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/voice-agent/routes',
    tags: [TAG],
    summary: 'Adicionar fila ou número',
    description: `Liga o atendente a uma fila ou a um DID, com um destino humano próprio opcional. Auditado. ${PRIVILEGED}`,
    body: CreateVoiceAgentRouteSchema,
    responses: {
      201: { description: 'Rota criada.', schema: VoiceAgentRouteDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      {
        code: 'VOICE_AGENT_ROUTE_DUPLICATE',
        when: 'A fila ou o número já está cadastrado',
      },
      'VALIDATION_ERROR',
    ],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/voice-agent/routes/{routeId}',
    tags: [TAG],
    summary: 'Atualizar fila ou número',
    description: `Liga/desliga a rota e troca o nome ou o destino humano. Auditado. ${PRIVILEGED}`,
    params: { routeId: ROUTE_ID },
    body: UpdateVoiceAgentRouteSchema,
    responses: {
      200: { description: 'Rota atualizada.', schema: VoiceAgentRouteDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      'VOICE_AGENT_ROUTE_NOT_FOUND',
      'VALIDATION_ERROR',
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/voice-agent/routes/{routeId}',
    tags: [TAG],
    summary: 'Remover fila ou número',
    description: `O atendente deixa de atender essa fila ou número. Auditado. ${PRIVILEGED}`,
    params: { routeId: ROUTE_ID },
    responses: {
      200: {
        description: 'Rota removida.',
        schema: z.object({ id: z.string() }),
      },
    },
    errors: [...PRIVILEGED_ERRORS, 'VOICE_AGENT_ROUTE_NOT_FOUND'],
  },
]
