import { Hono } from 'hono';
import {
  DEFAULT_SETTINGS,
  ATTENDANCE_CODES,
  calculatePayroll,
  daysInMonth,
  salarySlip,
  settingExamples,
  defaultAttendanceStatus,
  DEFAULT_TRAVEL_SETTINGS,
  travelAllowanceForDays,
  allowanceForDays,
  excelRound,
  haversineKm,
  travelAllowance
} from './calculator.js';

const app = new Hono();
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_DAYS = 7;
const REMEMBERED_SESSION_DAYS = 30;
const PASSWORD_HASH_ITERATIONS = 210_000;
const RECOVERY_CODE_TTL_MS = 10 * 60 * 1000;
const RECOVERY_RESEND_DELAY_MS = 60 * 1000;
const RECOVERY_MAX_ATTEMPTS = 5;
const ROLE_ORDER = { hr: 1, payroll: 2, employee: 3, admin: 4 };
const SETTING_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));
const TRAVEL_SETTINGS_KEYS = new Set(Object.keys(DEFAULT_TRAVEL_SETTINGS));
const EDITABLE_SETTING_KEYS = new Set(
  Object.keys(DEFAULT_SETTINGS).filter((key) => !['statutory_wage_pct', 'statutory_wage_addback'].includes(key))
);
const ACCESS_MODULES = new Set([
  'dashboard', 'employees', 'salary-revisions', 'payroll', 'attendance', 'leave-management',
  'holidays', 'shifts', 'field-tasks', 'sample-tracking', 'travel', 'route-playback',
  'expenses', 'customers', 'chemist-orders', 'reports', 'rule-settings', 'access-control'
]);
const ACCESS_ACTIONS = new Set(['view', 'create', 'edit', 'delete', 'approve', 'reject', 'export', 'manage']);

function jsonError(c, status, message) {
  return c.json({ error: message }, status);
}

// ============================================================
// SECURITY LAYER
// ============================================================

// Rate limiting: in-memory store keyed by IP + route. Cloudflare Workers
// isolates each isolate, so this resets on cold start. For production
// scale, replace with D1 or KV-backed counters.
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMITS = {
  '/api/login': { max: 10, windowMs: RATE_LIMIT_WINDOW_MS },
  '/api/setup': { max: 5, windowMs: RATE_LIMIT_WINDOW_MS },
  '/api/auth/recovery/request': { max: 5, windowMs: RATE_LIMIT_WINDOW_MS },
  '/api/auth/recovery/verify': { max: 10, windowMs: RATE_LIMIT_WINDOW_MS },
  '/api/employees': { max: 60, windowMs: RATE_LIMIT_WINDOW_MS },
  '/api/attendance': { max: 60, windowMs: RATE_LIMIT_WINDOW_MS },
  '/api/payroll': { max: 60, windowMs: RATE_LIMIT_WINDOW_MS },
  '/api/travel/punch': { max: 30, windowMs: RATE_LIMIT_WINDOW_MS },
  '/api/travel/route-points': { max: 30, windowMs: RATE_LIMIT_WINDOW_MS },
  '/api/orders': { max: 60, windowMs: RATE_LIMIT_WINDOW_MS },
  '/api/samples': { max: 60, windowMs: RATE_LIMIT_WINDOW_MS },
  '/api/tasks': { max: 60, windowMs: RATE_LIMIT_WINDOW_MS },
  '/api/backup/restore': { max: 5, windowMs: RATE_LIMIT_WINDOW_MS },
  '/api/import/workbook-json': { max: 5, windowMs: RATE_LIMIT_WINDOW_MS }
};
const DEFAULT_RATE_LIMIT = { max: 120, windowMs: RATE_LIMIT_WINDOW_MS };

function rateLimitKey(c) {
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  return `${ip}:${c.req.path}`;
}

function checkRateLimit(c) {
  const config = RATE_LIMITS[c.req.path] || DEFAULT_RATE_LIMIT;
  const key = rateLimitKey(c);
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || now - entry.windowStart > config.windowMs) {
    rateLimitStore.set(key, { windowStart: now, count: 1 });
    return true;
  }
  entry.count += 1;
  if (entry.count > config.max) {
    const retryAfter = Math.ceil((entry.windowStart + config.windowMs - now) / 1000);
    c.header('Retry-After', String(retryAfter));
    return false;
  }
  return true;
}

// Audit log: persists admin/manager actions for accountability.
async function auditLog(db, c, action, details = {}) {
  try {
    const user = c.get('user');
    if (!user) return;
    await db.prepare(
      'INSERT INTO travel_audit_log (id, emp_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(),
      user.employee_id || null,
      action,
      JSON.stringify({ role: user.role, ...details }),
      new Date().toISOString()
    ).run();
  } catch {
    // Audit logging must never break the request.
  }
}

// Admin action audit log - separate table for admin actions
async function adminAuditLog(db, c, action, targetType, targetId, details = {}) {
  try {
    const user = c.get('user');
    if (!user || user.role !== 'admin') return;
    await db.prepare(
      `INSERT INTO admin_audit_log (id, admin_user_id, admin_username, action, target_type, target_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      user.id,
      user.username,
      action,
      targetType,
      targetId || null,
      JSON.stringify(details),
      new Date().toISOString()
    ).run();
  } catch {
    // Audit logging must never break the request.
  }
}

// IDOR protection: verify user owns or has access to resource
function checkResourceAccess(user, resourceEmployeeId) {
  // Preserve account-role behavior only for installations without RBAC.
  if (['admin', 'hr', 'payroll'].includes(user.role)) return true;
  // Employee can only access their own data
  if (user.role === 'employee') return user.employee_id === resourceEmployeeId;
  return false;
}

async function canReadEmployeePayslip(db, user, employeeId) {
  if (user.access_control_enabled === undefined) return checkResourceAccess(user, employeeId);
  const roles = user.access_roles || await assignedAccessRoles(db, user.id);
  if (user.employee_id === employeeId) return true;
  return roles.includes('super_admin') || roles.includes('finance');
}

async function canRecordAttendancePunch(db, user, employeeId) {
  if (user.access_control_enabled === undefined) return checkResourceAccess(user, employeeId);
  const roles = user.access_roles || await assignedAccessRoles(db, user.id);
  if (roles.includes('super_admin') || roles.includes('hr_admin')) {
    return employeeIsInScope(db, user, employeeId);
  }
  return roles.includes('employee') && user.employee_id === employeeId;
}

async function hasPayrollAccess(db, user) {
  if (user.access_control_enabled === undefined) return ['admin', 'payroll'].includes(user.role);
  const roles = user.access_roles || await assignedAccessRoles(db, user.id);
  return roles.includes('super_admin') || roles.includes('finance');
}

// CAPTCHA verification placeholder - integrates with Cloudflare Turnstile or reCAPTCHA
async function verifyCaptcha(token, secretKey) {
  if (!token || !secretKey) return false;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: secretKey, response: token })
    });
    const result = await response.json();
    return result.success === true;
  } catch {
    return false;
  }
}

// Input sanitization: strip control characters and trim.
function sanitizeText(value, maxLength = 200) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

// Enum validation helper.
function requireEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} must be one of: ${allowed.join(', ')}.`);
  return value;
}

function isMonth(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  return Number(value.slice(0, 4)) >= 1900 && Number(value.slice(0, 4)) <= 2200;
}

function isIsoDate(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function numberValue(value, label, { minimum = 0, maximum = 1000000000 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function requiredText(value, label, maxLength = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`${label} is required and must be at most ${maxLength} characters.`);
  }
  return value.trim();
}

function optionalText(value, label, maxLength = 200) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`${label} must be at most ${maxLength} characters.`);
  }
  return value.trim();
}

function toBool(value, label) {
  if (value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'yes') return 1;
  if (value === false || value === 0 || value === '0' || String(value).toLowerCase() === 'no') return 0;
  throw new Error(`${label} must be yes or no.`);
}

function asEmployee(row) {
  return {
    ...row,
    pf_applicable: Boolean(row.pf_applicable),
    esic_applicable: Boolean(row.esic_applicable),
    active: Boolean(row.active)
  };
}

function readCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function pbkdf2Manual(password, saltBytes, iterations) {
  // RFC 2898 PBKDF2-HMAC-SHA256. Used only as a fallback when WebCrypto rejects
  // the requested iteration count (older Workers runtimes cap PBKDF2 at 100,000).
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);
  const hLen = 32;
  const keyLen = 32;
  const blockCount = Math.ceil(keyLen / hLen);
  const result = new Uint8Array(blockCount * hLen);
  const hmacKey = await crypto.subtle.importKey(
    'raw', passwordBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  for (let i = 1; i <= blockCount; i++) {
    const blockNum = new Uint8Array(4);
    blockNum[0] = (i >>> 24) & 0xff;
    blockNum[1] = (i >>> 16) & 0xff;
    blockNum[2] = (i >>> 8) & 0xff;
    blockNum[3] = i & 0xff;
    const firstInput = new Uint8Array(saltBytes.length + 4);
    firstInput.set(saltBytes, 0);
    firstInput.set(blockNum, saltBytes.length);
    let u = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, firstInput));
    const t = new Uint8Array(u);
    for (let j = 1; j < iterations; j++) {
      u = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, u));
      for (let k = 0; k < hLen; k++) t[k] ^= u[k];
    }
    result.set(t, (i - 1) * hLen);
  }
  return result;
}

async function passwordHash(password, salt, iterations = PASSWORD_HASH_ITERATIONS, { decodeSalt = true } = {}) {
  const encoder = new TextEncoder();
  // Salt is stored as base64 in the DB. Decode it; if it's already raw bytes, fall back to encoding.
  // Legacy hashes were created with the raw base64 salt string as bytes (not decoded), so the
  // login route can still verify them when decodeSalt is false.
  let saltBytes;
  if (decodeSalt) {
    try {
      saltBytes = Uint8Array.from(atob(salt), c => c.charCodeAt(0));
    } catch {
      saltBytes = encoder.encode(salt);
    }
  } else {
    saltBytes = encoder.encode(salt);
  }

  // WebCrypto PBKDF2 is the fast path (verified byte-identical to pbkdf2Manual).
  // Older Workers runtimes cap PBKDF2 at 100,000 iterations and throw NotSupportedError;
  // fall back to the manual implementation rather than rejecting the request.
  try {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, key, 256
    );
    return toBase64(new Uint8Array(bits));
  } catch {
    return toBase64(await pbkdf2Manual(password, saltBytes, iterations));
  }
}

function optionalEmail(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 254) throw new Error('Recovery email is invalid.');
  const email = value.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Recovery email is invalid.');
  }
  return email;
}

async function recoveryCodeHash(userId, salt, code, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${userId}:${salt}:${code}`)
  );
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function findAccount(db, identifier) {
  const idLower = identifier.toLowerCase();
  return db.prepare(
    `SELECT u.id, u.username, u.role, u.employee_id, u.password_salt, u.password_hash, u.is_active
     FROM users u
     LEFT JOIN employees e ON e.id = u.employee_id
     WHERE u.is_active = 1 AND (u.username = ?
        OR LOWER(u.employee_id) = ?
        OR LOWER(e.email) = ?)
     ORDER BY CASE
       WHEN u.username = ? THEN 0
       WHEN LOWER(u.employee_id) = ? THEN 1
       ELSE 2
     END
     LIMIT 1`
  ).bind(identifier, idLower, idLower, identifier, idLower).first();
}

async function findRecoveryAccount(db, identifier) {
  return db.prepare(
    `SELECT users.id, users.recovery_email,
            COALESCE(NULLIF(employees.email, ''), '') AS employee_email
     FROM users
     LEFT JOIN employees ON employees.id = users.employee_id
     WHERE users.username = ?
        OR users.employee_id = ? COLLATE NOCASE
        OR users.recovery_email = ? COLLATE NOCASE
        OR employees.email = ? COLLATE NOCASE
     ORDER BY CASE
       WHEN users.username = ? THEN 0
       WHEN users.employee_id = ? COLLATE NOCASE THEN 1
       ELSE 2
     END
     LIMIT 1`
  ).bind(identifier, identifier, identifier, identifier, identifier, identifier).first();
}

async function findRecoveryUser(db, identifier) {
  return db.prepare(
    `SELECT users.id, users.username, users.role, users.employee_id,
            users.password_salt, users.password_hash
     FROM users
     LEFT JOIN employees ON employees.id = users.employee_id
     WHERE users.username = ?
        OR users.employee_id = ? COLLATE NOCASE
        OR users.recovery_email = ? COLLATE NOCASE
        OR employees.email = ? COLLATE NOCASE
     ORDER BY CASE
       WHEN users.username = ? THEN 0
       WHEN users.employee_id = ? COLLATE NOCASE THEN 1
       ELSE 2
     END
     LIMIT 1`
  ).bind(identifier, identifier, identifier, identifier, identifier, identifier).first();
}

const APPROVAL_WORKFLOW_TYPES = new Set(['expense', 'attendance']);

function approvalStepMatchesAmount(level, amount) {
  const value = Number(amount || 0);
  return (level.minimum_amount === null || level.minimum_amount === undefined || value >= Number(level.minimum_amount))
    && (level.maximum_amount === null || level.maximum_amount === undefined || value <= Number(level.maximum_amount));
}

async function activeApprovalWorkflow(db, requestType, amount = 0) {
  const workflow = await db.prepare(
    'SELECT * FROM approval_workflows WHERE request_type = ? AND is_active = 1'
  ).bind(requestType).first();
  if (!workflow) return null;

  const result = await db.prepare(
    'SELECT * FROM approval_workflow_levels WHERE workflow_id = ? ORDER BY order_index DESC'
  ).bind(workflow.id).all();
  const levels = (result.results || []).filter((level) => approvalStepMatchesAmount(level, amount));
  return {
    workflow,
    levels,
    firstApprovalLevel: levels.find((level) => !level.auto_approve)
  };
}

async function addExpenseApprovalChains(db, expenses) {
  const workflows = await db.prepare(`
    SELECT w.id AS workflow_id, l.id, l.order_index, l.level_name, l.role_required,
           l.designation_required, l.min_hierarchy_level, l.auto_approve
    FROM approval_workflows w
    JOIN approval_workflow_levels l ON l.workflow_id = w.id
    WHERE w.request_type = 'expense'
    ORDER BY l.order_index DESC
  `).all();
  const levelsByWorkflow = new Map();
  for (const level of workflows.results || []) {
    const levels = levelsByWorkflow.get(level.workflow_id) || [];
    levels.push(level);
    levelsByWorkflow.set(level.workflow_id, levels);
  }
  return expenses.map((expense) => ({
    ...expense,
    approval_chain: levelsByWorkflow.get(expense.approval_workflow_id) || []
  }));
}

function nextApprovalLevel(levels, currentOrderIndex, amount = 0) {
  return levels.find((level) => Number(level.order_index) < Number(currentOrderIndex)
    && !level.auto_approve && approvalStepMatchesAmount(level, amount)) || null;
}

async function canApproveWorkflowLevel(db, user, level, approverEmployee = undefined, targetEmployeeId = null) {
  if (user.role === 'admin' && !user.access_control_enabled) return true;
  const roleAliases = { admin: 'super_admin', hr: 'hr_admin', payroll: 'finance', employee: 'employee' };
  const assigned = user.access_roles || await assignedAccessRoles(db, user.id);
  if (assigned.includes('super_admin')) return true;
  if (level.role_required) {
    if (!assigned.includes(level.role_required) && roleAliases[user.role] !== level.role_required
      && level.role_required !== user.role) return false;
  }
  let employee = approverEmployee;
  if ((level.designation_required || level.min_hierarchy_level !== null && level.min_hierarchy_level !== undefined
    || level.approver_source === 'reporting_manager') && employee === undefined) {
    employee = user.employee_id ? await db.prepare(
      'SELECT id, designation, hierarchy_level, reports_to FROM employees WHERE id = ? AND active = 1'
    ).bind(user.employee_id).first() : null;
  }
  if (level.approver_source === 'reporting_manager') {
    const target = targetEmployeeId ? await db.prepare(
      'SELECT reports_to FROM employees WHERE id = ? AND active = 1'
    ).bind(targetEmployeeId).first() : null;
    if (!employee || !target || target.reports_to !== employee.id) return false;
  }
  if (level.designation_required) {
    if (!employee || String(employee.designation || '').toLowerCase() !== String(level.designation_required).toLowerCase()) return false;
  }
  if (level.min_hierarchy_level !== null && level.min_hierarchy_level !== undefined) {
    if (!employee || Number(employee.hierarchy_level) > Number(level.min_hierarchy_level)) return false;
  }
  if (targetEmployeeId && user.access_control_enabled !== undefined) {
    const assigned = user.access_roles || await assignedAccessRoles(db, user.id);
    const financialApprover = assigned.includes('finance')
      && (['finance', 'payroll'].includes(level.role_required)
        || /finance/i.test(level.level_name || '')
        || /finance/i.test(level.designation_required || ''));
    if (!financialApprover && !await canAccessEmployee(db, user, targetEmployeeId)) return false;
  }
  if (user.employee_id && (level.designation_required || level.min_hierarchy_level !== null && level.min_hierarchy_level !== undefined)) {
    if (!user.employee_id || !targetEmployeeId || user.employee_id === targetEmployeeId) return false;
    const report = await db.prepare(`
      WITH RECURSIVE report_tree AS (
        SELECT id FROM employees WHERE id = ?
        UNION
        SELECT e.id FROM employees e JOIN report_tree rt ON e.reports_to = rt.id
      )
      SELECT id FROM report_tree WHERE id = ?
    `).bind(user.employee_id, targetEmployeeId).first();
    if (!report) return false;
  }
  return Boolean(
    level.role_required
    || level.designation_required
    || level.min_hierarchy_level !== null && level.min_hierarchy_level !== undefined
    || level.approver_source === 'reporting_manager'
  );
}

async function readJson(c, limit = 2_000_000) {
  const length = Number(c.req.header('content-length') || 0);
  if (length > limit) throw new Error('Request body is too large.');
  const text = await c.req.text();
  if (new TextEncoder().encode(text).byteLength > limit) throw new Error('Request body is too large.');
  return JSON.parse(text);
}

async function settingsFromDb(db) {
  const result = await db.prepare('SELECT setting_key, setting_value FROM payroll_settings').all();
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(result.results.map((row) => [row.setting_key, Number(row.setting_value)])) };
}

async function travelSettingsFromDb(db) {
  const result = await db.prepare('SELECT setting_key, setting_value FROM travel_settings').all();
  return { ...DEFAULT_TRAVEL_SETTINGS, ...Object.fromEntries(result.results.map((row) => [row.setting_key, Number(row.setting_value)])) };
}

function requireRoles(...roles) {
  return async (c, next) => {
    const user = c.get('user');
    if (!user || user.is_active === 0) return jsonError(c, 403, 'You do not have permission to access this resource.');
    if (user.access_control_enabled !== undefined) {
      const needsSuperAdmin = c.req.path.startsWith('/api/users')
        || c.req.path.startsWith('/api/access/roles')
        || c.req.path.startsWith('/api/access/users')
        || c.req.path.startsWith('/api/access/audit')
        || c.req.path.startsWith('/api/backup')
        || c.req.path.startsWith('/api/import');
      if (needsSuperAdmin && !await hasAccessRole(c.env.DB, user.id, 'super_admin')) {
        return jsonError(c, 403, 'Super Admin access is required for this operation.');
      }
      const requirement = await accessRequirement(c.req.method, c.req.path, c.req.raw.clone());
      const approvalSummaryAllowed = c.req.path.startsWith('/api/approvals/') && (
        await hasAccessPermission(c.env.DB, user.id, 'attendance', 'view')
        || await hasAccessPermission(c.env.DB, user.id, 'attendance', 'approve')
        || await hasAccessPermission(c.env.DB, user.id, 'attendance', 'reject')
        || await hasAccessPermission(c.env.DB, user.id, 'expenses', 'view')
        || await hasAccessPermission(c.env.DB, user.id, 'expenses', 'approve')
        || await hasAccessPermission(c.env.DB, user.id, 'expenses', 'reject')
        || await hasAccessPermission(c.env.DB, user.id, 'leave-management', 'view')
        || await hasAccessPermission(c.env.DB, user.id, 'leave-management', 'approve')
        || await hasAccessPermission(c.env.DB, user.id, 'leave-management', 'reject')
      );
      const allowed = approvalSummaryAllowed || (requirement
        ? await hasAccessPermission(c.env.DB, user.id, requirement.module, requirement.action)
        : false);
      if (!allowed) return jsonError(c, 403, 'You do not have permission to access this resource.');
      if (['payroll', 'salary-revisions'].includes(requirement?.module)
        && !await hasPayrollAccess(c.env.DB, user)) {
        return jsonError(c, 403, 'Finance access is required for payroll records.');
      }
      if (c.req.path.startsWith('/api/employees/') || c.req.path.startsWith('/api/employee-detail/')
        || c.req.path.startsWith('/api/manager/employee/')) {
        const employeeId = c.req.param('employee_id') || c.req.param('id');
        if (employeeId && !await canAccessEmployee(c.env.DB, user, employeeId, {
          financial: /salary|salary-attendance|salary-revisions/.test(c.req.path)
        })) {
          return jsonError(c, 403, 'You do not have access to this employee record.');
        }
      }
    } else if (!roles.includes(user.role)) {
      return jsonError(c, 403, 'You do not have permission to access this resource.');
    }
    await next();
  };
}

function accessRequirement(method, path, request) {
  const module = path === '/api/employee/slip' || path.startsWith('/api/access/organization') ? 'employees'
    : path.startsWith('/api/travel/expense-bills') ? 'expenses'
      : path.startsWith('/api/travel/punch') ? 'attendance'
    : path === '/api/slip' ? 'payroll'
    : path.startsWith('/api/reports/') ? 'reports'
    : path.startsWith('/api/access/') || path.startsWith('/api/users') ? 'access-control'
      : path.startsWith('/api/employee/attendance') ? 'attendance'
        : path.startsWith('/api/employee/travel') ? 'travel'
          : path.startsWith('/api/employee/route-playback') ? 'travel'
            : path.startsWith('/api/visits/') && path.endsWith('/attend') ? 'attendance'
              : path.startsWith('/api/manager/employee/') ? 'employees'
                : path === '/api/map/tile' ? 'travel'
                  : path === '/api/user/preferences' ? 'dashboard'
                    : path.startsWith('/api/approvals/') ? null
      : path.startsWith('/api/approval-workflows') ? 'rule-settings'
        : path.startsWith('/api/dashboard') ? 'dashboard'
          : path.startsWith('/api/employees') || path.startsWith('/api/employee-detail') || path.startsWith('/api/hierarchy') ? 'employees'
            : path.startsWith('/api/revisions') ? 'salary-revisions'
              : path.startsWith('/api/payroll') ? 'payroll'
                : path.startsWith('/api/attendance') ? 'attendance'
                  : path.startsWith('/api/leave') ? 'leave-management'
                    : path.startsWith('/api/holidays') ? 'holidays'
                      : path.startsWith('/api/shifts') || path.startsWith('/api/employee-shifts') ? 'shifts'
                        : path.startsWith('/api/tasks') ? 'field-tasks'
                          : path.startsWith('/api/samples') ? 'sample-tracking'
                            : path.startsWith('/api/expenses') || path.includes('/expense-') ? 'expenses'
                              : path.startsWith('/api/travel/customers') || path.startsWith('/api/customers') ? 'customers'
                                : path.startsWith('/api/orders') || path.startsWith('/api/products') ? 'chemist-orders'
                                  : path.startsWith('/api/travel/route-points') || path.includes('route-playback') ? 'route-playback'
                                    : path.startsWith('/api/travel') ? 'travel'
                                      : path.startsWith('/api/settings') || path.startsWith('/api/company-settings') ? 'rule-settings'
                                        : path.startsWith('/api/backup') || path.startsWith('/api/import') ? 'access-control'
                                          : null;
  if (!module) return null;

  let action = method === 'GET' ? (path.endsWith('.csv') ? 'export' : 'view')
    : method === 'POST' ? 'create'
      : method === 'DELETE' ? 'delete'
        : 'edit';

  if (path.includes('/approve')) {
    action = 'approve';
    if (request) {
      return request.json().then((body) => ({
        module,
        action: body.action === 'rejected' ? 'reject' : 'approve'
      })).catch(() => ({ module, action }));
    }
  } else if (path.startsWith('/api/leave-requests/') && method === 'PUT' && request) {
    return request.json().then((body) => ({
      module,
      action: body.status === 'rejected' ? 'reject' : body.status === 'approved' ? 'approve' : 'edit'
    })).catch(() => ({ module, action }));
  } else if (path.endsWith('/status') || path.endsWith('/levels')
    || path.startsWith('/api/access/roles') || path.startsWith('/api/access/users') || path.startsWith('/api/access/audit')) {
    action = 'manage';
  } else if (path.endsWith('/pay')) {
    action = 'approve';
  }
  if (path.startsWith('/api/access/organization')) action = method === 'GET' ? 'view' : 'edit';
  return { module, action };
}

async function hasAccessPermission(db, userId, module, action) {
  return Boolean(await db.prepare(`
    SELECT 1
    FROM user_access_roles assignment
    JOIN access_roles role ON role.id = assignment.role_id AND role.is_active = 1
    JOIN access_role_permissions permission ON permission.role_id = role.id
    WHERE assignment.user_id = ? AND permission.module_key = ?
      AND permission.action_key IN (?, 'manage')
    LIMIT 1
  `).bind(userId, module, action).first());
}

async function assignedAccessRoles(db, userId) {
  const result = await db.prepare(`
    SELECT role.code
    FROM user_access_roles assignment
    JOIN access_roles role ON role.id = assignment.role_id
    WHERE assignment.user_id = ? AND role.is_active = 1
  `).bind(userId).all();
  return (result.results || []).map((row) => row.code);
}

async function assignedAccessPermissions(db, userId) {
  const result = await db.prepare(`
    SELECT DISTINCT permission.module_key, permission.action_key
    FROM user_access_roles assignment
    JOIN access_roles role ON role.id = assignment.role_id AND role.is_active = 1
    JOIN access_role_permissions permission ON permission.role_id = role.id
    WHERE assignment.user_id = ?
  `).bind(userId).all();
  return (result.results || []).reduce((permissions, row) => {
    if (!row.module_key || !row.action_key) return permissions;
    permissions[row.module_key] ||= [];
    if (!permissions[row.module_key].includes(row.action_key)) permissions[row.module_key].push(row.action_key);
    return permissions;
  }, {});
}

async function selfServiceOnly(db, user) {
  if (user.access_control_enabled === undefined) return user.role === 'employee';
  const roles = user.access_roles || await assignedAccessRoles(db, user.id);
  return roles.includes('employee')
    && !['department_head', 'regional_manager', 'area_manager', 'hr_admin', 'super_admin', 'finance']
      .some((role) => roles.includes(role));
}

async function hasAccessRole(db, userId, roleCode) {
  return Boolean(await db.prepare(`
    SELECT 1 FROM user_access_roles assignment
    JOIN access_roles role ON role.id = assignment.role_id AND role.is_active = 1
    WHERE assignment.user_id = ? AND role.code = ? LIMIT 1
  `).bind(userId, roleCode).first());
}

async function canAccessEmployee(db, user, employeeId, { financial = false } = {}) {
  if (!employeeId) return false;
  if (user.access_control_enabled === undefined) return checkResourceAccess(user, employeeId);
  const roles = await assignedAccessRoles(db, user.id);
  if (roles.includes('super_admin') || (financial && roles.includes('finance'))
    || (!financial && roles.includes('hr_admin'))) return true;
  if (roles.includes('employee') && !['department_head', 'regional_manager', 'area_manager'].some((role) => roles.includes(role))) {
    return user.employee_id === employeeId;
  }

  const [actor, target] = await Promise.all([
    user.employee_id
      ? db.prepare('SELECT department, region, area FROM employees WHERE id = ? AND active = 1')
        .bind(user.employee_id).first()
      : null,
    db.prepare('SELECT id, department, region, area FROM employees WHERE id = ? AND active = 1')
      .bind(employeeId).first()
  ]);
  if (!actor || !target) return false;

  if (roles.includes('department_head') && actor.department
    && actor.department === target.department) return true;
  if (roles.includes('regional_manager') && actor.region
    && actor.region === target.region) return true;
  if (roles.includes('area_manager') && actor.area
    && actor.area === target.area && actor.region
    && actor.region === target.region) return true;

  if (!['department_head', 'regional_manager', 'area_manager']
    .some((role) => roles.includes(role))) return false;

  const reports = await db.prepare(`
    WITH RECURSIVE reports(id) AS (
      SELECT id FROM employees WHERE reports_to = ?
      UNION
      SELECT employee.id FROM employees employee JOIN reports ON employee.reports_to = reports.id
    )
    SELECT 1 FROM reports WHERE id = ? LIMIT 1
  `).bind(user.employee_id, employeeId).first();
  return Boolean(reports);
}

async function employeeScopePredicate(db, user, alias = 'employees', { financial = false } = {}) {
  if (user.access_control_enabled === undefined) return { sql: '1 = 1', bindings: [] };
  const roles = await assignedAccessRoles(db, user.id);
  if (roles.includes('super_admin') || roles.includes('hr_admin')
    || (financial && roles.includes('finance'))) {
    return { sql: '1 = 1', bindings: [] };
  }
  if (roles.includes('employee') && !['department_head', 'regional_manager', 'area_manager'].some((role) => roles.includes(role))) {
    return { sql: `${alias}.id = ?`, bindings: [user.employee_id || ''] };
  }
  if (!['department_head', 'regional_manager', 'area_manager']
    .some((role) => roles.includes(role))) {
    return { sql: '0 = 1', bindings: [] };
  }
  const predicates = [];
  const bindings = [];
  const actor = user.employee_id
    ? await db.prepare('SELECT department, region, area FROM employees WHERE id = ? AND active = 1')
      .bind(user.employee_id).first()
    : null;
  if (actor) {
    if (roles.includes('department_head') && actor.department) {
      predicates.push(`${alias}.department = ?`);
      bindings.push(actor.department);
    }
    if (roles.includes('regional_manager') && actor.region) {
      predicates.push(`${alias}.region = ?`);
      bindings.push(actor.region);
    }
    if (roles.includes('area_manager') && actor.area && actor.region) {
      predicates.push(`(${alias}.area = ? AND ${alias}.region = ?)`);
      bindings.push(actor.area, actor.region);
    }
    predicates.push(`${alias}.id IN (
      WITH RECURSIVE reports(id) AS (
        SELECT id FROM employees WHERE reports_to = ?
        UNION
        SELECT employee.id FROM employees employee JOIN reports ON employee.reports_to = reports.id
      )
      SELECT id FROM reports
    )`);
    bindings.push(user.employee_id);
  }
  return {
    sql: predicates.length ? `(${predicates.join(' OR ')})` : '0 = 1',
    bindings
  };
}

async function employeeIsInScope(db, user, employeeId, { financial = false } = {}) {
  if (!employeeId) return false;
  if (user.access_control_enabled === undefined) return checkResourceAccess(user, employeeId);

  const roles = user.access_roles || await assignedAccessRoles(db, user.id);
  if (roles.includes('super_admin') || roles.includes('hr_admin')
    || (financial && roles.includes('finance'))) {
    return Boolean(await db.prepare(
      'SELECT id FROM employees WHERE id = ? AND active = 1'
    ).bind(employeeId).first());
  }
  return canAccessEmployee(db, user, employeeId);
}

function withoutSensitiveEmployeeFields(employee) {
  if (!employee) return employee;
  const {
    monthly_ctc, pf_applicable, esic_applicable, pan, uan, esic_number, email,
    bank_account, ifsc, ...safe
  } = employee;
  return safe;
}

async function appendAccessAudit(db, user, action, targetType, targetId, oldValues, newValues) {
  await db.prepare(`
    INSERT INTO access_audit_log
      (id, actor_user_id, actor_username, action, target_type, target_id, old_values, new_values)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), user.id, user.username, action, targetType, targetId || null,
    oldValues === null ? null : JSON.stringify(oldValues),
    newValues === null ? null : JSON.stringify(newValues)
  ).run();
}

app.use('/api/*', async (c, next) => {
  // Security Headers
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' https://unpkg.com https://fonts.googleapis.com 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://tile.openstreetmap.org https://staticmap.openstreetmap.org https://server.arcgisonline.com;");
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Cache-Control', 'no-store');

  // Lock down CORS — allow same-origin, prod, dev and localhost
  const origin = c.req.header('Origin') || '';
  const allowedOrigins = [
    'https://salary-slip-automation.salarystatus.workers.dev',
    'https://salary-slip-automation-dev.salarystatus.workers.dev',
    'http://localhost:8787',
    'http://127.0.0.1:8787',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ];
  if (origin && !allowedOrigins.includes(origin)) {
    return jsonError(c, 403, 'Cross-origin requests are not allowed.');
  }

  // Rate Limiting
  if (!checkRateLimit(c)) {
    return jsonError(c, 429, 'Too many requests. Please try again later.');
  }

  const token = readCookie(c.req.raw, 'salary_session');
  if (token) {
    const session = await c.env.DB.prepare(
      `SELECT users.id, users.username, users.role, users.employee_id, users.is_active,
              1 AS access_control_enabled
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.is_active = 1`
    ).bind(await digest(token), Date.now()).first();
    if (session) {
      session.access_roles = await assignedAccessRoles(c.env.DB, session.id);
      session.access_permissions = await assignedAccessPermissions(c.env.DB, session.id);
      c.set('user', session);
    }
  }
  await next();
});

