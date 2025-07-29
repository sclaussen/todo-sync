#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

# Voice notifications for Claude Code events
# Reads JSON input from stdin to determine event type

import json
import sys
import subprocess

try:
    # Read JSON input from stdin
    data = json.load(sys.stdin)
    event_name = data.get('hook_event_name', '')

    # Voice messages (commented out, replaced with system sounds)
    # messages = {
    #     'Notification': 'Ready',
    #     'Stop': 'Done',
    #     'SubagentStop': 'Subtask Done',
    #     'PreCompact': 'Compacting'
    # }
    # message = messages.get(event_name, 'Unknown Event')
    # subprocess.run(['say', message])
    
    # System sound mappings
    # Available sounds: Glass, Ping, Pop, Purr, Submarine
    sounds = {
        'Notification': 'Submarine',  # Change this to your preferred sound
        'Stop': 'Pop',
        'SubagentStop': 'Ping',
        'PreCompact': 'Purr'
    }
    
    sound = sounds.get(event_name, 'Glass')
    subprocess.run(['afplay', f'/System/Library/Sounds/{sound}.aiff'])

except (json.JSONDecodeError, KeyError, Exception):
    # Fallback for invalid JSON or other errors
    subprocess.run(['say', 'Hook Error'])
