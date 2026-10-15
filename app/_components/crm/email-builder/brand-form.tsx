'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import type { EmailBrand } from '@/src/lib/crm-email-builder/brand'
import { CrmEmailBrandSchema } from '@/src/schemas/crm-email-builder.schema'
import { ImageField } from './image-field'

/**
 * Workspace branding of every builder template: name, logo, primary color
 * and footer address/site. Edits preview live (`onPreview`); saving applies
 * them to all templates of the workspace.
 */
export function BrandForm({
  workspaceId,
  brand,
  saving,
  onPreview,
  onSave,
  stacked = false,
}: {
  workspaceId: string
  brand: EmailBrand
  saving: boolean
  onPreview: (brand: EmailBrand) => void
  onSave: (brand: EmailBrand) => Promise<void>
  /** One column at any width (narrow side panels). */
  stacked?: boolean
}) {
  const [draft, setDraft] = useState(brand)
  useEffect(() => setDraft(brand), [brand])

  const update = (patch: Partial<EmailBrand>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    onPreview(next)
  }

  async function handleSave() {
    const parsed = CrmEmailBrandSchema.safeParse(draft)
    if (!parsed.success) {
      notify.error(parsed.error.issues[0]?.message ?? 'Dados inválidos')
      return
    }
    await onSave(parsed.data)
  }

  const colorValid = /^#[0-9a-fA-F]{6}$/.test(draft.primaryColor)

  return (
    <div
      className={cn(
        'grid min-w-0 gap-4',
        !stacked && 'sm:grid-cols-2 sm:[&>.brand-wide]:col-span-2',
      )}
    >
      <p className='brand-wide text-muted-foreground text-xs'>
        A marca vale para todos os templates do editor visual deste workspace.
      </p>
      <div className='grid gap-1.5'>
        <Label
          htmlFor='brand-company'
          className='text-muted-foreground text-xs'
        >
          Nome da empresa
        </Label>
        <Input
          id='brand-company'
          value={draft.companyName}
          maxLength={120}
          onChange={(e) => update({ companyName: e.target.value })}
        />
      </div>
      <div className='grid gap-1.5'>
        <Label htmlFor='brand-color' className='text-muted-foreground text-xs'>
          Cor principal
        </Label>
        <div className='flex items-center gap-2'>
          <input
            type='color'
            aria-label='Seletor de cor'
            value={colorValid ? draft.primaryColor : '#2893CC'}
            onChange={(e) => update({ primaryColor: e.target.value })}
            className='h-9 w-11 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1'
          />
          <Input
            id='brand-color'
            value={draft.primaryColor}
            maxLength={7}
            aria-invalid={!colorValid || undefined}
            onChange={(e) => update({ primaryColor: e.target.value })}
          />
        </div>
      </div>
      <div className='brand-wide'>
        <ImageField
          id='brand-logo'
          workspaceId={workspaceId}
          label='Logo'
          src={draft.logoUrl}
          alt={draft.companyName}
          onChange={(next) => {
            if (next.src !== undefined) update({ logoUrl: next.src })
          }}
        />
      </div>
      <div className='grid gap-1.5'>
        <Label
          htmlFor='brand-address'
          className='text-muted-foreground text-xs'
        >
          Endereço (rodapé)
        </Label>
        <Input
          id='brand-address'
          value={draft.address}
          maxLength={300}
          placeholder='Rua, número — cidade, UF'
          onChange={(e) => update({ address: e.target.value })}
        />
      </div>
      <div className='grid gap-1.5'>
        <Label
          htmlFor='brand-website'
          className='text-muted-foreground text-xs'
        >
          Site
        </Label>
        <Input
          id='brand-website'
          value={draft.website}
          placeholder='https://suaempresa.com.br'
          onChange={(e) => update({ website: e.target.value })}
        />
      </div>
      <div className='brand-wide'>
        <Button type='button' onClick={handleSave} disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar marca'}
        </Button>
      </div>
    </div>
  )
}
