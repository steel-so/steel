'use client'

import { ArrowRight01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { CrmPublicFormRenderer } from '@/app/_components/crm/crm-public-form-renderer'
import { SteelIcon } from '@/components/icon/icon'
import { GhostInput } from '@/components/ui/ghost-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { CrmFormDTO } from '@/types/crm-form'
import type { LandingPageSectionProps } from '../types'

type NewsletterContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'NEWSLETTER' }
>

const NO_FORM = '__none__'

export function consultationNewsletterDefaultContent(): NewsletterContent {
  return {
    type: 'NEWSLETTER',
    title: 'Assine nossa newsletter e receba as novidades no seu e-mail.',
    placeholder: 'Digite seu e-mail',
    ctaLabel: 'Assinar',
  }
}

/**
 * Quando `content.formId` aponta pra um formulário real do workspace, a
 * linha decorativa de e-mail some e o formulário publicado entra no lugar
 * (`CrmPublicFormRenderer`, mesmo componente da página pública) — submissão
 * de verdade em vez do input/botão sem backend. Sem `formId`, a seção
 * continua exatamente como antes.
 */
export function ConsultationNewsletter({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<NewsletterContent>) {
  const { items: forms } = useCrmResourceList<CrmFormDTO>(
    workspaceId ?? '',
    'forms',
  )
  const selectedForm = forms.find((form) => form.id === content.formId)

  return (
    <section className='px-6 py-16 sm:px-10 lg:px-[123px]'>
      <div className='mx-auto flex max-w-6xl flex-col gap-6'>
        <div className='flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center'>
          <GhostInput
            as='h2'
            value={content.title}
            onCommit={(v) => onChange?.({ ...content, title: v })}
            placeholder='Título da chamada'
            readOnly={readOnly}
            className='max-w-lg text-balance font-bold text-[#161c2d] text-[26px] leading-[1.3] tracking-[-1.2px] sm:text-[32px] sm:leading-[44px]'
          />

          <div className='flex shrink-0 flex-col items-end gap-3'>
            {!readOnly ? (
              <Select
                value={content.formId ?? NO_FORM}
                onValueChange={(v) =>
                  onChange?.({
                    ...content,
                    formId: v && v !== NO_FORM ? v : undefined,
                  })
                }
              >
                <SelectTrigger className='w-[260px]'>
                  <SelectValue placeholder='Selecionar formulário' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_FORM}>
                    Nenhum (campo decorativo)
                  </SelectItem>
                  {forms.map((form) => (
                    <SelectItem key={form.id} value={form.id}>
                      {form.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            {!content.formId ? (
              <div className='flex shrink-0 items-center gap-4'>
                <GhostInput
                  value={content.placeholder ?? ''}
                  onCommit={(v) =>
                    onChange?.({ ...content, placeholder: v || undefined })
                  }
                  placeholder='Digite seu e-mail'
                  readOnly={readOnly}
                  className='w-[290px] rounded-lg border border-[#e7e9ed] px-[19px] py-4 text-[#161c2d]/70 text-[15px] tracking-[-0.18px]'
                />
                <span className='inline-flex shrink-0 items-center gap-2 rounded-lg bg-[#473bf0] px-6 py-4 font-bold text-[17px] text-white tracking-[-0.6px]'>
                  <GhostInput
                    value={content.ctaLabel ?? ''}
                    onCommit={(v) =>
                      onChange?.({ ...content, ctaLabel: v || undefined })
                    }
                    placeholder='Assinar'
                    readOnly={readOnly}
                    className='text-inherit'
                  />
                  <SteelIcon
                    icon={ArrowRight01Icon}
                    strokeWidth={2.5}
                    size={16}
                  />
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {content.formId && selectedForm ? (
          <CrmPublicFormRenderer
            form={{
              id: selectedForm.id,
              name: selectedForm.name,
              description: selectedForm.description,
              fields: selectedForm.fields,
              phases: selectedForm.phases,
              successMessage: selectedForm.successMessage,
              redirectUrl: selectedForm.redirectUrl,
            }}
            publicToken={selectedForm.publicToken}
            preview={!readOnly}
          />
        ) : null}
      </div>
    </section>
  )
}
