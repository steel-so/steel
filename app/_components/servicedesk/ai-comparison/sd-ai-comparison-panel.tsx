'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  type SdAiComparisonDays,
  useSdAiComparison,
} from '@/src/hooks/use-sd-ai-comparison'
import type { SdAiComparisonDTO } from '@/types/sd-ai-comparison'

/**
 * Painel "IA vs. técnico": o que a IA sugeriu (triagem automática e
 * copiloto) comparado com o que o técnico fez. Cor só por token semântico:
 * o painel mede precisão, não status de chamado.
 */

const PERIODS: SdAiComparisonDays[] = [7, 30, 90]

const usd = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

function pct(value: number | null): string {
  return value === null ? '—' : `${value}%`
}

function Bar({ value }: { value: number | null }) {
  return (
    <div className='flex items-center gap-2'>
      <div
        className='h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted'
        role='img'
        aria-label={value === null ? 'Sem amostra' : `${value}%`}
      >
        <div
          className='h-full rounded-full bg-primary'
          style={{ width: `${value ?? 0}%` }}
        />
      </div>
      <span className='text-xs tabular-nums'>{pct(value)}</span>
    </div>
  )
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className='rounded-xl border bg-card p-4'>
      <p className='text-muted-foreground text-xs'>{label}</p>
      <p className='mt-1 font-semibold text-2xl tabular-nums'>{value}</p>
      {hint ? (
        <p className='mt-1 text-muted-foreground text-xs'>{hint}</p>
      ) : null}
    </div>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className='space-y-2'>
      <div>
        <h2 className='font-semibold text-sm'>{title}</h2>
        {description ? (
          <p className='text-muted-foreground text-xs'>{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className='rounded-xl border border-dashed p-4 text-center text-muted-foreground text-xs'>
      {children}
    </p>
  )
}

function TableBox({ children }: { children: React.ReactNode }) {
  return <div className='overflow-x-auto rounded-xl border'>{children}</div>
}

function Content({ data, slug }: { data: SdAiComparisonDTO; slug: string }) {
  const { summary, usage, preService } = data
  const hasFields = data.fields.some((f) => f.compared > 0)
  const hasTexts = data.texts.some((t) => t.total > 0)

  return (
    <div className='space-y-6'>
      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        <Tile
          label='Precisão da classificação'
          value={pct(summary.accuracy)}
          hint={`${summary.settled} chamados resolvidos conferidos`}
        />
        <Tile
          label='Correções do técnico'
          value={String(summary.corrections)}
          hint='Campos que a IA preencheu e o técnico trocou'
        />
        <Tile
          label='Chamados triados pela IA'
          value={String(summary.triaged)}
          hint={`${summary.awaitingReview} aguardando o técnico`}
        />
        <Tile
          label='Confiança média declarada'
          value={pct(summary.avgConfidence)}
          hint='Compare com a precisão ao lado'
        />
      </div>

      <Section
        title='Precisão por campo'
        description='Sugestão da IA (triagem e copiloto) contra o valor final do chamado. Só entram chamados resolvidos ou fechados.'
      >
        {hasFields ? (
          <TableBox>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campo</TableHead>
                  <TableHead className='text-right'>Comparados</TableHead>
                  <TableHead className='text-right'>Coincidem</TableHead>
                  <TableHead className='text-right'>Corrigidos</TableHead>
                  <TableHead>Precisão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.fields
                  .filter((f) => f.compared > 0)
                  .map((f) => (
                    <TableRow key={f.field}>
                      <TableCell className='font-medium'>{f.label}</TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {f.compared}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {f.matched}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {f.corrected}
                      </TableCell>
                      <TableCell>
                        <Bar value={f.accuracy} />
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <Empty>
            Ainda não há chamados resolvidos que a IA tenha classificado neste
            período.
          </Empty>
        )}
      </Section>

      <Section
        title='Confiança × acerto'
        description='Uma IA bem calibrada acerta mais quando declara mais confiança.'
      >
        <TableBox>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Faixa de confiança</TableHead>
                <TableHead className='text-right'>Chamados</TableHead>
                <TableHead>Acerto real</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.calibration.map((b) => (
                <TableRow key={b.band}>
                  <TableCell>{b.label}</TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {b.tickets}
                  </TableCell>
                  <TableCell>
                    <Bar value={b.accuracy} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableBox>
      </Section>

      <Section
        title='Copiloto: o que o agente aproveitou'
        description='Texto sugerido comparado ao que o agente escreveu: adotado (quase igual), editado (reaproveitado com ajustes) ou não usado.'
      >
        {hasTexts ? (
          <TableBox>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sugestão</TableHead>
                  <TableHead className='text-right'>Entregues</TableHead>
                  <TableHead className='text-right'>Adotadas</TableHead>
                  <TableHead className='text-right'>Editadas</TableHead>
                  <TableHead className='text-right'>Não usadas</TableHead>
                  <TableHead className='text-right'>Pendentes</TableHead>
                  <TableHead>Aproveitamento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.texts.map((t) => (
                  <TableRow key={t.kind}>
                    <TableCell className='font-medium'>{t.label}</TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {t.total}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {t.adopted}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {t.edited}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {t.notUsed}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {t.pending}
                    </TableCell>
                    <TableCell>
                      <Bar value={t.usageRate} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <Empty>
            Nenhuma resposta ou solução foi sugerida pelo copiloto neste
            período.
          </Empty>
        )}
        {data.agents.length > 0 ? (
          <TableBox>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agente</TableHead>
                  <TableHead className='text-right'>
                    Sugestões pedidas
                  </TableHead>
                  <TableHead className='text-right'>Aproveitadas</TableHead>
                  <TableHead>Aproveitamento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.agents.map((a) => (
                  <TableRow key={a.userId}>
                    <TableCell className='font-medium'>{a.name}</TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {a.suggestions}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {a.used}
                    </TableCell>
                    <TableCell>
                      <Bar value={a.usageRate} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        ) : null}
      </Section>

      <Section
        title='Pré-atendimento por IA'
        description='Conversas do portal e do WhatsApp em que a IA atendeu antes de um técnico.'
      >
        <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
          <Tile label='Conversas' value={String(preService.conversations)} />
          <Tile
            label='Resolvidas sem chamado'
            value={String(preService.resolvedByKb)}
            hint={`Taxa de desvio ${pct(preService.deflectionRate)}`}
          />
          <Tile
            label='Viraram chamado'
            value={String(preService.ticketOpened)}
          />
          <Tile label='Abandonadas' value={String(preService.abandoned)} />
        </div>
      </Section>

      <Section
        title='Consumo da cota de IA'
        description='Chamadas do ServiceDesk no período e o custo de cada sugestão aproveitada.'
      >
        <div className='grid grid-cols-2 gap-3 lg:grid-cols-3'>
          <Tile label='Chamadas à IA' value={String(usage.calls)} />
          <Tile label='Custo no período' value={usd.format(usage.costUsd)} />
          <Tile
            label='Custo por sugestão aproveitada'
            value={
              usage.costPerUsedUsd === null
                ? '—'
                : usd.format(usage.costPerUsedUsd)
            }
          />
        </div>
        <TableBox>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Função</TableHead>
                <TableHead className='text-right'>Chamadas</TableHead>
                <TableHead className='text-right'>Custo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.features.map((f) => (
                <TableRow key={f.feature}>
                  <TableCell>{f.label}</TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {f.calls}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {usd.format(f.costUsd)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableBox>
      </Section>

      <Section
        title='Divergências recentes'
        description='Onde o técnico discordou da IA, para revisar prompts e catálogo.'
      >
        {data.divergences.length > 0 ? (
          <TableBox>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Chamado</TableHead>
                  <TableHead>Campo</TableHead>
                  <TableHead>A IA sugeriu</TableHead>
                  <TableHead>O técnico deixou</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.divergences.map((d) => (
                  <TableRow key={`${d.ticketId}-${d.field}-${d.at}`}>
                    <TableCell className='max-w-72'>
                      <Link
                        href={`/${slug}/servicedesk/tickets/${encodeURIComponent(d.code)}`}
                        className='line-clamp-1 hover:underline'
                      >
                        <span className='mr-1.5 font-mono text-muted-foreground text-xs'>
                          {d.code}
                        </span>
                        {d.title}
                      </Link>
                    </TableCell>
                    <TableCell>{d.fieldLabel}</TableCell>
                    <TableCell>{d.suggested}</TableCell>
                    <TableCell>{d.final}</TableCell>
                    <TableCell>
                      <Badge variant={d.appliedByAi ? 'secondary' : 'outline'}>
                        {d.appliedByAi ? 'Corrigido' : 'Divergente'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <Empty>Nenhuma divergência neste período.</Empty>
        )}
      </Section>
    </div>
  )
}

export function SdAiComparisonPanel({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const [days, setDays] = useState<SdAiComparisonDays>(30)
  const { data, isLoading, error } = useSdAiComparison(workspaceId, days)

  return (
    <div className='h-full min-h-0 overflow-auto p-4'>
      <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
        <p className='max-w-2xl text-muted-foreground text-xs'>
          Compara o que a IA sugeriu com o que o técnico fez, para medir a
          precisão e justificar a cota de IA. Nada aqui chama a IA.
        </p>
        <Tabs
          value={String(days)}
          onValueChange={(value) =>
            setDays(Number(value) as SdAiComparisonDays)
          }
        >
          <TabsList>
            {PERIODS.map((period) => (
              <TabsTrigger key={period} value={String(period)}>
                {period} dias
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {isLoading ? (
        <div className='space-y-3'>
          <Skeleton className='h-24 w-full' />
          <Skeleton className='h-48 w-full' />
        </div>
      ) : error ? (
        <Empty>{error.message}</Empty>
      ) : data ? (
        <Content data={data} slug={slug} />
      ) : null}
    </div>
  )
}
