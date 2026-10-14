'use client'

import { ImageGalleryField } from '@/app/_components/crm/proposal/proposal-image-upload'
import { AiInput, AiTextarea } from '@/components/ui/ai-text-field'
import { Field, FieldLabel } from '@/components/ui/field'
import type { CrmProposalSectionContent } from '@/src/schemas/crm-proposal.schema'

export type CompanyPresentationContent = Extract<
  CrmProposalSectionContent,
  { type: 'COMPANY_PRESENTATION' }
>

export function companyPresentationDefaultContent(): CompanyPresentationContent {
  return {
    type: 'COMPANY_PRESENTATION',
    description: 'Descreva sua empresa, história e diferenciais aqui.',
    imageUrls: [],
  }
}

export function CompanyPresentationEditor({
  content,
  onChange,
  workspaceId,
}: {
  content: CompanyPresentationContent
  onChange: (content: CompanyPresentationContent) => void
  workspaceId: string
}) {
  return (
    <div className='flex flex-col gap-4'>
      <Field>
        <FieldLabel htmlFor='company-headline'>Chamada</FieldLabel>
        <AiInput
          id='company-headline'
          aiLabel='Chamada da apresentação'
          value={content.headline ?? ''}
          onChange={(e) =>
            onChange({ ...content, headline: e.target.value || undefined })
          }
          placeholder='Quem somos'
        />
      </Field>
      <Field>
        <FieldLabel htmlFor='company-description'>Descrição</FieldLabel>
        <AiTextarea
          id='company-description'
          aiLabel='Descrição da empresa'
          rows={6}
          value={content.description}
          onChange={(e) =>
            onChange({ ...content, description: e.target.value })
          }
        />
      </Field>
      <ImageGalleryField
        workspaceId={workspaceId}
        label='Imagens'
        value={content.imageUrls}
        onChange={(imageUrls) => onChange({ ...content, imageUrls })}
      />
    </div>
  )
}

export function CompanyPresentationDisplay({
  content,
}: {
  content: CompanyPresentationContent
}) {
  return (
    <section className='flex flex-col gap-4 rounded-lg border p-8'>
      <h2 className='font-semibold text-2xl'>
        {content.headline || 'Apresentação da empresa'}
      </h2>
      <p className='whitespace-pre-wrap text-muted-foreground'>
        {content.description}
      </p>
      {content.imageUrls.length > 0 ? (
        <div className='flex flex-wrap gap-3'>
          {content.imageUrls.map((url) => (
            <img
              key={url}
              src={url}
              alt=''
              className='h-32 w-32 rounded-md border object-cover'
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}
