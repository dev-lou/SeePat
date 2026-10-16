# SeePat — Free promo/demo video: feasibility research

Researched October 2026. Question: can an AI agent produce a 60–90 s promo / motion-design /
demo video for SeePat — real screen capture of the app, AI voiceover, background music —
using only free tools, on this machine (Windows 11, 16 GB RAM, **no GPU**, Node 22.18,
Python 3.14, **no ffmpeg installed**)?

**Verdict: yes — and the media pipeline is verified, not assumed.** Installed to a temp dir
outside this repo: `ffmpeg-static@5.3.0` (ffmpeg **6.1.1** gyan essentials build, with
`--enable-libass` and `--enable-libfreetype`) needs **no admin rights**, has every filter and
encoder the mux needs, and rendered a real 1080×1920 h264+aac MP4 with mixed audio and
burned-in Tagalog captions. Details and the exact evidence are in §4.

The remaining gaps are a Tagalog voice and an actual recorded take of the app.

---

## 1. Recording the actual app — already solved

Two free paths, both already available:

| Method | How | Notes |
|---|---|---|
| **Preview tab recording** (`preview_recording_start` / `preview_recording_stop`) | Records the app running in the Preview panel to a local **WebM** | This is the built-in one. Pairs with `preview_click` / `preview_type` / `preview_scroll` so the agent drives the UI like a user while it records. Real footage, not a mockup. |
| **Headless Edge over CDP** (`tools/capture-note-shots.mjs`) | Launches `msedge.exe` with `--remote-debugging-port`, drives `Page.startScreencast`, writes PNG frames | Already written for the concept-note screenshots. Extendable to frame capture, but the built-in recorder is simpler. |

**Pitfalls to expect:** CDP screencast drops frames when the page repaints slowly and gives
no audio; encode output is variable-frame-rate, so pass an explicit `fps` when muxing.
Preferred workflow: capture at a fixed phone viewport (e.g. 390×844 or scaled 2×), keep the
machine idle during the take, do several takes and pick one.

**Status:** the *screenshot* path is proven on this machine; an actual recorded take has not
yet been produced, so the WebM → mux handoff (variable frame rate, missing audio track) is
the one step still untested with real footage.

## 2. Voiceover (Tagalog / Taglish)

Free, offline, local options mostly **fail on Tagalog**:

- **Kokoro-82M** — no Tagalog voice (English, Spanish, French, Hindi, Italian, Japanese, Portuguese, Chinese). Apache weights.
- **Piper** — no official Filipino voice in the catalog.
- **Chatterbox Multilingual** — no `tl` in its language list.
- **XTTS-v2** — 17 languages, no Tagalog; and **CPML = non-commercial**.
- **F5-TTS** — weights are **CC-BY-NC** (non-commercial).
- **facebook/mms-tts-tgl** — **does** speak Tagalog (`tgl`), 36 M params, runs on CPU; but **CC-BY-NC 4.0 → not usable for a startup promo**.
- **VibeVoice / Fish Speech S2 Pro** — Tagalog listed for Fish (`tl`) but 4 B params on CPU is impractical, and its license is the Fish Audio Research License.

**Free hosted options that actually have Filipino voices (recommended):**

