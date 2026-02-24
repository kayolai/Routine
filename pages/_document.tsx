import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="fr">
      <Head>
        {/* PWA — manifest */}
        <link rel="manifest" href="/manifest.json" />

        {/* Favicon navigateur */}
        <link rel="icon" href="/icon-192x192.png" type="image/png" />

        {/* Couleur de la barre système Android (émeraude = couleur des routines) */}
        <meta name="theme-color" content="#10B981" />

        {/* iOS — installation sur l'écran d'accueil */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Routine Boss" />
        <link rel="apple-touch-icon" href="/icon-192x192.png" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
