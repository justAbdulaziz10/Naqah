-- BEFORE INSERT also runs before ON CONFLICT chooses an UPDATE. A same-farm retry of an
-- existing question must not count that row as a sixth question. Preserve the farm lock,
-- invoker security, RLS and immutable-parent trigger from 0001; no grants/policies change.
create or replace function private.enforce_custom_question_limit() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  farm_plan public.plan;
  existing int;
begin
  select f.plan into farm_plan from public.farms f where f.id = new.farm_id for update;
  if farm_plan = 'basic' then
    select count(*) into existing from public.custom_questions q
      where q.farm_id = new.farm_id and q.id <> new.id;
    if existing >= 5 then
      raise exception 'Basic plan allows up to 5 custom questions' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
