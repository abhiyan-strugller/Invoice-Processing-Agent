-- ============================================================================
-- 0001_foundation.sql — Shared platform tables (FOUNDATION.md §3) + RLS (§9).
--
-- Multi-tenancy rule: EVERY row carries org_id and EVERY table has Row Level Security
-- enforcing org isolation. This is set up on day one, not bolted on later. A user may
-- only ever see rows for organizations they are a member of.
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ---- organizations: the customer business (multi-tenancy root) -------------
create table if not exists organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  -- Tool A primary ingestion: the dedicated forwarding address (CLAUDE.md §5.1).
  inbox_slug    text unique,                         -- e.g. 'acme-co' => acme-co@inbox.ourapp.com
  auto_approve_threshold numeric not null default 0.90,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---- users: people who log in, belong to an org -----------------------------
-- Mirrors auth.users (Supabase Auth). app_users.id == auth.users.id.
create table if not exists app_users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  full_name     text,
  created_at    timestamptz not null default now()
);

-- Membership: which users belong to which orgs (a user/firm may serve many orgs).
create table if not exists memberships (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  user_id       uuid not null references app_users(id) on delete cascade,
  role          text not null default 'member',      -- 'owner' | 'admin' | 'member'
  created_at    timestamptz not null default now(),
  unique (org_id, user_id)
);

-- ---- integrations: connected external systems per org (tokens ENCRYPTED) ----
create table if not exists integrations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  provider      text not null,                       -- 'quickbooks' | 'xero' | ...
  -- Tokens are stored encrypted at rest (FOUNDATION.md §9). Never store raw plaintext.
  encrypted_credentials bytea,
  status        text not null default 'connected',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, provider)
);

-- ---- audit_log: immutable record of every action (FOUNDATION.md §9) ---------
create table if not exists audit_log (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  actor_user_id uuid references app_users(id),       -- null = system/agent
  action        text not null,                       -- 'extracted','approved','pushed_quickbooks',...
  entity_type   text,                                -- 'invoice','vendor',...
  entity_id     uuid,
  detail        jsonb,                               -- external record id, failure reason, etc.
  created_at    timestamptz not null default now()
);
-- Append-only: block updates/deletes at the row level (immutability).
create or replace function block_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end; $$;
drop trigger if exists audit_log_no_update on audit_log;
create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function block_mutation();

-- ---- usage_events: for usage-based billing + analytics (FOUNDATION.md §8) ----
create table if not exists usage_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  event_type    text not null default 'document_processed',
  quantity      integer not null default 1,
  metadata      jsonb,
  created_at    timestamptz not null default now()
);

-- ============================================================================
-- Row Level Security
-- ============================================================================

-- Helper: the set of org_ids the current authenticated user belongs to.
create or replace function current_user_org_ids() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select org_id from memberships where user_id = auth.uid();
$$;

alter table organizations enable row level security;
alter table app_users     enable row level security;
alter table memberships   enable row level security;
alter table integrations  enable row level security;
alter table audit_log     enable row level security;
alter table usage_events  enable row level security;

-- Organizations: visible to members only.
drop policy if exists org_member_select on organizations;
create policy org_member_select on organizations
  for select using (id in (select current_user_org_ids()));

-- app_users: a user can see their own row.
drop policy if exists self_select on app_users;
create policy self_select on app_users for select using (id = auth.uid());

-- memberships: a user can see memberships of orgs they belong to.
drop policy if exists membership_select on memberships;
create policy membership_select on memberships
  for select using (org_id in (select current_user_org_ids()));

-- Generic org-scoped read access for the per-org tables.
drop policy if exists integrations_member on integrations;
create policy integrations_member on integrations
  for select using (org_id in (select current_user_org_ids()));

drop policy if exists audit_member on audit_log;
create policy audit_member on audit_log
  for select using (org_id in (select current_user_org_ids()));

drop policy if exists usage_member on usage_events;
create policy usage_member on usage_events
  for select using (org_id in (select current_user_org_ids()));

-- Writes from the app go through the server (service role, which bypasses RLS) so the
-- agent can insert on the user's behalf; interactive client writes would get their own
-- INSERT/UPDATE policies as the UI grows.
