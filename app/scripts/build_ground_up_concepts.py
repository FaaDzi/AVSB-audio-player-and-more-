import os
from render_logo import render_svg_to_png
from PIL import Image

# =============================================================================
# CONCEPT 1: "The Pure Minimalist Clash"
# Clean, modern, Swiss-inspired athletic typography built from the ground up:
# - Slanted 15-degree forward italic
# - Letter "A": Clean athletic stance with uniform 46px stem, open crotch, and recessed 2-pin socket
# - Letter "B": Solid crimson mass with sculpted, continuous golden-ratio aerodynamic concha lobes
# - Central ⚡ Lightning Cutout: Bold, razor-sharp 28px chasm
# - White 3D Depth: Crisp, architectural white bevels framing the cut & top roofs
# =============================================================================
def generate_concept_1():
    return '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" fill="none">
  <defs>
    <!-- Dark obsidian squircle tile -->
    <linearGradient id="c1_bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#10061E" />
      <stop offset="50%" stop-color="#080212" />
      <stop offset="100%" stop-color="#030006" />
    </linearGradient>

    <!-- Vibrant Electric Sky Cyan -->
    <linearGradient id="c1_cyan" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#56D8F8" />
      <stop offset="100%" stop-color="#03A8DF" />
    </linearGradient>

    <!-- Deep Luxurious Crimson / Wine Red -->
    <linearGradient id="c1_crimson" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#D91642" />
      <stop offset="100%" stop-color="#84051E" />
    </linearGradient>

    <!-- Pristine Architectural White for 3D Facets -->
    <linearGradient id="c1_whiteRoof" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#E2EAF2" />
      <stop offset="100%" stop-color="#FFFFFF" />
    </linearGradient>

    <linearGradient id="c1_whiteWallL" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#CBD8E6" />
    </linearGradient>

    <linearGradient id="c1_whiteWallR" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#CBD8E6" />
    </linearGradient>
  </defs>

  <!-- Background tile -->
  <rect x="18" y="18" width="476" height="476" rx="112" fill="url(#c1_bg)" stroke="#221038" stroke-width="2.5" />

  <g id="monolithMark" transform="translate(4, -4)">

    <!-- ============================================================
         1. WHITE 3D ROOF FACETS (Isometric Depth)
         ============================================================ -->
    <!-- Roof A -->
    <polygon
      points="136,134  158,106  256,94  234,122"
      fill="url(#c1_whiteRoof)"
    />

    <!-- Roof B -->
    <path
      d="M 286, 122
         L 308, 94
         C 352, 94 394, 106 428, 130
         L 406, 158
         C 378, 136 340, 128 296, 128
         Z"
      fill="url(#c1_whiteRoof)"
    />

    <!-- ============================================================
         2. WHITE 3D CHASM WALLS (Framing the Central Lightning Cutout)
         ============================================================ -->
    <!-- Left White Wall (attached to A's right edge) -->
    <path
      d="M 234, 122
         L 256, 122
         L 204, 252
         L 272, 238
         L 214, 388
         L 192, 388
         L 250, 238
         L 182, 252
         Z"
      fill="url(#c1_whiteWallL)"
    />

    <!-- Right White Wall (attached to B's left edge) -->
    <path
      d="M 286, 122
         L 308, 122
         L 256, 252
         L 324, 238
         L 266, 388
         L 244, 388
         L 302, 238
         L 234, 252
         Z"
      fill="url(#c1_whiteWallR)"
    />

    <!-- ============================================================
         3. FRONT FACE: LETTER "A" (Electric Cyan)
         Built ground-up with athletic geometry and 2-pin socket
         ============================================================ -->
    <path
      d="M 136, 134
         L 234, 122
         L 182, 252
         L 250, 238
         L 192, 388
         L 144, 388
         L 158, 314
         L 124, 314
         L 98,  388
         L 48,  388
         Z"
      fill="url(#c1_cyan)"
    />

    <!-- Audiophile 2-Pin Socket in "A" -->
    <g transform="translate(156, 204) rotate(-14)">
      <!-- Outer socket pill -->
      <rect x="-24" y="-12" width="48" height="24" rx="12" fill="#02284A" stroke="#01162C" stroke-width="1.8" />
      <!-- Left pin -->
      <circle cx="-8.5" cy="0" r="3.8" fill="#FBBF24" />
      <circle cx="-8.5" cy="0" r="1.6" fill="#FFFBEB" />
      <!-- Right pin -->
      <circle cx="8.5" cy="0" r="3.8" fill="#FBBF24" />
      <circle cx="8.5" cy="0" r="1.6" fill="#FFFBEB" />
    </g>

    <!-- ============================================================
         4. FRONT FACE: LETTER "B" (Solid Deep Crimson)
         Sculpted aerodynamic dual lobes
         ============================================================ -->
    <path
      d="M 308, 122
         C 346, 122 384, 132 414, 150
         C 440, 166 450, 190 446, 214
         C 440, 234 420, 246 398, 248
         C 434, 258 464, 284 464, 320
         C 464, 356 432, 384 386, 388
         L 266, 388
         L 324, 238
         L 256, 252
         Z"
      fill="url(#c1_crimson)"
    />

  </g>
</svg>'''


# =============================================================================
# CONCEPT 2: "The Athletic Esport Crest"
# Slightly more dynamic with sharp spear-point foot on A and tapered base on B:
# =============================================================================
def generate_concept_2():
    return '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" fill="none">
  <defs>
    <!-- Dark obsidian squircle tile -->
    <linearGradient id="c2_bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#120624" />
      <stop offset="50%" stop-color="#090312" />
      <stop offset="100%" stop-color="#040108" />
    </linearGradient>

    <!-- Vibrant Electric Cyan -->
    <linearGradient id="c2_cyan" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4EE0FA" />
      <stop offset="100%" stop-color="#02A2D6" />
    </linearGradient>

    <!-- Rich Crimson / Ruby Red -->
    <linearGradient id="c2_crimson" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#DE1845" />
      <stop offset="100%" stop-color="#8A0620" />
    </linearGradient>

    <!-- Architectural White 3D Facets -->
    <linearGradient id="c2_whiteRoof" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#E2EAF2" />
      <stop offset="100%" stop-color="#FFFFFF" />
    </linearGradient>

    <linearGradient id="c2_whiteWallL" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#CCD9E8" />
    </linearGradient>

    <linearGradient id="c2_whiteWallR" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#CCD9E8" />
    </linearGradient>
  </defs>

  <!-- Background tile -->
  <rect x="18" y="18" width="476" height="476" rx="112" fill="url(#c2_bg)" stroke="#261240" stroke-width="2.5" />

  <g id="crestMark" transform="translate(6, 0)">

    <!-- ============================================================
         1. WHITE 3D ROOF FACETS
         ============================================================ -->
    <!-- Roof A -->
    <polygon
      points="136,130  160,102  256,90  232,118"
      fill="url(#c2_whiteRoof)"
    />

    <!-- Roof B -->
    <path
      d="M 288, 118
         L 312, 90
         C 356, 90 398, 102 432, 126
         L 408, 154
         C 378, 132 340, 124 296, 124
         Z"
      fill="url(#c2_whiteRoof)"
    />

    <!-- ============================================================
         2. WHITE 3D CHASM WALLS
         ============================================================ -->
    <!-- Left White Wall -->
    <path
      d="M 232, 118
         L 256, 118
         L 204, 252
         L 272, 238
         L 214, 392
         L 190, 392
         L 248, 238
         L 180, 252
         Z"
      fill="url(#c2_whiteWallL)"
    />

    <!-- Right White Wall -->
    <path
      d="M 288, 118
         L 312, 118
         L 260, 252
         L 328, 238
         L 270, 392
         L 246, 392
         L 304, 238
         L 236, 252
         Z"
      fill="url(#c2_whiteWallR)"
    />

    <!-- ============================================================
         3. FRONT FACE: LETTER "A" (With Spear-Point Foot)
         ============================================================ -->
    <path
      d="M 136, 130
         L 232, 118
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
      fill="url(#c2_cyan)"
    />

    <!-- Audiophile 2-Pin Socket in "A" -->
    <g transform="translate(156, 202) rotate(-14)">
      <rect x="-24" y="-12" width="48" height="24" rx="12" fill="#022442" stroke="#011426" stroke-width="1.6" />
      <circle cx="-8.5" cy="0" r="3.8" fill="#FBBF24" />
      <circle cx="-8.5" cy="0" r="1.6" fill="#FFFBEB" />
      <circle cx="8.5" cy="0" r="3.8" fill="#FBBF24" />
      <circle cx="8.5" cy="0" r="1.6" fill="#FFFBEB" />
    </g>

    <!-- ============================================================
         4. FRONT FACE: LETTER "B" (With Aerodynamic Tapered Base)
         ============================================================ -->
    <path
      d="M 312, 118
         C 350, 118 386, 128 416, 146
         C 442, 162 452, 186 448, 210
         C 442, 230 422, 242 400, 244
         C 436, 254 466, 280 466, 318
         C 466, 356 432, 386 386, 390
         C 350, 392 300, 392 246, 392
         L 304, 238
         L 236, 252
         Z"
      fill="url(#c2_crimson)"
    />

  </g>
</svg>'''

if __name__ == '__main__':
    art_dir = 'C:/Users/Lenovo/.gemini/antigravity/brain/ae604c30-8b55-4422-afde-bda205c4dced'
    
    # Generate Concept 1
    svg1 = generate_concept_1()
    with open(f'{art_dir}/concept_1_pure_minimalist.svg', 'w', encoding='utf-8') as f:
        f.write(svg1)
    render_svg_to_png(f'{art_dir}/concept_1_pure_minimalist.svg', f'{art_dir}/concept_1_pure_minimalist.png', 512)
    img1 = Image.open(f'{art_dir}/concept_1_pure_minimalist.png')
    img1.resize((128, 128), Image.Resampling.LANCZOS).save(f'{art_dir}/concept_1_128.png')
    img1.resize((48, 48), Image.Resampling.LANCZOS).save(f'{art_dir}/concept_1_48.png')
    img1.resize((32, 32), Image.Resampling.LANCZOS).save(f'{art_dir}/concept_1_32.png')

    # Generate Concept 2
    svg2 = generate_concept_2()
    with open(f'{art_dir}/concept_2_athletic_crest.svg', 'w', encoding='utf-8') as f:
        f.write(svg2)
    render_svg_to_png(f'{art_dir}/concept_2_athletic_crest.svg', f'{art_dir}/concept_2_athletic_crest.png', 512)
    img2 = Image.open(f'{art_dir}/concept_2_athletic_crest.png')
    img2.resize((128, 128), Image.Resampling.LANCZOS).save(f'{art_dir}/concept_2_128.png')
    img2.resize((48, 48), Image.Resampling.LANCZOS).save(f'{art_dir}/concept_2_48.png')
    img2.resize((32, 32), Image.Resampling.LANCZOS).save(f'{art_dir}/concept_2_32.png')

    print("Successfully built and rendered both Concept 1 and Concept 2!")

