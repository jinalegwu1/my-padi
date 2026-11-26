// Real-router regression check: direct links/refreshes have no previous screen.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const frontend = process.env.PADI_VOICE_FRONTEND_URL || 'http://localhost:8081';

(async()=>{
  const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
  try {
    for (const [route,button,target,onboarded] of [
      ['/voice','End chat','/chat',true],
      ['/weather','Go back','/chat',true],
      ['/auth','Back to chat','/chat',true],
      ['/onboarding/country','Back','/onboarding/welcome',false],
      ...['language','location','name'].flatMap(step => [
        ['/onboarding/'+step,null,'/onboarding/country',false],
        ['/onboarding/'+step,null,'/chat',true],
      ]),
    ]) {
      const context=await browser.newContext({viewport:{width:430,height:900}});
      await context.addInitScript(onboarded=>{
        localStorage.setItem('app:v1:preferences',JSON.stringify({onboarded,countryCode:'NG',languageCode:'en-NG',displayName:'Navigation check',appearance:'light',textScale:1,voiceId:'ada',voiceRate:1,reduceMotion:true}));
      },onboarded);
      const page=await context.newPage();
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('console',message=>{if(message.text().includes('GO_BACK'))errors.push(message.text());});
      page.setDefaultNavigationTimeout(120000);
      page.setDefaultTimeout(30000);
      await page.goto(frontend+route);
      // Exercise both a direct link and the same route after a refresh.
      await page.reload();
      if (button) await page.getByRole('button',{name:button,exact:true}).last().click();
      await page.waitForURL(url=>url.pathname===target);
      assert.equal(errors.some(error=>error.includes('GO_BACK')),false,route+' dispatched back without history');
      assert.deepEqual(errors,[]);
      console.log('PASS:',route,'after refresh exits to',target,'without an unhandled back action.');
      await context.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
