import React, { useState, useEffect, useRef } from "react";
import { ArrowRight, Star, Phone, Mail, Instagram, MessageCircle, TrendingUp, ShieldCheck, Home, Calculator } from "lucide-react";

/* ============================================================================
   Traffic-Zählung – dieselbe schlanke "events"-Tabelle wie im Vermögenskompass
   (Vermoegenskompass.jsx), nur mit einem eigenen Ereignisnamen
   ("startseite_aufruf" statt "seitenaufruf"), damit sich Besuche auf der
   Personenmarken-Hauptseite im Dashboard klar von der eigentlichen
   Vermögensanalyse unterscheiden lassen. Bewusst dieselben Supabase-Werte
   wie in Vermoegenskompass.jsx, weil beide Dateien unabhängig gebündelt
   werden und keine Werte teilen.
   ========================================================================== */
const SUPABASE_URL = "https://pxqtjmymrtytqwsvzhlr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4cXRqbXltcnR5dHF3c3Z6aGxyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NDIxMTcsImV4cCI6MjEwMTUxODExN30.jlG1uV5Cr3cgNhWVpYyZM_pR9YgN1C5MLr4YdXxHxVs";

async function zaehleStartseitenAufruf() {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/events`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify([{ event_name: "startseite_aufruf" }]),
    });
  } catch (e) { /* Statistik ist nice-to-have, kein kritischer Pfad */ }
}

/* ============================================================================
   Gleiche Design-Tokens wie im Vermögenskompass (bewusst dieselben Werte),
   damit steinreich.immo und steinreich.immo/analyse wie ein Guss wirken.
   ========================================================================== */
const GOLD = "#C9A227";
const GOLD_SOFT = "#E3C46A";
const GREEN = "#34D399";
const INK = "#0A0A0B";
const CARD = "rgba(255,255,255,0.045)";
const HAIRLINE = "rgba(255,255,255,0.09)";

/* ============================================================================
   Cookie-Consent – bewusst derselbe Cookie-Name (vk_consent) wie auf
   steinreich.immo/analyse, damit eine einmal getroffene Entscheidung auf
   beiden Seiten gilt und niemand zweimal gefragt wird.
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

/* ============================================================================
   Meta Pixel – bindet fbevents.js erst nach Einwilligung ein (Stub-Pattern,
   keine Daten vor Consent). Gleiche Pixel-ID wie in Vermoegenskompass.jsx
   eintragen, damit beide Seiten in dieselbe Meta-Kampagne einzahlen.
   ========================================================================== */
const META_PIXEL_ID = "1865391607960712";

/** Bindet fbevents.js erst nach Einwilligung ein – exakt Metas eigenes
 * Stub-Muster (nur als benannte Funktion statt der offiziellen IIFE), damit
 * Aufrufe vor dem vollständigen Laden korrekt in der von fbevents.js
 * erwarteten "queue" zwischengespeichert und danach nachgeholt werden. */
function ladeMetaPixel(pixelId) {
  if (typeof window === "undefined" || !pixelId || window.fbq) return;
  const fbq = function () {
    fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
  };
  window.fbq = fbq;
  if (!window._fbq) window._fbq = fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);
  window.fbq("init", pixelId);
  window.fbq("track", "PageView");
}

function ConsentBanner() {
  const [status, setStatus] = useState(() => leseConsent());
  useEffect(() => { if (status === "granted") ladeMetaPixel(META_PIXEL_ID); }, [status]);
  if (status) return null;
  const entscheiden = (wert) => { setzeConsent(wert); setStatus(wert); };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}>
      <div className="max-w-xl mx-auto rounded-2xl p-4 backdrop-blur-xl" style={{ background: "#141416", border: `1px solid ${HAIRLINE}`, boxShadow: "0 12px 40px rgba(0,0,0,0.6)" }}>
        <div className="flex items-start gap-2.5">
          <div className="rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ width: 26, height: 26, background: "rgba(201,162,39,0.14)" }}>
            <ShieldCheck size={13} color={GOLD_SOFT} />
          </div>
          <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>
            Kurz gefragt: Wir nutzen Cookies, um zu sehen, was für dich funktioniert, und die Seite besser zu machen.
          </p>
        </div>
        <div className="flex gap-2 mt-3.5">
          <button onClick={() => entscheiden("denied")} className="flex-1 rounded-xl py-2.5 text-sm font-medium transition-colors"
            style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.65)", border: `1px solid ${HAIRLINE}` }}>
            Nein danke
          </button>
          <button onClick={() => entscheiden("granted")} className="flex-1 rounded-xl py-2.5 text-sm font-medium transition-colors"
            style={{ background: GOLD, color: "#15130B" }}>
            Klar, passt
          </button>
        </div>
      </div>
    </div>
  );
}

const KONTAKT = {
  whatsappNummer: "4915787606321",
  whatsappText: "Hallo Philipp, ich interessiere mich für eine Kapitalanlage-Immobilie.",
  email: "info@wohnblick-immobilien.de",
  telefon: "0151 28960764",
  instagram: "https://www.instagram.com/philippstreib/",
};

const IMPRESSUM = {
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
};

// Dieselben echten Bewertungen wie im Vermögenskompass – nicht neu erfinden.
const BEWERTUNGEN = [
  { name: "Mark R.", sterne: 5, kurz: "Während des gesamten Kaufprozesses war Philipp gut erreichbar und hat die einzelnen Schritte verständlich begleitet. Dadurch konnte ich meine Entscheidung mit einem wirklich guten Gefühl treffen. Rückblickend bin ich mit der Zusammenarbeit und meiner ersten Kapitalanlage sehr zufrieden." },
  { name: "Thomas B.", sterne: 5, kurz: "Besonders wichtig war mir, langfristig Vermögen aufzubauen und gleichzeitig meine Altersvorsorge breiter aufzustellen. Philipp hat mir die Unterschiede zu anderen Anlageformen nachvollziehbar erklärt, ohne Aktien oder ETFs grundsätzlich schlechtzureden. Die Immobilie wurde mit allen Kosten, Chancen und Risiken transparent durchgerechnet. Für meine Ziele war der Kauf deshalb der richtige Schritt, und ich bin froh, ihn gemeinsam mit Philipp umgesetzt zu haben." },
  { name: "Sarah S.", sterne: 5, kurz: "Alle Zahlen, laufenden Kosten und auch die Risiken wurden offen und verständlich erklärt. Deshalb war es für mich sinnvoller, mit professioneller Begleitung eine fundierte Entscheidung zu treffen, statt jahrelang auf das vermeintlich perfekte Angebot zu warten. Heute bin ich froh, den Schritt gemacht zu haben, und würde bei der nächsten Kapitalanlage wieder mit Philipp zusammenarbeiten." },
];

function initialen(name) {
  return name.split(" ").map((t) => t[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

/* ============================================================ Animations-Helfer */
/** Blendet Kinder ein, sobald sie beim Scrollen ins Bild kommen – der
 * durchgängige, ruhige Bewegungsfaden der Seite. Läuft nur einmal pro
 * Element (kein wiederholtes Aufflackern beim Hoch-/Runterscrollen). */
function useReveal() {
  const ref = useRef(null);
  const [sichtbar, setSichtbar] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setSichtbar(true); obs.disconnect(); }
    }, { threshold: 0.15 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, sichtbar];
}

function Reveal({ children, delay = 0, className = "" }) {
  const [ref, sichtbar] = useReveal();
  return (
    <div ref={ref} className={className} style={{
      opacity: sichtbar ? 1 : 0,
      transform: sichtbar ? "translateY(0)" : "translateY(28px)",
      transition: `opacity .9s cubic-bezier(.16,1,.3,1) ${delay}ms, transform .9s cubic-bezier(.16,1,.3,1) ${delay}ms`,
    }}>
      {children}
    </div>
  );
}

/** Zählt von 0 auf den Zielwert hoch, sobald "aktiv" wird – für die
 * Zahlen-Sektion, das signature-Element der Seite. */
function useZaehler(zielwert, aktiv, dauer = 1500) {
  const [wert, setWert] = useState(0);
  useEffect(() => {
    if (!aktiv) return;
    let start = null; let raf;
    const schritt = (ts) => {
      if (!start) start = ts;
      const p = Math.min(1, (ts - start) / dauer);
      const eased = 1 - Math.pow(1 - p, 3);
      setWert(zielwert * eased);
      if (p < 1) raf = requestAnimationFrame(schritt);
    };
    raf = requestAnimationFrame(schritt);
    return () => cancelAnimationFrame(raf);
  }, [aktiv, zielwert, dauer]);
  return wert;
}

function Sterne({ anzahl = 5, size = 13 }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} size={size} fill={i < anzahl ? GOLD : "none"} color={i < anzahl ? GOLD : "rgba(255,255,255,0.2)"} />
      ))}
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

function GoldButton({ children, href, full }) {
  return (
    <a href={href}
      className={"inline-flex items-center justify-center gap-2 rounded-full px-7 py-4 text-base font-semibold transition-transform hover:scale-[1.02] active:scale-[0.98] " + (full ? "w-full" : "")}
      style={{ background: `linear-gradient(135deg, ${GOLD_SOFT}, ${GOLD})`, color: "#171205" }}>
      {children}
    </a>
  );
}

function Card({ children, className = "", style = {} }) {
  return (
    <div className={"rounded-2xl backdrop-blur-xl transition-transform duration-300 hover:-translate-y-1 " + className}
      style={{ background: CARD, border: `1px solid ${HAIRLINE}`, ...style }}>
      {children}
    </div>
  );
}

/* ================================================================ Rechtstexte */
function RechtstextAbschnitt({ titel, children }) {
  return (
    <div className="mt-8 first:mt-0">
      <h2 className="text-base font-semibold mb-2.5" style={{ color: "#fff" }}>{titel}</h2>
      <div className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>{children}</div>
    </div>
  );
}

function Impressum({ onZurueck }) {
  const I = IMPRESSUM;
  return (
    <div className="min-h-screen px-5 pt-10 pb-20 max-w-2xl mx-auto">
      <button onClick={onZurueck} className="text-sm mb-8 -ml-1 p-1" style={{ color: "rgba(255,255,255,0.5)" }}>← Zurück</button>
      <h1 className="text-2xl font-semibold tracking-tight">Impressum</h1>
      <RechtstextAbschnitt titel="Angaben gemäß § 5 DDG">
        {I.firma}<br />{I.strasse}<br />{I.ort}
      </RechtstextAbschnitt>
      <RechtstextAbschnitt titel="Kontakt">
        Telefon: {I.telefon}<br />E-Mail: {I.email}
      </RechtstextAbschnitt>
      <RechtstextAbschnitt titel="Umsatzsteuer-ID">{I.ustId}</RechtstextAbschnitt>
      <RechtstextAbschnitt titel="Erlaubnis nach § 34c GewO">
        Erteilt am {I.gewerbeDatum} durch {I.gewerbeStelle}.
      </RechtstextAbschnitt>
      <RechtstextAbschnitt titel="EU-Streitschlichtung">
        Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:
        https://ec.europa.eu/consumers/odr/. Zur Teilnahme an einem Streitbeilegungsverfahren vor
        einer Verbraucherschlichtungsstelle sind wir nicht verpflichtet und nicht bereit.
      </RechtstextAbschnitt>
      <RechtstextAbschnitt titel="Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV">
        {I.name}, {I.strasse}, {I.ort}
      </RechtstextAbschnitt>
      <RechtstextAbschnitt titel="DSA-Kontaktstelle">
        E-Mail: {I.dsaEmail}<br />Telefon: {I.dsaTelefon}<br />Verfügbare Sprachen: {I.dsaSprachen}
      </RechtstextAbschnitt>
    </div>
  );
}

function Datenschutz({ onZurueck }) {
  const I = IMPRESSUM;
  const Untertitel = ({ children }) => (
    <div className="text-sm font-semibold mt-4 mb-1.5" style={{ color: "#fff" }}>{children}</div>
  );

  return (
    <div className="min-h-screen px-5 pt-10 pb-20 max-w-2xl mx-auto">
      <button onClick={onZurueck} className="text-sm mb-8 -ml-1 p-1" style={{ color: "rgba(255,255,255,0.5)" }}>← Zurück</button>
      <h1 className="text-2xl font-semibold tracking-tight">Datenschutzerklärung</h1>

      <RechtstextAbschnitt titel="1. Datenschutz auf einen Blick">
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
        Ihre Daten werden zum einen dadurch erhoben, dass Sie uns diese mitteilen, z. B. über einen der
        Kontakt-Buttons auf dieser Seite.<br />
        Andere Daten werden automatisch beim Besuch der Website durch unsere IT-Systeme erfasst. Das sind
        vor allem technische Daten (z. B. Internetbrowser, Betriebssystem oder Uhrzeit des Seitenaufrufs).
        Die Erfassung dieser Daten erfolgt automatisch, sobald Sie diese Website betreten.
        <br /><br />
        <strong style={{ color: "#fff" }}>Wofür nutzen wir Ihre Daten?</strong><br />
        Ein Teil der Daten wird erhoben, um eine fehlerfreie Bereitstellung der Website zu gewährleisten.
        Sofern Sie über einen der Kontakt-Buttons ein Beratungsgespräch anfragen, werden die übermittelten
        Daten zur Bearbeitung dieser Anfrage verarbeitet.
        <br /><br />
        <strong style={{ color: "#fff" }}>Welche Rechte haben Sie bezüglich Ihrer Daten?</strong><br />
        Sie haben jederzeit das Recht, unentgeltlich Auskunft über Herkunft, Empfänger und Zweck Ihrer
        gespeicherten personenbezogenen Daten zu erhalten. Sie haben außerdem ein Recht, die Berichtigung
        oder Löschung dieser Daten zu verlangen. Außerdem haben Sie das Recht, unter bestimmten Umständen
        die Einschränkung der Verarbeitung Ihrer personenbezogenen Daten zu verlangen. Des Weiteren steht
        Ihnen ein Beschwerderecht bei der zuständigen Aufsichtsbehörde zu. Hierzu sowie zu weiteren Fragen
        zum Thema Datenschutz können Sie sich jederzeit an uns wenden.
      </RechtstextAbschnitt>

      <RechtstextAbschnitt titel="2. Hosting">
        <Untertitel>Externes Hosting</Untertitel>
        Diese Website wird extern gehostet. Die personenbezogenen Daten, die auf dieser Website erfasst
        werden, werden auf den Servern des Hosters gespeichert. Hierbei kann es sich v. a. um IP-Adressen,
        Kontaktanfragen, Meta- und Kommunikationsdaten, Namen, Websitezugriffe und sonstige Daten, die über
        eine Website generiert werden, handeln.
        <br /><br />
        Das externe Hosting erfolgt zum Zwecke der Vertragserfüllung gegenüber unseren potenziellen und
        bestehenden Kunden (Art. 6 Abs. 1 lit. b DSGVO) und im Interesse einer sicheren, schnellen und
        effizienten Bereitstellung unseres Online-Angebots durch einen professionellen Anbieter (Art. 6
        Abs. 1 lit. f DSGVO).
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
        durchgehend gleichwertiges Datenschutzniveau wie in der EU. Um dennoch ein hohes Datenschutzniveau
        zu wahren, stützt sich Vercel auf Standardvertragsklauseln nach Art. 46 Abs. 2 und 3 DSGVO. Weitere
        Informationen: vercel.com/legal/privacy-policy
      </RechtstextAbschnitt>

      <RechtstextAbschnitt titel="3. Allgemeine Hinweise und Pflichtinformationen">
        <Untertitel>Hinweis zur verantwortlichen Stelle</Untertitel>
        Die verantwortliche Stelle für die Datenverarbeitung auf dieser Website ist:<br /><br />
        {I.firma}<br />
        {I.strasse}<br />
        {I.ort}<br />
        Telefon: {I.telefon}<br />
        E-Mail: {I.email}

        <Untertitel>Speicherdauer</Untertitel>
        Soweit innerhalb dieser Datenschutzerklärung keine speziellere Speicherdauer genannt wurde,
        verbleiben Ihre personenbezogenen Daten bei uns, bis der Zweck für die Datenverarbeitung entfällt
        oder Sie ein berechtigtes Löschersuchen geltend machen, sofern keine gesetzlichen
        Aufbewahrungsfristen entgegenstehen.

        <Untertitel>SSL- bzw. TLS-Verschlüsselung</Untertitel>
        Diese Seite nutzt aus Sicherheitsgründen und zum Schutz der Übertragung vertraulicher Inhalte eine
        SSL- bzw. TLS-Verschlüsselung. Eine verschlüsselte Verbindung erkennen Sie daran, dass die
        Adresszeile des Browsers von „http://" auf „https://" wechselt und an dem Schloss-Symbol in Ihrer
        Browserzeile.
      </RechtstextAbschnitt>

      <RechtstextAbschnitt titel="4. Datenerfassung auf dieser Website">
        <Untertitel>Cookies</Untertitel>
        Diese Seite zeigt Ihnen ein Cookie-Consent-Banner und speichert Ihre Entscheidung dazu in einem
        einfachen Präferenz-Cookie (Art. 6 Abs. 1 lit. f DSGVO). Analyse- oder Marketing-Cookies werden auf
        dieser Seite selbst aktuell nicht eingesetzt und daher durch Ihre Entscheidung auch nicht aktiviert.

        <Untertitel>Server-Log-Dateien</Untertitel>
        Der Provider der Seiten erhebt und speichert automatisch Informationen in so genannten
        Server-Log-Dateien, die Ihr Browser automatisch an uns übermittelt. Dies sind: Browsertyp und
        -version, verwendetes Betriebssystem, Referrer URL, Hostname des zugreifenden Rechners, Uhrzeit
        der Serveranfrage, IP-Adresse. Eine Zusammenführung dieser Daten mit anderen Datenquellen wird
        nicht vorgenommen. Die Erfassung erfolgt auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO.

        <Untertitel>Kontaktaufnahme (WhatsApp, E-Mail, Telefon)</Untertitel>
        Nehmen Sie über einen der Kontakt-Buttons auf dieser Seite Verbindung zu uns auf, verarbeiten wir
        die dabei übermittelten Daten zur Bearbeitung Ihrer Anfrage (Art. 6 Abs. 1 lit. b bzw. f DSGVO).
        Eine Kontaktaufnahme über WhatsApp läuft technisch über Dienste der Meta Platforms Ireland
        Limited; es gelten zusätzlich deren Datenschutzhinweise (facebook.com/about/privacy/).
      </RechtstextAbschnitt>

      <RechtstextAbschnitt titel="5. Verlinkte Vermögensanalyse">
        Der Button "Kostenlose Vermögensanalyse starten" führt zu einem separaten Analyse-Tool unter
        steinreich.immo/analyse. Dort werden – anders als auf dieser Seite – im Rahmen des Funnels
        Kontaktdaten erhoben und, sofern Sie einwilligen, Analyse-Cookies (Meta Pixel, Google Analytics)
        eingesetzt. Die dafür geltenden, ausführlicheren Datenschutzhinweise finden Sie direkt in diesem
        Tool.
      </RechtstextAbschnitt>
    </div>
  );
}

/* ===================================================================== Foto */
/** Echtes Foto, sobald public/philipp.jpg existiert – bis dahin fallen wir
 * automatisch auf die Initialen zurück, kein kaputtes Bild-Icon. */
function PortraitFoto({ groesse = 128 }) {
  const [fehler, setFehler] = useState(false);
  if (fehler) {
    return (
      <div className="rounded-full flex items-center justify-center font-semibold shrink-0"
        style={{
          width: groesse, height: groesse, fontSize: groesse * 0.32,
          background: "rgba(201,162,39,0.15)", color: GOLD_SOFT,
          border: `2px solid rgba(201,162,39,0.4)`,
        }}>
        PS
      </div>
    );
  }
  return (
    <img src="/philipp.jpg" onError={() => setFehler(true)} alt="Philipp Streib"
      className="rounded-full object-cover shrink-0"
      style={{ width: groesse, height: groesse, border: `2px solid rgba(201,162,39,0.4)` }} />
  );
}

/* ===================================================================== Hero */
function Hero({ t }) {
  const scrollY = useScrollY();
  // Zwei Ebenen, die unterschiedlich schnell wegscrollen – Foto/Name etwas
  // schneller als die Überschrift, das erzeugt die räumliche Tiefe.
  const versatzSchnell = Math.min(scrollY * 0.35, 90);
  const versatzLangsam = Math.min(scrollY * 0.15, 60);
  const opacityAusblendend = Math.max(0, 1 - scrollY / 420);

  return (
    <div className="relative pt-14 md:pt-24" style={{ opacity: t, transition: "opacity 1s cubic-bezier(.16,1,.3,1)" }}>
      <div className="flex items-center gap-4 mb-7"
        style={{ transform: `translateY(${t ? -versatzSchnell : 16}px)`, opacity: t ? opacityAusblendend : 0, transition: "transform .1s linear, opacity .1s linear" }}>
        <PortraitFoto groesse={64} />
        <div>
          <div className="text-lg font-semibold leading-tight">Philipp Streib</div>
          <div className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>Kapitalanlage-Experte</div>
        </div>
      </div>
      <div style={{ transform: `translateY(${t ? -versatzLangsam : 0}px)`, transition: "transform .1s linear" }}>
        <Eyebrow>Kapitalanlage-Experte</Eyebrow>
        <h1 className="text-4xl md:text-6xl font-semibold leading-[1.08] tracking-tight max-w-xl">
          Vermögen aufbauen mit{" "}
          <span style={{ background: `linear-gradient(120deg, ${GOLD_SOFT}, ${GOLD})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
            vermieteten Immobilien
          </span>
        </h1>
        <p className="mt-5 text-base md:text-lg leading-relaxed max-w-lg" style={{ color: "rgba(255,255,255,0.55)" }}>
          Ich begleite dich dabei, mit vermieteten Bestandsimmobilien als Kapitalanlage langfristig
          Vermögen aufzubauen – von der ersten Analyse bis zur schlüsselfertigen Übergabe.
        </p>
        <div className="mt-8">
          <GoldButton href="/analyse">
            Kostenlose Vermögensanalyse starten <ArrowRight size={18} />
          </GoldButton>
        </div>
      </div>
    </div>
  );
}

