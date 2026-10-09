// PanoptiCoal sound design: every sound is synthesised here with the Web Audio API (no audio files).
// Theme: a satellite watching from orbit.
//   bed      low drone (55 Hz + a fifth, slow filter drift) + faint air, with telemetry blips on a space echo
//   hover    soft data tick          click   short scan chirp        whoosh  page transition sweep
//   hold     rising tension: pitch, drive (distortion), brightness and level build while held
//   blast    release: sub-bass drop + filtered boom + crack + crackle tail into a generated reverb
//   pluck    footer scan lines, a minor-pentatonic "telemetry harp"
// Everything sums into a limiter (DynamicsCompressor, ratio 20) so the blast is loud but capped.
// The preference lives in localStorage ('pc-sound'); audio starts only after a user gesture
// (browsers block autoplay) and the context suspends while the tab is hidden. Reduced motion
// defaults to off unless the user turns it on.

const KEY = 'pc-sound'
const VOLUME = 0.7 // master, moderate
const BED = 0.55 // bed level inside the mix (the bed's own nodes are quiet)
const HOLD_FULL = 3.6 // seconds to full charge (matches lib/hold.ts)

type Listener = () => void

function readPref(): boolean {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'on') return true
    if (v === 'off') return false
  } catch {
    /* storage blocked */
  }
  return !(typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number, pinkish = false) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  const d = b.getChannelData(0)
  let b0 = 0, b1 = 0, b2 = 0
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1
    if (!pinkish) d[i] = w
    else {
      // Paul Kellet's economy pink filter
      b0 = 0.99765 * b0 + w * 0.099046
      b1 = 0.963 * b1 + w * 0.2965164
      b2 = 0.57 * b2 + w * 1.0526913
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18
    }
  }
  return b
}

// Sparse random clicks whose density and level fall away: the crackle after the blast.
function crackleBuffer(ctx: BaseAudioContext, seconds: number) {
  const b = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c)
    for (let i = 0; i < d.length; i++) {
      const u = 1 - i / d.length
      if (Math.random() < 0.004 * u * u) {
        const a = (0.4 + Math.random() * 0.6) * u * Math.sqrt(u)
        const len = 6 + Math.floor(Math.random() * 40)
        for (let k = 0; k < len && i + k < d.length; k++) d[i + k] += (Math.random() * 2 - 1) * a * (1 - k / len)
      }
    }
  }
  return b
}

// Exponentially decaying stereo noise: a cheap, smooth hall for the blast and blips.
function reverbIR(ctx: BaseAudioContext, seconds: number, decay: number) {
  const n = Math.floor(ctx.sampleRate * seconds)
  const b = ctx.createBuffer(2, n, ctx.sampleRate)
  const k = Math.exp(-decay / n) // e^-decay over the length: smooth exponential tail
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c)
    let g = 1
    for (let i = 0; i < n; i++, g *= k) d[i] = (Math.random() * 2 - 1) * g
  }
  return b
}

function driveCurve(k: number) {
  const n = 1024
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    c[i] = Math.tanh(k * x) / Math.tanh(k)
  }
  return c
}

interface HoldVoice {
  stop: (when: number) => void
  drive: GainNode
  out: GainNode
}

class SoundEngine {
  enabled = readPref()
  private ctx: AudioContext | null = null
  private master!: GainNode
  private mix!: GainNode
  private verb!: ConvolverNode
  private verbIn!: GainNode
  private echoIn!: GainNode
  private bedOut!: GainNode
  private noise!: AudioBuffer
  private crackle!: AudioBuffer
  private bedOn = false
  private blipTimer = 0
  private lastHover = 0
  private lastClick = 0
  private hold: HoldVoice | null = null
  private listeners = new Set<Listener>()
  private unlocked = false

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  /** Call from a user gesture (pointerdown / keydown). Creates or resumes the context. */
  unlock() {
    const first = !this.unlocked
    this.unlocked = true
    if (!this.enabled) {
      if (first) this.listeners.forEach((f) => f())
      return
    }
    if (!this.ctx) this.build()
    const ctx = this.ctx
    if (!ctx) return
    if (ctx.state !== 'running' && !document.hidden) void ctx.resume().then(() => this.listeners.forEach((f) => f()))
    if (!this.bedOn) this.startBed()
    if (first) this.listeners.forEach((f) => f())
  }

