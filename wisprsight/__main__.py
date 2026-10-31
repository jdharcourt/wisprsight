import argparse
import datetime
import hashlib
import ipaddress
import json
import os
import shutil
import ssl
import subprocess
import urllib.request

import certifi

from wisprsight.engine import DATA, MODELS, ROOT, write_json


def download_models():
    from huggingface_hub import hf_hub_download

    manifest = json.loads((ROOT / "models.lock.json").read_text())
    for artifact in manifest:
        path = MODELS / artifact["path"]
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            with path.open("rb") as source:
                if (
                    hashlib.file_digest(source, "sha256").hexdigest()
                    == artifact["sha256"]
                ):
                    continue
        print(f"Downloading {artifact['path']}", flush=True)
        if "repo" in artifact:
            cached = hf_hub_download(
                artifact["repo"], path.name, revision=artifact["revision"]
            )
            shutil.copyfile(cached, path.with_suffix(".part"))
        else:
            with urllib.request.urlopen(
                artifact["url"],
                context=ssl.create_default_context(cafile=certifi.where()),
                timeout=60,
            ) as response:
                path.with_suffix(".part").write_bytes(response.read(10 * 1024 * 1024))
        with path.with_suffix(".part").open("rb") as source:
            if hashlib.file_digest(source, "sha256").hexdigest() != artifact["sha256"]:
                raise RuntimeError("Model checksum mismatch; installation stopped.")
        path.with_suffix(".part").replace(path)
    write_json(MODELS / "manifest.json", manifest)
    print(
        "Local models installed. LRS3 weights are for research use pending licensing review."
    )


def certificate():
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    cert_path, key_path = DATA / "localhost.pem", DATA / "localhost-key.pem"
    if cert_path.exists() and key_path.exists():
        return cert_path, key_path
    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Wisprsight Local")])
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(
            datetime.datetime.now(datetime.UTC) - datetime.timedelta(minutes=1)
        )
        .not_valid_after(
            datetime.datetime.now(datetime.UTC) + datetime.timedelta(days=30)
        )
        .add_extension(
            x509.SubjectAlternativeName(
                [
                    x509.DNSName("localhost"),
                    x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
                ]
            ),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    return cert_path, key_path


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "command",
        choices=["serve", "dev", "download-models"],
        nargs="?",
        default="serve",
    )
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Use a port between 1024 and 65535.")
    if args.command == "download-models":
        download_models()
        return
    import uvicorn

    os.environ["WISPRSIGHT_PORT"] = str(args.port)
    cert, key = certificate()
    print(
        f"Open https://localhost:{args.port}. Trust only the local certificate at:",
        cert,
        flush=True,
    )
    print("Camera and microphone activate only through browser controls.", flush=True)
    if args.command == "dev":
        if args.port > 65533:
            parser.error("Development mode needs a port at or below 65533.")
        os.environ.update(
            {
                "WISPRSIGHT_PORT": str(args.port + 2),
                "WISPRSIGHT_FRONTEND_ORIGIN": f"https://localhost:{args.port}",
                "WISPRSIGHT_FRONTEND_PORT": str(args.port),
                "WISPRSIGHT_CERT": str(cert),
                "WISPRSIGHT_KEY": str(key),
            }
        )
        frontend = subprocess.Popen(["node", "dev-server.mjs"], cwd=ROOT / "frontend")
        try:
            uvicorn.run(
                "wisprsight.server:app",
                host="127.0.0.1",
                port=args.port + 2,
                ssl_certfile=str(cert),
                ssl_keyfile=str(key),
                access_log=False,
                reload=True,
                reload_dirs=[str(ROOT / "wisprsight")],
            )
        finally:
            frontend.terminate()
            try:
                frontend.wait(timeout=5)
            except subprocess.TimeoutExpired:
                frontend.kill()
        return
    uvicorn.run(
        "wisprsight.server:app",
        host="127.0.0.1",
        port=args.port,
        ssl_certfile=str(cert),
        ssl_keyfile=str(key),
        access_log=False,
    )


if __name__ == "__main__":
    main()
