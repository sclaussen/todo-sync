# Claude Code

## Introduction

Claude Code is a powerful terminal-based coding assistant developed by
Anthropic. It integrates the intelligence of Claude directly into your
development environment, allowing you to work more productively without
leaving the terminal. With support for code understanding, context tracking,
custom workflows, and intelligent suggestions, Claude Code is designed to
streamline your coding experience from end to end.


## Getting Started



### Quick Start

```bash
npm install -g @anthropic-ai/claude-code # requires Node.js 18+
```

#### Terminal

```bash
# --> open terminal
cd <repo>
claude
```

#### Cursor / VS Code / Windsurf

```bash
# --> start Cursor / Windsurf / VS Code
# --> install Claude Code by Anthropic extension
# --> open Settings cog
# --> select the "Run Claude Code" icon
# --> SSO authentication
```


### Basic Configuration

```bash
/ide             # Use if running in an IDE window
/terminal-setup  # Enable Shift-Return for multi-line prompts.
/model sonnet    # change the default model to sonnet
/init            # Generates CLAUDE.md, docs project info, any persistent context required
/config          # Verify/update as required
```



# Context

## Implicit Context Management

Each Claude Code session maintains context:

1. Your prompts are added to the context
2. Tool executions (file reads, searches, edits) and their results become part of the context
3. Claude Code's responses are included in the ongoing context
4. System messages and reminders are also part of the context

This accumulating context allows Claude Code to maintain awareness of what
has been discussed and worked on throughout the session, but it also means
the context grows larger over time, which eventually reaches token limits,
and a large context can also confuse the model.

When the context nears the limit, Claude Code auto compacts the context.
This compaction can result in suboptimal responses.

## Configuring Persistent Context

Claude automatically adds these memory files to the context:

```bash
$repo/CLAUDE.md           # Project scoped memory checked in
$repo/$somedir/CLAUDE.md  # Directory scoped memory
$repo/CLAUDE.local.md     # Project scoped memory (not checked in)
~/.claude/CLAUDE.md       # User scoped memory
```

The memory files can be explicitly managed with the following commands:

```bash
/init        # analyze the code base and create the initial $repo/CLAUDE.md
/memory      # Edit existing memory files
```

The following can be added to prompts as well to explicitly manipulate the
memory files and the current context:

```bash
# something  # Claude prompts for where to add the memory
@filename    # Added if referenced in the prompt
```

## /clear

The /clear command starts a new session that starts with only the context
from memory.  To minimize costs, and to keep a focused context, everytime you
done with a feature, or bug fix, or find Claude Code in a confused state, use
/clear to clear your context.

## /compact [optional instructions]

Use /compact to explicitly compact the context.  The /compact command can
optionally take compaction instructions.

## /agents

Another way to optimize how context is used to create independent
[agents](https://docs.anthropic.com/en/docs/claude-code/sub-agents).



# Workflow

### Shift+Tab

- `Shift-tab` to enter **Auto Accept Edit** indicated by `auto-accept edits on`
- `Shift-tab` to enter **Plan Mode** indicated by `plan mode on`
- `Shift-tab` to enter normal mode requiring edits to be accepted

### Plan Mode

Plan mode will allow you to build up an execution plan with Claude before
executing the plan.

## Esc-Esc

Anytime you want to pause/halt an prompt response.  You can pick up directly
from where you paused.



# Thinking

Including specific phrases in the prompt can control how hard the model
thinks.

- Ultra (32K tokens): `think harder` or ultrathink, think intensely, think longer, think really hard, think super hard, think very hard
- Mega (10K tokens): `think hard` or think about it, think a lot, think deeply, think more, megathink
- Exceeded (4K tokens): `think`
- Default: anything else



# Configuration

## `$repo/.claude`

Claude uses a hidden directory, `$repo/.claude/`, to store configurations,
hooks, and reusable custom commands. These are shared with your project and
can be versioned via Git.

## Commands

Custom commands can be added as markdown documents in the
`$repo/.claude/commands/` directory.  This is a powerful capability enabling
users to extend Claude to invoke other LLMs or scripts.

```bash
# $repo/.claude/commands/gc.md
git add -A
git commit -m "$1"
```

Use `/gc 'your commit message'` to run this sequence.


export CLAUDE_CODE_SHELL_PREFIX="zsh -ic"



## Personalizing Your Setup

You can create a `~/.claude` directory in your home folder. This allows you to define **global commands** that are accessible across all projects.

This is especially useful for things like frequently used shell shortcuts, commit helpers, or standardized code templates.

## Additional Configurations

You can use a configuration file such as `config.yaml` in `.claude/` to customize Claude Code's behavior:

```yaml
indentation: 2
verbosity: detailed
code_style:
  language: javascript
  quotes: single
prompts:
  unit_test_template: "Describe the functionality being tested and the expected outcomes for each scenario."
```

This enables consistent formatting and reusability across prompts.



# Reference

## Images

You can attach images to your conversations for visual reference. On macOS, use `Cmd + Shift + 4` to capture a screenshot. You can drag images directly into the terminal or editor chat window (like Cursor).

Claude will interpret screenshots (e.g., diagrams, error messages) as part of the context.

## Key Bindings

- `Escape`: cancel an active prompt
- `Double Escape`: show Claude menu
- `Shift + Tab`: toggle Plan Mode
- `Up/Down Arrows`: navigate previous prompts

## Automation and Hooks

Claude supports **hooks**: actions triggered by file changes or command completions.

Examples:

- Auto-run linter before each commit
- Generate OpenAPI files and test suite when `.yaml` changes
- Run a test suite whenever a file is saved

Hooks are defined in `.claude/hooks/` and can be chained for multi-step workflows.

## Advanced CLI Options

- `--p`: Use Claude in scripts or batch mode (ideal for CI/CD or automation)
- `--dangerously-skip-permissions`: Allows Claude to run commands without manual approval (use with extreme caution)

These options are ideal for power users integrating Claude into their toolchain.



# Github

## Integration with GitHub

Run `/github-setup` to connect Claude with GitHub. Once linked:

- Claude can review pull requests
- Create PRs based on a description
- Assign issues and reference PRs

This improves developer velocity without leaving the terminal.

## Sound Notifications

You can enable sound alerts when:

- Claude finishes processing a prompt
- Claude awaits your input

This is useful when multitasking so you don’t miss the moment Claude is ready.




# MCP Servers

- Serena
- Github
- Context7
- Puppeteer



# FAQ

## Cleanup

```bash
ls ~/Library/Caches/claude-cli-nodejs
ls ~/Library/Application\ Support/Claude/claude_desktop_config.json
ls ~/.claude
ls ~/.claude.json
```

```bash
rm -rf ~/Library/Caches/claude-cli-nodejs
rm -f ~/Library/Application\ Support/Claude/claude_desktop_config.json
rm -rf ~/.claude
rm -rf ~/.claude.json
```



# Usage

## claude monitor

Reads ~/.claude/projects/<project-name>/<session-guid>.jsonl.

```bash
brew install uv
uv tool install claude-monitor
claude-monitor # or cmonitor, ccmonitor, claude-code-monitor
```
## ccusage

Reads ~/.claude/projects/<project-name>/<session-guid>.jsonl.

```bash
npx ccusage
```



# References

## Anthropic Documentation

- [Claude Code documentation](https://www.anthropic.com/claude-code).
- [Claude Code release notes](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

## YouTube
