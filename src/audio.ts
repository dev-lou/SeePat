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

  const finished = new Promise<Utterance | null>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onerror = () => {
      releaseStream(stream)
      reject(new VoiceError(say('Recording failed. Try again.', 'Nabigo ang pag-record. Subukan muli.')))
    }
    recorder.onstop = () => {
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

  const timer = setTimeout(() => {
    if (!stopping) {
      stopping = true
      recorder.stop()
    }
  }, maxMs)

  try {
    recorder.start()
  } catch {
    clearTimeout(timer)
    releaseStream(stream)
    throw new VoiceError(say('The microphone could not start. Try again.', 'Hindi masimulan ang mikropono. Subukan muli.'))
  }

  return {
    finished,
    stop() {
      if (stopping) return
      stopping = true
      clearTimeout(timer)
      recorder.stop()
    },
    cancel() {
      cancelled = true
      if (stopping) return
      stopping = true
      clearTimeout(timer)
      recorder.stop()
    },
  }
}
