#!/bin/sh
# Builds the native host, copies it to ~/Library/Application Support/zh-immerse,
# and registers it as native-messaging host "zh_immerse" with Firefox, Google
# Chrome, and any other Chromium-based browser that is installed.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
"$here/build.sh"

FIREFOX_EXTENSION_ID="{a202aa0b-ba2f-4990-8706-9e11d43be832}"
# Fixed by the public key in scripts/build.mjs (CHROME_KEY).
CHROME_EXTENSION_ID="foakbnkggnfiboimjoffkjdnopkcicfe"
support="$HOME/Library/Application Support"
install_dir="$support/zh-immerse"
binary="$install_dir/zh-translate-host"

mkdir -p "$install_dir"
# Replace rather than overwrite: macOS caches code signatures per file, and a
# binary rewritten in place gets killed on launch.
rm -f "$binary"
cp "$here/build/zh-translate-host" "$binary"

# register <NativeMessagingHosts dir> <JSON line naming who may connect>
register() {
  mkdir -p "$1"
  cat > "$1/zh_immerse.json" <<EOF
{
  "name": "zh_immerse",
  "description": "zh-immerse: on-device English to Chinese translation (Apple Translation)",
  "path": "$binary",
  "type": "stdio",
  $2
}
EOF
  echo "registered $1/zh_immerse.json"
}

register "$support/Mozilla/NativeMessagingHosts" "\"allowed_extensions\": [\"$FIREFOX_EXTENSION_ID\"]"

chromium_origins="\"allowed_origins\": [\"chrome-extension://$CHROME_EXTENSION_ID/\"]"
register "$support/Google/Chrome/NativeMessagingHosts" "$chromium_origins"
# Other Chromium-based browsers, only if they're installed (their settings
# folder exists).
for browser in "Google/Chrome Beta" "Google/Chrome Canary" "Chromium" \
    "BraveSoftware/Brave-Browser" "Microsoft Edge" "Arc/User Data"; do
  if [ -d "$support/$browser" ]; then
    register "$support/$browser/NativeMessagingHosts" "$chromium_origins"
  fi
done

echo "installed $binary"
echo "status: $("$binary" --status)"
