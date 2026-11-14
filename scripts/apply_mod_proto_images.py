import json

with open('app/public/data/images_search.json', 'r', encoding='utf-8') as f:
    images_search = json.load(f)

# 1. Modded units without image -> map to base IEM image
shortbus_ids = [
    'shortbus-audio-fat-earth', 'shortbus-audio-glamdring',
    'shortbus-charmeleon-gold-modded', 'shortbus-charmeleon-gold-no-tape',
    'shortbus-charmeleon-silver-modded', 'shortbus-charmeleon-silver-no-tape',
    'shortbus-eru', 'shortbus-fat-earth', 'shortbus-fat-glam',
    'shortbus-fat-goober', 'shortbus-glamdring', 'shortbus-glamdring-shortbus-glamdring-s2-foam'
]
for sid in shortbus_ids:
    images_search[sid] = {
        'src': 'img/iem/blon-bl03.webp',
        'store': 'Shortbus Audio Mod (Base: BL-03)',
        'title': 'Shortbus Audio Custom Mod'
    }

images_search['sivga-sm100-300-mesh-filter-tri-clarion'] = {
    'src': 'img/iem/sivga-que.webp',
    'store': 'SIVGA Mod (Base: SM100 / Que)',
    'title': 'SIVGA SM100 300 Mesh Mod'
}

# 2. Prototypes without image -> map to base/family unit image
images_search['penon-penon-sample'] = {
    'src': 'img/iem/penon-fan-2.webp',
    'store': 'Penon Pre-production Sample',
    'title': 'Penon Engineering Sample'
}
images_search['penon-penon-sample-3'] = {
    'src': 'img/iem/penon-fan-3.webp',
    'store': 'Penon Pre-production Sample 3',
    'title': 'Penon Engineering Sample 3'
}
images_search['sample-260'] = {
    'src': 'img/iem/sivga-que.webp',
    'store': 'Sivga Sample 260 Prototype',
    'title': 'Sample 260 (Sivga Prototype)'
}

# 3. Famous retail variants
images_search['seeaudio-x-crinacle-yume-midnight'] = {
    'src': 'img/iem/seeaudio-yume.webp',
    'store': 'SeeAudio x Crinacle Yume Midnight',
    'title': 'SeeAudio x Crinacle Yume Midnight'
}
images_search['letshuoer-ej07m-kinda-lava-resin'] = {
    'src': 'img/iem/shuoer-ej07m.webp',
    'store': 'Letshuoer EJ07M Kinda Lava',
    'title': 'Letshuoer EJ07M Kinda Lava Resin'
}
images_search['letshuoer-ej07m-resin'] = {
    'src': 'img/iem/shuoer-ej07m.webp',
    'store': 'Letshuoer EJ07M Resin',
    'title': 'Letshuoer EJ07M Resin'
}
images_search['letshuoer-ej07m-kinda-lava-yellow-custom'] = {
    'src': 'img/iem/shuoer-ej07m.webp',
    'store': 'Letshuoer EJ07M Yellow Custom',
    'title': 'Letshuoer EJ07M Kinda Lava Yellow Custom'
}

with open('app/public/data/images_search.json', 'w', encoding='utf-8') as f:
    json.dump(images_search, f, indent=2, ensure_ascii=False)

print('Updated images_search.json! New count:', len(images_search))

