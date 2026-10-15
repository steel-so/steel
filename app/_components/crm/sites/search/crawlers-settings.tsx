'use client'

import { LinkSquare02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useId, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  CRAWLER_INFO,
  CRAWLER_PURPOSE_LABELS,
  type CrawlerPurpose,
  renderSearchRobotsTxt,
} from '@/src/lib/sites/search/robots'
import {
  SITE_CRAWLER_BOTS,
  type SiteCrawlerBot,
  type UpdateSiteSearchSettingsDTO,
} from '@/src/schemas/site-search.schema'
import type { SiteSearchSettingsViewDTO } from '@/types/site-search'

const PURPOSE_HINTS: Record<CrawlerPurpose, string> = {
  search:
    'Trazem visitas: indexam o site para mostrá-lo em resultados e citá-lo em respostas.',
  assistant:
    'Abrem uma página quando alguém pede ao assistente. Não treinam modelos.',
  training:
    'Só alimentam o treino de modelos de IA. Bloquear não tira o site das buscas.',
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target='_blank'
      rel='noopener noreferrer'
      className='inline-flex items-center gap-1 text-primary text-xs underline-offset-4 hover:underline'
    >
      {children}
      <SteelIcon icon={LinkSquare02Icon} className='size-3' />
    </a>
  )
}

/**
 * "Rastreadores e feeds": who may crawl the site (per bot, training vs.
 * search explained), llms.txt, IndexNow, sitemap and the verification tags
 * of Google Search Console and Bing Webmaster Tools.
 */