app.get('/api/session', async (c) => {
  const userCount = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM users').first();
  return c.json({
    user: c.get('user') || null,
    needsSetup: Number(userCount?.count ?? 0) === 0
  });
});

app.post('/api/setup', async (c) => {
  let body;
  try {
    body = await readJson(c);
    const count = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM users').first();
    if (Number(count.count) !== 0) return jsonError(c, 409, 'Initial setup has already been completed.');
    const username = requiredText(body.username, 'Username', 80);
    const password = requiredText(body.password, 'Password', 200);
    if (password.length < 12) return jsonError(c, 400, 'Password must be at least 12 characters.');
    const recoveryEmail = optionalEmail(body.recovery_email);

    // CAPTCHA verification (optional if not configured)
    if (c.env.CAPTCHA_SECRET_KEY && body.captcha_token) {
      const captchaValid = await verifyCaptcha(body.captcha_token, c.env.CAPTCHA_SECRET_KEY);
      if (!captchaValid) return jsonError(c, 400, 'CAPTCHA verification failed.');
    }

    const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
    const userId = crypto.randomUUID();
    await c.env.DB.prepare(
      'INSERT INTO users (id, username, password_salt, password_hash, role, recovery_email) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(userId, username, salt, await passwordHash(password, salt), 'admin', recoveryEmail).run();
    await c.env.DB.prepare(
      'INSERT INTO user_access_roles (user_id, role_id) VALUES (?, ?)'
    ).bind(userId, 'role-super-admin').run();
    return await createSession(c, userId, username, 'admin');
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to initialize the application.');
  }
});

app.post('/api/login', async (c) => {
  let identifier;
  let password;
  let rememberMe;
  try {
    const body = await readJson(c, 20_000);
    identifier = requiredText(body.identifier ?? body.username, 'Username or employee ID', 80);
    password = requiredText(body.password, 'Password', 200);
    rememberMe = body.rememberMe === true;

    // CAPTCHA verification (optional if not configured)
    if (c.env.CAPTCHA_SECRET_KEY && body.captcha_token) {
      const captchaValid = await verifyCaptcha(body.captcha_token, c.env.CAPTCHA_SECRET_KEY);
      if (!captchaValid) return jsonError(c, 400, 'CAPTCHA verification failed.');
    }
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to sign in.');
  }

  try {
    const user = await findAccount(c.env.DB, identifier);
    if (!user) {
      return jsonError(c, 401, 'Invalid username or password.');
    }
    const currentHash = await passwordHash(password, user.password_salt);
    if (currentHash !== user.password_hash) {
      // Legacy hashes: 100,000 iterations and/or the raw base64 salt string as bytes.
      const legacyHash = await passwordHash(password, user.password_salt, 100_000);
      const legacyRawSaltHash = await passwordHash(password, user.password_salt, 100_000, { decodeSalt: false });
      if (legacyHash !== user.password_hash && legacyRawSaltHash !== user.password_hash) {
        return jsonError(c, 401, 'Invalid username or password.');
      }

      const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
      const upgradedHash = await passwordHash(password, salt);
      await c.env.DB.prepare(
        'UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?'
      ).bind(salt, upgradedHash, user.id).run();
    }
    return await createSession(c, user.id, user.username, user.role, user.employee_id, rememberMe);
  } catch (error) {
    console.error('Login request failed', error);
    return jsonError(c, 500, 'Sign-in is temporarily unavailable. Please try again or contact your administrator.');
  }
});

app.post('/api/auth/recovery/request', async (c) => {
  const genericResponse = {
    message: 'If an account matches and has a recovery email, a verification code will be sent.'
  };
  let identifier;
  try {
    const body = await readJson(c, 20_000);
    identifier = requiredText(body.identifier, 'Username, employee ID, or recovery email', 254);

    // CAPTCHA verification (optional if not configured)
    if (c.env.CAPTCHA_SECRET_KEY && body.captcha_token) {
      const captchaValid = await verifyCaptcha(body.captcha_token, c.env.CAPTCHA_SECRET_KEY);
      if (!captchaValid) return jsonError(c, 400, 'CAPTCHA verification failed.');
    }
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to request password recovery.');
  }

  try {
    const user = await findRecoveryUser(c.env.DB, identifier);
    const email = user?.recovery_email || user?.employee_email;
    if (!user || !email) return c.json(genericResponse);

    if (!c.env.RESEND_API_KEY || !c.env.AUTH_EMAIL_FROM || !c.env.AUTH_OTP_SECRET) {
      console.error('Password recovery email is not configured.');
      return c.json(genericResponse);
    }

    const previous = await c.env.DB.prepare(
      'SELECT last_sent_at FROM auth_recovery_challenges WHERE user_id = ?'
    ).bind(user.id).first();
    if (previous && Date.now() - Number(previous.last_sent_at) < RECOVERY_RESEND_DELAY_MS) {
      return c.json(genericResponse);
    }

    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
    const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
    const codeHash = await recoveryCodeHash(user.id, salt, code, c.env.AUTH_OTP_SECRET);
    const now = Date.now();
    const savedChallenge = await c.env.DB.prepare(
      `INSERT INTO auth_recovery_challenges (user_id, salt, code_hash, attempts, expires_at, last_sent_at)
       VALUES (?, ?, ?, 0, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET salt = excluded.salt, code_hash = excluded.code_hash,
       attempts = 0, expires_at = excluded.expires_at, last_sent_at = excluded.last_sent_at
       WHERE auth_recovery_challenges.last_sent_at <= ?`
    ).bind(user.id, salt, codeHash, now + RECOVERY_CODE_TTL_MS, now, now - RECOVERY_RESEND_DELAY_MS).run();
    if (!savedChallenge.meta.changes) return c.json(genericResponse);

    let response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: c.env.AUTH_EMAIL_FROM,
          to: [email],
          subject: 'Salary Desk password reset code',
          text: `Your Salary Desk password reset code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`
        })
      });
    } catch (error) {
      console.error('Password recovery email delivery failed', error);
      await c.env.DB.prepare('DELETE FROM auth_recovery_challenges WHERE user_id = ?')
        .bind(user.id).run();
      return c.json(genericResponse);
    }
    if (!response.ok) {
      console.error('Password recovery email delivery failed', { status: response.status });
      await c.env.DB.prepare('DELETE FROM auth_recovery_challenges WHERE user_id = ?')
        .bind(user.id).run();
    }
    return c.json(genericResponse);
  } catch (error) {
    console.error('Password recovery request failed', error);
    return c.json(genericResponse);
  }
});

app.post('/api/auth/recovery/verify', async (c) => {
  let identifier;
  let code;
  let password;
  try {
    const body = await readJson(c, 20_000);
    identifier = requiredText(body.identifier, 'Username, employee ID, or recovery email', 254);
    code = requiredText(body.code, 'Verification code', 6);
    password = requiredText(body.password, 'Password', 200);
    if (!/^\d{6}$/.test(code)) throw new Error('Verification code must contain six digits.');
    if (password.length < 12) throw new Error('Password must be at least 12 characters.');
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to reset password.');
  }

  try {
    const user = await findRecoveryAccount(c.env.DB, identifier);
    if (!user || !c.env.AUTH_OTP_SECRET) {
      return jsonError(c, 400, 'The verification code is invalid or expired.');
    }
    const challenge = await c.env.DB.prepare(
      'SELECT salt, code_hash, attempts, expires_at FROM auth_recovery_challenges WHERE user_id = ?'
    ).bind(user.id).first();
    if (!challenge || Number(challenge.expires_at) <= Date.now() || Number(challenge.attempts) >= RECOVERY_MAX_ATTEMPTS) {
      return jsonError(c, 400, 'The verification code is invalid or expired.');
    }

    const attempt = await c.env.DB.prepare(
      `UPDATE auth_recovery_challenges SET attempts = attempts + 1
       WHERE user_id = ? AND expires_at > ? AND attempts < ?`
    ).bind(user.id, Date.now(), RECOVERY_MAX_ATTEMPTS).run();
    if (!attempt.meta.changes) {
      return jsonError(c, 400, 'The verification code is invalid or expired.');
    }

    const submittedHash = await recoveryCodeHash(user.id, challenge.salt, code, c.env.AUTH_OTP_SECRET);
    if (!constantTimeEqual(submittedHash, challenge.code_hash)) {
      return jsonError(c, 400, 'The verification code is invalid or expired.');
    }

    const consumed = await c.env.DB.prepare(
      'DELETE FROM auth_recovery_challenges WHERE user_id = ? AND code_hash = ?'
    ).bind(user.id, challenge.code_hash).run();
    if (!consumed.meta.changes) {
      return jsonError(c, 400, 'The verification code is invalid or expired.');
    }

    const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await passwordHash(password, salt);
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?')
        .bind(salt, hash, user.id),
      c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id)
    ]);
    return c.json({ ok: true });
  } catch (error) {
    console.error('Password recovery verification failed', error);
    return jsonError(c, 500, 'Password reset is temporarily unavailable. Please try again or contact your administrator.');
  }
});

async function createSession(c, userId, username, role, employeeId = null, rememberMe = false) {
  const token = toBase64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const sessionDays = rememberMe ? REMEMBERED_SESSION_DAYS : SESSION_DAYS;
  const expiry = Date.now() + sessionDays * DAY_MS;
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Date.now()),
    c.env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(await digest(token), userId, expiry)
  ]);
  const secure = new URL(c.req.url).protocol === 'https:' ? '; Secure' : '';
  c.header('Set-Cookie', `salary_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionDays * 86400}${secure}`);
  const user = { id: userId, username, role };
  if (employeeId) user.employee_id = employeeId;
  user.access_roles = await assignedAccessRoles(c.env.DB, userId);
  user.access_permissions = await assignedAccessPermissions(c.env.DB, userId);
  return c.json({ user, needsSetup: false });
}

app.post('/api/logout', async (c) => {
  const token = readCookie(c.req.raw, 'salary_session');
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await digest(token)).run();
  c.header('Set-Cookie', 'salary_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  return c.json({ ok: true });
});

app.get('/api/dashboard', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  const user = c.get('user');
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7);
  if (!isMonth(month)) return jsonError(c, 400, 'Month must use YYYY-MM format.');
  const scope = await employeeScopePredicate(c.env.DB, user, 'employees');
  const employeeCount = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM employees WHERE active = 1 AND ${scope.sql}`
  ).bind(...scope.bindings).first();
  const attendanceRows = await c.env.DB.prepare(
    `SELECT attendance_days.status, COUNT(*) AS count FROM attendance_days
     JOIN employees ON employees.id = attendance_days.employee_id
     WHERE attendance_days.work_date >= ? AND attendance_days.work_date <= ?
       AND ${scope.sql}
     GROUP BY attendance_days.status`
  ).bind(`${month}-01`, `${month}-${String(daysInMonth(month)).padStart(2, '0')}`, ...scope.bindings).all();
  const attendance = Object.fromEntries(attendanceRows.results.map((row) => [row.status, Number(row.count)]));
  let payrollTotal = null;
  if (await hasPayrollAccess(c.env.DB, user)) {
    const rows = await calculateMonth(c.env.DB, month);
    payrollTotal = rows.reduce((sum, row) => sum + row.finalPayable, 0);
  }
  const period = await c.env.DB.prepare('SELECT status FROM payroll_periods WHERE payroll_month = ?').bind(month).first();
  return c.json({
    month,
    activeEmployees: Number(employeeCount.count),
    attendance,
    payrollTotal,
    payrollStatus: period?.status || 'draft'
  });
});

function employeeValues(body, current, role) {
  const id = current ? current.id : requiredText(body.id, 'Employee ID', 32);
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('Employee ID may contain letters, numbers, dots, underscores, and hyphens.');
  const general = {
    id,
    name: requiredText(body.name ?? current?.name, 'Name', 120),
    department: optionalText(body.department ?? current?.department, 'Department', 120),
    designation: optionalText(body.designation ?? current?.designation, 'Designation', 120),
    area: optionalText(body.area ?? current?.area, 'Area', 120),
    joining_date: (body.joining_date ?? current?.joining_date) || null,
    relieving_date: (body.relieving_date ?? current?.relieving_date) || null
  };
  if (general.joining_date && !isIsoDate(general.joining_date)) throw new Error('Joining date must use YYYY-MM-DD format.');
  if (general.relieving_date && !isIsoDate(general.relieving_date)) throw new Error('Relieving date must use YYYY-MM-DD format.');
  if (role === 'hr') {
    if (!current) {
      return { ...general, monthly_ctc: 0, pf_applicable: 0, esic_applicable: 0 };
    }
    return {
      ...general,
      monthly_ctc: current.monthly_ctc,
      pf_applicable: current.pf_applicable,
      esic_applicable: current.esic_applicable
    };
  }
  return {
    ...general,
    monthly_ctc: numberValue(body.monthly_ctc ?? current?.monthly_ctc ?? 0, 'Monthly CTC'),
    pf_applicable: toBool(body.pf_applicable ?? current?.pf_applicable ?? false, 'PF applicability'),
    esic_applicable: toBool(body.esic_applicable ?? current?.esic_applicable ?? false, 'ESIC applicability'),
    pan: optionalText(body.pan ?? current?.pan, 'PAN', 32),
    uan: optionalText(body.uan ?? current?.uan, 'UAN', 32),
    esic_number: optionalText(body.esic_number ?? current?.esic_number, 'ESIC number', 32),
    email: optionalText(body.email ?? current?.email, 'Email', 254),
    bank_account: optionalText(body.bank_account ?? current?.bank_account, 'Bank account', 64),
    ifsc: optionalText(body.ifsc ?? current?.ifsc, 'IFSC', 24)
  };
}

app.get('/api/employees', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  const query = (c.req.query('q') || '').trim().slice(0, 100);
  const user = c.get('user');
  const scope = await employeeScopePredicate(c.env.DB, user);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM employees
     WHERE active = 1 AND ${scope.sql}
       AND (? = '' OR name LIKE ? OR id LIKE ? OR department LIKE ?)
     ORDER BY name COLLATE NOCASE LIMIT 500`
  ).bind(...scope.bindings, query, `%${query}%`, `%${query}%`, `%${query}%`).all();
  const employees = rows.results.map(asEmployee);
  const accessRoles = user.access_control_enabled === undefined
    ? user.role === 'payroll' || user.role === 'admin' ? ['finance'] : []
    : await assignedAccessRoles(c.env.DB, user.id);
  if (!accessRoles.includes('super_admin') && !accessRoles.includes('finance')) {
    return c.json(employees.map(withoutSensitiveEmployeeFields));
  }
  return c.json(employees);
});

app.post('/api/employees', requireRoles('admin', 'hr'), async (c) => {
  try {
    const body = await readJson(c);
    const values = employeeValues(body, null, c.get('user').role);
    await c.env.DB.prepare(
      `INSERT INTO employees
       (id, name, department, designation, area, joining_date, relieving_date, monthly_ctc,
        pf_applicable, esic_applicable, pan, uan, esic_number, email, bank_account, ifsc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      values.id, values.name, values.department, values.designation, values.area,
      values.joining_date, values.relieving_date, values.monthly_ctc,
      values.pf_applicable, values.esic_applicable,
      values.pan || '', values.uan || '', values.esic_number || '', values.email || '',
      values.bank_account || '', values.ifsc || ''
    ).run();
    return c.json({ employee: values }, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to create employee.');
  }
});

app.put('/api/employees/:id', requireRoles('admin', 'hr'), async (c) => {
  try {
    const currentRow = await c.env.DB.prepare('SELECT * FROM employees WHERE id = ? AND active = 1').bind(c.req.param('id')).first();
    if (!currentRow) return jsonError(c, 404, 'Employee was not found.');
    const body = await readJson(c);
    const current = asEmployee(currentRow);
    const values = employeeValues(body, current, c.get('user').role);
    await c.env.DB.prepare(
      `UPDATE employees SET name = ?, department = ?, designation = ?, area = ?, joining_date = ?,
       relieving_date = ?, monthly_ctc = ?, pf_applicable = ?, esic_applicable = ?, pan = ?, uan = ?,
       esic_number = ?, email = ?, bank_account = ?, ifsc = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(
      values.name, values.department, values.designation, values.area, values.joining_date,
      values.relieving_date, values.monthly_ctc, values.pf_applicable, values.esic_applicable,
      values.pan || current.pan || '', values.uan || current.uan || '',
      values.esic_number || current.esic_number || '', values.email || current.email || '',
      values.bank_account || current.bank_account || '', values.ifsc || current.ifsc || '', values.id
    ).run();
    return c.json({ employee: values });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to update employee.');
  }
});

app.delete('/api/employees/:id', requireRoles('admin', 'hr'), async (c) => {
  const result = await c.env.DB.prepare(
    'UPDATE employees SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND active = 1'
  ).bind(c.req.param('id')).run();
  if (!result.meta.changes) return jsonError(c, 404, 'Employee was not found.');
  return c.json({ ok: true });
});

app.get('/api/revisions', requireRoles('admin', 'payroll'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT r.*, e.name AS employee_name FROM salary_revisions r
     JOIN employees e ON e.id = r.employee_id ORDER BY r.source_order DESC LIMIT 1000`
  ).all();
  return c.json(rows.results);
});

app.post('/api/revisions', requireRoles('admin', 'payroll'), async (c) => {
  try {
    const body = await readJson(c);
    const employeeId = requiredText(body.employee_id, 'Employee', 32);
    const date = requiredText(body.effective_date, 'Effective date', 10);
    if (!isIsoDate(date)) throw new Error('Effective date must use YYYY-MM-DD format.');
    const amount = numberValue(body.monthly_ctc, 'Monthly CTC');
    const orderRow = await c.env.DB.prepare('SELECT COALESCE(MAX(source_order), 0) AS max_order FROM salary_revisions').first();
    const revision = {
      id: crypto.randomUUID(),
      employee_id: employeeId,
      effective_date: date,
      monthly_ctc: amount,
      reason: optionalText(body.reason, 'Reason', 200),
      source_order: Number(orderRow.max_order) + 1
    };
    await c.env.DB.prepare(
      'INSERT INTO salary_revisions (id, employee_id, effective_date, monthly_ctc, reason, source_order) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(revision.id, revision.employee_id, revision.effective_date, revision.monthly_ctc, revision.reason, revision.source_order).run();
    return c.json(revision, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to add salary revision.');
  }
});

app.delete('/api/revisions/:id', requireRoles('admin', 'payroll'), async (c) => {
  await c.env.DB.prepare('DELETE FROM salary_revisions WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

app.get('/api/attendance', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7);
  if (!isMonth(month)) return jsonError(c, 400, 'Month must use YYYY-MM format.');
  const start = `${month}-01`;
  const end = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  const scope = await employeeScopePredicate(c.env.DB, c.get('user'));
  const [employees, rows, holidays] = await Promise.all([
    c.env.DB.prepare(`SELECT id, name, department FROM employees
      WHERE active = 1 AND ${scope.sql} ORDER BY name COLLATE NOCASE`)
      .bind(...scope.bindings).all(),
    c.env.DB.prepare(
      `SELECT attendance_days.employee_id, attendance_days.work_date, attendance_days.status
       FROM attendance_days
       JOIN employees ON employees.id = attendance_days.employee_id
       WHERE attendance_days.work_date >= ? AND attendance_days.work_date <= ?
         AND ${scope.sql}`
    ).bind(start, end, ...scope.bindings).all(),
    c.env.DB.prepare('SELECT holiday_date FROM holidays WHERE paid = 1 AND holiday_date >= ? AND holiday_date <= ?').bind(start, end).all()
  ]);
  const attendance = new Map(rows.results.map((row) => [`${row.employee_id}|${row.work_date}`, row.status]));
  const paidHolidays = new Set(holidays.results.map((row) => row.holiday_date));
  const dayCount = daysInMonth(month);
  return c.json({
    month,
    daysInMonth: dayCount,
    codes: ATTENDANCE_CODES,
    employees: employees.results,
    entries: employees.results.map((employee) => ({
      employeeId: employee.id,
      days: Array.from({ length: dayCount }, (_, index) => {
        const date = `${month}-${String(index + 1).padStart(2, '0')}`;
        if (attendance.has(`${employee.id}|${date}`)) return attendance.get(`${employee.id}|${date}`);
        return defaultAttendanceStatus(date, paidHolidays);
      })
    }))
  });
});

app.put('/api/attendance', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  try {
    const body = await readJson(c, 1_000_000);
    if (!isMonth(body.month) || !Array.isArray(body.entries) || body.entries.length > 20000) {
      throw new Error('Attendance payload is invalid.');
    }
    const dayCount = daysInMonth(body.month);
    const validCodes = new Set([...Object.keys(ATTENDANCE_CODES), '']);
    const user = c.get('user');
    for (const entry of body.entries) {
      if (!await canAccessEmployee(c.env.DB, user, entry.employee_id)) {
        return jsonError(c, 403, 'You do not have permission to change attendance for this employee.');
      }
    }
    const statements = body.entries.map((entry) => {
      const employeeId = requiredText(entry.employee_id, 'Employee ID', 32);
      const day = Number(entry.day);
      if (!Number.isInteger(day) || day < 1 || day > dayCount) throw new Error('Attendance day is outside the selected month.');
      if (!validCodes.has(entry.status)) throw new Error('Attendance code is invalid.');
      const date = `${body.month}-${String(day).padStart(2, '0')}`;
      return c.env.DB.prepare(
        `INSERT INTO attendance_days (employee_id, work_date, status) VALUES (?, ?, ?)
         ON CONFLICT(employee_id, work_date) DO UPDATE SET status = excluded.status`
      ).bind(employeeId, date, entry.status);
    });
    for (let offset = 0; offset < statements.length; offset += 100) {
      await c.env.DB.batch(statements.slice(offset, offset + 100));
    }
    return c.json({ saved: statements.length });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to save attendance.');
  }
});

app.get('/api/holidays', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  const year = c.req.query('year');
  if (year && !/^\d{4}$/.test(year)) return jsonError(c, 400, 'Year must use YYYY format.');
  const rows = year
    ? await c.env.DB.prepare('SELECT * FROM holidays WHERE holiday_date >= ? AND holiday_date < ? ORDER BY holiday_date')
      .bind(`${year}-01-01`, `${Number(year) + 1}-01-01`).all()
    : await c.env.DB.prepare('SELECT * FROM holidays ORDER BY holiday_date DESC LIMIT 1000').all();
  return c.json(rows.results.map((row) => ({ ...row, paid: Boolean(row.paid) })));
});

app.post('/api/holidays', requireRoles('admin', 'hr'), async (c) => {
  try {
    const body = await readJson(c);
    const items = Array.isArray(body) ? body : [body];
    if (!items.length) throw new Error('At least one holiday is required.');
    const saved = [];
    for (const item of items) {
      const holidayDate = requiredText(item.holiday_date, 'Holiday date', 10);
      if (!isIsoDate(holidayDate)) throw new Error('Holiday date must use YYYY-MM-DD format.');
      const holiday = {
        id: crypto.randomUUID(),
        holiday_date: holidayDate,
        name: requiredText(item.name, 'Holiday name', 120),
        paid: toBool(item.paid ?? true, 'Paid holiday')
      };
      await c.env.DB.prepare(
        `INSERT INTO holidays (id, holiday_date, name, paid) VALUES (?, ?, ?, ?)
         ON CONFLICT(holiday_date, name) DO UPDATE SET paid = excluded.paid`
      ).bind(holiday.id, holiday.holiday_date, holiday.name, holiday.paid).run();
      saved.push(holiday);
    }
    return c.json(saved.length === 1 ? saved[0] : saved, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to save holiday.');
  }
});

app.get('/api/holidays/:id', requireRoles('admin', 'hr'), async (c) => {
  const holiday = await c.env.DB.prepare('SELECT * FROM holidays WHERE id = ?').bind(c.req.param('id')).first();
  if (!holiday) return jsonError(c, 404, 'Holiday not found.');
  return c.json(holiday);
});

app.delete('/api/holidays/:id', requireRoles('admin', 'hr'), async (c) => {
  await c.env.DB.prepare('DELETE FROM holidays WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

/* Travel tracking routes */
app.get('/api/travel-settings', requireRoles('admin', 'payroll', 'employee'), async (c) => {
  const settings = await c.env.DB.prepare('SELECT setting_key, setting_value FROM travel_settings').all();
  return c.json(Object.fromEntries(settings.results.map((row) => [row.setting_key, row.setting_value])));
});

app.put('/api/travel-settings', requireRoles('admin', 'payroll'), async (c) => {
  try {
    const body = await readJson(c);
    const statements = [];
    for (const [key, value] of Object.entries(body)) {
      if (!TRAVEL_SETTINGS_KEYS.has(key)) throw new Error(`Unknown travel setting: ${key}`);
      const parsed = numberValue(value, key, { maximum: 1000 });
      statements.push(c.env.DB.prepare(
        `INSERT INTO travel_settings (setting_key, setting_value, description) VALUES (?, ?, '')
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`
      ).bind(key, parsed));
    }
    if (statements.length) await c.env.DB.batch(statements);
    const settings = await travelSettingsFromDb(c.env.DB);
    return c.json({ settings });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to save travel settings.');
  }
});

app.post('/api/travel/journeys', requireRoles('admin', 'payroll'), async (c) => {
  try {
    const body = await readJson(c);
    const required = ['employee_id', 'travel_date', 'start_lat', 'start_lng', 'end_lat', 'end_lng'];
    for (const field of required) {
      if (!body[field]) throw new Error(`Missing required field: ${field}`);
    }
    const user = c.get('user');
    const employeeId = requiredText(body.employee_id, 'Employee ID', 32);
    if (!await employeeIsInScope(c.env.DB, user, employeeId, { financial: true })) {
      return jsonError(c, 403, 'You do not have access to manage travel for this employee.');
    }
    const id = body.id || crypto.randomUUID();
    const existing = await c.env.DB.prepare(
      'SELECT employee_id FROM travel_journeys WHERE id = ?'
    ).bind(id).first();
    if (existing && !await employeeIsInScope(c.env.DB, user, existing.employee_id, { financial: true })) {
      return jsonError(c, 403, 'You do not have access to update this journey.');
    }
    const status = body.status || 'draft';
    if (!['draft', 'submitted'].includes(status)) {
      return jsonError(c, 400, 'Travel approvals must be recorded through the approval action.');
    }
    const journey = {
      id,
      employee_id: employeeId,
      travel_date: requiredText(body.travel_date, 'Travel date', 10),
      start_lat: numberValue(body.start_lat, 'Start latitude', 10),
      start_lng: numberValue(body.start_lng, 'Start longitude', 10),
      end_lat: numberValue(body.end_lat, 'End latitude', 10),
      end_lng: numberValue(body.end_lng, 'End longitude', 10),
      gps_distance_km: Number(body.gps_distance_km || 0),
      road_distance_km: Number(body.road_distance_km || 0),
      approved_distance_km: 0,
      status,
      notes: body.notes || ''
    };
    await c.env.DB.prepare(
      `INSERT INTO travel_journeys (id, employee_id, travel_date, start_lat, start_lng, end_lat, end_lng, gps_distance_km, road_distance_km, approved_distance_km, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET employee_id = excluded.employee_id, travel_date = excluded.travel_date,
       start_lat = excluded.start_lat, start_lng = excluded.start_lng, end_lat = excluded.end_lat, end_lng = excluded.end_lng,
       gps_distance_km = excluded.gps_distance_km, road_distance_km = excluded.road_distance_km, approved_distance_km = excluded.approved_distance_km,
       status = excluded.status, notes = excluded.notes, updated_at = CURRENT_TIMESTAMP`
    ).bind(journey.id, journey.employee_id, journey.travel_date, journey.start_lat, journey.start_lng, journey.end_lat, journey.end_lng, journey.gps_distance_km, journey.road_distance_km, journey.approved_distance_km, journey.status, journey.notes).run();
    return c.json(journey, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to create travel journey.');
  }
});

app.put('/api/travel/journeys/:id', requireRoles('admin', 'payroll'), async (c) => {
  try {
    const journeyId = c.req.param('id');
    const body = await readJson(c);
    const existing = await c.env.DB.prepare(
      'SELECT employee_id FROM travel_journeys WHERE id = ?'
    ).bind(journeyId).first();
    if (!existing) return jsonError(c, 404, 'Travel journey not found.');
    if (!await employeeIsInScope(c.env.DB, c.get('user'), existing.employee_id, { financial: true })) {
      return jsonError(c, 403, 'You do not have access to update this journey.');
    }
    if (body.approved_distance_km !== undefined
      || (body.status !== undefined && !['draft', 'submitted'].includes(body.status))) {
      return jsonError(c, 400, 'Travel approvals must be recorded through the approval action.');
    }
    const updates = [];
    for (const [field, value] of Object.entries({
      start_lat: body.start_lat,
      start_lng: body.start_lng,
      end_lat: body.end_lat,
      end_lng: body.end_lng,
      gps_distance_km: body.gps_distance_km,
      road_distance_km: body.road_distance_km,
      status: body.status
    })) {
      if (value !== undefined) {
        updates.push(c.env.DB.prepare(
          `UPDATE travel_journeys SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).bind(value, journeyId));
      }
    }
    if (updates.length) await c.env.DB.batch(updates);
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to update travel journey.');
  }
});

