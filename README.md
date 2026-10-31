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
uv run wisprsight serve
```

Open [https://localhost:8765](https://localhost:8765). The app generates a local HTTPS certificate at `.local/localhost.pem` without changing your system trust settings. For camera access, trust this specific development certificate locally using your browser/macOS certificate settings. Never disable certificate verification globally. The certificate expires after 30 days; remove the two local certificate files and restart to regenerate it.

The first model download is about 1.2 GB, plus the Python environment and download cache. Artifact revisions and SHA-256 checksums are pinned in `models.lock.json`. Recognition and calibration run offline once setup is complete. Keep the Python process running while using the browser.

## Calibrate in the browser

1. Create a profile. Every new profile starts with the same pretrained visual model.
2. In Calibration, record a spoken reference with camera and microphone enabled, or type/use a suggested sentence. Review the reference text; microphone transcription uses local Whisper.
3. Record the same sentence silently, then choose Save example. Only mouth crops and the approved reference are saved.
4. Repeat with at least 18 different sentences; 30–50 varied examples are a better starting point. Keep each silent take under seven seconds.
5. Choose Train locally. Six or more distinct sentences are reserved for validation and never used for fitting. Training runs on your Mac and may take several minutes.

A personal model replaces your current model only after a clear validation improvement across at least 60 reference words. Otherwise your existing model stays active. Profiles and calibration data remain in `.local/profiles/`; deleting a profile removes its examples and personal weights. The microphone is never requested for ordinary dictation.

## Status and evidence

Implemented: browser capture, editable transcription, profiles, local spoken-reference labeling, silent training examples, visual-frontend adaptation and validation-gated activation.

A four-second public-domain video was decoded on this M2 using MPS, and one supervised training step updated 11.2 million frontend parameters. This verifies execution only. Personal silent-speech accuracy is not measured, and no personal calibration has been trained yet. See [verification](docs/verification.md) for exact results and limits.

## Requirements

- Freely mouthed English sentences, completely silent.
- The laptop's own camera; microphone only for optional calibration labels.
- Local inference, including any future text correction.
- Browser interface first, native macOS integration later.
- Explicit camera activation and no recording retention by default.

## Development

See the [implementation plan](docs/plan.md), [product brief](PRODUCT.md) and [model research](docs/research.md). The native Mac app is the next delivery stage after evaluating real personal silent recordings.

```sh
uv run pytest -q
uv run ruff check wisprsight tests scripts
npm --prefix frontend run build
cd frontend
node browser-check.mjs
```

The browser check needs Google Chrome and the local server running. It uses Chrome's synthetic camera, creates/deletes a temporary profile, and never activates the real camera or microphone.

Model code, weights, and training data have separate licensing considerations. LRS3-derived visual weights are treated as noncommercial research assets pending review. No commercial distribution rights are implied. Third-party attribution is in [NOTICE](NOTICE); no model weights or personal recordings belong in this repository.
