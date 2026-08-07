
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    
    const files = [
        '01-master-plan.html',
        '02-three-steps.html',
        '03-git-management.html',
        '04-a2ui-detail.html',
        '05-low-cost-publish.html'
    ];
    
    for (const file of files) {
        const filePath = path.resolve(file);
        await page.goto('file://' + filePath, { waitUntil: 'networkidle0' });
        
        const outputFile = file.replace('.html', '.png');
        await page.screenshot({ path: outputFile, fullPage: false });
        console.log('Generated: ' + outputFile);
    }
    
    await browser.close();
})();
