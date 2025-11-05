#!/bin/bash
# Script to add a Wazuh Agent to an LXC Container
# Last Modified by Maxwell Klema on August 5th, 2025
# --------------------------------------------------

RUNTIME_LANGUAGE='{"whisper-diarization": "python", "diarization-ui": "nodejs"}'
VERSIONS_DICT='{"whisper-diarization": "3.10"}'

normalize_path() {
    echo "$1" | sed 's#/\+#/#g'
}