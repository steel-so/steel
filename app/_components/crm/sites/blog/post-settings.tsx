'use client'

import { Add01Icon, Cancel01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useId, useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  type SiteBlogApi,
  siteBlogKeys,
  useSiteAuthors,
  useSiteBlogCategories,
  useSiteBlogTags,
} from '@/src/hooks/use-site-blog'
import { analyzePost } from '@/src/lib/sites/blog/analysis'
import { isoToSiteLocal, siteLocalToIso } from '@/src/lib/sites/blog/format'
import { slugify } from '@/src/lib/sites/slug'
import type {
  SitePostSeoDTO,
  SitePostStatusDTO,
} from '@/src/schemas/site-blog.schema'
import type { SearchContentDTO } from '@/src/schemas/site-search.schema'
import type { SiteDTO } from '@/types/site'
import { MediaPickButton } from '../media-pick-button'
import {
  KeywordFields,
  QuestionsEditor,
  SummaryFields,
} from '../search/search-fields'
import { ScorePill, SEARCH_TONE_VARS } from '../search/search-ui'
import { BlogAuthorsDialog } from './blog-authors-dialog'
import type { PostDraft } from './post-editor'

/**
 * Right panel of the post editor: publication, address, excerpt, cover,
 * author, categories, tags, featured, SEO (shared with Buscadores:
 * focus keyword and the post FAQ) — all applied with the next "Salvar".
 */

const NO_AUTHOR = '__none'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className='grid gap-3 border-b px-4 py-4 last:border-b-0'>
      <h3 className='font-semibold text-sm'>{title}</h3>
      {children}
    </section>
  )
}

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string
  hint?: ReactNode
  htmlFor: string
  children: ReactNode
}) {
  return (
    <div className='grid gap-1.5'>
      <Label htmlFor={htmlFor} className='text-xs'>
        {label}
      </Label>
      {children}
      {hint ? <p className='text-muted-foreground text-xs'>{hint}</p> : null}
    </div>
  )
}

function Counter({ value, max }: { value: string; max: number }) {
  return (
    <span className={value.length > max ? 'text-destructive' : undefined}>
      {value.length}/{max}
    </span>
  )
}

function NewCategoryForm({
  api,
  workspaceId,
  siteId,
  onCreated,
}: {
  api: SiteBlogApi
  workspaceId: string
  siteId: string
  onCreated: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      const category = await api.createCategory({ name: name.trim() })
      await queryClient.invalidateQueries({
        queryKey: siteBlogKeys.categories(workspaceId, siteId),
      })
      onCreated(category.id)
      setName('')
    } catch (error) {
      notify.error(error, 'Não foi possível criar a categoria')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className='flex gap-1.5'>
      <Input
        aria-label='Nova categoria'
        placeholder='Nova categoria'
        value={name}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        className='h-8'
      />
      <Button
        type='submit'
        size='icon-sm'
        variant='outline'
        aria-label='Criar categoria'
        disabled={busy || !name.trim()}
      >
        <SteelIcon icon={Add01Icon} />
      </Button>
    </form>
  )
}

