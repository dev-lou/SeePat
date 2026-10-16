#!/usr/bin/env node
/**
 * Assemble the SeePat promo video from the recorded take.
 *
 * Built in stages rather than one enormous filter graph, because a single
 * -filter_complex with three video segments and fifteen audio inputs is
 * unreadable and undebuggable: each stage writes a file that can be inspected on
 * its own.
 *
 *   1. title card   (lavfi colour + drawtext + fades)
 *   2. demo         (the concat frame list -> 30 fps, with a slow Ken Burns drift)
 *   3. end card
 *   4. concat       -> silent master
 *   5. audio        (each narration line delayed to its beat, music bed under it)
 *   6. mux          (burn the captions, encode, faststart)
 *
 * The drift exists because a headless screencast only pushes frames when the page
 * repaints, which measured about 5 fps on this machine. A slow continuous pan
 * gives the eye smooth motion at 30 fps while the app itself stays a faithful
 * capture -- no interpolation, no invented frames.
 *
 * Usage:  node tools/build-video.mjs
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import sharp from 'sharp'

const FF = process.env.FFMPEG ?? 'C:/Users/Lou/AppData/Local/Temp/vidtool/node_modules/ffmpeg-static/ffmpeg.exe'
const DIR = 'docs/video'
const RAW = join(DIR, 'raw')
const VOICE = join(DIR, 'voice')
/** Set MUSIC to another bed; the default is the track this project licensed. */
const MUSIC = process.env.MUSIC ?? join(DIR, 'music', 'track-644.mp3')
const W = 1080
const H = 1920
const FPS = 30
const BG = '0x050f28'
const GOLD = '0xdda60c'
const FONT_BOLD = 'C\\:/Windows/Fonts/arialbd.ttf'
const FONT = 'C\\:/Windows/Fonts/arial.ttf'
/** Output base name; the cuts are <NAME>_1080x1920.mp4 and <NAME>_1920x1080.mp4. */
const NAME = process.env.VIDEO_NAME ?? 'SeePat_promo'
const OUT = join(DIR, `${NAME}_1080x1920.mp4`)

const spec = JSON.parse(readFileSync(join(DIR, 'narration.json'), 'utf8'))
const take = JSON.parse(readFileSync(join(RAW, 'take.json'), 'utf8'))

/*
 * Brand and card copy come from the spec, not from this script: a run in
 * another app must not put this project's wordmark or tagline on screen.
 * The fallbacks below are the copy this project shipped, and they are only
 * reached when there is no boot screen to film (the drawn cards are the
 * fallback).
 */
