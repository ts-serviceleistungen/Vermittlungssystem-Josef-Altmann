VERMITTLUNGSSYSTEM JOSEF ALTMANN
================================

BESTANDTEILE
- index.html: Oberfläche und Login
- app.js: App-Logik einschließlich Firmenportal und Abschlussprüfung
- style.css: Design
- config.js: Supabase-URL und Publishable Key (kein Service-Role-Key)
- supabase/migrations: Datenbankmigrationen
- supabase/functions: Edge Functions

FIRMENPORTAL
- Externe Firmen melden sich über Supabase Auth an.
- Ein Firmenkonto muss in vermittlung_benutzer die Rolle "Externe Firma", eine auth_user_id, aktiv=true und eine firma_id haben.
- Aufträge werden ausschließlich über vermittlung_firma_auftraege für die zugeordnete ausführende Firma geladen.
- Externe Firmen können Fortschrittsmeldungen und Fotos hochladen.
- Eine Abschlussmeldung benötigt mindestens ein Foto mit fotoart="Abschluss".
- Administratoren prüfen eingereichte Abschlüsse unter "Abschlussprüfung" und können "Abgeschlossen" oder "Nachbesserung erforderlich" setzen.
- Dokument-Edge-Functions prüfen Supabase-Sitzung, aktive Rolle und bei externen Firmen die Auftragszuordnung.

WICHTIG ZUR BEREITSTELLUNG
- Der Firmenportal-Code liegt im Hauptbranch.
- Die Firmenportal-Migrationen bis einschließlich 202610150006 wurden auf dem verbundenen Supabase-Produktivprojekt angewendet.
- Die Edge Functions admin-create-app-user, get-order-documents, get-order-document-url, upload-order-document und send-order-email wurden aktualisiert.
- Nicht erneut alle bereits angewendeten Migrationen manuell ausführen.
- Nach Änderungen an app.js muss der konfigurierte Hosting-Anbieter die aktuelle Hauptbranch-Version veröffentlichen. Das Hosting wurde durch diese GitHub-Änderung nicht unabhängig verifiziert.
- Vor Produktivfreigabe den Ablauf mit einem separaten externen Testkonto prüfen: Login, nur zugewiesene Aufträge, Meldung, Foto-Upload, Abschlussmeldung, Admin-Freigabe und Nachbesserung. Zusätzlich mit zwei Firmenkonten kontrollieren, dass Firmen keine Daten der jeweils anderen Firma sehen.
- Keine Supabase-Service-Role-Keys in config.js oder im Browser hinterlegen.

SICHERHEIT
- Das Portal verwendet echte Supabase-Auth-Sitzungen und serverseitige Rollenprüfungen.
- Das aktuelle Projekt enthält weitere bestehende Tabellen und Funktionen; RLS-/Policy-Änderungen müssen bei späteren Änderungen auf Auswirkungen für Admin- und Auftragserfassungsrollen geprüft werden.
