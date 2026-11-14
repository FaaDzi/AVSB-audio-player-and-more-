const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']
const FIRST = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

/** The bar pattern of a UPC-A or EAN-13 number, one character per module. Null for anything else. */
export function barcodeModules(code: string): string | null {
  if (!/^(\d{12}|\d{13})$/.test(code)) return null
  const digits = code.padStart(13, '0').split('').map(Number)
  const left = digits.slice(1, 7).map((d, i) => (FIRST[digits[0]][i] === 'L' ? L : G)[d]).join('')
  const right = digits.slice(7).map((d) => R[d]).join('')
  return `101${left}01010${right}101`
}

export function Barcode({ code }: { code: string }) {
  const modules = barcodeModules(code)
  if (!modules) return null
  return (
    <div className="ms-barcode">
      <svg viewBox={`0 0 ${modules.length} 40`} preserveAspectRatio="none" role="img" aria-label={`Barcode ${code}`}>
        {modules.split('').map((bit, i) => (bit === '1' ? <rect key={i} x={i} width="1" height="40" /> : null))}
      </svg>
      <span>{code}</span>
    </div>
  )
}
