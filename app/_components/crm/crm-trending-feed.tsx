'use client'

import {
  Comment01Icon,
  EyeIcon,
  FavouriteIcon,
  Fire02Icon,
  Share08Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import type { TrendingItem } from '@/src/schemas/crm-social-trending.schema'
import type { CrmSocialPlatformDTO } from '@/types/crm-social'

const nf = new Intl.NumberFormat('pt-BR')

const PLATFORM_COLOR: Record<CrmSocialPlatformDTO, string> = {
  FACEBOOK: 'bg-blue-600',
  INSTAGRAM: 'bg-pink-600',
  TIKTOK: 'bg-black',
  YOUTUBE: 'bg-red-600',
  GOOGLE_ANALYTICS: 'bg-amber-600',
  GOOGLE_ADS: 'bg-emerald-600',
}

function TrendingCard({ item, rank }: { item: TrendingItem; rank: number }) {
  const card = (
    <Card className='group relative overflow-hidden p-0'>
      <span className='absolute top-2 left-2 z-10 flex size-6 items-center justify-center rounded-full bg-black/70 font-semibold text-white text-xs'>
        {rank}
      </span>
      <span
        className={`absolute top-2 right-2 z-10 flex size-6 items-center justify-center rounded-full text-white ${PLATFORM_COLOR[item.platform]}`}
      >
        <SteelIcon icon={Fire02Icon} className='size-3.5' />
      </span>
      <div className='aspect-square w-full bg-muted'>
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt={item.caption ?? ''}
            className='size-full object-cover transition-transform group-hover:scale-[1.03]'
          />
        ) : (
          <div className='flex size-full items-center justify-center text-muted-foreground/30'>
            <SteelIcon icon={Fire02Icon} className='size-8' />
          </div>
        )}
        <div className='absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-2 pt-6 pb-1.5 text-[11px] text-white'>
          {item.views !== null ? (
            <span className='flex items-center gap-1 tabular-nums'>
              <SteelIcon icon={EyeIcon} className='size-3' />
              {nf.format(item.views)}
            </span>
          ) : null}
          <span className='flex items-center gap-1 tabular-nums'>
            <SteelIcon icon={FavouriteIcon} className='size-3' />
            {nf.format(item.likes)}
          </span>
          <span className='flex items-center gap-1 tabular-nums'>
            <SteelIcon icon={Comment01Icon} className='size-3' />
            {nf.format(item.comments)}
          </span>
          {item.shares !== null ? (
            <span className='flex items-center gap-1 tabular-nums'>
              <SteelIcon icon={Share08Icon} className='size-3' />
              {nf.format(item.shares)}
            </span>
          ) : null}
        </div>
      </div>
      {item.caption ? (
        <p className='line-clamp-2 px-2.5 py-2 text-sm leading-snug'>
          {item.caption}
        </p>
      ) : null}
    </Card>
  )

  if (!item.permalink) return card
  return (
    <a
      href={item.permalink}
      target='_blank'
      rel='noreferrer'
      className='block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring'
    >
      {card}
    </a>
  )
}

export function CrmTrendingFeed({ workspaceId }: { workspaceId: string }) {
  const { items, isLoading } = useCrmResourceList<TrendingItem>(
    workspaceId,
    'social-trending',
  )

  return (
    <div className='mx-auto w-full max-w-5xl space-y-4'>
      <p className='text-muted-foreground text-sm'>
        Posts, reels e stories publicados hoje na sua conta do Instagram
        conectada (por este workspace ou não), ranqueados por velocidade de
        engajamento: quanto mais views/interações em menos tempo, mais em alta.
        TikTok ainda não tem integração — só Instagram traz dado real por
        enquanto.
      </p>

      {isLoading ? (
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
          <Skeleton className='aspect-square' />
          <Skeleton className='aspect-square' />
          <Skeleton className='aspect-square' />
          <Skeleton className='aspect-square' />
        </div>
      ) : items.length > 0 ? (
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
          {items.map((item, i) => (
            <TrendingCard
              key={`${item.platform}-${item.id}`}
              item={item}
              rank={i + 1}
            />
          ))}
        </div>
      ) : (
        <Card className='px-4 py-10 text-center text-muted-foreground text-sm'>
          <SteelIcon
            icon={Fire02Icon}
            className='mx-auto mb-2 size-6 opacity-60'
          />
          Nenhum post publicado hoje ainda.
        </Card>
      )}
    </div>
  )
}
