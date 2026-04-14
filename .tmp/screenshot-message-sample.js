const { chromium } = require('playwright');
(async()=>{
 const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
 const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true });
 await page.goto('file:///root/chat/.tmp/message-sample.html');
 await page.waitForTimeout(500);
 await page.screenshot({ path: '.tmp/message-sample.png', fullPage: true });
 await browser.close();
})();
