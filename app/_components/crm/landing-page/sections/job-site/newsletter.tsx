'use client'

import { Mail01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { CrmPublicFormRenderer } from '@/app/_components/crm/crm-public-form-renderer'
import { SteelIcon } from '@/components/icon/icon'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
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
import { hrefOf, textOf, withHref, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type NewsletterContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'NEWSLETTER' }
>

export function newsletterDefaultContent(): NewsletterContent {
  return {
    type: 'NEWSLETTER',
    title: 'Get our latest updates',
    description:
      'With lots of unique blocks, you can easily build a page without coding. Build your next landing page.',
    placeholder: 'Enter your email',
    ctaLabel: 'Subscribe',
  }
}

export function JobSiteNewsletter({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<NewsletterContent>) {
  const { items: forms } = useCrmResourceList<CrmFormDTO>(
    workspaceId ?? '',
    'forms',
  )
  const selectedForm = forms.find((f) => f.id === content.formId)

  return (
    <section
      id='subscribe'
      className='flex flex-col items-center gap-6 px-6 py-20 text-center sm:px-12 sm:py-28'
    >
      <span className='flex size-[78px] items-center justify-center rounded-full bg-[#68d585]'>
        <SteelIcon
          icon={Mail01Icon}
          strokeWidth={2}
          size={28}
          className='text-white'
        />
      </span>

      <GhostInput
        as='h2'
        value={content.title}
        onCommit={(v) => onChange?.({ ...content, title: v })}
        placeholder='Título da seção'
        readOnly={readOnly}
        className='font-bold text-[#161c2d] text-[28px] tracking-[-1px] sm:text-[36px]'
      />
      {content.description || !readOnly ? (
        <GhostTextarea
          value={content.description ?? ''}
          onCommit={(v) =>
            onChange?.({ ...content, description: v || undefined })
          }
          placeholder='Descrição de apoio'
          readOnly={readOnly}
          as='p'
          className='max-w-md text-balance text-[#161c2d]/70 text-[17px] sm:text-[19px]'
        />
      ) : null}

      {!readOnly ? (
        <div className='w-full max-w-md text-left'>
          <Select
            value={content.formId ?? ''}
            onValueChange={(formId) =>
              onChange?.({ ...content, formId: formId || undefined })
            }
          >
            <SelectTrigger className='w-full'>
              <SelectValue placeholder='Formulário decorativo (sem envio real)' />
            </SelectTrigger>
            <SelectContent>
              {forms.map((form) => (
                <SelectItem key={form.id} value={form.id}>
                  {form.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {selectedForm ? (
        <div className='w-full max-w-md text-left'>
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
        </div>
      ) : (
        <div className='flex w-full max-w-md items-center gap-2 rounded-lg border border-[#e7e9ed] bg-white p-2'>
          <GhostInput
            value={content.placeholder ?? ''}
            onCommit={(v) =>
              onChange?.({ ...content, placeholder: v || undefined })
            }
            placeholder='Seu e-mail'
            readOnly={readOnly}
            className='flex-1 px-2 text-[#161c2d]/70 text-[15px]'
          />
          <GhostLink
            href={hrefOf(content, 'cta', '#')}
            onHrefChange={(v) => onChange?.(withHref(content, 'cta', v))}
            readOnly={readOnly}
            data-cta
            className='shrink-0 rounded-md bg-[#473bf0] px-6 py-3 font-bold text-[17px] text-white tracking-[-0.6px]'
          >
            <GhostInput
              value={content.ctaLabel ?? ''}
              onCommit={(v) =>
                onChange?.({ ...content, ctaLabel: v || undefined })
              }
              placeholder='Inscrever'
              readOnly={readOnly}
              className='field-sizing-content text-inherit'
            />
          </GhostLink>
        </div>
      )}

      <GhostTextarea
        value={textOf(
          content,
          'disclaimer',
          'We’ll never share your details with third parties. View our Privacy Policy for more info.',
        )}
        onCommit={(v) => onChange?.(withText(content, 'disclaimer', v))}
        placeholder='Aviso de privacidade'
        readOnly={readOnly}
        as='p'
        className='text-center text-[#161c2d]/70 text-[15px]'
      />
    </section>
  )
}
