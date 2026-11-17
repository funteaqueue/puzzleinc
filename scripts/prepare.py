"""Prepare the private session configuration and verified cloudflared sidecar."""
import hashlib
import json
import os
import platform
import re
import secrets
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / ".runtime"
TOKEN_NAMES = ("CLOUDFLARE_TUNNEL_TOKEN", "TUNNEL_TOKEN", "token")
SESSION_URL = "wss://puzzleinc.critfail.art"


def read_token(path):
    if not path.is_file():
        return None
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        key, _, value = line.removeprefix("export ").partition("=")
        if key.strip() in TOKEN_NAMES:
            return value.partition("#")[0].strip().strip("\"'")
    return None


def prepare_session():
    path = RUNTIME / "personal-session.json"
    config = json.loads(path.read_text(encoding="utf-8-sig")) if path.exists() else {}
    token = (next((os.environ[k] for k in TOKEN_NAMES if os.environ.get(k)), None)
             or read_token(ROOT / ".env") or read_token(ROOT / "dist/.env") or config.get("tunnelToken"))
    if not token or any(c.isspace() for c in token):
        sys.exit("Set TUNNEL_TOKEN in .env or in the environment before building.")
    config.setdefault("accessKey", secrets.token_hex(32))
    config["url"] = SESSION_URL
    config["tunnelToken"] = token
    data = json.dumps(config, indent=2)
    if not path.exists() or path.read_text(encoding="utf-8") != data:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=RUNTIME, delete=False) as tmp:
            tmp.write(data)
        Path(tmp.name).replace(path)
    return config["accessKey"]


def prepare_client(access_key=None):
    dest = RUNTIME / "client-session.json"
    if not access_key:
        access_key = os.environ.get("PUZZLE_INK_ACCESS_KEY")
    for source in (dest, RUNTIME / "personal-session.json"):
        if not access_key and source.is_file():
            access_key = json.loads(source.read_text(encoding="utf-8-sig")).get("accessKey")
    if not isinstance(access_key, str) or not re.fullmatch("[0-9a-f]{64}", access_key):
        sys.exit("Copy .runtime/client-session.json from the session host or set PUZZLE_INK_ACCESS_KEY.")
    data = json.dumps({"url": SESSION_URL, "accessKey": access_key}, indent=2)
    if not dest.exists() or dest.read_text(encoding="utf-8-sig") != data:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=RUNTIME, delete=False) as tmp:
            tmp.write(data)
        Path(tmp.name).replace(dest)


def download(url, dest, checksum=None):
    if dest.is_file() and (checksum is None or hashlib.sha256(dest.read_bytes()).hexdigest() == checksum):
        return
    with tempfile.TemporaryDirectory(dir=dest.parent) as tmp:
        path = Path(tmp) / dest.name
        with urllib.request.urlopen(url, timeout=90) as response, path.open("wb") as output:
            shutil.copyfileobj(response, output)
        if checksum and hashlib.sha256(path.read_bytes()).hexdigest() != checksum:
            sys.exit(f"Checksum mismatch for {dest.name}")
        path.replace(dest)


def main():
    if sys.platform == "darwin" and platform.machine() == "arm64":
        RUNTIME.mkdir(exist_ok=True)
        prepare_client()
        print("Mac client configuration ready.")
        return
    if sys.platform not in ("win32", "linux") or platform.machine().lower() not in ("amd64", "x86_64"):
        sys.exit("Build on Windows x64, Linux x86_64 or Apple Silicon macOS.")
    RUNTIME.mkdir(exist_ok=True)
    prepare_client(prepare_session())
    release = json.loads(Path(__file__).with_name("cloudflared-release.json").read_text(encoding="utf-8"))
    windows = sys.platform == "win32"
    name = "cloudflared-windows-amd64.exe" if windows else "cloudflared-linux-amd64"
    asset = next(item for item in release["assets"] if item["name"] == name)
    folder = RUNTIME / "cloudflared" / sys.platform
    folder.mkdir(parents=True, exist_ok=True)
    binary = folder / ("cloudflared.exe" if windows else "cloudflared")
    download(asset["url"], binary, asset["sha256"])
    binary.chmod(0o755)
    download(f"https://raw.githubusercontent.com/cloudflare/cloudflared/{release['version']}/LICENSE",
             folder / "LICENSE.cloudflared")
    print(f"Session ready. Verified cloudflared {release['version']} for {sys.platform}.")


if __name__ == "__main__":
    main()
