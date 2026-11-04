#!/usr/bin/env bash
# Install the pinned Foundry libraries into packages/contracts/lib.
# forge install looks tags up through git and failed in a repository with no commits,
# so this script clones the release tags directly.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIB="$ROOT/lib"
mkdir -p "$LIB"

clone() {
  local name="$1"
  local url="$2"
  local tag="$3"
  local dest="$LIB/$name"
  if [[ -d "$dest/.git" ]]; then
    echo "$name already present"
    return
  fi
  rm -rf "$dest"
  git clone --depth 1 --branch "$tag" "$url" "$dest"
}

# forge-std v1.17.0 = f3dae6e6ee381f25eb6a246f7da9b85c91a68219
clone forge-std https://github.com/foundry-rs/forge-std.git v1.17.0
# openzeppelin-contracts v5.7.0 = cab19933c33c2ad1d4c7a84864a3601dddfd16f3
clone openzeppelin-contracts https://github.com/OpenZeppelin/openzeppelin-contracts.git v5.7.0
