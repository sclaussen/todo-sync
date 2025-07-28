# Git Commit and Push with AI-Generated Message

This command will:
1. Analyze all changes since the last commit using `git status` and `git diff`
2. Review recent commit messages for consistency and style patterns
3. Generate a Conventional Commits formatted message based on:
   - The nature and scope of changes made
   - Patterns from recent commits in the repository
   - All context from recent Claude Code sessions since the last commit
4. Stage all changes (`git add -A`)
5. Commit with the generated message
6. Push to remote repository

**How it works:**
- Examines `git log --oneline -10` to understand commit message patterns
- Analyzes `git diff HEAD` to understand what changed
- Uses recent session context to understand the "why" behind changes
- Generates meaningful commit messages that focus on intent, not just mechanics

**Generated messages will:**
- Follow Conventional Commits format (feat:, fix:, docs:, refactor:, test:, chore:)
- Be concise but descriptive (1-2 sentences max)
- Focus on the "why" rather than the "what"
- Never mention Claude or Claude Code as co-author
- Reflect the actual business value or purpose of the changes

**Example outputs:**
- `feat: add priority mapping between local and Todoist task systems`
- `fix: resolve completed task deletion using correct API endpoints`
- `refactor: consolidate task display logic for better separation of concerns`

---

Analyze the changes since the last commit and generate a high-quality Conventional Commits message that captures the essence of what was accomplished and why. 

**Context Sources to Review:**
1. Read `CLAUDE.md` for project context and recent work summaries
2. Check `.claude/` directory for any session logs or memory files  
3. Review recent commit messages to understand development patterns
4. Use current session context about what was just accomplished

Before generating the commit message, read and analyze:

**Step 1: Gather Context**
```bash
# Read project documentation for context
cat CLAUDE.md
cat .claude/CLAUDE.md 2>/dev/null || echo "No project-specific Claude instructions"

# Check for any session logs or memory files
find .claude -name "*.md" -o -name "*session*" -o -name "*memory*" 2>/dev/null | head -5

# Review recent development patterns
git log --oneline -10
```

**Step 2: Analyze Changes**
```bash
git status
git diff --staged  
git diff HEAD
```

**Step 3: Generate Commit Message**

First, understand the full context by asking yourself:
- What was the main goal or problem being solved in recent sessions?
- What features or fixes were being implemented?
- What was the business justification for these changes?

Generate a commit message that:
1. Uses proper Conventional Commits format
2. Captures the business value or purpose of the changes  
3. Is concise but descriptive (1-2 sentences max)
4. Reflects patterns from recent commits
5. References the actual feature/fix that was implemented
6. Never mentions Claude/Claude Code

**Context Integration**: If uncertain about the purpose, review the files that were changed and the CLAUDE.md to understand the project's current focus and recent development themes.

Then execute:
```bash
git add -A
git commit -m "$(cat <<'EOF'
[Generated commit message here]
EOF
)"
git push
```
