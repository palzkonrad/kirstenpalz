/**
 * AP1 — Bild-Optimierung für die Kirsten-Palz-Website.
 *
 * Liest die Original-Bilder aus dem Repo-Root, optimiert sie mit sharp und
 * schreibt sie mit sprechenden kebab-case-Namen nach images/.
 * Erzeugt tools/image-map.json als Übergabe-Artefakt an AP2
 * (dort werden die Referenzen in script.js neu geschrieben).
 *
 * Regeln:
 *  - Breite auf max. 1600 px begrenzen, NIE hochskalieren
 *  - Foto-PNGs ohne (genutzte) Transparenz  → JPEG q80 (Sonderfall q90, s. QUALITY_OVERRIDES)
 *  - PNGs MIT Transparenz                   → bleiben PNG, verlustfrei nachkomprimiert
 *  - JPEGs                                  → neu komprimiert q80
 *  - finale width/height jedes Bilds wird erfasst
 *
 * Aufruf:  node tools/optimize-images.mjs   (oder: npm run optimize-images)
 */

import sharp from 'sharp';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'images');
const MAP_FILE = path.join(ROOT, 'tools', 'image-map.json');

const MAX_WIDTH = 1600;
const JPEG_QUALITY = 80;

// Kunst-Reproduktionen, die bei q80 sichtbar leiden → q90 (im Report vermerken).
const QUALITY_OVERRIDES = /** @type {Record<string, number>} */ ({});

// Das eine externe Bild (urhuette): wird von freight.cargo.site geladen,
// falls es lokal noch nicht vorliegt. CloudFront blockt ohne Browser-User-Agent.
const EXTERNAL = {
    url: 'https://freight.cargo.site/w/1200/i/W2409583359707704566001869886610/homecomings.png',
    localSource: path.join(ROOT, 'tools', '_downloads', 'homecomings.png'),
    mapKey: 'https://freight.cargo.site/.../homecomings.png',
};

/**
 * Manifest aus dem Nutzungs-Audit (AP1): jede referenzierte Bilddatei im Root,
 * welche projectData-Einträge sie nutzen (Reihenfolge = erste Verwendung in
 * script.js) und der neue Basisname. Generische Namen (imageNN) bekommen
 * <projekt-id>-NN (NN = Position im images-Array des Projekts), bereits
 * sprechende Namen werden nur zu kebab-case normalisiert.
 * Die Datei-Endung entscheidet das Skript (Transparenz-Check).
 */
const MANIFEST = [
    { src: 'Kirsten-Palz-Berlin.jpeg', base: 'kirsten-palz-berlin', usedBy: ['about'] },
    { src: 'EXTINCTION_Palz29.jpeg', base: 'chronicle-01', usedBy: ['chronicle'] },
    { src: 'extinction-probes.png', base: 'extinction-probes-01', usedBy: ['probes'] },
    { src: 'extinction-probes05.png', base: 'extinction-probes-02', usedBy: ['probes'] },
    { src: 'extinction-probes06.png', base: 'extinction-probes-03', usedBy: ['probes'] },
    { src: 'extinction-probes022.png', base: 'extinction-probes-04', usedBy: ['probes'] },
    { src: 'image28.jpeg', base: 'below-sun-01', usedBy: ['below-sun'] },
    { src: 'flugblatt.jpg', base: 'flugblatt', usedBy: ['substances'] },
    { src: 'Temperatures-1994.png', base: 'temperatures-1994', usedBy: ['temperatures'] },
    { src: 'forest-research-platform-2.png', base: 'forest-research-platform', usedBy: ['forest'] },
    { src: 'Invitation.png', base: 'forest-02', usedBy: ['forest'] },
    { src: 'image2.png', base: 'sound-2-01', usedBy: ['sound-2'] },
    { src: 'image3.png', base: 'sound-2-02', usedBy: ['sound-2'] },
    { src: 'image4.png', base: 'sound-2-03', usedBy: ['sound-2'] },
    { src: 'image5.png', base: 'sound-2-04', usedBy: ['sound-2'] },
    { src: 'image6.png', base: 'works-01', usedBy: ['works'] },
    { src: 'image7.png', base: 'works-02', usedBy: ['works'] }, // in 'works' doppelt referenziert
    { src: 'image8.png', base: 'works-03', usedBy: ['works'] },
    { src: 'image9.png', base: 'works-04', usedBy: ['works'] },
    { src: 'image10.png', base: 'works-05', usedBy: ['works'] },
    { src: 'image11.png', base: 'works-06', usedBy: ['works'] },
    { src: 'image12.png', base: 'works-07', usedBy: ['works'] },
    { src: 'image13.png', base: 'works-08', usedBy: ['works'] },
    { src: 'image14.png', base: 'works-09', usedBy: ['works'] },
    { src: 'image15.png', base: 'algorithm-01', usedBy: ['algorithm'] }, // im description-HTML
    { src: 'image16.png', base: 'algorithm-02', usedBy: ['algorithm'] }, // im description-HTML
    { src: 'image17.png', base: 'transmitter-01', usedBy: ['transmitter'] },
    { src: 'dance001_KP_small.jpg', base: 'dance-001', usedBy: ['choreography'] },
    { src: 'Choreography_Efrat.png', base: 'choreography-efrat', usedBy: ['choreography'] },
    { src: 'image18.png', base: 'song-books-01', usedBy: ['song-books'] },
    { src: 'image19.png', base: 'song-books-02', usedBy: ['song-books'] },
    { src: 'image20.png', base: 'song-books-03', usedBy: ['song-books'] },
    { src: 'image21.png', base: 'song-books-04', usedBy: ['song-books'] },
    { src: 'image22.png', base: 'song-books-05', usedBy: ['song-books'] },
    { src: 'jyhartmuseum_exhibition-view_JPG.jpeg', base: 'jyhartmuseum-exhibition-view', usedBy: ['impact-china'] },
    { src: 'image25.png', base: 'le-foyer-01', usedBy: ['le-foyer'] },
    { src: 'image26.png', base: 'art-feminism-01', usedBy: ['art-feminism'] },
    { src: 'image27.png', base: 'book-fairs-01', usedBy: ['book-fairs'] },
    { src: 'friends-with-books.jpeg', base: 'friends-with-books', usedBy: ['book-fairs'] },
    { src: 'KirstenPalz_IMPACT_small.jpeg', base: 'kirsten-palz-impact', usedBy: ['impact'] },
    { src: 'image24.png', base: 'acta-01', usedBy: ['acta'] },
    { src: 'Z1-city.jpg', base: 'z1-city', usedBy: ['acta'] },
    { src: 'image28.png', base: 'acta-03', usedBy: ['acta'] },
    // Externes Bild (freight.cargo.site) → lokalisiert:
    { src: EXTERNAL.mapKey, base: 'urhuette-01', usedBy: ['urhuette'], sourcePath: EXTERNAL.localSource },
];

