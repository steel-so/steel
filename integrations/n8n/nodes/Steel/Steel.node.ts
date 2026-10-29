import {
  type IDataObject,
  type IExecuteFunctions,
  type ILoadOptionsFunctions,
  type INodeExecutionData,
  type INodePropertyOptions,
  type INodeType,
  type INodeTypeDescription,
  NodeConnectionTypes,
  NodeOperationError,
} from 'n8n-workflow'
import { getSteelClient, unwrap } from '../shared/steel'
import { operationProperties } from './descriptions'
import { HANDLERS } from './operations'

export class Steel implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Steel',
    name: 'steel',
    icon: 'file:steel.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description:
      'Work with tickets (ServiceDesk), leads and opportunities (CRM) and WhatsApp templates in Steel',
    defaults: { name: 'Steel' },
    usableAsTool: true,
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'steelApi', required: true }],
    properties: operationProperties,
  }

  methods = {
    loadOptions: {
      /** Active phases of every ticket type, labelled with their type. */
      async getPhases(
        this: ILoadOptionsFunctions,
      ): Promise<INodePropertyOptions[]> {
        const client = await getSteelClient(this)
        const page = unwrap(
          this,
          await client.servicedesk.phases({ limit: 100 }),
        )
        return page.items.map((phase) => ({
          name: `${phase.name} (${phase.ticketType})`,
          value: phase.id,
        }))
      },
      async getPipelines(
        this: ILoadOptionsFunctions,
      ): Promise<INodePropertyOptions[]> {
        const client = await getSteelClient(this)
        const page = unwrap(this, await client.crm.pipelines({ limit: 100 }))
        return page.items.map((pipeline) => ({
          name: pipeline.name,
          value: pipeline.id,
        }))
      },
      /** Stages of the chosen pipeline (or of every pipeline when none). */
      async getStages(
        this: ILoadOptionsFunctions,
      ): Promise<INodePropertyOptions[]> {
        const client = await getSteelClient(this)
        const selected = this.getCurrentNodeParameter('pipelineId') as
          | string
          | undefined
        const page = unwrap(this, await client.crm.pipelines({ limit: 100 }))
        return page.items
          .filter((pipeline) => !selected || pipeline.id === selected)
          .flatMap((pipeline) =>
            (pipeline.stages ?? []).map((stage) => ({
              name: selected ? stage.name : `${pipeline.name} › ${stage.name}`,
              value: stage.id,
            })),
          )
      },
    },
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData()
    const client = await getSteelClient(this)
    const out: INodeExecutionData[] = []

    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter('resource', i) as string
        const operation = this.getNodeParameter(
          'operation',
          i,
          'request',
        ) as string
        const handler =
          HANDLERS[resource]?.[operation] ?? HANDLERS[resource]?.['*']
        if (!handler) {
          throw new NodeOperationError(
            this.getNode(),
            `The operation "${operation}" is not supported for "${resource}"`,
            { itemIndex: i },
          )
        }
        const result = await handler(this, client, i)
        const rows = Array.isArray(result) ? result : [result]
        out.push(
          ...this.helpers.constructExecutionMetaData(
            this.helpers.returnJsonArray(rows as IDataObject[]),
            { itemData: { item: i } },
          ),
        )
      } catch (error) {
        if (this.continueOnFail()) {
          out.push({
            json: { error: (error as Error).message },
            pairedItem: { item: i },
          })
          continue
        }
        throw error
      }
    }
    return [out]
  }
}
