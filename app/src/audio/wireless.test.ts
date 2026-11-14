import { describe, expect, it } from 'vitest'
import { hasAdaptiveEq, isBluetoothLabel, isHandsFreeLabel, isWirelessName } from './wireless'

describe('wireless earbuds', () => {
  it('recognises true-wireless models by name', () => {
    for (const n of [
      'Apple AirPods Pro',
      'Samsung Galaxy Buds2 Pro',
      'Sony WF-1000XM4 (ANC on)',
      'Sennheiser Momentum True Wireless 3',
      'Hessian TWS7',
      'Nothing ear (2)',
      'QCY T13 ANC2 (ANC on)',
      'Moondrop Space Travel',
      'Moondrop Ultrasonic',
      'Moondrop Moca',
      'Bose QuietComfort Ultra Earbuds',
      'Bowers & Wilkins Pi8',
      'Devialet Gemini',
      'Edifier NeoBuds Pro',
      'FiiO FW5',
      'Final ZE8000',
      'KZ Carol',
      'Soundpeats Air4 Pro',
      'Technics EAH-AZ80',
    ])
      expect(isWirelessName(n), n).toBe(true)
  })
  it('leaves wired IEMs alone, even ones measured with "TWS" tips', () => {
    for (const n of [
      'Moondrop Aria',
      'Final Audio B3 (Final Audio TWS eartips)',
      'Final A10000 (Type E TWS)',
      'Final A6000 (Type E TWS)',
      'Final S4000 (Type E TWS)',
      'Final S5000 (Type E TWS)',
      'Final REB GRID01 (Type E TWS)',
      'Kiwi Ears Orchestra (E-type TWS)',
      'KZ x Crinacle CRN',
      'Sennheiser IE 900',
      'Moondrop Chu 2',
    ])
      expect(isWirelessName(n), n).toBe(false)
  })
  it('spots Bluetooth outputs and the Windows hands-free mode', () => {
    expect(isHandsFreeLabel('Headset (Galaxy Buds2 Pro Hands-Free AG Audio)')).toBe(true)
    expect(isHandsFreeLabel('Headphones (Galaxy Buds2 Pro Stereo)')).toBe(false)
    expect(isBluetoothLabel('Headphones (WF-1000XM4 Stereo)')).toBe(true)
    expect(isBluetoothLabel('Speakers (Realtek(R) Audio)')).toBe(false)
  })

  it('knows which buds retune themselves (adaptive EQ)', () => {
    for (const n of ['Apple AirPods Pro 2', 'Apple AirPods 3', 'Apple AirPods Max', 'Beats Fit Pro', 'Bose QuietComfort Ultra Earbuds', 'Samsung Galaxy Buds3 Pro']) {
      expect(hasAdaptiveEq(n)).toBe(true)
    }
    for (const n of ['Apple AirPods 2', 'Sony WF-1000XM5', 'Moondrop CHU II']) expect(hasAdaptiveEq(n)).toBe(false)
  })
})
