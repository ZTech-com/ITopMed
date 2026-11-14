/**
 * `npm run docs:pdf` — renders docs/pdf-src/*.html to A4 PDFs in docs/pdf/ with Edge.
 * The screenshots in docs/pdf-src/img come from scripts/docs/screenshots.ts (synthetic data only).
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const SRC = path.join(process.cwd(), "docs", "pdf-src");
const OUT = path.join(process.cwd(), "docs", "pdf");
const DOCS = [
  { html: "sotuv.html", pdf: "ITopMed-sotuv.pdf", title: "ITop Med — Sotuv bo'limi uchun" },
  { html: "qollanma.html", pdf: "ITopMed-qollanma.pdf", title: "ITop Med — Egasi uchun qo'llanma" },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage();
  for (const d of DOCS) {
    await page.goto(pathToFileURL(path.join(SRC, d.html)).href, { waitUntil: "load" });
    await page.evaluate(() => Promise.all(Array.from(document.images).map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r))))));
    const broken = await page.evaluate(() => Array.from(document.images).filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src")));
    if (broken.length) throw new Error(`${d.html}: missing images ${broken.join(", ")}`);
    await page.pdf({
      path: path.join(OUT, d.pdf),
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="width:100%;font-size:8px;color:#888;padding:0 15mm;display:flex;justify-content:space-between;font-family:Segoe UI,Arial"><span>${d.title}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    });
    console.log(`  ${d.pdf}  ${(fs.statSync(path.join(OUT, d.pdf)).size / 1024).toFixed(0)} KB`);
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
