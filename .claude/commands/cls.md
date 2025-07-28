# Clear Session with Memory - /cls

This command analyzes the current Claude Code session, logs key accomplishments for future context, then clears the session.

**Usage:** `/cls` (no arguments needed)

**What it does:**
1. Analyzes the current session's conversation and actions
2. Identifies key accomplishments, features implemented, bugs fixed, and decisions made
3. Extracts the business context and reasoning behind changes
4. Logs findings to `.claude/session-memory.md` for use by `/gcp` and future sessions
5. **Clears the session** (equivalent to `/clear`)

**Purpose:**
- Automatically maintain continuity between Claude Code sessions
- Provide rich context for intelligent commit message generation
- Capture the "why" behind code changes, not just the "what"
- Help future sessions understand recent development themes and decisions
- One-command workflow: remember session accomplishments then start fresh

---

Analyze the current session to identify key accomplishments, features, fixes, and decisions. Look for:

**Technical Accomplishments:**
- New features implemented or bugs fixed
- Code refactoring or architecture improvements  
- Test improvements or infrastructure changes
- API integrations or migrations
- Performance optimizations

**Business Context:**
- Why were these changes made?
- What problems were being solved?
- What was the user's goal or pain point?
- How do the changes improve the system?

**Decisions Made:**
- Technology choices or architectural decisions
- Approach selections when multiple options existed
- Trade-offs and their reasoning

Generate a concise but comprehensive summary (2-4 sentences) that captures:
1. The main accomplishment(s) of this session
2. The business justification or problem solved
3. Any key technical decisions or approaches taken

Then log it:

```bash
# Create session memory file if it doesn't exist
mkdir -p .claude
touch .claude/session-memory.md

# Add session analysis with timestamp
echo "$(date '+%Y-%m-%d %H:%M'): [Session Analysis] $(cat <<'EOF'
[Generated session summary here - 2-4 sentences capturing key accomplishments, business context, and technical decisions from this session]
EOF
)" >> .claude/session-memory.md

echo "Session accomplishments logged for future reference:"
echo "----------------------------------------"
tail -5 .claude/session-memory.md
echo "----------------------------------------"
echo "Memory file: .claude/session-memory.md"
echo ""
echo "Clearing session..."
```

/clear