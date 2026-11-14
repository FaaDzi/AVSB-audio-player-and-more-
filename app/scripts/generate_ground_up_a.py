import math
from render_logo import render_svg_to_png

# Let's write a script that generates 3 distinctly different, world-class ground-up designs:
# Design A: "The Apex Clash" — Geometric 1:4 slant, clean architectural 3D white bevels, perfect B lobes, 2-pin socket
# Design B: "The Audiophile Shield" — Bold faceted hexagonal/rhomboid lockup with central lightning cut
# Design C: "The Minimalist Monogram" — Ultra-clean Swiss-style modernism with chiseled white chamfer

def generate_design_a():
    # Pure 1:4 slant ratio (dx/dy = 0.25, angle ~ 14.04 degrees)
    # Height: 240px (y from 140 to 380)
    # 3D Extrusion offset: dx = +20, dy = -20
    
    # Baseline: y = 380
    # Waist/Shelf: y = 260
    # Capline: y = 140
    
    # Centerline of Lightning:
    # Top: (265, 120)
    # Upper Zag: (220, 260)
    # Step Right: (285, 250)
    # Bottom: (230, 395)
    
    # White 3D bevel width = 16 px
    # Lightning cutout gap = 24 px
    
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" fill="none">
  <defs>
    <linearGradient id="bgTileA" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0F061C" />
      <stop offset="50%" stop-color="#090312" />
      <stop offset="100%" stop-color="#040108" />
    </linearGradient>

    <!-- Vibrant Electric Sky Cyan -->
    <linearGradient id="cyanA" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38BDF8" />
      <stop offset="100%" stop-color="#0284C7" />
    </linearGradient>

    <!-- Deep Luxurious Crimson / Ruby -->
    <linearGradient id="crimsonA" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#E11D48" />
      <stop offset="100%" stop-color="#9F1239" />
    </linearGradient>

    <!-- Architectural White Facets -->
    <linearGradient id="whiteRoofA" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#E2E8F0" />
      <stop offset="100%" stop-color="#FFFFFF" />
    </linearGradient>

    <linearGradient id="whiteChamferA" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#CBD5E1" />
    </linearGradient>

    <linearGradient id="whiteChamferB" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#CBD5E1" />
    </linearGradient>
  </defs>

  <!-- Background squircle -->
  <rect x="18" y="18" width="476" height="476" rx="112" fill="url(#bgTileA)" stroke="#221138" stroke-width="2" />

  <g id="apexClash" transform="translate(0, -6)">

    <!-- ============================================================
         1. WHITE 3D ROOF FACETS (Top Isometric Extrusion)
         ============================================================ -->
    <!-- Top Roof A (White) -->
    <polygon
      points="130,140  150,118  248,118  228,140"
      fill="url(#whiteRoofA)"
    />

    <!-- Top Roof B (White) -->
    <path
      d="M 288, 140
         L 308, 118
         L 378, 118
         C 408, 118 436, 134 446, 158
         L 426, 178
         C 416, 154 394, 140 368, 140
         Z"
      fill="url(#whiteRoofA)"
    />

    <!-- ============================================================
         2. WHITE 3D CHASM WALLS (Framing the Lightning Cutout)
         ============================================================ -->
    <!-- A's White 3D Inner Chamfer -->
    <polygon
      points="228,140  244,140  204,264  188,264"
      fill="url(#whiteChamferA)"
    />
    <polygon
      points="188,264  204,264  264,250  248,250"
      fill="url(#whiteRoofA)"
    />
    <polygon
      points="248,250  264,250  204,380  188,380"
      fill="url(#whiteChamferA)"
    />

    <!-- B's White 3D Inner Chamfer -->
    <polygon
      points="272,140  288,140  248,264  232,264"
      fill="url(#whiteChamferB)"
    />
    <polygon
      points="232,264  248,264  308,250  292,250"
      fill="url(#whiteRoofA)"
    />
    <polygon
      points="292,250  308,250  248,380  232,380"
      fill="url(#whiteChamferB)"
    />

    <!-- ============================================================
         3. FRONT FACE: LETTER "A" (Electric Cyan)
         Built ground-up: Geometric, athletic, perfectly balanced
         ============================================================ -->
    <!-- Outer Stem & Body of A -->
    <path
      d="M 130, 140
         L 228, 140
         L 188, 264
         L 248, 250
         L 188, 380
         L 138, 380
         L 156, 308
         L 126, 308
         L 100, 380
         L 48,  380
         Z"
      fill="url(#cyanA)"
    />

    <!-- Audiophile 2-Pin Connector Socket in "A" -->
    <g transform="translate(150, 204) rotate(-14)">
      <!-- Socket pill -->
      <rect x="-24" y="-12" width="48" height="24" rx="12" fill="#04233F" stroke="#021424" stroke-width="1.5" />
      <!-- Gold contact pins -->
      <circle cx="-8.5" cy="0" r="3.6" fill="#FBBF24" />
      <circle cx="8.5" cy="0" r="3.6" fill="#FBBF24" />
    </g>

    <!-- ============================================================
         4. FRONT FACE: LETTER "B" (Deep Crimson)
         Built ground-up: Clean aerodynamic dual lobes with perfect curves
         ============================================================ -->
    <path
      d="M 288, 140
         L 368, 140
         C 404, 140 432, 160 432, 194
         C 432, 222 414, 242 386, 248
         C 422, 254 446, 280 446, 318
         C 446, 356 414, 380 372, 380
         L 248, 380
         L 308, 250
         L 248, 264
         Z"
      fill="url(#crimsonA)"
    />

    <!-- Inner counters/openings of B (for authentic B typography) -->
    <!-- Upper inner counter -->
    <path
      d="M 314, 172
         L 358, 172
         C 374, 172 388, 180 388, 196
         C 388, 212 374, 220 358, 220
         L 298, 220
         Z"
      fill="#090312"
      opacity="0.9"
    />
    <!-- Lower inner counter -->
    <path
      d="M 330, 286
         L 364, 286
         C 382, 286 398, 296 398, 316
         C 398, 336 382, 348 364, 348
         L 308, 348
         Z"
      fill="#090312"
      opacity="0.9"
    />

  </g>
</svg>'''
    return svg

if __name__ == '__main__':
    svg_a = generate_design_a()
    svg_file = 'C:/Users/Lenovo/.gemini/antigravity/brain/ae604c30-8b55-4422-afde-bda205c4dced/ground_up_a.svg'
    png_file = 'C:/Users/Lenovo/.gemini/antigravity/brain/ae604c30-8b55-4422-afde-bda205c4dced/ground_up_a.png'
    with open(svg_file, 'w', encoding='utf-8') as f:
        f.write(svg_a)
    render_svg_to_png(svg_file, png_file, 512)
    print("Rendered ground_up_a.png")

