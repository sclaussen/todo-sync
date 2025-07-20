#!/bin/bash

# Voice notifications for Claude Code events
# Usage: voice.sh <event>

event="$1"

case "$event" in
    "notification")
        say "Input Required"
        ;;
    "stop")
        say "Done"
        ;;
    "subagent-stop")
        say "Subtask Done"
        ;;
    "pre-compact")
        say "Compacting"
        ;;
    *)
        say "Unknown Event"
        ;;
esac