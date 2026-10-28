import type { ReactNode } from 'react'

/** Frame of the public newsletter pages (confirm, unsubscribe, preferences). */
export function NewsletterPublicCard({
  children,
  wide = false,
}: {
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className='flex min-h-screen items-center justify-center bg-muted/30 p-4 sm:p-6'>
      <div
        className={`w-full rounded-xl border border-border bg-card p-6 shadow-sm ${wide ? 'max-w-lg' : 'max-w-md'}`}
      >
        {children}
      </div>
    </div>
  )
}

export function NewsletterInvalidLink({ what }: { what: string }) {
  return (
    <div className='space-y-2'>
      <h1 className='font-semibold text-lg'>Link inválido</h1>
      <p className='text-muted-foreground text-sm'>
        Não conseguimos identificar este link de {what}. Verifique se copiou o
        endereço completo do e-mail recebido.
      </p>
    </div>
  )
}
