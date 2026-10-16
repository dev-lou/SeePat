# SeePat how-it-works video — how it is made, and what it is licensed under

Everything here is produced from the real app with free tools and no accounts.
Total runtime of the pipeline: about six minutes from a running app to both MP4s.

## Outputs

| File | Use |
|---|---|
| [SeePat_promo_1080x1920.mp4](SeePat_promo_1080x1920.mp4) | **The master.** 90.0 s, 1080×1920 (9:16), h264 + aac, 11.5 MB. Reels, TikTok, phone viewing, the pitch deck. |
| [SeePat_promo_1920x1080.mp4](SeePat_promo_1920x1080.mp4) | Same cut, 16:9, the screen centred on a blurred backdrop, 9.3 MB. For projection and email. |
| [watch.html](watch.html) | Player page used for review. |

## Pipeline

```
npm run dev                                              # the app must be running on :5173
node tools/record-demo.mjs docs/video/splash --splash    # 1. boot screen  -> docs/video/splash/
node tools/record-demo.mjs docs/video/howto  --howto     # 2. chapter card -> docs/video/howto/
node tools/record-demo.mjs                                # 3. the demo     -> docs/video/raw/
node tools/make-narration-kokoro.mjs                      # 4. voice (Kokoro) -> docs/video/voice/
node tools/build-video.mjs                                # 5. assemble     -> the two MP4s
node tools/record-demo.mjs docs/video/raw --smoke         # fast capture test, ~25 s
```

The older `tools/make-narration.ps1` (Windows SAPI) is kept as a dependency-free
fallback; it writes the same filenames. The previous SAPI takes are in
`docs/video/voice-sapi/` if you want to compare.

## What makes it a demo rather than a promo

The difference is not the length or the captions, it is that the video shows the
work being done. Four things do that, and all four are driven by data the recorder
measured rather than by eyeballed numbers:

- **A camera.** Each step is rendered as its own clip with a virtual camera that
  pushes in on the element that narration is about and eases back out before the
  cut. The targets are rectangles the recorder took from the live layout, so the
  framing follows the real interface. Where the label is not a reliable handle —
  the dashboard's score card, the score screen's explanation — the camera frames
  whatever card is nearest the centre of the screen instead.
- **Touch markers.** The recorder stamps the point of every press in app
  coordinates. The edit draws a dot with two rings that travel out of it, applied
  *before* the camera move so the marker stays locked to the control it pressed and
  travels with the push-in for free. Eleven touches are marked, including each tap
  on the bottom dock.
- **Step chips and a progress rail.** `narration.json` carries the step table, and
  both the chapter card and the step chips are read from it, so the agenda on the
  card and the numbering on the film cannot disagree. A rail across the top edge
  shows how far through the walkthrough each scene is.
- **A chapter card.** The video opens on the app's own boot screen, then a card
  listing the seven steps — filmed, not drawn with drawtext, because a card that
  opens a walkthrough has to look like the product. It is injected into the running
  app with its own inline CSS, so it cannot drift with the app's stylesheet.

Add or reorder a step by editing the `steps` array in
[narration.json](narration.json) and re-running the capture: the camera targets,
the chips, the card and the narration windows all key off the same list.

### The bookends are the app's own boot screen

The intro and outro are the app's real loading screen, filmed — the official
lockup, its sheen sweep and the progress bar — not a card drawn for the video.
Because it is the app's own canvas, the cut into the interface is a fade rather
than a jump between two looks.

To film it, the run blocks the app's JavaScript so the boot overlay never hides
(`--splash` sets `Network.setBlockedURLs`). That also makes this capture the
*smooth* one: the CSS animation repaints constantly, so it filmed at 32.6 fps
against the demo's 5–7 fps. The clip is played once and its last frame is held,
never looped — replaying it restarts the wordmark's fade-in mid-card and reads as
a glitch. If no splash capture exists, the build falls back to drawtext cards.

### Why the recorder drives its own Edge instead of the Preview panel

The Preview panel's recorder would bake a **Freebuff badge** into the corner of
every frame, which is not acceptable in a competition submission. `record-demo.mjs`
launches its own headless Edge over the DevTools protocol — no overlay, no
extensions, no first-run UI — and captures frames with `Page.startScreencast`.

A fresh browser profile is fine: the app seeds a deterministic 21-day sari-sari
store history by itself when no ledger is saved ([store.ts](../src/store.ts) falls
back to `seedLedger`), so the demo always opens on the same populated store.

### What is deliberately dropped

- **The loading splash.** The DOM can be ready before the compositor has painted, so
  the head of a take is a run of byte-identical splash frames. The recorder measures
  that run and the build trims it, otherwise the promo flashes white right after the
  title card.
- **The frames in flight during a screen change.** The app swaps screens with a
  staggered entrance, so the frames captured mid-transition are a part-painted page —
  an empty shell or a half-arrived list. Written into the take, one of them cut from a
  full screen to a near-empty one in the middle of the film: measured as the frame's
  ink collapsing from 1,014,777 dark pixels to 71,472 for a quarter of a second.
  While a change is in flight the frames are therefore acknowledged but not written
  (62 of them in the current take), so the previous screen's last frame simply holds
  across the change. That is both what the app looks like and what keeps the concat
  timeline identical to the capture clock, so narration stays in sync.
- **Nothing is scheduled that cannot be seen.** Every one of the 20 narration lines
  has a screen to land on; the build reports any line that would outlast its own
  screen, and the only one that does runs 0.13 s past — over the held transition,
  where the previous screen is still on display.

### Why the beats carry frame timestamps

