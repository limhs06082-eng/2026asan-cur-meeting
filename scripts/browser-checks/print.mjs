import puppeteer from 'puppeteer-core';
const [,, mode, out, year] = process.argv;
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-first-run'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const url = `http://localhost:5173/?devLogin=limhs06082@gmail.com&devYear=${year}&devPrint=${mode}#output`;
await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
let ok = false;
for (let i = 0; i < 4 && !ok; i++) {
  try {
    await page.waitForSelector('.sheet', { timeout: 15000 });
    ok = true;
  } catch {
    const t = await page.evaluate(() => document.body.innerText.slice(0, 160));
    console.log('retry', i, JSON.stringify(t));
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  }
}
if (!ok) { console.log('FAILED'); await browser.close(); process.exit(1); }
await new Promise((r) => setTimeout(r, 1500));
await page.emulateMediaType('print');
await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
const info = await page.evaluate(() => ({ sheets: document.querySelectorAll('.sheet').length, overflow: [...document.querySelectorAll('.g-title, td')].filter((e) => e.scrollWidth > e.clientWidth + 1).length }));
console.log(mode, JSON.stringify(info));
await browser.close();