app.delete('/api/travel/journeys/:id', requireRoles('admin', 'payroll'), async (c) => {
  const existing = await c.env.DB.prepare(
    'SELECT employee_id FROM travel_journeys WHERE id = ?'
  ).bind(c.req.param('id')).first();
  if (!existing) return jsonError(c, 404, 'Travel journey not found.');
  if (!await employeeIsInScope(c.env.DB, c.get('user'), existing.employee_id, { financial: true })) {
    return jsonError(c, 403, 'You do not have access to delete this journey.');
  }
  await c.env.DB.prepare('DELETE FROM travel_journeys WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

app.put('/api/travel/adjustments', requireRoles('admin', 'payroll'), async (c) => {
  try {
    const body = await readJson(c);
    const journeyId = requiredText(body.journey_id, 'Journey ID', 64);
    const approvedKm = numberValue(body.approved_distance_km, 'Approved distance (KM)', { minimum: 0, maximum: 100000 });
    const status = body.status || 'approved';
    const reason = optionalText(body.reason, 'Reason', 200);
    const existing = await c.env.DB.prepare(
      `SELECT j.id, j.employee_id, j.status, j.approved_distance_km,
              l.journey_id AS live_journey_id
       FROM travel_journeys j
       LEFT JOIN travel_live_sessions l ON l.journey_id = j.id
       WHERE j.id = ?`
    ).bind(journeyId).first();
    if (!existing) return jsonError(c, 404, 'Travel journey not found.');
    if (!await employeeIsInScope(c.env.DB, c.get('user'), existing.employee_id, { financial: true })) {
      return jsonError(c, 403, 'You do not have access to approve this journey.');
    }
    if (existing.live_journey_id) return jsonError(c, 409, 'Stop live tracking before approving this journey.');
    const previous = Number(existing.approved_distance_km || 0);
    const nextStatus = status === 'rejected' ? 'rejected' : 'approved';
    await c.env.DB.prepare(
      `UPDATE travel_journeys SET approved_distance_km = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(approvedKm, nextStatus, journeyId).run();
    await c.env.DB.prepare(
      `INSERT INTO travel_audit_log (id, journey_id, actor, action, field, from_value, to_value, created_at)
       VALUES (?, ?, ?, 'approved_distance', 'approved_distance_km', ?, ?, CURRENT_TIMESTAMP)`
    ).bind(crypto.randomUUID(), journeyId, c.get('user')?.id || 'admin', String(previous), String(approvedKm)).run();
    if (reason) {
      await c.env.DB.prepare(
        `INSERT INTO travel_audit_log (id, journey_id, actor, action, field, from_value, to_value, created_at)
         VALUES (?, ?, ?, 'rejection', 'rejection_reason', ?, ?, CURRENT_TIMESTAMP)`
      ).bind(crypto.randomUUID(), journeyId, c.get('user')?.id || 'admin', '', reason).run();
    }
    return c.json({ ok: true, journeyId, approvedKm, status: nextStatus });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to save travel adjustment.');
  }
});

app.get('/api/travel/journeys', requireRoles('admin', 'payroll'), async (c) => {
  const scope = await employeeScopePredicate(c.env.DB, c.get('user'), 'e', { financial: true });
  const rows = await c.env.DB.prepare(
    `SELECT j.id, j.employee_id, j.travel_date, j.status, j.approved_distance_km, j.gps_distance_km, j.road_distance_km
     FROM travel_journeys j
     JOIN employees e ON e.id = j.employee_id
     WHERE ${scope.sql}
     ORDER BY j.travel_date DESC LIMIT 1000`
  ).bind(...scope.bindings).all();
  return c.json(rows.results);
});

// Classify a live session's current state from the most recent GPS point.
// live  = a GPS point was recorded within the last 15 minutes
// idle  = session is open but no recent GPS point (tracking stopped, app backgrounded)
// offline = no active session at all
const TRACKING_IDLE_MINUTES = 15;
function classifyTrackingStatus(session) {
  if (!session) return 'offline';
  if (!session.last_point_at) return 'idle';
  const minutes = (Date.now() - new Date(session.last_point_at).getTime()) / 60_000;
  return minutes <= TRACKING_IDLE_MINUTES ? 'live' : 'idle';
}

app.get('/api/travel/live-locations', requireRoles('admin', 'payroll', 'hr'), async (c) => {
  const scope = await employeeScopePredicate(c.env.DB, c.get('user'), 'e', { financial: true });
  const rows = await c.env.DB.prepare(
    `SELECT j.id AS journey_id, j.employee_id, e.name AS employee_name, j.travel_date,
            l.status AS session_status, l.last_point_at,
            COALESCE(p.lat, j.start_lat) AS lat, COALESCE(p.lng, j.start_lng) AS lng,
            p.accuracy, p.speed_kmh, p.recorded_at
     FROM travel_live_sessions l
     JOIN travel_journeys j ON j.id = l.journey_id
     JOIN employees e ON e.id = j.employee_id
     LEFT JOIN travel_route_points p ON p.id = (
       SELECT rp.id FROM travel_route_points rp
       WHERE rp.journey_id = j.id
       ORDER BY rp.recorded_at DESC LIMIT 1
     )
     WHERE ${scope.sql}
     ORDER BY l.started_at DESC`
  ).bind(...scope.bindings).all();
  return c.json(rows.results);
});

// All-employee tracking overview: every field force employee with their
// current state (live / idle / offline) and last known location.
app.get('/api/travel/employee-tracking', requireRoles('admin', 'payroll', 'hr'), async (c) => {
  const scope = await employeeScopePredicate(c.env.DB, c.get('user'), 'e', { financial: true });
  const rows = await c.env.DB.prepare(
    `SELECT e.id AS employee_id, e.name AS employee_name, e.department,
            l.journey_id, l.status AS session_status, l.last_point_at,
            COALESCE(p.lat, j.start_lat) AS lat, COALESCE(p.lng, j.start_lng) AS lng,
            p.recorded_at AS last_point_recorded_at
     FROM employees e
     LEFT JOIN travel_journeys j ON j.employee_id = e.id
     LEFT JOIN travel_live_sessions l ON l.journey_id = j.id
     LEFT JOIN travel_route_points p ON p.id = (
       SELECT rp.id FROM travel_route_points rp
       WHERE rp.journey_id = l.journey_id
       ORDER BY rp.recorded_at DESC LIMIT 1
     )
     WHERE e.active = 1 AND ${scope.sql}
     GROUP BY e.id
     ORDER BY e.name ASC`
  ).bind(...scope.bindings).all();
  const result = rows.results.map((row) => {
    const state = classifyTrackingStatus({
      status: row.session_status,
      last_point_at: row.last_point_at || row.last_point_recorded_at
    });
    return {
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      department: row.department,
      state,
      journey_id: row.journey_id,
      lat: row.lat,
      lng: row.lng,
      last_point_at: row.last_point_at || row.last_point_recorded_at
    };
  });
  const counts = {
    all: result.length,
    live: result.filter((r) => r.state === 'live').length,
    idle: result.filter((r) => r.state === 'idle').length,
    offline: result.filter((r) => r.state === 'offline').length
  };
  return c.json({ counts, employees: result });
});

// Get single journey with route points, odometer, and expense info
app.get('/api/travel/journeys/:journey_id', requireRoles('employee', 'admin', 'payroll'), async (c) => {
  const user = c.get('user');
  const journeyId = c.req.param('journey_id');
  const journey = await c.env.DB.prepare(
    `SELECT j.*, e.name AS employee_name
     FROM travel_journeys j
     JOIN employees e ON e.id = j.employee_id
     WHERE j.id = ?`
  ).bind(journeyId).first();
  if (!journey) return jsonError(c, 404, 'Journey not found.');
  if (!await employeeIsInScope(c.env.DB, user, journey.employee_id, { financial: true })) {
    return jsonError(c, 403, 'You do not have access to this journey.');
  }
  // Check for odometer record
  const odometer = await c.env.DB.prepare(
    'SELECT * FROM travel_odometer WHERE journey_id = ?'
  ).bind(journeyId).first();
  // Check for expense claim
  const expense = await c.env.DB.prepare(
    'SELECT * FROM travel_expense_claims WHERE journey_id = ?'
  ).bind(journeyId).first();
  return c.json({ ...journey, odometer_id: odometer?.id || null, expense_id: expense?.id || null });
});

app.get('/api/travel/employee/:employee_id', requireRoles('admin', 'payroll'), async (c) => {
  const employeeId = c.req.param('employee_id');
  if (employeeId !== 'all'
    && !await employeeIsInScope(c.env.DB, c.get('user'), employeeId, { financial: true })) {
    return jsonError(c, 403, 'You do not have access to this employee travel data.');
  }
  const scope = await employeeScopePredicate(c.env.DB, c.get('user'), 'e', { financial: true });
  const rows = employeeId === 'all'
    ? await c.env.DB.prepare(
        `SELECT j.id, j.employee_id, j.travel_date,
                CASE WHEN l.journey_id IS NOT NULL THEN COALESCE(l.status, 'live') ELSE j.status END AS status,
                j.approved_distance_km, j.gps_distance_km, j.road_distance_km, e.name AS employee_name
         FROM travel_journeys j JOIN employees e ON e.id = j.employee_id
         LEFT JOIN travel_live_sessions l ON l.journey_id = j.id
         WHERE ${scope.sql}
         ORDER BY j.travel_date DESC, j.created_at DESC LIMIT 1000`
      ).bind(...scope.bindings).all()
    : await c.env.DB.prepare(
        `SELECT j.id, j.employee_id, j.travel_date,
                CASE WHEN l.journey_id IS NOT NULL THEN COALESCE(l.status, 'live') ELSE j.status END AS status,
                j.approved_distance_km, j.gps_distance_km, j.road_distance_km, e.name AS employee_name
         FROM travel_journeys j JOIN employees e ON e.id = j.employee_id
         LEFT JOIN travel_live_sessions l ON l.journey_id = j.id
         WHERE j.employee_id = ?
         ORDER BY j.travel_date DESC, j.created_at DESC LIMIT 1000`
      ).bind(employeeId).all();
  return c.json(rows.results);
});

app.get('/api/travel/employee/:employee_id/summary', requireRoles('admin', 'payroll'), async (c) => {
  const employeeId = c.req.param('employee_id');
  if (employeeId !== 'all'
    && !await employeeIsInScope(c.env.DB, c.get('user'), employeeId, { financial: true })) {
    return jsonError(c, 403, 'You do not have access to this employee travel data.');
  }
  const scope = await employeeScopePredicate(c.env.DB, c.get('user'), 'e', { financial: true });
  const month = c.req.query('month');
  if (month && !isMonth(month)) return jsonError(c, 400, 'Month must use YYYY-MM format.');
  const dateFilter = month ? 'AND j.travel_date >= ? AND j.travel_date <= ?' : '';
  const dateBindings = month
    ? [`${month}-01`, `${month}-${String(daysInMonth(month)).padStart(2, '0')}`]
    : [];
  const [rows, settingsRows] = await Promise.all([
    employeeId === 'all'
      ? c.env.DB.prepare(
          `SELECT j.id, j.employee_id, j.travel_date,
                  CASE WHEN l.journey_id IS NOT NULL THEN 'live' ELSE j.status END AS status,
                  j.approved_distance_km, j.gps_distance_km, j.road_distance_km, e.name AS employee_name,
                  j.start_lat, j.start_lng, j.end_lat, j.end_lng
           FROM travel_journeys j JOIN employees e ON e.id = j.employee_id
           LEFT JOIN travel_live_sessions l ON l.journey_id = j.id
           WHERE ${scope.sql} ${dateFilter}
           ORDER BY j.travel_date DESC, j.created_at DESC LIMIT 1000`
        ).bind(...scope.bindings, ...dateBindings).all()
      : c.env.DB.prepare(
          `SELECT j.id, j.employee_id, j.travel_date,
                  CASE WHEN l.journey_id IS NOT NULL THEN 'live' ELSE j.status END AS status,
                  j.approved_distance_km, j.gps_distance_km, j.road_distance_km, e.name AS employee_name,
                  j.start_lat, j.start_lng, j.end_lat, j.end_lng
           FROM travel_journeys j JOIN employees e ON e.id = j.employee_id
           LEFT JOIN travel_live_sessions l ON l.journey_id = j.id
           WHERE j.employee_id = ? ${dateFilter}
           ORDER BY j.travel_date DESC, j.created_at DESC LIMIT 1000`
        ).bind(employeeId, ...dateBindings).all(),
    c.env.DB.prepare('SELECT setting_key, setting_value FROM travel_settings').all()
  ]);
  const settings = { ...DEFAULT_TRAVEL_SETTINGS, ...Object.fromEntries(
    settingsRows.results.map((row) => [row.setting_key, Number(row.setting_value)])
  ) };
  const approvedByDay = new Map();
  for (const row of rows.results) {
    const approvedKm = Number(row.approved_distance_km || 0);
    if (row.status !== 'approved' || approvedKm <= 0) continue;
    const key = `${row.employee_id}|${row.travel_date}`;
    approvedByDay.set(key, (approvedByDay.get(key) || 0) + approvedKm);
  }
  const travelAllowance = travelAllowanceForDays([...approvedByDay.values()], settings);
  return c.json({
    settings,
    journeys: rows.results,
    travel_allowance: travelAllowance,
    total_approved_km: rows.results.reduce((sum, row) => sum + (row.approved_distance_km || 0), 0),
    total_gps_km: rows.results.reduce((sum, row) => sum + (row.gps_distance_km || 0), 0),
    total_road_km: rows.results.reduce((sum, row) => sum + (row.road_distance_km || 0), 0)
  });
});

app.get('/api/settings', requireRoles('admin', 'payroll'), async (c) => {
  const settings = await settingsFromDb(c.env.DB);
  return c.json({ settings, examples: settingExamples(settings) });
});

app.put('/api/settings', requireRoles('admin'), async (c) => {
  try {
    const body = await readJson(c);
    const statements = [];
    for (const [key, value] of Object.entries(body)) {
      if (!SETTING_KEYS.has(key)) throw new Error(`Unknown payroll setting: ${key}.`);
      if (!EDITABLE_SETTING_KEYS.has(key)) throw new Error(`${key} is a reference-only workbook value.`);
      const parsed = numberValue(value, key, { maximum: key.includes('factor') ? 100 : 1000000 });
      if (key.endsWith('_pct') || key.endsWith('_rate')) {
        if (parsed > 1) throw new Error(`${key} must be between 0 and 1.`);
      }
      if (key.includes('factor') && parsed <= 0) throw new Error(`${key} must be greater than zero.`);
      statements.push(c.env.DB.prepare(
        `INSERT INTO payroll_settings (setting_key, setting_value, description) VALUES (?, ?, '')
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`
      ).bind(key, parsed));
    }
    if (statements.length) await c.env.DB.batch(statements);
    const settings = await settingsFromDb(c.env.DB);
    return c.json({ settings, examples: settingExamples(settings) });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to save payroll settings.');
  }
});

async function calculateMonth(db, month) {
  const firstDay = `${month}-01`;
  const lastDay = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  const [
    employeeResult,
    revisionResult,
    attendanceResult,
    adjustmentResult,
    settings,
    holidayResult,
    travelResult,
    travelSettingsResult,
    allowanceRulesResult,
    expenseClaimResult,
    oneOffResult,
    recurringResult
  ] = await Promise.all([
    db.prepare(
      `SELECT e.* FROM employees e
       WHERE e.active = 1 OR EXISTS (
         SELECT 1 FROM attendance_days a
         WHERE a.employee_id = e.id AND a.work_date >= ? AND a.work_date <= ?
       )
       ORDER BY e.name COLLATE NOCASE`
    ).bind(firstDay, lastDay).all(),
    db.prepare('SELECT * FROM salary_revisions ORDER BY source_order').all(),
    db.prepare('SELECT employee_id, work_date, status FROM attendance_days WHERE work_date >= ? AND work_date <= ?')
      .bind(firstDay, lastDay).all(),
    db.prepare('SELECT * FROM payroll_adjustments WHERE payroll_month = ?').bind(month).all(),
    settingsFromDb(db),
    db.prepare('SELECT holiday_date FROM holidays WHERE paid = 1 AND holiday_date >= ? AND holiday_date <= ?')
      .bind(firstDay, lastDay).all(),
    db.prepare(
      `SELECT employee_id, travel_date, SUM(approved_distance_km) AS approved_km
       FROM travel_journeys
       WHERE status = 'approved' AND approved_distance_km > 0 AND travel_date >= ? AND travel_date <= ?
       GROUP BY employee_id, travel_date`
    ).bind(firstDay, lastDay).all(),
    db.prepare('SELECT setting_key, setting_value FROM travel_settings').all(),
    db.prepare(
      `SELECT employee_id, effective_from, ta_per_km, da_daily, min_daily_km, max_daily_km, active
       FROM travel_allowance_rules WHERE active = 1`
    ).all(),
    db.prepare(
      `SELECT ec.employee_id, j.travel_date, SUM(ec.approved_km) AS approved_km
       FROM travel_expense_claims ec
       JOIN travel_journeys j ON j.id = ec.journey_id
       WHERE ec.status = 'approved' AND ec.approved_km > 0 AND j.travel_date >= ? AND j.travel_date <= ?
       GROUP BY ec.employee_id, j.travel_date`
    ).bind(firstDay, lastDay).all(),
    db.prepare(
      `SELECT id, employee_id, label, kind, amount, 0 AS recurring
       FROM payroll_one_off_items WHERE payroll_month = ?`
    ).bind(month).all(),
    db.prepare(
      `SELECT r.id, r.employee_id, c.label, c.kind, r.amount, 1 AS recurring
       FROM payroll_recurring_items r
       JOIN payroll_component_definitions c ON c.id = r.component_id
       WHERE r.start_month <= ? AND (r.end_month IS NULL OR r.end_month >= ?)`
    ).bind(month, month).all()
  ]);

  const attendanceByEmployee = new Map();
  for (const row of attendanceResult.results) {
    if (!attendanceByEmployee.has(row.employee_id)) attendanceByEmployee.set(row.employee_id, new Map());
    attendanceByEmployee.get(row.employee_id).set(row.work_date, row.status);
  }
  const paidHolidays = new Set(holidayResult.results.map((row) => row.holiday_date));
  const adjustments = new Map(adjustmentResult.results.map((row) => [row.employee_id, row]));
  const revisions = revisionResult.results;
  const travelSettings = { ...DEFAULT_TRAVEL_SETTINGS, ...Object.fromEntries(
    travelSettingsResult.results.map((row) => [row.setting_key, Number(row.setting_value)])
  ) };
  // Per-employee allowance rules, keyed by employee_id, ordered by effective date.
  const rulesByEmployee = new Map();
  for (const row of allowanceRulesResult.results) {
    if (!rulesByEmployee.has(row.employee_id)) rulesByEmployee.set(row.employee_id, []);
    rulesByEmployee.get(row.employee_id).push(row);
  }
  for (const list of rulesByEmployee.values()) {
    list.sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  }
  // Approved travel journeys, grouped by employee and date.
  const travelByEmployee = new Map();
  for (const row of travelResult.results) {
    if (!travelByEmployee.has(row.employee_id)) travelByEmployee.set(row.employee_id, new Map());
    travelByEmployee.get(row.employee_id).set(row.travel_date, Number(row.approved_km || 0));
  }
  // Approved expense-claim TA/DA, grouped by employee and date.
  const expenseByEmployee = new Map();
  for (const row of expenseClaimResult.results) {
    if (!expenseByEmployee.has(row.employee_id)) expenseByEmployee.set(row.employee_id, new Map());
    expenseByEmployee.get(row.employee_id).set(row.travel_date, Number(row.approved_km || 0));
  }
  const customItemsByEmployee = new Map();
  for (const row of [...oneOffResult.results, ...recurringResult.results]) {
    if (!customItemsByEmployee.has(row.employee_id)) customItemsByEmployee.set(row.employee_id, []);
    customItemsByEmployee.get(row.employee_id).push(row);
  }

  return employeeResult.results.map((rawEmployee) => {
    const employee = asEmployee(rawEmployee);
    const days = attendanceByEmployee.get(employee.id) || new Map();
    const statuses = Array.from({ length: daysInMonth(month) }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, '0')}`;
      if (days.has(date)) return days.get(date);
      return defaultAttendanceStatus(date, paidHolidays);
    });
    const employeeRules = rulesByEmployee.get(employee.id) || [];
    const travelDays = [...(travelByEmployee.get(employee.id) || new Map()).entries()]
      .map(([date, km]) => ({ date, km }));
    const expenseDays = [...(expenseByEmployee.get(employee.id) || new Map()).entries()]
      .map(([date, km]) => ({ date, km }));
    const travelReimbursement = allowanceForDays(employee.id, travelDays, travelSettings, employeeRules);
    const expenseReimbursement = allowanceForDays(employee.id, expenseDays, travelSettings, employeeRules);
    const combined = {
      ta: excelRound(travelReimbursement.ta + expenseReimbursement.ta, 2),
      da: excelRound(travelReimbursement.da + expenseReimbursement.da, 2),
      total: excelRound(travelReimbursement.total + expenseReimbursement.total, 2)
    };
    return calculatePayroll(
      employee, statuses, revisions, adjustments.get(employee.id), month, settings,
      combined,
      customItemsByEmployee.get(employee.id) || []
    );
  });
}

app.get('/api/payroll', requireRoles('admin', 'payroll'), async (c) => {
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7);
  if (!isMonth(month)) return jsonError(c, 400, 'Month must use YYYY-MM format.');
  const [rows, period] = await Promise.all([
    calculateMonth(c.env.DB, month),
    c.env.DB.prepare('SELECT status FROM payroll_periods WHERE payroll_month = ?').bind(month).first()
  ]);
  return c.json({ month, status: period?.status || 'draft', rows });
});

app.put('/api/payroll/adjustments', requireRoles('admin', 'payroll'), async (c) => {
  try {
    const body = await readJson(c);
    if (!isMonth(body.month)) throw new Error('Month must use YYYY-MM format.');
    const employeeId = requiredText(body.employee_id, 'Employee ID', 32);
    const reimbursement = numberValue(body.reimbursement ?? 0, 'Reimbursement');
    const advanceDeduction = numberValue(body.advance_deduction ?? 0, 'Advance deduction');
    await c.env.DB.prepare(
      `INSERT INTO payroll_adjustments
       (employee_id, payroll_month, reimbursement, advance_deduction, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(employee_id, payroll_month) DO UPDATE SET
       reimbursement = excluded.reimbursement, advance_deduction = excluded.advance_deduction,
       updated_at = CURRENT_TIMESTAMP`
    ).bind(employeeId, body.month, reimbursement, advanceDeduction).run();
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to save payroll inputs.');
  }
});

app.get('/api/payroll/components', requireRoles('admin', 'payroll'), async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT id, label, kind FROM payroll_component_definitions
     WHERE active = 1 ORDER BY label COLLATE NOCASE`
  ).all();
  return c.json(result.results);
});

app.post('/api/payroll/items', requireRoles('admin', 'payroll'), async (c) => {
  try {
    const body = await readJson(c, 20_000);
    if (!isMonth(body.month)) throw new Error('Month must use YYYY-MM format.');
    const employeeId = requiredText(body.employee_id, 'Employee ID', 32);
    const employee = await c.env.DB.prepare('SELECT id FROM employees WHERE id = ? AND active = 1').bind(employeeId).first();
    if (!employee) return jsonError(c, 404, 'Active employee was not found.');
    const amount = numberValue(body.amount, 'Amount');
    const recurring = toBool(body.recurring ?? false, 'Recurring');
    let component;

    if (body.component_id) {
      component = await c.env.DB.prepare(
        'SELECT id, label, kind FROM payroll_component_definitions WHERE id = ? AND active = 1'
      ).bind(requiredText(body.component_id, 'Component ID', 64)).first();
      if (!component) return jsonError(c, 404, 'Reusable payroll component was not found.');
    } else {
      const label = requiredText(body.label, 'Item name', 80);
      const kind = body.kind;
      if (!['earning', 'deduction'].includes(kind)) throw new Error('Item type must be earning or deduction.');
      if (recurring || body.save_reusable) {
        await c.env.DB.prepare(
          `INSERT INTO payroll_component_definitions (id, label, kind)
           VALUES (?, ?, ?)
           ON CONFLICT(label, kind) DO UPDATE SET active = 1`
        ).bind(crypto.randomUUID(), label, kind).run();
        component = await c.env.DB.prepare(
          'SELECT id, label, kind FROM payroll_component_definitions WHERE label = ? AND kind = ?'
        ).bind(label, kind).first();
      } else {
        component = { id: null, label, kind };
      }
    }

    if (recurring) {
      const id = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO payroll_recurring_items
         (id, employee_id, component_id, amount, start_month)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(id, employeeId, component.id, amount, body.month).run();
      return c.json({
        id, employee_id: employeeId, label: component.label, kind: component.kind,
        amount, recurring: true, start_month: body.month
      }, 201);
    }

    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO payroll_one_off_items
       (id, employee_id, payroll_month, component_id, label, kind, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, employeeId, body.month, component.id, component.label, component.kind, amount).run();
    return c.json({
      id, employee_id: employeeId, label: component.label, kind: component.kind,
      amount, recurring: false, payroll_month: body.month
    }, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to save payroll item.');
  }
});

app.delete('/api/payroll/items/:id', requireRoles('admin', 'payroll'), async (c) => {
  const month = c.req.query('month');
  if (!isMonth(month)) return jsonError(c, 400, 'Month must use YYYY-MM format.');
  const id = c.req.param('id');
  const oneOff = await c.env.DB.prepare(
    'SELECT id FROM payroll_one_off_items WHERE id = ? AND payroll_month = ?'
  ).bind(id, month).first();
  if (oneOff) {
    await c.env.DB.prepare('DELETE FROM payroll_one_off_items WHERE id = ?').bind(id).run();
    return c.json({ ok: true, recurring: false });
  }

  const recurring = await c.env.DB.prepare(
    'SELECT id, start_month, end_month FROM payroll_recurring_items WHERE id = ?'
  ).bind(id).first();
  if (!recurring) return jsonError(c, 404, 'Payroll item was not found.');
  if (month < recurring.start_month) return jsonError(c, 400, 'Selected month is before this item starts.');
  await c.env.DB.prepare(
    `UPDATE payroll_recurring_items SET end_month = ?
     WHERE id = ? AND (end_month IS NULL OR end_month > ?)`
  ).bind(month, id, month).run();
  return c.json({ ok: true, recurring: true, end_month: month });
});

app.put('/api/payroll/:month/status', requireRoles('admin', 'payroll'), async (c) => {
  const month = c.req.param('month');
  if (!isMonth(month)) return jsonError(c, 400, 'Month must use YYYY-MM format.');
  try {
    const body = await readJson(c, 20_000);
    if (!['draft', 'review', 'approved', 'paid'].includes(body.status)) throw new Error('Payroll status is invalid.');
    await c.env.DB.prepare(
      `INSERT INTO payroll_periods (payroll_month, status) VALUES (?, ?)
       ON CONFLICT(payroll_month) DO UPDATE SET status = excluded.status, updated_at = CURRENT_TIMESTAMP`
    ).bind(month, body.status).run();
    return c.json({ month, status: body.status });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to update payroll status.');
  }
});

async function companySettingsFromDb(db) {
  const result = await db.prepare('SELECT setting_key, setting_value FROM company_settings').all();
  return Object.fromEntries(result.results.map((row) => [row.setting_key, row.setting_value]));
}

app.get('/api/slip', requireRoles('admin', 'payroll'), async (c) => {
  const month = c.req.query('month');
  const employeeId = c.req.query('employee_id');
  if (!isMonth(month) || !employeeId) return jsonError(c, 400, 'Month and employee ID are required.');
  const [employeeRow, payrollRows, companySettings] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employeeId).first(),
    calculateMonth(c.env.DB, month),
    companySettingsFromDb(c.env.DB)
  ]);
  if (!employeeRow) return jsonError(c, 404, 'Employee was not found.');
  const payroll = payrollRows.find((row) => row.employeeId === employeeId);
  if (!payroll) return jsonError(c, 404, 'Payroll row was not found.');
  const slip = salarySlip(asEmployee(employeeRow), payroll);
  return c.json({ ...slip, company: companySettings });
});

/* Employee self-service routes */
app.get('/api/employee/attendance', requireRoles('employee', 'admin', 'hr', 'payroll'), async (c) => {
  const user = c.get('user');
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7);
  if (!isMonth(month)) return jsonError(c, 400, 'Month must use YYYY-MM format.');

  // RBAC scopes may grant managers access to assigned employees.
  const employeeId = user.role === 'employee' ? user.employee_id : c.req.query('employee_id');
  if (!employeeId) return jsonError(c, 400, 'Employee ID is required.');

  // Enforce the employee's own-record or manager-assigned scope.
  if (!await employeeIsInScope(c.env.DB, user, employeeId)) {
    return jsonError(c, 403, 'You do not have access to the requested employee attendance data.');
  }

  const start = `${month}-01`;
  const end = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;

  const [employeeRow, rows, holidays] = await Promise.all([
    c.env.DB.prepare('SELECT id, name, department FROM employees WHERE id = ? AND active = 1').bind(employeeId).first(),
    c.env.DB.prepare('SELECT work_date, status FROM attendance_days WHERE employee_id = ? AND work_date >= ? AND work_date <= ?').bind(employeeId, start, end).all(),
    c.env.DB.prepare('SELECT holiday_date FROM holidays WHERE paid = 1 AND holiday_date >= ? AND holiday_date <= ?').bind(start, end).all()
  ]);

  if (!employeeRow) return jsonError(c, 404, 'Employee was not found.');

  const attendance = new Map(rows.results.map((row) => [row.work_date, row.status]));
  const paidHolidays = new Set(holidays.results.map((row) => row.holiday_date));
  const dayCount = daysInMonth(month);

  return c.json({
    month,
    daysInMonth: dayCount,
    codes: ATTENDANCE_CODES,
    employee: employeeRow,
    entries: [{
      employeeId: employeeRow.id,
      days: Array.from({ length: dayCount }, (_, index) => {
        const date = `${month}-${String(index + 1).padStart(2, '0')}`;
        if (attendance.has(date)) return attendance.get(date);
        return defaultAttendanceStatus(date, paidHolidays);
      })
    }]
  });
});

app.get('/api/employee/travel', requireRoles('employee', 'admin', 'payroll'), async (c) => {
  const user = c.get('user');
  const employeeId = user.role === 'employee' ? user.employee_id : c.req.query('employee_id');
  const month = c.req.query('month');
  if (!employeeId) return jsonError(c, 400, 'Employee ID is required.');

  if (month && !isMonth(month)) return jsonError(c, 400, 'Month must use YYYY-MM format.');

  // Enforce the employee's own-record or manager-assigned scope.
  if (!await employeeIsInScope(c.env.DB, user, employeeId, { financial: true })) {
    return jsonError(c, 403, 'You do not have access to the requested employee travel data.');
  }

  const dateFilter = month ? 'AND j.travel_date >= ? AND j.travel_date <= ?' : '';
  const dateBindings = month
    ? [`${month}-01`, `${month}-${String(daysInMonth(month)).padStart(2, '0')}`]
    : [];

  const [rows, settingsRows, odometerRows, expenseRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT j.id, j.employee_id, j.travel_date,
              CASE WHEN l.journey_id IS NOT NULL THEN 'live' ELSE j.status END AS status,
              j.approved_distance_km, j.gps_distance_km, j.road_distance_km,
              j.start_lat, j.start_lng, j.end_lat, j.end_lng, j.notes
       FROM travel_journeys j
       LEFT JOIN travel_live_sessions l ON l.journey_id = j.id
       WHERE j.employee_id = ? ${dateFilter}
       ORDER BY j.travel_date DESC, j.created_at DESC LIMIT 1000`
    ).bind(employeeId, ...dateBindings).all(),
    c.env.DB.prepare('SELECT setting_key, setting_value FROM travel_settings').all(),
    c.env.DB.prepare(
      `SELECT journey_id, id AS odometer_id, actual_km, claimed_km, discrepancy_km, verified, recorded_at
       FROM travel_odometer
       WHERE journey_id IN (SELECT id FROM travel_journeys WHERE employee_id = ? ${dateFilter})`
    ).bind(employeeId, ...dateBindings).all(),
    c.env.DB.prepare(
      `SELECT journey_id, id AS expense_id, claimed_km, approved_km, total_claim, status, approved_by, approved_at
       FROM travel_expense_claims
       WHERE journey_id IN (SELECT id FROM travel_journeys WHERE employee_id = ? ${dateFilter})`
    ).bind(employeeId, ...dateBindings).all()
  ]);

  const settings = { ...DEFAULT_TRAVEL_SETTINGS, ...Object.fromEntries(
    settingsRows.results.map((row) => [row.setting_key, Number(row.setting_value)])
  ) };

  // Build lookup maps for odometer and expense
  const odometerMap = new Map(odometerRows.results.map(o => [o.journey_id, o]));
  const expenseMap = new Map(expenseRows.results.map(e => [e.journey_id, e]));

  // Enrich journeys with odometer and expense info
  const journeys = rows.results.map(journey => ({
    ...journey,
    odometer_id: odometerMap.get(journey.id)?.odometer_id || null,
    expense_id: expenseMap.get(journey.id)?.expense_id || null
  }));

  return c.json({
    settings,
    journeys
  });
});

