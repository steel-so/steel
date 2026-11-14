import {
  ChartHistogramIcon,
  FilterIcon,
  Route01Icon,
  SecurityLockIcon,
  Shapes01Icon,
  TargetDollarIcon,
  UserMultipleIcon,
  ViewIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { ReactNode } from 'react'
import { CrmCustomFieldsPanel } from '@/app/_components/crm/crm-custom-fields-panel'
import { CrmPipelinesPanel } from '@/app/_components/crm/crm-pipelines-panel'
import { CrmAuditLogSection } from '@/app/_components/settings/crm-audit-log-section'
import { CrmDealsSettingsSection } from '@/app/_components/settings/crm-deals-settings-section'
import { CrmLeadRulesSection } from '@/app/_components/settings/crm-lead-rules-section'
import { CrmPipelineSettingsSection } from '@/app/_components/settings/crm-pipeline-settings-section'
import { CrmPrivacySection } from '@/app/_components/settings/crm-privacy-section'
import { CrmProfilesSection } from '@/app/_components/settings/crm-profiles-section'
import { CrmRetentionSettingsSection } from '@/app/_components/settings/crm-retention-settings-section'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type IconType = Parameters<
  typeof import('@/components/icon/icon').SteelIcon
>[0]['icon']

export interface CrmSettingsSection {
  id: string
  label: string
  group: string
  icon: IconType
  description: string
  render: (workspaceId: string) => ReactNode
}

function Titled({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/**
 * CRM settings, one route per section (`/crm/settings/<id>`). Users are
 * global to the workspace (Ajustes › Membros) and external connections such
 * as social networks live in Ajustes › Integrações, so neither shows here.
 */
export const CRM_SETTINGS_SECTIONS: CrmSettingsSection[] = [
  {
    id: 'pipelines',
    label: 'Funis',
    group: 'Funil de vendas',
    icon: Route01Icon,
    description: 'Funis e etapas de leads e oportunidades.',
    render: (id) => (
      <Titled title='Funis'>
        <CrmPipelinesPanel workspaceId={id} />
      </Titled>
    ),
  },
  {
    id: 'lead-rules',
    label: 'Regras de leads',
    group: 'Funil de vendas',
    icon: FilterIcon,
    description: 'Pontuação e roteamento de leads.',
    render: (id) => <CrmLeadRulesSection workspaceId={id} />,
  },
  {
    id: 'funnel',
    label: 'Funil',
    group: 'Funil de vendas',
    icon: ChartHistogramIcon,
    description: 'Regras de passagem entre etapas do funil.',
    render: (id) => <CrmPipelineSettingsSection workspaceId={id} />,
  },
  {
    id: 'deals',
    label: 'Negócios e propostas',
    group: 'Funil de vendas',
    icon: TargetDollarIcon,
    description: 'Validade de propostas e regras de negócios.',
    render: (id) => <CrmDealsSettingsSection workspaceId={id} />,
  },
  {
    id: 'retention',
    label: 'Retenção',
    group: 'Funil de vendas',
    icon: UserMultipleIcon,
    description: 'Tarefa automática quando um cliente dá nota baixa ou esfria.',
    render: (id) => <CrmRetentionSettingsSection workspaceId={id} />,
  },
  {
    id: 'custom-fields',
    label: 'Campos customizados',
    group: 'Dados',
    icon: Shapes01Icon,
    description: 'Campos extras de leads, pessoas, empresas e oportunidades.',
    render: (id) => (
      <Titled title='Campos customizados'>
        <CrmCustomFieldsPanel workspaceId={id} />
      </Titled>
    ),
  },
  {
    id: 'profiles',
    label: 'Perfis de acesso',
    group: 'Dados',
    icon: UserMultipleIcon,
    description: 'O que cada perfil enxerga e edita no CRM.',
    render: (id) => <CrmProfilesSection workspaceId={id} />,
  },
  {
    id: 'privacy',
    label: 'Privacidade',
    group: 'Governança',
    icon: SecurityLockIcon,
    description: 'Tratamento de dados pessoais no CRM.',
    render: () => <CrmPrivacySection />,
  },
  {
    id: 'audit',
    label: 'Auditoria',
    group: 'Governança',
    icon: ViewIcon,
    description: 'Histórico de alterações do CRM.',
    render: (id) => <CrmAuditLogSection workspaceId={id} />,
  },
]
