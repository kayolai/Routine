import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string | null;
  location: string | null;
  isAllDay: boolean;
  isRoutine: boolean;   // créé par routine-boss via /api/sync
  isCompleted: boolean; // titre commence par "[✔]"
}

type ApiResponse = { events: CalendarEvent[] } | { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } =
    process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    return res.status(500).json({
      error:
        "Variables d'environnement manquantes : GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN",
    });
  }

  const oAuth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET
  );

  oAuth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

  const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

  const timeMin = new Date();
  timeMin.setHours(0, 0, 0, 0);
  const timeMax = new Date(timeMin);
  timeMax.setDate(timeMax.getDate() + 7);

  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    maxResults: 100,
    singleEvents: true,
    orderBy: "startTime",
  });

  const items = response.data.items ?? [];

  const events: CalendarEvent[] = items.map((event) => {
    const isAllDay = Boolean(event.start?.date && !event.start?.dateTime);
    return {
      id: event.id ?? crypto.randomUUID(),
      title: event.summary ?? "(Sans titre)",
      start: event.start?.dateTime ?? event.start?.date ?? "",
      end: event.end?.dateTime ?? event.end?.date ?? null,
      location: event.location ?? null,
      isAllDay,
      isRoutine: event.extendedProperties?.["private"]?.["source"] === "routine-boss",
      isCompleted: (event.summary ?? "").startsWith("[✔]"),
    };
  });

  res.status(200).json({ events });
}
