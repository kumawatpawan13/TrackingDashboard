import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import app from '../src/index.js';

const sessionToken = 'approval-workflow-test-session';
const sessionHash = Buffer.from(await webcrypto.subtle.digest(
  'SHA-256',
  new TextEncoder().encode(sessionToken)
)).toString('hex');

function workflowDatabase() {
  const workflows = [
    { id: 'expense-workflow', request_type: 'expense', is_active: 1 },
    { id: 'attendance-workflow', request_type: 'attendance', is_active: 1 }
  ];
  const levels = [];
  const expenses = [];
  const approvals = [];
  const regularisations = [];
  const attendanceDays = [];
  const sessionUser = { id: 'admin-1', username: 'admin', role: 'admin', employee_id: null };

  const DB = {
    prepare(query) {
      let values = [];
      const statement = {
        bind(...args) {
          values = args;
          return statement;
        },
        async first() {
          if (query.includes('FROM sessions JOIN users')) {
            return values[0] === sessionHash ? sessionUser : null;
          }
          if (query.includes('FROM approval_workflows WHERE request_type = ? AND is_active = 1')) {
            return workflows.find((workflow) => workflow.request_type === values[0] && workflow.is_active) || null;
          }
          if (query.includes('FROM approval_workflows WHERE request_type = ?')) {
            const workflow = workflows.find((row) => row.request_type === values[0]);
            return workflow ? { id: workflow.id } : null;
          }
          if (query.includes('FROM travel_expenses WHERE id = ?')) {
            return expenses.find((expense) => expense.id === values[0]) || null;
          }
          if (query.includes('COUNT(*) AS count FROM travel_expenses')) {
            return { count: expenses.filter((expense) => expense.approval_workflow_id === values[0] && expense.status === 'pending').length };
          }
          if (query.includes('COUNT(*) AS count FROM attendance_regularisation')) {
            return { count: regularisations.filter((request) => request.approval_workflow_id === values[0] && request.status === 'pending').length };
          }
          if (query.includes('FROM attendance_regularisation WHERE id = ?')) {
            return regularisations.find((request) => request.id === values[0]) || null;
          }
          return null;
        },
        async all() {
          if (query.includes('FROM approval_workflow_levels WHERE workflow_id = ?')) {
            return { results: levels.filter((level) => level.workflow_id === values[0]).sort((a, b) => b.order_index - a.order_index) };
          }
          return { results: [] };
        },
        async run() {
          const normalizedQuery = query.trimStart();
          if (normalizedQuery.startsWith('DELETE FROM approval_workflow_levels')) {
            for (let i = levels.length - 1; i >= 0; i--) {
              if (levels[i].workflow_id === values[0]) levels.splice(i, 1);
            }
            return { meta: { changes: 1 } };
          }
          if (normalizedQuery.startsWith('INSERT INTO approval_workflow_levels')) {
            const [
              workflow_id, order_index, level_name, role_required, designation_required,
              min_hierarchy_level, auto_approve, approver_source, minimum_amount, maximum_amount
            ] = values;
            levels.push({
              workflow_id, order_index, level_name, role_required, designation_required,
              min_hierarchy_level, auto_approve, approver_source, minimum_amount, maximum_amount
            });
            return { meta: { changes: 1 } };
          }
          if (normalizedQuery.startsWith('INSERT INTO travel_expenses')) {
            const [id, employee_id, expense_type, amount, description, expense_date, bill_photo, journey_id, status, current_approver_level, approval_workflow_id] = values;
            expenses.push({ id, employee_id, expense_type, amount, description, expense_date, bill_photo, journey_id, status, current_approver_level, approval_workflow_id });
            return { meta: { changes: 1 } };
          }
          if (normalizedQuery.startsWith('UPDATE travel_expenses')) {
            if (normalizedQuery.includes("SET status = 'paid'")) {
              const expense = expenses.find((row) => row.id === values[1]);
              if (!expense || expense.status !== 'finance_approved') return { meta: { changes: 0 } };
              expense.status = 'paid';
              return { meta: { changes: 1 } };
            }
            const expense = expenses.find((row) => row.id === values[3]);
            if (!expense || expense.status !== 'pending' || Number(expense.current_approver_level) !== Number(values[4])) {
              return { meta: { changes: 0 } };
            }
            [expense.current_approver_level, expense.status, expense.current_approver_name] = values.slice(0, 3);
            return { meta: { changes: 1 } };
          }
          if (normalizedQuery.startsWith('INSERT INTO travel_expense_approvals')) {
            approvals.push(values);
            return { meta: { changes: 1 } };
          }
          if (normalizedQuery.startsWith('INSERT INTO attendance_regularisation (')) {
            const [id, employee_id, work_date, request_type, requested_status, reason, status, current_approver_level, approval_workflow_id] = values;
            regularisations.push({ id, employee_id, work_date, request_type, requested_status, reason, status, current_approver_level, approval_workflow_id });
            return { meta: { changes: 1 } };
          }
          if (normalizedQuery.startsWith('UPDATE attendance_regularisation')) {
            const request = regularisations.find((row) => row.id === values[2]);
            if (!request || request.status !== 'pending' || Number(request.current_approver_level) !== Number(values[3])) {
              return { meta: { changes: 0 } };
            }
            [request.current_approver_level, request.status] = values.slice(0, 2);
            return { meta: { changes: 1 } };
          }
          if (normalizedQuery.startsWith('INSERT INTO attendance_regularisation_approvals')) {
            approvals.push(values);
            return { meta: { changes: 1 } };
          }
          if (normalizedQuery.startsWith('INSERT INTO attendance_days')) {
            attendanceDays.push(values);
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
      };
      return statement;
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    }
  };
  return { DB, levels, expenses, approvals, regularisations, attendanceDays };
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

test('empty workflow is allowed but blocks new expense submissions', async () => {
  const { DB, expenses } = workflowDatabase();
  const save = await request(DB, '/api/approval-workflows/expense/levels', {
    method: 'PUT',
    body: { levels: [] }
  });

  test('workflow saves functional approver routing and amount thresholds', async () => {
    const { DB, levels } = workflowDatabase();
    const response = await request(DB, '/api/approval-workflows/expense/levels', {
      method: 'PUT',
      body: {
        levels: [{
          level_name: 'Regional Manager',
          role_required: 'regional_manager',
          approver_source: 'assigned_role',
          designation_required: null,
          min_hierarchy_level: null,
          minimum_amount: 1000,
          maximum_amount: 5000,
          auto_approve: false
        }]
      }
    });
    assert.equal(response.status, 200);
    assert.equal(levels[0].role_required, 'regional_manager');
    assert.equal(levels[0].minimum_amount, 1000);
    assert.equal(levels[0].maximum_amount, 5000);
  });

  test('only finance-approved expenses can be marked paid', async () => {
    const { DB, expenses } = workflowDatabase();
    expenses.push({ id: 'pending-expense', status: 'pending', approval_workflow_id: 'expense-workflow' });
    expenses.push({ id: 'approved-expense', status: 'finance_approved', approval_workflow_id: 'expense-workflow' });

    const denied = await request(DB, '/api/expenses/pending-expense/pay', { method: 'PUT' });
    const paid = await request(DB, '/api/expenses/approved-expense/pay', { method: 'PUT' });

    assert.equal(denied.status, 409);
    assert.equal(paid.status, 200);
    assert.equal(expenses.find((expense) => expense.id === 'approved-expense').status, 'paid');
  });

  test('legacy expenses without workflow cannot be approved', async () => {
    const { DB, expenses } = workflowDatabase();
    expenses.push({ id: 'legacy-expense', employee_id: 'employee-1', status: 'pending', approval_workflow_id: null });

    const response = await request(DB, '/api/expenses/legacy-expense/approve', {
      method: 'PUT',
      body: { action: 'approved' }
    });

    assert.equal(response.status, 409);
    assert.equal(expenses[0].status, 'pending');
  });
  assert.equal(save.status, 200);

  const response = await request(DB, '/api/expenses', {
    method: 'POST',
    body: { employee_id: 'employee-1', expense_type: 'travel', amount: 10, expense_date: '2026-10-30' }
  });
  assert.equal(response.status, 400);
  assert.equal(expenses.length, 0);

  await request(DB, '/api/approval-workflows/expense/levels', {
    method: 'PUT',
    body: { levels: [{ level_name: 'Automatic only', auto_approve: true }] }
  });
  const allAuto = await request(DB, '/api/expenses', {
    method: 'POST',
    body: { employee_id: 'employee-1', expense_type: 'travel', amount: 10, expense_date: '2026-10-30' }
  });
  assert.equal(allAuto.status, 400);
  assert.equal(expenses.length, 0);
});

test('designation-only workflow steps save and route new expense approvals', async () => {
  const { DB, levels, expenses } = workflowDatabase();
  const saved = await request(DB, '/api/approval-workflows/expense/levels', {
    method: 'PUT',
    body: {
      levels: [{
        level_name: 'Regional Manager',
        designation_required: 'Regional Manager',
        role_required: null,
        min_hierarchy_level: null,
        auto_approve: false
      }]
    }
  });
  assert.equal(saved.status, 200);
  assert.equal(levels[0].designation_required, 'Regional Manager');
  assert.equal(levels[0].role_required, null);
  assert.equal(levels[0].min_hierarchy_level, null);

  const submitted = await request(DB, '/api/expenses', {
    method: 'POST',
    body: { employee_id: 'employee-1', expense_type: 'travel', amount: 10, expense_date: '2026-10-30' }
  });
  assert.equal(submitted.status, 201);
  assert.equal(expenses[0].current_approver_level, 1);
});

test('expense approvals advance through configured manual steps and skip auto steps', async () => {
  const { DB, levels, expenses, approvals } = workflowDatabase();
  const saved = await request(DB, '/api/approval-workflows/expense/levels', {
    method: 'PUT',
    body: {
      levels: [
        { level_name: 'Regional Manager', role_required: 'admin', auto_approve: false },
        { level_name: 'Automatic check', auto_approve: true },
        { level_name: 'Finance', role_required: 'admin', auto_approve: false }
      ]
    }
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(levels.map((level) => level.order_index), [3, 2, 1]);

  const submitted = await request(DB, '/api/expenses', {
    method: 'POST',
    body: { employee_id: 'employee-1', expense_type: 'travel', amount: 10, expense_date: '2026-10-30' }
  });
  assert.equal(submitted.status, 201);
  assert.equal(expenses[0].current_approver_level, 3);

  const editWhilePending = await request(DB, '/api/approval-workflows/expense/levels', {
    method: 'PUT',
    body: { levels: [] }
  });
  assert.equal(editWhilePending.status, 409);

  const firstApproval = await request(DB, `/api/expenses/${expenses[0].id}/approve`, {
    method: 'PUT',
    body: { action: 'approved' }
  });
  assert.equal(firstApproval.status, 200);
  assert.equal(expenses[0].current_approver_level, 1);
  assert.equal(expenses[0].status, 'pending');

  const finalApproval = await request(DB, `/api/expenses/${expenses[0].id}/approve`, {
    method: 'PUT',
    body: { action: 'approved' }
  });
  assert.equal(finalApproval.status, 200);
  assert.equal(expenses[0].current_approver_level, 0);
  assert.equal(expenses[0].status, 'finance_approved');
  assert.equal(approvals.length, 2);
});

test('attendance regularisation uses its separately configured approval workflow', async () => {
  const { DB, regularisations, attendanceDays } = workflowDatabase();
  const saved = await request(DB, '/api/approval-workflows/attendance/levels', {
    method: 'PUT',
    body: { levels: [{ level_name: 'Attendance Review', role_required: 'admin', auto_approve: false }] }
  });
  assert.equal(saved.status, 200);

  const submitted = await request(DB, '/api/attendance/regularisation', {
    method: 'POST',
    body: {
      employee_id: 'employee-1',
      work_date: '2026-10-30',
      request_type: 'missed_punch_in',
      requested_status: 'P',
      reason: 'Missed punch'
    }
  });
  assert.equal(submitted.status, 201);
  assert.equal(regularisations[0].approval_workflow_id, 'attendance-workflow');

  const response = await request(DB, `/api/attendance/regularisation/${regularisations[0].id}/approve`, {
    method: 'PUT',
    body: { action: 'approved' }
  });
  assert.equal(response.status, 200);
  assert.equal(regularisations[0].status, 'hr_finalised');
  assert.equal(attendanceDays.length, 1);
});
