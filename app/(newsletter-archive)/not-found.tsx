import { NewsIcon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'

/**
 * 404 of the public newsletter archive: unknown, archived or unpublished
 * newsletter, or an issue that was never sent. Same frame as the archive
 * (no brand: the newsletter is unknown), pt-BR copy.
 */
export default function NewsletterArchiveNotFound() {
  return (
    <div className='flex min-h-screen flex-col bg-background text-foreground'>
      <div aria-hidden='true' className='h-1.5 w-full bg-primary' />
      <main className='mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center sm:px-6'>
        <SteelIcon
          icon={NewsIcon}
          size={36}
          className='text-muted-foreground'
        />
        <h1 className='text-balance font-semibold text-2xl tracking-tight'>
          Newsletter não encontrada
        </h1>
        <p className='max-w-md text-pretty text-muted-foreground text-sm leading-relaxed'>
          O endereço pode estar incorreto, a edição pode ter sido removida ou o
          arquivo desta newsletter não está mais público.
        </p>
      </main>
      <footer className='border-border border-t px-4 py-6 text-center text-muted-foreground text-xs'>
        Publicado com Steel
      </footer>
    </div>
  )
}
