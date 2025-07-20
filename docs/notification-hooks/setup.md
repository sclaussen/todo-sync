# Voice Notification Setup

This guide walks through setting up voice notifications for Claude Code events.

## Prerequisites

- macOS (for `say` command)
- Python 3 (pre-installed on macOS)
- Claude Code

## Step 1: Create the Hook Script

Create the notification script at `.claude/hooks/event_notification_voice.py`:

```python
#!/usr/bin/env python3

# Voice notifications for Claude Code events
# Reads JSON input from stdin to determine event type

import json
import sys
import subprocess

try:
    # Read JSON input from stdin
    data = json.load(sys.stdin)
    event_name = data.get('hook_event_name', '')
    
    messages = {
        'Notification': 'Input Required',
        'Stop': 'Task Complete',
        'SubagentStop': 'Subtask Complete',
        'PreCompact': 'Compacting'
    }
    
    message = messages.get(event_name, 'Unknown Event')
    subprocess.run(['say', message])
    
except (json.JSONDecodeError, KeyError, Exception):
    # Fallback for invalid JSON or other errors
    subprocess.run(['say', 'Hook Error'])
```

Make the script executable:
```bash
chmod +x .claude/hooks/event_notification_voice.py
```

## Step 2: Configure Claude Code Settings

Update `.claude/settings.json` with hook configurations:

```json
{
  "permissions": {
    "allow": ["*"],
    "deny": []
  },
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/project/.claude/hooks/event_notification_voice.py"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/project/.claude/hooks/event_notification_voice.py"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/project/.claude/hooks/event_notification_voice.py"
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/project/.claude/hooks/event_notification_voice.py"
          }
        ]
      }
    ]
  }
}
```

**Important**: Replace `/absolute/path/to/project/` with the actual absolute path to your project directory.

## Step 3: Test the Configuration

1. Restart Claude Code to reload the configuration
2. Use Claude Code normally - you should hear voice notifications when:
   - You finish asking a question ("Task Complete")
   - A subagent finishes a task ("Subtask Complete")
   - Claude needs input ("Input Required")
   - Before compacting operations ("Compacting")

## Troubleshooting

If notifications aren't working, see `troubleshooting.md` for common issues and solutions.