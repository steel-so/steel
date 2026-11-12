import { z } from 'zod'
import {
  CreateWhatsAppContactBlockSchema,
  SyncWhatsAppContactBlocksSchema,
  WhatsAppContactBlockQuerySchema,
} from '@/src/schemas/whatsapp-contact-block.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  WhatsAppContactBlockDTO,
  WhatsAppContactBlockResultDTO,
  WhatsAppContactBlockSyncDTO,
  WhatsAppContactUnblockResultDTO,
  WhatsAppConversationBlockStateDTO,
} from '../../schemas/whatsapp-contact-block'
import { permErrors } from './shared'

const TAG = 'Comunicação · Contatos' as const

/** OWNER/ADMIN of the workspace or leader of a Comunicação team. */
const MANAGERS =
  'Módulo **Comunicação** habilitado; restrito a OWNER/ADMIN e líderes de equipe.'

const MANAGER_ERRORS: ErrorEntry[] = [
  {
    code: 'FORBIDDEN',
    when: 'Não é membro, ou não é OWNER/ADMIN nem líder de equipe',
  },
  'WORKSPACE_SUSPENDED',
  'MODULE_DISABLED',
]

const INTERNAL_BLOCK =
  'O bloqueio vale no Steel na hora, qualquer que seja a resposta do provedor: mensagens do contato naquele número são descartadas antes de criar conversa, notificação, IA, chatbot ou SLA, e todo envio a ele é recusado com `WHATSAPP_CONTACT_BLOCKED` (transmissões e campanhas pulam o destinatário).'

/** Contacts blocked on a WhatsApp number (zap-block-contacts). */
export const contactBlockRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/blocks',
    tags: [TAG],
    summary: 'Contatos bloqueados',
    description: `Bloqueios de todos os números do workspace (ou de um), do mais recente ao mais antigo, com quem bloqueou, motivo, situação no provedor e quantas mensagens foram ignoradas. ${MANAGERS}`,
    query: WhatsAppContactBlockQuerySchema,
    responses: {
      200: {
        description: 'Bloqueios.',
        schema: z.array(WhatsAppContactBlockDTO),
      },
    },
    errors: MANAGER_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/blocks',
    tags: [TAG],
    summary: 'Bloquear contato',
    description: `Bloqueia o contato num número. Pela conversa (\`conversationId\`): quem pode responder a conversa (permissão \`conversations\` × \`CREATE\` e acesso a ela pelas Equipes). Por número + contato (\`connectionId\` + \`contactId\`): só OWNER/ADMIN e líderes. Z-API: bloqueio no aparelho (\`modify-blocked\`). Meta: Block Users API — a Meta só bloqueia quem escreveu nas últimas 24 h; fora disso o bloqueio fica \`PENDING\` e vai para a Meta quando a pessoa escrever de novo. Outra recusa: \`FAILED\` com o motivo. ${INTERNAL_BLOCK} Bloquear de novo devolve o bloqueio existente. Auditado (sem conteúdo de mensagem).`,
    body: CreateWhatsAppContactBlockSchema,
    responses: {
      201: {
        description: 'Contato bloqueado.',
        schema: WhatsAppContactBlockResultDTO,
      },
    },
    errors: [
      ...permErrors('conversations', 'CREATE'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
      'WHATSAPP_CONTACT_NOT_FOUND',
      'WHATSAPP_CONNECTION_NOT_FOUND',
      {
        code: 'VALIDATION_ERROR',
        when: 'Corpo inválido, motivo com mais de 500 caracteres ou número que não é do WhatsApp (chat do site)',
      },
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/whatsapp/blocks/{blockId}',
    tags: [TAG],
    summary: 'Desbloquear contato',
    description: `Desbloqueia no provedor (quando o bloqueio está lá — Meta \`DELETE block_users\`, Z-API \`action: unblock\`) e remove o bloqueio do Steel. Se o provedor recusar, o Steel desbloqueia mesmo assim e devolve \`providerWarning\`. Auditado. ${MANAGERS}`,
    params: { blockId: 'Id do bloqueio.' },
    responses: {
      200: {
        description: 'Contato desbloqueado.',
        schema: WhatsAppContactUnblockResultDTO,
      },
    },
    errors: [
      ...MANAGER_ERRORS,
      { code: 'RESOURCE_NOT_FOUND', when: 'Bloqueio não encontrado' },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/blocks/sync',
    tags: [TAG],
    summary: 'Sincronizar bloqueios com a Meta/Z-API',
    description: `Importa como \`APPLIED\` os bloqueios feitos fora do Steel (lista da Meta; a Z-API não tem endpoint que liste os bloqueados) e reenvia ao provedor os bloqueios \`PENDING\`/\`FAILED\` (até 200 por número a cada sincronização). Corpo opcional: \`connectionId\` para um número só. Auditado. ${MANAGERS}`,
    body: SyncWhatsAppContactBlocksSchema,
    responses: {
      200: {
        description: 'Resultado por número.',
        schema: WhatsAppContactBlockSyncDTO,
      },
    },
    errors: [...MANAGER_ERRORS, 'WHATSAPP_CONNECTION_NOT_FOUND'],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/conversations/{conversationId}/block',
    tags: ['Comunicação · Conversas'],
    summary: 'Bloqueio do contato da conversa',
    description:
      'Se o contato da conversa está bloqueado no número dela, e se quem pergunta pode bloquear (quem responde a conversa) ou desbloquear (OWNER/ADMIN e líderes). Uma conversa que o membro não vê responde 404.',
    params: { conversationId: 'Id da conversa.' },
    responses: {
      200: {
        description: 'Situação do bloqueio.',
        schema: WhatsAppConversationBlockStateDTO,
      },
    },
    errors: [
      ...permErrors('conversations', 'VIEW'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
      'WHATSAPP_CONNECTION_NOT_FOUND',
    ],
  },
]
