-- Exact customer-approved atomic close avoids the legacy split-close debt placeholder.
ALTER TABLE margin_workflow_steps DROP CONSTRAINT margin_workflow_steps_step_check;
ALTER TABLE margin_workflow_steps ADD CONSTRAINT margin_workflow_steps_step_check CHECK(step IN ('vault_deposit','margin_transfer','open_begin','open_swap','open_activate','open_cancel','close_atomic','close_prepare','close_swap','close_short_swap','close_finish','close_cancel','margin_return','vault_withdraw'));
