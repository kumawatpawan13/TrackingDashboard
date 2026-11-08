# CLAUDE.md — Project Development & Token Efficiency Rules

## 1. Core Rules

- Understand the user's task before taking action.
- Use only relevant skills, agents and tools.
- Never activate all installed skills automatically.
- Maximum 2–3 skills per task unless complexity justifies more.
- Never explore the entire repository for a small task.
- Read only relevant files and dependencies.
- Reuse previously established context where reliable.
- Avoid unnecessary explanations, repeated analysis and tool calls.
- Do not modify unrelated files.

## 2. Skill Selection

Before starting:

1. Identify the task category.
2. Inspect available skill descriptions only if needed.
3. Select the minimum relevant skills.
4. Explain briefly why those skills are needed.
5. Do not invoke unrelated skills.

### Task → Skill Mapping

| Task | Skills/Tools to Use |
|------|---------------------|
| Bug fixing | REA (if unfamiliar code) + Ponytail |
| New feature | REA + Karpathy |
| UI redesign | Hallmark + UI-UX Pro Max + Taste |
| Frontend implementation | Frontend-design + 21st.dev |
| Architecture changes | Archify + Graphify |
| Code refactoring | Ponytail + Karpathy |
| Security issues | Security Audit |
| Performance issues | Headroom + Graphify |
| Code review | Claude Code Review + Ponytail |
| Complex UI/UX comparison | Arena |
| Browser testing | gstack |
| Previous work/context retrieval | Claude-Mem |

These are task-specific recommendations, not instructions to load all the tools. Check each skill's actual capabilities before invoking it.

## 3. Code Modification

- Understand existing implementation before modifying.
- Preserve existing business logic and calculations.
- Follow existing coding conventions.
- Avoid unnecessary refactoring.
- Make small, focused changes.
- Never overwrite working functionality without justification.

## 4. Token Management

- Avoid reading the same file repeatedly.
- Avoid dumping large files into context.
- Use targeted searches and relevant line ranges.
- Reuse existing architecture knowledge.
- Use Graphify for complex dependency analysis.
- Use Claude-Mem when previous implementation context is needed.
- Use Headroom when context optimization is beneficial.
- Compact context when conversation becomes unnecessarily large.
- Start a fresh session for unrelated tasks.

## 5. Testing

- Run only relevant tests first.
- Add regression tests for bug fixes.
- Verify existing functionality after changes.
- Avoid unnecessary full test suites for minor changes.
- Never claim tests passed without running them.

## 6. Reporting

Keep the final response concise:

1. Problem or requirement.
2. Files modified.
3. Implementation completed.
4. Tests performed.
5. Remaining issues.

## 7. Important

- Quality and correctness are more important than minimizing tokens at any cost.
- Never skip necessary investigation, security checks or testing just to save tokens.