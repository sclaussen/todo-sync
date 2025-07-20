# Claude Code Sound Notifications Setup

This document describes how to configure Claude Code to play sounds when steps are completed and when user input is required.

## Overview

The sound notification system uses Claude Code's hook functionality to play system sounds at key events:
- **Step completion**: Plays a "Glass" sound when a task/step is finished
- **User input required**: Plays a "Ping" sound when Claude needs user approval or input

## Setup Instructions

### 1. Create Hook Scripts

Create the `.claude/hooks/` directory and add the following executable scripts:

**`.claude/hooks/step-complete.sh`**:
```bash
#!/bin/bash
# Play completion sound when a step is finished
afplay /System/Library/Sounds/Funk.aiff
say "Step complete" &
```

**`.claude/hooks/user-input-required.sh`**:
```bash
#!/bin/bash
# Play attention sound when user input is required
afplay /System/Library/Sounds/Basso.aiff
say "Input needed" &
```

Make the scripts executable:
```bash
chmod +x .claude/hooks/step-complete.sh
chmod +x .claude/hooks/user-input-required.sh
```

### 2. Configure Claude Code Settings

Create `.claude/settings.local.json` with the hook configuration and permissions:

```json
{
  "permissions": {
    "allow": [
      "Bash(*)",
      "WebFetch(*)",
      "WebSearch(*)",
      "Edit(*)",
      "Write(*)",
      "MultiEdit(*)"
    ],
    "deny": []
  },
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/step-complete.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/step-complete.sh"
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/user-input-required.sh"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/user-input-required.sh"
          }
        ]
      }
    ]
  },
  "defaultMode": "acceptAll"
}
```

**Key Configuration Details**:
- **`defaultMode: "acceptAll"`** - Prevents all permission prompts
- **`Edit(*), Write(*), MultiEdit(*)`** - Allows all file operations without prompts
- **Multiple hook events** - Tries different event types (PostToolUse, Stop, Notification, PreToolUse) to ensure triggers
- **`settings.local.json`** - Primary configuration file that overrides settings.yaml

## Testing

Test the sound notifications by running the hook scripts directly:

```bash
# Test step completion sound
.claude/hooks/step-complete.sh

# Test user input required sound
.claude/hooks/user-input-required.sh
```

## Sound Files

The system uses macOS built-in sound files and voice notifications:
- **Funk.aiff**: Distinctive completion sound for finished tasks + "Step complete" voice
- **Basso.aiff**: Deep attention sound for user input prompts + "Input needed" voice
- Voice notifications run in background (`&`) to avoid blocking hook execution

You can customize these by changing the paths in the hook scripts to any `.aiff` or `.wav` file on your system, or modify the voice messages.

## Troubleshooting

1. **No sound playing**: Ensure scripts are executable and sound files exist
2. **Permission denied**: Check that bash commands are allowed in settings
3. **Wrong sound**: Modify the `.aiff` file paths in the hook scripts
4. **Hooks not triggering**: Verify the hook configuration syntax in `settings.yaml`

## Alternative Sound Files

Other macOS system sounds you can use:
- `/System/Library/Sounds/Basso.aiff` - Deep attention sound (currently used for input)
- `/System/Library/Sounds/Blow.aiff` - Soft completion sound
- `/System/Library/Sounds/Bottle.aiff` - Pop sound
- `/System/Library/Sounds/Frog.aiff` - Quirky sound
- `/System/Library/Sounds/Funk.aiff` - Funky completion sound (currently used for completion)
- `/System/Library/Sounds/Glass.aiff` - Pleasant completion sound  
- `/System/Library/Sounds/Hero.aiff` - Triumphant sound
- `/System/Library/Sounds/Morse.aiff` - Beep sound
- `/System/Library/Sounds/Ping.aiff` - Classic attention sound
- `/System/Library/Sounds/Purr.aiff` - Soft sound
- `/System/Library/Sounds/Sosumi.aiff` - Classic Mac sound
- `/System/Library/Sounds/Submarine.aiff` - Sonar sound
- `/System/Library/Sounds/Tink.aiff` - Metallic click

**Voice Customization**:
You can also customize the voice messages by editing the `say` commands:
```bash
say "Task finished" &          # Custom completion message
say "Attention required" &     # Custom input message
say -v "Samantha" "Done" &     # Use specific voice
```