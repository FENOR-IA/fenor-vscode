---
paths:
  - "**/*.php"
  - "**/composer.lock"
  - "**/composer.json"
---
# PHP Security

> This file extends [common/security.md](../common/security.md) with PHP specific content.

## Input and Output

- Validate request input at the framework boundary (`FormRequest`, Symfony Validator, or explicit DTO validation).
- Escape output in templates by default; treat raw HTML rendering as an exception that must be justified.
- Never trust query params, cookies, headers, or uploaded file metadata without validation.

## Database Safety

- Use prepared statements (`PDO`, Doctrine, Eloquent query builder) for all dynamic queries.
- Avoid string-building SQL in controllers/views.
- Scope ORM mass-assignment carefully and whitelist writable fields.

## Secrets and Dependencies

- Load secrets from environment variables or a secret manager, never from committed config files.
- Before adding ANY new Composer package, run the full vetting checklist in
  [common/security.md](../common/security.md#dependency-vetting-mandatory-before-adding-any-external-package)
  / skill `dependency-vetting` — `composer audit` alone is not enough. In particular, check the
  candidate package's own `composer.json` for required PHP extensions (`ext-*`) before installing:
  on shared hosting where you don't control `php.ini`, a missing extension doesn't just break the
  one feature that needs it — Composer's generated `platform_check.php` fails the request at
  bootstrap for the whole app.
- Pin major versions deliberately and remove abandoned packages quickly.

## Auth and Session Safety

- Use `password_hash()` / `password_verify()` for password storage.
- Regenerate session identifiers after authentication and privilege changes.
- Enforce CSRF protection on state-changing web requests.

## Reference

See skill: `laravel-security` for Laravel-specific security guidance.
See skill: `dependency-vetting` before adding any new Composer package.