const BRAND = spec.brand ?? 'SeePat'
// The brand goes into a quoted drawtext filter, where colon and backslash
// escape and a quote would close the string, so escape it before it gets there.
const brandTxt = BRAND.replace(/([\':])/g, '\$1')
const TITLE_SUB = spec.title.sub ?? 'Hindi lang record. Nauunawaan.'
const END_SUB = spec.end.sub ?? TITLE_SUB
const END_URL = spec.end.url ?? 'Data stays on your phone  ·  Works offline'


function run(args, label) {
  const res = spawnSync(FF, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (res.status !== 0) {
    console.error(`\n${label} FAILED (exit ${res.status})`)
    console.error((res.stderr ?? '').split('\n').slice(-18).join('\n'))
    process.exit(1)
  }
  const note = /(?:frame=\s*(\d+))/.exec(res.stderr ?? '')
  console.log(`${label} ok${note ? ` (${note[1]} frames)` : ''}`)
}

/** Duration of a mono/stereo PCM wav, straight from the header. */
function wavSeconds(path) {
  const b = readFileSync(path)
  const ch = b.readUInt16LE(22)
  const sr = b.readUInt32LE(24)
  const bits = b.readUInt16LE(34)
  return (b.length - 44) / (sr * ch * (bits / 8))
}

/**
 * How much of the capture to drop from the front.
 *
 * The recording starts before the app has painted, so the first ~1 s is the
 * page's white loading splash. Left in, the promo flashes white immediately after
 * the title card. The first beat marks the moment the real screen is up, so that
 * is the cut point -- and every narration and caption time shifts with it.
 */
const TRIM =
  typeof take.preRollSeconds === 'number' && take.preRollSeconds > 0.05
    ? take.preRollSeconds
    : take.beats[0]?.videoStart > 0.2
      ? take.beats[0].videoStart
      : 0

/*
 * The two cold opens: the app's own boot screen, then the chapter card that lists
 * the steps. Narration for the walkthrough is offset by both, so INTRO is the
 * single number that keeps voice, captions and pictures on the same clock.
 */
const HOWTO_SECONDS = spec.howto?.duration ?? 0
const INTRO = spec.title.duration + HOWTO_SECONDS

/*
 * Where the demo's own zero is.
 *
 * Not the splash trim and not the first frame of the capture: the first clip
 * begins at the dashboard beat, because that is the frame the recorder stamped as
 * the app being up. Offset from the splash trim instead and every line lands 1.34s
 * late against the picture -- and the mix comes out 1.34s longer than the video, so
 * the last frame freezes while the voice finishes. Both measured on the built film.
 */
const ORIGIN = take.beats[0]?.videoStart ?? TRIM

// Audio and captions both come out of the same table, so the burned-in text can
// never drift from the spoken words.
const beatOf = (name) => take.beats.find((b) => b.name === name)
const timeline = []
for (const line of spec.lines) {
  const wav = join(VOICE, `line-${String(line.id).padStart(2, '0')}.wav`)
  if (!existsSync(wav)) throw new Error(`missing ${wav}`)
  let start
  if (line.beat === 'title') start = line.offset
  else if (line.beat === 'howto') start = spec.title.duration + line.offset
  else if (line.beat === 'end') start = INTRO + (take.duration_estimate - ORIGIN) + line.offset
  else {
    const beat = beatOf(line.beat)
    if (!beat) throw new Error(`unknown beat ${line.beat}`)
    start = INTRO + (beat.videoStart - ORIGIN) + line.offset
  }
  timeline.push({ ...line, wav, start: Math.max(0, start), dur: wavSeconds(wav) })
}

const demoSecs = take.duration_estimate - ORIGIN
const total = INTRO + demoSecs + spec.end.duration
console.log(
  `capture origin: demo starts at ${ORIGIN.toFixed(2)}s of the take ` +
    `(loading splash ${TRIM.toFixed(2)}s, dropped)`,
)

// Fail loudly if the voice collides, rather than shipping overlapping speech.
timeline.sort((a, b) => a.start - b.start)
let overlaps = 0
for (let i = 1; i < timeline.length; i++) {
  const prev = timeline[i - 1]
  const gap = timeline[i].start - (prev.start + prev.dur)
  if (gap < 0) {
    overlaps++
    console.log(`  overlap: line ${prev.id} -> ${timeline[i].id} by ${(-gap).toFixed(2)}s`)
  }
}
console.log(`timeline: ${timeline.length} lines, total ${total.toFixed(2)}s, ${overlaps} overlap(s)`)

/*
 * The second timing risk after two lines colliding: a line outlasting the screen it
 * belongs to. It is not automatically wrong -- a scene change is held on the old
 * screen for about a second, so a word or two of spill still lands over the right
 * picture -- but the size of the spill is the difference between that and a
 * sentence describing a screen the viewer has already left, so it is measured
 * rather than assumed.
 */
const screenEnd = (line) => {
  if (line.beat === 'title' || line.beat === 'howto') return INTRO
  if (line.beat === 'end') return total
  const i = take.beats.findIndex((b) => b.name === line.beat)
  const next = take.beats[i + 1]
  return INTRO + ((next ? next.videoStart : take.duration_estimate) - ORIGIN)
}
let spills = 0
for (const line of timeline) {
  const over = line.start + line.dur - screenEnd(line)
  if (over > 0.05) {
    spills++
    console.log(`  line ${String(line.id).padStart(2)} runs ${over.toFixed(2)}s past its screen (${line.beat})`)
  }
}
if (spills === 0) console.log('every line ends inside its own screen')

mkdirSync(join(DIR, 'build'), { recursive: true })

// --- captions ------------------------------------------------------------
const assTime = (s) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const cs = Math.round((s - Math.floor(s)) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}
// PlayResX/Y must equal the frame size or libass scales the font by its assumed
// 384x288 script -- which put 24 px text at 160 px, mid-frame, in testing.
const captions = [
  '[Script Info]',
  'ScriptType: v4.00+',
  `PlayResX: ${W}`,
  `PlayResY: ${H}`,
  'WrapStyle: 0',
  'ScaledBorderAndShadow: yes',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  // BorderStyle=3 draws an opaque plate behind the text. An outline and shadow
  // looked fine on the dark dashboard but vanished on the app's white cards, and
  // the shadow read as doubled text; a plate is legible on any background.
  'Style: Cap,Arial,44,&H00FFFFFF,&H000000FF,&H6E101428,&H00000000,0,0,0,0,100,100,0,0,3,12,0,2,70,70,195,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
]
for (const line of timeline.filter((l) => l.caption)) {
  const end = Math.min(line.start + line.dur + 0.25, total - 0.2)
  // A short fade keeps captions from popping as the camera moves under them.
  captions.push(`Dialogue: 0,${assTime(line.start)},${assTime(end)},Cap,,0,0,0,,{\\fad(160,160)}${line.text}`)
}
writeFileSync(join(DIR, 'captions.ass'), captions.join('\n') + '\n')
console.log(`captions.ass: ${timeline.filter((l) => l.caption).length} cues`)

// --- cards ---------------------------------------------------------------
/*
 * The bookends are the app's own boot screen, filmed, not a card drawn here.
 *
 * It is the real brand moment -- the official lockup, its sheen sweep and the
 * progress bar -- and because it is the app's own canvas, the cut into the
 * interface is a fade rather than a jump between two looks. The drawtext cards
 * below remain as a fallback for when no splash capture exists.
 *
 * Both bookends cut straight against the light app screens instead of fading to
 * black: a black flash between two pale screens is the one thing that looks like
 * a mistake.
 */
const SPLASH_DIR = join(DIR, 'splash')
const SPLASH_MP4 = join(DIR, 'build', 'splash.mp4')
let haveSplash = false
if (existsSync(join(SPLASH_DIR, 'frames.txt'))) {
  const splashTake = JSON.parse(readFileSync(join(SPLASH_DIR, 'take.json'), 'utf8'))
  const splashTrim = splashTake.preRollSeconds > 0.05 ? splashTake.preRollSeconds : 0
  run(
    [
      '-y', '-f', 'concat', '-safe', '0', '-i', join(SPLASH_DIR, 'frames.txt'),
      '-vf', `fps=${FPS}${splashTrim ? `,trim=start=${splashTrim.toFixed(2)},setpts=PTS-STARTPTS` : ''},format=yuv420p`,
      '-r', String(FPS), '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
      SPLASH_MP4,
    ],
    'splash footage',
  )
  haveSplash = true
} else {
  console.log('no splash capture found; falling back to drawtext cards')
}

// Single lines on purpose: multi-line drawtext centring needs text_align, which
// is not in every build, and a card that fails to render is worse than a card
// that is plain.
writeFileSync(join(DIR, 'build', 'title.txt'), TITLE_SUB)
writeFileSync(join(DIR, 'build', 'end.txt'), END_SUB)
writeFileSync(join(DIR, 'build', 'end-url.txt'), END_URL)

const cardFilter = (dur, textFile, subFile, bigY, subY) =>
  [
    `drawbox=x=0:y=${bigY - 90}:w=${W}:h=8:color=${GOLD}@1:t=fill`,
    `drawtext=fontfile='${FONT_BOLD}':text='${brandTxt}':fontsize=210:fontcolor=white:x=(w-text_w)/2:y=${bigY}`,
    `drawtext=fontfile='${FONT}':textfile='${textFile}':fontsize=54:fontcolor=${GOLD}:x=(w-text_w)/2:y=${subY}`,
    ...(subFile
      ? [`drawtext=fontfile='${FONT}':textfile='${subFile}':fontsize=34:fontcolor=0x9fb0d0:x=(w-text_w)/2:y=${H - 300}`]
      : []),
    `fade=t=in:st=0:d=0.6`,
    `fade=t=out:st=${(dur - 0.7).toFixed(2)}:d=0.7`,
    'format=yuv420p',
  ].join(',')

run(
  haveSplash
    ? [
        // Hold the finished lockup rather than looping: restarting the capture
        // replays the wordmark's fade-in mid-card and reads as a glitch.
        '-y', '-i', SPLASH_MP4,
        '-vf', 'tpad=stop_mode=clone:stop_duration=3,fade=t=in:st=0:d=0.5:color=white,format=yuv420p',
        '-t', spec.title.duration.toFixed(2),
        '-r', String(FPS), '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
        join(DIR, 'build', 'title.mp4'),
      ]
    : [
        '-y', '-f', 'lavfi', '-i', `color=c=${BG}:s=${W}x${H}:r=${FPS}:d=${spec.title.duration}`,
        '-vf', cardFilter(spec.title.duration, 'docs/video/build/title.txt', null, 780, 1020),
        '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
        join(DIR, 'build', 'title.mp4'),
      ],
  'title card',
)

/*
 * The chapter card, filmed from the app's own page.
 *
 * It is captured rather than drawn with drawtext because drawtext cannot stagger,
 * wrap or lay out a list -- and a card that opens a walkthrough has to look like
 * the product, not like a caption. The capture is only about three seconds, so the
 * tail is cloned to the full length and both ends fade through white, matching the
 * bookends instead of cutting to black between pale screens.
 */
const HOWTO_DIR = join(DIR, 'howto')
const HOWTO_MP4 = join(DIR, 'build', 'howto.mp4')
let haveHowto = false
if (HOWTO_SECONDS > 0 && existsSync(join(HOWTO_DIR, 'frames.txt'))) {
  const howtoTake = JSON.parse(readFileSync(join(HOWTO_DIR, 'take.json'), 'utf8'))
  const howtoTrim = howtoTake.preRollSeconds > 0.05 ? howtoTake.preRollSeconds : 0
  run(
    [
      '-y', '-f', 'concat', '-safe', '0', '-i', join(HOWTO_DIR, 'frames.txt'),
      '-vf', `fps=${FPS}${howtoTrim ? `,trim=start=${howtoTrim.toFixed(2)},setpts=PTS-STARTPTS` : ''},format=yuv420p`,
      '-r', String(FPS), '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p',
      join(DIR, 'build', 'howto-raw.mp4'),
    ],
    'howto footage',
  )
  run(
    [
      '-y', '-i', join(DIR, 'build', 'howto-raw.mp4'),
      '-vf',
        `tpad=stop_mode=clone:stop_duration=${(HOWTO_SECONDS + 2).toFixed(1)},` +
        `fade=t=in:st=0:d=0.5:color=white,fade=t=out:st=${Math.max(0.6, HOWTO_SECONDS - 0.6).toFixed(2)}:d=0.6:color=white,` +
        'format=yuv420p',
      '-t', HOWTO_SECONDS.toFixed(2),
      '-r', String(FPS), '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p',
      HOWTO_MP4,
    ],
    'howto card',
  )
  haveHowto = true
} else {
  console.log('no chapter card capture; the walkthrough opens straight on the app')
}

// --- the demo, with a camera -------------------------------------------------
/*
 * This is what makes it a demo rather than a screen recording.
 *
 * Each scene is rendered as its own clip with a virtual camera that pushes in on
 * the element being narrated and eases back out. The targets are the mark
 * rectangles the recorder measured from the live layout, so the framing follows
 * the real UI instead of an estimate.
 *
 * Two details that matter:
 *
 * - The gold focus ring is drawn onto the SOURCE frame before the camera moves,
 *   so it travels with the push-in for free. Drawing it after would mean
 *   recomputing its screen position every frame.
 * - Pan is expressed with `in_time`, because zoompan has no `t` variable, and it
 *   is clamped so the camera can never show the area outside the screen.
 */
/*
 * The step table lives in narration.json, which the recorder also reads to build
 * the chapter card. One list, so the agenda on the card and the chips on the film
 * cannot disagree about what the steps are or how many there are.
 */
const STEPS = spec.steps ?? []
const stepIndexOf = (beatName) => STEPS.findIndex((s) => s.beat === beatName)
const chipFor = (beatName) => {
  const i = stepIndexOf(beatName)
  return i < 0 ? null : `STEP ${i + 1} OF ${STEPS.length}   ·   ${STEPS[i].chip}`
}
/** Marks worth ringing; the rest only steer the camera. */
const RINGED = new Set([
  'profit-card',
  'ledger-recent',
  'sample-button',
  'draft-card',
  'capital-answer',
  'settings-row',
  'offline-card',
])
const ZOOM_MIN = 1.12
const ZOOM_MAX = 1.5

const marksFor = (beatName) => {
  const i = take.beats.findIndex((b) => b.name === beatName)
  const next = take.beats[i + 1]
  const from = take.beats[i].videoStart
  const to = next ? next.videoStart : take.duration_estimate
  return (take.marks ?? [])
    .filter((m) => m.videoTime >= from && m.videoTime < to)
    .map((m) => ({
      ...m,
      rel: m.videoTime - from,
      // device pixels: the capture is 2x the CSS viewport
      cx: (m.rect.x + m.rect.w / 2) * 2,
      cy: (m.rect.y + m.rect.h / 2) * 2,
      z: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min((W / (m.rect.w * 2)) * 0.92, (H / (m.rect.h * 2)) * 0.92))),
    }))
}

/** A smoothstepped piecewise expression over the camera's keyframes. */
function piecewise(keyframes, pick) {
  let expr = String(pick(keyframes[keyframes.length - 1]))
  for (let i = keyframes.length - 2; i >= 0; i--) {
    const a = keyframes[i]
    const b = keyframes[i + 1]
    const span = Math.max(0.001, b.t - a.t).toFixed(3)
    const k = `min(1,max(0,(in_time-${a.t.toFixed(3)})/${span}))`
    const ss = `(${k}*${k}*(3-2*${k}))`
    const va = pick(a)
    const vb = pick(b)
    expr = `if(lt(in_time,${b.t.toFixed(3)}),(${va}+(${vb}-${va})*${ss}),${expr})`
  }
  return expr
}

/** A rounded gold ring sized to a mark, padded so it sits outside the element. */
async function ringFile(mark) {
  const pad = 9
  const w = Math.round(mark.rect.w * 2 + pad * 2)
  const h = Math.round(mark.rect.h * 2 + pad * 2)
  const path = join(DIR, 'build', `ring-${mark.name}.png`)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect x="${pad + 5}" y="${pad + 5}" width="${w - pad * 2 - 10}" height="${h - pad * 2 - 10}" rx="30" ry="30"
      fill="none" stroke="#dda60c" stroke-width="8" stroke-linecap="round" />
  </svg>`
  await sharp(Buffer.from(svg)).png().toFile(path)
  return { path, pad }
}

/**
 * The touch marker: a dot with two rings that travel out of it.
 *
 * Rendered as three stills rather than animated, because each layer is faded on its
 * own clock and the stagger between them is what reads as a ripple. Pre-rendering
 * keeps it to plain overlays, and the sizes are in capture pixels.
 */
async function touchMarkFiles() {
  const svg = (size, body) =>
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${body}</svg>`)
  const make = async (name, size, body) => {
    const path = join(DIR, 'build', `touch-${name}.png`)
    await sharp(svg(size, body)).png().toFile(path)
    return path
  }
  const ring = (size, width, opacity) => {
    const r = size / 2 - width / 2 - 1
    return `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#dda60c" ` +
      `stroke-opacity="${opacity}" stroke-width="${width}" />`
  }
  return {
    // Small on purpose: a 60 px mark sat over the label of the chip it was
    // pressing, hiding the very word the demo had just tapped.
    dot: await make(
      'dot',
      60,
      '<circle cx="30" cy="30" r="20" fill="#dda60c" fill-opacity="0.26" />' +
        '<circle cx="30" cy="30" r="20" fill="none" stroke="#dda60c" stroke-width="3.5" />' +
        '<circle cx="30" cy="30" r="5.5" fill="#ffffff" />',
    ),
    ring1: await make('ring1', 180, ring(180, 5, '0.95')),
    ring2: await make('ring2', 320, ring(320, 4, '0.8')),
  }
}

/** Taps inside one scene, on the same clock as the marks. */
const tapsFor = (beatName) => {
  const i = take.beats.findIndex((b) => b.name === beatName)
  const next = take.beats[i + 1]
  const from = take.beats[i].videoStart
  const to = next ? next.videoStart : take.duration_estimate
  return (take.taps ?? [])
    .filter((t) => t.videoTime >= from && t.videoTime < to)
    .map((t) => ({ ...t, rel: t.videoTime - from }))
}

const TOUCH = await touchMarkFiles()

const clips = []
for (const [index, beat] of take.beats.entries()) {
  /*
   * Scenes run from this beat's first painted frame to the next beat's.
   *
   * Not to `beat.videoEnd`: that is the last frame that happened to arrive, and a
   * static screen can hold for several seconds without arriving at all -- so a
   * still that belongs to this scene would otherwise be replayed at the head of
   * the next one.
   */
  const nextBeat = take.beats[index + 1]
  const start = beat.videoStart
  const end = nextBeat ? nextBeat.videoStart : take.duration_estimate
  const dur = end - start
  const marks = marksFor(beat.name)

  // Camera keyframes: wide, then a push-in arriving just after each mark, hold,
  // then ease back to wide so every cut lands on the same framing.
  const kfs = [{ t: 0, z: 1, cx: W / 2, cy: H / 2 }]
  let currentZ = 1
  for (const m of marks) {
    kfs.push({ t: Math.max(0, m.rel - 0.45), z: currentZ, cx: m.cx, cy: m.cy })
    kfs.push({ t: Math.min(dur - 0.35, m.rel + 0.4), z: m.z, cx: m.cx, cy: m.cy })
    currentZ = m.z
  }
  kfs.push({ t: Math.max(0.2, dur - 0.8), z: currentZ, cx: kfs[kfs.length - 1].cx, cy: kfs[kfs.length - 1].cy })
  kfs.push({ t: dur, z: 1, cx: W / 2, cy: H / 2 })
  kfs.sort((a, b) => a.t - b.t)

  const zE = piecewise(kfs, (k) => k.z.toFixed(4))
  const cxE = piecewise(kfs, (k) => k.cx.toFixed(1))
  const cyE = piecewise(kfs, (k) => k.cy.toFixed(1))
  const zoom = `zoompan=z='${zE}':x='max(0,min(iw-iw/(${zE}),(${cxE})-iw/(${zE})/2))':y='max(0,min(ih-ih/(${zE}),(${cyE})-ih/(${zE})/2))':d=1:s=${W}x${H}:fps=${FPS}`

  const inputs = ['-y', '-f', 'concat', '-safe', '0', '-i', join(RAW, 'frames.txt')]
  const chains = [`[0:v]trim=start=${start.toFixed(2)}:end=${end.toFixed(2)},setpts=PTS-STARTPTS,fps=${FPS}[base]`]
  let video = 'base'
  let inputIndex = 1

  /**
   * Draw a still on the source frame, before the camera moves.
   *
   * Overlays go on the unscaled capture and the push-in happens afterwards, so a
   * marker stays locked to the element it was measured from and travels with the
   * camera for free. The alternative -- recomputing its position every frame --
   * would have to redo the camera maths in the overlay as well.
   */
  const addOverlay = (png, x, y, from, to, fadeIn, fadeOut) => {
    const a = Math.max(0, from)
    const b = Math.min(dur, Math.max(a + 0.25, to))
    inputs.push('-loop', '1', '-i', png)
    const label = `ov${inputIndex}`
    chains.push(
      `[${inputIndex}:v]format=rgba,fade=t=in:st=${a.toFixed(2)}:d=${fadeIn}:alpha=1,` +
        `fade=t=out:st=${Math.max(a, b - fadeOut).toFixed(2)}:d=${fadeOut}:alpha=1[in${inputIndex}]`,
      `[${video}][in${inputIndex}]overlay=x=${Math.round(x)}:y=${Math.round(y)}:` +
        `enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'[${label}]`,
    )
    video = label
    inputIndex++
  }

  for (const m of marks.filter((x) => RINGED.has(x.name))) {
    const { path, pad } = await ringFile(m)
    addOverlay(path, m.rect.x * 2 - pad, m.rect.y * 2 - pad, m.rel - 0.55, m.rel + 2.2, 0.3, 0.35)
  }

  // The touches. A dot marks where the finger landed and the two rings stagger out
  // of it, so the eye is led to the thing being pressed instead of having to find
  // the change on a screen it has not read yet.
  for (const t of tapsFor(beat.name)) {
    const px = t.point.x * 2
    const py = t.point.y * 2
    // One ring at a time, then a second further out: overlapping rings of similar
    // opacity freeze into a bullseye on any paused frame, and a demo gets paused.
    const layers = [
      { png: TOUCH.dot, size: 60, from: t.rel - 0.3, to: t.rel + 0.95, in: 0.16, out: 0.4 },
      { png: TOUCH.ring1, size: 148, from: t.rel - 0.14, to: t.rel + 0.42, in: 0.12, out: 0.26 },
      { png: TOUCH.ring2, size: 252, from: t.rel + 0.34, to: t.rel + 0.98, in: 0.12, out: 0.5 },
    ]
    for (const l of layers) {
      addOverlay(l.png, px - l.size / 2, py - l.size / 2, l.from, l.to, l.in, l.out)
    }
  }

  chains.push(`[${video}]${zoom}[cam]`)

  const chip = chipFor(beat.name)
  const stepIndex = stepIndexOf(beat.name)
  if (chip) {
    const a = 0.5
    const b = Math.max(a + 1.2, dur - 0.5)
    const alpha =
      `if(lt(t,${a}),0,if(lt(t,${(a + 0.45).toFixed(2)}),(t-${a})/0.45,` +
      `if(lt(t,${(b - 0.4).toFixed(2)}),1,max(0,(${b.toFixed(2)}-t)/0.4))))`
    /*
     * A rail across the top edge shows how far through the walkthrough this screen
     * is: at seven steps the chip alone says which step, but not how many are left.
     * It does not fade with the chip -- a progress rail that pulses would read as a
     * glitch, and as fixed furniture it is the one element the eye can always find.
     */
    const railW = W - 92
    const progress = STEPS.length > 1 ? (stepIndex + 1) / STEPS.length : 1
    chains.push(
      `[cam]drawbox=x=46:y=0:w=${railW}:h=7:color=0xffffff@0.16:t=fill,` +
        `drawbox=x=46:y=0:w=${Math.round(railW * progress)}:h=7:color=${GOLD}@1:t=fill,` +
        `drawtext=fontfile='${FONT_BOLD}':text='${chip}':fontsize=38:fontcolor=0xffffff:` +
        `box=1:boxcolor=0x081b44@0.92:boxborderw=20:x=46:y=54:alpha='${alpha}',format=yuv420p[vout]`,
    )
  } else {
    chains.push('[cam]format=yuv420p[vout]')
  }

  const clipPath = join(DIR, 'build', `clip-${beat.name}.mp4`)
  run(
    [
      ...inputs,
      '-filter_complex', chains.join(';'),
      '-map', '[vout]', '-t', dur.toFixed(2),
      '-r', String(FPS), '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      clipPath,
    ],
    `clip ${beat.name} (${marks.length} mark(s), ${dur.toFixed(2)}s)`,
  )
  clips.push(clipPath)
}

writeFileSync(
  join(DIR, 'build', 'clips.txt'),
  clips.map((c) => `file '${c.split(/[/\\]/).pop()}'`).join('\n') + '\n',
)
run(
  [
    '-y', '-f', 'concat', '-safe', '0', '-i', join(DIR, 'build', 'clips.txt'),
    '-r', String(FPS), '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    join(DIR, 'build', 'demo.mp4'),
  ],
  'demo assembled',
)

run(
  haveSplash
    ? [
        '-y', '-i', SPLASH_MP4,
        '-vf', `tpad=stop_mode=clone:stop_duration=9,fade=t=out:st=${(spec.end.duration - 0.9).toFixed(2)}:d=0.9:color=white,format=yuv420p`,
        '-t', spec.end.duration.toFixed(2),
        '-r', String(FPS), '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
        join(DIR, 'build', 'end.mp4'),
      ]
    : [
        '-y', '-f', 'lavfi', '-i', `color=c=${BG}:s=${W}x${H}:r=${FPS}:d=${spec.end.duration}`,
        '-vf', cardFilter(spec.end.duration, 'docs/video/build/end.txt', 'docs/video/build/end-url.txt', 780, 1030),
        '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
        join(DIR, 'build', 'end.mp4'),
      ],
  'end card',
)

// Bare filenames: ffmpeg resolves entries in a concat list relative to the list
// file itself, so a path that includes the build directory resolves twice.
const cards = ['title.mp4', haveHowto ? 'howto.mp4' : null, 'demo.mp4', 'end.mp4'].filter(Boolean)
writeFileSync(
  join(DIR, 'build', 'cards.txt'),
  cards.map((p) => `file '${p}'`).join('\n') + '\n',
)
run(
  [
    '-y', '-f', 'concat', '-safe', '0', '-i', join(DIR, 'build', 'cards.txt'),
    '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    join(DIR, 'build', 'silent.mp4'),
  ],
  'video join',
)

// --- audio ---------------------------------------------------------------
const audioArgs = []
const chains = []
timeline.forEach((line, i) => {
  audioArgs.push('-i', line.wav)
  const ms = Math.round(line.start * 1000)
  // Kokoro's output is already hot, unlike the old SAPI voice that needed 1.35.
  chains.push(`[${i}:a]aresample=48000,adelay=${ms}|${ms},volume=1.25[v${i}]`)
})
const musicIdx = timeline.length
if (!existsSync(MUSIC)) throw new Error(`missing music bed ${MUSIC}`)
audioArgs.push('-i', MUSIC)
chains.push(
  `[${musicIdx}:a]aresample=48000,atrim=0:${total.toFixed(2)},asetpts=PTS-STARTPTS,` +
    `volume=0.085,afade=t=in:st=0:d=1.5,afade=t=out:st=${(total - 3.5).toFixed(2)}:d=3.5[bg]`,
)
const mixIns = timeline.map((_, i) => `[v${i}]`).join('') + '[bg]'
chains.push(
  /*
   * Fixed gain, then a limiter with auto-level OFF.
   *
   * alimiter's `level` defaults to on, which normalises the output up to the
   * ceiling -- so a 0.94 ceiling measured -0.0 dB, i.e. touching full scale. The
   * bed is also a mastered track peaking at 0 dBFS on its own, so the headroom
   * has to be managed here rather than assumed. 1.4x lifts the sum (narration
   * peaks about -4 dB after its own gain) to roughly -1 dB, with the limiter left
   * in only as a safety net.
   */
  `${mixIns}amix=inputs=${timeline.length + 1}:duration=longest:normalize=0,volume=1.4,alimiter=limit=0.9:level=0[aout]`,
)
run(
  [
    '-y', ...audioArgs,
    '-filter_complex', chains.join(';'),
    '-map', '[aout]', '-t', total.toFixed(2), '-c:a', 'pcm_s16le', join(DIR, 'build', 'mix.wav'),
  ],
  'audio mix',
)

// --- final ---------------------------------------------------------------
run(
  [
    '-y',
    '-i', join(DIR, 'build', 'silent.mp4'),
    '-i', join(DIR, 'build', 'mix.wav'),
    '-vf', 'subtitles=filename=docs/video/captions.ass',
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    OUT,
  ],
  'final mux',
)

console.log(`\nwrote ${OUT}`)

/*
 * The landscape cut, derived from the vertical master so the two can never drift.
 *
 * It used to be a one-off command, which is how it ended up an hour behind the
 * film it was supposed to duplicate. The phone frame is centred over a blurred,
 * slightly darkened copy of itself: projection and email both want 16:9, and
 * letterboxing a 9:16 screen would waste most of the frame. Audio is stream-copied,
 * so the mix is bit-identical to the master's.
 */
const LANDSCAPE = join(DIR, `${NAME}_1920x1080.mp4`)
run(
  [
    '-y', '-i', OUT,
    '-filter_complex',
    '[0:v]split=2[bg][fg];' +
      '[bg]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,' +
      'gblur=sigma=30,eq=brightness=-0.08:saturation=0.85[bgz];' +
      '[fg]scale=-1:1080:flags=lanczos[fgs];' +
      // setsar after the overlay: scaling the phone frame left a 10239:10240 pixel
    // aspect, and a non-square SAR is the kind of detail a projector will notice.
    '[bgz][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]',
    '-map', '[v]', '-map', '0:a:0', '-c:a', 'copy',
    '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-movflags', '+faststart',
    LANDSCAPE,
  ],
  'landscape cut',
)

for (const p of [OUT, LANDSCAPE]) {
  const bytes = readFileSync(p).length
  console.log(`  ${basename(p)}  ${(bytes / 1048576).toFixed(1)} MB`)
}
const sizes = readdirSync(DIR).filter((f) => f.endsWith('.mp4'))
console.log('video files:', sizes.join(', '))
