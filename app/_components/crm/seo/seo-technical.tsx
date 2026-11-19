import Link from 'next/link'
import type { TechnicalItemDTO } from '@/src/lib/sites/search/seo-overview'
import { StatusIcon } from '../sites/search/search-ui'

/**
 * Technical checklist aggregated over the pages of a site (title,
 * description, H1, canonical, image alt, broken links, sitemap, robots).
 * Pages that need attention link straight to the editor.
 */
export function SeoTechnical({
  items,
  slug,
  siteId,
}: {
  items: TechnicalItemDTO[]
  slug: string
  siteId: string
}) {
  return (
    <ul className='grid gap-2' data-testid='seo-technical'>
      {items.map((item) => (
        <li
          key={item.id}
          className='flex gap-3 rounded-md border p-3'
          data-check={item.id}
          data-status={item.status}
        >
          <StatusIcon status={item.status} />
          <div className='grid min-w-0 flex-1 gap-1'>
            <p className='font-medium text-sm'>{item.label}</p>
            <p className='text-muted-foreground text-xs'>{item.hint}</p>
            <p className='text-xs'>{item.detail}</p>
            {item.pages.length ? (
              <p className='flex flex-wrap gap-x-2 gap-y-1 text-xs'>
                {item.pages.map((page) => (
                  <Link
                    key={page.id}
                    href={`/${slug}/crm/sites/${siteId}?page=${page.id}`}
                    className='text-primary underline-offset-2 hover:underline'
                  >
                    {page.title}
                  </Link>
                ))}
              </p>
            ) : null}
          </div>
          {item.scope === 'pages' && item.total ? (
            <span className='shrink-0 text-muted-foreground text-xs tabular-nums'>
              {item.passed}/{item.total}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
