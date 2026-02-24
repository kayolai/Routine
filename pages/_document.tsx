import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="fr">
      <Head>
        {/* PWA — manifest */}
        <link rel="manifest" href="/manifest.json" />

        {/* Couleur de la barre d'adresse sur Android */}
        <meta name="theme-color" content="#7c3aed" />

        {/* iOS — installation sur l'écran d'accueil */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Routine Boss" />
        <link rel="apple-touch-icon" href="/icon.svg" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
