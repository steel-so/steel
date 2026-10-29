import { verifySignature } from '@steel-so/sdk'
import {
  type IDataObject,
  type IHookFunctions,
  type ILoadOptionsFunctions,
  type INodePropertyOptions,
  type INodeType,
  type INodeTypeDescription,
  type IWebhookFunctions,
  type IWebhookResponseData,
  NodeConnectionTypes,
  NodeOperationError,
} from 'n8n-workflow'
import { getSteelClient, unwrap } from '../shared/steel'

/** Subscribes the endpoint to every event, present and future. */
const ALL_EVENTS = '*'

const MODULE_LABEL: Record<string, string> = {
  SERVICE_DESK: 'ServiceDesk',
  CRM: 'CRM',
  COMMUNICATION: 'Comunicação',
  AGENTS: 'Steel Agents',
  PLATFORM: 'Platform',
}

interface StaticData extends IDataObject {
  endpointId?: string
  secret?: string
}

export class SteelTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Steel Trigger',
    name: 'steelTrigger',
    icon: 'file:steel.svg',
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["events"].join(", ")}}',
    description:
      'Starts the workflow when something happens in Steel (ticket, SLA, lead, deal, WhatsApp message)',
    defaults: { name: 'Steel Trigger' },
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'steelApi', required: true }],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        path: 'webhook',
      },
    ],
    properties: [
      {
        displayName:
          'Steel only delivers webhooks to public HTTPS addresses. The credential token needs the <code>api:write</code> scope to register the webhook.',
        name: 'notice',
        type: 'notice',
        default: '',
      },
      {
        displayName: 'Events',
        name: 'events',
        type: 'multiOptions',
        typeOptions: { loadOptionsMethod: 'getEvents' },
        required: true,
        default: [ALL_EVENTS],
        description:
          'Events that start the workflow. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        options: [
          {
            displayName: 'Verify Signature',
            name: 'verifySignature',
            type: 'boolean',
            default: true,
            description:
              'Whether to reject deliveries whose Steel-Signature does not match the endpoint secret (recommended)',
          },
        ],
      },
    ],
  }

  methods = {
    loadOptions: {
      async getEvents(
        this: ILoadOptionsFunctions,
      ): Promise<INodePropertyOptions[]> {
        const client = await getSteelClient(this)
        const catalog = unwrap(this, await client.webhooks.events())
        const events = catalog
          .filter((event) => event.subscribable)
          .map((event) => ({
            name: `${MODULE_LABEL[event.module] ?? event.module}: ${event.type}`,
            value: event.type,
            description: event.description,
          }))
        return [
          {
            name: 'All Events',
            value: ALL_EVENTS,
            description: 'Includes the event types Steel adds in the future',
          },
          ...events,
        ]
      },
    },
  }

  webhookMethods = {
    default: {
      /** The endpoint recorded in static data still exists in Steel. */
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const data = this.getWorkflowStaticData('node') as StaticData
        if (!data.endpointId || !data.secret) return false
        const client = await getSteelClient(this)
        const page = unwrap(this, await client.webhooks.listEndpoints())
        const found = page.items.find((item) => item.id === data.endpointId)
        if (!found) {
          delete data.endpointId
          delete data.secret
          return false
        }
        return found.url === this.getNodeWebhookUrl('default')
      },

      async create(this: IHookFunctions): Promise<boolean> {
        const url = this.getNodeWebhookUrl('default')
        if (!url) {
          throw new NodeOperationError(
            this.getNode(),
            'n8n did not provide a webhook URL',
          )
        }
        const events = this.getNodeParameter('events', []) as string[]
        const client = await getSteelClient(this)
        const created = unwrap(
          this,
          await client.webhooks.createEndpoint({
            url,
            description:
              `n8n: ${this.getWorkflow().name ?? this.getWorkflow().id ?? 'workflow'}`.slice(
                0,
                200,
              ),
            events: (events.includes(ALL_EVENTS)
              ? [ALL_EVENTS]
              : events) as never,
            active: true,
          }),
        )
        const data = this.getWorkflowStaticData('node') as StaticData
        data.endpointId = created.endpoint.id
        data.secret = created.secret
        return true
      },

      async delete(this: IHookFunctions): Promise<boolean> {
        const data = this.getWorkflowStaticData('node') as StaticData
        if (!data.endpointId) return true
        const client = await getSteelClient(this)
        const result = await client.webhooks.deleteEndpoint(data.endpointId)
        // Already gone in Steel is the state we wanted.
        if (!result.ok && result.error.status !== 404) {
          unwrap(this, result)
        }
        delete data.endpointId
        delete data.secret
        return true
      },
    },
  }

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const request = this.getRequestObject()
    const options = this.getNodeParameter('options', {}) as IDataObject
    const data = this.getWorkflowStaticData('node') as StaticData

    if (options.verifySignature !== false) {
      const headers = this.getHeaderData()
      const raw = request.rawBody
      const valid =
        Boolean(data.secret) &&
        Buffer.isBuffer(raw) &&
        verifySignature(
          data.secret as string,
          headerValue(headers['steel-signature']),
          headerValue(headers['steel-webhook-timestamp']),
          raw.toString('utf8'),
        )
      if (!valid) {
        const response = this.getResponseObject()
        response.status(401).json({ error: 'invalid signature' })
        return { noWebhookResponse: true }
      }
    }

    const body = this.getBodyData()
    return { workflowData: [this.helpers.returnJsonArray(body)] }
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
