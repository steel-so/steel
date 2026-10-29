import type { SdSwarmRow } from '@/src/repositories/sd-swarm.repository'
import type {
  SdSwarmDTO,
  SdSwarmMemberDTO,
  SdSwarmSlackStatusDTO,
} from '@/types/sd-swarm'

function slackStatus(row: SdSwarmRow): SdSwarmSlackStatusDTO {
  if (row.slackChannelId) return row.slackArchivedAt ? 'ARCHIVED' : 'ACTIVE'
  return row.slackError ? 'FAILED' : 'NONE'
}

function toMemberDTO(m: SdSwarmRow['members'][number]): SdSwarmMemberDTO {
  return {
    user: m.user,
    status: m.status,
    invitedAt: m.invitedAt.toISOString(),
    respondedAt: m.respondedAt?.toISOString() ?? null,
  }
}

export function toSdSwarmDTO(row: SdSwarmRow): SdSwarmDTO {
  return {
    id: row.id,
    ticketId: row.ticketId,
    status: row.status,
    reason: row.reason,
    outcome: row.outcome,
    startedBy: row.startedBy,
    closedBy: row.closedBy,
    startedAt: row.startedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    members: row.members.map(toMemberDTO),
    slack: {
      status: slackStatus(row),
      channelName: row.slackChannelName,
      error: row.slackError,
    },
  }
}
