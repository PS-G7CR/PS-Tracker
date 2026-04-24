/*
  # Create core tables for PreTracker

  1. New Tables
    - `activity` - Presales activity tracking (migrated from existing app)
    - `owner_directory` - Owner name directory
    - `kpi_week` - Weekly KPI ratings (existing, preserved)
    - `ticket` - Ticket-level grouping with open/closed status
    - `ticket_kpi_rating` - Per-ticket KPI ratings (1-5 scale)
    - `quarterly_kpi` - Quarterly KPI manual entries
    - `learning` - Learning/training entries per owner

  2. Security
    - RLS enabled on all tables
    - Policies allow authenticated read/write access

  3. Important Notes
    - Activity table preserves existing data structure
    - Ticket table groups activities by ticket_id
    - Ticket KPI ratings use 1-5 scale for 4 metrics
    - Quarterly KPI uses 1-5 scale for 2 metrics
    - Learning table tracks training/upskilling per owner
*/

-- Activity table (existing structure)
CREATE TABLE IF NOT EXISTS activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name text NOT NULL,
  customer_id text NOT NULL,
  ticket_id text NOT NULL,
  description text NOT NULL,
  activity_types text[] NOT NULL DEFAULT '{}',
  owner text NOT NULL,
  sales_owner text,
  hours numeric NOT NULL DEFAULT 0,
  assigned_date date NOT NULL,
  activity_date date NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read activities"
  ON activity FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert activities"
  ON activity FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update activities"
  ON activity FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete activities"
  ON activity FOR DELETE
  TO authenticated
  USING (true);

-- Owner directory
CREATE TABLE IF NOT EXISTS owner_directory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  name_norm text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Trigger to auto-populate name_norm from name
CREATE OR REPLACE FUNCTION owner_directory_name_norm()
RETURNS trigger AS $$
BEGIN
  NEW.name_norm := lower(btrim(NEW.name));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_owner_directory_name_norm ON owner_directory;
CREATE TRIGGER trg_owner_directory_name_norm
  BEFORE INSERT OR UPDATE ON owner_directory
  FOR EACH ROW EXECUTE FUNCTION owner_directory_name_norm();

ALTER TABLE owner_directory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read owner directory"
  ON owner_directory FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert owner directory"
  ON owner_directory FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update owner directory"
  ON owner_directory FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- KPI week table (existing structure, preserved)
CREATE TABLE IF NOT EXISTS kpi_week (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner text NOT NULL,
  owner_norm text NOT NULL,
  week_start date NOT NULL,
  ratings jsonb NOT NULL DEFAULT '{}',
  desc_override text,
  locked boolean DEFAULT false,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(owner_norm, week_start)
);

-- Trigger for kpi_week owner_norm
CREATE OR REPLACE FUNCTION kpi_week_owner_norm()
RETURNS trigger AS $$
BEGIN
  NEW.owner_norm := lower(btrim(NEW.owner));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kpi_week_owner_norm ON kpi_week;
CREATE TRIGGER trg_kpi_week_owner_norm
  BEFORE INSERT OR UPDATE ON kpi_week
  FOR EACH ROW EXECUTE FUNCTION kpi_week_owner_norm();

ALTER TABLE kpi_week ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read kpi week"
  ON kpi_week FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert kpi week"
  ON kpi_week FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update kpi week"
  ON kpi_week FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Ticket table (groups activities by ticket_id)
CREATE TABLE IF NOT EXISTS ticket (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id text UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'Open',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE ticket ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read tickets"
  ON ticket FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert tickets"
  ON ticket FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update tickets"
  ON ticket FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete tickets"
  ON ticket FOR DELETE
  TO authenticated
  USING (true);

-- Ticket KPI ratings (1-5 scale per ticket)
CREATE TABLE IF NOT EXISTS ticket_kpi_rating (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id text NOT NULL REFERENCES ticket(ticket_id),
  proposal_quality numeric CHECK (proposal_quality BETWEEN 1 AND 5),
  solution_accuracy numeric CHECK (solution_accuracy BETWEEN 1 AND 5),
  average_tat numeric CHECK (average_tat BETWEEN 1 AND 5),
  stakeholder_satisfaction numeric CHECK (stakeholder_satisfaction BETWEEN 1 AND 5),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(ticket_id)
);

ALTER TABLE ticket_kpi_rating ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read ticket kpi ratings"
  ON ticket_kpi_rating FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert ticket kpi ratings"
  ON ticket_kpi_rating FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update ticket kpi ratings"
  ON ticket_kpi_rating FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete ticket kpi ratings"
  ON ticket_kpi_rating FOR DELETE
  TO authenticated
  USING (true);

-- Quarterly KPI (manual entry per owner per quarter)
CREATE TABLE IF NOT EXISTS quarterly_kpi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner text NOT NULL,
  owner_norm text NOT NULL,
  financial_year text NOT NULL,
  quarter text NOT NULL,
  professional_behaviour numeric CHECK (professional_behaviour BETWEEN 1 AND 5),
  upskilling_certifications numeric CHECK (upskilling_certifications BETWEEN 1 AND 5),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(owner_norm, financial_year, quarter)
);

-- Trigger for quarterly_kpi owner_norm
CREATE OR REPLACE FUNCTION quarterly_kpi_owner_norm()
RETURNS trigger AS $$
BEGIN
  NEW.owner_norm := lower(btrim(NEW.owner));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quarterly_kpi_owner_norm ON quarterly_kpi;
CREATE TRIGGER trg_quarterly_kpi_owner_norm
  BEFORE INSERT OR UPDATE ON quarterly_kpi
  FOR EACH ROW EXECUTE FUNCTION quarterly_kpi_owner_norm();

ALTER TABLE quarterly_kpi ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read quarterly kpi"
  ON quarterly_kpi FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert quarterly kpi"
  ON quarterly_kpi FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update quarterly kpi"
  ON quarterly_kpi FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete quarterly kpi"
  ON quarterly_kpi FOR DELETE
  TO authenticated
  USING (true);

-- Learning table
CREATE TABLE IF NOT EXISTS learning (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner text NOT NULL,
  date date NOT NULL,
  topic text NOT NULL,
  category text NOT NULL DEFAULT '',
  description text DEFAULT '',
  hours numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'In Progress',
  source_link text DEFAULT '',
  completion_date date,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE learning ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read learning"
  ON learning FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert learning"
  ON learning FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update learning"
  ON learning FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete learning"
  ON learning FOR DELETE
  TO authenticated
  USING (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_activity_ticket_id ON activity(ticket_id);
CREATE INDEX IF NOT EXISTS idx_activity_owner ON activity(owner);
CREATE INDEX IF NOT EXISTS idx_activity_activity_date ON activity(activity_date);
CREATE INDEX IF NOT EXISTS idx_learning_owner ON learning(owner);
CREATE INDEX IF NOT EXISTS idx_learning_date ON learning(date);
CREATE INDEX IF NOT EXISTS idx_quarterly_kpi_owner ON quarterly_kpi(owner_norm);
CREATE INDEX IF NOT EXISTS idx_ticket_status ON ticket(status);