Wall-clock time and video time are different clocks. In the first attempt the two
differed by **5.4 seconds**, which would have put the narration visibly out of
sync. Each beat is therefore stamped with the timestamp of the last frame that had
actually arrived, and narration is anchored to those beats rather than to guessed
seconds (`narration.json` uses `beat` + `offset`, not absolute times).

### Where the 30 fps motion comes from

A screencast only pushes a frame when the page repaints, which measured about
**5–7 fps** here. The smooth motion in the finished film is not interpolation and
not invented frames: it is the virtual camera, evaluated at 30 fps over the real
captured frames, with the app itself left an untouched capture. The camera's zoom
and centre are piecewise smoothstepped expressions over the mark keyframes, and the
pan is clamped so the frame can never show the area outside the screen.

### Known limits of the capture

- Motion inside the app is 5–7 fps; the encode is 30 fps. The camera move and the
  overlays are generated at 30 fps so they are smooth, but content that moves inside
  the app itself — a scrolling list, a count-up — updates at capture rate.
- A static screen pushes no frames at all, so a scene whose whole span is static used
  to measure zero seconds and could not be cut. The recorder now forces a repaint
  every half second; the extra frames are identical to their neighbours.
- **The chapter card is a still for its last seconds.** The filmed animation runs
  about 1.5 s of a 6.2 s card; the tail is a cloned frame under the last line of the
  opener. Re-capturing with a slower stagger would fill it.
- Audio comes only from the narration and music; the app's own sounds are muted.

## The voice

Narration is **Kokoro-82M** (`kokoro-js`, model `onnx-community/Kokoro-82M-v1.0-ONNX`,
dtype `q8`), running on CPU in Node. **Apache-2.0**, so the output is usable in a
submitted pitch. The weights download once and it then works offline; no account,
no API key. It replaced Windows SAPI's Zira, which sounded like a 2005 phone menu.

Voice is `af_heart` by default. Switch it with `KOKORO_VOICE`:
`af_bella`, `af_nicole`, `am_michael`, `bm_george` (British male) are the other
good ones. Pace is fitted per line: the generator synthesizes, measures, and only
speeds up as much as the shot window requires. Of the current 20 lines, **eight came
in at exactly speed 1.00**, five needed 1.01–1.13, and the longest seven 1.17–1.28 —
which is the difference between fitted pacing and the chipmunk effect that
arithmetic would have produced.

**Still English, not Taglish.** No Filipino voice exists on this machine or in
Kokoro, which has no Tagalog, and every free *local* Tagalog model is either
non-commercial or worse — see [PROMO_VIDEO_RESEARCH.md](../../PROMO_VIDEO_RESEARCH.md) §2.
Tagalog is on screen instead, in the app's own UI and the captions.

To swap in a real Taglish voice later, replace `docs/video/voice/line-NN.wav` with
your own recordings of the same lines (phone recording is fine), keep the durations
close to the windows in `narration.json`, and re-run `node tools/build-video.mjs`.
Nothing else changes.

## Licences and sources

| Asset | Source | Terms |
|---|---|---|
| Music bed | Mixkit free stock music, asset `644` — `https://assets.mixkit.co/music/644/644.mp3` | [Mixkit free music licence](https://mixkit.co/license/modal/musicFree/): commercial use allowed, **no attribution required**, covers online marketing video and social posts; excludes TV/radio broadcast and video games. Downloaded 12 Oct 2026 for this project. The track title is not present in the page markup (Mixkit loads it via script), so **the asset URL is the identifier** — if the submission is queried, cite it. |
| Voiceover | Kokoro-82M via `kokoro-js` | Apache-2.0 model and code; commercial use permitted. Weights cached locally at first run. |
| Fonts (cards, captions) | Arial / Arial Bold, Windows system fonts | Rendered into the video pixels; no font file is redistributed. |
| App footage | This repository's app | — |

Keep this table updated whenever an asset is swapped. A submission is easier to
defend with a one-page licence log than with a promise.

## Verification performed

Run against the built file, not against the intentions:

- **Container.** `00:01:30.00`, 1080×1920 `SAR 1:1 DAR 9:16`, `h264 (High) yuv420p`,
  30 fps, `aac` 48 kHz mono; the 16:9 cut is the same duration at 1920×1080
  `SAR 1:1 DAR 16:9`. `setsar=1` after the landscape overlay — scaling the phone frame
  had left a 10239:10240 pixel aspect.
- **Audio present and not clipping:** `mean_volume: -19.6 dB`, `max_volume: -0.9 dB`.
- **The mix is exactly as long as the picture.** The silent video, the mix and the
  master all measure `00:01:30.00`. They did not before: narration was offset from the
  loading-splash trim rather than from the first clip, which put every line 1.34 s late
  and left the last frame frozen while the voice finished.
- **Every narration line lands on its own screen.** A frame was extracted at the start
  time of all 20 lines and inspected: title over the boot screen, chapter lines over
  the card, dashboards over the dashboard, the ledger line over the ledger, and so on.
- **Timing report:** 0 overlaps between the 20 lines; one line (the opener's fourth)
  runs 0.13 s past its screen, over a held transition.
- **Captions:** 14 cues burned in, sitting on their plate **90.5–92.8 % down the frame**.
- **No blank frames:** the finished film scanned at 1 fps for 90 frames; none is a
  near-blank page. The part-painted screen that used to flash mid-film is gone.
- **The camera and the touches are real.** Measured at two moments: the dashboard's
  profit card spans 930 px wide before the push and the full frame after it, gold ring
  pixels jump 749 → 27,981, and a touch marker sits on the chip being pressed with its
  second ring travelling out 0.4 s later.
- **Frames inspected by eye at each step** (nine thumbnails in `watch.html`): boot
  screen, chapter card, dashboard, ledger, voice sale, ask, score, offline, outro.
