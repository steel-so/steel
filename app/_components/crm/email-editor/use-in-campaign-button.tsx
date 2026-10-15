'use client'

import { MegaphoneIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import { campaignReturnHref, useEmailEditorData } from './editor-data'

/**
 * "Usar na campanha": shown when the editor was opened from the campaign
 * wizard ("Criar novo template"). Saves what is pending and goes back to
 * the wizard with this template selected.
 */
export function UseInCampaignButton() {
  const { returnTo, templateId, flushMeta, flushDocument } =
    useEmailEditorData()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  if (!returnTo) return null

  async function useInCampaign() {
    if (!returnTo) return
    setPending(true)
    const saved = (await flushMeta()) && (await flushDocument())
    if (!saved) {
      setPending(false)
      notify.error('Salve o template antes de voltar para a campanha')
      return
    }
    router.push(campaignReturnHref(returnTo, templateId))
  }

  return (
    <Button
      type='button'
      size='sm'
      onClick={useInCampaign}
      disabled={pending}
      data-testid='use-in-campaign'
    >
      <SteelIcon icon={MegaphoneIcon} strokeWidth={2} />
      {pending ? 'Salvando…' : 'Usar na campanha'}
    </Button>
  )
}
