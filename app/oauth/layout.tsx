import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { SteelRootLayout, steelMetadata } from '../_components/root/steel-root'

export const metadata: Metadata = steelMetadata({
  title: 'Autorizar app | Steel',
  description: 'Autorize um app de IA a acessar o seu workspace no Steel.',
  robots: { index: false, follow: false },
})

export default function OAuthLayout({ children }: { children: ReactNode }) {
  return (
    <SteelRootLayout>
      <main className='min-h-dvh w-full bg-background px-4 py-10 flex items-start justify-center sm:items-center'>
        {children}
      </main>
    </SteelRootLayout>
  )
}
