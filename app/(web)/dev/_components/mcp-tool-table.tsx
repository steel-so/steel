import {
  MCP_TOOL_ACCESS_LABELS,
  MCP_TOOL_KIND_LABELS,
  type McpToolCatalog,
} from '@/src/lib/dev/mcp-tools'

/**
 * The tools the MCP server can offer, grouped by module, from the Steel AI
 * registry (see `buildMcpToolCatalog`). The catalog comes in as a prop so
 * this stays a plain presentational component: the guide page builds it on
 * the server, at build time.
 */
export function McpToolTable({ catalog }: { catalog: McpToolCatalog }) {
  return (
    <div className='not-prose my-6 flex flex-col gap-3' data-mcp-tools=''>
      <p className='text-sm text-muted-foreground'>
        {catalog.readCount} ferramentas de leitura e {catalog.writeCount} de
        escrita. As {catalog.deleteCount} ferramentas de exclusão do Steel AI
        ficam fora do MCP.
      </p>
      {catalog.groups.map((group) => (
        <details
          key={group.label}
          className='rounded-xl border border-border'
          data-module={group.module ?? 'PLATFORM'}
        >
          <summary className='cursor-pointer px-4 py-3 text-sm font-medium'>
            {group.label}{' '}
            <span className='text-muted-foreground'>
              ({group.tools.length})
            </span>
          </summary>
          <div className='overflow-x-auto border-t border-border'>
            <table className='w-full text-left text-sm'>
              <thead className='text-muted-foreground'>
                <tr>
                  <th scope='col' className='px-4 py-2 font-medium'>
                    Ferramenta
                  </th>
                  <th scope='col' className='px-4 py-2 font-medium'>
                    O que faz
                  </th>
                  <th scope='col' className='px-4 py-2 font-medium'>
                    Tipo
                  </th>
                  <th scope='col' className='px-4 py-2 font-medium'>
                    Escopo
                  </th>
                </tr>
              </thead>
              <tbody>
                {group.tools.map((tool) => (
                  <tr
                    key={tool.name}
                    className='border-t border-border'
                    data-access={tool.access}
                  >
                    <td className='px-4 py-2 align-top'>
                      <code className='break-all font-mono text-xs'>
                        {tool.name}
                      </code>
                    </td>
                    <td className='px-4 py-2 align-top text-muted-foreground'>
                      {tool.summary}
                    </td>
                    <td className='px-4 py-2 align-top whitespace-nowrap'>
                      {MCP_TOOL_KIND_LABELS[tool.kind]}
                    </td>
                    <td className='px-4 py-2 align-top'>
                      <span
                        className={
                          tool.access === 'read'
                            ? 'inline-flex rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs whitespace-nowrap'
                            : 'inline-flex rounded-md border border-border px-1.5 py-0.5 font-mono text-xs whitespace-nowrap'
                        }
                      >
                        {MCP_TOOL_ACCESS_LABELS[tool.access]}
                      </span>
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
