# Wisprsight implementation plan

Status: implementation authorized, 31 October 2026.

## Outcome

An Apple Silicon user launches a local Python application, opens its browser dashboard, creates a calibration profile, and silently mouths unrestricted English sentences to produce editable text. All recognition and training execute locally. A microphone is used only when explicitly enabled to provide calibration labels.

## Architecture

React/Vite and Notra UI form the browser client. FastAPI serves the production build and a same-origin API on loopback HTTPS. PyTorch runs a pretrained Auto-AVSR visual model using MPS for the visual encoder and CPU beam decoding. MediaPipe landmarks align frames into mouth crops matching the checkpoint's preprocessing. A separate local Whisper model produces draft calibration transcripts from explicitly recorded audio; users correct labels before training.

Start by selectively reusing Lipflow's inference, preprocessing and adaptation implementation at a recorded Git revision, preserving attribution. Do not import its desktop app, global keyboard hooks, cloud cleanup, microphone capture, history import or automatic recording. Keep the inference boundary independent of the browser so a later macOS client can reuse it.

## Browser flows

- Dictate: choose a profile, record a short silent sentence, then edit/copy the Title Case transcript. Save correction stores that take's mouth crops with approved text as a training example.
- Calibrate: start a full-screen camera-only session. Each prompt is displayed in large readable type; local WASM landmarks detect articulation and its finishing pause. The take saves automatically and the screen slides to the next sentence. A Done control and retry path support manual endpoint correction. Remaining prompts complete a target of 8 different sentences.
- Train: the camera switches off and Python training starts automatically after the final saved prompt. Reserve validation sentences before fitting; activate a candidate only after sufficient evidence of improvement over the incumbent. Custom spoken references, typed references and manual training remain available.
- Manage: select, rename or delete local profiles; see example count and training status. No cloud account.

## Data and evaluation

Use UUID profile/sample identifiers and local owner-only storage. Persist mouth crops and approved references on explicit example/correction saving, or automatically within a deliberately started calibration session; discard full-face footage and audio after processing. Persist training summaries without private sentences. Separate users' artifacts. Never train on the validation split. Repeated reference sentences belong to one split. Use fresh sentences across sessions for a later independent acceptance test; validation used for candidate selection is not an unbiased final benchmark.

Initial calibration target: eight distinct silent sentences, with at least three sentences and thirty words reserved for validation while five sentences remain for training. This is an engineering starting point, not a guarantee of useful personalization. Show repeat prompts or request more data when sample diversity is insufficient. Target about 30-50 varied examples for a stronger personal calibration experiment.

Measure raw-model word error rate, preprocessing time, inference time, memory use and failure rate separately. Any later text cleanup must remain local and be evaluated separately. Never present decoder scores as calibrated accuracy probabilities.

## Delivery sequence

1. Reproducible inference: pin source and artifacts; verify downloads, safe-load tensor weights and decode a real consented/licensed test clip on this M2. Unit-test preprocessing and data boundaries without camera access.
2. Browser workflow: implement camera-only dictation, profiles, editable text, explicit cancellation, model missing/error states and local API protections.
3. Browser calibration: microphone-enabled local label capture, label editing, silent paired take, saved examples, holdout split, training job, validation gate and rollback.
4. Personal evaluation: user records real silent sentences; compare stock versus personalized WER on unseen examples. Fix actual data/model failures before claiming usable dictation.
5. Native macOS: menu bar, explicit camera permission, optional global shortcut and paste integration. Signed/notarized distribution and Core ML/MLX optimization follow validated accuracy; neither blocks the Python browser prototype.

## Dashboard brief

Use actual Notra registry buttons, toasts, selects, sidebar, cards and their Base UI alert/progress foundation. Match dplprint.glynn.cc's monochrome shell: 48px icon rail, compact header and a centered workspace. Keep the supplied registry control depth instead of flattening it into adapters. Calibration becomes a dedicated full-viewport prompt sequence with horizontal transitions; reduced-motion mode removes the movement. Keyboard controls, clear camera/microphone states, readable errors and narrow-screen layouts are required.

## Security and privacy

Bind to loopback only; validate Host and Origin, use session-bound CSRF tokens for mutations, Secure/HttpOnly/SameSite cookies, CSP and HSTS. Serve built JavaScript and styles locally with no inline scripts or CDNs. Provision a local TLS certificate explicitly; do not silently install a trust root. Rate-limit APIs and serialize inference/training. Validate upload size, allowed media signatures, decoder dimensions, frame count and duration; keep decode work bounded. Resolve only validated identifiers beneath the data directory. Load verified tensors with weights_only=True, never arbitrary pickle. Do not log speech, images, tokens or secrets.

## Dependencies and limits

The shared visual and ASR checkpoints require an initial download; inference is offline afterwards. Model code licensing does not clear pretrained weights or datasets for commercial distribution. This prototype is research-only until that audit is resolved. Silent articulation differs from ordinary voiced speech; paired calibration directly tests that gap. A small calibration set may not overcome visual ambiguity.

## Completion evidence

Report separately: checks that pass, real model smoke results, browser interaction verification, and actual personal training results. Training cannot run meaningfully until a user supplies consented examples through the browser. Never substitute synthetic clips for a claimed personal calibration.