export function CrawlersSettings({
  view,
  canEdit,
  onSave,
}: {
  view: SiteSearchSettingsViewDTO
  canEdit: boolean
  onSave: (dto: UpdateSiteSearchSettingsDTO) => Promise<boolean>
}) {
  const id = useId()
  const { settings, urls } = view
  const [crawlers, setCrawlers] = useState(settings.crawlers)
  const [notes, setNotes] = useState(settings.llms.notes ?? '')
  const [google, setGoogle] = useState(settings.verification.google ?? '')
  const [bing, setBing] = useState(settings.verification.bing ?? '')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setCrawlers(settings.crawlers)
    setNotes(settings.llms.notes ?? '')
    setGoogle(settings.verification.google ?? '')
    setBing(settings.verification.bing ?? '')
  }, [settings])

  const allowed = (bot: SiteCrawlerBot) => crawlers[bot] !== false
  const purposes: CrawlerPurpose[] = ['search', 'assistant', 'training']

  async function save(dto: UpdateSiteSearchSettingsDTO) {
    setSaving(true)
    await onSave(dto)
    setSaving(false)
  }

  return (
    <div className='grid gap-8' data-testid='crawlers-settings'>
      <fieldset
        disabled={!canEdit || saving}
        className='m-0 grid min-w-0 gap-8 border-0 p-0'
      >
        <section className='grid gap-4'>
          <div>
            <h3 className='font-medium text-sm'>Quem pode ler o site</h3>
            <p className='text-muted-foreground text-xs'>
              Vira o robots.txt do site na próxima publicação.
            </p>
          </div>
          {purposes.map((purpose) => (
            <div key={purpose} className='grid gap-2'>
              <div>
                <p className='font-medium text-xs'>
                  {CRAWLER_PURPOSE_LABELS[purpose]}
                </p>
                <p className='text-muted-foreground text-xs'>
                  {PURPOSE_HINTS[purpose]}
                </p>
              </div>
              <ul className='grid gap-2 sm:grid-cols-2'>
                {SITE_CRAWLER_BOTS.filter(
                  (bot) => CRAWLER_INFO[bot].purpose === purpose,
                ).map((bot) => (
                  <li
                    key={bot}
                    className='flex items-start justify-between gap-3 rounded-md border p-3'
                  >
                    <Label
                      htmlFor={`${id}-${bot}`}
                      className='grid gap-0.5 font-normal'
                    >
                      <span className='font-medium text-sm'>
                        {bot}{' '}
                        <span className='font-normal text-muted-foreground text-xs'>
                          · {CRAWLER_INFO[bot].owner}
                        </span>
                      </span>
                      <span className='text-muted-foreground text-xs'>
                        {CRAWLER_INFO[bot].description}
                      </span>
                    </Label>
                    <Switch
                      id={`${id}-${bot}`}
                      checked={allowed(bot)}
                      onCheckedChange={(checked) =>
                        setCrawlers((current) => {
                          const next = { ...current }
                          if (checked) delete next[bot]
                          else next[bot] = false
                          return next
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <details className='rounded-md border px-3 py-2'>
            <summary className='cursor-pointer text-muted-foreground text-xs'>
              Prévia do robots.txt
            </summary>
            <pre className='mt-2 overflow-x-auto font-mono text-[11px] leading-relaxed'>
              {renderSearchRobotsTxt({
                noindex: false,
                sitemapUrl: urls.sitemap,
                crawlers,
                llmsUrl: settings.llms.enabled ? urls.llms : undefined,
              })}
            </pre>
          </details>
          {canEdit ? (
            <div>
              <Button type='button' onClick={() => void save({ crawlers })}>
                Salvar rastreadores
              </Button>
            </div>
          ) : null}
        </section>

        <section className='grid gap-3'>
          <div className='flex items-start justify-between gap-3'>
            <div>
              <h3 className='font-medium text-sm'>llms.txt</h3>
              <p className='text-muted-foreground text-xs'>
                Resumo do site em Markdown para assistentes de IA: perfil do
                negócio, páginas e perguntas frequentes. Também publica o
                llms-full.txt com o texto de todas as páginas.
              </p>
            </div>
            <Switch
              aria-label='Publicar llms.txt'
              checked={settings.llms.enabled}
              onCheckedChange={(enabled) =>
                void save({
                  llms: { enabled, notes: notes.trim() || undefined },
                })
              }
            />
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor={`${id}-notes`}>Recado para as IAs</Label>
            <Textarea
              id={`${id}-notes`}
              rows={2}
              maxLength={1000}
              value={notes}
              placeholder='Ex.: Atendemos só com agendamento. Preços variam por avaliação.'
              onChange={(event) => setNotes(event.target.value)}
              onBlur={() => {
                if ((settings.llms.notes ?? '') !== notes.trim()) {
                  void save({
                    llms: {
                      enabled: settings.llms.enabled,
                      notes: notes.trim() || undefined,
                    },
                  })
                }
              }}
            />
          </div>
          {view.published ? (
            <div className='flex flex-wrap gap-3'>
              <ExternalLink href={urls.llms}>llms.txt</ExternalLink>
              <ExternalLink href={urls.llmsFull}>llms-full.txt</ExternalLink>
              <ExternalLink href={urls.robots}>robots.txt</ExternalLink>
              <ExternalLink href={urls.sitemap}>sitemap.xml</ExternalLink>
            </div>
          ) : (
            <p className='text-muted-foreground text-xs'>
              Os arquivos ficam disponíveis depois da primeira publicação.
            </p>
          )}
        </section>

        <section className='grid gap-3'>
          <div className='flex items-start justify-between gap-3'>
            <div>
              <h3 className='font-medium text-sm'>IndexNow</h3>
              <p className='text-muted-foreground text-xs'>
                A cada publicação, avisa Bing, Yandex e outros buscadores quais
                páginas mudaram, para indexarem em minutos e não em dias.
              </p>
            </div>
            <Switch
              aria-label='Avisar o IndexNow ao publicar'
              checked={settings.indexNow.enabled}
              onCheckedChange={(enabled) =>
                void save({ indexNow: { enabled } })
              }
            />
          </div>
          {urls.indexNowKey ? (
            <p className='text-muted-foreground text-xs'>
              Arquivo de chave:{' '}
              <ExternalLink href={urls.indexNowKey}>
                indexnow-key.txt
              </ExternalLink>
            </p>
          ) : null}
        </section>

        <section className='grid gap-3'>
          <div>
            <h3 className='font-medium text-sm'>Verificação de propriedade</h3>
            <p className='text-muted-foreground text-xs'>
              Cole só o código (o valor de content) da meta tag que o Google
              Search Console e o Bing Webmaster Tools mostram.
            </p>
          </div>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='grid gap-1.5'>
              <Label htmlFor={`${id}-google`}>Google Search Console</Label>
              <Input
                id={`${id}-google`}
                value={google}
                placeholder='abc123XYZ…'
                onChange={(event) => setGoogle(event.target.value.trim())}
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor={`${id}-bing`}>Bing Webmaster Tools</Label>
              <Input
                id={`${id}-bing`}
                value={bing}
                placeholder='1A2B3C…'
                onChange={(event) => setBing(event.target.value.trim())}
              />
            </div>
          </div>
          {canEdit ? (
            <div>
              <Button
                type='button'
                variant='outline'
                onClick={() =>
                  void save({
                    verification: {
                      google: google || undefined,
                      bing: bing || undefined,
                    },
                  })
                }
              >
                Salvar verificação
              </Button>
            </div>
          ) : null}
        </section>
      </fieldset>
    </div>
  )
}
