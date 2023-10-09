const fs = require('fs');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
const Canvas = require('canvas');

function NodeCanvasFactory() { }
NodeCanvasFactory.prototype = {
    create: function NodeCanvasFactory_create(width, height) {
        const canvas = Canvas.createCanvas(width, height);
        const context = canvas.getContext("2d");
        return {
            canvas,
            context,
        };
    },

    reset: function NodeCanvasFactory_reset(canvasAndContext, width, height) {
        canvasAndContext.canvas.width = width;
        canvasAndContext.canvas.height = height;
    },

    destroy: function NodeCanvasFactory_destroy(canvasAndContext) {

        // Zeroing the width and height cause Firefox to release graphics
        // resources immediately, which can greatly reduce memory consumption.
        canvasAndContext.canvas.width = 0;
        canvasAndContext.canvas.height = 0;
        canvasAndContext.canvas = null;
        canvasAndContext.context = null;
    },
};

// Some PDFs need external cmaps.
const CMAP_URL = "../../../node_modules/pdfjs-dist/cmaps/";
const CMAP_PACKED = true;

// Where the standard fonts are located.
const STANDARD_FONT_DATA_URL =
  "../../../node_modules/pdfjs-dist/standard_fonts/";

const canvasFactory = new NodeCanvasFactory();

// Seuil de contraste minimal pour considérer une page comme non blanche
const SEUIL_CONTRASTE = 0.01;

async function main() {

    // Vérifier les arguments
    if (process.argv.length !== 3) {
        console.log(`Usage: node ${process.argv[1]} fichier.pdf`);
        process.exit(1);
    }

    console.log(`Processing ${process.argv[2]}`);

    // Lire le fichier PDF
    const fichierPDF = process.argv[2];
    const contenuPDF = fs.readFileSync(fichierPDF).buffer;

    // Extraire le texte de chaque page
    const pdf = await pdfjs.getDocument({
        data: contenuPDF,
        cMapUrl: CMAP_URL,
        cMapPacked: CMAP_PACKED,
        standardFontDataUrl: STANDARD_FONT_DATA_URL,
        canvasFactory,
    }).promise;


    const nbPages = pdf.numPages;
    const pagesASupprimer = [];
    for (let i = 1; i <= nbPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1 });

        const canvasAndContext = canvasFactory.create(
            viewport.width,
            viewport.height
        );
        const renderContext = {
            canvasContext: canvasAndContext.context,
            viewport,
        };
        await page.render(renderContext).promise;
        const imageData = canvasAndContext.context.getImageData(0, 0, canvasAndContext.canvas.width, canvasAndContext.canvas.height);

        // Calculer le contraste global de l'image
        let somme = 0;
        for (let i = 0; i < imageData.data.length; i += 4) {
            const r = imageData.data[i];
            const g = imageData.data[i + 1];
            const b = imageData.data[i + 2];
            const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            somme += luma;
        }
        const moyenne = somme / (imageData.width * imageData.height);
        let variance = 0;
        for (let i = 0; i < imageData.data.length; i += 4) {
            const r = imageData.data[i];
            const g = imageData.data[i + 1];
            const b = imageData.data[i + 2];
            const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            variance += (luma - moyenne) ** 2;
        }
        const ecartType = Math.sqrt(variance / (imageData.width * imageData.height));
        const contraste = ecartType / 255;

        console.log(`Page ${i} contrast ${contraste}`);

        // Vérifier si la page est non blanche
        if (contraste < SEUIL_CONTRASTE) {
            pagesASupprimer.push(i);
        }
    }
    console.log(pagesASupprimer);

    // Supprimer les pages vides
    const doc = await PDFDocument.load(contenuPDF);
    pagesASupprimer.reverse().forEach(i => {
        doc.removePage(i - 1);
    });
    const nouveauContenuPDF = await doc.save();

    // Écrire le nouveau fichier PDF
    fs.writeFileSync(fichierPDF, nouveauContenuPDF);
}

main();