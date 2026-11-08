import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import app from '../src/index.js';

const sessionToken = 'access-control-test-session';
const sessionHash = Buffer.from(await webcrypto.subtle.digest(
  'SHA-256',
  new TextEncoder().encode(sessionToken)
)).toString('hex');

function accessDatabase(user, roles, permissions, employees = {}, reportedEmployees = [], journeys = {}, expenseClaims = {}) {
  const calls = [];
  return {
    calls,
    prepare(query) {
      let values = [];
      const statement = {
        bind(...args) {
          values = args;
          return statement;
        },
        async first() {
          calls.push({ method: 'first', query, values: [...values] });
          if (query.includes('COUNT(*) AS count FROM employees')) return { count: 0 };
          if (query.includes('FROM sessions JOIN users')) {
            return values[0] === sessionHash && user.is_active !== 0
              ? { ...user, is_active: 1, access_control_enabled: 1 }
              : null;
          }
          if (query.includes('FROM user_access_roles assignment') && query.includes('role.code = ?')) {
            return roles.includes(values[1]) ? { 1: 1 } : null;
          }
          if (query.includes('access_role_permissions permission')) {
            return permissions.some((permission) => permission.module === values[1]
              && (permission.action === values[2] || permission.action === 'manage'))
              ? { 1: 1 }
              : null;
          }
          if (query.includes('WITH RECURSIVE reports(id) AS')) {
            return reportedEmployees.includes(values[1]) ? { 1: 1 } : null;
          }
          if (query.includes('FROM travel_journeys WHERE id = ?')) return journeys[values[0]] || null;
          if (query.includes('FROM travel_expense_claims WHERE id = ?')) return expenseClaims[values[0]] || null;
          if (query.startsWith('SELECT department, region, area FROM employees WHERE id = ?')) {
            return employees[values[0]] || null;
          }
          if (query.startsWith('SELECT id, department, region, area FROM employees WHERE id = ?')) {
            const employee = employees[values[0]];
            return employee ? { id: values[0], ...employee } : null;
          }
          return null;
        },
        async all() {
          calls.push({ method: 'all', query, values: [...values] });
          if (query.includes('FROM user_access_roles')) return { results: roles.map((code) => ({ code })) };
          return { results: [] };
        },
        async run() {
          calls.push({ method: 'run', query, values: [...values] });
          return { meta: { changes: 0 } };
        }
      };
      return statement;
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    }
  };
}

