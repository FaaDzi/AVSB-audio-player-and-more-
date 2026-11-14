# Duplicate check (2026-10-29)

Reviewed by name and measured curve. Merged rows leave the lists; their ids still resolve to the kept model (saved brackets, your IEMs, reviews, photos keep working).
Source of truth: scripts/duplicates_confirmed.json, applied by scripts/apply_confirmed_duplicates.py.

- IEM: 214 duplicates merged
- TWS: 49
- Headphones: 52
- Plus the leftover variants of each merged model (e.g. "Aful Performer 7 (5+2)")

## Wrong merges undone
- AirPods Pro 2 rows were merged into the 1st-gen AirPods Pro: now under AirPods Pro 2
- Galaxy Buds FE / Buds Core were merged into Buds 3 Pro: FE under Buds FE, Core on its own
- Px7 S3 (into S2), AR5000 MK2 (into AR5000), HE400se V2 (into V1): back as their own models

## All merges

| Merged | Into | Why |
|---|---|---|
| 7Hz x Crinacle Zero 3 | 7Hz Salnotes x Crinacle Zero 3 | same IEM, 'Salnotes' dropped |
| 7Hz x Crinacle Zero 2 | 7Hz Salnotes Zero:2 | Zero:2 = Salnotes x Crinacle Zero 2; existing merges split it into two groups |
| 7Hz × Crinacle Zero 2 (sample 01) | 7Hz Salnotes Zero:2 | unit label only |
| 7Hz SALNOTES X CRIN ZERO 2 SET 2 | 7Hz Salnotes Zero:2 | unit/set label only |
| Salnotes (7hz) Zero 2 | 7Hz Salnotes Zero:2 | brand order |
| Salnotes Zero 2 | 7Hz Salnotes Zero:2 | brand dropped |
| Audio Research AR-H1 | Acoustic Research AR-H1 | Brand typo: AR-H1 is from Acoustic Research (rms 2.37 dB) |
| AFUL 5+2 | AFUL Performer 5+2 | 'Performer' dropped |
| Aful P5+2 | AFUL Performer 5+2 | shorthand P5+2 |
| Aful Performer P5+2 | AFUL Performer 5+2 | shorthand P5+2 |
| AFUL Audio Performer 5+2 (Performer 5+2 (all silicone stock tips)) | AFUL Performer 5+2 | stock tips = base config |
| AKG Q701 | AKG Q701 Quincy Jones | Q701 is the Quincy Jones signature model (rms 1.69 dB) |
| Soundcore Liberty 3 Pro (TWS) | Anker Soundcore Liberty 3 Pro | Brand prefix dropped plus a "(TWS)" tag (rms 1.71 dB) |
| Soundcore Liberty Pro 3 | Anker Soundcore Liberty 3 Pro | Same model with "Pro 3" word order; the spread fits TWS seal variation (rms 2.16 dB) |
| Soundcore Liberty 4 NC | Anker Soundcore Liberty 4NC | "4 NC" vs "4NC" spacing, brand prefix dropped; name-certain, curve spread is from seal/ANC (rms 2.51 dB) |
| Soundcore Q45 | Anker Soundcore Space Q45 | "Anker" and "Space" dropped; ANC headphone, 2.31 dB from the ANC-on row (rms 3.32 dB) |
| Apple AirPods Pro 1 | Apple AirPods Pro | "Pro 1" = AirPods Pro 1st generation (rms 2.23 dB) |
| Apple AirPods Pro 2nd Generation (TWS) | Apple AirPods Pro 2 | "2nd Generation" = Pro 2 (rms 1.65 dB) |
| Apple AirPods Pro Gen 2 (Apple Airpods Pro Gen 2 70dB) | Apple AirPods Pro 2 | "Gen 2" spelling of Pro 2; listening-level row like the S1 72-94 dB rows already merged into apple-airpods-pro-2 (rms 2.12 dB) |
| Apple AirPods Pro Gen 2 (Apple Airpods Pro Gen 2 75dB Spatial Audio) | Apple AirPods Pro 2 | "Gen 2" spelling of Pro 2; listening-level row (rms 1.83 dB) |
| Apple AirPods Pro Gen 2 (Apple Airpods Pro Gen 2 80dB) | Apple AirPods Pro 2 | "Gen 2" spelling of Pro 2; listening-level row (rms 1.55 dB) |
| Audio Technica R50x | Audio-Technica ATH-R50x | "ATH-" dropped (rms 0.86 dB) |
| Audio Technica R70xa | Audio-Technica ATH-R70xa | "ATH-" dropped (rms 1.09 dB) |
| AUDIOSENSE DT600 without Ω adapter | Audiosense DT600 | no adapter = stock (rms 0.08) |
| Audiosense DT600 (Audiosense DT600 Stock) | Audiosense DT600 | stock config label |
| Aurorus Borealis | Aurorus Audio Borealis | "Audio" dropped (rms 0.96 dB) |
| Apple Powerbeats Pro | Beats Powerbeats Pro | Beats product filed under Apple; same Harpo data (rms 0.08 dB) |
| Beyerdynamic TYGR 300 | beyerdynamic TYGR 300R | TYGR 300 R is the only TYGR 300; "R" dropped (rms 1.62 dB) |
| BGVP BGVP DM8 | BGVP DM8 | doubled brand |
| BLON Mini | Blon ['BL-Mini'] | BL-Mini shorthand |
| BLON 01 | BLON BL-01 | BL-01 shorthand |
| BLON 05 | BLON BL-05 | BL-05 shorthand |
| BLON  03 | Blon BL03 | BL-03 shorthand |
| BLON 03 II | Blon BL03 2 | BL-03 II shorthand |
| Blon Blon x HBB Z300 | BLON x HBB Z300 | doubled brand |
| BLON x Z Jojo | Blon x Zeos Jojo | Z = Zeos (rms 0.09) |
| Canpur 622B | Canpur CP622B | CP prefix dropped |
| COZOY ['D1'] (COZOY D1 Stock Tips) | Cozoy D1 | stock tips = base |
| Denon D5200 | Denon AH-D5200 | "AH-" prefix dropped (rms 0.99 dB) |
| Denon D7000 | Denon AH-D7000 | "AH-" prefix dropped (rms 2.17 dB) |
| Denon D7200 | Denon AH-D7200 | "AH-" prefix dropped (rms 1.30 dB) |
| DUNU 142 | Dunu DN 142 | DN prefix dropped |
| DUNU 242 | Dunu DN242 | DN prefix dropped |
| DUNU DUNU 242 | Dunu DN242 | doubled brand |
| EarAcoustic Genesis G318s | EarAcoustic Audio Elysian Fields GENESIS G318s | series name dropped |
| EarAcoustic Audio Genesis 318s | EarAcoustic Audio Elysian Fields GENESIS G318s | G dropped |
| EARACOUSTICS GENESIS G318s | EarAcoustic Audio Elysian Fields GENESIS G318s | brand spelling |
| Earfun Oluv Edition | EarFun Free Pro - Oluv Edition | Model name dropped; the Oluv Edition is the Free Pro (rms 0.29 dB) |
| Edifier 950NB | Edifier WH950NB | "WH" prefix dropped (rms 2.35 dB) |
| Edifier ['X3 Lite'] | Edifier X3 Lite TWS | Bracket-artifact name ["X3 Lite"]; its Classical/Pop/Rock preset rows stay as variants (rms 1.72 dB) |
| EPZ EPZ P40 | EPZ P40 | doubled brand |
| Etymotic Research mk5 | Etymotic mk5 Isolator | 'Isolator' dropped |
| Etymotic ER4S | Etymotic Research ER-4S | 'Research' dropped |
| Etymotic ER2SE | Etymotic Research ER2SE | 'Research' dropped |
| Etymotic ER3XR | Etymotic Research ER3XR | 'Research' dropped |
| Etymotic ER4SR | Etymotic Research ER4SR | 'Research' dropped |
| Etymotic ER4XR | Etymotic Research ER4XR | 'Research' dropped |
| Etymotic ETY Kids | Etymotic Research Ety Kids | 'Research' dropped |
| FiiO JT7 | FiiO Jadeaudio JT7 | JadeAudio sub-brand dropped (rms 0.96 dB) |
| FiiO JT1 | FiiO x JadeAudio JT1 | JadeAudio sub-brand dropped (rms 1.65 dB) |
| FiiO & JadeAudio JT1 | FiiO x JadeAudio JT1 | "&" vs "x" (rms 2.94 dB) |
| Final Audio Final E500 | Final Audio E500 | doubled brand |
| Final Audio E500 (FA E500) | Final Audio E500 | label repeats name |
| final UX3000 | Final Audio UX3000 | "Audio" dropped (not the UX3000 SV) (rms 1.95 dB) |
| Final Audio VR3000 | Final Audio VR3000 Gaming | VR3000 is sold as 'VR3000 for Gaming' (rms 0.54) |
| Final Audio VR3000 (Final VR3000) | Final Audio VR3000 Gaming | label repeats name |
| Final Audio ZE3000 TWS | Final Audio ZE3000 | ZE3000 only exists as TWS; "TWS" tag only (rms 2.20 dB) |
| FIR AUDIO E10 | Fir Audio Electron 10 | E10 = Electron 10 |
| FIR AUDIO E12 | Fir Audio Electron 12 | E12 = Electron 12 |
| FiR XE6 (FiR XE6 Black) | FiR Audio XE6 Black Atom | same Black Atom config |
| FiR XE6 (FiR XE6 Gold) | FiR Audio XE6 Gold Atom | same Gold Atom config |
| FIR Audio XENON XE6 | Fir Audio Xenon 6 | Xenon 6 = XE6 |
| FiR Audio XE6 UIEM | Fir Audio Xenon 6 | XE6 is a universal; UIEM suffix only |
| Fractal Designs Scape | Fractal Design Scape | Brand typo "Designs" (rms 1.74 dB) |
| Grell OAE1 | Grell Audio OAE1 | "Audio" dropped (rms 1.22 dB) |
| Drop + Grell OAE1 | Grell Audio OAE1 | Drop collab naming of the OAE1 (rms 1.14 dB) |
| Grell x Drop OAE1 | Grell Audio OAE1 | Drop collab naming of the OAE1 (rms 1.46 dB) |
| HEDD Audio D1 | HEDD Audio HEDDphone D1 | "HEDDphone" dropped (rms 1.03 dB) |
| HEDD D1 | HEDD Audio HEDDphone D1 | "Audio HEDDphone" dropped (rms 1.22 dB) |
| HEDD HEDDPhone D1 | HEDD Audio HEDDphone D1 | "Audio" dropped (rms 1.36 dB) |
| HEDDPhone D1 | HEDD Audio HEDDphone D1 | Brand dropped (rms 1.37 dB) |
| HEDDphone TWO | HEDD Audio HEDDphone TWO | Brand dropped (rms 1.59 dB) |
| HEDD Heddphone 2 | HEDD Audio HEDDphone TWO | "2" = TWO (rms 1.30 dB) |
| HEDDphone TWO GT | HEDD Audio HEDDphone TWO GT | Brand dropped (rms 1.63 dB) |
| HEDD HEDDphone | HEDDphone ONE | Original HEDDphone, renamed ONE after TWO launched (rms 1.39 dB) |
| Hedd hedd | HEDDphone ONE | "Hedd hedd" = original HEDDphone (ONE) (rms 1.81 dB) |
| Hidizs Hidizs MM2 | Hidizs Mermaid MM2 | doubled brand, 'Mermaid' dropped |
| Hidizs MM2 | Hidizs Mermaid MM2 | 'Mermaid' dropped |
| Hidizs MS1 | Hidizs Mermaid MS1 | 'Mermaid' dropped (rms 0.09) |
| Drop + Hifiman HE-4xx | HIFIMAN HE4XX | Drop collab naming, "HE-4xx" spelling (rms 1.53 dB) |
| Hisenior (Febos) Cano Cristales | Hisenior Caño Cristales | same IEM, official spelling Caño |
| HISENIOR Cano Cristales | Hisenior Caño Cristales | Cano vs Caño |
| HiSenior Cristales | Hisenior Caño Cristales | 'Caño' dropped |
| Hisenior Mega5-EST (Hisenior Mega5EST) | Hisenior Mega 5 EST | label repeats name |
| IKKO OH1S | Ikko Gems OH1s | 'Gems' dropped |
| Ikko OH10 | Ikko OH10 Obsidian | OH10 is named Obsidian |
| IKKO IKKO OH300 | Ikko OH300 | doubled brand |
| IKKO OH2 | Ikko Opal OH2 | 'Opal' dropped (rms 0.02) |
| Ikko Opal OH02 | Ikko Opal OH2 | OH02 = OH2 |
| Juzear 61T | Juzear Butterfly 61T | 'Butterfly' dropped |
| Juzear 81T | Juzear Dragonfly 81T | 'Dragonfly' dropped |
| Juzear 41T | Juzear FLAME/41T | 'Flame' dropped |
| Juzear 41t (Juzear 41t) | Juzear FLAME/41T | label repeats name |
| JUZEAR JUZEAR FLAME - 41T | Juzear FLAME/41T | doubled brand |
| Juzear Flame | Juzear FLAME/41T | 41T dropped |
| JVC FW10000 | JVC Victor FW10000 | 'Victor' dropped |
| KBear 03 | KBEAR KB03 | KB prefix dropped |
| KBEAR Cepheus | KBEAR KB16 Cepheus | KB16 dropped |
| KBEar Cepheus KB16 (KBEar Cepheus 1) | KBEAR KB16 Cepheus | word order + unit label |
| KBEAR KB16 (Cepheus) (Cepheus (any stock silicone tips)) | KBEAR KB16 Cepheus | stock tips = base |
| Celest Pandamon | Kinera Celest Pandamon | brand dropped |
| KINERA KINERA PANDAMON | Kinera Celest Pandamon | doubled brand |
| KINERA Pandamon | Kinera Celest Pandamon | 'Celest' dropped |
| Celest Pandamon 2.0 | Kinera Celest Pandamon 2.0 | brand dropped |
| Celest (Kinera) Pandamon 2.0 | Kinera Celest Pandamon 2.0 | brand order |
| Celest (Kinera) Pandamon 2.0 (Pandamon 2.0 (stock silicone tips)) | Kinera Celest Pandamon 2.0 | stock tips = base |
| Kinera  Pandamon 2.0 | Kinera Celest Pandamon 2.0 | 'Celest' dropped |
| Kinera Celest Pandamon 2 | Kinera Celest Pandamon 2.0 | 2 = 2.0 |
| KZ AM16 Bass | KZ AM16 Bass Enhanced | 'Enhanced' dropped |
| KZ KRILLA DDDD | KZ KRILA DDDD | Krilla typo, same switch DDDD |
| KZ KRILLA DDDU | KZ KRILA DDDU | Krilla typo, same switch DDDU |
| KZ KRILLA DDUD | KZ KRILA DDUD | Krilla typo, same switch DDUD |
| KZ Krilla (KZ Krilla DDUD) | KZ KRILA DDUD | Krilla typo, same switch DDUD |
| KZ KRILLA DUDD | KZ KRILA DUDD | Krilla typo, same switch DUDD |
| KZ Krilla (KZ Krilla DUDD) | KZ KRILA DUDD | Krilla typo, same switch DUDD |
| KZ Krila (KZ Krila DUUU) | KZ KRILA DUUU | same switch DUUU, other rig |
| KZ KRILLA UDDD | KZ KRILA UDDD | Krilla typo, same switch UDDD |
| KZ Krilla (KZ Krilla UDDD) | KZ KRILA UDDD | Krilla typo, same switch UDDD |
| KZ Krila (KZ Krila UDDD) | KZ KRILA UDDD | same switch UDDD, other rig |
| KZ Krila (KZ Krila UDDU) | KZ KRILA UDDU | same switch UDDU, other rig |
| KZ Krila (KZ Krila UDUD) | KZ KRILA UDUD | same switch UDUD, other rig |
| KZ Krila (KZ Krila UDUU) | KZ KRILA UDUU | same switch UDUU, other rig |
| KZ Krilla (KZ Krilla UUDD) | KZ KRILA UUDD | Krilla typo, same switch UUDD |
| KZ Krila (KZ Krila UUDD) | KZ KRILA UUDD | same switch UUDD, other rig |
| KZ Krila (KZ Krila UUDU) | KZ KRILA UUDU | same switch UUDU, other rig |
| KZ Krilla (KZ Krilla UUUD) | KZ KRILA UUUD | Krilla typo, same switch UUUD |
| KZ Krila (KZ Krila UUUD) | KZ KRILA UUUD | same switch UUUD, other rig |
| KZ KZ PR2 | KZ x HBB PR2 | doubled brand; kz-pr2 already merged here |
| KZ Z10 Pro 2 | KZ ZS10 Pro 2 | typo Z10 for ZS10 |
| Letshuoer EJ07 OG | Letshuoer EJ07 | OG = original EJ07 |
| LetShuoer EJ07M Lava | Letshuoer EJ07M: Kinda Lava | 'Kinda' dropped |
| Letshuoer HBB EJ07M Kinda Lava | Letshuoer EJ07M: Kinda Lava | HBB collab tag |
| Shuoer EJ07M Kinda Lava Edition | Letshuoer EJ07M: Kinda Lava | old brand name + 'Edition' |
| Letshouer Letshuoer S08 | Letshuoer S08 | brand typo |
| LETSHOUER S08 | Letshuoer S08 | brand typo |
| Letshuoer S08 (s08) | Letshuoer S08 | label repeats name |
| Letshuoer S12 2024 Edition | Letshuoer S12 2024 Anniversary Edition | same 2024 edition |
| LetShouer S12 2024 | Letshuoer S12 2024 Anniversary Edition | brand typo, same 2024 edition |
| Madoo T711 | Madoo Type 711 | T711 = Typ 711 shorthand |
| Mangird Tea 2 | Mangird Xenns Tea 2 | Xenns Mangird Tea 2, brand word dropped/reordered |
| Xenns Mangird Tea2 | Mangird Xenns Tea 2 | Xenns Mangird Tea 2, brand word dropped/reordered |
| XENNS Tea 2 | Mangird Xenns Tea 2 | Xenns Mangird Tea 2, brand word dropped/reordered |
| MIRPH MIRPH-1 | Mirph Designs Mirph-1 | "Designs" dropped, caps (rms 1.10 dB) |
| MYER-AUDIO  CKLVX D41 | Myer Audio CKLVX CK-D41 | CKLVX D41 = CK-D41 |
| Myer CKLVX D41 | Myer Audio CKLVX CK-D41 | CKLVX D41 = CK-D41 |
| MYER CK2V | MYER-AUDIO  CKLVX CK2V | same CK2V; note myer-audio-ck2v already merges into myer-ck2v, re-point it |
| Myer CKLVX CK2V | MYER-AUDIO  CKLVX CK2V | same CK2V; note myer-audio-ck2v already merges into myer-ck2v, re-point it |
| Myer-Audio SLIVO SL-41 MK2 | MYER-AUDIO  SLIIVO SL-41 MK2 | SLIVO typo / brand word dropped |
| Myer SLIIVO SL41 MK2 | MYER-AUDIO  SLIIVO SL-41 MK2 | SLIVO typo / brand word dropped |
| Myer Audio SL-224 | MYER-AUDIO  SLIIVO SL224 | series/brand word dropped |
| Myer SLIIVO SL224 | MYER-AUDIO  SLIIVO SL224 | series/brand word dropped |
| Myer Audio SLA3 | MYER-AUDIO  SLIIVO SLA3 | series/brand word dropped |
| MYER SLIIVO SLA3 | MYER-AUDIO  SLIIVO SLA3 | series/brand word dropped |
| Myer Audio SLT6 | MYER-AUDIO  SLIIVO SLT6 | series/brand word dropped |
| Myer SLIIVO SLT6 | MYER-AUDIO  SLIIVO SLT6 | series/brand word dropped |
| Myer Audio D62 | MYER-AUDIO CKLVX D62 | series/brand word dropped |
| MYER CKLVX D62 | MYER-AUDIO CKLVX D62 | series/brand word dropped |
| Myer Audio CKLVX Hydra | MYER-AUDIO CKLVX x Soundcheck39 Hydra | Hydra is the Soundcheck39 collab |
| MYER SLIIVO SL41 | MYER-AUDIO SLIIVO SL41 | brand word dropped |
| ND ND-001 | ND Earphone ND-001 | brand spelling |
| ND ND-X12 | ND Earphone ND-X12 | brand spelling |
| ND x12 | ND Earphone ND-X12 | brand spelling |
| ND PLANET | ND ND-Planet | brand prefix dropped |
| NFAudio ['NE4'] | NF ACOUS NE4 | NF Acous = NF Audio, plain NE4 |
| NF ACOUS NA1 | NF AUDIO NA1 | NF Acous = old name of NF Audio |
| NF ACOUS NA2+ | NF Audio NA2+ | NF Acous = NF Audio |
| NF Acous/Audio NA2+ | NF Audio NA2+ | NF Acous = NF Audio |
| NF ACOUS NA20 | NF Audio NA20 | NF Acous = NF Audio |
| NF ACOUS NA3 | NF Audio NA3 | NF Acous = NF Audio |
| NF AUDIO NE4 (NF AUDIO NE4 CLR) | NF AUDIO NE4 CLEAR | CLR = CLEAR, same config |
| NF ACOUS NF2u | NF AUDIO NF2U | NF Acous = NF Audio |
| NF ACOUS NM2 | NF Audio NM2 | NF Acous = NF Audio |
| NF ACOUS NM20 | NF Audio NM20 | NF Acous = NF Audio |
| NF Acous/Audio NM20 | NF Audio NM20 | NF Acous = NF Audio |
| NFAcous ['NM25'] | NF Audio NM25 | NF Acous = NF Audio |
| NFAcous RA15 | NF Audio RA15 | NF Acous = NF Audio |
| NF ACOUS RG15 | NF Audio RG15 | NF Acous = NF Audio |
| NF Acous/Audio RG15 | NF Audio RG15 | NF Acous = NF Audio |
| NF Acous/Audio RA05 | NF RA05 | NF Acous = NF Audio |
| NF AUDIO x Mirage RG15 | NF RG15 x Assassin's Creed Mirage | same Mirage edition |
| NiceHCK NiceHCK NX8 SE | Nicehck NX8 SE | doubled brand |
| Noble Audio K10 | Noble Audio Kaiser 10 | K10 = Kaiser 10 |
| NS Audio NS5MKII Bass | NS Audio NS5 MKII Extra Bass | same model, rms 0.10 |
| Oppo Enco X2 - Classic | OPPO Enco X2 EQ Classic | Same Classic EQ preset, two sources (rms 1.58 dB) |
| Oppo Enco X2 (Enco classic preset) | OPPO Enco X2 EQ Classic | Same Classic preset (0.08 dB from "Oppo Enco X2 - Classic", same Harpo data) (rms 1.61 dB) |
| Oppo Enco X2 - Punchy | OPPO Enco X2 EQ Punchy | Same Punchy EQ preset, two sources (rms 1.29 dB) |
| Oppo Enco X2 - Real | OPPO Enco X2 EQ Real | Same Real EQ preset, two sources (rms 1.29 dB) |
| Oppo Enco X2 - Simple and Clear | OPPO Enco X2 EQ Simple & Clear | Same "Simple & Clear" preset ("and" vs "&") (rms 1.46 dB) |
| Penon 10th Anniversary IEM | Penon 10th Anniversary | IEM suffix / typo |
| PENON 10TH ANNIVESARY | Penon 10th Anniversary | IEM suffix / typo |
| Philips L2 | Philips Fidelio L2 | "Fidelio" dropped (rms 2.72 dB) |
| Philips x2hr | Philips Fidelio X2HR | "Fidelio" dropped (rms 1.29 dB) |
| Phillips SHP9500 (sample 1) | Philips SHP9500 | Brand typo "Phillips"; "(sample 1)" is bookkeeping (rms 1.80 dB) |
| QKZ ['QKZ x HBB Hades'] | QKZ x HBB Hades | list-formatted name |
| QKZ QKZ X HBB KHAN | QKZ x HBB Khan | list-formatted name / typo |
| QKZ x HBB Kahn | QKZ x HBB Khan | list-formatted name / typo |
| QoA Magarita | Qoa ['Margarita'] | typo |
| realme Buds Air 5 Pro (original sound effect mode) | realme Buds Air 5 Pro - Original | Same "Original" sound mode, same Harpo data (rms 0.09 dB) |
| Rose QT9 MK3 | Rose Technics (Roseselsa) QT9 MK3 | brand word dropped |
| Rose Technics ['QT9 MK3'] | Rose Technics (Roseselsa) QT9 MK3 | brand word dropped |
| Rose QuietSea II | Rose Technics (Roseselsa) Quietsea II | brand spelling, II = 2 |
| ROSESELSA QuietSea II | Rose Technics (Roseselsa) Quietsea II | brand spelling, II = 2 |
| RoseTechnics QuietSea 2 | Rose Technics (Roseselsa) Quietsea II | brand spelling, II = 2 |
| ROSESELSA Aurora Ultra | Rose Technics Aurora Ultra | Roseselsa = Rose Technics |
| ROSESELSA EARFREE-i3 | Rose Technics Earfree i3 | Roseselsa = Rose Technics |
| Rose Technics (Roseselsa) Earfree-i3 | Rose Technics Earfree i3 | Brand spelling for Earfree i3 (rms 1.41 dB) |
| ROSESELSA EARFREE-i3 | Rose Technics Earfree i3 | Brand spelling for Earfree i3 (1.70 dB from the Roseselsa-paren row) (rms 2.46 dB) |
| ROSE TECHNICS ROSESELSA EARFREE-i5 | Rose Technics EARFREE i5 | Brand spelling for Earfree i5 (rms 1.26 dB) |
| Roseselsa Earfree-i5 | Rose Technics EARFREE i5 | Brand spelling for Earfree i5 (rms 1.23 dB) |
| Rose Technics (Roseselsa) Earfree i5 TWS | Rose Technics EARFREE i5 | Brand spelling plus TWS tag (rms 1.58 dB) |
| Rose QT9 MK2 | Rose Technics QT9 MK2 | brand word dropped |
| Rose QuietSea | Rose Technics QuietSea | brand spelling |
| Roseselsa Quiet Sea | Rose Technics QuietSea | brand spelling |
| ROSESELSA CERAMICS X HIFI | Rose Technics Roseselsa Ceramics X HIFI TWS | Same Ceramics X HiFi preset, brand spelling (rms 1.19 dB) |
| ROSESELSA STAR CITY 5 | Rose Technics Star City 5 | Roseselsa = Rose Technics |
| Rose Star City 5 Pro | Rose Technics Star City 5 Pro | Rose/Roseselsa brand spelling |
| Roseselsa Star City 5 Pro | Rose Technics Star City 5 Pro | Rose/Roseselsa brand spelling |
| Rose Technics (Roseselsa) Star City 5 Pro | Rose Technics Star City 5 Pro | Rose/Roseselsa brand spelling |
| Rose Technics (Roseselsa) Ceramics MK2 | Roseselsa Ceramics MK2 | Brand written "Rose Technics (Roseselsa)" vs "Roseselsa"; same data (rms 0.08 dB) |
| Rose Technics (Roseselsa) Ceramics Ultra | Roseselsa Ceramics Ultra | Brand written "Rose Technics (Roseselsa)" vs "Roseselsa"; same data (rms 0.08 dB) |
| RoseTechnics Ceramics Ultra TWS | Roseselsa Ceramics Ultra | Same Ceramics Ultra, brand spelling plus TWS tag; name-certain, large spread probably from the preset (rms 2.96 dB) |
| Rose Technics (Roseselsa) Ceramics X TWS | Roseselsa Ceramics X | Brand spelling plus TWS tag (rms 1.03 dB) |
| Rose Technics Ceramics X | Roseselsa Ceramics X | Brand spelling; name-certain, the lumerion curve is the outlier (likely another preset) (rms 3.05 dB) |
| Rose Ceramics X Pop | ROSESELSA CERAMICS X POP | Same Ceramics X Pop preset, brand spelling (rms 1.01 dB) |
| Rose Ceramics X Rock | ROSESELSA CERAMICS X ROCK | Same Ceramics X Rock preset, brand spelling (rms 1.22 dB) |
| ROSESELSA x AAV CJ20 | Roseselsa CJ20 x AndyAudioVault | AAV = AndyAudioVault |
| RoseTechnics x AAV CJ20 | Roseselsa CJ20 x AndyAudioVault | AAV = AndyAudioVault |
| Rose EARFREE-i5 Light | Roseselsa Earfree i5 Light | Same Earfree i5 Light preset, brand spelling (rms 1.28 dB) |
| Rose EARFREE-i5 Pop | Roseselsa Earfree i5 Pop | Same Earfree i5 Pop preset, brand spelling (rms 1.42 dB) |
| Rose EARFREE-i5 Rock | Roseselsa Earfree i5 Rock | Same Earfree i5 Rock preset, brand spelling (rms 1.33 dB) |
| Samsung EO-IG955 | Samsung AKG EO-IG955 | AKG word dropped |
| Samsung Galaxy Buds + | Samsung Galaxy Buds Plus | "Buds +" = Buds Plus; identical Super Review data (rms 0.02 dB) |
| Samsung Galaxy Buds Plus TWS | Samsung Galaxy Buds Plus | "TWS" tag only (rms 1.50 dB) |
| Samsung Galaxy Buds Pro TWS | Samsung Galaxy Buds Pro | "TWS" tag only (rms 1.56 dB) |
| SeeAudio X Crinacle Midnight | SeeAudio x Crinacle Yume Midnight | model word dropped |
| SeeAudio  x Z Review Rinko | SeeAudio x Z-Reviews Rinko | typo |
| Sennheiser HD 580 | Sennheiser HD 580 precision | HD 580 was sold as the HD 580 Precision; its (BS) row stays as a variant (rms 2.83 dB) |
| Drop hd 58X | Sennheiser HD 58X | Drop collab naming of the HD 58X (rms 0.85 dB) |
| Sennheiser x Drop HD58X | Sennheiser HD 58X | Drop collab naming, spacing (rms 0.66 dB) |
| Sennheiser x Massdrop HD-58X | Sennheiser HD 58X | Massdrop collab naming of the HD 58X (rms 1.22 dB) |
| Drop hd 6XX | Sennheiser HD 6XX | Drop/Massdrop collab naming of the HD 6XX (rms 0.94 dB) |
| Sennheiser x Drop HD 6XX | Sennheiser HD 6XX | Drop collab naming of the HD 6XX (rms 1.15 dB) |
| Sennheiser x Massdrop HD-6XX | Sennheiser HD 6XX | Massdrop collab naming of the HD 6XX (rms 1.00 dB) |
| Sennheiser Momentum 4 | Sennheiser Momentum 4 Wireless | Momentum 4 only exists as the Wireless (rms 1.71 dB) |
| Drop + Sennheiser PC38X | Sennheiser PC38X | Drop collab naming of the PC38X (rms 0.93 dB) |
| Epos x Drop PC38X | Sennheiser PC38X | EPOS-era rebrand of the same PC38X (rms 0.87 dB) |
| EPOS×DROP PC38X | Sennheiser PC38X | EPOS-era rebrand of the same PC38X (rms 0.78 dB) |
| Sennheiser x Drop PC38X | Sennheiser PC38X | Drop collab naming of the PC38X (rms 0.96 dB) |
| SHOZY 1.1 | Shozy Form 1.1 | Form word dropped |
| SHOZY 1.4 | SHOZY Form 1.4 | Form word dropped |
| Simgot EM6L | Simgot EM6L Phoenix | EM6L is the Phoenix |
| Sivga Phoenix | Sivga Audio Phoenix | "Audio" dropped (rms 1.54 dB) |
| Sivga robin | Sivga Audio Robin | "Audio" dropped (rms 0.82 dB) |
| SIVGA Robin SV021 | Sivga Audio Robin | SV021 is the Robin model number (rms 0.84 dB) |
| Smabat M4 (balanced armature driver) | Smabat M4+BA | same BA config, rms 0.09 |
| Softears Studio4 (Softears Studio4 Starry) | SoftEars Studio4 Starry Version | same, rms 0.01 |
| Sony zx110 | Sony MDR-ZX110 | "MDR-" dropped; same Auriculares Argentina data (rms 0.14 dB) |
| PlayStation Pulse 3D | Sony PULSE 3D | Sony PlayStation Pulse 3D, brand written differently (rms 1.57 dB) |
| Soundpeats Air 4 Pro TWS | Soundpeats Air4 Pro | "Air 4 Pro" vs "Air4 Pro", TWS tag (rms 0.65 dB) |
| Soundpeats Air5 Pro TWS | SoundPeats Air5 Pro | "TWS" tag only (rms 1.43 dB) |
| Soundpeats ['Capsule 3 Pro'] (Soundpeats Capsule 3 Pro) | Soundpeats Capsule3 Pro TWS | "Capsule 3 Pro" vs "Capsule3 Pro"; the paren just repeats the name (rms 0.52 dB) |
| Soundpeats Capsule3 Pro Plus TWS | Soundpeats Capsule3 Pro+ | "Pro Plus" = "Pro+" (the keep row is Capsule3 Pro+) (rms 1.20 dB) |
| Soundpeats Clear TWS | SoundPEATS Clear | "TWS" tag only (rms 1.80 dB) |
| Soundpeats Engine 4 TWS | SoundPeats Engine 4 | "TWS" tag only (rms 1.28 dB) |
| Soundpeats H3 TWS | Soundpeats H3 | "TWS" tag only (rms 1.07 dB) |
| Soundpeats Life TWS | Soundpeats Life | "TWS" tag only (rms 1.12 dB) |
| Soundpeats Mini Pro HS TWS | Soundpeats Mini Pro HS | "TWS" tag only (0.25 dB from the kr0mka Mini Pro HS ANC-off row) (rms 2.07 dB) |
| Soundpeats Opera05 TWS | SoundPeats Opera05 | "TWS" tag only (rms 0.91 dB) |
| SteelSeries Nova 1 | Steel Series Arctis Nova 1 | "Arctis" dropped (keep row spells the brand "Steel Series", worth fixing) (rms 1.50 dB) |
| SteelSeries GameBuds (ANC off) | SteelSeries Arctis Gamebuds | "Arctis" dropped; same GameBuds in default ANC-off (rms 0.75 dB) |
| Strauss em205 | Strauss and Wagner EM205 | brand truncated |
| Symphonium x Elise Helios SE | Symphonium Audio x Elise Audio Helios SE | brand words dropped |
| TangZu Fu Du (Verse I) | TANGZU FUDU | Fudu (Verse 1) original |
| Tangzu Wan'Er S.G 2 Jade | Tangzu Wan'er SG 2 Jade Dragon | Jade = Jade Dragon colourway |
| TANGZU Waner 2 Amethyst Dragon | Tangzu Waner S.G 2 Amethyst Dragon | S.G word dropped |
| Tangzu Wan'Er Studio Edition | Tangzu Waner S.G Studio Edition | S.G word dropped |
| Tangzu Wuzetian Heyday | Tangzu Zetian Wu Heyday | word order |
| ThieAudio L3 | ThieAudio Legacy 3 | L3 = Legacy 3 |
| THIEAUDIO MK2 | ThieAudio Oracle MK2 | Oracle word dropped |
| ThieAudio V16 | Thieaudio V16 Divinity | V16 Divinity |
| TinHiFi C2 | Tin Hifi C2 Mech Warrior | C2 Mech Warrior, shortened |
| Tin Hifi Mech C2 | Tin Hifi C2 Mech Warrior | C2 Mech Warrior, shortened |
| Tinhifi MECA C2 | Tin Hifi C2 Mech Warrior | C2 Mech Warrior, shortened |
| TINHiFi Buds 3 | Tin HiFi Tin Buds 3 | Brand spelling TINHiFi / Tin HiFi (rms 1.88 dB) |
| Tin T5S | TinHiFi T5S | brand spelling |
| Tipsy TTROMSO | Tipsy Tromso | typo, rms 0.08 |
| Tri x HBB KAI (Tri HBB Kai) | TRI TRI X HBB KAI | same; parenthetical is the same name |
| TruthEar ['Zero Red'] (TruthEar Zero Red 10Ohm) | Truthear Zero Red (Truthear Zero Red (10 Ohm adapter)) | same 10 ohm config |
| Verum 2 | Verum Audio Verum 2 | Brand shortened (rms 1.59 dB) |
| Whizzer Kylin HEO3D | Whizzer HE03D | HEO3D typo |
| Whizzer HE10 | Whizzer Kylin HE10 | Kylin word dropped |
| Mangird Tea | Xenns Mangird Tea | Xenns Mangird Tea, brand word dropped/reordered |
| Mangird  Xenns Tea | Xenns Mangird Tea | Xenns Mangird Tea, brand word dropped/reordered |
| XENNS Tea | Xenns Mangird Tea | Xenns Mangird Tea, brand word dropped/reordered |
| Mangird Tea Pro | XENNS Mangird Tea Pro | same Tea Pro; brand word dropped / typo |
| Xenns Mangrid Tea PRO | XENNS Mangird Tea Pro | same Tea Pro; brand word dropped / typo |
| XENNS Tea PRO | XENNS Mangird Tea Pro | same Tea Pro; brand word dropped / typo |
| Xenns Tea Pro SE | XENNS Mangird Tea Pro SE | brand word dropped |
| Mangird Top | Xenns Mangird Top | brand word dropped |
| XENNS Top | Xenns Mangird Top | brand word dropped |
| Xenns Top Pro | Xenns Mangird Top Pro | brand word dropped |
| XENNS UP | XENNS Mangird UP | brand word dropped |
| Yanyin Canon OG | Yanyin Canon | OG = original Canon |
| ZiiGaat x Hangout Odyssey2 | Ziigaat x Hangout Audio Odyssey 2 | Audio word dropped |
| ZiSin GYZIISINE 340 | ZiSin 340 | GYZiisine = ZiSin brand |

