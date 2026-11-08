-- Remove only the original five seeded levels when they remain unchanged.
-- Any workflow already customized by an administrator is preserved.
DELETE FROM approval_workflow_levels
WHERE workflow_id IN (
  SELECT workflow_id
  FROM approval_workflow_levels
  GROUP BY workflow_id
  HAVING COUNT(*) = 5
    AND SUM(CASE
      WHEN (order_index = 5 AND level_name = 'Area Manager' AND role_required IS NULL AND min_hierarchy_level = 5)
        OR (order_index = 4 AND level_name = 'Regional Manager' AND role_required IS NULL AND min_hierarchy_level = 4)
        OR (order_index = 3 AND level_name = 'Department Head' AND role_required IS NULL AND min_hierarchy_level = 3)
        OR (order_index = 2 AND level_name = 'HR Admin' AND role_required = 'hr' AND min_hierarchy_level = 2)
        OR (order_index = 1 AND level_name = 'Finance' AND role_required = 'payroll' AND min_hierarchy_level = 1)
      THEN 1 ELSE 0 END) = 5
);
