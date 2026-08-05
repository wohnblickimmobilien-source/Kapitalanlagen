# Vermögenskompass – Deployment auf Vercel

## Einmalig einrichten (GitHub + Vercel verbinden)

1. **GitHub-Konto** (falls noch nicht vorhanden): auf github.com kostenlos registrieren.
2. **Neues Repository anlegen**: auf github.com oben rechts auf "+" → "New repository" →
   z. B. `vermoegenskompass` nennen → "Create repository".
3. **Dateien hochladen**: auf der neuen Repository-Seite auf "uploading an existing file"
   klicken, dann den kompletten Inhalt dieses Ordners (alle Dateien und den `src`-Ordner)
   per Drag & Drop reinziehen → unten "Commit changes" klicken. Kein Terminal nötig.
4. **Vercel-Konto** (falls noch nicht vorhanden): auf vercel.com mit dem GitHub-Konto anmelden.
5. **Projekt importieren**: im Vercel-Dashboard "Add New" → "Project" → das gerade
   erstellte GitHub-Repository auswählen → "Import".
6. Vercel erkennt automatisch "Vite" als Framework – die vorgeschlagenen Einstellungen
   einfach so lassen und auf "Deploy" klicken.
7. Nach ein bis zwei Minuten ist die Seite live, unter einer Adresse wie
   `vermoegenskompass.vercel.app`. Eine eigene Domain (z. B. wohnblick-immobilien.de)
   lässt sich danach in den Vercel-Projekteinstellungen unter "Domains" ergänzen.

## Künftige Änderungen

Sobald ich dir eine aktualisierte `Vermoegenskompass.jsx` schicke: die alte Datei im
GitHub-Repository im `src`-Ordner öffnen, auf das Stift-Symbol ("Edit") oder erneut
"Add file → Upload files" klicken und die neue Version hochladen, "Commit changes"
klicken. Vercel baut und veröffentlicht die neue Version dann automatisch – kein
erneuter Import nötig.

## Interner Bereich (CRM)

Kein sichtbarer Link auf der Seite. Zugang: 5× kurz hintereinander auf den kleinen
"© Wohnblick Immobilien"-Schriftzug ganz unten auf der Startseite tippen, danach mit
E-Mail/Passwort anmelden (Nutzer dafür in Supabase unter Authentication → Users anlegen).
