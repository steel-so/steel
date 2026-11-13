import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import {
  CampaignAudienceCounts,
  CampaignAudienceStep,
} from '../campaign-audience-step'
import { type CampaignDraft, draftFromCampaign } from '../campaign-draft'
import { campaign, options, WS } from './fixtures'

const COUNTS = {
  total: 12,
  email: { reachable: 9, optedOut: 2, missing: 1 },
  whatsapp: { reachable: 4, optedOut: 1, missing: 7 },
}

describe('CampaignAudienceCounts', () => {
  it('should show reach, opt-outs and missing contacts per channel', () => {
    render(
      <CampaignAudienceCounts
        counts={COUNTS}
        whatsappEnabled
        loading={false}
      />,
    )
    const section = screen.getByRole('region', { name: 'Alcance do público' })
    expect(section.textContent).toContain('12 contato(s) no público')
    expect(section.textContent).toContain(
      '9 alcançáveis · 2 descadastrados · 1 sem e-mail',
    )
    expect(section.textContent).toContain(
      '4 alcançáveis · 1 descadastrados · 7 sem WhatsApp',
    )
  })

  it('should hide WhatsApp when the add-on is off', () => {
    render(
      <CampaignAudienceCounts
        counts={COUNTS}
        whatsappEnabled={false}
        loading={false}
      />,
    )
    expect(screen.queryByText(/sem WhatsApp/)).toBeNull()
  })

  it('should show zeros without data and a skeleton while loading', () => {
    const { container, rerender } = render(
      <CampaignAudienceCounts
        counts={undefined}
        whatsappEnabled={false}
        loading={false}
      />,
    )
    expect(container.textContent).toContain('0 contato(s)')
    rerender(
      <CampaignAudienceCounts counts={undefined} whatsappEnabled loading />,
    )
    expect(screen.queryByRole('region')).toBeNull()
  })
})

describe('CampaignAudienceStep', () => {
  function setup(initial: CampaignDraft) {
    const spy = mockFetch([
      {
        method: 'POST',
        match: '/crm/campaigns/audience-preview',
        data: COUNTS,
      },
    ])
    const onChange = vi.fn()
    function Harness() {
      const [draft, setDraft] = useState(initial)
      return (
        <CampaignAudienceStep
          workspaceId={WS}
          draft={draft}
          options={options()}
          onChange={(patch) => {
            onChange(patch)
            setDraft((d) => ({ ...d, ...patch }))
          }}
        />
      )
    }
    renderWithQuery(<Harness />)
    return { spy, onChange }
  }

  it('should count the audience and recount when a source changes', async () => {
    const { spy, onChange } = setup(
      draftFromCampaign(
        campaign({
          whatsappEnabled: true,
          audience: { mailingListIds: [], allPeople: false, leadStages: [] },
        }),
      ),
    )
    expect(await screen.findByText(/12/)).toBeTruthy()
    expect(fetchBody(spy, '/audience-preview')).toEqual({
      audience: { mailingListIds: [], allPeople: false, leadStages: [] },
      whatsappEnabled: true,
    })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Clientes VIP' }))
    expect(onChange).toHaveBeenLastCalledWith({
      audience: { mailingListIds: ['ml1'], allPeople: false, leadStages: [] },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lead qualificado' }))
    expect(onChange).toHaveBeenLastCalledWith({
      audience: {
        mailingListIds: ['ml1'],
        allPeople: false,
        leadStages: ['QUALIFIED'],
      },
    })
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange.mock.lastCall?.[0].audience.allPeople).toBe(true)
    // Unchecking removes the source again.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Clientes VIP' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Lead qualificado' }))
    expect(onChange.mock.lastCall?.[0].audience).toEqual({
      mailingListIds: [],
      allPeople: true,
      leadStages: [],
    })
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(1))
    // One legal basis covers every channel, WhatsApp included.
    expect(screen.getByLabelText('Base legal (LGPD)')).toBeTruthy()
    expect(screen.queryByText('WhatsApp', { selector: 'label' })).toBeNull()
  })
})
