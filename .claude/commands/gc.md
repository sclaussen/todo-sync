# Git Commit Command

This command will:
1. Stage all changes in the repository (`git add -A`)
2. Create a commit with your provided message
3. Follow Conventional Commits format (you should provide a properly formatted message)

**Usage:** `/gc "feat: add new sync functionality"`

**Conventional Commits Format:**
- `feat:` for new features
- `fix:` for bug fixes  
- `docs:` for documentation changes
- `refactor:` for code refactoring
- `test:` for adding/updating tests
- `chore:` for maintenance tasks

**Important:** 
- Do not mention Claude or Claude Code in commit messages
- Use clear, descriptive commit messages that explain the "why" not just the "what"

---

git add -A
git commit -m "$1"
