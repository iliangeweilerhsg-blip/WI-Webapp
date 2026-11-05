#!/usr/bin/env bash
# Swift-Contract: generierte Swift-Typen + Hilfsschicht kompilieren und gegen die Beispiele prüfen.
# Aufruf: bash packages/schemas/swift-support/check.sh   (SWIFTC überschreibt den Compiler)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
"${SWIFTC:-swiftc}" \
  "$here/../generated/swift/Schemas.swift" \
  "$here"/Sources/*.swift \
  "$here/ContractCheck/main.swift" \
  -o "$out/contract-check"
"$out/contract-check" "$repo"
