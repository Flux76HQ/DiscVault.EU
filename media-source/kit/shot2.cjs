const { chromium } = require('playwright');
(async()=>{const [file,out,w,h,dsf]=process.argv.slice(2);const b=await chromium.launch();const p=await (await b.newContext({viewport:{width:+w,height:+h},deviceScaleFactor:+dsf||1})).newPage();
await p.goto('file://'+file);await p.waitForTimeout(900);await p.screenshot({path:out});await b.close();})();
