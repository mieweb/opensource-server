#!/usr/bin/env bash
# Build the trusted-proxy-auth sdist + wheel into python/dist/.
# Upload is handled separately: CI uses PyPI Trusted Publishing (OIDC); for a
# local release run `python -m twine upload python/dist/*` with your token.
set -euo pipefail
version="${1:?usage: build-pypi.sh <version>}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$here/stamp-version.sh" "$version"
cd "$here/../python"
rm -rf dist
python -m pip install --quiet --upgrade build
python -m build
