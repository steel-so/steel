'use client'

import { Megaphone01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { useWhatsAppConversationAdReferral } from '@/src/hooks/use-whatsapp-ads'

/**
 * Strip above the messages of a conversation that came from a
 * Click-to-WhatsApp ad: names the ad so the agent opens with its offer.
 * Renders nothing for an ordinary conversation.
 */
export function WhatsappAdReferralBanner({
  workspaceId,
  conversationId,
}: {
  workspaceId: string
  conversationId: string
}) {
  const { data } = useWhatsAppConversationAdReferral(
    workspaceId,
    conversationId,
  )
  if (!data) return null

  const title = data.headline ?? `Anúncio ${data.sourceId}`
  return (
    <div className='flex items-start gap-2 border-b bg-muted px-4 py-2 text-sm'>
      <SteelIcon
        icon={Megaphone01Icon}
        className='mt-0.5 size-4 shrink-0 text-muted-foreground'
      />
      <div className='min-w-0'>
        <p className='truncate font-medium'>
          {data.sourceType === 'post'
            ? 'Veio de uma publicação'
            : 'Veio de um anúncio'}
          : {title}
        </p>
        {data.body ? (
          <p className='line-clamp-2 text-muted-foreground text-xs'>
            {data.body}
          </p>
        ) : null}
      </div>
      {data.sourceUrl && /^https?:\/\//i.test(data.sourceUrl) ? (
        <a
          href={data.sourceUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='ml-auto shrink-0 text-xs underline underline-offset-2'
        >
          Abrir anúncio
        </a>
      ) : null}
    </div>
  )
}
