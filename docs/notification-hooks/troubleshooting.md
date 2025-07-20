# Troubleshooting Voice Notifications

Common issues and solutions for Claude Code voice notifications.

## No Voice Output

### Check Script Permissions
Ensure the script is executable:
```bash
ls -la .claude/hooks/event_notification_voice.py
# Should show: -rwxr-xr-x
```

If not executable:
```bash
chmod +x .claude/hooks/event_notification_voice.py
```

### Verify Python Path
Test the script directly:
```bash
echo '{"hook_event_name": "Stop"}' | .claude/hooks/event_notification_voice.py
```

Should say "Task Complete". If not, check:
- Python 3 is installed: `python3 --version`
- Script shebang is correct: `#!/usr/bin/env python3`

### Check macOS Say Command
Test the `say` command:
```bash
say "Test message"
```

If this doesn't work, check:
- System sound settings
- Volume levels
- Audio output device

## Script Errors

### JSON Parsing Issues
If the script receives invalid JSON, it should say "Hook Error". To debug:

1. Add logging to the script:
```python
import logging
logging.basicConfig(filename='/tmp/hook-debug.log', level=logging.DEBUG)

try:
    data = json.load(sys.stdin)
    logging.debug(f"Received data: {data}")
    # ... rest of script
except Exception as e:
    logging.error(f"Error: {e}")
    subprocess.run(['say', 'Hook Error'])
```

2. Check the log file: `cat /tmp/hook-debug.log`

### Path Issues
If Claude Code can't find the script:
- Verify the absolute path in settings.json is correct
- Test the path: `ls -la /absolute/path/to/.claude/hooks/event_notification_voice.py`

## Configuration Issues

### Settings Not Loading
If changes to settings.json aren't taking effect:
1. Exit Claude Code completely
2. Restart Claude Code
3. Configuration is reloaded on startup

### Events Not Triggering
Some events may be rare:
- **PreCompact**: Only occurs when context gets large
- **Notification**: Only when Claude needs permission or input is idle

Test with common events first:
- **Stop**: Happens after every response
- **SubagentStop**: Use Task tool to trigger

## Performance Issues

### Script Takes Too Long
If the script delays Claude Code responses:
1. Run `say` command in background:
```python
subprocess.Popen(['say', message])
```

2. Add timeout to prevent hanging:
```python
subprocess.run(['say', message], timeout=5)
```

## Alternative Implementations

### Different Audio Systems
For non-macOS systems, replace `say` with:

Linux (espeak):
```python
subprocess.run(['espeak', message])
```

Linux (festival):
```python
subprocess.run(['echo', message, '|', 'festival', '--tts'])
```

Windows (PowerShell):
```python
subprocess.run(['powershell', '-Command', f'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak("{message}")'])
```

### Sound Files Instead of TTS
Replace voice with sound files:
```python
sounds = {
    'Stop': '/System/Library/Sounds/Glass.aiff',
    'SubagentStop': '/System/Library/Sounds/Ping.aiff',
    'PreCompact': '/System/Library/Sounds/Pop.aiff',
    'Notification': '/System/Library/Sounds/Basso.aiff'
}
sound_file = sounds.get(event_name, '/System/Library/Sounds/Funk.aiff')
subprocess.run(['afplay', sound_file])
```

## Getting Help

If issues persist:
1. Check Claude Code documentation: https://docs.anthropic.com/en/docs/claude-code/hooks
2. Verify your Claude Code version supports hooks
3. Test with simpler hooks first (like echoing to a log file)