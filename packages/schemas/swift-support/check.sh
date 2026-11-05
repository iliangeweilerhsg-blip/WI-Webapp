#!/usr/bin/env bash
# Swift-Contract: generierte Swift-Typen + Hilfsschicht kompilieren und gegen die Beispiele prüfen.
# Aufruf: bash packages/schemas/swift-support/check.sh   (SWIFTC überschreibt den Compiler)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
# Swift-6-Sprachmodus: Standard in neuen Xcode-Projekten, strengere Sendable-Prüfungen (#56)
"${SWIFTC:-swiftc}" -swift-version 6 \
  "$here/../generated/swift/Schemas.swift" \
  "$here"/Sources/*.swift \
  "$here/ContractCheck/main.swift" \
  -o "$out/contract-check"
"$out/contract-check" "$repo"

# Auf dem Mac zusätzlich gegen das iOS-SDK typprüfen (wie die iPad-App baut). In der CI (Linux) gibt es kein xcrun
if command -v xcrun >/dev/null 2>&1 && xcrun --sdk iphonesimulator --show-sdk-path >/dev/null 2>&1; then
  xcrun --sdk iphonesimulator swiftc -typecheck -swift-version 6 -target arm64-apple-ios17.0-simulator \
    "$here/../generated/swift/Schemas.swift" "$here"/Sources/*.swift
  echo "iOS-SDK (Swift 6): Typprüfung bestanden"
fi
