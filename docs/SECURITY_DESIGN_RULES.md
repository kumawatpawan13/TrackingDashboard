# Security & Design Rules

This document contains the mandatory security hardening requirements and design system rules that must be followed for all new code. Review before any feature implementation.

---

## Security Hardening Requirements

### 1. Rate Limiting
Implement IP-based rate limiting on all `/api/*` endpoints:
- Login: 10 requests/60s window
- Setup: 5 requests/60s window  
- Recovery request: 5 requests/60s window
- Recovery verify: 10 requests/60s window
- Employee endpoints: 60 requests/60s window
- Payroll endpoints: 60 requests/60s window
- Travel endpoints: 30 requests/60s window
- Import/Backup: 5 requests/60s window
- Default: 120 requests/60s window

### 2. CAPTCHA Integration (Optional)
For login, setup, and recovery request endpoints:
- Accept optional `captcha_token` in request body
- Verify using Cloudflare Turnstile API when `CAPTCHA_SECRET_KEY` is configured
- If configured and no token provided, reject with 400

### 3. Security Headers (All API responses)
```javascript
Content-Security-Policy: "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:;"
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Cache-Control: no-store
```

### 4. CORS Lockdown
- Only allow requests from configured origin (e.g., production domain)
- Reject cross-origin requests with 403

### 5. Input Validation
- Use parameterized queries for all database operations
- Sanitize text inputs: strip control characters, trim, enforce max length
- Validate emails, dates, IDs against strict patterns
- Use helper functions: `requiredText()`, `optionalText()`, `numberValue()`, `optionalEmail()`

### 6. IDOR Protection (Check Resource Access)
For all self-service endpoints where employees access their own data:
```javascript
if (!await employeeIsInScope(db, user, resourceEmployeeId)) {
  return jsonError(c, 403, 'Access denied.');
}
```
When RBAC is enabled, enforce the assigned functional role and organization scope in both
single-record checks and list queries. Super Admin has company-wide access. HR Admin has
company-wide access to modules explicitly granted to that role. Finance has authorized financial
access; department, regional, and area managers are limited to their assigned scope; employees
can access their own records. Use `checkResourceAccess()` only for legacy installations where
RBAC is not enabled. Other employees' payslips, payroll dashboard totals, and payroll CSV exports
require Super Admin or Finance access; generic dashboard or report permissions do not grant payroll
access.

### 7. Audit Logging
Log all admin actions to `admin_audit_log` table:
- Create user
- Update user
- Reset password
- Delete user
- Update settings
- Approve travel
- Change payroll status

### 8. Session Security
- Session tokens: 32 random bytes, base64-encoded
- Duration: 7 days default, 30 days with rememberMe
- Cookie: `HttpOnly; SameSite=Strict; Path=/; Max-Age=<seconds>`
- Secure flag added in HTTPS context

### 9. Password Hashing
- Use PBKDF2-SHA256 with 210,000 iterations (manual HMAC implementation)
- Legacy 100,000 iteration hashes auto-upgrade on successful login
- Salt: 16 random bytes, base64-encoded

### 10. Error Handling
- Never expose raw errors to clients
- Use generic error messages for authentication failures
- Log detailed errors server-side only

### 11. Debug Mode
- Remove all debug console output in production
- Never return stack traces or internal errors to clients

---

## Design System Rules (Kinetic Minimalism + Bento Grid + Glassmorphism)

### Color Palette
- **Backgrounds**: Solid colors only, no gradients
  - Light: `--color-bg: #f8fafc`, `--color-bg-1: #ffffff`, `--color-bg-2: #f1f5f9`
  - Dark: `--color-bg: #0b1020`, `--color-bg-1: #111827`, `--color-bg-2: #0f172a`
- **Text**: `#111827` (light), `#f1f5f9` (dark)
- **Primary**: `--color-primary: #2563eb`
- **No purple gradients** - use solid blues/teals/emerald/grays

### Typography
- Font: Inter, system-ui, sans-serif
- Base size: 14px
- No emoji icons in text

### Buttons
- **Rectangular only**, max 6px border-radius
- **No pill shapes**
- No emoji in button text
- Classes: `.button`, `.button.primary`, `.button.ghost`, `.button.danger`
- Functional hover/focus transitions only (120ms)

### Layout
- **Bento Grid**: 4-column CSS grid for dashboard cards
- CSS Grid structure: sidebar (240px fixed width) + main content area
- Responsive: mobile-first, collapses to single column under 820px

### Glassmorphism
- **Modals only** use `backdrop-filter: blur(8px)`
- Background: semi-transparent black (rgba 0.5 opacity)
- Fade-in and slide-up animations (180ms)

### Visual Elements
- No decorative animations
- Motion only for functional purposes (hover states, transitions)
- Shadows: subtle (`0 1px 3px rgba(15, 23, 42, 0.06)`)
- No floating elements or 3D effects

### Spacing
- 6px radius max
- 16px base gap for grids
- 12px minimum line length for readability

---

## Implementation Checklist

Before committing code:

- [ ] Rate limiting applied to new API endpoints
- [ ] Security headers configured
- [ ] CORS properly restricted
- [ ] All queries parameterized
- [ ] Input validation added
- [ ] IDOR check if employee self-service access
- [ ] Audit logging if admin action
- [ ] No debug output in production code
- [ ] No purple gradients or pill buttons
- [ ] No emoji in UI or error messages
- [ ] Colors are solid, no gradients