import math
from render_logo import render_svg_to_png

def generate_design_d():
    # Design D: "The Masterpiece Duel Crest"
    # Ground-up athletic audiophile insignia:
    # - Dynamic 16-degree forward slant
    # - "A" has the iconic spear-point foot, uniform stem, and 2-pin audiophile socket
    # - "B" has smooth aerodynamic concha lobes with golden-ratio curvature
    # - ⚡ Lightning Cutout: bold 32px negative-space chasm
    # - White 3D depth: faceted top roofs and inner canyon walls in brilliant white / platinum
    # - Zero black strokes between facets — seamless vector perfection

    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" fill="none">
  <defs>
    <!-- Background Squircle Canvas -->
    <linearGradient id="bgTileD" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#110622" />
      <stop offset="50%" stop-color="#080210" />
      <stop offset="100%" stop-color="#030006" />
    </linearGradient>

    <!-- Electric Cyan Front Face for Letter A -->
    <linearGradient id="cyanD" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#52D5F7" />
      <stop offset="60%" stop-color="#02A5DC" />
      <stop offset="100%" stop-color="#0180AD" />
    </linearGradient>

    <!-- Deep Crimson Front Face for Letter B -->
    <linearGradient id="crimsonD" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#D61846" />
      <stop offset="60%" stop-color="#9E0B2D" />
      <stop offset="100%" stop-color="#6E041C" />
    </linearGradient>

    <!-- Pristine Architectural White for 3D Facets -->
    <linearGradient id="whiteRoofD" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#E2EAF2" />
      <stop offset="100%" stop-color="#FFFFFF" />
    </linearGradient>

    <linearGradient id="whiteWallLeftD" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="50%" stop-color="#E8EFF6" />
      <stop offset="100%" stop-color="#CBD8E6" />
    </linearGradient>

    <linearGradient id="whiteWallRightD" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="50%" stop-color="#E8EFF6" />
      <stop offset="100%" stop-color="#CBD8E6" />
    </linearGradient>
  </defs>

  <!-- 1. SQUIRCLE ICON TILE -->
  <rect x="18" y="18" width="476" height="476" rx="112" fill="url(#bgTileD)" stroke="#261240" stroke-width="2.5" />

  <g id="masterMark" transform="translate(6, 2)">

    <!-- ============================================================
         2. WHITE 3D ROOF FACETS (Top Isometric Extrusion)
         ============================================================ -->
    <!-- Top Roof of A -->
    <polygon
      points="136,128  160,100  256,88  232,116"
      fill="url(#whiteRoofD)"
    />

    <!-- Top Roof of B -->
    <path
      d="M 288, 116
         L 312, 88
         C 356, 88 396, 100 430, 124
         L 406, 152
         C 376, 132 340, 124 296, 124
         Z"
      fill="url(#whiteRoofD)"
    />

    <!-- ============================================================
         3. WHITE 3D INNER WALLS (Framing the Central Lightning Cutout)
         ============================================================ -->
    <!-- Left White Wall (attached to A's right edge) -->
    <path
      d="M 232, 116
         L 256, 116
         L 204, 252
         L 272, 238
         L 214, 392
         L 190, 392
         L 248, 238
         L 180, 252
         Z"
      fill="url(#whiteWallLeftD)"
    />

    <!-- Right White Wall (attached to B's left edge) -->
    <path
      d="M 288, 116
         L 312, 116
         L 260, 252
         L 328, 238
         L 270, 392
         L 246, 392
         L 304, 238
         L 236, 252
         Z"
      fill="url(#whiteWallRightD)"
    />

    <!-- ============================================================
         4. FRONT FACE: LETTER "A" (Electric Cyan)
         Athletic letterform with spear-foot terminal & 2-pin socket
         ============================================================ -->
    <path
      d="M 136, 128
         L 232, 116
         L 180, 252
         L 248, 238
         L 190, 392
         L 142, 392
         L 158, 316
         L 124, 316
         L 98,  392
         L 46,  392
         L 32,  408
         L 86,  382
         L 100, 340
         Z"
      fill="url(#cyanD)"
    />

    <!-- Audiophile 2-Pin Socket in "A" -->
    <g transform="translate(156, 202) rotate(-14)">
      <!-- Recessed outer socket pill -->
      <rect x="-24" y="-12" width="48" height="24" rx="12" fill="#022442" stroke="#011426" stroke-width="1.6" />
      <!-- Left gold contact pin -->
      <circle cx="-8.5" cy="0" r="3.8" fill="#FBBF24" />
      <circle cx="-8.5" cy="0" r="1.6" fill="#FFFBEB" />
      <!-- Right gold contact pin -->
      <circle cx="8.5" cy="0" r="3.8" fill="#FBBF24" />
      <circle cx="8.5" cy="0" r="1.6" fill="#FFFBEB" />
    </g>

    <!-- ============================================================
         5. FRONT FACE: LETTER "B" (Solid Deep Crimson)
         Sculpted aerodynamic concha lobes with golden-ratio curvature
         ============================================================ -->
    <path
      d="M 312, 116
         C 350, 116 386, 126 416, 144
         C 442, 160 452, 184 448, 208
         C 442, 228 422, 240 400, 242
         C 436, 252 466, 278 466, 316
         C 466, 354 432, 384 386, 388
         C 350, 390 300, 392 246, 392
         L 304, 238
         L 236, 252
         Z"
      fill="url(#crimsonD)"
    />

  </g>
</svg>'''
    return svg

if __name__ == '__main__':
    svg_d = generate_design_d()
    svg_file = 'C:/Users/Lenovo/.gemini/antigravity/brain/ae604c30-8b55-4422-afde-bda205c4dced/ground_up_d.svg'
    png_file = 'C:/Users/Lenovo/.gemini/antigravity/brain/ae604c30-8b55-4422-afde-bda205c4dced/ground_up_d.png'
    with open(svg_file, 'w', encoding='utf-8') as f:
        f.write(svg_d)
    render_svg_to_png(svg_file, png_file, 512)
    print("Rendered ground_up_d.png")

