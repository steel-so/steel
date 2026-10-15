import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { SITE_DESCRIPTION, SITE_TITLE } from '@/src/lib/seo/site'
import { SteelRootLayout, steelMetadata } from '../_components/root/steel-root'
import { WebShell } from './_components/web-shell'

export const metadata: Metadata = steelMetadata({
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
})

export default function WebLayout({ children }: { children: ReactNode }) {
  return (
    <SteelRootLayout>
      <WebShell>{children}</WebShell>
    </SteelRootLayout>
  )
}
