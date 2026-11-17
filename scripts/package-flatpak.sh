#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
binary=${1:-"$root/target/release/puzzle-ink"}
assets="$root/.runtime/cloudflared/linux"
read -r id version < <(python3 -c 'import json,sys; c=json.load(open(sys.argv[1])); print(c["identifier"],c["version"])' "$root/tauri.conf.json")
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
build="$stage/build"
files="$build/files"
install -Dm755 "$binary" "$files/bin/puzzle-ink"
install -Dm755 "$assets/cloudflared" "$files/bin/cloudflared"
install -Dm644 "$assets/LICENSE.cloudflared" "$files/share/licenses/$id/LICENSE.cloudflared"
install -Dm644 "$root/icons/icon.png" "$files/share/icons/hicolor/512x512/apps/$id.png"
mkdir -p "$files/share/applications" "$root/dist"
cat > "$files/share/applications/$id.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Puzzle Ink
Exec=puzzle-ink
Icon=$id
Categories=Graphics;
Terminal=false
EOF
cat > "$build/metadata" <<EOF
[Application]
name=$id
runtime=org.gnome.Platform/x86_64/50
sdk=org.gnome.Sdk/x86_64/50
EOF
flatpak build-finish --command=puzzle-ink --socket=x11 --share=ipc --share=network \
    --env=GDK_BACKEND=x11 --env=WEBKIT_DISABLE_DMABUF_RENDERER=1 "$build"
flatpak build-export "$stage/repo" "$build" stable
out="Puzzle-Ink-Tauri-$version-linux-x64.flatpak"
flatpak build-bundle --arch=x86_64 --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo \
    "$stage/repo" "$stage/$out" "$id" stable
install -m644 "$stage/$out" "$root/dist/$out"
printf '%s\n' "$root/dist/$out"
