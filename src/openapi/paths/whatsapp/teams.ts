import { z } from 'zod'
import { SetWhatsAppPresenceSchema } from '@/src/schemas/whatsapp-presence.schema'
import {
  CreateWhatsAppTeamSchema,
  UpdateWhatsAppTeamSchema,
} from '@/src/schemas/whatsapp-team.schema'
import type { RouteConfig } from '../../registry'
import {
  DeletedIdDTO,
  WhatsAppConversationScopeDTO,
  WhatsAppPresenceDTO,
  WhatsAppTeamDTO,
} from '../../schemas/whatsapp'
import { PRIVILEGED, PRIVILEGED_ERRORS, perm, permErrors } from './shared'

const TAG = 'Comunicação · Equipes' as const
const TEAM_PARAMS = { teamId: 'Id da equipe.' }

const MEMBERS_NOTE =
  'Os membros (`members`) precisam ser membros do workspace e aparecer uma vez só; quando enviados, substituem a lista inteira.'

const NOT_A_MEMBER = {
  code: 'BAD_REQUEST',
  message: 'Usuário informado não pertence a este workspace',
  when: 'Algum `userId` não é membro do workspace',
} as const

export const teamRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/teams',
    tags: [TAG],
    summary: 'Listar equipes',
    description: `Equipes do workspace por nome, com líderes e agentes. ${perm('conversations', 'VIEW')}`,
    responses: {
      200: { description: 'Equipes.', schema: z.array(WhatsAppTeamDTO) },
    },
    errors: permErrors('conversations', 'VIEW'),
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/teams',
    tags: [TAG],
    summary: 'Criar equipe',
    description: `${MEMBERS_NOTE} Auditado. ${PRIVILEGED} Líderes não editam equipes.`,
    body: CreateWhatsAppTeamSchema,
    responses: {
      201: { description: 'Equipe criada.', schema: WhatsAppTeamDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      'WHATSAPP_TEAM_CONFLICT',
      {
        code: 'VALIDATION_ERROR',
        message: 'Um membro aparece mais de uma vez na equipe',
        when: 'O mesmo `userId` repetido em `members`',
      },
      NOT_A_MEMBER,
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/teams/me',
    tags: [TAG],
    summary: 'Meu escopo de conversas',
    description: `Como o usuário vê as conversas: \`ALL\` (OWNER, ou ADMIN fora de equipe) ou \`SCOPED\`, com as equipes que lidera e das quais participa. ${perm('conversations', 'VIEW')}`,
    responses: {
      200: { description: 'Escopo.', schema: WhatsAppConversationScopeDTO },
    },
    errors: permErrors('conversations', 'VIEW'),
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/teams/{teamId}',
    tags: [TAG],
    summary: 'Ver equipe',
    description: perm('conversations', 'VIEW'),
    params: TEAM_PARAMS,
    responses: { 200: { description: 'Equipe.', schema: WhatsAppTeamDTO } },
    errors: [...permErrors('conversations', 'VIEW'), 'WHATSAPP_TEAM_NOT_FOUND'],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/whatsapp/teams/{teamId}',
    tags: [TAG],
    summary: 'Atualizar equipe',
    description: `Atualização parcial. ${MEMBERS_NOTE} Auditado. ${PRIVILEGED}`,
    params: TEAM_PARAMS,
    body: UpdateWhatsAppTeamSchema,
    responses: {
      200: { description: 'Equipe atualizada.', schema: WhatsAppTeamDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      'WHATSAPP_TEAM_NOT_FOUND',
      'WHATSAPP_TEAM_CONFLICT',
      NOT_A_MEMBER,
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/whatsapp/teams/{teamId}',
    tags: [TAG],
    summary: 'Excluir equipe',
    description: `As conversas da equipe continuam, sem equipe (voltam para a fila geral). Auditado. ${PRIVILEGED}`,
    params: TEAM_PARAMS,
    responses: {
      200: { description: 'Equipe excluída.', schema: DeletedIdDTO },
    },
    errors: [...PRIVILEGED_ERRORS, 'WHATSAPP_TEAM_NOT_FOUND'],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/presence',
    tags: [TAG],
    summary: 'Presença dos membros das equipes',
    description:
      'Disponível ou Ausente de cada pessoa que está em alguma equipe (quem nunca mexeu conta como Disponível). OWNER/ADMIN veem todas as equipes; um líder vê só os membros das equipes que lidera. Só importa para a distribuição automática da fila (ADR 0047).',
    responses: {
      200: {
        description: 'Presença dos membros.',
        schema: z.array(WhatsAppPresenceDTO),
      },
    },
    errors: [
      ...permErrors('conversations', 'VIEW'),
      {
        code: 'FORBIDDEN',
        message: 'Permissão insuficiente',
        when: 'O membro não é OWNER/ADMIN nem líder de equipe',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/presence/me',
    tags: [TAG],
    summary: 'Minha presença',
    description: `Disponível ou Ausente do usuário (Disponível enquanto nunca alterou). ${perm('conversations', 'VIEW')}`,
    responses: {
      200: { description: 'Presença do usuário.', schema: WhatsAppPresenceDTO },
    },
    errors: permErrors('conversations', 'VIEW'),
  },
  {
    method: 'put',
    path: '/workspaces/{id}/whatsapp/presence/me',
    tags: [TAG],
    summary: 'Definir minha presença',
    description: `O atendente marca-se Disponível ou Ausente; a troca é manual, nada a altera sozinho. Ausente é pulado pela distribuição automática da fila. Ao voltar a Disponível, a fila de espera é entregue (em segundo plano, em lote limitado). Auditado. ${perm('conversations', 'EDIT')}`,
    body: SetWhatsAppPresenceSchema,
    responses: {
      200: { description: 'Presença salva.', schema: WhatsAppPresenceDTO },
    },
    errors: permErrors('conversations', 'EDIT'),
  },
]
