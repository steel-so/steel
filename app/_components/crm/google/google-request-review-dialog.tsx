'use client'

import {
  Mail01Icon,
  StarIcon,
  WhatsappIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useCrmGoogleLinks } from '@/src/hooks/use-crm-google-presence'
import { copyText, GoogleQr } from './google-qr'

/** Default ask, with the review link appended when it is sent. */
export function defaultReviewMessage(businessName: string): string {
  return `Olá! Obrigado por escolher a ${businessName}. Sua opinião é muito importante para nós. Se puder, deixe sua avaliação no Google, leva menos de um minuto:`
}

/**
 * "Pedir avaliação": the review link of the location with an editable
 * message, ready to send by WhatsApp or e-mail, plus the QR code for
 * printing at the counter.
 */
export function GoogleRequestReviewDialog({
  workspaceId,
  businessName,
  open,
  onOpenChange,
}: {
  workspaceId: string
  businessName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const links = useCrmGoogleLinks(workspaceId, open)
  const [message, setMessage] = useState(defaultReviewMessage(businessName))
  const reviewUrl = links.data?.reviewUrl ?? null
  const fullText = reviewUrl ? `${message.trim()} ${reviewUrl}` : message.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Pedir avaliação aos clientes</DialogTitle>
          <DialogDescription>
            Envie o link direto para a avaliação no Google. Quanto mais
            avaliações reais, mais confiança e mais aparições na busca.
          </DialogDescription>
        </DialogHeader>

        {links.isLoading ? (
          <p className='text-muted-foreground text-sm'>Carregando o link…</p>
        ) : links.error ? (
          <p role='alert' className='text-destructive text-sm'>
            {links.error.message}
          </p>
        ) : !reviewUrl ? (
          <p className='text-muted-foreground text-sm'>
            O Google ainda não liberou o link de avaliação deste local.
          </p>
        ) : (
          <div className='space-y-5'>
            <div className='space-y-1.5'>
              <Label htmlFor='google-review-message'>Mensagem</Label>
              <Textarea
                id='google-review-message'
                rows={4}
                value={message}
                maxLength={500}
                onChange={(event) => setMessage(event.target.value)}
              />
              <p className='break-all text-muted-foreground text-xs'>
                O link vai no fim: {reviewUrl}
              </p>
            </div>

            <div className='flex flex-wrap gap-2'>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(fullText)}`}
                target='_blank'
                rel='noopener noreferrer'
                className={cn(buttonVariants({ variant: 'default' }))}
              >
                <SteelIcon icon={WhatsappIcon} size={14} />
                Enviar pelo WhatsApp
              </a>
              <a
                href={`mailto:?subject=${encodeURIComponent(`Avalie a ${businessName}`)}&body=${encodeURIComponent(fullText)}`}
                className={cn(buttonVariants({ variant: 'outline' }))}
              >
                <SteelIcon icon={Mail01Icon} size={14} />
                Enviar por e-mail
              </a>
              <Button
                variant='outline'
                onClick={() => copyText(fullText, 'Mensagem copiada.')}
              >
                <SteelIcon icon={StarIcon} size={14} />
                Copiar mensagem
              </Button>
            </div>

            <div className='rounded-xl border border-border/60 p-4'>
              <p className='mb-3 text-center text-muted-foreground text-xs'>
                Imprima o QR code e deixe no balcão, na nota ou no cartão.
              </p>
              <GoogleQr
                url={reviewUrl}
                label='QR code do link de avaliação no Google'
                fileName='avaliar-no-google'
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
