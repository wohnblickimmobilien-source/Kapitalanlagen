import React, { useState, useMemo, useEffect, useRef, useDeferredValue } from "react";
import {
  XAxis, YAxis, ResponsiveContainer, ComposedChart, Area, Line
} from "recharts";
import {
  ArrowRight, ArrowLeft, Check, TrendingUp, Receipt,
  Calculator, ChevronRight, Info, UserCheck, MessageCircle, Clock, Star,
  Phone, Mail, RefreshCw, Search, Users, X, Plus, Trash2, Download
} from "lucide-react";

/* ============================================================================
   ANALYTICS
   Meta Pixel und GA4 feuern erst NACH Einwilligung (Consent-Cookie).
   Ohne eingetragene IDs in CONFIG.tracking passiert schlicht nichts – kein Fehler.
   ========================================================================== */

const CONSENT_COOKIE = "vk_consent";

function leseConsent() {
  if (typeof document === "undefined") return null;
  const treffer = document.cookie.match(/(?:^|; )vk_consent=([^;]*)/);
  return treffer ? decodeURIComponent(treffer[1]) : null;
}

function setzeConsent(wert) {
  if (typeof document === "undefined") return;
  const einJahr = 60 * 60 * 24 * 365;
  document.cookie = `${CONSENT_COOKIE}=${wert}; max-age=${einJahr}; path=/; SameSite=Lax`;
}

/** Bindet fbevents.js erst nach Einwilligung ein – klassisches Stub-Pattern, keine Daten vor Consent. */
function ladeMetaPixel(pixelId) {
  if (typeof window === "undefined" || !pixelId || window.fbq) return;
  window.fbq = function () { (window.fbq.q = window.fbq.q || []).push(arguments); };
  window.fbq.loaded = true;
  window.fbq.version = "2.0";
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);
  window.fbq("init", pixelId);
  window.fbq("track", "PageView");
}

function ladeGA4(measurementId) {
  if (typeof window === "undefined" || !measurementId || window.gtag) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(script);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", measurementId);
}

function aktiviereTracking() {
  ladeMetaPixel(CONFIG.tracking.metaPixelId);
  ladeGA4(CONFIG.tracking.ga4Id);
}

/** Allgemeines Event – für Trichter-Schritte (Quiz-Fortschritt, WhatsApp-Klick etc.). */
function trackEvent(name, params = {}) {
  if (leseConsent() !== "granted") return;
  if (typeof window.fbq === "function") window.fbq("trackCustom", name, params);
  if (typeof window.gtag === "function") window.gtag("event", name, params);
}

/** Das Conversion-Event: löst bei Meta das Standard-Event "Lead" aus (für Kampagnenoptimierung). */
function trackLead(params = {}) {
  if (leseConsent() !== "granted") return;
  if (typeof window.fbq === "function") window.fbq("track", "Lead", params);
  if (typeof window.gtag === "function") window.gtag("event", "generate_lead", params);
}

/** Baut den wa.me-Link mit vorausgefüllter Nachricht aus CONFIG.kontakt. */
function waLink(text = CONFIG.kontakt.whatsappText) {
  return `https://wa.me/${CONFIG.kontakt.whatsappNummer}?text=${encodeURIComponent(text)}`;
}

/**
 * Die Tabelle "leads" hat eigene Spalten für die wichtigsten Felder
 * (id, erstellt_am, vorname, nachname, telefon, email, termin, vollstaendig,
 * crm_status, notiz_verlauf, selbstauskunft, selbstauskunft_eingereicht_am)
 * plus eine Sammel-Spalte "antworten" (jsonb) für alle übrigen Quiz-Antworten
 * (ziele, alter, brutto, eigenkapital, sparrate, zielrente, …). Im Rest der
 * App wird ein Lead aber als EIN flaches Objekt behandelt (lead.brutto,
 * lead.crmStatus, …) – leadZuZeile()/zeileZuLead() übersetzen zwischen
 * beiden Formen, damit an den ganzen Aufrufstellen (Quiz, Telefon-Gate,
 * CRM, Selbstauskunft) nichts geändert werden muss.
 *
 * Zugriffsmodell (wichtig für die Sicherheit echter Kundendaten):
 * - INSERT/UPDATE bleiben für jeden offen (anon), weil der öffentliche
 *   Funnel und die Selbstauskunft-Seite ohne Login schreiben müssen.
 * - Die komplette Liste lesen (SELECT auf die Tabelle) und Löschen sind in
 *   Supabase per Row-Level-Security auf eingeloggte Nutzer (authenticated)
 *   beschränkt – dafür wird beim CRM-Login ein accessToken erzeugt und hier
 *   durchgereicht. Ohne Token nutzen alle Aufrufe den öffentlichen anon-Key.
 * - Einen einzelnen Datensatz per bekannter ID nachschlagen (fürs Merge beim
 *   Speichern und für die Selbstauskunft-Vorbefüllung) läuft über eine
 *   eigene Datenbank-Funktion (RPC), die absichtlich NUR die eine ID
 *   zurückgibt – so kann niemand mit dem öffentlichen Schlüssel die ganze
 *   Tabelle auf einmal abziehen, aber der legitime "meinen eigenen
 *   Datensatz nachladen"-Fall funktioniert weiterhin ohne Login.
 */
// Zuordnung Lead-Objekt-Feld (camelCase, im Rest der App genutzt) zu echtem
// Spaltennamen (snake_case, wie in Supabase angelegt). Alles, was hier NICHT
// drinsteht, landet gesammelt in der jsonb-Spalte "antworten".
const LEAD_SPALTEN = {
  id: "id", erstelltAm: "erstellt_am", vorname: "vorname", nachname: "nachname",
  telefon: "telefon", email: "email", termin: "termin", vollstaendig: "vollstaendig",
  crmStatus: "crm_status", notizVerlauf: "notiz_verlauf",
  selbstauskunft: "selbstauskunft", selbstauskunftEingereichtAm: "selbstauskunft_eingereicht_am",
  analyse: "analyse", analyseAktualisiertAm: "analyse_aktualisiert_am",
};

/** Flaches Lead-Objekt (wie es die App überall nutzt) → Tabellenzeile mit
 * echten Spaltennamen für den Supabase-Request. */
function leadZuZeile(lead) {
  const zeile = {};
  const antworten = {};
  for (const [feld, wert] of Object.entries(lead)) {
    if (feld in LEAD_SPALTEN) zeile[LEAD_SPALTEN[feld]] = wert;
    else antworten[feld] = wert;
  }
  zeile.antworten = antworten;
  return zeile;
}

/** Tabellenzeile aus Supabase → flaches Lead-Objekt für die App. */
function zeileZuLead(zeile) {
  const lead = {};
  for (const [feld, spalte] of Object.entries(LEAD_SPALTEN)) lead[feld] = zeile[spalte];
  return { ...lead, ...(zeile.antworten || {}) };
}

// Als Funktion statt festem Objekt, damit CONFIG zum Zeitpunkt des Aufrufs
// garantiert schon vollständig ausgewertet ist (CONFIG steht im Code weiter
// unten als diese Datei-Sektion hier).
function supabaseHeaders(accessToken) {
  return {
    apikey: CONFIG.supabase.anonKey,
    Authorization: `Bearer ${accessToken || CONFIG.supabase.anonKey}`,
    "Content-Type": "application/json",
  };
}

/** Meldet Philipp (oder einen Mitarbeiter) per E-Mail/Passwort über Supabase
 * Auth an. Gibt bei Erfolg das Access-Token für die CRM-Session zurück, sonst
 * null. Das Token bleibt bewusst nur im React-State (kein localStorage) –
 * nach einem Neuladen der Seite ist eine erneute Anmeldung nötig, was für
 * ein internes Werkzeug ein akzeptabler Kompromiss ist. */
async function supabaseAnmelden(email, passwort) {
  try {
    const res = await fetch(`${CONFIG.supabase.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: CONFIG.supabase.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: passwort }),
    });
    if (!res.ok) return null;
    const daten = await res.json();
    return daten.access_token || null;
  } catch (e) {
    console.error("Anmeldung fehlgeschlagen", e);
    return null;
  }
}

/** Lädt genau einen Lead per bekannter ID über die sichere RPC-Funktion
 * lead_by_id – funktioniert ohne Login, gibt aber (anders als ein direktes
 * SELECT) niemals mehr als den einen angefragten Datensatz zurück. */
async function holeLeadPerId(id, accessToken) {
  try {
    const res = await fetch(`${CONFIG.supabase.url}/rest/v1/rpc/lead_by_id`, {
      method: "POST",
      headers: supabaseHeaders(accessToken),
      body: JSON.stringify({ such_id: id }),
    });
    if (!res.ok) return null;
    const zeilen = await res.json();
    if (!zeilen || !zeilen.length) return null;
    return zeileZuLead(zeilen[0]);
  } catch (e) {
    console.error("Lead-Nachschlagen fehlgeschlagen", e);
    return null;
  }
}

async function ladeLeads(accessToken) {
  try {
    const res = await fetch(`${CONFIG.supabase.url}/rest/v1/leads?select=*`, {
      headers: supabaseHeaders(accessToken),
    });
    if (!res.ok) { console.error("Leads laden fehlgeschlagen", res.status, await res.text()); return []; }
    const zeilen = await res.json();
    return zeilen.map(zeileZuLead);
  } catch (e) {
    console.error("Leads konnten nicht geladen werden", e);
    return [];
  }
}

async function speichereLead(patch, accessToken) {
  try {
    // Bestehenden Datensatz per sicherer Einzel-ID-Abfrage holen, um die
    // Teil-Aktualisierung reinzumergen – dasselbe Upsert-Verhalten wie
    // zuvor (z. B. Telefon-Gate legt an, KontaktFormular ergänzt später
    // E-Mail, ohne Ziele/Einkommen zu verlieren), nur ohne offenes SELECT.
    const bisher = await holeLeadPerId(patch.id, accessToken);
    const neu = { ...(bisher || {}), ...patch };

    const schreibRes = await fetch(`${CONFIG.supabase.url}/rest/v1/leads?on_conflict=id`, {
      method: "POST",
      headers: { ...supabaseHeaders(accessToken), Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify([leadZuZeile(neu)]),
    });
    if (!schreibRes.ok) { console.error("Lead speichern fehlgeschlagen", schreibRes.status, await schreibRes.text()); return null; }
    return neu;
  } catch (e) {
    console.error("Lead konnte nicht gespeichert werden", e);
    return null;
  }
}

async function loescheLead(id, accessToken) {
  try {
    const res = await fetch(`${CONFIG.supabase.url}/rest/v1/leads?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: supabaseHeaders(accessToken),
    });
    if (!res.ok) { console.error("Lead löschen fehlgeschlagen", res.status, await res.text()); return null; }
    return true;
  } catch (e) {
    console.error("Lead konnte nicht gelöscht werden", e);
    return null;
  }
}

/** Baut einen Beispiel-Lead mit denselben Feldern wie ein echter Funnel-Durchlauf –
 * zum Testen der CRM-Ansicht, bevor die ersten echten Leads eintreffen. */
function beispielLead() {
  const id = `beispiel-${Date.now()}`;
  const jetzt = Date.now();
  return {
    id, erstelltAm: new Date(jetzt - 5 * 86400000).toISOString(),
    vorname: "Max", nachname: "Mustermann", telefon: "0157 12345678",
    email: "max.mustermann@example.com", termin: "Nachmittags", vollstaendig: true,
    ziele: ["Passive Einnahmen", "Steuern optimieren"],
    alter: 34, status: "angestellt", brutto: 68000,
    eigenkapital: 25000, sparrate: 650,
    hatImmobilien: false, immobilien: 0,
    zielrente: 5500, zeitpunkt: "6monate",
    crmStatus: "strategiegespraech",
    notizVerlauf: [
      { id: "b2", text: "Objekt in Aussicht gestellt, wartet noch auf Rückmeldung von seiner Bank zur Finanzierungsbestätigung.", datum: new Date(jetzt - 1 * 86400000).toISOString() },
      { id: "b1", text: "Strategiegespräch geführt – sehr interessiert, sucht Kapitalanlage mit Fokus auf Steuervorteil. Beispiel-Lead zum Testen, kann jederzeit gelöscht werden.", datum: new Date(jetzt - 4 * 86400000).toISOString() },
    ],
  };
}

/** true, sobald das Element nach oben aus dem Bild gescrollt wurde; false, sobald es wieder sichtbar ist. */
function useScrolledPast(ref) {
  const [vorbei, setVorbei] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setVorbei(false);
      else if (entry.boundingClientRect.top < 0) setVorbei(true);
    }, { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return vorbei;
}

/** Fixierte CTA-Leiste – erscheint, sobald der Score gescrollt ist, verschwindet, sobald der echte CTA im Bild ist. */
function StickyCTA({ sichtbar, onClick }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40" style={{
      paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)",
      opacity: sichtbar ? 1 : 0,
      transform: sichtbar ? "translateY(0)" : "translateY(16px)",
      transition: "opacity .35s cubic-bezier(.16,1,.3,1), transform .35s cubic-bezier(.16,1,.3,1)",
      pointerEvents: sichtbar ? "auto" : "none",
    }}>
      <div className="px-5 pt-10 flex justify-center" style={{ background: `linear-gradient(to top, ${INK} 55%, transparent)` }}>
        <GoldButton compact onClick={onClick}>
          Termin sichern <ChevronRight size={15} />
        </GoldButton>
      </div>
    </div>
  );
}

function ConsentBanner() {
  const [status, setStatus] = useState(() => leseConsent());

  useEffect(() => { if (status === "granted") aktiviereTracking(); }, [status]);
  if (status) return null;

  const entscheiden = (wert) => { setzeConsent(wert); setStatus(wert); };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}>
      <div className="max-w-xl mx-auto rounded-2xl p-4 backdrop-blur-xl" style={{ background: "#141416", border: `1px solid ${HAIRLINE}`, boxShadow: "0 12px 40px rgba(0,0,0,0.6)" }}>
        <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>
          Wir verwenden Cookies für Analyse und Marketing, um dieses Angebot zu verbessern.
        </p>
        <div className="flex gap-2 mt-3">
          <button onClick={() => entscheiden("denied")} className="flex-1 rounded-xl py-2.5 text-sm"
            style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)", border: `1px solid ${HAIRLINE}` }}>
            Ablehnen
          </button>
          <button onClick={() => entscheiden("granted")} className="flex-1 rounded-xl py-2.5 text-sm font-medium"
            style={{ background: GOLD, color: "#15130B" }}>
            Akzeptieren
          </button>
        </div>
      </div>
    </div>
  );
}

