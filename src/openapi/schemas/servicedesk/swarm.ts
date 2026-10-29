import { z } from 'zod'
import { dto } from '../../common'
import { SdUserSummaryDTO } from '../servicedesk-tickets'

/** DTOs do swarming (`types/sd-swarm.d.ts`). */

export const SdSwarmMemberDTO = dto(
  'SdSwarmMember',
  z.object({
    user: SdUserSummaryDTO,
    status: z.enum(['INVITED', 'JOINED', 'DECLINED']),
    invitedAt: z.iso.datetime(),
    respondedAt: z.iso.datetime().nullable(),
  }),
)

export const SdSwarmDTO = dto(
  'SdSwarm',
  z.object({
    id: z.string(),
    ticketId: z.string(),
    status: z.enum(['OPEN', 'CLOSED']),
    reason: z.string().meta({ example: 'Queda intermitente do link' }),
    outcome: z.string().nullable(),
    startedBy: SdUserSummaryDTO.nullable(),
    closedBy: SdUserSummaryDTO.nullable(),
    startedAt: z.iso.datetime(),
    closedAt: z.iso.datetime().nullable(),
    members: z.array(SdSwarmMemberDTO),
    slack: z.object({
      status: z.enum(['NONE', 'ACTIVE', 'ARCHIVED', 'FAILED']).meta({
        description:
          '`FAILED` = o canal foi pedido e o Slack recusou (veja `error`).',
      }),
      channelName: z.string().nullable(),
      error: z.string().nullable(),
    }),
  }),
)

export const SdSwarmListDTO = dto(
  'SdSwarmList',
  z.object({
    items: z.array(SdSwarmDTO).meta({ description: 'Mais recentes primeiro.' }),
    slackAvailable: z.boolean().meta({
      description: 'O workspace tem o Slack conectado (oferece o canal).',
    }),
    maxMembers: z.number().int().meta({ example: 10 }),
  }),
)
