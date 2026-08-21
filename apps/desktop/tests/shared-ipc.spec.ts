import { describe, expect, it } from 'vitest'
import { RELEASE_REPOSITORY, releasePageUrl, UPDATE_FEED } from '../src/shared/ipc.ts'

describe('releasePageUrl', () => {
  it('builds the dsh-v tag URL for a valid version', () => {
    expect(releasePageUrl('0.1.0-rc.7')).toBe(
      'https://github.com/627444640/deepseek-harness/releases/tag/dsh-v0.1.0-rc.7',
    )
  })

  it('refuses versions that could break out of the tag path', () => {
    for (const version of ['0.1.0/../../evil', 'v1 2', 'v1?x=1', 'v1#frag', '']) {
      expect(() => releasePageUrl(version)).toThrow()
    }
  })
})

describe('feed constants', () => {
  it('keeps the repository string derived from the feed', () => {
    expect(UPDATE_FEED.provider).toBe('github')
    expect(RELEASE_REPOSITORY).toBe(`${UPDATE_FEED.owner}/${UPDATE_FEED.repo}`)
  })
})
