# SeePat — offline voice: what to ship, and why it was not hearing you

Researched and **measured** October 2026. Question: the offline voice model is not
working — talking to the phone produces nothing or the wrong words. What is the best
approach in October 2026 — a Hugging Face model, an open-source project, or something built
into the phone — for a website/PWA that must recognize **English and Tagalog**, offline,
from a downloadable model?

**Verdict, in three parts.**

1. **The "it cannot hear me" half was a bug in this repo, not the model.** The silence gate
   in [`src/audio.ts`](src/audio.ts) uses a fixed 0.02 RMS floor. Real recordings arrive well
   below it: four clean FLEURS `fil_ph` clips measured **0.018–0.029 RMS**, so the gate
   credited only 1.5–2.7s of ~5s takes — and the same audio **20 dB down credited 0ms**,
   which the engine reports as *"No words were heard"*. Fixed and verified end-to-end
   (§3).
2. **The accuracy half is real, and is now a number rather than a worry.** On clean read
   Tagalog the shipped `onnx-community/whisper-base` scored **49.7% mean word error** across
   four clips; `whisper-small` scored **35.3%**. English is fine — **0.0%** on the control.
   See §2.
3. **Packaging your own model is still the right architecture** — October 2026 platform
   recognizers are not a dependable *offline Tagalog* path on either OS, and a PWA cannot
   reach Android's on-device models at all (§5). The question is only *which* weights, and
   §7 ranks the options.

---

## 1. How the numbers below were produced

| Piece | What it is |
|---|---|
| `tools/bench/asr-bench.html` | A page that runs `@huggingface/transformers` **with the production call options** from [`src/asr-offline.ts`](src/asr-offline.ts) (`task: 'transcribe'`, the same fixed `language`; chunked with `chunk_length_s: 30`, `stride_length_s: 5` only for takes over 15s, single-pass below that — mirroring `transcribeOffline`), and imports the app's **own** `speechDurationMs` / `normalisePeak` from [`src/audio.ts`](src/audio.ts) rather than re-implementing them. |
| `tools/bench-asr.mjs` | Drives that page in headless Edge over CDP, scores word error rate, writes JSON. |
| `tools/bench-score.mjs` | Word-level Levenshtein WER; normalizes punctuation and case only. |
| `tools/bench-report.mjs` | Per-clip tables from a result JSON (`--text` prints hypotheses). |
| `tools/verify-offline-voice.mjs` | Drives the **real app** with Chrome's fake audio device fed a real Tagalog recording: taps the Voice tab, the offline engine chip and the microphone, then reads the screen. |
| Clips | 4 × FLEURS `fil_ph` development recordings (~5s, CC BY 4.0, 16 kHz mono, published transcripts) + the JFK sample from whisper.cpp as an English control. |

Runtime facts recorded by the run itself, so they are not assumptions:
`dtype not specified for "decoder_model_merged". Using the default dtype (q8) for this device
(wasm)` — i.e. **q8 on WASM, exactly what production uses** — and single-threaded WASM, because
the dev server (like production) sends no COOP/COEP headers, so `SharedArrayBuffer` and
multi-threaded ORT are unavailable.

**The benchmark is small on purpose: 4 clips.** It can rank a short list of candidates and
it caught a real bug. It cannot certify a product (see §8).

---

## 2. Measurements

### 2.1 Word error rate, per clip (`tools/bench/results-normal.json`)

| clip | whisper-base `tl` | whisper-base `en` | whisper-base `auto` | whisper-small `tl` | whisper-small `en` | whisper-small `auto` |
|---|---:|---:|---:|---:|---:|---:|
| fil-1 | 27.3% | 172.7% | 172.7% | 18.2% | 100.0% | 100.0% |
| fil-2 | 50.0% | 100.0% | 100.0% | 50.0% | 100.0% | 100.0% |
| fil-3 | 61.5% | 146.2% | 146.2% | 46.2% | 146.2% | 146.2% |
| fil-4 | 60.0% | 93.3% | 93.3% | 26.7% | 93.3% | 93.3% |
| en-jfk | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| **Tagalog mean** | **49.7%** | 128.1% | 128.1% | **35.3%** | 109.9% | 109.9% |
| corpus WER (5 clips) | 35.6% | 87.7% | 87.7% | 24.7% | 76.7% | 76.7% |

