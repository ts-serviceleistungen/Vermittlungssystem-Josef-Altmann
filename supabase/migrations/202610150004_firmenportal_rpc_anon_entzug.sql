-- Explicitly remove default PUBLIC execution from firm-portal SECURITY DEFINER RPCs.
revoke all privileges on function public.vermittlung_current_profile() from PUBLIC;
revoke all privileges on function public.vermittlung_current_profile() from anon;
revoke all privileges on function public.vermittlung_firma_auftraege() from PUBLIC;
revoke all privileges on function public.vermittlung_firma_auftraege() from anon;
revoke all privileges on function public.vermittlung_firma_meldung_erstellen(uuid,text,text) from PUBLIC;
revoke all privileges on function public.vermittlung_firma_meldung_erstellen(uuid,text,text) from anon;
revoke all privileges on function public.vermittlung_firma_status_melden(uuid,text,text) from PUBLIC;
revoke all privileges on function public.vermittlung_firma_status_melden(uuid,text,text) from anon;
grant execute on function public.vermittlung_current_profile() to authenticated;
grant execute on function public.vermittlung_firma_auftraege() to authenticated;
grant execute on function public.vermittlung_firma_meldung_erstellen(uuid,text,text) to authenticated;
grant execute on function public.vermittlung_firma_status_melden(uuid,text,text) to authenticated;
