import { PlusSignIcon } from '@hugeicons-pro/core-stroke-rounded'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  ContextHeader,
  ContextPrimaryAction,
  ContextSidebar,
} from '@/app/_components/navigation/sidebar-context'
import { SteelAiAreaNav } from '@/app/_components/steel-ai/steel-ai-area-nav'
import { SteelAiProvider } from '@/app/_components/steel-ai/steel-ai-context'
import { SteelAiHistory } from '@/app/_components/steel-ai/steel-ai-history'
import { SteelIcon } from '@/components/icon/icon'
import { getAuthSession } from '@/src/lib/auth-session'
import { isPrivilegedRole } from '@/src/services/authz'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Steel AI | Steel',
  description: 'Converse com o Steel AI para consultar e executar tarefas.',
}

export default async function AiLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()

  const firstName = (session.value.user.name ?? '').trim().split(/\s+/)[0] ?? ''

  return (
    <SteelAiProvider
      value={{
        workspaceId: membership.value.workspaceId,
        slug,
        firstName,
        isAdmin: isPrivilegedRole(membership.value.role),
      }}
    >
      <div className='hidden h-full shrink-0 md:block'>
        <ContextSidebar>
          <ContextHeader
            title='Steel AI'
            primaryAction={
              <ContextPrimaryAction
                render={<Link href={`/${slug}/ai`} />}
                nativeButton={false}
              >
                <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
                Novo chat
              </ContextPrimaryAction>
            }
          />
          <div className='-mt-2'>
            <SteelAiAreaNav slug={slug} />
          </div>
          <SteelAiHistory />
        </ContextSidebar>
      </div>
      {children}
    </SteelAiProvider>
  )
}
