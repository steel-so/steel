import type { PlanTier } from '../schemas/plan.schema'
import type { ModuleKindSchema } from '../schemas/workspace-module-access.schema'

type ModuleKind = (typeof ModuleKindSchema)['options'][number]

/**
 * Catálogo de funcionalidades opcionais por workspace (feature flags /
 * entitlements). Diferente dos módulos (liga/desliga um módulo inteiro), uma
 * feature é uma capacidade dentro de um módulo, com um default por plano que o
 * admin global pode sobrescrever por workspace (ligar/desligar, com nota e
 * validade opcionais) — é assim que se entrega customização exclusiva de um
 * cliente sem código separado.
 *
 * Regras:
 * - A chave é `<módulo>.<capacidade>` em camelCase e nunca muda depois de
 *   publicada (overrides gravados no banco apontam para ela). Para aposentar
 *   uma feature, remova-a daqui: overrides órfãos são ignorados.
 * - `planDefaults` precisa listar os 4 planos (validado pelo tipo).
 * - O gate de verdade é no service (`assertFeature`); a UI só esconde.
 */
export interface FeatureDefinition {
  module: ModuleKind
  /** Nome curto exibido no painel admin (pt-BR). */
  label: string
  /** O que a feature libera, para o admin decidir o override. */
  description: string
  planDefaults: Record<PlanTier, boolean>
}

const ALL_PLANS_ON: Record<PlanTier, boolean> = {
  FREE: true,
  PRO: true,
  BUSINESS: true,
  ENTERPRISE: true,
}

export const FEATURE_CATALOG = {
  'crm.aiAssistant': {
    module: 'CRM',
    label: 'IA do CRM',
    description:
      'Análise de concorrentes e redação de landing pages com IA no CRM. O antigo widget de chat saiu; o assistente agora é o Steel AI.',
    // Ligado em todos os planos para não mudar o comportamento de quem já
    // usa; restringir por plano é decisão de produto (ver docs/feature-flags.md).
    planDefaults: ALL_PLANS_ON,
  },
  'crm.socialPublishing': {
    module: 'CRM',
    label: 'Publicação em redes sociais',
    description:
      'Agendar e publicar posts nas redes sociais conectadas (Facebook, Instagram, TikTok, X, LinkedIn, YouTube).',
    planDefaults: ALL_PLANS_ON,
  },
  'communication.broadcasts': {
    module: 'COMMUNICATION',
    label: 'Transmissões de WhatsApp',
    description:
      'Criar e disparar listas de transmissão (envio em massa) pelo WhatsApp.',
    planDefaults: ALL_PLANS_ON,
  },
} as const satisfies Record<string, FeatureDefinition>

export type FeatureKey = keyof typeof FEATURE_CATALOG

export const FEATURE_KEYS = Object.keys(FEATURE_CATALOG) as [
  FeatureKey,
  ...FeatureKey[],
]

export function isFeatureKey(value: string): value is FeatureKey {
  return Object.hasOwn(FEATURE_CATALOG, value)
}
