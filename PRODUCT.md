# Product

## Platform

web

## Stack

User-approved: React/Vite, Notra UI, Python FastAPI and PyTorch. Apple Silicon first. A native macOS application follows the browser prototype and reuses the Python inference engine initially.

## Users and purpose

Laptop users who want to dictate English sentences silently while facing their own camera. Wisprsight turns deliberate visible articulation into editable text using local inference.

## Workflow

Every user starts with the shared pretrained Auto-AVSR model and creates a local profile. Calibration is a full-screen sequence: mouth one sentence, let local mouth-motion tracking detect the finishing pause, and advance to the next prompt. Examples save automatically during the explicitly started session. After the remaining prompts complete a set of 8 distinct sentences, the camera switches off and Python training starts automatically. A Done button provides manual endpoint control.

Users can add custom examples with a spoken reference transcribed by local Whisper, or type/edit the reference. Dictation results use Title Case. Editing a transcription and choosing Save correction stores that take's mouth crops with the approved text for subsequent supervised fine-tuning. Ordinary dictation never requests the microphone.

## Constraints

No cloud inference, telemetry or background recording. Calibration auto-saving is enabled by explicitly starting the session. Dictation keeps at most three temporary mouth-crop takes for corrections; they expire after five minutes. Saved calibration data remains on the laptop. Raw recordings, model weights and private profiles never enter Git. The first development target is an M2 Mac with 16 GB RAM. Accuracy and supported minimum hardware are unproven.

## Brand commitments

Use the actual Notra registry buttons, toasts, selects, sidebar and cards, including their supplied control depth; do not replace them with approximations. Match dplprint.glynn.cc’s compact monochrome workspace. Apply Apple Design and Impeccable guidance, system typography, solid backgrounds, clear focus and reduced-motion support. No decorative glass, chart filler or invented claims.

## Evidence

Model and licensing research is recorded in docs/research.md. Real pretrained MPS inference and one supervised training step have been verified. Automated browser checks exercise full-screen completion, saving and training startup with a synthetic camera; full fitting in that browser test is mocked. No personal accuracy benchmark has been recorded. Pretrained checkpoint distribution and commercial-use rights remain unresolved.
