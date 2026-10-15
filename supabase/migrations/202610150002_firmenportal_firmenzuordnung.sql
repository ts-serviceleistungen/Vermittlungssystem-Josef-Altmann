create or replace function public.vermittlung_admin_assign_firma(p_user_id uuid,p_firma_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
begin
 if auth.uid() is null or not exists(select 1 from public.vermittlung_benutzer u where u.auth_user_id=auth.uid() and u.aktiv=true and u.rolle='Administrator') then
  raise exception 'Keine Administrator-Berechtigung.' using errcode='42501';
 end if;
 if not exists(select 1 from public.vermittlung_firmen f where f.id=p_firma_id) then raise exception 'Firma nicht gefunden.'; end if;
 update public.vermittlung_benutzer set firma_id=p_firma_id where id=p_user_id and rolle='Externe Firma';
 if not found then raise exception 'Benutzer ist kein externes Firmenkonto.'; end if;
 return jsonb_build_object('ok',true);
end $$;
revoke execute on function public.vermittlung_admin_assign_firma(uuid,uuid) from public,anon;
grant execute on function public.vermittlung_admin_assign_firma(uuid,uuid) to authenticated;
