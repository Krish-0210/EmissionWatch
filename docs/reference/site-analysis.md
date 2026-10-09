# trionn.com: animation, interaction and sound reference (study for PanoptiCoal)

Studied 2026-10-10 with Playwright driving installed Chrome at 1440×900 (headless), with an init script that logged every
Web Audio source / media element and tapped everything reaching the speakers into an RMS + spectral-centroid meter.
Recordings and screenshots are in `docs/reference/trionn/` (gitignored): `a-load/` (10 s video + 0.25 s shots),
`b-scroll/<page>/` (1 s shots + video for /, /work, /services, /about, /contact, /trionn-story), `c-hover/` (before /
150 / 450 / 900 ms / after crops, menu), `d-hold/{hero,mid,image}/` (hold 4 s + 2 s after), `f-inspect/` (fonts,
computed styles, library signatures), `g-footer/`, `h-transition/`, `sheet-*.png` contact sheets.

This file records **what the site does** (principles, timings, techniques). Nothing from their code, shaders, assets,
audio, copy, logo or layouts is reused; PanoptiCoal re-implements each effect type from scratch with its own content.

## 1. Technique / library inventory (from loaded scripts, CSS, fonts and audio requests)

| Area | What loads | Notes |
|---|---|---|
| Framework | Next.js (app router, Turbopack chunks), Tailwind classes | RSC fetches on navigation |
| Animation | GSAP 3.15.0 core + ScrollTrigger, SplitText, DrawSVG, Draggable + InertiaPlugin | SplitText splits every link / headline into `.char` spans |
| Smooth scroll | Lenis | ScrollTrigger pins (`.pin-spacer` 13,050 px and 6,750 px on Home) |
| 3D | vanilla Three.js + custom GLSL (no R3F / postprocessing lib detected) | hero logo, services objects, footer smoke |
| Image sequences | 140 WebP frames (`stone/frame_0001..0140`) | scroll-scrubbed canvas sequence |
| Video | MP4 cards (desktop + `_m` mobile variants) | autoplay muted on hover/in view |
| Audio | Web Audio API (`AudioContext`, `decodeAudioData`, gain ramps, oscillators, BiquadFilter); one looping `<audio>` | 7 short MP3s + voice clips on the story page |
| Other | Swiper (testimonials), reCAPTCHA, GA | |
| Canvases on Home | 3: full-screen WebGL hero (1440×900), loader canvas (2880×1800, DPR 2), page-overlay canvas | |
| Cursor | **none**: native `pointer`/`auto` everywhere | hover feedback is on the element itself |

## 2. Effect inventory (51 effects: A1–A9, B1–B8, C1–C6, D1, E1–E11, F1–F8, G1–G3, H1–H4, I)

Timings are read off 0.1–0.25 s screenshots and 4 fps video frames, so they are approximate (±0.1 s).

### A. Loader / opening (Home, ~4.8 s, then ~2.5 s hero build)
| # | Effect | What it does | Timing / easing | Technique |
|---|---|---|---|---|
| A1 | Crosshair converge | 4 `+` marks start at the screen corners of a square, converge to a single centre point, then spring back out to a 250 px frame | 0.7–1.6 s, expo in/out | canvas (DPR 2) |
| A2 | Logo stroke draw | the mark is drawn as hairline outlines, then filled by **horizontal scan stripes** (barcode-like bars that thicken until solid) | 1.7–3.8 s | canvas |
| A3 | Frame progress trace | a 1 px line traces clockwise around the frame as the progress bar | 2.4–4.2 s, linear | canvas |
| A4 | Tagline | three uppercase words with `·` separators fade in under the frame | ~2.4 s | DOM |
| A5 | Rolling counter | bottom-centre 3-digit percentage, each digit a vertical slot that rolls (digits seen mid-roll) | 2.4–4.6 s | DOM translateY per digit |
| A6 | Frame fill + zoom-out | frame fills lighter, then the square scales up to cover the viewport, darkening to the site background | 4.5–5.3 s, expo in | canvas → DOM |
| A7 | Hero assemble | nav fades in; 3D logo shards fly in from depth and lock together; orange internal light flares | 5.5–7.5 s | WebGL |
| A8 | Headline char blur-in | each character goes from blur(~12px)+opacity 0 to sharp, in **random order**, ~40 ms stagger | 6.8–7.6 s | SplitText chars, GSAP |
| A9 | CTA / stats blur-in | mono CTAs, stats box, footer copy blur in after the headline | 7.5–8 s | GSAP |

