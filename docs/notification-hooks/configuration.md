# Configuration Reference

Detailed reference for configuring Claude Code voice notifications.

## Settings.json Structure

The hook configuration in `.claude/settings.json` follows this structure:

```json
{
  "permissions": {
    "allow": ["*"],
    "deny": []
  },
  "hooks": {
    "EventName": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/script"
          }
        ]
      }
    ]
  }
}
```

## Available Events

### Stop
- **When**: Main Claude Code agent finishes responding
- **Use case**: Know when Claude has completed your request
- **Voice message**: "Task Complete"

### SubagentStop  
- **When**: A subagent (Task tool) finishes responding
- **Use case**: Track progress of complex tasks using subagents
- **Voice message**: "Subtask Complete"

### PreCompact
- **When**: Before Claude Code performs a compact operation
- **Use case**: Awareness of when context is being compressed
- **Voice message**: "Compacting"

### Notification
- **When**: Claude Code needs user attention or input
- **Use case**: Know when interaction is required
- **Voice message**: "Input Required"

## Script Input Format

The Python script receives JSON via stdin with this structure:

```json
{
  "session_id": "unique-session-identifier",
  "transcript_path": "/path/to/conversation.json",
  "cwd": "/current/working/directory",
  "hook_event_name": "Stop|SubagentStop|PreCompact|Notification",
  // Additional event-specific fields...
}
```

The script uses `hook_event_name` to determine which voice message to play.

## Customization

### Custom Voice Messages

Modify the `messages` dictionary in the Python script:

```python
messages = {
    'Notification': 'Hey, I need input',
    'Stop': 'All done',
    'SubagentStop': 'Subtask finished',
    'PreCompact': 'Compressing context'
}
```

### Different Voice or Speed

Customize the `say` command:

```python
# Different voice
subprocess.run(['say', '-v', 'Samantha', message])

# Different speaking rate
subprocess.run(['say', '-r', '200', message])

# Both voice and rate
subprocess.run(['say', '-v', 'Samantha', '-r', '180', message])
```

### Additional Events

To add more events, extend both the settings.json hooks section and the Python script's messages dictionary.

## Permissions

The `"allow": ["*"]` permission setting prevents Claude Code from prompting for tool usage permissions. This is optional but recommended to avoid interrupting the workflow.

## File Paths

Always use absolute paths in the `command` field. Relative paths may not resolve correctly depending on Claude Code's working directory.