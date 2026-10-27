'use client'

import { WhatsAppArchiveList } from '@/app/_components/whatsapp/archive/whatsapp-archive-list'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useWhatsAppArchives } from '@/src/hooks/use-whatsapp-archive'

/**
 * Arquivamento de conversas para bancos (ADR 0052), só OWNER/ADMIN: se está
 * ativo, como o pacote é organizado e os pacotes semanais e completos para
 * baixar. Quem liga é a equipe da Stratus (admin da plataforma).
 */
export function WhatsappSettingsArchive({
  workspaceId,
}: {
  workspaceId: string
}) {
  const isAdmin = useIsPrivileged()
  const overview = useWhatsAppArchives(workspaceId, isAdmin)

  if (!isAdmin) return null

  const data = overview.data
  return (
    <section
      className='max-w-3xl space-y-4'
      aria-labelledby='whatsapp-archive-title'
    >
      <div className='space-y-1'>
        <div className='flex flex-wrap items-center gap-2'>
          <h3 id='whatsapp-archive-title' className='font-medium text-sm'>
            Arquivamento de conversas
          </h3>
          {data ? (
            <Badge variant={data.settings.enabled ? 'default' : 'outline'}>
              {data.settings.enabled ? 'Ativo' : 'Inativo'}
            </Badge>
          ) : null}
        </div>
        <p className='text-muted-foreground text-xs'>
          Pacotes .zip com um PDF por atendimento (conversa × dia), para
          entregar a bancos e auditorias. O semanal sai toda segunda às 02:00
          com a semana anterior; o completo sai no dia 1 às 02:30 com todo o
          histórico até o fim do mês anterior (horário de Brasília).
        </p>
      </div>

      {overview.isLoading ? (
        <Skeleton className='h-24 w-full' />
      ) : overview.isError || !data ? (
        <p className='text-destructive text-sm'>
          Não foi possível carregar o arquivamento.
        </p>
      ) : (
        <>
          {data.settings.enabled ? (
            <dl className='grid gap-x-6 gap-y-2 rounded-lg border p-3 text-xs sm:grid-cols-2'>
              <div className='min-w-0'>
                <dt className='text-muted-foreground'>Organização</dt>
                <dd className='break-all font-mono'>
                  {data.settings.effectiveRootFolderName}
                  /WHATSAPP/data/atendente/contato-data-hora.pdf
                </dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>Guarda</dt>
                <dd>
                  Semanal por {data.retention.weeklyDays} dias; completo por{' '}
                  {data.retention.monthlyMonths} meses
                  {data.offsiteConfigured ? ', com cópia fora do servidor' : ''}
                  .
                </dd>
              </div>
              <div className='sm:col-span-2'>
                <dt className='text-muted-foreground'>Integridade</dt>
                <dd>
                  O arquivo WHATSAPP/INDICE.csv lista cada PDF com data,
                  atendente, contato, telefone, número de mensagens e SHA-256.
                </dd>
              </div>
            </dl>
          ) : (
            <p className='rounded-lg border border-dashed px-3 py-2 text-muted-foreground text-sm'>
              O arquivamento não está ativo neste workspace. Para ativar, fale
              com o suporte da Stratus.
            </p>
          )}
          {data.archives.length > 0 || data.settings.enabled ? (
            <WhatsAppArchiveList archives={data.archives} />
          ) : null}
        </>
      )}
    </section>
  )
}