app.post('/api/employee/travel/journeys', requireRoles('employee', 'admin', 'payroll'), async (c) => {
  try {
    const user = c.get('user');
    const body = await readJson(c);
    const required = ['travel_date', 'start_lat', 'start_lng', 'end_lat', 'end_lng'];
    for (const field of required) {
      if (!body[field]) throw new Error(`Missing required field: ${field}`);
    }
    const employeeId = user.role === 'employee'
      ? user.employee_id
      : requiredText(body.employee_id, 'Employee ID', 32);
    if (!employeeId) return jsonError(c, 400, 'This employee account is not linked to an employee record.');

    // Enforce the employee's own-record or manager-assigned scope.
    if (!await employeeIsInScope(c.env.DB, user, employeeId, { financial: true })) {
      return jsonError(c, 403, 'You do not have access to create journeys for this employee.');
    }

    const employee = await c.env.DB.prepare(
      'SELECT id FROM employees WHERE id = ? AND active = 1'
    ).bind(employeeId).first();
    if (!employee) return jsonError(c, 404, 'Active employee was not found.');
    const journey = {
      id: crypto.randomUUID(),
      employee_id: employeeId,
      travel_date: requiredText(body.travel_date, 'Travel date', 10),
      start_lat: numberValue(body.start_lat, 'Start latitude', 10),
      start_lng: numberValue(body.start_lng, 'Start longitude', 10),
      end_lat: numberValue(body.end_lat, 'End latitude', 10),
      end_lng: numberValue(body.end_lng, 'End longitude', 10),
      gps_distance_km: Number(body.gps_distance_km || 0),
      road_distance_km: Number(body.road_distance_km || 0),
      approved_distance_km: 0,
      status: 'submitted',
      notes: body.notes || ''
    };
    await c.env.DB.prepare(
      `INSERT INTO travel_journeys (id, employee_id, travel_date, start_lat, start_lng, end_lat, end_lng, gps_distance_km, road_distance_km, approved_distance_km, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(journey.id, journey.employee_id, journey.travel_date, journey.start_lat, journey.start_lng, journey.end_lat, journey.end_lng, journey.gps_distance_km, journey.road_distance_km, journey.approved_distance_km, journey.status, journey.notes).run();
    return c.json(journey, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to create travel journey.');
  }
});

app.post('/api/employee/travel/live', requireRoles('employee', 'admin', 'payroll'), async (c) => {
  try {
    const user = c.get('user');
    const body = await readJson(c);
    const action = body.action;

    if (action === 'start') {
      const employeeId = user.role === 'employee'
        ? user.employee_id
        : requiredText(body.employee_id, 'Employee ID', 32);
      if (!employeeId) return jsonError(c, 400, 'This employee account is not linked to an employee record.');

      // Enforce the employee's own-record or manager-assigned scope.
      if (!await employeeIsInScope(c.env.DB, user, employeeId, { financial: true })) {
        return jsonError(c, 403, 'You do not have access to start live tracking for this employee.');
      }

      const employee = await c.env.DB.prepare(
        'SELECT id FROM employees WHERE id = ? AND active = 1'
      ).bind(employeeId).first();
      if (!employee) return jsonError(c, 404, 'Active employee was not found.');
      const travelDate = requiredText(body.travel_date, 'Travel date', 10);
      if (!isIsoDate(travelDate)) throw new Error('Travel date must use YYYY-MM-DD format.');
      const journey = {
        id: crypto.randomUUID(),
        employee_id: employeeId,
        travel_date: travelDate,
        start_lat: numberValue(body.start_lat, 'Start latitude', 10),
        start_lng: numberValue(body.start_lng, 'Start longitude', 10),
        end_lat: numberValue(body.start_lat, 'End latitude', 10),
        end_lng: numberValue(body.start_lng, 'End longitude', 10),
        gps_distance_km: 0,
        road_distance_km: 0,
        approved_distance_km: 0,
        status: 'draft',
        notes: 'Live tracking started'
      };
      await c.env.DB.batch([
        c.env.DB.prepare(
        `INSERT INTO travel_journeys (id, employee_id, travel_date, start_lat, start_lng, end_lat, end_lng, gps_distance_km, road_distance_km, approved_distance_km, status, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        ).bind(journey.id, journey.employee_id, journey.travel_date, journey.start_lat, journey.start_lng, journey.end_lat, journey.end_lng, journey.gps_distance_km, journey.road_distance_km, journey.approved_distance_km, journey.status, journey.notes),
        c.env.DB.prepare(
          'INSERT INTO travel_live_sessions (journey_id, user_id) VALUES (?, ?)'
        ).bind(journey.id, user.id)
      ]);
      return c.json({ journeyId: journey.id, ...journey, status: 'live' }, 201);
    } else if (action === 'stop') {
      const journeyId = requiredText(body.journey_id, 'Journey ID', 64);
      const endLat = numberValue(body.end_lat, 'End latitude', 10);
      const endLng = numberValue(body.end_lng, 'End longitude', 10);
      const gpsKm = numberValue(body.gps_distance_km ?? 0, 'GPS distance (KM)', { maximum: 100000 });
      const roadKm = numberValue(body.road_distance_km ?? gpsKm, 'Road distance (KM)', { maximum: 100000 });

      const existing = await c.env.DB.prepare(
        `SELECT j.id, j.employee_id, l.user_id
         FROM travel_journeys j
         JOIN travel_live_sessions l ON l.journey_id = j.id
         WHERE j.id = ?`
      ).bind(journeyId).first();
      if (!existing) return jsonError(c, 404, 'Journey not found.');
      if (existing.user_id !== user.id) return jsonError(c, 403, 'You can only stop a journey started by your account.');

      // Use the recorded route points' cumulative distance when available;
      // the client-supplied start-to-end straight-line value is a fallback.
      const routeRow = await c.env.DB.prepare(
        'SELECT cumulative_km FROM travel_route_points WHERE journey_id = ? ORDER BY recorded_at DESC LIMIT 1'
      ).bind(journeyId).first();
      const routeKm = Number(routeRow?.cumulative_km ?? 0);
      const resolvedGpsKm = routeKm > 0 ? routeKm : gpsKm;
      const resolvedRoadKm = routeKm > 0 ? routeKm : roadKm;

      await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE travel_journeys
           SET end_lat = ?, end_lng = ?, gps_distance_km = ?, road_distance_km = ?,
               status = 'submitted', notes = 'Live GPS tracked journey', updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).bind(endLat, endLng, resolvedGpsKm, resolvedRoadKm, journeyId),
        c.env.DB.prepare(
          `UPDATE travel_live_sessions SET status = 'idle', last_point_at = ? WHERE journey_id = ?`
        ).bind(new Date().toISOString(), journeyId)
      ]);
      return c.json({ ok: true, journeyId, employee_id: existing.employee_id, status: 'submitted', gps_distance_km: resolvedGpsKm });
    } else {
      return jsonError(c, 400, 'Invalid action. Use "start" or "stop".');
    }
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to update live tracking.');
  }
});

app.get('/api/employee/slip', requireRoles('employee', 'admin', 'payroll'), async (c) => {
  const user = c.get('user');
  const month = c.req.query('month');
  if (!isMonth(month)) return jsonError(c, 400, 'Month must use YYYY-MM format.');

  // Employee accounts are pinned to their own record; other access is checked below.
  if (user.role === 'employee') {
    if (!user.employee_id) return jsonError(c, 400, 'This employee account is not linked to an employee record.');
  }
  const employeeId = user.role === 'employee' ? user.employee_id : c.req.query('employee_id');
  if (!employeeId) return jsonError(c, 400, 'Employee ID is required.');

  // Restrict employee accounts to their own payslip; Finance and Super Admin handle others.
  if (!await canReadEmployeePayslip(c.env.DB, user, employeeId)) {
    return jsonError(c, 403, 'You do not have access to this payslip.');
  }

  const [employeeRow, payrollRows, companySettings] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employeeId).first(),
    calculateMonth(c.env.DB, month),
    companySettingsFromDb(c.env.DB)
  ]);
  if (!employeeRow) return jsonError(c, 404, 'Employee was not found.');
  const payroll = payrollRows.find((row) => row.employeeId === employeeId);
  if (!payroll) return jsonError(c, 404, 'Payroll row was not found.');
  const slip = salarySlip(asEmployee(employeeRow), payroll);
  return c.json({ ...slip, company: companySettings });
});

app.get('/api/company-settings', requireRoles('admin', 'payroll'), async (c) => {
  const settings = await companySettingsFromDb(c.env.DB);
  return c.json(settings);
});

app.put('/api/company-settings', requireRoles('admin'), async (c) => {
  try {
    const body = await readJson(c);
    const statements = [];
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === 'string' || typeof value === 'number' || value === null) {
        statements.push(c.env.DB.prepare(
          `INSERT INTO company_settings (setting_key, setting_value) VALUES (?, ?)
           ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`
        ).bind(key, String(value ?? '')));
      }
    }
    if (statements.length) await c.env.DB.batch(statements);
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to save company settings.');
  }
});

