create or replace function public.vermittlung_admin_abschluss_pruefen(p_auftrag_id uuid,p_status text,p_nachricht text default '')
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_firma uuid; v_user uuid; v_id uuid;
begin
 if auth.uid() is null then raise exception 'Anmeldung erforderlich.' using errcode='42501'; end if;
 select id into v_user from public.vermittlung_benutzer where auth_user_id=auth.uid() and aktiv=true and rolle='Administrator' limit 1;
 if v_user is null then raise exception 'Nur Administratoren dürfen Abschlüsse prüfen.' using errcode='42501'; end if;
 if p_status not in ('Abgeschlossen','Nachbesserung erforderlich') then raise exception 'Ungültiger Prüfstatus.'; end if;
 select ausfuehrende_firma_id into v_firma from public.vermittlung_auftraege where id=p_auftrag_id;
 if not found or v_firma is null then raise exception 'Auftrag oder ausführende Firma nicht gefunden.'; end if;
 if p_status='Abgeschlossen' and not exists(select 1 from public.vermittlung_firmen_auftragsfotos where auftrag_id=p_auftrag_id and firma_id=v_firma and fotoart='Abschluss') then raise exception 'Abschluss kann ohne Abschlussfoto nicht freigegeben werden.'; end if;
 update public.vermittlung_auftraege set status=p_status where id=p_auftrag_id;
 insert into public.vermittlung_firmen_auftragsmeldungen(auftrag_id,firma_id,benutzer_id,meldungstyp,nachricht)
 values(p_auftrag_id,v_firma,v_user,case when p_status='Abgeschlossen' then 'Abschlussprüfung' else 'Nachbesserung' end,coalesce(nullif(trim(p_nachricht),''),case when p_status='Abgeschlossen' then 'Abschluss durch Verwaltung bestätigt.' else 'Bitte Nachbesserung durchführen.' end)) returning id into v_id;
 return jsonb_build_object('ok',true,'id',v_id,'status',p_status);
end $$;
revoke all privileges on function public.vermittlung_admin_abschluss_pruefen(uuid,text,text) from PUBLIC;
revoke all privileges on function public.vermittlung_admin_abschluss_pruefen(uuid,text,text) from anon;
grant execute on function public.vermittlung_admin_abschluss_pruefen(uuid,text,text) to authenticated;
