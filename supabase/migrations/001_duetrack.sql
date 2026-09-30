create table public.records (
 id uuid primary key, owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
 kind text not null check(kind in ('payment','type','preferences')), data jsonb not null,
 version integer not null default 1 check(version>0), deleted boolean not null default false,
 updated_at timestamptz not null default now()
);
create index records_owner on public.records(owner);
create unique index occurrence_unique on public.records(owner,(data->>'seriesId'),(data->>'due')) where kind='payment' and data->>'seriesId' is not null;
create unique index one_preference_per_owner on public.records(owner) where kind='preferences' and not deleted;
create table public.mutations(owner uuid not null references auth.users(id) on delete cascade, id uuid not null, result jsonb not null, primary key(owner,id));
create table public.receipt_gc(owner uuid not null references auth.users(id) on delete cascade,path text primary key, queued_at timestamptz not null default now(),deleting boolean not null default false);
alter table public.records enable row level security;
alter table public.mutations enable row level security;
alter table public.receipt_gc enable row level security;
create policy own_read on public.records for select to authenticated using(owner=auth.uid());
-- All writes go through the version-checking function. No direct table write grants.
revoke all on public.records,public.mutations,public.receipt_gc from anon,authenticated;
grant select on public.records to authenticated;
create function public.apply_change(p_id uuid,p_kind text,p_data jsonb,p_deleted boolean,p_base integer,p_mutation uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=auth.uid(); existing records; answer jsonb; a jsonb; old_path text;
begin
 if u is null then raise exception 'Sign in required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select result into answer from mutations where owner=u and id=p_mutation;
 if found then return answer; end if;
 select * into existing from records where id=p_id;
 if found and existing.owner<>u then raise exception 'Not authorized'; end if;
 if (existing.id is null and p_base<>0) or (existing.id is not null and existing.version<>p_base) then return jsonb_build_object('conflict',true,'row',to_jsonb(existing)); end if;
 if p_kind not in ('payment','type','preferences') or (existing.id is not null and existing.kind<>p_kind) then raise exception 'Invalid kind'; end if;
 if jsonb_typeof(p_data)<>'object' then raise exception 'Invalid record'; end if;
 if p_kind='type' then
  if jsonb_typeof(p_data->'name') is distinct from 'string' or jsonb_typeof(p_data->'order') is distinct from 'number' or (p_data->>'order')::numeric<>trunc((p_data->>'order')::numeric) then raise exception 'Invalid type fields'; end if;
  if not p_data ?& array['name','order'] then raise exception 'Type fields required'; end if;
  if length(trim(p_data->>'name')) not between 1 and 60 or (p_data->>'order')::integer<0 then raise exception 'Invalid payment type'; end if;
  if p_deleted and exists(select 1 from records where owner=u and kind='payment' and not deleted and data->>'typeId'=p_id::text) then raise exception 'Delete or move payments first'; end if;
 elsif p_kind='payment' then
  if not p_data ?& array['typeId','amount','currency','due','invoice','reference','description','paid','paymentDate','recurrence'] then raise exception 'Payment fields required'; end if;
  if jsonb_typeof(p_data->'amount') is distinct from 'number' or jsonb_typeof(p_data->'paid') is distinct from 'boolean' then raise exception 'Invalid payment fields'; end if;
  if exists(select 1 from unnest(array['typeId','currency','due','invoice','reference','description','paymentDate','recurrence']) f where jsonb_typeof(p_data->f) is distinct from 'string') then raise exception 'Invalid payment fields'; end if;
  if not exists(select 1 from records where id=(p_data->>'typeId')::uuid and owner=u and kind='type' and not deleted) then raise exception 'Payment type unavailable'; end if;
  if jsonb_typeof(p_data->'amount')<>'number' or (p_data->>'amount')::numeric<>trunc((p_data->>'amount')::numeric) or (p_data->>'amount')::numeric not between 1 and 1000000000000 then raise exception 'Invalid amount'; end if;
  if p_data->>'currency' !~ '^[A-Z]{3}$' or p_data->>'due' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid currency or date'; end if;
  perform (p_data->>'due')::date;
  if coalesce(p_data->>'invoice','')<>'' then if p_data->>'invoice' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid invoice date'; end if; perform (p_data->>'invoice')::date; end if;
  if jsonb_typeof(p_data->'paid')<>'boolean' or (p_data->>'paid')::boolean and coalesce(p_data->>'paymentDate','')='' then raise exception 'Payment date required'; end if;
  if coalesce(p_data->>'paymentDate','')<>'' then if p_data->>'paymentDate' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid payment date'; end if; perform (p_data->>'paymentDate')::date; end if;
  if p_data->>'recurrence' not in ('none','monthly','yearly') or length(p_data->>'description')>2000 or length(p_data->>'reference')>200 then raise exception 'Invalid payment'; end if;
  if coalesce(p_data->>'seriesId','')<>'' then perform (p_data->>'seriesId')::uuid; end if;
  if p_data->>'recurrence'<>'none' and (coalesce(p_data->>'seriesId','')='' or coalesce(p_data->>'anchor','')='') then raise exception 'Recurrence anchor and series required'; end if;
  if coalesce(p_data->>'anchor','')<>'' then if p_data->>'anchor' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid anchor'; end if;perform (p_data->>'anchor')::date;end if;
  a:=p_data->'attachment';
  if a is not null and a<>'null'::jsonb then
   perform (a->>'id')::uuid;
   if a->>'mime' not in ('image/jpeg','image/png','image/webp','application/pdf') or (a->>'size')::integer not between 1 and 10485760 then raise exception 'Invalid receipt'; end if;
   if exists(select 1 from receipt_gc where path=u::text||'/'||(a->>'id') and deleting) then raise exception 'Receipt cleanup in progress. Retry upload.'; end if;
   if not exists(select 1 from storage.objects where bucket_id='receipts' and name=u::text||'/'||(a->>'id')) then raise exception 'Upload receipt before saving'; end if;
  end if;
 elsif p_kind='preferences' then
  if not p_data ?& array['currency','timezone','theme'] then raise exception 'Preference fields required'; end if;
  if exists(select 1 from unnest(array['currency','timezone','theme']) f where jsonb_typeof(p_data->f) is distinct from 'string') then raise exception 'Invalid preferences'; end if;
  if p_data->>'currency' !~ '^[A-Z]{3}$' or p_data->>'theme' not in ('light','dark','system') or not exists(select 1 from pg_timezone_names where name=p_data->>'timezone') then raise exception 'Invalid preferences'; end if;
 end if;
 if existing.data->'attachment'->>'id' is not null and (p_deleted or coalesce(p_data->'attachment'->>'id','')<>existing.data->'attachment'->>'id') then
  old_path:=u::text||'/'||(existing.data->'attachment'->>'id');insert into receipt_gc(owner,path) values(u,old_path) on conflict do nothing;
 end if;
 insert into records(id,owner,kind,data,version,deleted) values(p_id,u,p_kind,p_data,1,p_deleted)
 on conflict(id) do update set data=excluded.data,version=records.version+1,deleted=excluded.deleted,updated_at=now()
 returning to_jsonb(records.*) into answer;
 answer:=jsonb_build_object('conflict',false,'row',answer);
 insert into mutations values(u,p_mutation,answer);return answer;
end $$;
revoke all on function public.apply_change(uuid,text,jsonb,boolean,integer,uuid) from public,anon;
grant execute on function public.apply_change(uuid,text,jsonb,boolean,integer,uuid) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('receipts','receipts',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']);
create policy receipts_read on storage.objects for select to authenticated using(bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text);
create policy receipts_upload on storage.objects for insert to authenticated with check(bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text);
-- Immutable object IDs: replacement uploads a fresh object before updating metadata.
-- Deletion is handled by the scheduled server cleanup, never by frontend credentials.
alter publication supabase_realtime add table public.records;
-- Reserve orphan paths before deleting bytes; metadata writes reject a reserved path.

create function public.claim_receipt_cleanup(p_owner uuid,p_path text) returns boolean language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 if exists(select 1 from records where owner=p_owner and not deleted and data->'attachment'->>'id'=split_part(p_path,'/',2)) then return false; end if;
 insert into receipt_gc(owner,path,deleting) values(p_owner,p_path,true) on conflict(path) do update set deleting=true;
 return true;
end $$;
revoke all on function public.claim_receipt_cleanup(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_receipt_cleanup(uuid,text) to service_role;
grant select,delete on public.receipt_gc to service_role;
