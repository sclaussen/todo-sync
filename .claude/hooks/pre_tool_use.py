#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# ///

import json
import sys
import re
from pathlib import Path

def is_dangerous_rm_command(command):
    """
    Comprehensive detection of dangerous rm commands.
    Matches various forms of rm -rf and similar destructive patterns.
    """
    # Normalize command by removing extra spaces and converting to lowercase
    normalized = ' '.join(command.lower().split())
    
    # Pattern 1: Standard rm -rf variations
    patterns = [
        r'\brm\s+.*-[a-z]*r[a-z]*f',  # rm -rf, rm -fr, rm -Rf, etc.
        r'\brm\s+.*-[a-z]*f[a-z]*r',  # rm -fr variations
        r'\brm\s+--recursive\s+--force',  # rm --recursive --force
        r'\brm\s+--force\s+--recursive',  # rm --force --recursive
        r'\brm\s+-r\s+.*-f',  # rm -r ... -f
        r'\brm\s+-f\s+.*-r',  # rm -f ... -r
    ]
    
    # Check for dangerous patterns
    for pattern in patterns:
        if re.search(pattern, normalized):
            return True
    
    # Pattern 2: Check for rm with recursive flag targeting dangerous paths
    dangerous_paths = [
        r'/',           # Root directory
        r'/\*',         # Root with wildcard
        r'~',           # Home directory
        r'~/',          # Home directory path
        r'\$HOME',      # Home environment variable
        r'\.\.',        # Parent directory references
        r'\*',          # Wildcards in general rm -rf context
        r'\.',          # Current directory
        r'\.\s*$',      # Current directory at end of command
    ]
    
    # Check if rm command has recursive flag and targets dangerous paths
    if re.search(r'\brm\s+.*-[a-z]*r', normalized):
        for path_pattern in dangerous_paths:
            if re.search(path_pattern, normalized):
                return True
    
    return False

def is_env_file_access(tool_name, file_path_arg):
    """
    Check if the tool is trying to access .env files (but allow .env.sample).
    """
    if not file_path_arg:
        return False
    
    # Convert to string if Path object
    file_path = str(file_path_arg).lower()
    
    # Allow .env.sample, .env.example, .env.template files
    if re.search(r'\.env\.(sample|example|template)', file_path):
        return False
    
    # Block access to .env files
    if re.search(r'(^|/)\.env($|\.)', file_path):
        return True
    
    return False

def main():
    try:
        # Read JSON input from stdin
        input_data = json.load(sys.stdin)
        
        # Ensure log directory exists
        log_dir = Path.cwd() / 'logs'
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / 'pre_tool_use.json'
        
        # Read existing log data or initialize empty list
        if log_path.exists():
            with open(log_path, 'r') as f:
                try:
                    log_data = json.load(f)
                except (json.JSONDecodeError, ValueError):
                    log_data = []
        else:
            log_data = []
        
        # Append new data
        log_data.append(input_data)
        
        # Write back to file with formatting
        with open(log_path, 'w') as f:
            json.dump(log_data, f, indent=2)
        
        # Extract tool information
        tool_name = input_data.get('tool_name', '')
        tool_args = input_data.get('tool_args', {})
        
        # Check for dangerous rm commands in Bash tool
        if tool_name == 'Bash':
            command = tool_args.get('command', '')
            if is_dangerous_rm_command(command):
                print("BLOCKED: Dangerous rm command detected. Use safer alternatives.", file=sys.stderr)
                sys.exit(2)  # Exit code 2 blocks the tool and shows error
        
        # Check for .env file access in file tools
        file_tools = ['Read', 'Edit', 'MultiEdit', 'Write']
        if tool_name in file_tools:
            file_path = tool_args.get('file_path', '')
            if is_env_file_access(tool_name, file_path):
                print("BLOCKED: Access to .env files is not allowed for security.", file=sys.stderr)
                sys.exit(2)  # Exit code 2 blocks the tool and shows error
        
        # Check for .env in bash commands
        if tool_name == 'Bash':
            command = tool_args.get('command', '')
            if re.search(r'\.env($|[^.])', command.lower()) and not re.search(r'\.env\.(sample|example|template)', command.lower()):
                print("BLOCKED: Bash commands accessing .env files are not allowed.", file=sys.stderr)
                sys.exit(2)
        
        # Allow the tool to proceed
        sys.exit(0)
        
    except json.JSONDecodeError:
        # Handle JSON decode errors gracefully
        sys.exit(0)
    except Exception:
        # Exit cleanly on any other error
        sys.exit(0)

if __name__ == '__main__':
    main()