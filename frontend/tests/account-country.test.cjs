const test = require('node:test');
const assert = require('node:assert/strict');
const {syncCountry} = require('../public/padi-chat/account-country.js');
const {latestPreferenceID, preferenceDraft} = require('../public/padi-chat/preference-review.js');

function setup(t, prefs, countries = {}) {
  let session = {user:{id:'A'},token:'A'};
  const calls = [];
  const fetch = t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(url, '/api/v1/account/country');
    const owner = options.headers.Authorization.slice(7);
    const body = options.body && JSON.parse(options.body);
    calls.push({owner, method:options.method, body});
    if (body && (!body.only_if_missing || !countries[owner])) countries[owner] = body.country_code;
    return {ok:true, json:async () => ({country_code:countries[owner] || ''})};
  });
  return {
    calls, fetch, countries, prefs:()=>prefs, choose:code=>{prefs={...prefs,countryCode:code,countrySyncPending:true};},
    switch:owner=>{session={user:{id:owner},token:owner};},
    sync:options=>syncCountry({session,api:'/api',currentSession:async()=>session,
      readPreferences:async()=>prefs,savePreferences:async next=>{prefs=next;},...options}),
  };
}

test('onboarding and Settings follow the account, including on a shared device',async t=>{
  const f=setup(t,{onboarded:true,countryCode:'NG',countrySyncPending:true},{B:'KE'});
  await f.sync({freshLogin:true});
  assert.equal(f.countries.A,'NG');assert.equal(f.prefs().countryOwner,'A');
  await f.sync({beforeChat:true});assert.equal(f.calls.length,1);
  f.switch('B');await f.sync();assert.equal(f.prefs().countryCode,'KE');assert.equal(f.countries.B,'KE');
  f.choose('GH');await f.sync();assert.equal(f.countries.B,'GH');
  f.switch('A');await f.sync();assert.equal(f.prefs().countryCode,'NG');
});
test('an older on-device selection seeds only a missing country, and a fresh login never inherits unlabelled legacy data',async t=>{
  const f=setup(t,{onboarded:true,countryCode:'NG'},{A:'GH'});
  await f.sync();assert.equal(f.prefs().countryCode,'GH');assert.equal(f.calls[0].body.only_if_missing,true);
  const second=setup(t,{onboarded:true,countryCode:'NG'});
  await second.sync({freshLogin:true});assert.equal(second.calls[0].method,'GET');assert.equal(second.prefs().countryCode,null);
});
test('a failed upload stays with its owner until a successful retry',async t=>{
  const f=setup(t,{countryCode:'NG',countrySyncPending:true});
  f.fetch.mock.mockImplementationOnce(async()=>{throw Error('offline');});
  await assert.rejects(f.sync(),/sync/);assert.equal(f.prefs().countryOwner,'A');
  f.switch('B');await f.sync();assert.equal(f.countries.B,undefined);assert.equal(f.prefs().countryOwner,'A');
  f.switch('A');await f.sync();assert.equal(f.countries.A,'NG');
});
test('an account change during a request discards the late device update',async t=>{
  const f=setup(t,{countryCode:'NG',countryOwner:'A'});
  f.fetch.mock.mockImplementationOnce(async()=>{f.switch('B');return {ok:true,json:async()=>({country_code:'US'})};});
  await f.sync();assert.equal(f.prefs().countryCode,'NG');
});
test('a memory suggestion uses the signed-in user’s own completed words and preserves dislikes',()=>{
  const message={id:'m1',role:'user',backendChat:true,backendUserID:'A',text:"Remember that I don't like loud music."};
  assert.equal(preferenceDraft(message,'A').value,"I don't like loud music.");
  assert.equal(latestPreferenceID([message], 'A'),'m1');
  assert.equal(latestPreferenceID([message], 'B'),null);
  for(const patch of [{role:'padi',text:'I love headphones.'},{text:'What do I like?'},{text:'Funny'},{text:'My sister loves music.'},{backendChat:false}]){
    assert.equal(preferenceDraft({...message,...patch},'A'),undefined);
  }
});
