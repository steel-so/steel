import type { ReactNode } from 'react'
import {
  type CanvasRenderProps,
  defineComponent,
  type InspectorField,
} from '@/src/lib/canvas/registry'
import { SITE_TYPES } from '../constants'
import {
  defaultFormAction,
  type SiteLiveForm,
  type SiteRenderContext,
} from '../context'
import { classNames } from '../css'
import {
  advancedSection,
  BUTTON_VARIANT_OPTIONS,
  spacingSection,
} from '../inspector'
import { safeHref } from '../sanitize'
import {
  type SiteFormField,
  type SiteFormProps,
  siteFormSchema,
} from '../schemas'

const anchorId = (anchor: string | undefined) => anchor || undefined

const INPUT_TYPES: Record<string, string> = {
  text: 'text',
  email: 'email',
  phone: 'tel',
  number: 'number',
  url: 'url',
  date: 'date',
}

const AUTOCOMPLETE: Record<string, string> = {
  email: 'email',
  phone: 'tel',
  url: 'url',
}

/** Fields shown in the editor before a form is picked. */
export const SAMPLE_FORM_FIELDS: SiteFormField[] = [
  { key: 'name', label: 'Nome', type: 'text', required: true },
  { key: 'email', label: 'E-mail', type: 'email', required: true },
  { key: 'message', label: 'Mensagem', type: 'textarea', required: false },
]

function FormField({
  field,
  id,
  disabled,
}: {
  field: SiteFormField
  id: string
  disabled: boolean
}) {
  const common = {
    id,
    name: field.key,
    required: field.required,
    disabled,
    'data-field': '',
  }
  const label = (
    <>
      {field.label}
      {field.required && <span aria-hidden='true'> *</span>}
    </>
  )
  if (field.type === 'checkbox') {
    return (
      <div className='s-field s-field-wide'>
        <label className='s-check' htmlFor={id}>
          <input {...common} type='checkbox' value='true' />
          <span>{label}</span>
        </label>
      </div>
    )
  }
  let control: ReactNode
  if (field.type === 'textarea') {
    control = (
      <textarea
        {...common}
        className='s-input'
        placeholder={field.placeholder}
      />
    )
  } else if (field.type === 'select') {
    control = (
      <select {...common} className='s-input' defaultValue=''>
        <option value='' disabled>
          {field.placeholder || 'Selecione'}
        </option>
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    )
  } else {
    control = (
      <input
        {...common}
        className='s-input'
        type={INPUT_TYPES[field.type]}
        placeholder={field.placeholder}
        autoComplete={AUTOCOMPLETE[field.type]}
      />
    )
  }
  return (
    <div
      className={field.type === 'textarea' ? 's-field s-field-wide' : 's-field'}
    >
      <label className='s-label' htmlFor={id}>
        {label}
      </label>
      {control}
    </div>
  )
}

