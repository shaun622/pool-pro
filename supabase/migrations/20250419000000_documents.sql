-- Document storage for clients, pools, and jobs
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses NOT NULL,
  client_id uuid REFERENCES clients,
  pool_id uuid REFERENCES pools,
  job_id uuid REFERENCES jobs,
  name text NOT NULL,
  file_type text,
  file_size integer,
  storage_path text NOT NULL,
  category text DEFAULT 'other' CHECK (category IN ('certificate', 'compliance', 'photo', 'contract', 'report', 'other')),
  uploaded_by uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Business can manage documents"
  ON documents FOR ALL
  USING (business_id = current_business_id());

CREATE INDEX idx_documents_business ON documents(business_id);
CREATE INDEX idx_documents_client ON documents(client_id);
CREATE INDEX idx_documents_pool ON documents(pool_id);

-- Storage bucket for documents
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', true) ON CONFLICT DO NOTHING;
CREATE POLICY "Anyone can view documents" ON storage.objects FOR SELECT USING (bucket_id = 'documents');
CREATE POLICY "Authenticated can upload documents" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'documents' AND auth.role() = 'authenticated');
CREATE POLICY "Authenticated can delete documents" ON storage.objects FOR DELETE USING (bucket_id = 'documents' AND auth.role() = 'authenticated');
