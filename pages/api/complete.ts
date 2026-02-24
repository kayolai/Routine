import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";

type ApiResponse = { ok: true } | { error: string };

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

  const { eventId, completed } = req.body;
  if (!eventId || typeof eventId !== "string") {
    return res.status(400).json({ error: "eventId manquant ou invalide" });
  }
  if (typeof completed !== "boolean") {
    return res.status(400).json({ error: "completed (boolean) manquant" });
  }

  const oAuth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET
  );
  oAuth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

  const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

  const existing = await calendar.events.get({ calendarId: "primary", eventId });
  const currentSummary = existing.data.summary ?? "";

  const newSummary = completed
    ? (currentSummary.startsWith("[✔]") ? currentSummary : `[✔] ${currentSummary}`)
    : currentSummary.replace(/^\[✔\] /, "");

  await calendar.events.patch({
    calendarId: "primary",
    eventId,
    requestBody: {
      summary: newSummary,
      colorId: completed ? "8" : "2", // Graphite si fait, Sage (vert) si annulé
    },
  });

  res.status(200).json({ ok: true });
}