export function formDefinition(ctx: SiteRenderContext) {
  const tokenField: InspectorField = ctx.formPicker
    ? {
        path: 'formToken',
        label: 'Formulário do CRM',
        control: { kind: 'custom', component: ctx.formPicker },
      }
    : {
        path: 'formToken',
        label: 'Código público do formulário',
        help: 'Está no endereço público do formulário do CRM (/f/<código>).',
        control: { kind: 'text', maxLength: 64 },
      }
  return defineComponent<SiteFormProps>({
    type: SITE_TYPES.form,
    label: 'Formulário',
    icon: 'form',
    category: 'Formulários',
    keywords: ['contato', 'lead', 'crm', 'cadastro', 'inscrição'],
    propsSchema: siteFormSchema,
    defaultProps: () => ({
      formToken: '',
      formName: '',
      fields: [],
      submitLabel: 'Enviar',
      successMessage:
        'Recebemos suas informações. Em breve entraremos em contato.',
      columns: '1',
      buttonVariant: 'primary',
      buttonAlign: 'stretch',
    }),
    accepts: false,
    inspector: [
      {
        id: 'content',
        label: 'Formulário',
        tab: 'content',
        fields: [
          tokenField,
          {
            path: 'submitLabel',
            label: 'Texto do botão',
            control: { kind: 'text', maxLength: 80 },
          },
          {
            path: 'successMessage',
            label: 'Mensagem de sucesso',
            help: 'Usada quando o formulário do CRM não define a dele.',
            control: { kind: 'textarea', rows: 2, maxLength: 300 },
          },
        ],
      },
      {
        id: 'style',
        label: 'Aparência',
        tab: 'style',
        fields: [
          {
            path: 'columns',
            label: 'Colunas',
            responsive: true,
            control: {
              kind: 'segmented',
              options: [
                { value: '1', label: '1' },
                { value: '2', label: '2' },
              ],
            },
          },
          {
            path: 'buttonVariant',
            label: 'Estilo do botão',
            control: { kind: 'select', options: BUTTON_VARIANT_OPTIONS },
          },
          {
            path: 'buttonAlign',
            label: 'Alinhamento do botão',
            control: {
              kind: 'segmented',
              options: [
                { value: 'left', label: 'Esquerda', icon: 'text-left' },
                { value: 'center', label: 'Centro', icon: 'text-center' },
                { value: 'right', label: 'Direita', icon: 'text-right' },
                { value: 'stretch', label: 'Largura total' },
              ],
            },
          },
          {
            path: 'fieldBackground',
            label: 'Fundo dos campos',
            control: { kind: 'color', allowTokens: true },
          },
        ],
      },
      spacingSection(),
      advancedSection,
    ],
    render: ({
      node,
      attributes,
      editing,
    }: CanvasRenderProps<SiteFormProps>) => {
      const p = node.props
      const token = p.formToken
      if (!token && !editing) return null
      const live: SiteLiveForm | undefined = token
        ? ctx.forms?.[token]
        : undefined
      const fields = live?.fields ?? (token ? p.fields : SAMPLE_FORM_FIELDS)
      const success = live?.successMessage || p.successMessage
      const redirect = safeHref(live?.redirectUrl ?? undefined)
      const action = token
        ? (ctx.formAction ?? defaultFormAction)(token)
        : undefined
      const honeypot = `${node.id}-hp`
      return (
        <form
          {...attributes}
          id={anchorId(p.anchor)}
          className={classNames(node, 's-form')}
          action={action}
          method='post'
          data-site-form=''
          data-success={success}
          data-redirect={redirect}
        >
          {editing && !token && (
            <p className='s-form-empty'>
              Exemplo: escolha um formulário do CRM no painel à direita.
            </p>
          )}
          {fields.map((field) => (
            <FormField
              key={field.key}
              field={field}
              id={`${node.id}-${field.key}`}
              disabled={editing}
            />
          ))}
          <div className='s-hp' aria-hidden='true'>
            <label htmlFor={honeypot}>Não preencha este campo</label>
            <input
              id={honeypot}
              name='company_website'
              tabIndex={-1}
              autoComplete='off'
            />
          </div>
          <p
            className='s-form-status'
            role='status'
            aria-live='polite'
            hidden
          />
          <div className='s-form-actions'>
            <button
              type='submit'
              className={`s-btn s-btn-${p.buttonVariant}`}
              disabled={editing}
            >
              {p.submitLabel || 'Enviar'}
            </button>
          </div>
        </form>
      )
    },
  })
}

/**
 * The only script a published page needs, and only when it has a
 * `site.form`: posts the fields as JSON to the CRM endpoint (with the
 * campaign parameters of the URL), honours the honeypot, then shows the
 * success message or follows the form's redirect. The runtime inlines it
 * once, with the CSP nonce.
 */
export const SITE_FORM_SCRIPT = `(function(){document.addEventListener('submit',function(e){var f=e.target;if(!f||!f.hasAttribute||!f.hasAttribute('data-site-form'))return;e.preventDefault();if(f.getAttribute('data-busy'))return;var hp=f.querySelector('[name=company_website]');if(hp&&hp.value)return;var values={};f.querySelectorAll('[data-field]').forEach(function(el){if(el.type==='checkbox')values[el.name]=el.checked;else if(el.value!=='')values[el.name]=el.value});var q=new URLSearchParams(location.search),c={};if(q.get('ref'))c.ref=q.get('ref');if(q.get('utm_campaign'))c.utmCampaign=q.get('utm_campaign');if(q.get('utm_source'))c.utmSource=q.get('utm_source');var s=f.querySelector('.s-form-status'),b=f.querySelector('[type=submit]');f.setAttribute('data-busy','1');if(b)b.disabled=true;fetch(f.action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:values,campaign:Object.keys(c).length?c:undefined})}).then(function(r){return r.json().catch(function(){return{}}).then(function(j){if(!r.ok||!j||!j.success)throw new Error((j&&(j.message||(j.error&&j.error.message)))||'');})}).then(function(){try{document.dispatchEvent(new CustomEvent('steel:site-form-submitted',{detail:{action:f.action}}))}catch(x){}var to=f.getAttribute('data-redirect');if(to){location.href=to;return}var m=document.createElement('p');m.className='s-form-status';m.setAttribute('role','status');m.textContent=f.getAttribute('data-success')||'Recebemos suas informações. Obrigado!';f.replaceWith(m)}).catch(function(err){if(s){s.hidden=false;s.setAttribute('data-state','error');s.textContent=(err&&err.message)||'Não foi possível enviar. Tente novamente.'}}).finally(function(){f.removeAttribute('data-busy');if(b)b.disabled=false})})})();`
