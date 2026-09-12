import React from "react";
import ReactDOM from "react-dom/client";
import Vermoegenskompass from "./Vermoegenskompass.jsx";
import PersonalLanding from "./PersonalLanding.jsx";
import "./index.css";

// Einfaches Pfad-Routing ohne zusätzliche Bibliothek: /analyse, /rechner und
// /tool zeigen alle den Vermögenskompass (der anhand des Pfads selbst
// erkennt, ob er direkt beim Rechner oder beim CRM starten soll), alles
// andere (allen voran /) die Landingpage. Selbstauskunft läuft weiterhin
// über die URL-Raute (#selbstauskunft-…) innerhalb von /analyse – unberührt.
const pfad = window.location.pathname;
const zeigeVermoegenskompass = pfad.startsWith("/analyse") || pfad.startsWith("/rechner") || pfad.startsWith("/tool");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {zeigeVermoegenskompass ? <Vermoegenskompass /> : <PersonalLanding />}
  </React.StrictMode>
);
