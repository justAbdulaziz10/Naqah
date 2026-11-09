# NAQAH landing — asset licence ledger

Handoff §09 licence log. All entries are **candidates pending owner approval**. They show the region and the
animal in general; none is presented as a NAQAH estate, herd or client.

Commercial-use check date for every row: **2026-11-05**. Licence data was read from the Wikimedia Commons file
metadata (via the Openverse / Commons APIs). Proof column quotes that metadata; re-open each source page and
confirm the licence box before production.

Share-alike (CC BY-SA) note: use unaltered (resize/crop only), credit the creator with title, licence and link.
If an image is recoloured or composited, the derivative must be released under the same licence.

## IMG-01 · hero

| Field | Value |
|---|---|
| slot | `hero` |
| source_url | https://commons.wikimedia.org/w/index.php?curid=165908227 |
| creator | Florian Kriechbaumer |
| license | CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/ |
| commercial_usage_verified_date | 2026-11-05 |
| proof | Commons metadata: "CC BY-SA 4.0"; credit: "Empty Quarter Dunes" by Florian Kriechbaumer, CC BY-SA 4.0, via Wikimedia Commons |
| model/property release | Not needed: landscape, no people, no buildings, no branding |
| original_filename | Empty_Quarter_Dunes.jpg (2247 × 1707) |
| optimized_filename | public/images/landing/hero.jpg (JPEG q50, ~543 KB; source not upscaled) |
| pixel size | 2247 × 1707 |
| notes | Exact country not stated on the file page (Empty Quarter spans KSA, UAE, Oman). Source has visible film-like grain. |
| status | Superseded by Phase 2B (2026-11-05); file overwritten |

## IMG-04-alt · evening

IMG-04 in the handoff is not matched exactly; this is the closest licensed alternative (dromedary in warm, low light).

| Field | Value |
|---|---|
| slot | `evening` |
| source_url | https://commons.wikimedia.org/wiki/File:Arabian_Camel_in_Kuwait.jpg |
| creator | Manojkiri photography |
| license | CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0 |
| commercial_usage_verified_date | 2026-11-05 |
| proof | Commons metadata: "CC BY-SA 4.0"; credit: "Arabian Camel in Kuwait" by Manojkiri photography, CC BY-SA 4.0, via Wikimedia Commons |
| model/property release | Not needed: animals only, no people. A small piece of litter sits in the left foreground. |
| original_filename | Arabian_Camel_in_Kuwait.jpg (2696 × 1796) |
| optimized_filename | public/images/landing/evening.jpg (progressive JPEG q78, 232 KB) |
| pixel size | 1600 × 1066 |
| notes | Kuwait, not Saudi. A 3:4 portrait crop is tight around the mother and calf (focus 50% 55%). |
| status | Candidate, pending owner approval |

## IMG-02-alt · herd

| Field | Value |
|---|---|
| slot | `herd` |
| source_url | https://commons.wikimedia.org/wiki/File:Camelus_dromedarius_in_Saudi_Arabia_(8400052348).jpg |
| creator | Peter Dowley (Dubai, UAE) |
| license | CC BY 2.0 — https://creativecommons.org/licenses/by/2.0 |
| commercial_usage_verified_date | 2026-11-05 |
| proof | Commons metadata: "CC BY 2.0"; credit: "Camelus dromedarius in Saudi Arabia (8400052348)" by Peter Dowley from Dubai, United Arab Emirates, CC BY 2.0, via Wikimedia Commons |
| model/property release | No people identifiable. A distant generic SUV and other camels are in the background right; no legible branding. |
| original_filename | Camelus_dromedarius_in_Saudi_Arabia_(8400052348).jpg (3648 × 2736) |
| optimized_filename | public/images/landing/herd.jpg (JPEG q78, ~267 KB) |
| pixel size | 1600 × 1200 |
| notes | Wide-angle, slightly playful expression (mouth open). A 4:5 crop at focus 45% 35% keeps the head and neck; the vehicle sits near the right edge. |
| status | Superseded by Phase 2B (2026-11-05); file overwritten |

## IMG-05 · closing

