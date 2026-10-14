'use client'

import { ImageUploadField } from '@/app/_components/crm/proposal/proposal-image-upload'
import { AiInput } from '@/components/ui/ai-text-field'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import type { CrmProposalSectionContent } from '@/src/schemas/crm-proposal.schema'

export type CoverContent = Extract<CrmProposalSectionContent, { type: 'COVER' }>

export function coverDefaultContent(ctx: {
  proposalName?: string
}): CoverContent {
  return { type: 'COVER', title: ctx.proposalName || 'Proposta Comercial' }
}

export function CoverEditor({
  content,
  onChange,
  workspaceId,
}: {
  content: CoverContent
  onChange: (content: CoverContent) => void
  workspaceId: string
}) {
  return (
    <div className='flex flex-col gap-4'>
      <Field>
        <FieldLabel htmlFor='cover-title'>Título</FieldLabel>
        <AiInput
          id='cover-title'
          aiLabel='Título da capa'
          value={content.title}
          onChange={(e) => onChange({ ...content, title: e.target.value })}
          placeholder='Proposta Comercial'
          aria-invalid={content.title === '' || undefined}
        />
        {content.title === '' ? (
          <FieldError>Título é obrigatório</FieldError>
        ) : null}
      </Field>
      <Field>
        <FieldLabel htmlFor='cover-subtitle'>Subtítulo</FieldLabel>
        <AiInput
          id='cover-subtitle'
          aiLabel='Subtítulo da capa'
          value={content.subtitle ?? ''}
          onChange={(e) =>
            onChange({ ...content, subtitle: e.target.value || undefined })
          }
          placeholder='Preparado para [Cliente]'
        />
      </Field>
      <ImageUploadField
        workspaceId={workspaceId}
        label='Imagem de capa'
        value={content.coverImageUrl}
        onChange={(url) => onChange({ ...content, coverImageUrl: url })}
      />
    </div>
  )
}

export function CoverDisplay({ content }: { content: CoverContent }) {
  return (
    <section className='flex min-h-[420px] flex-col items-center justify-center gap-4 rounded-lg border bg-gradient-to-br from-primary/5 to-transparent p-12 text-center'>
      {content.coverImageUrl ? (
        <img
          src={content.coverImageUrl}
          alt=''
          className='mb-4 max-h-40 w-auto rounded-md object-contain'
        />
      ) : null}
      <h1 className='text-balance font-semibold text-4xl tracking-tight'>
        {content.title}
      </h1>
      {content.subtitle ? (
        <p className='text-balance text-lg text-muted-foreground'>
          {content.subtitle}
        </p>
      ) : null}
    </section>
  )
}
