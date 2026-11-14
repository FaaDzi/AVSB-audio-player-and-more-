import math
from render_logo import render_svg_to_png

def generate_design_b():
    # Design B: "High-Energy Prism Clash"
    # Modern, bold, dynamic geometry built from the ground up:
    # - Solid Sky Cyan "A" with clean athletic lines & 2-pin socket
    # - Solid Deep Crimson "B" with aerodynamic concha curves (solid, no inner holes, true to user sketch)
    # - Central ⚡ Lightning Cutout: a sharp, iconic diagonal slash
    # - Gleaming White 3D bevels framing the lightning cut & top roofs
    # - Built with pure geometric SVG paths (no disjointed polygons, no messy black outlines!)

    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" fill="none">
  <defs>
    <!-- Dark obsidian canvas -->
    <linearGradient id="bgTileB" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#10061E" />
      <stop offset="50%" stop-color="#090312" />
      <stop offset="100%" stop-color="#040108" />
    </linearGradient>

    <!-- Electric Cyan Front Face -->
    <linearGradient id="cyanFront" x1="10%" y1="0%" x2="90%" y2="100%">
      <stop offset="0%" stop-color="#56D6F7" />
      <stop offset="100%" stop-color="#029DD1" />
    </linearGradient>

    <!-- Deep Crimson Front Face -->
    <linearGradient id="crimsonFront" x1="10%" y1="0%" x2="90%" y2="100%">
      <stop offset="0%" stop-color="#C71842" />
      <stop offset="100%" stop-color="#80061E" />
    </linearGradient>

    <!-- Pure Architectural White Bevels -->
    <linearGradient id="whiteRoofB" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#E2EBF4" />
      <stop offset="100%" stop-color="#FFFFFF" />
    </linearGradient>

    <linearGradient id="whiteWallLeft" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#CBD8E6" />
    </linearGradient>

    <linearGradient id="whiteWallRight" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#CBD8E6" />
    </linearGradient>
  </defs>

  <!-- Background tile -->
  <rect x="18" y="18" width="476" height="476" rx="112" fill="url(#bgTileB)" stroke="#221138" stroke-width="2.5" />

  <g id="prismClash" transform="translate(6, -2)">

    <!-- ============================================================
         1. WHITE 3D ROOF FACETS
         ============================================================ -->
    <!-- Roof A -->
    <polygon
      points="132,130  156,104  256,92  232,118"
      fill="url(#whiteRoofB)"
    />

    <!-- Roof B -->
    <path
      d="M 288, 118
         L 312, 92
         C 356, 92 396, 104 430, 128
         L 406, 154
         C 376, 134 340, 126 296, 126
         Z"
      fill="url(#whiteRoofB)"
    />

    <!-- ============================================================
         2. WHITE 3D CHASM WALLS (Framing the Central Lightning Cutout)
         ============================================================ -->
    <!-- Left White Wall (attached to A) -->
    <path
      d="M 232, 118
         L 256, 118
         L 204, 252
         L 272, 238
         L 214, 388
         L 190, 388
         L 248, 238
         L 180, 252
         Z"
      fill="url(#whiteWallLeft)"
    />

    <!-- Right White Wall (attached to B) -->
    <path
      d="M 288, 118
         L 312, 118
         L 260, 252
         L 328, 238
         L 270, 388
         L 246, 388
         L 304, 238
         L 236, 252
         Z"
      fill="url(#whiteWallRight)"
    />

    <!-- ============================================================
         3. FRONT FACE: LETTER "A" (Electric Cyan)
         ============================================================ -->
    <path
      d="M 132, 130
         L 232, 118
         L 180, 252
         L 248, 238
         L 190, 388
         L 142, 388
         L 158, 312
         L 124, 312
         L 96,  388
         L 46,  388
         Z"
      fill="url(#cyanFront)"
    />

    <!-- Audiophile 2-Pin Socket in "A" -->
    <g transform="translate(154, 202) rotate(-14)">
      <rect x="-24" y="-12" width="48" height="24" rx="12" fill="#032545" stroke="#01162B" stroke-width="1.8" />
      <circle cx="-8.5" cy="0" r="3.8" fill="#FBBF24" />
      <circle cx="8.5" cy="0" r="3.8" fill="#FBBF24" />
    </g>

    <!-- ============================================================
         4. FRONT FACE: LETTER "B" (Solid Deep Crimson)
         Aerodynamic concha lobes matching user's sketch
         ============================================================ -->
    <path
      d="M 312, 118
         C 350, 118 386, 128 416, 146
         C 442, 162 452, 186 448, 210
         C 442, 230 422, 242 400, 244
         C 436, 254 466, 280 466, 318
         C 466, 356 432, 386 386, 388
         L 270, 388
         L 328, 238
         L 260, 252
         Z"
      fill="url(#crimsonFront)"
    />

  </g>
</svg>'''
    return svg

if __name__ == '__main__':
    svg_b = generate_design_b()
    svg_file = 'C:/Users/Lenovo/.gemini/antigravity/brain/ae604c30-8b55-4422-afde-bda205c4dced/ground_up_b.svg'
    png_file = 'C:/Users/Lenovo/.gemini/antigravity/brain/ae604c30-8b55-4422-afde-bda205c4dced/ground_up_b.png'
    with open(svg_file, 'w', encoding='utf-8') as f:
        f.write(svg_b)
    render_svg_to_png(svg_file, png_file, 512)
    print("Rendered ground_up_b.png")

