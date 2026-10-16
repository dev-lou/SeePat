/**
 * Microphone capture for the on-device recognizer.
 *
 * The browser engine never needs this — it takes the mic itself and streams
 * results back. A locally-run model does need it, because Whisper-class models
 * consume raw 16 kHz mono float samples and know nothing about containers,
 * codecs, or the microphone at all.
 *
 * So this file does one job: turn a press-and-hold on the mic button into a
 * `Float32Array` of 16 kHz mono samples, resampled properly rather than by
 * naive decimation (which would alias and make the already-weak Tagalog
 * accuracy worse).
 *
 * Nothing here touches the network. Audio captured this way never leaves the
 * device — which is the entire point of the offline model.
 */

import { say } from './i18n/index.ts'

/**
 * A failure the owner can act on, as opposed to a bug.
 *
 * This exists because `asr-offline.ts` used to decide whether an error was
 * already owner-facing by pattern-matching its *wording* against a list of
 * Tagalog prefixes. That was always brittle, and translating the messages would
 * have silently broken it — every recognised failure would have been wrapped in
 * a second layer of apology. A type answers the question the string was standing
 * in for.
 */
export class VoiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VoiceError'
  }
}

/** Whisper's fixed input rate. Resampling happens here, not in the model. */
export const TARGET_SAMPLE_RATE = 16000

/** Below this, there is nothing to recognize and Whisper tends to hallucinate. */
const MIN_SECONDS = 0.4

/** Hard ceiling so a stuck microphone cannot grow an unbounded buffer. */
const DEFAULT_MAX_MS = 30000

/**
 * When a take ends, and why it is not up to the owner to say so.
 *
 * The recorder used to stop only on a second tap or the 30-second ceiling, which
 * made "just say the sale" false: you spoke, and then waited. Worse, the wait was
 * silent — the mic stayed red for up to half a minute with nothing to look at.
 *
 * So the take now ends when the talking does. The browser engine has always
 * behaved this way (Google's own endpointing), so this also makes the two engines
 * feel like the same product.
 *
 * The numbers, and the trade they make:
 *  - 1.8s of silence after speech ends the take. Short enough not to feel stuck;
 *    long enough to survive the pause in "limang Coke … bayad cash". Set it
 *    higher and a store owner who is thinking keeps recording; set it lower and
 *    a list gets cut in half mid-thought.
 *  - 300ms of voiced audio is required first, so a cough or a tap on the counter
 *    cannot end a take before it starts.
 *  - 10s of complete silence gives up. Somebody opened the mic by accident; they
 *    should get an answer, not a red light.
 *
 * `speechRms` is an amplitude heuristic, not a calibrated gate: capture runs with
 * `autoGainControl`, so speech sits far above it and room hum far below. It is
 * deliberately the *only* judgement made from level — everything else is timing,
 * because a threshold that adapts to a noisy room would end takes unpredictably.
 */
export interface SilenceOptions {
  /** Root-mean-square amplitude above which a frame counts as speech. */
  speechRms: number
  /** Silence after speech that ends the take. */
  silenceMs: number
  /** Silence before speech that abandons the take. */
  noSpeechMs: number
  /** Voiced audio required before silence is allowed to end anything. */
  minVoicedMs: number
}

export const SILENCE_DEFAULTS: SilenceOptions = {
  speechRms: 0.02,
  silenceMs: 1800,
  noSpeechMs: 10_000,
  minVoicedMs: 300,
}

/** How often the level is sampled while recording. */
export const VAD_INTERVAL_MS = 60

/*
 * The room's own noise floor, read from the recording rather than assumed.
 *
 * A single absolute amplitude threshold cannot tell quiet speech from a quiet
 * room, and the measurements say that is not a theoretical problem: four clean
 * FLEURS `fil_ph` recordings arrived at 0.018–0.029 RMS, so the 0.02 threshold
 * credited only about half of each take as speech — and the same audio 20 dB down
 * credited **0ms**, which the engine reports as "No words were heard". The quiet
 * parts of any take are the best evidence available about the room it was made
 * in, so a frame now counts as speech if it clears the absolute floor *or* stands
 * this far above that floor. See `speechDurationMs`.
 */
const NOISE_PERCENTILE = 0.2

/** A frame this far above the room's own floor is speech, not room. ~10 dB. */
const NOISE_TO_SPEECH_RATIO = 3

