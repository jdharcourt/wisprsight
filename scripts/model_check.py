import argparse
import json
import time
from pathlib import Path

import torch

from wisprsight import engine

parser = argparse.ArgumentParser()
parser.add_argument("video", type=Path)
parser.add_argument("--train", action="store_true")
args = parser.parse_args()
engine.verify_models()
payload = args.video.read_bytes()
start = time.monotonic()
crops = engine.extract_video(payload)
reader = engine.make_reader()
prediction, seconds = reader.read(crops)
reference = engine.label_audio(payload)["text"]
result = {
    "frames": len(crops),
    "device": str(reader.enc_device),
    "transcript": prediction,
    "audio_reference": reference,
    "inference_seconds": round(seconds, 2),
    "total_seconds": round(time.monotonic() - start, 2),
}
if args.train:
    from lipflow.train_vsr import _targets, clip_loss, trainable

    reader.model.decoder.to(reader.enc_device)
    reader.model.ctc.to(reader.enc_device)
    reader.model.criterion.to(reader.enc_device)
    parameters = trainable(reader, "frontend")
    before = parameters[0].detach().clone()
    optimizer = torch.optim.AdamW(parameters, lr=1e-5)
    reader.model.train()
    for module in reader.model.modules():
        if isinstance(
            module, (torch.nn.BatchNorm1d, torch.nn.BatchNorm2d, torch.nn.BatchNorm3d)
        ):
            module.eval()
    start = time.monotonic()
    loss = clip_loss(reader, reader.to_tensor(crops), _targets(reader, reference))
    assert torch.isfinite(loss), "Training loss is not finite"
    optimizer.zero_grad()
    loss.backward()
    torch.nn.utils.clip_grad_norm_(parameters, 5)
    optimizer.step()
    assert not torch.equal(before, parameters[0]), "Training did not update weights"
    result.update(
        training_loss=round(float(loss.detach()), 4),
        training_step_seconds=round(time.monotonic() - start, 2),
        trainable_parameters=sum(parameter.numel() for parameter in parameters),
    )
print(json.dumps(result, indent=2))
