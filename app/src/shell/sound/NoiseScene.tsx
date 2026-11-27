// §117/§118: the noise scene from the owner's sketch, as line art in one colour (the theme's accent). `t` is where the
// slider sits, 0 (strongest cancelling: the world dim, the listener in a quiet bubble) to 1 (most ambient). Moving
// right lights the world up from small sounds to big ones, as Sony's slider does: birds, then the car, the city,
// and last the aeroplane. Laid out left to right with nothing overlapping, and inside the frame at every size.

const DIM = 0.14
/**
 * §119: the slider's length is cut evenly into four stages, one per layer (birds, car, city, aeroplane). Inside its
 * stage a layer brightens step by step with every node, so a pair with many settings (Sony's 22) fades each layer in
 * gradually and one with few (Buds2's 5) lights one layer per node.
 */
// §120: `off` is where Off sits on the slider. Left of it (cancelling) closes the bubble and dims the birds; right of
// it (ambient) lights the car, the city and the aeroplane in three even stages across the ambient nodes.
const lit = (t: number, off: number, layer: number) => {
  const p = layer === 0 ? (off > 0 ? t / off : 1) : ((t - off) / Math.max(1e-6, 1 - off)) * 3 - (layer - 1)
  return DIM + (1 - DIM) * Math.min(1, Math.max(0, p))
}

export function NoiseScene({ t, off = 0.25, dim = false }: { t: number; off?: number; dim?: boolean }) {
  const bubble = off > 0 ? Math.max(0, 1 - t / off) : 0
  const arcs = Math.max(0, (t - off) / Math.max(1e-6, 1 - off))
  return (
    <svg className={`ms-noise-scene${dim ? ' dim' : ''}`} viewBox="0 0 400 150" role="img" aria-hidden="true">
      {/* birds: the smallest sounds, first to come in */}
      <g style={{ opacity: lit(t, off, 0) }}>
        <path d="M112 34 q6 -6 12 0 q6 -6 12 0" />
        <path className="thin" d="M144 22 q4 -4 8 0 q4 -4 8 0" />
        <path className="thin" d="M128 50 q4 -4 8 0 q4 -4 8 0" />
      </g>
      {/* car, near, on the road */}
      <g style={{ opacity: lit(t, off, 1) }} transform="translate(112 96)">
        <path d="M0 20 V12 L10 10 L22 0 H52 L64 10 L74 12 V20 Z" />
        <circle cx="16" cy="21" r="6" />
        <circle cx="58" cy="21" r="6" />
      </g>
      {/* city, behind the car and clear of it */}
      <g style={{ opacity: lit(t, off, 2) }}>
        <path d="M204 120 V92 H218 V76 H232 V98 H242 V64 H258 V94 H268 V82 H282 V54 H296 V120" />
        {[[247, 74], [247, 84], [286, 64], [286, 76], [222, 86], [272, 90]].map(([x, y]) => <path key={`${x}-${y}`} className="thin" d={`M${x} ${y} h5`} />)}
      </g>
      {/* aeroplane, farthest, above and right of the city */}
      <g style={{ opacity: lit(t, off, 3) }} transform="translate(306 14)">
        <path d="M0 16 L58 9 L70 2 L76 4 L68 11 L82 13 L82 17 L66 17 L52 24 L45 24 L51 17 L10 19 Z" />
      </g>
      <path className="thin" d="M8 120 H392" style={{ opacity: lit(t, off, 1) }} />
      {/* sound reaching the listener */}
      <g style={{ opacity: arcs }}>
        {[0, 1, 2].map((k) => <path key={k} className={k ? 'thin' : undefined} d={`M${100 - k * 9} ${70 - k * 8} Q${90 - k * 11} 88 ${100 - k * 9} ${106 + k * 8}`} />)}
      </g>
      {/* quiet bubble (cancelling), kept inside the frame */}
      <circle className="thin" cx="56" cy="80" r={46 + bubble * 8} strokeDasharray="6 6" style={{ opacity: bubble }} />
      {/* the listener with headphones, always lit */}
      <g transform="translate(32 40)">
        <path d="M4 80 C4 58 14 48 24 46 C34 48 44 58 44 80" />
        <circle cx="24" cy="24" r="17" />
        <path d="M6 24 C6 2 42 2 42 24" />
        <rect x="2" y="18" width="8" height="15" rx="3" />
        <rect x="38" y="18" width="8" height="15" rx="3" />
      </g>
    </svg>
  )
}
