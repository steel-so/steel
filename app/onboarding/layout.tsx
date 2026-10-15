import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { HeaderOnboarding } from '@/app/_components/header/onboarding/header-onboarding'
import {
  SteelRootLayout,
  steelMetadata,
} from '@/app/_components/root/steel-root'

export const metadata: Metadata = steelMetadata({
  title: 'Configuração | Steel',
})

export default function OnboardingLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <SteelRootLayout>
      <div className='min-h-screen flex flex-col bg-background'>
        <HeaderOnboarding />
        <div className='flex-1 flex items-center justify-center'>
          {children}
        </div>
      </div>
    </SteelRootLayout>
  )
}
