'use client'

import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type TestimonialContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'TESTIMONIAL' }
>

const BASE = '/landing-page-templates/consultation'

export function consultationTestimonialDefaultContent(): TestimonialContent {
  return {
    type: 'TESTIMONIAL',
    quote:
      'Vocês deixaram tudo muito simples. Meu novo site ficou bem mais rápido e fácil de usar.',
    authorName: 'Ilya Vasin',
    authorRole: 'Engenheiro de Software',
    avatarUrl: `${BASE}/testimonial-logo-amazon.png`,
    style: 'default',
  }
}

export function consultationTestimonialGoogleDefaultContent(): TestimonialContent {
  return {
    type: 'TESTIMONIAL',
    quote:
      'Leitura indispensável para estudantes que querem ser grandes Product Designers.',
    authorName: 'Mariano Rasgado',
    authorRole: 'Engenheiro de Software',
    avatarUrl: `${BASE}/testimonial-logo-google.png`,
    style: 'default',
  }
}

export function consultationTestimonialAmazon2DefaultContent(): TestimonialContent {
  return {
    type: 'TESTIMONIAL',
    quote:
      'Vocês deixaram tudo muito simples. Meu novo site ficou bem mais rápido e fácil de usar.',
    authorName: 'Oka Tomoaki',
    authorRole: 'Engenheiro de Software',
    avatarUrl: `${BASE}/testimonial-logo-amazon.png`,
    style: 'default',
  }
}

/**
 * `avatarUrl` é reaproveitado pro pequeno logo da empresa acima do
 * depoimento (não uma foto de rosto) — mesma ideia sugerida no brief pro
 * card "3-up" do Figma, já que o schema não tem campo dedicado a logo.
 */
export function ConsultationTestimonial({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<TestimonialContent>) {
  async function handleImage(file: File) {
    const res = await uploadCrmLandingPageImage(workspaceId ?? '', file)
    if (!res.ok || !res.data) {
      notify.error(res.message ?? 'Não foi possível enviar a imagem.')
      return
    }
    onChange?.({ ...content, avatarUrl: res.data.url })
  }

  // Cada seção TESTIMONIAL renderiza como bloco independente e empilhado
  // (mesmo padrão que o Agency usa pros seus dois blocos de Testimonial) —
  // a página não tem um contêiner de grid compartilhado entre seções
  // vizinhas, então o "3-up lado a lado" do Figma vira 3 cards cheios
  // empilhados aqui. Ver relatório final.
  return (
    <section className='flex flex-col items-center gap-6 border-[#161c2d]/10 border-b bg-white px-6 py-12 text-center sm:px-10'>
      <GhostImage
        value={content.avatarUrl}
        onUpload={handleImage}
        readOnly={readOnly}
        alt=''
        className='h-[35px] w-auto max-w-[104px] object-contain grayscale'
      />

      <GhostTextarea
        value={content.quote}
        onCommit={(v) => onChange?.({ ...content, quote: v })}
        placeholder='Depoimento'
        readOnly={readOnly}
        as='p'
        className='max-w-[324px] text-balance font-bold text-[#161c2d] text-[24px] leading-[1.4] tracking-[-0.5px]'
      />

      <div className='flex flex-col items-center gap-0.5'>
        <GhostInput
          value={content.authorName}
          onCommit={(v) => onChange?.({ ...content, authorName: v })}
          placeholder='Nome'
          readOnly={readOnly}
          className='font-bold text-[#161c2d] text-[17px] tracking-[-0.2px]'
        />
        {content.authorRole || !readOnly ? (
          <GhostInput
            value={content.authorRole ?? ''}
            onCommit={(v) =>
              onChange?.({ ...content, authorRole: v || undefined })
            }
            placeholder='Cargo/empresa'
            readOnly={readOnly}
            className='text-[#161c2d]/70 text-[15px] tracking-[-0.1px]'
          />
        ) : null}
      </div>
    </section>
  )
}
