from uuid import uuid4

import numpy as np
import pytest
from fastapi.testclient import TestClient

from wisprsight import engine, server


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(engine, "DATA", tmp_path)
    server.sessions.clear()
    server.limits.clear()
    server.jobs.clear()
    engine._corrections.clear()
    with TestClient(server.app, base_url="https://localhost:8765") as client:
        csrf = client.get("/api/session").json()["csrf"]
        client.headers["x-csrf-token"] = csrf
        yield client


def test_requires_real_session_and_csrf(client):
    client.cookies.clear()
    for token in ["", "invalid", "anything"]:
        response = client.post(
            "/api/profiles", json={"name": "Ada"}, headers={"x-csrf-token": token}
        )
        assert response.status_code == 403


def test_rejects_cross_origin_and_host(client):
    assert (
        client.get(
            "/api/session", headers={"Origin": "https://attacker.example"}
        ).status_code
        == 403
    )
    assert (
        client.get("/api/session", headers={"Host": "attacker.example"}).status_code
        == 400
    )


def test_profiles_are_isolated_and_can_be_deleted(client):
    a = client.post("/api/profiles", json={"name": "Ada"}).json()
    b = client.post("/api/profiles", json={"name": "Grace"}).json()
    assert a["id"] != b["id"]
    assert (
        client.patch(f"/api/profiles/{b['id']}", json={"name": "Grace renamed"}).json()[
            "name"
        ]
        == "Grace renamed"
    )
    assert client.delete(f"/api/profiles/{a['id']}").status_code == 200
    assert [
        profile["name"] for profile in client.get("/api/session").json()["profiles"]
    ] == ["Grace renamed"]


def test_input_boundaries(client):
    for name in ["", "  ", "x" * 61]:
        assert client.post("/api/profiles", json={"name": name}).status_code == 422
    assert client.post("/api/train/not-a-uuid").status_code == 422
    assert (
        client.post(
            f"/api/samples/{uuid4()}",
            content=b"wrong",
            headers={"Content-Type": "video/webm", "x-reference": "A clear sentence"},
        ).status_code
        == 415
    )
    assert (
        client.post(
            "/api/label", content=b"bad", headers={"Content-Type": "text/plain"}
        ).status_code
        == 415
    )
    assert (
        client.post(
            "/api/label",
            content=b"x" * (20 * 1024 * 1024 + 1),
            headers={"Content-Type": "video/webm"},
        ).status_code
        == 413
    )


def test_security_headers_and_secure_cookie(client):
    response = client.get("/api/session")
    assert "script-src 'self'" in response.headers["content-security-policy"]
    assert response.headers["strict-transport-security"]
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "no-store"
    cookie = response.headers["set-cookie"].lower()
    assert "secure" in cookie and "httponly" in cookie and "samesite=strict" in cookie


def test_crops_and_reference_are_saved_without_video(client, monkeypatch):
    profile = engine.create_profile("Ada")
    monkeypatch.setattr(
        engine, "extract_video", lambda payload: np.zeros((50, 96, 96), dtype=np.uint8)
    )
    saved = engine.save_sample(b"test", profile["id"], "This is my sentence")
    assert len(saved["samples"]) == 1
    path = engine.profile_path(profile["id"])
    assert {file.suffix for file in path.iterdir()} == {".json", ".npy"}
    assert np.load(
        path / f"{saved['samples'][0]['id']}.npy", allow_pickle=False
    ).shape == (50, 96, 96)


def test_word_error_rate_counts_insertions_and_deletions():
    assert engine.word_errors("Hello, my friend!", "hello friend") == (1, 3)
    assert engine.word_errors("one two", "one two three") == (1, 2)
    assert engine.word_errors("Don't stop.", "don't stop") == (0, 2)


def test_rejects_path_traversal():
    with pytest.raises(ValueError):
        engine.profile_path("../../outside")


def test_transcripts_use_title_case_and_preserve_apostrophes(client, monkeypatch):
    from types import SimpleNamespace

    profile = engine.create_profile("Ada")
    monkeypatch.setattr(engine, "verify_models", lambda: None)
    monkeypatch.setattr(
        engine, "extract_video", lambda payload: np.zeros((25, 96, 96), dtype=np.uint8)
    )
    monkeypatch.setattr(
        engine,
        "make_reader",
        lambda profile_id: SimpleNamespace(
            read=lambda crops: ("I'M IN NEW YORK CITY", 1), enc_device="cpu"
        ),
    )
    assert engine.transcribe(b"video", profile["id"])["text"] == "I'm In New York City"


def test_corrections_are_bound_to_the_recording_profile_and_consumed(
    client, monkeypatch
):
    from types import SimpleNamespace

    profile = engine.create_profile("Ada")
    other = engine.create_profile("Grace")
    monkeypatch.setattr(engine, "verify_models", lambda: None)
    monkeypatch.setattr(
        engine, "extract_video", lambda payload: np.zeros((50, 96, 96), dtype=np.uint8)
    )
    monkeypatch.setattr(
        engine,
        "make_reader",
        lambda profile_id: SimpleNamespace(
            read=lambda crops: ("A WRONG SENTENCE", 1), enc_device="cpu"
        ),
    )
    token = engine.transcribe(b"video", profile["id"])["correction_id"]
    with pytest.raises(ValueError):
        engine.save_correction(other["id"], token, "The correct reference sentence")
    result = engine.save_correction(
        profile["id"], token, "The correct reference sentence"
    )
    assert result["samples"][0]["text"] == "The correct reference sentence"
    with pytest.raises(ValueError):
        engine.save_correction(profile["id"], token, "A second different sentence")