/* Enhanced GPS travel tracking routes */
app.post('/api/travel/route-points', requireRoles('employee', 'admin', 'payroll'), async (c) => {
  try {
    const user = c.get('user');
    const body = await readJson(c);
    const journeyId = requiredText(body.journey_id, 'Journey ID', 64);
    const lat = numberValue(body.lat, 'Latitude', 10);
    const lng = numberValue(body.lng, 'Longitude', 10);
    const accuracy = Number(body.accuracy ?? 0);
    const speedKmh = Number(body.speed_kmh ?? 0);
    const headingDeg = Number(body.heading_deg ?? 0);
    const recordedAt = body.recorded_at || new Date().toISOString();

    const journey = await c.env.DB.prepare(
      `SELECT employee_id, status,
              EXISTS (SELECT 1 FROM travel_live_sessions WHERE journey_id = travel_journeys.id) AS is_live
       FROM travel_journeys WHERE id = ?`
    ).bind(journeyId).first();
    if (!journey) return jsonError(c, 404, 'Journey not found.');
    if (!['live', 'submitted', 'approved'].includes(journey.status) && !journey.is_live) {
      return jsonError(c, 400, `Cannot record points for journey with status: ${journey.status}`);
    }
    if (!await employeeIsInScope(c.env.DB, user, journey.employee_id, { financial: true })) {
      return jsonError(c, 403, 'You do not have access to record points for this journey.');
    }

    // Get previous point for distance calculation
    const prevPoint = await c.env.DB.prepare(
      'SELECT lat, lng, cumulative_km FROM travel_route_points WHERE journey_id = ? ORDER BY recorded_at DESC LIMIT 1'
    ).bind(journeyId).first();

    const prevCumulative = prevPoint ? Number(prevPoint.cumulative_km || 0) : 0;
    const distanceFromPrev = prevPoint
      ? haversineKm(lat, lng, Number(prevPoint.lat), Number(prevPoint.lng))
      : 0;

    const point = {
      id: crypto.randomUUID(),
      journey_id: journeyId,
      lat,
      lng,
      accuracy,
      speed_kmh,
      heading_deg: headingDeg,
      recorded_at: recordedAt,
      distance_from_prev_km: distanceFromPrev,
      cumulative_km: prevCumulative + distanceFromPrev
    };

    await c.env.DB.prepare(
      `INSERT INTO travel_route_points (id, journey_id, lat, lng, accuracy, speed_kmh, heading_deg, recorded_at, distance_from_prev_km, cumulative_km)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(point.id, point.journey_id, point.lat, point.lng, point.accuracy, point.speed_kmh, point.heading_deg, point.recorded_at, point.distance_from_prev_km, point.cumulative_km).run();

    // A successful GPS point means the employee is currently tracking.
    if (journey.is_live) {
      await c.env.DB.prepare(
        `UPDATE travel_live_sessions SET status = 'live', last_point_at = ? WHERE journey_id = ?`
      ).bind(point.recorded_at, journeyId).run();
    }

    return c.json(point, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to record GPS point.');
  }
});

app.get('/api/travel/route-points/:journey_id', requireRoles('employee', 'admin', 'payroll'), async (c) => {
  const user = c.get('user');
  const journeyId = c.req.param('journey_id');

  const journey = await c.env.DB.prepare('SELECT employee_id FROM travel_journeys WHERE id = ?').bind(journeyId).first();
  if (!journey) return jsonError(c, 404, 'Journey not found.');
  if (!await employeeIsInScope(c.env.DB, user, journey.employee_id, { financial: true })) {
    return jsonError(c, 403, 'You do not have access to view points for this journey.');
  }

  const rows = await c.env.DB.prepare(
    'SELECT * FROM travel_route_points WHERE journey_id = ? ORDER BY recorded_at'
  ).bind(journeyId).all();

  return c.json(rows.results);
});

app.post('/api/travel/stoppage', requireRoles('employee', 'admin', 'payroll'), async (c) => {
  try {
    const user = c.get('user');
    const body = await readJson(c);
    const journeyId = requiredText(body.journey_id, 'Journey ID', 64);
    const lat = numberValue(body.lat, 'Latitude', 10);
    const lng = numberValue(body.lng, 'Longitude', 10);
    const durationMinutes = numberValue(body.duration_minutes, 'Duration', { minimum: 0 });
    const reason = optionalText(body.reason, 'Reason', 200);

    const journey = await c.env.DB.prepare('SELECT employee_id FROM travel_journeys WHERE id = ?').bind(journeyId).first();
    if (!journey) return jsonError(c, 404, 'Journey not found.');
    if (!await employeeIsInScope(c.env.DB, user, journey.employee_id, { financial: true })) {
      return jsonError(c, 403, 'You do not have access to record stoppages for this journey.');
    }

    const stoppage = {
      id: crypto.randomUUID(),
      journey_id: journeyId,
      lat,
      lng,
      duration_minutes: durationMinutes,
      reason,
      recorded_at: new Date().toISOString()
    };

    await c.env.DB.prepare(
      `INSERT INTO travel_stoppages (id, journey_id, lat, lng, duration_minutes, reason, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(stoppage.id, stoppage.journey_id, stoppage.lat, stoppage.lng, stoppage.duration_minutes, stoppage.reason, stoppage.recorded_at).run();

    return c.json(stoppage, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to record stoppage.');
  }
});

app.post('/api/travel/odometer', requireRoles('employee', 'admin', 'payroll'), async (c) => {
  try {
    const user = c.get('user');
    const body = await readJson(c);
    const journeyId = requiredText(body.journey_id, 'Journey ID', 64);
    const beforePhoto = optionalText(body.before_photo_url, 'Before photo');
    const afterPhoto = optionalText(body.after_photo_url, 'After photo');
    const beforeOdometer = Number(body.before_odometer_km ?? 0);
    const afterOdometer = Number(body.after_odometer_km ?? 0);

    const journey = await c.env.DB.prepare('SELECT employee_id FROM travel_journeys WHERE id = ?').bind(journeyId).first();
    if (!journey) return jsonError(c, 404, 'Journey not found.');
    if (!await employeeIsInScope(c.env.DB, user, journey.employee_id, { financial: true })) {
      return jsonError(c, 403, 'You do not have access to record odometer data for this journey.');
    }

    const actualKm = Math.max(0, afterOdometer - beforeOdometer);
    const claimedKm = Number(body.claimed_km || 0);
    const discrepancy = Math.abs(actualKm - claimedKm);

    const record = {
      id: crypto.randomUUID(),
      journey_id: journeyId,
      before_photo_url: beforePhoto,
      after_photo_url: afterPhoto,
      before_odometer_km: beforeOdometer,
      after_odometer_km: afterOdometer,
      actual_km: actualKm,
      claimed_km: claimedKm,
      discrepancy_km: discrepancy,
      verified: 0,
      recorded_at: new Date().toISOString()
    };

    await c.env.DB.prepare(
      `INSERT INTO travel_odometer (id, journey_id, before_photo_url, after_photo_url, before_odometer_km, after_odometer_km, actual_km, claimed_km, discrepancy_km, verified, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(record.id, record.journey_id, record.before_photo_url, record.after_photo_url, record.before_odometer_km, record.after_odometer_km, record.actual_km, record.claimed_km, record.discrepancy_km, record.verified, record.recorded_at).run();

    return c.json(record, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to record odometer.');
  }
});

app.post('/api/travel/expense-claim', requireRoles('employee', 'admin', 'payroll'), async (c) => {
  try {
    const user = c.get('user');
    const body = await readJson(c);
    const journeyId = requiredText(body.journey_id, 'Journey ID', 64);
    const claimedKm = numberValue(body.claimed_km, 'Claimed KM', { minimum: 0, maximum: 100000 });

    const journey = await c.env.DB.prepare('SELECT employee_id FROM travel_journeys WHERE id = ?').bind(journeyId).first();
    if (!journey) return jsonError(c, 404, 'Journey not found.');
    if (!await employeeIsInScope(c.env.DB, user, journey.employee_id, { financial: true })) {
      return jsonError(c, 403, 'You do not have access to submit claims for this journey.');
    }

    // Calculate TA/DA
    const travelSettings = await travelSettingsFromDb(c.env.DB);
    const allowance = travelAllowance(claimedKm, travelSettings);

    const claim = {
      id: crypto.randomUUID(),
      journey_id: journeyId,
      employee_id: journey.employee_id,
      claimed_km: claimedKm,
      approved_km: 0,
      ta_amount: allowance.ta,
      da_amount: allowance.da,
      total_claim: allowance.total,
      status: 'pending'
    };

    await c.env.DB.prepare(
      `INSERT INTO travel_expense_claims (id, journey_id, employee_id, claimed_km, approved_km, ta_amount, da_amount, total_claim, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(claim.id, claim.journey_id, claim.employee_id, claim.claimed_km, claim.approved_km, claim.ta_amount, claim.da_amount, claim.total_claim, claim.status).run();

    return c.json(claim, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to submit expense claim.');
  }
});

app.put('/api/travel/expense-claims/:id', requireRoles('admin', 'payroll'), async (c) => {
  try {
    const claim = await c.env.DB.prepare('SELECT * FROM travel_expense_claims WHERE id = ?').bind(c.req.param('id')).first();
    if (!claim) return jsonError(c, 404, 'Expense claim not found.');
    if (!await employeeIsInScope(c.env.DB, c.get('user'), claim.employee_id, { financial: true })) {
      return jsonError(c, 403, 'You do not have access to update this expense claim.');
    }
    const body = await readJson(c);
    const status = body.status;
    if (!['approved', 'rejected', 'adjusted'].includes(status)) throw new Error('Invalid status.');
    const approvedKm = numberValue(body.approved_km ?? claim.approved_km, 'Approved KM', { minimum: 0, maximum: 100000 });

    // Recalculate TA/DA
    const travelSettings = await travelSettingsFromDb(c.env.DB);
    const allowance = travelAllowance(approvedKm, travelSettings);

    await c.env.DB.prepare(
      `UPDATE travel_expense_claims SET approved_km = ?, ta_amount = ?, da_amount = ?, total_claim = ?, status = ?, approved_by = ?, approved_at = ?, rejection_reason = COALESCE(?, rejection_reason), updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(approvedKm, allowance.ta, allowance.da, allowance.total, status, c.get('user')?.id, status === 'approved' ? new Date().toISOString() : null, optionalText(body.rejection_reason, 'Rejection reason'), c.req.param('id')).run();

    return c.json({ ok: true, id: c.req.param('id'), status, approved_km: approvedKm });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to update expense claim.');
  }
});

app.get('/api/travel/expense-claims', requireRoles('admin', 'payroll'), async (c) => {
  const scope = await employeeScopePredicate(c.env.DB, c.get('user'), 'e', { financial: true });
  const rows = await c.env.DB.prepare(
    `SELECT ec.*, j.travel_date, e.name AS employee_name
     FROM travel_expense_claims ec
     JOIN travel_journeys j ON j.id = ec.journey_id
     JOIN employees e ON e.id = ec.employee_id
     WHERE ${scope.sql}
     ORDER BY ec.created_at DESC LIMIT 500`
  ).bind(...scope.bindings).all();
  return c.json(rows.results);
});

/* Customer/Doctor master management */
app.get('/api/travel/customers', requireRoles('admin', 'hr', 'payroll', 'employee'), async (c) => {
  const user = c.get('user');
  const employeeId = await selfServiceOnly(c.env.DB, user) ? user.employee_id : c.req.query('employee_id');
  if (employeeId && !await employeeIsInScope(c.env.DB, user, employeeId)) {
    return jsonError(c, 403, 'You do not have access to this employee customer list.');
  }
  const activeOnly = c.req.query('active') === 'true';
  const scope = await employeeScopePredicate(c.env.DB, user, 'e');
  let query = `SELECT tc.* FROM travel_customers tc
               JOIN employees e ON e.id = tc.employee_id`;
  const conditions = [scope.sql];
  const bindings = [...scope.bindings];
  if (employeeId) {
    conditions.push('tc.employee_id = ?');
    bindings.push(employeeId);
  }
  if (activeOnly) {
    conditions.push('tc.active = 1');
  }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY tc.name';
  const rows = await c.env.DB.prepare(query).bind(...bindings).all();
  return c.json(rows.results);
});

app.post('/api/travel/customers', requireRoles('admin', 'hr'), async (c) => {
  try {
    const body = await readJson(c);
    const user = c.get('user');
    const employeeId = requiredText(body.employee_id, 'Employee ID', 32);
    if (!await employeeIsInScope(c.env.DB, user, employeeId)) {
      return jsonError(c, 403, 'You do not have access to create customers for this employee.');
    }
    const customer = {
      id: crypto.randomUUID(),
      employee_id: employeeId,
      name: requiredText(body.name, 'Customer name', 100),
      customer_type: body.customer_type || 'doctor',
      location: body.location || '',
      lat: body.lat ? numberValue(body.lat, 'Latitude', { minimum: -90, maximum: 90 }) : null,
      lng: body.lng ? numberValue(body.lng, 'Longitude', { minimum: -180, maximum: 180 }) : null,
      territory: body.territory || '',
      phone: body.phone || '',
      notes: body.notes || ''
    };
    await c.env.DB.prepare(
      `INSERT INTO travel_customers (id, employee_id, name, customer_type, location, lat, lng, territory, phone, notes, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(
      customer.id, customer.employee_id, customer.name, customer.customer_type,
      customer.location, customer.lat, customer.lng, customer.territory,
      customer.phone, customer.notes
    ).run();
    return c.json(customer, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to create customer.');
  }
});

app.put('/api/travel/customers/:id', requireRoles('admin', 'hr'), async (c) => {
  try {
    const current = await c.env.DB.prepare(
      'SELECT employee_id FROM travel_customers WHERE id = ?'
    ).bind(c.req.param('id')).first();
    if (!current) return jsonError(c, 404, 'Customer not found.');
    if (!await employeeIsInScope(c.env.DB, c.get('user'), current.employee_id)) {
      return jsonError(c, 403, 'You do not have access to update this customer.');
    }
    const body = await readJson(c);
    const updates = {
      name: body.name,
      customer_type: body.customer_type,
      location: body.location,
      lat: body.lat,
      lng: body.lng,
      territory: body.territory,
      phone: body.phone,
      notes: body.notes,
      active: body.active
    };
    await c.env.DB.prepare(
      `UPDATE travel_customers SET name = ?, customer_type = ?, location = ?, lat = ?, lng = ?,
        territory = ?, phone = ?, notes = ?, active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(
      updates.name, updates.customer_type, updates.location,
      updates.lat, updates.lng, updates.territory, updates.phone,
      updates.notes, updates.active, c.req.param('id')
    ).run();
    const updated = await c.env.DB.prepare('SELECT * FROM travel_customers WHERE id = ?').bind(c.req.param('id')).first();
    return c.json(updated);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to update customer.');
  }
});

app.delete('/api/travel/customers/:id', requireRoles('admin', 'hr'), async (c) => {
  const customer = await c.env.DB.prepare(
    'SELECT employee_id FROM travel_customers WHERE id = ?'
  ).bind(c.req.param('id')).first();
  if (!customer) return jsonError(c, 404, 'Customer not found.');
  if (!await employeeIsInScope(c.env.DB, c.get('user'), customer.employee_id)) {
    return jsonError(c, 403, 'You do not have access to delete this customer.');
  }
  await c.env.DB.prepare('DELETE FROM travel_customers WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

/* Punch in/out attendance for field force */
app.get('/api/travel/punch', requireRoles('admin', 'employee'), async (c) => {
  const user = c.get('user');
  const employeeId = user?.role === 'employee' ? user.employee_id : c.req.query('employee_id');
  const punchDate = c.req.query('date');
  if (!employeeId) return jsonError(c, 400, 'Employee ID is required.');
  if (!await employeeIsInScope(c.env.DB, user, employeeId)) {
    return jsonError(c, 403, 'You do not have access to these attendance punches.');
  }
  const rows = await c.env.DB.prepare(
    `SELECT * FROM travel_punch_events
     WHERE employee_id = ? AND punch_date = ?
     ORDER BY recorded_at`
  ).bind(employeeId, punchDate || new Date().toISOString().slice(0, 10)).all();
  return c.json(rows.results);
});

app.post('/api/travel/punch', requireRoles('admin', 'employee'), async (c) => {
  try {
    const user = c.get('user');
    const body = await readJson(c);
    const direction = body.direction; // 'in' or 'out'
    const punchDate = body.punch_date || new Date().toISOString().slice(0, 10);
    const employeeId = user.role === 'employee' ? user.employee_id : body.employee_id;
    if (!employeeId) return jsonError(c, 400, 'Employee ID is required.');
    if (!await canRecordAttendancePunch(c.env.DB, user, employeeId)) {
      return jsonError(c, 403, 'You do not have access to record this attendance punch.');
    }
    if (!['in', 'out'].includes(direction)) throw new Error('Direction must be "in" or "out".');
    const selfieUrl = requiredText(body.selfie_url, 'Live selfie', 1_800_000);
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(selfieUrl)) {
      throw new Error('Capture a live selfie from the camera before submitting this punch.');
    }

    // Check for existing punch on same date for same direction
    const existing = await c.env.DB.prepare(
      'SELECT id FROM travel_punch_events WHERE employee_id = ? AND punch_date = ? AND direction = ?'
    ).bind(employeeId, punchDate, direction).first();
    if (existing) return jsonError(c, 409, `Punch for direction "${direction}" already exists for this date.`);

    const punch = {
      id: crypto.randomUUID(),
      employee_id: employeeId,
      punch_date: punchDate,
      direction,
      lat: body.lat ? numberValue(body.lat, 'Latitude') : null,
      lng: body.lng ? numberValue(body.lng, 'Longitude') : null,
      accuracy: body.accuracy ? numberValue(body.accuracy, 'GPS accuracy') : null,
      selfie_url: selfieUrl,
      face_verified: 0,
      notes: body.notes || '',
      recorded_at: new Date().toISOString()
    };
    await c.env.DB.prepare(
      `INSERT INTO travel_punch_events (id, employee_id, punch_date, direction, lat, lng, accuracy, selfie_url, face_verified, notes, recorded_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(
      punch.id, punch.employee_id, punch.punch_date, punch.direction,
      punch.lat, punch.lng, punch.accuracy, punch.selfie_url,
      punch.face_verified, punch.notes, punch.recorded_at
    ).run();
    return c.json(punch, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to record punch.');
  }
});

// Sync punch events into the attendance ledger so a punched-in day counts as
// paid in payroll. Manual attendance edits (source = '') are never overwritten.
app.post('/api/travel/punch/sync', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  try {
    const user = c.get('user');
    if (user.access_control_enabled !== undefined) {
      const roles = user.access_roles || await assignedAccessRoles(c.env.DB, user.id);
      if (!roles.includes('super_admin') && !roles.includes('hr_admin')) {
        return jsonError(c, 403, 'HR Admin or Super Admin access is required to sync attendance punches.');
      }
    }
    const body = await readJson(c);
    const month = body.month;
    if (!isMonth(month)) return jsonError(c, 400, 'Month must use YYYY-MM format.');
    const firstDay = `${month}-01`;
    const lastDay = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;

    const [punches, manualRows] = await Promise.all([
      c.env.DB.prepare(
        `SELECT employee_id, punch_date, direction FROM travel_punch_events
         WHERE punch_date >= ? AND punch_date <= ?`
      ).bind(firstDay, lastDay).all(),
      c.env.DB.prepare(
        `SELECT employee_id, work_date FROM attendance_days
         WHERE work_date >= ? AND work_date <= ? AND (source = '' OR source IS NULL)`
      ).bind(firstDay, lastDay).all()
    ]);
    const manualKeys = new Set(manualRows.results.map((row) => `${row.employee_id}|${row.work_date}`));

    const byDay = new Map();
    for (const row of punches.results) {
      const key = `${row.employee_id}|${row.punch_date}`;
      if (!byDay.has(key)) byDay.set(key, { employee_id: row.employee_id, punch_date: row.punch_date, in: false, out: false });
      if (row.direction === 'in') byDay.get(key).in = true;
      if (row.direction === 'out') byDay.get(key).out = true;
    }

    const statements = [];
    for (const day of byDay.values()) {
      const key = `${day.employee_id}|${day.punch_date}`;
      if (manualKeys.has(key)) continue; // manual edit wins
      if (!day.in && !day.out) continue;
      const status = (day.in && day.out) ? 'P' : 'R';
      statements.push(c.env.DB.prepare(
        `INSERT INTO attendance_days (employee_id, work_date, status, source)
         VALUES (?, ?, ?, 'punch')
         ON CONFLICT(employee_id, work_date) DO UPDATE SET status = excluded.status, source = 'punch'`
      ).bind(day.employee_id, day.punch_date, status));
    }
    for (let offset = 0; offset < statements.length; offset += 100) {
      await c.env.DB.batch(statements.slice(offset, offset + 100));
    }
    return c.json({ synced: statements.length, month });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to sync punch attendance.');
  }
});

/* Expense bills/photos for claims */
app.get('/api/travel/expense-bills', requireRoles('admin', 'payroll'), async (c) => {
  const claimId = c.req.query('claim_id');
  const employeeId = c.req.query('employee_id');
  const user = c.get('user');
  if (employeeId && !await employeeIsInScope(c.env.DB, user, employeeId, { financial: true })) {
    return jsonError(c, 403, 'You do not have access to these expense bills.');
  }
  const scope = await employeeScopePredicate(c.env.DB, user, 'e', { financial: true });
  let query = `SELECT eb.*, e.name AS employee_name FROM travel_expense_bills eb
               JOIN employees e ON e.id = eb.employee_id`;
  const conditions = [scope.sql];
  const bindings = [...scope.bindings];
  if (claimId) {
    conditions.push('eb.claim_id = ?');
    bindings.push(claimId);
  }
  if (employeeId) {
    conditions.push('eb.employee_id = ?');
    bindings.push(employeeId);
  }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY eb.created_at DESC LIMIT 500';
  const rows = await c.env.DB.prepare(query).bind(...bindings).all();
  return c.json(rows.results);
});

app.post('/api/travel/expense-bills', requireRoles('admin', 'payroll'), async (c) => {
  try {
    const body = await readJson(c);
    const linked = await resolveExpenseBillEmployee(c.env.DB, body);
    if (!await employeeIsInScope(c.env.DB, c.get('user'), linked.employeeId, { financial: true })) {
      return jsonError(c, 403, 'You do not have access to create an expense bill for this employee.');
    }
    const bill = {
      id: crypto.randomUUID(),
      claim_id: linked.claimId,
      journey_id: linked.journeyId,
      employee_id: linked.employeeId,
      bill_date: body.bill_date || new Date().toISOString().slice(0, 10),
      category: body.category || 'travel',
      amount: numberValue(body.amount, 'Amount', { minimum: 0 }),
      description: body.description || '',
      photo_url: body.photo_url || '',
      status: 'pending'
    };
    await c.env.DB.prepare(
      `INSERT INTO travel_expense_bills (id, claim_id, journey_id, employee_id, bill_date, category, amount, description, photo_url, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(
      bill.id, bill.claim_id, bill.journey_id, bill.employee_id,
      bill.bill_date, bill.category, bill.amount, bill.description, bill.photo_url
    ).run();
    return c.json(bill, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to create expense bill.');
  }
});

app.put('/api/travel/expense-bills/:id', requireRoles('admin', 'payroll'), async (c) => {
  try {
    const body = await readJson(c);
    const current = await c.env.DB.prepare(
      'SELECT * FROM travel_expense_bills WHERE id = ?'
    ).bind(c.req.param('id')).first();
    if (!current) return jsonError(c, 404, 'Expense bill not found.');
    const linked = await resolveExpenseBillEmployee(c.env.DB, {
      ...current,
      ...body,
      employee_id: body.employee_id ?? current.employee_id,
      claim_id: body.claim_id ?? current.claim_id,
      journey_id: body.journey_id ?? current.journey_id
    });
    if (!await employeeIsInScope(c.env.DB, c.get('user'), current.employee_id, { financial: true })
      || !await employeeIsInScope(c.env.DB, c.get('user'), linked.employeeId, { financial: true })) {
      return jsonError(c, 403, 'You do not have access to update this expense bill.');
    }
    await c.env.DB.prepare(
      `UPDATE travel_expense_bills SET claim_id = ?, journey_id = ?, employee_id = ?, bill_date = ?, category = ?, amount = ?, description = ?, photo_url = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(
      linked.claimId, linked.journeyId, linked.employeeId,
      body.bill_date ?? current.bill_date, body.category ?? current.category,
      body.amount ?? current.amount, body.description ?? current.description,
      body.photo_url ?? current.photo_url, body.status ?? current.status, c.req.param('id')
    ).run();
    const updated = await c.env.DB.prepare('SELECT * FROM travel_expense_bills WHERE id = ?').bind(c.req.param('id')).first();
    return c.json(updated);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to update expense bill.');
  }
});

app.delete('/api/travel/expense-bills/:id', requireRoles('admin', 'payroll'), async (c) => {
  const current = await c.env.DB.prepare(
    'SELECT employee_id FROM travel_expense_bills WHERE id = ?'
  ).bind(c.req.param('id')).first();
  if (!current) return jsonError(c, 404, 'Expense bill not found.');
  if (!await employeeIsInScope(c.env.DB, c.get('user'), current.employee_id, { financial: true })) {
    return jsonError(c, 403, 'You do not have access to delete this expense bill.');
  }
  await c.env.DB.prepare('DELETE FROM travel_expense_bills WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

/* ============================================================
   5-LEVEL REPORTING HIERARCHY
   ============================================================ */
// Get all employees with hierarchy info for admin
app.get('/api/hierarchy/employees', requireRoles('admin', 'hr'), async (c) => {
  const scope = await employeeScopePredicate(c.env.DB, c.get('user'), 'e');
  const rows = await c.env.DB.prepare(
    `SELECT e.id, e.name, e.department, e.designation, e.area, e.region,
            e.reports_to, e.hierarchy_level, e.active,
            u.id AS user_id, u.username,
            r.id AS reporter_id, r.name AS reporter_name
     FROM employees e
     LEFT JOIN users u ON u.employee_id = e.id
     LEFT JOIN employees r ON r.id = e.reports_to
     WHERE e.active = 1 AND ${scope.sql}
     ORDER BY e.hierarchy_level, e.department, e.name`
  ).bind(...scope.bindings).all();
  return c.json(rows.results);
});

// Update employee reporting hierarchy
app.put('/api/hierarchy/employees/:id', requireRoles('admin', 'hr'), async (c) => {
  try {
    const body = await readJson(c);
    const empId = c.req.param('id');
    const user = c.get('user');
    if (!await employeeIsInScope(c.env.DB, user, empId)) {
      return jsonError(c, 403, 'You do not have access to update this employee hierarchy.');
    }
    const reportsTo = body.reports_to || null;
    const designation = body.designation || '';
    const hierarchyLevel = body.hierarchy_level || 5;
    const department = body.department || '';
    const region = body.region || '';
    const area = body.area || '';

    if (reportsTo && !await employeeIsInScope(c.env.DB, user, reportsTo)) {
      return jsonError(c, 403, 'The reporting manager is outside your organizational scope.');
    }
    if (reportsTo) {
      const descendants = await c.env.DB.prepare(`
        WITH RECURSIVE reports(id) AS (
          SELECT id FROM employees WHERE reports_to = ?
          UNION
          SELECT employee.id FROM employees employee JOIN reports ON employee.reports_to = reports.id
        )
        SELECT 1 FROM reports WHERE id = ? LIMIT 1
      `).bind(empId, reportsTo).first();
      if (descendants) throw new Error('The reporting relationship would create a cycle.');
    }

    await c.env.DB.prepare(
      `UPDATE employees SET reports_to = ?, designation = ?, hierarchy_level = ?, department = ?, region = ?, area = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(reportsTo, designation, hierarchyLevel, department, region, area, empId).run();

    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to update hierarchy.');
  }
});

// Get direct reports for a manager
app.get('/api/hierarchy/reports/:manager_id', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  const managerId = c.req.param('manager_id');
  const user = c.get('user');
  if (!await employeeIsInScope(c.env.DB, user, managerId)) {
    return jsonError(c, 403, 'You do not have access to this reporting structure.');
  }
  const scope = await employeeScopePredicate(c.env.DB, user, 'e');
  const rows = await c.env.DB.prepare(
    `SELECT e.id, e.name, e.designation, e.department, e.area, e.region, e.reports_to
     FROM employees e WHERE e.reports_to = ? AND e.active = 1 AND ${scope.sql}
     ORDER BY e.name`
  ).bind(managerId, ...scope.bindings).all();
  return c.json(rows.results);
});

// Get all reports (subtree) for a manager
app.get('/api/hierarchy/reports-all/:manager_id', requireRoles('admin', 'hr'), async (c) => {
  const managerId = c.req.param('manager_id');
  const user = c.get('user');
  if (!await employeeIsInScope(c.env.DB, user, managerId)) {
    return jsonError(c, 403, 'You do not have access to this reporting structure.');
  }
  const scope = await employeeScopePredicate(c.env.DB, user, 'e');
  const rows = await c.env.DB.prepare(
    `WITH RECURSIVE report_tree AS (
       SELECT e.id, e.name, e.designation, e.department, e.area, e.region, e.reports_to, e.hierarchy_level
       FROM employees e WHERE e.id = ? AND e.active = 1 AND ${scope.sql}
       UNION
       SELECT e.id, e.name, e.designation, e.department, e.area, e.region, e.reports_to, e.hierarchy_level
       FROM employees e
       JOIN report_tree rt ON e.reports_to = rt.id
       WHERE e.active = 1 AND ${scope.sql}
     )
     SELECT * FROM report_tree ORDER BY hierarchy_level, department, name`
  ).bind(managerId, ...scope.bindings, ...scope.bindings).all();
  return c.json(rows.results);
});

/* ============================================================
   EXPENSE MANAGEMENT — Configurable sequential approval
   ============================================================ */
// Submit new expense
app.post('/api/expenses', requireRoles('employee', 'admin', 'hr', 'payroll'), async (c) => {
  try {
    const body = await readJson(c);
    const user = c.get('user');
    const employeeId = await selfServiceOnly(c.env.DB, user)
      ? user.employee_id
      : (body.employee_id || user.employee_id);
    if (!employeeId) return jsonError(c, 400, 'Employee ID required.');
    if (!await employeeIsInScope(c.env.DB, user, employeeId, { financial: true })) {
      return jsonError(c, 403, 'You do not have access to submit expenses for this employee.');
    }
    const amount = numberValue(body.amount, 'Amount', { minimum: 0 });
    const approvalWorkflow = await activeApprovalWorkflow(c.env.DB, 'expense', amount);
    if (!approvalWorkflow?.firstApprovalLevel) {
      return jsonError(c, 400, 'Expense submissions are unavailable until an approval workflow has at least one manual approver.');
    }
    const expenseDate = requiredText(body.expense_date, 'Expense date', 10);
    if (!isIsoDate(expenseDate)) return jsonError(c, 400, 'Expense date must be a valid date.');

    const expense = {
      id: crypto.randomUUID(),
      employee_id: employeeId,
      expense_type: requiredText(body.expense_type, 'Expense type', 50),
      amount,
      description: optionalText(body.description, 'Description', 500),
      expense_date: expenseDate,
      bill_photo: body.bill_photo || '',
      journey_id: body.journey_id || null,
      status: 'pending',
      approval_workflow_id: approvalWorkflow.workflow.id,
      current_approver_level: approvalWorkflow.firstApprovalLevel.order_index
    };

    await c.env.DB.prepare(
      `INSERT INTO travel_expenses (id, employee_id, expense_type, amount, description, expense_date, bill_photo, journey_id, status, current_approver_level, approval_workflow_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(expense.id, expense.employee_id, expense.expense_type, expense.amount, expense.description, expense.expense_date, expense.bill_photo, expense.journey_id, expense.status, expense.current_approver_level, expense.approval_workflow_id).run();

    return c.json(expense, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to create expense.');
  }
});

// Get expenses for current user
app.get('/api/expenses/mine', requireRoles('employee'), async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT e.*, emp.name AS employee_name, j.travel_date AS journey_date
     FROM travel_expenses e
     JOIN employees emp ON emp.id = e.employee_id
     LEFT JOIN travel_journeys j ON j.id = e.journey_id
     WHERE e.employee_id = ?
     ORDER BY e.created_at DESC`
  ).bind(user.employee_id).all();
  return c.json(await addExpenseApprovalChains(c.env.DB, rows.results));
});

// Get expenses by level (for managers)
app.get('/api/expenses/by-level/:level', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  const level = Number(c.req.param('level'));
  const user = c.get('user');
  const statusFilter = c.req.query('status') || 'pending';
  const scope = await employeeScopePredicate(c.env.DB, user, 'emp', { financial: true });
  const rows = await c.env.DB.prepare(
    `SELECT e.*, emp.name AS employee_name, u.username
     FROM travel_expenses e
     JOIN employees emp ON emp.id = e.employee_id
     LEFT JOIN users u ON u.employee_id = emp.id
     WHERE e.current_approver_level = ? AND e.status = ? AND ${scope.sql}
     ORDER BY e.created_at DESC`
  ).bind(level, statusFilter, ...scope.bindings).all();
  return c.json(rows.results);
});

// Get all expenses (admin view)
app.get('/api/expenses', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  const status = c.req.query('status');
  const employeeId = c.req.query('employee_id');
  const type = c.req.query('type');
  const scope = await employeeScopePredicate(c.env.DB, c.get('user'), 'emp', { financial: true });
  let query = `SELECT e.*, emp.name AS employee_name, u.username,
               j.travel_date AS journey_date, j.approved_distance_km
               FROM travel_expenses e
               JOIN employees emp ON emp.id = e.employee_id
               LEFT JOIN users u ON u.employee_id = emp.id
               LEFT JOIN travel_journeys j ON j.id = e.journey_id`;
  const conditions = [];
  const bindings = [];
  conditions.push(scope.sql);
  bindings.push(...scope.bindings);
  if (status) { conditions.push('e.status = ?'); bindings.push(status); }
  if (employeeId) { conditions.push('e.employee_id = ?'); bindings.push(employeeId); }
  if (type) { conditions.push('e.expense_type = ?'); bindings.push(type); }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY e.created_at DESC LIMIT 500';
  const rows = await c.env.DB.prepare(query).bind(...bindings).all();
  return c.json(await addExpenseApprovalChains(c.env.DB, rows.results));
});

app.get('/api/expenses/approvals', requireRoles('admin', 'hr', 'payroll', 'employee'), async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(`
    SELECT e.*, emp.name AS employee_name, u.username,
           j.travel_date AS journey_date, j.approved_distance_km
    FROM travel_expenses e
    JOIN employees emp ON emp.id = e.employee_id
    LEFT JOIN users u ON u.employee_id = emp.id
    LEFT JOIN travel_journeys j ON j.id = e.journey_id
    WHERE e.status = 'pending'
    ORDER BY e.created_at DESC
    LIMIT 500
  `).all();
  const expenses = await addExpenseApprovalChains(c.env.DB, rows.results || []);
  const approverEmployee = user.employee_id ? await c.env.DB.prepare(
    'SELECT designation, hierarchy_level FROM employees WHERE id = ?'
  ).bind(user.employee_id).first() : null;
  const approvable = [];
  for (const expense of expenses) {
    if (expense.employee_id === user.employee_id) continue;
    const level = expense.approval_chain.find(
      (item) => Number(item.order_index) === Number(expense.current_approver_level)
    );
    if (level && !level.auto_approve && await canApproveWorkflowLevel(c.env.DB, user, level, approverEmployee, expense.employee_id)) {
      approvable.push({ ...expense, can_approve_current: true });
    }
  }
  return c.json(approvable);
});

// Approve/Reject at any level
app.put('/api/expenses/:id/approve', requireRoles('admin', 'hr', 'payroll', 'employee'), async (c) => {
  try {
    const body = await readJson(c);
    const action = requiredText(body.action, 'Action', 20);
    const comments = optionalText(body.comments, 'Comments', 500);
    const expenseId = c.req.param('id');
    const user = c.get('user');

    const expense = await c.env.DB.prepare(
      'SELECT * FROM travel_expenses WHERE id = ?'
    ).bind(expenseId).first();
    if (!expense) return jsonError(c, 404, 'Expense not found.');
    if (!['approved', 'rejected', 'returned'].includes(action)) return jsonError(c, 400, 'Action must be approved, rejected, or returned.');
    if (!expense.approval_workflow_id) {
      return jsonError(c, 409, 'This legacy expense has no configured approval workflow and cannot be processed.');
    }

    if (user.employee_id && expense.employee_id === user.employee_id) {
      return jsonError(c, 403, 'You cannot approve, reject, or return your own expense.');
    }
    if (action === 'rejected' && !comments) return jsonError(c, 400, 'A rejection reason is required.');

    if (expense.approval_workflow_id) {
      if (expense.status !== 'pending') return jsonError(c, 409, 'This expense is not awaiting approval.');
      const levelsResult = await c.env.DB.prepare(
        'SELECT * FROM approval_workflow_levels WHERE workflow_id = ? ORDER BY order_index DESC'
      ).bind(expense.approval_workflow_id).all();
      const levels = levelsResult.results || [];
      const currentLevel = levels.find((level) => Number(level.order_index) === Number(expense.current_approver_level));
      if (!currentLevel || currentLevel.auto_approve) return jsonError(c, 409, 'The expense approval step is no longer configured.');
      if (!await canApproveWorkflowLevel(c.env.DB, user, currentLevel, undefined, expense.employee_id)) {
        return jsonError(c, 403, 'You are not an approver for the current workflow step.');
      }

      const approverName = user.employee_id ? await c.env.DB.prepare(
        'SELECT name FROM employees WHERE id = ?'
      ).bind(user.employee_id).then((result) => result.first()?.name || 'System') : 'System';
      const auditId = crypto.randomUUID();
      if (action === 'approved') {
        const nextLevel = nextApprovalLevel(levels, currentLevel.order_index, expense.amount);
        const status = nextLevel ? 'pending' : 'finance_approved';
        const results = await c.env.DB.batch([
          c.env.DB.prepare(
          `UPDATE travel_expenses
           SET current_approver_level = ?, status = ?, current_approver_name = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'pending' AND current_approver_level = ?`
          ).bind(nextLevel?.order_index ?? 0, status, approverName, expenseId, currentLevel.order_index),
          c.env.DB.prepare(
            `INSERT INTO travel_expense_approvals
              (id, expense_id, approver_user_id, approver_level, action, comments, created_at)
             SELECT ?, ?, ?, ?, 'approved', ?, CURRENT_TIMESTAMP WHERE changes() > 0`
          ).bind(auditId, expenseId, user.id, currentLevel.order_index, comments)
        ]);
        if (!results[0]?.meta?.changes) return jsonError(c, 409, 'This expense has already been processed.');
        return c.json({ ok: true, status, nextLevel: nextLevel?.order_index ?? null });
      }

      const reasonColumn = action === 'rejected' ? 'rejection_reason' : 'returned_reason';
      const status = action === 'rejected' ? 'rejected' : 'returned';
      const results = await c.env.DB.batch([
        c.env.DB.prepare(
        `UPDATE travel_expenses SET status = ?, ${reasonColumn} = COALESCE(?, ${reasonColumn}),
         current_approver_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`
        ).bind(status, comments || null, approverName, expenseId),
        c.env.DB.prepare(
          `INSERT INTO travel_expense_approvals
            (id, expense_id, approver_user_id, approver_level, action, comments, created_at)
           SELECT ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP WHERE changes() > 0`
        ).bind(auditId, expenseId, user.id, currentLevel.order_index, action, comments)
      ]);
      if (!results[0]?.meta?.changes) return jsonError(c, 409, 'This expense has already been processed.');
      return c.json({ ok: true, status });
    }

    // Get approver name
    const approverName = user.employee_id ? await c.env.DB.prepare(
      `SELECT e.name FROM employees e WHERE e.id = ?`
    ).bind(user.employee_id).then(r => r.first()?.name || 'System') : 'System';

    if (action === 'rejected') {
      await c.env.DB.prepare(
        `UPDATE travel_expenses SET status = 'rejected', rejection_reason = COALESCE(?, rejection_reason), updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(comments || null, expenseId).run();
      await c.env.DB.prepare(
        `INSERT INTO travel_expense_approvals (id, expense_id, approver_user_id, approver_level, action, comments, created_at)
         VALUES (?, ?, ?, ?, 'rejected', ?, CURRENT_TIMESTAMP)`
      ).bind(crypto.randomUUID(), expenseId, user.id, expense.current_approver_level, comments || '').run();
      return c.json({ ok: true, status: 'rejected' });
    }

    if (action === 'returned') {
      await c.env.DB.prepare(
        `UPDATE travel_expenses SET status = 'returned', returned_reason = COALESCE(?, returned_reason), current_approver_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(comments || null, approverName, expenseId).run();
      await c.env.DB.prepare(
        `INSERT INTO travel_expense_approvals (id, expense_id, approver_user_id, approver_level, action, comments, created_at)
         VALUES (?, ?, ?, ?, 'returned', ?, CURRENT_TIMESTAMP)`
      ).bind(crypto.randomUUID(), expenseId, user.id, expense.current_approver_level, comments || '').run();
      return c.json({ ok: true, status: 'returned' });
    }

    // Approved — move to next level
    const nextLevel = expense.current_approver_level - 1;
    if (nextLevel < 1) {
      // Reached Finance (level 1) → mark finance_approved, update approver name
      await c.env.DB.prepare(
        `UPDATE travel_expenses SET status = 'finance_approved', current_approver_level = 0, current_approver_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(approverName, expenseId).run();
    } else {
      await c.env.DB.prepare(
        `UPDATE travel_expenses SET current_approver_level = ?, status = CASE ? WHEN 4 THEN 'area_approved' WHEN 3 THEN 'regional_approved' WHEN 2 THEN 'dept_approved' ELSE status END, current_approver_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(nextLevel, nextLevel, approverName, expenseId).run();
    }

    await c.env.DB.prepare(
      `INSERT INTO travel_expense_approvals (id, expense_id, approver_user_id, approver_level, action, comments, created_at)
       VALUES (?, ?, ?, ?, 'approved', ?, CURRENT_TIMESTAMP)`
    ).bind(crypto.randomUUID(), expenseId, user.id, expense.current_approver_level, comments || '').run();

    return c.json({ ok: true, nextLevel });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to process approval.');
  }
});

// Pay expense (Finance → Accounts)
app.put('/api/expenses/:id/pay', requireRoles('admin', 'payroll'), async (c) => {
  try {
    const expenseId = c.req.param('id');
    const user = c.get('user');
    if (!await hasPayrollAccess(c.env.DB, user)) {
      return jsonError(c, 403, 'Finance or Super Admin access is required to pay expenses.');
    }
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
      `UPDATE travel_expenses SET status = 'paid', paid_at = CURRENT_TIMESTAMP, paid_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'finance_approved'`
      ).bind(user.id, expenseId),
      c.env.DB.prepare(`
        INSERT INTO access_audit_log
          (id, actor_user_id, actor_username, action, target_type, target_id, old_values, new_values)
        SELECT ?, ?, ?, 'pay_expense', 'expense', ?, ?, ?
        WHERE changes() > 0
      `).bind(
        crypto.randomUUID(), user.id, user.username, expenseId,
        JSON.stringify({ status: 'finance_approved' }), JSON.stringify({ status: 'paid' })
      )
    ]);
    if (!results[0]?.meta?.changes) return jsonError(c, 409, 'Only finance-approved expenses can be marked as paid.');
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to mark as paid.');
  }
});

/* ============================================================
   ATTENDANCE REGULARISATION — Configurable sequential approval
   ============================================================ */
// Submit attendance regularisation
app.post('/api/attendance/regularisation', requireRoles('employee', 'admin', 'hr', 'payroll'), async (c) => {
  try {
    const body = await readJson(c);
    const user = c.get('user');
    const employeeId = await selfServiceOnly(c.env.DB, user)
      ? user.employee_id
      : (body.employee_id || user.employee_id);
    if (!employeeId) return jsonError(c, 400, 'Employee ID required.');
    if (!await employeeIsInScope(c.env.DB, user, employeeId)) {
      return jsonError(c, 403, 'You do not have access to submit attendance requests for this employee.');
    }
    const approvalWorkflow = await activeApprovalWorkflow(c.env.DB, 'attendance');
    if (!approvalWorkflow?.firstApprovalLevel) {
      return jsonError(c, 400, 'Attendance requests are unavailable until an approval workflow has at least one manual approver.');
    }
    const workDate = requiredText(body.work_date, 'Work date', 10);
    if (!isIsoDate(workDate)) return jsonError(c, 400, 'Work date must be a valid date.');

    const request = {
      id: crypto.randomUUID(),
      employee_id: employeeId,
      work_date: workDate,
      request_type: requiredText(body.request_type, 'Request type', 30),
      requested_status: body.requested_status || 'P',
      reason: requiredText(body.reason, 'Reason', 500),
      status: 'pending',
      approval_workflow_id: approvalWorkflow.workflow.id,
      current_approver_level: approvalWorkflow.firstApprovalLevel.order_index
    };

    await c.env.DB.prepare(
      `INSERT INTO attendance_regularisation (id, employee_id, work_date, request_type, requested_status, reason, status, current_approver_level, approval_workflow_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(request.id, request.employee_id, request.work_date, request.request_type, request.requested_status, request.reason, request.status, request.current_approver_level, request.approval_workflow_id).run();

    return c.json(request, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to submit request.');
  }
});

// Get my regularisation requests
app.get('/api/attendance/regularisation/mine', requireRoles('employee'), async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT * FROM attendance_regularisation
     WHERE employee_id = ? ORDER BY created_at DESC`
  ).bind(user.employee_id).all();
  return c.json(rows.results);
});

// Get pending regularisation by level
app.get('/api/attendance/regularisation/by-level/:level', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  const level = Number(c.req.param('level'));
  const user = c.get('user');
  const scope = await employeeScopePredicate(c.env.DB, user, 'emp');
  const rows = await c.env.DB.prepare(
    `SELECT r.*, emp.name AS employee_name, u.username
     FROM attendance_regularisation r
     JOIN employees emp ON emp.id = r.employee_id
     LEFT JOIN users u ON u.employee_id = emp.id
     WHERE r.current_approver_level = ? AND r.status = 'pending' AND ${scope.sql}
     ORDER BY r.created_at DESC`
  ).bind(level, ...scope.bindings).all();
  return c.json(rows.results);
});

// Get all regularisation (admin)
app.get('/api/attendance/regularisation', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  const scope = await employeeScopePredicate(c.env.DB, c.get('user'), 'emp');
  const rows = await c.env.DB.prepare(
    `SELECT r.*, emp.name AS employee_name, u.username
     FROM attendance_regularisation r
     JOIN employees emp ON emp.id = r.employee_id
     LEFT JOIN users u ON u.employee_id = emp.id
     WHERE ${scope.sql}
     ORDER BY r.created_at DESC LIMIT 500`
  ).bind(...scope.bindings).all();
  return c.json(rows.results);
});

// Approve/Reject regularisation
app.put('/api/attendance/regularisation/:id/approve', requireRoles('admin', 'hr', 'payroll', 'employee'), async (c) => {
  try {
    const body = await readJson(c);
    const action = requiredText(body.action, 'Action', 20);
    const comments = optionalText(body.comments, 'Comments', 500);
    const reqId = c.req.param('id');
    const user = c.get('user');

    const request = await c.env.DB.prepare('SELECT * FROM attendance_regularisation WHERE id = ?').bind(reqId).first();
    if (!request) return jsonError(c, 404, 'Request not found.');
    if (!['approved', 'rejected', 'returned'].includes(action)) return jsonError(c, 400, 'Action must be approved, rejected, or returned.');
    if (!request.approval_workflow_id) {
      return jsonError(c, 409, 'This legacy attendance request has no configured approval workflow and cannot be processed.');
    }

    if (user.employee_id && request.employee_id === user.employee_id) {
      return jsonError(c, 403, 'You cannot approve, reject, or return your own request.');
    }
    if (action === 'rejected' && !comments) return jsonError(c, 400, 'A rejection reason is required.');

    if (request.approval_workflow_id) {
      if (request.status !== 'pending') return jsonError(c, 409, 'This request is not awaiting approval.');
      const levelsResult = await c.env.DB.prepare(
        'SELECT * FROM approval_workflow_levels WHERE workflow_id = ? ORDER BY order_index DESC'
      ).bind(request.approval_workflow_id).all();
      const levels = levelsResult.results || [];
      const currentLevel = levels.find((level) => Number(level.order_index) === Number(request.current_approver_level));
      if (!currentLevel || currentLevel.auto_approve) return jsonError(c, 409, 'The attendance approval step is no longer configured.');
      if (!await canApproveWorkflowLevel(c.env.DB, user, currentLevel, undefined, request.employee_id)) {
        return jsonError(c, 403, 'You are not an approver for the current workflow step.');
      }

      const auditId = crypto.randomUUID();
      if (action === 'approved') {
        const nextLevel = nextApprovalLevel(levels, currentLevel.order_index);
        const status = nextLevel ? 'pending' : 'hr_finalised';
        const statements = [
          c.env.DB.prepare(
          `UPDATE attendance_regularisation
           SET current_approver_level = ?, status = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'pending' AND current_approver_level = ?`
          ).bind(nextLevel?.order_index ?? 0, status, reqId, currentLevel.order_index),
          c.env.DB.prepare(
            `INSERT INTO attendance_regularisation_approvals
              (id, request_id, approver_user_id, approver_level, action, comments, created_at)
             SELECT ?, ?, ?, ?, 'approved', ?, CURRENT_TIMESTAMP WHERE changes() > 0`
          ).bind(auditId, reqId, user.id, currentLevel.order_index, comments)
        ];
        if (!nextLevel) {
          statements.push(c.env.DB.prepare(
            `INSERT INTO attendance_days (employee_id, work_date, status, source)
             SELECT ?, ?, ?, 'regularisation' WHERE changes() > 0
             ON CONFLICT(employee_id, work_date) DO UPDATE SET status = excluded.status, source = excluded.source`
          ).bind(request.employee_id, request.work_date, request.requested_status));
        }
        const results = await c.env.DB.batch(statements);
        if (!results[0]?.meta?.changes) return jsonError(c, 409, 'This request has already been processed.');
        return c.json({ ok: true, status, nextLevel: nextLevel?.order_index ?? null });
      }

      const reasonColumn = action === 'rejected' ? 'rejection_reason' : 'returned_reason';
      const status = action === 'rejected' ? 'rejected' : 'returned';
      const results = await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE attendance_regularisation SET status = ?, ${reasonColumn} = COALESCE(?, ${reasonColumn}),
           updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`
        ).bind(status, comments || null, reqId),
        c.env.DB.prepare(
          `INSERT INTO attendance_regularisation_approvals
            (id, request_id, approver_user_id, approver_level, action, comments, created_at)
           SELECT ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP WHERE changes() > 0`
        ).bind(auditId, reqId, user.id, currentLevel.order_index, action, comments)
      ]);
      if (!results[0]?.meta?.changes) return jsonError(c, 409, 'This request has already been processed.');
      return c.json({ ok: true, status });
    }

    if (action === 'rejected') {
      await c.env.DB.prepare(
        `UPDATE attendance_regularisation SET status = 'rejected', rejection_reason = COALESCE(?, rejection_reason), updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(comments || null, reqId).run();
      await c.env.DB.prepare(
        `INSERT INTO attendance_regularisation_approvals (id, request_id, approver_user_id, approver_level, action, comments, created_at)
         VALUES (?, ?, ?, ?, 'rejected', ?, CURRENT_TIMESTAMP)`
      ).bind(crypto.randomUUID(), reqId, user.id, request.current_approver_level, comments || '').run();
      return c.json({ ok: true, status: 'rejected' });
    }

    if (action === 'returned') {
      await c.env.DB.prepare(
        `UPDATE attendance_regularisation SET status = 'returned', returned_reason = COALESCE(?, returned_reason), updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(comments || null, reqId).run();
      return c.json({ ok: true, status: 'returned' });
    }

    // Approved — move to next level
    const nextLevel = request.current_approver_level - 1;
    if (nextLevel < 1) {
      // HR finalised
      await c.env.DB.prepare(
        `UPDATE attendance_regularisation SET status = 'hr_finalised', current_approver_level = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(reqId).run();
      // Update attendance
      await c.env.DB.prepare(
        `INSERT INTO attendance_days (employee_id, work_date, status, source)
         VALUES (?, ?, ?, 'regularisation')
         ON CONFLICT(employee_id, work_date) DO UPDATE SET status = excluded.status, source = excluded.source`
      ).bind(request.employee_id, request.work_date, request.requested_status).run();
    } else {
      const statusMap = { 3: 'area_approved', 2: 'regional_approved', 1: 'dept_approved' };
      const newStatus = statusMap[nextLevel] || 'pending';
      await c.env.DB.prepare(
        `UPDATE attendance_regularisation SET current_approver_level = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(nextLevel, newStatus, reqId).run();
    }

    await c.env.DB.prepare(
      `INSERT INTO attendance_regularisation_approvals (id, request_id, approver_user_id, approver_level, action, comments, created_at)
       VALUES (?, ?, ?, ?, 'approved', ?, CURRENT_TIMESTAMP)`
    ).bind(crypto.randomUUID(), reqId, user.id, request.current_approver_level, comments || '').run();

    return c.json({ ok: true, nextLevel });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to process approval.');
  }
});

/* ============================================================
   APPROVAL DASHBOARD — Summary for all levels
   ============================================================ */
app.get('/api/approvals/pending', requireRoles('admin', 'hr', 'payroll', 'employee'), async (c) => {
  const user = c.get('user');
  const employeeId = user.employee_id;

  // Count pending by level for this employee's chain
  const expenseCount = await c.env.DB.prepare(
    `SELECT current_approver_level, COUNT(*) AS cnt FROM travel_expenses
     WHERE employee_id = ? AND status = 'pending'
     GROUP BY current_approver_level`
  ).bind(employeeId).all();

  const regCount = await c.env.DB.prepare(
    `SELECT current_approver_level, COUNT(*) AS cnt FROM attendance_regularisation
     WHERE employee_id = ? AND status = 'pending'
     GROUP BY current_approver_level`
  ).bind(employeeId).all();

  return c.json({
    expenses_by_level: Object.fromEntries(expenseCount.results.map(r => [r.current_approver_level, r.cnt])),
    regularisation_by_level: Object.fromEntries(regCount.results.map(r => [r.current_approver_level, r.cnt]))
  });
});

app.get('/api/approvals/inbox', requireRoles('admin', 'hr', 'payroll', 'employee'), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const canApproveExpenses = await hasAccessPermission(db, user.id, 'expenses', 'approve')
    || await hasAccessPermission(db, user.id, 'expenses', 'reject');
  const canApproveAttendance = await hasAccessPermission(db, user.id, 'attendance', 'approve')
    || await hasAccessPermission(db, user.id, 'attendance', 'reject');
  const pending = [];

  if (canApproveExpenses) {
    const scope = await employeeScopePredicate(db, user, 'emp', { financial: true });
    const rows = await db.prepare(`
      SELECT expense.*, emp.name AS employee_name
      FROM travel_expenses expense
      JOIN employees emp ON emp.id = expense.employee_id
      WHERE expense.status = 'pending' AND expense.approval_workflow_id IS NOT NULL
        AND ${scope.sql}
      ORDER BY expense.created_at DESC LIMIT 500
    `).bind(...scope.bindings).all();
    const expenses = await addExpenseApprovalChains(db, rows.results || []);
    const approverEmployee = user.employee_id
      ? await db.prepare('SELECT id, designation, hierarchy_level, reports_to FROM employees WHERE id = ? AND active = 1')
        .bind(user.employee_id).first()
      : null;
    for (const expense of expenses) {
      if (expense.employee_id === user.employee_id) continue;
      const step = expense.approval_chain.find(
        (item) => Number(item.order_index) === Number(expense.current_approver_level)
      );
      if (step && !step.auto_approve && approvalStepMatchesAmount(step, expense.amount)
        && await canApproveWorkflowLevel(db, user, step, approverEmployee, expense.employee_id)) {
        pending.push({
          ...expense,
          request_type: 'expense',
          request_id: expense.id,
          title: expense.expense_type,
          reason: expense.description || ''
        });
      }
    }
  }

  if (canApproveAttendance) {
    const scope = await employeeScopePredicate(db, user, 'emp');
    const rows = await db.prepare(`
      SELECT request.*, emp.name AS employee_name
      FROM attendance_regularisation request
      JOIN employees emp ON emp.id = request.employee_id
      WHERE request.status = 'pending' AND request.approval_workflow_id IS NOT NULL
        AND ${scope.sql}
      ORDER BY request.created_at DESC LIMIT 500
    `).bind(...scope.bindings).all();
    const levels = await db.prepare(`
      SELECT level.*, workflow.request_type
      FROM approval_workflow_levels level
      JOIN approval_workflows workflow ON workflow.id = level.workflow_id
      WHERE workflow.request_type = 'attendance'
      ORDER BY level.order_index DESC
    `).all();
    const approverEmployee = user.employee_id
      ? await db.prepare('SELECT id, designation, hierarchy_level, reports_to FROM employees WHERE id = ? AND active = 1')
        .bind(user.employee_id).first()
      : null;
    for (const request of rows.results || []) {
      if (request.employee_id === user.employee_id) continue;
      const step = (levels.results || []).find((item) =>
        item.workflow_id === request.approval_workflow_id
        && Number(item.order_index) === Number(request.current_approver_level)
      );
      if (step && !step.auto_approve
        && await canApproveWorkflowLevel(db, user, step, approverEmployee, request.employee_id)) {
        pending.push({
          ...request,
          request_type: 'attendance',
          request_id: request.id,
          title: request.request_type,
          level_name: step.level_name,
          designation_required: step.designation_required,
          role_required: step.role_required,
          amount: null
        });
      }
    }
  }

  const [expenseHistory, attendanceHistory] = await Promise.all([
    db.prepare(`
      SELECT history.id, 'expense' AS request_type, history.action, history.comments,
             history.approver_level, history.created_at, expense.id AS request_id,
             expense.expense_type AS title, expense.amount, expense.status,
             expense.expense_date AS request_date, emp.name AS employee_name
      FROM travel_expense_approvals history
      JOIN travel_expenses expense ON expense.id = history.expense_id
      JOIN employees emp ON emp.id = expense.employee_id
      WHERE history.approver_user_id = ?
      ORDER BY history.created_at DESC LIMIT 250
    `).bind(user.id).all(),
    db.prepare(`
      SELECT history.id, 'attendance' AS request_type, history.action, history.comments,
             history.approver_level, history.created_at, request.id AS request_id,
             request.request_type AS title, NULL AS amount, request.status,
             request.work_date AS request_date, emp.name AS employee_name
      FROM attendance_regularisation_approvals history
      JOIN attendance_regularisation request ON request.id = history.request_id
      JOIN employees emp ON emp.id = request.employee_id
      WHERE history.approver_user_id = ?
      ORDER BY history.created_at DESC LIMIT 250
    `).bind(user.id).all()
  ]);
  const history = [...(expenseHistory.results || []), ...(attendanceHistory.results || [])]
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
    .slice(0, 250);
  return c.json({ pending, history });
});

/* ============================================================
   APPROVAL WORKFLOWS — Configurable approval chains
   ============================================================ */

// Get all approval workflows with their levels
app.get('/api/approval-workflows', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  const workflows = await c.env.DB.prepare(`
    SELECT * FROM approval_workflows
    WHERE request_type IN ('expense', 'attendance')
    ORDER BY request_type
  `).all();
  const levels = await c.env.DB.prepare(`
    SELECT * FROM approval_workflow_levels
    ORDER BY workflow_id, order_index DESC
  `).all();
  const levelsByWorkflow = new Map();
  for (const level of levels.results || []) {
    const workflowLevels = levelsByWorkflow.get(level.workflow_id) || [];
    workflowLevels.push(level);
    levelsByWorkflow.set(level.workflow_id, workflowLevels);
  }
  return c.json((workflows.results || []).map((workflow) => ({
    ...workflow,
    is_active: Boolean(workflow.is_active),
    levels: levelsByWorkflow.get(workflow.id) || []
  })));
});

// Get workflow levels for a specific request type
app.get('/api/approval-workflows/:type/levels', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  const requestType = c.req.param('type');
  if (!APPROVAL_WORKFLOW_TYPES.has(requestType)) return jsonError(c, 404, 'Workflow type not found.');
  const workflow = await c.env.DB.prepare(`
    SELECT id FROM approval_workflows
    WHERE request_type = ?
  `).bind(requestType).first();

  if (!workflow) return jsonError(c, 404, 'Workflow not found for ' + requestType);

  const levels = await c.env.DB.prepare(`
    SELECT * FROM approval_workflow_levels
    WHERE workflow_id = ?
    ORDER BY order_index DESC
  `).bind(workflow.id).all();

  return c.json({ workflow_id: workflow.id, levels: levels.results });
});

// Replace the ordered approver steps; an empty list leaves the workflow unconfigured.
app.put('/api/approval-workflows/:type/levels', requireRoles('admin'), async (c) => {
  try {
    const requestType = c.req.param('type');
    const body = await readJson(c);
    if (!APPROVAL_WORKFLOW_TYPES.has(requestType)) return jsonError(c, 404, 'Workflow type not found.');
    const levels = body.levels;
    if (!Array.isArray(levels) || levels.length > 20) {
      return jsonError(c, 400, 'Levels must be an array containing no more than 20 steps.');
    }

    const validatedLevels = levels.map((level) => {
      if (!level || typeof level !== 'object' || Array.isArray(level)) {
        throw new Error('Each workflow step must be an object.');
      }
      const levelName = requiredText(level.level_name, 'Step name', 100);
      const role = level.role_required === '' || level.role_required === null || level.role_required === undefined
        ? null
        : requireEnum(level.role_required, [
          'super_admin', 'hr_admin', 'department_head', 'regional_manager', 'area_manager', 'finance', 'employee',
          'admin', 'hr', 'payroll'
        ], 'Approver role');
      const approverSource = level.approver_source === undefined
        ? (level.designation_required ? 'designation' : 'assigned_role')
        : requireEnum(level.approver_source, ['assigned_role', 'designation', 'reporting_manager', 'hierarchy'], 'Approver source');
      const designation = optionalText(level.designation_required, 'Designation', 100) || null;
      const hierarchy = level.min_hierarchy_level === '' || level.min_hierarchy_level === null || level.min_hierarchy_level === undefined
        ? null
        : Number(level.min_hierarchy_level);
      const minimumAmount = level.minimum_amount === '' || level.minimum_amount === null || level.minimum_amount === undefined
        ? null
        : numberValue(level.minimum_amount, 'Minimum amount', { minimum: 0 });
      const maximumAmount = level.maximum_amount === '' || level.maximum_amount === null || level.maximum_amount === undefined
        ? null
        : numberValue(level.maximum_amount, 'Maximum amount', { minimum: 0 });
      if (hierarchy !== null && (!Number.isInteger(hierarchy) || hierarchy < 1 || hierarchy > 5)) {
        throw new Error('Hierarchy level must be between 1 and 5.');
      }
      if (minimumAmount !== null && maximumAmount !== null && minimumAmount > maximumAmount) {
        throw new Error('Minimum amount cannot exceed maximum amount.');
      }
      if (typeof level.auto_approve !== 'boolean') throw new Error('Auto-approve must be true or false.');
      if (!level.auto_approve && !role && !designation && hierarchy === null && approverSource !== 'reporting_manager') {
        throw new Error(`Manual step "${levelName}" must specify a role, designation, or hierarchy level.`);
      }
      return {
        level_name: levelName,
        role_required: role,
        approver_source: approverSource,
        designation_required: designation,
        min_hierarchy_level: hierarchy,
        minimum_amount: minimumAmount,
        maximum_amount: maximumAmount,
        auto_approve: level.auto_approve ? 1 : 0
      };
    });

    // Find workflow
    const workflow = await c.env.DB.prepare(`
      SELECT id FROM approval_workflows WHERE request_type = ?
    `).bind(requestType).first();

    if (!workflow) return jsonError(c, 404, 'Workflow not found for ' + requestType);
    const requestTable = requestType === 'expense' ? 'travel_expenses' : 'attendance_regularisation';
    const pending = await c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM ${requestTable} WHERE approval_workflow_id = ? AND status = 'pending'`
    ).bind(workflow.id).first();
    if (Number(pending?.count || 0) > 0) {
      return jsonError(c, 409, 'This workflow cannot be changed while requests are awaiting approval.');
    }

    const statements = [c.env.DB.prepare(
      'DELETE FROM approval_workflow_levels WHERE workflow_id = ?'
    ).bind(workflow.id)];
    validatedLevels.forEach((level, idx) => {
      const orderIndex = validatedLevels.length - idx;
      statements.push(c.env.DB.prepare(`
        INSERT INTO approval_workflow_levels
          (workflow_id, order_index, level_name, role_required, designation_required,
           min_hierarchy_level, auto_approve, approver_source, minimum_amount, maximum_amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        workflow.id, orderIndex, level.level_name, level.role_required, level.designation_required,
        level.min_hierarchy_level, level.auto_approve, level.approver_source,
        level.minimum_amount, level.maximum_amount
      ));
    });
    await c.env.DB.batch(statements);
    const newLevels = await c.env.DB.prepare(`
      SELECT * FROM approval_workflow_levels WHERE workflow_id = ? ORDER BY order_index DESC
    `).bind(workflow.id).all();

    return c.json({ ok: true, workflow_id: workflow.id, levels: newLevels.results });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to update workflow levels.');
  }
});

async function resolveExpenseBillEmployee(db, body) {
  const employeeId = body.employee_id ? requiredText(body.employee_id, 'Employee ID', 32) : null;
  const claimId = body.claim_id ? requiredText(body.claim_id, 'Claim ID', 64) : null;
  const journeyId = body.journey_id ? requiredText(body.journey_id, 'Journey ID', 64) : null;
  const [claim, journey] = await Promise.all([
    claimId
      ? db.prepare('SELECT employee_id FROM travel_expense_claims WHERE id = ?').bind(claimId).first()
      : null,
    journeyId
      ? db.prepare('SELECT employee_id FROM travel_journeys WHERE id = ?').bind(journeyId).first()
      : null
  ]);
  if (claimId && !claim) throw new Error('Expense claim was not found.');
  if (journeyId && !journey) throw new Error('Travel journey was not found.');

  const linkedEmployeeIds = [claim?.employee_id, journey?.employee_id].filter(Boolean);
  if (new Set(linkedEmployeeIds).size > 1) {
    throw new Error('The claim and journey belong to different employees.');
  }
  const linkedEmployeeId = linkedEmployeeIds[0] || null;
  if (employeeId && linkedEmployeeId && employeeId !== linkedEmployeeId) {
    throw new Error('The selected employee does not match the linked claim or journey.');
  }
  const resolvedEmployeeId = employeeId || linkedEmployeeId;
  if (!resolvedEmployeeId) throw new Error('Employee ID, claim, or journey is required.');
  return { employeeId: resolvedEmployeeId, claimId, journeyId };
}

/* Per-employee allowance rules overrides */
app.get('/api/travel/allowance-rules', requireRoles('admin', 'payroll'), async (c) => {
  const employeeId = c.req.query('employee_id');
  const activeOnly = c.req.query('active') === 'true';
  const user = c.get('user');
  if (employeeId && !await employeeIsInScope(c.env.DB, user, employeeId, { financial: true })) {
    return jsonError(c, 403, 'You do not have access to this employee allowance data.');
  }
  const scope = await employeeScopePredicate(c.env.DB, user, 'e', { financial: true });
  let query = `SELECT rules.* FROM travel_allowance_rules rules
               JOIN employees e ON e.id = rules.employee_id`;
  const conditions = [scope.sql];
  const bindings = [...scope.bindings];
  if (employeeId) {
    conditions.push('rules.employee_id = ?');
    bindings.push(employeeId);
  }
  if (activeOnly) {
    conditions.push('rules.active = 1');
  }
  conditions.push('rules.effective_from <= ?');
  bindings.push(new Date().toISOString().slice(0, 10));
  query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY rules.effective_from DESC';
  const rows = await c.env.DB.prepare(query).bind(...bindings).all();
  return c.json(rows.results);
});

app.post('/api/travel/allowance-rules', requireRoles('admin', 'payroll'), async (c) => {
  try {
    const body = await readJson(c);
    const employeeId = requiredText(body.employee_id, 'Employee ID', 32);
    if (!await employeeIsInScope(c.env.DB, c.get('user'), employeeId, { financial: true })) {
      return jsonError(c, 403, 'You do not have access to manage this employee allowance.');
    }
    const effectiveFrom = body.effective_from || new Date().toISOString().slice(0, 10);
    if (!isIsoDate(effectiveFrom)) throw new Error('Effective date must use YYYY-MM-DD format.');

    // Deactivate any existing active rules for this employee on or after the effective date
    if (effectiveFrom) {
      await c.env.DB.prepare(
        `UPDATE travel_allowance_rules SET active = 0 WHERE employee_id = ? AND effective_from >= ?`
      ).bind(employeeId, effectiveFrom).run();
    }

    const rule = {
      id: crypto.randomUUID(),
      employee_id: employeeId,
      effective_from: effectiveFrom,
      ta_per_km: body.ta_per_km !== undefined ? numberValue(body.ta_per_km, 'TA per KM') : 5,
      da_daily: body.da_daily !== undefined ? numberValue(body.da_daily, 'Daily DA') : 150,
      min_daily_km: body.min_daily_km !== undefined ? numberValue(body.min_daily_km, 'Min daily KM') : 0,
      max_daily_km: body.max_daily_km !== undefined ? numberValue(body.max_daily_km, 'Max daily KM') : 200,
      active: true
    };

    await c.env.DB.prepare(
      `INSERT INTO travel_allowance_rules (id, employee_id, effective_from, ta_per_km, da_daily, min_daily_km, max_daily_km, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(
      rule.id, rule.employee_id, rule.effective_from, rule.ta_per_km,
      rule.da_daily, rule.min_daily_km, rule.max_daily_km
    ).run();
    return c.json(rule, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to create allowance rule.');
  }
});

app.put('/api/travel/allowance-rules/:id', requireRoles('admin', 'payroll'), async (c) => {
  try {
    const body = await readJson(c);
    const current = await c.env.DB.prepare(
      'SELECT * FROM travel_allowance_rules WHERE id = ?'
    ).bind(c.req.param('id')).first();
    if (!current) return jsonError(c, 404, 'Allowance rule not found.');
    const employeeId = requiredText(body.employee_id ?? current.employee_id, 'Employee ID', 32);
    if (!await employeeIsInScope(c.env.DB, c.get('user'), current.employee_id, { financial: true })
      || !await employeeIsInScope(c.env.DB, c.get('user'), employeeId, { financial: true })) {
      return jsonError(c, 403, 'You do not have access to update this employee allowance.');
    }
    const effectiveFrom = body.effective_from ?? current.effective_from;
    if (!isIsoDate(effectiveFrom)) throw new Error('Effective date must use YYYY-MM-DD format.');
    await c.env.DB.prepare(
      `UPDATE travel_allowance_rules SET employee_id = ?, effective_from = ?, ta_per_km = ?, da_daily = ?, min_daily_km = ?, max_daily_km = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(
      employeeId, effectiveFrom, body.ta_per_km ?? current.ta_per_km,
      body.da_daily ?? current.da_daily, body.min_daily_km ?? current.min_daily_km,
      body.max_daily_km ?? current.max_daily_km, body.active ?? current.active, c.req.param('id')
    ).run();
    const updated = await c.env.DB.prepare('SELECT * FROM travel_allowance_rules WHERE id = ?').bind(c.req.param('id')).first();
    return c.json(updated);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to update allowance rule.');
  }
});

app.delete('/api/travel/allowance-rules/:id', requireRoles('admin', 'payroll'), async (c) => {
  const rule = await c.env.DB.prepare(
    'SELECT employee_id FROM travel_allowance_rules WHERE id = ?'
  ).bind(c.req.param('id')).first();
  if (!rule) return jsonError(c, 404, 'Allowance rule not found.');
  if (!await employeeIsInScope(c.env.DB, c.get('user'), rule.employee_id, { financial: true })) {
    return jsonError(c, 403, 'You do not have access to delete this employee allowance.');
  }
  const result = await c.env.DB.prepare('DELETE FROM travel_allowance_rules WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

/* Leave management routes */
app.get('/api/leave-types', requireRoles('admin', 'hr', 'payroll', 'employee'), async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM leave_types WHERE active = 1 ORDER BY code').all();
  return c.json(rows.results);
});

app.get('/api/leave-balances', requireRoles('admin', 'hr', 'payroll', 'employee'), async (c) => {
  const user = c.get('user');
  const selfOnly = await selfServiceOnly(c.env.DB, user);
  const employeeId = selfOnly ? user.employee_id : c.req.query('employee_id');
  if (selfOnly && !employeeId) return jsonError(c, 400, 'Employee ID is required.');
  if (employeeId && !await canAccessEmployee(c.env.DB, user, employeeId)) {
    return jsonError(c, 403, 'You do not have access to this employee leave data.');
  }

  const year = Number(c.req.query('year') || new Date().getFullYear());
  const scope = await employeeScopePredicate(c.env.DB, user, 'e');
  let query = `SELECT lb.*, lt.code, lt.name AS leave_name, e.name AS employee_name
               FROM leave_balances lb
               JOIN leave_types lt ON lt.id = lb.leave_type_id
               JOIN employees e ON e.id = lb.employee_id
               WHERE lb.year = ? AND ${scope.sql}`;
  const bindings = [year, ...scope.bindings];
  if (employeeId) {
    query += ' AND lb.employee_id = ?';
    bindings.push(employeeId);
  }
  query += ' ORDER BY e.name, lt.code';
  const rows = await c.env.DB.prepare(query).bind(...bindings).all();
  return c.json(rows.results);
});

app.get('/api/leave-requests', requireRoles('admin', 'hr', 'payroll', 'employee'), async (c) => {
  const user = c.get('user');
  const selfOnly = await selfServiceOnly(c.env.DB, user);
  const employeeId = selfOnly ? user.employee_id : c.req.query('employee_id');
  if (selfOnly && !employeeId) return jsonError(c, 400, 'Employee ID is required.');
  if (employeeId && !await canAccessEmployee(c.env.DB, user, employeeId)) {
    return jsonError(c, 403, 'You do not have access to this employee leave data.');
  }

  const status = c.req.query('status');
  const scope = await employeeScopePredicate(c.env.DB, user, 'e');
  let query = `SELECT lr.*, lt.code AS leave_code, lt.name AS leave_name, e.name AS employee_name,
                u.username AS approved_by_username
                FROM leave_requests lr
                JOIN leave_types lt ON lt.id = lr.leave_type_id
                JOIN employees e ON e.id = lr.employee_id
                LEFT JOIN users u ON u.id = lr.approved_by`;
  const conditions = [];
  const bindings = [...scope.bindings];
  conditions.push(scope.sql);
  if (employeeId) {
    conditions.push('lr.employee_id = ?');
    bindings.push(employeeId);
  }
  if (status) {
    conditions.push('lr.status = ?');
    bindings.push(status);
  }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY lr.start_date DESC, e.name';
  const rows = await c.env.DB.prepare(query).bind(...bindings).all();
  return c.json(rows.results);
});

app.post('/api/leave-requests', requireRoles('admin', 'hr', 'payroll', 'employee'), async (c) => {
  try {
    const user = c.get('user');
    const body = await readJson(c);
    const employeeId = await selfServiceOnly(c.env.DB, user)
      ? user.employee_id
      : requiredText(body.employee_id, 'Employee ID', 32);

    if (!await canAccessEmployee(c.env.DB, user, employeeId)) {
      return jsonError(c, 403, 'You do not have access to create leave for this employee.');
    }

    const leaveTypeId = requiredText(body.leave_type_id, 'Leave type ID', 32);
    const startDate = requiredText(body.start_date, 'Start date', 10);
    const endDate = requiredText(body.end_date, 'End date', 10);
    if (!isIsoDate(startDate)) throw new Error('Start date must use YYYY-MM-DD format.');
    if (!isIsoDate(endDate)) throw new Error('End date must use YYYY-MM-DD format.');
    if (endDate < startDate) throw new Error('End date must be after start date.');
    const days = numberValue(body.days, 'Days', { minimum: 0.5, maximum: 365 });
    const halfDay = toBool(body.half_day ?? false, 'Half day');
    const halfDayPeriod = body.half_day_period;
    if (halfDay && halfDayPeriod && !['first', 'second'].includes(halfDayPeriod)) {
      throw new Error('Half-day period must be "first" or "second".');
    }
    const reason = optionalText(body.reason, 'Reason', 500);

    const request = {
      id: crypto.randomUUID(),
      employee_id: employeeId,
      leave_type_id: leaveTypeId,
      start_date: startDate,
      end_date: endDate,
      days,
      half_day: halfDay ? 1 : 0,
      half_day_period: halfDayPeriod || null,
      reason,
      status: 'pending'
    };
    await c.env.DB.prepare(
      `INSERT INTO leave_requests (id, employee_id, leave_type_id, start_date, end_date, days, half_day, half_day_period, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(request.id, request.employee_id, request.leave_type_id, request.start_date, request.end_date,
      request.days, request.half_day, request.half_day_period, request.reason, request.status).run();
    return c.json(request, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to create leave request.');
  }
});

app.put('/api/leave-requests/:id', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  try {
    const request = await c.env.DB.prepare('SELECT * FROM leave_requests WHERE id = ?').bind(c.req.param('id')).first();
    if (!request) return jsonError(c, 404, 'Leave request not found.');
    const user = c.get('user');
    if (user.employee_id && user.employee_id === request.employee_id) {
      return jsonError(c, 403, 'You cannot approve or reject your own leave request.');
    }
    if (!await canAccessEmployee(c.env.DB, user, request.employee_id)) {
      return jsonError(c, 403, 'You do not have access to this employee leave request.');
    }
    const body = await readJson(c);
    const status = body.status;
    if (!['approved', 'rejected', 'cancelled'].includes(status)) throw new Error('Status must be approved, rejected, or cancelled.');
    const rejectionReason = optionalText(body.rejection_reason, 'Rejection reason', 500);
    if (status === 'rejected' && !rejectionReason) throw new Error('A rejection reason is required.');
    const now = new Date().toISOString();
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE leave_requests SET status = ?, approved_by = ?, approved_at = ?, rejection_reason = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'pending'`
      ).bind(status, user.id, status === 'approved' ? now : null, rejectionReason, c.req.param('id')),
      c.env.DB.prepare(`
        INSERT INTO access_audit_log
          (id, actor_user_id, actor_username, action, target_type, target_id, old_values, new_values)
        SELECT ?, ?, ?, ?, 'leave_request', ?, ?, ?
        WHERE changes() > 0
      `).bind(
        crypto.randomUUID(), user.id, user.username,
        status === 'rejected' ? 'reject_leave_request' : status === 'approved' ? 'approve_leave_request' : 'cancel_leave_request',
        c.req.param('id'), JSON.stringify({ status: request.status }), JSON.stringify({ status })
      )
    ]);
    if (!results[0]?.meta?.changes) return jsonError(c, 409, 'This leave request is no longer pending.');
    return c.json({ ok: true, id: c.req.param('id'), status });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to update leave request.');
  }
});

app.delete('/api/leave-requests/:id', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  const user = c.get('user');
  const request = await c.env.DB.prepare(
    'SELECT employee_id FROM leave_requests WHERE id = ?'
  ).bind(c.req.param('id')).first();
  if (!request) return jsonError(c, 404, 'Leave request not found.');
  if (user.employee_id && user.employee_id === request.employee_id) {
    return jsonError(c, 403, 'You cannot delete your own leave request.');
  }
  if (!await canAccessEmployee(c.env.DB, user, request.employee_id)) {
    return jsonError(c, 403, 'You do not have access to delete this employee leave request.');
  }
  await c.env.DB.prepare('DELETE FROM leave_requests WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

const ACCESS_MODULE_LABELS = {
  dashboard: 'Dashboard', employees: 'Employees', 'salary-revisions': 'Salary Revisions',
  payroll: 'Payroll', attendance: 'Attendance', 'leave-management': 'Leave Management',
  holidays: 'Holidays', shifts: 'Shifts', 'field-tasks': 'Field Tasks',
  'sample-tracking': 'Sample Tracking', travel: 'Travel', 'route-playback': 'Route Playback',
  expenses: 'Expenses', customers: 'Customers', 'chemist-orders': 'Chemist Orders',
  reports: 'Reports', 'rule-settings': 'Rule Settings', 'access-control': 'Access Control'
};
const ACCESS_ROLE_CODES = new Set([
  'super_admin', 'hr_admin', 'department_head', 'regional_manager',
  'area_manager', 'finance', 'employee'
]);

function validateAccessPermissions(value) {
  if (!Array.isArray(value) || value.length > ACCESS_MODULES.size * ACCESS_ACTIONS.size) {
    throw new Error('Permissions must be an array of module and action pairs.');
  }
  const permissions = [];
  const unique = new Set();
  for (const permission of value) {
    const module = requiredText(permission?.module, 'Permission module', 40);
    const action = requiredText(permission?.action, 'Permission action', 20).toLowerCase();
    if (!ACCESS_MODULES.has(module) || !ACCESS_ACTIONS.has(action)) {
      throw new Error('A permission contains an unsupported module or action.');
    }
    const key = `${module}:${action}`;
    if (!unique.has(key)) {
      unique.add(key);
      permissions.push({ module, action });
    }
  }
  return permissions;
}

app.get('/api/access/roles', requireRoles('admin'), async (c) => {
  const [roles, permissions] = await Promise.all([
    c.env.DB.prepare(`
      SELECT role.id, role.code, role.name, role.description, role.is_system, role.is_active,
             COUNT(DISTINCT assignment.user_id) AS assigned_users
      FROM access_roles role
      LEFT JOIN user_access_roles assignment ON assignment.role_id = role.id
      GROUP BY role.id ORDER BY role.is_system DESC, role.name COLLATE NOCASE
    `).all(),
    c.env.DB.prepare(`
      SELECT role_id, module_key, action_key
      FROM access_role_permissions ORDER BY module_key, action_key
    `).all()
  ]);
  const byRole = new Map();
  for (const permission of permissions.results || []) {
    const list = byRole.get(permission.role_id) || [];
    list.push({ module: permission.module_key, action: permission.action_key });
    byRole.set(permission.role_id, list);
  }
  return c.json({
    modules: ACCESS_MODULE_LABELS,
    actions: [...ACCESS_ACTIONS],
    roles: (roles.results || []).map((role) => ({
      ...role,
      is_system: Boolean(role.is_system),
      is_active: Boolean(role.is_active),
      permissions: byRole.get(role.id) || []
    }))
  });
});

app.post('/api/access/roles', requireRoles('admin'), async (c) => {
  try {
    const body = await readJson(c, 100_000);
    const code = requiredText(body.code, 'Role code', 40).toLowerCase().replaceAll(/[^a-z0-9_]+/g, '_');
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(code) || ACCESS_ROLE_CODES.has(code)) {
      throw new Error('Role code must be a unique custom role code.');
    }
    const name = requiredText(body.name, 'Role name', 80);
    const description = optionalText(body.description, 'Description', 300);
    const permissions = validateAccessPermissions(body.permissions);
    const roleId = crypto.randomUUID();
    const actor = c.get('user');
    const statements = [
      c.env.DB.prepare(`
        INSERT INTO access_roles (id, code, name, description, created_by)
        VALUES (?, ?, ?, ?, ?)
      `).bind(roleId, code, name, description, actor.id),
      ...permissions.map(({ module, action }) => c.env.DB.prepare(`
        INSERT INTO access_role_permissions (role_id, module_key, action_key) VALUES (?, ?, ?)
      `).bind(roleId, module, action))
    ];
    await c.env.DB.batch(statements);
    await appendAccessAudit(c.env.DB, actor, 'create_role', 'access_role', roleId, null, { code, name, permissions });
    return c.json({ id: roleId, code, name, description, is_system: false, is_active: true, permissions }, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to create role.');
  }
});

app.put('/api/access/roles/:id', requireRoles('admin'), async (c) => {
  try {
    const roleId = c.req.param('id');
    const current = await c.env.DB.prepare('SELECT * FROM access_roles WHERE id = ?').bind(roleId).first();
    if (!current) return jsonError(c, 404, 'Role not found.');
    const body = await readJson(c, 100_000);
    const name = requiredText(body.name ?? current.name, 'Role name', 80);
    const description = optionalText(body.description ?? current.description, 'Description', 300);
    const isActive = body.is_active === undefined ? Number(current.is_active) : toBool(body.is_active, 'Role active');
    if (current.code === 'super_admin' && !isActive) return jsonError(c, 409, 'The Super Admin role cannot be deactivated.');
    if (body.permissions !== undefined) {
      if (current.code === 'super_admin') return jsonError(c, 409, 'Super Admin permissions cannot be reduced.');
      const permissions = validateAccessPermissions(body.permissions);
      const statements = [
        c.env.DB.prepare('DELETE FROM access_role_permissions WHERE role_id = ?').bind(roleId),
        ...permissions.map(({ module, action }) => c.env.DB.prepare(`
          INSERT INTO access_role_permissions (role_id, module_key, action_key) VALUES (?, ?, ?)
        `).bind(roleId, module, action))
      ];
      await c.env.DB.batch(statements);
    }
    await c.env.DB.prepare(`
      UPDATE access_roles SET name = ?, description = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(name, description, isActive, roleId).run();
    if (!isActive) {
      await c.env.DB.prepare(`
        DELETE FROM sessions WHERE user_id IN (
          SELECT assignment.user_id FROM user_access_roles assignment WHERE assignment.role_id = ?
        )
      `).bind(roleId).run();
    }
    await appendAccessAudit(c.env.DB, c.get('user'), 'update_role', 'access_role', roleId,
      { name: current.name, description: current.description, is_active: Boolean(current.is_active) },
      { name, description, is_active: Boolean(isActive), permissions_changed: body.permissions !== undefined });
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to update role.');
  }
});

app.post('/api/access/roles/:id/duplicate', requireRoles('admin'), async (c) => {
  try {
    const source = await c.env.DB.prepare('SELECT * FROM access_roles WHERE id = ? AND is_active = 1')
      .bind(c.req.param('id')).first();
    if (!source) return jsonError(c, 404, 'Active source role not found.');
    const body = await readJson(c, 20_000);
    const name = requiredText(body.name, 'Role name', 80);
    const code = `${source.code}_copy_${crypto.randomUUID().slice(0, 8)}`;
    const roleId = crypto.randomUUID();
    const permissions = await c.env.DB.prepare(`
      SELECT module_key, action_key FROM access_role_permissions WHERE role_id = ?
    `).bind(source.id).all();
    const statements = [
      c.env.DB.prepare('INSERT INTO access_roles (id, code, name, description, created_by) VALUES (?, ?, ?, ?, ?)')
        .bind(roleId, code, name, source.description || '', c.get('user').id),
      ...(permissions.results || []).map((permission) => c.env.DB.prepare(`
        INSERT INTO access_role_permissions (role_id, module_key, action_key) VALUES (?, ?, ?)
      `).bind(roleId, permission.module_key, permission.action_key))
    ];
    await c.env.DB.batch(statements);
    await appendAccessAudit(c.env.DB, c.get('user'), 'duplicate_role', 'access_role', roleId, null,
      { source_role_id: source.id, code, name });
    return c.json({ id: roleId, code, name }, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to duplicate role.');
  }
});

app.put('/api/access/users/:id/roles', requireRoles('admin'), async (c) => {
  try {
    const userId = c.req.param('id');
    const target = await c.env.DB.prepare('SELECT id, username, role, employee_id FROM users WHERE id = ?')
      .bind(userId).first();
    if (!target) return jsonError(c, 404, 'User not found.');
    const body = await readJson(c, 20_000);
    if (!Array.isArray(body.role_ids) || body.role_ids.length < 1 || body.role_ids.length > 10) {
      throw new Error('Assign between one and ten active roles.');
    }
    const roleIds = [...new Set(body.role_ids.map((id) => requiredText(id, 'Role ID', 64)))];
    const placeholders = roleIds.map(() => '?').join(', ');
    const roles = await c.env.DB.prepare(`
      SELECT id, code FROM access_roles WHERE is_active = 1 AND id IN (${placeholders})
    `).bind(...roleIds).all();
    if ((roles.results || []).length !== roleIds.length) throw new Error('Every assigned role must be active.');
    const codes = new Set(roles.results.map((role) => role.code));
    if (codes.has('super_admin') && target.role !== 'admin') {
      throw new Error('Super Admin access requires an administrator account.');
    }
    if (codes.has('hr_admin') && target.role !== 'hr') {
      throw new Error('HR Admin access requires an HR account.');
    }
    if (codes.has('finance') && target.role !== 'payroll') {
      throw new Error('Finance access requires a payroll account.');
    }
    if ([...codes].some((code) => ['employee', 'department_head', 'regional_manager', 'area_manager'].includes(code))
      && (target.role !== 'employee' || !target.employee_id)) {
      throw new Error('Employee and manager roles require an employee account linked to an employee record.');
    }
    if (codes.has('super_admin') && !await hasAccessRole(c.env.DB, c.get('user').id, 'super_admin')) {
      return jsonError(c, 403, 'Only an existing Super Admin can assign Super Admin access.');
    }
    const current = await c.env.DB.prepare(`
      SELECT role_id FROM user_access_roles WHERE user_id = ? ORDER BY role_id
    `).bind(userId).all();
    const oldIds = (current.results || []).map((row) => row.role_id);
    const hadSuperAdmin = await hasAccessRole(c.env.DB, userId, 'super_admin');
    if (hadSuperAdmin && !codes.has('super_admin')) {
      const activeAdmins = await c.env.DB.prepare(`
        SELECT COUNT(DISTINCT assignment.user_id) AS count FROM user_access_roles assignment
        JOIN access_roles role ON role.id = assignment.role_id AND role.code = 'super_admin'
        JOIN users ON users.id = assignment.user_id AND users.is_active = 1
      `).first();
      if (userId === c.get('user').id || Number(activeAdmins?.count || 0) <= 1) {
        return jsonError(c, 409, 'The last active Super Admin cannot lose Super Admin access.');
      }
    }
    const statements = [
      c.env.DB.prepare('DELETE FROM user_access_roles WHERE user_id = ?').bind(userId),
      ...roleIds.map((roleId) => c.env.DB.prepare(`
        INSERT INTO user_access_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)
      `).bind(userId, roleId, c.get('user').id))
    ];
    await c.env.DB.batch(statements);
    await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
    await appendAccessAudit(c.env.DB, c.get('user'), 'assign_user_roles', 'user', userId,
      { role_ids: oldIds }, { role_ids: roleIds });
    return c.json({ ok: true, user_id: userId, role_ids: roleIds, access_roles: [...codes] });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to assign roles.');
  }
});

app.put('/api/users/:id/active', requireRoles('admin'), async (c) => {
  try {
    const userId = c.req.param('id');
    const body = await readJson(c, 20_000);
    const active = toBool(body.active, 'Active');
    if (!active && userId === c.get('user').id) return jsonError(c, 409, 'You cannot deactivate your own account.');
    const target = await c.env.DB.prepare('SELECT id, username, is_active FROM users WHERE id = ?')
      .bind(userId).first();
    if (!target) return jsonError(c, 404, 'User not found.');
    if (!active && await hasAccessRole(c.env.DB, userId, 'super_admin')) {
      const count = await c.env.DB.prepare(`
        SELECT COUNT(DISTINCT assignment.user_id) AS count FROM user_access_roles assignment
        JOIN access_roles role ON role.id = assignment.role_id
        JOIN users ON users.id = assignment.user_id AND users.is_active = 1
        WHERE role.code = 'super_admin'
      `).first();
      if (Number(count?.count || 0) <= 1) return jsonError(c, 409, 'The last active Super Admin cannot be deactivated.');
    }
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET is_active = ? WHERE id = ?').bind(active ? 1 : 0, userId),
      ...(!active ? [c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId)] : [])
    ]);
    await appendAccessAudit(c.env.DB, c.get('user'), active ? 'activate_user' : 'deactivate_user',
      'user', userId, { is_active: Boolean(target.is_active) }, { is_active: active });
    return c.json({ ok: true, active });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to update account status.');
  }
});

app.get('/api/access/organization', requireRoles('admin', 'hr'), async (c) => {
  const scope = await employeeScopePredicate(c.env.DB, c.get('user'), 'e');
  const rows = await c.env.DB.prepare(`
    SELECT e.id, e.name, e.department, e.designation, e.region, e.area, e.reports_to,
           e.hierarchy_level, e.active, manager.name AS manager_name
    FROM employees e
    LEFT JOIN employees manager ON manager.id = e.reports_to
    WHERE e.active = 1 AND ${scope.sql}
    ORDER BY e.department, e.region, e.area, e.name COLLATE NOCASE
    LIMIT 1000
  `).bind(...scope.bindings).all();
  return c.json(rows.results || []);
});

app.put('/api/access/organization/:employeeId', requireRoles('admin', 'hr'), async (c) => {
  try {
    const employeeId = c.req.param('employeeId');
    const current = await c.env.DB.prepare(`
      SELECT id, reports_to, designation, hierarchy_level, department, region, area
      FROM employees WHERE id = ? AND active = 1
    `).bind(employeeId).first();
    if (!current) return jsonError(c, 404, 'Active employee not found.');
    const body = await readJson(c, 20_000);
    const reportsTo = body.reports_to ? requiredText(body.reports_to, 'Reporting manager', 32) : null;
    if (reportsTo === employeeId) throw new Error('An employee cannot report to themselves.');
    if (reportsTo) {
      const manager = await c.env.DB.prepare('SELECT id FROM employees WHERE id = ? AND active = 1')
        .bind(reportsTo).first();
      if (!manager) throw new Error('The reporting manager must be an active employee.');
      const cycle = await c.env.DB.prepare(`
        WITH RECURSIVE ancestors(id) AS (
          SELECT ? UNION
          SELECT employee.reports_to FROM employees employee JOIN ancestors ON employee.id = ancestors.id
          WHERE employee.reports_to IS NOT NULL
        )
        SELECT 1 FROM ancestors WHERE id = ? LIMIT 1
      `).bind(reportsTo, employeeId).first();
      if (cycle) throw new Error('This reporting change would create a hierarchy cycle.');
    }
    const designation = optionalText(body.designation ?? current.designation, 'Designation', 120);
    const department = optionalText(body.department ?? current.department, 'Department', 120);
    const region = optionalText(body.region ?? current.region, 'Region', 120);
    const area = optionalText(body.area ?? current.area, 'Area', 120);
    const hierarchyLevel = Number(body.hierarchy_level ?? current.hierarchy_level);
    if (!Number.isInteger(hierarchyLevel) || hierarchyLevel < 1 || hierarchyLevel > 5) {
      throw new Error('Hierarchy level must be between 1 and 5.');
    }
    const next = { reports_to: reportsTo, designation, department, region, area, hierarchy_level: hierarchyLevel };
    await c.env.DB.prepare(`
      UPDATE employees SET reports_to = ?, designation = ?, hierarchy_level = ?,
        department = ?, region = ?, area = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(reportsTo, designation, hierarchyLevel, department, region, area, employeeId).run();
    await appendAccessAudit(c.env.DB, c.get('user'), 'update_employee_organization', 'employee', employeeId,
      current, next);
    return c.json({ ok: true, employee_id: employeeId, ...next });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to update employee organization.');
  }
});

app.get('/api/access/audit', requireRoles('admin'), async (c) => {
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') || 100)));
  if (!Number.isInteger(limit)) return jsonError(c, 400, 'Limit must be an integer.');
  const rows = await c.env.DB.prepare(`
    SELECT id, actor_user_id, actor_username, action, target_type, target_id,
           old_values, new_values, created_at
    FROM access_audit_log ORDER BY created_at DESC LIMIT ?
  `).bind(limit).all();
  return c.json(rows.results || []);
});

const CSV_COLUMNS = [
  ['Employee ID', 'employeeId'],
  ['Name', 'employeeName'],
  ['CTC', 'ctc'],
  ['Gross', 'gross'],
  ['Basic', 'basic'],
  ['HRA', 'hra'],
  ['Bonus', 'bonus'],
  ['Deductions', 'totalDeduction'],
  ['Net Payable', 'netPayable'],
  ['Final Payable', 'finalPayable'],
  ['Paid Days', 'paidDays'],
  ['Absent Days', 'absentDays'],
  ['Leave Days', 'leaveDays'],
  ['Travel TA', 'travelTa'],
  ['Travel DA', 'travelDa'],
  ['Reimbursement', 'reimbursement']
];

function csvField(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

app.get('/api/reports/payroll.csv', requireRoles('admin', 'payroll'), async (c) => {
  if (!await hasPayrollAccess(c.env.DB, c.get('user'))) {
    return jsonError(c, 403, 'Finance or Super Admin access is required for payroll reports.');
  }
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7);
  if (!isMonth(month)) return jsonError(c, 400, 'Month must use YYYY-MM format.');
  const rows = await calculateMonth(c.env.DB, month);
  const csv = [
    CSV_COLUMNS.map(([label]) => label).join(','),
    ...rows.map((row) => CSV_COLUMNS.map(([, key]) => csvField(row[key])).join(','))
  ].join('\r\n');
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="payroll-${month}.csv"`);
  return c.body(`\uFEFF${csv}`);
});

app.get('/api/backup', requireRoles('admin'), async (c) => {
  const tables = {
    employees: 'SELECT * FROM employees',
    salary_revisions: 'SELECT * FROM salary_revisions ORDER BY source_order',
    attendance_days: 'SELECT * FROM attendance_days',
    holidays: 'SELECT * FROM holidays',
    payroll_adjustments: 'SELECT * FROM payroll_adjustments',
    payroll_component_definitions: 'SELECT * FROM payroll_component_definitions',
    payroll_recurring_items: 'SELECT * FROM payroll_recurring_items',
    payroll_one_off_items: 'SELECT * FROM payroll_one_off_items',
    payroll_settings: 'SELECT * FROM payroll_settings',
    payroll_periods: 'SELECT * FROM payroll_periods'
  };
  const backup = { format: 'salary-app-backup-v1', exportedAt: new Date().toISOString(), data: {} };
  for (const [table, query] of Object.entries(tables)) {
    backup.data[table] = (await c.env.DB.prepare(query).all()).results;
  }
  c.header('Content-Disposition', 'attachment; filename="salary-app-backup.json"');
  return c.json(backup);
});

app.post('/api/backup/restore', requireRoles('admin'), async (c) => {
  try {
    const backup = await readJson(c, 20_000_000);
    if (backup.format !== 'salary-app-backup-v1' || !backup.data || typeof backup.data !== 'object') {
      throw new Error('Backup format is unsupported.');
    }
    await importData(c.env.DB, backup.data);
    return c.json({ ok: true, imported: true });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to restore the backup.');
  }
});

async function importData(db, data) {
  const statements = [];
  for (const component of data.payroll_component_definitions || []) {
    if (!['earning', 'deduction'].includes(component.kind)) {
      throw new Error('A reusable payroll component has an invalid type.');
    }
    statements.push(db.prepare(
      `INSERT INTO payroll_component_definitions (id, label, kind, active)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET label=excluded.label, kind=excluded.kind, active=excluded.active`
    ).bind(
      requiredText(component.id, 'Component ID', 64),
      requiredText(component.label, 'Component name', 80),
      component.kind,
      Number(component.active ?? 1)
    ));
  }
  for (const employee of data.employees || []) {
    const e = employeeValues(employee, null, 'admin');
    statements.push(db.prepare(
      `INSERT INTO employees
       (id, name, department, designation, area, joining_date, relieving_date, monthly_ctc,
        pf_applicable, esic_applicable, pan, uan, esic_number, email, bank_account, ifsc, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, department=excluded.department,
       designation=excluded.designation, area=excluded.area, joining_date=excluded.joining_date,
       relieving_date=excluded.relieving_date, monthly_ctc=excluded.monthly_ctc,
       pf_applicable=excluded.pf_applicable, esic_applicable=excluded.esic_applicable,
       pan=excluded.pan, uan=excluded.uan, esic_number=excluded.esic_number,
       email=excluded.email, bank_account=excluded.bank_account, ifsc=excluded.ifsc,
       active=excluded.active`
    ).bind(
      e.id, e.name, e.department, e.designation, e.area, e.joining_date, e.relieving_date,
      e.monthly_ctc, e.pf_applicable, e.esic_applicable, e.pan, e.uan, e.esic_number,
      e.email, e.bank_account, e.ifsc, Number(employee.active ?? 1)
    ));
  }
  for (const revision of data.salary_revisions || []) {
    if (!isIsoDate(revision.effective_date)) throw new Error('A salary revision has an invalid effective date.');
    statements.push(db.prepare(
      `INSERT INTO salary_revisions (id, employee_id, effective_date, monthly_ctc, reason, source_order)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET employee_id=excluded.employee_id,
       effective_date=excluded.effective_date, monthly_ctc=excluded.monthly_ctc,
       reason=excluded.reason, source_order=excluded.source_order`
    ).bind(
      requiredText(revision.id || crypto.randomUUID(), 'Revision ID', 80),
      requiredText(revision.employee_id, 'Employee ID', 32),
      revision.effective_date,
      numberValue(revision.monthly_ctc, 'Revision CTC'),
      optionalText(revision.reason, 'Revision reason', 200),
      Number(revision.source_order || 0)
    ));
  }
  for (const holiday of data.holidays || []) {
    if (!isIsoDate(holiday.holiday_date)) throw new Error('A holiday has an invalid date.');
    statements.push(db.prepare(
      `INSERT INTO holidays (id, holiday_date, name, paid) VALUES (?, ?, ?, ?)
       ON CONFLICT(holiday_date, name) DO UPDATE SET paid=excluded.paid`
    ).bind(
      holiday.id || crypto.randomUUID(), holiday.holiday_date,
      requiredText(holiday.name, 'Holiday name', 120), toBool(holiday.paid, 'Paid holiday')
    ));
  }
  for (const day of data.attendance_days || []) {
    if (!isIsoDate(day.work_date) || !Object.hasOwn(ATTENDANCE_CODES, day.status) && day.status !== '') {
      throw new Error('An attendance entry has an invalid date or status.');
    }
    statements.push(db.prepare(
      `INSERT INTO attendance_days (employee_id, work_date, status) VALUES (?, ?, ?)
       ON CONFLICT(employee_id, work_date) DO UPDATE SET status=excluded.status`
    ).bind(requiredText(day.employee_id, 'Employee ID', 32), day.work_date, day.status));
  }
  for (const adjustment of data.payroll_adjustments || []) {
    if (!isMonth(adjustment.payroll_month)) throw new Error('A payroll input has an invalid month.');
    statements.push(db.prepare(
      `INSERT INTO payroll_adjustments (employee_id, payroll_month, reimbursement, advance_deduction)
       VALUES (?, ?, ?, ?) ON CONFLICT(employee_id, payroll_month) DO UPDATE SET
       reimbursement=excluded.reimbursement, advance_deduction=excluded.advance_deduction`
    ).bind(
      requiredText(adjustment.employee_id, 'Employee ID', 32),
      adjustment.payroll_month,
      numberValue(adjustment.reimbursement || 0, 'Reimbursement'),
      numberValue(adjustment.advance_deduction || 0, 'Advance deduction')
    ));
  }
  for (const [key, value] of Object.entries(data.payroll_settings || {})) {
    if (!SETTING_KEYS.has(key)) throw new Error(`Unknown payroll setting: ${key}.`);
    statements.push(db.prepare(
      `INSERT INTO payroll_settings (setting_key, setting_value, description) VALUES (?, ?, '')
       ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value`
    ).bind(key, numberValue(value, key)));
  }
  for (const item of data.payroll_recurring_items || []) {
    if (!isMonth(item.start_month) || (item.end_month && !isMonth(item.end_month))
      || (item.end_month && item.end_month < item.start_month)) {
      throw new Error('A recurring payroll item has an invalid effective period.');
    }
    statements.push(db.prepare(
      `INSERT INTO payroll_recurring_items
       (id, employee_id, component_id, amount, start_month, end_month)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET employee_id=excluded.employee_id, component_id=excluded.component_id,
       amount=excluded.amount, start_month=excluded.start_month, end_month=excluded.end_month`
    ).bind(
      requiredText(item.id, 'Payroll item ID', 64),
      requiredText(item.employee_id, 'Employee ID', 32),
      requiredText(item.component_id, 'Component ID', 64),
      numberValue(item.amount, 'Payroll item amount'),
      item.start_month,
      item.end_month || null
    ));
  }
  for (const item of data.payroll_one_off_items || []) {
    if (!isMonth(item.payroll_month) || !['earning', 'deduction'].includes(item.kind)) {
      throw new Error('A one-off payroll item has an invalid month or type.');
    }
    statements.push(db.prepare(
      `INSERT INTO payroll_one_off_items
       (id, employee_id, payroll_month, component_id, label, kind, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET employee_id=excluded.employee_id, payroll_month=excluded.payroll_month,
       component_id=excluded.component_id, label=excluded.label, kind=excluded.kind, amount=excluded.amount`
    ).bind(
      requiredText(item.id, 'Payroll item ID', 64),
      requiredText(item.employee_id, 'Employee ID', 32),
      item.payroll_month,
      item.component_id || null,
      requiredText(item.label, 'Item name', 80),
      item.kind,
      numberValue(item.amount, 'Payroll item amount')
    ));
  }
  for (const period of data.payroll_periods || []) {
    if (!isMonth(period.payroll_month) || !['draft', 'review', 'approved', 'paid'].includes(period.status)) {
      throw new Error('A payroll period is invalid.');
    }
    statements.push(db.prepare(
      `INSERT INTO payroll_periods (payroll_month, status) VALUES (?, ?)
       ON CONFLICT(payroll_month) DO UPDATE SET status=excluded.status`
    ).bind(period.payroll_month, period.status));
  }
  for (const leaveType of data.leave_types || []) {
    statements.push(db.prepare(
      `INSERT INTO leave_types (id, code, name, description, accrual_type, accrual_count, accrual_cycle, encashable, max_per_year, min_per_request, max_consecutive, color, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, description=excluded.description,
       accrual_type=excluded.accrual_type, accrual_count=excluded.accrual_count, accrual_cycle=excluded.accrual_cycle,
       encashable=excluded.encashable, max_per_year=excluded.max_per_year, min_per_request=excluded.min_per_request,
       max_consecutive=excluded.max_consecutive, color=excluded.color, active=excluded.active`
    ).bind(
      requiredText(leaveType.id, 'Leave type ID', 64),
      requiredText(leaveType.code, 'Leave code', 8),
      requiredText(leaveType.name, 'Leave name', 60),
      leaveType.description || '',
      leaveType.accrual_type || 'monthly',
      numberValue(leaveType.accrual_count, 'Accrual count'),
      leaveType.accrual_cycle || 'financial_year',
      toBool(leaveType.encashable ?? false, 'Encashable'),
      leaveType.max_per_year != null ? numberValue(leaveType.max_per_year, 'Max per year') : null,
      numberValue(leaveType.min_per_request ?? 0, 'Min per request'),
      leaveType.max_consecutive != null ? numberValue(leaveType.max_consecutive, 'Max consecutive') : null,
      leaveType.color || '#6366f1',
      toBool(leaveType.active ?? true, 'Active')
    ));
  }
  for (const leaveRequest of data.leave_requests || []) {
    statements.push(db.prepare(
      `INSERT INTO leave_requests (id, employee_id, leave_type_id, start_date, end_date, days, half_day, half_day_period, reason, status, approved_by, approved_at, rejection_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET employee_id=excluded.employee_id, leave_type_id=excluded.leave_type_id,
       start_date=excluded.start_date, end_date=excluded.end_date, days=excluded.days, half_day=excluded.half_day,
       half_day_period=excluded.half_day_period, reason=excluded.reason, status=excluded.status,
       approved_by=excluded.approved_by, approved_at=excluded.approved_at, rejection_reason=excluded.rejection_reason`
    ).bind(
      requiredText(leaveRequest.id, 'Leave request ID', 64),
      requiredText(leaveRequest.employee_id, 'Employee ID', 32),
      requiredText(leaveRequest.leave_type_id, 'Leave type ID', 64),
      leaveRequest.start_date,
      leaveRequest.end_date,
      numberValue(leaveRequest.days, 'Days'),
      toBool(leaveRequest.half_day ?? false, 'Half day'),
      leaveRequest.half_day_period || null,
      leaveRequest.reason || '',
      leaveRequest.status || 'pending',
      leaveRequest.approved_by || null,
      leaveRequest.approved_at || null,
      leaveRequest.rejection_reason || null
    ));
  }
  for (let offset = 0; offset < statements.length; offset += 100) {
    await db.batch(statements.slice(offset, offset + 100));
  }
}

app.post('/api/import/workbook-json', requireRoles('admin'), async (c) => {
  try {
    const data = await readJson(c, 20_000_000);
    if (data.format !== 'salary-workbook-import-v1' || !data.data) {
      throw new Error('Workbook import format is unsupported.');
    }
    await importData(c.env.DB, data.data);
    return c.json({
      ok: true,
      counts: Object.fromEntries(Object.entries(data.data).map(([key, value]) => [key, Array.isArray(value) ? value.length : Object.keys(value || {}).length]))
    });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to import workbook data.');
  }
});

app.get('/api/users', requireRoles('admin'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT users.id, users.username, users.role, users.created_at, employees.designation,
            users.is_active,
            COALESCE((
              SELECT GROUP_CONCAT(access_roles.code, ',')
              FROM user_access_roles
              JOIN access_roles ON access_roles.id = user_access_roles.role_id
              WHERE user_access_roles.user_id = users.id AND access_roles.is_active = 1
            ), '') AS access_roles,
            CASE WHEN COALESCE(NULLIF(users.recovery_email, ''), NULLIF(employees.email, ''), '') = ''
                 THEN 0 ELSE 1 END AS has_recovery_email
     FROM users LEFT JOIN employees ON employees.id = users.employee_id
     ORDER BY users.username`
  ).all();
  return c.json(rows.results);
});

app.post('/api/users', requireRoles('admin'), async (c) => {
  try {
    const body = await readJson(c, 20_000);
    const username = requiredText(body.username, 'Username', 80);
    const password = requiredText(body.password, 'Password', 200);
    const recoveryEmail = optionalEmail(body.recovery_email);
    if (password.length < 12) throw new Error('Password must be at least 12 characters.');
    if (!['admin', 'hr', 'payroll', 'employee'].includes(body.role)) throw new Error('Role must be admin, hr, payroll, or employee.');
    const defaultAccessRole = ({ admin: 'super_admin', hr: 'hr_admin', payroll: 'finance', employee: 'employee' })[body.role];
    const accessRoleCode = requiredText(body.access_role_code || defaultAccessRole, 'Functional role', 40);
    if (!ACCESS_ROLE_CODES.has(accessRoleCode)) {
      if (body.role !== 'employee') throw new Error('Custom functional roles require an employee account.');
    } else if (
      (accessRoleCode === 'super_admin' && body.role !== 'admin')
      || (accessRoleCode === 'hr_admin' && body.role !== 'hr')
      || (accessRoleCode === 'finance' && body.role !== 'payroll')
      || (['department_head', 'regional_manager', 'area_manager', 'employee'].includes(accessRoleCode) && body.role !== 'employee')
    ) {
      throw new Error('The selected functional role does not match the account role.');
    }

    // If role is employee, validate employee_id
    let employeeId = null;
    if (body.role === 'employee') {
      if (!body.employee_id) throw new Error('Employee ID is required for employee role.');
      const emp = await c.env.DB.prepare('SELECT id FROM employees WHERE id = ? AND active = 1').bind(body.employee_id).first();
      if (!emp) throw new Error('Active employee not found for the given Employee ID.');
      employeeId = body.employee_id;
    }

    const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
    const id = crypto.randomUUID();
    const accessRole = await c.env.DB.prepare(`
      SELECT id FROM access_roles WHERE code = ? AND is_active = 1
    `).bind(accessRoleCode).first();
    if (!accessRole) throw new Error('The selected functional role is not active.');
    const assignedRoles = [accessRole.id];
    if (body.role === 'employee' && accessRoleCode !== 'employee') {
      const employeeRole = await c.env.DB.prepare(`
        SELECT id FROM access_roles WHERE code = 'employee' AND is_active = 1
      `).first();
      if (!employeeRole) throw new Error('The employee self-service role is not configured.');
      assignedRoles.push(employeeRole.id);
    }
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO users (id, username, password_salt, password_hash, role, employee_id, recovery_email) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(id, username, salt, await passwordHash(password, salt), body.role, employeeId, recoveryEmail),
      ...assignedRoles.map((roleId) => c.env.DB.prepare(
        'INSERT INTO user_access_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)'
      ).bind(id, roleId, c.get('user').id))
    ]);
    await appendAccessAudit(c.env.DB, c.get('user'), 'create_user', 'user', id, null,
      { username, account_role: body.role, access_role: accessRoleCode, employee_id: employeeId });
    await adminAuditLog(c.env.DB, c, 'create_user', 'user', id, { username, role: body.role, employee_id: employeeId });
    return c.json({ id, username, role: body.role, access_role: accessRoleCode, employee_id: employeeId }, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to create user.');
  }
});

app.put('/api/users/:id/recovery-email', requireRoles('admin'), async (c) => {
  try {
    const body = await readJson(c, 20_000);
    const recoveryEmail = optionalEmail(body.recovery_email);
    const targetId = c.req.param('id');
    const user = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?')
      .bind(targetId).first();
    if (!user) return jsonError(c, 404, 'User was not found.');

    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET recovery_email = ? WHERE id = ?').bind(recoveryEmail, user.id),
      c.env.DB.prepare('DELETE FROM auth_recovery_challenges WHERE user_id = ?').bind(user.id)
    ]);
    await adminAuditLog(c.env.DB, c, 'update_recovery_email', 'user', targetId, { has_email: !!recoveryEmail });
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to update recovery email.');
  }
});

app.post('/api/users/:id/reset-password', requireRoles('admin'), async (c) => {
  try {
    const body = await readJson(c, 20_000);
    const password = requiredText(body.password, 'Password', 200);
    if (password.length < 12) throw new Error('Password must be at least 12 characters.');

    const targetId = c.req.param('id');
    const user = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?')
      .bind(targetId).first();
    if (!user) return jsonError(c, 404, 'User was not found.');

    const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await passwordHash(password, salt);
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?')
        .bind(salt, hash, user.id),
      c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id)
    ]);
    await adminAuditLog(c.env.DB, c, 'reset_password', 'user', targetId, {});
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to reset user password.');
  }
});

app.delete('/api/users/:id', requireRoles('admin'), async (c) => {
  const userId = c.req.param('id');
  if (userId === c.get('user').id) {
    return jsonError(c, 400, 'You cannot remove your own account.');
  }

  const user = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(userId).first();
  if (!user) return jsonError(c, 404, 'User was not found.');
  if (user.role === 'admin') return jsonError(c, 409, 'The last administrator cannot be removed.');

  const result = await c.env.DB.prepare(
    `DELETE FROM users
     WHERE id = ? AND (role != 'admin' OR (SELECT COUNT(*) FROM users WHERE role = 'admin') > 1)`
  ).bind(userId).run();
  if (result.meta.changes) {
    await adminAuditLog(c.env.DB, c, 'delete_user', 'user', userId, { role: user.role });
    return c.json({ ok: true });
  }
  return jsonError(c, 409, 'User could not be removed.');
});

/* ============================================================
   EMPLOYEE DETAIL DASHBOARD - Combined salary revision + attendance
   ============================================================ */
app.get('/api/employees/:employee_id', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  const employeeId = c.req.param('employee_id');
  const user = c.get('user');
  const employee = await c.env.DB.prepare(
    'SELECT * FROM employees WHERE id = ? AND active = 1'
  ).bind(employeeId).first();
  if (!employee) return jsonError(c, 404, 'Employee not found.');

  // Get latest salary revision
  const revision = await c.env.DB.prepare(
    'SELECT * FROM salary_revisions WHERE employee_id = ? ORDER BY source_order DESC, effective_date DESC LIMIT 1'
  ).bind(employeeId).first();

  // Get leave balance summary
  const leaveBalances = await c.env.DB.prepare(
    'SELECT lb.*, lt.code AS leave_code, lt.name AS leave_name FROM leave_balances lb JOIN leave_types lt ON lt.id = lb.leave_type_id WHERE lb.employee_id = ? AND lb.year = ?'
  ).bind(employeeId, new Date().getFullYear()).all();
  const canViewFinancial = user.access_control_enabled === undefined
    ? ['admin', 'payroll'].includes(user.role)
    : await canAccessEmployee(c.env.DB, user, employeeId, { financial: true });

  return c.json({
    employee: canViewFinancial ? asEmployee(employee) : withoutSensitiveEmployeeFields(asEmployee(employee)),
    salary_revision: canViewFinancial ? revision || null : null,
    leave_balances: leaveBalances.results
  });
});

/* ============================================================
   EMPLOYEE ROUTE PLAYBACK WITH SELFIES (Manager view)
   ============================================================ */
app.get('/api/employees/:employee_id/route-playback', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  const employeeId = c.req.param('employee_id');
  const month = c.req.query('month');
  const user = c.get('user');

  if (!month || !isMonth(month)) return jsonError(c, 400, 'Month is required in YYYY-MM format.');

  // Log the view for audit
  const viewerId = user.id;

  // Get selfies stored in the database
  const selfies = await c.env.DB.prepare(
    `SELECT s.*, e.name AS employee_name
     FROM travel_selfies s
     JOIN employees e ON e.id = s.employee_id
     WHERE s.employee_id = ? AND DATE(s.recorded_at) >= ? AND DATE(s.recorded_at) <= ?`
  ).bind(
    employeeId,
    `${month}-01`,
    `${month}-${String(new Date(Number(month.split('-')[0]), Number(month.split('-')[1]), 0).getUTCDate()).toString().padStart(2, '0')}`
  ).all();

  // Get journeys for the month
  const journeys = await c.env.DB.prepare(
    `SELECT j.*,
            (SELECT lat FROM travel_route_points WHERE journey_id = j.id ORDER BY recorded_at LIMIT 1) AS start_lat,
            (SELECT lng FROM travel_route_points WHERE journey_id = j.id ORDER BY recorded_at LIMIT 1) AS start_lng,
            (SELECT lat FROM travel_route_points WHERE journey_id = j.id ORDER BY recorded_at DESC LIMIT 1) AS end_lat,
            (SELECT lng FROM travel_route_points WHERE journey_id = j.id ORDER BY recorded_at DESC LIMIT 1) AS end_lng
     FROM travel_journeys j
     WHERE j.employee_id = ? AND j.travel_date LIKE ? || '%'
     ORDER BY j.travel_date`
  ).bind(employeeId, `${month}%`).all();

  // Get attendance for context
  const firstDay = `${month}-01`;
  const lastDay = `${month}-${String(new Date(Number(month.split('-')[0]), Number(month.split('-')[1]), 0).getUTCDate()).toString().padStart(2, '0')}`;
  const attendance = await c.env.DB.prepare(
    `SELECT work_date, status FROM attendance_days
     WHERE employee_id = ? AND work_date >= ? AND work_date <= ?`
  ).bind(employeeId, firstDay, lastDay).all();

  // Get punch events for selfie linkage
  const punchEvents = await c.env.DB.prepare(
    `SELECT pe.*, s.id AS selfie_id
     FROM travel_punch_events pe
     LEFT JOIN travel_selfies s ON s.punch_id = pe.id
     WHERE pe.employee_id = ? AND pe.punch_date LIKE ? || '%'`
  ).bind(employeeId, `${month}%`).all();

  // Log audit entry
  await c.env.DB.prepare(
    'INSERT INTO employee_location_audits (id, viewer_user_id, viewer_role, target_employee_id, action, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(),
    viewerId,
    user.role,
    employeeId,
    'view_route',
    null,
    new Date().toISOString()
  ).run();

  return c.json({
    employee_name: selfies.results[0]?.employee_name || '',
    selfies: selfies.results,
    journeys: journeys.results,
    attendance: attendance.results,
    punches: punchEvents.results
  });
});

/* ============================================================
   EMPLOYEE OWN ROUTE PLAYBACK (Self view - employee only)
   ============================================================ */
app.get('/api/employee/route-playback', requireRoles('employee'), async (c) => {
  const user = c.get('user');
  const employeeId = user.employee_id;
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7);

  // Get selfies for own journeys only
  const selfies = await c.env.DB.prepare(
    `SELECT s.id, s.image_data, s.recorded_at, s.face_verified,
            j.travel_date, j.id AS journey_id
     FROM travel_selfies s
     JOIN travel_journeys j ON j.id = s.journey_id
     WHERE s.employee_id = ? AND j.travel_date LIKE ? || '%'`
  ).bind(employeeId, `${month}%`).all();

  // Get journeys
  const journeys = await c.env.DB.prepare(
    `SELECT j.*,
            (SELECT lat FROM travel_route_points WHERE journey_id = j.id ORDER BY recorded_at LIMIT 1) AS start_lat,
            (SELECT lng FROM travel_route_points WHERE journey_id = j.id ORDER BY recorded_at LIMIT 1) AS start_lng,
            (SELECT lat FROM travel_route_points WHERE journey_id = j.id ORDER BY recorded_at DESC LIMIT 1) AS end_lat,
            (SELECT lng FROM travel_route_points WHERE journey_id = j.id ORDER BY recorded_at DESC LIMIT 1) AS end_lng
     FROM travel_journeys j
     WHERE j.employee_id = ? AND j.travel_date LIKE ? || '%'
     ORDER BY j.travel_date`
  ).bind(employeeId, `${month}%`).all();

  return c.json({
    selfies: selfies.results,
    journeys: journeys.results
  });
});

/* ============================================================
   CUSTOMER VISIT ATTENDANCE MARKING
   ============================================================ */
// When a DCR visit is completed and confirmed, it can mark attendance
app.post('/api/visits/:visit_id/attend', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  try {
    const visitId = c.req.param('visit_id');
    const visit = await c.env.DB.prepare(
      'SELECT * FROM travel_visits WHERE id = ?'
    ).bind(visitId).first();
    if (!visit) return jsonError(c, 404, 'Visit not found.');

    // Get the visit date and employee
    const visitDate = visit.visit_date;
    const employeeId = visit.employee_id;
    if (!await canAccessEmployee(c.env.DB, c.get('user'), employeeId)) {
      return jsonError(c, 403, 'You do not have access to update attendance for this employee.');
    }

    // Check if attendance already exists for this date
    const existing = await c.env.DB.prepare(
      'SELECT * FROM attendance_days WHERE employee_id = ? AND work_date = ?'
    ).bind(employeeId, visitDate).first();

    if (existing) {
      return c.json({ message: 'Attendance already exists for this date.', attendance: existing });
    }

    // Mark as Present (customer visit = worked day)
    await c.env.DB.prepare(
      'INSERT INTO attendance_days (employee_id, work_date, status, source) VALUES (?, ?, ?, ?)'
    ).bind(employeeId, visitDate, 'P', 'customer_visit').run();

    // Update visit to mark attendance done
    await c.env.DB.prepare(
      'UPDATE travel_visits SET attendance_marked = 1, attendance_date = ? WHERE id = ?'
    ).bind(visitDate, visitId).run();

    return c.json({
      ok: true,
      attendance: { employee_id: employeeId, work_date: visitDate, status: 'P', source: 'customer_visit' }
    });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to mark attendance.');
  }
});

/* ============================================================
   MARK TODAY AS PRESENT (customer visit attendance)
   ============================================================ */
app.post('/api/attendance/today', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  try {
    const user = c.get('user');
    const body = await readJson(c);
    const employeeId = body.employee_id;
    const workDate = body.work_date || new Date().toISOString().slice(0, 10);

    if (!employeeId) return jsonError(c, 400, 'Employee ID is required.');
    if (!await canAccessEmployee(c.env.DB, user, employeeId)) {
      return jsonError(c, 403, 'You do not have access to mark attendance for this employee.');
    }

    // Check if attendance already exists for this date
    const existing = await c.env.DB.prepare(
      'SELECT * FROM attendance_days WHERE employee_id = ? AND work_date = ?'
    ).bind(employeeId, workDate).first();

    if (existing) {
      return c.json({ message: 'Attendance already exists for this date.', attendance: existing });
    }

    // Mark as Present (customer visit = worked day)
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      'INSERT INTO attendance_days (id, employee_id, work_date, status, source) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, employeeId, workDate, 'P', 'customer_visit').run();

    // Log the attendance action
    await c.env.DB.prepare(
      'INSERT INTO attendance_actions (attendance_id, source_type, reference_id, action_by, action_at, notes) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, 'customer_visit', null, user.id, new Date().toISOString(), body.notes || 'Marked from customer visit').run();

    return c.json({
      ok: true,
      attendance: { id, employee_id: employeeId, work_date: workDate, status: 'P', source: 'customer_visit' }
    });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to mark attendance.');
  }
});

/* ============================================================
   EMPLOYEE LOCATION AUDIT API
   ============================================================ */
app.get('/api/employees/:employee_id/location-audit', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  const employeeId = c.req.param('employee_id');
  const from = c.req.query('from');
  const to = c.req.query('to');

  let query = `SELECT la.*, u.username AS viewer_username, u.role AS viewer_role
               FROM employee_location_audits la
               JOIN users u ON u.id = la.viewer_user_id
               WHERE la.target_employee_id = ?`;
  const bindings = [employeeId];

  if (from) {
    query += ' AND la.created_at >= ?';
    bindings.push(from);
  }
  if (to) {
    query += ' AND la.created_at <= ?';
    bindings.push(to);
  }
  query += ' ORDER BY la.created_at DESC LIMIT 500';

  const rows = await c.env.DB.prepare(query).bind(...bindings).all();
  return c.json(rows.results);
});

/* ============================================================
   SALARY REVISION + ATTENDANCE MERGE FOR EMPLOYEE TAB
   ============================================================ */
app.get('/api/employees/:employee_id/salary-attendance', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  const employeeId = c.req.param('employee_id');
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7);

  const employee = await c.env.DB.prepare(
    'SELECT * FROM employees WHERE id = ? AND active = 1'
  ).bind(employeeId).first();
  if (!employee) return jsonError(c, 404, 'Employee not found.');

  // Get salary revision effective for this month
  const revision = await c.env.DB.prepare(
    `SELECT * FROM salary_revisions
     WHERE employee_id = ? AND effective_date <= ?
     ORDER BY source_order DESC, effective_date DESC
     LIMIT 1`
  ).bind(employeeId, month).first();

  // Get attendance for the month
  const firstDay = `${month}-01`;
  const lastDay = `${month}-${String(new Date(Number(month.split('-')[0]), Number(month.split('-')[1]), 0).getUTCDate()).toString().padStart(2, '0')}`;
  const attendanceEntries = await c.env.DB.prepare(
    `SELECT work_date, status, source FROM attendance_days
     WHERE employee_id = ? AND work_date >= ? AND work_date <= ?`
  ).bind(employeeId, firstDay, lastDay).all();

  // Calculate attendance summary
  let presentDays = 0;
  let absentDays = 0;
  let leaveDays = 0;
  const sourceCounts = {};

  for (const entry of attendanceEntries.results) {
    const source = entry.source || 'manual';
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;

    if (entry.status === 'P' || entry.status === 'R') presentDays++;
    else if (entry.status === 'A') absentDays++;
    else if (['CL', 'SL', 'L'].includes(entry.status)) leaveDays++;
  }

  return c.json({
    employee: asEmployee(employee),
    salary_revision: revision || null,
    attendance: {
      month,
      days: attendanceEntries.results,
      summary: {
        present: presentDays,
        absent: absentDays,
        leave: leaveDays,
        by_source: sourceCounts
      }
    }
  });
});

/* ============================================================
   EMPLOYEE DETAIL (alias endpoint used by Employee tab)
   ============================================================ */
app.get('/api/employee-detail/:employee_id', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  const employeeId = c.req.param('employee_id');
  const user = c.get('user');
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7);

  const employee = await c.env.DB.prepare(
    'SELECT * FROM employees WHERE id = ? AND active = 1'
  ).bind(employeeId).first();
  if (!employee) return jsonError(c, 404, 'Employee not found.');

  // Get salary revision effective for this month
  const revision = await c.env.DB.prepare(
    `SELECT * FROM salary_revisions
     WHERE employee_id = ? AND effective_date <= ?
     ORDER BY source_order DESC, effective_date DESC
     LIMIT 1`
  ).bind(employeeId, month).first();

  // Get attendance for the month
  const firstDay = `${month}-01`;
  const lastDay = `${month}-${String(new Date(Number(month.split('-')[0]), Number(month.split('-')[1]), 0).getUTCDate()).toString().padStart(2, '0')}`;
  const attendanceEntries = await c.env.DB.prepare(
    `SELECT work_date, status, source FROM attendance_days
     WHERE employee_id = ? AND work_date >= ? AND work_date <= ?`
  ).bind(employeeId, firstDay, lastDay).all();

  const [travelJourneys, leaveBalances] = await Promise.all([
    c.env.DB.prepare(
      `SELECT travel_date, status, gps_distance_km, approved_distance_km
       FROM travel_journeys
       WHERE employee_id = ?
       ORDER BY travel_date DESC
       LIMIT 50`
    ).bind(employeeId).all(),
    c.env.DB.prepare(
      `SELECT lb.opening_balance, lb.accrued, lb.used, lb.closing_balance,
              lt.code AS leave_code, lt.name AS leave_name
       FROM leave_balances lb
       JOIN leave_types lt ON lt.id = lb.leave_type_id
       WHERE lb.employee_id = ? AND lb.year = ?`
    ).bind(employeeId, new Date().getFullYear()).all()
  ]);
  const canViewFinancial = user.access_control_enabled === undefined
    ? ['admin', 'payroll'].includes(user.role)
    : await canAccessEmployee(c.env.DB, user, employeeId, { financial: true });

  // Calculate attendance summary
  let presentDays = 0;
  let absentDays = 0;
  let leaveDays = 0;
  const sourceCounts = {};

  for (const entry of attendanceEntries.results) {
    const source = entry.source || 'manual';
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;

    if (entry.status === 'P' || entry.status === 'R') presentDays++;
    else if (entry.status === 'A') absentDays++;
    else if (['CL', 'SL', 'L'].includes(entry.status)) leaveDays++;
  }

  return c.json({
    employee: canViewFinancial ? asEmployee(employee) : withoutSensitiveEmployeeFields(asEmployee(employee)),
    salary_revision: canViewFinancial ? revision || null : null,
    attendance: {
      month,
      days: attendanceEntries.results,
      summary: {
        present: presentDays,
        absent: absentDays,
        leave: leaveDays,
        by_source: sourceCounts
      }
    },
    travel: {
      journeys: travelJourneys.results,
      approved_km_total: travelJourneys.results.reduce(
        (sum, journey) => sum + (journey.status === 'approved' ? Number(journey.approved_distance_km) || 0 : 0),
        0
      )
    },
    leave: {
      balances: leaveBalances.results
    }
  });
});

/* ============================================================
   FULL MANAGER DASHBOARD - Employee detail view
   ============================================================ */
app.get('/api/manager/employee/:employee_id', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  const employeeId = c.req.param('employee_id');
  const user = c.get('user');

  const employee = await c.env.DB.prepare(
    'SELECT * FROM employees WHERE id = ? AND active = 1'
  ).bind(employeeId).first();
  if (!employee) return jsonError(c, 404, 'Employee not found.');

  // Gather all employee data in parallel
  const [
    salaryRevisions,
    travelJourneys,
    liveJourney,
    leaveRequests,
    activeTasks,
    customerVisits,
    expenseClaims,
    dashboardPrefs
  ] = await Promise.all([
    // Salary revisions
    c.env.DB.prepare(
      'SELECT * FROM salary_revisions WHERE employee_id = ? ORDER BY effective_date DESC'
    ).bind(employeeId).all(),

    // Travel journeys (approved)
    c.env.DB.prepare(
      'SELECT j.*, e.name AS employee_name FROM travel_journeys j JOIN employees e ON e.id = j.employee_id WHERE j.employee_id = ? AND j.status = \'approved\' ORDER BY j.travel_date DESC LIMIT 50'
    ).bind(employeeId).all(),

    // Live tracking
    c.env.DB.prepare(
      `SELECT l.*, j.travel_date, j.id AS journey_id
       FROM travel_live_sessions l
       JOIN travel_journeys j ON j.id = l.journey_id
       WHERE j.employee_id = ?`
    ).bind(employeeId).all(),

    // Leave requests
    c.env.DB.prepare(
      'SELECT lr.*, lt.code AS leave_code, lt.name AS leave_name FROM leave_requests lr JOIN leave_types lt ON lt.id = lr.leave_type_id WHERE lr.employee_id = ? ORDER BY lr.created_at DESC LIMIT 20'
    ).bind(employeeId).all(),

    // Active tasks
    c.env.DB.prepare(
      "SELECT t.*, c.name AS customer_name FROM travel_tasks t LEFT JOIN travel_customers c ON c.id = t.customer_id WHERE t.employee_id = ? AND t.status = 'in_progress' ORDER BY t.created_at DESC"
    ).bind(employeeId).all(),

    // Recent customer visits
    c.env.DB.prepare(
      'SELECT * FROM travel_visits WHERE employee_id = ? AND visit_date >= ? ORDER BY visit_date DESC LIMIT 20'
    ).bind(employeeId, `${new Date().toISOString().slice(0, 7)}-01`).all(),

    // Expense claims
    c.env.DB.prepare(
      'SELECT * FROM travel_expense_claims WHERE employee_id = ? ORDER BY created_at DESC LIMIT 20'
    ).bind(employeeId).all(),

    // Dashboard preferences
    c.env.DB.prepare(
      'SELECT * FROM employee_dashboard_settings WHERE employee_id = ?'
    ).bind(employeeId).first()
  ]);

  // Get leave balances
  const leaveBalances = await c.env.DB.prepare(
    'SELECT lb.*, lt.code AS leave_code, lt.name AS leave_name FROM leave_balances lb JOIN leave_types lt ON lt.id = lb.leave_type_id WHERE lb.employee_id = ? AND lb.year = ?'
  ).bind(employeeId, new Date().getFullYear()).all();

  // Log audit entry
  await c.env.DB.prepare(
    'INSERT INTO employee_location_audits (id, viewer_user_id, viewer_role, target_employee_id, action, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(),
    user.id,
    user.role,
    employeeId,
    'view_detail',
    new Date().toISOString()
  ).run();

  const canViewFinancial = user.access_control_enabled === undefined
    ? ['admin', 'payroll'].includes(user.role)
    : await canAccessEmployee(c.env.DB, user, employeeId, { financial: true });

  return c.json({
    employee: canViewFinancial ? asEmployee(employee) : withoutSensitiveEmployeeFields(asEmployee(employee)),
    salary_revisions: canViewFinancial ? salaryRevisions.results : [],
    travel: {
      journeys: travelJourneys.results,
      live_session: liveJourney.results[0] || null,
      approved_km_total: travelJourneys.results.reduce((sum, j) => sum + (Number(j.approved_distance_km) || 0), 0)
    },
    leave: {
      requests: leaveRequests.results,
      balances: leaveBalances.results
    },
    tasks: activeTasks.results,
    customer_visits: customerVisits.results,
    expense_claims: expenseClaims.results,
    dashboard_prefs: dashboardPrefs || null
  });
});

