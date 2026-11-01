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

Automatic correction learning: tests verify persistent pending state, the idle delay, minimum sentence count, one-job serialization, session discovery after reload, and stopping retries after a failed update. The browser check verifies the correction confirmation and pending-learning banner. Existing validation-gated activation remains in place.

The revised small-sample trainer uses a deterministic center crop, disables dropout while retaining gradients, accumulates four examples per optimizer step, reduces the learning rate to 2e-6, and checks every epoch. Tests cover eight-example startup, unchanged sentence-group separation, retaining the first improving checkpoint when later epochs regress, and replay-only improvement with unchanged validation. Activation permits either a clear reserved-sentence improvement or at least two fewer replay errors with no validation regression. Replay scores are explicitly training-example scores; epoch selection uses the validation set and is not an independent generalization test. Existing profiles retain their established validation groups.

A real run on the existing 34-example profile completed all three epochs. Epoch two was selected: replay errors fell from 10/24 words (41.7%) to 8/24 (33.3%), while the unchanged reserved set stayed at 11/111 errors (9.9%). The selected checkpoint was activated, then loaded in a fresh process and both scores reproduced exactly. This demonstrates improvement on familiar examples without a measured reserved-set regression; it does not demonstrate better accuracy on new sentences or that eight examples are sufficient for all users. The browser checks also passed the eight-sentence target and correction-queue messaging.

## Browser-only runtime — 1 November 2026

The shared pretrained encoder and attention decoder were exported to ONNX, with external weights split into hash-verified 32 MiB chunks. No personal Python adapter was exported. The complete model bundle is 1,052,178,282 bytes and remains outside Git.

CPU ONNX parity against PyTorch passed at 25 and 100 frames and decoder prefixes of one and four tokens. Maximum encoder memory error was 0.000033, encoder logits error 0.000135 and decoder score error 0.000013. Chrome WebGPU parity against the CPU fixture passed with maximum memory error 0.000056 and decoder score error 0.000014.

A static-only HTTPS server with no Python API completed actual WebGPU recognition. Pre-cropped fixture output matched the public-domain reference sentence above. A separate test recorded Chrome's prerecorded synthetic camera, decoded the browser video, tracked/aligned its face and produced an editable Title Case transcript containing “New York City.” That camera path produced wording errors; it is functional evidence, not an accuracy benchmark. A correction persisted after page reload. The test observed zero HTTP API calls and zero requests to external services.

Eight canonically distinct examples from the explicitly selected James profile were encoded on WebGPU and saved into a disposable browser profile. Real vocabulary-adapter fitting completed twelve gradient steps. Loss fell from 0.9204 to 0.8836, but reserved errors remained 11/35 words and familiar-example errors remained 21/37 words. The candidate was correctly rejected. This verifies execution and validation-gated retention, not better recognition. The Python profile was not modified.

The same run reproduced a browser storage quota failure while saving a correction, evicted only the downloadable model cache and successfully retried the personal-data write. Additional storage checks verify immutable asynchronous job snapshots, typed-array persistence, profile isolation and deletion of orphaned feature records. Gradient tests compare finite differences and verify a supervised loss decrease; tokenizer fixtures match SentencePiece on four generic phrases.

The browser runtime omits the Python external RNN language model and CTC prefix scorer. Its small vocabulary adapter does not fine-tune visual weights. Real silent-camera accuracy, unseen-sentence improvement, other devices, cross-tab coordination and an actual Vercel deployment remain unverified.

## Paired audio-video teaching — 1 November 2026

Browser teaching now uses a pinned quantized Whisper base.en model, approximately 79.7 MB, loaded from the same origin. A real WASM run on the public-domain audio fixture returned “Born in New York City and raised mostly in Chicago, Nancy Davis” with average greedy token log probability -0.104. This is a teacher quality check on voiced speech, not a guarantee for other voices or microphone conditions.

The complete browser check recorded a synthetic camera and microphone together, ran actual local Whisper and visual inference on that same take, saved an example automatically, edited its reference through the real persistence path and verified the microphone track was released. No HTTP API or external inference requests occurred. Separate full-screen workflow checks verify uncertain-label review, automatic sentence progression and exactly one training start; those workflow teacher/fitting jobs are mocked.

Browser fitting now updates a linear visual-conditioned token adapter as well as vocabulary biases, with the pretrained encoder frozen. Its 32 input features are normalized pooled encoder outputs. Finite-difference checks verify gradients, and a controlled test learns different token predictions from different visual inputs. This is supervised adaptation, not reinforcement learning or visual-encoder backpropagation.

A separate real eight-example run using existing local-only James mouth crops completed all twelve gradient steps. Loss fell from 0.8986 to 0.8315. Familiar-example errors improved from 21/37 words (56.8%) to 19/37 (51.4%), while reserved errors stayed at 11/35 words (31.4%). The update was activated. These are replay and reserved scores from this fixture run, not evidence of improved unseen silent-sentence accuracy. The existing Python James profile was not modified.

Tests cover teacher uncertainty and prompt mismatch requiring review, cancellation before saving, reference provenance, editing a saved reference, profile isolation and preventing reference edits from changing validation membership. Python mode uses its existing local Whisper and visual-frontend trainer; browser mode uses the visual-conditioned decoder adapter. Both queue accepted examples automatically and retain validation-gated activation.

A real Python paired-teaching run on the public clip produced matching audio/visual text (0/12 word disagreement), saved only mouth crops and the reference into a disposable profile, and queued learning. No existing personal profile was changed. Browser persistence checks additionally verify that the stored visual adapter reaches subsequent dictation and that reference edits cannot cross profiles; model workers are mocked in that storage check.

Final interaction checks keep an unsaved reference edit intact for 35 seconds with eight distinct examples available and confirm that fitting does not start. Saving the correction releases the activity guard. Permission-denied calibration reports both devices off with recovery instructions; live spoken capture reports track-derived camera and microphone state. These UI checks use synthetic media and fixture predictions. The production build, 23 Python tests, six Node tests and production dependency audit pass.
