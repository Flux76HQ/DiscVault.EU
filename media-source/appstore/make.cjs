// usage: node make.cjs  (reads panels.json: [{out,title,shot,field}])
const { chromium } = require('playwright'); const fs=require('fs');
(async()=>{const panels=JSON.parse(fs.readFileSync(__dirname+'/panels.json','utf8'));const b=await chromium.launch();
const p=await (await b.newContext({viewport:{width:1320,height:2868},deviceScaleFactor:1})).newPage();
for(const x of panels){await p.goto('file://'+__dirname+'/panel.html?'+new URLSearchParams({title:x.title,shot:x.shot,field:x.field}));await p.waitForTimeout(500);await p.screenshot({path:__dirname+'/out/'+x.out});console.log(x.out)}
await b.close()})();