/* =================================================================== Zahlen */
/** Das signature-Element der Seite: große, hochzählende Kennzahlen beim
 * Scrollen ins Bild – bewusst nur echte, belegbare Zahlen. */
function ZahlenSektion() {
  const [ref, sichtbar] = useReveal();
  const jahre = useZaehler(6, sichtbar);
  const sterne = useZaehler(5.0, sichtbar);
  const kaufpreis = useZaehler(250, sichtbar);

  const Zahl = ({ children }) => (
    <div className="text-4xl md:text-6xl font-semibold tabular-nums tracking-tight"
      style={{ background: `linear-gradient(120deg, #fff 30%, ${GOLD_SOFT})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
      {children}
    </div>
  );

  return (
    <div ref={ref} className="mt-24 grid grid-cols-3 gap-4 md:gap-10 py-8" style={{ borderTop: `1px solid ${HAIRLINE}`, borderBottom: `1px solid ${HAIRLINE}` }}>
      <div>
        <Zahl>{jahre.toFixed(0)}+</Zahl>
        <div className="text-xs md:text-sm mt-2" style={{ color: "rgba(255,255,255,0.45)" }}>Jahre Erfahrung</div>
      </div>
      <div>
        <Zahl>{sterne.toFixed(1).replace(".", ",")}</Zahl>
        <div className="text-xs md:text-sm mt-2" style={{ color: "rgba(255,255,255,0.45)" }}>★ aus 3 Bewertungen</div>
      </div>
      <div>
        <Zahl>{kaufpreis.toFixed(0)}T€</Zahl>
        <div className="text-xs md:text-sm mt-2" style={{ color: "rgba(255,255,255,0.45)" }}>Ø Objektwert</div>
      </div>
    </div>
  );
}

/* ============================================================== Wachstumskurve */
/** Beispielrechnung, wie sich der Wert eines Objekts über die Zeit
 * entwickeln könnte – zeichnet sich beim Scrollen ins Bild selbst. Bewusst
 * mit denselben Standard-Annahmen wie im Vermögenskompass (250.000 €
 * Kaufpreis, 2 % Wertsteigerung p. a.), klar als Beispiel beschriftet, keine
 * reale Fallstudie einer bestimmten Person. */
function WachstumsSektion() {
  const [ref, sichtbar] = useReveal();
  const endwert = useZaehler(371487, sichtbar, 1800);

  return (
    <div ref={ref} className="mt-24">
      <Reveal><Eyebrow>Beispielrechnung</Eyebrow></Reveal>
      <Reveal delay={60}>
        <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-2">So könnte sich eine Kapitalanlage entwickeln</h2>
      </Reveal>
      <Reveal delay={120}>
        <p className="text-sm mb-8 max-w-lg" style={{ color: "rgba(255,255,255,0.45)" }}>
          Objekt für 250.000 €, 2 % angenommene Wertsteigerung pro Jahr – eine überschlägige
          Beispielrechnung, keine Prognose oder reale Fallstudie.
        </p>
      </Reveal>

      <Card className="p-6 md:p-8">
        <svg viewBox="0 0 500 190" className="w-full h-auto" style={{ overflow: "visible" }}>
          <defs>
            <linearGradient id="wachstumFuellung" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GOLD} stopOpacity="0.35" />
              <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M 20,170 L 135,138 L 250,102 L 365,63 L 480,20 L 480,170 L 20,170 Z"
            fill="url(#wachstumFuellung)"
            style={{ opacity: sichtbar ? 1 : 0, transition: "opacity 1.2s ease .5s" }} />
          <path d="M 20,170 L 135,138 L 250,102 L 365,63 L 480,20" fill="none"
            stroke={GOLD_SOFT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            pathLength="1" style={{
              strokeDasharray: 1, strokeDashoffset: sichtbar ? 0 : 1,
              transition: "stroke-dashoffset 1.6s cubic-bezier(.16,1,.3,1)",
            }} />
          {[[20, 170], [135, 138], [250, 102], [365, 63], [480, 20]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="4" fill={GOLD_SOFT}
              style={{ opacity: sichtbar ? 1 : 0, transition: `opacity .4s ease ${0.4 + i * 0.28}s` }} />
          ))}
        </svg>
        <div className="flex items-end justify-between mt-4 pt-4" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
          <div>
            <div className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>Heute</div>
            <div className="text-lg font-medium tabular-nums">250.000 €</div>
          </div>
          <div className="text-right">
            <div className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>Nach 20 Jahren</div>
            <div className="text-2xl md:text-3xl font-semibold tabular-nums"
              style={{ background: `linear-gradient(120deg, #fff 30%, ${GOLD_SOFT})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
              {Math.round(endwert).toLocaleString("de-DE")} €
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* =================================================================== Leistungen */
function Leistungen() {
  const items = [
    { icon: Home, titel: "Objektauswahl", text: "Auswahl passender, vermieteter Bestandsimmobilien nach deiner finanziellen Situation und deinen Zielen – keine Massenware." },
    { icon: Calculator, titel: "Finanzierung", text: "Begleitung bei der Finanzierung, mit klarer Einordnung von Zins, Tilgung und dem Eigenkapital, das wirklich nötig ist." },
    { icon: ShieldCheck, titel: "Steuerliche Einordnung", text: "Verständliche Einordnung von AfA und steuerlichen Effekten anhand konkreter Zahlen – als Ergänzung zu deinem Steuerberater, nicht als Ersatz." },
    { icon: TrendingUp, titel: "Verwaltung inklusive", text: "Haus- und Mietverwaltung sind bei vermittelten Objekten inklusive – ohne Zusatzaufwand für dich nach dem Kauf." },
  ];
  return (
    <div className="mt-24">
      <Reveal><Eyebrow>Leistungen</Eyebrow></Reveal>
      <Reveal delay={60}><h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-8">Wie ich dich begleite</h2></Reveal>
      <div className="grid sm:grid-cols-2 gap-3">
        {items.map((it, i) => (
          <Reveal key={it.titel} delay={120 + i * 90}>
            <Card className="p-5 h-full">
              <it.icon size={20} color={GOLD_SOFT} />
              <div className="text-base font-medium mt-3">{it.titel}</div>
              <div className="text-sm leading-relaxed mt-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>{it.text}</div>
            </Card>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

/* =================================================================== Über mich */
function UeberMich() {
  return (
    <div className="mt-24">
      <Reveal><Eyebrow>Über mich</Eyebrow></Reveal>
      <Reveal delay={60}>
        <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-5">Seit über 6 Jahren im Immobilienmarkt</h2>
      </Reveal>
      <Reveal delay={140}>
        <p className="text-base leading-relaxed max-w-2xl" style={{ color: "rgba(255,255,255,0.6)" }}>
          Mein Fokus liegt bewusst auf Kapitalanlagen: Objekte, die sich über die Mieteinnahmen
          weitgehend selbst tragen, und bei denen Finanzierung, steuerliche Effekte und Werterhalt
          von Anfang an mitgedacht werden – statt erst im Nachhinein Böses zu erleben.
        </p>
        <p className="text-base leading-relaxed max-w-2xl mt-4" style={{ color: "rgba(255,255,255,0.6)" }}>
          Bevor wir über ein konkretes Objekt sprechen, steht für mich immer erst deine Situation:
          dein Einkommen, dein verfügbares Eigenkapital und dein eigentliches Ziel. Erst danach macht
          eine Empfehlung überhaupt Sinn.
        </p>
      </Reveal>
    </div>
  );
}

/* =================================================================== Bewertungen */
function Bewertungen() {
  const schnitt = BEWERTUNGEN.reduce((s, b) => s + b.sterne, 0) / BEWERTUNGEN.length;
  return (
    <div className="mt-24">
      <Reveal>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
          <div>
            <Eyebrow>Stimmen</Eyebrow>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight -mt-1">Was Kunden sagen</h2>
          </div>
          <div className="flex items-center gap-2 text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
            <Sterne anzahl={Math.round(schnitt)} />
            <span className="tabular-nums">{schnitt.toFixed(1).replace(".", ",")} · {BEWERTUNGEN.length} Bewertungen</span>
          </div>
        </div>
      </Reveal>
      <div className="grid sm:grid-cols-3 gap-3">
        {BEWERTUNGEN.map((b, i) => (
          <Reveal key={b.name} delay={i * 90}>
            <Card className="p-5 h-full">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                  style={{ background: "rgba(201,162,39,0.15)", color: GOLD_SOFT, border: "1px solid rgba(201,162,39,0.3)" }}>
                  {initialen(b.name)}
                </div>
                <div>
                  <div className="text-sm font-medium leading-tight">{b.name}</div>
                  <div className="text-xs leading-tight" style={{ color: "rgba(255,255,255,0.4)" }}>Anleger</div>
                </div>
              </div>
              <p className="text-sm leading-relaxed mt-3.5" style={{ color: "rgba(255,255,255,0.7)" }}>„{b.kurz}"</p>
            </Card>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

/* =================================================================== CTA + Kontakt */
function CtaSektion() {
  return (
    <Reveal className="mt-24">
      <div className="rounded-3xl p-8 md:p-12 text-center" style={{
        background: "linear-gradient(165deg, rgba(201,162,39,0.13), rgba(255,255,255,0.025) 55%)",
        border: "1px solid rgba(201,162,39,0.26)",
      }}>
        <h2 className="text-2xl md:text-4xl font-semibold tracking-tight">Wie viel Vermögen könntest du aufbauen?</h2>
        <p className="text-base mt-3 max-w-md mx-auto" style={{ color: "rgba(255,255,255,0.55)" }}>
          Beantworte ein paar Fragen und erhalte kostenlos eine interaktive Beispielanalyse – dauert
          etwa 2 Minuten.
        </p>
        <div className="mt-7 flex justify-center">
          <GoldButton href="/analyse">
            Kostenlose Vermögensanalyse starten <ArrowRight size={18} />
          </GoldButton>
        </div>
      </div>
    </Reveal>
  );
}

function Kontakt() {
  const waLink = `https://wa.me/${KONTAKT.whatsappNummer}?text=${encodeURIComponent(KONTAKT.whatsappText)}`;
  const links = [
    { href: waLink, icon: MessageCircle, farbe: GREEN, label: "WhatsApp", extern: true },
    { href: `mailto:${KONTAKT.email}`, icon: Mail, farbe: GOLD_SOFT, label: "E-Mail" },
    { href: `tel:${KONTAKT.telefon.replace(/\s/g, "")}`, icon: Phone, farbe: GOLD_SOFT, label: "Anrufen" },
    { href: KONTAKT.instagram, icon: Instagram, farbe: GOLD_SOFT, label: "Instagram", extern: true },
  ];
  return (
    <div className="mt-24">
      <Reveal><Eyebrow>Kontakt</Eyebrow></Reveal>
      <Reveal delay={60}><h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-6">Sprechen wir</h2></Reveal>
      <Reveal delay={120}>
        <div className="flex flex-wrap gap-3">
          {links.map((l) => (
            <a key={l.label} href={l.href} target={l.extern ? "_blank" : undefined} rel={l.extern ? "noopener noreferrer" : undefined}
              className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition-transform hover:scale-[1.03]"
              style={{ background: CARD, border: `1px solid ${HAIRLINE}`, color: "#fff" }}>
              <l.icon size={16} color={l.farbe} /> {l.label}
            </a>
          ))}
        </div>
      </Reveal>
    </div>
  );
}

/** Aktuelle Scroll-Position, gedrosselt über requestAnimationFrame – Basis
 * für den Parallax-Effekt im Hero. */
function useScrollY() {
  const [y, setY] = useState(0);
  useEffect(() => {
    let raf = null;
    const aktualisieren = () => {
      raf = null;
      setY(window.scrollY);
    };
    const onScroll = () => { if (raf === null) raf = requestAnimationFrame(aktualisieren); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return y;
}

/**
 * Weicher Übergang zur Statusleiste des iPhones. Ganz oben exakt INK, also
 * dieselbe Farbe wie das theme-color in der index.html, nach unten transparent.
 * Ohne diesen Verlauf setzt der Hintergrundschimmer direkt an der Statusleiste
 * an und man sieht oben eine harte schwarze Kante.
 */
function StatusbarVerlauf() {
  return (
    <div aria-hidden className="fixed inset-x-0 top-0 z-0 pointer-events-none" style={{
      height: "calc(120px + env(safe-area-inset-top))",
      background: `linear-gradient(to bottom, ${INK} 0%, rgba(10,10,11,0.86) 38%, rgba(10,10,11,0) 100%)`,
    }} />
  );
}

/** Seitenweiter, fest positionierter Hintergrund mit mehreren langsam
 * driftenden Farbflächen (Gold + Smaragdgrün als zweiter Akzent) – bleibt
 * beim Scrollen stehen, sodass die ganze Seite Atmosphäre hat statt nur
 * der Bereich hinter dem Hero. Dezentes Punktraster obendrauf für Textur. */
function AmbientBackground() {
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      <div style={{
        position: "absolute", top: "-10%", left: "-10%", width: 560, height: 560,
        background: `radial-gradient(circle, rgba(201,162,39,0.20), transparent 65%)`,
        filter: "blur(20px)", animation: "vk-drift-a 18s ease-in-out infinite",
      }} />
      <div style={{
        position: "absolute", top: "20%", right: "-15%", width: 620, height: 620,
        background: `radial-gradient(circle, rgba(52,211,153,0.14), transparent 65%)`,
        filter: "blur(20px)", animation: "vk-drift-b 22s ease-in-out infinite",
      }} />
      <div style={{
        position: "absolute", bottom: "-15%", left: "20%", width: 520, height: 520,
        background: `radial-gradient(circle, rgba(201,162,39,0.13), transparent 65%)`,
        filter: "blur(20px)", animation: "vk-drift-a 20s ease-in-out infinite reverse",
      }} />
      <div style={{
        position: "absolute", inset: 0, opacity: 0.35,
        backgroundImage: "radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)",
        backgroundSize: "28px 28px",
      }} />
    </div>
  );
}

/* ======================================================================= App */
export default function PersonalLanding() {
  const [phase, setPhase] = useState("start");
  const [t, setT] = useState(0);
  useEffect(() => { const id = setTimeout(() => setT(1), 80); return () => clearTimeout(id); }, []);
  useEffect(() => { zaehleStartseitenAufruf(); }, []);

  if (phase === "impressum") return <div className="min-h-screen w-full antialiased" style={{ background: INK, color: "#fff" }}><Impressum onZurueck={() => setPhase("start")} /><ConsentBanner /></div>;
  if (phase === "datenschutz") return <div className="min-h-screen w-full antialiased" style={{ background: INK, color: "#fff" }}><Datenschutz onZurueck={() => setPhase("start")} /><ConsentBanner /></div>;

  return (
    <div className="min-h-screen w-full antialiased relative" style={{ background: INK, color: "#fff" }}>
      <style>{`
        @keyframes vk-drift-a {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(40px, 30px) scale(1.1); }
        }
        @keyframes vk-drift-b {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-35px, 25px) scale(1.06); }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }
      `}</style>
      <AmbientBackground />
      <StatusbarVerlauf />
      <ConsentBanner />
      <div className="relative z-10 min-h-screen px-5 pt-6 pb-20 max-w-2xl mx-auto">
        <Hero t={t} />
        <ZahlenSektion />
        <WachstumsSektion />
        <UeberMich />
        <Leistungen />
        <Bewertungen />
        <CtaSektion />
        <Kontakt />

        <div className="mt-16 flex items-center gap-4">
          <button onClick={() => setPhase("impressum")} className="text-xs underline" style={{ color: "rgba(255,255,255,0.3)" }}>Impressum</button>
          <button onClick={() => setPhase("datenschutz")} className="text-xs underline" style={{ color: "rgba(255,255,255,0.3)" }}>Datenschutz</button>
          <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>© Steinreich</span>
        </div>
      </div>
    </div>
  );
}
