'use client'

import { FileAddIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useParams, useRouter } from 'next/navigation'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import { useCreateOpportunityProposal } from '@/src/hooks/use-crm-deals'

/**
 * "Gerar proposta" de uma oportunidade (ou da oportunidade de renovação):
 * cria a proposta em CRM > Documentos, com os itens da oportunidade na
 * tabela de preços, e abre o editor (ADR 0063).
 */
export function OpportunityProposalButton({
  workspaceId,
  opportunityId,
  label = 'Gerar proposta',
  variant = 'outline',
}: {
  workspaceId: string
  opportunityId: string
  label?: string
  variant?: 'outline' | 'ghost' | 'default'
}) {
  const params = useParams<{ 'workspace-slug'?: string }>()
  const slug = params?.['workspace-slug'] ?? ''
  const router = useRouter()
  const canCreate = useCan('documents', 'CREATE')
  const create = useCreateOpportunityProposal(workspaceId)

  if (!canCreate) return null

  async function handleClick() {
    try {
      const doc = await create.mutateAsync({ opportunityId })
      notify.success('Proposta criada')
      router.push(`/${slug}${doc.path}/edit`)
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <Button
      type='button'
      size='sm'
      variant={variant}
      disabled={create.isPending}
      onClick={handleClick}
    >
      <SteelIcon icon={FileAddIcon} strokeWidth={2} />
      {create.isPending ? 'Gerando…' : label}
    </Button>
  )
}
