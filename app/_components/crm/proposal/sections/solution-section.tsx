'use client'

import { ImageGalleryField } from '@/app/_components/crm/proposal/proposal-image-upload'
import { AiTextarea } from '@/components/ui/ai-text-field'
import { Field, FieldLabel } from '@/components/ui/field'
import type { CrmProposalSectionContent } from '@/src/schemas/crm-proposal.schema'

export type SolutionContent = Extract<
  CrmProposalSectionContent,
  { type: 'SOLUTION' }
>

export function solutionDefaultContent(): SolutionContent {
  return {
    type: 'SOLUTION',
    description: 'Descreva a solução proposta para o cliente.',
    imageUrls: [],
  }
}

export function SolutionEditor({
  content,
  onChange,
  workspaceId,
}: {
  content: SolutionContent
  onChange: (content: SolutionContent) => void
  workspaceId: string
}) {
  return (
    <div className='flex flex-col gap-4'>
      <Field>
        <FieldLabel htmlFor='solution-description'>Descrição</FieldLabel>
        <AiTextarea
          id='solution-description'
          aiLabel='Descrição da solução'
          rows={8}
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

export function SolutionDisplay({ content }: { content: SolutionContent }) {
  return (
    <section className='flex flex-col gap-4 rounded-lg border p-8'>
      <h2 className='font-semibold text-2xl'>Solução da proposta</h2>
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
