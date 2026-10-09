const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {transformSync}=require('next/dist/build/swc');

function harness(presentation,data,mutate=async()=>({ok:true}),props={}){
  const states=[data],refs=[];let index=0,ri=0;
  const hooks={...React,useEffect(){},useCallback:f=>f,useState(initial){const i=index++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v;}];},useRef(initial){const i=ri++;return refs[i]||=( {current:initial} );}};
  const filename='frontend/components/finance-panel.js';
  const {code}=transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}});
  const module={exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,require:id=>id==='react'?hooks:id==='../lib/api'?{api:async()=>data}:id.endsWith('finance-presentation.mjs')?presentation:id.endsWith('.css')?new Proxy({},{get:(_,key)=>key}):require(id),crypto:require('node:crypto'),FormData:class{constructor(form){this.values=form.values;}[Symbol.iterator](){return this.values[Symbol.iterator]();}},setTimeout,clearTimeout});
  return {render(){index=0;ri=0;return module.exports.FinancePanel({...props,mutate});},states};
}
function nodes(node,type){if(!node||typeof node!=='object')return [];return [...(node.type===type?[node]:[]),...React.Children.toArray(node.props?.children).flatMap(n=>nodes(n,type))];}
const merchant={balances:{PENDING:'10000',AVAILABLE:'96500',RESERVED:'0',HELD:'0',DEBT:'0'},paid_out_satang:'0',eligibility:{next_eligible_at:'2026-01-01'},settlement_mode:'MANUAL_WITHDRAWAL',accounts:[],withdrawals:[],advertising:[],transactions:[],banners:[],snapshots:[],csrf_token:'synthetic-csrf'};
test('finance amounts preserve exact satang including values beyond Number precision',async()=>{
  const p=await import('../frontend/lib/finance-presentation.mjs');
  assert.equal(p.inputSatang('300.01'),'30001');assert.equal(p.inputSatang('900719925474099.99'),'90071992547409999');
  assert.match(p.financeBaht('90071992547409999'),/\.99$/);assert.throws(()=>p.inputSatang('300.001'));assert.throws(()=>p.inputSatang('-1'));
});
test('cooldown display uses the server eligibility timestamp and rounds remaining minutes up',async()=>{
  const {remainingWindow}=await import('../frontend/lib/finance-presentation.mjs');
  assert.match(remainingWindow('2026-01-04T00:00:00Z',Date.parse('2026-01-01T00:00:00Z')),/72 ชั่วโมง 0 นาที/);
  assert.match(remainingWindow('2026-01-01T00:00:01Z',Date.parse('2026-01-01T00:00:00Z')),/0 ชั่วโมง 1 นาที/);
  assert.match(remainingWindow('2026-01-01T00:00:00Z',Date.parse('2026-01-04T00:00:00Z')),/ครบช่วงพักแล้ว/);
});
test('merchant finance renders authoritative balances and isolated finance controls',async()=>{
  const p=await import('../frontend/lib/finance-presentation.mjs');const html=renderToStaticMarkup(harness(p,merchant).render());
  assert.match(html,/฿965\.00/);assert.match(html,/ขอถอนเงิน/);assert.match(html,/24 ชั่วโมง/);assert.match(html,/72 ชั่วโมง/);assert.doesNotMatch(html,/Platform \/ สร้างผู้รับรุ่นใหม่|ยืนยันโอนสำเร็จ/);
});
test('withdrawal form submits integer satang, CSRF and stable idempotency; double click blocked',async()=>{
  const p=await import('../frontend/lib/finance-presentation.mjs');let finish;const calls=[];
  const h=harness(p,merchant,(path,options)=>{calls.push({path,options});return new Promise(r=>{finish=r;});});
  nodes(h.render(),'button').find(n=>n.props.children==='ขอถอนเงิน').props.onClick();
  const form=nodes(h.render(),'form')[0],event={preventDefault(){},currentTarget:{values:[['amountSatang','300.01']]}};
  const first=form.props.onSubmit(event);await form.props.onSubmit(event);
  assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/finance/merchant/withdrawals');assert.equal(JSON.parse(calls[0].options.body).amountSatang,'30001');assert.equal(calls[0].options.headers['X-Finance-CSRF'],merchant.csrf_token);assert.ok(calls[0].options.headers['Idempotency-Key']);
  assert.match(renderToStaticMarkup(h.render()),/กำลังดำเนินการ/);finish({ok:true});await first;assert.match(renderToStaticMarkup(h.render()),/ดำเนินการสำเร็จ/);
});
test('owner Confirm Paid requires reference, proof optional; server error is visible',async()=>{
  const p=await import('../frontend/lib/finance-presentation.mjs');
  const data={accounts:[],summary:{gmv_satang:'0',paid_out_satang:'0',refunded_satang:'0'},runtime:{mode:'LEGACY_MERCHANT_DIRECT'},payout_accounts:[],payouts:[],advertising:[],refunds:[],cases:[]};
  // View exposes cutover only to owner; transfer form uses required browser field plus backend authority.
  assert.doesNotMatch(renderToStaticMarkup(harness(p,data,undefined,{admin:true,owner:false}).render()),/เปิด Platform/);
  const h=harness(p,merchant,async()=>{throw new Error('เลขอ้างอิงนี้ถูกใช้แล้ว');});
  nodes(h.render(),'button').find(n=>n.props.children==='ขอถอนเงิน').props.onClick();
  await nodes(h.render(),'form')[0].props.onSubmit({preventDefault(){},currentTarget:{values:[['amountSatang','300']]}});
  assert.match(renderToStaticMarkup(h.render()),/role="alert"[^>]*>เลขอ้างอิงนี้ถูกใช้แล้ว/);
  const source=fs.readFileSync('frontend/components/finance-panel.js','utf8');assert.match(source,/name:'reference'.*จำเป็น/);assert.match(source,/name:'proof'.*optional:true/);
});