Three findings that matter more than the averages:

**Forcing `tl` is doing real work.** It is not cosmetic: with `en` — and with `auto` — Tagalog
audio is turned into fluent English that was never said. For `fil-1`, whose reference is
*"karamihan sa buhay ng pamilya ng hebreo ay nangyari sa labas"*:

```
tl    →  "karamiyan sa buhay ng pamilya ng hebbrio ay nangyari sa lebas"   (close)
en    →  "there is a lot of people who are just friends, that's why it's a lot of fun"
auto  →  "there is a lot of people who are just friends, that's why it's a lot of fun"
```

WER above 100% is insertions, not noise: the model *translates* rather than transcribes.
This is the single most important setting in the offline path, and the app already gets it
right (`SPOKEN_LANGUAGE = 'tl'`).

**`auto` is not auto in this library version.** `auto` and `en` produced byte-identical
hypotheses on every clip, so on `@huggingface/transformers` 3.7.6 passing `language: null`
means *English*, not *detect*. Any future "let it auto-detect" plan must not assume otherwise.

**Forcing `tl` does not cost English anything** — 0.0% on the English control, same as with
`en`. So there is no need for a language switch in the UI to protect English speakers.

### 2.2 The silence gate: the "it cannot hear me" evidence (`results-gain.json`, `results-after-fix.json`)

| clip | peak (raw) | `speechDurationMs` raw | at −20 dB (before fix) | at −20 dB (after the shipped fix) |
|---|---:|---:|---:|---:|
| fil-1 | 0.147 | 1560 ms | **0 ms** | 840 ms |
| fil-2 | 0.375 | 2700 ms | **0 ms** | 2340 ms |
| fil-3 | 0.181 | 1560 ms | **0 ms** | 1320 ms |
| fil-4 | 0.199 | 2460 ms | **0 ms** | 1560 ms |
| en-jfk | 0.783 | 7100 ms | 2280 ms | 6300 ms |

`0 ms` is below [`asr-offline.ts`](src/asr-offline.ts)'s `MIN_VOICED_FOR_TRANSCRIPTION_MS` of
200 ms, so the engine never calls the model: the owner sees *"No words were heard. Try again,
a little louder."* for audio that transcribes perfectly well once it is lifted.

### 2.3 What the lift should be — and the first version of the fix was wrong

| variant | corpus WER (whisper-base, `tl`) |
|---|---:|
| raw (as recorded) | 35.6% |
| −20 dB, no gain | 57.5% |
| −20 dB, lifted to full scale (`normalisePeak` v1: every take to 0.9 peak) | 45.2% |
| **loud audio** lifted to full scale (the control) | **45.2%** |
| −20 dB, lifted by the **shipped** rule (only below 0.05 peak, target 0.3, ≤8×) | **35.6%** |

The control row is the interesting one. Normalizing audio that is *already audible* to full
scale made the shipped model **worse** — 35.6% → 45.2% corpus, and for `fil-1` **27.3% → 72.7%**
— while `whisper-small` was indifferent (24.7% → 23.3%). The reason is in the peaks: the real
recordings arrive at 0.147–0.375, so "normalizing" them meant multiplying by 4.5–6×, noise
included. Hence the shipped rule is *conditional*: it lifts only takes below 0.05 peak, and
it aims at audibility (0.3) rather than full scale. With that rule, quiet audio lands back at
**35.6% corpus WER — equal to the best loud-audio result**, and `fil-1` reproduces its
un-attenuated 27.3% exactly.

### 2.4 Latency (this desktop, single-threaded WASM, q8)

