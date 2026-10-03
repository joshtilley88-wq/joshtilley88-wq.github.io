-- Performance advisor: evaluate auth.uid() once per query, not per row.
drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_member(business_id));
