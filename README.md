# Wisprsight

Local, camera-only silent English dictation for Apple Silicon Macs.

Mouth a sentence while facing your laptop, then review and copy its transcription in a browser. Python runs the vision and speech model on your laptop. A native macOS app is planned after the browser prototype.

## Run locally

Requires an Apple Silicon Mac, Python 3.11–3.12, Node 22 and [uv](https://docs.astral.sh/uv/). This source-checkout prototype has been tested on an M2 Mac with 16 GB RAM.

```sh
uv sync --locked
npm --prefix frontend ci
npm --prefix frontend run build
uv run wisprsight download-models
uv run wisprsight dev
```

Open [https://localhost:8765](https://localhost:8765). The app generates a local HTTPS certificate at `.local/localhost.pem` without changing your system trust settings. For camera access, trust this specific development certificate locally using your browser/macOS certificate settings. Never disable certificate verification globally. The certificate expires after 30 days; remove the two local certificate files and restart to regenerate it.

The first model download is about 1.2 GB, plus the Python environment and download cache. Artifact revisions and SHA-256 checksums are pinned in `models.lock.json`. Recognition and calibration run offline once setup is complete. Keep the Python process running while using the browser.

## Calibrate in the browser

1. Create a profile, open Calibration, and choose Start calibration.
2. Mouth the displayed sentence silently. Local camera tracking detects articulation followed by a pause; the take saves and the next sentence slides into view. Use Done if you want to end a take manually.
3. Complete the remaining prompts toward 8 different sentences. The camera turns off and local training starts automatically after the final sentence.
4. Review the result, then choose Start dictating.

To add your own material, choose Add a custom sentence instead. You can type/edit a reference or record a spoken reference with the microphone; local Whisper supplies a draft label. Review it, record a silent take, then save it.

Personal training runs on the CPU to avoid Metal command-buffer failures during longer backward passes. Dictation retains automatic GPU acceleration.

To teach a correction, edit a dictation's text and choose Save correction. Its temporary mouth crops become a labeled example, and local CPU learning queues automatically after 30 seconds without recording. Corrections are batched, and at least 8 different sentences are required. Training progress appears automatically; you can cancel it. Dictation pauses while training uses the local model. Each epoch is checked. The best candidate activates only when reserved-sentence errors improve, or replayed examples improve without worsening reserved-sentence errors. At least three distinct sentences and thirty words stay outside training. Replayed-example scores measure familiar examples, not general accuracy. This is supervised fine-tuning, not reinforcement learning. Unsaved correction takes expire after five minutes.

A personal update must improve reserved-sentence errors by at least two words or two percent, or improve replayed-example errors by at least two words without increasing reserved-sentence errors. Otherwise the existing model stays active. Profiles and calibration data remain in `.local/profiles/`; deleting a profile removes its examples and personal weights. The microphone is never requested for ordinary dictation.

## Status and evidence

Implemented: actual Notra UI controls/toasts/sidebar/cards, full-screen automatic calibration, editable Title Case transcriptions, correction examples, local spoken-reference labels, personal visual-frontend training and validation-gated activation.

A four-second public-domain video was decoded on this M2 using MPS, and one supervised training step updated 11.2 million frontend parameters. This verifies execution only. Personal silent-speech accuracy is not measured, and full personal accuracy remains unmeasured. See [verification](docs/verification.md) for exact results and limits.

## Requirements

- Freely mouthed English sentences, completely silent.
- The laptop's own camera; microphone only for optional calibration labels.
- Local inference, including any future text correction.
- Browser interface first, native macOS integration later.
- Explicit camera activation and no recording retention by default.

## Development

`uv run wisprsight dev` runs verified loopback HTTPS, React Fast Refresh and Python reloads at https://localhost:8765. Finish active training before changing Python source. Use `uv run wisprsight serve` after a dashboard build for a stable session without development reloads. Each development port has a separate dependency cache.

See the [implementation plan](docs/plan.md), [product brief](PRODUCT.md) and [model research](docs/research.md). The native Mac app is the next delivery stage after evaluating real personal silent recordings.

```sh
uv run pytest -q
uv run ruff check wisprsight tests scripts
npm --prefix frontend run build
node --experimental-strip-types --test frontend/src/calibration-endpoint.test.ts
cd frontend
node browser-check.mjs
```

Run browser checks against an isolated profile store using `WISPRSIGHT_DATA=/private/tmp/wisprsight-tests uv run wisprsight dev --port 8770`, then `WISPRSIGHT_TEST_URL=https://localhost:8770 node browser-check.mjs` from frontend. The checks need Google Chrome. It uses Chrome's synthetic camera, creates/deletes a temporary profile, and never activates the real camera or microphone.

Model code, weights, and training data have separate licensing considerations. LRS3-derived visual weights are treated as noncommercial research assets pending review. No commercial distribution rights are implied. Third-party attribution is in [NOTICE](NOTICE); no model weights or personal recordings belong in this repository.
