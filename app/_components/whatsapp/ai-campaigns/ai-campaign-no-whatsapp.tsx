'use client'

import { useState } from 'react'
import { WhatsappNumberValidationDialog } from '@/app/_components/whatsapp/number-validation/whatsapp-number-validation-dialog'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import { useUpdateWhatsAppAiCampaign } from '@/src/hooks/use-whatsapp-ai-campaigns'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import type { WhatsAppAiCampaignDTO } from '@/types/whatsapp-ai-campaign'

/**
 * Checagem "tem zap?" da campanha: botão "Validar contatos" e o interruptor
 * "Pular números sem WhatsApp" (só pula quem já foi verificado sem WhatsApp).
 */
export function AiCampaignNoWhatsapp({
  workspaceId,
  campaign,
}: {
  workspaceId: string
  campaign: WhatsAppAiCampaignDTO
}) {
  const canEdit = useCan('broadcasts', 'EDIT')
  const canValidate = useCan('contacts', 'EDIT')
  const connections = useWhatsAppConnections(workspaceId)
  const update = useUpdateWhatsAppAiCampaign(workspaceId, campaign.id)
  const [validateOpen, setValidateOpen] = useState(false)

  const hasZapi = (connections.data ?? []).some(
    (connection) => connection.provider === 'ZAPI',
  )

  return (
    <div className='space-y-2 border-t pt-3'>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <Label htmlFor='campaignSkipNoWhatsapp'>
            Pular números sem WhatsApp
          </Label>
          <p className='text-muted-foreground text-xs'>
            {hasZapi || connections.data === undefined
              ? 'Pula quem a checagem marcou sem WhatsApp; quem não foi verificado recebe normalmente.'
              : 'Disponível só com uma conexão Z-API (a API oficial da Meta não oferece a checagem).'}
          </p>
        </div>
        <Switch
          id='campaignSkipNoWhatsapp'
          checked={campaign.skipNoWhatsapp}
          disabled={!canEdit || update.isPending || !hasZapi}
          onCheckedChange={(checked) =>
            update.mutate(
              { skipNoWhatsapp: checked },
              {
                onError: (error) =>
                  notify.error(error, 'Não foi possível salvar'),
              },
            )
          }
        />
      </div>
      {canValidate && campaign.stats.total > 0 ? (
        <Button
          size='xs'
          variant='outline'
          onClick={() => setValidateOpen(true)}
        >
          Validar contatos
        </Button>
      ) : null}
      {validateOpen ? (
        <WhatsappNumberValidationDialog
          workspaceId={workspaceId}
          open
          onOpenChange={(open) => {
            if (!open) setValidateOpen(false)
          }}
          source={{ scope: 'AI_CAMPAIGN', campaignId: campaign.id }}
          title='Validar contatos da campanha'
          subject='esta campanha'
        />
      ) : null}
    </div>
  )
}
