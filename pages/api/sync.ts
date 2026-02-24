import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";

export interface SyncTask {
  title: string;
  startIso: string; // "2026-02-23T11:00:00" — heure locale, sans Z
  endIso: string;
  timezone: string; // ex: "Europe/Paris"
}

type ApiResponse = { created: number; deleted: number } | { error: string };

const SOURCE_KEY = ["source=routine-boss"];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } =
    process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    return res.status(500).json({
      error: "Variables d'environnement manquantes : GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN",
    });
  }

  const tasks: SyncTask[] = req.body?.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return res.status(400).json({ error: "Aucune tâche à synchroniser" });
  }

  const oAuth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET
  );
  oAuth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

  const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

  // ── 1. Calculer la fenêtre couverte par les tâches à synchroniser ─────────
  const startDates = tasks.map((t) => new Date(t.startIso));
  const timeMin = new Date(Math.min(...startDates.map((d) => d.getTime())));
  timeMin.setHours(0, 0, 0, 0);
  const timeMax = new Date(Math.max(...startDates.map((d) => d.getTime())));
  timeMax.setDate(timeMax.getDate() + 1);
  timeMax.setHours(0, 0, 0, 0);

  // ── 2. Lister les anciens événements routine-boss sur cette fenêtre ───────
  const existing = await calendar.events.list({
    calendarId: "primary",
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    privateExtendedProperty: SOURCE_KEY,
    singleEvents: true,
    maxResults: 250,
  });

  const toDelete = existing.data.items ?? [];

  // ── 3. Supprimer les anciens événements ───────────────────────────────────
  const deletions = await Promise.allSettled(
    toDelete.map((e) =>
      calendar.events.delete({ calendarId: "primary", eventId: e.id! })
    )
  );

  const deleteFailed = deletions.filter((r) => r.status === "rejected");
  if (deleteFailed.length > 0) {
    const reason = (deleteFailed[0] as PromiseRejectedResult).reason?.message ?? "Erreur inconnue";
    return res.status(500).json({ error: `Échec suppression : ${reason}` });
  }

  // ── 4. Insérer les nouveaux événements marqués ────────────────────────────
  const insertions = await Promise.allSettled(
    tasks.map((task) =>
      calendar.events.insert({
        calendarId: "primary",
        requestBody: {
          summary: task.title,
          colorId: "2", // Sage (vert)
          start: { dateTime: task.startIso, timeZone: task.timezone },
          end:   { dateTime: task.endIso,   timeZone: task.timezone },
          extendedProperties: { private: { source: "routine-boss" } },
          reminders: {
            useDefault: false,
            overrides: [{ method: "popup", minutes: 10 }],
          },
        },
      })
    )
  );

  const insertFailed = insertions.filter((r) => r.status === "rejected");
  if (insertFailed.length > 0) {
    const reason = (insertFailed[0] as PromiseRejectedResult).reason?.message ?? "Erreur inconnue";
    return res.status(500).json({ error: `${insertFailed.length} insertion(s) échouée(s) : ${reason}` });
  }

  res.status(200).json({ created: insertions.length, deleted: toDelete.length });
}
