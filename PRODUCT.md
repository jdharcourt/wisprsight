# Product

## Platform

web

## Stack

User-approved: React/Vite and Notra UI. Hosted pages run ONNX Runtime Web with WebGPU in a worker, without a local Python service. The installed local mode retains FastAPI and PyTorch. Apple Silicon first. A native macOS application follows the browser prototype and reuses the Python inference engine initially.

## Users and purpose

Laptop users who want to dictate English sentences silently while facing their own camera. Wisprsight turns deliberate visible articulation into editable text using local inference.

## Workflow

Every user starts with the shared pretrained Auto-AVSR model and creates a local profile. Hosted visitors first load the roughly 1 GB browser model. Calibration is a full-screen sequence: mouth one sentence, let local mouth-motion tracking detect the finishing pause, and advance to the next prompt. Examples save automatically during the explicitly started session. After the remaining prompts complete a set of 8 distinct sentences, the camera switches off and local training starts automatically. A Done button provides manual endpoint control.

Spoken calibration records synchronized camera and microphone input. Local Whisper labels the audio while the visual model reads the same take without audio. Usable teacher references save automatically; uncertain labels and prompt mismatches pause for review. Custom spoken takes expose an editable reference, visual prediction and word-error comparison. Saved teacher references can be corrected before idle learning. Audio-reference comparisons measure disagreement, not independent accuracy. Dictation results use Title Case. Saved examples use encoded mouth features in browser mode or mouth crops in Python mode and queue supervised learning after thirty seconds idle. Browser learning updates a small visual-conditioned decoder adapter and vocabulary bias; Python learning updates the visual frontend. Both retain the previous adapter unless measured errors improve without a validation regression. Ordinary dictation never requests the microphone.

## Constraints

No cloud inference, telemetry or background recording. Calibration auto-saving is enabled by explicitly starting the session. Dictation keeps at most three temporary correction takes; they expire after five minutes. Browser profiles and features live in IndexedDB, separate from Python profiles; raw browser video is released after processing. Clearing site data deletes browser calibration. Model-download cache can be evicted to prioritize personal data. Raw recordings, model weights and private profiles never enter Git. The first development target is an M2 Mac with 16 GB RAM. Browser mode currently requires Chrome with WebGPU. Accuracy and supported minimum hardware are unproven.

## Brand commitments

Use the actual Notra registry buttons, toasts, selects, sidebar and cards, including their supplied control depth; do not replace them with approximations. Match dplprint.glynn.cc’s compact monochrome workspace. Apply Apple Design and Impeccable guidance, system typography, solid backgrounds, clear focus and reduced-motion support. No decorative glass, chart filler or invented claims.

## Evidence

Model and licensing research is recorded in docs/research.md; measured results are in docs/verification.md. Real PyTorch and browser WebGPU inference, full Python fitting and browser vocabulary fitting have been verified. The visual-conditioned browser adapter reduced familiar-example errors from 21/37 to 19/37 words with unchanged reserved errors of 11/35; it was activated. Python replay improved with unchanged reserved errors; neither result establishes general silent-speech accuracy. Pretrained checkpoint distribution and commercial-use rights remain unresolved.
