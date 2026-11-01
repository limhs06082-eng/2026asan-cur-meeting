import puppeteer from 'puppeteer-core';
const years = ['2026-review-v1', '2027-plan-v1', 'perf-test-200', 'restore-test-1'];
const views = ['board', 'list', 'connections', 'grades', 'checks', 'output', 'admin', 'guide'];
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const problems = [];
for (const y of years) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 800 });
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`[${y}] ${m.type()}: ${m.text().slice(0, 220)}`); });
  page.on('pageerror', (e) => problems.push(`[${y}] pageerror: ${e.message}`));
  await page.goto(`http://localhost:5173/?devLogin=limhs06082@gmail.com&devYear=${y}#board`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  await page.waitForSelector('.topbar', { timeout: 30000 }).catch(() => problems.push(`[${y}] no topbar`));
  await new Promise((r) => setTimeout(r, 2500));
  for (const v of views) {
    await page.evaluate((v) => { location.hash = v; }, v);
    await new Promise((r) => setTimeout(r, 900));
    const bad = await page.evaluate(() => document.body.innerText.includes('화면을 표시하는 중 문제가 생겼습니다'));
    if (bad) problems.push(`[${y}] ${v}: error boundary`);
    if (v === 'board') {
      const n = await page.$$eval('.chip', (els) => els.length);
      if (n) {
        await page.click('.chip');
        await new Promise((r) => setTimeout(r, 900));
        const hist = await page.$$('xpath/.//button[contains(., "변경 이력 불러오기")]');
        if (hist[0]) { await hist[0].click(); await new Promise((r) => setTimeout(r, 1200)); }
      }
    }
    if (v === 'connections') {
      const rows = await page.$$('tr.clickable');
      if (rows[0]) { await rows[0].click(); await new Promise((r) => setTimeout(r, 900)); await page.keyboard.press('Escape'); }
    }
    if (v === 'output') {
      const b = await page.$$('xpath/.//button[contains(., "출력 화면 만들기")]');
      if (b[0]) { await b[0].click(); await new Promise((r) => setTimeout(r, 900)); }
    }
  }
  await page.close();
}
await browser.close();
console.log(problems.length ? problems.join('\n') : 'NO PROBLEMS');
