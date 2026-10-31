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

The TypeScript/Vite production build passes. Impeccable's mechanical detector reported no findings. Third-party Base UI modules emit harmless build warnings that their server-component directives are ignored in this client-only Vite bundle.

## Still to measure

- A full calibration using this user's own silent examples.
- Baseline and personalized WER on fresh, unseen sentences across recording sessions.
- Browser camera quality under real lighting, positioning and dropped frames.
- Longer training runs, memory limits and cancellation during GPU work.
- Generalization to other Apple Silicon Macs and other users.

Do not describe any of these as verified until the corresponding measurements exist.
