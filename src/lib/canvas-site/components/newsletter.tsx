import {
  type CanvasRenderProps,
  defineComponent,
  type InspectorField,
} from '@/src/lib/canvas/registry'
import { NEWSLETTER_SUBSCRIBE_ENDPOINT } from '@/src/lib/newsletter/subscribe-client'
import { CRM_NEWSLETTER_DEFAULT_CONSENT_TEXT } from '@/src/schemas/crm-newsletter.schema'
import type { PublicNewsletterIssueSummaryDTO } from '@/src/schemas/crm-newsletter-archive.schema'
import { SITE_TYPES } from '../constants'
import type { SiteRenderContext } from '../context'
import { classNames } from '../css'
import {
  advancedSection,
  BUTTON_VARIANT_OPTIONS,
  spacingSection,
} from '../inspector'
import {
  type SiteNewsletterIssuesProps,
  type SiteNewsletterSubscribeProps,
  siteNewsletterIssuesSchema,
  siteNewsletterSubscribeSchema,
} from '../schemas-newsletter'

/**
 * Newsletter elements of the site catalog (ADR 0054, slice nl-archive):
 *
 * - `site.newsletter-subscribe`: e-mail (+ optional name) and the consent
 *   checkbox, posted by `SITE_NEWSLETTER_SCRIPT` to
 *   `POST /api/newsletters/subscribe` with `source: 'SITE'` and the site id
 *   as `sourceRef`;
 * - `site.newsletter-issues`: the latest N SENT issues, linking to the
 *   public archive (absolute links: a site may live on its own host).
 *
 * Both point to a newsletter by id; the runtime resolves it into
 * `ctx.newsletters`. A newsletter that is gone (archived, deleted, CRM off)
 * renders nothing on the published page.
 */

const anchorId = (anchor: string | undefined) => anchor || undefined

const DEFAULT_TIME_ZONE = 'America/Sao_Paulo'

export const NEWSLETTER_SUBSCRIBE_COPY = {
  pending: 'Confira seu e-mail: enviamos um link para confirmar a inscrição.',
  active: 'Inscrição feita! As próximas edições chegam no seu e-mail.',
} as const

/** Issues shown in the editor before a newsletter is picked. */
export const SAMPLE_NEWSLETTER_ISSUES: PublicNewsletterIssueSummaryDTO[] = [
  {
    number: 3,
    subject: 'Novidades de outubro',
    slug: 'novidades-de-outubro',
    excerpt: 'O que mudou no produto, os eventos do mês e uma dica rápida.',
    sentAt: '2026-10-01T12:00:00.000Z',
  },
  {
    number: 2,
    subject: 'Bastidores do lançamento',
    slug: 'bastidores-do-lancamento',
    excerpt: 'Como o time preparou a nova versão em três semanas.',
    sentAt: '2026-09-01T12:00:00.000Z',
  },
  {
    number: 1,
    subject: 'Boas-vindas à nossa newsletter',
    slug: 'boas-vindas',
    excerpt: 'Por que começamos e o que você vai receber todo mês.',
    sentAt: '2026-08-01T12:00:00.000Z',
  },
]

function newsletterField(ctx: SiteRenderContext): InspectorField {
  return ctx.newsletterPicker
    ? {
        path: 'newsletterId',
        label: 'Newsletter',
        control: { kind: 'custom', component: ctx.newsletterPicker },
      }
    : {
        path: 'newsletterId',
        label: 'Id da newsletter',
        help: 'Está em CRM › Newsletters.',
        control: { kind: 'text', maxLength: 40 },
      }
}