async function ensureExternalDownloaded() {
    if (existsSync(EXTERNAL.localSource)) return;
    console.log(`Lade externes Bild: ${EXTERNAL.url}`);
    const res = await fetch(EXTERNAL.url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            Accept: 'image/avif,image/webp,image/png,image/*,*/*;q=0.8',
        },
    });
    if (!res.ok) throw new Error(`Download fehlgeschlagen: HTTP ${res.status}`);
    await mkdir(path.dirname(EXTERNAL.localSource), { recursive: true });
    await writeFile(EXTERNAL.localSource, Buffer.from(await res.arrayBuffer()));
}

/** Hat das Bild tatsächlich genutzte Transparenz (nicht nur einen Alpha-Kanal)? */
async function hasRealTransparency(image, metadata) {
    if (!metadata.hasAlpha) return false;
    const stats = await image.stats();
    return !stats.isOpaque;
}

function fmtKB(bytes) {
    return `${(bytes / 1024).toFixed(0)} KB`;
}

async function main() {
    await ensureExternalDownloaded();
    await mkdir(OUT_DIR, { recursive: true });

    /** @type {Record<string, { new: string, width: number, height: number, usedBy: string[] }>} */
    const map = {};
    let totalBefore = 0;
    let totalAfter = 0;
    const notes = [];

    for (const entry of MANIFEST) {
        const sourcePath = entry.sourcePath ?? path.join(ROOT, entry.src);
        if (!existsSync(sourcePath)) {
            throw new Error(`Quelldatei fehlt: ${sourcePath}`);
        }
        const beforeSize = statSync(sourcePath).size;
        const input = await readFile(sourcePath);
        const image = sharp(input);
        const metadata = await image.metadata();

        const isPng = metadata.format === 'png';
        const keepPng = isPng && (await hasRealTransparency(image, metadata));
        const ext = keepPng ? 'png' : 'jpg';
        const outName = `${entry.base}.${ext}`;
        const outPath = path.join(OUT_DIR, outName);

        let pipeline = sharp(input).rotate(); // EXIF-Orientierung einbacken
        if ((metadata.width ?? 0) > MAX_WIDTH) {
            pipeline = pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });
        }

        if (keepPng) {
            pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 });
            notes.push(`${entry.src}: echte Transparenz → bleibt PNG (${outName})`);
        } else {
            const quality = QUALITY_OVERRIDES[entry.src] ?? JPEG_QUALITY;
            if (quality !== JPEG_QUALITY) {
                notes.push(`${entry.src}: Qualitäts-Sonderfall q${quality} (Kunst-Reproduktion)`);
            }
            // flatten: falls ein PNG einen (ungenutzten) Alpha-Kanal hat → weißer Grund
            pipeline = pipeline
                .flatten({ background: '#ffffff' })
                .jpeg({ quality, mozjpeg: true });
        }

        const info = await pipeline.toFile(outPath);
        const afterSize = info.size;
        totalBefore += beforeSize;
        totalAfter += afterSize;

        map[entry.src] = {
            new: `images/${outName}`,
            width: info.width,
            height: info.height,
            usedBy: entry.usedBy,
        };

        const saved = ((1 - afterSize / beforeSize) * 100).toFixed(1);
        console.log(
            `${entry.src.padEnd(42)} → ${outName.padEnd(32)} ` +
            `${String(info.width).padStart(4)}x${String(info.height).padEnd(4)} ` +
            `${fmtKB(beforeSize).padStart(8)} → ${fmtKB(afterSize).padStart(8)}  (-${saved}%)`
        );
    }

    await writeFile(MAP_FILE, JSON.stringify(map, null, 2) + '\n');

    console.log('\n──────────────────────────────────────────────');
    console.log(`Gesamt: ${fmtKB(totalBefore)} → ${fmtKB(totalAfter)} ` +
        `(Ersparnis ${((totalBefore - totalAfter) / 1048576).toFixed(2)} MB, ` +
        `-${((1 - totalAfter / totalBefore) * 100).toFixed(1)}%)`);
    console.log(`Mapping geschrieben: ${path.relative(ROOT, MAP_FILE)}`);
    if (notes.length) {
        console.log('\nAuffälligkeiten:');
        for (const note of notes) console.log(`  - ${note}`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
