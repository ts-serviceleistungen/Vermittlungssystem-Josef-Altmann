-- Firmenportal foundation: auth-bound admin RPCs and scoped company APIs.
-- Review the migration in the feature branch before applying to production.

create or replace function public.vermittlung_current_role()
returns text language sql stable security definer set search_path=public,pg_temp
as $$ select u.rolle from public.vermittlung_benutzer u where u.auth_user_id=auth.uid() and u.aktiv=true limit 1 $$;

create or replace function public.vermittlung_current_firma_id()
returns uuid language sql stable security definer set search_path=public,pg_temp
as $$ select u.firma_id from public.vermittlung_benutzer u where u.auth_user_id=auth.uid() and u.aktiv=true and u.rolle='Externe Firma' and u.firma_id is not null limit 1 $$;

create or replace function public.vermittlung_current_profile()
returns jsonb language sql stable security definer set search_path=public,pg_temp
as $$ select jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'rolle',u.rolle,'firma_id',u.firma_id) from public.vermittlung_benutzer u where u.auth_user_id=auth.uid() and u.aktiv=true limit 1 $$;

create or replace function public.vermittlung_firma_auftraege()
returns table(id uuid,auftragsnummer text,bereich text,status text,beschreibung text,objekt_adresse text,objekt_typ text,geplanter_beginn date,fertigstellung date,erstellt_am timestamptz)
language plpgsql stable security definer set search_path=public,pg_temp
as $$
declare v_firma uuid;
begin
 if auth.uid() is null or public.vermittlung_current_role()<>'Externe Firma' then raise exception 'Nur externe Firmen dürfen ihre Aufträge abrufen.' using errcode='42501'; end if;
 v_firma:=public.vermittlung_current_firma_id();
 if v_firma is null then raise exception 'Keine aktive Firmenzuordnung.' using errcode='42501'; end if;
 return query select a.id,a.auftragsnummer,a.bereich,a.status,a.beschreibung,a.objekt_adresse,a.objekt_typ,a.geplanter_beginn,a.fertigstellung,a.erstellt_am
 from public.vermittlung_auftraege a where a.ausfuehrende_firma_id=v_firma and coalesce(a.status,'')<>'Storniert'
 order by a.geplanter_beginn nulls last,a.erstellt_am desc;
end $$;

create or replace function public.vermittlung_firma_meldung_erstellen(p_auftrag_id uuid,p_nachricht text,p_meldungstyp text default 'Fortschritt')
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_firma uuid; v_user uuid; v_id uuid;
begin
 if auth.uid() is null or public.vermittlung_current_role()<>'Externe Firma' then raise exception 'Keine Berechtigung.' using errcode='42501'; end if;
 v_firma:=public.vermittlung_current_firma_id();
 select u.id into v_user from public.vermittlung_benutzer u where u.auth_user_id=auth.uid() and u.aktiv=true and u.firma_id=v_firma limit 1;
 if v_firma is null or v_user is null then raise exception 'Firmenzuordnung fehlt.' using errcode='42501'; end if;
 if not exists(select 1 from public.vermittlung_auftraege a where a.id=p_auftrag_id and a.ausfuehrende_firma_id=v_firma) then raise exception 'Auftrag nicht zugeordnet.' using errcode='42501'; end if;
 if p_meldungstyp not in ('Fortschritt','Notiz','Nachbesserung') then raise exception 'Ungültiger Meldungstyp.'; end if;
 if length(trim(coalesce(p_nachricht,'')))<2 or length(p_nachricht)>5000 then raise exception 'Meldung muss 2 bis 5000 Zeichen haben.'; end if;
 insert into public.vermittlung_firmen_auftragsmeldungen(auftrag_id,firma_id,benutzer_id,meldungstyp,nachricht) values(p_auftrag_id,v_firma,v_user,p_meldungstyp,trim(p_nachricht)) returning id into v_id;
 return jsonb_build_object('ok',true,'id',v_id);
end $$;

