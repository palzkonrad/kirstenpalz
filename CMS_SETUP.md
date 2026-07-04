# CMS-Setup (Pages CMS) — Notizen für Konrad

Repo: `palzkonrad/kirstenpalz` · Live-Branch: `main` · Basispfad: `/kirstenpalz/`
CMS-Konfig: `.pages.yml` · Bedienungsanleitung für Kirsten: `ANLEITUNG.md`

## 1. Einmalige Einrichtung

1. https://app.pagescms.org → Sign-in mit GitHub-Account **palzkonrad**.
2. GitHub App „Pages CMS" installieren, Zugriff auf **palzkonrad/kirstenpalz**
   (Repository-Auswahl, nicht „All repositories").
3. Repo im CMS öffnen, Branch **main**.
4. Kirsten einladen:
   - **Plan A:** Pages CMS → Settings → Collaborators → Einladung per
     E-Mail (kein GitHub-Account nötig). **Vorher verifizieren, ob das im
     Free-Tier verfügbar ist** — Stand der Doku ja, aber vor dem Onboarding
     live prüfen.
   - **Plan B (Fallback):** GitHub-Account für Kirsten anlegen + als
     Repo-Collaborator hinzufügen; Anmeldung im CMS dann via GitHub.
5. Danach in `ANLEITUNG.md` Abschnitt 2 den nicht zutreffenden
   Anmelde-Absatz (Weg A/B) löschen.

## 2. Roundtrip-Testprotokoll

**VOR Kirstens Onboarding durchgehen — auf `main`, nach dem Merge von
`relaunch`.**

- [ ] **(a) Save-Roundtrip aller 11 Content-Dateien:** `content/projects.json`,
      `content/engagement.json`, `content/pages/{about,now,cv,sculpture,absences,ai-research,thanks,impressum,datenschutz}.json`
      im CMS öffnen, ohne Änderung speichern → `git diff` muss leer bzw.
      formatneutral sein. Einmaliger Format-Diff ist ok, danach muss es
      stabil sein.
- [ ] **(b) Media-Output ohne führenden Slash (KRITISCH):** Bild in einem
      Eintrag auswählen → im JSON muss `"images/…"` stehen (relativ, OHNE
      führenden `/`). Grund: GitHub-Pages-Basispfad `/kirstenpalz/` —
      absolute Pfade zeigen ins Leere. Konfiguriert via `media.output: images`.
- [ ] **(c) Rich-Text-Roundtrip:** Feld „Beschreibung" ändern, speichern,
      Rendering auf der Website prüfen (HTML-Format, `options.format: html`).
- [ ] **(d) Umlaut-Upload:** Bild als „Skulptur März.jpg" hochladen →
      `rename: safe` muss den Dateinamen slugifizieren.
- [ ] **(e) Drag-Sortierung:** Projekt in der Liste umsortieren →
      Array-Reihenfolge in `projects.json` im Diff prüfen.
- [ ] **(f) Validierung:** Pflichtfeld (Titel) leeren + ungültige id
      „Neues Projekt!" eingeben → Validierung muss greifen
      (Pattern `^[a-z0-9-]+$`, Meldung: „Nur Kleinbuchstaben (a–z), Zahlen
      und Bindestriche erlaubt …").
- [ ] **(g) Löschschutz:** `operations.delete: false` ist auf allen
      Dateien gesetzt → Datei darf im CMS nicht löschbar sein;
      Listeneinträge (einzelne Projekte/Bilder/Sounds) schon.
- [ ] **(h) Components-Labels:** Labels/Hilfetexte aus den `components`
      (`feld_id` = „Technischer Name", `feld_titel` = „Titel",
      `feld_beschreibung` = „Beschreibung", `feld_bilder` = „Bilder",
      `feld_sounds` = „Sounds") werden in der UI korrekt angezeigt.
- [ ] **(i) Listendarstellung:** Die 16 Projekte in der Liste brauchbar
      benannt (Titel sichtbar, nicht „Item #1")?
- [ ] **(j) Bild-Optimierung live:** Test-Upload eines >2000-px-Bilds auf
      `main` → Workflow **„Optimize CMS image uploads"**
      (`optimize-images.yml`) läuft, Bot-Commit
      **„Auto: Bilder weboptimiert [skip-optimize]"**, KEIN Folgelauf
      (GITHUB_TOKEN-Push triggert keine push-Workflows), Deploy wird via
      `workflow_dispatch` auf `static.yml` angestoßen. Branch-Protection
      auf `main` (falls vorhanden) darf den Bot-Push nicht blocken.
- [ ] **(k) Gefahrloser Erst-Test der Action:** über den Actions-Tab →
      `workflow_dispatch` auf „Optimize CMS image uploads" — auf
      konformem Bestand ein No-Op (kein Commit).

Schwellen der Auto-Optimierung (`tools/optimize-uploads.mjs`): Breite
> 2000 px → Resize; Datei > 500 KB → Rekompression (JPEG q80); PNG ohne
echte Transparenz → JPEG-Konvertierung inkl. Referenz-Update in `content/`.

## 3. Bekannte Grenzen / Randfälle

- **Race-Condition** Bot-Konvertierung (PNG→JPG-Umbenennung) vs.
  gleichzeitiges Content-Speichern im CMS: Die PNG-Referenz kann kurz tot
  sein; ein späterer Bild-Push heilt das NICHT automatisch (das Skript
  fasst nur nicht-konforme Bilder an) — bei Auffälligkeit `src` in der
  Content-Datei manuell fixen.
- **Hash-Routen** (`#/project/...`) sind für Crawler unsichtbar → nur EIN
  site-weites OG-Set in `index.html`, keine Pro-Projekt-Previews beim
  Teilen von Links.
- **GIF/SVG/WebP** werden von der Auto-Optimierung nicht angefasst
  (verarbeitet werden nur `.jpg`, `.jpeg`, `.png`).

## 4. Offene Platzhalter

- **Impressum + Datenschutz** (`content/pages/impressum.json`,
  `datenschutz.json`) enthalten `[Straße Hausnummer]`, `[PLZ Ort]`,
  `[E-Mail-Adresse]` → vor/nach Go-Live via CMS ausfüllen.
- **Opus 13** (Projekt `sound-2`, Track „Opus 13 Berlin (2020)",
  `soundcloud.com/user-538461993/opus-13`) ist bei SoundCloud nicht
  einbettbar → Kirsten: Embedding im Track aktivieren oder Eintrag
  entfernen.
- **`sound-1`** enthält deutschen Platzhaltertext („Platzhalter für die
  MP3-Dateien, die noch hinzugefügt werden.") und keine Sounds — Inhalt
  fehlt.

## 5. Notfall-Wege

- **CMS-Ersatz:** GitHub-Weboberfläche — `content/*.json` bzw.
  `content/pages/*.json` direkt editieren (JSON-Format:
  `JSON.stringify(x, null, 2)` + Newline, 2-Space-Indent beibehalten).
- **Wiederherstellung:** jede Version via Git-Historie; Tag
  **`pre-relaunch`** = alter Stand vor dem Relaunch.
- **Lock-in:** Pages CMS ist Open Source und self-hostbar; die
  Architektur (statisches JSON + `fetch`) funktioniert auch mit jedem
  anderen Git-basierten CMS.
