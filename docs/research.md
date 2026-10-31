# Model research

Reviewed 31 October 2026. Upstream claims below are not Wisprsight measurements.

## Product distinction

[The Subvocal Company](https://www.ycombinator.com/companies/the-subvocal-company/jobs) describes physiological sensing rather than an ordinary webcam. Wisprsight will instead decode deliberate, visible silent articulation from RGB video. Its performance cannot be inferred from Subvocal's claims.

## Candidate implementations

| Candidate | Useful evidence | Limitation | Proposed role |
| --- | --- | --- | --- |
| [Auto-AVSR](https://github.com/mpc001/auto_avsr) | Sentence-level Python implementation, preprocessing tutorials, pretrained checkpoints | The current model zoo lists 250M-parameter visual models; laptop latency and silent webcam accuracy remain unmeasured | Direct baseline and upstream reference |
| [Lipflow](https://github.com/amywork777/lipflow) | Existing local webcam dictation with Apple Silicon inference, mouth alignment, decoding and personalization | Desktop-first; includes optional cloud cleanup and dependencies outside Wisprsight's scope | Inspect reusable inference and preprocessing code after checking each source's license |
| [LiteVSR](https://arxiv.org/abs/2312.09727) | Research explicitly targets lower resource usage | Reports 45.7% WER on LRS3 after fine-tuning; published claims do not establish ready-to-use Mac inference | Lightweight comparison if usable code and weights can be verified |
| [SwinLip](https://github.com/park-ing/SwinLip) | Efficient word-level recognition implementation | LRW word classification does not satisfy unrestricted sentence dictation | Exclude from the primary sentence prototype |

## Accuracy risks

[Kashiwagi et al.](https://arxiv.org/abs/2305.14203) explicitly study degraded visual recognition when transferring from normal speech to silent speech. Evaluate actual silent articulation, not only ordinary speech with its audio removed.

Similar visible mouth movements can correspond to different sounds. Language priors help rank alternatives but cannot guarantee the intended sentence. Keep raw model text separate from any later local correction; evaluate both independently.

## Model provenance

Auto-AVSR states that its code is Apache-2.0 and that pretrained models may have separate terms derived from training datasets. Lipflow's [NOTICE](https://github.com/amywork777/lipflow/blob/main/NOTICE) advises treating its LRS3-derived weights as noncommercial research assets. This is an unresolved distribution constraint, not clearance to ship a commercial product.

The [Lipflow download script](https://github.com/amywork777/lipflow/blob/main/scripts/download-models.sh) identifies a roughly 1.2 GB bundle containing visual recognition and language-model weights plus a face landmarker. Do not assume that its mirrored 19.1% WER checkpoint is interchangeable with the current Auto-AVSR model zoo's 20.3% WER checkpoint.

Before integration, record for each artifact: upstream revision, original author, exact download URL, SHA-256, architecture/configuration, tokenizer, preprocessing, code license, checkpoint terms and redistribution status. Never execute upstream setup scripts without inspection. Never load an unverified pickle checkpoint or enable unrestricted pickle loading as a workaround.

## Initial test hardware

The development machine reports an Apple M2 and 16 GB RAM. This is a baseline development target, not a minimum requirement or an established performance result.

Use PyTorch MPS for the visual encoder where supported, and measure CPU versus MPS decoding separately. No GPU timing from another project should become a Wisprsight performance claim.
