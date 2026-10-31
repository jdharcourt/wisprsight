import threading

import numpy as np
import torch

from wisprsight import engine


def test_training_reserves_sentences_and_only_activates_improvement(
    tmp_path, monkeypatch
):
    from lipflow import train_vsr

    monkeypatch.setattr(engine, "DATA", tmp_path)
    monkeypatch.setattr(engine, "verify_models", lambda: None)
    profile = engine.create_profile("Test person")
    references = {}
    for index in range(24):
        text = f"sentence {chr(97 + index)} I would like to write a clear and simple message to my friend today"
        sample = {"id": str(index), "text": text, "frames": 25}
        profile["samples"].append(sample)
        references[index] = text
        np.save(
            engine.profile_path(profile["id"]) / f"{index}.npy",
            np.full((25, 96, 96), index, dtype=np.uint8),
        )
    engine.write_json(engine.profile_path(profile["id"]) / "profile.json", profile)
    trained = []
    model = torch.nn.Module()
    model.encoder = torch.nn.Module()
    model.encoder.frontend = torch.nn.Linear(1, 1)
    model.decoder = torch.nn.Identity()
    model.ctc = torch.nn.Identity()
    model.criterion = torch.nn.Identity()

    class Reader:
        enc_device = torch.device("cpu")
        device = torch.device("cpu")

        def __init__(self):
            self.model = model

        def read(self, crops):
            words = references[int(crops[0, 0, 0])].split()
            return " ".join(words if trained else words[:-3]), 0

    monkeypatch.setattr(engine, "make_reader", lambda profile_id, fresh: Reader())
    monkeypatch.setattr(
        train_vsr,
        "trainable",
        lambda reader, scope: list(model.encoder.frontend.parameters()),
    )
    monkeypatch.setattr(train_vsr, "_targets", lambda reader, text: text)
    monkeypatch.setattr(train_vsr, "_augment", lambda crops: crops)

    def loss(reader, crops, text):
        trained.append(int(crops[0, 0, 0]))
        return model.encoder.frontend.weight.square().sum()

    monkeypatch.setattr(train_vsr, "clip_loss", loss)
    result = engine.train_profile(profile["id"], {}, threading.Event())
    saved = engine.read_profile(profile["id"])
    validation = {
        index
        for index, text in references.items()
        if " ".join(engine.normalize(text)) in saved["validation_keys"]
    }
    assert len(validation) == 6
    assert not validation.intersection(trained)
    assert result["accepted"]
    active = engine.profile_path(profile["id"]) / "active.pth"
    assert active.exists()
    original = active.read_bytes()
    result = engine.train_profile(profile["id"], {}, threading.Event())
    assert not result["accepted"]
    assert active.read_bytes() == original


def test_short_references_fail_before_model_loading(tmp_path, monkeypatch):
    import pytest

    monkeypatch.setattr(engine, "DATA", tmp_path)
    profile = engine.create_profile("Test person")
    profile["samples"] = [
        {"id": str(index), "text": f"word {chr(97 + index)} three", "frames": 25}
        for index in range(18)
    ]
    engine.write_json(engine.profile_path(profile["id"]) / "profile.json", profile)

    def unexpected(*args, **kwargs):
        raise AssertionError(
            "Model loading must not happen before validation preflight"
        )

    monkeypatch.setattr(engine, "make_reader", unexpected)
    with pytest.raises(ValueError, match="sixty words"):
        engine.train_profile(profile["id"], {}, threading.Event())
    assert "validation_keys" not in engine.read_profile(profile["id"])


def test_variable_camera_timing_resamples_isolated_gaps():
    timestamps = np.arange(100, dtype=float) / 25
    timestamps[50:] += 0.16
    crops = np.arange(100, dtype=np.uint8).reshape(100, 1, 1)
    result = engine.resample_video(crops, timestamps)
    assert len(result) == 104
    assert result[0, 0, 0] == 0
    assert result[-1, 0, 0] == 99


def test_variable_camera_timing_rejects_sustained_loss():
    import pytest

    crops = np.zeros((100, 1, 1), dtype=np.uint8)
    for timestamps in [
        np.arange(100) / 10,
        np.r_[np.arange(50) / 25, np.arange(50, 100) / 25 + 0.4],
        np.arange(100) / 12,
    ]:
        with pytest.raises(ValueError, match="Camera timing is too uneven"):
            engine.resample_video(crops, timestamps)


def test_training_reader_uses_cpu_without_changing_inference_device(monkeypatch):
    from lipflow import vsr

    devices = []
    monkeypatch.setattr(
        vsr, "LipReader", lambda **kwargs: devices.append(kwargs["device"]) or object()
    )
    monkeypatch.setattr(engine, "_reader", None)
    monkeypatch.setattr(engine, "_reader_key", None)
    engine.make_reader(fresh=True)
    engine.make_reader()
    assert devices == ["cpu", "auto"]
