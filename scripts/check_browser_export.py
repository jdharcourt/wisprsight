import argparse
import json
import os
import tempfile
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch

from scripts.export_browser import BrowserDecoder, BrowserEncoder
from wisprsight import engine


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument(
        "--profile",
        help="Prepare eight local-only personalization fixtures from a consenting profile name or UUID",
    )
    args = parser.parse_args()
    assets = engine.ROOT / "frontend/public/browser-model"
    manifest = json.loads((assets / "manifest.json").read_text())
    crops = engine.extract_video(args.video.read_bytes())
    from lipflow import vsr

    vsr.MODELS = str(engine.MODELS)
    reader = vsr.LipReader(device="cpu", use_lm=False, personal=False)
    out = engine.DATA / "browser-check"
    out.mkdir(parents=True, exist_ok=True)
    crops.tofile(out / "crops.bin")
    if args.profile:
        profile = next(
            (
                item
                for item in engine.profiles()
                if args.profile in {item["id"], item["name"]}
            ),
            None,
        )
        if not profile:
            raise ValueError("Profile not found")
        records, seen = [], set()
        for sample in profile["samples"]:
            canonical = " ".join(engine.normalize(sample["text"]))
            if canonical in seen or len(engine.normalize(sample["text"])) < 10:
                continue
            seen.add(canonical)
            filename = f"personal-{len(records)}.bin"
            np.load(
                engine.profile_path(profile["id"]) / f"{sample['id']}.npy",
                allow_pickle=False,
            ).tofile(out / filename)
            records.append({"file": filename, "text": sample["text"]})
            if len(records) == 8:
                break
        if len(records) < 8:
            raise ValueError(
                "Eight different references of at least ten words are required for this test fixture"
            )
        (out / "personalization.json").write_text(json.dumps(records))
        print("Prepared eight private local-only mouth-crop fixtures.", flush=True)
    results = {}
    with tempfile.TemporaryDirectory() as directory:
        for name, graph in manifest["graphs"].items():
            os.link(assets / graph["file"], Path(directory) / graph["file"])
            with (Path(directory) / graph["external"]).open("wb") as target:
                for chunk in graph["chunks"]:
                    target.write((assets / chunk["file"]).read_bytes())
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        encoder = ort.InferenceSession(
            str(Path(directory) / "encoder.onnx"),
            options,
            providers=["CPUExecutionProvider"],
        )
        with torch.no_grad():
            for count in [25, len(crops)]:
                x = reader.to_tensor(crops[:count]).unsqueeze(0)
                expected = BrowserEncoder(reader.model)(x)
                actual = encoder.run(None, {"video": x.numpy()})
                errors = [
                    float(np.max(np.abs(a - b.numpy())))
                    for a, b in zip(actual, expected)
                ]
                assert max(errors) < 0.002, errors
                results[str(count)] = errors
            memory = actual[0]
            greedy = reader.greedy(torch.from_numpy(memory[0]))
            print(
                json.dumps({"encoder_max_errors": results, "greedy": greedy}),
                flush=True,
            )
            del encoder
            decoder = ort.InferenceSession(
                str(Path(directory) / "decoder.onnx"),
                options,
                providers=["CPUExecutionProvider"],
            )
            for tokens in [
                [len(reader.token_list) - 1],
                [len(reader.token_list) - 1, 10, 20, 30],
            ]:
                ids = np.asarray([tokens], dtype=np.int64)
                expected = BrowserDecoder(reader.model)(
                    torch.from_numpy(ids), torch.from_numpy(memory)
                ).numpy()
                actual = decoder.run(None, {"tokens": ids, "memory": memory})[0]
                error = float(np.abs(expected - actual).max())
                assert error < 0.002, error
                results["decoder_" + str(len(tokens))] = error
            np.asarray(memory, dtype=np.float32).tofile(out / "memory.bin")
            (out / "expected.json").write_text(
                json.dumps(
                    {
                        "frames": len(crops),
                        "memory_shape": list(memory.shape),
                        "memory_sum": float(memory.sum()),
                        "decoder": actual.tolist(),
                        "greedy": greedy,
                    }
                )
            )
            print(json.dumps({"parity_passed": True, "errors": results}), flush=True)


if __name__ == "__main__":
    main()
