import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/services/site-post-schedule.service', () => ({
  SitePostScheduleService: { publishDue: vi.fn() },
}))

import { SitePostScheduleService } from '@/src/services/site-post-schedule.service'
import { SitePostsJob } from '../queue/jobs'
import { processSitePosts } from '../queue/processors/site-posts'

const publishDue = vi.mocked(SitePostScheduleService.publishDue)
const job = (name: string) => ({ name, id: 'j1' }) as Job

beforeEach(() => {
  publishDue.mockResolvedValue(ok({ published: 0, sites: 0 }))
})

describe('processSitePosts', () => {
  it('publishes the due posts', async () => {
    expect(await processSitePosts(job(SitePostsJob.PublishDue))).toEqual({
      published: 0,
      sites: 0,
    })
    publishDue.mockResolvedValueOnce(ok({ published: 2, sites: 1 }))
    expect(await processSitePosts(job(SitePostsJob.PublishDue))).toEqual({
      published: 2,
      sites: 1,
    })
  })

  it('throws so BullMQ retries, and on unknown jobs', async () => {
    publishDue.mockResolvedValueOnce(err(databaseError()))
    await expect(
      processSitePosts(job(SitePostsJob.PublishDue)),
    ).rejects.toThrow(/Failed to publish due site posts/)
    await expect(processSitePosts({ name: 'x' } as Job)).rejects.toThrow(
      'Unknown site-posts job: x (id=unknown)',
    )
  })
})
