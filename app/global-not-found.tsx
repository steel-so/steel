import type { Metadata } from 'next'
import SteelNotFound from './_components/root/steel-not-found'
import { SteelRootLayout } from './_components/root/steel-root'

export const metadata: Metadata = {
  title: 'Página não encontrada | Steel',
  robots: { index: false },
}

/** 404 of URLs that match no route (the app has several root layouts, so
 * there is no single layout to render `not-found.tsx` in). */
export default function GlobalNotFound() {
  return (
    <SteelRootLayout>
      <SteelNotFound />
    </SteelRootLayout>
  )
}
