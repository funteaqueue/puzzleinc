import json
import shutil
import sys
import tarfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
config = json.loads((root / 'tauri.conf.json').read_text(encoding='utf-8'))
version = config['version']
release = root / 'target/release'
dist = root / 'dist'
dist.mkdir(exist_ok=True)

if sys.platform == 'win32':
    out = dist / f'Puzzle-Ink-Tauri-{version}-win-x64.exe'
    shutil.copyfile(release / 'puzzle-ink.exe', out)
elif sys.platform == 'linux':
    out = dist / f'puzzle-ink-tauri-{version}-linux-x64.tar.gz'
    runtime = root / '.runtime/cloudflared/linux'
    with tarfile.open(out, 'w:gz') as archive:
        for src in [release / 'puzzle-ink', runtime / 'cloudflared', runtime / 'LICENSE.cloudflared']:
            entry = archive.gettarinfo(str(src), arcname='puzzle-ink-tauri/' + src.name)
            entry.mode = 0o644 if src.name.startswith('LICENSE') else 0o755
            with src.open('rb') as content:
                archive.addfile(entry, content)
elif sys.platform == 'darwin':
    import platform
    from macos_bundle import package
    if platform.machine() != 'arm64':
        sys.exit('Mac packaging requires Apple Silicon.')
    out = dist / f'Puzzle-Ink-Tauri-{version}-mac-arm64.zip'
    package(root, release / 'puzzle-ink', config, out)
else:
    sys.exit('Run packaging on Windows, Linux or Apple Silicon macOS.')

print(f'{out.name} {out.stat().st_size:,} bytes')