/** Below this the "floor" is digital silence and proves nothing about the room. */
const MIN_MEANINGFUL_NOISE_RMS = 0.0005

/**
 * Software AGC — for takes that are too quiet to use, and only those.
 *
 * WHY IT EXISTS AT ALL. Audio 20 dB down is not merely quieter, it is unusable:
 * the same four Tagalog clips scored **57.5%** word error attenuated against
 * **35.6%** at level, and every one of them was refused outright by the gate
 * first (credit of 0ms against 1.5–2.7s). Lifting that audio recovered it to
 * **45.2%**, and for one clip from 100% error to 58%.
 *
 * WHY IT IS CONDITIONAL, WHICH IS THE PART THAT WAS MEASURED LAST. The first
 * version of this lifted every take to a common peak, on the reasoning that
 * Whisper likes full-scale input. That was wrong, and expensively so: the real
 * recordings in the benchmark arrive at peaks of **0.147, 0.375, 0.181 and 0.199**,
 * and normalizing *those* made `whisper-base` worse — 35.6% → 45.2% across the
 * corpus, and for one clip 27.3% → 72.7%. `whisper-small` was indifferent
 * (24.7% → 23.3%). So the gain is now applied only to audio below a threshold the
 * measured recordings sit well above, and it aims at audibility rather than full
 * scale.
 *
 * `MAX_GAIN` is what keeps it safe rather than merely helpful. Whisper answers
 * silence with invention, so an uncapped lifter would amplify a room's hum into
 * something the gate then accepts as speech. At 8× a genuinely silent take peaks
 * at 0.016 — still under the 0.02 floor — while the quiet-but-real case (peaks
 * 0.015–0.038) is lifted to 0.12–0.3, where the measurements were taken.
 */
export const NORMALIZE_TARGET_PEAK = 0.3

/** Only recordings quieter than this are touched at all. */
export const QUIET_PEAK_THRESHOLD = 0.05

export const MAX_GAIN = 8

export function normalisePeak(
  samples: Float32Array,
  targetPeak = NORMALIZE_TARGET_PEAK,
): Float32Array {
  let peak = 0
  for (let i = 0; i < samples.length; i += 1) {
    const magnitude = Math.abs(samples[i])
    if (magnitude > peak) peak = magnitude
  }
  // Already usable: hand the same buffer back rather than copying it, since a
  // recording is the largest thing this module ever allocates.
  if (peak <= 0 || peak >= QUIET_PEAK_THRESHOLD) return samples

  const gain = Math.min(MAX_GAIN, targetPeak / peak)
  if (gain <= 1) return samples
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) out[i] = samples[i] * gain
  return out
}

/**
 * How much of a recording sits above the speech floor.
 *
 * This exists to stop Whisper being asked a question it will answer wrongly. Fed
 * silence or room noise, a Whisper model does not return nothing — it invents a
 * fluent sentence. Measured on this app's own weights with three seconds of
 * silence, it produced `"[Song ang kawakong]"`: confident, well-formed, and
 * completely fabricated.
 *
 * That is the "it transcribed something different from what I said" failure, and
 * the model is not at fault — it was handed audio containing no speech, so every
 * word it emitted was made up. Nothing downstream can tell a hallucination from a
 * real reading, which is why the only safe place to catch it is before the call.
 */
export function speechDurationMs(
  samples: Float32Array,
  speechRms: number = SILENCE_DEFAULTS.speechRms,
): number {
  const window = Math.max(1, Math.round((TARGET_SAMPLE_RATE * VAD_INTERVAL_MS) / 1000))

  const frames: number[] = []
  for (let start = 0; start < samples.length; start += window) {
    const end = Math.min(samples.length, start + window)
    let sum = 0
    for (let i = start; i < end; i += 1) sum += samples[i] * samples[i]
    frames.push(Math.sqrt(sum / (end - start)))
  }

  const sorted = [...frames].sort((a, b) => a - b)
  const floor = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * NOISE_PERCENTILE))] ?? 0
  const relativeGate =
    floor >= MIN_MEANINGFUL_NOISE_RMS ? floor * NOISE_TO_SPEECH_RATIO : Number.POSITIVE_INFINITY

  let voicedMs = 0
  for (const level of frames) {
    // Either test alone is defeasible; together they are not. The absolute floor
    // refuses a take whose every frame is room noise, because there the floor and
    // the speech are the same level. The relative test is what rescues quiet but
    // genuinely spoken audio, which the absolute floor alone was refusing.
    if (level >= speechRms || level >= relativeGate) {
      voicedMs += (window / TARGET_SAMPLE_RATE) * 1000
    }
  }
  return Math.round(voicedMs)
}

