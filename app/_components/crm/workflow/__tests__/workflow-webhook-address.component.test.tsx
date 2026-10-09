import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { WorkflowConfigPanel } from '../workflow-config-panel'
import { webhookTriggerPath } from '../workflow-labels'

function noop() {}

// Regression for #64: the webhook trigger showed an address that did not
// match the public route. The UI must show the route that really exists.
describe('webhook trigger address', () => {
  it('should show POST /api/crm/workflows/<token>/trigger', () => {
    render(
      <Sheet open>
        <SheetContent>
          <WorkflowConfigPanel
            selectedId='trigger'
            trigger={{
              id: 'trigger',
              position: { x: 0, y: 0 },
              data: { type: 'webhook', token: 'abc123' },
            }}
            node={null}
            onUpdateTrigger={noop}
            onUpdateNode={noop}
            onDeleteNode={noop}
            onClose={noop}
          />
        </SheetContent>
      </Sheet>,
    )

    expect(
      screen.getByText('Endereço: POST /api/crm/workflows/<token>/trigger'),
    ).toBeTruthy()
    expect(webhookTriggerPath('abc123')).toBe(
      '/api/crm/workflows/abc123/trigger',
    )
  })

  it('should match the public route on disk', () => {
    expect(
      existsSync(
        join(
          process.cwd(),
          'app/api/crm/workflows/[webhookToken]/trigger/route.ts',
        ),
      ),
    ).toBe(true)
  })
})
