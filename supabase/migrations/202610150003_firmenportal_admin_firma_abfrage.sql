create or replace function public.vermittlung_admin_get_user_firma(p_user_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_firma uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.vermittlung_benutzer u where u.auth_user_id=auth.uid() and u.aktiv=true and u.rolle='Administrator') then
  raise exception 'Keine Administrator-Berechtigung.' using errcode='42501';
 end if;
 select firma_id into v_firma from public.vermittlung_benutzer where id=p_user_id and rolle='Externe Firma';
 return v_firma;
end $$;
revoke execute on function public.vermittlung_admin_get_user_firma(uuid) from public,anon;
grant execute on function public.vermittlung_admin_get_user_firma(uuid) to authenticated;