export interface SilenceTracker {
  /**
   * Feed one level sample. Returns true when capture should end.
   *
   * Takes the clock as an argument rather than reading it, so the whole decision
   * is a pure function of the samples — which is what makes "it stops 1.8s after
   * you stop talking" testable without a microphone.
   */
  push(level: number, nowMs: number): boolean
  /** Whether anything above the speech floor was heard at all. */
  heardSpeech(): boolean
}

export function createSilenceTracker(overrides: Partial<SilenceOptions> = {}): SilenceTracker {
  const { speechRms, silenceMs, noSpeechMs, minVoicedMs } = { ...SILENCE_DEFAULTS, ...overrides }

  let firstAt: number | null = null
  let lastAt: number | null = null
  let lastVoiceAt: number | null = null
  let voicedMs = 0
  let heard = false

  return {
    push(level, nowMs) {
      if (firstAt === null) firstAt = nowMs
      // Measured from the previous sample rather than from the nominal interval,
      // so a throttled timer in a background tab cannot shorten the silence
      // window and cut a take short.
      const dt = lastAt === null ? 0 : Math.max(0, nowMs - lastAt)
      lastAt = nowMs

      if (level >= speechRms) {
        voicedMs += dt
        lastVoiceAt = nowMs
        if (voicedMs >= minVoicedMs) heard = true
        return false
      }

      if (!heard) return nowMs - firstAt >= noSpeechMs
      return lastVoiceAt !== null && nowMs - lastVoiceAt >= silenceMs
    },
    heardSpeech() {
      return heard
    },
  }
}

export interface Utterance {
  samples: Float32Array
  /** Always 16 kHz — the caller should not need to know that. */
  sampleRate: typeof TARGET_SAMPLE_RATE
  durationMs: number
}

export interface Recorder {
  /**
   * Resolves once capture finishes and the audio is decoded. Resolves with
   * `null` when the user cancelled, so a cancelled take is never mistaken for
   * a silent one.
   */
  finished: Promise<Utterance | null>
  /** Requests the end of capture. Idempotent. */
  stop(): void
  /** Abandons the take and releases the microphone immediately. */
  cancel(): void
}

interface AudioWindow {
  AudioContext?: typeof AudioContext
  webkitAudioContext?: typeof AudioContext
}

function getAudioContextCtor(): typeof AudioContext {
  const w = window as unknown as AudioWindow
  const ctor = w.AudioContext ?? w.webkitAudioContext
  if (!ctor) throw new VoiceError(say('No audio support in this browser.', 'Walang audio support sa browser na ito.'))
  return ctor
}

function releaseStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

/**
 * Downmix to mono and resample to 16 kHz by *rendering* through an
 * OfflineAudioContext, which applies the Web Audio resampling filter. Same
 * arithmetic the browser uses for playback, so no hand-rolled interpolation.
 */
async function toMono16k(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer()
  const Ctor = getAudioContextCtor()
  const decodeContext = new Ctor()

  try {
    const decoded = await decodeContext.decodeAudioData(bytes)

    if (decoded.sampleRate === TARGET_SAMPLE_RATE && decoded.numberOfChannels === 1) {
      return decoded.getChannelData(0).slice()
    }

    const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE))
    // A 1-channel destination makes the Web Audio graph downmix stereo for us.
    const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    const rendered = await offline.startRendering()
    return rendered.getChannelData(0)
  } finally {
    void decodeContext.close()
  }
}

export function isCaptureSupported(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    getAudioContextCtorSafe() !== null
  )
}

function getAudioContextCtorSafe(): typeof AudioContext | null {
  try {
    return getAudioContextCtor()
  } catch {
    return null
  }
}

/**
 * Opens the microphone and starts recording. Rejects if permission is denied or
 * the platform has no usable recorder, always with a message the UI can show
 * as-is.
 */
