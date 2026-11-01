# Browser-only runtime

A deployed Wisprsight site runs recognition and personal word adaptation on the visitor's laptop. Users need a current Chrome browser with WebGPU, camera permission, and enough memory for the roughly 1 GB visual speech model. They do not install Python or run a local service.

## Use

Choose Load browser model, create a browser profile, and record a silent sentence. The download is verified against SHA-256 hashes and cached when browser storage permits. Personal data takes priority over cached downloads. If a data write hits a browser quota, the app removes only its downloadable model cache and retries once. Profiles and corrections are never automatically deleted. Inference can proceed when there is not enough space to cache every model file.

Profiles, approved labels, encoded mouth features and personal token adapters are stored in IndexedDB. Unsaved corrections stay in memory for five minutes. Full video is decoded locally and released after processing; no recording is posted to a server. Browser profiles are separate from existing Python profiles and do not synchronize across browsers or devices. Clearing site data deletes them.

Calibration uses eight different sentences, reserving at least three sentences and thirty words outside training. Saved corrections queue another local update after thirty seconds without recording. Keep the page open and use one tab while learning; concurrent training across tabs is not coordinated. The existing personal adapter remains active unless validation improves, or familiar-example errors improve without a validation regression. The user can cancel an operation.

Browser personalization fits a small vocabulary bias using teacher-forced decoder scores. It does not retrain the visual frontend. Browser inference uses attention beam search without the Python runtime's external RNN language model and CTC prefix scorer. Quality and performance can differ from Python mode. Spoken-reference transcription is currently Python-only; type references for browser calibration.

## Prepare models once as the site operator

```sh
uv sync --locked --group export
uv run wisprsight download-models
uv run --group export python scripts/export_browser.py
npm --prefix frontend ci
npm --prefix frontend run build
```

The exporter reads only the shared pretrained checkpoint, not personal Python adapters. It emits graphs, hash-verified 32 MB weight chunks, vocabulary metadata and the face tracker into `frontend/public/browser-model/`. Generated model files are ignored by Git. The converted checkpoint remains subject to the original weight license; commercial distribution rights have not been established.

To test a source checkout without a Python server, use `npm --prefix frontend run preview` and open `https://localhost:8780/?runtime=browser`. This Node static server uses the existing local development certificate, or paths supplied through `WISPRSIGHT_CERT` and `WISPRSIGHT_KEY`. A hosted site uses its ordinary HTTPS certificate and requires no local certificates on visitors' laptops.

## Vercel

Import the repository. Both the repository-root and `frontend` Vercel configurations select Vite, not FastAPI. With Root Directory `frontend`, the install command is `npm ci`, build command is `npm run build`, and output directory is `dist`.

Model assets must be hosted too. For Git-based deployment, publish the exported bundle directory to an HTTPS asset host you control, then set the Vercel build environment variable `BROWSER_MODEL_URL` to that directory URL, including access to `manifest.json`. The build downloads and verifies each artifact into the static deployment. Visitors subsequently fetch the models from the site's own origin. This build-time URL is not included in the browser bundle.

A Vercel build fails with an explicit configuration error if browser model assets are absent. Uploading the source code alone does not provide a usable model. Model hosting, bandwidth and checkpoint distribution rights are operator responsibilities; this implementation does not automatically publish weights or change any model licenses.

## Verification

`uv run --group export python -m scripts.check_browser_export /path/to/consented-test.webm` compares encoder outputs at two clip lengths and decoder outputs at two prefix lengths against PyTorch. It writes local-only numerical fixtures under `.local/browser-check/`.

`cd frontend` then `node browser-model-check.mjs` runs a static-only HTTPS site with no Python API. It checks actual WebGPU inference against those fixtures, camera-video alignment using a prerecorded public-domain fake camera, correction saving, and IndexedDB persistence. The camera fixture for this developer check is `/private/tmp/wisprsight-calibration-camera.y4m`; real camera and microphone are not used. The export check accepts `--profile NAME_OR_UUID` to prepare eight canonically distinct, local-only mouth-crop fixtures from an explicitly chosen profile. Optional `BROWSER_PERSONALIZATION_CHECK=1` uses those fixtures for a real browser fitting run. It never modifies Python profiles or publishes their data.

Pure decoder and gradient checks run with `node --experimental-strip-types --test frontend/src/browser-decoder.test.ts` from the repository root.
