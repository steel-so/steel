import {
  BILLING_INTERVALS,
  type BillingInterval,
  PLAN_PRICES,
  type PlanPrice,
} from '@/src/config/plan-prices'
import { PlanSchema, type PlanTier } from '@/src/schemas/plan.schema'

/** Tier de plano — reusa o enum do backend (`src/schemas/plan.schema`). */
export type PlanGrid = PlanTier
export const PLAN_ORDER = PlanSchema.options

export type { PlanPrice } from '@/src/config/plan-prices'
export { PAID_PLAN_PRICES } from '@/src/config/plan-prices'

/** Cadência de cobrança — `monthly`/`yearly` (padrão do backend), via url-state `?billing=`. */
export type Billing = BillingInterval
export const BILLINGS = BILLING_INTERVALS

export interface PlanFeature {
  title: string
  description: string
}

export interface PlanCopy {
  description: string
  features: PlanFeature[]
}

const MODULES: PlanFeature = {
  title: 'ServiceDesk, CRM e Comunicação',
  description:
    'Os três módulos no mesmo workspace, habilitados por workspace pela equipe da Stratus Telecom.',
}

const STEEL_AI: PlanFeature = {
  title: 'Steel AI e Steel Agents',
  description:
    'Assistente nos três módulos, com confirmação antes de alterar dados, e agentes em segundo plano. Uso dentro da cota mensal de IA do workspace.',
}

const WORKSPACE: PlanFeature = {
  title: 'Caixa de entrada, busca e Wiki',
  description:
    'Notificações de todos os módulos, busca global com Ctrl+K e páginas colaborativas em tempo real.',
}

const INTEGRATIONS: PlanFeature = {
  title: 'Slack, GitHub e GitLab',
  description: 'Uma conexão por workspace, usada por todos os módulos.',
}

const SECURITY: PlanFeature = {
  title: 'Verificação em duas etapas e LGPD',
  description:
    'Código por e-mail ou app autenticador, auditoria, exportação completa dos dados e descadastro de marketing.',
}

/**
 * Copy of each plan on /pricing (and in the in-app upgrade screens). Today
 * the plans differ only in seats (`src/config/plans.ts`, the only enforced
 * limit); everything else is included in all of them.
 */
export const PLANS: Record<PlanGrid, PlanCopy> = {
  FREE: {
    description:
      'Para conhecer o Steel com uma equipe pequena, com todos os recursos.',
    features: [
      {
        title: 'Até 12 membros',
        description: 'Membros e convites pendentes contam como assentos.',
      },
      MODULES,
      STEEL_AI,
      WORKSPACE,
      INTEGRATIONS,
      SECURITY,
    ],
  },
  PRO: {
    description: 'Para equipes de até 12 pessoas que querem o Steel completo.',
    features: [
      {
        title: 'Até 12 membros',
        description: 'Membros e convites pendentes contam como assentos.',
      },
      MODULES,
      STEEL_AI,
      WORKSPACE,
      INTEGRATIONS,
      SECURITY,
    ],
  },
  BUSINESS: {
    description:
      'Para equipes que crescem sem limite de membros. É também o plano do período de teste: todo workspace novo começa com 14 dias de Business.',
    features: [
      {
        title: 'Membros ilimitados',
        description: 'Convide toda a empresa, sem teto de assentos.',
      },
      MODULES,
      STEEL_AI,
      WORKSPACE,
      INTEGRATIONS,
      SECURITY,
    ],
  },
  ENTERPRISE: {
    description:
      'Para operações maiores, com condições comerciais definidas com a Stratus Telecom.',
    features: [
      {
        title: 'Membros ilimitados',
        description: 'Convide toda a empresa, sem teto de assentos.',
      },
      MODULES,
      STEEL_AI,
      WORKSPACE,
      INTEGRATIONS,
      SECURITY,
    ],
  },
}

/** Formata centavos (BRL) como moeda, escondendo os `,00` quando inteiro. */
export function formatCurrency(cents: number) {
  const value = cents / 100

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/** `"FREE"` -> `"Free"`. */
export function formatPlanName(plan: PlanGrid) {
  return plan.charAt(0) + plan.slice(1).toLowerCase()
}

/** Plano anterior na hierarquia (`null` no FREE). */
export function previousPlan(plan: PlanGrid): PlanGrid | null {
  const index = PLAN_ORDER.indexOf(plan)
  return index > 0 ? PLAN_ORDER[index - 1] : null
}

/** URL de checkout/upgrade para um plano pago, com a cadência escolhida. */
export function upgradeUrl(plan: PlanGrid, billing: Billing) {
  return `/upgrade?plan=${plan}&billing=${billing}`
}

/** Preço do plano (BRL), ou `null` se não tiver preço público (Enterprise). */
export function getPrice(plan: PlanGrid): PlanPrice | null {
  return PLAN_PRICES[plan]
}

/** Preço por mês na cobrança anual, em centavos. */
export function yearlyPerMonth(price: PlanPrice) {
  return price.yearly / 12
}

/** Desconto do anual vs mensal (0..1); `0` para planos gratuitos. */
export function yearlyDiscount(price: PlanPrice) {
  if (price.monthly === 0) return 0
  return (price.monthly - yearlyPerMonth(price)) / price.monthly
}

/** Preço por mês (centavos) na cadência escolhida. */
export function priceForBilling(price: PlanPrice, billing: Billing) {
  return billing === 'yearly' ? yearlyPerMonth(price) : price.monthly
}