export function newsletterSubscribeDefinition(ctx: SiteRenderContext) {
  return defineComponent<SiteNewsletterSubscribeProps>({
    type: SITE_TYPES.newsletterSubscribe,
    label: 'Inscrição na newsletter',
    icon: 'newsletterSubscribe',
    category: 'Newsletter',
    keywords: ['newsletter', 'e-mail', 'assinar', 'inscrição', 'lista'],
    propsSchema: siteNewsletterSubscribeSchema,
    defaultProps: () => ({
      newsletterId: '',
      newsletterName: '',
      title: 'Assine a nossa newsletter',
      showName: false,
      submitLabel: 'Assinar',
      layout: 'stacked',
      buttonVariant: 'primary',
    }),
    accepts: false,
    inspector: [
      {
        id: 'content',
        label: 'Newsletter',
        tab: 'content',
        fields: [
          newsletterField(ctx),
          {
            path: 'title',
            label: 'Título',
            help: 'Deixe vazio para não mostrar.',
            control: { kind: 'text', maxLength: 120 },
          },
          {
            path: 'showName',
            label: 'Pedir o nome',
            help: 'Campo opcional; o e-mail é sempre pedido.',
            control: { kind: 'toggle' },
          },
          {
            path: 'submitLabel',
            label: 'Texto do botão',
            control: { kind: 'text', maxLength: 80 },
          },
        ],
      },
      {
        id: 'style',
        label: 'Aparência',
        tab: 'style',
        fields: [
          {
            path: 'layout',
            label: 'E-mail e botão',
            responsive: true,
            control: {
              kind: 'segmented',
              options: [
                { value: 'stacked', label: 'Empilhados' },
                { value: 'inline', label: 'Lado a lado' },
              ],
            },
          },
          {
            path: 'buttonVariant',
            label: 'Estilo do botão',
            control: { kind: 'select', options: BUTTON_VARIANT_OPTIONS },
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
    }: CanvasRenderProps<SiteNewsletterSubscribeProps>) => {
      const p = node.props
      const live = p.newsletterId
        ? ctx.newsletters?.[p.newsletterId]
        : undefined
      if (!live && !editing) return null
      const id = (field: string) => `${node.id}-${field}`
      return (
        <form
          {...attributes}
          id={anchorId(p.anchor)}
          className={classNames(node, 's-form', 's-nl-form')}
          action={live ? NEWSLETTER_SUBSCRIBE_ENDPOINT : undefined}
          method='post'
          data-site-newsletter=''
          data-workspace={live?.workspaceSlug}
          data-newsletter={live?.slug}
          data-site={ctx.siteId}
          data-double-opt-in={live?.doubleOptIn ? 'true' : 'false'}
          data-pending={NEWSLETTER_SUBSCRIBE_COPY.pending}
          data-active={NEWSLETTER_SUBSCRIBE_COPY.active}
        >
          {editing && !live && (
            <p className='s-form-empty'>
              {p.newsletterId
                ? 'Esta newsletter não está mais ativa: escolha outra no painel à direita.'
                : 'Exemplo: escolha uma newsletter do CRM no painel à direita.'}
            </p>
          )}
          {p.title ? <p className='s-nl-title'>{p.title}</p> : null}
          {p.showName ? (
            <div className='s-field s-field-wide'>
              <label className='s-label' htmlFor={id('name')}>
                Nome
              </label>
              <input
                id={id('name')}
                name='name'
                className='s-input'
                autoComplete='name'
                maxLength={200}
                disabled={editing}
              />
            </div>
          ) : null}
          <div className='s-nl-row'>
            <div className='s-field'>
              <label className='s-label' htmlFor={id('email')}>
                E-mail<span aria-hidden='true'> *</span>
              </label>
              <input
                id={id('email')}
                name='email'
                type='email'
                className='s-input'
                autoComplete='email'
                inputMode='email'
                required
                maxLength={254}
                placeholder='voce@empresa.com.br'
                disabled={editing}
              />
            </div>
            <button
              type='submit'
              className={`s-btn s-btn-${p.buttonVariant}`}
              disabled={editing}
            >
              {p.submitLabel || 'Assinar'}
            </button>
          </div>
          <div className='s-field s-field-wide'>
            <label className='s-check' htmlFor={id('consent')}>
              <input
                id={id('consent')}
                name='consent'
                type='checkbox'
                value='true'
                required
                disabled={editing}
              />
              <span>{CRM_NEWSLETTER_DEFAULT_CONSENT_TEXT}</span>
            </label>
          </div>
          <div className='s-hp' aria-hidden='true'>
            <label htmlFor={id('website')}>Não preencha este campo</label>
            <input
              id={id('website')}
              name='website'
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
        </form>
      )
    },
  })
}

export function newsletterIssuesDefinition(ctx: SiteRenderContext) {
  return defineComponent<SiteNewsletterIssuesProps>({
    type: SITE_TYPES.newsletterIssues,
    label: 'Últimas edições',
    icon: 'newsletterIssues',
    category: 'Newsletter',
    keywords: ['newsletter', 'edições', 'arquivo', 'e-mail', 'novidades'],
    propsSchema: siteNewsletterIssuesSchema,
    defaultProps: () => ({
      newsletterId: '',
      newsletterName: '',
      count: 3,
      layout: 'cards',
      columns: { base: '3', mobile: '1' },
      showNumber: true,
      showDate: true,
      showExcerpt: true,
      showArchiveLink: true,
      archiveLinkLabel: 'Ver todas as edições',
      emptyText: 'A primeira edição sai em breve.',
    }),
    accepts: false,
    inspector: [
      {
        id: 'content',
        label: 'Edições',
        tab: 'content',
        fields: [
          newsletterField(ctx),
          {
            path: 'count',
            label: 'Quantas edições',
            control: { kind: 'number', min: 1, max: 12 },
          },
          {
            path: 'showArchiveLink',
            label: 'Link para o arquivo',
            control: { kind: 'toggle' },
          },
          {
            path: 'archiveLinkLabel',
            label: 'Texto do link',
            control: { kind: 'text', maxLength: 80 },
          },
          {
            path: 'emptyText',
            label: 'Texto sem edições',
            control: { kind: 'text', maxLength: 200 },
          },
        ],
      },
      {
        id: 'show',
        label: 'Mostrar',
        tab: 'content',
        fields: [
          { path: 'showNumber', label: 'Número', control: { kind: 'toggle' } },
          { path: 'showDate', label: 'Data', control: { kind: 'toggle' } },
          {
            path: 'showExcerpt',
            label: 'Resumo',
            control: { kind: 'toggle' },
          },
        ],
      },
      {
        id: 'style',
        label: 'Aparência',
        tab: 'style',
        fields: [
          {
            path: 'layout',
            label: 'Formato',
            control: {
              kind: 'segmented',
              options: [
                { value: 'cards', label: 'Cartões' },
                { value: 'list', label: 'Lista' },
              ],
            },
          },
          {
            path: 'columns',
            label: 'Colunas (cartões)',
            responsive: true,
            control: {
              kind: 'segmented',
              options: [
                { value: '1', label: '1' },
                { value: '2', label: '2' },
                { value: '3', label: '3' },
              ],
            },
          },
          {
            path: 'accentColor',
            label: 'Cor do número',
            control: { kind: 'color', allowTokens: true },
          },
          {
            path: 'cardBackground',
            label: 'Fundo dos cartões',
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
    }: CanvasRenderProps<SiteNewsletterIssuesProps>) => {
      const p = node.props
      const live = p.newsletterId
        ? ctx.newsletters?.[p.newsletterId]
        : undefined
      if (!live && !editing) return null
      const issues = (live ? live.issues : SAMPLE_NEWSLETTER_ISSUES).slice(
        0,
        p.count,
      )
      const archiveUrl = live?.archiveEnabled ? live.archiveUrl : undefined
      if (issues.length === 0 && !p.emptyText && !editing) return null
      const date = new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'long',
        timeZone: ctx.timeZone || DEFAULT_TIME_ZONE,
      })
      return (
        <div
          {...attributes}
          id={anchorId(p.anchor)}
          className={classNames(node, 's-nl-issues', `s-nl-${p.layout}`)}
        >
          {editing && !live && (
            <p className='s-form-empty'>
              {p.newsletterId
                ? 'Esta newsletter não está mais ativa: escolha outra no painel à direita.'
                : 'Exemplo: escolha uma newsletter do CRM no painel à direita.'}
            </p>
          )}
          {issues.length === 0 ? (
            <p className='s-nl-empty'>{p.emptyText}</p>
          ) : (
            <ol className='s-nl-items'>
              {issues.map((issue) => (
                <li key={issue.slug}>
                  <a
                    className='s-nl-card'
                    href={
                      archiveUrl ? `${archiveUrl}/${issue.slug}` : undefined
                    }
                  >
                    {p.showNumber || p.showDate ? (
                      <span className='s-nl-meta'>
                        {p.showNumber ? (
                          <span className='s-nl-number'>#{issue.number}</span>
                        ) : null}
                        {p.showNumber && p.showDate ? ' · ' : null}
                        {p.showDate ? (
                          <time dateTime={issue.sentAt}>
                            {date.format(new Date(issue.sentAt))}
                          </time>
                        ) : null}
                      </span>
                    ) : null}
                    <span className='s-nl-subject'>{issue.subject}</span>
                    {p.showExcerpt && issue.excerpt ? (
                      <span className='s-nl-excerpt'>{issue.excerpt}</span>
                    ) : null}
                  </a>
                </li>
              ))}
            </ol>
          )}
          {p.showArchiveLink && (archiveUrl || editing) ? (
            <a className='s-nl-all' href={archiveUrl}>
              {p.archiveLinkLabel || 'Ver todas as edições'}
            </a>
          ) : null}
        </div>
      )
    },
  })
}

/**
 * Runtime script of `site.newsletter-subscribe` (inlined once with the CSP
 * nonce when a page has one): honours the honeypot and the consent box,
 * posts the subscription as JSON (`source: 'SITE'`, `sourceRef: <site id>`)
 * and replaces the form by "confira seu e-mail" or "inscrição feita". Same
 * rules as `parseSubscribeResponse` (src/lib/newsletter/subscribe-client.ts).
 */
export const SITE_NEWSLETTER_SCRIPT = `(function(){var GENERIC='Não foi possível concluir a inscrição. Tente novamente.';document.addEventListener('submit',function(e){var f=e.target;if(!f||!f.hasAttribute||!f.hasAttribute('data-site-newsletter'))return;e.preventDefault();if(f.getAttribute('data-busy'))return;var dbl=f.getAttribute('data-double-opt-in')==='true';function done(p){var m=document.createElement('p');m.className='s-form-status';m.setAttribute('role','status');m.textContent=f.getAttribute(p?'data-pending':'data-active')||'';f.replaceWith(m)}var hp=f.querySelector('[name=website]');if(hp&&hp.value){done(dbl);return}var s=f.querySelector('.s-form-status'),b=f.querySelector('[type=submit]');function fail(t){if(s){s.hidden=false;s.setAttribute('data-state','error');s.textContent=t}}var em=f.querySelector('[name=email]'),nm=f.querySelector('[name=name]'),cs=f.querySelector('[name=consent]');if(cs&&!cs.checked){fail('Marque a autorização para assinar.');return}var body={workspaceSlug:f.getAttribute('data-workspace'),newsletterSlug:f.getAttribute('data-newsletter'),email:em?em.value.trim():'',consent:true,source:'SITE'};if(nm&&nm.value.trim())body.name=nm.value.trim();var site=f.getAttribute('data-site');if(site)body.sourceRef=site;f.setAttribute('data-busy','1');if(b)b.disabled=true;fetch(f.action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().catch(function(){return null}).then(function(j){if(r.ok&&j&&j.success){var d=j.data||{};if(typeof d.requiresConfirmation==='boolean')return done(d.requiresConfirmation);if(d.status==='PENDING'||d.status==='ACTIVE')return done(d.status==='PENDING');return done(dbl)}if(r.status===429)return fail('Muitas tentativas em pouco tempo. Aguarde um instante e tente de novo.');var msg=j&&((j.error&&j.error.message)||j.message);fail(r.status===400&&msg?msg:GENERIC)})}).catch(function(){fail('Sem conexão. Verifique a internet e tente de novo.')}).finally(function(){f.removeAttribute('data-busy');if(b)b.disabled=false})})})();`
