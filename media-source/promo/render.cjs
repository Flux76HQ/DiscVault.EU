const { chromium } = require('playwright');
(async()=>{const [mode,out,fpsArg,only]=process.argv.slice(2);const portrait=mode==='portrait';const fps=+fpsArg||30;
const b=await chromium.launch();const p=await (await b.newContext({viewport:portrait?{width:1080,height:1920}:{width:1920,height:1080},deviceScaleFactor:1})).newPage();
await p.goto('file://'+__dirname+'/promo.html'+(portrait?'?portrait=1':''));await p.waitForTimeout(500);
const dur=21;const frames=only?only.split(',').map(Number):[...Array(dur*fps).keys()].map(i=>i/fps);
let n=0;for(const t of frames){await p.evaluate(t=>window.renderAt(t),t);await p.screenshot({path:`${out}/${only?'k':'f'}${String(only?Math.round(t*10):n).padStart(4,'0')}.jpg`,type:'jpeg',quality:92});n++}
await b.close();console.log('frames',n)})();
