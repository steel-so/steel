'use client'

import { useCanvasStoreApi } from '@/app/_components/canvas/use-canvas'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSiteForms } from '@/src/hooks/use-crm-sites'
import type { CustomControlProps } from '@/src/lib/canvas/registry'
import type { SiteFormField } from '@/src/lib/canvas-site/schemas'
import type { CrmFormDTO } from '@/types/crm-form'
import { useSiteEditor } from './site-editor-context'

const NONE = '__none'

/** Snapshot of a CRM form kept in the `site.form` node (the page still
 * renders if the form is later unpublished). */
export function formSnapshot(form: CrmFormDTO): {
  formName: string
  fields: SiteFormField[]
} {
  return {
    formName: form.name,
    fields: form.fields.slice(0, 50).map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      ...(field.placeholder ? { placeholder: field.placeholder } : {}),
      ...(field.options?.length ? { options: field.options } : {}),
    })),
  }
}

/**
 * Inspector control of `site.form`: picks one of the workspace's published
 * CRM forms. Submissions go to that form (leads land in the CRM as usual).
 */
export function SiteFormPicker({ value, node }: CustomControlProps) {
  const { workspaceId, slug } = useSiteEditor()
  const store = useCanvasStoreApi()
  const forms = useSiteForms(workspaceId)
  const published = (forms.data ?? []).filter(
    (form) => form.status === 'PUBLISHED',
  )
  const token = typeof value === 'string' && value ? value : NONE
  const current = published.find((form) => form.publicToken === token)

  return (
    <div className='grid gap-1.5'>
      <Select
        value={token}
        onValueChange={(next) => {
          if (typeof next !== 'string') return
          const form = published.find((item) => item.publicToken === next)
          store.dispatch({
            kind: 'update',
            id: node.id,
            set: form
              ? { formToken: form.publicToken, ...formSnapshot(form) }
              : { formToken: '', formName: '', fields: [] },
          })
        }}
      >
        <SelectTrigger
          size='sm'
          className='w-full text-xs'
          aria-label='Formulário do CRM'
          disabled={forms.isLoading}
        >
          <SelectValue>
            {() =>
              forms.isLoading
                ? 'Carregando…'
                : (current?.name ??
                  (token === NONE
                    ? 'Escolha um formulário'
                    : 'Formulário indisponível'))
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectItem value={NONE}>Nenhum</SelectItem>
          {published.map((form) => (
            <SelectItem key={form.id} value={form.publicToken}>
              {form.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className='text-[11px] text-muted-foreground leading-relaxed'>
        {published.length === 0 && !forms.isLoading
          ? 'Nenhum formulário publicado. '
          : token !== NONE && !current && !forms.isLoading
            ? 'Este formulário não está mais publicado. '
            : 'Quem enviar vira lead no CRM. '}
        <a
          href={`/${slug}/crm/forms`}
          target='_blank'
          rel='noopener'
          className='font-medium text-primary underline-offset-4 hover:underline'
        >
          Gerenciar formulários
        </a>
      </p>
    </div>
  )
}
