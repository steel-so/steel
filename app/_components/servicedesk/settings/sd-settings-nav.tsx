'use client'

import { ArrowLeft01Icon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  ContextHeader,
  ContextSidebar,
  NavGroup,
  NavGroupAccordion,
  NavItem,
} from '@/app/_components/navigation/sidebar-context'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SD_SETTINGS_TABS, type SdSettingsTabDefinition } from './settings-tabs'

/**
 * ServiceDesk settings navigation, living in the module context rail.
 *
 * The 24 sections used to sit in a second bar *inside* the screen: a 240px
 * rail glued to the module rail (two rails side by side on desktop) and,
 * below `md`, an extra horizontal bar right under the breadcrumb. No other
 * screen in the app does this — CRM and Comunicação put their settings
 * navigation in the module `ContextSidebar` and let the content breathe. Here
 * the module rail shows the sections while the route is
 * `/servicedesk/settings`, grouped into accordions (`NavGroupAccordion`, the
 * same device CRM uses for Marketing and Social).
 *
 * The active section stays in `?tab=` rather than a route segment: e-mails
 * already sent, an in-app notification and an OAuth redirect point at
 * `settings?tab=reports`, `?tab=whatsapp` and `?tab=integrations`.
 */

/**
 * Presentation-only grouping — the registry (`SD_SETTINGS_TABS`) stays flat
 * and in the same order, which is what the tab tests assert. A new tab nobody
 * listed here lands in "Outros" instead of vanishing.
 */
const GROUPS: { label: string; ids: string[] }[] = [
  { label: 'Geral', ids: ['general', 'departments'] },
  {
    label: 'Chamados',
    ids: [
      'flows',
      'catalog',
      'classifications',
      'priorities',
      'custom-fields',
      'templates',
      'recurring',
      'canned-responses',
    ],
  },
  {
    label: 'Atendimento',
    ids: ['sla', 'escalation', 'oncall', 'automations', 'changes'],
  },
  { label: 'Recursos', ids: ['parts', 'contracts'] },
  { label: 'Operação', ids: ['reports', 'monitoring', 'inventory', 'remote'] },
  { label: 'Canais e integrações', ids: ['mail', 'whatsapp', 'integrations'] },
  { label: 'Preferências', ids: ['notifications', 'ai'] },
]

/** Each group's tabs in registry order, plus unlisted ones under "Outros". */
export function sdSettingsNavGroups(
  tabs: SdSettingsTabDefinition[] = SD_SETTINGS_TABS,
): { label: string; tabs: SdSettingsTabDefinition[] }[] {
  const grouped = GROUPS.map((group) => ({
    label: group.label,
    tabs: tabs.filter((tab) => group.ids.includes(tab.id)),
  })).filter((group) => group.tabs.length > 0)

  const placed = new Set(GROUPS.flatMap((group) => group.ids))
  const rest = tabs.filter((tab) => !placed.has(tab.id))
  return rest.length > 0
    ? [...grouped, { label: 'Outros', tabs: rest }]
    : grouped
}

/** Section item: a real `<Link>`, marked active by `?tab=`. */
function SdSettingsNavItem({
  tab,
  base,
  active,
}: {
  tab: SdSettingsTabDefinition
  base: string
  active: boolean
}) {
  return (
    <Link href={`${base}/settings?tab=${tab.id}`} className='block'>
      <Button
        variant={active ? 'secondary' : 'ghost'}
        size='sm'
        aria-current={active ? 'page' : undefined}
        className={cn('w-full justify-start')}
      >
        <SteelIcon icon={tab.icon} strokeWidth={2} />
        {tab.label}
      </Button>
    </Link>
  )
}

export function SdSettingsNav({ base }: { base: string }) {
  const searchParams = useSearchParams()
  const requested = searchParams.get('tab')
  const activeId = (
    SD_SETTINGS_TABS.find((tab) => tab.id === requested) ?? SD_SETTINGS_TABS[0]
  ).id

  return (
    <ContextSidebar>
      <ContextHeader title='Configurações' />
      <NavGroup>
        <NavItem href={base} icon={ArrowLeft01Icon}>
          Voltar ao ServiceDesk
        </NavItem>
      </NavGroup>
      {sdSettingsNavGroups().map((group) => (
        <NavGroupAccordion
          key={group.label}
          label={group.label}
          defaultOpen={group.tabs.some((tab) => tab.id === activeId)}
        >
          {group.tabs.map((tab) => (
            <SdSettingsNavItem
              key={tab.id}
              tab={tab}
              base={base}
              active={tab.id === activeId}
            />
          ))}
        </NavGroupAccordion>
      ))}
    </ContextSidebar>
  )
}
