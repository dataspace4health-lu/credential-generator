# Contributing Guide

We welcome contributions that improve the Gaia-X Self-Description Generator maintained by NTT Data Luxembourg for Dataspace4Health! Follow the steps below to propose changes.

## Development Workflow
1. **Fork and clone** the repository.
2. **Create a feature branch** from `main`:
   ```sh
   git checkout -b feature/your-change
   ```
3. **Install dependencies**:
   ```sh
   npm install
   ```
4. **Make your changes** following the coding standards below.
5. **Add or update tests** in `tests/` and run them:
   ```sh
   npm test
   ```
6. **Submit a pull request** with a clear description of the change and any relevant context.

## Coding Standards
- Use modern JavaScript (ES modules).
- Keep functions small and focused; prefer pure functions where possible.
- Include the Apache-2.0 license header at the top of new source files.
- Update documentation (README, comments) when behavior changes.

## Commit & PR Checklist
- [ ] Code is formatted and linted according to project conventions.
- [ ] New/updated tests cover the change.
- [ ] All checks in CI pass.
- [ ] PR description includes motivation, changes, and testing performed.

## Reporting Issues
If you encounter a bug or have a feature request, please open an issue using the appropriate template. Include:
- Steps to reproduce or desired behavior
- Expected vs. actual results
- Environment details (OS, Node.js version)

## Community Expectations
Please review the [Code of Conduct](CODE_OF_CONDUCT.md) and follow it in all project spaces.
