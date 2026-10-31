import type { AiActionConnector, AiActionSettings } from '@prisma/client'
import type {
  AiActionConnectorDTO,
  AiActionParamDTO,
  AiActionSettingsDTO,
  AiActionZapToolDTO,
} from '@/types/ai-action'

function paramsOf(value: unknown): AiActionParamDTO[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const { name, description, required } = item as Record<string, unknown>
    if (typeof name !== 'string') return []
    return [
      {
        name,
        description: typeof description === 'string' ? description : '',
        required: required !== false,
      },
    ]
  })
}

export function zapToolsOf(value: unknown): AiActionZapToolDTO[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const { toolName, mode } = item as Record<string, unknown>
    if (typeof toolName !== 'string') return []
    return [{ toolName, mode: mode === 'AUTO' ? 'AUTO' : 'APPROVAL' } as const]
  })
}

/** `headerNames` comes from the decrypted headers; the values never leave. */
export function toAiActionConnectorDTO(
  connector: AiActionConnector,
  headerNames: string[],
): AiActionConnectorDTO {
  return {
    id: connector.id,
    key: connector.key,
    name: connector.name,
    description: connector.description,
    kind: connector.kind,
    method: connector.method,
    urlTemplate: connector.urlTemplate,
    headerNames,
    params: paramsOf(connector.params),
    enabled: connector.enabled,
    createdAt: connector.createdAt.toISOString(),
    updatedAt: connector.updatedAt.toISOString(),
  }
}

export function toAiActionSettingsDTO(
  settings: AiActionSettings | null,
): AiActionSettingsDTO {
  return {
    enabled: settings?.enabled ?? false,
    zapTools: zapToolsOf(settings?.zapTools),
    zapActorId: settings?.zapActorId ?? null,
  }
}

export { paramsOf as connectorParamsOf }
