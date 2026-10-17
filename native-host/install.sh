#!/bin/sh
# Builds the native host, copies it to ~/Library/Application Support/zh-immerse,
# and registers it with Firefox as native-messaging host "zh_immerse".
set -eu
here=$(cd "$(dirname "$0")" && pwd)
"$here/build.sh"

EXTENSION_ID="{a202aa0b-ba2f-4990-8706-9e11d43be832}"
install_dir="$HOME/Library/Application Support/zh-immerse"
manifest_dir="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
binary="$install_dir/zh-translate-host"

mkdir -p "$install_dir" "$manifest_dir"
# Replace rather than overwrite: macOS caches code signatures per file, and a
# binary rewritten in place gets killed on launch.
rm -f "$binary"
cp "$here/build/zh-translate-host" "$binary"

cat > "$manifest_dir/zh_immerse.json" <<EOF
{
  "name": "zh_immerse",
  "description": "zh-immerse: on-device English to Chinese translation (Apple Translation)",
  "path": "$binary",
  "type": "stdio",
  "allowed_extensions": ["$EXTENSION_ID"]
}
EOF

echo "installed $binary"
echo "registered $manifest_dir/zh_immerse.json"
echo "status: $("$binary" --status)"
