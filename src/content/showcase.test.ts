import { describe, expect, it } from 'vitest'
import { STORIES, step, storyById } from './showcase'

describe('발표용 미리보기', () => {
  it('두 이야기, 장면 5개씩, 학번·전화번호 같은 숫자는 없다', () => {
    expect(STORIES.map((s) => s.id)).toEqual(['lawyer', 'harvest'])
    for (const s of STORIES) expect(s.scenes).toHaveLength(5)
    expect(JSON.stringify(STORIES)).not.toMatch(/\d{6,}|01[016789]-?\d{3,4}/)
  })
  it('주소의 이야기 이름이 틀리면 첫 이야기', () => {
    expect(storyById('harvest').id).toBe('harvest')
    expect(storyById('nope').id).toBe('lawyer')
    expect(storyById(null).id).toBe('lawyer')
  })
  it('장면 넘기기는 끝에서 처음으로 돈다', () => {
    expect(step(4, 5, 1)).toBe(0)
    expect(step(0, 5, -1)).toBe(4)
    expect(step(2, 5, 1)).toBe(3)
  })
})
