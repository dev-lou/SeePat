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
