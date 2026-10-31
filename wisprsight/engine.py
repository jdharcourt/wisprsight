import gc
import hashlib
import io
import json
import math
import os
import re
import threading
import time
from pathlib import Path
from uuid import UUID, uuid4

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("WISPRSIGHT_DATA", ROOT / ".local")).resolve()
MODELS = ROOT / "models"
_reader = None
_reader_key = None
_corrections = {}
_correction_lock = threading.Lock()


def expire_corrections():
    with _correction_lock:
        for token, pending in list(_corrections.items()):
            if pending["expires"] < time.monotonic():
                _corrections.pop(token, None)


def profile_path(profile_id):
    return DATA / "profiles" / str(UUID(str(profile_id)))


def read_profile(profile_id):
    path = profile_path(profile_id)
    if not (path / "profile.json").exists():
        raise ValueError("Choose an existing profile.")
    return json.loads((path / "profile.json").read_text())


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.with_suffix(".tmp").write_text(json.dumps(value, indent=2))
    path.with_suffix(".tmp").replace(path)


def create_profile(name):
    profile = {
        "id": str(uuid4()),
        "name": name.strip(),
        "samples": [],
        "calibration": None,
    }
    write_json(profile_path(profile["id"]) / "profile.json", profile)
    return profile


def profiles():
    return [
        json.loads(path.read_text())
        for path in sorted((DATA / "profiles").glob("*/profile.json"))
    ]


def model_ready():
    lock = ROOT / "models.lock.json"
    return (
        lock.is_file()
        and (MODELS / "manifest.json").is_file()
        and all(
            (MODELS / item["path"]).is_file() for item in json.loads(lock.read_text())
        )
    )


def verify_models():
    if not model_ready():
        raise ValueError(
            "Models are missing. Run uv run wisprsight download-models first."
        )
    for artifact in json.loads((ROOT / "models.lock.json").read_text()):
        path = MODELS / artifact["path"]
        with path.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        if digest != artifact["sha256"]:
            raise ValueError("A model failed its checksum. Download the models again.")


def make_reader(profile_id=None, fresh=False):
    global _reader, _reader_key

    from lipflow import vsr

    active = profile_path(profile_id) / "active.pth" if profile_id else None
    key = (profile_id, active.stat().st_mtime_ns if active and active.exists() else 0)
    if not fresh and _reader is not None and _reader_key == key:
        return _reader
    _reader = None
    gc.collect()
    vsr.MODELS = str(MODELS)
    reader = vsr.LipReader(
        device="cpu" if fresh else "auto", beam_size=5, personal=False
    )
    if profile_id and (profile_path(profile_id) / "active.pth").exists():
        import torch

        reader.model.load_state_dict(
            torch.load(
                profile_path(profile_id) / "active.pth",
                map_location="cpu",
                weights_only=True,
            ),
            strict=False,
        )
    if not fresh:
        _reader, _reader_key = reader, key
    return reader


def extract_video(payload):
    import av
    import cv2
    import mediapipe as mp
    from lipflow.face import FaceObs, mouth_rois
    from mediapipe.tasks.python import BaseOptions, vision

    tracker = vision.FaceLandmarker.create_from_options(
        vision.FaceLandmarkerOptions(
            base_options=BaseOptions(
                model_asset_path=str(MODELS / "face_landmarker.task")
            ),
            running_mode=vision.RunningMode.VIDEO,
            num_faces=2,
        )
    )
    frames, anchors, timestamps = [], [], []
    try:
        with av.open(io.BytesIO(payload)) as container:
            if not container.streams.video:
                raise ValueError("Record a camera video first.")
            stream = container.streams.video[0]
            if stream.width > 1280 or stream.height > 720:
                raise ValueError("Use a camera resolution of 1280 × 720 or lower.")
            for frame in container.decode(video=0):
                if len(frames) >= 380 or frame.time is None:
                    raise ValueError(
                        "The recording is too long or has invalid timestamps."
                    )
                ts = float(frame.time)
                if timestamps and ts <= timestamps[-1]:
                    raise ValueError(
                        "The recording has invalid frame timing. Record it again."
                    )
                if timestamps and ts - timestamps[0] > 12.5:
                    raise ValueError("Keep each sentence under twelve seconds.")
                image = frame.to_ndarray(format="bgr24")
                detection = tracker.detect_for_video(
                    mp.Image(
                        image_format=mp.ImageFormat.SRGB,
                        data=cv2.cvtColor(image, cv2.COLOR_BGR2RGB),
                    ),
                    round(ts * 1000),
                )
                if len(detection.face_landmarks) > 1:
                    raise ValueError("Only one person should face the camera.")
                h, w = image.shape[:2]
                observation = (
                    FaceObs(
                        np.array(
                            [
                                (point.x * w, point.y * h)
                                for point in detection.face_landmarks[0]
                            ],
                            dtype=np.float32,
                        )
                    )
                    if detection.face_landmarks
                    else None
                )
                frames.append(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY))
                anchors.append(observation.anchors if observation else None)
                timestamps.append(ts)
        if len(frames) < 20 or timestamps[-1] - timestamps[0] < 0.8:
            raise ValueError("Record at least one second of clear articulation.")
        valid = [index for index, anchor in enumerate(anchors) if anchor is not None]
        if (
            len(valid) < len(frames) * 0.9
            or not valid
            or valid[0] > 3
            or len(frames) - valid[-1] > 4
        ):
            raise ValueError(
                "Your face was lost. Face the camera in steady light and try again."
            )
        if any(b - a > 4 for a, b in zip(valid, valid[1:])):
            raise ValueError(
                "Your face was hidden for too long. Record the sentence again."
            )
        return resample_video(mouth_rois(frames, anchors), timestamps)
    finally:
        tracker.close()


