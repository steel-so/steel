import 'server-only'
import type { WhatsAppConnection } from '@prisma/client'
import { whatsappProviderError } from '@/src/errors'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import { consume, whatsappSendLimiter } from '@/src/lib/rate-limit'
import { err, ok, type Result } from '@/src/lib/result'
import { WhatsAppCostService } from '@/src/services/whatsapp-cost.service'
import { WhatsAppUsageService } from '@/src/services/whatsapp-usage.service'
import { createMetaClient } from './meta-client'
import type {
  WhatsAppCostContext,
  WhatsAppOutboundButtons,
  WhatsAppOutboundContact,
  WhatsAppOutboundFlow,
  WhatsAppOutboundList,
  WhatsAppOutboundMedia,
  WhatsAppOutboundReaction,
  WhatsAppOutboundTemplate,
  WhatsAppOutboundText,
  WhatsAppProviderClient,
  WhatsAppSendResult,
} from './types'
import { createWidgetClient } from './widget-client'
import { createZapiClient } from './zapi-client'

async function resolveClient(
  connection: WhatsAppConnection,
): Promise<WhatsAppProviderClient> {
  if (connection.provider === 'ZAPI') {
    if (!connection.zapiInstanceId || !connection.encryptedZapiToken) {
      throw new Error('Conexão Z-API sem credenciais configuradas')
    }
    const token = await decryptConnectionSecret(connection.encryptedZapiToken)
    const clientToken = connection.encryptedZapiClientToken
      ? await decryptConnectionSecret(connection.encryptedZapiClientToken)
      : undefined
    return createZapiClient({
      instanceId: connection.zapiInstanceId,
      token,
      clientToken,
    })
  }

  if (connection.provider === 'WIDGET') return createWidgetClient()

  if (
    !connection.metaPhoneNumberId ||
    !connection.metaWabaId ||
    !connection.encryptedMetaAccessToken
  ) {
    throw new Error('Conexão Meta sem credenciais configuradas')
  }
  const accessToken = await decryptConnectionSecret(
    connection.encryptedMetaAccessToken,
  )
  return createMetaClient({
    phoneNumberId: connection.metaPhoneNumberId,
    wabaId: connection.metaWabaId,
    accessToken,
  })
}

export interface WhatsAppSendOptions {
  /**
   * Skip the monthly Comunicação message limit (not checked, not counted).
   * Only for compliance replies such as the LGPD opt-out confirmation.
   */
  unmetered?: boolean
  /**
   * Why the message is sent (broadcast, agent, AI reply...) for the cost
   * analysis. Optional: a send without it is recorded as `OTHER`.
   */
  cost?: WhatsAppCostContext
}

async function withProvider<T>(
  connection: WhatsAppConnection,
  op: (client: WhatsAppProviderClient) => Promise<T>,
  options: {
    metered: boolean
    /** Billing kind to record; omitted = nothing recorded (reactions). */
    costKind?: 'TEMPLATE' | 'SERVICE'
    to?: string
    cost?: WhatsAppCostContext
  },
): Promise<Result<T>> {
  const limit = await consume(whatsappSendLimiter, connection.id)
  if (!limit.ok) return limit

  // Monthly limits apply to the Comunicação module only (ServiceDesk
  // WhatsApp is a separate product line).
  const metered = options.metered && connection.module === 'COMMUNICATION'
  if (metered) {
    const allowed = await WhatsAppUsageService.assertCanSend(
      connection.workspaceId,
      'messages',
    )
    if (!allowed.ok) return allowed
  }

  try {
    const client = await resolveClient(connection)
    const result = await op(client)
    if (metered) {
      await WhatsAppUsageService.record(connection.workspaceId, 'messages')
    }
    if (options.costKind && options.to) {
      // Never fails the send: the cost service swallows and logs its errors.
      await WhatsAppCostService.record({
        connection,
        kind: options.costKind,
        to: options.to,
        context: options.cost,
      })
    }
    return ok(result)
  } catch (error) {
    return err(
      whatsappProviderError(
        error instanceof Error ? error.message : 'Falha ao enviar mensagem',
      ),
    )
  }
}

export const WhatsAppSend = {
  text(
    connection: WhatsAppConnection,
    input: WhatsAppOutboundText,
    options?: WhatsAppSendOptions,
  ): Promise<Result<WhatsAppSendResult>> {
    return withProvider(connection, (client) => client.sendText(input), {
      metered: !options?.unmetered,
      costKind: 'SERVICE',
      to: input.to,
      cost: options?.cost,
    })
  },

  media(
    connection: WhatsAppConnection,
    input: WhatsAppOutboundMedia,
    options?: WhatsAppSendOptions,
  ): Promise<Result<WhatsAppSendResult>> {
    return withProvider(connection, (client) => client.sendMedia(input), {
      metered: !options?.unmetered,
      costKind: 'SERVICE',
      to: input.to,
      cost: options?.cost,
    })
  },

  template(
    connection: WhatsAppConnection,
    input: WhatsAppOutboundTemplate,
    options?: WhatsAppSendOptions,
  ): Promise<Result<WhatsAppSendResult>> {
    return withProvider(connection, (client) => client.sendTemplate(input), {
      metered: !options?.unmetered,
      costKind: 'TEMPLATE',
      to: input.to,
      cost: options?.cost,
    })
  },

  contact(
    connection: WhatsAppConnection,
    input: WhatsAppOutboundContact,
    options?: WhatsAppSendOptions,
  ): Promise<Result<WhatsAppSendResult>> {
    return withProvider(connection, (client) => client.sendContact(input), {
      metered: !options?.unmetered,
      costKind: 'SERVICE',
      to: input.to,
      cost: options?.cost,
    })
  },

  buttons(
    connection: WhatsAppConnection,
    input: WhatsAppOutboundButtons,
    options?: WhatsAppSendOptions,
  ): Promise<Result<WhatsAppSendResult>> {
    return withProvider(connection, (client) => client.sendButtons(input), {
      metered: !options?.unmetered,
      costKind: 'SERVICE',
      to: input.to,
      cost: options?.cost,
    })
  },

  list(
    connection: WhatsAppConnection,
    input: WhatsAppOutboundList,
    options?: WhatsAppSendOptions,
  ): Promise<Result<WhatsAppSendResult>> {
    return withProvider(
      connection,
      (client) => {
        if (!client.sendList) {
          throw new Error(
            'Listas interativas só funcionam em conexões da API oficial da Meta',
          )
        }
        return client.sendList(input)
      },
      {
        metered: !options?.unmetered,
        costKind: 'SERVICE',
        to: input.to,
        cost: options?.cost,
      },
    )
  },

  flow(
    connection: WhatsAppConnection,
    input: WhatsAppOutboundFlow,
    options?: WhatsAppSendOptions,
  ): Promise<Result<WhatsAppSendResult>> {
    return withProvider(
      connection,
      (client) => {
        if (!client.sendFlow) {
          throw new Error(
            'WhatsApp Flows só funcionam em conexões da API oficial da Meta',
          )
        }
        return client.sendFlow(input)
      },
      {
        metered: !options?.unmetered,
        costKind: 'SERVICE',
        to: input.to,
        cost: options?.cost,
      },
    )
  },

  reaction(
    connection: WhatsAppConnection,
    input: WhatsAppOutboundReaction,
  ): Promise<Result<void>> {
    // Reactions are not messages: never metered.
    return withProvider(connection, (client) => client.sendReaction(input), {
      metered: false,
    })
  },
}
