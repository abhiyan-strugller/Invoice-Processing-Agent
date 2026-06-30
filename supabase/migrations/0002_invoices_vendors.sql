-- ============================================================================
-- 0002_invoices_vendors.sql — Tool A primary tables (CLAUDE.md §8, §13.1).
--
-- `invoices` follows the common document shape (FOUNDATION.md §3) so code patterns
-- transfer to Tools B–E. `vendors` is the per-vendor learning table — the core
-- differentiator that turns a generic extractor into an agent that knows THIS business's
-- suppliers (CLAUDE.md §8). Guard it.
-- ============================================================================

-- ---- vendors: learned per-vendor profile (CLAUDE.md §8) ---------------------
create table if not exists vendors (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references organizations(id) on delete cascade,
  name                    text not null,
  tax_id                  text,
  invoice_number_pattern  text,                       -- learned regex/format
  typical_currency        text,
  amount_min              numeric,                    -- learned historical range
  amount_max              numeric,
  last_known_bank_fingerprint text,                   -- sha256 of bank details, to detect changes
  default_gl_code         text,                       -- learned categorization
  invoice_count           integer not null default 0,
  accuracy_rate           numeric,                    -- rises as humans confirm; gates auto-approve
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (org_id, name)
);

-- ---- invoices: the document table (common shape, FOUNDATION.md §3) ----------
create table if not exists invoices (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  vendor_id         uuid references vendors(id) on delete set null,
  status            text not null default 'pending',
    -- 'pending'|'processing'|'needs_review'|'approved'|'rejected'|'failed'|'pushed'
  -- Denormalized key fields for fast dashboard/duplicate queries (also live in extracted_data).
  vendor_name       text,
  invoice_number    text,
  invoice_date      date,
  due_date          date,
  currency          text,
  total_amount_due  numeric,
  raw_file_url      text,                             -- original in Supabase Storage
  extracted_data    jsonb,                            -- full structured output (the §4 schema)
  confidence_score  numeric,                          -- 0.00–1.00 overall
  decision          text,                             -- 'auto_approve'|'approve_with_flag'|'needs_review'
  validation_flags  jsonb default '[]'::jsonb,        -- array of issues found
  escalation_reason text,                             -- one-line plain-English (CLAUDE.md §7.6)
  reviewed_by       uuid references app_users(id),
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Duplicate detection (CLAUDE.md §7.1) leans on this lookup.
create index if not exists invoices_dup_idx
  on invoices (org_id, vendor_name, invoice_number);
create index if not exists invoices_status_idx on invoices (org_id, status);
create index if not exists vendors_org_idx on vendors (org_id);

-- ---- RLS ----
alter table vendors  enable row level security;
alter table invoices enable row level security;

drop policy if exists vendors_member on vendors;
create policy vendors_member on vendors
  for select using (org_id in (select current_user_org_ids()));

drop policy if exists invoices_member on invoices;
create policy invoices_member on invoices
  for select using (org_id in (select current_user_org_ids()));

-- A reviewer in the org may update an invoice (approve/edit/reject from the review screen).
drop policy if exists invoices_member_update on invoices;
create policy invoices_member_update on invoices
  for update using (org_id in (select current_user_org_ids()))
  with check (org_id in (select current_user_org_ids()));

-- keep updated_at fresh
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists invoices_touch on invoices;
create trigger invoices_touch before update on invoices
  for each row execute function touch_updated_at();
drop trigger if exists vendors_touch on vendors;
create trigger vendors_touch before update on vendors
  for each row execute function touch_updated_at();
