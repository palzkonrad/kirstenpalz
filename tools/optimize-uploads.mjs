/**
 * AP7 — Auto-Optimierung für CMS-Bild-Uploads (läuft in CI, siehe
 * .github/workflows/optimize-images.yml).
 *
 * Zweck: Die Site wird über Pages CMS gepflegt; Bild-Uploads landen als
 * Commits direkt in images/ — potenziell 8-MB-Handyfotos. Dieses Skript
 * fängt NUR die Ausreißer ein und lässt alles Konforme byte-identisch
 * in Ruhe (wichtig: kein Endlos-Commit-Loop, kein unnötiger Diff).
 *
 * Regeln (konsistent zu tools/optimize-images.mjs aus AP1 — bewusst als
 * separates Skript: das AP1-Skript ist ein Einmal-Migrationswerkzeug mit
 * hartkodiertem Datei-MANIFEST; geteilt sind nur die Encoder-Settings):
 *  - Breite > 2000 px                → auf 2000 px verkleinern (nie hochskalieren)
 *  - Dateigröße > 500 KB             → rekomprimieren:
 *      · JPEG                        → JPEG q80 (mozjpeg), EXIF-Orientierung eingebacken
 *      · PNG ohne echte Transparenz  → JPEG q80 (Foto im PNG-Mantel; Datei wird zu .jpg
 *                                      umbenannt, alle Referenzen in content/ mitgezogen)
 *      · PNG mit echter Transparenz  → nur verlustfrei nachkomprimiert, bleibt PNG
 *  - bereits konforme Dateien        → UNVERÄNDERT (byte-identisch)
 *
 * Idempotenz (zwei Anker):
 *  1. Jede JPEG-Ausgabe bekommt ein EXIF-Software-Tag als Marker. Ein zweiter
 *     Lauf erkennt den Marker und lässt die Datei byte-identisch — nötig, weil
 *     verlustbehaftete Re-Enkodierung sonst bei jedem Lauf erneut ein paar
 *     Prozent "spart" (Generationsverlust) und immer neue Bytes erzeugt.
 *     Nebeneffekt: das übrige EXIF (inkl. GPS-Position von Handyfotos!) wird
 *     dabei entfernt — erwünscht für eine öffentliche Website.
 *  2. Rekompression ohne Resize wird nur übernommen, wenn sie ≥ 5 % spart —
 *     fängt fremde, bereits gut komprimierte Dateien ab und macht den
 *     verlustfreien PNG-Pfad idempotent (Re-Encode spart dort ~0 %).
 *
 * Nach einem Resize/Umbenennen werden die betroffenen Einträge in
 * content/**\/*.json korrigiert (src, width, height). Nicht referenzierte
 * Bilder (z. B. frisch hochgeladen, Eintrag noch nicht gespeichert): kein
 * Content-Eingriff. JSON wird nur bei echter Änderung neu geschrieben —
 * Format ist exakt JSON.stringify(x, null, 2) + '\n' (2-Space-Indent,
 * identisch zum Bestand, minimaler Diff).
 *
 * Aufruf:  node tools/optimize-uploads.mjs   (oder: npm run optimize-uploads)
 * Exit 0 = Erfolg (auch wenn nichts zu tun war); ob committet wird,
 * entscheidet der Workflow per git diff.
 */

