-- Apply after 001_duetrack.sql. Existing payments remain expenses.
begin;
alter table public.records drop constraint if exists records_kind_check;
alter table public.records add constraint records_kind_check check(kind in ('payment','type','preferences','cash_account','cash_entry'));
-- Preserve the existing payment/receipt validation behind a private function.
do $$ begin
 if to_regprocedure('public.apply_change_v1(uuid,text,jsonb,boolean,integer,uuid)') is null then
  alter function public.apply_change(uuid,text,jsonb,boolean,integer,uuid) rename to apply_change_v1;
 end if;
end $$;
revoke all on function public.apply_change_v1(uuid,text,jsonb,boolean,integer,uuid) from public,anon,authenticated;
create or replace function public.apply_change(p_id uuid,p_kind text,p_data jsonb,p_deleted boolean,p_base integer,p_mutation uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); existing records; account records; answer jsonb; direction text;
begin
 if u is null then raise exception 'Sign in required'; end if;
 if p_id is null or p_mutation is null or p_kind is null or p_deleted is null or p_base is null or p_base<0 or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Invalid record'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select result into answer from mutations where owner=u and id=p_mutation;
 if found then return answer; end if;
 select * into existing from records where id=p_id;
 if found and existing.owner<>u then raise exception 'Not authorized'; end if;
 if (existing.id is null and p_base<>0) or (existing.id is not null and existing.version<>p_base) then return jsonb_build_object('conflict',true,'row',to_jsonb(existing)); end if;
 if p_kind not in ('payment','type','preferences','cash_account','cash_entry') or (existing.id is not null and existing.kind<>p_kind) then raise exception 'Invalid kind'; end if;
 if p_kind='type' then
  direction:=coalesce(p_data->>'direction',existing.data->>'direction','expense');
  if direction not in ('income','expense') then raise exception 'Invalid type direction'; end if;
  if existing.id is not null and direction<>coalesce(existing.data->>'direction','expense') and exists(select 1 from records where owner=u and kind='payment' and not deleted and data->>'typeId'=p_id::text) then raise exception 'Direction is fixed while payments exist'; end if;
  if p_deleted and exists(select 1 from records where owner=u and kind='cash_entry' and not deleted and data->>'typeId'=p_id::text) then raise exception 'Delete or move cash entries first'; end if;
  p_data:=p_data||jsonb_build_object('direction',direction);
 end if;
 if p_kind in ('payment','type','preferences') then
  return public.apply_change_v1(p_id,p_kind,p_data,p_deleted,p_base,p_mutation);
 elsif p_kind='cash_account' then
  if not p_data ?& array['name','currency','openingDate','openingBalance'] then raise exception 'Cash account fields required'; end if;
  if exists(select 1 from unnest(array['name','currency','openingDate']) f where jsonb_typeof(p_data->f) is distinct from 'string') or jsonb_typeof(p_data->'openingBalance') is distinct from 'number' then raise exception 'Invalid cash account fields'; end if;
  if length(trim(p_data->>'name')) not between 1 and 60 or p_data->>'currency' !~ '^[A-Z]{3}$' or p_data->>'openingDate' !~ '^\d{4}-\d{2}-\d{2}$' or (p_data->>'openingBalance')::numeric<>trunc((p_data->>'openingBalance')::numeric) or (p_data->>'openingBalance')::numeric not between -1000000000000 and 1000000000000 then raise exception 'Invalid cash account'; end if;
  perform (p_data->>'openingDate')::date;
  if exists(select 1 from records where owner=u and kind='cash_entry' and not deleted and data->>'accountId'=p_id::text) then
   if p_deleted then raise exception 'Delete or move cash entries first'; end if;
   if existing.data->'currency' is distinct from p_data->'currency' or existing.data->'openingDate' is distinct from p_data->'openingDate' or existing.data->'openingBalance' is distinct from p_data->'openingBalance' then raise exception 'Opening balance is fixed while entries exist. Use an adjustment.'; end if;
  end if;
 elsif p_kind='cash_entry' then
  if not p_data ?& array['accountId','currency','direction','amount','date','category','description'] then raise exception 'Cash entry fields required'; end if;
  if exists(select 1 from unnest(array['accountId','currency','direction','date','category','description']) f where jsonb_typeof(p_data->f) is distinct from 'string') or jsonb_typeof(p_data->'amount') is distinct from 'number' then raise exception 'Invalid cash entry fields'; end if;
  if p_data->>'direction' not in ('in','out') or p_data->>'category' not in ('rent','mortgage','service_charges','maintenance','savings_profit','adjustment','other') or length(p_data->>'description')>2000 or p_data->>'currency' !~ '^[A-Z]{3}$' or p_data->>'date' !~ '^\d{4}-\d{2}-\d{2}$' or (p_data->>'amount')::numeric<>trunc((p_data->>'amount')::numeric) or (p_data->>'amount')::numeric not between 1 and 1000000000000 then raise exception 'Invalid cash entry'; end if;
  perform (p_data->>'date')::date;
  if not p_deleted then
   select * into account from records where id=(p_data->>'accountId')::uuid and owner=u and kind='cash_account' and not deleted;
   if account.id is null then raise exception 'Cash account unavailable'; end if;
   if p_data->>'currency'<>account.data->>'currency' then raise exception 'Entry currency must match its cash account'; end if;
   if (p_data->>'date')::date<(account.data->>'openingDate')::date then raise exception 'Entry date precedes opening balance'; end if;
   if p_data ? 'typeId' and (jsonb_typeof(p_data->'typeId') is distinct from 'string' or not exists(select 1 from records where id=(p_data->>'typeId')::uuid and owner=u and kind='type' and not deleted)) then raise exception 'Associated payment type unavailable'; end if;
  end if;
 end if;
 insert into records(id,owner,kind,data,version,deleted) values(p_id,u,p_kind,p_data,1,p_deleted)
 on conflict(id) do update set data=excluded.data,version=records.version+1,deleted=excluded.deleted,updated_at=now()
 returning to_jsonb(records.*) into answer;
 answer:=jsonb_build_object('conflict',false,'row',answer);
 insert into mutations values(u,p_mutation,answer);return answer;
end $$;
revoke all on function public.apply_change(uuid,text,jsonb,boolean,integer,uuid) from public,anon;
grant execute on function public.apply_change(uuid,text,jsonb,boolean,integer,uuid) to authenticated;
-- Clients gate new cloud features until this migration is installed.
create or replace function public.duetrack_capabilities() returns jsonb language sql security invoker as $$ select '{"cash":true,"income":true,"backupVersion":2}'::jsonb $$;
revoke all on function public.duetrack_capabilities() from public,anon;
grant execute on function public.duetrack_capabilities() to authenticated;
commit;