def resample_video(crops, timestamps):
    from lipflow.vsr import LipReader

    gaps = np.diff(timestamps)
    duration = timestamps[-1] - timestamps[0]
    fps = (len(timestamps) - 1) / duration
    if (
        fps < 15
        or gaps.max() > 0.3
        or np.maximum(gaps - 0.08, 0).sum() > duration * 0.1
    ):
        raise ValueError(
            f"Camera timing is too uneven ({fps:.0f} fps, longest pause {gaps.max() * 1000:.0f} ms). Use steady lighting, close other camera apps, and retry."
        )
    return crops[LipReader.resample(timestamps, len(crops))]


def transcribe(payload, profile_id):
    read_profile(profile_id)
    verify_models()
    start = time.monotonic()
    crops = extract_video(payload)
    reader = make_reader(profile_id)
    text, seconds = reader.read(crops)
    text = re.sub(
        r"(^|[\s-])([a-z])", lambda match: match[1] + match[2].upper(), text.lower()
    )
    result = {
        "text": text,
        "inference_seconds": round(seconds, 2),
        "total_seconds": round(time.monotonic() - start, 2),
        "device": str(reader.enc_device),
    }
    expire_corrections()
    token = str(uuid4())
    with _correction_lock:
        while len(_corrections) >= 3:
            del _corrections[next(iter(_corrections))]
        _corrections[token] = {
            "profile": profile_id,
            "crops": crops,
            "expires": time.monotonic() + 300,
        }
    result["correction_id"] = token
    del reader
    gc.collect()
    return result


def save_sample(payload, profile_id, text):
    return store_sample(extract_video(payload), profile_id, text)


def save_correction(profile_id, token, text):
    with _correction_lock:
        pending = _corrections.get(str(UUID(str(token))))
    if (
        not pending
        or pending["expires"] < time.monotonic()
        or pending["profile"] != profile_id
    ):
        raise ValueError(
            "This recording has expired. Record the sentence again to save a correction."
        )
    result = store_sample(pending["crops"], profile_id, text)
    with _correction_lock:
        _corrections.pop(token, None)
    return result


def store_sample(crops, profile_id, text):
    profile = read_profile(profile_id)
    if len(profile["samples"]) >= 100:
        raise ValueError("This prototype supports up to 100 examples per profile.")
    if len(normalize(text)) < 3:
        raise ValueError("Use a sentence with at least three English words.")
    if len(crops) > 175:
        raise ValueError("Keep calibration sentences under seven seconds.")
    sample_id = str(uuid4())
    np.save(profile_path(profile_id) / f"{sample_id}.npy", crops, allow_pickle=False)
    profile["samples"].append(
        {"id": sample_id, "text": text.strip(), "frames": len(crops)}
    )
    write_json(profile_path(profile_id) / "profile.json", profile)
    return profile


def label_audio(payload):
    import av
    from faster_whisper import WhisperModel

    with av.open(io.BytesIO(payload)) as container:
        if not container.streams.audio:
            raise ValueError(
                "No audio was captured. Enable the microphone or type the sentence."
            )
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=16000)
        samples = []
        total = 0
        for frame in container.decode(audio=0):
            for output in resampler.resample(frame):
                total += output.samples
                if total > 16_000 * 13:
                    raise ValueError("Keep each spoken sentence under twelve seconds.")
                samples.append(output.to_ndarray().reshape(-1))
    if total < 8_000:
        raise ValueError("Record a spoken sentence or type its reference text.")
    if not (MODELS / "whisper" / "model.bin").exists():
        raise ValueError(
            "Local speech-label models are missing. Download the models first."
        )
    model = WhisperModel(
        str(MODELS / "whisper"),
        device="cpu",
        compute_type="int8",
        local_files_only=True,
    )
    segments, _ = model.transcribe(np.concatenate(samples), language="en", beam_size=3)
    text = " ".join(segment.text.strip() for segment in segments).strip()
    del model
    gc.collect()
    if not text:
        raise ValueError(
            "No speech was recognized. Try again or type the reference sentence."
        )
    return {"text": text}


def normalize(text):
    return re.findall(r"[a-z]+(?:'[a-z]+)?", text.lower())


def word_errors(reference, hypothesis):
    ref, hyp = normalize(reference), normalize(hypothesis)
    row = list(range(len(hyp) + 1))
    for i, word in enumerate(ref, 1):
        next_row = [i]
        for j, candidate in enumerate(hyp, 1):
            next_row.append(
                min(next_row[-1] + 1, row[j] + 1, row[j - 1] + (word != candidate))
            )
        row = next_row
    return row[-1], len(ref)


