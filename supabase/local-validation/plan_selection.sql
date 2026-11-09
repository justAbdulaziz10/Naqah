-- LOCAL ONLY. Run after all relevant migrations on a disposable PostgreSQL database.
-- Covers the hosted fix for new owners, stable selection, existing data and function grants.
do $$
declare
  fn regprocedure := to_regprocedure('public.select_initial_plan(public.plan)');
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'farms' and column_name = 'plan_selected_at'
  ) then
    raise exception 'plan_selected_at is missing';
  end if;
  if fn is null then raise exception 'select_initial_plan is missing'; end if;
  if not has_function_privilege('authenticated', fn, 'EXECUTE') then
    raise exception 'authenticated cannot execute select_initial_plan';
  end if;
  if has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('service_role', fn, 'EXECUTE') then
    raise exception 'select_initial_plan has an unexpected grant';
  end if;
end
$$;

-- A signed-in user without a farm has no implicit Basic plan or farm until the RPC is called.
insert into auth.users (id) values ('10000000-0000-4000-8000-000000000001');
do $$
begin
  if exists (select 1 from public.farms where owner_id = '10000000-0000-4000-8000-000000000001') then
    raise exception 'a farm was created before explicit plan selection';
  end if;
end
$$;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
set role authenticated;
select public.select_initial_plan('ultimate');
select public.select_initial_plan('ultimate');
reset role;
do $$
begin
  if (select count(*) from public.farms where owner_id = '10000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'plan selection did not create exactly one farm';
  end if;
  if not exists (
    select 1 from public.farms
    where owner_id = '10000000-0000-4000-8000-000000000001'
      and plan = 'ultimate' and plan_selected_at is not null and not setup_complete
  ) then raise exception 'explicit plan choice was not saved'; end if;
end
$$;
set role authenticated;
do $$
begin
  perform public.select_initial_plan('basic');
  raise exception 'a different second plan choice was accepted';
exception when unique_violation then null;
end
$$;
reset role;

-- An existing incomplete farm can confirm Ultimate without losing saved workers or questions.
insert into auth.users (id) values ('10000000-0000-4000-8000-000000000002');
insert into public.farms (owner_id, plan) values ('10000000-0000-4000-8000-000000000002', 'basic');
insert into public.workers (farm_id, name)
select id, 'Test worker' from public.farms where owner_id = '10000000-0000-4000-8000-000000000002';
insert into public.custom_questions (farm_id, text)
select id, 'Test question' from public.farms where owner_id = '10000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
set role authenticated;
select public.select_initial_plan('ultimate');
reset role;
do $$
begin
  if not exists (
    select 1 from public.farms
    where owner_id = '10000000-0000-4000-8000-000000000002'
      and plan = 'ultimate' and plan_selected_at is not null
  ) then raise exception 'legacy plan choice was not saved'; end if;
  if (select count(*) from public.workers w join public.farms f on f.id = w.farm_id
      where f.owner_id = '10000000-0000-4000-8000-000000000002') <> 1 then
    raise exception 'existing worker data was lost';
  end if;
  if (select count(*) from public.custom_questions q join public.farms f on f.id = q.farm_id
      where f.owner_id = '10000000-0000-4000-8000-000000000002') <> 1 then
    raise exception 'existing question data was lost';
  end if;
end
$$;

-- Confirming Basic is refused when an old incomplete farm exceeds Basic worker limits.
insert into auth.users (id) values ('10000000-0000-4000-8000-000000000003');
insert into public.farms (owner_id, plan) values ('10000000-0000-4000-8000-000000000003', 'ultimate');
insert into public.workers (farm_id, name)
select f.id, 'Test worker ' || g.n
from public.farms f cross join generate_series(1, 4) as g(n)
where f.owner_id = '10000000-0000-4000-8000-000000000003';
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
set role authenticated;
do $$
begin
  perform public.select_initial_plan('basic');
  raise exception 'Basic was accepted below saved worker limits';
exception when check_violation then null;
end
$$;
reset role;
do $$
begin
  if not exists (
    select 1 from public.farms
    where owner_id = '10000000-0000-4000-8000-000000000003'
      and plan = 'ultimate' and plan_selected_at is null
  ) then raise exception 'rejected Basic selection changed the farm'; end if;
  if (select count(*) from public.workers w join public.farms f on f.id = w.farm_id
      where f.owner_id = '10000000-0000-4000-8000-000000000003') <> 4 then
    raise exception 'rejected Basic selection changed worker data';
  end if;
end
$$;

-- Completed legacy farms keep their current plan and do not re-enter plan selection.
insert into auth.users (id) values ('10000000-0000-4000-8000-000000000004');
insert into public.farms (owner_id, plan, setup_complete)
values ('10000000-0000-4000-8000-000000000004', 'ultimate', true);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
set role authenticated;
do $$
begin
  perform public.select_initial_plan('basic');
  raise exception 'completed farm accepted initial plan selection';
exception when unique_violation then null;
end
$$;
reset role;
do $$
begin
  if not exists (
    select 1 from public.farms
    where owner_id = '10000000-0000-4000-8000-000000000004'
      and plan = 'ultimate' and setup_complete and plan_selected_at is null
  ) then raise exception 'completed legacy farm was changed'; end if;
end
$$;

select 'PASS: plan-selection migration, idempotency, legacy preservation, limits and grants' as result;