| Field | Value |
|---|---|
| slot | `closing` |
| source_url | https://commons.wikimedia.org/wiki/File:Rub_al_khali_sunset_Nov_2007.jpg |
| creator | Javierblas |
| license | CC BY-SA 3.0 — https://creativecommons.org/licenses/by-sa/3.0/ |
| commercial_usage_verified_date | 2026-11-05 |
| proof | Commons metadata: "CC BY-SA 3.0"; description: "Rub al-Khali desert in Saudi Arabia — sunset"; credit: "Rub al khali sunset Nov 2007" by Javierblas, CC BY-SA 3.0, via Wikimedia Commons |
| model/property release | Not needed: landscape, no people, no buildings |
| original_filename | Rub_al_khali_sunset_Nov_2007.jpg (4000 × 3000) |
| optimized_filename | public/images/landing/closing.jpg (progressive JPEG q78, 400 KB) |
| pixel size | 2400 × 1800 |
| notes | Saudi Arabia. Sun sits upper right; dunes fill the middle band, suits a 16:9 crop. |
| status | Candidate, pending owner approval |

## Still needed

- **IMG-03 heritage** (Sadu weaving / camel adornment textile, crimson): not filled. Search was stopped before
  a licensed, unwatermarked candidate was viewed. The page renders its designed fallback plate.
- **IMG-02** welcome camel with crimson adornment: not found; `herd` uses an unadorned portrait (IMG-02-alt).
- **IMG-04** exact evening brief (camels in golden light, Saudi): only the Kuwait alternative above.
- **MOTION-01..03**: no footage sourced.
- **PAT** artwork: Sadu-derived pattern artwork still needs owner/cultural review.
- **DEMO-01**: demo screen capture not produced here.

## Production replacement

These Commons photographs are interim candidates. For production, replace them with licensed stock with clear
commercial terms (ArabsStock, Adobe Stock) or commissioned photography of Saudi estates, and update this ledger
and `src/components/landing/photos.ts` together.

## Camel-colour gallery (مزاين الإبل)

Six tiles: `wadh`, `shul`, `sufr`, `shaqh`, `humr`, `majaheem` (target files `public/images/landing/colours/<id>.jpg`).
Acceptance rule: the source title, description or categories must name the colour category explicitly (or a camel
beauty festival page must name it). The category is never inferred from how the camel looks.

Search (2026-11-05, Wikimedia Commons + Openverse, licences CC0 / PDM / CC BY / CC BY-SA): "Majaheem camel",
"Maghateer camel", "Wadh camels", "Majaheem", "مجاهيم", "Maghateer", "مغاتير", "camel beauty festival",
"مزاين الإبل", "Wadh", "camel festival Saudi". No openly licensed result named any of the six categories. The one
"مجاهيم" hit (Commons "(كل راعي لأبعد الذود بالصــوت إنهمــــه....♥) - Flickr - Aih.", CC BY 2.0) is a poem caption
plus the generic "Camels" category. It does not contain the word, so it was rejected. "Wadh" results were
places, minerals and people. Festival results (Janadriyah 2008) do not name a colour category.

| Slot | Status |
|---|---|
| wadh | Designed colour plate (no verifiable licensed photo) |
| shul | Designed colour plate (no verifiable licensed photo) |
| sufr | Designed colour plate (no verifiable licensed photo) |
| shaqh | Designed colour plate (no verifiable licensed photo) |
| humr | Designed colour plate (no verifiable licensed photo) |
| majaheem | Designed colour plate (no verifiable licensed photo) |

Next step: license category-labelled photographs from ArabsStock or Adobe Stock, or commission them (for example,
from King Abdulaziz Camel Festival exhibitors with their permission). Record each one here before it is used.

## Phase 2B photo updates

Verified 2026-11-05 from Wikimedia Commons file metadata (imageinfo extmetadata API). Supersedes IMG-01 (`hero`)
and IMG-02-alt (`herd`) above; fills IMG-03 (`heritage`), which "Still needed" listed as open. `evening` and
`closing` are unchanged.

### IMG-01-2B · hero

