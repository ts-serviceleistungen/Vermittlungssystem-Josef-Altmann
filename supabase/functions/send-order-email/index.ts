
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Nur POST ist erlaubt.' }, 405);
  }

  let step = 'Initialisierung';

  const env = (key: string) => Deno.env.get(key) || '';
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASSWORD',
  ];

  const missing = required.filter((key) => !env(key));

  if (missing.length > 0) {
    console.error('send-order-email: Serverkonfiguration fehlt:', missing);
    return json({
      ok: false,
      error: 'Serverkonfiguration fehlt: ' + missing.join(', '),
      step: 'Konfiguration',
    }, 500);
  }

  let mailAccepted = false;
  let messageId: string | null = null;

  try {
    step = 'Eingabedaten lesen';

    const authorization = req.headers.get('Authorization') || '';
    const token = authorization.replace(/^Bearer\\s+/i, '').trim();
    if (!token) return json({ ok: false, error: 'Anmeldung erforderlich.' }, 401);

    const admin = createClient(
      env('SUPABASE_URL'),
      env('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ ok: false, error: 'Sitzung ungültig.' }, 401);

    const input = await req.json();
    const orderId = String(input.order_id || '').trim();
    const recipients = Array.isArray(input.recipients)
      ? input.recipients
      : [];
    const subject = String(input.subject || '').trim().slice(0, 250);
    const body = String(input.body || '').trim();
    const cc = 'auftragsservice@josef-altmann.de';

    if (
      !orderId ||
      recipients.length === 0 ||
      !subject ||
      !body
    ) {
      return json({
        ok: false,
        error:
          'Auftrag, Absender-Benutzer, Empfänger, Betreff und Nachricht sind erforderlich.',
        step,
      }, 400);
    }

    if (recipients.length > 30) {
      return json({
        ok: false,
        error: 'Maximal 30 Empfänger pro Versand.',
        step,
      }, 400);
    }

    if (
      recipients.some(
        (r: any) => !r.email || !String(r.email).includes('@'),
      )
    ) {
      return json({
        ok: false,
        error: 'Mindestens eine Empfängeradresse ist ungültig.',
        step,
      }, 400);
    }

    step = 'Angemeldeten Administrator prüfen';

    const { data: user, error: userError } = await admin
      .from('vermittlung_benutzer')
      .select('id,email,rolle,aktiv,auth_user_id')
      .eq('auth_user_id', authData.user.id)
      .maybeSingle();
    const actorEmail = String(user?.email || '').trim().toLowerCase();

    if (userError) {
      throw new Error(
        'Benutzerprüfung fehlgeschlagen: ' + userError.message,
      );
    }

    if (
      !user ||
      user.rolle !== 'Administrator' ||
      user.aktiv === false
    ) {
      return json({
        ok: false,
        error: 'Nur aktive Administratoren dürfen Aufträge versenden.',
        step,
      }, 403);
    }

    step = 'Anhangsliste prüfen';

    const attachmentIds = Array.isArray(input.attachment_ids)
      ? [
          ...new Set(
            input.attachment_ids.map((id: unknown) => String(id)),
          ),
        ]
      : [];

    if (attachmentIds.length > 10) {
      return json({
        ok: false,
        error: 'Maximal 10 Dokumente pro E-Mail.',
        step,
      }, 400);
    }

    const attachments: Array<{
      filename: string;
      content: Uint8Array;
      contentType: string;
    }> = [];

    if (attachmentIds.length > 0) {
      step = 'Dokumentdaten aus Datenbank laden';

      const { data: docs, error: docsError } = await admin
        .from('vermittlung_auftragsdokumente')
        .select(
          'id,auftrag_id,dateiname,speicherpfad,mime_type,dateigroesse',
        )
        .eq('auftrag_id', orderId)
        .in('id', attachmentIds);

      if (docsError) {
        throw new Error(
          'Anlagen konnten nicht geladen werden: ' + docsError.message,
        );
      }

      if (!docs || docs.length !== attachmentIds.length) {
        return json({
          ok: false,
          error:
            'Mindestens ein ausgewähltes Dokument gehört nicht zu diesem Auftrag oder wurde nicht gefunden.',
          step,
        }, 400);
      }

      let totalBytes = 0;

      for (const doc of docs) {
        step = 'Anhang herunterladen: ' + String(doc.dateiname);

        const { data: file, error: downloadError } = await admin.storage
          .from('vermittlung-dokumente')
          .download(doc.speicherpfad);

        if (downloadError || !file) {
          throw new Error(
            'Datei "' + doc.dateiname +
            '" konnte nicht geladen werden: ' +
            (downloadError?.message || 'Datei fehlt'),
          );
        }

        const buffer = new Uint8Array(await file.arrayBuffer());
        totalBytes += buffer.byteLength;

        if (totalBytes > 18 * 1024 * 1024) {
          return json({
            ok: false,
            error:
              'Die ausgewählten Anhänge sind zusammen größer als 18 MB. Bitte weniger Dateien auswählen.',
            step,
          }, 413);
        }

        attachments.push({
          filename: String(doc.dateiname || 'Dokument'),
          content: buffer,
          contentType: String(
            doc.mime_type || 'application/octet-stream',
          ),
        });
      }
    }

    step = 'SMTP-Verbindung vorbereiten';

    const smtpPort = Number(env('SMTP_PORT'));

    if (!Number.isInteger(smtpPort) || smtpPort <= 0) {
      throw new Error('SMTP_PORT ist ungültig.');
    }

    const transport = nodemailer.createTransport({
      host: env('SMTP_HOST'),
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: env('SMTP_USER'),
        pass: env('SMTP_PASSWORD'),
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 60000,
    });

    const to = recipients.map((r: any) => ({
      name: String(r.name || ''),
      address: String(r.email).trim(),
    }));

    step = 'E-Mail an SMTP-Mailserver übergeben';

    const info = await transport.sendMail({
      from: {
        name: 'Vermittlungssystem Josef Altmann',
        address: 'auftragsservice@josef-altmann.de',
      },
      to,
      cc,
      subject,
      text: body,
      attachments,
    });

    mailAccepted = Array.isArray(info.accepted)
      ? info.accepted.length > 0
      : false;
    messageId = info.messageId || null;

    if (!mailAccepted) {
      throw new Error(
        'Der Mailserver hat keinen Empfänger als angenommen bestätigt. Abgelehnte Empfänger: ' +
        JSON.stringify(info.rejected || []),
      );
    }

    step = 'E-Mail-Versand protokollieren';

    const logRows = recipients.map((r: any) => ({
      auftrag_id: orderId,
      empfaenger_firma_id: r.company_id || null,
      empfaenger_firma: String(r.name || ''),
      empfaenger_email: String(r.email).trim(),
      cc_email: cc,
      betreff: subject,
      versendet_von: actorEmail,
      versand_status: 'vom_mailserver_angenommen',
      mail_message_id: messageId,
    }));

    const { error: logError } = await admin
      .from('vermittlung_email_versand')
      .insert(logRows);

    if (logError) {
      console.error(
        'E-Mail angenommen, Protokollierung fehlgeschlagen:',
        logError.message,
      );

      return json({
        ok: true,
        warning:
          'Die E-Mail wurde vom Mailserver angenommen, aber das Versandprotokoll konnte nicht gespeichert werden: ' +
          logError.message,
        message_id: messageId,
      });
    }

    console.log(
      'send-order-email erfolgreich. Message-ID:',
      messageId || 'nicht vorhanden',
      'Anhänge:',
      attachments.length,
    );

    return json({
      ok: true,
      message_id: messageId,
      accepted: info.accepted || [],
      rejected: info.rejected || [],
      attachment_count: attachments.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorName = err instanceof Error ? err.name : 'UnknownError';
    const errorCode =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code || '')
        : '';

    console.error(
      'send-order-email Fehler. Schritt:',
      step,
      'Name:',
      errorName,
      'Code:',
      errorCode,
      'Meldung:',
      message,
    );

    if (err instanceof Error && err.stack) {
      console.error('Fehlerdetails:', err.stack);
    }

    return json({
      ok: false,
      error: message,
      step,
      error_name: errorName,
      error_code: errorCode || null,
      mail_server_accepted: mailAccepted,
      message_id: messageId,
    }, 500);
  }
});
