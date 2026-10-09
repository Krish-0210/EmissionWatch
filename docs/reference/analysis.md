# Reference analysis: previous hackathon site (4th nationally)

Source: `docs/reference/prev-hackathon.mp4`. It is a screen recording, 9.8 s long, at 2558×1344 and 30 fps.
Frames are in `docs/reference/frames/` (gitignored):
- `a_*` are every 0.5 s for 0–8 s;
- `b_*` are every 1.5 s after that.

**Scope note.** The recording shows only:
- the opening animation;
- the settled hero;
- one scroll into the start of the second section.

No inner pages are in it. Section (b) is therefore based on what is visible: the hero, its idle state and one section
hand-off. To analyse inner pages, add a longer recording to this folder.

## (a) The opening animation

| t (s) | What is on screen |
|---|---|
| 0.0 | Near-black canvas with a faint blueprint grid (~120 px cells), scattered `+` crosshair marks and small ruler ticks with numbers on the left and right edges. In the centre is a large, loose sphere of warm peach/white particles. The particles vary in size and the near ones are soft, like bokeh. |
| 0.5 | The sphere contracts and condenses. The particles get smaller, cooler (white/grey) and more uniform, and the shape briefly stretches vertically, like it is being squeezed into form. |
| 1.0–1.5 | It settles into an evenly dotted sphere (lattice-like distribution) at the screen centre. Nothing else is on screen yet. |
| 2.0 | Hand-off begins. The nav fades in at the top, and the sphere now sits at about 70 % x with a soft violet radial glow behind it. A small eyebrow badge appears on the left. The first headline line starts entering through a line mask (glyphs slide up from a clipped edge). |
| 2.5 | Headline line 1 is complete. Line 2, in the accent colour, is mid-mask-reveal. |
| 3.0 | Body copy and the two CTAs fade in from a blur to sharp focus. Four small capability chips appear around the sphere (mono uppercase label plus a tiny icon tile). Under the sphere is a round glowing microphone button with a mono label. |
| 3.5 | A row of feature tags (accent dots plus mono labels) lands under the CTAs. The hero is complete. |
| 3.5–8 | Idle: the sphere keeps rotating, the chips drift a few px independently, and the glow breathes. |

**Summary.** One object (the sphere) carries the whole opening: chaos → form → it moves aside → the UI assembles in
reading order. The total is about 3.5 s, and there is no hard cut: the object that opens the site is the hero visual.

## (b) Why it feels interactive (from what is visible)

1. **Something is always moving, and it is the focal point.** The sphere never stops rotating, so the page reads as
   live even when the user does nothing.
2. **Layered depth with independent motion.** It has 4–5 planes:
   - grid (static, far);
   - glow (breathing);
   - sphere (rotating);
   - chips (bobbing, near);
   - copy (static).

   Planes moving at different rates read as depth without any scroll parallax.
3. **Choreographed reading order.** Elements arrive one at a time, roughly 150–250 ms apart, in the order the eye
   should read them:
   - object → nav → eyebrow → headline line 1 → line 2 → body → CTAs → chips → tags.
4. **Varied reveal types.** It mixes mask-slide (headline), blur-to-focus (body, CTAs) and fades (chips). No two
   adjacent beats use the same motion, so the sequence never feels mechanical.
5. **Instrument texture.** Grid, crosshairs and edge rulers make a dark page feel like a precision tool rather than
   empty space. The effect is cheap (static, low contrast) but carries a lot of mood.
6. **Explicit invitations.** A glowing round button labelled with what will happen ("speak to interact") gives the
   visitor a reason to touch something on the first screen. The primary CTA has a gradient and a soft glow; the
   secondary is a ghost button.
7. **One accent colour, used as a path.** The single warm accent marks:
   - the second headline line;
   - the CTA;
   - the mic button;
   - the chip icons;
   - the tag dots.

   The eye moves between these as a route.
8. **Type contrast.** A heavy grotesque display face in two tones (white, then accent) sits against small mono
   uppercase labels for metadata. The mono labels make the content look like data.
9. **Section hand-offs are events.** At the end of the hero:
   - the grid background ends on a hard edge;
   - the next section opens with an eyebrow flanked by hairlines;
   - the next headline reveals word by word.

   Scrolling is rewarded with a new "scene", not just more content.

## (c) Principles to adopt for PanoptiCoal (principles only, no designs)

- **One live focal object per page, made of the page's own data:**
  - the globe on Home;
  - a pulsing map on the risk map;
  - a gauge plus rings on a cluster;
  - a radar on Near Me.

  It never sits fully still.
- **3–4 depth planes, each with its own slow motion:** background mesh, texture, focal object, near accents.
  Transform/opacity only.
