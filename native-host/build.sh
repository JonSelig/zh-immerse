#!/bin/sh
# Builds the native host. Needs a macOS 26.4+ SDK; if the selected Xcode is
# older, the Command Line Tools SDK is used instead.
set -eu
cd "$(dirname "$0")"

sdk_ok() {
  v=$(DEVELOPER_DIR="$1" xcrun --sdk macosx --show-sdk-version 2>/dev/null || true)
  major=${v%%.*}
  minor=$(echo "$v" | cut -d. -f2)
  [ -n "$major" ] && { [ "$major" -gt 26 ] || { [ "$major" -eq 26 ] && [ "${minor:-0}" -ge 4 ]; }; }
}

if [ -z "${DEVELOPER_DIR:-}" ]; then
  for dir in "$(xcode-select -p 2>/dev/null || true)" /Library/Developer/CommandLineTools; do
    if [ -n "$dir" ] && sdk_ok "$dir"; then
      DEVELOPER_DIR=$dir
      break
    fi
  done
fi
if [ -z "${DEVELOPER_DIR:-}" ]; then
  echo "error: no macOS 26.4+ SDK found. Update Xcode or the Command Line Tools." >&2
  exit 1
fi
export DEVELOPER_DIR

mkdir -p build
xcrun swiftc -O -swift-version 5 -target arm64-apple-macos26.4 \
  Sources/ZhTranslateHost/main.swift -o build/zh-translate-host
echo "built native-host/build/zh-translate-host (SDK from $DEVELOPER_DIR)"
