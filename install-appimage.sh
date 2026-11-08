#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s /path/to/Arc.AppImage\n' "${0##*/}" >&2
}

if [[ $# -ne 1 ]]; then
  usage
  exit 2
fi

source_appimage=$1
if [[ ! -f $source_appimage || $source_appimage != *.AppImage ]]; then
  printf 'Error: expected an existing .AppImage file: %s\n' "$source_appimage" >&2
  exit 1
fi
source_appimage=$(realpath -- "$source_appimage")

home=${HOME:?HOME must be set}
data_home=${XDG_DATA_HOME:-"$home/.local/share"}
if [[ $data_home != /* ]]; then
  printf 'Error: XDG_DATA_HOME must be an absolute path: %s\n' "$data_home" >&2
  exit 1
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
icon_source="$script_dir/src-tauri/icons/icon.png"
if [[ ! -f $icon_source ]]; then
  printf 'Error: Arc icon not found: %s\n' "$icon_source" >&2
  exit 1
fi

app_dir="$home/Applications"
app_path="$app_dir/Arc.AppImage"
applications_dir="$data_home/applications"
desktop_file="$applications_dir/arc.desktop"
icon_path="$data_home/icons/hicolor/512x512/apps/arc.png"

mkdir -p "$app_dir" "$applications_dir"
if [[ -e $app_path && $source_appimage -ef $app_path ]]; then
  chmod 755 "$app_path"
else
  install -Dm755 -- "$source_appimage" "$app_path"
fi
install -Dm644 -- "$icon_source" "$icon_path"

escaped_exec=$app_path
escaped_exec=${escaped_exec//\\/\\\\}
escaped_exec=${escaped_exec//\"/\\\"}
escaped_exec=${escaped_exec//%/%%}

desktop_tmp=$(mktemp "$applications_dir/.arc.desktop.XXXXXX")
trap 'rm -f -- "$desktop_tmp"' EXIT
printf '[Desktop Entry]\nVersion=1.0\nType=Application\nName=Arc\nComment=Web development workspace\nExec="%s"\nIcon=arc\nTerminal=false\nCategories=Development;IDE;\n' \
  "$escaped_exec" > "$desktop_tmp"
chmod 644 "$desktop_tmp"
mv -- "$desktop_tmp" "$desktop_file"
trap - EXIT

printf 'Installed Arc: %s\nLauncher entry: %s\n' "$app_path" "$desktop_file"
