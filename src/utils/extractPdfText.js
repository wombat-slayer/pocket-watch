import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Fake worker — runs synchronously in the main thread.
// Appropriate for small PDFs like pay stubs. No CDN, no worker URL, no CSP issues.
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

export async function extractPdfText(arrayBuffer) {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    fullText += content.items.map(item => item.str).join(' ') + '\n';
  }
  return fullText;
}
