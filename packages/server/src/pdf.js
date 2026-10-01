// PDF rendering. print and PDF share one HTML source from one snapshot.
// puppeteer-core is optional; when no Chromium is present callers fall back to
// the print HTML so the pipeline stays demonstrable and the missing-engine
// condition is explicit rather than silently producing a different layout.
let puppeteer = null;
try { puppeteer = (await import('puppeteer-core')).default; } catch { /* optional */ }

const CANDIDATES = process.env.CHROMIUM_PATH
  ? [process.env.CHROMIUM_PATH]
  : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];

export async function renderPDF(html) {
  if (!puppeteer) throw new Error('puppeteer-core not installed');
  const exec = await findBrowser();
  if (!exec) throw new Error('no Chromium/Chrome executable found (set CHROMIUM_PATH)');
  const browser = await puppeteer.launch({ executablePath: exec, headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return page.pdf({ printBackground: true, preferCSSPageSize: true });
  } finally { await browser.close(); }
}

async function findBrowser() {
  const fs = await import('node:fs/promises');
  for (const c of CANDIDATES) { try { await fs.access(c); return c; } catch {} }
  return null;
}

export function pdfAvailable() { return !!puppeteer; }
