'use client'

import { useParams } from 'next/navigation'
import { OnboardingChecklist } from '@/app/_components/onboarding-checklist/onboarding-checklist'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import { useWhatsAppContacts } from '@/src/hooks/use-whatsapp-contacts'
import { useWhatsAppTemplates } from '@/src/hooks/use-whatsapp-templates'

/** First steps of Comunicação, shown in the empty conversation pane. */
export function ZapOnboardingChecklist({
  workspaceId,
}: {
  workspaceId: string
}) {
  const params = useParams<{ 'workspace-slug': string }>()
  const slug = params['workspace-slug']
  const connections = useWhatsAppConnections(workspaceId)
  const contacts = useWhatsAppContacts(workspaceId)
  const templates = useWhatsAppTemplates(workspaceId)

  if (!slug) return null

  return (
    <OnboardingChecklist
      title='Primeiros passos no WhatsApp'
      description='Faltam poucos passos para atender seus clientes por aqui.'
      items={[
        {
          key: 'connection',
          title: 'Conectar um número de WhatsApp',
          description:
            'Sem um número conectado não dá para enviar nem receber mensagens. Só administradores conectam.',
          href: `/${slug}/settings/whatsapp`,
          actionLabel: 'Conectar',
          done: (connections.data?.length ?? 0) > 0,
          loading: connections.isLoading,
        },
        {
          key: 'contacts',
          title: 'Cadastrar ou importar contatos',
          description: 'Quem você quer atender ou avisar.',
          href: `/${slug}/zap/contatos`,
          actionLabel: 'Abrir contatos',
          done: (contacts.data?.length ?? 0) > 0,
          loading: contacts.isLoading,
        },
        {
          key: 'template',
          title: 'Criar um modelo de mensagem',
          description:
            'Modelos aprovados permitem iniciar conversas depois de 24 horas sem resposta.',
          href: `/${slug}/zap/templates`,
          actionLabel: 'Criar modelo',
          done: (templates.data?.length ?? 0) > 0,
          loading: templates.isLoading,
        },
      ]}
    />
  )
}
