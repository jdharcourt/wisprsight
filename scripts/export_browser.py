import argparse
import hashlib
import json
from pathlib import Path

import onnx
import sentencepiece
import torch

from wisprsight import engine


class BrowserEncoder(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.encoder = model.encoder
        self.ctc = model.ctc.ctc_lo

    def forward(self, video):
        encoded, _ = self.encoder(video, None)
        return encoded, self.ctc(encoded)


class BrowserDecoder(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.decoder = model.decoder

    def forward(self, tokens, memory):
        mask = (
            torch.ones(tokens.shape[1], tokens.shape[1], dtype=torch.bool)
            .tril()
            .unsqueeze(0)
        )
        logits, _ = self.decoder(tokens, mask, memory, None)
        return logits[:, -1].log_softmax(-1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output", type=Path, default=engine.ROOT / "frontend/public/browser-model"
    )
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    engine.verify_models()
    from lipflow import vsr
    from lipflow.face import STABLE_REFERENCE

    vsr.MODELS = str(engine.MODELS)
    reader = vsr.LipReader(device="cpu", use_lm=False, personal=False)
    frames = torch.zeros(1, 1, 50, 88, 88)
    encoder = BrowserEncoder(reader.model).eval()
    decoder = BrowserDecoder(reader.model).eval()
    with torch.no_grad():
        memory, _ = encoder(frames)
    torch.onnx.export(
        encoder,
        (frames,),
        args.output / "encoder.onnx",
        input_names=["video"],
        output_names=["memory", "logits"],
        dynamic_axes={
            "video": {2: "frames"},
            "memory": {1: "time"},
            "logits": {1: "time"},
        },
        opset_version=17,
        dynamo=False,
    )
    print("Encoder exported", flush=True)
    torch.onnx.export(
        decoder,
        (torch.tensor([[len(reader.token_list) - 1, 10]]), memory),
        args.output / "decoder.onnx",
        input_names=["tokens", "memory"],
        output_names=["scores"],
        dynamic_axes={"tokens": {1: "tokens"}, "memory": {1: "time"}},
        opset_version=17,
        dynamo=False,
    )
    print("Decoder exported", flush=True)
    graphs = {}
    for name in ["encoder", "decoder"]:
        path = args.output / f"{name}.onnx"
        model = onnx.load(path)
        weights = args.output / f"{name}.weights"
        weights.unlink(missing_ok=True)
        onnx.save_model(
            model,
            path,
            save_as_external_data=True,
            all_tensors_to_one_file=True,
            location=weights.name,
            size_threshold=1024,
        )
        chunks = []
        with weights.open("rb") as source:
            while block := source.read(32 * 1024 * 1024):
                chunk = args.output / f"{name}.weights.{len(chunks)}"
                chunk.write_bytes(block)
                chunks.append(
                    {
                        "file": chunk.name,
                        "bytes": len(block),
                        "sha256": hashlib.sha256(block).hexdigest(),
                    }
                )
        graphs[name] = {
            "file": path.name,
            "sha256": hashlib.file_digest(path.open("rb"), "sha256").hexdigest(),
            "external": weights.name,
            "chunks": chunks,
        }
        weights.unlink()
    sp = sentencepiece.SentencePieceProcessor(
        model_file=str(engine.MODELS / "lm/unigram5000.model")
    )
    manifest = {
        "version": 1,
        "graphs": graphs,
        "tokens": reader.token_list,
        "pieces": [
            [sp.id_to_piece(i), sp.get_score(i)] for i in range(sp.get_piece_size())
        ],
        "reference": STABLE_REFERENCE.tolist(),
        "fps": 25,
        "mean": 0.421,
        "std": 0.165,
        "decoder": "attention-beam-5-no-external-lm",
        "license": "Research-only pending checkpoint rights review",
    }
    face = engine.MODELS / "face_landmarker.task"
    (args.output / face.name).write_bytes(face.read_bytes())
    manifest["face"] = {
        "file": face.name,
        "sha256": hashlib.file_digest(face.open("rb"), "sha256").hexdigest(),
    }
    (args.output / "manifest.json").write_text(json.dumps(manifest))
    print(
        json.dumps(
            {
                "exported": str(args.output),
                "bytes": sum(p.stat().st_size for p in args.output.iterdir()),
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
