-- Assign a client to a branch — nullable, exactly like clients.assigned_staff_id
-- (see 20250102000000_staff_members.sql). Existing clients stay null ("No
-- branch") and behave as today. The client's branch is what the schedule filters
-- on and what routes the service-report office copy.
alter table clients add column if not exists branch_id uuid references branches on delete set null;
create index if not exists idx_clients_branch on clients(branch_id);
