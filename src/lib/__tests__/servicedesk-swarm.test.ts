import { describe, expect, it } from 'vitest'
import { sdSwarmChannelName } from '../servicedesk/swarm'

describe('sdSwarmChannelName', () => {
  it('lowercases the ticket code into a Slack-safe name', () => {
    expect(sdSwarmChannelName('INC-000123')).toBe('swarm-inc-000123')
    expect(sdSwarmChannelName('REQ 5/9')).toBe('swarm-req-5-9')
  })

  it('adds the retry salt and caps the length', () => {
    expect(sdSwarmChannelName('INC-1', 'ab12')).toBe('swarm-inc-1-ab12')
    expect(sdSwarmChannelName('x'.repeat(200))).toHaveLength(80)
  })

  it('falls back when the code has no usable characters', () => {
    expect(sdSwarmChannelName('###')).toBe('swarm-ticket')
  })
})
