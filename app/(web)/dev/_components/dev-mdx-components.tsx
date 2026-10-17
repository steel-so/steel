import type { MDXComponents } from 'mdx/types'
import {
  buildErrorCatalog,
  type ErrorCatalogGroup,
} from '@/src/lib/dev/error-catalog'
import { SITE_URL } from '@/src/lib/seo/site'

/**
 * Every error code the API can answer with, grouped by HTTP status, from
 * `src/errors/codes.ts` (see `buildErrorCatalog`). Each status is a
 * disclosure so the page stays readable with a few hundred codes.
 */
export function ErrorCodeTable({
  groups = buildErrorCatalog(),
}: {
  groups?: ErrorCatalogGroup[]
}) {
  const total = groups.reduce((sum, group) => sum + group.codes.length, 0)
  return (
    <div className='not-prose my-6 flex flex-col gap-2' data-error-catalog=''>
      <p className='text-sm text-muted-foreground'>
        {total} códigos em {groups.length} status HTTP.
      </p>
      {groups.map((group) => (
        <details
          key={group.status}
          className='rounded-xl border border-border'
          data-status={group.status}
        >
          <summary className='cursor-pointer px-4 py-3 text-sm font-medium'>
            <span className='font-mono'>{group.status}</span> · {group.title}{' '}
            <span className='text-muted-foreground'>
              ({group.codes.length})
            </span>
          </summary>
          <div className='overflow-x-auto border-t border-border'>
            <table className='w-full text-left text-sm'>
              <thead className='text-muted-foreground'>
                <tr>
                  <th scope='col' className='px-4 py-2 font-medium'>
                    Código
                  </th>
                  <th scope='col' className='px-4 py-2 font-medium'>
                    Mensagem padrão
                  </th>
                </tr>
              </thead>
              <tbody>
                {group.codes.map((entry) => (
                  <tr key={entry.code} className='border-t border-border'>
                    <td className='px-4 py-2 align-top'>
                      <code className='break-all font-mono text-xs'>
                        {entry.code}
                      </code>
                    </td>
                    <td className='px-4 py-2 align-top text-muted-foreground'>
                      {entry.message ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  )
}

/** The API's base url on the environment serving the page. */
export function BaseUrl() {
  return <code>{`${SITE_URL}/api`}</code>
}

/** The MCP server's url on the environment serving the page. */
export function McpServerUrl() {
  return <code className='break-all'>{`${SITE_URL}/api/mcp`}</code>
}

export const DEV_MDX_COMPONENTS: MDXComponents = {
  ErrorCodeTable,
  BaseUrl,
  McpServerUrl,
}
