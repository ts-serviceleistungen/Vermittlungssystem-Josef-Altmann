import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply({ok:false,error:"Nur POST erlaubt."},405);
 const url=Deno.env.get("SUPABASE_URL")||"", key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!url||!key)return reply({ok:false,error:"Serverkonfiguration fehlt."},500);
 const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();
 if(!token)return reply({ok:false,error:"Anmeldung erforderlich."},401);
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const {data:auth,error:authErr}=await admin.auth.getUser(token);
  if(authErr||!auth.user)return reply({ok:false,error:"Sitzung ungültig."},401);
  const {data:actor,error:actorErr}=await admin.from("vermittlung_benutzer").select("id,rolle,aktiv").eq("auth_user_id",auth.user.id).maybeSingle();
  if(actorErr)throw actorErr;
  if(!actor||!actor.aktiv||actor.rolle!=="Administrator")return reply({ok:false,error:"Nur Administratoren dürfen Benutzer anlegen."},403);
  const b=await req.json(),name=String(b.name||"").trim(),email=String(b.email||"").trim().toLowerCase(),password=String(b.password||""),rolle=String(b.rolle||""),firma_id=b.firma_id?String(b.firma_id):null;
  if(name.length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return reply({ok:false,error:"Name oder E-Mail ungültig."},400);
  if(password.length<12)return reply({ok:false,error:"Passwort muss mindestens 12 Zeichen haben."},400);
  if(!["Administrator","Auftragserfassung","Externe Firma"].includes(rolle))return reply({ok:false,error:"Ungültige Rolle."},400);
  if((rolle==="Externe Firma")!==Boolean(firma_id))return reply({ok:false,error:"Externe Firmenkonten benötigen genau eine Firmenzuordnung."},400);
  const {data:existing}=await admin.from("vermittlung_benutzer").select("id").ilike("email",email).maybeSingle();
  if(existing)return reply({ok:false,error:"Diese E-Mail ist bereits vorhanden."},409);
  if(firma_id){const {data:f,error}=await admin.from("vermittlung_firmen").select("id").eq("id",firma_id).maybeSingle();if(error)throw error;if(!f)return reply({ok:false,error:"Firma nicht gefunden."},400);}
  const {data:created,error:createErr}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:name}});
  if(createErr||!created.user)return reply({ok:false,error:createErr?.message||"Auth-Konto konnte nicht angelegt werden."},400);
  const {data:profile,error:profileErr}=await admin.from("vermittlung_benutzer").insert({name,email,rolle,aktiv:true,auth_user_id:created.user.id,firma_id,password_hash:"supabase-auth-managed"}).select("id,name,email,rolle,firma_id").single();
  if(profileErr){await admin.auth.admin.deleteUser(created.user.id);throw profileErr;}
  return reply({ok:true,user:profile});
 }catch(e){console.error(e);return reply({ok:false,error:e instanceof Error?e.message:"Interner Fehler."},500);}
});