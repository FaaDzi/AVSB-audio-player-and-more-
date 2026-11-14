import math
from render_logo import render_svg_to_png

def generate_design_c():
    # Design C: "The Ultra-Modern Dynamic Duel Badge"
    # Perfectly proportioned, modern minimalist tech monogram
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" fill="none">
  <defs>
    <!-- Deep obsidian squircle tile -->
    <linearGradient id="bgTileC" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#120622" />
      <stop offset="50%" stop-color="#090312" />
      <stop offset="100%" stop-color="#040108" />
    </linearGradient>

    <!-- Electric Cyan Front Face -->
    <linearGradient id="cyanC" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#5EE2FA" />
      <stop offset="100%" stop-color="#029DD1" />
    </linearGradient>

    <!-- Rich Crimson Front Face -->
    <linearGradient id="crimsonC" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#D91848" />
      <stop offset="100%" stop-color="#840722" />
    </linearGradient>

    <!-- Architectural White 3D Extrusion -->
    <linearGradient id="whiteRoofC" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#E2EBF5" />
      <stop offset="100%" stop-color="#FFFFFF" />
    </linearGradient>

    <linearGradient id="whiteWallLeftC" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#D0DDEB" />
    </linearGradient>

    <linearGradient id="whiteWallRightC" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#D0DDEB" />
    </linearGradient>
  </defs>

  <!-- Tile -->
  <rect x="18" y="18" width="476" height="476" rx="112" fill="url(#bgTileC)" stroke="#26123E" stroke-width="2.5" />

  <g id="duelBadgeC" transform="translate(4, -4)">

    <!-- ============================================================
         1. WHITE 3D ROOF FACETS (Isometric Depth)
         ============================================================ -->
    <!-- Roof A -->
    <polygon
      points="136,134  162,104  258,92  232,122"
      fill="url(#whiteRoofC)"
    />

    <!-- Roof B -->
    <path
      d="M 284, 122
         L 310, 92
         C 356, 92 398, 106 432, 130
         L 406, 160
         C 378, 138 340, 130 292, 130
         Z"
      fill="url(#whiteRoofC)"
    />

    <!-- ============================================================
         2. WHITE 3D INNER WALLS (Framing the Lightning Cutout)
         ============================================================ -->
    <!-- Left White Wall on A -->
    <path
      d="M 232, 122
         L 256, 122
         L 204, 252
         L 268, 238
         L 214, 388
         L 190, 388
         L 244, 238
         L 180, 252
         Z"
      fill="url(#whiteWallLeftC)"
    />

    <!-- Right White Wall on B -->
    <path
      d="M 284, 122
         L 308, 122
         L 256, 252
         L 320, 238
         L 266, 388
         L 242, 388
         L 296, 238
         L 232, 252
         Z"
      fill="url(#whiteWallRightC)"
    />

    <!-- ============================================================
         3. FRONT FACE: LETTER "A" (Electric Cyan)
         Athletic spear-foot terminal, clean crotch, 2-pin socket
         ============================================================ -->
    <path
      d="M 136, 134
         L 232, 122
         L 180, 252
         L 244, 238
         L 190, 388
         L 142, 388
         L 156, 314
         L 122, 314
         L 96,  388
         L 52,  388
         L 38,  402
         L 84,  378
         L 100, 334
         Z"
      fill="url(#cyanC)"
    />

    <!-- Audiophile 2-Pin Socket in "A" -->
    <g transform="translate(156, 204) rotate(-14)">
      <!-- Outer socket pill -->
      <rect x="-24" y="-12" width="48" height="24" rx="12" fill="#02284A" stroke="#01162C" stroke-width="1.8" />
      <!-- Left pin -->
      <circle cx="-8.5" cy="0" r="3.8" fill="#FBBF24" />
      <circle cx="-8.5" cy="0" r="1.6" fill="#FFF7CE" />
      <!-- Right pin -->
      <circle cx="8.5" cy="0" r="3.8" fill="#FBBF24" />
      <circle cx="8.5" cy="0" r="1.6" fill="#FFF7CE" />
    </g>

    <!-- ============================================================
         4. FRONT FACE: LETTER "B" (Solid Deep Crimson)
         Sculpted aerodynamic dual lobes (Solid mass, no inner holes)
         ============================================================ -->
    <path
      d="M 308, 122
         C 346, 122 384, 132 414, 150
         C 440, 166 450, 190 446, 214
         C 440, 234 420, 246 398, 248
         C 434, 258 464, 284 464, 320
         C 464, 356 432, 384 386, 388
         L 266, 388
         L 320, 238
         L 256, 252
         Z"
      fill="url(#crimsonC)"
    />

  </g>
</svg>'''
    return svg

if __name__ == '__main__':
    svg_c = generate_design_c()
    svg_file = 'C:/Users/Lenovo/.gemini/antigravity/brain/ae604c30-8b55-4422-afde-bda205c4dced/ground_up_c.svg'
    png_file = 'C:/Users/Lenovo/.gemini/antigravity/brain/ae604c30-8b55-4422-afde-bda205c4dced/ground_up_c.png'
    with open(svg_file, 'w', encoding='utf-8') as f:
        f.write(svg_c)
    render_svg_to_png(svg_file, png_file, 512)
    print("Rendered ground_up_c.png")

