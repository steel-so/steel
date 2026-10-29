import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import {
  isNewsletterTriggerData,
  WorkflowNewsletterTriggerFields,
} from '../workflow-newsletter-trigger-fields'

const newsletters = [
  { id: 'a', name: 'Novidades', status: 'ACTIVE' },
  { id: 'z', name: 'Arquivada', status: 'ARCHIVED' },
]

describe('isNewsletterTriggerData', () => {
  it('recognizes the newsletter triggers only', () => {
    expect(isNewsletterTriggerData({ type: 'newsletter-subscribed' })).toBe(
      true,
    )
    expect(
      isNewsletterTriggerData({ type: 'record-is-created', entity: 'lead' }),
    ).toBe(false)
  })
})

describe('<WorkflowNewsletterTriggerFields />', () => {
  it('filters by an active newsletter', async () => {
    mockFetch([{ match: '/crm/newsletters', data: newsletters }])
    const onChange = vi.fn()
    renderWithQuery(
      <WorkflowNewsletterTriggerFields
        workspaceId='ws1'
        data={{ type: 'newsletter-subscribed' }}
        onChange={onChange}
      />,
    )
    expect(
      await screen.findByRole('option', { name: 'Novidades' }),
    ).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Arquivada' })).toBeNull()
    expect(screen.queryByLabelText('URL contém (opcional)')).toBeNull()

    fireEvent.change(screen.getByLabelText('Newsletter'), {
      target: { value: 'a' },
    })
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'newsletter-subscribed',
      newsletterId: 'a',
    })
  })

  it('keeps an unavailable selection visible and can go back to any', async () => {
    mockFetch([{ match: '/crm/newsletters', data: newsletters }])
    const onChange = vi.fn()
    renderWithQuery(
      <WorkflowNewsletterTriggerFields
        workspaceId='ws1'
        data={{ type: 'newsletter-issue-opened', newsletterId: 'z' }}
        onChange={onChange}
      />,
    )
    expect(
      await screen.findByRole('option', { name: 'Newsletter indisponível' }),
    ).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Newsletter'), {
      target: { value: '' },
    })
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'newsletter-issue-opened',
      newsletterId: undefined,
    })
  })

  it('edits the URL filter of link clicks', async () => {
    mockFetch([{ match: '/crm/newsletters', data: [] }])
    const onChange = vi.fn()
    renderWithQuery(
      <WorkflowNewsletterTriggerFields
        workspaceId='ws1'
        data={{ type: 'newsletter-link-clicked', urlContains: '/a' }}
        onChange={onChange}
      />,
    )
    const input = screen.getByLabelText('URL contém (opcional)')
    fireEvent.change(input, { target: { value: '/precos' } })
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'newsletter-link-clicked',
      urlContains: '/precos',
    })
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'newsletter-link-clicked',
      urlContains: undefined,
    })
  })
})