| Service | Filipino voice | Free allowance | Source |
|---|---|---|---|
| **Azure Speech** | `fil-PH-BlessicaNeural` (F), `fil-PH-AngeloNeural` (M) | **500,000 neural chars/month** (F0) | [language support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support), [pricing](https://azure.microsoft.com/en-us/pricing/details/speech/) |
| **Google Cloud TTS** | `fil-PH-Standard-A` (F) | Standard tier listed at **4 M chars/month free**, then $4/1M | [voices](https://cloud.google.com/text-to-speech/docs/list-voices-and-types), [pricing](https://cloud.google.com/text-to-speech/pricing) |
| **ElevenLabs** | Filipino supported on Eleven v4 | Free = 10,000 credits/mo, but **commercial licence starts at Starter** | [pricing](https://elevenlabs.io/pricing) |

A 75-second narration is ~1,000–1,500 characters — trivially inside either free tier.
Both need an account + API key; **that is the one action I cannot do for you.**

Fallback with zero signup: record the narration in your own voice on a phone. Genuinely
acceptable for a pitch, and it dodges the "AI voice sounds robotic in Taglish" risk entirely.

Note: a licence for a model/API is not a licence for every output; treat the promo as
commercial use and have a Filipino speaker check pronunciation of brand names.

## 3. Music and sound effects

| Source | Attribution | Commercial / public video |
|---|---|---|
| **Mixkit** free music licence | Not required | **Yes** — explicitly covers YouTube, social posts and "online marketing ads". Excludes TV/radio/broadcast and video games. [licence](https://mixkit.co/license/modal/musicFree/) |
| **Pixabay** (Content Licence) | Not required | **Yes**, when incorporated into a finished work (not redistributed standalone) [terms](https://pixabay.com/service/terms/) |
| **Free Music Archive — CC0 tracks only** | Not required | Yes; but FMA is *not* all CC0 — check each track [guide](https://freemusicarchive.org/License_Guide) |
| **YouTube Audio Library** | Track-dependent | Safe on YouTube; off-platform unclear [rules](https://support.google.com/youtube/answer/3376882) |

Avoid for this: **Suno free tier** (non-commercial by its Sept 2026 terms), **Udio**
(downloads disabled during label transition), any **CC-BY-NC** or **CC-BY-ND** track, and
never a commercial pop song (needs clearing both the composition and the master;
Philippine law is RA 8293).

## 4. Motion design / assembly

| Tool | Licence | Bundles ffmpeg? | Verdict |
|---|---|---|---|
| **Revideo 0.11** | **MIT** | Yes (`@revideo/ffmpeg`) | Best free agent-drivable scene renderer; needs Node ≥22.12 |
| **Motion Canvas 3.17** | **MIT** | Yes with its exporter | Solid, less shell-friendly |
| **Remotion 4.0.535** | Proprietary — free for individuals and teams ≤3 | Yes, baked into `@remotion/renderer` since v4 | Excellent DX; licence is a trap if the team grows |
| **FFmpeg** (Gyan static ZIP / Scoop user scope / `ffmpeg-static`) | GPLv3 build | is the binary | The reliable final mux, mix and caption burn |

### Verified on this machine (October 2026)

```
npm i ffmpeg-static@5.3.0        # exit 0, no admin rights, installed to a temp prefix
ffmpeg -version                 # ffmpeg 6.1.1-essentials_build-www.gyan.dev
configuration:                  # --enable-libass --enable-libfreetype --enable-libx264 …
```

Every filter and encoder the pipeline needs is present: `subtitles`, `amix`, `afade`,
`atrim`, `format`, `scale`; encoders `libx264` and `aac`. A full dry run of the chain below
produced `smoke.mp4` — **3.00 s, 1080×1920, h264 (High) yuv420p 30 fps + aac 48 kHz, 1.19 MB**,
with both audio tracks mixed, fade applied, and Tagalog captions burned in. `-movflags +faststart`
is accepted, so the file streams/plays before it fully downloads.

**The one real trap — subtitle sizing.** `force_style` font sizes are **not** pixels. An SRT
carries no script resolution, so libass assumes a 384×288 script and scales by frame height:
on a 1920-tall frame, `FontSize=24` renders ~160 px tall and lands **mid-frame (measured at
63–81% down)**, not at the bottom. Passing `original_size=1080x1920` to the filter did not fix
it cleanly in testing. **The reliable fix is a real `.ass` file** that declares its own
resolution, so `Fontsize` and `MarginV` mean actual pixels. Measured result for the style below:
a single 46 px line, centred (x 269–812 of 1080), sitting at **y 1737–1782 = 90.5–92.8% down**
— precisely the requested 140 px bottom margin.

```text
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,60,60,140,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.20,0:00:01.60,Cap,,0,0,0,,Nakabenta ng 3 kilong bigas
Dialogue: 0,0:00:01.70,0:00:03.00,Cap,,0,0,0,,Nasaan ang puhunan ko?
```

Set `PlayResX`/`PlayResY` to the **output frame size** every time; for a 1080×1920 vertical
cut use `Fontsize 48, MarginV 140`, for 1920×1080 use roughly `Fontsize 40, MarginV 80`.

### The mux command (framing captured earlier)

```bash
FF=$(node -e "console.log(require('ffmpeg-static'))")
"$FF" -y -i capture.webm -i narration.wav -stream_loop -1 -i music.mp3 \
  -filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,subtitles=filename=captions.ass[v];[1:a]aresample=48000,afade=t=in:st=0:d=0.25[vo];[2:a]aresample=48000,atrim=0:75,volume=0.12,afade=t=in:st=0:d=2,afade=t=out:st=72:d=3[bg];[vo][bg]amix=inputs=2:duration=longest,alimiter=limit=0.95[a]" \
  -map "[v]" -map "[a]" -t 75 -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart final.mp4
```

Notes: pass `capture.webm` **with no audio track** in mind (browser capture may have none, so
`[0:a]` is deliberately unused), always set `fps=30` because screencast output is variable
frame rate, and `-t 75` hard-cuts to the target length. Captions come from the `.ass` file
(§4) — never `force_style` on an SRT. Auto-time a first draft with local Whisper
(`whisper draft.mp4 --model small --task transcribe --output_format srt`), convert to `.ass`,
then correct by hand: auto captions mangle Taglish and brand names.

## 5. Font, format and competition caveats

- Captions: white sans-serif, 1–2 lines, ≤~37 chars per line, high contrast. Montserrat is
  SIL OFL; system Arial is fine. Keep the caption inside the `.ass` style so the size is in
  real pixels (§4).
- **The official PSC XI mechanics could not be confirmed from a readable source.** Do not
  assume a 60–90 s video satisfies the formal submission requirement — the concept note is
  the graded artifact; a promo video is supporting evidence. Confirm with the organiser.
- Keep an .SRT alongside the burned-in file, and keep a small licence log (track name,
  source URL, download date, licence) so the submission is defensible.

## 6. Recommended zero-cost path

1. `npm i -D ffmpeg-static` — already proven to work here at 5.3.0 with no admin rights
   (+ optional Revideo only if motion graphics are wanted beyond what CSS/HTML can do).
2. Script the demo: `preview_recording_start` → drive the app through a stock-in, a spoken
   sale in Taglish, confirmation, "nasaan ang puhunan ko?", restock advice → stop. Two or
   three takes.
3. Narration: Azure `fil-PH-BlessicaNeural` or Google `fil-PH-Standard-A` free tier; else
   record it yourself.
4. Music: one Mixkit free track (no attribution owed).
5. Mux + burn subtitles with ffmpeg-static; export 1080p MP4 and a vertical 1080×1920 cut
   for social.
6. Log every asset's licence beside the output.
