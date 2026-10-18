import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { SteelRootLayout, steelMetadata } from '../_components/root/steel-root'

export const metadata: Metadata = steelMetadata({
  title: 'Entrar no Steel CLI | Steel',
  description: 'Confirme o login do Steel CLI no seu terminal.',
  robots: { index: false, follow: false },
})

export default function DeviceLayout({ children }: { children: ReactNode }) {
  return (
    <SteelRootLayout>
      <main className='min-h-dvh w-full bg-background px-4 py-10 flex items-start justify-center sm:items-center'>
        {children}
      </main>
    </SteelRootLayout>
  )
}