- **Ordered entrances:** reveal in reading order, 100–200 ms apart, and mix at least two reveal types per sequence.
  Inner-page heroes finish within about 1.2 s.
- **An instrument texture that is ours.** A satellite instrument suggests scanlines, orbit arcs and swath ticks. We do
  not reuse the grid, crosshairs or edge rulers.
- **Every page invites one action and says what it does:** "Select a cluster to fly in", "Use my location", "Generate
  inspection brief".
- **Colour discipline.** Teal (signal) means the instrument; ember means what needs attention. Risk colours appear only
  on risk data.
- **Mono micro-labels for anything that is data:** units, dates, counts, sources.
- **Section boundaries are events:** eyebrow, rule draw-in, staggered reveal. Each page gets its own hero scene.
- **Opening length ≤ 3.5 s, and the opening object becomes the hero visual** (no hard cut).

What we deliberately do **not** take:
- the particle sphere and its chaos-to-form collapse;
- the object sliding aside while the copy types in;
- floating capability chips around the object;
- the grid/crosshair/ruler HUD;
- the mic button;
- the line-mask headline sequence.

---

## Opening concepts for PanoptiCoal

The story is: plants report their own pollution, and a satellite watches from orbit. The name comes from the
panopticon, the watcher that sees everything.

### 1. The eye opens

- **Sequence:**
  - A hairline seam of light opens into an almond aperture.
  - Inside, concentric orbit rings draw in as an iris, counter-rotating.
  - A satellite dot runs the outer ring while a scan beam sweeps the iris.
  - A mono counter runs 000→100 beside status lines built from the real export
    (LINKING SENTINEL-5P · 11 CLUSTERS · 31 PLANTS · 19,183 CLUSTER-DAYS).
  - The PANOPTICOAL letters assemble.
  - The pupil dilates past the screen edges.
- **Placement:** the iris sits exactly where the hero globe will be, and the Earth is already visible *through the
  pupil*.
- **Handoff:** when the pupil opens, the camera pulls back out of it into the globe.

### 2. Self-report vs sky

- **Sequence:**
  - A column of real self-reported generation numbers scrolls like a ledger.
  - A satellite scan line passes over it, and where it passes, the numbers are overprinted with the NO₂ seen from
    space.
  - Mismatches flare in ember.
  - The ledger collapses into the wordmark, and the scan line becomes the globe's orbit.
- **Strength:** the most literal statement of the method.
- **Weakness:** the handoff to a 3D globe is a change of medium (text → sphere), so it needs a cross-fade, and
  numbers need reading time.

### 3. Ground track

- **Sequence:**
  - A satellite draws its ground track across a black screen.
  - Underneath, India's outline is revealed only where the swath has passed.
  - The 11 clusters ping at their true positions, coloured by risk.
  - Zoom out: the swaths wrap into a sphere and become the globe.
- **Strength:** true data from frame one.
- **Weakness:** the wrap from flat map to sphere is a hard morph (costly to do well in 3.5 s, and it reads as a map
  trick rather than a brand moment). The wordmark has no natural place in it.

### Comparison with the reference

Scores are 1–5.

| | Originality vs reference | Wow factor | Clarity of story | Performance |
|---|---|---|---|---|
| Reference: particle sphere → hero | – | 3 | 2 (a sphere says nothing about captions) | 4 |
| 1. The eye opens | 5 (no particles, no sphere, no slide-aside; opens, watches, dilates) | 5 | 5 (name + watching + real counts) | 5 (SVG/CSS transforms; the hole is a composited box-shadow) |
| 2. Self-report vs sky | 5 | 3 | 4 | 4 |
| 3. Ground track | 4 | 4 | 3 | 3 (flat → sphere morph) |

**Chosen: 1, the eye opens.** It turns the product's name into the opening shot. It shows real numbers from the
export. And it hands off *into* the actual WebGL Earth rather than replacing a placeholder.

**Why it beats the reference, in one line:** the reference's sphere is decoration that moves aside, while our opening
object is the product's meaning (an eye that watches coal plants) and literally becomes the live Earth.

### Implementation notes

- **Timing:** 3.4 s total.
  - 0–0.5 aperture.
  - 0.3–1.3 iris rings.
  - 0.9–2.5 satellite, scan, counter and status.
  - 1.9–2.7 wordmark.
  - 2.6–3.4 dilation and camera pull-back.
- **Skip:** click, any key, or the Skip button jumps to the dilation.
- **Frequency:** once per session (sessionStorage), and only when landing on Home.
- **Reduced motion:** a 0.4 s fade.
- **Preloading:** the 3D hero mounts at the start of the intro, so it is rendering by the time the pupil opens.
