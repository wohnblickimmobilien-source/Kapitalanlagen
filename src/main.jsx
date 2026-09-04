import React from "react";
import ReactDOM from "react-dom/client";
import Vermoegenskompass from "./Vermoegenskompass.jsx";
import PersonalLanding from "./PersonalLanding.jsx";
import "./index.css";

// Einfaches Pfad-Routing ohne zusätzliche Bibliothek: /analyse und /rechner
// zeigen beide den Vermögenskompass (der anhand des Pfads selbst erkennt,
// ob er direkt beim Rechner starten soll), alles andere (allen voran /)
// die Landingpage. CRM/Selbstauskunft laufen weiterhin über die
// URL-Raute (#crm, #selbstauskunft-…) innerhalb von /analyse – unberührt.
const pfad = window.location.pathname;
const zeigeVermoegenskompass = pfad.startsWith("/analyse") || pfad.startsWith("/rechner");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {zeigeVermoegenskompass ? <Vermoegenskompass /> : <PersonalLanding />}
  </React.StrictMode>
);