| Field | Value |
|---|---|
| slot | `hero` |
| source_url | https://commons.wikimedia.org/wiki/File:%D8%B1%D8%A7%D8%B9_%D9%8A%D9%82%D9%88%D8%AF_%D8%AC%D9%85%D9%84%D9%87.jpg |
| creator | Saudi Press Agency (SPA) |
| license | CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0 |
| commercial_usage_verified_date | 2026-11-05 |
| proof | Commons metadata: LicenseShortName "CC BY-SA 4.0"; UsageTerms "Creative Commons Attribution-Share Alike 4.0"; description: "A herder leading his camel in a calm desert atmosphere in Saudi Arabia (Published 2024)." Categories include "Deserts of Saudi Arabia", "Featured pictures of Saudi Arabia". Credit: "راع يقود جمله" by Saudi Press Agency (SPA), CC BY-SA 4.0, via Wikimedia Commons |
| model/property release | One mid-distance herder; face covered by his shemagh and hand, not identifiable. No branding. A few small litter specks on the sand near the horizon. |
| original_filename | راع_يقود_جمله.jpg (5392 × 3592) |
| optimized_filename | public/images/landing/hero-herder.jpg (progressive JPEG q78, 214 KB) |
| pixel size | 2400 × 1598 |
| notes | Saudi Arabia, 2023-12-09. Flat desert in a dust haze, not dunes. One camel, centred; the upper half is plain haze that can hold a headline. Focus 50% 55%. |
| status | Candidate, pending owner approval |

### IMG-02-2B · herd

| Field | Value |
|---|---|
| slot | `herd` |
| source_url | https://commons.wikimedia.org/wiki/File:Dromedary_Wahiba_Sands_2019_(08).jpg |
| creator | Ekrem Canli |
| license | CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0 |
| commercial_usage_verified_date | 2026-11-05 |
| proof | Commons metadata: LicenseShortName "CC BY-SA 4.0"; UsageTerms "Creative Commons Attribution-Share Alike 4.0"; description: "Dromedary in the Wahibah Sands, Oman". Credit: "Dromedary Wahiba Sands 2019 (08)" by Ekrem Canli, CC BY-SA 4.0, via Wikimedia Commons |
| model/property release | Not needed: one animal, no people, no vehicles, no branding |
| original_filename | Dromedary_Wahiba_Sands_2019_(08).jpg (2544 × 1696) |
| optimized_filename | public/images/landing/herd-profile.jpg (progressive JPEG q78, 134 KB) |
| pixel size | 1600 × 1066 |
| notes | Oman (Gulf), not Saudi. Calm left-facing side profile, soft blurred sand background. The head sits in the left half: a 4:5 crop needs focus near the left edge (4% 45%) to keep the muzzle. |
| status | Candidate, pending owner approval |

### IMG-03-2B · heritage

| Field | Value |
|---|---|
| slot | `heritage` |
| source_url | https://commons.wikimedia.org/wiki/File:%D8%A7%D9%84%D8%B3%D8%AF%D9%88_2.jpg |
| creator | Di7ane |
| license | CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0 |
| commercial_usage_verified_date | 2026-11-05 |
| proof | Commons metadata: title and description "السدو 2" (Al Sadu); LicenseShortName "CC BY-SA 4.0"; UsageTerms "Creative Commons Attribution-Share Alike 4.0"; categories "Textiles of Kuwait", "Images from Wiki Loves Folklore 2026 in Kuwait". Credit: "السدو 2" by Di7ane, CC BY-SA 4.0, via Wikimedia Commons |
| model/property release | Not needed: textile only, no people, no labels or branding in the crop |
| original_filename | السدو_2.jpg (8064 × 4536; downloaded at 3840 × 2160) |
| optimized_filename | public/images/landing/heritage.jpg (crop 3072 × 1920 at offset 96,96 to remove a window edge at top and a dark object at bottom right; progressive JPEG q78, 386 KB) |
| pixel size | 1600 × 1000 (16:10) |
| notes | Kuwaiti Sadu, not Saudi. Cream and dark-brown bands with deep red patterned borders; red is an accent rather than the ground. A small pale stain sits on the central dark band. Crop only, no recolour (share-alike). |
| status | Candidate, pending owner approval |

### Phase 2B rejected candidates

- "On camels" (Sammy Giuvara, CC BY-SA 4.0): Petra, Jordan; identifiable riders and a tourist price sign.
- Camel-and-dune results from Mongolia, Rajasthan, Ladakh, Egypt, Morocco: not Arabian.
- "Camel tracks in the Empty Quarter east of Najran" (CC BY 2.0): no camels in frame.
- "Dromedary - tunisia" (Skander zarrad, CC BY-SA 4.0): strong profile, but blue rope halter and Tunisia; Wahiba Sands is calmer and Gulf.
- "Textile Al Sadu, Egypte, collection privée de Ariane Mawaffo" (CC0): vivid red, but labelled Egypt, looks machine-woven and is portrait.
- "السدو" and "السدو 3" (Di7ane, CC BY-SA 4.0): portrait; "السدو 3" includes a museum label.
- "Women's fashion from Saudi Sadu weaving decorations" (CC0): a garment, not the weaving itself.

