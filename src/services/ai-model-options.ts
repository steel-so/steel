import { AI_PROVIDER_LABELS } from '@/src/lib/ai/models'
import type { EffectiveAiSettings } from '@/src/mappers/ai-settings.mapper'
import { toAiModelPriceDTOs } from '@/src/mappers/platform-ai-settings.mapper'
import type { AiChatModelDTO } from '@/types/steel-ai'
import { isModelUsable } from './ai-settings.service'
import { PlatformAiSettingsService } from './platform-ai-settings.service'

/**
 * Models a user may pick on an AI surface: enabled in the workspace and
 * with a provider that has a key in this environment, priced as charged
 * (provider price × platform margin). Shared by the Steel AI model picker
 * and the site generator's "Gerar com".
 */
export async function listUsableAiModels(
  settings: EffectiveAiSettings,
): Promise<AiChatModelDTO[]> {
  const margin = await PlatformAiSettingsService.getCostMargin()
  return toAiModelPriceDTOs(margin)
    .filter((price) => isModelUsable(settings, price.key))
    .map((price) => ({
      key: price.key,
      provider: price.provider,
      providerLabel: AI_PROVIDER_LABELS[price.provider],
      label: price.label,
      inputUsdPer1M: price.chargedInputUsdPer1M,
      outputUsdPer1M: price.chargedOutputUsdPer1M,
    }))
}