create or replace function public.vermittlung_firma_status_melden(p_auftrag_id uuid,p_status text,p_nachricht text default '')
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_firma uuid; v_user uuid; v_id uuid;
begin
 if auth.uid() is null or public.vermittlung_current_role()<>'Externe Firma' then raise exception 'Keine Berechtigung.' using errcode='42501'; end if;
 v_firma:=public.vermittlung_current_firma_id();
 select u.id into v_user from public.vermittlung_benutzer u where u.auth_user_id=auth.uid() and u.aktiv=true and u.firma_id=v_firma limit 1;
 if v_firma is null or v_user is null then raise exception 'Firmenzuordnung fehlt.' using errcode='42501'; end if;
 if p_status not in ('In Ausführung','Abschluss gemeldet','Nachbesserung erforderlich') then raise exception 'Status ist für externe Firmen nicht erlaubt.'; end if;
 if not exists(select 1 from public.vermittlung_auftraege a where a.id=p_auftrag_id and a.ausfuehrende_firma_id=v_firma) then raise exception 'Auftrag nicht zugeordnet.' using errcode='42501'; end if;
 if p_status='Abschluss gemeldet' and not exists(select 1 from public.vermittlung_firmen_auftragsfotos f where f.auftrag_id=p_auftrag_id and f.firma_id=v_firma and f.fotoart='Abschluss') then raise exception 'Vor Abschlussmeldung ist mindestens ein Abschlussfoto erforderlich.'; end if;
 update public.vermittlung_auftraege set status=p_status where id=p_auftrag_id and ausfuehrende_firma_id=v_firma;
 insert into public.vermittlung_firmen_auftragsmeldungen(auftrag_id,firma_id,benutzer_id,meldungstyp,nachricht)
 values(p_auftrag_id,v_firma,v_user,case when p_status='Abschluss gemeldet' then 'Abschlussmeldung' when p_status='Nachbesserung erforderlich' then 'Nachbesserung' else 'Fortschritt' end,coalesce(nullif(trim(p_nachricht),''),'Status geändert: '||p_status)) returning id into v_id;
 return jsonb_build_object('ok',true,'id',v_id,'status',p_status);
end $$;

