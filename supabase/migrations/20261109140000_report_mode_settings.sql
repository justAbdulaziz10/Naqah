-- NAQAH | ناقة — how the report is taken. Applies on top of 20261109120000.
--
-- The owner chooses how the worker gives the report, and which questions the call asks, in what
-- order. Additive: an existing farm keeps today's call (guided, everything on, today's order).

alter table farms
  add column report_mode text not null default 'guided'
    check (report_mode in ('worker_choice', 'guided', 'open')),
  -- [{ "id": predefined or custom question id, "enabled": bool, "required": bool }], ask order.
  -- '[]' means no plan yet: everything on and required, in the default order.
  add column question_plan jsonb not null default '[]'::jsonb
    check (case jsonb_typeof(question_plan) when 'array' then jsonb_array_length(question_plan) <= 500 else false end);

grant insert (report_mode, question_plan) on farms to authenticated;
grant update (report_mode, question_plan) on farms to authenticated;

-- Keeps the reference copy in step with PREDEFINED_QUESTIONS: the question the call actually asks.
update predefined_questions
set text_ar = 'كم عدد الحلال كله اليوم؟', text_en = 'How many camels are there in total today?'
where id = 'herd_count';