export function PostSettings({
  workspaceId,
  siteId,
  api,
  draft,
  status,
  timezone,
  site,
  onChange,
}: {
  /** Site of the post (Buscadores scores); scores hide without it. */
  site?: Pick<SiteDTO, 'name' | 'settings' | 'url'>
  workspaceId: string
  siteId: string
  api: SiteBlogApi
  draft: PostDraft
  status: SitePostStatusDTO
  timezone?: string
  onChange: (patch: Partial<PostDraft>) => void
}) {
  const id = useId()
  const categories = useSiteBlogCategories(workspaceId, siteId)
  const tags = useSiteBlogTags(workspaceId, siteId)
  const authors = useSiteAuthors(workspaceId, siteId)
  const [tagInput, setTagInput] = useState('')
  const [authorsOpen, setAuthorsOpen] = useState(false)

  const seo = draft.seo
  const setSeo = (patch: Partial<SitePostSeoDTO>) =>
    onChange({ seo: { ...seo, ...patch } })
  const search = seo.search ?? {}
  // The shared Buscadores fields save through this: the patch goes to the
  // draft and is stored with the next "Salvar".
  const saveSearch = async (patch: Partial<SearchContentDTO>) => {
    setSeo({ search: { ...search, ...patch } })
    return true
  }
  const analysis = useMemo(
    () =>
      site
        ? analyzePost({
            post: {
              id: 'post',
              title: draft.title,
              slug: draft.slug,
              seo: {
                ...seo,
                description: seo.description || draft.excerpt || undefined,
              },
              content: draft.content,
            },
            site: { name: site.name, settings: site.settings, url: site.url },
          })
        : null,
    [site, draft.title, draft.slug, draft.excerpt, draft.content, seo],
  )

  const selectedTags = (tags.data ?? []).filter((tag) =>
    draft.tagIds.includes(tag.id),
  )
  function addTag(raw: string) {
    const name = raw.trim()
    if (!name) return
    const slug = slugify(name, 60)
    const existing = (tags.data ?? []).find((tag) => tag.slug === slug)
    if (existing) {
      if (!draft.tagIds.includes(existing.id)) {
        onChange({ tagIds: [...draft.tagIds, existing.id] })
      }
    } else if (
      !draft.newTags.some((tag) => slugify(tag, 60) === slug) &&
      slug
    ) {
      onChange({ newTags: [...draft.newTags, name] })
    }
    setTagInput('')
  }

  const localDate = draft.publishedAt
    ? isoToSiteLocal(draft.publishedAt, timezone)
    : ''

  return (
    <div className='grid'>
      <Section title='Publicação'>
        <Field
          label='Data de publicação'
          htmlFor={`${id}-date`}
          hint={
            status === 'PUBLISHED'
              ? 'Mudar a data não tira o post do ar.'
              : 'Escolha uma data futura e use “Agendar” para publicar sozinho. Vazio publica na hora.'
          }
        >
          <Input
            id={`${id}-date`}
            type='datetime-local'
            value={localDate}
            onChange={(event) =>
              onChange({
                publishedAt: event.target.value
                  ? siteLocalToIso(event.target.value, timezone)
                  : null,
              })
            }
          />
        </Field>
        <div className='flex items-center justify-between gap-3'>
          <Label htmlFor={`${id}-featured`} className='font-normal text-sm'>
            Post em destaque
          </Label>
          <Switch
            id={`${id}-featured`}
            checked={draft.featured}
            onCheckedChange={(featured) => onChange({ featured })}
          />
        </div>
      </Section>

      <Section title='Endereço e resumo'>
        <Field
          label='Endereço'
          htmlFor={`${id}-slug`}
          hint={`/blog/${draft.slug || '…'}`}
        >
          <Input
            id={`${id}-slug`}
            value={draft.slug}
            maxLength={80}
            onChange={(event) =>
              onChange({ slug: slugify(event.target.value, 80) })
            }
          />
        </Field>
        <Field
          label='Resumo'
          htmlFor={`${id}-excerpt`}
          hint={
            <>
              Aparece nos cartões do blog e nos feeds. Vazio usa o início do
              texto. <Counter value={draft.excerpt} max={400} />
            </>
          }
        >
          <Textarea
            id={`${id}-excerpt`}
            rows={3}
            maxLength={400}
            value={draft.excerpt}
            onChange={(event) => onChange({ excerpt: event.target.value })}
          />
        </Field>
      </Section>

      <Section title='Imagem de capa'>
        {draft.coverImageUrl ? (
          <img
            src={draft.coverImageUrl}
            alt=''
            className='aspect-video w-full rounded-md border object-cover'
          />
        ) : (
          <p className='text-muted-foreground text-xs'>
            Sem capa. Ela também vira a imagem do post nas redes sociais.
          </p>
        )}
        <div className='flex flex-wrap gap-2'>
          <MediaPickButton
            workspaceId={workspaceId}
            label={draft.coverImageUrl ? 'Trocar capa' : 'Escolher capa'}
            onPick={(url) => onChange({ coverImageUrl: url })}
          />
          {draft.coverImageUrl ? (
            <Button
              variant='ghost'
              size='sm'
              onClick={() => onChange({ coverImageUrl: null })}
            >
              Remover
            </Button>
          ) : null}
        </div>
        {draft.coverImageUrl ? (
          <Field
            label='Texto alternativo'
            htmlFor={`${id}-alt`}
            hint='Descreva a imagem para quem usa leitor de tela.'
          >
            <Input
              id={`${id}-alt`}
              maxLength={300}
              value={draft.coverImageAlt}
              onChange={(event) =>
                onChange({ coverImageAlt: event.target.value })
              }
            />
          </Field>
        ) : null}
      </Section>

      <Section title='Autor'>
        <Select
          value={draft.authorId ?? NO_AUTHOR}
          onValueChange={(next) =>
            typeof next === 'string' &&
            onChange({ authorId: next === NO_AUTHOR ? null : next })
          }
        >
          <SelectTrigger aria-label='Autor do post' className='w-full'>
            <SelectValue>
              {(value: string | null) =>
                !value || value === NO_AUTHOR
                  ? 'Sem autor'
                  : ((authors.data ?? []).find((item) => item.id === value)
                      ?.name ?? 'Autor')
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_AUTHOR}>Sem autor</SelectItem>
            {(authors.data ?? []).map((author) => (
              <SelectItem key={author.id} value={author.id}>
                {author.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant='outline'
          size='sm'
          className='justify-self-start'
          onClick={() => setAuthorsOpen(true)}
        >
          Gerenciar autores
        </Button>
        <BlogAuthorsDialog
          open={authorsOpen}
          onOpenChange={setAuthorsOpen}
          workspaceId={workspaceId}
          siteId={siteId}
          api={api}
        />
      </Section>

      <Section title='Categorias'>
        {(categories.data ?? []).length === 0 ? (
          <p className='text-muted-foreground text-xs'>
            Nenhuma categoria ainda.
          </p>
        ) : (
          <ul className='grid max-h-48 gap-2 overflow-y-auto'>
            {(categories.data ?? []).map((category) => {
              const checked = draft.categoryIds.includes(category.id)
              const checkboxId = `${id}-cat-${category.id}`
              return (
                <li key={category.id} className='flex items-center gap-2'>
                  <Checkbox
                    id={checkboxId}
                    checked={checked}
                    onCheckedChange={(next) =>
                      onChange({
                        categoryIds: next
                          ? [...draft.categoryIds, category.id]
                          : draft.categoryIds.filter(
                              (item) => item !== category.id,
                            ),
                      })
                    }
                  />
                  <Label htmlFor={checkboxId} className='font-normal text-sm'>
                    {category.name}
                  </Label>
                </li>
              )
            })}
          </ul>
        )}
        <NewCategoryForm
          api={api}
          workspaceId={workspaceId}
          siteId={siteId}
          onCreated={(categoryId) =>
            onChange({ categoryIds: [...draft.categoryIds, categoryId] })
          }
        />
      </Section>

      <Section title='Tags'>
        {selectedTags.length + draft.newTags.length > 0 ? (
          <ul className='flex flex-wrap gap-1.5'>
            {selectedTags.map((tag) => (
              <li key={tag.id}>
                <button
                  type='button'
                  aria-label={`Remover a tag ${tag.name}`}
                  className='inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  onClick={() =>
                    onChange({
                      tagIds: draft.tagIds.filter((item) => item !== tag.id),
                    })
                  }
                >
                  {tag.name}
                  <SteelIcon icon={Cancel01Icon} className='size-3' />
                </button>
              </li>
            ))}
            {draft.newTags.map((name) => (
              <li key={name}>
                <button
                  type='button'
                  aria-label={`Remover a tag ${name}`}
                  className='inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  onClick={() =>
                    onChange({
                      newTags: draft.newTags.filter((item) => item !== name),
                    })
                  }
                >
                  {name}
                  <SteelIcon icon={Cancel01Icon} className='size-3' />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <Input
          aria-label='Adicionar tag'
          placeholder='Digite e tecle Enter'
          value={tagInput}
          maxLength={60}
          list={`${id}-tags`}
          onChange={(event) => setTagInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault()
              addTag(tagInput)
            }
          }}
          onBlur={() => addTag(tagInput)}
          className='h-8'
        />
        <datalist id={`${id}-tags`}>
          {(tags.data ?? []).map((tag) => (
            <option key={tag.id} value={tag.name} />
          ))}
        </datalist>
      </Section>

      <Section title='Buscadores (SEO)'>
        {analysis ? (
          <div className={`flex flex-wrap gap-1.5 ${SEARCH_TONE_VARS}`}>
            <ScorePill score={analysis.seo.score} label='SEO' />
            <ScorePill score={analysis.aeo.score} label='AEO' />
            <ScorePill score={analysis.geo.score} label='GEO' />
          </div>
        ) : null}
        <KeywordFields search={search} onSave={saveSearch} />
        <Field
          label='Título para buscadores'
          htmlFor={`${id}-seo-title`}
          hint={
            <>
              Vazio usa o título do post.{' '}
              <Counter value={seo.title ?? ''} max={60} />
            </>
          }
        >
          <Input
            id={`${id}-seo-title`}
            maxLength={120}
            value={seo.title ?? ''}
            onChange={(event) =>
              setSeo({ title: event.target.value || undefined })
            }
          />
        </Field>
        <Field
          label='Descrição'
          htmlFor={`${id}-seo-description`}
          hint={
            <>
              Vazio usa o resumo.{' '}
              <Counter value={seo.description ?? ''} max={155} />
            </>
          }
        >
          <Textarea
            id={`${id}-seo-description`}
            rows={3}
            maxLength={320}
            value={seo.description ?? ''}
            onChange={(event) =>
              setSeo({ description: event.target.value || undefined })
            }
          />
        </Field>
        <Field
          label='Imagem para redes sociais'
          htmlFor={`${id}-og`}
          hint='Vazio usa a capa.'
        >
          <div className='flex flex-wrap items-center gap-2'>
            <MediaPickButton
              workspaceId={workspaceId}
              label={seo.socialImageUrl ? 'Trocar imagem' : 'Escolher imagem'}
              onPick={(url) => setSeo({ socialImageUrl: url })}
            />
            {seo.socialImageUrl ? (
              <Button
                id={`${id}-og`}
                variant='ghost'
                size='sm'
                onClick={() => setSeo({ socialImageUrl: undefined })}
              >
                Remover
              </Button>
            ) : null}
          </div>
        </Field>
        <div className='flex items-center justify-between gap-3'>
          <Label htmlFor={`${id}-noindex`} className='font-normal text-sm'>
            Esconder dos buscadores
          </Label>
          <Switch
            id={`${id}-noindex`}
            checked={Boolean(seo.noindex)}
            onCheckedChange={(noindex) =>
              setSeo({ noindex: noindex || undefined })
            }
          />
        </div>
        <Field
          label='Endereço canônico'
          htmlFor={`${id}-canonical`}
          hint='Só quando o conteúdo foi publicado primeiro em outro site.'
        >
          <Input
            id={`${id}-canonical`}
            type='url'
            placeholder='https://'
            maxLength={2000}
            value={seo.canonicalUrl ?? ''}
            onChange={(event) =>
              setSeo({ canonicalUrl: event.target.value || undefined })
            }
          />
        </Field>
      </Section>

      <Section title='Perguntas e resumo (AEO/GEO)'>
        <p className='text-muted-foreground text-xs'>
          As perguntas aparecem no fim do post e nos resultados de busca (FAQ).
          Aplicadas ao salvar o post.
        </p>
        <QuestionsEditor
          questions={search.questions ?? []}
          onSave={saveSearch}
        />
        <SummaryFields search={search} onSave={saveSearch} />
      </Section>
    </div>
  )
}
