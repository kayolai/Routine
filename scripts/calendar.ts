/**
 * Script : liste des 10 prochains événements Google Calendar
 *
 * Prérequis :
 *  1. Créer un projet sur https://console.cloud.google.com
 *  2. Activer l'API Google Calendar
 *  3. Créer des identifiants OAuth2 (type "Application de bureau")
 *  4. Télécharger le fichier JSON et le renommer en credentials.json à la racine
 *  5. Dans les identifiants OAuth, ajouter http://localhost:3001 comme URI de redirection autorisée
 *
 * Lancer avec : npm run calendar
 */

import { google } from "googleapis";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as url from "url";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];
const TOKEN_PATH = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");
const REDIRECT_PORT = 3001;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

interface OAuthKeys {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
}

interface CredentialsFile {
  installed?: OAuthKeys;
  web?: OAuthKeys;
}

function loadCredentials(): OAuthKeys {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(`
Erreur : le fichier credentials.json est introuvable.

Etapes pour le créer :
  1. Rendez-vous sur https://console.cloud.google.com
  2. Créez un projet et activez l'API "Google Calendar"
  3. Allez dans "APIs & Services" > "Identifiants" > "Créer des identifiants" > "ID client OAuth"
  4. Choisissez le type "Application de bureau"
  5. Téléchargez le JSON et copiez-le ici sous le nom : credentials.json
  6. Dans les paramètres OAuth, ajoutez l'URI de redirection : http://localhost:${REDIRECT_PORT}
`);
    process.exit(1);
  }

  const raw = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
  const parsed: CredentialsFile = JSON.parse(raw);
  const keys = parsed.installed ?? parsed.web;

  if (!keys) {
    console.error('Erreur : format credentials.json invalide (clé "installed" ou "web" introuvable).');
    process.exit(1);
  }

  return keys;
}

function createOAuthClient(keys: OAuthKeys) {
  return new google.auth.OAuth2(keys.client_id, keys.client_secret, REDIRECT_URI);
}

function getAccessToken(oAuth2Client: InstanceType<typeof google.auth.OAuth2>): Promise<void> {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("--------------------------------------------------------------");
  console.log("Ouvrez ce lien dans votre navigateur pour vous authentifier :");
  console.log("--------------------------------------------------------------");
  console.log(authUrl);
  console.log("--------------------------------------------------------------\n");

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const parsedUrl = url.parse(req.url ?? "/", true);
        const code = parsedUrl.query.code as string | undefined;
        const error = parsedUrl.query.error as string | undefined;

        if (error) {
          res.writeHead(400);
          res.end(`Erreur d'authentification : ${error}`);
          server.close();
          reject(new Error(`Erreur OAuth : ${error}`));
          return;
        }

        if (code) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h2>Authentification reussie !</h2><p>Vous pouvez fermer cet onglet et revenir dans le terminal.</p>");
          server.close();

          const { tokens } = await oAuth2Client.getToken(code);
          oAuth2Client.setCredentials(tokens);
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
          console.log(`Token sauvegarde dans : ${TOKEN_PATH}\n`);
          resolve();
        }
      } catch (err) {
        reject(err);
      }
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(`En attente du callback OAuth sur le port ${REDIRECT_PORT}...`);
    });

    server.on("error", (err) => {
      reject(new Error(`Impossible de démarrer le serveur sur le port ${REDIRECT_PORT} : ${err.message}`));
    });
  });
}

async function authorize(): Promise<InstanceType<typeof google.auth.OAuth2>> {
  const keys = loadCredentials();
  const oAuth2Client = createOAuthClient(keys);

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    oAuth2Client.setCredentials(token);
    console.log(`Token charge depuis : ${TOKEN_PATH}\n`);
  } else {
    await getAccessToken(oAuth2Client);
  }

  return oAuth2Client;
}

async function listCalendarEvents(auth: InstanceType<typeof google.auth.OAuth2>): Promise<void> {
  const calendar = google.calendar({ version: "v3", auth });

  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: new Date().toISOString(),
    maxResults: 10,
    singleEvents: true,
    orderBy: "startTime",
  });

  const events = response.data.items;

  if (!events || events.length === 0) {
    console.log("Aucun evenement a venir trouve dans le calendrier principal.");
    return;
  }

  console.log("=== 10 prochains evenements du calendrier principal ===\n");

  events.forEach((event, index) => {
    const start = event.start?.dateTime ?? event.start?.date ?? "Date inconnue";
    const title = event.summary ?? "(Sans titre)";
    const location = event.location ? ` | Lieu : ${event.location}` : "";
    console.log(`${String(index + 1).padStart(2, " ")}. [${start}] ${title}${location}`);
  });

  console.log("\n======================================================");
}

async function main(): Promise<void> {
  console.log("\n=== Google Calendar — Consultation des evenements ===\n");

  const auth = await authorize();
  await listCalendarEvents(auth);
}

main().catch((error: Error) => {
  console.error("\nErreur :", error.message);
  process.exit(1);
});
