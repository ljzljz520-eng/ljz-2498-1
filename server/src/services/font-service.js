import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class FontService {
  constructor({ requiredFonts = [], availableFonts = null, pdfRendererAvailable = false } = {}) {
    this.requiredFonts = requiredFonts;
    this.availableFonts = availableFonts;
    this.pdfRendererAvailable = pdfRendererAvailable;
  }

  async detectFonts() {
    if (Array.isArray(this.availableFonts)) return { fonts: this.availableFonts, source: 'configured' };
    try {
      const { stdout } = await execFileAsync('fc-list', ['--format=%{family}\n'], { timeout: 3000 });
      this.availableFonts = [...new Set(stdout.split('\n').map(line => line.trim()).filter(Boolean))];
      return { fonts: this.availableFonts, source: 'fc-list' };
    } catch {
      this.availableFonts = [];
      return { fonts: [], source: 'unavailable' };
    }
  }

  missingRequiredFonts() {
    if (!this.availableFonts) return this.requiredFonts;
    const set = new Set(this.availableFonts.flatMap(family => family.split(',').map(v => v.trim())));
    return this.requiredFonts.filter(font => !set.has(font));
  }
}
