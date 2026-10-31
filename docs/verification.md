# Verification

31 October 2026. Development hardware: Apple M2 MacBook Air, 16 GB RAM. These results describe this prototype and these particular checks, not general performance or silent-speech accuracy.

## Real model execution

Fixture: four seconds starting at 20.4 seconds in the public-domain [12 March 2016 White House weekly address](https://commons.wikimedia.org/wiki/File:2016-03-12_President_Obama%27s_Weekly_Address.webm). Video was resampled to 25 fps. Audio was used only to verify local label generation; visual inference used video pixels alone.

| Measurement | Result |
| --- | --- |
| Mouth frames | 100 |
| Visual encoder device | MPS |
| Raw visual output | BORN IN NEW YORK CITY AND RAISED MOSTLY IN CHICAGO NANCY DAVIS |
| Local Whisper reference | Born in New York City and raised mostly in Chicago, Nancy Davis. |
| Visual inference | 5.69 seconds |
| Cold full check including initialization, preprocessing and ASR | 40.07 seconds |
| Supervised training loss | 0.4128, finite |
| One training step | 4.83 seconds |
| Trainable visual-frontend parameters | 11,182,784 |

The check asserted that parameters changed after backpropagation and an optimizer step. It did not save a personal model. This clip contains voiced speech; it is not a silent-speech benchmark. Timing includes no promise for other devices, utterance lengths or repeated runs.

Reproduce with `uv run python scripts/model_check.py /path/to/four-second-clip.webm --train`. Supply a consented/licensed video that includes audio if checking local labels. No bundled fixture or personal recording is required for unit tests.

## Automated checks

Python tests cover session/CSRF rejection, origin/host validation, input sizes and formats, profile isolation/deletion, secure response headers, mouth-only persistence, WER normalization, validation-set separation and retaining an incumbent model when a candidate does not improve.

Browser verification covers profile creation/renaming/deletion, calibration navigation, transcript editing/copy/clear, light and dark appearances, mobile overflow, and synthetic camera recording/discard without requesting a microphone for dictation. A delayed-permission test verifies that navigation is disabled while acquiring a camera and that cancelling stops a stream which arrives late. Real camera/microphone permission behavior and Safari recording require user-device verification.

Full-screen calibration was additionally tested using a public-domain video with a still ending as Chrome’s synthetic camera: real local WASM mouth tracking automatically finished three takes, saved their labels, advanced prompts and started training once. The fitting/evaluation endpoints in that workflow check were mocked; it does not establish personal accuracy.

A fresh-load regression check reproduced the Base UI hook crash on the primary development port while isolated and production loads worked. Separate per-port Vite dependency caches fixed the mixed runtime; fresh loads and tooltips then passed.

The TypeScript/Vite production build passes. Impeccable's mechanical detector reported no findings. The local live server serves its React refresh bootstrap as an external module. Sonner’s fixed stylesheet is explicitly allowed by SHA-256 rather than allowing arbitrary inline styles. Production builds currently emit a bundle-size advisory.

## Still to measure

- A full calibration using this user's own silent examples.
- Baseline and personalized WER on fresh, unseen sentences across recording sessions.
- Browser camera quality under real lighting, positioning and dropped frames.
- Longer training runs, memory limits and cancellation during GPU work.
- Generalization to other Apple Silicon Macs and other users.

Do not describe any of these as verified until the corresponding measurements exist.

The camera timing regression now accepts an isolated 200 ms interval in an otherwise 25 fps clip and resamples it to the checkpoint’s 25 fps input. Sustained capture below 15 fps, gaps over 300 ms, or excessive accumulated gaps remain rejected. This replaces the former single-gap 150 ms rejection; tests cover accepted transient jitter and rejected sustained loss. Dictation reuses a live camera between takes and awaits video playback on first acquisition. Real-camera behavior on the user’s laptop still needs a fresh take.

A full user training run reproduced Apple Metal’s `kIOGPUCommandBufferCallbackErrorImpactingInteractivity` during the first epoch. Fresh training readers now select CPU explicitly while ordinary inference keeps automatic device selection. A regression test checks both constructor paths. The replacement CPU run completed all three epochs over 21 training examples and completed reserved-sentence evaluation. Its candidate did not improve, so the incumbent model remained active. This verifies full CPU execution and validation-gated retention, not an accuracy improvement.