/* ============================================================
   SATELLITE MAP SUPPORT
   ============================================================ */
app.get('/api/map/tile', requireRoles('admin', 'hr', 'payroll', 'employee'), async (c) => {
  // Return tile endpoint info for satellite/hybrid maps
  // Uses OpenStreetMap standard tile layers
  const mapType = c.req.query('type') || 'satellite';
  const zoom = Number(c.req.query('zoom') || 12);
  const x = Number(c.req.query('x') || 0);
  const y = Number(c.req.query('y') || 0);

  // Standard OSM tile server
  const tileServers = {
    roadmap: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    hybrid: 'https://tile1.gs.mapbox.com/v4/openupmap/terrain-rgb/{z}/{x}/{y}.png'
  };

  const baseUrl = tileServers[mapType] || tileServers.satellite;

  // Cache headers for tile optimization
  c.header('Cache-Control', 'public, max-age=86400');
  return c.json({
    tile_url: baseUrl,
    attribution: '© OpenStreetMap contributors, © Esri',
    zoom,
    x,
    y,
    map_type: mapType
  });
});

/* ============================================================
   ATTENDANCE AUTO-MARKING SETTINGS
   ============================================================ */
app.get('/api/attendance/auto-mark', requireRoles('admin', 'hr'), async (c) => {
  // Default settings: attendance NOT auto-marked as present
  // Customer visits can mark attendance
  const settings = await c.env.DB.prepare('SELECT setting_key, setting_value FROM company_settings WHERE setting_key LIKE \'auto_mark%\'').all();
  const autoMarkSettings = Object.fromEntries(settings.results.map(r => [r.setting_key, r.setting_value]));

  return c.json({
    auto_mark_weekdays: autoMarkSettings.auto_mark_weekdays || '0',  // 0 = don't auto-mark
    auto_mark_after_visit_hours: autoMarkSettings.auto_mark_after_visit_hours || '2',  // Auto-mark P after X hours
    customer_visit_marks_attendance: autoMarkSettings.customer_visit_marks_attendance || '1'
  });
});

