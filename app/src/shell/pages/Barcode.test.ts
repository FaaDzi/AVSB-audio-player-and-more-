import { describe, expect, it } from 'vitest'
import { barcodeModules } from './Barcode'

describe('barcodeModules', () => {
  it('builds 95 modules with the guard bars in place', () => {
    const bars = barcodeModules('886443927087')
    expect(bars).toHaveLength(95)
    expect(bars?.startsWith('101')).toBe(true)
    expect(bars?.endsWith('101')).toBe(true)
    expect(bars?.slice(45, 50)).toBe('01010')
  })
  it('encodes a known UPC-A left digit', () => {
    // UPC-A left digits use the L table: 8 is 0110111
    expect(barcodeModules('886443927087')?.slice(3, 10)).toBe('0110111')
  })
  it('refuses anything but 12 or 13 digits', () => {
    expect(barcodeModules('12345')).toBeNull()
    expect(barcodeModules('88644392708X')).toBeNull()
  })
})
