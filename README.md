# philippstreib.com – Deployment auf Vercel

Dieses Projekt enthält jetzt zwei Seiten:

- **`/`** → `src/PersonalLanding.jsx` – die Personal-Brand-Landingpage
- **`/analyse`** → `src/Vermoegenskompass.jsx` – der Vermögenskompass-Funnel inkl. CRM

Welche Seite angezeigt wird, entscheidet `src/main.jsx` anhand der URL – kein
zusätzliches Routing-Paket nötig.

## Einmalig einrichten (GitHub + Vercel verbinden)

1. **GitHub-Konto** (falls noch nicht vorhanden): auf github.com kostenlos registrieren.
2. **Neues Repository anlegen**: auf github.com oben rechts auf "+" → "New repository" →
   z. B. `philippstreib-com` nennen → "Create repository".
3. **Dateien hochladen**: auf der neuen Repository-Seite auf "uploading an existing file"
   klicken, dann den kompletten Inhalt dieses Ordners (alle Dateien und den `src`-Ordner)
   per Drag & Drop reinziehen → unten "Commit changes" klicken. Kein Terminal nötig.
4. **Vercel-Konto** (falls noch nicht vorhanden): auf vercel.com mit dem GitHub-Konto anmelden.
5. **Projekt importieren**: im Vercel-Dashboard "Add New" → "Project" → das gerade
   erstellte GitHub-Repository auswählen → "Import".
6. Vercel erkennt automatisch "Vite" als Framework – die vorgeschlagenen Einstellungen
   einfach so lassen und auf "Deploy" klicken.
7. Nach ein bis zwei Minuten ist die Seite live, unter einer Adresse wie
   `philippstreib-com.vercel.app`.

## Eigene Domain: philippstreib.com

1. Im Vercel-Projekt: Settings → Domains → `philippstreib.com` eingeben → "Add".
2. Vercel zeigt dir die nötigen DNS-Einträge an (i. d. R. ein A-Record für die nackte
   Domain und/oder ein CNAME für `www`).
3. Diese Einträge bei deinem Domain-Anbieter (dort, wo `philippstreib.com` verwaltet
   wird) unter "DNS-Verwaltung" eintragen.
4. Nach der DNS-Umstellung ist die alte WordPress-Seite unter dieser Domain nicht mehr
   erreichbar – das WordPress-Hosting selbst bleibt davon unberührt, nur die Domain
   zeigt woanders hin.
5. DNS-Änderungen können je nach Anbieter zwischen wenigen Minuten und einigen Stunden
   dauern, bis sie überall wirken.

## Künftige Änderungen

- Neue Version der Landingpage → `src/PersonalLanding.jsx` in GitHub ersetzen.
- Neue Version des Funnels/CRM → `src/Vermoegenskompass.jsx` ersetzen.
Vercel baut und veröffentlicht danach automatisch neu.

## Interner Bereich (CRM)

Erreichbar über `/analyse`, dort kein sichtbarer Link. Zugang: 5× kurz hintereinander
auf den kleinen "© Wohnblick Immobilien"-Schriftzug ganz unten auf der Analyse-Startseite
tippen, danach mit E-Mail/Passwort anmelden (Nutzer dafür in Supabase unter
Authentication → Users anlegen).