/* ============================================================
   USER DASHBOARD PREFERENCES
   ============================================================ */
app.put('/api/user/preferences', requireRoles('admin', 'hr', 'payroll', 'employee'), async (c) => {
  try {
    const user = c.get('user');
    const body = await readJson(c);

    // Validate preferences
    const allowedKeys = ['last_view', 'show_salary_in_employees', 'map_show_satellite', 'map_zoom_level'];
    const updates = {};

    for (const key of Object.keys(body)) {
      if (allowedKeys.includes(key)) {
        updates[`preferences_${key}`] = JSON.stringify(body[key]);
      }
    }

    if (Object.keys(updates).length === 0) {
      return jsonError(c, 400, 'No valid preferences to update.');
    }

    // Insert or update preferences
    for (const [key, value] of Object.entries(updates)) {
      await c.env.DB.prepare(
        `INSERT INTO company_settings (setting_key, setting_value) VALUES (?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`
      ).bind(key, value).run();
    }

    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to update preferences.');
  }
});

/* ============================================================
   SAMPLE TRACKING - Track promotional samples and inputs
   ============================================================ */
app.get('/api/samples', requireRoles('admin', 'hr', 'payroll', 'employee'), async (c) => {
  const user = c.get('user');
  const employeeId = await selfServiceOnly(c.env.DB, user) ? user.employee_id : c.req.query('employee_id');
  const statusFilter = c.req.query('status');
  const dateFrom = c.req.query('date_from');
  const dateTo = c.req.query('date_to');
  if (employeeId && !await employeeIsInScope(c.env.DB, user, employeeId)) {
    return jsonError(c, 403, 'You do not have access to these employee samples.');
  }
  const scope = await employeeScopePredicate(c.env.DB, user, 'e');

  let query = `SELECT s.*, e.name AS employee_name, c.name AS customer_name
               FROM travel_samples s
               LEFT JOIN employees e ON e.id = s.employee_id
               LEFT JOIN travel_customers c ON c.id = s.customer_id`;
  const conditions = [scope.sql];
  const bindings = [...scope.bindings];

  if (employeeId) {
    conditions.push('s.employee_id = ?');
    bindings.push(employeeId);
  }
  if (statusFilter) {
    conditions.push('s.status = ?');
    bindings.push(statusFilter);
  }
  if (dateFrom) {
    conditions.push('s.allocated_at >= ?');
    bindings.push(dateFrom);
  }
  if (dateTo) {
    conditions.push('s.allocated_at <= ?');
    bindings.push(dateTo);
  }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY s.allocated_at DESC LIMIT 500';

  const rows = await c.env.DB.prepare(query).bind(...bindings).all();
  return c.json(rows.results);
});

