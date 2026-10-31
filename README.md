# Wisprsight

Local, camera-only silent English dictation for Apple Silicon Macs.

Mouth a sentence while facing your laptop, then review and copy its transcription in a browser. Python runs the vision and speech model on your laptop. A native macOS app is planned after the browser prototype.

## Status

Project planning and model evaluation. No working transcriber is included yet, and silent-speech accuracy has not been measured.

## Requirements

- Freely mouthed English sentences, completely silent.
- The laptop's own camera; no microphone or additional sensors.
- Local inference, including any future text correction.
- Browser interface first, native macOS integration later.
- Explicit camera activation and no recording retention by default.

## Development

Implementation will begin with a pretrained sentence-level visual speech recognition benchmark on Apple Silicon. The first milestone is a real transcription with measured accuracy and latency on silently mouthed speech.

Model code, weights, and training data have separate licensing considerations. No third-party weights or recordings belong in this repository.
