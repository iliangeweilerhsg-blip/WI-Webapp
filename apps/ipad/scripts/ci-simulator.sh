#!/usr/bin/env bash
# Gibt die UDID eines verfügbaren iPad-Simulators aus (stdout), den Namen auf stderr.
# Wählt die neueste iOS-Laufzeit ab 17 und bevorzugt darin ein iPad Air (Gerät des Owners).
# Gerätenamen wechseln je nach Xcode auf dem Runner, darum wird nicht fest verdrahtet.
set -euo pipefail

xcrun simctl list devices available -j | python3 -c '
import json
import sys

devices_by_runtime = json.load(sys.stdin)["devices"]


def version(runtime):
    # com.apple.CoreSimulator.SimRuntime.iOS-18-5 -> (18, 5)
    tail = runtime.rsplit("iOS-", 1)[-1]
    return tuple(int(part) for part in tail.split("-") if part.isdigit())


candidates = []
for runtime, devices in devices_by_runtime.items():
    if "SimRuntime.iOS-" not in runtime or version(runtime) < (17,):
        continue
    for device in devices:
        if device.get("isAvailable", True) and "iPad" in device["name"]:
            candidates.append((version(runtime), "iPad Air" in device["name"], device["name"], device["udid"]))

if not candidates:
    sys.exit("Kein iPad-Simulator mit iOS 17 oder neuer gefunden")

runtime_version, _, name, udid = max(candidates)
print("Simulator: %s (iOS %s)" % (name, ".".join(str(part) for part in runtime_version)), file=sys.stderr)
print(udid)
'
