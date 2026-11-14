import math
import os
from render_logo import render_svg_to_png

def make_design_1():
    # Design 1: Precision Monolith (Edge-to-edge chiseled facets, no clumsy black outlines)
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" fill="none">
  <defs>
    <!-- Dark obsidian squircle tile background -->
    <linearGradient id="bgTile" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0E061A" />
      <stop offset="50%" stop-color="#0A0413" />
      <stop offset="100%" stop-color="#050109" />
    </linearGradient>

    <!-- Premium matte front face: Electric Cyan for A -->
    <linearGradient id="cyanA" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#40D6FA" />
      <stop offset="100%" stop-color="#05A8DF" />
    </linearGradient>

    <!-- Premium matte front face: Deep Crimson for B -->
    <linearGradient id="crimsonB" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#B8143C" />
      <stop offset="100%" stop-color="#7A0620" />
    </linearGradient>

    <!-- Pristine Architectural White for 3D Roofs & Inner Chasm Walls -->
    <linearGradient id="whiteHighlight" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#EDF3F9" />
      <stop offset="100%" stop-color="#FFFFFF" />
    </linearGradient>

    <linearGradient id="whiteShadeLeft" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#D6E2EE" />
    </linearGradient>

    <linearGradient id="whiteShadeRight" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#D0DCEB" />
    </linearGradient>
  </defs>

  <!-- Squircle Canvas -->
  <rect x="16" y="16" width="480" height="480" rx="108" fill="url(#bgTile)" stroke="#221038" stroke-width="2.5" />

  <g id="badge" transform="translate(6, 4)">

    <!-- ============================================================
         1. WHITE 3D EXTENSION: LETTER "A"
         Top roof & inner chasm walls framing the lightning cutout
         ============================================================ -->
    <!-- Top 3D Roof of A (White) -->
    <polygon
      points="138,124  158,100  250,86  228,110"
      fill="url(#whiteHighlight)"
    />

    <!-- Upper 3D Wall of A along Lightning Cutout (White) -->
    <polygon
      points="228,110  250,86  198,234  176,246"
      fill="url(#whiteShadeLeft)"
    />

    <!-- Shelf 3D Wall of A along Lightning Cutout (White) -->
    <polygon
      points="176,246  198,234  264,222  242,234"
      fill="url(#whiteHighlight)"
    />

    <!-- Lower 3D Wall of A along Lightning Cutout (White) -->
    <polygon
      points="242,234  264,222  192,410  170,410"
      fill="url(#whiteShadeLeft)"
    />


    <!-- ============================================================
         2. WHITE 3D EXTENSION: LETTER "B"
         Top roof & inner chasm walls framing the lightning cutout
         ============================================================ -->
    <!-- Top 3D Roof of B (White) -->
    <path
      d="M 282,86
         L 302,64
         C 344,68 386,80 422,106
         L 402,126
         C 370,104 330,94 282,86 Z"
      fill="url(#whiteHighlight)"
    />

    <!-- Upper 3D Wall of B along Cutout (White) -->
    <polygon
      points="282,86  304,110  252,246  230,234"
      fill="url(#whiteShadeRight)"
    />

    <!-- Shelf 3D Wall of B along Cutout (White) -->
    <polygon
      points="230,234  252,246  318,234  296,222"
      fill="url(#whiteHighlight)"
    />

    <!-- Lower 3D Wall of B along Cutout (White) -->
    <polygon
      points="296,222  318,234  246,410  224,410"
      fill="url(#whiteShadeRight)"
    />


    <!-- ============================================================
         3. FRONT FACE: LETTER "A" (Electric Cyan)
         Modern athletic letterform with 2-pin socket
         ============================================================ -->
    <path
      d="M 228, 110
         L 138, 124
         L 60,  396
         L 50,  410
         L 112, 388
         L 146, 276
         L 186, 276
         L 148, 410
         L 170, 410
         L 242, 234
         L 176, 246
         Z"
      fill="url(#cyanA)"
    />

    <!-- Audiophile 2-Pin Socket in A -->
    <g transform="translate(166, 184) rotate(-14)">
      <rect x="-24" y="-12" width="48" height="24" rx="12" fill="#022B4F" stroke="#001830" stroke-width="1.5" />
      <circle cx="-8" cy="0" r="3.8" fill="#FFC800" />
      <circle cx="8" cy="0" r="3.8" fill="#FFC800" />
    </g>


    <!-- ============================================================
         4. FRONT FACE: LETTER "B" (Deep Crimson)
         Sculpted aerodynamic dual lobes
         ============================================================ -->
    <path
      d="M 304, 110
         C 338, 102 376, 110 408, 128
         C 436, 144 446, 168 442, 192
         C 436, 212 416, 224 394, 226
         C 430, 236 462, 260 464, 296
         C 466, 332 440, 362 396, 372
         C 358, 382 300, 398 246, 410
         L 318, 234
         L 252, 246
         Z"
      fill="url(#crimsonB)"
    />

  </g>
</svg>'''
    return svg

if __name__ == '__main__':
    svg = make_design_1()
    svg_file = 'C:/Users/Lenovo/.gemini/antigravity/brain/ae604c30-8b55-4422-afde-bda205c4dced/design_1.svg'
    png_file = 'C:/Users/Lenovo/.gemini/antigravity/brain/ae604c30-8b55-4422-afde-bda205c4dced/design_1.png'
    with open(svg_file, 'w', encoding='utf-8') as f:
        f.write(svg)
    render_svg_to_png(svg_file, png_file, 512)
    print("Rendered design_1.png")
