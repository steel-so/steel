'use client'

import { MobileNavDrawer } from '../navigation/mobile-nav/mobile-nav-drawer'
import { GlobalSearch } from '../search/global-search'
import { TourReplayButton } from '../tours/tour-replay-button'
import { UserDropdownHelper } from '../user/user-dropdown-helper'
import { UserDropdownProfile } from '../user/user-dropdown-profile'
import { WorkSpaceDropdown } from '../workspace/workspace-dropdown/workspace-dropdown-selector'
import { HeaderInboxButton } from './header-inbox-button'

export function UserHeader({
  slug,
  workspaceId,
  wikiEnabled = false,
  whiteboardEnabled = false,
}: {
  slug: string
  workspaceId: string
  wikiEnabled?: boolean
  whiteboardEnabled?: boolean
}) {
  // Below `lg`: a row — workspace on the left, then the search icon and the
  // account actions pushed to the right edge. From `lg` up: three columns with
  // equal side tracks, so the search bar sits exactly in the middle of the
  // header whatever the width of either side.
  return (
    <div
      data-slot='user-header'
      className='flex w-full min-h-11 items-center gap-1 px-1.5 pt-[env(safe-area-inset-top)] md:px-3.5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(16rem,28rem)_minmax(0,1fr)] lg:gap-3'
    >
      <div className='flex min-w-0 flex-1 items-center gap-0.5 lg:justify-self-start'>
        <MobileNavDrawer
          slug={slug}
          wikiEnabled={wikiEnabled}
          whiteboardEnabled={whiteboardEnabled}
        />
        <div data-tour='app-workspace' className='min-w-0'>
          <WorkSpaceDropdown currentSlug={slug} />
        </div>
      </div>
      {/* Touch targets: 40px below `md`, the compact 32-36px from there up. */}
      <div
        data-slot='user-header-search'
        data-tour='app-search'
        className='flex shrink-0 items-center max-md:[&_[data-slot=button]]:size-10 lg:w-full lg:justify-center'
      >
        <GlobalSearch
          slug={slug}
          workspaceId={workspaceId}
          wikiEnabled={wikiEnabled}
          whiteboardEnabled={whiteboardEnabled}
        />
      </div>
      <div className='flex shrink-0 items-center gap-1 max-md:[&_[data-slot=button]]:size-10 lg:justify-self-end'>
        <TourReplayButton />
        <div data-tour='app-inbox' className='flex'>
          <HeaderInboxButton slug={slug} workspaceId={workspaceId} />
        </div>
        <div data-tour='app-help' className='flex'>
          <UserDropdownHelper />
        </div>
        <UserDropdownProfile />
      </div>
    </div>
  )
}