/** Bleibt true, solange das beobachtete Element im Viewport sichtbar ist (im Gegensatz zu Reveal, das nur einmal feuert). */
function useSichtbarkeit(ref) {
  const [sichtbar, setSichtbar] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setSichtbar(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return sichtbar;
}

/* ============================================================================
   VERMÖGENSKOMPASS
   Alle Annahmen zentral in CONFIG. Alles darunter rechnet nur damit.
   ========================================================================== */

const CONFIG = {
  // Echte, von window.storage unabhängige Datenbank für Leads/CRM/Selbstauskunft.
  // Funktioniert auf jeder echten Website, nicht nur innerhalb von Claude.
  supabase: {
    url: "https://pxqtjmymrtytqwsvzhlr.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4cXRqbXltcnR5dHF3c3Z6aGxyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NDIxMTcsImV4cCI6MjEwMTUxODExN30.jlG1uV5Cr3cgNhWVpYyZM_pR9YgN1C5MLr4YdXxHxVs",
  },
  objekt: {
    kaufpreisOptionen: [200000, 300000, 400000, 500000],
    kaufpreisDefault: 250000,
    // Auf 0 gesetzt: Kaufnebenkosten werden i. d. R. mitfinanziert, sollen die
    // Nettovermögens-Rechnung daher nicht künstlich mit einem Startdefizit belasten.
    kaufnebenkostenQuote: 0,
    gebaeudeanteil: 0.80,
    afaSatz: 0.04,
    afaDauerJahre: 25,
    bruttomietrendite: 0.047,
    nichtUmlagefaehigMonat: 100,
    mietsteigerung: 0.02,
  },
  finanzierung: {
    sollzins: 0.045,
    anfangstilgung: 0.015,
  },
  projektion: {
    wertsteigerung: 0.02,
    szenarien: { konservativ: 0.0, standard: 0.02, optimistisch: 0.03 }, // aktuell ungenutzt, nur Referenz – siehe wertsteigerung oben
    betrachtungJahre: 20,
    horizontJahre: 30,
  },
  // Vergleichsrechnung auf der Startseite
  vergleich: {
    startkapital: 20000,
    jahre: 10,
    sparzins: 0.02,
    sparLabel: "Tagesgeld",
    aktienzins: 0.06,
    aktienLabel: "ETF",
    bruttoReferenz: 60000,     // Nur noch für die Anzeigetexte relevant, der Steuersatz selbst ist fest
    statusReferenz: "angestellt",
    steuersatzFix: 0.42,       // Bewusst fest statt aus bruttoReferenz berechnet – 42% ist der auf der Startseite gewünschte Vergleichswert
  },
  // Einkommensteuer-Tarif 2025 (§32a EStG), Grundtarif
  steuer: {
    grundfreibetrag: 12096,
    zone2Ende: 17443,
    zone3Ende: 68480,
    zone4Ende: 277825,
    soliFreigrenze: 19950,
    soliSatz: 0.055,
    soliMilderung: 0.119,
    werbungskostenPauschale: 1230,
    sonderausgabenPauschale: 36,
    bbgRentenversicherung: 96600,
    bbgKranken: 66150,
  },
  // Personenmarke – erscheint auf der Startseite und im Ergebnis-CTA
  marke: {
    name: "Philipp Streib",
    firma: "Wohnblick Immobilien",
    erfahrungText: "6+ Jahre Erfahrung im Immobilienmarkt",
  },
  // WhatsApp-Kontakt: Nummer im Format Ländervorwahl+Nummer, ohne '+' und ohne Leerzeichen
  kontakt: {
    whatsappNummer: "4915787606321",
    whatsappText: "Hallo, ich habe Interesse am Kauf einer Kapitalanlage.",
  },
  // Tracking: IDs eintragen, sonst bleiben die Aufrufe wirkungslos (kein Fehler)
  tracking: {
    metaPixelId: "",   // z. B. "1234567890123456"
    ga4Id: "",         // z. B. "G-XXXXXXXXXX"
  },
  // Wie viele Jahre "Warten" für die Kosten-des-Zuwartens-Zeile verglichen werden
  zuwarten: { jahre: 3 },
  // Portfolio-Teaser direkt nach dem Quiz: wie viele gleichartige Objekte,
  // in welchem Abstand gekauft – rein illustrativ, jedes Objekt braucht
  // erneut eigenes Eigenkapital.
  // Kaufplan auf der Auswertungsseite: alle benötigten Objekte innerhalb
  // dieses Zeitraums, so früh wie möglich, gleichmäßig verteilt – Volumen
  // schnell sichern, statt über Jahrzehnte zu strecken.
  kaufplan: { zielzeitraum: 5 },
  // Echte Kundenstimmen eintragen (Vorname + Anfangsbuchstabe, Rolle/Ort genügt).
  // WICHTIG: Nur echte Zitate. Erfundene Bewertungen sind nach Anh. Nr. 23b UWG
  // eine "Schwarze-Liste"-Praxis – immer unzulässig, unabhängig vom Einzelfall.
  // Bleibt das Array leer, wird der Abschnitt schlicht nicht angezeigt.
  testimonials: [
    { name: "Mark R.", text: "Als ich mich an Philipp gewandt habe, war der Kauf einer vermieteten Immobilie für mich noch komplettes Neuland. Besonders positiv fand ich, dass er sich zunächst viel Zeit genommen hat, meine Ziele und meine finanzielle Situation zu verstehen.\n\nDie Immobilie wurde **nicht schöngerechnet**, sondern inklusive Finanzierung, laufender Kosten und möglicher Risiken transparent erklärt. Auch bei meinen vielen Rückfragen hatte ich nie das Gefühl, unter Druck gesetzt zu werden.\n\nWährend des gesamten Kaufprozesses war Philipp gut erreichbar und hat die einzelnen Schritte verständlich begleitet. Dadurch konnte ich meine Entscheidung mit einem wirklich guten Gefühl treffen. Rückblickend bin ich mit der Zusammenarbeit und meiner **ersten Kapitalanlage sehr zufrieden**." },
    { name: "Thomas B.", text: "Für mich war lange nicht klar, ob ich mein Geld weiterhin überwiegend in Aktien und ETFs investieren oder zusätzlich eine vermietete Immobilie kaufen sollte.\n\nDurch die Gespräche mit Philipp habe ich verstanden, dass Immobilien für meine persönliche Situation **einen ganz anderen Hebel ermöglichen**, weil ich nicht nur mit meinem eigenen Kapital arbeite, sondern zusätzlich Finanzierung und Mieteinnahmen einbeziehe. Dadurch kann die Rendite auf das tatsächlich eingesetzte Eigenkapital deutlich interessanter ausfallen – natürlich immer abhängig vom Objekt und von der Finanzierung.\n\nBesonders wichtig war mir, **langfristig Vermögen aufzubauen** und gleichzeitig meine Altersvorsorge breiter aufzustellen. Philipp hat mir die Unterschiede zu anderen Anlageformen nachvollziehbar erklärt, ohne Aktien oder ETFs grundsätzlich schlechtzureden.\n\nDie Immobilie wurde mit allen Kosten, Chancen und Risiken transparent durchgerechnet. Für meine Ziele war der Kauf deshalb **der richtige Schritt**, und ich bin froh, ihn gemeinsam mit Philipp umgesetzt zu haben." },
    { name: "Sarah S.", text: "Rückblickend war für mich die wichtigste Erkenntnis, dass bei Immobilien nicht nur das richtige Objekt zählt, sondern auch **der Zeitpunkt**. Jedes weitere Jahr, in dem man nur sucht und nicht investiert, ist schließlich auch ein Jahr ohne Mieteinnahmen, Tilgung und möglichen Vermögensaufbau.\n\nIch hätte vermutlich noch mehrere Jahre auf ImmoScout vergleichen können, ohne wirklich sicher zu wissen, ob ich am Ende ein besseres Objekt finde. Bei Philipp hatte ich dagegen von Anfang an das Gefühl, dass die Immobilie **zu meiner finanziellen Situation und meinen langfristigen Zielen** ausgewählt wurde.\n\nAlle Zahlen, laufenden Kosten und auch die Risiken wurden offen und verständlich erklärt. Deshalb war es für mich sinnvoller, mit professioneller Begleitung eine fundierte Entscheidung zu treffen, statt jahrelang auf das vermeintlich perfekte Angebot zu warten.\n\nHeute bin ich froh, den Schritt gemacht zu haben, und würde bei der nächsten Kapitalanlage **wieder mit Philipp zusammenarbeiten**." },
  ],
  // Kurze Bewertungskarten ganz unten auf der Startseite. Gleiche Regel wie oben:
  // nur echte Bewertungen, sonst zeigt sich der Abschnitt gar nicht erst.
  //
  // ACHTUNG: Die drei Einträge unten sind PLATZHALTER zur Voransicht des Layouts.
  // Vor dem Livegang durch echte Bewertungen ersetzen oder das Array leeren –
  // erfundene Bewertungen sind nach Anh. Nr. 23b UWG nicht zulässig.
  bewertungen: [
    { name: "Mark R.", sterne: 5, kurz: "Während des gesamten Kaufprozesses war Philipp gut erreichbar und hat die einzelnen Schritte verständlich begleitet. Dadurch konnte ich meine Entscheidung mit einem wirklich guten Gefühl treffen. Rückblickend bin ich mit der Zusammenarbeit und meiner ersten Kapitalanlage sehr zufrieden.", text: "Als ich mich an Philipp gewandt habe, war der Kauf einer vermieteten Immobilie für mich noch komplettes Neuland. Besonders positiv fand ich, dass er sich zunächst viel Zeit genommen hat, meine Ziele und meine finanzielle Situation zu verstehen.\n\nDie Immobilie wurde **nicht schöngerechnet**, sondern inklusive Finanzierung, laufender Kosten und möglicher Risiken transparent erklärt. Auch bei meinen vielen Rückfragen hatte ich nie das Gefühl, unter Druck gesetzt zu werden.\n\nWährend des gesamten Kaufprozesses war Philipp gut erreichbar und hat die einzelnen Schritte verständlich begleitet. Dadurch konnte ich meine Entscheidung mit einem wirklich guten Gefühl treffen. Rückblickend bin ich mit der Zusammenarbeit und meiner **ersten Kapitalanlage sehr zufrieden**." },
    { name: "Thomas B.", sterne: 5, kurz: "Besonders wichtig war mir, langfristig Vermögen aufzubauen und gleichzeitig meine Altersvorsorge breiter aufzustellen. Philipp hat mir die Unterschiede zu anderen Anlageformen nachvollziehbar erklärt, ohne Aktien oder ETFs grundsätzlich schlechtzureden. Die Immobilie wurde mit allen Kosten, Chancen und Risiken transparent durchgerechnet. Für meine Ziele war der Kauf deshalb der richtige Schritt, und ich bin froh, ihn gemeinsam mit Philipp umgesetzt zu haben.", text: "Für mich war lange nicht klar, ob ich mein Geld weiterhin überwiegend in Aktien und ETFs investieren oder zusätzlich eine vermietete Immobilie kaufen sollte.\n\nDurch die Gespräche mit Philipp habe ich verstanden, dass Immobilien für meine persönliche Situation **einen ganz anderen Hebel ermöglichen**, weil ich nicht nur mit meinem eigenen Kapital arbeite, sondern zusätzlich Finanzierung und Mieteinnahmen einbeziehe. Dadurch kann die Rendite auf das tatsächlich eingesetzte Eigenkapital deutlich interessanter ausfallen – natürlich immer abhängig vom Objekt und von der Finanzierung.\n\nBesonders wichtig war mir, **langfristig Vermögen aufzubauen** und gleichzeitig meine Altersvorsorge breiter aufzustellen. Philipp hat mir die Unterschiede zu anderen Anlageformen nachvollziehbar erklärt, ohne Aktien oder ETFs grundsätzlich schlechtzureden.\n\nDie Immobilie wurde mit allen Kosten, Chancen und Risiken transparent durchgerechnet. Für meine Ziele war der Kauf deshalb **der richtige Schritt**, und ich bin froh, ihn gemeinsam mit Philipp umgesetzt zu haben." },
    { name: "Sarah S.", sterne: 5, kurz: "Alle Zahlen, laufenden Kosten und auch die Risiken wurden offen und verständlich erklärt. Deshalb war es für mich sinnvoller, mit professioneller Begleitung eine fundierte Entscheidung zu treffen, statt jahrelang auf das vermeintlich perfekte Angebot zu warten. Heute bin ich froh, den Schritt gemacht zu haben, und würde bei der nächsten Kapitalanlage wieder mit Philipp zusammenarbeiten.", text: "Rückblickend war für mich die wichtigste Erkenntnis, dass bei Immobilien nicht nur das richtige Objekt zählt, sondern auch **der Zeitpunkt**. Jedes weitere Jahr, in dem man nur sucht und nicht investiert, ist schließlich auch ein Jahr ohne Mieteinnahmen, Tilgung und möglichen Vermögensaufbau.\n\nIch hätte vermutlich noch mehrere Jahre auf ImmoScout vergleichen können, ohne wirklich sicher zu wissen, ob ich am Ende ein besseres Objekt finde. Bei Philipp hatte ich dagegen von Anfang an das Gefühl, dass die Immobilie **zu meiner finanziellen Situation und meinen langfristigen Zielen** ausgewählt wurde.\n\nAlle Zahlen, laufenden Kosten und auch die Risiken wurden offen und verständlich erklärt. Deshalb war es für mich sinnvoller, mit professioneller Begleitung eine fundierte Entscheidung zu treffen, statt jahrelang auf das vermeintlich perfekte Angebot zu warten.\n\nHeute bin ich froh, den Schritt gemacht zu haben, und würde bei der nächsten Kapitalanlage **wieder mit Philipp zusammenarbeiten**." },
  ],
  impressum: {
    name: "Philipp Streib",
    firma: "Wohnblick Immobilien – Inh. Philipp Streib",
    strasse: "Grubenstr. 21",
    ort: "74858 Aglasterhausen",
    telefon: "0151 28960764",
    email: "info@wohnblick-immobilien.de",
    ustId: "DE314926729",
    gewerbeDatum: "04.11.2021",
    gewerbeStelle: "IHK Rhein-Neckar, L1, 2, 68161 Mannheim",
    dsaEmail: "dsa@nextlevel-webdesign.de",
    dsaTelefon: "0176 80841685",
    dsaSprachen: "Deutsch, Englisch",
  },
};

const GOLD = "#C9A227";
const GOLD_SOFT = "#E3C46A";
const GREEN = "#34D399";
const INK = "#0A0A0B";
const CARD = "rgba(255,255,255,0.045)";
const HAIRLINE = "rgba(255,255,255,0.09)";

/* ---------------------------------------------------------------- Formatter */
const eur = (n, digits = 0) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(Number.isFinite(n) ? n : 0);

const eurK = (n) => {
  const v = Number.isFinite(n) ? n : 0;
  if (Math.abs(v) >= 1000000) return (v / 1000000).toFixed(1).replace(".", ",") + " Mio.";
  if (Math.abs(v) >= 1000) return Math.round(v / 1000) + "k";
  return Math.round(v).toString();
};

const pct = (n, digits = 0) =>
  new Intl.NumberFormat("de-DE", {
    style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(Number.isFinite(n) ? n : 0);

/* ------------------------------------------------------- Steuer: ESt-Tarif */
function einkommensteuer(zvE) {
  const S = CONFIG.steuer;
  const x = Math.max(0, Math.floor(zvE));
  if (x <= S.grundfreibetrag) return 0;
  if (x <= S.zone2Ende) {
    const y = (x - S.grundfreibetrag) / 10000;
    return (932.30 * y + 1400) * y;
  }
  if (x <= S.zone3Ende) {
    const z = (x - S.zone2Ende) / 10000;
    return (176.64 * z + 2397) * z + 1015.13;
  }
  if (x <= S.zone4Ende) return 0.42 * x - 10911.92;
  return 0.45 * x - 19246.67;
}

function soli(est) {
  const S = CONFIG.steuer;
  if (est <= S.soliFreigrenze) return 0;
  return Math.min(S.soliSatz * est, S.soliMilderung * (est - S.soliFreigrenze));
}

/**
 * Grobe Schätzung des zu versteuernden Einkommens aus dem Bruttoeinkommen.
 * Bewusst vereinfacht – jede Position ist eine Annahme, keine Steuerberechnung.
 */
function schaetzeZvE(brutto, status) {
  const S = CONFIG.steuer;
  const b = Math.max(0, brutto);
  const rvBasis = Math.min(b, S.bbgRentenversicherung);
  const kvBasis = Math.min(b, S.bbgKranken);
  let vorsorge = 0;
  let werbungskosten = 0;

  if (status === "angestellt") {
    // Rentenversicherung (abziehbar) + Basisanteil Kranken-/Pflegeversicherung
    vorsorge = rvBasis * 0.093 + kvBasis * 0.088;
    werbungskosten = S.werbungskostenPauschale;
  } else if (status === "beamter") {
    // keine Sozialabgaben, private Krankenversicherung
    vorsorge = kvBasis * 0.05;
    werbungskosten = S.werbungskostenPauschale;
  } else {
    // Selbstständig / Freiberuflich / Unternehmer: voller KV/PV-Beitrag + Altersvorsorge
    vorsorge = kvBasis * 0.16 + Math.min(b * 0.10, 15000);
    werbungskosten = 0;
  }
  return Math.max(0, b - vorsorge - werbungskosten - S.sonderausgabenPauschale);
}

/**
 * Grenzsteuersatz inkl. Solidaritätszuschlag.
 *
 * Der Soli wird bewusst mit der *effektiven* Quote der Person angesetzt, nicht
 * mit seinem Grenzwert. Grund: In der Milderungszone (§4 SolZG, ESt zwischen
 * ca. 19.950 € und 37.100 €) beträgt der marginale Soli 11,9 % der Mehrsteuer.
 * Rechnerisch ergibt das dort echte 42 % × 1,119 = 47,0 %. Das stimmt zwar,
 * ist aber gemessen an unserer groben zvE-Schätzung Scheingenauigkeit – und
 * ein Wert, den kein Nutzer glaubt. Mit der effektiven Quote landet man bei
 * den erwartbaren 42–44 % im oberen Bereich.
 */
function grenzsteuersatz(brutto, status) {
  const zvE = schaetzeZvE(brutto, status);
  const d = 100;
  const estGrenz = (einkommensteuer(zvE + d) - einkommensteuer(zvE)) / d;
  const est = einkommensteuer(zvE);
  const soliQuote = est > 0 ? soli(est) / est : 0;
  return Math.max(0, Math.min(0.475, estGrenz * (1 + soliQuote)));
}

/* ------------------------------------------------- Finanzierung: Annuität */
/**
 * Echter monatlicher Annuitätenplan. Keine lineare Näherung.
 * Rate = Darlehen * (Sollzins + Anfangstilgung) / 12, monatlich verzinst.
 */
function annuitaetenplan(darlehen, jahre, sollzinsOverride, anfangstilgungOverride) {
  const sollzins = sollzinsOverride ?? CONFIG.finanzierung.sollzins;
  const anfangstilgung = anfangstilgungOverride ?? CONFIG.finanzierung.anfangstilgung;
  const iM = sollzins / 12;
  const rateM = (darlehen * (sollzins + anfangstilgung)) / 12;
  let rest = darlehen;
  const jahresreihe = [];

  for (let j = 1; j <= jahre; j++) {
    let zinsen = 0, tilgung = 0, gezahlt = 0;
    for (let m = 0; m < 12; m++) {
      if (rest <= 0) break;
      const z = rest * iM;
      let t = rateM - z;
      let zahlung = rateM;
      if (t >= rest) { t = rest; zahlung = z + t; }
      rest -= t;
      zinsen += z; tilgung += t; gezahlt += zahlung;
    }
    jahresreihe.push({
      jahr: j, zinsen, tilgung, annuitaet: gezahlt,
      restschuld: Math.max(0, rest),
    });
  }
  return { rateMonat: rateM, jahresreihe, laufzeitEnde: jahresreihe.findIndex(r => r.restschuld <= 0.5) + 1 };
}

/* ----------------------------------------------------- Projektionsmodell */
function berechneModell({
  kaufpreis, eigenkapitalEinsatz, steuersatz, wertsteigerung,
  // Optionale Overrides für die Objekt-Detailanalyse (Kunden-CRM). Ohne
  // Angabe greifen exakt wie bisher die CONFIG-Standardwerte – bestehende
  // Aufrufstellen (Funnel, Kaufplan, Zuwarten-Rechnung) bleiben dadurch
  // unverändert, nur die neue Detailanalyse nutzt objektspezifische Werte.
  kaufnebenkostenQuote, gebaeudeanteil, bruttomietrendite,
  nichtUmlagefaehigMonat, afaSatz, afaDauerJahre, mietsteigerung,
  sollzins, anfangstilgung, horizontJahre,
}) {
  const O = CONFIG.objekt;
  const _kaufnebenkostenQuote = kaufnebenkostenQuote ?? O.kaufnebenkostenQuote;
  const _gebaeudeanteil = gebaeudeanteil ?? O.gebaeudeanteil;
  const _bruttomietrendite = bruttomietrendite ?? O.bruttomietrendite;
  const _nichtUmlagefaehigMonat = nichtUmlagefaehigMonat ?? O.nichtUmlagefaehigMonat;
  const _afaSatz = afaSatz ?? O.afaSatz;
  const _afaDauerJahre = afaDauerJahre ?? O.afaDauerJahre;
  const _mietsteigerung = mietsteigerung ?? O.mietsteigerung;

  const nebenkosten = kaufpreis * _kaufnebenkostenQuote;
  const gesamtkosten = kaufpreis + nebenkosten;
  const ekEingesetzt = Math.min(Math.max(0, eigenkapitalEinsatz), gesamtkosten);
  const darlehen = Math.max(0, gesamtkosten - ekEingesetzt);

  // AfA-Bemessung: Gebäudeanteil an Kaufpreis inkl. anteiliger Nebenkosten
  const afaBasis = gesamtkosten * _gebaeudeanteil;
  const afaJahr = afaBasis * _afaSatz;

  const H = horizontJahre ?? CONFIG.projektion.horizontJahre;
  const { rateMonat, jahresreihe, laufzeitEnde } = annuitaetenplan(darlehen, H, sollzins, anfangstilgung);

  const reihe = [];
  let kumCfVorSteuer = 0, kumSteuerwirkung = 0, kumTilgung = 0;

  for (let j = 1; j <= H; j++) {
    const f = jahresreihe[j - 1];
    const kaltmiete = kaufpreis * _bruttomietrendite * Math.pow(1 + _mietsteigerung, j - 1);
    const nichtUml = _nichtUmlagefaehigMonat * 12;
    const afa = j <= _afaDauerJahre ? afaJahr : 0;

    const steuerErgebnis = kaltmiete - f.zinsen - afa - nichtUml;
    const steuerwirkung = -steuerErgebnis * steuersatz; // Verlust => Entlastung
    const cfVorSteuer = kaltmiete - f.annuitaet - nichtUml;
    const cfNachSteuer = cfVorSteuer + steuerwirkung;

    kumCfVorSteuer += cfVorSteuer;
    kumSteuerwirkung += steuerwirkung;
    kumTilgung += f.tilgung;

    const immobilienwert = kaufpreis * Math.pow(1 + wertsteigerung, j);
    const gebundenesEK = immobilienwert - f.restschuld;
    const nettovermoegen = gebundenesEK + kumCfVorSteuer + kumSteuerwirkung;

    reihe.push({
      jahr: j, kaltmiete, zinsen: f.zinsen, tilgung: f.tilgung, annuitaet: f.annuitaet,
      restschuld: f.restschuld, afa, steuerErgebnis, steuerwirkung,
      cfVorSteuer, cfNachSteuer, kumCfVorSteuer, kumSteuerwirkung, kumTilgung,
      immobilienwert, gebundenesEK, nettovermoegen,
      wertzuwachs: immobilienwert - kaufpreis,
    });
  }

  const j1 = reihe[0];
  const abbezahltNachJahren = laufzeitEnde > 0 ? laufzeitEnde : null;
  return {
    kaufpreis, nebenkosten, gesamtkosten, ekEingesetzt, darlehen,
    afaBasis, afaJahr, rateMonat, reihe, abbezahltNachJahren,
    monat: {
      kaltmiete: j1.kaltmiete / 12,
      rate: rateMonat,
      nichtUml: _nichtUmlagefaehigMonat,
      zinsen: j1.zinsen / 12,
      afa: j1.afa / 12,
      steuerErgebnis: j1.steuerErgebnis / 12,
      steuerwirkung: j1.steuerwirkung / 12,
      cfVorSteuer: j1.cfVorSteuer / 12,
      cfNachSteuer: j1.cfNachSteuer / 12,
    },
    stand: (jahr) => reihe[Math.min(reihe.length, Math.max(1, jahr)) - 1],
  };
}

/**
 * Kosten des Zuwartens, pro Jahr: derselbe Endpunkt, nur mit weniger Zeit zum Wachsen.
 * Wird sowohl im Telefon-Gate (mit Standardwerten) als auch auf der Ergebnisseite
 * (mit den vom Nutzer gewählten Werten) verwendet – eine Berechnung, ein Ergebnis.
 */
function schaetzeZuwartenProJahr(antworten, { kaufpreis = CONFIG.objekt.kaufpreisDefault, jahr = CONFIG.projektion.betrachtungJahre } = {}) {
  const zjahre = CONFIG.zuwarten.jahre;
  if (jahr <= zjahre) return null;
  const ekEinsatz = Math.min(antworten.eigenkapitalEinsatz, antworten.eigenkapital);
  const steuersatz = grenzsteuersatz(antworten.brutto, antworten.status || "angestellt");
  const modell = berechneModell({ kaufpreis, eigenkapitalEinsatz: ekEinsatz, steuersatz, wertsteigerung: CONFIG.projektion.wertsteigerung });
  const delta = modell.stand(jahr).nettovermoegen - modell.stand(jahr - zjahre).nettovermoegen;
  return Math.round(delta / zjahre);
}

/**
 * Wie viele Objekte für eine gewünschte monatliche Immobilienrente nötig
 * sind – mit der heutigen Mietrendite, ohne die über die Jahre eingerechnete
 * Mietsteigerung (die kommt separat als Bonus obendrauf, siehe Kaufplan).
 * Wichtig: die nicht umlagefähigen Kosten fallen PRO Objekt an, nicht einmal
 * pauschal fürs ganze Portfolio – deshalb wird die Rente eines einzelnen
 * Objekts berechnet und die Anzahl direkt daraus abgeleitet, statt zuerst
 * ein Gesamtvolumen zu bilden und das durch den Kaufpreis zu teilen. Der
 * zweite Weg hätte bei vielen Objekten die nötige Anzahl unterschätzt, weil
 * er die nicht umlagefähigen Kosten nur einmal statt pro Objekt abgezogen hätte.
 */
function schaetzeBenoetigteObjekte(zielRenteMonat) {
  if (!zielRenteMonat || zielRenteMonat <= 0) return 0;
  const O = CONFIG.objekt;
  const renteProObjekt = (O.kaufpreisDefault * O.bruttomietrendite) / 12 - O.nichtUmlagefaehigMonat;
  return Math.max(1, Math.ceil(zielRenteMonat / renteProObjekt));
}

/**
 * Baut die Liste der Kauf-Ereignisse für ein Zielrente-Portfolio: alle
 * benötigten Objekte, so früh wie möglich, gleichmäßig verteilt auf die
 * ersten CONFIG.kaufplan.zielzeitraum Jahre. Wird sowohl vom Score-Teaser
 * als auch vom Kaufplan auf der Auswertungsseite genutzt – eine Logik,
 * ein konsistentes Bild an beiden Stellen.
 */
function baueKaufplan(zielRenteMonat) {
  const kaufpreis = CONFIG.objekt.kaufpreisDefault;
  const n = schaetzeBenoetigteObjekte(zielRenteMonat);
  const volumen = n * kaufpreis;
  const proJahr = Math.max(1, Math.ceil(n / CONFIG.kaufplan.zielzeitraum));
  const objekte = [];
  let rest = n, jahr = 0;
  while (rest > 0) {
    const anzahl = Math.min(proJahr, rest);
    for (let i = 0; i < anzahl; i++) objekte.push({ jahr, kaufpreis });
    rest -= anzahl;
    jahr++;
  }
  return { volumen, objekte, gesamtanzahl: n, kaufpreis };
}

/**
 * Summiert das Nettovermögen mehrerer, versetzt gekaufter Objekte zu einem
 * gemeinsamen Zielhorizont. Objekte, die zu diesem Zeitpunkt noch nicht
 * gekauft wären, tragen nichts bei.
 */
function schaetzePortfolioNetto(objekte, steuersatz, zielhorizont) {
  let summe = 0;
  for (const o of objekte) {
    const gehalten = Math.min(zielhorizont - o.jahr, CONFIG.projektion.horizontJahre);
    if (gehalten < 1) continue;
    const m = berechneModell({
      kaufpreis: o.kaufpreis, eigenkapitalEinsatz: 0, steuersatz,
      wertsteigerung: CONFIG.projektion.wertsteigerung,
    });
    summe += m.stand(gehalten).nettovermoegen;
  }
  return summe;
}

/**
 * Die persönliche Sparrate auf drei Wegen: Tagesgeld, ETF, oder so viele
 * Immobilien, wie die monatliche Belastung eines einzelnen Objekts in diese
 * Sparrate passen – alle mit demselben Kapitaleinsatz. Bei der Immobilie wird
 * zusätzlich aufgeteilt, wie viel davon eigenes Geld ist und wie viel über
 * die Miete vom Mieter mitfinanziert wurde.
 */
function schaetzeSparratenHebel(zielrente, steuersatz, jahre) {
  const kaufpreis = CONFIG.objekt.kaufpreisDefault;
  const referenz = berechneModell({
    kaufpreis, eigenkapitalEinsatz: 0, steuersatz, wertsteigerung: CONFIG.projektion.wertsteigerung,
  });
  const belastungMonat = Math.max(1, Math.round(-referenz.monat.cfNachSteuer));
  // Dieselbe Objektanzahl wie im Kaufplan (aus der Zielrente abgeleitet, nicht
  // aus der Sparrate) – damit beide Screens immer dieselbe Zahl zeigen. Die
  // monatliche Rate für den Tagesgeld-/ETF-Vergleich ist die tatsächlich
  // nötige Belastung für genau diese Objektanzahl, kein separater Wert.
  const anzahl = schaetzeBenoetigteObjekte(zielrente);
  const monatlicheRate = anzahl * belastungMonat;

  const objekte = Array.from({ length: anzahl }, () => ({ jahr: 0, kaufpreis }));
  const immoGesamt = schaetzePortfolioNetto(objekte, steuersatz, jahre);
  const eigenerEinsatz = belastungMonat * anzahl * 12 * jahre;
  const geschenkt = Math.max(0, immoGesamt - eigenerEinsatz);

  const sparplanBis = (zins, bisJahr) => {
    let summe = 0;
    for (let j = 1; j <= bisJahr; j++) summe += monatlicheRate * 12 * Math.pow(1 + zins, bisJahr - j);
    return summe;
  };

  // Jahresverlauf für das Liniendiagramm – zeigt, wie die Schere zwischen den
  // drei Wegen über die Zeit aufgeht. Bewusst drei einfache Linien statt einer
  // gestapelten Fläche für die Immobilie: robust auch für den Fall, dass
  // Annahmen (z. B. Kaufnebenkosten) sich künftig ändern und der Wert
  // zeitweise negativ wird – eine einzelne Linie zeigt das dann ehrlich,
  // eine gestapelte Fläche aus "eigener Einsatz" + "vom Mieter" könnte das nicht.
  const verlauf = [{ jahr: 0, Tagesgeld: 0, ETF: 0, Immobilie: 0 }];
  for (let j = 1; j <= jahre; j++) {
    verlauf.push({
      jahr: j,
      Tagesgeld: sparplanBis(CONFIG.vergleich.sparzins, j),
      ETF: sparplanBis(CONFIG.vergleich.aktienzins, j),
      Immobilie: referenz.stand(j).nettovermoegen * anzahl,
    });
  }

  return {
    monatlicheRate,
    anzahl, belastungMonat, verlauf,
    tagesgeld: sparplanBis(CONFIG.vergleich.sparzins, jahre),
    etf: sparplanBis(CONFIG.vergleich.aktienzins, jahre),
    immoGesamt, eigenerEinsatz, geschenkt,
  };
}

/* =========================================================== UI-Bausteine */

function Card({ children, className = "", style = {} }) {
  return (
    <div
      className={"rounded-2xl backdrop-blur-xl " + className}
      style={{ background: CARD, border: `1px solid ${HAIRLINE}`, ...style }}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children }) {
  return (
    <div className="text-xs uppercase tracking-widest mb-3" style={{ color: GOLD, letterSpacing: "0.18em" }}>
      {children}
    </div>
  );
}

function GoldButton({ children, onClick, disabled, full, compact, glow }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-300 ${full ? "w-full" : ""} ${compact ? "px-5 py-2.5 text-sm" : "px-7 py-4 text-base"}`}
      style={{
        background: disabled ? "rgba(255,255,255,0.06)" : `linear-gradient(135deg, ${GOLD_SOFT}, ${GOLD})`,
        color: disabled ? "rgba(255,255,255,0.3)" : "#15130B",
        boxShadow: disabled ? "none" : "0 8px 30px rgba(201,162,39,0.22)",
        cursor: disabled ? "not-allowed" : "pointer",
        animation: glow && !disabled ? "vkAtem 2.8s ease-in-out infinite" : "none",
      }}
    >
      {children}
    </button>
  );
}

/**
 * Ein einziges Stylesheet für alle Slider – wird nur einmal gemountet.
 * Der Füllstand läuft über die CSS-Variable --vk-p, damit beim Ziehen
 * kein <style>-Block neu geparst wird. Das war die eigentliche Ruckelquelle.
 */
function GlobalStyles() {
  return (
    <style>{`
      html, body{margin:0;background:${INK};}
      .vk-range{-webkit-appearance:none;appearance:none;width:100%;height:30px;background:transparent;cursor:grab;touch-action:none;}
      .vk-range:active{cursor:grabbing;}
      .vk-range::-webkit-slider-runnable-track{height:5px;border-radius:99px;
        background:linear-gradient(90deg, ${GOLD_SOFT} 0%, ${GOLD} var(--vk-p), rgba(255,255,255,0.11) var(--vk-p), rgba(255,255,255,0.11) 100%);}
      .vk-range::-webkit-slider-thumb{-webkit-appearance:none;height:26px;width:26px;border-radius:99px;background:#fff;
        margin-top:-10.5px;box-shadow:0 3px 14px rgba(0,0,0,.65);border:2px solid ${GOLD};
        transition:transform .18s cubic-bezier(.16,1,.3,1), box-shadow .18s ease;}
      .vk-range:active::-webkit-slider-thumb{transform:scale(1.16);box-shadow:0 0 0 10px rgba(201,162,39,0.14), 0 3px 14px rgba(0,0,0,.65);}
      .vk-range::-moz-range-track{height:5px;border-radius:99px;background:rgba(255,255,255,0.11);}
      .vk-range::-moz-range-progress{height:5px;border-radius:99px;background:${GOLD};}
      .vk-range::-moz-range-thumb{height:24px;width:24px;border-radius:99px;background:#fff;border:2px solid ${GOLD};
        transition:transform .18s cubic-bezier(.16,1,.3,1);}
      .vk-range:active::-moz-range-thumb{transform:scale(1.16);}
      .vk-range:focus-visible{outline:2px solid ${GOLD_SOFT};outline-offset:6px;border-radius:99px;}
      @keyframes vkIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
      @keyframes vkSpin{to{transform:rotate(360deg)}}
      @keyframes vkPuls{0%{transform:scale(1);opacity:.55}100%{transform:scale(1.28);opacity:0}}
      @keyframes vkAtem{0%,100%{box-shadow:0 8px 30px rgba(201,162,39,0.22)}50%{box-shadow:0 8px 40px rgba(201,162,39,0.42)}}
      @keyframes vkBalken{from{width:0}}
      @keyframes vkGlanz{0%{opacity:0}22%{opacity:1}100%{opacity:0}}
      @media (prefers-reduced-motion: reduce){*{animation-duration:.01ms !important;transition-duration:.01ms !important;}}
    `}</style>
  );
}

/**
 * Zahl läuft dem Zielwert exponentiell hinterher (rAF, kein Re-Render-Sturm).
 * Erzeugt beim Ziehen das weiche Hochzählen statt harter Sprünge.
 */
/** Zählt beim Erscheinen einmalig von 0 auf den Zielwert hoch. */
function useZaehler(ziel, { dauer = 1600, delay = 0, aktiv = true } = {}) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!aktiv) return;
    let raf = null, start = null;
    const ease = (t) => 1 - Math.pow(2, -10 * t);
    const tick = (ts) => {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / dauer);
      setV(ziel * ease(t));
      if (t < 1) raf = requestAnimationFrame(tick);
      else setV(ziel);
    };
    const id = setTimeout(() => { raf = requestAnimationFrame(tick); }, delay);
    return () => { clearTimeout(id); if (raf) cancelAnimationFrame(raf); };
  }, [ziel, dauer, delay, aktiv]);
  return v;
}

function useSmoothNumbers(ziele, geschwindigkeit = 0.22) {
  const [werte, setWerte] = useState(ziele);
  const ref = useRef(ziele);
  const raf = useRef(null);
  const key = ziele.join("|");

  useEffect(() => {
    const tick = () => {
      let fertig = true;
      const naechste = ziele.map((z, i) => {
        const akt = ref.current[i] ?? z;
        const diff = z - akt;
        if (Math.abs(diff) < Math.max(0.5, Math.abs(z) * 0.0004)) return z;
        fertig = false;
        return akt + diff * geschwindigkeit;
      });
      ref.current = naechste;
      setWerte(naechste);
      raf.current = fertig ? null : requestAnimationFrame(tick);
    };
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, geschwindigkeit]);

  return werte;
}

/**
 * `kurve` verbiegt die Skala: Position t (0..1) -> Wert = min + (max-min) * t^kurve.
 * Bei kurve=3.2 liegt die Mitte des Wegs bei ca. 60.000 € statt bei 165.000 €.
 *
 * `mitte` ist die Alternative, wenn ein bestimmter Wert exakt auf 50 % des Wegs
 * sitzen soll: zwei linear zusammengesetzte Strecken (min→mitte, mitte→max),
 * je über die halbe Reglerlänge. Eine reine Potenzkurve kann das nicht leisten –
 * verschiebt man mit ihr den unteren Bereich, verschiebt sich die Mitte mit.
 * `kurve` und `mitte` schließen sich gegenseitig aus; `mitte` hat Vorrang.
 */
function Slider({ value, min, max, step, onChange, format, marken, kompakt, kurve, mitte }) {
  const zuT = (v) => {
    if (mitte != null) {
      return v <= mitte
        ? 0.5 * (v - min) / (mitte - min)
        : 0.5 + 0.5 * (v - mitte) / (max - mitte);
    }
    const roh = (v - min) / (max - min);
    return kurve ? Math.pow(Math.max(0, roh), 1 / kurve) : roh;
  };
  const zuWert = (t) => {
    if (mitte != null) {
      const v = t <= 0.5 ? min + (t / 0.5) * (mitte - min) : mitte + ((t - 0.5) / 0.5) * (max - mitte);
      return Math.min(max, Math.max(min, Math.round(v / step) * step));
    }
    const roh = kurve ? Math.pow(t, kurve) : t;
    const v = min + (max - min) * roh;
    return Math.min(max, Math.max(min, Math.round(v / step) * step));
  };

  const verbogen = !!kurve || mitte != null;
  const t = Math.min(1, Math.max(0, zuT(value)));
  const p = t * 100;

  return (
    <div>
      {!kompakt && (
        <div className="text-3xl md:text-4xl font-semibold tabular-nums mb-5" style={{ color: "#fff" }}>
          {format(value)}
        </div>
      )}
      <input
        type="range"
        min={verbogen ? 0 : min}
        max={verbogen ? 1000 : max}
        step={verbogen ? 1 : step}
        value={verbogen ? Math.round(t * 1000) : value}
        onChange={(e) => onChange(verbogen ? zuWert(Number(e.target.value) / 1000) : Number(e.target.value))}
        className="vk-range"
        style={{ "--vk-p": p + "%" }}
      />
      {marken ? (
        <div className="flex justify-between text-xs mt-1 tabular-nums" style={{ color: "rgba(255,255,255,0.3)" }}>
          {marken.map((mk) => (
            <button key={mk} onClick={() => onChange(mk)} className="px-1 py-1 -mx-1 transition-colors"
              style={{ color: Math.abs(value - mk) < (step ?? 1) / 2 ? GOLD_SOFT : "rgba(255,255,255,0.3)" }}>
              {format(mk)}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex justify-between text-xs mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>
          <span>{format(min)}</span><span>{format(max)}</span>
        </div>
      )}
    </div>
  );
}

/** Zeigt an, dass dieser Abschnitt zu einem der in Frage 1 gewählten Ziele passt. */
function ZielBadge({ text }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium mb-4"
      style={{ background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.35)", color: GREEN }}>
      <Check size={11} strokeWidth={3} />
      {text}
    </div>
  );
}

function Option({ selected, onClick, children, multi }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl px-5 py-4 flex items-center justify-between gap-3 transition-all duration-200"
      style={{
        background: selected ? "rgba(201,162,39,0.10)" : "rgba(255,255,255,0.035)",
        border: `1px solid ${selected ? "rgba(201,162,39,0.55)" : HAIRLINE}`,
        color: "#fff",
      }}
    >
      <span className="text-base">{children}</span>
      <span
        className="flex items-center justify-center shrink-0 transition-all duration-200"
        style={{
          width: 22, height: 22, borderRadius: multi ? 6 : 99,
          border: `1px solid ${selected ? GOLD : "rgba(255,255,255,0.2)"}`,
          background: selected ? GOLD : "transparent",
        }}
      >
        {selected && <Check size={13} strokeWidth={3} color="#15130B" />}
      </span>
    </button>
  );
}

function Stat({ label, value, tone = "neutral", sub }) {
  const color = tone === "green" ? GREEN : tone === "gold" ? GOLD_SOFT : "#fff";
  return (
    <div className="flex items-baseline justify-between py-3" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
      <div>
        <div className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>{label}</div>
        {sub && <div className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.32)" }}>{sub}</div>}
      </div>
      <div className="text-base font-medium tabular-nums shrink-0 pl-4" style={{ color }}>{value}</div>
    </div>
  );
}

/**
 * Blendet Abschnitte ein, sobald sie in den Blick kommen.
 * Oben auf der Seite ergibt das eine choreografierte Abfolge,
 * weiter unten belohnt es das Scrollen.
 */
function Reveal({ delay = 0, children }) {
  const ref = useRef(null);
  const [sichtbar, setSichtbar] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setSichtbar(true); return; }
    const io = new IntersectionObserver(
      ([eintrag]) => { if (eintrag.isIntersecting) { setSichtbar(true); io.disconnect(); } },
      { rootMargin: "0px 0px -60px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} style={{
      opacity: sichtbar ? 1 : 0,
      transform: sichtbar ? "none" : "translateY(24px) scale(0.985)",
      transformOrigin: "center top",
      transition: `opacity .85s cubic-bezier(.16,1,.3,1) ${delay}ms, transform .85s cubic-bezier(.16,1,.3,1) ${delay}ms`,
      willChange: "opacity, transform",
    }}>
      {children}
    </div>
  );
}

/** Zeigt nur echte, in CONFIG.testimonials eingetragene Stimmen – sonst nichts. */
/**
 * Rendert Bewertungstext mit Absätzen (Leerzeile im Text = neuer Absatz) und
 * **so** markierten Stellen als fett – der Wortlaut in CONFIG bleibt dabei
 * unverändert, nur zwei einfache Konventionen (Leerzeile, **) steuern die Optik.
 */
function BewertungsText({ text, style }) {
  const absaetze = text.split(/\n\s*\n/);
  const formatiere = (absatz) =>
    absatz.split(/(\*\*[^*]+\*\*)/g).map((teil, j) =>
      teil.startsWith("**") && teil.endsWith("**")
        ? <strong key={j} style={{ color: "#fff", fontWeight: 600 }}>{teil.slice(2, -2)}</strong>
        : teil
    );
  return absaetze.map((absatz, i) => (
    <p key={i} className="text-sm leading-relaxed" style={{ ...style, marginTop: i > 0 ? "0.85em" : 0 }}>
      {i === 0 && "\u201E"}
      {formatiere(absatz)}
      {i === absaetze.length - 1 && "\""}
    </p>
  ));
}

function Sterne({ anzahl = 5, size = 13 }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} size={size} color={GOLD} fill={i < anzahl ? GOLD : "transparent"} />
      ))}
    </div>
  );
}

/** Kurze Bewertungskarten – rendert nichts, solange CONFIG.bewertungen leer ist. */
/** Kürzt eine Bewertung auf den ersten Absatz und ggf. weiter auf maxLaenge
 * Zeichen (an einer Wortgrenze abgeschnitten) – für die Startseite, wo ein
 * knapper Eindruck reicht statt des vollständigen Zitats wie auf der
 * Ergebnisseite. Markdown-Sternchen werden entfernt, damit beim Abschneiden
 * keine offenen "**" stehen bleiben. */
function kuerzeBewertung(text, maxLaenge = 150) {
  const ersterAbsatz = text.split(/\n\s*\n/)[0].replace(/\*\*/g, "");
  if (ersterAbsatz.length <= maxLaenge) return { text: ersterAbsatz, gekuerzt: false };
  const stelle = ersterAbsatz.slice(0, maxLaenge);
  const letzteLeerstelle = stelle.lastIndexOf(" ");
  return { text: stelle.slice(0, letzteLeerstelle > 0 ? letzteLeerstelle : maxLaenge).trim(), gekuerzt: true };
}

/** "Mark R." → "MR" – für den Mini-Avatar, da keine echten Fotos hinterlegt sind. */
function initialen(name) {
  return name.split(" ").map((teil) => teil[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function Bewertungskarten() {
  const eintraege = CONFIG.bewertungen;
  if (!eintraege || eintraege.length === 0) return null;

  const spalten = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" }[Math.min(eintraege.length, 3)];
  const schnitt = eintraege.reduce((s, b) => s + (b.sterne ?? 5), 0) / eintraege.length;

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <Eyebrow>Stimmen</Eyebrow>
          <h3 className="text-xl font-semibold -mt-1">Was Kunden sagen</h3>
        </div>
        <div className="flex items-center gap-2 text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
          <Sterne anzahl={Math.round(schnitt)} size={13} />
          <span className="tabular-nums">{schnitt.toFixed(1).replace(".", ",")} · {eintraege.length} Bewertungen</span>
        </div>
      </div>
      <div className={`grid gap-3 ${spalten}`}>
        {eintraege.map((b, i) => {
          // Echte, von Philipp/aus dem Original-Zitat stammende Kurzfassung
          // bevorzugen (kohärenter Satz) – automatisches Abschneiden nur als
          // Rückfall, falls eine künftige Bewertung ohne "kurz" ergänzt wird.
          const fallback = b.kurz ? null : kuerzeBewertung(b.text);
          const auszug = b.kurz || fallback.text;
          const gekuerzt = !b.kurz && fallback.gekuerzt;
          return (
            <div key={i} className="rounded-2xl p-5" style={{ background: CARD, border: `1px solid ${HAIRLINE}` }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                    style={{ background: "rgba(201,162,39,0.15)", color: GOLD_SOFT, border: "1px solid rgba(201,162,39,0.3)" }}>
                    {initialen(b.name)}
                  </div>
                  <div>
                    <div className="text-sm font-medium leading-tight">{b.name}</div>
                    <div className="text-xs leading-tight" style={{ color: "rgba(255,255,255,0.4)" }}>{b.rolle || "Anleger"}</div>
                  </div>
                </div>
                <Sterne anzahl={b.sterne ?? 5} size={12} />
              </div>
              <p className="text-sm leading-relaxed mt-3.5" style={{ color: "rgba(255,255,255,0.7)" }}>
                „{auszug}{gekuerzt ? "…" : "\u201C"}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Testimonials() {
  const eintraege = CONFIG.testimonials;
  if (!eintraege || eintraege.length === 0) return null;

  return (
    <Card className="p-7">
      <Eyebrow>Stimmen</Eyebrow>
      <h3 className="text-xl font-semibold mb-5">Was andere sagen</h3>
      <div className="space-y-5">
        {eintraege.map((e, i) => (
          <div key={i} className={i > 0 ? "pt-5" : ""} style={i > 0 ? { borderTop: `1px solid ${HAIRLINE}` } : {}}>
            <BewertungsText text={e.text} style={{ color: "rgba(255,255,255,0.75)" }} />
            <div className="text-xs mt-2.5" style={{ color: "rgba(255,255,255,0.4)" }}>
              {e.name}{e.rolle ? ` · ${e.rolle}` : ""}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Details({ titel = "Rechenweg anzeigen", children }) {
  const [offen, setOffen] = useState(false);
  return (
    <div className="mt-5">
      <button onClick={() => setOffen(!offen)}
        className="flex items-center gap-1.5 text-sm transition-colors"
        style={{ color: "rgba(255,255,255,0.45)" }}>
        <ChevronRight size={14} style={{
          transform: offen ? "rotate(90deg)" : "none",
          transition: "transform .25s cubic-bezier(.16,1,.3,1)",
        }} />
        {offen ? "Details ausblenden" : titel}
      </button>
      {offen && <div style={{ animation: "vkIn .35s cubic-bezier(.16,1,.3,1)" }}>{children}</div>}
    </div>
  );
}

function Hinweis({ children }) {
  return (
    <div className="flex gap-2.5 text-xs leading-relaxed p-3 rounded-xl"
      style={{ background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.45)", border: `1px solid ${HAIRLINE}` }}>
      <Info size={14} className="shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

/* ================================================= Vergleich (Startseite) */
/**
 * Drei Wege, gleiche monatliche Belastung, gleicher Zeitraum, kein Eigenkapital.
 * Wichtig: Die beiden Sparseiten werden korrekt verzinst dargestellt – nicht als Null.
 * Der Effekt entsteht durch den Hebel, nicht durch einen geschönten Vergleich.
 */
function DreiWegeVergleich({ onRechner }) {
  const V = CONFIG.vergleich;
  const satz = CONFIG.vergleich.steuersatzFix;

  // Kein Eigenkapital – dieselbe monatliche Belastung, drei Wege: Tagesgeld,
  // ETF-Sparplan, oder Vollfinanzierung einer Immobilie. Die Belastung ist
  // der Jahr-1-Wert, vereinfacht über den ganzen Zeitraum konstant gerechnet
  // (siehe Fußnote).
  const { immo, tagesgeld, aktien, belastungMonat } = useMemo(() => {
    const m = berechneModell({
      kaufpreis: CONFIG.objekt.kaufpreisDefault,
      eigenkapitalEinsatz: 0,
      steuersatz: satz,
      wertsteigerung: CONFIG.projektion.wertsteigerung,
    });
    const belastung = Math.max(0, Math.round(-m.monat.cfNachSteuer));
    const jahresbeitrag = belastung * 12;
    const sparplan = (zins) => {
      let summe = 0;
      for (let j = 1; j <= V.jahre; j++) summe += jahresbeitrag * Math.pow(1 + zins, V.jahre - j);
      return summe;
    };
    return {
      immo: m.stand(V.jahre).nettovermoegen,
      tagesgeld: sparplan(V.sparzins),
      aktien: sparplan(V.aktienzins),
      belastungMonat: belastung,
    };
  }, [satz]);

  // Unterschied gegen die stärkere Alternative (ETF), nicht gegen Tagesgeld
  // – das ist der ehrlichere, konservativere Vergleich.

  const [sichtbar, setSichtbar] = useState(false);
  useEffect(() => { const id = setTimeout(() => setSichtbar(true), 700); return () => clearTimeout(id); }, []);

  const tagesgeldZahl = useZaehler(tagesgeld, { delay: 800, aktiv: sichtbar });
  const aktienZahl = useZaehler(aktien, { delay: 950, aktiv: sichtbar });
  const immoZahl = useZaehler(immo, { delay: 1100, aktiv: sichtbar });
  const deltaZahl = useZaehler(immo - aktien, { delay: 1500, aktiv: sichtbar });

  const max = Math.max(immo, tagesgeld, aktien, 1);
  const saeulen = [
    {
      label: V.sparLabel,
      unter: `${pct(V.sparzins)} p. a. angenommen`,
      zahl: tagesgeldZahl,
      hoehe: (tagesgeld / max) * 100,
      farbe: "rgba(255,255,255,0.16)",
      rand: "rgba(255,255,255,0.22)",
      textFarbe: "rgba(255,255,255,0.75)",
      delay: 800,
    },
    {
      label: V.aktienLabel,
      unter: `${pct(V.aktienzins)} p. a. angenommen`,
      zahl: aktienZahl,
      hoehe: (aktien / max) * 100,
      farbe: "rgba(91,140,201,0.45)",
      rand: "#5B8CC9",
      textFarbe: "#8FB4E3",
      delay: 950,
    },
    {
      label: "Immobilie",
      unter: `${eurK(CONFIG.objekt.kaufpreisDefault)} € Kaufpreis`,
      zahl: immoZahl,
      hoehe: (immo / max) * 100,
      farbe: `linear-gradient(180deg, ${GOLD_SOFT}, ${GOLD})`,
      rand: "transparent",
      textFarbe: GOLD_SOFT,
      delay: 1100,
    },
  ];

  return (
    <Card className="p-7 md:p-8 xl:p-7">
      <Eyebrow>Beispielrechnung</Eyebrow>
      <h2 className="text-2xl md:text-3xl xl:text-2xl font-semibold tracking-tight leading-snug">
        {eur(belastungMonat)} im Monat – drei Wege, {V.jahre} Jahre.
      </h2>
      <p className="text-sm mt-3 leading-relaxed font-medium" style={{ color: GOLD_SOFT }}>
        In diesem Beispiel baut die Immobilie mit derselben monatlichen Belastung mit Abstand
        das meiste Vermögen auf – ganz ohne Eigenkapital.
      </p>
      <p className="text-sm mt-2 leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
        Kein Eigenkapital nötig. Dieselbe monatliche Belastung – als Tagesgeld-Sparplan, als
        {" "}{V.aktienLabel}-Sparplan, oder als Vollfinanzierung einer Immobilie, bei der die Miete
        den Großteil der Rate trägt.
      </p>

      {/* Säulen */}
      <div className="flex items-end gap-3 mt-7 xl:mt-6 h-[210px] xl:h-[175px]">
        {saeulen.map((s) => (
          <div key={s.label} className="flex-1 h-full flex flex-col items-center justify-end">
            <div className="text-sm md:text-base font-semibold tabular-nums mb-2.5 whitespace-nowrap"
              style={{ color: s.textFarbe }}>
              {eur(Math.round(s.zahl))}
            </div>
            <div className="w-full rounded-t-xl" style={{
              height: sichtbar ? `${s.hoehe}%` : "0%",
              minHeight: 4,
              background: s.farbe,
              border: `1px solid ${s.rand}`,
              borderBottom: "none",
              transition: `height 1.4s cubic-bezier(.16,1,.3,1) ${s.delay}ms`,
            }} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 pt-3" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
        {saeulen.map((s) => (
          <div key={s.label} className="text-center">
            <div className="text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>{s.label}</div>
            <div className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>{s.unter}</div>
          </div>
        ))}
      </div>

      {/* Unterschied */}
      <div className="flex items-center justify-center mt-6">
        <span className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium tabular-nums"
          style={{
            background: "rgba(52,211,153,0.10)", border: "1px solid rgba(52,211,153,0.32)", color: GREEN,
            opacity: sichtbar ? 1 : 0, transition: "opacity .8s ease 1.5s",
          }}>
          <TrendingUp size={14} />
          Unterschied zum {V.aktienLabel}: {eur(Math.round(deltaZahl))}
        </span>
      </div>

      <button onClick={onRechner}
        className="w-full mt-5 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-medium transition-colors"
        style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${HAIRLINE}`, color: "rgba(255,255,255,0.7)" }}>
        <Calculator size={13} /> Kalkulation im Detail ansehen
      </button>
    </Card>
  );
}