-- Legacy admin RPCs now derive authority from auth.uid(), never from caller-supplied email.
create or replace function public.vermittlung_admin_list_users(p_actor_email text)
returns table(id uuid,name text,email text,rolle text,aktiv boolean,created_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp
as $$
begin
 if auth.uid() is null or not exists(select 1 from public.vermittlung_benutzer u where u.auth_user_id=auth.uid() and u.aktiv=true and u.rolle='Administrator') then raise exception 'Keine Administrator-Berechtigung.' using errcode='42501'; end if;
 return query select u.id,u.name,u.email,u.rolle,u.aktiv,u.created_at from public.vermittlung_benutzer u order by u.name;
end $$;

create or replace function public.vermittlung_admin_create_user(p_actor_email text,p_name text,p_email text,p_password text,p_rolle text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp
as $$
declare v_id uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.vermittlung_benutzer u where u.auth_user_id=auth.uid() and u.aktiv=true and u.rolle='Administrator') then raise exception 'Keine Administrator-Berechtigung.' using errcode='42501'; end if;
 if p_rolle not in ('Administrator','Auftragserfassung') then raise exception 'Externe Firmenkonten müssen über den sicheren Auth-Prozess angelegt werden.'; end if;
 if length(coalesce(p_password,''))<8 then raise exception 'Passwort muss mindestens 8 Zeichen haben.'; end if;
 if exists(select 1 from public.vermittlung_benutzer u where lower(trim(u.email))=lower(trim(p_email))) then raise exception 'E-Mail ist bereits vorhanden.'; end if;
 insert into public.vermittlung_benutzer(name,email,password_hash,rolle,aktiv,created_at) values(trim(p_name),lower(trim(p_email)),extensions.crypt(p_password,extensions.gen_salt('bf')),p_rolle,true,now()) returning id into v_id;
 return jsonb_build_object('ok',true,'id',v_id);
end $$;

create or replace function public.vermittlung_admin_update_user(p_actor_email text,p_user_id uuid,p_name text,p_email text,p_password text,p_rolle text,p_aktiv boolean)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp
as $$
begin
 if auth.uid() is null or not exists(select 1 from public.vermittlung_benutzer u where u.auth_user_id=auth.uid() and u.aktiv=true and u.rolle='Administrator') then raise exception 'Keine Administrator-Berechtigung.' using errcode='42501'; end if;
 if p_rolle not in ('Administrator','Auftragserfassung','Externe Firma') then raise exception 'Ungültige Rolle.'; end if;
 if exists(select 1 from public.vermittlung_benutzer u where lower(trim(u.email))=lower(trim(p_email)) and u.id<>p_user_id) then raise exception 'E-Mail ist bereits vorhanden.'; end if;
 update public.vermittlung_benutzer set name=trim(p_name),email=lower(trim(p_email)),rolle=p_rolle,aktiv=p_aktiv,
 password_hash=case when coalesce(p_password,'')<>'' then extensions.crypt(p_password,extensions.gen_salt('bf')) else password_hash end
 where id=p_user_id and (rolle<>'Externe Firma' or p_rolle='Externe Firma');
 if not found then raise exception 'Benutzer nicht gefunden oder externe Rolle nicht änderbar.'; end if;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.vermittlung_admin_delete_user(p_actor_email text,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_email text; v_auth uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.vermittlung_benutzer u where u.auth_user_id=auth.uid() and u.aktiv=true and u.rolle='Administrator') then raise exception 'Keine Administrator-Berechtigung.' using errcode='42501'; end if;
 select email,auth_user_id into v_email,v_auth from public.vermittlung_benutzer where id=p_user_id;
 if lower(trim(v_email))=lower(trim((select email from public.vermittlung_benutzer where auth_user_id=auth.uid()))) then raise exception 'Selbstlöschung nicht erlaubt.'; end if;
 delete from public.vermittlung_benutzer where id=p_user_id;
 if not found then raise exception 'Benutzer nicht gefunden.'; end if;
 return jsonb_build_object('ok',true,'auth_user_id',v_auth);
end $$;

create or replace function public.vermittlung_create_order_entry(p_user_email text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp
as $$
declare v_id uuid; v_email text;
begin
 select u.email into v_email from public.vermittlung_benutzer u where u.auth_user_id=auth.uid() and u.aktiv=true and u.rolle='Auftragserfassung' limit 1;
 if auth.uid() is null or v_email is null then raise exception 'Nicht für Auftragserfassung freigeschaltet.' using errcode='42501'; end if;
 insert into public.vermittlung_auftraege(bereich,prioritaet,status,objekt_adresse,objekt_typ,objekt_kontakt,objekt_kontakt_telefon,ansprechpartner,geplanter_beginn,beschreibung,schadensart,schadensort,versicherung,schadennummer,versicherungsgesellschaft,notizen,created_by)
 values(coalesce(p_data->>'bereich','Sonstige Vermittlung'),coalesce(p_data->>'prioritaet','Normal'),'Neue Anfrage',nullif(p_data->>'objekt_adresse',''),nullif(p_data->>'objekt_typ',''),nullif(p_data->>'objekt_kontakt',''),nullif(p_data->>'objekt_kontakt_telefon',''),nullif(p_data->>'ansprechpartner',''),nullif(p_data->>'geplanter_beginn','')::date,nullif(p_data->>'beschreibung',''),nullif(p_data->>'schadensart',''),nullif(p_data->>'schadensort',''),case when p_data->>'versicherung'='' then null else (p_data->>'versicherung')::boolean end,nullif(p_data->>'schadennummer',''),nullif(p_data->>'versicherungsgesellschaft',''),nullif(p_data->>'notizen',''),v_email) returning id into v_id;
 return jsonb_build_object('ok',true,'id',v_id);
end $$;

create or replace function public.vermittlung_generate_due_periods()
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare o record; start_month date; current_month date:=date_trunc('month',current_date)::date; period_month date; step_months integer; inserted_count integer:=0; one_count integer:=0;
begin
 if auth.uid() is null or not exists(select 1 from public.vermittlung_benutzer u where u.auth_user_id=auth.uid() and u.aktiv=true and u.rolle='Administrator') then raise exception 'Nur Administratoren dürfen Abrechnungen erzeugen.' using errcode='42501'; end if;
 for o in select id,ausfuehrende_firma_id,status,erstellt_am,geplanter_beginn,wiederholung,wiederholung_beginn,wiederholung_ende,wiederholung_aktiv,auftragswert_netto,provision from public.vermittlung_auftraege where coalesce(status,'')<>'Storniert'
 loop
  if coalesce(o.wiederholung,'Einmalig')='Einmalig' or coalesce(o.wiederholung_aktiv,false)=false then
   start_month:=date_trunc('month',coalesce(o.geplanter_beginn,o.erstellt_am::date))::date;
   if start_month<=current_month then
    insert into public.vermittlung_auftragsabrechnungen(auftrag_id,firma_id,abrechnungsmonat,auftragswert_netto,provision,wiederholung,status) values(o.id,o.ausfuehrende_firma_id,start_month,coalesce(o.auftragswert_netto,0),coalesce(o.provision,round(coalesce(o.auftragswert_netto,0)*0.10,2)),'Einmalig','Offen') on conflict(auftrag_id,abrechnungsmonat) do nothing;
    get diagnostics one_count=row_count; inserted_count:=inserted_count+one_count;
   end if;
  else
   start_month:=date_trunc('month',coalesce(o.wiederholung_beginn,o.geplanter_beginn,o.erstellt_am::date))::date;
   step_months:=case o.wiederholung when 'Monatlich' then 1 when 'Vierteljährlich' then 3 when 'Halbjährlich' then 6 when 'Jährlich' then 12 else 0 end;
   if step_months>0 and start_month<=current_month then
    period_month:=start_month;
    while period_month<=current_month and (o.wiederholung_ende is null or period_month<=date_trunc('month',o.wiederholung_ende)::date) loop
     if mod(((extract(year from period_month)::integer-extract(year from start_month)::integer)*12+extract(month from period_month)::integer-extract(month from start_month)::integer),step_months)=0 then
      insert into public.vermittlung_auftragsabrechnungen(auftrag_id,firma_id,abrechnungsmonat,auftragswert_netto,provision,wiederholung,status) values(o.id,o.ausfuehrende_firma_id,period_month,coalesce(o.auftragswert_netto,0),coalesce(o.provision,round(coalesce(o.auftragswert_netto,0)*0.10,2)),o.wiederholung,'Offen') on conflict(auftrag_id,abrechnungsmonat) do nothing;
      get diagnostics one_count=row_count; inserted_count:=inserted_count+one_count;
     end if;
     period_month:=(period_month+interval '1 month')::date;
    end loop;
   end if;
  end if;
 end loop;
 return jsonb_build_object('ok',true,'created_count',inserted_count,'checked_at',now());
end $$;
create or replace function public.vermittlung_generate_due_periods(p_actor_email text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$ begin if auth.uid() is null or not exists(select 1 from public.vermittlung_benutzer u where u.auth_user_id=auth.uid() and u.aktiv=true and u.rolle='Administrator') then raise exception 'Keine Administrator-Berechtigung.' using errcode='42501'; end if; return public.vermittlung_generate_due_periods(); end $$;

-- Remove permissive policies that previously allowed anonymous or any signed-in user to read/change all records.
do $$
declare t text; p record;
begin
 foreach t in array array['vermittlung_auftraege','vermittlung_firmen','vermittlung_kunden','vermittlung_dokumente','vermittlung_verlauf','vermittlung_provisionen','vermittlung_auftragsabrechnungen','vermittlung_auftragsdokumente'] loop
  if to_regclass('public.'||t) is not null then
   for p in select policyname from pg_policies where schemaname='public' and tablename=t loop execute format('drop policy %I on public.%I',p.policyname,t); end loop;
   execute format('alter table public.%I enable row level security',t);
   execute format('create policy %I on public.%I for all to authenticated using (public.vermittlung_current_role() = ''Administrator'') with check (public.vermittlung_current_role() = ''Administrator'')',t||'_admin_only',t);
  end if;
 end loop;
end $$;

revoke all on table public.vermittlung_auftraege,public.vermittlung_firmen,public.vermittlung_kunden,public.vermittlung_dokumente,public.vermittlung_verlauf,public.vermittlung_provisionen,public.vermittlung_auftragsabrechnungen,public.vermittlung_auftragsdokumente from anon;
grant select,insert,update,delete on table public.vermittlung_auftraege,public.vermittlung_firmen,public.vermittlung_kunden,public.vermittlung_dokumente,public.vermittlung_verlauf,public.vermittlung_provisionen,public.vermittlung_auftragsabrechnungen,public.vermittlung_auftragsdokumente to authenticated;

do $$ declare t text; p record; begin
 foreach t in array array['vermittlung_firmen_auftragsmeldungen','vermittlung_firmen_auftragsfotos'] loop
  for p in select policyname from pg_policies where schemaname='public' and tablename=t loop execute format('drop policy %I on public.%I',p.policyname,t); end loop;
 end loop;
end $$;
create policy firmenmeldungen_select_scoped on public.vermittlung_firmen_auftragsmeldungen for select to authenticated using (
 public.vermittlung_current_role()='Administrator' or (public.vermittlung_current_role()='Externe Firma' and firma_id=public.vermittlung_current_firma_id() and exists(select 1 from public.vermittlung_auftraege a where a.id=auftrag_id and a.ausfuehrende_firma_id=public.vermittlung_current_firma_id())));
create policy firmenmeldungen_insert_scoped on public.vermittlung_firmen_auftragsmeldungen for insert to authenticated with check (
 public.vermittlung_current_role()='Externe Firma' and firma_id=public.vermittlung_current_firma_id() and exists(select 1 from public.vermittlung_auftraege a where a.id=auftrag_id and a.ausfuehrende_firma_id=public.vermittlung_current_firma_id()));
create policy firmenfotos_select_scoped on public.vermittlung_firmen_auftragsfotos for select to authenticated using (
 public.vermittlung_current_role()='Administrator' or (public.vermittlung_current_role()='Externe Firma' and firma_id=public.vermittlung_current_firma_id() and exists(select 1 from public.vermittlung_auftraege a where a.id=auftrag_id and a.ausfuehrende_firma_id=public.vermittlung_current_firma_id())));
create policy firmenfotos_insert_scoped on public.vermittlung_firmen_auftragsfotos for insert to authenticated with check (
 public.vermittlung_current_role()='Externe Firma' and firma_id=public.vermittlung_current_firma_id() and hochgeladen_von=auth.uid() and exists(select 1 from public.vermittlung_auftraege a where a.id=auftrag_id and a.ausfuehrende_firma_id=public.vermittlung_current_firma_id()));
grant select,insert on public.vermittlung_firmen_auftragsmeldungen,public.vermittlung_firmen_auftragsfotos to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('vermittlung-firmenfotos','vermittlung-firmenfotos',false,10485760,array['image/jpeg','image/png','image/webp']) on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
drop policy if exists vermittlung_firmenfotos_insert on storage.objects;
drop policy if exists vermittlung_firmenfotos_select on storage.objects;
drop policy if exists vermittlung_firmenfotos_delete on storage.objects;
create policy vermittlung_firmenfotos_insert on storage.objects for insert to authenticated with check(bucket_id='vermittlung-firmenfotos' and public.vermittlung_current_role()='Externe Firma' and (storage.foldername(name))[1]=public.vermittlung_current_firma_id()::text and exists(select 1 from public.vermittlung_auftraege a where a.id::text=(storage.foldername(name))[2] and a.ausfuehrende_firma_id=public.vermittlung_current_firma_id()));
create policy vermittlung_firmenfotos_select on storage.objects for select to authenticated using(bucket_id='vermittlung-firmenfotos' and (public.vermittlung_current_role()='Administrator' or (public.vermittlung_current_role()='Externe Firma' and (storage.foldername(name))[1]=public.vermittlung_current_firma_id()::text and exists(select 1 from public.vermittlung_auftraege a where a.id::text=(storage.foldername(name))[2] and a.ausfuehrende_firma_id=public.vermittlung_current_firma_id()))));
create policy vermittlung_firmenfotos_delete on storage.objects for delete to authenticated using(bucket_id='vermittlung-firmenfotos' and public.vermittlung_current_role()='Administrator');

revoke execute on function public.vermittlung_admin_list_users(text) from public,anon;
revoke execute on function public.vermittlung_admin_create_user(text,text,text,text,text) from public,anon;
revoke execute on function public.vermittlung_admin_update_user(text,uuid,text,text,text,text,boolean) from public,anon;
revoke execute on function public.vermittlung_admin_delete_user(text,uuid) from public,anon;
revoke execute on function public.vermittlung_create_order_entry(text,jsonb) from public,anon;
revoke execute on function public.vermittlung_generate_due_periods() from public,anon;
revoke execute on function public.vermittlung_generate_due_periods(text) from public,anon;
grant execute on function public.vermittlung_admin_list_users(text) to authenticated;
grant execute on function public.vermittlung_admin_create_user(text,text,text,text,text) to authenticated;
grant execute on function public.vermittlung_admin_update_user(text,uuid,text,text,text,text,boolean) to authenticated;
grant execute on function public.vermittlung_admin_delete_user(text,uuid) to authenticated;
grant execute on function public.vermittlung_create_order_entry(text,jsonb) to authenticated;
grant execute on function public.vermittlung_generate_due_periods() to authenticated;
grant execute on function public.vermittlung_generate_due_periods(text) to authenticated;
