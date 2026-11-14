'use client'

import { OnboardingChecklist } from '@/app/_components/onboarding-checklist/onboarding-checklist'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'

/** First steps of the CRM, shown while the workspace has no leads yet. */
export function CrmOnboardingChecklist({
  workspaceId,
  slug,
  hasLeads,
}: {
  workspaceId: string
  slug: string
  hasLeads: boolean
}) {
  const pipelines = useCrmResourceList<unknown>(workspaceId, 'pipelines')
  const people = useCrmResourceList<unknown>(workspaceId, 'people')
  const connections = useWhatsAppConnections(workspaceId)

  return (
    <OnboardingChecklist
      title='Primeiros passos no CRM'
      description='Siga estes passos na ordem para começar a vender com o Steel.'
      items={[
        {
          key: 'pipeline',
          title: 'Montar o funil de vendas',
          description:
            'As etapas pelas quais cada oportunidade passa, de “novo” até “ganho”.',
          href: `/${slug}/crm/pipelines`,
          actionLabel: 'Abrir funis',
          done: pipelines.items.length > 0,
          loading: pipelines.isLoading,
        },
        {
          key: 'people',
          title: 'Cadastrar seus contatos',
          description: 'Clientes e pessoas com quem você já fala.',
          href: `/${slug}/crm/people`,
          actionLabel: 'Abrir pessoas',
          done: people.items.length > 0,
          loading: people.isLoading,
        },
        {
          key: 'lead',
          title: 'Cadastrar o primeiro lead',
          description: 'Alguém que demonstrou interesse e ainda não comprou.',
          href: `/${slug}/crm/leads`,
          actionLabel: 'Novo lead',
          done: hasLeads,
        },
        {
          key: 'whatsapp',
          title: 'Conectar um número de WhatsApp',
          description:
            'Para conversar com leads sem sair do Steel. Só administradores conectam.',
          href: `/${slug}/settings/whatsapp`,
          actionLabel: 'Conectar',
          done: (connections.data?.length ?? 0) > 0,
          loading: connections.isLoading,
        },
      ]}
    />
  )
}
