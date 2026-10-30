/**
 * The FLOW button of a message template (`BUTTONS` block). Pure helpers used
 * to send a Flow through a template, one by one or in a broadcast.
 */

interface RawButtonsBlock {
  type?: string
  buttons?: { type?: string; flow_id?: string | number }[]
}

export interface TemplateFlowButton {
  /** Position of the button in the BUTTONS block (the `index` of the send). */
  index: number
  /** Meta's id of the Flow the button opens, when the template names it. */
  metaFlowId: string | null
}

/** First FLOW button of the template, or null when it has none. */
export function findTemplateFlowButton(
  components: unknown,
): TemplateFlowButton | null {
  if (!Array.isArray(components)) return null
  const block = (components as RawButtonsBlock[]).find(
    (component) => component?.type === 'BUTTONS',
  )
  const buttons = Array.isArray(block?.buttons) ? block.buttons : []
  const index = buttons.findIndex((button) => button?.type === 'FLOW')
  if (index < 0) return null
  const flowId = buttons[index].flow_id
  return {
    index,
    metaFlowId:
      flowId === undefined || flowId === null || flowId === ''
        ? null
        : String(flowId),
  }
}

/**
 * The `button` component of a template send that carries the Flow token and,
 * when there is something to prefill, the first screen's data.
 */
export function buildFlowButtonComponent(input: {
  index: number
  flowToken: string
  data?: Record<string, string>
}) {
  return {
    type: 'button',
    sub_type: 'flow',
    index: String(input.index),
    parameters: [
      {
        type: 'action',
        action: {
          flow_token: input.flowToken,
          ...(input.data && Object.keys(input.data).length > 0
            ? { flow_action_data: input.data }
            : {}),
        },
      },
    ],
  }
}
