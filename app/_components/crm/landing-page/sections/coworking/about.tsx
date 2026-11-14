'use client'

import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type AboutContent = Extract<CrmLandingPageSectionContent, { type: 'ABOUT' }>

const BASE = '/landing-page-templates/coworking'

/** Mapeia "Content 01" (duas fotos + título) pro tipo ABOUT — `imageUrl` é a
 * foto retrato menor (esquerda), `imageUrls[0]` a foto paisagem maior
 * (direita), igual ao frame do Figma. */
export function aboutDefaultContent(): AboutContent {
  return {
    type: 'ABOUT',
    title: 'Trabalhe ao lado de pessoas muito talentosas.',
    description:
      'Com vários blocos prontos, você monta sua página facilmente, sem escrever código.',
    imageUrl: `${BASE}/about-photo-1.jpg`,
    imageUrls: [`${BASE}/about-photo-2.jpg`],
  }
}

export function CoworkingAbout({
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

  const [image2] = content.imageUrls

  return (
    <section className='bg-[#f4f7fa] px-6 py-20 sm:px-10 sm:py-28 lg:px-[123px]'>
      <div className='mx-auto grid max-w-6xl grid-cols-1 items-start gap-x-8 gap-y-12 lg:grid-cols-2'>
        <div className='flex flex-col gap-4'>
          <GhostInput
            as='h2'
            value={content.title}
            onCommit={(v) => onChange?.({ ...content, title: v })}
            placeholder='Título da seção'
            readOnly={readOnly}
            className='max-w-md text-balance font-bold text-[#161c2d] text-[36px] leading-tight tracking-[-1.8px] sm:text-[48px] sm:leading-[58px]'
          />
          <GhostTextarea
            value={content.description}
            onCommit={(v) => onChange?.({ ...content, description: v })}
            placeholder='Descrição'
            readOnly={readOnly}
            as='p'
            className='max-w-sm text-[#161c2d]/70 text-[19px] leading-[1.7]'
          />
          <GhostImage
            value={content.imageUrl}
            onUpload={(file) => handleImage(null, file)}
            readOnly={readOnly}
            alt={content.title}
            className='mt-4 aspect-[520/600] w-full max-w-[420px] rounded-[10px] object-cover'
          />
        </div>

        {image2 || !readOnly ? (
          <GhostImage
            value={image2}
            onUpload={(file) => handleImage(0, file)}
            readOnly={readOnly}
            alt=''
            className='aspect-[520/670] w-full rounded-[10px] object-cover lg:mt-16'
          />
        ) : null}
      </div>
    </section>
  )
}