def train_profile(profile_id, job, cancelled):
    import torch
    from lipflow.train_vsr import _augment, _targets, clip_loss, trainable

    profile = read_profile(profile_id)
    groups = {}
    for sample in profile["samples"]:
        groups.setdefault(" ".join(normalize(sample["text"])), []).append(sample)
    if len(groups) < 18:
        raise ValueError(
            "Save at least eighteen different silent sentences before training."
        )
    validation_keys = profile.get("validation_keys")
    if not validation_keys:
        validation_keys = []
        words = 0
        for key in sorted(
            groups, key=lambda key: hashlib.sha256(key.encode()).hexdigest()
        )[:-8]:
            validation_keys.append(key)
            words += len(normalize(groups[key][0]["text"]))
            if len(validation_keys) >= 6 and words >= 60:
                break
        if len(validation_keys) < 6 or words < 60:
            raise ValueError(
                "Add more or longer sentences before training. At least sixty words must be reserved for validation while eight different sentences remain for training."
            )
        profile["validation_keys"] = validation_keys
        write_json(profile_path(profile_id) / "profile.json", profile)
    validation = [sample for key in validation_keys for sample in groups.get(key, [])]
    training = [
        sample
        for key, samples in groups.items()
        if key not in validation_keys
        for sample in samples
    ]
    if len(training) < 8 or len(validation) < 6:
        raise ValueError(
            "Add more different sentences to provide training and validation examples."
        )
    verify_models()
    reader = make_reader(profile_id, fresh=True)
    start = time.monotonic()

    def evaluate():
        errors = words = 0
        for sample in validation:
            if cancelled.is_set():
                raise ValueError(
                    "Training cancelled. Your previous calibration is unchanged."
                )
            prediction, _ = reader.read(
                np.load(
                    profile_path(profile_id) / f"{sample['id']}.npy", allow_pickle=False
                )
            )
            count, length = word_errors(sample["text"], prediction)
            errors += count
            words += length
        return {"errors": errors, "words": words, "wer": errors / max(words, 1)}

    job["message"] = "Measuring your current model on reserved sentences"
    baseline = evaluate()
    reader.model.decoder.to(reader.enc_device)
    reader.model.ctc.to(reader.enc_device)
    reader.model.criterion.to(reader.enc_device)
    parameters = trainable(reader, "frontend")
    optimizer = torch.optim.AdamW(parameters, lr=1e-5, weight_decay=1e-4)
    torch.manual_seed(0)
    for epoch in range(3):
        reader.model.train()
        for module in reader.model.modules():
            if isinstance(
                module,
                (torch.nn.BatchNorm1d, torch.nn.BatchNorm2d, torch.nn.BatchNorm3d),
            ):
                module.eval()
        for index, sample in enumerate(training):
            if cancelled.is_set() or time.monotonic() - start > 1200:
                raise ValueError(
                    "Training stopped. Your previous calibration is unchanged."
                )
            job["message"] = (
                f"Training on {reader.enc_device} · epoch {epoch + 1} of 3 · example {index + 1} of {len(training)}"
            )
            crops = np.load(
                profile_path(profile_id) / f"{sample['id']}.npy", allow_pickle=False
            )
            optimizer.zero_grad(set_to_none=True)
            loss = clip_loss(reader, _augment(crops), _targets(reader, sample["text"]))
            if not torch.isfinite(loss):
                raise ValueError(
                    "Training became unstable. Your previous calibration is unchanged."
                )
            loss.backward()
            torch.nn.utils.clip_grad_norm_(parameters, 5)
            optimizer.step()
        job["progress"] = round((epoch + 1) / 3, 2)
    reader.model.eval()
    reader.model.decoder.to(reader.device)
    reader.model.ctc.to(reader.device)
    job["message"] = "Checking the candidate on reserved sentences"
    candidate = evaluate()
    if cancelled.is_set():
        raise ValueError("Training cancelled. Your previous calibration is unchanged.")
    accepted = candidate["words"] >= 60 and baseline["errors"] - candidate[
        "errors"
    ] >= max(2, math.ceil(candidate["words"] * 0.02))
    if accepted:
        state = {
            key: value.detach().cpu()
            for key, value in reader.model.state_dict().items()
            if key.startswith("encoder.frontend.")
        }
        torch.save(state, profile_path(profile_id) / "candidate.pth")
        (profile_path(profile_id) / "candidate.pth").replace(
            profile_path(profile_id) / "active.pth"
        )
    result = {
        "baseline": baseline,
        "candidate": candidate,
        "accepted": accepted,
        "validation_sentences": len(validation),
        "training_sentences": len(training),
        "message": "Personal model activated."
        if accepted
        else "Previous model kept. Add more varied sentences; at least sixty validation words and a clear improvement are required.",
    }
    profile["calibration"] = result
    write_json(profile_path(profile_id) / "profile.json", profile)
    del optimizer
    gc.collect()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
    return result