| model | per ~5s clip | real-time factor | download |
|---|---:|---:|---:|
| whisper-base | 4.1–5.3 s | ≈0.9–1.05 | 76 MB (measured by the app) |
| whisper-small | 15.3–18.0 s | ≈3.2–3.6 | ~248 MB int8 |

These are **desktop x86** figures and are a lower bound for a phone. The stage-3 timings in
`results-normalized.json` are deliberately excluded: they were taken while `vitest` was running
and are inflated ~2.5×. WER is unaffected by CPU contention; timing is.

### 2.5 The accuracy king, measured — and why it still stays off the list

The report's model ranking began as citations. So the strongest candidate that is both MIT
licensed and available as ONNX was put through the same bench, on the **same two clips**:

| model | fil-1 | fil-2 | mean of the two | inference per ~5s clip | download |
|---|---:|---:|---:|---:|---:|
| `whisper-base` **(shipped)** | 27.3% | 50.0% | **38.7%** | 4.1–5.3 s | 76 MB |
| `whisper-small` | 18.2% | 50.0% | **34.1%** | 15.3–18.0 s | ~248 MB |
| `whisper-large-v3-turbo` | **9.1%** | **16.7%** | **12.9%** | **85–109 s** | ~1.1 GB (int8) |

(`tools/bench/results-large-v3-turbo.json`. The shared profile cache measured **1.6 GB** after
the run — that total holds all three models, so it corroborates turbo's own ~1.1 GB rather than
measuring it in isolation.)

So the published ranking is real: turbo is roughly **three times more accurate** on these
clips than the model that ships. It is also **~20× slower** per utterance and **~14× the
download** — and those are *desktop x86* figures, so on the mid-range Android phone this
product targets, a five-second sentence would take minutes and the weights would be over a
gigabyte of prepaid data. That is a measured trade, not an opinion about model sizes: the
accuracy king is unimplementable here, and the shipped `whisper-base` is not.

### 2.6 End-to-end, in the real app (`tools/verify-offline-voice.mjs`)

Both runs click through the actual UI — Voice tab → *Offline (Whisper Base)* chip →
microphone — with Chrome's fake audio device playing a real FLEURS recording:

| input | on-screen transcript | result |
|---|---|---|
| `fil-1.wav` (as recorded) | “karamiyan sa buhay ng pamilya lang hebrio ay nangyari sa lebas” | **PASS** |
| `fil-1-quiet.wav` (−20 dB) | “karamiyan sa buhay ng pamilya lang hebrio ay nangyari sa lebas” | **PASS** |

Reference: *"karamihan sa buhay ng pamilya ng hebreo ay nangyari sa labas."* The downstream
guard also behaved: the draft reported *"No known items recognised"* rather than inventing a
sale, which is [`src/engine/voice.ts`](src/engine/voice.ts) doing its job on a sentence
containing no shop vocabulary.

---

## 3. What was changed, and why it is safe

All three changes are in [`src/audio.ts`](src/audio.ts), with tests in
[`src/audio.test.ts`](src/audio.test.ts) (177/177 tests pass, typecheck clean).

1. **`speechDurationMs` now also tests the recording against its own noise floor.** A frame
   counts as speech if it clears the absolute floor **or** stands ~10 dB above the 20th
   percentile of the clip's frame levels. The absolute floor stays, and that is what keeps
   this safe: on a take that is nothing but room noise, the floor *is* the signal, the relative
   test cannot pass either, and the take is still refused. Digital silence is still refused.
2. **`normalisePeak` lifts only quiet takes** — below 0.05 peak, capped at 8×, aiming at 0.3.
   The cap is load-bearing rather than cosmetic: Whisper answers silence with invention, and an
   uncapped lift would raise a room's hum over the floor and hand the model something to invent
   from. At 8×, a silent take peaks at 0.016 — still under the 0.02 floor.