## File naming note (2026-11-05)

Replacement photographs get a new filename (`hero-herder.jpg`, `herd-profile.jpg`) instead of overwriting the old one, so no image-optimizer, browser or CDN cache can keep serving the superseded picture. The superseded `hero.jpg` (Empty Quarter dunes) and `herd.jpg` (face-on camel) files have been removed from the repository; their entries above are kept for the record.

## Still needed: real photographs for the camel-colour gallery

The six-colour gallery (الوضح، الشعل، الصفر، الشقح، الحمر، المجاهيم) currently shows designed coat-colour plates, because no openly licensed photograph names its colour category (see "Camel-colour gallery" above). Before launch, obtain six real photographs, one per colour, each verifiably of that category:

- Source: licensed Saudi stock (ArabsStock, Adobe Stock) whose item description names the category, or commissioned photography (for example of King Abdulaziz Camel Festival entrants, with the owners' written permission).
- Have a camel owner confirm each colour, especially الصفر and الشعل, whose shades the sources describe least consistently.
- Format: 4:5 portrait (also cropped 4:3 on desktop), calm single animal, plain background, ≥ 1200 px wide, no identifiable people, no branding.
- Add each as `public/images/landing/colours/<id>.jpg` and an entry in `src/components/landing/photos.ts` under the matching id (`wadh`, `shul`, `sufr`, `shaqh`, `humr`, `majaheem`); the gallery then shows the photograph instead of the plate automatically.

## Product Experience 2.0 (2026-11-08)

Two photographs from the unmerged `design/landing-refresh-v2` branch (commit `4d96e8b`) are now used on the landing.
**Verified for release 2026-11-08:** each source page and licence page was re-read (both photos marked free, commercial
website use allowed, no attribution required), and each file was compared with its source image. Credits stay visible in the landing footer even though neither licence
requires attribution. Neither is presented as a NAQAH estate, herd, worker or client.

| Slot | File | Shows | Stated location | Creator | Licence | Source |
|---|---|---|---|---|---|---|
| `hero` | `hero-herd-dusk.jpg` (2560 × 1706) | Camels walking across dunes at sunset | Saudi Arabia, per Pexels | Mo Eid | Pexels License — https://www.pexels.com/license/ | https://www.pexels.com/photo/camels-trekking-through-the-desert-at-sunset-28844446/ |
| `closing` | `call-hisma-sunset.jpg` (2400 × 1600) | The sun setting over the Hisma desert | Hisma Desert, NEOM, Saudi Arabia | NEOM | Unsplash License — https://unsplash.com/license | https://unsplash.com/photos/the-sun-is-setting-over-a-desert-landscape-WpOMM4uE-F8 |

`hero-herder.jpg` (SPA, CC BY-SA 4.0) moves from the landing hero to the onboarding panel, where it shows the
kind of worker NAQAH calls. `evening.jpg`, `closing.jpg` and `herd-profile.jpg` stay in the repository but are no
longer shown on the landing; only shown photographs are credited there.

## Landing JPEG delivery (2026-11-09)

All seven JPEGs in `public/images/landing/` were re-encoded in place as progressive JPEGs at quality 78, with a
2560 px maximum width. Every source was already at or below that width, so filenames, pixel dimensions and aspect
ratios are unchanged.

| File | Before (bytes) | After (bytes) |
|---|---:|---:|
| `call-hisma-sunset.jpg` | 347,149 | 201,368 |
| `closing.jpg` | 579,825 | 399,578 |
| `evening.jpg` | 423,301 | 232,369 |
| `herd-profile.jpg` | 263,143 | 133,504 |
| `heritage.jpg` | 391,339 | 385,551 |
| `hero-herd-dusk.jpg` | 667,643 | 364,944 |
| `hero-herder.jpg` | 381,729 | 213,907 |
| **Total** | **3,054,129** | **1,931,221** |

The total decreased by 1,122,908 bytes (36.8%).
