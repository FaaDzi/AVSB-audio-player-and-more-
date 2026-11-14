import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from add_iem_image import add_image

items = [
  {
    "id": "hp-apple-airpods-max",
    "name": "Apple AirPods Max",
    "image_url": "https://www.apple.com/v/airpods-max/l/images/meta/airpods-max_overview__c2mz40a3bugm_og.png",
    "source_store": "Apple",
    "source_page": "https://www.apple.com/airpods-max/"
  },
  {
    "id": "hp-akg-k371",
    "name": "AKG K371",
    "image_url": "https://media.sweetwater.com/api/i/q-82,f-auto/images/items/750/K371-large.jpg",
    "source_store": "Sweetwater",
    "source_page": "https://www.sweetwater.com/store/detail/AKGK371--akg-k371-closed-back-folding-studio-headphones"
  },
  {
    "id": "hp-akg-k361",
    "name": "AKG K361",
    "image_url": "https://media.sweetwater.com/api/i/q-82,f-auto/images/items/750/K361-large.jpg",
    "source_store": "Sweetwater",
    "source_page": "https://www.sweetwater.com/store/detail/K361--akg-k361-closed-back-studio-headphones"
  },
  {
    "id": "hp-akg-k240-studio",
    "name": "AKG K240 Studio",
    "image_url": "https://media.sweetwater.com/api/i/q-82,f-auto/images/items/750/K240S-large.jpg",
    "source_store": "Sweetwater",
    "source_page": "https://www.sweetwater.com/store/detail/K240S--akg-k240-studio-semi-open-pro-studio-headphones"
  },
  {
    "id": "hp-akg-k702",
    "name": "AKG K702",
    "image_url": "https://media.sweetwater.com/api/i/q-82,f-auto/images/items/750/K702-large.jpg",
    "source_store": "Sweetwater",
    "source_page": "https://www.sweetwater.com/store/detail/K702--akg-k702-open-back-mastering-reference-headphones"
  },
  {
    "id": "hp-akg-k712-pro",
    "name": "AKG K712 PRO",
    "image_url": "https://media.sweetwater.com/api/i/q-82,f-auto/images/items/750/K712Pro-large.jpg",
    "source_store": "Sweetwater",
    "source_page": "https://www.sweetwater.com/store/detail/K712Pro--akg-k712-pro-open-back-mastering-and-reference-headphones"
  },
  {
    "id": "hp-akg-k612-pro",
    "name": "AKG K612 Pro",
    "image_url": "https://media.sweetwater.com/api/i/q-82,f-auto/images/items/750/K612Pro-large.jpg",
    "source_store": "Sweetwater",
    "source_page": "https://www.sweetwater.com/store/detail/K612Pro--akg-k612-pro-open-back-reference-studio-headphones"
  },
  {
    "id": "hp-akg-k812",
    "name": "AKG K812",
    "image_url": "https://www.thomann.de/thumb/opengraph/pics/prod/328776.jpg",
    "source_store": "Thomann",
    "source_page": "https://www.thomannmusic.com/akg_k_812.htm"
  },
  {
    "id": "hp-akg-k92",
    "name": "AKG K92",
    "image_url": "https://media.sweetwater.com/api/i/q-82,f-auto/images/items/750/K92-large.jpg",
    "source_store": "Sweetwater",
    "source_page": "https://www.sweetwater.com/store/detail/K92--akg-k92-closed-back-monitor-headphones"
  },
  {
    "id": "hp-bose-qc-ultra",
    "name": "Bose QC Ultra Headphones",
    "image_url": "https://media.sweetwater.com/api/i/q-82,f-auto/images/items/750/QCUltraHPBlk-large.jpg",
    "source_store": "Sweetwater",
    "source_page": "https://www.sweetwater.com/store/detail/QCUltraHPBlk--bose-quietcomfort-ultra-headphones-black"
  },
  {
    "id": "hp-bose-noise-cancelling-headphones-700",
    "name": "Bose Noise Cancelling Headphones 700",
    "image_url": "https://media.sweetwater.com/api/i/q-82,f-auto/images/items/750/BoseHP700UCB-large.jpg",
    "source_store": "Sweetwater",
    "source_page": "https://www.sweetwater.com/store/detail/BoseHP700UCB--bose-700-uc-noise-canceling-headphones-black"
  },
  {
    "id": "hp-anker-soundcore-space-q45",
    "name": "Anker Soundcore Space Q45",
    "image_url": "https://cdn.shopify.com/s/files/1/0516/3761/6830/files/A3040G11_64363979-86bd-4bbf-a122-d26fadaa97cd.png",
    "source_store": "soundcore",
    "source_page": "https://us.soundcore.com/products/space-q45-a3040011"
  },
  {
    "id": "hp-audioquest-nighthawk",
    "name": "AudioQuest NightHawk",
    "image_url": "https://images.crutchfieldonline.com/ImageHandler/trim/869/652/products/2015/22/703/g703NHTHAWK-o_front2.jpg",
    "source_store": "Crutchfield",
    "source_page": "https://www.crutchfield.com/p_703NHTHAWK/AudioQuest-NightHawk.html"
  },
  {
    "id": "hp-audioquest-nightowl",
    "name": "AudioQuest NightOwl",
    "image_url": "https://images.crutchfieldonline.com/ImageHandler/trim/869/652/products/2017/6/703/g703NHTOWLC-F.jpg",
    "source_store": "Crutchfield",
    "source_page": "https://www.crutchfield.com/p_703NHTOWL/AudioQuest-NightOwl-Carbon.html"
  },
  {
    "id": "hp-beyerdynamic-t5p",
    "name": "Beyerdynamic T5p",
    "image_url": "https://static.bhphoto.com/images/images500x500/716855.jpg",
    "source_store": "B&H Photo",
    "source_page": "https://www.bhphotovideo.com/c/product/716855-REG/Beyerdynamic_713_880_T_5_p_Portable.html"
  },
  {
    "id": "hp-philips-fidelio-x2hr",
    "name": "Philips Fidelio X2HR",
    "image_url": "https://images.philips.com/is/image/philipsconsumer/bea8fe94a77e43138519b0bf010c6901?$png$&wid=1200&hei=630",
    "source_store": "Philips",
    "source_page": "https://www.usa.philips.com/c-p/X2HR_00/fidelio-fidelio-headphones"
  },
  {
    "id": "hp-rode-nth-100",
    "name": "Rode NTH-100",
    "image_url": "https://media.sweetwater.com/api/i/q-82,f-auto/images/items/750/NTH100-large.jpg",
    "source_store": "Sweetwater",
    "source_page": "https://www.sweetwater.com/store/detail/NTH100--rode-nth-100-professional-over-ear-headphones"
  },
  {
    "id": "hp-sendy-aiva",
    "name": "Sendy Aiva",
    "image_url": "https://sendyaudio.com/Uploads/editor/2021-01-09/2983719450af50f76d6aaa1657f78101.png",
    "source_store": "Sendy Audio",
    "source_page": "https://sendyaudio.com/product_d?id=1"
  },
  {
    "id": "hp-zmf-eikon",
    "name": "ZMF Eikon",
    "image_url": "https://images.squarespace-cdn.com/content/v1/533ddd72e4b07d027eb4a2c0/1606338960503-YUR5QVGLNEVTLXYF8YSQ/Auteur-EikonBanner.jpg",
    "source_store": "ZMF Headphones",
    "source_page": "https://www.zmfheadphones.com/auteur-eikon"
  },
  {
    "id": "hp-zmf-verite",
    "name": "ZMF Verite",
    "image_url": "https://images.squarespace-cdn.com/content/v1/533ddd72e4b07d027eb4a2c0/1606258591654-GZN4HPHPROOQ13AJ01DG/VeriteImgs.jpg",
    "source_store": "ZMF Headphones",
    "source_page": "https://www.zmfheadphones.com/verite"
  },
  {
    "id": "1more-comfobuds-pro",
    "name": "1MORE Comfobuds Pro",
    "image_url": "https://www.soundguys.com/wp-content/uploads/2021/06/1more-comfobuds-pro-product-image-1200x674.jpg",
    "source_store": "SoundGuys / 1MORE",
    "source_page": "https://www.soundguys.com/1more-comfobuds-pro-review-54328/"
  },
  {
    "id": "anker-r50i-nc",
    "name": "Anker Soundcore R50i NC",
    "image_url": "https://cdn.shopify.com/s/files/1/0516/3761/6830/files/20250715-181408.png?v=1752574504",
    "source_store": "soundcore",
    "source_page": "https://us.soundcore.com/products/soundcore-p30i"
  },
  {
    "id": "earfun-air-pro-4",
    "name": "EarFun Air Pro 4",
    "image_url": "https://api.myearfun.com/image/product/470vdeowrx3.png",
    "source_store": "EarFun",
    "source_page": "https://www.myearfun.com/eu/headphones/earfun-air-pro-4-adaptive-anc-true-wireless-earbuds-black"
  },
  {
    "id": "edifier-neobud-pro-2",
    "name": "Edifier Neobuds Pro 2",
    "image_url": "https://new-edifier-us-oss.edifier.com/images/20231011/2377694adb35743b4dd06a671889d626.png",
    "source_store": "Edifier",
    "source_page": "https://www.edifier.com/global/p/true-wireless-earbuds/neobuds-pro-2"
  },
  {
    "id": "grell-tws1x",
    "name": "Grell TWS1X",
    "image_url": "https://www.soundstagesolo.com/images/stories/equipment9/202202_grado_1.png",
    "source_store": "SoundStage! Solo / Grell",
    "source_page": "https://www.soundstagesolo.com/index.php/equipment/earphones/324-grell-audio-tws1-true-wireless-earphones"
  },
  {
    "id": "soundpeats-clear",
    "name": "SoundPEATS Clear",
    "image_url": "https://cdn.mobileaudiophile.com/2023/11/Soundpeats-Clear-Review-Pic-47-scaled.jpg",
    "source_store": "MobileAudiophile / SoundPEATS",
    "source_page": "https://mobileaudiophile.com/true-wireless-sound-tws-review/soundpeats-clear-review/"
  },
  {
    "id": "simgot-ew100-dsp",
    "name": "Simgot EW100 DSP",
    "image_url": "https://cdn.shopify.com/s/files/1/0013/3896/6076/files/2_442406c7-f265-4339-b0c0-a684730887a2.png?v=1686301382",
    "source_store": "ShenzhenAudio",
    "source_page": "https://shenzhenaudio.com/products/simgot-ew100p-10mm-dynamic-driver-in-ear-headphone"
  },
  {
    "id": "sony-mh750",
    "name": "Sony MH750",
    "image_url": "https://static.bhphoto.com/images/images500x500/1006533.jpg",
    "source_store": "B&H Photo",
    "source_page": "https://www.bhphotovideo.com/c/product/1006533-REG/sony_1263_6146_mh750_stereo_headset_black.html"
  },
  {
    "id": "canpur-deep-blue",
    "name": "Canpur Deep Blue",
    "image_url": "https://static.wixstatic.com/media/e15cb5_43f08475e7c74d67ba6d19b049008af3~mv2.jpeg",
    "source_store": "Beyond The Music",
    "source_page": "https://www.beyondthemusicid.com/post/new-stock-arrival-canpur-deep-blue-in-earphone"
  },
  {
    "id": "tozo-golden-x1",
    "name": "Tozo Golden X1",
    "image_url": "https://m.media-amazon.com/images/I/61tpeapM38L._AC_SL1500_.jpg",
    "source_store": "Amazon / TOZO",
    "source_page": "https://www.amazon.com/dp/B0BS3SYYBP"
  }
]

print(f"Ingesting {len(items)} researched images...")
success = 0
for it in items:
    try:
        res = add_image(
            iem_id=it['id'],
            image_url=it['image_url'],
            source_name=it['source_store'],
            source_url=it['source_page'],
            title=it['name']
        )
        if res:
            success += 1
            print(f"  [OK] {it['id']} ({it['name']})")
        else:
            print(f"  [FAILED] {it['id']}")
    except Exception as e:
        print(f"  [ERROR] {it['id']}: {e}")

print(f"\nSuccessfully downloaded and added {success}/{len(items)} images!")

