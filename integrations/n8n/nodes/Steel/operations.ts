import type { SteelClient } from '@steel-so/sdk'
import {
  type IDataObject,
  type IExecuteFunctions,
  NodeOperationError,
} from 'n8n-workflow'
import { collectPages, splitList, unwrap } from '../shared/steel'

export type OperationResult = IDataObject | IDataObject[]

type Handler = (
  ctx: IExecuteFunctions,
  client: SteelClient,
  i: number,
) => Promise<OperationResult>

/** Drops `''`, `undefined` and empty arrays so the API applies its defaults. */
export function compact(input: IDataObject): IDataObject {
  const out: IDataObject = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    out[key] = value
  }
  return out
}

function paging(ctx: IExecuteFunctions, i: number) {
  const returnAll = ctx.getNodeParameter('returnAll', i, false) as boolean
  const limit = returnAll ? 0 : (ctx.getNodeParameter('limit', i, 50) as number)
  return { returnAll, limit }
}

function filters(ctx: IExecuteFunctions, i: number): IDataObject {
  return ctx.getNodeParameter('filters', i, {}) as IDataObject
}

/** Parses a JSON parameter (string from the editor, or an object already). */
function parseJsonValue(
  ctx: IExecuteFunctions,
  i: number,
  label: string,
  raw: unknown,
): unknown {
  if (typeof raw !== 'string') return raw
  if (raw.trim() === '') return undefined
  try {
    return JSON.parse(raw)
  } catch {
    throw new NodeOperationError(
      ctx.getNode(),
      `"${label}" is not valid JSON`,
      {
        itemIndex: i,
      },
    )
  }
}

/* --------------------------------- ticket --------------------------------- */

const TICKET_LIST_ARRAYS = [
  'status',
  'type',
  'phaseId',
  'priorityId',
  'assigneeId',
]

const ticketHandlers: Record<string, Handler> = {
  async create(ctx, client, i) {
    const extra = compact(
      ctx.getNodeParameter('additionalFields', i, {}) as IDataObject,
    )
    if (typeof extra.tags === 'string') extra.tags = splitList(extra.tags)
    const body = {
      ...extra,
      type: ctx.getNodeParameter('ticketType', i) as string,
      title: ctx.getNodeParameter('title', i) as string,
      channel: 'API',
      ...compact({
        description: ctx.getNodeParameter('description', i, '') as string,
      }),
    }
    return unwrap(
      ctx,
      await client.servicedesk.tickets.create(body as never),
      i,
    ) as unknown as IDataObject
  },
  async get(ctx, client, i) {
    const ticketId = ctx.getNodeParameter('ticketId', i) as string
    return unwrap(
      ctx,
      await client.servicedesk.tickets.get(ticketId),
      i,
    ) as unknown as IDataObject
  },
  async getAll(ctx, client, i) {
    const f = compact(filters(ctx, i))
    for (const key of TICKET_LIST_ARRAYS) {
      if (typeof f[key] === 'string') f[key] = splitList(f[key])
    }
    const items = await collectPages(
      ctx,
      (cursor, limit) =>
        client.servicedesk.tickets.list({
          ...f,
          limit,
          ...(cursor ? { cursor } : {}),
        } as never),
      paging(ctx, i),
      i,
    )
    return items as unknown as IDataObject[]
  },
  async comment(ctx, client, i) {
    return unwrap(
      ctx,
      await client.servicedesk.tickets.comment(
        ctx.getNodeParameter('ticketId', i) as string,
        {
          body: ctx.getNodeParameter('commentBody', i) as string,
          visibility: ctx.getNodeParameter('visibility', i, 'PUBLIC') as
            | 'PUBLIC'
            | 'INTERNAL',
        },
      ),
      i,
    ) as unknown as IDataObject
  },
  async changePhase(ctx, client, i) {
    const options = compact(
      ctx.getNodeParameter('phaseOptions', i, {}) as IDataObject,
    )
    return unwrap(
      ctx,
      await client.servicedesk.tickets.move(
        ctx.getNodeParameter('ticketId', i) as string,
        {
          ...options,
          phaseId: ctx.getNodeParameter('phaseId', i) as string,
        },
      ),
      i,
    ) as unknown as IDataObject
  },
}

/* ---------------------------------- lead ---------------------------------- */

const leadHandlers: Record<string, Handler> = {
  async create(ctx, client, i) {
    const extra = compact(
      ctx.getNodeParameter('additionalFields', i, {}) as IDataObject,
    )
    if (typeof extra.emails === 'string') extra.emails = splitList(extra.emails)
    if (typeof extra.phones === 'string') extra.phones = splitList(extra.phones)
    return unwrap(
      ctx,
      await client.crm.leads.create({
        ...extra,
        name: ctx.getNodeParameter('name', i) as string,
        source: ctx.getNodeParameter('source', i) as string,
      } as never),
      i,
    ) as unknown as IDataObject
  },
  async getAll(ctx, client, i) {
    const f = compact(filters(ctx, i))
    return (await collectPages(
      ctx,
      (cursor, limit) =>
        client.crm.leads.list({
          ...f,
          limit,
          ...(cursor ? { cursor } : {}),
        } as never),
      paging(ctx, i),
      i,
    )) as unknown as IDataObject[]
  },
}

