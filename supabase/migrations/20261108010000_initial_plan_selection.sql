-- NAQAH | ناقة — record an owner's explicit initial plan choice.
-- Existing rows remain unmarked. Incomplete owners confirm their choice in the UI;
-- completed accounts keep their current plan and continue to the application.
alter table public.farms
  add column plan_selected_at timestamptz;

comment on column public.farms.plan_selected_at is
  'Set only after the owner explicitly confirms the initial plan; NULL is not consent to the default plan.';

-- The plan column is service-controlled. This narrow RPC derives ownership from auth.uid(),
-- creates a farm only after an explicit choice, and is idempotent only for the same choice.
create or replace function public.select_initial_plan(p_plan public.plan)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_farm public.farms%rowtype;
  v_questions integer;
  v_workers integer;
begin
  if p_plan is null then
    raise exception 'An initial plan choice is required' using errcode = '22023';
  end if;

  if v_owner_id is null then
    raise exception 'A signed-in owner is required' using errcode = '42501';
  end if;

  insert into public.farms (owner_id, plan, plan_selected_at)
  values (v_owner_id, p_plan, pg_catalog.now())
  on conflict (owner_id) do nothing;

  select f.* into v_farm
  from public.farms as f
  where f.owner_id = v_owner_id
  for update;

  if not found then
    raise exception 'Owner farm could not be selected' using errcode = 'P0002';
  end if;

  if v_farm.setup_complete then
    raise exception 'Initial plan selection is closed after setup' using errcode = '23505';
  end if;

  if v_farm.plan_selected_at is not null then
    if v_farm.plan = p_plan then
      return;
    end if;
    raise exception 'Initial plan was already selected' using errcode = '23505';
  end if;

  -- Existing incomplete accounts may have saved data under the default/current plan.
  -- Never remove it or silently downgrade it to Basic when they confirm a plan.
  if p_plan = 'basic' then
    select pg_catalog.count(*) into v_questions
    from public.custom_questions as q
    where q.farm_id = v_farm.id;

    select pg_catalog.count(*) into v_workers
    from public.workers as w
    where w.farm_id = v_farm.id;

    if v_questions > 5 or v_workers > 3 then
      raise exception 'Initial Basic plan is below saved data limits' using errcode = '23514';
    end if;
  end if;

  update public.farms
  set plan = p_plan,
      plan_selected_at = pg_catalog.now()
  where id = v_farm.id;
end;
$$;

revoke all on function public.select_initial_plan(public.plan) from public, anon, authenticated, service_role;
grant execute on function public.select_initial_plan(public.plan) to authenticated;
