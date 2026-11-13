// Estrae il testo di un PDF con pdf.js (libreria in vendor/pdfjs, caricata solo quando serve).
// Il file viene letto sul dispositivo: nessun dato esce dal browser.

let lib;

export async function readPdf(buf) {
  if (!lib) {
    lib = await import('../vendor/pdfjs/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  const doc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  try {
    const pages = [];
    for (let n = 1; n <= Math.min(doc.numPages, 200); n++) {
      const page = await doc.getPage(n);
      const height = page.getViewport({ scale: 1 }).height;
      const text = await page.getTextContent();
      pages.push(
        text.items
          .filter((it) => it.str && it.str.trim())
          .map((it) => ({ str: it.str, x: it.transform[4], y: height - it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]) || 10 }))
      );
    }
    return pages;
  } finally {
    doc.destroy();
  }
}
