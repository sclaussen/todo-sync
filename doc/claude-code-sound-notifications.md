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
afplay /System/Library/Sounds/Glass.aiff
```

**`.claude/hooks/user-input-required.sh`**:
```bash
#!/bin/bash
# Play attention sound when user input is required
afplay /System/Library/Sounds/Ping.aiff
```

Make the scripts executable:
```bash
chmod +x .claude/hooks/step-complete.sh
chmod +x .claude/hooks/user-input-required.sh
```

### 2. Configure Claude Code Settings

Create or update `.claude/settings.yaml` with the hook configuration:

```yaml
hooks:
  Stop:
    - hooks:
      - type: command
        command: '.claude/hooks/step-complete.sh'
  UserInputRequired:
    - hooks:
      - type: command
        command: '.claude/hooks/user-input-required.sh'
```

### 3. Update Permissions (if needed)

If you encounter permission prompts, update your `.claude/settings.yaml` to include:

```yaml
permissions:
  allow:
    - Bash(*)
    - WebFetch(*)
    - WebSearch(*)
  deny: []
```

## Testing

Test the sound notifications by running the hook scripts directly:

```bash
# Test step completion sound
.claude/hooks/step-complete.sh

# Test user input required sound
.claude/hooks/user-input-required.sh
```

## Sound Files

The system uses macOS built-in sound files:
- **Glass.aiff**: Pleasant completion sound for finished tasks
- **Ping.aiff**: Attention-getting sound for user input prompts

You can customize these by changing the paths in the hook scripts to any `.aiff` or `.wav` file on your system.

## Troubleshooting

1. **No sound playing**: Ensure scripts are executable and sound files exist
2. **Permission denied**: Check that bash commands are allowed in settings
3. **Wrong sound**: Modify the `.aiff` file paths in the hook scripts
4. **Hooks not triggering**: Verify the hook configuration syntax in `settings.yaml`

## Alternative Sound Files

Other macOS system sounds you can use:
- `/System/Library/Sounds/Basso.aiff` - Error/warning sound
- `/System/Library/Sounds/Blow.aiff` - Soft completion sound
- `/System/Library/Sounds/Bottle.aiff` - Pop sound
- `/System/Library/Sounds/Frog.aiff` - Quirky sound
- `/System/Library/Sounds/Funk.aiff` - Funky completion sound
- `/System/Library/Sounds/Hero.aiff` - Triumphant sound
- `/System/Library/Sounds/Morse.aiff` - Beep sound
- `/System/Library/Sounds/Purr.aiff` - Soft sound
- `/System/Library/Sounds/Sosumi.aiff` - Classic Mac sound
- `/System/Library/Sounds/Submarine.aiff` - Sonar sound
- `/System/Library/Sounds/Tink.aiff` - Metallic click