  /** A gesture has happened (audio can play). */
  get started() {
    return this.unlocked
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running' && this.enabled
  }

  setEnabled(on: boolean) {
    if (on === this.enabled) return
    this.enabled = on
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off')
    } catch {
      /* storage blocked */
    }
    const ctx = this.ctx
    if (on) {
      // The toggle click is itself a gesture.
      this.unlock()
      if (this.ctx) {
        const g = this.master.gain, t = this.ctx.currentTime
        g.cancelScheduledValues(t)
        g.setValueAtTime(g.value, t)
        g.linearRampToValueAtTime(VOLUME, t + 0.6)
        this.toggleChirp(true)
      }
    } else if (ctx) {
      this.toggleChirp(false)
      const g = this.master.gain, t = ctx.currentTime
      g.cancelScheduledValues(t)
      g.setValueAtTime(g.value, t)
      g.linearRampToValueAtTime(0, t + 0.45)
      window.setTimeout(() => {
        if (!this.enabled && this.ctx?.state === 'running') void this.ctx.suspend()
      }, 520)
    }
    this.listeners.forEach((f) => f())
  }

  toggle() {
    this.setEnabled(!this.enabled)
  }

  /** What a sound switch does when pressed. */
  press() {
    if (this.enabled && !this.unlocked) this.unlock()
    else this.toggle()
  }

  private build() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC({ latencyHint: 'interactive' })
    this.ctx = ctx
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -10
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.001
    limiter.release.value = 0.22
    this.master = ctx.createGain()
    this.master.gain.value = 0
    this.master.gain.linearRampToValueAtTime(VOLUME, ctx.currentTime + 0.8)
    this.mix = ctx.createGain()
    this.mix.connect(limiter).connect(this.master).connect(ctx.destination)
    // Reverb send (blast, blips)
    this.verb = ctx.createConvolver()
    this.verbIn = ctx.createGain()
    this.verbIn.gain.value = 0.35
    this.verbIn.connect(this.verb).connect(this.mix)
    // Space echo send (telemetry blips, chirps): delay with damped feedback
    const delay = ctx.createDelay(1)
    delay.delayTime.value = 0.29
    const fb = ctx.createGain()
    fb.gain.value = 0.38
    const damp = ctx.createBiquadFilter()
    damp.type = 'lowpass'
    damp.frequency.value = 2400
    this.echoIn = ctx.createGain()
    this.echoIn.gain.value = 0.5
    this.echoIn.connect(delay)
    delay.connect(damp).connect(fb).connect(delay)
    damp.connect(this.mix)
    this.noise = noiseBuffer(ctx, 2, false)
    this.crackle = ctx.createBuffer(2, 1, ctx.sampleRate) // filled at idle
    // The reverb impulse and the crackle tail are generated off the gesture, at idle time.
    const idle = (fn: () => void) => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout: 1500 })
      else setTimeout(fn, 200)
    }
    idle(() => {
      this.verb.buffer = reverbIR(ctx, 2.6, 4.2)
      idle(() => (this.crackle = crackleBuffer(ctx, 1.6)))
    })
    this.bedOut = ctx.createGain()
    this.bedOut.gain.value = 0
    this.bedOut.connect(this.mix)
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return
      if (document.hidden) void this.ctx.suspend()
      else if (this.enabled && this.unlocked) void this.ctx.resume()
    })
  }

  private startBed() {
    const ctx = this.ctx
    if (!ctx || this.bedOn) return
    this.bedOn = true
    const t = ctx.currentTime
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 240
    lp.Q.value = 0.8
    const drift = ctx.createOscillator()
    drift.frequency.value = 0.045
    const driftAmt = ctx.createGain()
    driftAmt.gain.value = 120
    drift.connect(driftAmt).connect(lp.frequency)
    const drone = ctx.createGain()
    drone.gain.value = 0.032
    for (const [type, f, det, g] of [
      ['sine', 55, 0, 0.9],
      ['triangle', 82.4, 4, 0.45],
      ['sawtooth', 110, -6, 0.18],
      ['sawtooth', 110.6, 7, 0.14],
    ] as const) {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = f
      o.detune.value = det
      const og = ctx.createGain()
      og.gain.value = g
      o.connect(og).connect(lp)
      o.start(t)
    }
    lp.connect(drone).connect(this.bedOut)
    // Air: pink-ish noise, band-limited, breathing slowly
    const air = ctx.createBufferSource()
    air.buffer = noiseBuffer(ctx, 3, true)
    air.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 650
    bp.Q.value = 0.6
    const airG = ctx.createGain()
    airG.gain.value = 0.018
    const breath = ctx.createOscillator()
    breath.frequency.value = 0.07
    const breathAmt = ctx.createGain()
    breathAmt.gain.value = 0.011
    breath.connect(breathAmt).connect(airG.gain)
    air.connect(bp).connect(airG).connect(this.bedOut)
    drift.start(t)
    breath.start(t)
    air.start(t)
    this.bedOut.gain.setValueAtTime(0, t)
    this.bedOut.gain.linearRampToValueAtTime(BED, t + 2.5)
    this.scheduleBlip()
  }

  private scheduleBlip() {
    window.clearTimeout(this.blipTimer)
    this.blipTimer = window.setTimeout(() => {
      if (this.ready && !this.hold) this.blip()
      this.scheduleBlip()
    }, 2600 + Math.random() * 5200)
  }

  /** Radio-telemetry blip: one to three short pips at a random pitch from a fixed set, panned. */
  blip() {
    const ctx = this.ctx
    if (!this.ready || !ctx) return
    const f = [1318.5, 1568, 1760, 2093][Math.floor(Math.random() * 4)]
    const n = Math.random() < 0.55 ? 1 : Math.random() < 0.7 ? 2 : 3
    const pan = ctx.createStereoPanner()
    pan.pan.value = Math.random() * 1.2 - 0.6
    const g = ctx.createGain()
    g.gain.value = 0.028
    g.connect(pan)
    pan.connect(this.mix)
    pan.connect(this.echoIn)
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + 0.02 + i * 0.11
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(f * (i === n - 1 && n > 1 ? 1.5 : 1), t)
      const e = ctx.createGain()
      e.gain.setValueAtTime(0, t)
      e.gain.linearRampToValueAtTime(1, t + 0.004)
      e.gain.setTargetAtTime(0, t + 0.03, 0.012)
      o.connect(e).connect(g)
      o.start(t)
      o.stop(t + 0.15)
    }
  }

  /** Soft data tick on hover; pitch by kind, rate-limited. */
  hover(kind: 'link' | 'button' | 'card' | 'chip' = 'link') {
    const ctx = this.ctx
    if (!this.ready || !ctx) return
    const now = performance.now()
    if (now - this.lastHover < 45) return
    this.lastHover = now
    const t = ctx.currentTime + 0.005
    const f = { link: 3200, button: 2600, card: 1900, chip: 2900 }[kind] * (0.97 + Math.random() * 0.06)
    const o = ctx.createOscillator()
    o.type = 'triangle'
    o.frequency.setValueAtTime(f, t)
    o.frequency.exponentialRampToValueAtTime(f * 0.82, t + 0.04)
    const e = ctx.createGain()
    e.gain.setValueAtTime(0, t)
    e.gain.linearRampToValueAtTime(0.045, t + 0.003)
    e.gain.setTargetAtTime(0, t + 0.008, 0.012)
    o.connect(e).connect(this.mix)
    o.start(t)
    o.stop(t + 0.09)
    // tiny click on top
    const n = ctx.createBufferSource()
    n.buffer = this.noise
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 5000
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0.03, t)
    ng.gain.setTargetAtTime(0, t + 0.002, 0.004)
    n.connect(hp).connect(ng).connect(this.mix)
    n.start(t, Math.random() * 1.5, 0.03)
  }

  /** Short scan chirp on click: an upward sine sweep with a settling tail, into the echo. */
  click() {
    const ctx = this.ctx
    if (!this.ready || !ctx) return
    const now = performance.now()
    if (now - this.lastClick < 60) return
    this.lastClick = now
    const t = ctx.currentTime + 0.005
    const g = ctx.createGain()
    g.gain.value = 0.07
    g.connect(this.mix)
    g.connect(this.echoIn)
    for (const [mul, lvl] of [[1, 1], [2.01, 0.25]] as const) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(700 * mul, t)
      o.frequency.exponentialRampToValueAtTime(2600 * mul, t + 0.07)
      o.frequency.exponentialRampToValueAtTime(1900 * mul, t + 0.12)
      const e = ctx.createGain()
      e.gain.setValueAtTime(0, t)
      e.gain.linearRampToValueAtTime(lvl, t + 0.006)
      e.gain.setTargetAtTime(0, t + 0.08, 0.025)
      o.connect(e).connect(g)
      o.start(t)
      o.stop(t + 0.25)
    }
  }

  private toggleChirp(up: boolean) {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime + 0.01
    ;[0, 1].forEach((i) => {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = (up ? [880, 1320] : [1320, 880])[i]
      const e = ctx.createGain()
      const s = t + i * 0.08
      e.gain.setValueAtTime(0, s)
      e.gain.linearRampToValueAtTime(0.05, s + 0.005)
      e.gain.setTargetAtTime(0, s + 0.04, 0.02)
      o.connect(e).connect(this.mix)
      o.start(s)
      o.stop(s + 0.2)
    })
  }

  /** Page transition: band-passed noise sweeping up and down, panning left to right. */
  whoosh(dur = 0.95) {
    const ctx = this.ctx
    if (!this.ready || !ctx) return
    const t = ctx.currentTime + 0.01
    const n = ctx.createBufferSource()
    n.buffer = this.noise
    n.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 1.4
    bp.frequency.setValueAtTime(260, t)
    bp.frequency.exponentialRampToValueAtTime(2300, t + dur * 0.45)
    bp.frequency.exponentialRampToValueAtTime(420, t + dur)
    const e = ctx.createGain()
    e.gain.setValueAtTime(0, t)
    e.gain.linearRampToValueAtTime(0.22, t + dur * 0.42)
    e.gain.linearRampToValueAtTime(0, t + dur)
    const pan = ctx.createStereoPanner()
    pan.pan.setValueAtTime(-0.75, t)
    pan.pan.linearRampToValueAtTime(0.75, t + dur)
    n.connect(bp).connect(e).connect(pan).connect(this.mix)
    pan.connect(this.verbIn)
    n.start(t)
    n.stop(t + dur + 0.05)
  }

  /** Click-and-hold: rising tension until release (or until stopped). */
  holdStart() {
    const ctx = this.ctx
    if (!this.ready || !ctx || this.hold) return
    const t = ctx.currentTime + 0.01
    const end = t + HOLD_FULL
    const drive = ctx.createGain()
    drive.gain.setValueAtTime(1, t)
    drive.gain.exponentialRampToValueAtTime(9, end)
    const shaper = ctx.createWaveShaper()
    shaper.curve = driveCurve(2.5)
    shaper.oversample = '2x'
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.Q.value = 3
    lp.frequency.setValueAtTime(180, t)
    lp.frequency.exponentialRampToValueAtTime(3600, end)
    const trem = ctx.createGain()
    trem.gain.value = 0.75
    const lfo = ctx.createOscillator()
    lfo.frequency.setValueAtTime(3, t)
    lfo.frequency.exponentialRampToValueAtTime(19, end)
    const lfoAmt = ctx.createGain()
    lfoAmt.gain.setValueAtTime(0.05, t)
    lfoAmt.gain.linearRampToValueAtTime(0.25, end)
    lfo.connect(lfoAmt).connect(trem.gain)
    const out = ctx.createGain()
    out.gain.setValueAtTime(0, t)
    out.gain.linearRampToValueAtTime(0.05, t + 0.25)
    out.gain.exponentialRampToValueAtTime(0.17, end)
    const oscs: AudioScheduledSourceNode[] = [lfo]
    for (const [type, f, det] of [
      ['sawtooth', 55, 0],
      ['sawtooth', 55, 9],
      ['square', 27.5, -4],
    ] as const) {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.setValueAtTime(f, t)
      o.frequency.exponentialRampToValueAtTime(f * 3, end)
      o.detune.value = det
      o.connect(drive)
      oscs.push(o)
    }
    // Wind riser
    const n = ctx.createBufferSource()
    n.buffer = this.noise
    n.loop = true
    const nbp = ctx.createBiquadFilter()
    nbp.type = 'bandpass'
    nbp.Q.value = 2
    nbp.frequency.setValueAtTime(300, t)
    nbp.frequency.exponentialRampToValueAtTime(4200, end)
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0.0, t)
    ng.gain.linearRampToValueAtTime(0.35, end)
    n.connect(nbp).connect(ng).connect(drive)
    oscs.push(n)
    drive.connect(shaper).connect(lp).connect(trem).connect(out).connect(this.mix)
    oscs.forEach((o) => o.start(t))
    // Duck the bed
    const bg = this.bedOut.gain
    bg.cancelScheduledValues(t)
    bg.setValueAtTime(bg.value, t)
    bg.linearRampToValueAtTime(BED * 0.25, t + 0.6)
    this.hold = {
      drive,
      out,
      stop: (when: number) => {
        out.gain.cancelScheduledValues(when)
        out.gain.setValueAtTime(out.gain.value, when)
        out.gain.linearRampToValueAtTime(0, when + 0.06)
        oscs.forEach((o) => o.stop(when + 0.1))
      },
    }
  }

  /** Stop the tension without a blast (hold cancelled). */
  holdCancel() {
    const ctx = this.ctx
    if (!ctx || !this.hold) return
    const t = ctx.currentTime
    this.hold.stop(t)
    this.hold = null
    this.restoreBed(t, 0.8)
  }

  /** Release: the blast, scaled by how charged the hold was (0..1). */
  holdRelease(level: number) {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime + 0.005
    if (this.hold) {
      this.hold.stop(t)
      this.hold = null
    }
    if (!this.ready) return
    const a = 0.35 + 0.65 * Math.min(1, Math.max(0, level))
    // Sub-bass drop
    const sub = ctx.createOscillator()
    sub.type = 'sine'
    sub.frequency.setValueAtTime(95, t)
    sub.frequency.exponentialRampToValueAtTime(30, t + 0.55)
    const sg = ctx.createGain()
    sg.gain.setValueAtTime(0, t)
    sg.gain.linearRampToValueAtTime(0.95 * a, t + 0.006)
    sg.gain.setTargetAtTime(0, t + 0.08, 0.38)
    sub.connect(sg).connect(this.mix)
    sub.start(t)
    sub.stop(t + 2.2)
    // Boom body: noise through a closing low-pass
    const n = ctx.createBufferSource()
    n.buffer = this.noise
    n.loop = true
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(3200, t)
    lp.frequency.exponentialRampToValueAtTime(110, t + 0.9)
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0, t)
    ng.gain.linearRampToValueAtTime(0.75 * a, t + 0.004)
    ng.gain.setTargetAtTime(0, t + 0.03, 0.26)
    n.connect(lp).connect(ng)
    ng.connect(this.mix)
    ng.connect(this.verbIn)
    n.start(t)
    n.stop(t + 2)
    // Crack transient
    const c = ctx.createBufferSource()
    c.buffer = this.noise
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 1400
    const cg = ctx.createGain()
    cg.gain.setValueAtTime(0.6 * a, t)
    cg.gain.setTargetAtTime(0, t + 0.005, 0.012)
    c.connect(hp).connect(cg).connect(this.mix)
    c.start(t, Math.random(), 0.12)
    // Crackle tail
    const k = ctx.createBufferSource()
    k.buffer = this.crackle
    const khp = ctx.createBiquadFilter()
    khp.type = 'highpass'
    khp.frequency.value = 2200
    const kg = ctx.createGain()
    kg.gain.value = 0.32 * a
    k.connect(khp).connect(kg)
    kg.connect(this.mix)
    kg.connect(this.verbIn)
    k.start(t + 0.05)
    this.restoreBed(t + 0.5, 2.6)
  }

  private restoreBed(from: number, over: number) {
    if (!this.bedOn) return
    const bg = this.bedOut.gain
    bg.cancelScheduledValues(from)
    bg.setValueAtTime(bg.value, from)
    bg.linearRampToValueAtTime(BED, from + over)
  }

  /** Footer scan lines: minor pentatonic from A3, index i of n lines (top = high). */
  pluck(i: number, n: number) {
    const ctx = this.ctx
    if (!this.ready || !ctx) return
    const steps = [0, 3, 5, 7, 10]
    const k = Math.max(0, n - 1 - i)
    const semi = 12 * Math.floor(k / steps.length) + steps[k % steps.length]
    const f = 220 * Math.pow(2, semi / 12)
    const t = ctx.currentTime + 0.003
    const g = ctx.createGain()
    g.gain.value = 0.05
    const pan = ctx.createStereoPanner()
    pan.pan.value = (Math.random() - 0.5) * 0.6
    g.connect(pan).connect(this.mix)
    pan.connect(this.echoIn)
    for (const [mul, lvl, tau] of [[1, 1, 0.45], [2, 0.32, 0.25], [3, 0.12, 0.14]] as const) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = f * mul
      const e = ctx.createGain()
      e.gain.setValueAtTime(0, t)
      e.gain.linearRampToValueAtTime(lvl, t + 0.003)
      e.gain.setTargetAtTime(0, t + 0.004, tau)
      o.connect(e).connect(g)
      o.start(t)
      o.stop(t + tau * 6)
    }
    const nz = ctx.createBufferSource()
    nz.buffer = this.noise
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = f * 2
    bp.Q.value = 4
    const nzg = ctx.createGain()
    nzg.gain.setValueAtTime(0.5, t)
    nzg.gain.setTargetAtTime(0, t + 0.002, 0.01)
    nz.connect(bp).connect(nzg).connect(g)
    nz.start(t, Math.random(), 0.05)
  }

  /** Intro accents (only if already unlocked): orbit power-up, satellite pass. */
  rise(dur = 1.2) {
    const ctx = this.ctx
    if (!this.ready || !ctx) return
    const t = ctx.currentTime + 0.01
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(110, t)
    o.frequency.exponentialRampToValueAtTime(440, t + dur)
    const e = ctx.createGain()
    e.gain.setValueAtTime(0, t)
    e.gain.linearRampToValueAtTime(0.06, t + dur * 0.8)
    e.gain.linearRampToValueAtTime(0, t + dur)
    o.connect(e).connect(this.mix)
    e.connect(this.verbIn)
    o.start(t)
    o.stop(t + dur + 0.05)
  }
}

export const sound = new SoundEngine()

// First gesture anywhere unlocks audio (if the preference is on). Sound switches
// ([data-sound-toggle]) handle their own press: before any gesture it starts the sound, after it toggles.
if (typeof window !== 'undefined') {
  // Deferred a tick: opening the audio device (~100 ms the first time) then falls outside the input
  // event, e.g. inside a hold's 140 ms arming delay, instead of stalling a visible frame. The page's
  // user activation is sticky, so the context may still start.
  const first = (e: Event) => {
    if (!(e.target as Element | null)?.closest?.('[data-sound-toggle]')) window.setTimeout(() => sound.unlock(), 0)
  }
  window.addEventListener('pointerdown', first, { capture: true, passive: true })
  window.addEventListener('keydown', first, { capture: true })
}

// Dev-only handle for scripts/check-sound.mjs-style probing in the console.
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __sound: SoundEngine }).__sound = sound
