-- Add auth_user_id to clients for customer portal login
ALTER TABLE clients ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_auth_user ON clients(auth_user_id) WHERE auth_user_id IS NOT NULL;
