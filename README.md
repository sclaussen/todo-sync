# Todo Sync

Bidirectional synchronization between your local `~/.todo` file and Todoist.

## Features

- **Bidirectional sync**: Changes in either system are reflected in the other
- **Priority mapping**: `~/.todo` Priority 0 → Todoist Priority 4 (urgent) with today's due date
- **Conflict resolution**: Multiple strategies for handling conflicts
- **Backup support**: Optional backup before each sync
- **Daemon mode**: Automatic periodic synchronization

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the project:
   ```bash
   npm run build
   ```

3. Set up configuration:
   ```bash
   npm run start setup
   ```

4. Run your first sync:
   ```bash
   npm run start sync
   ```

## Commands

- `npm run start setup` - Configure API token and preferences
- `npm run start sync` - Run synchronization
- `npm run start sync --dry-run` - Preview changes without applying them
- `npm run start status` - Show current configuration and sync status
- `npm run start daemon` - Run in daemon mode with automatic sync

## Configuration

Configuration is stored in `~/.todo-sync.json`. The setup command will help you create this file.

### Priority Mapping

- Priority 0 → Todoist Priority 4 (urgent) + due date "today"
- Priority 1 → Todoist Priority 3
- Priority 2 → Todoist Priority 2
- Priority 3 → Todoist Priority 1
- Priority 4 → Todoist Priority 1

### Conflict Resolution

- **Interactive**: Ask user for each conflict
- **Local wins**: Local file changes override Todoist
- **Remote wins**: Todoist changes override local file
- **Newest wins**: Most recent change wins

## File Format

Your `~/.todo` file should follow this format:

```
Priority 0
-------------------------------------------------------------------------------
urgent task due today
another urgent task

Priority 1
-------------------------------------------------------------------------------
high priority task
another high priority task

Priority 2
-------------------------------------------------------------------------------
medium priority task
```

## Development

- `npm run dev` - Run in development mode
- `npm run build` - Build TypeScript
- `npm test` - Run tests
- `npm run lint` - Run linter
- `npm run typecheck` - Run type checking

## API Token

Get your Todoist API token from: https://todoist.com/prefs/integrations

## Troubleshooting

- Check logs in `~/.todo-sync/` directory
- Run `todo-sync status` to verify configuration
- Use `--dry-run` to preview changes before applying

## License

MIT
