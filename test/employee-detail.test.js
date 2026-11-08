import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import app from '../src/index.js';

const sessionToken = 'employee-detail-test-session';
const sessionHash = Buffer.from(await webcrypto.subtle.digest(
  'SHA-256',
  new TextEncoder().encode(sessionToken)
)).toString('hex');

function employeeDetailDatabase() {
  const employee = { id: 'employee-1', employee_id: 'EMP-001', name: 'Test Employee' };
  const journeys = [{
    travel_date: '2026-04-10',
    status: 'approved',
    gps_distance_km: 12.5,
    approved_distance_km: 10
  }];
  const balances = [{
    opening_balance: 12,
    accrued: 1,
    used: 2,
    closing_balance: 11,
    leave_code: 'CL',
    leave_name: 'Casual Leave'
  }];

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
            return values[0] === sessionHash
              ? { id: 'admin-1', username: 'admin', role: 'admin', employee_id: null }
              : null;
          }
          if (query.includes('FROM employees WHERE id = ? AND active = 1')) {
            return values[0] === employee.id ? employee : null;
          }
          return null;
        },
        async all() {
          if (query.includes('FROM attendance_days')) return { results: [] };
          if (query.includes('FROM travel_journeys')) return { results: journeys };
          if (query.includes('FROM leave_balances')) return { results: balances };
          return { results: [] };
        }
      };
      return statement;
    }
  };
  return DB;
}

test('employee detail returns travel and leave data for its detail view', async () => {
  const response = await app.fetch(new Request(
    'https://salary-desk.test/api/employee-detail/employee-1?month=2026-04',
    { headers: { Cookie: `salary_session=${sessionToken}` } }
  ), { DB: employeeDetailDatabase() });

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.employee.id, 'employee-1');
  assert.equal(result.travel.journeys.length, 1);
  assert.equal(result.travel.approved_km_total, 10);
  assert.deepEqual(result.leave.balances, [{
    opening_balance: 12,
    accrued: 1,
    used: 2,
    closing_balance: 11,
    leave_code: 'CL',
    leave_name: 'Casual Leave'
  }]);
});
