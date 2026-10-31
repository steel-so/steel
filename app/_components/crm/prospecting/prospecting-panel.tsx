'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProspectingDrafts } from './prospecting-drafts'
import { ProspectingSettings } from './prospecting-settings'

/** "Prospecção" page: the review inbox and the settings of the agent. */
export function ProspectingPanel({
  workspaceId,
  slug,
  canManage,
}: {
  workspaceId: string
  slug: string
  canManage: boolean
}) {
  return (
    <div className='flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4'>
      <Tabs defaultValue='drafts'>
        <TabsList>
          <TabsTrigger value='drafts'>Rascunhos</TabsTrigger>
          <TabsTrigger value='settings'>Configurações</TabsTrigger>
        </TabsList>
        <TabsContent value='drafts' className='pt-2'>
          <ProspectingDrafts workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value='settings' className='pt-2'>
          <ProspectingSettings
            workspaceId={workspaceId}
            slug={slug}
            canManage={canManage}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
