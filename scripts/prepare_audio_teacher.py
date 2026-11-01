import hashlib
import json
import ssl
import urllib.request
from pathlib import Path

import certifi

REVISION = "51eefc0af78b103839eda9e7e4f4186acc6517fe"
FILES = [
    "config.json",
    "generation_config.json",
    "preprocessor_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "normalizer.json",
    "added_tokens.json",
    "onnx/encoder_model_quantized.onnx",
    "onnx/decoder_model_merged_quantized.onnx",
]


def main():
    root = Path(__file__).resolve().parent.parent / "frontend/public/browser-model"
    context = ssl.create_default_context(cafile=certifi.where())
    with urllib.request.urlopen(
        f"https://huggingface.co/api/models/onnx-community/whisper-base.en/revision/{REVISION}?blobs=true",
        context=context,
    ) as response:
        metadata = {item["rfilename"]: item for item in json.load(response)["siblings"]}
    artifacts = []
    for name in FILES:
        path = root / "speech/whisper-base.en" / name
        expected = metadata[name].get("lfs", {}).get("sha256")
        if not path.exists() or (
            expected and hashlib.sha256(path.read_bytes()).hexdigest() != expected
        ):
            path.parent.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(
                f"https://huggingface.co/onnx-community/whisper-base.en/resolve/{REVISION}/{name}",
                context=context,
                timeout=120,
            ) as response:
                content = response.read(64 * 1024 * 1024 + 1)
            if len(content) > 64 * 1024 * 1024 or (
                expected and hashlib.sha256(content).hexdigest() != expected
            ):
                raise ValueError(f"Whisper asset failed verification: {name}")
            path.with_suffix(path.suffix + ".tmp").write_bytes(content)
            path.with_suffix(path.suffix + ".tmp").replace(path)
        content = path.read_bytes()
        artifacts.append(
            {
                "file": path.relative_to(root).as_posix(),
                "bytes": len(content),
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        )
        print(f"Prepared {name}", flush=True)
    (root / "speech-manifest.json").write_text(
        json.dumps(
            {
                "version": 1,
                "model": "whisper-base.en",
                "revision": REVISION,
                "files": artifacts,
            }
        )
    )
    print(
        f"Local audio teacher: {sum(item['bytes'] for item in artifacts) / 1e6:.1f} MB",
        flush=True,
    )


if __name__ == "__main__":
    main()
