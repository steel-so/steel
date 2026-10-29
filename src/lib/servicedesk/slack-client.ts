import { logger } from '@/lib/axiom/logger'
import {
  BETTER_AUTH_URL,
  SLACK_CLIENT_ID,
  SLACK_CLIENT_SECRET,
  SLACK_SIGNING_SECRET,
} from '@/lib/env/server'
import { sdIntegrationRequestFailed } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'

/**
 * Cliente mínimo da Web API do Slack usado pelo ServiceDesk. É o único ponto
 * do módulo que fala com a rede, para os testes poderem dublá-lo inteiro
 * (`vi.mock('@/src/lib/servicedesk/slack-client')`).
 *
 * Nenhuma função loga token, `code` ou segredo: só o método, o canal e o
 * motivo devolvido pelo Slack.
 */

const API = 'https://slack.com/api'

/** Credenciais do app do Slack (nível da instalação, não do workspace). */
export interface SlackAppConfig {
  clientId: string
  clientSecret: string
  signingSecret: string
  redirectUri: string
  eventsUrl: string
}

/** Caminho fixo do callback OAuth (cadastrado no painel do app). */
export const SLACK_REDIRECT_PATH = '/api/servicedesk/integrations/oauth/slack'
/** Caminho fixo do webhook (eventos, atalhos e slash commands). */
export const SLACK_EVENTS_PATH = '/api/servicedesk/integrations/slack'

/**
 * Escopos de bot pedidos no OAuth: postar no canal, ler os canais para o
 * seletor, ler a thread espelhada, receber atalho/comando e resolver o
 * usuário (incluindo o e-mail, que casa o autor com a conta do Steel).
 */
export const SLACK_BOT_SCOPES = [
  'chat:write',
  'chat:write.public',
  'channels:read',
  'groups:read',
  'channels:history',
  'groups:history',
  'commands',
  'users:read',
  'users:read.email',
  // Swarming: temporary channel per swarm (create, invite, archive).
  'channels:manage',
  'groups:write',
] as const

/**
 * `null` quando o app do Slack não está configurado no servidor — a feature
 * fica inerte e a interface explica, como a cópia offsite do backup.
 */
export function getSlackAppConfig(): SlackAppConfig | null {
  if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET || !SLACK_SIGNING_SECRET) {
    return null
  }
  const base = BETTER_AUTH_URL.replace(/\/$/, '')
  return {
    clientId: SLACK_CLIENT_ID,
    clientSecret: SLACK_CLIENT_SECRET,
    signingSecret: SLACK_SIGNING_SECRET,
    redirectUri: `${base}${SLACK_REDIRECT_PATH}`,
    eventsUrl: `${base}${SLACK_EVENTS_PATH}`,
  }
}

export function isSlackConfigured(): boolean {
  return getSlackAppConfig() !== null
}

