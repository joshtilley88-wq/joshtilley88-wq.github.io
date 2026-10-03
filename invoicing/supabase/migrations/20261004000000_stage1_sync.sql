-- Invoicing cloud, stage 1: businesses + members (multi-business ready), one generic synced `records` table,
-- conflict history, push RPC (last-write-wins + sticky outbox + settings field merge), private receipts bucket,
-- anon heartbeat for the free-plan keep-alive. RLS is on for every table.

create extension if not exists pgcrypto;

-- ---------- tenancy ----------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My business',
  timezone text not null default 'Australia/Sydney',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table public.members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index members_user_idx on public.members(user_id);

-- membership check used by every policy (security definer so policies on members don't recurse)
create or replace function public.is_member(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.members m where m.business_id = b and m.user_id = auth.uid())
$$;
create or replace function public.is_member_text(b text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.members m where m.business_id::text = b and m.user_id = auth.uid())
$$;

-- ---------- synced data ----------
create sequence public.record_rev_seq;
create table public.records (
  business_id uuid not null references public.businesses(id) on delete cascade,
  collection text not null check (collection in ('settings','customers','services','invoices','payments','expenses','outbox','contractTemplates','contracts','forms','responses','files')),
  id text not null check (length(id) between 1 and 100),
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null,
  rev bigint not null default nextval('public.record_rev_seq'),
  updated_by uuid,
  updated_by_device text,
  server_updated_at timestamptz not null default now(),
  primary key (business_id, collection, id),
  check (collection <> 'settings' or id = 'main')     -- only settings/main syncs; 'device' and 'sync' rows stay on the device
);
create index records_rev_idx on public.records(business_id, rev);

create table public.record_history (
  hid bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  collection text not null, id text not null, data jsonb, deleted boolean, updated_at timestamptz, rev bigint,
  reason text not null, device text, replaced_at timestamptz not null default now()
);
create index record_history_idx on public.record_history(business_id, collection, id);

-- ---------- keep-alive ----------
create table public.heartbeat (id int primary key, beat_at timestamptz not null default now());
insert into public.heartbeat (id) values (1) on conflict do nothing;

-- ---------- RLS ----------
alter table public.businesses enable row level security;
alter table public.members enable row level security;
alter table public.records enable row level security;
alter table public.record_history enable row level security;
alter table public.heartbeat enable row level security;

create policy businesses_select on public.businesses for select to authenticated using (public.is_member(id));
create policy members_select on public.members for select to authenticated using (user_id = auth.uid() or public.is_member(business_id));
create policy records_select on public.records for select to authenticated using (public.is_member(business_id));
create policy history_select on public.record_history for select to authenticated using (public.is_member(business_id));
-- no insert/update/delete policies: all writes go through the RPCs below, which check membership themselves
revoke all on public.businesses, public.members, public.records, public.record_history, public.heartbeat from anon;
revoke insert, update, delete, truncate on public.businesses, public.members, public.records, public.record_history, public.heartbeat from authenticated;
revoke all on sequence public.record_rev_seq from anon, authenticated;

-- ---------- RPCs ----------
create or replace function public.create_business(p_name text default 'My business') returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  insert into businesses (name, created_by) values (coalesce(nullif(trim(p_name), ''), 'My business'), auth.uid()) returning id into v;
  insert into members (business_id, user_id, role) values (v, auth.uid(), 'owner');
  return v;
end $$;

-- push: [{collection, id, data, deleted, updated_at, base_rev, fields?}] → {results:[{collection,id,rev,status,row?}], warnings:[...]}
-- status: ok (written), stale (server copy is newer, kept; row = server copy), merged (server combined both; row = result)
create or replace function public.push_changes(p_business uuid, p_device text, p_changes jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c jsonb; cur public.records%rowtype; found_cur boolean; v_data jsonb; v_del boolean; v_upd timestamptz; v_status text; v_rev bigint;
  p jsonb; v_path text[]; res jsonb := '[]'::jsonb; warn jsonb := '[]'::jsonb; v_col text; v_id text;
begin
  if not public.is_member(p_business) then raise exception 'not a member of this business' using errcode = '42501'; end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 500 then raise exception 'changes must be an array of at most 500'; end if;
  perform pg_advisory_xact_lock(hashtext('records:' || p_business::text));   -- one writer per business: revs become visible in order
  for c in select value from jsonb_array_elements(p_changes) loop
    v_col := c->>'collection'; v_id := c->>'id'; v_data := c->'data'; v_del := coalesce((c->>'deleted')::boolean, false);
    v_upd := coalesce((c->>'updated_at')::timestamptz, now()); v_status := 'ok';
    if v_data is null or jsonb_typeof(v_data) <> 'object' then raise exception 'record %/% has no data', v_col, v_id; end if;
    select * into cur from public.records r where r.business_id = p_business and r.collection = v_col and r.id = v_id for update;
    found_cur := found;
    if found_cur and not (c->>'base_rev' is not null and (c->>'base_rev')::bigint = cur.rev) then
      -- conflict: someone else wrote since this device last saw the record
      if v_col = 'settings' and jsonb_typeof(c->'fields') = 'array' and not v_del and not cur.deleted then
        v_data := cur.data;
        for p in select value from jsonb_array_elements(c->'fields') loop
          v_path := array(select jsonb_array_elements_text(p));
          if (c->'data') #> v_path is null then v_data := v_data #- v_path;
          elsif array_length(v_path, 1) > 1 and v_data #> v_path[1:array_length(v_path, 1) - 1] is null then v_data := jsonb_set(v_data, v_path[1:1], (c->'data') -> v_path[1], true);
          else v_data := jsonb_set(v_data, v_path, (c->'data') #> v_path, true); end if;
        end loop;
        -- numbering never goes backwards
        if (cur.data->>'invNext') ~ '^\d+$' and (v_data->>'invNext') ~ '^\d+$' then v_data := jsonb_set(v_data, '{invNext}', to_jsonb(greatest((cur.data->>'invNext')::bigint, (v_data->>'invNext')::bigint))); end if;
        if (cur.data->>'quoteNext') ~ '^\d+$' and (v_data->>'quoteNext') ~ '^\d+$' then v_data := jsonb_set(v_data, '{quoteNext}', to_jsonb(greatest((cur.data->>'quoteNext')::bigint, (v_data->>'quoteNext')::bigint))); end if;
        v_upd := greatest(v_upd, cur.updated_at); v_data := jsonb_set(v_data, '{updatedAt}', to_jsonb(to_char(v_upd at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
        v_status := 'merged';
      elsif v_upd > cur.updated_at then
        v_status := 'ok';    -- incoming is newer: it wins (loser kept in history below)
      elsif v_col = 'outbox' and not v_del and v_data->>'status' = 'sent' and coalesce(cur.data->>'status', '') <> 'sent' then
        -- older edit, but it marks the email as sent: keep the newer content and the sent status
        v_data := cur.data || jsonb_build_object('status', 'sent', 'sentAt', v_data->'sentAt'); v_upd := cur.updated_at; v_status := 'merged';
      else
        insert into public.record_history (business_id, collection, id, data, deleted, updated_at, rev, reason, device)
          values (p_business, v_col, v_id, c->'data', v_del, v_upd, null, 'conflict-lost', p_device);
        res := res || jsonb_build_object('collection', v_col, 'id', v_id, 'rev', cur.rev, 'status', 'stale',
          'row', jsonb_build_object('data', cur.data, 'deleted', cur.deleted, 'updated_at', cur.updated_at, 'rev', cur.rev));
        continue;
      end if;
    end if;
    -- outbox: once sent, always sent
    if v_col = 'outbox' and found_cur and cur.data->>'status' = 'sent' and coalesce(v_data->>'status', '') <> 'sent' then
      v_data := v_data || jsonb_build_object('status', 'sent', 'sentAt', cur.data->'sentAt'); v_status := 'merged';
    end if;
    if found_cur then
      insert into public.record_history (business_id, collection, id, data, deleted, updated_at, rev, reason, device)
        values (p_business, v_col, v_id, cur.data, cur.deleted, cur.updated_at, cur.rev, case when c->>'base_rev' is not null and (c->>'base_rev')::bigint = cur.rev then 'replaced' else 'conflict-overwritten' end, p_device);
      update public.records set data = v_data, deleted = v_del, updated_at = v_upd, rev = nextval('public.record_rev_seq'),
        updated_by = auth.uid(), updated_by_device = p_device, server_updated_at = now()
        where business_id = p_business and collection = v_col and id = v_id returning rev into v_rev;
    else
      insert into public.records (business_id, collection, id, data, deleted, updated_at, updated_by, updated_by_device)
        values (p_business, v_col, v_id, v_data, v_del, v_upd, auth.uid(), p_device) returning rev into v_rev;
    end if;
    res := res || jsonb_build_object('collection', v_col, 'id', v_id, 'rev', v_rev, 'status', v_status,
      'row', case when v_status = 'merged' then jsonb_build_object('data', v_data, 'deleted', v_del, 'updated_at', v_upd, 'rev', v_rev) end);
    -- two invoices with the same number (e.g. made on two offline devices)
    if v_col = 'invoices' and not v_del and v_data->>'number' is not null and exists (
      select 1 from public.records r where r.business_id = p_business and r.collection = 'invoices' and r.id <> v_id and not r.deleted
        and r.data->>'number' = v_data->>'number' and coalesce(r.data->>'kind', 'invoice') = coalesce(v_data->>'kind', 'invoice')) then
      warn := warn || jsonb_build_object('type', 'duplicate-number', 'number', v_data->>'number', 'id', v_id);
    end if;
  end loop;
  return jsonb_build_object('results', res, 'warnings', warn);
end $$;

-- keep-alive ping for the free plan (callable with the public key)
create or replace function public.heartbeat() returns timestamptz
language sql security definer set search_path = public as $$
  update public.heartbeat set beat_at = now() where id = 1 returning beat_at
$$;

revoke execute on function public.create_business(text), public.push_changes(uuid, text, jsonb), public.is_member(uuid), public.is_member_text(text) from public, anon;
grant execute on function public.create_business(text), public.push_changes(uuid, text, jsonb), public.is_member(uuid), public.is_member_text(text) to authenticated;
revoke execute on function public.heartbeat() from public;
grant execute on function public.heartbeat() to anon, authenticated;

-- ---------- receipt files: private bucket, path <business_id>/<file_id> ----------
insert into storage.buckets (id, name, public, file_size_limit)
  values ('receipts', 'receipts', false, 26214400) on conflict (id) do nothing;
create policy receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.is_member_text((storage.foldername(name))[1]));
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_member_text((storage.foldername(name))[1]));
create policy receipts_update on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and public.is_member_text((storage.foldername(name))[1]))
  with check (bucket_id = 'receipts' and public.is_member_text((storage.foldername(name))[1]));
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.is_member_text((storage.foldername(name))[1]));