/* ============================================================ Landing Page */
function Landing({ onStart, onImpressum, onDatenschutz, onCrm, onRechner }) {
  const [t, setT] = useState(0);
  useEffect(() => { const id = setTimeout(() => setT(1), 80); return () => clearTimeout(id); }, []);
  const ease = { transition: "opacity .9s cubic-bezier(.16,1,.3,1), transform .9s cubic-bezier(.16,1,.3,1)" };
  const rise = (d) => ({ opacity: t, transform: t ? "translateY(0)" : "translateY(18px)", transitionDelay: `${d}ms`, ...ease });

  // Unauffälliger Zugang zum internen Bereich: 5× kurz hintereinander auf
  // den kleinen Copyright-Schriftzug im Footer tippen. Kein Hinweis auf der
  // Seite, dass das etwas auslöst – wer es nicht weiß, tippt nie 5×.
  const tippsRef = useRef([]);
  const geheimerTipp = () => {
    const jetzt = Date.now();
    tippsRef.current = [...tippsRef.current.filter((z) => jetzt - z < 1800), jetzt];
    if (tippsRef.current.length >= 5) {
      tippsRef.current = [];
      onCrm();
    }
  };

  return (
    <div className="min-h-screen px-5 pt-10 pb-20 md:pt-16 max-w-5xl xl:max-w-6xl mx-auto">
      <div className="xl:grid xl:grid-cols-2 xl:gap-16 xl:items-center">
        <div>
          <h1 className="text-4xl md:text-6xl xl:text-5xl font-semibold leading-[1.08] tracking-tight max-w-3xl xl:max-w-none" style={rise(0)}>
            Wie viel Vermögen könntest du mit{" "}
            <span style={{ background: `linear-gradient(120deg, ${GOLD_SOFT}, ${GOLD})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
              Immobilien
            </span>{" "}
            aufbauen?
          </h1>

          <p className="mt-6 text-base md:text-lg leading-relaxed max-w-2xl xl:max-w-none" style={{ color: "rgba(255,255,255,0.55)", ...rise(160) }}>
            Beantworte wenige Fragen und erhalte kostenlos eine interaktive Beispielanalyse
            inklusive Finanzierung, Cashflow, steuerlicher Betrachtung und Vermögensentwicklung.
          </p>

          <p className="mt-3 text-sm leading-relaxed max-w-2xl xl:max-w-none" style={{ color: "rgba(255,255,255,0.4)", ...rise(200) }}>
            Hausverwaltung und Mietverwaltung sind bei allen Objekten inklusive – ohne Aufwand für dich.
          </p>

          <div className="mt-9 flex flex-col items-center xl:items-start w-fit mx-auto xl:mx-0" style={rise(240)}>
            <GoldButton onClick={onStart} glow>
              Jetzt Vermögensanalyse starten <ArrowRight size={18} />
            </GoldButton>
            <div className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs mt-4"
              style={{ border: `1px solid ${HAIRLINE}`, color: "rgba(255,255,255,0.6)", background: CARD }}>
              <Clock size={12} color={GOLD} /> Dauert nur ca. 2 Minuten
            </div>
          </div>
        </div>

        {/* Der Vergleich ist die Kernaussage der Seite – ab 1280px direkt
            neben dem Text, statt darunter viel Leerraum entstehen zu lassen.
            Unterhalb von 1280px (Handy, Tablet, kleinere Laptop-Fenster)
            bleibt exakt die mobile Reihenfolge, gestapelt. */}
        <div className="mt-8 xl:mt-0 xl:max-w-lg xl:ml-auto" style={rise(340)}>
          <DreiWegeVergleich onRechner={onRechner} />
        </div>
      </div>

      <p className="mt-8 text-xs leading-relaxed max-w-2xl xl:hidden" style={{ color: "rgba(255,255,255,0.3)", ...rise(420) }}>
        Alle Darstellungen sind überschlägige Beispielrechnungen auf Basis allgemeiner Annahmen.
        Sie ersetzen keine Steuer-, Rechts- oder Anlageberatung.
      </p>

      {/* Bewertungskarten – nur im DOM, wenn echte Einträge vorhanden sind */}
      {CONFIG.bewertungen.length > 0 && (
        <div className="mt-8">
          <Bewertungskarten />
        </div>
      )}

      <div className="mt-10 flex items-center gap-4">
        <button onClick={onImpressum} className="text-xs underline" style={{ color: "rgba(255,255,255,0.3)" }}>
          Impressum
        </button>
        <button onClick={onDatenschutz} className="text-xs underline" style={{ color: "rgba(255,255,255,0.3)" }}>
          Datenschutz
        </button>
        <span onClick={geheimerTipp} className="text-xs select-none" style={{ color: "rgba(255,255,255,0.3)" }}>
          © {CONFIG.marke.firma}
        </span>
      </div>
    </div>
  );
}

/* ================================================================= Quiz */
const ZIELE = [
  "Vermögen aufbauen", "Steuern optimieren", "Passive Einnahmen",
  "Altersvorsorge", "Kapital sinnvoll investieren",
];
const STATUS = [
  { id: "angestellt", label: "Angestellt" },
  { id: "beamter", label: "Beamter" },
  { id: "selbststaendig", label: "Selbstständig" },
  { id: "unternehmer", label: "Unternehmer" },
  { id: "freiberufler", label: "Freiberufler" },
];
const ZEITPUNKT = [
  { id: "sofort", label: "Sofort" },
  { id: "3monate", label: "Innerhalb von 3 Monaten" },
  { id: "6monate", label: "Innerhalb von 6 Monaten" },
  { id: "12monate", label: "Innerhalb von 12 Monaten" },
  { id: "informieren", label: "Zunächst informieren" },
];

function einkommensHinweis(b) {
  if (b < 42000) return "Solide Basis – der Einstieg ist möglich.";
  if (b < 55000) return "Gute Voraussetzungen für eine Finanzierung.";
  if (b < 85000) return "Sehr gute Voraussetzungen für eine Finanzierung.";
  if (b < 130000) return "Starke Ausgangsposition für den Vermögensaufbau.";
  return "Interessantes steuerliches Potenzial.";
}

/** Nutzt das echte Tilgungsjahr aus dem Modell statt einer vagen Aussage –
 * zeigt konkret, wie alt man bei Volltilgung wäre. Dieselbe Zahl taucht
 * später im Kaufplan als Meilenstein wieder auf. */
function alterHinweis(alter, tilgungsjahr) {
  const dann = alter + tilgungsjahr;
  if (alter < 30) return `Bei Volltilgung nach rund ${tilgungsjahr} Jahren wärst du erst ${dann} – noch mitten im Berufsleben.`;
  if (alter < 45) return `Bei Volltilgung nach rund ${tilgungsjahr} Jahren wärst du ${dann} – kurz vor oder im Ruhestand.`;
  return `Bei Volltilgung nach rund ${tilgungsjahr} Jahren wärst du ${dann} – die Rente käme dann genau zur rechten Zeit.`;
}

function eigenkapitalHinweis(ek) {
  if (ek === 0) return "Kein Eigenkapital nötig – auch eine Vollfinanzierung ist möglich.";
  if (ek < 20000) return "Schon ein kleiner Puffer kann die Finanzierungskonditionen verbessern.";
  if (ek < 60000) return "Guter Puffer – das erweitert deinen Spielraum bei der Bank.";
  return "Damit stehen dir auch größere Objekte oder mehrere Käufe gleichzeitig offen.";
}

function Quiz({ antworten, setAntworten, onFertig, onZurueck }) {
  const [step, setStep] = useState(0);
  const a = antworten;
  const set = (patch) => setAntworten({ ...a, ...patch });

  const istSelbststaendig = ["selbststaendig", "freiberufler", "unternehmer"].includes(a.status);
  const steuersatz = useMemo(() => grenzsteuersatz(a.brutto, a.status || "angestellt"), [a.brutto, a.status]);
  // Tilgungsjahr ist unabhängig vom Kaufpreis (siehe berechneModell) – einmal
  // berechnet, für den Altershinweis auf dieser Seite nutzbar.
  const tilgungsjahr = useMemo(() => {
    const modell = berechneModell({
      kaufpreis: CONFIG.objekt.kaufpreisDefault, eigenkapitalEinsatz: 0,
      steuersatz: 0, wertsteigerung: CONFIG.projektion.wertsteigerung,
    });
    return modell.abbezahltNachJahren ?? CONFIG.projektion.betrachtungJahre;
  }, []);
  const steuerlastJahr = useMemo(() => {
    const zve = schaetzeZvE(a.brutto, a.status || "angestellt");
    const est = einkommensteuer(zve);
    return Math.round(est + soli(est));
  }, [a.brutto, a.status]);
  // Gehaltszettel-Vergleich auf dem Steuerpotenzial-Screen: Steuer mit einer
  // Beispielimmobilie (Standard-Kaufpreis, noch vor der Kaufpreis-Frage) –
  // zeigt schon früh im Quiz konkret, wie viel mehr Netto ankommt, inklusive
  // aller Zwischenschritte für eine nachvollziehbare Rechenleiter.
  const steuerRechnung = useMemo(() => {
    const modell = berechneModell({
      kaufpreis: CONFIG.objekt.kaufpreisDefault, eigenkapitalEinsatz: 0,
      steuersatz, wertsteigerung: CONFIG.projektion.wertsteigerung,
    });
    const m = modell.monat;
    const ersparnisJahr = Math.round(m.steuerwirkung * 12);
    return {
      kaltmiete: Math.round(m.kaltmiete * 12),
      zinsen: Math.round(m.zinsen * 12),
      afa: Math.round(m.afa * 12),
      nichtUml: CONFIG.objekt.nichtUmlagefaehigMonat * 12,
      steuerErgebnis: Math.round(m.steuerErgebnis * 12),
      ersparnisJahr,
      steuerlastMit: Math.max(0, steuerlastJahr - ersparnisJahr),
    };
  }, [steuerlastJahr, steuersatz]);
  const steuerlastMitImmobilie = steuerRechnung.steuerlastMit;

  // Live-Vorschau für die Sparrate-Frage: derselbe echte Rechenkern wie
  // überall sonst, nur der Referenz-Kaufpreis wird proportional zur
  // eingestellten Sparrate skaliert (dieselbe Belastung-zu-Kaufpreis-Logik
  // wie im DreiWegeVergleich, nur umgekehrt aufgelöst). Bewusst als
  // Näherung markiert ("≈"), nicht als exakte Endauswertung.
  const referenzBelastung = useMemo(() => {
    const modell = berechneModell({
      kaufpreis: CONFIG.objekt.kaufpreisDefault, eigenkapitalEinsatz: 0,
      steuersatz, wertsteigerung: CONFIG.projektion.wertsteigerung,
    });
    return Math.max(1, Math.round(-modell.monat.cfNachSteuer));
  }, [steuersatz]);
  const sparrateVorschau = useMemo(() => {
    if (!a.sparrate) return 0;
    const faktor = a.sparrate / referenzBelastung;
    const modell = berechneModell({
      kaufpreis: CONFIG.objekt.kaufpreisDefault * faktor, eigenkapitalEinsatz: 0,
      steuersatz, wertsteigerung: CONFIG.projektion.wertsteigerung,
    });
    return modell.stand(20).nettovermoegen;
  }, [a.sparrate, referenzBelastung, steuersatz]);

  /**
   * Bei Fragen mit genau einer möglichen Antwort geht es von selbst weiter.
   * Die kurze Verzögerung ist Absicht: das Häkchen soll sichtbar werden,
   * und ein Fehlgriff lässt sich durch Antippen der richtigen Option noch korrigieren.
   */
  const autoRef = useRef(null);
  const autoWeiter = (verzoegerung = 340) => {
    clearTimeout(autoRef.current);
    autoRef.current = setTimeout(() => weiter(), verzoegerung);
  };
  useEffect(() => () => clearTimeout(autoRef.current), []);
  useEffect(() => { clearTimeout(autoRef.current); }, [step]);

  const steps = [
    {
      titel: "Was möchtest du erreichen?",
      hilfe: "Mehrfachauswahl möglich.",
      valide: a.ziele.length > 0,
      inhalt: (
        <div className="space-y-2.5">
          {ZIELE.map((z) => (
            <Option key={z} multi selected={a.ziele.includes(z)}
              onClick={() => set({ ziele: a.ziele.includes(z) ? a.ziele.filter(x => x !== z) : [...a.ziele, z] })}>
              {z}
            </Option>
          ))}
        </div>
      ),
    },
    {
      titel: "Wie alt bist du?",
      valide: a.alter >= 18 && a.alter <= 50,
      inhalt: (
        <div className="space-y-6">
          <Slider value={a.alter} min={18} max={50} step={1} onChange={(v) => set({ alter: v })}
            format={(v) => (v >= 50 ? "50+ Jahre" : `${v} Jahre`)} />
          <div className="text-sm" style={{ color: GOLD_SOFT }}>{alterHinweis(a.alter, tilgungsjahr)}</div>
        </div>
      ),
    },
    {
      titel: "Was ist dein Berufsstatus?",
      valide: !!a.status && (!istSelbststaendig || a.selbststaendigSeit >= 0),
      zeigeButton: istSelbststaendig,
      inhalt: (
        <div className="space-y-2.5">
          {STATUS.map((s) => (
            <Option key={s.id} selected={a.status === s.id}
              onClick={() => {
                set({ status: s.id });
                // Selbstständige bekommen im selben Schritt noch die Frage nach der Dauer
                if (!["selbststaendig", "freiberufler", "unternehmer"].includes(s.id)) autoWeiter();
              }}>
              {s.label}
            </Option>
          ))}
          {istSelbststaendig && (
            <div className="pt-6">
              <div className="text-sm mb-4" style={{ color: "rgba(255,255,255,0.6)" }}>Seit wann bist du selbstständig?</div>
              <Slider value={a.selbststaendigSeit} min={0} max={25} step={1} onChange={(v) => set({ selbststaendigSeit: v })}
                format={(v) => (v === 0 ? "Weniger als 1 Jahr" : v === 25 ? "25+ Jahre" : `${v} Jahre`)} />
            </div>
          )}
        </div>
      ),
    },
    {
      titel: "Wie hoch ist dein jährliches Bruttoeinkommen?",
      valide: a.brutto >= 20000,
      inhalt: (
        <div className="space-y-6">
          <Slider value={a.brutto} min={30000} max={300000} step={1000} kurve={3.2}
            onChange={(v) => set({ brutto: v })} format={(v) => eur(v)} />
          <div className="text-sm" style={{ color: GOLD_SOFT }}>{einkommensHinweis(a.brutto)}</div>
          <div>
            <ZahlenFeld label="Oder genauen Betrag eingeben" value={a.brutto} onChange={(v) => set({ brutto: v })} suffix="€" min={0} />
          </div>
          <Card className="p-5">
            <div className="text-xs uppercase tracking-widest mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>
              Geschätzter Grenzsteuersatz
            </div>
            <div className="text-3xl font-semibold tabular-nums" style={{ color: GOLD_SOFT }}>{pct(steuersatz, 1)}</div>
            <div className="text-sm mt-2" style={{ color: "rgba(255,255,255,0.55)" }}>
              Das entspricht schätzungsweise {eur(steuerlastJahr)} Einkommensteuer pro Jahr.
            </div>
            <div className="text-xs mt-3 leading-relaxed" style={{ color: "rgba(255,255,255,0.4)" }}>
              Dies ist eine Schätzung auf Basis des Einkommensteuertarifs inklusive Solidaritätszuschlag.
              Die tatsächliche steuerliche Situation hängt von weiteren Faktoren ab.
            </div>
          </Card>
        </div>
      ),
    },
    {
      titel: "Interessantes Steuerpotenzial",
      hilfe: "Kurzer Zwischenstopp, bevor es mit deinem Eigenkapital weitergeht.",
      valide: true,
      inhalt: (
        <div className="space-y-6">
          {a.ziele.includes("Steuern optimieren") && <ZielBadge text="Passt zu deinem Ziel: Steuern optimieren" />}
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="shrink-0 rounded-full flex items-center justify-center"
                style={{ width: 38, height: 38, background: "rgba(201,162,39,0.14)" }}>
                <Receipt size={18} color={GOLD_SOFT} />
              </div>
              <div>
                <div className="text-xs uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.4)" }}>
                  Dein Grenzsteuersatz
                </div>
                <div className="text-2xl font-semibold tabular-nums" style={{ color: GOLD_SOFT }}>{pct(steuersatz, 1)}</div>
              </div>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>
              Nice – bei diesem Steuersatz zählt jeder Euro, den du legal sparen kannst. Mit einer
              vermieteten Immobilie lässt sich ein Teil deiner Steuerlast über Abschreibungen (AfA)
              und Schuldzinsen reduzieren. Je höher dein Steuersatz, desto stärker wirkt sich das aus.
            </p>
            {a.ziele.includes("Steuern optimieren") && (
              <p className="text-sm leading-relaxed mt-3 pt-3" style={{ color: "rgba(255,255,255,0.65)", borderTop: `1px solid ${HAIRLINE}` }}>
                Konkret heißt das: Die jährliche AfA und die Zinsen aus der Finanzierung mindern dein
                steuerpflichtiges Einkommen aus der Vermietung – entsteht daraus ein Verlust, wird er
                mit deinem übrigen Einkommen verrechnet. Genau das zeigt dir die Auswertung gleich in Euro.
              </p>
            )}
          </Card>

          {/* Gehaltszettel-Vergleich: macht die AfA/Zinsen-Erklärung oben konkret,
              mit dem tatsächlich eingegebenen Bruttogehalt statt abstrakten Prozenten. */}
          <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${HAIRLINE}` }}>
            <div className="grid grid-cols-3 text-xs px-4 py-2.5" style={{ background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.4)" }}>
              <div>Gehaltszettel</div>
              <div className="text-right">Ohne</div>
              <div className="text-right">Mit Immobilie</div>
            </div>
            <div className="grid grid-cols-3 text-sm items-center px-4 py-2.5" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
              <div style={{ color: "rgba(255,255,255,0.6)" }}>Bruttogehalt</div>
              <div className="text-right tabular-nums">{eur(a.brutto)}</div>
              <div className="text-right tabular-nums">{eur(a.brutto)}</div>
            </div>
            <div className="grid grid-cols-3 text-sm items-center px-4 py-2.5" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
              <div style={{ color: "rgba(255,255,255,0.6)" }}>Steuern &amp; Soli</div>
              <div className="text-right tabular-nums" style={{ color: "rgba(255,255,255,0.6)" }}>−{eur(steuerlastJahr)}</div>
              <div className="text-right tabular-nums" style={{ color: GOLD_SOFT }}>−{eur(steuerlastMitImmobilie)}</div>
            </div>
            <div className="grid grid-cols-3 text-sm items-center px-4 py-3 font-semibold"
              style={{ borderTop: `1px solid ${HAIRLINE}`, background: "rgba(255,255,255,0.02)" }}>
              <div>Netto/Jahr</div>
              <div className="text-right tabular-nums">{eur(a.brutto - steuerlastJahr)}</div>
              <div className="text-right tabular-nums" style={{ color: GOLD_SOFT }}>{eur(a.brutto - steuerlastMitImmobilie)}</div>
            </div>
          </div>

          {steuerlastJahr > steuerlastMitImmobilie && (
            <div className="rounded-2xl p-4" style={{ background: "rgba(201,162,39,0.08)", border: "1px solid rgba(201,162,39,0.25)" }}>
              <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>
                <span style={{ color: GOLD_SOFT, fontWeight: 600 }}>+{eur(steuerlastJahr - steuerlastMitImmobilie)} mehr Netto pro Jahr</span>{" "}
                – weil Abschreibung (AfA) und Zinsen deine Steuerlast senken. Bei deinem Steuersatz von{" "}
                {pct(steuersatz, 1)} wirkt sich das besonders stark aus.
              </p>

              <Details titel="Genaue Rechnung anzeigen">
                <div className="mt-3 pt-3" style={{ borderTop: `1px solid rgba(201,162,39,0.25)` }}>
                  <Rechenzeile label="Kaltmiete/Jahr" wert={eur(steuerRechnung.kaltmiete)} zeichen="+" />
                  <Rechenzeile label="Zinsen (Jahr 1)" wert={eur(steuerRechnung.zinsen)} zeichen="−" />
                  <Rechenzeile label="Abschreibung (AfA)" wert={eur(steuerRechnung.afa)} zeichen="−" />
                  <Rechenzeile label="Nicht umlagefähige Kosten" wert={eur(steuerRechnung.nichtUml)} zeichen="−" />
                  <div style={{ borderTop: `1px solid rgba(201,162,39,0.25)` }} />
                  <Rechenzeile label="Steuerliches Ergebnis" wert={eur(steuerRechnung.steuerErgebnis)} zeichen="=" stark />
                  <Rechenzeile label={`× Steuersatz (${pct(steuersatz, 1)})`} wert="" />
                  <div style={{ borderTop: `1px solid rgba(201,162,39,0.25)` }} />
                  <Rechenzeile label="Steuerersparnis pro Jahr" wert={eur(steuerRechnung.ersparnisJahr)} zeichen="=" stark />
                  <p className="text-xs leading-relaxed mt-2" style={{ color: "rgba(255,255,255,0.4)" }}>
                    {eur(steuerlastJahr)} − {eur(steuerRechnung.ersparnisJahr)} = {eur(steuerlastMitImmobilie)}{" "}
                    Steuerlast mit Immobilie, wie oben in der Tabelle.
                  </p>
                </div>
              </Details>

              <p className="text-xs leading-relaxed mt-3 pt-3" style={{ color: "rgba(255,255,255,0.4)", borderTop: `1px solid rgba(201,162,39,0.2)` }}>
                Das Geld bekommst du in der Regel über die Steuererklärung zurück – oder direkt
                monatlich, wenn du beim Finanzamt einen Freibetrag einträgst.
              </p>
            </div>
          )}
          <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.35)" }}>
            Wie stark sich das bei deinen Angaben konkret auswirkt, zeigt dir gleich deine Auswertung.
            Zunächst brauchen wir noch ein paar Angaben zu deiner Finanzierung.
          </p>
        </div>
      ),
    },
    {
      titel: "Wie viel Eigenkapital hast du zur Verfügung?",
      hilfe: "Nur zur Einordnung – du musst nichts davon einsetzen. Auch eine Finanzierung ganz ohne Eigenkapital ist möglich.",
      valide: true,
      inhalt: (
        <div className="space-y-6">
          {a.ziele.includes("Kapital sinnvoll investieren") && <ZielBadge text="Passt zu deinem Ziel: Kapital sinnvoll investieren" />}
          <Slider value={a.eigenkapital} min={0} max={200000} step={1000} kurve={2}
            onChange={(v) => set({ eigenkapital: v })} format={(v) => eur(v)} />
          <div className="text-sm" style={{ color: GOLD_SOFT }}>{eigenkapitalHinweis(a.eigenkapital)}</div>
        </div>
      ),
    },
    {
      titel: "Was kannst du monatlich zurücklegen?",
      hilfe: "Der Betrag, den du dir realistisch leisten könntest – deine Sparrate fließt direkt in deine Auswertung ein.",
      valide: true,
      inhalt: (
        <div className="space-y-5">
          <Slider value={a.sparrate} min={0} max={2000} step={25} kurve={2}
            onChange={(v) => set({ sparrate: v })} format={(v) => eur(v) + " / Monat"} />
          {a.sparrate > 0 && (
            <div className="rounded-2xl p-4" style={{ background: "rgba(201,162,39,0.1)", border: "1px solid rgba(201,162,39,0.3)" }}>
              <div className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>Damit wären bei einer passenden Immobilie überschlägig</div>
              <div className="text-xl font-semibold tabular-nums mt-0.5" style={{ color: GOLD_SOFT }}>
                ≈ {eur(Math.round(sparrateVorschau))} <span className="text-sm font-normal" style={{ color: "rgba(255,255,255,0.5)" }}>Nettovermögen in 20 Jahren</span>
              </div>
            </div>
          )}
        </div>
      ),
    },
    {
      titel: "Besitzt du bereits Immobilien?",
      valide: a.hatImmobilien !== null,
      zeigeButton: a.hatImmobilien === true,
      inhalt: (
        <div className="space-y-2.5">
          <Option selected={a.hatImmobilien === true}
            onClick={() => set({ hatImmobilien: true, immobilien: Math.max(1, a.immobilien) })}>Ja</Option>
          <Option selected={a.hatImmobilien === false}
            onClick={() => { set({ hatImmobilien: false, immobilien: 0 }); autoWeiter(); }}>Nein</Option>
          {a.hatImmobilien === true && (
            <div className="pt-6">
              <div className="text-sm mb-4" style={{ color: "rgba(255,255,255,0.6)" }}>Wie viele?</div>
              <Slider value={a.immobilien} min={1} max={10} step={1} onChange={(v) => set({ immobilien: v })}
                format={(v) => (v === 10 ? "10 oder mehr" : `${v}`)} />
            </div>
          )}
        </div>
      ),
    },
    {
      titel: "Wie viel Immobilienrente möchtest du im Alter haben?",
      hilfe: "Monatlich, sobald deine Immobilie abbezahlt ist – die Miete gehört dann dir.",
      valide: true,
      inhalt: (
        <div className="space-y-6">
          {(a.ziele.includes("Altersvorsorge") || a.ziele.includes("Passive Einnahmen")) && (
            <ZielBadge text={`Passt zu deinem Ziel: ${a.ziele.includes("Altersvorsorge") ? "Altersvorsorge" : "Passive Einnahmen"}`} />
          )}
          <Slider value={a.zielrente} min={0} max={15000} step={100} mitte={3500}
            onChange={(v) => set({ zielrente: v })} format={(v) => eur(v) + " / Monat"} />
          {a.zielrente > 0 && a.zielrente < 5000 && (
            <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: "rgba(201,162,39,0.1)", border: "1px solid rgba(201,162,39,0.3)" }}>
              <Info size={18} color={GOLD_SOFT} className="shrink-0 mt-0.5" />
              <span className="text-sm leading-relaxed" style={{ color: GOLD_SOFT }}>
                Zum Vergleich: Viele empfehlen mindestens 5.000–6.000 € monatliche Immobilienrente
                einzuplanen, um die gesetzliche Rente spürbar zu ergänzen.
              </span>
            </div>
          )}
          {a.zielrente > 0 && (() => {
            const kp = baueKaufplan(a.zielrente);
            return (
              <Card className="p-5">
                <div className="text-xs uppercase tracking-widest mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>
                  Dafür langfristig erforderlich
                </div>
                <div className="text-3xl font-semibold tabular-nums" style={{ color: GOLD_SOFT }}>
                  {kp.gesamtanzahl} Wohnung{kp.gesamtanzahl === 1 ? "" : "en"} à {eurK(kp.kaufpreis)} €
                </div>
                <div className="text-sm mt-2" style={{ color: "rgba(255,255,255,0.55)" }}>
                  Gesamtvolumen ca. {eur(kp.gesamtanzahl * kp.kaufpreis)}
                </div>
                <div className="text-xs mt-3 leading-relaxed" style={{ color: "rgba(255,255,255,0.4)" }}>
                  Beispielrechnung mit der heutigen Miete, ohne Mietsteigerung – sobald der Kredit
                  getilgt ist, wird sie abzüglich laufender Kosten zu deiner monatlichen Rente.
                  Eine bis dahin gestiegene Miete kommt on top. Deinen persönlichen Weg zu diesem
                  Bestand zeigt dir gleich die Auswertung.
                </div>
              </Card>
            );
          })()}
        </div>
      ),
    },
    {
      titel: "Wann möchtest du investieren?",
      valide: !!a.zeitpunkt,
      zeigeButton: false,
      inhalt: (
        <div className="space-y-2.5">
          {ZEITPUNKT.map((z) => (
            <Option key={z.id} selected={a.zeitpunkt === z.id}
              onClick={() => { set({ zeitpunkt: z.id }); autoWeiter(420); }}>
              {z.label}
            </Option>
          ))}
        </div>
      ),
    },
  ];

  const s = steps[step];

  useEffect(() => {
    trackEvent("quiz_step", { step: step + 1, von: steps.length, frage: s.titel });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const weiter = () => (step === steps.length - 1 ? onFertig() : setStep(step + 1));
  const zurueck = () => (step === 0 ? onZurueck() : setStep(step - 1));

  return (
    <div className="min-h-screen flex flex-col px-5 max-w-2xl mx-auto w-full" style={{ minHeight: "100dvh" }}>
      <div className="pt-8 pb-2">
        <div className="flex items-center gap-4">
          <button onClick={zurueck} className="p-2 -ml-2 rounded-full transition-colors"
            style={{ color: "rgba(255,255,255,0.45)" }} aria-label="Zurück">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 flex items-center justify-center gap-1.5 flex-wrap">
            {steps.map((_, i) => (
              <div key={i} className="rounded-full transition-all duration-300"
                style={{
                  width: i === step ? 8 : 6, height: i === step ? 8 : 6,
                  background: i <= step ? GOLD : "rgba(255,255,255,0.15)",
                  boxShadow: i === step ? `0 0 6px ${GOLD}` : "none",
                }} />
            ))}
          </div>
          <div className="w-[18px]" />
        </div>
      </div>

      <div key={step} className={"flex-1 flex flex-col py-10 " + (s.obenAusgerichtet ? "justify-start" : "justify-center")} style={{ animation: "vkIn .5s cubic-bezier(.16,1,.3,1)" }}>
        <h2 className="text-2xl md:text-3xl font-semibold leading-snug tracking-tight mb-2">{s.titel}</h2>
        {s.hilfe && <p className="text-sm mb-7" style={{ color: "rgba(255,255,255,0.4)" }}>{s.hilfe}</p>}
        <div className={s.hilfe ? "" : "mt-6"}>{s.inhalt}</div>
      </div>

      {s.zeigeButton !== false && (
        <div className="pb-10 pt-4 sticky bottom-0" style={{ background: `linear-gradient(to top, ${INK} 62%, transparent)` }}>
          <GoldButton full onClick={weiter} disabled={!s.valide}>
            {step === steps.length - 1 ? "Analyse starten" : "Weiter"} <ArrowRight size={18} />
          </GoldButton>
        </div>
      )}
    </div>
  );
}

/* ==================================================== Analyse-Animation */
const ANALYSE_TEXTE = [
  "Deine Angaben werden ausgewertet…",
  "Finanzierung wird berechnet…",
  "Steuerliche Wirkung wird simuliert…",
  "Vermögensentwicklung wird erstellt…",
  "Fast geschafft…",
];

function Analyse({ onFertig }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => v + 1), 750);
    const done = setTimeout(onFertig, 3800);
    return () => { clearInterval(t); clearTimeout(done); };
  }, [onFertig]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="relative mb-12" style={{ width: 84, height: 84 }}>
        <div className="absolute inset-0 rounded-full" style={{ border: `1px solid ${HAIRLINE}` }} />
        <div className="absolute inset-0 rounded-full"
          style={{ border: "2px solid transparent", borderTopColor: GOLD, animation: "vkSpin 1.1s linear infinite" }} />
        <div className="absolute inset-3 rounded-full flex items-center justify-center" style={{ background: "rgba(201,162,39,0.06)" }}>
          <Calculator size={24} color={GOLD} />
        </div>
      </div>
      <div className="h-8 text-center">
        {ANALYSE_TEXTE.map((t, idx) => (
          <div key={t} className="text-base absolute left-0 right-0 transition-all duration-500"
            style={{ opacity: idx === Math.min(i, 4) ? 1 : 0, color: "rgba(255,255,255,0.7)", transform: idx === Math.min(i, 4) ? "none" : "translateY(6px)" }}>
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ==================================================== Fallstudie (Hero) */
function Segment({ optionen, wert, onChange }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${optionen.length}, minmax(0,1fr))` }}>
      {optionen.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)}
          className="rounded-xl py-2.5 text-sm font-medium transition-all duration-200"
          style={{
            background: wert === o.id ? "rgba(201,162,39,0.15)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${wert === o.id ? "rgba(201,162,39,0.6)" : HAIRLINE}`,
            color: wert === o.id ? GOLD_SOFT : "rgba(255,255,255,0.55)",
          }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Zeigt in einem Bild, wie das Vermögen entsteht: Der Immobilienwert steigt,
 * die Restschuld sinkt – die goldene Fläche dazwischen ist das Eigenkapital.
 * Der Trick für das Band: Restschuld transparent stapeln, Differenz darauf.
 */
function VermoegensBand({ modell, jahr }) {
  const daten = useMemo(() => {
    const punkte = [{
      jahr: 0,
      Immobilienwert: Math.round(modell.kaufpreis),
      Restschuld: Math.round(modell.darlehen),
      band: Math.max(0, Math.round(modell.kaufpreis - modell.darlehen)),
    }];
    for (let i = 0; i < jahr; i++) {
      const r = modell.reihe[i];
      punkte.push({
        jahr: r.jahr,
        Immobilienwert: Math.round(r.immobilienwert),
        Restschuld: Math.round(r.restschuld),
        band: Math.max(0, Math.round(r.immobilienwert - r.restschuld)),
      });
    }
    return punkte;
  }, [modell, jahr]);

  return (
    <div className="-mx-2" style={{ height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={daten} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="vk-band" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GOLD} stopOpacity="0.42" />
              <stop offset="100%" stopColor={GOLD} stopOpacity="0.08" />
            </linearGradient>
          </defs>
          <XAxis dataKey="jahr" tick={{ fill: "rgba(255,255,255,0.32)", fontSize: 11 }}
            tickLine={false} axisLine={{ stroke: HAIRLINE }}
            tickFormatter={(v) => (v === 0 ? "heute" : `${v}J`)} />
          <YAxis tick={{ fill: "rgba(255,255,255,0.32)", fontSize: 11 }} tickLine={false}
            axisLine={false} width={42} tickFormatter={(v) => eurK(v)} />
          {/* Bewusst kein Tooltip: die Zahlen stehen bereits in der Rechenzeile darunter,
              und ein Touch-Tooltip auf einem so schmalen Chart verdeckt beim Ziehen mehr,
              als er erklärt. Das Diagramm ist hier reine Illustration der Kurvenform. */}
          {/* unsichtbarer Sockel */}
          <Area dataKey="Restschuld" stackId="b" stroke="none" fill="transparent" isAnimationActive={false} />
          {/* die Fläche dazwischen */}
          <Area dataKey="band" stackId="b" stroke="none" fill="url(#vk-band)" isAnimationActive={false} />
          <Line dataKey="Immobilienwert" stroke={GOLD} strokeWidth={2.5} dot={false} isAnimationActive={false} />
          <Line dataKey="Restschuld" stroke="#7A7A85" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Der Weg zur gewünschten Immobilienrente aus dem Quiz: alle benötigten
 * Objekte so schnell wie möglich, gleichmäßig verteilt innerhalb von
 * CONFIG.kaufplan.zielzeitraum Jahren – Volumen zügig sichern, statt über
 * Jahrzehnte zu strecken. Danach läuft nur noch Zeit: Tilgung, Mietwachstum,
 * Wertsteigerung. Bewusst als Partnerschaft formuliert ("wir"), nicht als
 * reine Rechnung – das war explizit der Wunsch: ein Plan, kein Kalkulationsblatt.
 */
function Kaufplan({ antworten }) {
  const zielrente = antworten.zielrente;
  if (!zielrente || zielrente <= 0) return null;

  const kaufpreis = CONFIG.objekt.kaufpreisDefault;

  const { volumen, wellen, gesamtanzahl, tilgungsjahr, gesamtwertHeute, meilenstein1Jahr, meilenstein2Jahr, gesamtwertDann, renteDann } = useMemo(() => {
    const { volumen: vol, objekte, gesamtanzahl: n } = baueKaufplan(zielrente);
    const referenz = berechneModell({
      kaufpreis, eigenkapitalEinsatz: 0, steuersatz: 0, wertsteigerung: CONFIG.projektion.wertsteigerung,
    });
    const tj = referenz.abbezahltNachJahren ?? CONFIG.projektion.betrachtungJahre;

    // Gleiche Jahr+Kaufpreis-Kombination zu einer Zeile zusammenfassen ("2 Objekte" statt zweimal derselbe Eintrag).
    const gruppen = [];
    for (const o of objekte) {
      const letzte = gruppen[gruppen.length - 1];
      if (letzte && letzte.jahr === o.jahr && letzte.kaufpreis === o.kaufpreis) letzte.anzahl += 1;
      else gruppen.push({ jahr: o.jahr, kaufpreis: o.kaufpreis, anzahl: 1 });
    }

    const m1 = gruppen[0].jahr + tj;
    const m2 = gruppen[gruppen.length - 1].jahr + tj;
    const O = CONFIG.objekt;

    // Wertentwicklung ab "alle abbezahlt": Portfolio-Wert mit Wertsteigerung
    // hochgerechnet, tatsächliche Miete mit Mietsteigerung – zum Vergleich mit
    // der bewusst konservativ (heutige Miete) kalkulierten Zielrente oben.
    const wertHeute = gruppen.reduce((s, w) => s + w.anzahl * w.kaufpreis, 0);
    const wertDann = gruppen.reduce((s, w) =>
      s + w.anzahl * w.kaufpreis * Math.pow(1 + CONFIG.projektion.wertsteigerung, m2 - w.jahr), 0);
    const mieteJahrDann = gruppen.reduce((s, w) =>
      s + w.anzahl * w.kaufpreis * O.bruttomietrendite * Math.pow(1 + O.mietsteigerung, m2 - w.jahr - 1), 0);
    const nichtUmlDann = gruppen.reduce((s, w) => s + w.anzahl * O.nichtUmlagefaehigMonat, 0);
    const renteMonatDann = mieteJahrDann / 12 - nichtUmlDann;

    return {
      volumen: vol, wellen: gruppen, gesamtanzahl: n, tilgungsjahr: tj,
      gesamtwertHeute: wertHeute, meilenstein1Jahr: m1, meilenstein2Jahr: m2,
      gesamtwertDann: wertDann, renteDann: renteMonatDann,
    };
  }, [zielrente]);

  const sichtbar = wellen.slice(0, 5);
  const objekteSichtbar = sichtbar.reduce((s, w) => s + w.anzahl, 0);
  const objekteRest = gesamtanzahl - objekteSichtbar;
  const wellenRest = wellen.length - sichtbar.length;
  const dauerJahre = wellen[wellen.length - 1].jahr + 1;

  return (
    <Reveal>
      <Card className="p-7">
        <Eyebrow>Dein Plan</Eyebrow>
        <h3 className="text-xl font-semibold mb-2 leading-snug">
          {antworten.vorname.trim() ? `${antworten.vorname.trim()}, gemeinsam` : "Gemeinsam"} zu {eur(zielrente)} Immobilienrente
        </h3>
        <p className="text-sm leading-relaxed mb-6" style={{ color: "rgba(255,255,255,0.5)" }}>
          So könnten wir das Volumen zügig absichern – {gesamtanzahl} Objekte à {eurK(kaufpreis)} €,
          verteilt auf die nächsten {dauerJahre === 1 ? "12 Monate" : `${dauerJahre} Jahre`}. Danach
          läuft es im Hintergrund weiter: Tilgung, Mietwachstum, Wertsteigerung.
        </p>

        <div>
          {sichtbar.map((w, i) => (
            <div key={i} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="rounded-full flex items-center justify-center shrink-0"
                  style={{ width: 32, height: 32, background: "rgba(201,162,39,0.14)", border: "1px solid rgba(201,162,39,0.4)" }}>
                  <span className="text-xs font-semibold" style={{ color: GOLD_SOFT }}>
                    {w.anzahl > 1 ? `${w.anzahl}×` : i + 1}
                  </span>
                </div>
                {(i < sichtbar.length - 1 || wellenRest > 0) && (
                  <div style={{ width: 1, flex: 1, background: HAIRLINE, minHeight: 24 }} />
                )}
              </div>
              <div className="pb-6">
                <div className="text-sm font-medium">
                  {w.jahr === 0 ? "Jetzt" : `In ${w.jahr} Jahren`} – {w.anzahl > 1 ? `${w.anzahl} Objekte` : "Objekt"}
                </div>
                <div className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                  {w.anzahl > 1 ? "je " : ""}{eurK(w.kaufpreis)} € Kaufpreis
                </div>
              </div>
            </div>
          ))}
          {wellenRest > 0 && (
            <div className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="rounded-full flex items-center justify-center shrink-0"
                  style={{ width: 32, height: 32, background: "rgba(255,255,255,0.05)", border: `1px solid ${HAIRLINE}` }}>
                  <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>+{objekteRest}</span>
                </div>
              </div>
              <div className="pb-1">
                <div className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
                  … und {objekteRest} weitere{objekteRest === 1 ? "s" : ""} Objekt{objekteRest === 1 ? "" : "e"}, bis Jahr {wellen[wellen.length - 1].jahr}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-8">
          <div className="text-xs uppercase tracking-widest mb-4" style={{ color: "rgba(255,255,255,0.35)" }}>
            Und danach
          </div>
          {[
            {
              jahr: meilenstein1Jahr,
              titel: "Erste Immobilie abbezahlt",
              beschreibung: "Die erste Miete gehört dann komplett dir.",
            },
            {
              jahr: meilenstein2Jahr,
              titel: "Alle Immobilien abbezahlt",
              beschreibung: `Deine volle Zielrente von ${eur(zielrente)} im Monat ist erreicht.`,
            },
          ].map((m, i, arr) => (
            <div key={i} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="rounded-full flex items-center justify-center shrink-0"
                  style={{ width: 32, height: 32, background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.4)" }}>
                  <Check size={14} color={GREEN} />
                </div>
                {i < arr.length - 1 && <div style={{ width: 1, flex: 1, background: HAIRLINE, minHeight: 24 }} />}
              </div>
              <div className="pb-6">
                <div className="text-sm font-medium">Jahr {m.jahr} – {m.titel}</div>
                <div className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>{m.beschreibung}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-2xl p-6" style={{ background: "rgba(201,162,39,0.08)", border: `1.5px solid rgba(201,162,39,0.35)` }}>
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest mb-2" style={{ color: GOLD_SOFT }}>
            <TrendingUp size={13} /> Wertentwicklung
          </div>
          <h3 className="text-2xl font-semibold mb-2 leading-snug">
            Und das ist nur der Bonus obendrauf
          </h3>
          <p className="text-sm leading-relaxed mb-6" style={{ color: "rgba(255,255,255,0.55)" }}>
            Deine volle Zielrente von {eur(zielrente)} steht oben bereits fest – ganz ohne
            Wertsteigerung oder Mietwachstum eingerechnet, nur mit der heutigen Miete. Nimmt man{" "}
            {pct(CONFIG.projektion.wertsteigerung)} Wertsteigerung und {pct(CONFIG.objekt.mietsteigerung)}{" "}
            Mietsteigerung pro Jahr trotzdem realistisch an, kommt das hier in Jahr {meilenstein2Jahr},
            wenn alles abbezahlt ist, zusätzlich obendrauf:
          </p>
          <div className="space-y-6">
            <div>
              <div className="text-sm mb-2.5" style={{ color: "rgba(255,255,255,0.75)" }}>Portfolio-Wert</div>
              <div className="flex items-center gap-3">
                <div>
                  <div className="text-xs mb-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>heute</div>
                  <div className="text-base font-medium tabular-nums" style={{ color: "rgba(255,255,255,0.6)" }}>{eur(gesamtwertHeute)}</div>
                </div>
                <ArrowRight size={16} color={GOLD_SOFT} className="shrink-0 mt-3.5" />
                <div>
                  <div className="text-xs mb-0.5" style={{ color: GOLD_SOFT }}>in Jahr {meilenstein2Jahr}</div>
                  <div className="text-2xl font-semibold tabular-nums" style={{ color: GOLD_SOFT }}>{eur(Math.round(gesamtwertDann))}</div>
                </div>
              </div>
            </div>
            <div>
              <div className="text-sm mb-2.5" style={{ color: "rgba(255,255,255,0.75)" }}>Tatsächliche Rente</div>
              <div className="flex items-center gap-3">
                <div>
                  <div className="text-xs mb-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>geplant</div>
                  <div className="text-base font-medium tabular-nums" style={{ color: "rgba(255,255,255,0.6)" }}>{eur(zielrente)} / Monat</div>
                </div>
                <ArrowRight size={16} color={GOLD_SOFT} className="shrink-0 mt-3.5" />
                <div>
                  <div className="text-xs mb-0.5" style={{ color: GOLD_SOFT }}>in Jahr {meilenstein2Jahr}</div>
                  <div className="text-2xl font-semibold tabular-nums" style={{ color: GOLD_SOFT }}>{eur(Math.round(renteDann))} / Monat</div>
                </div>
              </div>
            </div>
          </div>
          <p className="text-xs leading-relaxed mt-6" style={{ color: "rgba(255,255,255,0.35)" }}>
            Fortschreibung der hinterlegten Annahmen, keine Prognose.
          </p>
        </div>

        <div className="rounded-2xl p-4 mt-8" style={{ background: "rgba(201,162,39,0.08)", border: "1px solid rgba(201,162,39,0.25)" }}>
          <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>
            Ist das Volumen gesichert, ist die Kauf-Arbeit getan – der Rest läuft im Hintergrund:
            Tilgung, Mietwachstum, Wertsteigerung. Die Zahlen oben sind bereits konservativ zu
            heutigen Werten gerechnet, eine bis dahin gestiegene Miete kommt on top. Wir begleiten
            dich bei jedem Kauf.
          </p>
        </div>

        <p className="text-xs leading-relaxed mt-5" style={{ color: "rgba(255,255,255,0.32)" }}>
          Beispielrechnung, keine Finanzierungszusage. Wie viele Objekte innerhalb welcher Zeit
          realistisch finanzierbar sind, hängt von deiner Bonität und der Vermietung der jeweils
          vorherigen Objekte ab – das besprechen wir im persönlichen Gespräch.
        </p>
      </Card>
    </Reveal>
  );
}

function Rechenzeile({ label, wert, zeichen, stark }) {
  return (
    <div className="flex items-baseline justify-between py-2">
      <span className="text-sm" style={{ color: stark ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.55)" }}>
        {zeichen && <span className="inline-block w-4 tabular-nums" style={{ color: "rgba(255,255,255,0.35)" }}>{zeichen}</span>}
        {label}
      </span>
      <span className={"tabular-nums " + (stark ? "text-base font-medium" : "text-sm")}
        style={{ color: stark ? GOLD_SOFT : "rgba(255,255,255,0.8)" }}>
        {wert}
      </span>
    </div>
  );
}

function FallstudieHero({ modell, modellChart, kaufpreis, setKaufpreis, jahr, setJahr, ekEinsatz, wertsteigerung }) {
  const heroJahr = jahr;
  const s = modell.stand(heroJahr);

  const [netto, wert, rest, preis] = useSmoothNumbers([
    s.nettovermoegen, s.immobilienwert, s.restschuld, kaufpreis,
  ]);

  const faktor = ekEinsatz >= 1000 ? s.nettovermoegen / ekEinsatz : null;
  const extra = s.kumSteuerwirkung + s.kumCfVorSteuer;

  return (
    <div className="rounded-3xl p-7 md:p-9" style={{
      background: "linear-gradient(165deg, rgba(201,162,39,0.13), rgba(255,255,255,0.025) 55%)",
      border: "1px solid rgba(201,162,39,0.26)",
      boxShadow: "0 24px 70px rgba(0,0,0,0.5)",
    }}>
      <Eyebrow>Fallstudie · Beispielimmobilie</Eyebrow>
      <div className="flex items-center gap-1.5 text-xs mb-5" style={{ color: "rgba(255,255,255,0.4)" }}>
        <UserCheck size={13} color={GOLD_SOFT} />
        Vollständig verwaltet – inklusive Mietverwaltung. Kein Aufwand für dich.
      </div>

      {/* Kaufpreis */}
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>Kaufpreis</span>
        <span className="text-2xl font-semibold tabular-nums">{eur(Math.round(preis / 1000) * 1000)}</span>
      </div>
      <Slider
        kompakt value={kaufpreis} min={200000} max={500000} step={10000}
        onChange={setKaufpreis}
        marken={CONFIG.objekt.kaufpreisOptionen}
        format={(v) => eurK(v) + " €"}
      />

      {/* Zeitraum */}
      <div className="mt-7">
        <div className="text-sm mb-3" style={{ color: "rgba(255,255,255,0.55)" }}>Zeitraum</div>
        <Segment
          optionen={[{ id: 10, label: "10 Jahre" }, { id: 20, label: "20 Jahre" }, { id: 30, label: "30 Jahre" }]}
          wert={heroJahr} onChange={setJahr}
        />
      </div>

      {/* Kernbotschaft */}
      <div className="mt-9 pt-8" style={{ borderTop: "1px solid rgba(201,162,39,0.22)" }}>
        <div className="text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
          Aufgebautes Nettovermögen nach {heroJahr === 1 ? "einem Jahr" : `${heroJahr} Jahren`}
        </div>
        <div className="mt-2 font-semibold tabular-nums tracking-tight leading-none"
          style={{
            fontSize: "clamp(2.75rem, 12vw, 4.5rem)",
            background: `linear-gradient(120deg, #fff 20%, ${GOLD_SOFT})`,
            WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
          }}>
          {eur(Math.round(netto))}
        </div>

        {faktor && (
          <div className="flex items-center gap-3 mt-5 flex-wrap">
            <span className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
              aus {eur(ekEinsatz)} eingesetztem Eigenkapital
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium tabular-nums"
              style={{ background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.35)", color: GREEN }}>
              <TrendingUp size={13} />
              Faktor {faktor.toFixed(1).replace(".", ",")}×
            </span>
          </div>
        )}
        {!faktor && (
          <div className="text-sm mt-5" style={{ color: "rgba(255,255,255,0.5)" }}>
            gerechnet ohne nennenswerten Eigenkapitaleinsatz
          </div>
        )}

        <div className="flex items-start gap-2 text-xs leading-relaxed mt-4" style={{ color: "rgba(255,255,255,0.4)" }}>
          <Info size={13} className="shrink-0 mt-0.5" color={GOLD_SOFT} />
          <span>
            Eigenkapital ist hier nicht zwingend. Je nach Einkommen und Bonität ist auch eine Finanzierung
            ganz ohne Eigenkapital möglich – wie viel du einsetzt, hängt vom individuellen Szenario ab.
          </span>
        </div>
      </div>

      {/* So entsteht die Zahl */}
      <div className="mt-9">
        <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>
          So entsteht das Vermögen
        </div>
        <p className="text-sm leading-relaxed mb-4" style={{ color: "rgba(255,255,255,0.5)" }}>
          Der Wert der Immobilie steigt, die Restschuld sinkt durch die Tilgung.
          Der goldene Bereich dazwischen gehört dir.
        </p>

        <VermoegensBand modell={modellChart ?? modell} jahr={heroJahr} />

        <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3 mb-6">
          <span className="flex items-center gap-2 text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
            <span style={{ width: 14, height: 2, background: GOLD, borderRadius: 99 }} /> Immobilienwert
          </span>
          <span className="flex items-center gap-2 text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
            <span style={{ width: 14, height: 2, background: "#7A7A85", borderRadius: 99 }} /> Restschuld
          </span>
          <span className="flex items-center gap-2 text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
            <span style={{ width: 10, height: 10, background: "rgba(201,162,39,0.35)", borderRadius: 3 }} /> Dein Eigenkapital
          </span>
        </div>

        {/* Die Rechnung in vier Zeilen */}
        <div className="rounded-2xl p-5" style={{ background: "rgba(0,0,0,0.3)", border: `1px solid ${HAIRLINE}` }}>
          <Rechenzeile label={`Immobilienwert nach ${heroJahr} Jahren`} wert={eur(Math.round(wert))} />
          <Rechenzeile label="Restschuld" zeichen="−" wert={eur(Math.round(rest))} />
          <div style={{ borderTop: `1px solid ${HAIRLINE}` }} />
          <Rechenzeile label="Eigenkapital in der Immobilie" zeichen="=" wert={eur(Math.round(wert - rest))} />
          <Rechenzeile label="Steuerwirkung & Cashflow" zeichen={extra >= 0 ? "+" : "−"} wert={eur(Math.abs(Math.round(extra)))} />
          <div style={{ borderTop: `1px solid rgba(201,162,39,0.3)` }} />
          <Rechenzeile label="Nettovermögen" zeichen="=" wert={eur(Math.round(netto))} stark />
        </div>
      </div>

      <Details titel="Alle Annahmen anzeigen">
        <div className="mt-5">
          <Stat label="Darlehensbetrag" value={eur(modell.darlehen)} tone="gold" />
          <Stat label="Monatliche Rate" sub={`${pct(CONFIG.finanzierung.sollzins)} Sollzins · ${pct(CONFIG.finanzierung.anfangstilgung)} Anfangstilgung`} value={eur(modell.rateMonat)} />
          <Stat label="Gesamtkosten" value={eur(modell.gesamtkosten)} />
          <Stat label="Eingesetztes Eigenkapital" value={eur(modell.ekEingesetzt)} />
          <Stat label="Zinsanteil (Jahr 1, monatlich)" value={eur(modell.monat.zinsen)} />
          <Stat label="Tilgungsanteil (Jahr 1, monatlich)" value={eur(modell.rateMonat - modell.monat.zinsen)} />
          <Stat label={`Restschuld nach ${heroJahr} Jahren`} value={eur(s.restschuld)} />
          <Stat label="AfA-Bemessungsgrundlage" sub={`${pct(CONFIG.objekt.gebaeudeanteil)} Gebäudeanteil inkl. anteiliger Nebenkosten`} value={eur(modell.afaBasis)} />
          <Stat label="Angenommene AfA" sub={`${pct(CONFIG.objekt.afaSatz)} p. a. · ${CONFIG.objekt.afaDauerJahre} Jahre`} value={eur(modell.afaJahr) + " / Jahr"} />
          <div className="mt-5">
            <Hinweis>
              Die angenommene AfA von {pct(CONFIG.objekt.afaSatz)} dient ausschließlich der Beispielrechnung
              und hängt in der Praxis unter anderem vom Objekt und der steuerlichen Anerkennung ab.
            </Hinweis>
          </div>
        </div>
      </Details>

      <p className="text-xs leading-relaxed mt-7" style={{ color: "rgba(255,255,255,0.32)" }}>
        Überschlägige Beispielrechnung mit {pct(wertsteigerung)} angenommener Wertsteigerung p. a.
        Laufende Ein- und Auszahlungen sind im Nettovermögen bereits verrechnet. Keine Prognose.
      </p>
    </div>
  );
}

/* =========================================================== Telefon-Gate */
/**
 * Steht zwischen Analyse-Animation und Ergebnisseite. Ein einziges Feld,
 * bewusst kein zweites – jedes weitere Feld hier kostet Abschlussquote,
 * und der Zweck ist ausschließlich "Telefonnummer sichern", nicht Terminbuchung
 * (die passiert weiter unten im vollständigen Formular).
 */
/* ==================================================== Sparraten-Hebel */
/**
 * Zeigt, was dieselbe monatliche Sparrate auf drei Wegen wird – und bei der
 * Immobilie zusätzlich, wie viel davon eigenes Geld ist und wie viel über
 * die Miete vom Mieter mitfinanziert wird. Ungegatet, direkt nach dem
 * Score-Teaser, vor dem Telefon-Gate – der stärkste Moment kommt vor der Frage.
 */
function SparHebelVergleich({ antworten, onWeiter }) {
  const steuersatz = useMemo(() => grenzsteuersatz(antworten.brutto, antworten.status), [antworten]);
  const [jahre, setJahre] = useState(20);
  const daten = useMemo(
    () => schaetzeSparratenHebel(antworten.zielrente, steuersatz, jahre),
    [antworten.zielrente, steuersatz, jahre]
  );

  const Zeile = ({ label, wert, farbe, stark }) => (
    <div className="flex items-center justify-between py-1.5">
      <span className="flex items-center gap-2 text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
        <span className="shrink-0" style={{ width: 8, height: 8, borderRadius: 99, background: farbe }} />
        {label}
      </span>
      <span className={"tabular-nums " + (stark ? "text-base font-semibold" : "text-sm")}
        style={{ color: stark ? GOLD_SOFT : "rgba(255,255,255,0.85)" }}>
        {eur(Math.round(wert))}
      </span>
    </div>
  );

  const geschenktAnteil = daten.immoGesamt > 0 ? Math.round((daten.geschenkt / daten.immoGesamt) * 100) : 0;
  const FARBE_SPAR = "#A8A8B3";
  const FARBE_ETF = "#6FA3E0";

  // Punkt am Linienende – damit auf einen Blick klar ist, welche Linie wo
  // endet, auch wenn ETF und Tagesgeld nah beieinander verlaufen.
  const endPunkt = (farbe) => (props) => {
    const { cx, cy, index } = props;
    if (index !== daten.verlauf.length - 1) return null;
    return <circle key="end" cx={cx} cy={cy} r={4} fill={farbe} stroke={INK} strokeWidth={2} />;
  };

  return (
    <div className="min-h-screen px-5 pt-10 pb-10 max-w-md mx-auto flex flex-col justify-center">
      <div style={{ animation: "vkIn .6s cubic-bezier(.16,1,.3,1)" }}>
        <Card className="p-7">
          <Eyebrow>Dein Kaufplan im Vergleich</Eyebrow>
          {antworten.ziele.includes("Vermögen aufbauen") && <ZielBadge text="Passt zu deinem Ziel: Vermögen aufbauen" />}
          <h3 className="text-xl font-semibold mb-2 leading-snug">
            {eur(daten.monatlicheRate)} im Monat – drei Wege
          </h3>
          <p className="text-sm leading-relaxed mb-5" style={{ color: "rgba(255,255,255,0.5)" }}>
            Die monatliche Belastung für deine {daten.anzahl} Immobilie{daten.anzahl === 1 ? "" : "n"} –
            einmal auf dem Tagesgeldkonto, einmal im ETF-Sparplan, einmal wie geplant investiert.
            Selbst der renditestärkere ETF-Sparplan bleibt deutlich hinter der Immobilie zurück.
          </p>

          <div className="mb-6">
            <Segment
              optionen={[{ id: 10, label: "10 Jahre" }, { id: 20, label: "20 Jahre" }]}
              wert={jahre} onChange={setJahre}
            />
          </div>

          {/* Liniendiagramm statt statischer Balken – zeigt, wie der Unterschied
              über die Jahre wächst, nicht nur den Endstand. */}
          <div className="-mx-2" style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={daten.verlauf} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="sh-immo" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={GOLD} stopOpacity="0.45" />
                    <stop offset="100%" stopColor={GOLD} stopOpacity="0.04" />
                  </linearGradient>
                </defs>
                <XAxis dataKey="jahr" tick={{ fill: "rgba(255,255,255,0.32)", fontSize: 11 }}
                  tickLine={false} axisLine={{ stroke: HAIRLINE }}
                  tickFormatter={(v) => (v === 0 ? "heute" : `${v}J`)} />
                <YAxis tick={{ fill: "rgba(255,255,255,0.32)", fontSize: 11 }} tickLine={false}
                  axisLine={false} width={42} tickFormatter={(v) => eurK(v)} />
                <Area type="monotone" dataKey="Immobilie" stroke={GOLD} strokeWidth={2.5}
                  fill="url(#sh-immo)" dot={endPunkt(GOLD)} isAnimationActive={false} />
                <Line type="monotone" dataKey="ETF" stroke={FARBE_ETF} strokeWidth={2}
                  dot={endPunkt(FARBE_ETF)} isAnimationActive={false} />
                <Line type="monotone" dataKey="Tagesgeld" stroke={FARBE_SPAR} strokeWidth={2}
                  strokeDasharray="4 3" dot={endPunkt(FARBE_SPAR)} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2 mb-6">
            <span className="flex items-center gap-1.5 text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
              <span style={{ width: 10, height: 2, background: GOLD, borderRadius: 99 }} /> Immobilie
            </span>
            <span className="flex items-center gap-1.5 text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
              <span style={{ width: 10, height: 2, background: FARBE_ETF, borderRadius: 99 }} /> ETF
            </span>
            <span className="flex items-center gap-1.5 text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
              <span style={{ width: 10, height: 2, background: FARBE_SPAR, borderRadius: 99, backgroundImage: `repeating-linear-gradient(90deg, ${FARBE_SPAR} 0 4px, transparent 4px 7px)` }} /> Tagesgeld
            </span>
          </div>

          <div className="rounded-2xl p-4" style={{ background: "rgba(0,0,0,0.3)", border: `1px solid ${HAIRLINE}` }}>
            <div className="text-xs uppercase tracking-widest mb-2" style={{ color: "rgba(255,255,255,0.35)" }}>
              Nach {jahre} Jahren
            </div>
            <Zeile label="Tagesgeld" wert={daten.tagesgeld} farbe={FARBE_SPAR} />
            <Zeile label="ETF" wert={daten.etf} farbe={FARBE_ETF} />
            <div className="text-xs pl-4 -mt-1 mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>
              ETF bringt {eur(Math.round(daten.etf - daten.tagesgeld))} mehr als Tagesgeld
            </div>
            <Zeile label={`Immobilie (${daten.anzahl}×)`} wert={daten.immoGesamt} farbe={GOLD} stark />
            <div className="pt-2 mt-2" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
              <Zeile label="davon eigener Einsatz" wert={daten.eigenerEinsatz} farbe="#9A6A3D" />
              <Zeile label="davon vom Mieter mitfinanziert" wert={daten.geschenkt} farbe={GOLD} />
            </div>
          </div>

          <div className="rounded-2xl p-4 mt-4" style={{ background: "rgba(201,162,39,0.08)", border: "1px solid rgba(201,162,39,0.25)" }}>
            <div className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>
              Bei Tagesgeld und ETF ist jeder Euro dein eigener. Bei der Immobilie sind es nur rund{" "}
              <span style={{ color: GOLD_SOFT, fontWeight: 600 }}>{100 - geschenktAnteil} %</span> – den Rest,
              rund <span style={{ color: GOLD_SOFT, fontWeight: 600 }}>{geschenktAnteil} %</span>, zahlt
              über die Miete dein Mieter mit.
            </div>
          </div>

          <p className="text-xs leading-relaxed mt-5" style={{ color: "rgba(255,255,255,0.32)" }}>
            Beispielrechnung mit {eurK(CONFIG.objekt.kaufpreisDefault)} € Kaufpreis je Objekt und{" "}
            {eur(daten.belastungMonat)} monatlicher Belastung pro Objekt – Wert aus Jahr 1, vereinfacht
            über den Zeitraum konstant gerechnet. Kaufnebenkosten als mitfinanziert angenommen.
            Kein Eigenkapital vorausgesetzt. Keine Prognose.
          </p>

          <p className="text-sm leading-relaxed mt-6 text-center" style={{ color: "rgba(255,255,255,0.55)" }}>
            Jetzt wird's konkret: Schritt für Schritt statt auf einen Schlag – wie genau,
            zeigt dir dein ganz persönlicher Plan.
          </p>

          <div className="mt-4">
            <GoldButton full onClick={onWeiter}>
              Meinen persönlichen Plan ansehen <ArrowRight size={18} />
            </GoldButton>
          </div>
        </Card>
      </div>
    </div>
  );
}

function TelefonGate({ antworten, onWeiter }) {
  const [name, setName] = useState("");
  const [telefon, setTelefon] = useState("");
  const [einwilligung, setEinwilligung] = useState(false);
  const [fehler, setFehler] = useState("");

  const zuwartenProJahr = useMemo(() => schaetzeZuwartenProJahr(antworten), [antworten]);
  const vornameAnzeige = name.trim().split(/\s+/)[0] || "";

  const weiter = () => {
    if (telefon.replace(/\D/g, "").length < 7) return setFehler("Die Telefonnummer ist zu kurz.");
    if (!einwilligung) return setFehler("Bitte bestätige die Einwilligung zur Kontaktaufnahme.");
    setFehler("");
    trackLead({ quelle: "telefon_gate" });
    // Ein Feld für den ganzen Namen, geht schneller auszufüllen – beim
    // Absenden am ersten Leerzeichen in Vor- und Nachname aufgeteilt, damit
    // das finale Formular beide Felder trotzdem einzeln vorausfüllen kann.
    const teile = name.trim().split(/\s+/);
    onWeiter(telefon, teile[0] || "", teile.slice(1).join(" "));
  };

  return (
    <div className="min-h-screen flex flex-col items-center px-5 pt-16 md:justify-center md:pt-5" style={{ minHeight: "100dvh" }}>
      <div className="w-full max-w-md" style={{ animation: "vkIn .6s cubic-bezier(.16,1,.3,1)" }}>
        <Eyebrow>{vornameAnzeige ? `Fast geschafft, ${vornameAnzeige}` : "Fast geschafft"}</Eyebrow>
        <h2 className="text-2xl md:text-3xl font-semibold leading-snug tracking-tight mb-3">
          Weiter zu deinem persönlichen Kaufplan, Cashflow und Steuern
        </h2>
        <p className="text-sm leading-relaxed mb-6" style={{ color: "rgba(255,255,255,0.5)" }}>
          Trag deine Kontaktdaten ein, damit wir dich bei Rückfragen zu deiner Auswertung erreichen können.
        </p>

        {zuwartenProJahr !== null && zuwartenProJahr > 0 && (
          <div className="rounded-2xl p-4 mb-6 flex gap-2.5" style={{ background: "rgba(201,162,39,0.08)", border: "1px solid rgba(201,162,39,0.25)" }}>
            <Info size={14} color={GOLD_SOFT} className="shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>
              Jedes Jahr, das du wartest, kostet dich nach deinen Angaben im Schnitt rund{" "}
              <span style={{ color: GOLD_SOFT }}>{eur(zuwartenProJahr)}</span> Vermögen – Zeit, die sich
              nicht nachkaufen lässt. Wartest du zwei Jahre statt einem, sind es entsprechend rund{" "}
              {eur(zuwartenProJahr * 2)}. Wir begleiten dich dabei, jetzt den passenden Einstieg zu finden.
            </p>
          </div>
        )}

        <label className="text-xs block mb-2" style={{ color: "rgba(255,255,255,0.45)" }}>Name</label>
        <input
          type="text" value={name} autoFocus
          name="name" autoComplete="name"
          onChange={(e) => setName(e.target.value)}
          placeholder="Max Mustermann"
          className="w-full rounded-xl px-4 py-3.5 text-base outline-none transition-colors mb-4"
          style={{ background: "rgba(0,0,0,0.35)", border: `1px solid ${HAIRLINE}`, color: "#fff" }}
          onFocus={(e) => (e.target.style.borderColor = GOLD)}
          onBlur={(e) => (e.target.style.borderColor = HAIRLINE)}
        />

        <label className="text-xs block mb-2" style={{ color: "rgba(255,255,255,0.45)" }}>Telefonnummer</label>
        <input
          type="tel" value={telefon} inputMode="tel"
          name="tel" autoComplete="tel"
          onChange={(e) => setTelefon(e.target.value)}
          placeholder="0157 12345678"
          className="w-full rounded-xl px-4 py-3.5 text-base outline-none transition-colors"
          style={{ background: "rgba(0,0,0,0.35)", border: `1px solid ${HAIRLINE}`, color: "#fff" }}
          onFocus={(e) => {
            e.target.style.borderColor = GOLD;
            setTimeout(() => e.target.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
          }}
          onBlur={(e) => (e.target.style.borderColor = HAIRLINE)}
        />

        <label className="flex items-start gap-3 mt-4 cursor-pointer">
          <span
            onClick={() => setEinwilligung(!einwilligung)}
            className="flex items-center justify-center shrink-0 transition-all duration-200 mt-0.5"
            style={{
              width: 20, height: 20, borderRadius: 6,
              border: `1px solid ${einwilligung ? GOLD : "rgba(255,255,255,0.25)"}`,
              background: einwilligung ? GOLD : "transparent",
            }}
          >
            {einwilligung && <Check size={12} strokeWidth={3} color="#15130B" />}
          </span>
          <span className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}
            onClick={() => setEinwilligung(!einwilligung)}>
            Ich bin damit einverstanden, dass {CONFIG.marke.name} / {CONFIG.marke.firma} mich telefonisch
            oder per WhatsApp zu meiner Anfrage kontaktiert. Widerruf jederzeit möglich.
          </span>
        </label>

        {fehler && <div className="text-sm mt-4" style={{ color: "#F87171" }}>{fehler}</div>}

        <div className="mt-6">
          <GoldButton full onClick={weiter}>
            Weiter zur Auswertung <ArrowRight size={18} />
          </GoldButton>
        </div>

        <p className="text-xs leading-relaxed mt-4 text-center" style={{ color: "rgba(255,255,255,0.3)" }}>
          Keine Weitergabe an Dritte. Nur für deine Auswertung und Rückfragen dazu.
        </p>
      </div>
    </div>
  );
}

/* ======================================================== Ergebnisseite */
/** Zeichnet das persönliche Ergebnis als teilbares 9:16-Bild (Canvas-API,
 * kein zusätzliches Paket nötig) und löst direkt den Download aus – gedacht
 * zum Teilen in der Instagram Story. */
function StoryKarteButton({ nettovermoegen, jahr, faktor }) {
  const erstelleUndSpeichern = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1080; canvas.height = 1920;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, 1080, 1920);

    const glow = ctx.createRadialGradient(540, 320, 0, 540, 320, 720);
    glow.addColorStop(0, "rgba(201,162,39,0.28)");
    glow.addColorStop(1, "rgba(201,162,39,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 1080, 1920);

    ctx.textAlign = "center";
    ctx.fillStyle = GOLD;
    ctx.font = "600 30px system-ui, -apple-system, sans-serif";
    ctx.fillText("MEINE VERMÖGENSANALYSE", 540, 720);

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "400 34px system-ui, sans-serif";
    ctx.fillText(`Nettovermögen nach ${jahr} Jahren`, 540, 800);

    const zahlGradient = ctx.createLinearGradient(140, 0, 940, 0);
    zahlGradient.addColorStop(0, "#ffffff");
    zahlGradient.addColorStop(1, GOLD_SOFT);
    ctx.fillStyle = zahlGradient;
    ctx.font = "700 108px system-ui, sans-serif";
    ctx.fillText(eur(Math.round(nettovermoegen)), 540, 940);

    if (faktor && faktor > 1) {
      ctx.fillStyle = GREEN;
      ctx.font = "500 36px system-ui, sans-serif";
      ctx.fillText(`${faktor.toFixed(1).replace(".", ",")}× mehr als Tagesgeld`, 540, 1030);
    }

    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "400 30px system-ui, sans-serif";
    ctx.fillText("philippstreib.com/analyse", 540, 1820);

    const link = document.createElement("a");
    link.download = "meine-vermoegensanalyse.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    trackEvent("story_karte_download");
  };

  return (
    <button onClick={erstelleUndSpeichern}
      className="w-full flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-medium transition-colors"
      style={{ background: "rgba(201,162,39,0.1)", border: "1px solid rgba(201,162,39,0.3)", color: GOLD_SOFT }}>
      <Download size={16} /> Für Story speichern
    </button>
  );
}

function Ergebnis({ antworten, onNeu, telefonVorausgefuellt, onImpressum, onDatenschutz, leadId }) {
  const [kaufpreis, setKaufpreis] = useState(CONFIG.objekt.kaufpreisDefault);
  const [jahr, setJahr] = useState(CONFIG.projektion.betrachtungJahre);
  const [formOffen, setFormOffen] = useState(false);
  const heroRef = useRef(null);
  const ctaRef = useRef(null);
  const heroVergangen = useScrolledPast(heroRef);
  const ctaSichtbar = useSichtbarkeit(ctaRef);

  const zumCta = () => {
    setFormOffen(true);
    trackEvent("sticky_cta_click");
    ctaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const steuersatz = useMemo(() => grenzsteuersatz(antworten.brutto, antworten.status), [antworten]);
  const wertsteigerung = CONFIG.projektion.wertsteigerung;
  const ekEinsatz = Math.min(antworten.eigenkapitalEinsatz, antworten.eigenkapital);

  const modell = useMemo(() => berechneModell({
    kaufpreis, eigenkapitalEinsatz: ekEinsatz, steuersatz, wertsteigerung,
  }), [kaufpreis, ekEinsatz, steuersatz, wertsteigerung]);

  // Die Diagramme hängen einen Tick hinterher, damit das Ziehen flüssig bleibt.
  const kaufpreisTraege = useDeferredValue(kaufpreis);
  const modellTraege = useMemo(() => berechneModell({
    kaufpreis: kaufpreisTraege, eigenkapitalEinsatz: ekEinsatz, steuersatz, wertsteigerung,
  }), [kaufpreisTraege, ekEinsatz, steuersatz, wertsteigerung]);

  const stand = modell.stand(jahr);
  const m = modell.monat;

  const cfTon = m.cfNachSteuer > 15 ? "green" : m.cfNachSteuer > -50 ? "gold" : "neutral";

  // Kosten des Zuwartens: derselbe Helfer wie im Telefon-Gate, nur mit den vom Nutzer gewählten Werten.
  const zuwartenDelta = schaetzeZuwartenProJahr(antworten, { kaufpreis, jahr });

  // Für die Story-Karte: derselbe Belastung-vs-Tagesgeld-Vergleich wie im
  // DreiWegeVergleich auf der Startseite, hier mit den persönlichen Werten.
  const belastungMonat = Math.max(0, Math.round(-m.cfNachSteuer));
  const tagesgeldVergleich = useMemo(() => {
    const jahresbeitrag = belastungMonat * 12;
    let summe = 0;
    for (let j = 1; j <= jahr; j++) summe += jahresbeitrag * Math.pow(1 + CONFIG.vergleich.sparzins, jahr - j);
    return summe;
  }, [belastungMonat, jahr]);
  const faktorVsTagesgeld = tagesgeldVergleich > 0 ? stand.nettovermoegen / tagesgeldVergleich : null;

  return (
    <div className="min-h-screen px-5 pt-10 pb-24 max-w-3xl mx-auto space-y-5">
      <StickyCTA sichtbar={heroVergangen && !ctaSichtbar} onClick={zumCta} />

      {/* Kaufplan zur Zielrente – zuerst, löst das Versprechen vom Sparraten-Screen direkt ein */}
      <Kaufplan antworten={antworten} />

      {/* Fallstudie – der Beweis hinter dem Plan: wie eines dieser Objekte im Detail funktioniert */}
      <div ref={heroRef}>
      <Reveal>
        <FallstudieHero
          modell={modell} modellChart={modellTraege}
          kaufpreis={kaufpreis} setKaufpreis={setKaufpreis}
          jahr={jahr} setJahr={setJahr} ekEinsatz={ekEinsatz} wertsteigerung={wertsteigerung}
        />
      </Reveal>
      </div>

      <Reveal>
        <StoryKarteButton nettovermoegen={stand.nettovermoegen} jahr={jahr} faktor={faktorVsTagesgeld} />
      </Reveal>

      {/* Monatliche Betrachtung */}
      <Reveal>
        <Card className="p-7">
        <Eyebrow>Monatlich · Jahr 1</Eyebrow>
        <h3 className="text-xl font-semibold mb-5">Was die Wohnung kostet</h3>
        <Stat label="Kaltmiete" sub={`${pct(CONFIG.objekt.bruttomietrendite)} Bruttomietrendite · steigt jährlich um ${pct(CONFIG.objekt.mietsteigerung)}`} value={"+ " + eur(m.kaltmiete)} />
        <Stat label="Kreditrate" value={"− " + eur(m.rate)} />
        <Stat label="Nicht umlagefähige Kosten" value={"− " + eur(m.nichtUml)} />

        <div className="mt-7 rounded-2xl p-5" style={{
          background: cfTon === "green" ? "rgba(52,211,153,0.07)" : cfTon === "gold" ? "rgba(201,162,39,0.07)" : "rgba(255,255,255,0.03)",
          border: `1px solid ${cfTon === "green" ? "rgba(52,211,153,0.3)" : cfTon === "gold" ? "rgba(201,162,39,0.3)" : HAIRLINE}`,
        }}>
          <div className="flex justify-between text-sm py-1.5">
            <span style={{ color: "rgba(255,255,255,0.6)" }}>Cashflow vor Steuern</span>
            <span className="tabular-nums">{eur(m.cfVorSteuer)}</span>
          </div>
          <div className="flex justify-between text-sm py-1.5">
            <span style={{ color: "rgba(255,255,255,0.6)" }}>Geschätzte Steuerwirkung</span>
            <span className="tabular-nums">{(m.steuerwirkung >= 0 ? "+ " : "− ") + eur(Math.abs(m.steuerwirkung))}</span>
          </div>
          <div className="flex justify-between items-baseline pt-4 mt-2" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
            <span className="text-sm" style={{ color: "rgba(255,255,255,0.85)" }}>Cashflow nach Steuern</span>
            <span className="text-2xl font-semibold tabular-nums"
              style={{ color: cfTon === "green" ? GREEN : cfTon === "gold" ? GOLD_SOFT : "#fff" }}>
              {(m.cfNachSteuer >= 0 ? "+" : "−") + eur(Math.abs(m.cfNachSteuer))}
            </span>
          </div>
        </div>

        <p className="text-sm leading-relaxed mt-5" style={{ color: "rgba(255,255,255,0.5)" }}>
          {cfTon === "green"
            ? "Die Miete deckt die gesamte monatliche Belastung und wirft sogar etwas ab – die Immobilie trägt sich in diesem Beispiel vollständig selbst."
            : cfTon === "gold"
              ? "Die Miete deckt die Kreditrate nahezu vollständig – die monatliche Belastung ist gering, die Immobilie trägt sich damit weitgehend von selbst."
              : "Ein Teil der Kreditrate wird durch die Miete gedeckt, der Rest kommt aus eigener Tasche – wie viel, hängt von Kaufpreis und Eigenkapitaleinsatz ab."}
        </p>

        <Details titel="Steuerliche Betrachtung anzeigen">
          <div className="mt-4">
            <Stat label="Kaltmiete" value={"+ " + eur(m.kaltmiete)} />
            <Stat label="Schuldzinsen" value={"− " + eur(m.zinsen)} />
            <Stat label="Angenommene AfA" value={"− " + eur(m.afa)} />
            <Stat label="Nicht umlagefähige Kosten" value={"− " + eur(m.nichtUml)} />
            <Stat label="Steuerliches Ergebnis" value={eur(m.steuerErgebnis)} />
            <Stat label="Grenzsteuersatz (geschätzt)" value={pct(steuersatz, 1)} />
            <div className="mt-5">
              <Hinweis>
                Die Steuerwirkung wird überschlägig mit dem geschätzten Grenzsteuersatz auf das steuerliche
                Ergebnis der Vermietung angesetzt. Sie verringert sich im Zeitverlauf, weil der Zinsanteil sinkt
                und die Miete steigt. Keine Zusage über tatsächliche Steuererstattungen.
              </Hinweis>
            </div>
          </div>
        </Details>
        </Card>
      </Reveal>

      {/* Stimmen – nur im DOM, wenn echte Einträge vorhanden sind (kein Leerraum sonst) */}
      {CONFIG.testimonials.length > 0 && (
        <Reveal>
          <Testimonials />
        </Reveal>
      )}

      {/* Abschluss */}
      <div ref={ctaRef}>
      <Reveal>
        <div className="rounded-3xl p-8 md:p-10 mt-10"
          style={{ background: "linear-gradient(160deg, rgba(201,162,39,0.14), rgba(255,255,255,0.02))", border: `1px solid rgba(201,162,39,0.28)` }}>
          <h3 className="text-2xl md:text-3xl font-semibold leading-snug tracking-tight">
            Deine persönliche Vermögensstrategie wartet auf dich.
          </h3>
          <p className="text-sm md:text-base mt-5 leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>
            Diese Auswertung ist eine überschlägige Beispielrechnung auf Basis deiner Angaben und allgemeiner
            Annahmen. In einem persönlichen Gespräch analysieren wir deine individuelle Situation, prüfen
            geeignete Kapitalanlagen und zeigen dir, welche Finanzierungs- und Steuerpotenziale zu deinen Zielen passen.
          </p>

          {zuwartenDelta !== null && zuwartenDelta > 0 && (
            <p className="text-sm mt-4 leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
              In diesem Beispiel kostet jedes Jahr, das du wartest, im Schnitt rund {eur(zuwartenDelta)} Vermögen nach {jahr} Jahren
              – weil dann weniger Zeit zum Wachsen bleibt.
            </p>
          )}

          <div className="mt-7 pt-6 space-y-3" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
            <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>
              So läuft das Gespräch ab
            </div>
            {[
              { icon: Clock, text: "15 Minuten, telefonisch oder per Video" },
              { icon: Info, text: "Wir schauen uns deine Situation konkret an" },
              { icon: Check, text: "Unverbindlich – kein Verkaufsdruck" },
            ].map((p) => (
              <div key={p.text} className="flex items-center gap-2.5 text-sm" style={{ color: "rgba(255,255,255,0.65)" }}>
                <p.icon size={15} color={GOLD_SOFT} className="shrink-0" />
                {p.text}
              </div>
            ))}
          </div>

          <div className="mt-7 space-y-3">
            {!formOffen && (
              <GoldButton full onClick={() => { setFormOffen(true); trackEvent("cta_form_open"); }}>
                Kostenlose Vermögensanalyse vereinbaren <ChevronRight size={18} />
              </GoldButton>
            )}
            <a href={waLink()} target="_blank" rel="noopener noreferrer"
              onClick={() => trackEvent("whatsapp_click")}
              className="flex items-center justify-center gap-2 rounded-full px-7 py-4 text-base font-medium transition-colors"
              style={{ background: "rgba(52,211,153,0.10)", border: "1px solid rgba(52,211,153,0.35)", color: GREEN }}>
              <MessageCircle size={18} /> Direkt per WhatsApp schreiben
            </a>
          </div>

          {formOffen && <KontaktFormular telefonVorausgefuellt={telefonVorausgefuellt} vornameVorausgefuellt={antworten.vorname} nachnameVorausgefuellt={antworten.nachname} leadId={leadId} />}
        </div>
      </Reveal>
      </div>

      <div className="text-center pt-6 flex items-center justify-center gap-4">
        <button onClick={onNeu} className="text-xs underline underline-offset-4" style={{ color: "rgba(255,255,255,0.3)" }}>
          Immokompass neu starten
        </button>
        <button onClick={onImpressum} className="text-xs underline underline-offset-4" style={{ color: "rgba(255,255,255,0.3)" }}>
          Impressum
        </button>
        <button onClick={onDatenschutz} className="text-xs underline underline-offset-4" style={{ color: "rgba(255,255,255,0.3)" }}>
          Datenschutz
        </button>
      </div>

      <p className="text-xs leading-relaxed text-center pt-4" style={{ color: "rgba(255,255,255,0.25)" }}>
        Alle Werte sind unverbindliche Beispielrechnungen und keine Prognose. Keine Steuer-, Rechts- oder Anlageberatung.
      </p>
    </div>
  );
}

/* =========================================================== Kontaktform */
const TERMINE = ["Vormittags", "Nachmittags", "Abends", "Flexibel"];

/* ============================================================== Impressum */
/** Wiederverwendbarer Abschnitt für Impressum und Datenschutzerklärung. */
function RechtstextAbschnitt({ titel, children }) {
  return (
    <div className="mt-6">
      <div className="text-xs uppercase tracking-widest mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>{titel}</div>
      <div className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>{children}</div>
    </div>
  );
}

function Impressum({ onZurueck }) {
  const I = CONFIG.impressum;
  const Abschnitt = RechtstextAbschnitt;

  return (
    <div className="min-h-screen px-5 pt-10 pb-20 max-w-2xl mx-auto">
      <button onClick={onZurueck} className="flex items-center gap-1.5 text-sm mb-8 -ml-1 p-1" style={{ color: "rgba(255,255,255,0.5)" }}>
        <ArrowLeft size={16} /> Zurück
      </button>
      <h1 className="text-2xl font-semibold tracking-tight">Impressum</h1>

      <div className="mt-6 text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>
        <div>{I.name}</div>
        <div>{I.firma}</div>
        <div>{I.strasse}</div>
        <div>{I.ort}</div>
      </div>

      <Abschnitt titel="Kontakt">
        <div>Telefon: {I.telefon}</div>
        <div>E-Mail: {I.email}</div>
      </Abschnitt>

      <Abschnitt titel="Umsatzsteuer-ID">
        Umsatzsteuer-Identifikationsnummer gemäß § 27 a Umsatzsteuergesetz:<br />
        {I.ustId}
      </Abschnitt>

      <Abschnitt titel="Gewerbeanmeldung">
        Die Gewerbeerlaubnis nach § 34c GewO wurde am {I.gewerbeDatum} von folgender Stelle erteilt: {I.gewerbeStelle}.
      </Abschnitt>

      <Abschnitt titel="Verbraucherstreitbeilegung / Universalschlichtungsstelle">
        Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.
      </Abschnitt>

      <Abschnitt titel="Zentrale Kontaktstelle nach dem Digital Services Act – DSA (Verordnung (EU) 2022/2065)">
        Unsere zentrale Kontaktstelle für Nutzer und Behörden nach Art. 11, 12 DSA erreichen Sie wie folgt:<br />
        E-Mail: {I.dsaEmail}<br />
        Telefon: {I.dsaTelefon}<br />
        Die für den Kontakt zur Verfügung stehenden Sprachen sind: {I.dsaSprachen}.
      </Abschnitt>
    </div>
  );
}

/* ========================================================= Datenschutz */
function Datenschutz({ onZurueck }) {
  const I = CONFIG.impressum;
  const Abschnitt = RechtstextAbschnitt;
  const Untertitel = ({ children }) => (
    <div className="text-sm font-semibold mt-4 mb-1.5" style={{ color: "#fff" }}>{children}</div>
  );

  return (
    <div className="min-h-screen px-5 pt-10 pb-20 max-w-2xl mx-auto">
      <button onClick={onZurueck} className="flex items-center gap-1.5 text-sm mb-8 -ml-1 p-1" style={{ color: "rgba(255,255,255,0.5)" }}>
        <ArrowLeft size={16} /> Zurück
      </button>
      <h1 className="text-2xl font-semibold tracking-tight">Datenschutzerklärung</h1>

      <Abschnitt titel="1. Datenschutz auf einen Blick">
        <Untertitel>Allgemeine Hinweise</Untertitel>
        Die folgenden Hinweise geben einen einfachen Überblick darüber, was mit Ihren personenbezogenen
        Daten passiert, wenn Sie diese Website besuchen. Personenbezogene Daten sind alle Daten, mit denen
        Sie persönlich identifiziert werden können. Ausführliche Informationen zum Thema Datenschutz
        entnehmen Sie unserer unter diesem Text aufgeführten Datenschutzerklärung.

        <Untertitel>Datenerfassung auf dieser Website</Untertitel>
        <strong style={{ color: "#fff" }}>Wer ist verantwortlich für die Datenerfassung auf dieser Website?</strong><br />
        Die Datenverarbeitung auf dieser Website erfolgt durch den Websitebetreiber. Dessen Kontaktdaten
        können Sie dem Abschnitt „Hinweis zur verantwortlichen Stelle" in dieser Datenschutzerklärung entnehmen.
        <br /><br />
        <strong style={{ color: "#fff" }}>Wie erfassen wir Ihre Daten?</strong><br />
        Ihre Daten werden zum einen dadurch erhoben, dass Sie uns diese mitteilen. Hierbei kann es sich
        z. B. um Daten handeln, die Sie in ein Kontaktformular eingeben.<br />
        Andere Daten werden automatisch oder nach Ihrer Einwilligung beim Besuch der Website durch unsere
        IT-Systeme erfasst. Das sind vor allem technische Daten (z. B. Internetbrowser, Betriebssystem
        oder Uhrzeit des Seitenaufrufs). Die Erfassung dieser Daten erfolgt automatisch, sobald Sie diese
        Website betreten.
        <br /><br />
        <strong style={{ color: "#fff" }}>Wofür nutzen wir Ihre Daten?</strong><br />
        Ein Teil der Daten wird erhoben, um eine fehlerfreie Bereitstellung der Website zu gewährleisten.
        Andere Daten können zur Analyse Ihres Nutzerverhaltens verwendet werden. Sofern über die Website
        ein Beratungsgespräch angefragt wird, werden die übermittelten Daten zur Bearbeitung dieser Anfrage
        verarbeitet.
        <br /><br />
        <strong style={{ color: "#fff" }}>Welche Rechte haben Sie bezüglich Ihrer Daten?</strong><br />
        Sie haben jederzeit das Recht, unentgeltlich Auskunft über Herkunft, Empfänger und Zweck Ihrer
        gespeicherten personenbezogenen Daten zu erhalten. Sie haben außerdem ein Recht, die Berichtigung
        oder Löschung dieser Daten zu verlangen. Wenn Sie eine Einwilligung zur Datenverarbeitung erteilt
        haben, können Sie diese Einwilligung jederzeit für die Zukunft widerrufen. Außerdem haben Sie das
        Recht, unter bestimmten Umständen die Einschränkung der Verarbeitung Ihrer personenbezogenen Daten
        zu verlangen. Des Weiteren steht Ihnen ein Beschwerderecht bei der zuständigen Aufsichtsbehörde zu.
        Hierzu sowie zu weiteren Fragen zum Thema Datenschutz können Sie sich jederzeit an uns wenden.
      </Abschnitt>

      <Abschnitt titel="2. Hosting">
        <Untertitel>Externes Hosting</Untertitel>
        Diese Website wird extern gehostet. Die personenbezogenen Daten, die auf dieser Website erfasst
        werden, werden auf den Servern des Hosters gespeichert. Hierbei kann es sich v. a. um IP-Adressen,
        Kontaktanfragen, Meta- und Kommunikationsdaten, Namen, Websitezugriffe und sonstige Daten, die über
        eine Website generiert werden, handeln.
        <br /><br />
        Das externe Hosting erfolgt zum Zwecke der Vertragserfüllung gegenüber unseren potenziellen und
        bestehenden Kunden (Art. 6 Abs. 1 lit. b DSGVO) und im Interesse einer sicheren, schnellen und
        effizienten Bereitstellung unseres Online-Angebots durch einen professionellen Anbieter (Art. 6
        Abs. 1 lit. f DSGVO). Sofern eine entsprechende Einwilligung abgefragt wurde, erfolgt die
        Verarbeitung ausschließlich auf Grundlage von Art. 6 Abs. 1 lit. a DSGVO und § 25 Abs. 1 TDDDG,
        soweit die Einwilligung die Speicherung von Cookies oder den Zugriff auf Informationen im
        Endgerät des Nutzers umfasst. Die Einwilligung ist jederzeit widerrufbar.
        <br /><br />
        Unser Hoster wird Ihre Daten nur insoweit verarbeiten, wie dies zur Erfüllung seiner
        Leistungspflichten erforderlich ist, und unsere Weisungen in Bezug auf diese Daten befolgen.
        <br /><br />
        Wir setzen folgenden Hoster ein: Vercel Inc., 340 S Lemon Ave #4133, Walnut, CA 91789, USA. Vercel
        stellt die technische Infrastruktur bereit, die für den Abruf und die Auslieferung unserer Seiten
        notwendig ist. Beim Besuch unserer Website werden automatisch bestimmte Verbindungsdaten an Vercel
        übermittelt – darunter etwa Ihre IP-Adresse, Informationen zu Ihrem Browser, Datum und Uhrzeit des
        Zugriffs sowie aufgerufene Ressourcen. Diese Verarbeitung ist erforderlich, um die Stabilität und
        Sicherheit des Webangebots zu gewährleisten und beruht auf Art. 6 Abs. 1 lit. f DSGVO
        (berechtigtes Interesse).

        <Untertitel>Übermittlung personenbezogener Daten in die USA</Untertitel>
        Vercel kann Daten auch auf Servern in den Vereinigten Staaten verarbeiten. Nach aktueller
        Rechtsprechung des Europäischen Gerichtshofs gilt für Datenübermittlungen in die USA kein
        durchgehend gleichwertiges Datenschutzniveau wie in der EU. Dadurch können theoretisch Zugriffe
        staatlicher US-Behörden oder eingeschränkte Möglichkeiten zur Rechtsdurchsetzung nicht vollständig
        ausgeschlossen werden.

        <Untertitel>Rechtsgrundlagen und Schutzmaßnahmen</Untertitel>
        Um dennoch ein hohes Datenschutzniveau zu wahren, stützt sich Vercel auf Standardvertragsklauseln
        nach Art. 46 Abs. 2 und 3 DSGVO. Diese von der EU-Kommission verabschiedeten Verträge verpflichten
        Vercel vertraglich dazu, europäische Datenschutzstandards einzuhalten, selbst wenn personenbezogene
        Daten außerhalb des EWR verarbeitet werden.<br />
        • Text und Beschluss der EU-Kommission: eur-lex.europa.eu/eli/dec_impl/2021/914/oj?locale=de<br />
        • Datenverarbeitungsvereinbarung von Vercel (DPA mit SCC): vercel.com/legal/dpa

        <Untertitel>Weitere Informationen</Untertitel>
        Ausführliche Hinweise zur Art, zum Umfang und zu den Zwecken der Datenverarbeitung finden Sie in
        der Datenschutzerklärung von Vercel: vercel.com/legal/privacy-policy

        <Untertitel>Auftragsverarbeitung</Untertitel>
        Wir haben einen Vertrag über Auftragsverarbeitung (AVV) zur Nutzung des oben genannten Dienstes
        geschlossen. Hierbei handelt es sich um einen datenschutzrechtlich vorgeschriebenen Vertrag, der
        gewährleistet, dass dieser die personenbezogenen Daten unserer Websitebesucher nur nach unseren
        Weisungen und unter Einhaltung der DSGVO verarbeitet.
      </Abschnitt>

      <Abschnitt titel="3. Allgemeine Hinweise und Pflichtinformationen">
        <Untertitel>Datenschutz</Untertitel>
        Die Betreiber dieser Seiten nehmen den Schutz Ihrer persönlichen Daten sehr ernst. Wir behandeln
        Ihre personenbezogenen Daten vertraulich und entsprechend den gesetzlichen Datenschutzvorschriften
        sowie dieser Datenschutzerklärung.
        <br /><br />
        Wir weisen darauf hin, dass die Datenübertragung im Internet (z. B. bei der Kommunikation per
        E-Mail) Sicherheitslücken aufweisen kann. Ein lückenloser Schutz der Daten vor dem Zugriff durch
        Dritte ist nicht möglich.

        <Untertitel>Hinweis zur verantwortlichen Stelle</Untertitel>
        Die verantwortliche Stelle für die Datenverarbeitung auf dieser Website ist:<br /><br />
        {I.firma}<br />
        {I.strasse}<br />
        {I.ort}<br />
        Telefon: {I.telefon}<br />
        E-Mail: {I.email}
        <br /><br />
        Verantwortliche Stelle ist die natürliche oder juristische Person, die allein oder gemeinsam mit
        anderen über die Zwecke und Mittel der Verarbeitung von personenbezogenen Daten entscheidet.

        <Untertitel>Speicherdauer</Untertitel>
        Soweit innerhalb dieser Datenschutzerklärung keine speziellere Speicherdauer genannt wurde,
        verbleiben Ihre personenbezogenen Daten bei uns, bis der Zweck für die Datenverarbeitung entfällt.
        Wenn Sie ein berechtigtes Löschersuchen geltend machen oder eine Einwilligung zur Datenverarbeitung
        widerrufen, werden Ihre Daten gelöscht, sofern wir keine anderen rechtlich zulässigen Gründe für
        die Speicherung haben (z. B. steuer- oder handelsrechtliche Aufbewahrungsfristen); im
        letztgenannten Fall erfolgt die Löschung nach Fortfall dieser Gründe.

        <Untertitel>Allgemeine Hinweise zu den Rechtsgrundlagen</Untertitel>
        Sofern Sie in die Datenverarbeitung eingewilligt haben, verarbeiten wir Ihre personenbezogenen
        Daten auf Grundlage von Art. 6 Abs. 1 lit. a DSGVO. Sind Ihre Daten zur Vertragserfüllung oder zur
        Durchführung vorvertraglicher Maßnahmen erforderlich, verarbeiten wir Ihre Daten auf Grundlage des
        Art. 6 Abs. 1 lit. b DSGVO. Sofern diese zur Erfüllung einer rechtlichen Verpflichtung erforderlich
        sind, auf Grundlage von Art. 6 Abs. 1 lit. c DSGVO. Die Datenverarbeitung kann ferner auf Grundlage
        unseres berechtigten Interesses nach Art. 6 Abs. 1 lit. f DSGVO erfolgen. Über die jeweils im
        Einzelfall einschlägigen Rechtsgrundlagen wird in den folgenden Absätzen informiert.

        <Untertitel>Empfänger von personenbezogenen Daten</Untertitel>
        Im Rahmen unserer Geschäftstätigkeit arbeiten wir mit verschiedenen externen Stellen zusammen.
        Dabei ist teilweise auch eine Übermittlung von personenbezogenen Daten an diese externen Stellen
        erforderlich. Wir geben personenbezogene Daten nur dann an externe Stellen weiter, wenn dies im
        Rahmen einer Vertragserfüllung erforderlich ist, wenn wir gesetzlich hierzu verpflichtet sind,
        wenn wir ein berechtigtes Interesse nach Art. 6 Abs. 1 lit. f DSGVO an der Weitergabe haben, oder
        wenn eine sonstige Rechtsgrundlage die Datenweitergabe erlaubt. Beim Einsatz von
        Auftragsverarbeitern geben wir personenbezogene Daten nur auf Grundlage eines gültigen Vertrags
        über Auftragsverarbeitung weiter.

        <Untertitel>Widerruf Ihrer Einwilligung zur Datenverarbeitung</Untertitel>
        Viele Datenverarbeitungsvorgänge sind nur mit Ihrer ausdrücklichen Einwilligung möglich. Sie
        können eine bereits erteilte Einwilligung jederzeit widerrufen. Die Rechtmäßigkeit der bis zum
        Widerruf erfolgten Datenverarbeitung bleibt vom Widerruf unberührt.

        <Untertitel>Widerspruchsrecht gegen die Datenerhebung in besonderen Fällen (Art. 21 DSGVO)</Untertitel>
        Wenn die Datenverarbeitung auf Grundlage von Art. 6 Abs. 1 lit. e oder f DSGVO erfolgt, haben Sie
        jederzeit das Recht, aus Gründen, die sich aus Ihrer besonderen Situation ergeben, gegen die
        Verarbeitung Ihrer personenbezogenen Daten Widerspruch einzulegen. Wenn Sie Widerspruch einlegen,
        werden wir Ihre betroffenen personenbezogenen Daten nicht mehr verarbeiten, es sei denn, wir können
        zwingende schutzwürdige Gründe für die Verarbeitung nachweisen, die Ihre Interessen, Rechte und
        Freiheiten überwiegen, oder die Verarbeitung dient der Geltendmachung, Ausübung oder Verteidigung
        von Rechtsansprüchen.

        <Untertitel>Beschwerderecht bei der zuständigen Aufsichtsbehörde</Untertitel>
        Im Falle von Verstößen gegen die DSGVO steht den Betroffenen ein Beschwerderecht bei einer
        Aufsichtsbehörde zu, insbesondere in dem Mitgliedstaat ihres gewöhnlichen Aufenthalts, ihres
        Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes.

        <Untertitel>Recht auf Datenübertragbarkeit</Untertitel>
        Sie haben das Recht, Daten, die wir auf Grundlage Ihrer Einwilligung oder in Erfüllung eines
        Vertrags automatisiert verarbeiten, an sich oder an einen Dritten in einem gängigen,
        maschinenlesbaren Format aushändigen zu lassen.

        <Untertitel>Auskunft, Berichtigung und Löschung</Untertitel>
        Sie haben im Rahmen der geltenden gesetzlichen Bestimmungen jederzeit das Recht auf unentgeltliche
        Auskunft über Ihre gespeicherten personenbezogenen Daten, deren Herkunft und Empfänger und den
        Zweck der Datenverarbeitung und ggf. ein Recht auf Berichtigung oder Löschung dieser Daten. Hierzu
        können Sie sich jederzeit an uns wenden.

        <Untertitel>Recht auf Einschränkung der Verarbeitung</Untertitel>
        Sie haben das Recht, die Einschränkung der Verarbeitung Ihrer personenbezogenen Daten zu
        verlangen. Hierzu können Sie sich jederzeit an uns wenden.

        <Untertitel>SSL- bzw. TLS-Verschlüsselung</Untertitel>
        Diese Seite nutzt aus Sicherheitsgründen und zum Schutz der Übertragung vertraulicher Inhalte eine
        SSL- bzw. TLS-Verschlüsselung. Eine verschlüsselte Verbindung erkennen Sie daran, dass die
        Adresszeile des Browsers von „http://" auf „https://" wechselt und an dem Schloss-Symbol in Ihrer
        Browserzeile.
      </Abschnitt>

      <Abschnitt titel="4. Datenerfassung auf dieser Website">
        <Untertitel>Cookies</Untertitel>
        Unsere Internetseite verwendet so genannte „Cookies". Cookies sind kleine Datenpakete und richten
        auf Ihrem Endgerät keinen Schaden an. Sie werden entweder vorübergehend für die Dauer einer Sitzung
        (Session-Cookies) oder dauerhaft (permanente Cookies) auf Ihrem Endgerät gespeichert.
        <br /><br />
        Cookies, die zur Durchführung des elektronischen Kommunikationsvorgangs oder zur Bereitstellung
        bestimmter, von Ihnen erwünschter Funktionen erforderlich sind (notwendige Cookies), werden auf
        Grundlage von Art. 6 Abs. 1 lit. f DSGVO gespeichert. Für alle darüber hinausgehenden Cookies –
        insbesondere für Meta Pixel und Google Analytics – fragen wir vor deren Einsatz über ein
        Consent-Banner Ihre Einwilligung ab (Art. 6 Abs. 1 lit. a DSGVO und § 25 Abs. 1 TDDDG). Diese
        Einwilligung ist jederzeit mit Wirkung für die Zukunft widerrufbar.
        <br /><br />
        Sie können Ihren Browser so einstellen, dass Sie über das Setzen von Cookies informiert werden und
        Cookies nur im Einzelfall erlauben. Bei der Deaktivierung von Cookies kann die Funktionalität
        dieser Website eingeschränkt sein.

        <Untertitel>Server-Log-Dateien</Untertitel>
        Der Provider der Seiten erhebt und speichert automatisch Informationen in so genannten
        Server-Log-Dateien, die Ihr Browser automatisch an uns übermittelt. Dies sind: Browsertyp und
        -version, verwendetes Betriebssystem, Referrer URL, Hostname des zugreifenden Rechners, Uhrzeit
        der Serveranfrage, IP-Adresse. Eine Zusammenführung dieser Daten mit anderen Datenquellen wird
        nicht vorgenommen. Die Erfassung erfolgt auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO.

        <Untertitel>Kontaktformular / Anfrage zum Beratungsgespräch</Untertitel>
        Wenn Sie uns über den Funnel Ihre Kontaktdaten (Name, Telefonnummer, E-Mail, ggf. Wunschtermin)
        übermitteln, werden diese Angaben zwecks Bearbeitung Ihrer Anfrage und für den Fall von
        Anschlussfragen bei uns gespeichert. Diese Daten geben wir nicht ohne Ihre Einwilligung weiter.
        <br /><br />
        Die Verarbeitung erfolgt auf Grundlage unseres berechtigten Interesses an der effektiven
        Bearbeitung der an uns gerichteten Anfragen (Art. 6 Abs. 1 lit. f DSGVO) sowie zur Durchführung
        vorvertraglicher Maßnahmen, sofern Ihre Anfrage auf den Abschluss eines Maklervertrags abzielt
        (Art. 6 Abs. 1 lit. b DSGVO).
        <br /><br />
        Die von Ihnen übermittelten Daten verbleiben bei uns, bis Sie uns zur Löschung auffordern oder der
        Zweck für die Datenspeicherung entfällt (z. B. nach abgeschlossener Bearbeitung Ihrer Anfrage).
        Zwingende gesetzliche Aufbewahrungsfristen bleiben unberührt.
        <br /><br />
        Die im Rahmen der Beispielrechnung abgefragten finanziellen Angaben (z. B. Einkommen, Eigenkapital,
        Sparrate) werden zunächst ausschließlich in Ihrem Browser verarbeitet, um Ihnen die
        Beispielrechnung anzuzeigen. Übermitteln Sie uns anschließend Ihre Kontaktdaten (z. B. über das
        Telefon-Gate), werden diese Angaben zusammen mit Ihren Kontaktdaten bei uns gespeichert, damit wir
        Ihnen ein zu Ihrer Situation passendes Beratungsgespräch anbieten können.

        <Untertitel>Anfrage per WhatsApp, E-Mail oder Telefon</Untertitel>
        Wenn Sie uns per WhatsApp, E-Mail oder Telefon kontaktieren, wird Ihre Anfrage inklusive aller
        daraus hervorgehenden personenbezogenen Daten zum Zwecke der Bearbeitung Ihres Anliegens bei uns
        gespeichert und verarbeitet. Bei einer Kontaktaufnahme über WhatsApp gelten zusätzlich die
        Datenschutzhinweise von WhatsApp (Meta Platforms Ireland Limited).
      </Abschnitt>

      <Abschnitt titel="5. Selbstauskunft für die Finanzierungsanfrage">
        Wenn Sie über einen von uns persönlich zugesandten Link eine Selbstauskunft ausfüllen, erheben wir
        deutlich weitergehende Angaben als im übrigen Funnel – u. a. zu Ihrer Beschäftigung und Ihrem
        Einkommen, weiteren Einkünften, bestehenden finanziellen Verpflichtungen sowie zu Ihrem Vermögen.
        Diese Daten benötigen wir, um für Sie eine passende Immobilienfinanzierung vorzubereiten bzw. an
        finanzierende Banken oder Finanzierungsvermittler weiterzugeben.
        <br /><br />
        Die Verarbeitung erfolgt auf Grundlage Ihrer Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), die Sie
        beim Absenden des Formulars erteilen, sowie zur Durchführung vorvertraglicher Maßnahmen auf Ihre
        Anfrage hin (Art. 6 Abs. 1 lit. b DSGVO). Ihre Einwilligung können Sie jederzeit mit Wirkung für
        die Zukunft widerrufen.
        <br /><br />
        Der Zugriff auf diese Daten ist innerhalb unseres Unternehmens auf die mit der Bearbeitung Ihrer
        Finanzierungsanfrage befassten Personen beschränkt. Eine Weitergabe an Banken oder
        Finanzierungsvermittler erfolgt nur, soweit dies für die Bearbeitung Ihrer Anfrage erforderlich ist
        und Sie dem zugestimmt haben. Die Daten werden gelöscht, sobald sie für die Bearbeitung Ihrer
        Anfrage nicht mehr erforderlich sind, spätestens jedoch nach Abschluss oder endgültigem Absagen des
        Finanzierungsvorhabens, soweit keine gesetzlichen Aufbewahrungsfristen entgegenstehen.
      </Abschnitt>

      <Abschnitt titel="6. Analyse & Tracking">
        <Untertitel>Meta Pixel (Facebook/Instagram)</Untertitel>
        Sofern Sie eingewilligt haben, setzen wir auf dieser Website den Meta Pixel der Meta Platforms
        Ireland Limited, 4 Grand Canal Square, Grand Canal Harbour, Dublin 2, Irland ein. Damit können wir
        das Verhalten der Seitenbesucher nachverfolgen, nachdem diese durch Klick auf eine Facebook- oder
        Instagram-Werbeanzeige auf unsere Website weitergeleitet wurden, um die Wirksamkeit der
        Werbeanzeigen auszuwerten. Meta kann die Daten für eigene Werbezwecke entsprechend der
        Meta-Datenverwendungsrichtlinie verwenden; diese Verwendung können wir als Seitenbetreiber nicht
        beeinflussen.
        <br /><br />
        Der Meta Pixel wird erst geladen, nachdem Sie über unser Consent-Banner eingewilligt haben.
        Rechtsgrundlage ist Ihre Einwilligung nach Art. 6 Abs. 1 lit. a DSGVO und § 25 Abs. 1 TDDDG. Die
        Einwilligung ist jederzeit mit Wirkung für die Zukunft widerrufbar.
        <br /><br />
        Weitere Informationen: facebook.com/about/privacy/ · Einstellungen zur Verwendung Ihrer Daten für
        Werbezwecke: facebook.com/settings?tab=ads

        <Untertitel>Google Analytics (GA4)</Untertitel>
        Sofern Sie eingewilligt haben, nutzen wir auf dieser Website Google Analytics, einen
        Webanalysedienst der Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland. Google
        Analytics ermöglicht es uns, das Verhalten der Website-Besucher zu analysieren, etwa welche
        Inhalte aufgerufen werden oder wie lange ein Besuch dauert.
        <br /><br />
        Google Analytics wird erst geladen, nachdem Sie über unser Consent-Banner eingewilligt haben.
        Rechtsgrundlage ist Ihre Einwilligung nach Art. 6 Abs. 1 lit. a DSGVO und § 25 Abs. 1 TDDDG. Die
        Einwilligung ist jederzeit mit Wirkung für die Zukunft widerrufbar. Google verarbeitet die Daten
        teilweise auch in den USA; hierbei stützt sich Google auf Standardvertragsklauseln nach Art. 46
        Abs. 2 und 3 DSGVO.
        <br /><br />
        Weitere Informationen: policies.google.com/privacy?hl=de
      </Abschnitt>
    </div>
  );
}

/** Präzises Zahlen-Eingabefeld mit Einheit – für die Objekt-Detailanalyse,
 * wo Segment-Buttons mit groben Stufen nicht reichen und die echten Werte
 * eines konkreten Objekts eingetragen werden sollen (z. B. Steuersatz auf
 * 0,5% genau, oder die tatsächliche Kaltmiete eines Objekts). */
/** Rundet auf 2 Nachkommastellen und zeigt deutsche Schreibweise – Punkt als
 * Tausendertrennzeichen, Komma als Dezimaltrennzeichen (z. B. 250000 →
 * "250.000", 4.5 → "4,5"). parseZahlDE oben liest genau dieses Format
 * beim erneuten Eintippen korrekt wieder ein. */
function formatZahlDE(n) {
  if (!Number.isFinite(n)) return "";
  const gerundet = Math.round(n * 100) / 100;
  return gerundet.toLocaleString("de-DE", { maximumFractionDigits: 2 });
}
/** Liest einen roh eingetippten Text als Zahl – deutsche Schreibweise:
 * Komma ist IMMER das Dezimaltrennzeichen. Ein Punkt wird nur dann als
 * Tausendertrennzeichen behandelt (und entfernt), wenn er zu einer
 * dreistelligen Gruppe passt ("380.000" → 380000) – ein einzelner Punkt mit
 * abweichender Stellenzahl ("4.5") bleibt ein Dezimalpunkt. Ohne diese
 * Unterscheidung würde "380.000" als 380 statt 380.000 gelesen, weil
 * JavaScript einen Punkt sonst immer als Dezimaltrennzeichen liest – das
 * kann sich über mehrere Felder hinweg zu absurden Endergebnissen aufschaukeln.
 * Gibt null zurück, solange noch nichts Gültiges dasteht (leer, nur ein
 * Minus), damit während des Tippens nicht ständig auf 0 zurückgesprungen wird. */
function parseZahlDE(roh) {
  let s = roh.trim();
  if (s === "" || s === "-") return null;
  if (s.includes(",")) {
    // Komma vorhanden → das ist das Dezimaltrennzeichen, alle Punkte davor
    // sind zwangsläufig Tausendertrennzeichen ("380.000,50").
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    const teile = s.split(".");
    const wirktWieTausender = teile.length > 1 && teile.slice(1).every((t) => t.length === 3);
    if (wirktWieTausender) s = s.replace(/\./g, "");
  }
  const bereinigt = s.replace(/[^0-9.\-]/g, "");
  if (bereinigt === "" || bereinigt === "-") return null;
  const n = parseFloat(bereinigt);
  return Number.isFinite(n) ? n : null;
}
/** Zahlen-Eingabefeld für die Objekt-Detailanalyse. Bewusst als Text-Input
 * gebaut statt type="number": native number-Inputs blockieren in manchen
 * mobilen Webviews das Komma als Dezimaltrennzeichen, und wenn das Feld beim
 * Leeren sofort auf den Zahlenwert 0 zurückspringt, hängt sich die nächste
 * getippte Ziffer VOR die 0 statt sie zu ersetzen ("07" statt "7"). Hier
 * wird stattdessen der rohe Tastatur-Text als eigener State geführt und erst
 * beim Verlassen des Felds sauber formatiert – während des Tippens bleibt
 * exakt stehen, was eingegeben wurde. */
function ZahlenFeld({ label, value, onChange, suffix, min = 0, max, hinweis }) {
  const [text, setText] = useState(() => formatZahlDE(value));
  const fokussiert = useRef(false);

  // Externe Änderungen (Vorlage aus einem Lead, Zurücksetzen) übernehmen –
  // aber nur, wenn gerade nicht getippt wird, sonst überschreibt jede
  // Neuberechnung von außen die laufende Eingabe.
  useEffect(() => {
    if (!fokussiert.current) setText(formatZahlDE(value));
  }, [value]);

  return (
    <div>
      <div className="text-xs mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>{label}</div>
      <div className="relative">
        <input
          type="text" inputMode="decimal"
          value={text}
          onChange={(e) => {
            const roh = e.target.value;
            setText(roh);
            const n = parseZahlDE(roh);
            if (n !== null) onChange(n);
          }}
          className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors tabular-nums"
          style={{ background: "rgba(0,0,0,0.35)", border: `1px solid ${HAIRLINE}`, color: "#fff" }}
          onFocus={(e) => { fokussiert.current = true; e.target.style.borderColor = GOLD; }}
          onBlur={(e) => {
            fokussiert.current = false;
            e.target.style.borderColor = HAIRLINE;
            let n = parseZahlDE(text);
            if (n === null) n = 0;
            if (min !== undefined) n = Math.max(min, n);
            if (max !== undefined) n = Math.min(max, n);
            onChange(n);
            setText(formatZahlDE(n));
          }}
        />
        {suffix && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: "rgba(255,255,255,0.35)" }}>
            {suffix}
          </span>
        )}
      </div>
      {/* Live-Gegenprobe für Prozentfelder, deren Größenordnung man sonst
          leicht falsch einschätzt (z. B. Euro-Betrag statt Prozentsatz
          eingetippt) – macht so eine Verwechslung sofort sichtbar. */}
      {hinweis && (
        <div className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>{hinweis}</div>
      )}
    </div>
  );
}

/** Überschrift für eine Gruppe von ZahlenFeld-Eingaben innerhalb einer Karte. */
function FeldGruppe({ titel, children }) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="text-xs uppercase tracking-widest mb-3" style={{ color: "rgba(255,255,255,0.4)" }}>{titel}</div>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

/** Vollständige Jahresreihe der Projektion als scrollbare Tabelle – für den
 * Moment im Gespräch, in dem eine ganz bestimmte Zahl aus einem bestimmten
 * Jahr gefragt ist, statt nur des Meilensteins 10/20/30. */
function Jahrestabelle({ reihe }) {
  const [modus, setModus] = useState("monat"); // "jahr" | "monat"
  const teiler = modus === "monat" ? 12 : 1;

  const spalten = [
    { key: "kaltmiete", label: "Kaltmiete", fluss: true },
    { key: "zinsen", label: "Zinsen", fluss: true },
    { key: "tilgung", label: "Tilgung", fluss: true },
    { key: "restschuld", label: "Restschuld", fluss: false },
    { key: "afa", label: "AfA", fluss: true },
    { key: "steuerwirkung", label: "Steuerwirkung", fluss: true },
    { key: "cfNachSteuer", label: modus === "monat" ? "Cashflow nach Steuer" : "Cashflow nach Steuer (Jahr)", fluss: true },
    { key: "immobilienwert", label: "Immobilienwert", fluss: false },
    { key: "nettovermoegen", label: "Nettovermögen", fluss: false },
  ];

  return (
    <div>
      <div className="mb-4">
        <div className="text-xs uppercase tracking-widest mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>Ansicht</div>
        <Segment optionen={[{ id: "monat", label: "Pro Monat" }, { id: "jahr", label: "Pro Jahr" }]} wert={modus} onChange={setModus} />
      </div>
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="text-xs border-collapse" style={{ minWidth: 800 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
              <th className="text-left py-2 pr-3 font-medium whitespace-nowrap" style={{ color: "rgba(255,255,255,0.4)" }}>Jahr</th>
              {spalten.map((s) => (
                <th key={s.key} className="text-right py-2 px-2 font-medium whitespace-nowrap" style={{ color: "rgba(255,255,255,0.4)" }}>
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reihe.map((r) => (
              <tr key={r.jahr} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <td className="py-2 pr-3 text-left font-medium whitespace-nowrap" style={{ color: "rgba(255,255,255,0.6)" }}>{r.jahr}</td>
                <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{eur(Math.round(r.kaltmiete / teiler))}</td>
                <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap" style={{ color: "rgba(255,255,255,0.5)" }}>{eur(Math.round(r.zinsen / teiler))}</td>
                <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap" style={{ color: "rgba(255,255,255,0.5)" }}>{eur(Math.round(r.tilgung / teiler))}</td>
                <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap" style={{ color: "rgba(255,255,255,0.5)" }}>{eur(Math.round(r.restschuld))}</td>
                <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap" style={{ color: r.afa > 0 ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.25)" }}>{eur(Math.round(r.afa / teiler))}</td>
                <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap" style={{ color: r.steuerwirkung >= 0 ? GREEN : "#FCA5A5" }}>{eur(Math.round(r.steuerwirkung / teiler))}</td>
                <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap" style={{ color: r.cfNachSteuer >= 0 ? GREEN : "#FCA5A5" }}>{eur(Math.round(r.cfNachSteuer / teiler))}</td>
                <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{eur(Math.round(r.immobilienwert))}</td>
                <td className="py-2 px-2 text-right tabular-nums font-medium whitespace-nowrap" style={{ color: GOLD_SOFT }}>{eur(Math.round(r.nettovermoegen))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ================================================================== CRM */
/** Objekt-Detailanalyse fürs Beratungsgespräch – alle Annahmen frei und
 * exakt editierbar (nicht nur grobe Stufen), damit ein konkretes reales
 * Objekt mit seinen tatsächlichen Zahlen durchgerechnet werden kann: eigene
 * Kaltmiete, eigenes nicht umlagefähiges Hausgeld, eigener AfA-Verlauf
 * (endet automatisch nach der AfA-Dauer), eigene Mietsteigerung, exakter
 * Steuersatz des Kunden. Optional mit Vorlage aus einem Lead – dann sind
 * Steuersatz und Eigenkapitaleinsatz schon anhand seiner Antworten geschätzt
 * und müssen nur noch geprüft/angepasst werden. */
function AnalyseTool({ initialLead, onVorlageEntfernen, accessToken }) {
  // Mehrere benannte Fallstudien pro Kunde statt nur einer – dieselbe
  // jsonb-Spalte "analyse" hält jetzt ein Array statt eines einzelnen
  // Objekts, keine neue Migration nötig. Beim Öffnen wird die zuletzt
  // gespeicherte Fallstudie automatisch vorgeladen.
  const analysen = useMemo(() => initialLead?.analyse || [], [initialLead]);
  const [aktiveId, setAktiveId] = useState(() => analysen[0]?.id ?? null);
  const [name, setName] = useState(() => analysen[0]?.name ?? "");
  const aktiveAnalyse = analysen.find((a) => a.id === aktiveId) || null;

  // Objektdaten – Startwerte aus der aktiven Fallstudie, sonst CONFIG,
  // vollständig frei editierbar.
  const [kaufpreis, setKaufpreis] = useState(aktiveAnalyse?.kaufpreis ?? CONFIG.objekt.kaufpreisDefault);
  const [kaltmieteMonat, setKaltmieteMonat] = useState(
    aktiveAnalyse?.kaltmieteMonat ?? Math.round((CONFIG.objekt.kaufpreisDefault * CONFIG.objekt.bruttomietrendite) / 12)
  );
  const [nichtUmlagefaehigMonat, setNichtUmlagefaehigMonat] = useState(aktiveAnalyse?.nichtUmlagefaehigMonat ?? CONFIG.objekt.nichtUmlagefaehigMonat);
  const [kaufnebenkostenProzent, setKaufnebenkostenProzent] = useState(aktiveAnalyse?.kaufnebenkostenProzent ?? CONFIG.objekt.kaufnebenkostenQuote * 100);
  const [gebaeudeanteilProzent, setGebaeudeanteilProzent] = useState(aktiveAnalyse?.gebaeudeanteilProzent ?? CONFIG.objekt.gebaeudeanteil * 100);
  const [afaSatzProzent, setAfaSatzProzent] = useState(aktiveAnalyse?.afaSatzProzent ?? CONFIG.objekt.afaSatz * 100);
  const [afaDauerJahre, setAfaDauerJahre] = useState(aktiveAnalyse?.afaDauerJahre ?? CONFIG.objekt.afaDauerJahre);
  const [mietsteigerungProzent, setMietsteigerungProzent] = useState(aktiveAnalyse?.mietsteigerungProzent ?? CONFIG.objekt.mietsteigerung * 100);
  const [wertsteigerungProzent, setWertsteigerungProzent] = useState(aktiveAnalyse?.wertsteigerungProzent ?? CONFIG.projektion.wertsteigerung * 100);
  const [sollzinsProzent, setSollzinsProzent] = useState(aktiveAnalyse?.sollzinsProzent ?? CONFIG.finanzierung.sollzins * 100);
  const [tilgungProzent, setTilgungProzent] = useState(aktiveAnalyse?.tilgungProzent ?? CONFIG.finanzierung.anfangstilgung * 100);

  // Kundendaten – aktive Fallstudie geht vor der groben Schätzung aus dem
  // Lead, die wiederum vor dem CONFIG-Standardwert geht.
  const [steuersatzProzent, setSteuersatzProzent] = useState(() => {
    if (aktiveAnalyse?.steuersatzProzent != null) return aktiveAnalyse.steuersatzProzent;
    if (initialLead?.brutto) {
      return Math.round(grenzsteuersatz(initialLead.brutto, initialLead.status || "angestellt") * 1000) / 10;
    }
    return 42;
  });
  const [ekEinsatz, setEkEinsatz] = useState(() => {
    if (aktiveAnalyse?.ekEinsatz != null) return aktiveAnalyse.ekEinsatz;
    if (initialLead?.eigenkapital) return Math.min(initialLead.eigenkapital, 500000);
    return 0;
  });

  const [jahr, setJahr] = useState(aktiveAnalyse?.jahr ?? 20);
  const [zeigeTabelle, setZeigeTabelle] = useState(false);
  const [speicherStatus, setSpeicherStatus] = useState(""); // "" | "speichert" | "gespeichert" | "fehler"

  /** Setzt alle Felder auf die Werte einer gespeicherten Fallstudie zurück
   * und markiert sie als aktiv – weitere Speicherungen aktualisieren dann
   * genau diese, statt eine neue anzulegen. */
  const ladeFallstudie = (a) => {
    setAktiveId(a.id); setName(a.name || "");
    setKaufpreis(a.kaufpreis ?? CONFIG.objekt.kaufpreisDefault);
    setKaltmieteMonat(a.kaltmieteMonat ?? 0);
    setNichtUmlagefaehigMonat(a.nichtUmlagefaehigMonat ?? CONFIG.objekt.nichtUmlagefaehigMonat);
    setKaufnebenkostenProzent(a.kaufnebenkostenProzent ?? CONFIG.objekt.kaufnebenkostenQuote * 100);
    setGebaeudeanteilProzent(a.gebaeudeanteilProzent ?? CONFIG.objekt.gebaeudeanteil * 100);
    setAfaSatzProzent(a.afaSatzProzent ?? CONFIG.objekt.afaSatz * 100);
    setAfaDauerJahre(a.afaDauerJahre ?? CONFIG.objekt.afaDauerJahre);
    setMietsteigerungProzent(a.mietsteigerungProzent ?? CONFIG.objekt.mietsteigerung * 100);
    setWertsteigerungProzent(a.wertsteigerungProzent ?? CONFIG.projektion.wertsteigerung * 100);
    setSollzinsProzent(a.sollzinsProzent ?? CONFIG.finanzierung.sollzins * 100);
    setTilgungProzent(a.tilgungProzent ?? CONFIG.finanzierung.anfangstilgung * 100);
    setSteuersatzProzent(a.steuersatzProzent ?? 42);
    setEkEinsatz(a.ekEinsatz ?? 0);
    setJahr(a.jahr ?? 20);
  };

  /** Setzt alle Felder auf die Standardwerte zurück, um eine neue,
   * unabhängige Fallstudie für denselben Kunden zu beginnen. */
  const neueFallstudie = () => {
    setAktiveId(null); setName("");
    setKaufpreis(CONFIG.objekt.kaufpreisDefault);
    setKaltmieteMonat(Math.round((CONFIG.objekt.kaufpreisDefault * CONFIG.objekt.bruttomietrendite) / 12));
    setNichtUmlagefaehigMonat(CONFIG.objekt.nichtUmlagefaehigMonat);
    setKaufnebenkostenProzent(CONFIG.objekt.kaufnebenkostenQuote * 100);
    setGebaeudeanteilProzent(CONFIG.objekt.gebaeudeanteil * 100);
    setAfaSatzProzent(CONFIG.objekt.afaSatz * 100);
    setAfaDauerJahre(CONFIG.objekt.afaDauerJahre);
    setMietsteigerungProzent(CONFIG.objekt.mietsteigerung * 100);
    setWertsteigerungProzent(CONFIG.projektion.wertsteigerung * 100);
    setSollzinsProzent(CONFIG.finanzierung.sollzins * 100);
    setTilgungProzent(CONFIG.finanzierung.anfangstilgung * 100);
    setJahr(20);
  };

  /** Speichert die aktuell eingestellten Werte als Fallstudie unter dem
   * Namen im Namensfeld – aktualisiert die aktive Fallstudie, falls eine
   * geladen ist, sonst legt sie eine neue an. */
  const speichernFuerKunden = async () => {
    if (!initialLead || !name.trim()) return;
    setSpeicherStatus("speichert");
    const daten = {
      id: aktiveId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(), erstelltAm: aktiveAnalyse?.erstelltAm || new Date().toISOString(),
      kaufpreis, kaltmieteMonat, nichtUmlagefaehigMonat, kaufnebenkostenProzent,
      gebaeudeanteilProzent, afaSatzProzent, afaDauerJahre, mietsteigerungProzent,
      wertsteigerungProzent, sollzinsProzent, tilgungProzent, steuersatzProzent, ekEinsatz, jahr,
    };
    const neueListe = aktiveId
      ? analysen.map((a) => (a.id === aktiveId ? daten : a))
      : [daten, ...analysen];
    const ok = await speichereLead(
      { id: initialLead.id, analyse: neueListe, analyseAktualisiertAm: new Date().toISOString() },
      accessToken
    );
    if (ok) setAktiveId(daten.id);
    setSpeicherStatus(ok ? "gespeichert" : "fehler");
    setTimeout(() => setSpeicherStatus(""), 2500);
  };

  /** Löscht eine Fallstudie aus der Liste (nach Bestätigung). */
  const loescheFallstudie = async (id) => {
    if (!window.confirm("Diese Fallstudie wirklich löschen?")) return;
    const neueListe = analysen.filter((a) => a.id !== id);
    await speichereLead({ id: initialLead.id, analyse: neueListe, analyseAktualisiertAm: new Date().toISOString() }, accessToken);
    if (aktiveId === id) neueFallstudie();
  };

  const bruttomietrendite = kaufpreis > 0 ? (kaltmieteMonat * 12) / kaufpreis : 0;

  const modell = useMemo(() => berechneModell({
    kaufpreis, eigenkapitalEinsatz: ekEinsatz,
    steuersatz: steuersatzProzent / 100, wertsteigerung: wertsteigerungProzent / 100,
    kaufnebenkostenQuote: kaufnebenkostenProzent / 100,
    gebaeudeanteil: gebaeudeanteilProzent / 100,
    bruttomietrendite,
    nichtUmlagefaehigMonat,
    afaSatz: afaSatzProzent / 100,
    afaDauerJahre,
    mietsteigerung: mietsteigerungProzent / 100,
    sollzins: sollzinsProzent / 100,
    anfangstilgung: tilgungProzent / 100,
  }), [
    kaufpreis, ekEinsatz, steuersatzProzent, wertsteigerungProzent, kaufnebenkostenProzent,
    gebaeudeanteilProzent, bruttomietrendite, nichtUmlagefaehigMonat, afaSatzProzent,
    afaDauerJahre, mietsteigerungProzent, sollzinsProzent, tilgungProzent,
  ]);

  const s = modell.stand(jahr);
  const extra = s.kumSteuerwirkung + s.kumCfVorSteuer;
  const afaEndeText = afaDauerJahre < CONFIG.projektion.horizontJahre
    ? `AfA endet nach Jahr ${afaDauerJahre} – danach entfällt die steuerliche Entlastung daraus.`
    : `AfA läuft über den gesamten Betrachtungszeitraum von ${CONFIG.projektion.horizontJahre} Jahren.`;

  return (
    <div className="space-y-5">
      {initialLead && (
        <div className="rounded-2xl p-4" style={{ background: "rgba(201,162,39,0.1)", border: "1px solid rgba(201,162,39,0.3)" }}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm">
              <span style={{ color: "rgba(255,255,255,0.5)" }}>Fallstudien für </span>
              <span className="font-medium">{initialLead.vorname} {initialLead.nachname}</span>
            </div>
            {onVorlageEntfernen && (
              <button onClick={onVorlageEntfernen} className="shrink-0 p-1.5 rounded-full" style={{ color: "rgba(255,255,255,0.4)" }} aria-label="Vorlage entfernen">
                <X size={14} />
              </button>
            )}
          </div>

          {analysen.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {analysen.map((a) => (
                <div key={a.id} className="flex items-center gap-1 rounded-full pl-3 pr-1 py-1 text-xs"
                  style={{
                    background: a.id === aktiveId ? "rgba(201,162,39,0.28)" : "rgba(255,255,255,0.06)",
                    border: `1px solid ${a.id === aktiveId ? "rgba(201,162,39,0.5)" : HAIRLINE}`,
                    color: a.id === aktiveId ? GOLD_SOFT : "rgba(255,255,255,0.7)",
                  }}>
                  <button onClick={() => ladeFallstudie(a)} className="font-medium">{a.name || "Ohne Namen"}</button>
                  <button onClick={() => loescheFallstudie(a.id)} className="p-1 rounded-full" style={{ color: "rgba(255,255,255,0.35)" }} aria-label="Fallstudie löschen">
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 mt-3">
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Name dieser Fallstudie, z. B. Whg. Musterstraße"
              className="flex-1 min-w-0 rounded-xl px-3.5 py-2.5 text-sm outline-none"
              style={{ background: "rgba(0,0,0,0.3)", border: `1px solid ${HAIRLINE}`, color: "#fff" }}
            />
            {aktiveId && (
              <button onClick={neueFallstudie} className="shrink-0 rounded-xl px-3.5 text-xs font-medium"
                style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${HAIRLINE}`, color: "rgba(255,255,255,0.7)" }}>
                + Neu
              </button>
            )}
          </div>
          <button onClick={speichernFuerKunden} disabled={speicherStatus === "speichert" || !name.trim()}
            className="w-full mt-2 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-medium transition-opacity"
            style={{ background: "rgba(201,162,39,0.18)", border: "1px solid rgba(201,162,39,0.4)", color: GOLD_SOFT, opacity: (speicherStatus === "speichert" || !name.trim()) ? 0.6 : 1 }}>
            {speicherStatus === "speichert" && "Wird gespeichert …"}
            {speicherStatus === "gespeichert" && "Gespeichert ✓"}
            {speicherStatus === "fehler" && "Fehlgeschlagen – nochmal versuchen"}
            {speicherStatus === "" && (aktiveId ? "Fallstudie aktualisieren" : "Als neue Fallstudie speichern")}
          </button>
        </div>
      )}

      <div className="rounded-2xl p-5" style={{ background: CARD, border: `1px solid ${HAIRLINE}` }}>
        <div className="flex items-center gap-2 mb-4">
          <Calculator size={15} color={GOLD_SOFT} />
          <div className="text-xs uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.4)" }}>Objektdaten</div>
        </div>

        <FeldGruppe titel="Kaufpreis & Miete">
          <ZahlenFeld label="Kaufpreis" value={kaufpreis} onChange={setKaufpreis} suffix="€" step={1000} />
          <ZahlenFeld label="Kaltmiete" value={kaltmieteMonat} onChange={setKaltmieteMonat} suffix="€/Monat" step={10} />
          <ZahlenFeld label="Nicht umlagefähiges Hausgeld" value={nichtUmlagefaehigMonat} onChange={setNichtUmlagefaehigMonat} suffix="€/Monat" step={5} />
          <ZahlenFeld label="Kaufnebenkosten" value={kaufnebenkostenProzent} onChange={setKaufnebenkostenProzent} suffix="%" step={0.5}
            hinweis={`≈ ${eur(Math.round(kaufpreis * kaufnebenkostenProzent / 100))}`} />
        </FeldGruppe>

        <FeldGruppe titel="Abschreibung (AfA)">
          <ZahlenFeld label="Gebäudeanteil" value={gebaeudeanteilProzent} onChange={setGebaeudeanteilProzent} suffix="%" step={1} max={100} />
          <ZahlenFeld label="AfA-Satz" value={afaSatzProzent} suffix="%" step={0.1}
            onChange={(v) => { setAfaSatzProzent(v); if (v > 0) setAfaDauerJahre(Math.round(100 / v)); }} />
          <ZahlenFeld label="AfA-Dauer" value={afaDauerJahre} onChange={setAfaDauerJahre} suffix="Jahre" step={1} />
        </FeldGruppe>

        <FeldGruppe titel="Entwicklung über die Zeit">
          <ZahlenFeld label="Mietsteigerung p. a." value={mietsteigerungProzent} onChange={setMietsteigerungProzent} suffix="%" step={0.1} />
          <ZahlenFeld label="Wertsteigerung p. a." value={wertsteigerungProzent} onChange={setWertsteigerungProzent} suffix="%" step={0.1} />
        </FeldGruppe>

        <div className="grid grid-cols-2 gap-3">
          <ZahlenFeld label="Sollzins" value={sollzinsProzent} onChange={setSollzinsProzent} suffix="%" step={0.05} />
          <ZahlenFeld label="Anfangstilgung" value={tilgungProzent} onChange={setTilgungProzent} suffix="%" step={0.1} />
        </div>
      </div>

      <div className="rounded-2xl p-5" style={{ background: CARD, border: `1px solid ${HAIRLINE}` }}>
        <div className="text-xs uppercase tracking-widest mb-4" style={{ color: "rgba(255,255,255,0.4)" }}>
          Kunde
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ZahlenFeld label="Grenzsteuersatz" value={steuersatzProzent} onChange={setSteuersatzProzent} suffix="%" step={0.5} max={47.5} />
          <ZahlenFeld label="Eigenkapitaleinsatz" value={ekEinsatz} onChange={setEkEinsatz} suffix="€" step={1000} />
        </div>
      </div>

      <div className="rounded-3xl p-6" style={{
        background: "linear-gradient(165deg, rgba(201,162,39,0.13), rgba(255,255,255,0.025) 55%)",
        border: "1px solid rgba(201,162,39,0.26)",
      }}>
        <div className="text-sm mb-3" style={{ color: "rgba(255,255,255,0.55)" }}>Zeitraum</div>
        <Segment
          optionen={[{ id: 10, label: "10 Jahre" }, { id: 20, label: "20 Jahre" }, { id: 30, label: "30 Jahre" }]}
          wert={jahr} onChange={setJahr}
        />

        <div className="mt-7 pt-6" style={{ borderTop: "1px solid rgba(201,162,39,0.22)" }}>
          <div className="text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
            Nettovermögen nach {jahr === 1 ? "einem Jahr" : `${jahr} Jahren`}
          </div>
          <div className="mt-2 font-semibold tabular-nums tracking-tight leading-none"
            style={{
              fontSize: "clamp(2.25rem, 9vw, 3.25rem)",
              background: `linear-gradient(120deg, #fff 20%, ${GOLD_SOFT})`,
              WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
            }}>
            {eur(Math.round(s.nettovermoegen))}
          </div>
          {ekEinsatz >= 1000 && (
            <div className="text-sm mt-2" style={{ color: "rgba(255,255,255,0.5)" }}>
              aus {eur(ekEinsatz)} eingesetztem Eigenkapital – Faktor {(s.nettovermoegen / ekEinsatz).toFixed(1).replace(".", ",")}×
            </div>
          )}
        </div>

        <VermoegensBand modell={modell} jahr={jahr} />

        <div className="rounded-2xl p-5 mt-4" style={{ background: "rgba(0,0,0,0.3)", border: `1px solid ${HAIRLINE}` }}>
          <Rechenzeile label={`Immobilienwert nach ${jahr} Jahren`} wert={eur(Math.round(s.immobilienwert))} />
          <Rechenzeile label="Restschuld" zeichen="−" wert={eur(Math.round(s.restschuld))} />
          <div style={{ borderTop: `1px solid ${HAIRLINE}` }} />
          <Rechenzeile label="Eigenkapital in der Immobilie" zeichen="=" wert={eur(Math.round(s.immobilienwert - s.restschuld))} />
          <Rechenzeile label="Steuerwirkung & Cashflow" zeichen={extra >= 0 ? "+" : "−"} wert={eur(Math.abs(Math.round(extra)))} />
          <div style={{ borderTop: `1px solid rgba(201,162,39,0.3)` }} />
          <Rechenzeile label="Nettovermögen" zeichen="=" wert={eur(Math.round(s.nettovermoegen))} stark />
        </div>

        <div className="mt-4">
          <Hinweis>{afaEndeText}</Hinweis>
        </div>

        <button onClick={() => setZeigeTabelle((v) => !v)}
          className="w-full mt-5 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-medium transition-colors"
          style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${HAIRLINE}`, color: "rgba(255,255,255,0.7)" }}>
          {zeigeTabelle ? "Jahrestabelle ausblenden" : `Jahr für Jahr anzeigen (${CONFIG.projektion.horizontJahre} Jahre)`}
        </button>

        {zeigeTabelle && (
          <div className="mt-4">
            <Jahrestabelle reihe={modell.reihe} />
          </div>
        )}
      </div>
    </div>
  );
}

const CRM_STATUS = {
  neu: { label: "Neu", color: GOLD_SOFT },
  strategiegespraech: { label: "Strategiegespräch", color: "#60A5FA" },
  objektpraesentation: { label: "Objektpräsentation", color: "#818CF8" },
  besichtigung: { label: "Besichtigung", color: "#34D399" },
  notartermin: { label: "Notartermin", color: "#A78BFA" },
  abgeschlossen: { label: "Abgeschlossen", color: "#4ADE80" },
  kein_interesse: { label: "Kein Interesse", color: "rgba(255,255,255,0.4)" },
};

/** Ein Zeile-Feld für die Detailansicht – rendert nichts, wenn kein Wert vorliegt. */
function CRMFeld({ label, wert }) {
  if (wert === undefined || wert === null || wert === "") return null;
  return (
    <div className="flex items-center justify-between gap-4 py-2.5" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
      <span className="text-sm shrink-0" style={{ color: "rgba(255,255,255,0.5)" }}>{label}</span>
      <span className="text-sm font-medium text-right">{wert}</span>
    </div>
  );
}

function LeadDetail({ lead, onZurueck, onAktualisieren, onLoeschen, onAnalysieren }) {
  const [neueNotiz, setNeueNotiz] = useState("");
  const [loeschenBestaetigen, setLoeschenBestaetigen] = useState(false);
  const [linkKopiert, setLinkKopiert] = useState(false);
  const kaufplan = useMemo(() => (lead.zielrente ? baueKaufplan(lead.zielrente) : null), [lead.zielrente]);
  const aktuellerStatus = lead.crmStatus || "neu";
  const selbstauskunftLink = typeof window !== "undefined"
    ? `${window.location.origin}${window.location.pathname}#selbstauskunft-${lead.id}` : "";

  const linkKopieren = async () => {
    try {
      await navigator.clipboard.writeText(selbstauskunftLink);
      setLinkKopiert(true);
      setTimeout(() => setLinkKopiert(false), 2000);
    } catch (e) { /* Zwischenablage nicht verfügbar – Link steht trotzdem sichtbar da */ }
  };
  // Abwärtskompatibel: ältere Leads hatten ein einzelnes überschreibbares
  // notizen-Textfeld statt eines Verlaufs – wird hier als ein Alt-Eintrag
  // mitgezeigt, statt beim Umstieg verloren zu gehen.
  const verlauf = lead.notizVerlauf || (lead.notizen ? [{ id: "alt", text: lead.notizen, datum: lead.erstelltAm }] : []);

  const notizHinzufuegen = () => {
    const text = neueNotiz.trim();
    if (!text) return;
    const eintrag = { id: `${Date.now()}`, text, datum: new Date().toISOString() };
    onAktualisieren({ notizVerlauf: [eintrag, ...verlauf], notizen: undefined });
    setNeueNotiz("");
  };

  return (
    <div className="min-h-screen px-5 pt-10 pb-20 max-w-2xl mx-auto" style={{ color: "#fff" }}>
      <button onClick={onZurueck} className="flex items-center gap-1.5 text-sm mb-6 -ml-1 p-1" style={{ color: "rgba(255,255,255,0.5)" }}>
        <ArrowLeft size={16} /> Zurück zur Liste
      </button>

      <h1 className="text-2xl font-semibold tracking-tight">{lead.vorname} {lead.nachname}</h1>
      <div className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>
        Eingegangen am {new Date(lead.erstelltAm).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}
      </div>

      <div className="flex gap-2.5 mt-5">
        {lead.telefon && (
          <a href={`tel:${lead.telefon}`} className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-medium transition-colors"
            style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${HAIRLINE}`, color: "#fff" }}>
            <Phone size={14} /> Anrufen
          </a>
        )}
        {lead.telefon && (
          <a href={waLink(`Hallo ${lead.vorname}, hier ist ${CONFIG.marke.name} von ${CONFIG.marke.firma}.`)} target="_blank" rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-medium transition-colors"
            style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${HAIRLINE}`, color: "#fff" }}>
            <MessageCircle size={14} /> WhatsApp
          </a>
        )}
        {lead.email && (
          <a href={`mailto:${lead.email}`} className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-medium transition-colors"
            style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${HAIRLINE}`, color: "#fff" }}>
            <Mail size={14} /> E-Mail
          </a>
        )}
      </div>

      {onAnalysieren && (
        <button onClick={onAnalysieren}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-3 mt-2.5 text-sm font-medium transition-colors"
          style={{ background: "rgba(201,162,39,0.12)", border: "1px solid rgba(201,162,39,0.35)", color: GOLD_SOFT }}>
          <Calculator size={15} /> Kunden analysieren
        </button>
      )}

      <div className="mt-7">
        <div className="text-xs uppercase tracking-widest mb-2.5" style={{ color: "rgba(255,255,255,0.4)" }}>Status</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(CRM_STATUS).map(([key, s]) => (
            <button key={key} onClick={() => onAktualisieren({ crmStatus: key })}
              className="rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: aktuellerStatus === key ? s.color : "rgba(255,255,255,0.06)",
                color: aktuellerStatus === key ? "#0A0A0B" : "rgba(255,255,255,0.6)",
                border: `1px solid ${aktuellerStatus === key ? s.color : HAIRLINE}`,
              }}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-7">
        <div className="text-xs uppercase tracking-widest mb-2.5" style={{ color: "rgba(255,255,255,0.4)" }}>Follow-up-Verlauf</div>
        <div className="flex gap-2">
          <textarea
            value={neueNotiz} onChange={(e) => setNeueNotiz(e.target.value)}
            rows={2} placeholder="Neue Notiz, z. B. Ergebnis eines Telefonats …"
            className="flex-1 rounded-xl px-4 py-3 text-sm outline-none resize-none"
            style={{ background: "rgba(0,0,0,0.35)", border: `1px solid ${HAIRLINE}`, color: "#fff" }}
            onFocus={(e) => (e.target.style.borderColor = GOLD)}
            onBlur={(e) => (e.target.style.borderColor = HAIRLINE)}
          />
          <button onClick={notizHinzufuegen} disabled={!neueNotiz.trim()}
            className="shrink-0 rounded-xl px-4 text-sm font-medium transition-colors"
            style={{
              background: neueNotiz.trim() ? GOLD : "rgba(255,255,255,0.06)",
              color: neueNotiz.trim() ? "#15130B" : "rgba(255,255,255,0.3)",
              cursor: neueNotiz.trim() ? "pointer" : "not-allowed",
            }}>
            Hinzufügen
          </button>
        </div>

        {verlauf.length > 0 && (
          <div className="mt-4 space-y-3.5">
            {verlauf.map((e) => (
              <div key={e.id} className="pl-3" style={{ borderLeft: `2px solid ${HAIRLINE}` }}>
                <div className="text-xs mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>
                  {new Date(e.datum).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}
                </div>
                <div className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>{e.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {kaufplan && (
        <div className="mt-7 rounded-2xl p-5" style={{ background: "rgba(201,162,39,0.08)", border: "1px solid rgba(201,162,39,0.25)" }}>
          <div className="text-xs uppercase tracking-widest mb-2" style={{ color: GOLD_SOFT }}>Passender Kaufplan</div>
          <div className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>
            {kaufplan.gesamtanzahl} Objekte à {eurK(kaufplan.kaufpreis)} € · Gesamtvolumen {eur(kaufplan.volumen)}
          </div>
        </div>
      )}

      <div className="mt-7">
        <div className="text-xs uppercase tracking-widest mb-2.5" style={{ color: "rgba(255,255,255,0.4)" }}>Selbstauskunft</div>
        {lead.selbstauskunft ? (
          <div className="rounded-2xl p-4" style={{ background: CARD, border: `1px solid ${HAIRLINE}` }}>
            <div className="text-xs mb-3" style={{ color: "rgba(255,255,255,0.4)" }}>
              Eingegangen am {new Date(lead.selbstauskunftEingereichtAm).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}
            </div>
            {Object.entries(SELBSTAUSKUNFT_LABELS).map(([key, label]) => (
              <CRMFeld key={key} label={label} wert={lead.selbstauskunft[key]} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl p-4" style={{ background: CARD, border: `1px solid ${HAIRLINE}` }}>
            <p className="text-sm leading-relaxed mb-3" style={{ color: "rgba(255,255,255,0.6)" }}>
              Noch keine Selbstauskunft eingegangen. Schick diesen Link an {lead.vorname}, damit die
              Daten für die Bank erfasst werden können.
            </p>
            <div className="text-xs px-3 py-2.5 rounded-lg mb-3 break-all" style={{ background: "rgba(0,0,0,0.3)", color: "rgba(255,255,255,0.5)" }}>
              {selbstauskunftLink}
            </div>
            <div className="flex gap-2">
              <button onClick={linkKopieren} className="text-xs font-medium px-3.5 py-2 rounded-full transition-colors"
                style={{ background: linkKopiert ? "rgba(52,211,153,0.15)" : "rgba(255,255,255,0.06)", color: linkKopiert ? GREEN : "rgba(255,255,255,0.7)", border: `1px solid ${linkKopiert ? "rgba(52,211,153,0.3)" : HAIRLINE}` }}>
                {linkKopiert ? "Link kopiert ✓" : "Link kopieren"}
              </button>
              <a href={waLink(`Hallo ${lead.vorname}, könntest du bitte noch kurz deine Selbstauskunft für die Finanzierung ausfüllen? ${selbstauskunftLink}`)}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-full transition-colors"
                style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${HAIRLINE}`, color: "rgba(255,255,255,0.7)" }}>
                <MessageCircle size={13} /> Per WhatsApp senden
              </a>
            </div>
          </div>
        )}
      </div>

      <div className="mt-7">
        <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>Kontaktdaten</div>
        <CRMFeld label="Telefon" wert={lead.telefon} />
        <CRMFeld label="E-Mail" wert={lead.email || "–"} />
        <CRMFeld label="Wunschtermin" wert={lead.termin || "–"} />
        <CRMFeld label="Formular vollständig ausgefüllt" wert={lead.vollstaendig ? "Ja" : "Nein – nur Telefon-Gate"} />
      </div>

      <div className="mt-7">
        <div className="text-xs uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>Auswertung aus dem Funnel</div>
        <CRMFeld label="Ziele" wert={(lead.ziele || []).join(", ") || "–"} />
        <CRMFeld label="Alter" wert={lead.alter ? `${lead.alter} Jahre` : "–"} />
        <CRMFeld label="Berufsstatus" wert={STATUS.find((s) => s.id === lead.status)?.label || lead.status || "–"} />
        <CRMFeld label="Bruttoeinkommen" wert={lead.brutto ? eur(lead.brutto) : "–"} />
        <CRMFeld label="Eigenkapital" wert={lead.eigenkapital !== undefined ? eur(lead.eigenkapital) : "–"} />
        <CRMFeld label="Sparrate" wert={lead.sparrate !== undefined ? `${eur(lead.sparrate)} / Monat` : "–"} />
        <CRMFeld label="Besitzt bereits Immobilien" wert={
          lead.hatImmobilien === true ? `Ja (${lead.immobilien ?? "?"})` : lead.hatImmobilien === false ? "Nein" : "–"
        } />
        <CRMFeld label="Zielrente" wert={lead.zielrente ? `${eur(lead.zielrente)} / Monat` : "–"} />
        <CRMFeld label="Zeitpunkt" wert={ZEITPUNKT.find((z) => z.id === lead.zeitpunkt)?.label || lead.zeitpunkt || "–"} />
      </div>

      <div className="mt-8 pt-6" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
        {loeschenBestaetigen ? (
          <div className="flex items-center gap-2.5">
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>Wirklich löschen?</span>
            <button onClick={onLoeschen} className="text-xs font-medium px-3 py-1.5 rounded-full"
              style={{ background: "rgba(239,68,68,0.15)", color: "#FCA5A5", border: "1px solid rgba(239,68,68,0.3)" }}>
              Ja, löschen
            </button>
            <button onClick={() => setLoeschenBestaetigen(false)} className="text-xs px-3 py-1.5 rounded-full"
              style={{ color: "rgba(255,255,255,0.5)" }}>
              Abbrechen
            </button>
          </div>
        ) : (
          <button onClick={() => setLoeschenBestaetigen(true)} className="flex items-center gap-1.5 text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
            <Trash2 size={13} /> Lead löschen
          </button>
        )}
      </div>
    </div>
  );
}

/** Login-Sperre vor dem CRM. Nutzt Supabase Auth (E-Mail/Passwort) statt
 * eines im Code versteckten Fest-Passworts – der eigentliche Datenschutz
 * kommt sowieso aus der Datenbank-Berechtigung (RLS), das Login hier ist
 * die dazugehörige Vordertür. Session lebt nur im React-State: kein
 * localStorage, dafür beim Neuladen der Seite erneute Anmeldung nötig. */
function CRMLogin({ onErfolg }) {
  const [email, setEmail] = useState("");
  const [passwort, setPasswort] = useState("");
  const [fehler, setFehler] = useState("");
  const [laedt, setLaedt] = useState(false);

  const anmelden = async () => {
    if (!email || !passwort) return;
    setLaedt(true);
    setFehler("");
    const token = await supabaseAnmelden(email, passwort);
    setLaedt(false);
    if (!token) { setFehler("E-Mail oder Passwort falsch."); return; }
    onErfolg(token);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-5" style={{ color: "#fff" }}>
      <div className="w-full max-w-sm">
        <div className="text-xl font-semibold mb-1 text-center">Anmeldung</div>
        <div className="text-sm text-center mb-7" style={{ color: "rgba(255,255,255,0.45)" }}>Interner Bereich</div>
        <div className="space-y-3">
          <input
            type="email" inputMode="email" autoComplete="username" placeholder="E-Mail"
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors"
            style={{ background: "rgba(0,0,0,0.35)", border: `1px solid ${HAIRLINE}`, color: "#fff" }}
            onFocus={(e) => (e.target.style.borderColor = GOLD)}
            onBlur={(e) => (e.target.style.borderColor = HAIRLINE)}
          />
          <input
            type="password" autoComplete="current-password" placeholder="Passwort"
            value={passwort} onChange={(e) => setPasswort(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && anmelden()}
            className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors"
            style={{ background: "rgba(0,0,0,0.35)", border: `1px solid ${HAIRLINE}`, color: "#fff" }}
            onFocus={(e) => (e.target.style.borderColor = GOLD)}
            onBlur={(e) => (e.target.style.borderColor = HAIRLINE)}
          />
        </div>
        {fehler && <div className="text-sm mt-3" style={{ color: "#FCA5A5" }}>{fehler}</div>}
        <button onClick={anmelden} disabled={laedt}
          className="w-full mt-5 rounded-xl py-3 text-sm font-medium transition-opacity"
          style={{ background: GOLD, color: "#0A0A0B", opacity: laedt ? 0.6 : 1 }}>
          {laedt ? "Wird geprüft …" : "Anmelden"}
        </button>
      </div>
    </div>
  );
}

function CRM({ onZurueck, accessToken }) {
  const [tab, setTab] = useState("leads"); // "leads" | "analyse"
  const [leads, setLeads] = useState(null);
  const [filter, setFilter] = useState("alle");
  const [suche, setSuche] = useState("");
  const [aktivId, setAktivId] = useState(null);
  const [ladeFehler, setLadeFehler] = useState(false);
  const [analyseVorlage, setAnalyseVorlage] = useState(null);

  const laden = async () => {
    setLadeFehler(false);
    const daten = await ladeLeads(accessToken);
    if (daten === null) { setLadeFehler(true); return; }
    daten.sort((a, b) => new Date(b.erstelltAm) - new Date(a.erstelltAm));
    setLeads(daten);
  };

  useEffect(() => { laden(); }, []);

  const aktualisieren = async (id, patch) => {
    setLeads((vorher) => vorher.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    await speichereLead({ id, ...patch }, accessToken);
  };

  const hinzufuegenBeispiel = async () => {
    const neu = beispielLead();
    setLeads((vorher) => [neu, ...(vorher || [])]);
    await speichereLead(neu, accessToken);
  };

  const loeschen = async (id) => {
    setLeads((vorher) => vorher.filter((l) => l.id !== id));
    setAktivId(null);
    await loescheLead(id, accessToken);
  };

  const zaehler = (status) =>
    (leads || []).filter((l) => (status === "alle" ? true : (l.crmStatus || "neu") === status)).length;

  const gefiltert = useMemo(() => {
    if (!leads) return [];
    let liste = filter === "alle" ? leads : leads.filter((l) => (l.crmStatus || "neu") === filter);
    const q = suche.trim().toLowerCase();
    if (q) {
      liste = liste.filter((l) =>
        `${l.vorname} ${l.nachname}`.toLowerCase().includes(q) ||
        (l.telefon || "").includes(q) || (l.email || "").toLowerCase().includes(q)
      );
    }
    return liste;
  }, [leads, filter, suche]);

  if (leads !== null && aktivId) {
    const lead = leads.find((l) => l.id === aktivId);
    if (lead) {
      return <LeadDetail lead={lead} onZurueck={() => setAktivId(null)} onAktualisieren={(patch) => aktualisieren(aktivId, patch)} onLoeschen={() => loeschen(aktivId)} onAnalysieren={() => { setAnalyseVorlage(lead); setAktivId(null); setTab("analyse"); }} />;
    }
  }

  return (
    <div className="min-h-screen px-5 pt-10 pb-20 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Users size={20} color={GOLD_SOFT} /> {tab === "leads" ? "Leads" : "Analyse"}
        </h1>
        {tab === "leads" && (
          <div className="flex items-center gap-1">
            <button onClick={hinzufuegenBeispiel} className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors"
              style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${HAIRLINE}`, color: "rgba(255,255,255,0.6)" }}>
              <Plus size={13} /> Beispiel
            </button>
            <button onClick={laden} className="p-2 -mr-2 rounded-full transition-colors" style={{ color: "rgba(255,255,255,0.5)" }} aria-label="Aktualisieren">
              <RefreshCw size={16} />
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-2 mb-6">
        {[{ id: "leads", label: "Leads" }, { id: "analyse", label: "Analyse fürs Gespräch" }].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors"
            style={{
              background: tab === t.id ? GOLD : "rgba(255,255,255,0.06)",
              color: tab === t.id ? "#15130B" : "rgba(255,255,255,0.6)",
              border: `1px solid ${tab === t.id ? GOLD : HAIRLINE}`,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "analyse" && <AnalyseTool initialLead={analyseVorlage} onVorlageEntfernen={() => setAnalyseVorlage(null)} accessToken={accessToken} />}

      {tab === "leads" && (
        <>
      {ladeFehler && (
        <div className="rounded-2xl p-4 mb-5 text-sm" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#FCA5A5" }}>
          Leads konnten nicht geladen werden. Kurz warten und nochmal versuchen.
        </div>
      )}

      {leads === null ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw size={18} color="rgba(255,255,255,0.3)" />
        </div>
      ) : (
        <>
          <div className="relative mb-4">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" color="rgba(255,255,255,0.35)" />
            <input
              value={suche} onChange={(e) => setSuche(e.target.value)}
              placeholder="Name, Telefon oder E-Mail suchen"
              className="w-full rounded-xl pl-10 pr-4 py-3 text-sm outline-none transition-colors"
              style={{ background: "rgba(0,0,0,0.35)", border: `1px solid ${HAIRLINE}`, color: "#fff" }}
              onFocus={(e) => (e.target.style.borderColor = GOLD)}
              onBlur={(e) => (e.target.style.borderColor = HAIRLINE)}
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 mb-5" style={{ scrollbarWidth: "none" }}>
            {["alle", ...Object.keys(CRM_STATUS)].map((s) => (
              <button key={s} onClick={() => setFilter(s)}
                className="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors"
                style={{
                  background: filter === s ? GOLD : "rgba(255,255,255,0.06)",
                  color: filter === s ? "#15130B" : "rgba(255,255,255,0.6)",
                  border: `1px solid ${filter === s ? GOLD : HAIRLINE}`,
                }}>
                {s === "alle" ? "Alle" : CRM_STATUS[s].label} ({zaehler(s)})
              </button>
            ))}
          </div>

          {gefiltert.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm mb-4" style={{ color: "rgba(255,255,255,0.4)" }}>
                {leads.length === 0 ? "Noch keine Leads eingegangen." : "Keine Leads in dieser Ansicht."}
              </p>
              {leads.length === 0 && (
                <button onClick={hinzufuegenBeispiel} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-colors"
                  style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${HAIRLINE}`, color: "rgba(255,255,255,0.7)" }}>
                  <Plus size={14} /> Beispiel-Lead anlegen
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {gefiltert.map((lead) => {
                const st = CRM_STATUS[lead.crmStatus || "neu"];
                return (
                  <button key={lead.id} onClick={() => setAktivId(lead.id)}
                    className="w-full text-left rounded-2xl p-4 transition-colors"
                    style={{ background: CARD, border: `1px solid ${HAIRLINE}` }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{lead.vorname} {lead.nachname}</div>
                        <div className="text-xs mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.4)" }}>
                          {lead.telefon}{lead.zielrente ? ` · Ziel ${eur(lead.zielrente)}/Monat` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        <span className="text-[11px] font-medium px-2 py-1 rounded-full whitespace-nowrap" style={{ background: `${st.color}22`, color: st.color }}>
                          {st.label}
                        </span>
                        <ChevronRight size={16} color="rgba(255,255,255,0.3)" />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
      </>
      )}

      <button onClick={onZurueck} className="mt-10 text-xs underline" style={{ color: "rgba(255,255,255,0.3)" }}>
        Zurück zum Funnel
      </button>
    </div>
  );
}

/* ======================================================== Selbstauskunft */
const FAMILIENSTAND = [
  { id: "ledig", label: "Ledig" },
  { id: "verheiratet", label: "Verheiratet" },
  { id: "lebenspartnerschaft", label: "Eingetragene Lebenspartnerschaft" },
  { id: "geschieden", label: "Geschieden" },
  { id: "verwitwet", label: "Verwitwet" },
];

const SELBSTAUSKUNFT_LEER = {
  vorname: "", nachname: "", geburtsdatum: "", geburtsort: "", staatsangehoerigkeit: "",
  familienstand: "", kinder: "", adresse: "", plzOrt: "", wohnhaftSeit: "",
  berufsstatus: "", arbeitgeber: "", branche: "", beschaeftigtSeit: "", befristet: "",
  nettoEinkommen: "", sonderzahlungen: "",
  mieteinnahmen: "", kapitalertraege: "", sonstigeEinkuenfte: "",
  mieteAktuell: "", bestehendeKreditraten: "", unterhaltszahlungen: "",
  bankguthaben: "", wertpapiere: "", lebensversicherungWert: "", vorhandeneImmobilien: "", fahrzeuge: "",
};

/** Feld-Bezeichnungen für die Anzeige im CRM – hält Formular und Detailansicht synchron. */
const SELBSTAUSKUNFT_LABELS = {
  geburtsdatum: "Geburtsdatum", geburtsort: "Geburtsort", staatsangehoerigkeit: "Staatsangehörigkeit",
  familienstand: "Familienstand", kinder: "Unterhaltspflichtige Kinder", adresse: "Adresse", plzOrt: "PLZ / Ort",
  wohnhaftSeit: "Wohnhaft seit", berufsstatus: "Berufsstatus", arbeitgeber: "Arbeitgeber", branche: "Branche",
  beschaeftigtSeit: "Beschäftigt seit", befristet: "Befristet", nettoEinkommen: "Netto-Einkommen / Monat",
  sonderzahlungen: "Sonderzahlungen (13./14. Gehalt etc.)", mieteinnahmen: "Mieteinnahmen / Monat",
  kapitalertraege: "Kapitalerträge / Jahr", sonstigeEinkuenfte: "Sonstige Einkünfte", mieteAktuell: "Aktuelle Miete / Monat",
  bestehendeKreditraten: "Bestehende Kreditraten / Monat", unterhaltszahlungen: "Unterhaltszahlungen / Monat",
  bankguthaben: "Bankguthaben / Rücklagen", wertpapiere: "Wertpapierdepot (ca. Wert)",
  lebensversicherungWert: "Lebensversicherung (Rückkaufswert)", vorhandeneImmobilien: "Vorhandene Immobilien",
  fahrzeuge: "Fahrzeuge (ca. Wert)",
};

function Selbstauskunft({ leadId }) {
  const [lead, setLead] = useState(undefined); // undefined = lädt, null = nicht gefunden
  const [d, setD] = useState(SELBSTAUSKUNFT_LEER);
  const [einwilligung, setEinwilligung] = useState(false);
  const [gesendet, setGesendet] = useState(false);
  const [fehler, setFehler] = useState("");

  useEffect(() => {
    (async () => {
      const gefunden = await holeLeadPerId(leadId);
      setLead(gefunden);
      if (gefunden) {
        setD((vorher) => ({
          ...vorher,
          vorname: gefunden.vorname || "", nachname: gefunden.nachname || "",
          ...(gefunden.selbstauskunft || {}),
        }));
      }
    })();
  }, [leadId]);

  const set = (key) => (e) => setD((vorher) => ({ ...vorher, [key]: e.target.value }));

  const senden = async () => {
    if (!d.vorname || !d.nachname || !d.geburtsdatum || !d.adresse || !d.plzOrt) {
      return setFehler("Bitte mindestens Name, Geburtsdatum und Adresse ausfüllen.");
    }
    if (!einwilligung) return setFehler("Bitte bestätige die Einwilligung zur Datenverarbeitung.");
    setFehler("");
    await speichereLead({ id: leadId, selbstauskunft: d, selbstauskunftEingereichtAm: new Date().toISOString() });
    setGesendet(true);
  };

  const feld = (key, label, opts = {}) => (
    <div>
      <label className="text-xs block mb-2" style={{ color: "rgba(255,255,255,0.45)" }}>
        {label}{opts.required && " *"}
      </label>
      {opts.select ? (
        <select value={d[key]} onChange={set(key)}
          className="w-full rounded-xl px-4 py-3.5 text-base outline-none appearance-none"
          style={{ background: "rgba(0,0,0,0.35)", border: `1px solid ${HAIRLINE}`, color: d[key] ? "#fff" : "rgba(255,255,255,0.4)" }}>
          <option value="">Bitte wählen</option>
          {opts.select.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      ) : (
        <input
          type={opts.type || "text"} value={d[key]} onChange={set(key)} placeholder={opts.placeholder}
          className="w-full rounded-xl px-4 py-3.5 text-base outline-none transition-colors"
          style={{ background: "rgba(0,0,0,0.35)", border: `1px solid ${HAIRLINE}`, color: "#fff" }}
          onFocus={(e) => (e.target.style.borderColor = GOLD)}
          onBlur={(e) => (e.target.style.borderColor = HAIRLINE)}
        />
      )}
    </div>
  );

  if (lead === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefreshCw size={20} color="rgba(255,255,255,0.3)" />
      </div>
    );
  }

  if (lead === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 text-center">
        <p className="text-sm max-w-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
          Dieser Link ist nicht mehr gültig. Bitte wende dich an {CONFIG.marke.name}, um einen neuen Link zu erhalten.
        </p>
      </div>
    );
  }

  if (gesendet) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 text-center">
        <div className="inline-flex items-center justify-center rounded-full mb-5" style={{ width: 48, height: 48, background: "rgba(52,211,153,0.14)" }}>
          <Check size={22} color={GREEN} />
        </div>
        <h1 className="text-xl font-semibold mb-2">Danke, {d.vorname}!</h1>
        <p className="text-sm max-w-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
          Deine Selbstauskunft ist eingegangen. {CONFIG.marke.name} meldet sich mit den nächsten Schritten zur Finanzierung bei dir.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-5 pt-12 pb-24 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight mb-2">Selbstauskunft</h1>
      <p className="text-sm leading-relaxed mb-8" style={{ color: "rgba(255,255,255,0.5)" }}>
        Diese Angaben braucht die Bank, um deine Finanzierung zu prüfen. Alles, was du hier einträgst,
        wird ausschließlich zur Vorbereitung deiner Finanzierungsanfrage verwendet.
      </p>

      <Eyebrow>Persönliche Angaben</Eyebrow>
      <div className="grid grid-cols-2 gap-3 mb-3">
        {feld("vorname", "Vorname", { required: true })}
        {feld("nachname", "Nachname", { required: true })}
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        {feld("geburtsdatum", "Geburtsdatum", { type: "date", required: true })}
        {feld("geburtsort", "Geburtsort")}
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        {feld("staatsangehoerigkeit", "Staatsangehörigkeit")}
        {feld("familienstand", "Familienstand", { select: FAMILIENSTAND })}
      </div>
      <div className="mb-3">{feld("kinder", "Unterhaltspflichtige Kinder", { type: "number" })}</div>
      <div className="mb-3">{feld("adresse", "Straße und Hausnummer", { required: true })}</div>
      <div className="grid grid-cols-2 gap-3 mb-8">
        {feld("plzOrt", "PLZ und Ort", { required: true })}
        {feld("wohnhaftSeit", "Wohnhaft seit", { placeholder: "MM/JJJJ" })}
      </div>

      <Eyebrow>Beschäftigung & Einkommen</Eyebrow>
      <div className="mb-3">{feld("berufsstatus", "Berufsstatus", { select: STATUS })}</div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        {feld("arbeitgeber", "Arbeitgeber")}
        {feld("branche", "Branche")}
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        {feld("beschaeftigtSeit", "Beschäftigt seit", { placeholder: "MM/JJJJ" })}
        {feld("befristet", "Befristet oder unbefristet")}
      </div>
      <div className="grid grid-cols-2 gap-3 mb-8">
        {feld("nettoEinkommen", "Netto-Einkommen / Monat", { type: "number", placeholder: "€" })}
        {feld("sonderzahlungen", "Sonderzahlungen (13./14. Gehalt etc.)", { placeholder: "€ / Jahr, falls vorhanden" })}
      </div>

      <Eyebrow>Weitere Einkünfte (falls vorhanden)</Eyebrow>
      <div className="grid grid-cols-2 gap-3 mb-3">
        {feld("mieteinnahmen", "Mieteinnahmen / Monat", { type: "number", placeholder: "€" })}
        {feld("kapitalertraege", "Kapitalerträge / Jahr", { type: "number", placeholder: "€" })}
      </div>
      <div className="mb-8">{feld("sonstigeEinkuenfte", "Sonstige Einkünfte")}</div>

      <Eyebrow>Monatliche Verpflichtungen</Eyebrow>
      <div className="grid grid-cols-2 gap-3 mb-3">
        {feld("mieteAktuell", "Aktuelle Miete / Monat", { type: "number", placeholder: "€, falls zur Miete wohnhaft" })}
        {feld("bestehendeKreditraten", "Bestehende Kreditraten / Monat", { type: "number", placeholder: "€" })}
      </div>
      <div className="mb-8">{feld("unterhaltszahlungen", "Unterhaltszahlungen / Monat", { type: "number", placeholder: "€" })}</div>

      <Eyebrow>Vermögen</Eyebrow>
      <div className="grid grid-cols-2 gap-3 mb-3">
        {feld("bankguthaben", "Bankguthaben / Rücklagen", { type: "number", placeholder: "€" })}
        {feld("wertpapiere", "Wertpapierdepot (ca. Wert)", { type: "number", placeholder: "€" })}
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        {feld("lebensversicherungWert", "Lebensversicherung (Rückkaufswert)", { type: "number", placeholder: "€, falls vorhanden" })}
        {feld("fahrzeuge", "Fahrzeuge (ca. Wert)", { type: "number", placeholder: "€" })}
      </div>
      <div className="mb-8">{feld("vorhandeneImmobilien", "Vorhandene Immobilien", { placeholder: "z. B. Wert und Restschuld" })}</div>

      <label className="flex items-start gap-3 mb-6 cursor-pointer">
        <span
          onClick={() => setEinwilligung(!einwilligung)}
          className="flex items-center justify-center shrink-0 transition-all duration-200 mt-0.5"
          style={{
            width: 20, height: 20, borderRadius: 6,
            border: `1px solid ${einwilligung ? GOLD : "rgba(255,255,255,0.25)"}`,
            background: einwilligung ? GOLD : "transparent",
          }}>
          {einwilligung && <Check size={13} color="#15130B" strokeWidth={3} />}
        </span>
        <span className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
          Ich willige ein, dass {CONFIG.marke.name} / {CONFIG.marke.firma} die oben angegebenen Daten
          ausschließlich zur Vorbereitung und Weiterleitung meiner Finanzierungsanfrage an eine finanzierende
          Bank verarbeitet. Widerruf jederzeit möglich.
        </span>
      </label>

      {fehler && <p className="text-sm mb-4" style={{ color: "#F87171" }}>{fehler}</p>}

      <GoldButton full onClick={senden}>
        Selbstauskunft absenden <ArrowRight size={18} />
      </GoldButton>
    </div>
  );
}

function KontaktFormular({ telefonVorausgefuellt = "", vornameVorausgefuellt = "", nachnameVorausgefuellt = "", leadId }) {
  const [d, setD] = useState({ vorname: vornameVorausgefuellt, nachname: nachnameVorausgefuellt, email: "", telefon: telefonVorausgefuellt, termin: "" });
  const [gesendet, setGesendet] = useState(false);
  const [fehler, setFehler] = useState("");

  const AUTOCOMPLETE = { vorname: "given-name", nachname: "family-name", email: "email", telefon: "tel" };

  const feld = (key, label, type = "text") => (
    <div>
      <label className="text-xs block mb-2" style={{ color: "rgba(255,255,255,0.45)" }}>{label}</label>
      <input
        type={type} value={d[key]}
        name={AUTOCOMPLETE[key]} autoComplete={AUTOCOMPLETE[key]}
        onChange={(e) => setD({ ...d, [key]: e.target.value })}
        className="w-full rounded-xl px-4 py-3.5 text-base outline-none transition-colors"
        style={{ background: "rgba(0,0,0,0.35)", border: `1px solid ${HAIRLINE}`, color: "#fff" }}
        onFocus={(e) => (e.target.style.borderColor = GOLD)}
        onBlur={(e) => (e.target.style.borderColor = HAIRLINE)}
      />
    </div>
  );

  const senden = () => {
    if (!d.vorname || !d.nachname) return setFehler("Bitte Vor- und Nachnamen eintragen.");
    if (!/^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/.test(d.email)) return setFehler("Diese E-Mail-Adresse lässt sich nicht zustellen.");
    if (d.telefon.replace(/\D/g, "").length < 7) return setFehler("Die Telefonnummer ist zu kurz.");
    setFehler("");
    setGesendet(true);
    // Das Standard-Lead-Event feuert bereits beim Telefon-Gate vor der Auswertung.
    // Hier nur ein Zusatz-Event, damit Meta/GA nicht zwei Leads für dieselbe Person zählen.
    trackEvent("termin_angefragt", { termin: d.termin || undefined });
    // Vervollständigt den beim Telefon-Gate angelegten Lead-Datensatz um E-Mail
    // und Wunschtermin (Upsert über dieselbe id) – kein doppelter Eintrag im CRM.
    speichereLead({
      id: leadId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      vorname: d.vorname, nachname: d.nachname, telefon: d.telefon, email: d.email, termin: d.termin,
      vollstaendig: true,
    });
  };

  if (gesendet) {
    return (
      <div className="mt-8 rounded-2xl p-7 text-center" style={{ background: "rgba(52,211,153,0.07)", border: `1px solid rgba(52,211,153,0.3)` }}>
        <div className="inline-flex items-center justify-center rounded-full mb-4"
          style={{ width: 44, height: 44, background: "rgba(52,211,153,0.14)" }}>
          <Check size={20} color={GREEN} />
        </div>
        <div className="text-lg font-medium">Anfrage eingegangen</div>
        <p className="text-sm mt-2" style={{ color: "rgba(255,255,255,0.55)" }}>
          Wir melden uns innerhalb von 24 Stunden bei dir, {d.vorname}.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-4" style={{ animation: "vkIn .5s cubic-bezier(.16,1,.3,1)" }}>
      <div className="grid grid-cols-2 gap-3">
        {feld("vorname", "Vorname")}
        {feld("nachname", "Nachname")}
      </div>
      {feld("email", "E-Mail", "email")}
      {feld("telefon", "Telefonnummer", "tel")}

      <div>
        <label className="text-xs block mb-2" style={{ color: "rgba(255,255,255,0.45)" }}>Wunschtermin (optional)</label>
        <div className="grid grid-cols-4 gap-2">
          {TERMINE.map((t) => (
            <button key={t} onClick={() => setD({ ...d, termin: d.termin === t ? "" : t })}
              className="rounded-xl py-3 text-xs transition-all duration-200"
              style={{
                background: d.termin === t ? "rgba(201,162,39,0.13)" : "rgba(0,0,0,0.35)",
                border: `1px solid ${d.termin === t ? "rgba(201,162,39,0.55)" : HAIRLINE}`,
                color: d.termin === t ? GOLD_SOFT : "rgba(255,255,255,0.55)",
              }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {fehler && <div className="text-sm" style={{ color: "#F87171" }}>{fehler}</div>}

      <div className="pt-2">
        <GoldButton full onClick={senden}>Analysegespräch anfragen <ArrowRight size={18} /></GoldButton>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.3)" }}>
        Mit dem Absenden willigst du ein, dass wir deine Angaben zur Kontaktaufnahme verarbeiten.
        Du kannst die Einwilligung jederzeit widerrufen. Details in der Datenschutzerklärung.
      </p>
    </div>
  );
}

/** Öffentliche, blanko Version des internen Objekt-Rechners – exakt dieselbe
 * Komponente wie im CRM, nur ohne Kunden-Kontext (kein initialLead), daher
 * blendet sich das Speichern/Kunden-Banner automatisch aus. Nichts wird
 * hier gespeichert, reines Durchprobieren für Besucher. */
function RechnerSeite({ onZurueck, onStart }) {
  return (
    <div className="min-h-screen px-5 pt-10 pb-20 max-w-2xl mx-auto">
      <button onClick={onZurueck} className="text-sm mb-6 -ml-1 p-1 flex items-center gap-1" style={{ color: "rgba(255,255,255,0.5)" }}>
        <ArrowLeft size={15} /> Zurück
      </button>
      <div className="mb-6">
        <Eyebrow>Kostenloser Rechner</Eyebrow>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Calculator size={20} color={GOLD_SOFT} /> Immobilien-Kalkulator
        </h1>
        <p className="text-sm mt-2" style={{ color: "rgba(255,255,255,0.5)" }}>
          Spiel frei mit den Zahlen – Kaufpreis, Miete, Zins, Tilgung, Steuersatz, alles live
          durchgerechnet. Nichts davon wird gespeichert.
        </p>
      </div>
      <AnalyseTool />

      <div className="rounded-3xl p-7 text-center mt-6" style={{
        background: "linear-gradient(165deg, rgba(201,162,39,0.13), rgba(255,255,255,0.025) 55%)",
        border: "1px solid rgba(201,162,39,0.26)",
      }}>
        <h2 className="text-xl font-semibold tracking-tight">Deine Zahlen passen? Lass uns drüber sprechen.</h2>
        <p className="text-sm mt-2 max-w-sm mx-auto" style={{ color: "rgba(255,255,255,0.55)" }}>
          Kein festes Angebot, nur ein kurzes, unverbindliches Gespräch über deine konkrete Situation.
        </p>
        <a href={waLink("Hallo Philipp, ich habe mit dem Rechner gespielt und würde gerne einen Termin vereinbaren.")}
          target="_blank" rel="noopener noreferrer"
          onClick={() => trackEvent("rechner_cta_click")}
          className="inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 text-sm font-semibold mt-5"
          style={{ background: `linear-gradient(135deg, ${GOLD_SOFT}, ${GOLD})`, color: "#171205" }}>
          Jetzt Termin vereinbaren <ArrowRight size={16} />
        </a>

        {onStart && (
          <div className="mt-4">
            <button onClick={() => { trackEvent("rechner_zu_analyse_click"); onStart(); }}
              className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-medium"
              style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${HAIRLINE}`, color: "rgba(255,255,255,0.75)" }}>
              Oder: Jetzt Vermögensanalyse starten <ArrowRight size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================== App */
const START = {
  vorname: "", nachname: "",
  ziele: [], alter: 30, status: "", selbststaendigSeit: 3, brutto: 60000,
  eigenkapital: 30000, eigenkapitalEinsatz: 0, sparrate: 500, zielrente: 5500,
  hatImmobilien: null, immobilien: 0, zeitpunkt: "",
};

export default function Vermoegenskompass() {
  const [phase, setPhase] = useState(() => {
    if (typeof window === "undefined") return "start";
    if (window.location.pathname === "/rechner") return "rechner";
    if (window.location.hash === "#crm") return "crm";
    if (window.location.hash === "#rechner") return "rechner";
    if (window.location.hash.startsWith("#selbstauskunft-")) return "selbstauskunft";
    return "start";
  });
  const [selbstauskunftLeadId] = useState(() => {
    if (typeof window === "undefined") return null;
    const treffer = window.location.hash.match(/^#selbstauskunft-(.+)$/);
    return treffer ? treffer[1] : null;
  });
  const [vorherigePhase, setVorherigePhase] = useState("start");
  const [antworten, setAntworten] = useState(START);
  const [telefon, setTelefon] = useState("");
  const [leadId, setLeadId] = useState(null);
  const [crmSession, setCrmSession] = useState(null);
  const top = useRef(null);

  const oeffneImpressum = () => { setVorherigePhase(phase); setPhase("impressum"); };
  const oeffneDatenschutz = () => { setVorherigePhase(phase); setPhase("datenschutz"); };

  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [phase]);
  useEffect(() => { trackEvent("phase_view", { phase }); }, [phase]);

  return (
    <div ref={top} className="min-h-screen w-full antialiased" style={{
      background: INK, color: "#fff", colorScheme: "only light",
      fontFamily: 'ui-sans-serif, -apple-system, "SF Pro Display", "Inter", "Segoe UI", system-ui, sans-serif',
    }}>
      <GlobalStyles />
      {phase !== "crm" && <ConsentBanner />}
      {/* Ambient Glow */}
      <div className="fixed inset-0 pointer-events-none" style={{
        background: `radial-gradient(1000px 600px at 50% -10%, rgba(201,162,39,0.10), transparent 70%)`,
      }} />
      {/* einmaliges Aufglühen, wenn der Sparraten-Vergleich erscheint – das ist jetzt der echte Reveal-Moment */}
      {phase === "sparvergleich" && (
        <div key="glanz" className="fixed inset-0 pointer-events-none" style={{
          background: `radial-gradient(900px 520px at 50% 0%, rgba(201,162,39,0.30), transparent 68%)`,
          animation: "vkGlanz 2.6s cubic-bezier(.16,1,.3,1) forwards",
        }} />
      )}
      <div className="relative">
        {phase === "start" && <Landing onStart={() => setPhase("quiz")} onImpressum={oeffneImpressum} onDatenschutz={oeffneDatenschutz} onCrm={() => setPhase("crm")} onRechner={() => setPhase("rechner")} />}
        {phase === "quiz" && (
          <Quiz antworten={antworten} setAntworten={setAntworten}
            onFertig={() => setPhase("analyse")} onZurueck={() => setPhase("start")} />
        )}
        {phase === "analyse" && <Analyse onFertig={() => setPhase("sparvergleich")} />}
        {phase === "sparvergleich" && (
          <SparHebelVergleich antworten={antworten} onWeiter={() => setPhase("kontakt")} />
        )}
        {phase === "kontakt" && (
          <TelefonGate antworten={antworten} onWeiter={(tel, vorname, nachname) => {
            const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const neueAntworten = { ...antworten, vorname, nachname };
            setLeadId(id);
            setTelefon(tel);
            setAntworten(neueAntworten);
            speichereLead({
              id, erstelltAm: new Date().toISOString(), telefon: tel,
              email: "", termin: "", vollstaendig: false,
              crmStatus: "neu", notizen: "",
              ...neueAntworten,
            });
            setPhase("ergebnis");
          }} />
        )}
        {phase === "ergebnis" && (
          <Ergebnis antworten={antworten} telefonVorausgefuellt={telefon} onImpressum={oeffneImpressum} onDatenschutz={oeffneDatenschutz} leadId={leadId}
            onNeu={() => { setAntworten(START); setTelefon(""); setPhase("start"); }} />
        )}
        {phase === "impressum" && <Impressum onZurueck={() => setPhase(vorherigePhase)} />}
        {phase === "datenschutz" && <Datenschutz onZurueck={() => setPhase(vorherigePhase)} />}
        {phase === "crm" && (
          crmSession ? (
            <CRM accessToken={crmSession} onZurueck={() => {
              if (typeof window !== "undefined") window.location.hash = "";
              setCrmSession(null);
              setPhase("start");
            }} />
          ) : (
            <CRMLogin onErfolg={setCrmSession} />
          )
        )}
        {phase === "selbstauskunft" && <Selbstauskunft leadId={selbstauskunftLeadId} />}
        {phase === "rechner" && (
          <RechnerSeite onZurueck={() => {
            if (typeof window !== "undefined") window.location.hash = "";
            setPhase("start");
          }} onStart={() => setPhase("quiz")} />
        )}
      </div>
    </div>
  );
}
