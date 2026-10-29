import { logger } from '@/lib/axiom/logger'
import { sdIntegrationNotConfigured } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { SlackClient } from '@/src/lib/servicedesk/slack-client'
import { sdSwarmChannelName } from '@/src/lib/servicedesk/swarm'
import { WorkspaceIntegrationRepository } from '@/src/repositories/workspace-integration.repository'
import { decryptSdIntegrationToken } from './sd-integration-credentials'

/**
 * The Slack side of a swarm: a temporary private channel opened with the
 * specialists and archived when the swarm closes. Everything here is best
 * effort for the caller (a Slack failure never blocks the swarm): each
 * function returns a `Result` and the swarm service decides what to keep.
 */

interface SlackSession {
  token: string
}

async function session(workspaceId: string): Promise<Result<SlackSession>> {
  const found = await WorkspaceIntegrationRepository.findByKind(
    workspaceId,
    'SLACK',
  )
  if (!found.ok) return found
  const integration = found.value
  if (!integration || integration.status === 'DISCONNECTED') {
    return err(
      sdIntegrationNotConfigured(
        'Conecte o Slack em Ajustes > Integrações para abrir o canal',
      ),
    )
  }
  const token = await decryptSdIntegrationToken(integration)
  if (!token.ok) return token
  return ok({ token: token.value })
}

/** Slack user ids for the e-mails that have an account there. */
async function slackUserIds(
  token: string,
  emails: string[],
): Promise<string[]> {
  const ids = await Promise.all(
    emails.map((email) => SlackClient.lookupByEmail(token, email)),
  )
  return ids.filter((id): id is string => id !== null)
}

export interface SdSwarmChannelInput {
  workspaceId: string
  ticketCode: string
  ticketTitle: string
  ticketUrl: string
  reason: string
  emails: string[]
}

export interface SdSwarmChannel {
  channelId: string
  channelName: string
}

function nameTaken(message: string): boolean {
  return message.includes('name_taken')
}

export const SdSwarmSlack = {
  /** Creates the channel, invites who has a Slack account and says why. */
  async open(input: SdSwarmChannelInput): Promise<Result<SdSwarmChannel>> {
    const slack = await session(input.workspaceId)
    if (!slack.ok) return slack
    const { token } = slack.value

    let created = await SlackClient.createChannel(token, {
      name: sdSwarmChannelName(input.ticketCode),
      isPrivate: true,
    })
    if (!created.ok && nameTaken(created.error.message)) {
      created = await SlackClient.createChannel(token, {
        name: sdSwarmChannelName(
          input.ticketCode,
          Math.random().toString(36).slice(2, 6),
        ),
        isPrivate: true,
      })
    }
    if (!created.ok) return created
    const channel = created.value

    const userIds = await slackUserIds(token, input.emails)
    if (userIds.length > 0) {
      const invited = await SlackClient.inviteToChannel(token, {
        channel: channel.id,
        userIds,
      })
      if (!invited.ok) {
        logger.warn('servicedesk.swarm.slack_invite_failed', {
          workspaceId: input.workspaceId,
          reason: invited.error.code,
        })
      }
    }
    const posted = await SlackClient.postMessage(token, {
      channel: channel.id,
      text: `*Swarming em ${input.ticketCode}* — ${input.ticketTitle}\n${input.reason}\n<${input.ticketUrl}|Abrir o chamado no Steel>`,
    })
    if (!posted.ok) {
      logger.warn('servicedesk.swarm.slack_post_failed', {
        workspaceId: input.workspaceId,
        reason: posted.error.code,
      })
    }
    return ok({ channelId: channel.id, channelName: channel.name })
  },

  /** Brings late invitees into the existing channel. */
  async invite(
    workspaceId: string,
    channelId: string,
    emails: string[],
  ): Promise<Result<number>> {
    const slack = await session(workspaceId)
    if (!slack.ok) return slack
    const { token } = slack.value
    const userIds = await slackUserIds(token, emails)
    if (userIds.length === 0) return ok(0)
    const invited = await SlackClient.inviteToChannel(token, {
      channel: channelId,
      userIds,
    })
    if (!invited.ok) return invited
    return ok(userIds.length)
  },

  /** Posts the outcome and archives. `true` when the channel is archived. */
  async close(
    workspaceId: string,
    channelId: string,
    outcome: string | null,
  ): Promise<boolean> {
    const slack = await session(workspaceId)
    if (!slack.ok) return false
    const { token } = slack.value
    await SlackClient.postMessage(token, {
      channel: channelId,
      text: `*Swarming encerrado.* ${outcome ?? 'Sem resumo registrado.'}`,
    })
    const archived = await SlackClient.archiveChannel(token, channelId)
    if (!archived.ok) {
      logger.warn('servicedesk.swarm.slack_archive_failed', {
        workspaceId,
        reason: archived.error.code,
      })
    }
    return archived.ok
  },

  /** Is there a live Slack connection to offer the channel? */
  async available(workspaceId: string): Promise<boolean> {
    const found = await WorkspaceIntegrationRepository.findByKind(
      workspaceId,
      'SLACK',
    )
    return (
      found.ok && found.value !== null && found.value.status !== 'DISCONNECTED'
    )
  },
}
