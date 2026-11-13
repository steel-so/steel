'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type LogosContent = Extract<CrmLandingPageSectionContent, { type: 'LOGOS' }>

const BASE = '/landing-page-templates/job-site'

export function logosDefaultContent(): LogosContent {
  return {
    type: 'LOGOS',
    title: 'Grandes empresas estão aqui',
    logos: [
      { name: 'MakeLess', imageUrl: `${BASE}/logo-makeless.png` },
      { name: 'coworks', imageUrl: `${BASE}/logo-coworks.png` },
      { name: 'greener', imageUrl: `${BASE}/logo-greener.png` },
      { name: 'SAAS TODAY', imageUrl: `${BASE}/logo-saastoday.png` },
      { name: 'Dorfus', imageUrl: `${BASE}/logo-dorfus.png` },
      { name: 'askimat', imageUrl: `${BASE}/logo-askimat.png` },
    ],
  }
}

export function JobSiteLogos({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<LogosContent>) {
  async function handleImage(index: number, file: File) {
    const res = await uploadCrmLandingPageImage(workspaceId ?? '', file)
    if (!res.ok || !res.data) {
      notify.error(res.message ?? 'Não foi possível enviar a imagem.')
      return
    }
    const url = res.data.url
    onChange?.({
      ...content,
      logos: content.logos.map((l, i) =>
        i === index ? { ...l, imageUrl: url } : l,
      ),
    })
  }

  function updateLogo(index: number, name: string) {
    onChange?.({
      ...content,
      logos: content.logos.map((l, i) => (i === index ? { ...l, name } : l)),
    })
  }

  function addLogo() {
    onChange?.({
      ...content,
      logos: [...content.logos, { name: 'Empresa' }],
    })
  }

  function removeLogo(index: number) {
    onChange?.({
      ...content,
      logos: content.logos.filter((_, i) => i !== index),
    })
  }

  return (
    <section className='flex flex-col items-center gap-16 bg-white px-6 py-20 sm:px-10 sm:py-28 lg:px-[123px]'>
      <GhostInput
        as='h2'
        value={content.title ?? ''}
        onCommit={(v) => onChange?.({ ...content, title: v || undefined })}
        placeholder='Título da seção'
        readOnly={readOnly}
        className='text-balance text-center font-bold text-[#161c2d] text-[28px] leading-tight tracking-[-1px] sm:text-[36px]'
      />

      <div className='flex w-full max-w-4xl flex-wrap items-center justify-center gap-x-16 gap-y-8'>
        {content.logos.map((logo, index) => (
          <div
            key={index}
            className='group/item relative flex flex-col items-center gap-1'
          >
            {!readOnly ? (
              <Button
                type='button'
                variant='ghost'
                size='icon-xs'
                className='-top-2 -right-2 absolute z-10 opacity-0 group-hover/item:opacity-100'
                aria-label='Remover logo'
                onClick={() => removeLogo(index)}
              >
                <SteelIcon icon={Delete02Icon} strokeWidth={2} size={12} />
              </Button>
            ) : null}
            <GhostImage
              value={logo.imageUrl}
              onUpload={(file) => handleImage(index, file)}
              readOnly={readOnly}
              alt={logo.name}
              className='h-8 w-32 opacity-50 grayscale'
            />
            {!readOnly ? (
              <GhostInput
                value={logo.name}
                onCommit={(v) => updateLogo(index, v)}
                placeholder='Nome da empresa'
                readOnly={readOnly}
                className='text-center text-[#161c2d]/60 text-xs'
              />
            ) : null}
          </div>
        ))}
        {!readOnly ? (
          <Button type='button' variant='outline' size='sm' onClick={addLogo}>
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Adicionar logo
          </Button>
        ) : null}
      </div>
    </section>
  )
}