/* ------------------------------- opportunity ------------------------------ */

const opportunityHandlers: Record<string, Handler> = {
  async getAll(ctx, client, i) {
    const f = compact(filters(ctx, i))
    return (await collectPages(
      ctx,
      (cursor, limit) =>
        client.crm.opportunities.list({
          ...f,
          limit,
          ...(cursor ? { cursor } : {}),
        } as never),
      paging(ctx, i),
      i,
    )) as unknown as IDataObject[]
  },
  async moveStage(ctx, client, i) {
    const pipelineId = ctx.getNodeParameter('pipelineId', i, '') as string
    return unwrap(
      ctx,
      await client.crm.opportunities.move(
        ctx.getNodeParameter('opportunityId', i) as string,
        {
          stageId: ctx.getNodeParameter('stageId', i) as string,
          ...(pipelineId ? { pipelineId } : {}),
        },
      ),
      i,
    ) as unknown as IDataObject
  },
}

/* --------------------------------- whatsapp -------------------------------- */

const templateHandlers: Record<string, Handler> = {
  async getAll(ctx, client, i) {
    const f = compact(filters(ctx, i))
    return (await collectPages(
      ctx,
      (cursor, limit) =>
        client.whatsapp.templates({
          ...f,
          limit,
          ...(cursor ? { cursor } : {}),
        } as never),
      paging(ctx, i),
      i,
    )) as unknown as IDataObject[]
  },
  async send(ctx, client, i) {
    const recipientType = ctx.getNodeParameter('recipientType', i, 'to') as
      | 'to'
      | 'conversationId'
      | 'contactId'
    const options = ctx.getNodeParameter('sendOptions', i, {}) as IDataObject
    const components = parseJsonValue(ctx, i, 'Components', options.components)
    if (components !== undefined && !Array.isArray(components)) {
      throw new NodeOperationError(
        ctx.getNode(),
        '"Components" must be a JSON array',
        { itemIndex: i },
      )
    }
    const body = compact({
      [recipientType]: ctx.getNodeParameter(recipientType, i) as string,
      connectionId: options.connectionId as string | undefined,
      templateName: ctx.getNodeParameter('templateName', i) as string,
      language: ctx.getNodeParameter('language', i) as string,
      components:
        Array.isArray(components) && components.length > 0
          ? (components as IDataObject[])
          : undefined,
    })
    return unwrap(
      ctx,
      await client.whatsapp.sendTemplate(body as never),
      i,
    ) as unknown as IDataObject
  },
}

const conversationHandlers: Record<string, Handler> = {
  async getWaiting(ctx, client, i) {
    const f = compact(filters(ctx, i))
    return (await collectPages(
      ctx,
      (cursor, limit) =>
        client.whatsapp.conversations.waiting({
          ...f,
          limit,
          ...(cursor ? { cursor } : {}),
        } as never),
      paging(ctx, i),
      i,
    )) as unknown as IDataObject[]
  },
}

/* -------------------------------- custom call ------------------------------ */

const apiCallHandlers: Record<string, Handler> = {
  async request(ctx, client, i) {
    const method = ctx.getNodeParameter('method', i, 'GET') as string
    const path = (ctx.getNodeParameter('path', i) as string).trim()
    if (!path.startsWith('/api/v1/') || path.includes('..')) {
      throw new NodeOperationError(
        ctx.getNode(),
        'The path must start with /api/v1/',
        { itemIndex: i },
      )
    }
    const query = parseJsonValue(
      ctx,
      i,
      'Query',
      ctx.getNodeParameter('query', i, ''),
    ) as Record<string, string | string[]> | undefined
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(method)
    const body = hasBody
      ? parseJsonValue(ctx, i, 'Body', ctx.getNodeParameter('body', i, ''))
      : undefined
    const response = unwrap(
      ctx,
      await client.request({
        method,
        path,
        ...(query && Object.keys(query).length > 0 ? { query } : {}),
        ...(body !== undefined ? { body } : {}),
      }),
      i,
    )
    if (!response.ok) {
      throw new NodeOperationError(
        ctx.getNode(),
        `Steel answered ${response.status}`,
        { itemIndex: i, description: JSON.stringify(response.body) },
      )
    }
    const payload = response.body as IDataObject | string | null
    if (payload !== null && typeof payload === 'object') return payload
    return { statusCode: response.status, body: payload }
  },
}

export const HANDLERS: Record<string, Record<string, Handler>> = {
  ticket: ticketHandlers,
  lead: leadHandlers,
  opportunity: opportunityHandlers,
  template: templateHandlers,
  conversation: conversationHandlers,
  apiCall: { ...apiCallHandlers, '*': apiCallHandlers.request as Handler },
}