async function request(DB, path, { method = 'GET', body } = {}) {
  return app.fetch(new Request(`https://salary-desk.test${path}`, {
    method,
    headers: {
      Cookie: `salary_session=${sessionToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  }), { DB });
}

test('employee functional role cannot read payroll through direct API access', async () => {
  const DB = accessDatabase(
    { id: 'employee-user', username: 'employee', role: 'employee', employee_id: 'EMP-1' },
    ['employee'],
    [{ module: 'employees', action: 'view' }, { module: 'attendance', action: 'view' }]
  );
  const response = await request(DB, '/api/payroll?month=2026-01');
  assert.equal(response.status, 403);
});

test('dashboard permission does not expose payroll totals without Finance or Super Admin', async () => {
  const DB = accessDatabase(
    { id: 'legacy-admin', username: 'admin', role: 'admin', employee_id: null },
    ['custom_role'],
    [{ module: 'dashboard', action: 'view' }]
  );
  const response = await request(DB, '/api/dashboard?month=2026-01');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).payrollTotal, null);
});

test('reports export permission alone does not grant payroll CSV access', async () => {
  const DB = accessDatabase(
    { id: 'report-user', username: 'report', role: 'admin', employee_id: null },
    ['custom_role'],
    [{ module: 'reports', action: 'export' }]
  );
  const response = await request(DB, '/api/reports/payroll.csv?month=2026-01');
  assert.equal(response.status, 403);
});

test('regional manager cannot open employee details outside the assigned region', async () => {
  const DB = accessDatabase(
    { id: 'manager-user', username: 'manager', role: 'employee', employee_id: 'MGR-1' },
    ['employee', 'regional_manager'],
    [{ module: 'employees', action: 'view' }],
    {
      'MGR-1': { department: 'Sales', region: 'West', area: 'West-1' },
      'EMP-2': { department: 'Sales', region: 'East', area: 'East-1' }
    }
  );
  const response = await request(DB, '/api/manager/employee/EMP-2');
  assert.equal(response.status, 403);
});

test('area manager cannot read a different area through the reporting-tree API', async () => {
  const DB = accessDatabase(
    { id: 'manager-user', username: 'manager', role: 'employee', employee_id: 'MGR-1' },
    ['employee', 'area_manager'],
    [{ module: 'employees', action: 'view' }],
    {
      'MGR-1': { department: 'Sales', region: 'West', area: 'West-1' },
      'MGR-2': { department: 'Sales', region: 'West', area: 'West-2' }
    }
  );
  const response = await request(DB, '/api/hierarchy/reports-all/MGR-2');
  assert.equal(response.status, 403);
});

test('department head cannot read a different department through the direct reports API', async () => {
  const DB = accessDatabase(
    { id: 'manager-user', username: 'manager', role: 'employee', employee_id: 'MGR-1' },
    ['employee', 'department_head'],
    [{ module: 'employees', action: 'view' }],
    {
      'MGR-1': { department: 'Sales', region: 'West', area: 'West-1' },
      'MGR-2': { department: 'Finance', region: 'West', area: 'West-1' }
    }
  );
  const response = await request(DB, '/api/hierarchy/reports/MGR-2');
  assert.equal(response.status, 403);
});

test('attendance ledger query is restricted to the regional manager scope', async () => {
  const DB = accessDatabase(
    { id: 'manager-user', username: 'manager', role: 'employee', employee_id: 'MGR-1' },
    ['employee', 'regional_manager'],
    [{ module: 'attendance', action: 'view' }],
    { 'MGR-1': { department: 'Sales', region: 'West', area: 'West-1' } }
  );
  const response = await request(DB, '/api/attendance?month=2026-01');
  assert.equal(response.status, 200);
  const attendanceQuery = DB.calls.find((call) =>
    call.method === 'all' && call.query.includes('FROM attendance_days')
  );
  assert.ok(attendanceQuery);
  assert.match(attendanceQuery.query, /JOIN employees ON employees\.id = attendance_days\.employee_id/);
  assert.match(attendanceQuery.query, /employees\.region = \?/);
  assert.ok(attendanceQuery.values.includes('West'));
});

test('a non-manager functional role cannot read linked employees through the attendance list', async () => {
  const DB = accessDatabase(
    { id: 'legacy-admin', username: 'admin', role: 'admin', employee_id: 'MGR-1' },
    ['custom_role'],
    [{ module: 'attendance', action: 'view' }],
    { 'MGR-1': { department: 'Sales', region: 'West', area: 'West-1' } }
  );
  const response = await request(DB, '/api/attendance?month=2026-01');
  assert.equal(response.status, 200);
  const attendanceQuery = DB.calls.find((call) =>
    call.method === 'all' && call.query.includes('FROM attendance_days')
  );
  assert.ok(attendanceQuery);
  assert.match(attendanceQuery.query, /0 = 1/);
});

test('manager operational lists include the assigned organization scope', async () => {
  const DB = accessDatabase(
    { id: 'manager-user', username: 'manager', role: 'employee', employee_id: 'MGR-1' },
    ['employee', 'area_manager'],
    [
      { module: 'field-tasks', action: 'view' },
      { module: 'sample-tracking', action: 'view' },
      { module: 'chemist-orders', action: 'view' },
      { module: 'customers', action: 'view' }
    ],
    { 'MGR-1': { department: 'Sales', region: 'West', area: 'West-1' } }
  );
  for (const path of ['/api/tasks', '/api/samples', '/api/orders', '/api/travel/customers']) {
    const response = await request(DB, path);
    assert.equal(response.status, 200);
  }
  const scopedQueries = DB.calls.filter((call) =>
    call.method === 'all' && (
      call.query.includes('FROM travel_tasks t')
      || call.query.includes('FROM travel_samples s')
      || call.query.includes('FROM travel_chemist_orders o')
      || call.query.includes('FROM travel_customers tc')
    )
  );
  assert.equal(scopedQueries.length, 4);
  for (const query of scopedQueries) {
    assert.match(query.query, /e\.area = \?/);
    assert.ok(query.values.includes('West-1'));
  }
});

test('manager dashboard KPI queries are restricted to the assigned region', async () => {
  const DB = accessDatabase(
    { id: 'manager-user', username: 'manager', role: 'employee', employee_id: 'MGR-1' },
    ['employee', 'regional_manager'],
    [{ module: 'dashboard', action: 'view' }],
    { 'MGR-1': { department: 'Sales', region: 'West', area: 'West-1' } }
  );
  const response = await request(DB, '/api/dashboard/kpis?month=2026-01');
  assert.equal(response.status, 200);
  const scopedQueries = DB.calls.filter((call) =>
    call.query.includes('travel_journeys j')
    || call.query.includes('travel_punch_events p')
    || call.query.includes('travel_chemist_orders o')
    || call.query.includes('travel_samples s')
    || call.query.includes('travel_tasks t')
  );
  assert.equal(scopedQueries.length, 5);
  for (const query of scopedQueries) {
    assert.match(query.query, /e\.region = \?/);
    assert.ok(query.values.includes('West'));
  }
});

test('expense bill listing applies the manager employee scope', async () => {
  const DB = accessDatabase(
    { id: 'manager-user', username: 'manager', role: 'employee', employee_id: 'MGR-1' },
    ['employee', 'area_manager'],
    [{ module: 'expenses', action: 'view' }],
    { 'MGR-1': { department: 'Sales', region: 'West', area: 'West-1' } }
  );
  const response = await request(DB, '/api/travel/expense-bills');
  assert.equal(response.status, 200);
  const billsQuery = DB.calls.find((call) =>
    call.method === 'all' && call.query.includes('FROM travel_expense_bills eb')
  );
  assert.ok(billsQuery);
  assert.match(billsQuery.query, /e\.area = \?/);
  assert.match(billsQuery.query, /e\.region = \?/);
  assert.ok(billsQuery.values.includes('West-1'));
  assert.ok(billsQuery.values.includes('West'));
});

test('area manager cannot create an expense bill for an employee outside the assigned area', async () => {
  const DB = accessDatabase(
    { id: 'manager-user', username: 'manager', role: 'employee', employee_id: 'MGR-1' },
    ['employee', 'area_manager'],
    [{ module: 'expenses', action: 'create' }],
    {
      'MGR-1': { department: 'Sales', region: 'West', area: 'West-1' },
      'EMP-2': { department: 'Sales', region: 'West', area: 'West-2' }
    }
  );
  const response = await request(DB, '/api/travel/expense-bills', {
    method: 'POST',
    body: { employee_id: 'EMP-2', amount: 25 }
  });
  assert.equal(response.status, 403);
  assert.equal(DB.calls.some((call) => call.method === 'run'), false);
});

test('expense claim listing is restricted to the manager organization scope', async () => {
  const DB = accessDatabase(
    { id: 'manager-user', username: 'manager', role: 'employee', employee_id: 'MGR-1' },
    ['employee', 'area_manager'],
    [{ module: 'expenses', action: 'view' }],
    { 'MGR-1': { department: 'Sales', region: 'West', area: 'West-1' } }
  );
  const response = await request(DB, '/api/travel/expense-claims');
  assert.equal(response.status, 200);
  const claimsQuery = DB.calls.find((call) =>
    call.method === 'all' && call.query.includes('FROM travel_expense_claims ec')
  );
  assert.ok(claimsQuery);
  assert.match(claimsQuery.query, /e\.area = \?/);
  assert.ok(claimsQuery.values.includes('West-1'));
});

test('legacy admin role cannot update an expense claim outside its RBAC scope', async () => {
  const DB = accessDatabase(
    { id: 'legacy-admin', username: 'admin', role: 'admin', employee_id: 'MGR-1' },
    ['custom_role'],
    [{ module: 'expenses', action: 'edit' }],
    {
      'MGR-1': { department: 'Sales', region: 'West', area: 'West-1' },
      'EMP-2': { department: 'Sales', region: 'West', area: 'West-2' }
    },
    [],
    {},
    { 'CLAIM-1': { id: 'CLAIM-1', employee_id: 'EMP-2' } }
  );
  const response = await request(DB, '/api/travel/expense-claims/CLAIM-1', {
    method: 'PUT',
    body: { status: 'approved', approved_km: 15 }
  });
  assert.equal(response.status, 403);
  assert.equal(DB.calls.some((call) => call.method === 'run'), false);
});

test('employee cannot submit route points for another employee journey', async () => {
  const DB = accessDatabase(
    { id: 'employee-user', username: 'employee', role: 'employee', employee_id: 'EMP-1' },
    ['employee'],
    [{ module: 'route-playback', action: 'create' }],
    {},
    [],
    { 'JOURNEY-1': { employee_id: 'EMP-2', status: 'live', is_live: 1 } }
  );
  const response = await request(DB, '/api/travel/route-points', {
    method: 'POST',
    body: { journey_id: 'JOURNEY-1', lat: 10, lng: 20 }
  });
  assert.equal(response.status, 403);
  assert.equal(DB.calls.some((call) => call.method === 'run'), false);
});

test('legacy admin role cannot record punches for another employee in RBAC mode', async () => {
  const DB = accessDatabase(
    { id: 'legacy-admin', username: 'admin', role: 'admin', employee_id: 'EMP-1' },
    ['custom_role'],
    [{ module: 'attendance', action: 'create' }]
  );
  const response = await request(DB, '/api/travel/punch', {
    method: 'POST',
    body: {
      employee_id: 'EMP-2',
      direction: 'in',
      selfie_url: 'data:image/jpeg;base64,AA=='
    }
  });
  assert.equal(response.status, 403);
  assert.equal(DB.calls.some((call) => call.method === 'run'), false);
});

test('legacy admin role cannot submit an expense for another employee in RBAC mode', async () => {
  const DB = accessDatabase(
    { id: 'legacy-admin', username: 'admin', role: 'admin', employee_id: 'EMP-1' },
    ['custom_role'],
    [{ module: 'expenses', action: 'create' }]
  );
  const response = await request(DB, '/api/expenses', {
    method: 'POST',
    body: {
      employee_id: 'EMP-2',
      amount: 25,
      expense_type: 'Travel',
      expense_date: '2026-01-15'
    }
  });
  assert.equal(response.status, 403);
  assert.equal(DB.calls.some((call) => call.method === 'run'), false);
});

test('legacy admin role cannot submit attendance regularization for another employee', async () => {
  const DB = accessDatabase(
    { id: 'legacy-admin', username: 'admin', role: 'admin', employee_id: 'EMP-1' },
    ['custom_role'],
    [{ module: 'attendance', action: 'create' }]
  );
  const response = await request(DB, '/api/attendance/regularisation', {
    method: 'POST',
    body: {
      employee_id: 'EMP-2',
      work_date: '2026-01-15',
      request_type: 'regularisation',
      reason: 'Correct missed punch'
    }
  });
  assert.equal(response.status, 403);
  assert.equal(DB.calls.some((call) => call.method === 'run'), false);
});

test('attendance punch sync requires HR Admin or Super Admin in RBAC mode', async () => {
  const DB = accessDatabase(
    { id: 'custom-user', username: 'custom', role: 'admin', employee_id: null },
    ['custom_role'],
    [{ module: 'attendance', action: 'create' }]
  );
  const response = await request(DB, '/api/travel/punch/sync', {
    method: 'POST',
    body: { month: '2026-01' }
  });
  assert.equal(response.status, 403);
  assert.equal(DB.calls.some((call) => call.query.includes('FROM travel_punch_events')), false);
});

test('area manager cannot mark a finance-approved expense as paid', async () => {
  const DB = accessDatabase(
    { id: 'manager-user', username: 'manager', role: 'employee', employee_id: 'MGR-1' },
    ['area_manager'],
    [{ module: 'expenses', action: 'approve' }]
  );
  const response = await request(DB, '/api/expenses/EXP-1/pay', { method: 'PUT' });
  assert.equal(response.status, 403);
  assert.equal(DB.calls.some((call) => call.method === 'run'), false);
});

test('Finance can read payroll, while inactive accounts are denied', async () => {
  const finance = accessDatabase(
    { id: 'finance-user', username: 'finance', role: 'payroll', employee_id: null },
    ['finance'],
    [{ module: 'payroll', action: 'view' }]
  );
  const financeResponse = await request(finance, '/api/payroll?month=2026-01');
  assert.equal(financeResponse.status, 200);

  const inactive = accessDatabase(
    { id: 'inactive-user', username: 'inactive', role: 'employee', employee_id: 'EMP-1', is_active: 0 },
    ['employee'],
    [{ module: 'payroll', action: 'view' }]
  );
  const inactiveResponse = await request(inactive, '/api/payroll?month=2026-01');
  assert.equal(inactiveResponse.status, 403);
});

test('role permission changes take effect on the next protected API request', async () => {
  const roles = ['employee'];
  const permissions = [{ module: 'employees', action: 'view' }];
  const DB = accessDatabase(
    { id: 'employee-user', username: 'employee', role: 'employee', employee_id: 'EMP-1' },
    roles,
    permissions
  );

  const denied = await request(DB, '/api/payroll?month=2026-01');
  assert.equal(denied.status, 403);

  roles.push('finance');
  permissions.push({ module: 'payroll', action: 'view' });
  const allowed = await request(DB, '/api/payroll?month=2026-01');
  assert.equal(allowed.status, 200);
});

test('self-service account can load its approval summary', async () => {
  const DB = accessDatabase(
    { id: 'employee-user', username: 'employee', role: 'employee', employee_id: 'EMP-1' },
    ['employee'],
    [{ module: 'attendance', action: 'view' }]
  );
  const response = await request(DB, '/api/approvals/pending');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { expenses_by_level: {}, regularisation_by_level: {} });
});

test('approval inbox returns an empty inbox when the employee has no approval role', async () => {
  const DB = accessDatabase(
    { id: 'employee-user', username: 'employee', role: 'employee', employee_id: 'EMP-1' },
    ['employee'],
    [{ module: 'attendance', action: 'view' }]
  );
  const response = await request(DB, '/api/approvals/inbox');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { pending: [], history: [] });
});

test('legacy admin account role does not grant reporting-tree access in RBAC mode', async () => {
  const DB = accessDatabase(
    { id: 'legacy-admin', username: 'admin', role: 'admin', employee_id: 'MGR-1' },
    ['custom_role'],
    [{ module: 'employees', action: 'view' }],
    {
      'MGR-1': { department: 'Sales', region: 'West', area: 'West-1' },
      'EMP-2': { department: 'Sales', region: 'West', area: 'West-1' }
    },
    ['EMP-2']
  );
  const response = await request(DB, '/api/manager/employee/EMP-2');
  assert.equal(response.status, 403);
});

test('RBAC employee account cannot read another employee payslip', async () => {
  const DB = accessDatabase(
    { id: 'legacy-admin', username: 'admin', role: 'admin', employee_id: 'EMP-1' },
    ['custom_role'],
    [{ module: 'employees', action: 'view' }]
  );
  const response = await request(DB, '/api/employee/slip?month=2026-01&employee_id=EMP-2');
  assert.equal(response.status, 403);
});

test('employee can read own travel while manager access remains organization-scoped', async () => {
  const employee = accessDatabase(
    { id: 'employee-user', username: 'employee', role: 'employee', employee_id: 'EMP-1' },
    ['employee'],
    [{ module: 'travel', action: 'view' }]
  );
  const employeeResponse = await request(employee, '/api/employee/travel');
  assert.equal(employeeResponse.status, 200);

  const manager = accessDatabase(
    { id: 'manager-user', username: 'manager', role: 'admin', employee_id: 'MGR-1' },
    ['area_manager'],
    [{ module: 'travel', action: 'view' }],
    {
      'MGR-1': { department: 'Sales', region: 'West', area: 'West-1' },
      'EMP-2': { department: 'Sales', region: 'West', area: 'West-1' }
    }
  );
  const managerResponse = await request(manager, '/api/employee/travel?employee_id=EMP-2');
  assert.equal(managerResponse.status, 200);
});