/** URL da tela de autorização do Slack. */
export function slackAuthorizeUrl(
  config: SlackAppConfig,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    scope: SLACK_BOT_SCOPES.join(','),
    redirect_uri: config.redirectUri,
    state,
  })
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`
}

interface SlackEnvelope {
  ok?: boolean
  error?: string
}

async function call<T extends SlackEnvelope>(
  method: string,
  init: RequestInit,
): Promise<Result<T>> {
  try {
    const response = await fetch(`${API}/${method}`, init)
    const json = (await response.json().catch(() => null)) as T | null
    if (!response.ok || !json?.ok) {
      logger.warn('servicedesk.slack.request_failed', {
        method,
        status: response.status,
        reason: json?.error ?? 'unknown',
      })
      return err(
        sdIntegrationRequestFailed(
          `O Slack recusou a chamada (${json?.error ?? response.status})`,
        ),
      )
    }
    return ok(json)
  } catch {
    logger.warn('servicedesk.slack.network_error', { method })
    return err(sdIntegrationRequestFailed('O Slack não respondeu'))
  }
}

function form(body: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  }
}

function authed(token: string, body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  }
}

export interface SlackOauthResult {
  accessToken: string
  teamId: string
  teamName: string | null
  botUserId: string | null
}

export interface SlackPostedMessage {
  channel: string
  ts: string
}

export interface SlackUserProfile {
  id: string
  name: string
  email: string | null
  isBot: boolean
}

export interface SlackChannel {
  id: string
  name: string
  isPrivate: boolean
}

export const SlackClient = {
  /** Troca o `code` do OAuth pelo token do bot. */
  async exchangeCode(
    config: SlackAppConfig,
    code: string,
  ): Promise<Result<SlackOauthResult>> {
    const result = await call<
      SlackEnvelope & {
        access_token?: string
        bot_user_id?: string
        team?: { id?: string; name?: string }
      }
    >(
      'oauth.v2.access',
      form({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        code,
      }),
    )
    if (!result.ok) return result
    const token = result.value.access_token
    const teamId = result.value.team?.id
    if (!token || !teamId) {
      return err(
        sdIntegrationRequestFailed('O Slack não devolveu o token do app'),
      )
    }
    return ok({
      accessToken: token,
      teamId,
      teamName: result.value.team?.name ?? null,
      botUserId: result.value.bot_user_id ?? null,
    })
  },

  /** Mensagem no canal, ou na thread quando `threadTs` é informado. */
  async postMessage(
    token: string,
    input: { channel: string; text: string; threadTs?: string },
  ): Promise<Result<SlackPostedMessage>> {
    const result = await call<
      SlackEnvelope & { channel?: string; ts?: string }
    >(
      'chat.postMessage',
      authed(token, {
        channel: input.channel,
        text: input.text,
        ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
        unfurl_links: false,
      }),
    )
    if (!result.ok) return result
    return ok({
      channel: result.value.channel ?? input.channel,
      ts: result.value.ts ?? '',
    })
  },

  /** Usuário do Slack (nome e e-mail, para casar com a conta do Steel). */
  async getUser(
    token: string,
    userId: string,
  ): Promise<Result<SlackUserProfile>> {
    const result = await call<
      SlackEnvelope & {
        user?: {
          id?: string
          real_name?: string
          name?: string
          is_bot?: boolean
          profile?: { email?: string; real_name?: string }
        }
      }
    >('users.info', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ user: userId }).toString(),
    })
    if (!result.ok) return result
    const user = result.value.user
    return ok({
      id: user?.id ?? userId,
      name: user?.profile?.real_name ?? user?.real_name ?? user?.name ?? userId,
      email: user?.profile?.email ?? null,
      isBot: user?.is_bot === true,
    })
  },

  /** Canais que o bot pode ver (para o seletor da aba Integrações). */
  async listChannels(token: string): Promise<Result<SlackChannel[]>> {
    const result = await call<
      SlackEnvelope & {
        channels?: { id?: string; name?: string; is_private?: boolean }[]
      }
    >('conversations.list', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        types: 'public_channel,private_channel',
        exclude_archived: 'true',
        limit: '200',
      }).toString(),
    })
    if (!result.ok) return result
    const channels: SlackChannel[] = []
    for (const channel of result.value.channels ?? []) {
      if (!channel.id || !channel.name) continue
      channels.push({
        id: channel.id,
        name: channel.name,
        isPrivate: channel.is_private === true,
      })
    }
    return ok(channels.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))
  },

  /**
   * `auth.test`: confirms the bot token still works and which team it
   * belongs to ("Testar conexão" in Ajustes > Integrações).
   */
  async authTest(
    token: string,
  ): Promise<Result<{ teamId: string | null; teamName: string | null }>> {
    const result = await call<
      SlackEnvelope & { team_id?: string; team?: string }
    >('auth.test', authed(token, {}))
    if (!result.ok) return result
    return ok({
      teamId: result.value.team_id ?? null,
      teamName: result.value.team ?? null,
    })
  },

  /** Slack user id for an e-mail, or `null` when nobody has it. */
  async lookupByEmail(token: string, email: string): Promise<string | null> {
    const result = await call<SlackEnvelope & { user?: { id?: string } }>(
      'users.lookupByEmail',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ email }).toString(),
      },
    )
    return result.ok ? (result.value.user?.id ?? null) : null
  },

  /** Creates a (private) channel; the bot becomes its first member. */
  async createChannel(
    token: string,
    input: { name: string; isPrivate: boolean },
  ): Promise<Result<SlackChannel>> {
    const result = await call<
      SlackEnvelope & { channel?: { id?: string; name?: string } }
    >(
      'conversations.create',
      authed(token, { name: input.name, is_private: input.isPrivate }),
    )
    if (!result.ok) return result
    const id = result.value.channel?.id
    if (!id) {
      return err(sdIntegrationRequestFailed('O Slack não criou o canal'))
    }
    return ok({
      id,
      name: result.value.channel?.name ?? input.name,
      isPrivate: input.isPrivate,
    })
  },

  /** Adds people (Slack user ids) to a channel. */
  async inviteToChannel(
    token: string,
    input: { channel: string; userIds: string[] },
  ): Promise<Result<true>> {
    const result = await call<SlackEnvelope>(
      'conversations.invite',
      authed(token, {
        channel: input.channel,
        users: input.userIds.join(','),
      }),
    )
    return result.ok ? ok(true) : result
  },

  /** Archives the channel (the history stays readable in Slack). */
  async archiveChannel(token: string, channel: string): Promise<Result<true>> {
    const result = await call<SlackEnvelope>(
      'conversations.archive',
      authed(token, { channel }),
    )
    return result.ok ? ok(true) : result
  },

  /** Link permanente da mensagem (vai no corpo do chamado). */
  async permalink(
    token: string,
    input: { channel: string; ts: string },
  ): Promise<string | null> {
    const result = await call<SlackEnvelope & { permalink?: string }>(
      'chat.getPermalink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          channel: input.channel,
          message_ts: input.ts,
        }).toString(),
      },
    )
    return result.ok ? (result.value.permalink ?? null) : null
  },
}
