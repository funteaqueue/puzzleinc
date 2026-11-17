import plistlib
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path


def assemble(root, executable, config, directory):
    app = directory / "Puzzle Ink.app"
    contents = app / "Contents"
    macos = contents / "MacOS"
    resources = contents / "Resources"
    macos.mkdir(parents=True)
    resources.mkdir()
    shutil.copy2(executable, macos / "puzzle-ink")
    (macos / "puzzle-ink").chmod(0o755)
    icon = (root / "icons/icon.png").read_bytes()
    entry = struct.pack(">4sI", b"ic09", len(icon) + 8) + icon
    (resources / "PuzzleInk.icns").write_bytes(struct.pack(">4sI", b"icns", len(entry) + 8) + entry)
    with (contents / "Info.plist").open("wb") as output:
        plistlib.dump({
            "CFBundleIdentifier": config["identifier"],
            "CFBundleExecutable": "puzzle-ink",
            "CFBundleName": "Puzzle Ink",
            "CFBundlePackageType": "APPL",
            "CFBundleShortVersionString": config["version"],
            "CFBundleVersion": config["version"],
            "CFBundleIconFile": "PuzzleInk.icns",
            "LSMinimumSystemVersion": "14.0",
            "NSHighResolutionCapable": True,
        }, output)
    return app


def package(root, executable, config, out):
    with tempfile.TemporaryDirectory() as tmp:
        app = assemble(root, executable, config, Path(tmp))
        subprocess.run(["codesign", "--force", "--sign", "-", "--timestamp=none", str(app)], check=True)
        subprocess.run(["codesign", "--verify", "--strict", str(app)], check=True)
        subprocess.run(["ditto", "-c", "-k", "--keepParent", str(app), str(out)], check=True)
