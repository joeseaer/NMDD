alter table if exists public.people_profiles
add column if not exists ai_followup_suggestion jsonb;

create or replace function public.try_parse_jsonb(input text)
returns jsonb
language plpgsql
as $$
begin
  if input is null or btrim(input) = '' then
    return null;
  end if;
  return input::jsonb;
exception
  when others then
    return null;
end;
$$;

update public.people_profiles
set ai_followup_suggestion = coalesce(
  ai_followup_suggestion,
  try_parse_jsonb(private_info) -> 'ai_followup_suggestion'
)
where ai_followup_suggestion is null;
