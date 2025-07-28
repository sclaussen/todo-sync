# Git Commit Command

This command will:
1. Analyze all staged and unstaged changes in the repository
2. Automatically generate an appropriate commit message based on the changes
3. Stage all changes (`git add -A`)
4. Create the commit with the generated message
5. Follow Conventional Commits format

**Usage:** `/gc` (no parameters needed - the commit message will be generated automatically)

**Conventional Commits Format Used:**
- `feat:` for new features
- `fix:` for bug fixes  
- `docs:` for documentation changes
- `refactor:` for code refactoring
- `test:` for adding/updating tests
- `chore:` for maintenance tasks

**Important:** 
- The commit message will be automatically generated based on the changes
- Do not mention Claude or Claude Code in commit messages
- Clear, descriptive commit messages that explain the "why" not just the "what"

---

# Analyze changes and create commit
git status
git diff --cached
git diff
git log --oneline -5
git add -A
# Generate and apply commit message based on analysis
