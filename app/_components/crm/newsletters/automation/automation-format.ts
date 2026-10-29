import type {
  CrmNewsletterDelayUnitValue,
  CrmNewsletterReengagementActionValue,
} from '@/src/schemas/crm-newsletter-automation.schema'

/** Labels of the newsletter automation screens (nl2-automation). */

export const DELAY_UNIT_LABEL: Record<CrmNewsletterDelayUnitValue, string> = {
  HOURS: 'horas',
  DAYS: 'dias',
}

/** "Logo após a confirmação", "2 dias após a confirmação"… */
export function delayLabel(
  value: number,
  unit: CrmNewsletterDelayUnitValue,
): string {
  if (value === 0) return 'Logo após a confirmação'
  const noun =
    unit === 'DAYS'
      ? value === 1
        ? 'dia'
        : 'dias'
      : value === 1
        ? 'hora'
        : 'horas'
  return `${value.toLocaleString('pt-BR')} ${noun} após a confirmação`
}

export const REENGAGEMENT_ACTION_LABEL: Record<
  CrmNewsletterReengagementActionValue,
  string
> = {
  UNSUBSCRIBE: 'Descadastrar (motivo "inativo")',
  FLAG: 'Só marcar como inativo',
}

export function welcomeStepEditorHref(
  workspaceSlug: string,
  newsletterId: string,
  stepId: string,
): string {
  return `/${workspaceSlug}/crm/newsletters/${newsletterId}/welcome/${stepId}`
}

export function welcomeTabHref(
  workspaceSlug: string,
  newsletterId: string,
): string {
  return `/${workspaceSlug}/crm/newsletters/${newsletterId}?aba=boas-vindas`
}
