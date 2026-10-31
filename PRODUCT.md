# Product

## Platform

web

## Stack

User-approved: React/Vite, Notra UI, Python FastAPI and PyTorch. Apple Silicon first. A native macOS application follows the browser prototype and reuses the Python inference engine initially.

## Users and purpose

Laptop users who want to dictate English sentences silently while facing their own camera. Wisprsight turns deliberate visible articulation into editable text using local inference.

## Workflow

Every user starts from the shared pretrained model and creates a local calibration profile. In the browser, the user enables the camera and optionally the microphone, says a sentence, reviews its local speech transcript, then mouths the same sentence silently. These paired examples personalize visual recognition. Users may also type a reference sentence. Ordinary dictation never requests the microphone.

## Constraints

No cloud inference, telemetry, automatic uploads, or background recording. Explicitly saved calibration data remains on the laptop. Raw recordings, model weights and private profiles never enter Git. The first development target is an M2 Mac with 16 GB RAM. Accuracy and supported minimum hardware are unproven.

## Brand commitments

Notra UI components, Apple Design principles and Impeccable design guidance. Follow the user's clean-interface constraints: compact functional layout, system sans-serif, muted neutral colors, simple borders, restrained corners, no decorative gradients, glass, metric-card grid or invented performance claims.

## Evidence

Model and licensing research is recorded in docs/research.md. No Wisprsight benchmark results or user training recordings exist yet. Pretrained checkpoint distribution and commercial-use rights remain unresolved.