export async function startCapture(maxMs = DEFAULT_MAX_MS): Promise<Recorder> {
  if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    throw new VoiceError(say('This device has no microphone.', 'Walang mikropono sa device na ito.'))
  }
  if (typeof MediaRecorder === 'undefined') {
    throw new VoiceError(
        say(
          'This browser does not support audio recording.',
          'Hindi sinusuportahan ng browser na ito ang pag-record ng audio.',
        ),
      )
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
  } catch {
    throw new VoiceError(say('Microphone permission is needed.', 'Kailangan ng pahintulot sa mikropono.'))
  }

  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream)
  let stopping = false
  let cancelled = false
  let closeMonitor: (() => void) | null = null

  /** The one way a take ends: the timer, the owner, or the talking stopping. */
  const finish = (): void => {
    if (stopping) return
    stopping = true
    clearTimeout(timer)
    recorder.stop()
  }

  const finished = new Promise<Utterance | null>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onerror = () => {
      closeMonitor?.()
      releaseStream(stream)
      reject(new VoiceError(say('Recording failed. Try again.', 'Nabigo ang pag-record. Subukan muli.')))
    }
    recorder.onstop = () => {
      closeMonitor?.()
      releaseStream(stream)
      if (cancelled) {
        resolve(null)
        return
      }
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
      toMono16k(blob)
        // Lifted before anything reads it, so the silence gate and the model both
        // see audio at the level Whisper was trained on. See `normalisePeak`.
        .then((samples) => normalisePeak(samples))
        .then((samples) => {
          if (samples.length < TARGET_SAMPLE_RATE * MIN_SECONDS) {
            reject(
              new VoiceError(
                say('That was too short to use. Try again.', 'Masyadong maikli ang narinig. Subukan muli.'),
              ),
            )
            return
          }
          resolve({
            samples,
            sampleRate: TARGET_SAMPLE_RATE,
            durationMs: Math.round((samples.length / TARGET_SAMPLE_RATE) * 1000),
          })
        })
        .catch(() =>
          reject(
            new VoiceError(
              say('The recorded audio could not be read.', 'Hindi mabasa ang na-record na audio.'),
            ),
          ),
        )
    }
  })

  const timer = setTimeout(finish, maxMs)

  try {
    recorder.start()
  } catch {
    clearTimeout(timer)
    releaseStream(stream)
    throw new VoiceError(say('The microphone could not start. Try again.', 'Hindi masimulan ang mikropono. Subukan muli.'))
  }

  /*
   * Best-effort on purpose. If the browser refuses an AudioContext the take is
   * still perfectly usable — tapping the mic stops it, and the ceiling still
   * applies — so a monitoring failure must never fail the recording.
   */
  try {
    closeMonitor = startSilenceMonitor(stream, finish)
  } catch {
    closeMonitor = null
  }

  return {
    finished,
    stop: finish,
    cancel() {
      cancelled = true
      finish()
    },
  }
}

/**
 * Watch the live level and end the take when the talking stops.
 *
 * Returns its own teardown, because an interval and an AudioContext that outlive
 * a finished take are exactly the kind of leak that keeps a microphone indicator
 * lit on the device after the app is done with it.
 */
function startSilenceMonitor(stream: MediaStream, onSilence: () => void): () => void {
  const Ctor = getAudioContextCtor()
  const context = new Ctor()
  /*
   * Resumed explicitly, because this context is created *after* the `await` on
   * `getUserMedia` — outside the user gesture that opened the microphone. On iOS
   * a context created that way can come up suspended, and a suspended context
   * feeds an analyser nothing but zeros: the tracker would never see speech, and
   * every take would run to the 10s no-speech timeout instead of ending when the
   * owner stopped talking.
   */
  void context.resume().catch(() => undefined)
  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  // Deliberately not connected to the destination: listening to the microphone
  // must never play it back through the speaker.
  source.connect(analyser)

  const frame = new Float32Array(analyser.fftSize)
  const tracker = createSilenceTracker()

  const id = setInterval(() => {
    analyser.getFloatTimeDomainData(frame)
    let sum = 0
    for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i]
    if (tracker.push(Math.sqrt(sum / frame.length), performance.now())) onSilence()
  }, VAD_INTERVAL_MS)

  return () => {
    clearInterval(id)
    try {
      source.disconnect()
    } catch {
      // Already torn down.
    }
    void context.close()
  }
}
