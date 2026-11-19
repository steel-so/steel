'use client'

import { AiMagicIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify'
import { crmBannersApi } from '@/src/hooks/use-crm-banners'
import {
  BANNER_AI_TONE_LABELS,
  BANNER_AI_TONES,
  type BannerAiCopy,
  type BannerAiTone,
  type BannerObjective,
} from '@/src/schemas/crm-banner.schema'
import { Field, SelectField } from './banner-fields'

/**
 * Text variants for A/B tests: the AI rewrites the banner's current copy
 * from a different angle each time. "Usar" swaps the text in every format;
 * "Criar versão B" keeps this banner and saves the variant as a new one.
 */
export function BannerAiDialog({
  open,
  onOpenChange,
  workspaceId,
  companyName,
  objective,
  current,
  onUse,
  onCreateVersion,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  companyName: string
  objective: BannerObjective | null
  current: BannerAiCopy
  onUse: (copy: BannerAiCopy) => void
  onCreateVersion: (copy: BannerAiCopy) => Promise<void>
}) {
  const [tone, setTone] = useState<BannerAiTone>('DIRECT')
  const [count, setCount] = useState(3)
  const [offer, setOffer] = useState('')
  const [variants, setVariants] = useState<BannerAiCopy[]>([])
  const [creating, setCreating] = useState<number | null>(null)

  const generate = useMutation({
    mutationFn: () =>
      crmBannersApi(workspaceId).generateCopy({
        mode: 'VARIANTS',
        tone,
        count,
        offer,
        objective,
        companyName,
        current: {
          headline: current.headline,
          subheadline: current.subheadline,
          cta: current.cta,
        },
      }),
    onSuccess: (result) => setVariants(result.variants),
    onError: (error) =>
      notify.error(error, 'A IA não conseguiu responder agora'),
  })

  const hasCurrent = Boolean(current.headline.trim())

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>Variações de texto (teste A/B)</DialogTitle>
          <DialogDescription>
            A IA reescreve o texto do banner com ângulos diferentes. Só o texto
            vai para o provedor, nunca dados do CRM.
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-4'>
          <div className='grid gap-3 sm:grid-cols-3'>
            <SelectField
              label='Tom'
              value={tone}
              options={BANNER_AI_TONES.map((value) => ({
                value,
                label: BANNER_AI_TONE_LABELS[value],
              }))}
              onChange={setTone}
            />
            <SelectField
              label='Quantidade'
              value={count}
              options={[2, 3, 4, 5].map((value) => ({
                value,
                label: `${value} opções`,
              }))}
              onChange={setCount}
            />
            <Field label='Oferta (opcional)'>
              {(id) => (
                <Input
                  id={id}
                  value={offer}
                  maxLength={200}
                  placeholder='20% na primeira compra'
                  onChange={(event) => setOffer(event.target.value)}
                />
              )}
            </Field>
          </div>

          {hasCurrent ? null : (
            <p className='rounded-md border border-dashed p-3 text-muted-foreground text-sm'>
              O banner ainda não tem título. Escreva um texto base no editor e
              volte aqui para gerar as variações.
            </p>
          )}

          <Button
            type='button'
            disabled={!hasCurrent || generate.isPending}
            onClick={() => generate.mutate()}
          >
            <SteelIcon icon={AiMagicIcon} />
            {generate.isPending
              ? 'Gerando…'
              : variants.length > 0
                ? 'Gerar outras opções'
                : 'Gerar variações'}
          </Button>

          {variants.length > 0 ? (
            <ul className='grid gap-2' aria-label='Variações geradas'>
              {variants.map((variant, index) => (
                <li key={index} className='grid gap-2 rounded-lg border p-3'>
                  <div className='grid gap-0.5'>
                    <span className='font-medium text-sm'>
                      {variant.headline}
                    </span>
                    {variant.subheadline ? (
                      <span className='text-muted-foreground text-sm'>
                        {variant.subheadline}
                      </span>
                    ) : null}
                    <span className='text-muted-foreground text-xs'>
                      Botão: {variant.cta || '—'}
                      {variant.badge ? ` · Selo: ${variant.badge}` : ''}
                    </span>
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    <Button
                      type='button'
                      size='sm'
                      onClick={() => {
                        onUse(variant)
                        onOpenChange(false)
                      }}
                    >
                      Usar neste banner
                    </Button>
                    <Button
                      type='button'
                      size='sm'
                      variant='outline'
                      disabled={creating !== null}
                      onClick={async () => {
                        setCreating(index)
                        try {
                          await onCreateVersion(variant)
                        } finally {
                          setCreating(null)
                        }
                      }}
                    >
                      {creating === index ? 'Criando…' : 'Criar versão B'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
