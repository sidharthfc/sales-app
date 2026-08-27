import { describe, expect, it } from 'vitest'
import { fmt } from './format'

describe('fmt', () => {
  it('falls back to 0 for nullish input', () => {
    expect(fmt(undefined)).toBe('0')
    expect(fmt(null)).toBe('0')
    expect(fmt(0)).toBe('0')
  })

  it('formats numbers below the first grouping threshold without a separator', () => {
    expect(fmt(999)).toBe('999')
  })

  it('drops fractional digits', () => {
    expect(fmt(42.9)).toBe('43')
  })
})
