import { describe, expect, it, vi } from 'vitest'
import { onReportsChanged, reportsChanged } from './reportsBus'

describe('reportsBus', () => {
  it('듣는 쪽 모두에게 알리고, 그만 들으면 더는 부르지 않는다', () => {
    const a = vi.fn()
    const b = vi.fn()
    const stopA = onReportsChanged(a)
    const stopB = onReportsChanged(b)
    reportsChanged()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    stopA()
    reportsChanged()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
    stopB()
  })
})
