'use client'

import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type AboutContent = Extract<CrmLandingPageSectionContent, { type: 'ABOUT' }>

const BASE = '/landing-page-templates/agency'

export function aboutDefaultContent(): AboutContent {
  return {
    type: 'ABOUT',
    eyebrow: 'Nossa história',
    title: 'Sabemos como tudo funciona e por que o seu negócio não decola.',
    description:
      'Compartilhamos tendências e estratégias para aumentar a sua receita e manter a sua empresa sempre em alta demanda. Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
    imageUrl: `${BASE}/about-photo-main.png`,
    imageUrls: [`${BASE}/about-photo-2.png`, `${BASE}/about-photo-3.png`],
  }
}

export function AgencyAbout({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<AboutContent>) {
  async function handleImage(index: number | null, file: File) {
    const res = await uploadCrmLandingPageImage(workspaceId ?? '', file)
    if (!res.ok || !res.data) {
      notify.error(res.message ?? 'Não foi possível enviar a imagem.')
      return
    }
    if (index === null) {
      onChange?.({ ...content, imageUrl: res.data.url })
      return
    }
    const imageUrls = [...content.imageUrls]
    imageUrls[index] = res.data.url
    onChange?.({ ...content, imageUrls })
  }

  const [image2, image3] = content.imageUrls

  return (
    <section className='bg-[#f4f7fa] px-6 py-16 sm:px-10 sm:py-24 lg:px-[123px]'>
      <div className='mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-2'>
        <GhostImage
          value={content.imageUrl}
          onUpload={(file) => handleImage(null, file)}
          readOnly={readOnly}
          alt={content.title}
          className='aspect-[445/565] w-full max-w-md rounded-[10px] object-cover'
        />

        <div className='flex flex-col gap-8'>
          <div className='flex flex-col gap-4'>
            {content.eyebrow || !readOnly ? (
              <GhostInput
                value={content.eyebrow ?? ''}
                onCommit={(v) =>
                  onChange?.({ ...content, eyebrow: v || undefined })
                }
                placeholder='Texto de destaque'
                readOnly={readOnly}
                className='font-bold text-[#f64b4b] text-[13px] uppercase tracking-[1.6px]'
              />
            ) : null}
            <GhostInput
              as='h2'
              value={content.title}
              onCommit={(v) => onChange?.({ ...content, title: v })}
              placeholder='Título da seção'
              readOnly={readOnly}
              className='text-balance font-bold text-[#161c2d] text-[28px] leading-tight tracking-[-1px] sm:text-[36px] sm:leading-[48px]'
            />
          </div>

          <div className='relative flex items-start gap-6'>
            <GhostImage
              value={image2}
              onUpload={(file) => handleImage(0, file)}
              readOnly={readOnly}
              alt=''
              className='aspect-[318/332] w-2/3 rounded-[10px] object-cover'
            />
            {image3 || !readOnly ? (
              <GhostImage
                value={image3}
                onUpload={(file) => handleImage(1, file)}
                readOnly={readOnly}
                alt=''
                className='mt-12 aspect-[160/167] w-1/3 rounded-[10px] object-cover'
              />
            ) : null}
            <img
              src={`${BASE}/about-dots.svg`}
              alt=''
              aria-hidden
              className='-top-6 -right-4 absolute h-24 w-24 opacity-70'
            />
          </div>

          <GhostTextarea
            value={content.description}
            onCommit={(v) => onChange?.({ ...content, description: v })}
            placeholder='Descrição'
            readOnly={readOnly}
            as='p'
            className='text-[#161c2d]/70 text-[17px] leading-[1.7]'
          />
        </div>
      </div>
    </section>
  )
}