### B. Text effects
| # | Effect | Where | Behaviour | Technique |
|---|---|---|---|---|
| B1 | Rotating last word | hero `Designed to mean <word>.` | every ~3–4 s the word blurs out char-by-char (random order) and the next word blurs in (something → depth → impact → purpose → intention) | SplitText chars, filter blur |
| B2 | Random-order char blur reveal | every section headline on scroll-in (Selected work, How we work, Let's work together, Location) | letters appear out of order from heavy blur | ScrollTrigger once |
| B3 | Scroll-scrubbed paragraph highlight | Home "about" paragraph (85 px) | words go from 10 % to 100 % opacity (with slight blur) as you scroll through a pinned section | ScrollTrigger scrub |
| B4 | Giant marquee | IMPACT + INSPIRE + INNOVATE (132 px uppercase, −0.08 em), BRANDING + A.I. + DESIGN + DEVELOPMENT | two rows moving in opposite directions, speed tied to scroll position; chrome/gradient fill on About | GSAP + ScrollTrigger |
| B5 | Char blur swap on hover | nav links, LET'S TALK, footer links, email/phone | text is doubled (`WorkWork`); on hover each char blurs out left→right and the twin set blurs in (~30 ms stagger, ~0.45 s total) | SplitText, two stacked copies |
| B6 | Letter-spacing wave | mono CTAs (DISCUSS YOUR PROJECT, EXPLORE PROJECT) | letters spread apart in a travelling wave then settle (~0.6 s) | per-char x |
| B7 | Counter roll | stats (40+, 1.5K+, 20+) | digit slots roll to the value on entry | translateY |
| B8 | Live clock | footer `IST → 02:24` | real local time | JS |

### C. Buttons and links
| # | Effect | Behaviour |
|---|---|---|
| C1 | Underline CTA | mono label + right arrow + 1 px underline. Hover: arrow exits right and re-enters on the **left**, underline collapses to the right and redraws from the left, label does B6. ~0.6 s, expo-out |
| C2 | Pill button | LET'S TALK: white pill darkens to grey while chars do B5 |
| C3 | Menu pill → panel morph | MENU pill grows into a tall rounded panel (grey → white, ~0.3 s), links stagger in with blur (~60 ms), contact block after; close reverses bottom-up |
| C4 | Sound toggle | 32 px square, speaker icon; crossed speaker when muted (default muted) |
| C5 | Slider arrows | square outlined boxes; border darkens on hover |
| C6 | Electric arc on hover | hovering MENU (near the hero lines) spawns a blue lightning arc around the pointer + spark sound |

### D. Cursor
| # | Effect | Notes |
|---|---|---|
| D1 | Native cursor only | `cursor: pointer` on links/buttons, `auto` elsewhere; no follower, no hold ring. The hold hint lives in the page ("HOLD TO 💥 BLAST / DARE ⚡ TO TOUCH THE LINES."), not at the cursor |

### E. Images / cards / visuals
| # | Effect | Where | Behaviour |
|---|---|---|---|
| E1 | Hover-to-play video | team / award cards | video starts (muted) on hover |
| E2 | Image swap on hover | award cards | image cross-fades to an alternate |
| E3 | Scattered parallax cards | /work | project cards at different depths/speeds, linked by thin curved "cable" lines; a small electric spark travels along a cable |
| E4 | Image tunnel | /work hero | thumbnails fly from depth toward a central logo |
| E5 | Striped (blind) image | /about lion | portrait cut into ~40 horizontal strips; strips are draggable and play sound ("drag the strips") |
| E6 | Circle mask expand | /about awards | image in a circle that grows to full-bleed on scroll |
| E7 | Pill mask expand | /trionn-story mascot | rounded-pill window that opens on scroll |
| E8 | Photo pile | /about "Work hard. Play loud." | photos thrown in with rotation onto a pile as you scroll |
| E9 | 3D ribbon carousel | Home "Design in motion" | images on a curved 3D ribbon that sweeps through, then settles into a grid |
| E10 | Swinging puppets | /contact hero | images hang on strings and sway |
| E11 | Orbiting planets | /trionn-story | planets on elliptical orbits, scroll-driven |

### F. Scroll effects
| # | Effect | Where | Behaviour |
|---|---|---|---|
| F1 | **Blind-strip section transition** (signature) | between dark and light sections on every page, and before the footer | ~12–16 horizontal bars of uneven thickness grow/shrink with scroll, slicing one section into the next |
| F2 | Pinned image-sequence scrub | Home services stone | 140 frames scrubbed by scroll; letters of the service words fly around the object, labels appear around it |
| F3 | Pinned stacked services | /services | left image card sticks, right column text changes per service, image clip-swaps |
| F4 | Horizontal pinned strip | Home "Selected work", /services "How we work" | vertical scroll drives a horizontal track; step markers + progress line |
| F5 | Scale / clip reveals | founder portrait, awards | images scale from ~0.8 and un-clip on entry |
| F6 | Accordion list | /services tech stack, /contact FAQ | numbered rows, + icon rotates, height animates |
| F7 | Progress line | "How we work" | dotted line with markers fills as steps advance |
| F8 | No velocity skew | (checked) | marquee speed follows scroll but no skew/stretch was observed |

### G. Page transitions
| # | Effect | Behaviour (Services → About, measured) | Sound |
|---|---|---|---|
| G1 | Blind-strip wipe | 0–0.45 s: strips of uneven height grow from thin lines until they cover the page (light grey #c3c3c3) | spark/zap (1.13 s sample) at a random playback rate (0.97 seen) |
| G2 | Holding card | 0.45–1.5 s: grey screen with 4 crosshair corners and the page name (ABOUT) small in the centre | |
| G3 | Reveal | 1.5–2.1 s: strips shrink away top-to-bottom revealing the new page; its headline words blur in in random order (~0.8 s) | |

### H. Footer
| # | Effect | Behaviour |
|---|---|---|
| H1 | Line wordmark | the brand name drawn as ~20 rows of horizontal hairlines; "SOUND ON ♪ HOVER THE LINES." |
| H2 | Line harp | crossing a line plays a plucked note, synthesised live: 4 sine oscillators (fundamental + partials) + a 0.1 s noise burst through a BiquadFilter whose cutoff sweeps ~1.6→2.5 kHz. Notes measured: 196, 220, 247, 294, 330, 392, 440, 494, 588, 660, 784, 988 Hz… = **G-major pentatonic** across octaves (line index → pitch). The touched line brightens |
| H3 | Smoke | WebGL smoke/fluid layer behind the footer that the pointer stirs |
| H4 | Big headline + CTAs, live clock, socials with B5 | |

### I. Click-and-hold ("HOLD TO BLAST", Home hero only)
Measured on three holds (hero centre; mid-page; "over an image", which fell back to the hero video area):
mid-page hold did **nothing** (no visual change, no audio): the effect is scoped to the hero.

| Phase | Time | What happens |
|---|---|---|
| Start | 0–0.25 s | nothing visible at first; the rotating headline keeps going |
| Build 1 | 0.25–1.1 s | the 3D logo pops apart: pieces fly outward/toward the camera; pale shards streak past |
| Build 2 | 1.1–2 s | **the whole DOM layer** (nav, headline, CTAs, stats) tilts in 3D (rotateZ ≈ −5°, slight rotateX/Y), zooms ~1.1–1.15× and drifts toward the pointer; text gets a directional blur; light streaks (warp lines) cross the screen |
| Build 3 | 2–4 s | the tilt/zoom keep growing slowly with small jitter; the scene darkens to near-black with shards and streaks; at ~3.8 s a **blue lightning arc** crackles at the centre |
| Release | 0–0.45 s | everything snaps back with overshoot (rotation swings past 0 and settles); shards rush back |
| Recover | 0.45–0.9 s | the logo reassembles; orange internal light flares on the joints; page is back to rest by ~0.9 s |

Audio for the hold (gain automation logged): a ~2.8 s whoosh/drone loop starts ~1 s into the hold; its gain jumps to
0.9 then rises along an exponential approach 0.38 → ~1.0 (time constant ≈ 0.6 s). Measured output RMS rose from 0.007
(bed) to ~0.12, spectral centroid low (~700 Hz) = a low rumble. On release: the spark sample (1.13 s) plus a 2.6 s
blast/reassemble sample fire; centroid jumps to 4.5–5.4 kHz for ~0.5 s (bright crackle), the tension loop's gain decays
1.0 → 0.07 over ~2.5 s, and the ambient bed carries on. Peak amplitude stayed ≤ 0.39 (never clipping).

## 3. Sound design (what plays, when, how loud)

All samples are fetched and decoded on the first gesture after sound is switched on (default **off**, toggle in the
nav). Levels are output RMS from the tap (full scale = 1).

| Sound | Trigger | Character | Level |
|---|---|---|---|
| Ambient bed | sound on; 4.56 s stereo loop (Web Audio, `loop`) | soft, dark drone, centroid ~700 Hz | gain ramps 0 → 0.07 over 2 s; RMS ≈ 0.007 (≈ −43 dBFS) |
| Thunder bed | `<audio loop>` `thunder.mp3`, wraps at 14 s | distant rumble (loaded on every page) | low |
| Hover beep | pointer crossing hero lines / interactive items; 80 ms | short bright tick, centroid ~7.8 kHz | peak ≈ 0.12 |
| Spark / zap | lightning arcs, menu, page transitions; 1.13 s | electric crackle; playbackRate randomised (~0.97–1.03) | peak ≈ 0.3 |
| Hold loop | click-and-hold; 2.8 s | rising whoosh/rumble | gain → 1.0, RMS ≈ 0.12 |
| Blast + reassemble | release; 2.6 s | crack + glassy shatter, bright then decaying | RMS ≈ 0.11, peak ≈ 0.36 |
| Line pluck | footer lines; synthesised | pentatonic harp pluck, osc + filtered noise | soft |
| Voice | /trionn-story | narration clips | |

Layering: the bed never stops while sound is on; one-shots are mixed on top through per-sound gain nodes; repeated
hovers are rate-limited (beeps ≥ ~20 ms apart). Nothing plays before the first user gesture.

## 4. Typography

| Role | Family (licence) | Size @1440 | Weight | Line-height | Tracking | Case |
|---|---|---|---|---|---|---|
| H1 hero | Familjen Grotesk (OFL, Google Fonts) | 90 px (6.25 vw) | 400 | 0.9 | −0.06 em | sentence |
| H2 section | Familjen Grotesk | 85.5 px | 400 (500 on some) | 0.95 | −0.06 em | sentence |
| Marquee | Familjen Grotesk | 132 px | 400 | 0.8 | −0.08 em | UPPER |
| H3 / card title | Familjen Grotesk | 32.4 px | 400 | 1.0 | −0.04 em | sentence |
| Nav / menu links | Familjen Grotesk | 18 px | 400 | 1.1 | −0.04 em | UPPER |
| Small labels | Familjen Grotesk | 12.6–15.3 px | 400 | 1.0 | −0.02 em | UPPER |
| Buttons / CTAs | Martian Mono Light (OFL, Google Fonts) | 12.6 px | 300 | 1.0 | −0.06 em | UPPER |
| Body | Neue Haas Grotesk Display Roman (**commercial**, Commercial Type/Monotype) | 16.2 px | 400 | ~1.25 | 0 | sentence |
| (declared, unused on pages seen) | PP Editorial New Ultralight (**commercial**, Pangram Pangram) | | 200 | | | |

Colours: text #d8d8d8 on #0c0c0c / #040508; light sections #c3c3c3 → #fff gradients with #434343 text; accent orange.

## 5. What PanoptiCoal takes from this (principles only)

- One idea per interaction, always tied to the brand story (their "blast" = our "scan deeper").
- Per-character work everywhere (blur swaps, random-order reveals) gives a consistent "decoding" voice.
- The blind-strip is a single motif reused for section breaks, page transitions and an image treatment.
- Sound is opt-in, quiet (bed ≈ −43 dBFS), sample-accurate on hover, and the loudest moment is the release.
- Mobile: hero hold and most hover effects are absent; the content still reads.
