# Claude Code Voice Event Notifications

This directory contains documentation and configuration for voice notifications triggered by Claude Code events.

## Overview

Voice notifications provide audio feedback during development workflows by announcing when different Claude Code events occur. This helps developers stay aware of task progress without constantly monitoring the screen.

## Supported Events

- **Stop**: Triggered when the main Claude Code agent finishes responding
- **SubagentStop**: Triggered when a subagent (Task tool) finishes responding  
- **PreCompact**: Triggered before Claude Code performs a compact operation
- **Notification**: Triggered when Claude Code needs user attention or input

## Implementation

The notification system uses:
- Claude Code hooks configured in `.claude/settings.json`
- A Python script that reads event data from stdin
- macOS `say` command for text-to-speech output
- No external dependencies (uses Python standard library only)

## Voice Messages

Each event triggers a specific voice message:
- **Stop**: "Task Complete"
- **SubagentStop**: "Subtask Complete"
- **PreCompact**: "Compacting"
- **Notification**: "Input Required"

## Files

- `setup.md` - Installation and configuration instructions
- `configuration.md` - Detailed configuration reference
- `troubleshooting.md` - Common issues and solutions