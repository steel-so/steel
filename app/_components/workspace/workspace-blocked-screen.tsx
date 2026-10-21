import Link from 'next/link'
import { Button } from '@/components/ui/button'

/**
 * Tela exibida a membros de um workspace suspenso (ou em exclusão) pelo
 * admin global. O motivo interno da suspensão não é mostrado — fica só na
 * auditoria do admin.
 */
export function WorkspaceBlockedScreen({
  workspaceName,
  status,
  otherWorkspaces,
}: {
  workspaceName: string
  status: 'SUSPENDED' | 'DELETING' | 'IP_RESTRICTED'
  otherWorkspaces: { slug: string; name: string }[]
}) {
  const deleting = status === 'DELETING'
  const restricted = status === 'IP_RESTRICTED'

  return (
    <main className='flex min-h-dvh items-center justify-center bg-background px-4 py-10'>
      <div className='w-full max-w-md space-y-5 rounded-xl border border-border bg-card p-6 shadow-xs'>
        <div className='space-y-2'>
          <span className='inline-flex h-5 items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 font-medium text-[11px] text-amber-700 dark:text-amber-400'>
            {deleting
              ? 'Em exclusão'
              : restricted
                ? 'Rede não autorizada'
                : 'Acesso suspenso'}
          </span>
          <h1 className='wrap-break-word font-semibold text-xl tracking-tight'>
            {deleting
              ? `${workspaceName} está sendo excluído`
              : restricted
                ? `${workspaceName} não é acessível desta rede`
                : `${workspaceName} está suspenso`}
          </h1>
          <p className='text-muted-foreground text-sm'>
            {restricted
              ? 'Este workspace só pode ser acessado a partir das redes autorizadas pela sua empresa. Conecte-se à rede ou à VPN corporativa e tente novamente.'
              : deleting
                ? 'Este workspace foi encerrado e os dados estão sendo removidos. Se isso não era esperado, fale com o suporte da Stratus Telecom imediatamente.'
                : 'O acesso a este workspace foi temporariamente bloqueado pela Stratus Telecom. Seus dados continuam guardados. Fale com o suporte ou com o responsável pelo contrato para regularizar.'}
          </p>
        </div>

        {otherWorkspaces.length > 0 && (
          <div className='space-y-2'>
            <p className='font-medium text-muted-foreground text-xs uppercase tracking-wider'>
              Seus outros workspaces
            </p>
            <ul className='divide-y rounded-md border border-border'>
              {otherWorkspaces.map((ws) => (
                <li key={ws.slug}>
                  <Link
                    href={`/${ws.slug}`}
                    className='flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted'
                  >
                    <span className='truncate'>{ws.name}</span>
                    <span className='shrink-0 font-mono text-muted-foreground text-xs'>
                      /{ws.slug}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className='flex flex-wrap gap-2'>
          <Button
            variant='outline'
            size='sm'
            nativeButton={false}
            render={
              <a href='mailto:suporte@stratustelecom.com.br'>
                Falar com o suporte
              </a>
            }
          />
          {otherWorkspaces.length === 0 && (
            <Button
              variant='ghost'
              size='sm'
              nativeButton={false}
              render={
                <Link href='/create-workspace'>Criar outro workspace</Link>
              }
            />
          )}
        </div>
      </div>
    </main>
  )
}