## Not merged: unsure (your call)

| A | B | Note |
|---|---|---|
| FIR Audio KRYPTON 5 BLK / SLV / GLD | Krypton 5 | colour suffixes, rms 0.3-0.5; unsure if just finishes or different ATOM/tuning |
| Campfire Andromeda 10 | Campfire Audio Andromeda 10 SE / Black Damascus | low rms (0.44/0.82) but SE and Black Damascus may be separate editions |
| DDHiFi Memory AL 4.4 | DDHiFi Memory PD 4.4 | rms 0.2; unclear what AL/PD denote |
| DUNU DK3001 BD | DUNU DK3001BD Braindance | BD may stand for Braindance |
| DUNU SA6 | DUNU SA6 EST | unclear if EST is a variant/edition |
| Dunu SA6 mkII | Dunu SA6 MkII Red/Blue Edition | colour edition, rms 0.5 |
| DUNU Kima 2 | DUNU Kima 2 Raven Teal | colour edition or retune? |
| EPZ 530 / G10 | EPZ 530 new / G10 NEW | revision vs relabel unknown |
| EPZ 550 | EPZ 550 Purple Phoenix | limited edition, maybe same tuning |
| EPZ P50 | EPZ P50 CLEAR | rms 0.26, shell colour? |
| Hidizs ST2 PRO / HIDIZS ST2 Nebula | Hidizs ST2 Pro Nebula | Nebula may be the ST2 Pro colourway |
| IKKO OH5 | IKKO OH5 Asgard | rms 0.56; not sure Asgard is OH5's name |
| INAWAKEN Twilight | Inawaken Twilight DS | DS could be a separate version |
| INTUAURA Reference 2019 | INTUAURA Reference 2019 DSP | rms 0.09 but DSP suggests separate product |
| Intime Sora Light 2019 | Intime SORA Light 2019 Garnet | colour edition? |
| Kinera iDun 2.0 | Kinera IDUN Golden 2.0 | Idun Golden vs Idun 2.0 lineage unclear |
| Hisenior T2 | Hisenior T2 Classic | Classic may be a separate tuning |
| Letshuoer S12 | LetShuoer SB S12 | SB meaning unclear |
| Catbling Custom | Catbling Custom RT | RT meaning unclear |
| Cozoy D2 | Cozoy D2 evg | evg meaning unclear |
| CVJ Shadowblade | CVJ AUDIO Shadow Blade (CVJ ShadowBlade TBlack) | TBlack could be tips or a colourway |
| 7th Acoustics Stargazer 3 | 7th Acoustic Stargazer 3 SO | SO meaning unclear |
| 7Hz Timeless 2 GOLD NOZZLE | 7Hz Timeless 2 BIG GOLD NOZZLE | possibly the same nozzle, rms 0.94 |
| Juzear HARRIER Stock Clear Blue | Juzear HARRIER Stock Red Black | colour-coded stock tips, kept separate |
| BLON x Z Jojo / Blon x Zeos Jojo | Blon BL-Mini | existing aliases merge other Jojo rows into blon-bl-mini; unsure Jojo = BL-Mini |
| Letshuoer S12 2024 (merged into letshuoer-s12) | Letshuoer S12 2024 Anniversary Edition | existing merge treats the 2024 edition as S12; check consistency |
| Lime Ears sample | Lime Ears SampleA | unclear if same unit/product |
| Moondrop DUSK 2 L (3.5) | Moondrop DUSK 2 R (3.5) | left/right channel of one product |
| Mystori Audio M-121i | Mystori Audio M121 | i suffix may be a revision |
| NF Audio  N2+ | NF Audio NA2+ / NM2 | N2+ ambiguous between NA2+ and NM2+ |
| NF Audio NA2 Metal | NFAudio (NFAcous) NA2 | Metal may be a separate edition |
| NICEHCK NX8 | NiceHCK NX8 Ti | Ti may be a different edition |
| Simgot EW100P | Simgot EW100P Shark / SIMGOT EW100 Shark | not sure Shark is the same product |
| Simgot EM10 | Simgot EM10 DREAM | Dream may be an edition |
| Simgot EW200 | Simgot EW200 Maze | Maze may be an edition |
| Softears SE6 | Softears SE6 Live | rms 0.26 but Live may be an edition |
| Tin Hifi C0 Elf | TinHiFi C0 | likely same, unsure of Elf name |
| Tin Hifi T5S Mars | TinHiFi T5S | rms 0.31, Mars may be official name |
| TIN HiFi T6 Black/Green/Pink | TinHiFi T6 X Ring Clear | same filter colour, Clear unclear |
| TRN MT4 Pro | TRN MT4 PRO Final | rms 0.08; Final may be production vs prototype |
| WHIZZER H1 | Whizzer HE1 | H1 may be a typo of HE1 |
| XENNS Top PRO 1 | XENNS TOP PRO T1 | unit labels |
| XENNS TEA MKII | XENNS Tea 2 | MKII may be Tea 2 |
| Rose Technics (ROSESELSA) Quiet Sea II (stock silicone tips) | Rose Technics (Roseselsa) Quietsea II | stock-tip row = default config |
| Sennheiser IE 900 | Sennheiser IE900 (stock foam tips) / Standard foam | foam tips vs default |
| QoA Misty Blue | QoA x Eir Aoi Misty Blue | probably the same collab IEM |
| Truthear Crinacle Zero Red (Project Red IMP 2) | TRUTHEAR CRINACLE ZERO RED IMP | IMP 2 vs IMP |
| Reecho SG-01 | Reecho SG-01 OVA | OVA may be an edition |
| VSonic GR07 | VSonic GR07 Classic | Classic is a re-release |
| TANGZU Shimin Li | Tangzu ShiminLi (DownUnder) | DownUnder may be a rig label or edition |
| realme Buds Air 5 Pro - Clean Bass | realme Buds Air 5 Pro - Deep Bass | Identical data under two different preset names; more likely a mislabel than a rename (rms 0.00 dB) |
| realme Buds Air 5 Pro - Dynamic Bass +5 | realme Buds Air 5 Pro - Original | Near-identical curves, different preset names (rms 0.05 dB) |
| Soundpeats H3 Default | SoundPEATS H3 Normal | Both are the default preset from two sources; could also fold into soundpeats-h3 (rms 0.86 dB) |
| EarFun Free Pro (Oluv Edition, ANC off) | EarFun Free Pro - Oluv Edition | Same data; the base row is probably ANC off too, but the mode is listed on its own (rms 0.02 dB) |
| SoundPEATS Air5 Pro+ Normal | SoundPEATS Air 5 Pro Plus | Air5 Pro+ = Air 5 Pro Plus. The cqtek/tonedeafmonk preset rows are filed under a second spelling; better renamed into the family than merged (rms 1.83 dB) |
| Lypertek Z3 | Lypertek PurePlay Z3 | Z3 1.0 vs 2.0 unknown for both rows; curves differ (rms 3.34 dB) |
| Tin Hifi T3 Buds | Tin HiFi Tin Buds 3 | "T3 Buds" could be the Tin Buds 3 or a mislabel (rms 2.44 dB) |
| Sennheiser Momentum TW2 (Sennheiser MTW2 (HE)) | Sennheiser Momentum True Wireless 2 | TW2 = True Wireless 2, but "(HE)" is an unknown configuration (rms 1.36 dB) |
| Samsung Galaxy Buds TWS | Samsung Galaxy Buds (Samsung Galaxy Buds (Clear)) | Original Galaxy Buds; that family has only aden preset rows to keep, no base row (rms 2.20 dB) |
| Nothing Ear 2 (Nothing Ear 2) | Nothing ear (2) | Both are Super Review "Ear (2)" but 2.36 dB apart. Also, "Nothing ear (2)" loses its "(2)" to paren-stripping and groups with Ear (2024) (rms 2.36 dB) |
| Nothing Ear Nothing Ear B162 TWS | Nothing Ear (2024) (Nothing Ear (2024) ANC) | B162 model code: possibly Ear (a), not Ear (2024) (rms 1.32 dB) |
| Samsung ['Galazy Buds FE'] (Galaxy Buds FE ANC OFF) | Samsung Galaxy Buds FE | "Galazy" typo rows for Buds FE (modes). Note: aliases.json merges samsung-galazy-buds-fe into galaxy-buds-3-pro, which looks wrong (rms 2.00 dB) |
| Samsung ['Galazy Buds FE'] (Galaxy Buds FE Ambient) | Samsung Galaxy Buds FE | Same as above, Ambient mode (rms 1.21 dB) |
| Rose Ceramics | Rose Technics Roseselsa Ceramics TWS | Same Ceramics, but base rows are 2.2-4.9 dB apart (preset unknown); pick the HiFi/default one before merging (rms 3.97 dB) |
| Rose Technics (Roseselsa) Ceramics | Rose Technics Roseselsa Ceramics TWS | Same as above (rms 2.57 dB) |
| RoseTechnics Ceramics TWS | Rose Technics Roseselsa Ceramics TWS | Same as above (rms 4.92 dB) |
| ROSESELSA CERAMICS 2 | Roseselsa Ceramics MK2 | "Ceramics 2" probably = MK2 (rms 1.87 dB) |
| Heddphone D1 2 | HEDD Audio HEDDphone D1 | "D1 2" could be a second sample or a D1 II (rms 1.94 dB) |
| Massdrop + Grell OAE1 Signature | Grell Audio OAE1 | "Signature" may be Drop's name for the OAE1 or a special version (rms 1.65 dB) |
| Bose QuietComfort Ultra | Bose QuietComfort Ultra Headphones | Could be the 1st or 2nd gen (2025); large spread (rms 3.16 dB) |
| Fosi Audio Fosi I5 | Fosi Audio i5 | Same name, but 4.4 dB apart (rms 4.44 dB) |
| Ultrasone Edition 8 Palladium | Ultrasone Edition 8 | Identical data; Palladium is a finish edition, so it may be listed on purpose (rms 0.00 dB) |
| Koss KPH30i Clear | Koss KPH30i | Clear is a colour edition (rms 0.99 dB) |
| Koss KPH40 Utility | Koss KPH40 | Utility edition, different housing (rms 1.20 dB) |
| ADAM H200 (H200 (2025 sample, fresh stock pads, realistic seal)) | Adam Audio H200 | Shortened brand, single measurement-note row; 2.9 dB (rms 2.86 dB) |
| Simgot EP5 (EP5 (2025 sample, fresh stock pads, realistic seal)) | Simgot Audio EP5 | Shortened brand, single measurement-note row; 3.2 dB (rms 3.20 dB) |
| AceZone A-Spire | AceZone A-Spire Wireless | Unsure whether a wired A-Spire exists apart from the Wireless (rms 2.17 dB) |
| Sineaptic SE-1 | Sineaptic SE-1 Wireless | Unsure whether the wired and wireless versions differ (rms 1.98 dB) |
| Sennheiser HD 25-1 II B (2012) | Sennheiser HD25-1 II | "II B (2012)" may be the Basic edition or a revision (rms 2.57 dB) |
