-- NAQAH | ناقة — limits on what an owner's session can write. Applies on top of 0003.
--
-- A session token and the public key reach the Data API directly, so the checks in
-- src/server/farm/input.ts protect the website only. These hold for any client.

-- Deleting a farm erased its reports and reset Basic's weekly limits. Reports are history an owner
-- can only read, so account deletion must be its own service-side step once that is decided.
revoke delete on farms from authenticated;

-- Same limits as src/server/farm/input.ts, or the voice contract where a call writes more. Blank-only text is refused too: the voice contract
-- rejects it, so one such custom question would make every report on that farm fail at the end.
alter table farms
  add constraint farms_owner_name_length check (length(owner_name) <= 200),
  add constraint farms_name_length check (length(name) <= 200),
  add constraint farms_location_length check (length(location) <= 200),
  add constraint farms_supplier_name_length check (length(supplier_name) <= 200),
  add constraint farms_supplier_phone_e164 check (supplier_phone = '' or supplier_phone ~ '^\+[1-9][0-9]{7,14}$');
alter table workers add constraint workers_name_length check (length(name) <= 200);
alter table camels
  add constraint camels_name_length check (length(name) <= 200),
  add constraint camels_tag_length check (length(tag) <= 40),
  add constraint camels_health_note_length check (length(health_note) <= 500);
alter table resources
  add constraint resources_quantity_length check (length(quantity) <= 500),
  add constraint resources_note_length check (length(note) <= 500);
alter table custom_questions
  add constraint custom_questions_text_shape check (length(text) <= 300 and btrim(text, E' \t\n\r\f\x0B') <> '');
alter table criteria add constraint criteria_label_length check (length(label) <= 200);
alter table emergency_categories add constraint emergency_label_length check (length(label) <= 200);