app.post('/api/samples', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  try {
    const body = await readJson(c);
    const user = c.get('user');
    const employeeId = requiredText(body.employee_id, 'Employee ID', 32);
    if (!await employeeIsInScope(c.env.DB, user, employeeId)) {
      return jsonError(c, 403, 'You do not have access to allocate samples to this employee.');
    }
    const sample = {
      id: crypto.randomUUID(),
      employee_id: employeeId,
      customer_id: body.customer_id || null,
      sample_name: requiredText(body.sample_name, 'Sample name', 120),
      batch_number: requiredText(body.batch_number, 'Batch number', 64),
      quantity: numberValue(body.quantity, 'Quantity', { minimum: 1 }),
      unit: body.unit || 'piece',
      allocated_at: body.allocated_at || new Date().toISOString().slice(0, 10),
      notes: body.notes || ''
    };
    await c.env.DB.prepare(
      `INSERT INTO travel_samples (id, employee_id, customer_id, sample_name, batch_number, quantity, unit, allocated_at, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(
      sample.id, sample.employee_id, sample.customer_id, sample.sample_name,
      sample.batch_number, sample.quantity, sample.unit, sample.allocated_at, sample.notes
    ).run();
    return c.json(sample, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to record sample allocation.');
  }
});

app.put('/api/samples/:id', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  try {
    const current = await c.env.DB.prepare(
      'SELECT employee_id FROM travel_samples WHERE id = ?'
    ).bind(c.req.param('id')).first();
    if (!current) return jsonError(c, 404, 'Sample allocation not found.');
    if (!await employeeIsInScope(c.env.DB, c.get('user'), current.employee_id)) {
      return jsonError(c, 403, 'You do not have access to update this sample allocation.');
    }
    const body = await readJson(c);
    const updates = {};
    if (body.status !== undefined) updates.status = body.status;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.returned_at !== undefined) updates.returned_at = body.returned_at;
    if (Object.keys(updates).length === 0) throw new Error('No fields to update.');

    const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await c.env.DB.prepare(
      `UPDATE travel_samples SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(...Object.values(updates), c.req.param('id')).run();
    const updated = await c.env.DB.prepare('SELECT * FROM travel_samples WHERE id = ?').bind(c.req.param('id')).first();
    return c.json(updated);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to update sample.');
  }
});

/* ============================================================
   PRODUCT CATALOG - For chemist order booking
   ============================================================ */
app.get('/api/products', requireRoles('admin', 'hr', 'payroll', 'employee'), async (c) => {
  const activeOnly = c.req.query('active') === 'true';
  let query = 'SELECT * FROM travel_products';
  const bindings = [];
  if (activeOnly) {
    query += ' WHERE active = 1';
  }
  query += ' ORDER BY name LIMIT 500';
  const rows = await c.env.DB.prepare(query).bind(...bindings).all();
  return c.json(rows.results);
});

app.post('/api/products', requireRoles('admin', 'hr'), async (c) => {
  try {
    const body = await readJson(c);
    const product = {
      id: crypto.randomUUID(),
      name: requiredText(body.name, 'Product name', 120),
      sku: body.sku || '',
      category: body.category || 'medicine',
      unit_price: numberValue(body.unit_price ?? 0, 'Unit price'),
      stock_quantity: numberValue(body.stock_quantity ?? 0, 'Stock quantity'),
      scheme_tag: body.scheme_tag || '',
      active: body.active !== false ? 1 : 0
    };
    await c.env.DB.prepare(
      `INSERT INTO travel_products (id, name, sku, category, unit_price, stock_quantity, scheme_tag, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`
    ).bind(
      product.id, product.name, product.sku, product.category,
      product.unit_price, product.stock_quantity, product.scheme_tag
    ).run();
    return c.json(product, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to create product.');
  }
});

app.put('/api/products/:id', requireRoles('admin', 'hr'), async (c) => {
  try {
    const body = await readJson(c);
    const updates = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.sku !== undefined) updates.sku = body.sku;
    if (body.category !== undefined) updates.category = body.category;
    if (body.unit_price !== undefined) updates.unit_price = body.unit_price;
    if (body.stock_quantity !== undefined) updates.stock_quantity = body.stock_quantity;
    if (body.scheme_tag !== undefined) updates.scheme_tag = body.scheme_tag;
    if (body.active !== undefined) updates.active = body.active ? 1 : 0;
    if (Object.keys(updates).length === 0) throw new Error('No fields to update.');

    const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await c.env.DB.prepare(
      `UPDATE travel_products SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(...Object.values(updates), c.req.param('id')).run();
    const updated = await c.env.DB.prepare('SELECT * FROM travel_products WHERE id = ?').bind(c.req.param('id')).first();
    return c.json(updated);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to update product.');
  }
});

/* ============================================================
   CHEMIST ORDER BOOKING - Interactive product catalog
   ============================================================ */
app.get('/api/orders', requireRoles('admin', 'hr', 'payroll', 'employee'), async (c) => {
  const user = c.get('user');
  const employeeId = await selfServiceOnly(c.env.DB, user) ? user.employee_id : c.req.query('employee_id');
  const statusFilter = c.req.query('status');
  const dateFrom = c.req.query('date_from');
  const dateTo = c.req.query('date_to');
  if (employeeId && !await employeeIsInScope(c.env.DB, user, employeeId)) {
    return jsonError(c, 403, 'You do not have access to these employee orders.');
  }
  const scope = await employeeScopePredicate(c.env.DB, user, 'e');

  let query = `SELECT o.*, c.name AS customer_name, e.name AS employee_name,
                      oi.product_id, p.name AS product_name, oi.quantity, oi.unit_price, oi.line_total
               FROM travel_chemist_orders o
               LEFT JOIN travel_customers c ON c.id = o.customer_id
               LEFT JOIN employees e ON e.id = o.employee_id
               LEFT JOIN travel_chemist_order_items oi ON oi.order_id = o.id
               LEFT JOIN travel_products p ON p.id = oi.product_id`;
  const conditions = [scope.sql];
  const bindings = [...scope.bindings];

  if (employeeId) {
    conditions.push('o.employee_id = ?');
    bindings.push(employeeId);
  }
  if (statusFilter) {
    conditions.push('o.status = ?');
    bindings.push(statusFilter);
  }
  if (dateFrom) {
    conditions.push('o.order_date >= ?');
    bindings.push(dateFrom);
  }
  if (dateTo) {
    conditions.push('o.order_date <= ?');
    bindings.push(dateTo);
  }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY o.order_date DESC LIMIT 500';

  const rows = await c.env.DB.prepare(query).bind(...bindings).all();
  // Group order items
  const orders = new Map();
  for (const row of rows.results) {
    if (!orders.has(row.id)) {
      orders.set(row.id, {
        id: row.id,
        employee_id: row.employee_id,
        customer_id: row.customer_id,
        order_date: row.order_date,
        total_amount: row.total_amount,
        status: row.status,
        notes: row.notes,
        items: []
      });
    }
    if (row.product_id) {
      orders.get(row.id).items.push({
        product_id: row.product_id,
        product_name: row.product_name,
        quantity: row.quantity,
        unit_price: row.unit_price,
        line_total: row.line_total
      });
    }
  }
  return c.json(Array.from(orders.values()));
});

app.post('/api/orders', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  try {
    const body = await readJson(c);
    const user = c.get('user');
    const employeeId = await selfServiceOnly(c.env.DB, user) ? user.employee_id : body.employee_id;
    if (!employeeId) return jsonError(c, 400, 'Employee ID is required.');
    if (!await employeeIsInScope(c.env.DB, user, employeeId)) {
      return jsonError(c, 403, 'You do not have access to create an order for this employee.');
    }

    const orderId = crypto.randomUUID();
    const orderDate = body.order_date || new Date().toISOString().slice(0, 10);

    // Validate items
    if (!body.items || !body.items.length) throw new Error('At least one order item is required.');

    // Calculate total
    let totalAmount = 0;
    const itemStatements = [];
    for (const item of body.items) {
      const quantity = numberValue(item.quantity, 'Quantity', { minimum: 1 });
      const unitPrice = numberValue(item.unit_price, 'Unit price');
      const lineTotal = quantity * unitPrice;
      totalAmount += lineTotal;

      itemStatements.push(c.env.DB.prepare(
        `INSERT INTO travel_chemist_order_items (id, order_id, product_id, quantity, unit_price, line_total, created_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      ).bind(crypto.randomUUID(), orderId, item.product_id, quantity, unitPrice, lineTotal));
    }

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO travel_chemist_orders (id, employee_id, customer_id, order_date, total_amount, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`
      ).bind(orderId, employeeId, body.customer_id || null, orderDate, totalAmount),
      ...itemStatements
    ]);

    return c.json({ id: orderId, employee_id: employeeId, order_date: orderDate, total_amount: totalAmount, status: 'pending' }, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to create order.');
  }
});

app.put('/api/orders/:id', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  try {
    const current = await c.env.DB.prepare(
      'SELECT employee_id FROM travel_chemist_orders WHERE id = ?'
    ).bind(c.req.param('id')).first();
    if (!current) return jsonError(c, 404, 'Order not found.');
    if (!await employeeIsInScope(c.env.DB, c.get('user'), current.employee_id)) {
      return jsonError(c, 403, 'You do not have access to update this order.');
    }
    const body = await readJson(c);
    const updates = {};
    if (body.status !== undefined) {
      if (!['pending', 'confirmed', 'dispatched', 'delivered', 'cancelled'].includes(body.status)) {
        throw new Error('Invalid status.');
      }
      updates.status = body.status;
    }
    if (Object.keys(updates).length === 0) throw new Error('No fields to update.');

    const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await c.env.DB.prepare(
      `UPDATE travel_chemist_orders SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(...Object.values(updates), c.req.param('id')).run();

    // Send SMS notification if status changed to dispatched
    if (body.status === 'dispatched' && c.env.TWILIO_PHONE_NUMBER) {
      const order = await c.env.DB.prepare(
        'SELECT employee_id, customer_id FROM travel_chemist_orders WHERE id = ?'
      ).bind(c.req.param('id')).first();
      // SMS sending would go here with Twilio
    }

    const updated = await c.env.DB.prepare('SELECT * FROM travel_chemist_orders WHERE id = ?').bind(c.req.param('id')).first();
    return c.json(updated);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to update order.');
  }
});

/* ============================================================
   SHIFT / ROSTER MANAGEMENT
   ============================================================ */
app.get('/api/shifts', requireRoles('admin', 'hr'), async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM travel_shifts WHERE active = 1 ORDER BY name').all();
  return c.json(rows.results);
});

app.get('/api/employees/:employee_id/shifts', requireRoles('admin', 'hr'), async (c) => {
  const employeeId = c.req.param('employee_id');
  const asOf = c.req.query('as_of') || new Date().toISOString().slice(0, 10);
  const rows = await c.env.DB.prepare(
    `SELECT es.*, s.name AS shift_name, s.start_time, s.end_time
     FROM travel_employee_shifts es
     JOIN travel_shifts s ON s.id = es.shift_id
     WHERE es.employee_id = ? AND es.effective_from <= ?
       AND (es.effective_to IS NULL OR es.effective_to >= ?)`
  ).bind(employeeId, asOf, asOf).all();
  return c.json(rows.results);
});

app.post('/api/employee-shifts', requireRoles('admin', 'hr'), async (c) => {
  try {
    const body = await readJson(c);
    const user = c.get('user');
    const employeeId = requiredText(body.employee_id, 'Employee ID', 32);
    if (!await employeeIsInScope(c.env.DB, user, employeeId)) {
      return jsonError(c, 403, 'You do not have access to assign shifts to this employee.');
    }
    const assignment = {
      id: crypto.randomUUID(),
      employee_id: employeeId,
      shift_id: requiredText(body.shift_id, 'Shift ID', 32),
      effective_from: body.effective_from || new Date().toISOString().slice(0, 10),
      effective_to: body.effective_to || null
    };
    await c.env.DB.prepare(
      `INSERT INTO travel_employee_shifts (id, employee_id, shift_id, effective_from, effective_to, created_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(assignment.id, assignment.employee_id, assignment.shift_id, assignment.effective_from, assignment.effective_to).run();
    return c.json(assignment, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to assign shift.');
  }
});

/* ============================================================
   FIELD TASK MANAGEMENT
   ============================================================ */
app.get('/api/tasks', requireRoles('admin', 'hr', 'payroll', 'employee'), async (c) => {
  const user = c.get('user');
  const employeeId = await selfServiceOnly(c.env.DB, user) ? user.employee_id : c.req.query('employee_id');
  const statusFilter = c.req.query('status');
  const typeFilter = c.req.query('type');
  if (employeeId && !await employeeIsInScope(c.env.DB, user, employeeId)) {
    return jsonError(c, 403, 'You do not have access to these employee tasks.');
  }
  const scope = await employeeScopePredicate(c.env.DB, user, 'e');

  let query = `SELECT t.*, e.name AS employee_name, c.name AS customer_name
               FROM travel_tasks t
               LEFT JOIN employees e ON e.id = t.employee_id
               LEFT JOIN travel_customers c ON c.id = t.customer_id`;
  const conditions = [scope.sql];
  const bindings = [...scope.bindings];

  if (employeeId) {
    conditions.push('t.employee_id = ?');
    bindings.push(employeeId);
  }
  if (statusFilter) {
    conditions.push('t.status = ?', statusFilter);
  }
  if (typeFilter) {
    conditions.push('t.task_type = ?', typeFilter);
  }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY t.created_at DESC LIMIT 500';

  const rows = await c.env.DB.prepare(query).bind(...bindings).all();
  return c.json(rows.results);
});

app.post('/api/tasks', requireRoles('admin', 'hr', 'payroll', 'employee'), async (c) => {
  try {
    const user = c.get('user');
    const body = await readJson(c);
    const selfOnly = await selfServiceOnly(c.env.DB, user);
    const employeeId = selfOnly ? user.employee_id : (body.employee_id || null);
    if (selfOnly && !employeeId) return jsonError(c, 400, 'This employee account is not linked to an employee record.');
    if (employeeId && !await employeeIsInScope(c.env.DB, user, employeeId)) {
      return jsonError(c, 403, 'You do not have access to create a task for this employee.');
    }

    const task = {
      id: crypto.randomUUID(),
      employee_id: employeeId,
      customer_id: body.customer_id || null,
      title: requiredText(body.title, 'Task title', 120),
      description: body.description || '',
      task_type: body.task_type || 'visit',
      priority: body.priority || 'medium',
      due_date: body.due_date || null,
      created_by: user.id
    };
    await c.env.DB.prepare(
      `INSERT INTO travel_tasks (id, employee_id, customer_id, title, description, task_type, priority, due_date, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, CURRENT_TIMESTAMP)`
    ).bind(
      task.id, task.employee_id, task.customer_id, task.title, task.description,
      task.task_type, task.priority, task.due_date, task.created_by
    ).run();
    return c.json(task, 201);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to create task.');
  }
});

app.put('/api/tasks/:id', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  try {
    const current = await c.env.DB.prepare(
      'SELECT employee_id FROM travel_tasks WHERE id = ?'
    ).bind(c.req.param('id')).first();
    if (!current) return jsonError(c, 404, 'Task not found.');
    if (!await employeeIsInScope(c.env.DB, c.get('user'), current.employee_id)) {
      return jsonError(c, 403, 'You do not have access to update this task.');
    }
    const body = await readJson(c);
    const updates = {};
    if (body.status !== undefined) {
      if (!['open', 'in_progress', 'completed', 'cancelled'].includes(body.status)) {
        throw new Error('Invalid status.');
      }
      updates.status = body.status;
      if (body.status === 'completed') updates.completed_at = new Date().toISOString();
    }
    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.due_date !== undefined) updates.due_date = body.due_date;
    if (Object.keys(updates).length === 0) throw new Error('No fields to update.');

    const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await c.env.DB.prepare(
      `UPDATE travel_tasks SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(...Object.values(updates), c.req.param('id')).run();
    const updated = await c.env.DB.prepare('SELECT * FROM travel_tasks WHERE id = ?').bind(c.req.param('id')).first();
    return c.json(updated);
  } catch (error) {
    return jsonError(c, 400, error.message || 'Unable to update task.');
  }
});

/* ============================================================
   MANAGER DASHBOARD KPIs
   ============================================================ */
app.get('/api/dashboard/kpis', requireRoles('admin', 'hr', 'payroll'), async (c) => {
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7);
  const scope = await employeeScopePredicate(c.env.DB, c.get('user'), 'e');
  const [journeys, punches, orders, samples, tasks] = await Promise.all([
    c.env.DB.prepare(
      `SELECT employee_id, travel_date, approved_distance_km, status
       FROM travel_journeys j
       JOIN employees e ON e.id = j.employee_id
       WHERE j.travel_date LIKE ? || '%' AND j.status = 'approved' AND ${scope.sql}`
    ).bind(month, ...scope.bindings).all(),
    c.env.DB.prepare(
      `SELECT p.employee_id, COUNT(*) as punch_count FROM travel_punch_events p
       JOIN employees e ON e.id = p.employee_id
       WHERE p.punch_date LIKE ? || '%' AND ${scope.sql} GROUP BY p.employee_id`
    ).bind(month, ...scope.bindings).all(),
    c.env.DB.prepare(
      `SELECT COUNT(*) as count, SUM(o.total_amount) as total FROM travel_chemist_orders o
       LEFT JOIN employees e ON e.id = o.employee_id
       WHERE o.order_date LIKE ? || '%' AND o.status IN ('confirmed', 'dispatched', 'delivered')
         AND ${scope.sql}`
    ).bind(month, ...scope.bindings).first(),
    c.env.DB.prepare(
      `SELECT s.employee_id, COUNT(*) as count FROM travel_samples s
       JOIN employees e ON e.id = s.employee_id
       WHERE date(s.allocated_at) >= ? || '-01' AND date(s.allocated_at) <= ? || '-15'
         AND s.status = 'allocated' AND ${scope.sql}
       GROUP BY s.employee_id`
    ).bind(month, month, ...scope.bindings).all(),
    c.env.DB.prepare(
      `SELECT t.status, COUNT(*) as count FROM travel_tasks t
       LEFT JOIN employees e ON e.id = t.employee_id
       WHERE ${scope.sql} GROUP BY t.status`
    ).bind(...scope.bindings).all()
  ]);

  const totalKm = journeys.results.reduce((sum, r) => sum + (Number(r.approved_distance_km) || 0), 0);
  const activeOnField = new Set(journeys.results.map(r => r.employee_id)).size;
  const punchRate = punches.results.length > 0
    ? (punches.results.filter(p => p.punch_count >= 2).length / punches.results.length * 100).toFixed(1)
    : 0;
  const ordersTotal = Number(orders?.total || 0);

  return c.json({
    month,
    total_km: totalKm,
    active_on_field: activeOnField,
    punch_rate_percent: Number(punchRate),
    orders_count: Number(orders?.count || 0),
    orders_amount: ordersTotal,
    samples_allocated: samples.results.reduce((sum, r) => sum + Number(r.count), 0),
    tasks_by_status: Object.fromEntries(tasks.results.map(r => [r.status, Number(r.count)]))
  });
});

app.notFound((c) => c.req.path.startsWith('/api/')
  ? jsonError(c, 404, 'API endpoint was not found.')
  : c.env.ASSETS.fetch(c.req.raw));

app.onError((error, c) => {
  console.error('Request failed', error);
  // Never expose error details in production - security requirement 10
  return c.json({ error: 'An unexpected error occurred. Your request could not be completed.' }, 500);
});

export default app;