import sharp from 'sharp';
import { readdir, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES_DIR = path.join(ROOT, 'images');
const CONTENT_DIR = path.join(ROOT, 'content');

// CMS-Uploads dürfen etwas großzügiger sein als die AP1-Migrationsgrenze
// (1600 px): Der optimierte Bestand bleibt so garantiert unangetastet,
// eingefangen werden nur echte Ausreißer (Handyfotos, Screenshots).
const MAX_WIDTH = 2000;
const MAX_BYTES = 500 * 1024;
const JPEG_QUALITY = 80; // identisch zu AP1
const MIN_SAVING = 0.05; // Rekompression nur bei ≥ 5 % Ersparnis (Idempotenz-Anker 2)

// Idempotenz-Anker 1: wird als EXIF-Software-Tag in jede JPEG-Ausgabe
// geschrieben; die Byte-Sequenz ist beim nächsten Lauf in der Datei auffindbar.
const MARKER = 'kirstenpalz optimize-uploads';

const PROCESSABLE = new Set(['.jpg', '.jpeg', '.png']);

/** Hat das Bild tatsächlich genutzte Transparenz (nicht nur einen Alpha-Kanal)? */
async function hasRealTransparency(image, metadata) {
    if (!metadata.hasAlpha) return false;
    const stats = await image.stats();
    return !stats.isOpaque;
}

/** Angezeigte Breite unter Berücksichtigung der EXIF-Orientierung. */
function displayedWidth(metadata) {
    const orientation = metadata.orientation ?? 1;
    return orientation >= 5 ? (metadata.height ?? 0) : (metadata.width ?? 0);
}

function fmtKB(bytes) {
    return `${(bytes / 1024).toFixed(0)} KB`;
}

/** Freien Zielnamen für eine PNG→JPG-Umbenennung finden (Kollisionen vermeiden). */
function uniqueJpgPath(pngPath) {
    const dir = path.dirname(pngPath);
    const base = path.basename(pngPath, path.extname(pngPath));
    let candidate = path.join(dir, `${base}.jpg`);
    let i = 1;
    while (existsSync(candidate)) {
        candidate = path.join(dir, `${base}-${i}.jpg`);
        i += 1;
    }
    return candidate;
}

/** Alle Bilddateien unter images/ (rekursiv, das CMS legt sie flach ab). */
async function collectImages(dir) {
    const entries = await readdir(dir, { withFileTypes: true, recursive: true });
    return entries
        .filter((e) => e.isFile() && PROCESSABLE.has(path.extname(e.name).toLowerCase()))
        .map((e) => path.join(e.parentPath ?? e.path, e.name));
}

/**
 * Ein Bild prüfen und ggf. optimieren.
 * @returns {Promise<null | { oldRel: string, newRel: string, width: number, height: number }>}
 *          null = Datei blieb unverändert.
 */
async function processImage(filePath) {
    const rel = path.relative(ROOT, filePath);
    const beforeSize = (await stat(filePath)).size;
    const input = await readFile(filePath);
    const image = sharp(input);
    const metadata = await image.metadata();

    const width = displayedWidth(metadata);
    const needsResize = width > MAX_WIDTH;
    const tooBig = beforeSize > MAX_BYTES;
    // Idempotenz-Anker 1: von uns erzeugte JPEGs tragen den EXIF-Marker —
    // die erneut anzufassen würde nur Generationsverlust produzieren.
    const alreadyOptimized = input.includes(MARKER);
    if (!needsResize && (!tooBig || alreadyOptimized)) return null; // → byte-identisch lassen

    const isPng = metadata.format === 'png';
    const keepPng = isPng && (await hasRealTransparency(image, metadata));

    let pipeline = sharp(input).rotate(); // EXIF-Orientierung einbacken (wie AP1)
    if (needsResize) {
        pipeline = pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });
    }

    let outPath = filePath;
    if (keepPng) {
        // Echte Transparenz → bleibt PNG, nur verlustfrei nachkomprimiert (wie AP1)
        pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 });
    } else {
        if (isPng) outPath = uniqueJpgPath(filePath); // Foto im PNG-Mantel → .jpg
        pipeline = pipeline
            .flatten({ background: '#ffffff' }) // evtl. ungenutzten Alpha-Kanal entfernen
            .withExif({ IFD0: { Software: MARKER } }) // Marker; ersetzt zugleich alles alte EXIF (GPS!)
            .jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
    }

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

    // Idempotenz-Anker 2: Ohne Resize wird eine Rekompression nur übernommen,
    // wenn sie spürbar spart — fängt fremde, bereits gut komprimierte Dateien
    // ab (verlustfreier PNG-Re-Encode spart ~0 %, fremde q80-JPEGs ebenso).
    if (!needsResize && data.length > beforeSize * (1 - MIN_SAVING)) {
        console.log(`${rel}: > 500 KB, aber bereits gut komprimiert (Ersparnis < 5 %) → unverändert`);
        return null;
    }

    await writeFile(outPath, data);
    if (outPath !== filePath) await unlink(filePath);

    const newRel = path.relative(ROOT, outPath);
    console.log(
        `${rel} → ${newRel}  ${info.width}x${info.height}  ` +
        `${fmtKB(beforeSize)} → ${fmtKB(data.length)}` +
        (needsResize ? `  (Resize ${width} → ${info.width} px)` : '')
    );
    return { oldRel: rel, newRel, width: info.width, height: info.height };
}

/**
 * content/**\/*.json an eine Bild-Änderung anpassen:
 *  - Objekte mit passendem "src" → src/width/height aktualisieren
 *  - sonstige String-Werte (z. B. description-HTML mit <img>) → Pfad ersetzen
 * Rückgabe: true, wenn der JSON-Baum verändert wurde.
 */
function applyChangeToTree(node, change) {
    let touched = false;
    if (Array.isArray(node)) {
        for (const item of node) touched = applyChangeToTree(item, change) || touched;
        return touched;
    }
    if (node === null || typeof node !== 'object') return false;

    if (node.src === change.oldRel) {
        node.src = change.newRel;
        if (typeof node.width === 'number') node.width = change.width;
        if (typeof node.height === 'number') node.height = change.height;
        touched = true;
    }
    for (const [key, value] of Object.entries(node)) {
        if (key === 'src') continue;
        if (typeof value === 'string' && change.oldRel !== change.newRel && value.includes(change.oldRel)) {
            node[key] = value.replaceAll(change.oldRel, change.newRel);
            touched = true;
        } else if (typeof value === 'object') {
            touched = applyChangeToTree(value, change) || touched;
        }
    }
    return touched;
}

async function updateContentReferences(changes) {
    if (changes.length === 0) return;
    const entries = await readdir(CONTENT_DIR, { withFileTypes: true, recursive: true });
    const jsonFiles = entries
        .filter((e) => e.isFile() && e.name.endsWith('.json'))
        .map((e) => path.join(e.parentPath ?? e.path, e.name));

    for (const file of jsonFiles) {
        const raw = await readFile(file, 'utf8');
        const tree = JSON.parse(raw);
        let touched = false;
        for (const change of changes) {
            touched = applyChangeToTree(tree, change) || touched;
        }
        if (!touched) continue; // Datei nicht betroffen → nicht anfassen
        const output = JSON.stringify(tree, null, 2) + '\n';
        if (output === raw) continue; // Werte waren schon korrekt → byte-identisch lassen
        await writeFile(file, output);
        console.log(`${path.relative(ROOT, file)}: Bild-Referenzen aktualisiert`);
    }
}

async function main() {
    const files = await collectImages(IMAGES_DIR);
    const changes = [];
    for (const file of files.sort()) {
        const change = await processImage(file);
        if (change) changes.push(change);
    }
    await updateContentReferences(changes);
    console.log(
        changes.length === 0
            ? 'Alle Bilder konform — nichts zu tun.'
            : `${changes.length} Bild(er) optimiert.`
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
