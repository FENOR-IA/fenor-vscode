# Security Guidelines

## Mandatory Security Checks

Before ANY commit:
- [ ] No hardcoded secrets (API keys, passwords, tokens)
- [ ] All user inputs validated
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (sanitized HTML)
- [ ] CSRF protection enabled
- [ ] Authentication/authorization verified
- [ ] Rate limiting on all endpoints
- [ ] Error messages don't leak sensitive data

## Secret Management

- NEVER hardcode secrets in source code
- ALWAYS use environment variables or a secret manager
- Validate that required secrets are present at startup
- Rotate any secrets that may have been exposed

## Dependency Vetting (MANDATORY before adding any external package)

No new external dependency (npm/composer/pip/cargo/gem/go module) gets installed without vetting
first — see skill: `dependency-vetting` for the full checklist. Non-negotiable minimum before
running the install command:

- [ ] Prefer the narrowest package that solves the actual problem — check its own
      dependencies/required system extensions, not just what it promises to do
- [ ] Run the ecosystem's audit tool (`composer audit`, `npm audit`, `pip-audit`, `cargo audit`,
      `bundle audit`) against the exact candidate version — zero known vulnerabilities is the
      floor, not the goal
- [ ] Check maintenance health (recent activity for actively-issue-tracked packages; single
      maintainer + no org backing is extra scrutiny for anything auth/crypto/payment-adjacent)
- [ ] Confirm it runs in the real production environment (extensions, runtime version), not just
      local dev
- [ ] Document why this package over the obvious alternative, when one was discarded for a
      specific technical reason

## Security Response Protocol

If security issue found:
1. STOP immediately
2. Use **security-reviewer** agent
3. Fix CRITICAL issues before continuing
4. Rotate any exposed secrets
5. Review entire codebase for similar issues