3. **The level monitor resumes its `AudioContext` explicitly.** It is created after the `await`
   on `getUserMedia`, i.e. outside the user gesture, and a context created that way can come up
   suspended on iOS — where an analyser receives nothing but zeros, so every take would run to
   the 10-second no-speech timeout instead of ending when the owner stops talking.

What was **not** changed: the model, the engine order (browser recognition stays the default),
the `tl` language setting, and the numbers in the user-facing copy — because the model choice
is a product decision with a data-cost consequence (§7), and it should be made deliberately.

---

## 4. Candidate models, October 2026

Sizes are the quantized artifacts actually published where verified; "—" means the figure was
not verified, not that none exists.

| Candidate (Hub ID) | Filipino support | Size | License | Browser-usable today |
|---|---|---|---|---|
| `onnx-community/whisper-base` **(shipped)** | yes, via Whisper's language inventory | ~76 MB (app's own measurement) | MIT | yes |
| `onnx-community/whisper-small` | yes | ~248 MB int8 / 486 MB fp16 | MIT | yes — **measured +14 points on Tagalog** |
| `onnx-community/whisper-large-v3-turbo` | yes | 1,085 MB int8 / 564 MB q4f16 | MIT | yes in theory; not a phone download |
| `arun100/whisper-base-tl-1` (fine-tune) | Tagalog-tuned | same as base (74M) | Apache-2.0 | **no ONNX** — conversion required |
| `arun100/whisper-small-tl-1` (fine-tune) | Tagalog-tuned | same as small (244M) | Apache-2.0, gated | no ONNX |
| `facebook/mms-1b-all` | `tgl` present | 1B | **CC-BY-NC-4.0 → cannot ship commercially** | no |
| `facebook/omniASR-CTC-300M` | `fil_Latn` present | 348 MB via sherpa-onnx INT8 | Apache-2.0 | native (sherpa-onnx), not transformers.js |
| `Qwen/Qwen3-ASR-0.6B` | Filipino listed | ~1.87 GB fp16 browser export | see card | too large to be serious for prepaid data |
| `nvidia/parakeet-tdt-0.6b-v3` | **no** (25 European languages) | 600M | CC-BY-4.0 | n/a for Tagalog |
| `nvidia/canary-1b-v2` / `-qwen-2.5b` | **no** | 1B / 2.5B | CC-BY-**NC**-4.0 | n/a |
| `distil-whisper/*` | **no** (English-only) | 756M / 394M | MIT | n/a for Tagalog |
| `moonshine-ai/moonshine-*` | **no** (English + ar/zh/ja/ko/uk/vi) | 27M | MIT | n/a for Tagalog |
| `kyutai/stt-*`, `mistralai/Voxtral-*` | **no** | 1–4.4B | CC-BY / Apache-2.0 | n/a for Tagalog |

Published Filipino numbers, for scale — **lower is better, and not all sources are comparable**
(normalization and splits differ; treat this as a ranking, not a scoreboard):

| Model | Filipino WER | Source |
|---|---:|---|
| NCSpeech fastconformer (Tagalog-trained) | 9.34% | model card, FLEURS `fil_ph` test, CC-BY-4.0 |
| Whisper **large-v3** | 10.00% | community benchmark, FLEURS `fil_ph` |
| Whisper **large-v3-turbo** | 10.76% (another card says 11.60%) | as above |
| `facebook/mms-1b-all` | 11.55% | community benchmark |
| `arun100/whisper-small-tl-1` (fine-tune) | 20.67% | self-reported, FLEURS `fil_ph` test |
| `Qwen3-ASR-1.7B` | 24.29% | Qwen technical report |
| `arun100/whisper-base-tl-1` (fine-tune) | 30.81% | self-reported |
| `Qwen3-ASR-0.6B` | 36.10% | Qwen technical report (English on the same eval: 4.39%) |
| `KarlShane11/handsfree-whisper-tiny-tl` | 63.15% fine-tuned vs **82.72% vanilla tiny** | 2026 thesis card, MIT |

Notes that decide the shortlist:

- **`Qwen3-ASR-0.6B` is not the "newest is best" answer here.** It supports Filipino, but it
  scores worse on Filipino than a fine-tuned Whisper *small* (36.1% vs 20.7%), costs an order
  of magnitude more bytes, and its Vanilla-English advantage is irrelevant to this product.
- **Fine-tunes are the highest-value lever available**, because they change accuracy at
  **unchanged size**: `whisper-base-tl-1` claims 30.8% against the ~49.7% measured here for
  vanilla base. The blocker is packaging, not quality — those repos ship safetensors only, so
  they need an ONNX conversion before `transformers.js` can load them.
- **MMS Filipino is real but unusable here**: `facebook/mms-1b-all` carries
  `tgl` and scores well, and its **CC-BY-NC-4.0 licence forbids the commercial use this product
  is built for** — the same reason [`asr-offline.ts`](src/asr-offline.ts) already refuses to
  offer Vosk's Tagalog model.
- Tools worth knowing: [`openai/whisper`](https://github.com/openai/whisper) (MIT, the
  reference implementation), [`ggml-org/whisper.cpp`](https://github.com/ggml-org/whisper.cpp)
  (WASM example; its README estimates tiny/base at ~2–3× realtime on a modern CPU),
  [`snakers4/silero-vad`](https://github.com/snakers4/silero-vad) and
  [`@ricky0123/vad`](https://github.com/ricky0123/vad) (browser VAD that outputs 16 kHz Float32),
  and [sherpa-onnx](https://k2-fsa.github.io/sherpa/onnx/omnilingual-asr/models.html) (native
  runtime for Omnilingual ASR).

---

## 5. Why the platform recognizers are not the answer offline

This matters because it is the tempting shortcut — "the phone already has speech recognition" —
and because it is what makes the current architecture correct rather than merely acceptable.

**Android.** `RecognizerIntent.EXTRA_PREFER_OFFLINE` is a *hint* the implementation may ignore,
and the ordinary `createSpeechRecognizer()` is documented as likely to stream audio to remote
servers ([AOSP `RecognizerIntent.java`](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/speech/RecognizerIntent.java),
[`SpeechRecognizer.java`](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/speech/SpeechRecognizer.java)).
The real offline path is `createOnDeviceSpeechRecognizer()` behind
`isOnDeviceRecognitionAvailable()` (API 31), with support/model-download queries in API 33
([`RecognitionSupport.java`](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/speech/RecognitionSupport.java))
— all answered by the installed service, per device. Google publishes no fixed offline language
catalogue, and **Filipino is not among the documented locales of ML Kit GenAI Speech Recognition**
(basic or the Pixel-only advanced mode) — an API still labelled alpha
([docs](https://developers.google.com/ml-kit/genai/speech-recognition/android)). Google Cloud
does list `fil-PH`, but that is a cloud service: it proves nothing about offline models.

**iOS.** Apple exposes runtime capability checks rather than a guarantee:
`SFSpeechRecognizer.supportedLocales()`, `supportsOnDeviceRecognition`, and
`requiresOnDeviceRecognition` for keeping audio on-device
([Apple](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition)).
iOS 26 added SpeechAnalyzer / `SpeechTranscriber` with on-device models managed through
AssetInventory ([WWDC25 session 277](https://developer.apple.com/videos/play/wwdc2025/277/),
[`SpeechTranscriber.supportedLocales`](https://developer.apple.com/documentation/speech/speechtranscriber/supportedlocales)).
**No official Apple source confirms Filipino as an on-device locale**, so shipping it as the
offline promise would be a guess with a store owner on the other end of it.

**A PWA cannot reach the platform models anyway.** Chrome 139 shipped availability and
language-pack plumbing for the Web Speech API, but Chromium's own May 2026 statement is that
**Android and ChromeOS did not support on-device Web Speech** ([Chrome 139](https://developer.chrome.com/blog/new-in-chrome-139),
[blink-dev thread](https://groups.google.com/a/chromium.org/g/blink-dev/c/P8P-x7AnC6I)), and MDN
still notes Chrome's recognizer may be server-based ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)).
Reaching a *native* recognizer deterministically needs a bridge (Capacitor-style), not a web page.

**So: shipping your own weights is the only route that can honestly promise offline recognition
of both languages.** That is what this app does, and the measurement above says the promise is
currently worth the word "poor" on Tagalog rather than "good".

---

## 6. The capture pipeline: the remaining known gaps

Ranked by how likely each is to bite next:

1. **Microphone constraints should be `ideal`, not exact** — and the app already gets this
   right by passing bare values. Worth knowing why: MDN marks `sampleRate` as limited-availability
   and notes exact constraints raise `OverconstrainedError`
   ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/sampleRate)).
   Logging `track.getSettings()` and `context.sampleRate` is the fastest way to diagnose a
   device that ignores the request.
2. **Multi-threading is the biggest latency lever left.** Single-threaded WASM is why
   `whisper-base` runs at ~1× realtime here; `SharedArrayBuffer` needs cross-origin isolation
   (COOP/COEP), which the app does not send. That is a real decision — it can break third-party
   embeds and needs the model CDN's CORP headers to cooperate — but it is the difference between
   a phone taking ~30s on a sentence and perhaps ~10s.
3. **A real VAD would beat the RMS/SNR gate** for endpointing. Silero via `@ricky0123/vad`
   returns 16 kHz `Float32Array` frames directly, which is the format the pipeline already wants.
   The current SNR gate is a cheap 90% solution and is now measured; VAD is the principled one.
4. **WebGPU deserves one honest re-test on target phones.** Safari 26 shipped WebGPU on iOS,
   iPadOS and macOS ([WebKit](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)),
   which invalidates the "iOS has no WebGPU" part of the earlier reasoning — though not the
   measured objection recorded in `asr-offline.ts` (the WebGPU path silently selected fp32:
   154 MB of weights and 7.6 s for a 3-second clip). If it is revisited, pin `dtype`
   explicitly so it cannot quietly pull fp32 again.
5. **iOS installed-PWA microphone behaviour must be tested on a real device.** It is
   supported, but Apple/WebKit's own documentation is silent about standalone mode in
   particular, and backgrounding interrupts capture. This cannot be settled empirically here —
   this machine is Windows.

---

## 7. Recommendation for this system

1. **Keep the architecture.** Browser recognition as the accurate default, a downloaded
   Whisper as the offline fallback, constrained SKU matching + mandatory confirmation on top
   of both. §5 is why the fallback cannot be replaced by a platform API.
2. **Ship the pipeline fix (done).** It removes the failure that was actually reported, and
   the measurement puts quiet audio back at parity with loud audio.
3. **Next, in order of value per byte:**
   - **(a) Convert a Tagalog fine-tune to ONNX** at *base* size — `arun100/whisper-base-tl-1`
     (Apache-2.0, same 74M parameters, claimed 30.8% vs the 49.7% measured for vanilla base)
     or `whisper-small-tl-1` (20.7%). Same download, better Tagalog. Requires an `optimum`/
     `onnxruntime` conversion pass on a machine with Python, and a re-run of this benchmark to
     confirm the claimed numbers on the actual packaging.
   - **(b) ✅ Shipped: `whisper-small` as a measured, opt-in upgrade** — "better Tagalog, 3×
     the data" — since it is +14 points on the benchmark and 3.5× slower: a trade an owner can
     only make for themselves. `asr-offline.ts` now installs/transcribes per-model
     (`WHISPER_SMALL_MODEL`, record keyed by model, per-model pipeline cache) and the
     Offline screen offers each installable model with its own download/switch button.
     Base stays the default.
   - **(c) Do not ship** large-v3-turbo, MMS (licence), Qwen3-ASR or Canary (no Filipino) for
     this audience. Large-v3-turbo is now *measured* rather than assumed: 12.9% against 38.7%
     for the shipped model on the same clips, at ~20× the time and ~14× the bytes (§2.5).
4. **Delete the 320MB Vosk Tagalog model from the plan permanently.** Already handled by
   licence, and the benchmark shows the licence was not the only problem.
5. **Later:** native Android recognizer as an optional *extra* engine where
   `isOnDeviceRecognitionAvailable()` and a support query say the language is installed; Silero
   VAD; COOP/COEP + ORT threads; a phone-labelled benchmark run on the devices you support.

---

## 8. The whole app, clicked through in a browser

Everything above is about the recognizer. This section is the rest of the product, exercised
the way an owner would — through the visible UI, on a running dev server, with the console and
network traffic watched throughout. **No JavaScript errors occurred at any point** (the only
console output was Vite's handshake, React's dev-tools notice, and the library's own q8 dtype
notice), and every request returned 200.

| Screen / feature | Result |
|---|---|
| Splash → app shell | renders, hands off without a blank frame |
| Twin dashboard | profit headline, week toggle, Sipat Score ring, capital breakdown, “Where did the money go?”, Business Twin, Watch out |
| Record sale (Ledger) | item **Coke Mismo** × 3 @ ₱12.50 → *“Recorded: ₱37.50 sale”*, appears at the top of the ledger, count 233 → 234 |
| Entry modes | Sale, Utang, Expense, Purchase, Payment, Capital, Take out — all render the right fields; Payment lists each customer's outstanding balance |
| Expense post | ₱250 → *“Recorded: ₱250.”*, ledger 235 |
| Voice: engine chips | Browser (Google) / Type it / Offline — offline correctly reads **unavailable** before install |
| Voice: typed draft | *“Nakabenta ako ng tatlong Coke Mismo at limang Lucky Me”* → draft with 3 × ₱12.50 and 5 × ₱17.00 (prices suggested from history), total **₱122.50** |
| Voice: confirm and record | posts as *Sale — 2 items, Voice, +₱122.50*, ledger 236 — the confirm-before-posting guard holds |
| **Offline model download** | clicked *Download for offline (~81MB)*: the two `*_quantized.onnx` files plus tokenizer/config fetched with 200s; card flips to **Installed**, button becomes **Remove**, cache bucket `transformers-cache` holds **76 MB**, Voice hero shows *“Working offline 76MB”*, Settings row shows *“Installed · 76MB”* |
| Ask | deterministic answers with evidence (profit ₱2,442.62 = sales − COGS − expenses); PRO adds “Explain with AI” |
| Explain with AI | quota decrements 300 → 299 and shows the exact payload that *would* be sent, with the note that the LLM is not wired up — i.e. it refuses to fake a paragraph |
| Score | 81/100 with every weight stated (an earlier read of “51” was **my** error: the ring animates with `useCountUp(…, 1400)`, and a settled read returns 81) |
| Plan / simulated checkout | FREE / PRO / NEGOSYO with GCash, Maya, Card; header flips to PRO; the modal states plainly that no real payment happens |
| Settings | language switch (nav becomes Tala/Boses/Tanong, all copy follows, and back again), demo-data reset, demo tier picker, transaction count |
| First-run deck | 4 steps (Voice → Sipat → Yours → checklist), Skip and “Open the ledger” both work |

Four small defects found by clicking, none of which the unit tests cover:

1. **“Sale — 1 items”, “Purchase — 1 items”.** `i18n/index.ts` hardcodes the plural in
   `record.row.sale` / `record.row.purchase`; the Tagalog is fine (“paninda” is not pluralized).
   Cosmetic, but it prints on the ledger line of every one-line entry.
2. **A typed draft is recorded with capture source `voice`.** Confirming the typed utterance
   produced a ledger row badged **Voice** — the badge comes from `source: 'voice'` being
   hardcoded in the Voice screen's confirm, regardless of whether the words came from the
   microphone or the keyboard. That is a provenance error in a product whose selling point is
   that the ledger is trustworthy.
3. **“Storage used 0 B” after installing 76 MB.** `useStorageEstimate` reads
   `navigator.storage.estimate()` once on mount, so the figure is stale exactly when it first
   matters — the owner has just spent 76 MB of data and the screen still says 0 B. Verified:
   the API reports 76 MB used of a 30.4 GB quota while the screen shows 0 B.
4. **The demo seed contains an invalid payment.** The Watch-out panel reports *“Payment of
   14700 exceeds the 13500 outstanding for ‘kuya_ben’”* — the anomaly detector working, on
   demo data that ships inconsistent. Worth knowing before it is shown to a judge.

One thing I could not click: **the real microphone.** A browser will not hand a real device to
an unattended agent, so the capture path was verified with a fake audio device playing a real
recording (§2.6) rather than by speaking at the phone. Any remaining doubt is in the browser's
permission/GUI layer, not in the audio pipeline.

## 9. What is not established

- **Four clips, one corpus, read speech.** FLEURS `fil_ph` is clean read Tagalog — not
  Taglish, not a noisy sari-sari store, not a speaker leaning over a counter. Absolute error
  rates in the field will be worse; the *comparisons* are the transferable part.
- **No phone was benchmarked.** Every latency figure is desktop x86 single-threaded. The
  real-time factors above are a floor, not a forecast.
- **English is one clip.** It proves English works (0.0%) and that `tl` does not break it. It
  does not characterize English accuracy in any wider sense.
- **Fine-tune WERs are self-reported model cards**, not reproduced here. The whole point of
  step 7(a) is to replace that claim with a measurement through this pipeline.
- **The quiet case is simulated by scaling samples**, which is equivalent for a linear decode
  path but is not a real quiet recording made on a real phone.
- **The `auto` finding is a statement about `@huggingface/transformers` 3.7.6**, the version
  pinned in `package.json`; it may differ elsewhere.
- **Stage-3 timings are excluded** (concurrent test run); its WER numbers are used.

## 10. Reproducing this

```bash
# 1. clips (into a temp dir; the archive is 366MB and never goes in the repo)
mkdir -p "$TMP" && cd "$TMP"
curl -sSfL -o fil_dev.tsv  https://huggingface.co/datasets/google/fleurs/resolve/main/data/fil_ph/dev.tsv
curl -sSfL -o fil_dev_audio.tar.gz https://huggingface.co/datasets/google/fleurs/resolve/main/data/fil_ph/audio/dev.tar.gz
curl -sSfL -o jfk.wav https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/samples/jfk.wav
mkdir -p wav && tar -xzf fil_dev_audio.tar.gz -C wav        # expect 419 members
node <repo>/tools/bench-prepare.mjs "$TMP"                   # writes clips/ + clips.json

# 2. app server (the bench page imports the app's own modules)
npm run dev

# 3. measurements
node tools/bench-asr.mjs --clips "$TMP/clips" \
  --models onnx-community/whisper-base,onnx-community/whisper-small \
  --langs tl,en,auto --variants raw --out tools/bench/results-normal.json
node tools/bench-report.mjs tools/bench/results-normal.json --text

# 4. the app itself, with a fake microphone
node tools/verify-offline-voice.mjs --clip "$TMP/clips/fil-1.wav"
```

```bash
# 5. the strongest candidate, for the trade-off in §2.5 (~1.1GB of weights)
node tools/bench-asr.mjs --clips "$TMP/clips" \
  --models onnx-community/whisper-large-v3-turbo --langs tl --variants raw --limit 2 \
  --out tools/bench/results-large-v3-turbo.json
```

Result files kept in the repo: `tools/bench/results-normal.json` (WER matrix),
`results-gain.json` (level study), `results-normalized.json` (the wrong fix, kept as the
control that refuted it), `results-after-fix.json` (the shipped rule), and
`results-large-v3-turbo.json` (§2.5).

The §8 walkthrough was driven interactively through a visible browser rather than by script,
so it is evidence rather than a regression test — the four defects it found are recorded above
instead of being encoded as assertions.
