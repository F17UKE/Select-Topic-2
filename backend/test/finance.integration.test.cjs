const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
require('../src/env.cjs');
const { createDatabase } = require('../src/database.cjs');
const { createFinanceService } = require('../src/finance-service.cjs');
const { allocation, halfUp, reference, refundAllocation, served } = require('../src/finance-money.cjs');
const { createOrderService } = require('../src/order-service.cjs');
const { createPaymentService } = require('../src/payment-service.cjs');
const { createPaymentVerifier } = require('../src/payment-verifier.cjs');
const { createMerchantOrderService } = require('../src/merchant-order-service.cjs');
const { createRiderOrderService } = require('../src/rider-order-service.cjs');
const { recipientMapping, parseResult } = require('../src/payment-verifiers/easyslip-provider.cjs');

test('finance money: half-up, merchant/platform funding, delivery exclusion and reference normalization', () => {
  assert.deepEqual([9n,10n,11n,30n].map(v=>halfUp(v*500n,10000n)),[0n,1n,1n,2n]);
  const base={subtotal_amount:'200.00',delivery_fee:'15.00',discount_amount:'20.00',total_amount:'195.00'};
  const merchant=allocation({...base,promotion_snapshot:{funding_source:'MERCHANT',promotion_type:'FIXED_AMOUNT'}});
  const platform=allocation({...base,promotion_snapshot:{funding_source:'PLATFORM',promotion_type:'FIXED_AMOUNT'}});
  assert.equal(merchant.commission_satang,'900');assert.equal(merchant.merchant_entitlement_satang,'18600');
  assert.equal(platform.commission_satang,'1000');assert.equal(platform.merchant_entitlement_satang,'20500');
  assert.equal(platform.platform_subsidy_satang,'2000');
  const freeBase={subtotal_amount:'200.00',delivery_fee:'15.00',discount_amount:'15.00',total_amount:'200.00'};
  const freeMerchant=allocation({...freeBase,coupon_snapshot:{funding_source:'MERCHANT',promotion_type:'FREE_DELIVERY'}});
  const freePlatform=allocation({...freeBase,promotion_snapshot:{funding_source:'PLATFORM',promotion_type:'FREE_DELIVERY'}});
  assert.equal(freeMerchant.commission_satang,'1000');assert.equal(freePlatform.commission_satang,'1000');
  assert.equal(freeMerchant.merchant_entitlement_satang,'19000');assert.equal(freePlatform.merchant_entitlement_satang,'20500');
  assert.equal(freePlatform.platform_subsidy_satang,'1500');
  assert.throws(()=>allocation(base),{code:'finance_funding_required'});
  assert.equal(reference(' ab 123-xy '),'AB123-XY');assert.throws(()=>reference('  '));
  const first=refundAllocation(platform,{},'5000','0');
  const last=refundAllocation(platform,first,'15000','1500');
  assert.equal(BigInt(first.customer_refund_satang)+BigInt(last.customer_refund_satang),19500n);
  assert.equal(BigInt(first.commission_satang)+BigInt(last.commission_satang),1000n);
  assert.throws(()=>refundAllocation(platform,first,'15001','0'),{code:'refund_exceeds_snapshot'});
  assert.equal(served(30000,'2026-01-01','2026-01-31','2026-01-16'),15000n);
});

test('finance PostgreSQL integration and isolated local E2E', { skip: !/^-c search_path=p0_test_[a-f0-9]{16}$/.test(process.env.PGOPTIONS || '') && 'Use isolated-local-verification; never write finance fixtures into public' }, async t => {
  process.env.INTEGRATION_SETTINGS_ENCRYPTION_KEY=crypto.randomBytes(32).toString('base64');
  const db=createDatabase();
  try {
    await db.migrate.latest();
    const finance=createFinanceService(db), orders=createOrderService(db);
    const root=await db('platform_admins').where({role:'SUPER_ADMIN'}).first();
    const customer=await db('customers').where({line_user_id:'U_LOCAL_CUSTOMER_001'}).first();
    const address=await db('customer_addresses as a').join('dormitories as d','a.dormitory_id','d.id').where('a.customer_id',customer.id).first('a.id','d.soi_id');
    const [merchant]=await db('merchants').insert({store_name:'Finance isolated',prefix:`F${crypto.randomUUID().slice(0,7)}`,phone:'0800000000',location_text:'Isolated',promptpay_identifier_type:'PHONE',promptpay_id:'0800000000',is_open:true}).returning('*');
    const staff={};for(const role of ['MANAGER','CASHIER','KITCHEN','RIDER']) [staff[role]]=await db('merchant_staffs').insert({merchant_id:merchant.id,username:`f_${role}_${crypto.randomUUID().slice(0,7)}`,role,full_name:role,password_hash:'DEV_ONLY_NO_PASSWORD_LOGIN'}).returning('*');
    const [category]=await db('menu_categories').insert({merchant_id:merchant.id,name:'Finance'}).returning('*');
    const [item]=await db('menu_items').insert({merchant_id:merchant.id,category_id:category.id,name:'Finance meal',price:'1000.00',is_available:true}).returning('*');
    await db('delivery_fees').insert({merchant_id:merchant.id,soi_id:address.soi_id,fee:'15.00'});
    const config={verificationMode:'mock',maxUploadBytes:4194304,retentionHours:24};
    const files=new Map();
    const storage={put:async({buffer})=>{const k=`test-${crypto.randomUUID()}`;files.set(k,buffer);return {objectKey:k,fileHash:crypto.createHash('sha256').update(buffer).digest('hex')};},remove:async k=>files.delete(k)};
    const payments=createPaymentService({db,config,storage,verifier:createPaymentVerifier(config)});
    const merchants=createMerchantOrderService(db), riders=createRiderOrderService(db);
    const payload={merchantId:merchant.id,addressId:address.id,deliveryType:'DELIVERY',items:[{menuItemId:item.id,quantity:1}]};
    const uuid=()=>crypto.randomUUID();
    let first,second,account,withdrawal,ad,banner;
    const refund=(orderId,body,requestKey)=>finance.refund(root,orderId,{destinationBankCode:'004',destinationIdentifier:'1231231234',destinationName:'Synthetic customer',...body},requestKey);
    const paidOrder=async()=>{
      const o=await orders.createOrder(customer.id,payload);
      await payments.createAttempt(customer.id,o.id);
      const bytes=Buffer.from(uuid());
      const p=await payments.uploadAndVerify(customer.id,o.id,{mimetype:'image/png',buffer:bytes},{});
      assert.equal(p.payment.status,'PAID');return o;
    };
    const complete=async (o, concurrent=false)=>{
      await merchants.accept(staff.MANAGER,o.id);await merchants.startPreparing(staff.MANAGER,o.id);
      await merchants.completeAllItems(staff.KITCHEN,o.id);await merchants.ready(staff.KITCHEN,o.id);
      await merchants.assignRider(staff.MANAGER,o.id,staff.RIDER.id);await riders.startDelivery(staff.RIDER,o.id);
      if(concurrent){const results=await Promise.allSettled([riders.complete(staff.RIDER,o.id),riders.complete(staff.RIDER,o.id)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);}
      else await riders.complete(staff.RIDER,o.id);
    };
    await t.test('legacy orders remain legacy, no opening balances; unauthorized finance denied',async()=>{
      const legacy=await orders.createOrder(customer.id,payload);
      assert.equal((await db('orders').where({id:legacy.id}).first()).collection_mode,'LEGACY_DIRECT');
      assert.equal((await finance.balances(merchant.id)).AVAILABLE,'0');
      for(const role of ['CASHIER','KITCHEN','RIDER']) await assert.rejects(finance.merchantOverview(staff[role]),{status:403});
    });
    await t.test('owner explicit cutover creates encrypted immutable platform recipient',async()=>{
      const result=await finance.configure(root,{mode:'PLATFORM_CENTRALIZED',confirm:true,promptpayType:'PHONE',promptpayId:'0811111111',displayName:'Synthetic platform',bankCode:'004',bankNumber:'1234567890'});
      assert.ok(result.recipient_version_id);
      const row=await db('platform_payment_recipients').where({id:result.recipient_version_id}).first();
      assert.ok(!row.encrypted_identity.includes('0811111111'));
      await assert.rejects(db('platform_payment_recipients').where({id:row.id}).update({display_name:'Changed'}),{code:'23514'});
    });
    await t.test('new QR uses platform and pins version across rotation',async()=>{
      first=await orders.createOrder(customer.id,payload);
      const qr=await payments.getQr(customer.id,first.id);assert.ok(qr.merchant.promptpay_identifier.endsWith('1111'));
      const before=(await db('orders').where({id:first.id}).first()).payment_recipient_version_id;
      await finance.configure(root,{mode:'PLATFORM_CENTRALIZED',confirm:true,promptpayType:'PHONE',promptpayId:'0822222222',displayName:'Synthetic rotated',bankCode:'004',bankNumber:'1234567890'});
      assert.equal((await db('orders').where({id:first.id}).first()).payment_recipient_version_id,before);
      assert.ok((await payments.getQr(customer.id,first.id)).merchant.promptpay_identifier.endsWith('1111'));
    });
    await t.test('EasySlip uses pinned platform mapping and rejects wrong recipient',async()=>{
      const input={merchantId:merchant.id,expectedRecipient:'0811111111',expectedRecipientType:'PHONE',expectedAmount:'1015.00',financeRecipient:{promptpayId:'0811111111',promptpayType:'PHONE',bankCode:'004',bankNumber:'1234567890'}};
      const map=recipientMapping({},input);assert.equal(map.bankCode,'004');
      const response={success:true,data:{isDuplicate:false,isAmountMatched:true,amountInOrder:1015,amountInSlip:1015,matchedAccount:{bank:{code:'004'},bankNumber:'1234567890'},rawSlip:{transRef:'TEST_FINANCE',date:'2026-10-09T00:00:00Z',amount:{amount:1015},receiver:{bank:{id:'004'},account:{bank:{account:'9999999999'}}}}}};
      assert.equal(parseResult(response,input,map,'fake').failureCode,'RECIPIENT_MISMATCH');
      response.data.rawSlip.receiver.account.bank.account='1234567890';assert.equal(parseResult(response,input,map,'fake').status,'VERIFIED');
    });
    await t.test('paid capture pending snapshot exact and exactly once',async()=>{
      await payments.createAttempt(customer.id,first.id);
      await payments.uploadAndVerify(customer.id,first.id,{mimetype:'image/png',buffer:Buffer.from(uuid())},{});
      const s=await db('order_financial_snapshots').where({order_id:first.id}).first();assert.equal(s.commission_satang,'5000');
      assert.equal((await finance.balances(merchant.id)).PENDING,'96500');
      await db.transaction(q=>finance.capture(q,first.id,s.paid_payment_id));
      await payments.reconcilePayment(customer.id,first.id);
      assert.equal((await db('financial_transactions').where({event_key:`ORDER_PAID:${first.id}`}).count('* as n').first()).n,'1');
      assert.equal((await db('order_financial_snapshots').where({order_id:first.id}).count('* as n').first()).n,'1');
      assert.equal((await finance.balances(merchant.id)).PENDING,'96500');
      await assert.rejects(db('order_financial_snapshots').where({order_id:first.id}).update({commission_satang:'0'}),{code:'23514'});
    });
    await t.test('full fulfillment releases once and immutable journals reject append/update',async()=>{
      await complete(first);assert.equal((await finance.balances(merchant.id)).AVAILABLE,'96500');
      await assert.rejects(riders.complete(staff.RIDER,first.id),{code:'invalid_delivery_transition'});
      await Promise.all([db.transaction(q=>finance.orderEvent(q,first.id,'COMPLETED')),db.transaction(q=>finance.orderEvent(q,first.id,'COMPLETED'))]);
      const journal=await db('financial_transactions').where({event_key:`ORDER_COMPLETED:${first.id}`}).first();
      await assert.rejects(db('financial_transactions').where({id:journal.id}).update({event_key:'changed'}),{code:'23514'});
      const p=await db('financial_postings').where({transaction_id:journal.id}).first();
      await assert.rejects(db('financial_postings').insert({...p,line_no:20}),{code:'23514'});
      await assert.rejects(db('financial_postings').where({transaction_id:journal.id,line_no:p.line_no}).update({transaction_id:journal.id}),{code:'23514'});
    });
    await t.test('unbalanced/header-only journal, duplicate event key and invalid account type rejected',async()=>{
      await assert.rejects(db('financial_transactions').insert({merchant_id:merchant.id,event_key:uuid(),fingerprint:'a'.repeat(64),kind:'ORDER_PAID',order_id:first.id}),{code:'23514'});
      await assert.rejects(db('financial_transactions').insert({merchant_id:merchant.id,event_key:`ORDER_PAID:${first.id}`,fingerprint:'a'.repeat(64),kind:'ORDER_PAID',order_id:first.id}),{code:'23505'});
      await assert.rejects(db('financial_accounts').insert({merchant_id:merchant.id,kind:'INVENTED'}),{code:'23514'});
    });
    await t.test('payout account encryption, verification and 24h hold',async()=>{
      account=await finance.saveAccount(staff.MANAGER,{accountType:'BANK_ACCOUNT',bankCode:'004',identifier:'9876543210',accountName:'Synthetic Merchant'});
      assert.ok(!JSON.stringify(account).includes('9876543210'));
      await finance.verifyAccount(root,account.id);
      await assert.rejects(finance.withdrawal(staff.MANAGER,{amountSatang:'30000'},uuid()),{code:'withdrawal_on_hold'});
      // Clock fixture confined to disposable schema, never a public/operator override.
      await db('merchants').where({id:merchant.id}).update({payout_account_changed_at:new Date(Date.now()-86401000)});
    });
    await t.test('minimum and overdraft reject; concurrent withdrawal reserves once',async()=>{
      await assert.rejects(finance.withdrawal(staff.MANAGER,{amountSatang:'29999'},uuid()),{code:'withdrawal_minimum'});
      await assert.rejects(finance.withdrawal(staff.MANAGER,{amountSatang:'999999'},uuid()),{code:'insufficient_available'});
      const results=await Promise.allSettled([finance.withdrawal(staff.MANAGER,{amountSatang:'30000'},uuid()),finance.withdrawal(staff.MANAGER,{amountSatang:'30000'},uuid())]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);withdrawal=results.find(r=>r.status==='fulfilled').value;
      assert.equal((await finance.balances(merchant.id)).RESERVED,'30000');
      assert.equal((await finance.withdrawal(staff.MANAGER,{amountSatang:'30000'},withdrawal.idempotency_key)).id,withdrawal.id);
    });
    await t.test('IDOR, role permissions, skip transition and rejected release once',async()=>{
      await assert.rejects(finance.withdrawalAction({...staff.MANAGER,merchant_id:merchant.id+999},withdrawal.id,'cancel',{reason:'test'}),{status:404});
      await assert.rejects(finance.withdrawalAction({...root,role:'FINANCE'},withdrawal.id,'paid',{reference:'ABC'}),{status:403});
      await assert.rejects(finance.withdrawalAction(root,withdrawal.id,'paid',{reference:'ABC'}),{code:'invalid_withdrawal_transition'});
      await finance.withdrawalAction(root,withdrawal.id,'reject',{reason:'Synthetic reject'});
      assert.equal((await finance.balances(merchant.id)).AVAILABLE,'96500');
      await assert.rejects(finance.withdrawalAction(root,withdrawal.id,'reject',{reason:'Again'}),{code:'invalid_withdrawal_transition'});
    });
    await t.test('failed transfer requires non-transfer confirmation and releases once',async()=>{
      const w=await finance.withdrawal(staff.MANAGER,{amountSatang:'30000'},uuid());
      await finance.withdrawalAction(root,w.id,'approve');await finance.withdrawalAction(root,w.id,'processing');
      await assert.rejects(finance.withdrawalAction(root,w.id,'failed',{reason:'timeout'}),{code:'non_transfer_confirmation_required'});
      await finance.withdrawalAction(root,w.id,'failed',{reason:'Confirmed no transfer',confirmNoTransfer:true});
      assert.equal((await finance.balances(merchant.id)).AVAILABLE,'96500');
    });
    await t.test('Confirm Paid requires reference, normalizes, records actor/time, then 72h cooldown',async()=>{
      withdrawal=await finance.withdrawal(staff.MANAGER,{amountSatang:'96500'},uuid());
      await finance.withdrawalAction(root,withdrawal.id,'approve');await finance.withdrawalAction(root,withdrawal.id,'processing');
      await assert.rejects(finance.withdrawalAction(root,withdrawal.id,'paid',{}),{code:'transfer_reference_required'});
      await finance.withdrawalAction(root,withdrawal.id,'paid',{reference:' finance 123-abc '});
      const tx=await db('finance_transfers').where({withdrawal_id:withdrawal.id}).first();assert.equal(tx.external_reference,'FINANCE123-ABC');assert.equal(tx.confirmed_by_admin_id,root.id);assert.ok(tx.confirmed_at);assert.equal(tx.evidence_object_key,null);
      assert.equal((await finance.balances(merchant.id)).AVAILABLE,'0');
      await assert.rejects(finance.withdrawalAction(root,withdrawal.id,'paid',{reference:'FINANCE123-ABC'}),{code:'invalid_withdrawal_transition'});
      await assert.rejects(finance.withdrawal(staff.MANAGER,{amountSatang:'30000'},uuid()),{code:'withdrawal_on_hold'});
    });
    await t.test('multiple partial refund after payout creates debt, caps components and rejects bank reference reuse across refund/payout',async()=>{
      const one=await refund(first.id,{foodSatang:'40000',deliverySatang:'0',reason:'Part one'},uuid());
      assert.equal(one.commission_satang,'2000');assert.equal((await finance.balances(merchant.id)).DEBT,'38000');
      await finance.refundAction(root,one.id,'processing',{});
      await assert.rejects(finance.refundAction(root,one.id,'paid',{reference:'finance 123-abc'}),{code:'duplicate_transfer_reference'});
      assert.equal((await db('finance_refunds').where({id:one.id}).first()).status,'PROCESSING');
      await finance.refundAction(root,one.id,'paid',{reference:'FINANCE-REFUND-001'});
      const two=await refund(first.id,{foodSatang:'60000',deliverySatang:'1500',reason:'Remaining'},uuid());
      assert.equal(two.customer_refund_satang,'61500');assert.equal((await finance.balances(merchant.id)).DEBT,'96500');
      await assert.rejects(refund(first.id,{foodSatang:'1',deliverySatang:'0',reason:'Too much'},uuid()),{code:'refund_exceeds_snapshot'});
    });
    await t.test('future completed earnings offset debt before creating available',async()=>{
      second=await paidOrder();await complete(second);
      assert.equal((await finance.balances(merchant.id)).DEBT,'0');assert.equal((await finance.balances(merchant.id)).AVAILABLE,'0');
    });
    await t.test('advertising rejects insufficient; paid consent/deferred, reject refunds once',async()=>{
      [banner]=await db('banners').insert({title:'Synthetic ad',image_object_key:'banners/2026/10/11111111-1111-4111-8111-111111111111.png',scope:'MERCHANT',merchant_id:merchant.id,target_type:'STORE',target_value:String(merchant.id),status:'DRAFT'}).returning('*');
      await assert.rejects(finance.purchaseAd(staff.MANAGER,{bannerId:banner.id,confirm:true},uuid()),{code:'insufficient_available'});
      await complete(await paidOrder());
      ad=await finance.purchaseAd(staff.MANAGER,{bannerId:banner.id,confirm:true},uuid());
      assert.equal((await finance.balances(merchant.id)).AVAILABLE,'66500');
      assert.equal((await db('banners').where({id:banner.id}).first()).status,'DRAFT');
      await finance.adAction(root,ad.id,'reject','Not approved');assert.equal((await finance.balances(merchant.id)).AVAILABLE,'96500');
    });
    await t.test('active merchant ad cancellation has no automatic refund; platform termination refunds unserved',async()=>{
      ad=await finance.purchaseAd(staff.MANAGER,{bannerId:banner.id,confirm:true},uuid());await finance.adAction(root,ad.id,'activate');
      await finance.adAction(staff.MANAGER,ad.id,'cancel','Merchant cancel');assert.equal((await finance.balances(merchant.id)).AVAILABLE,'66500');
      ad=await finance.purchaseAd(staff.MANAGER,{bannerId:banner.id,confirm:true},uuid());await finance.adAction(root,ad.id,'activate');
      const ended=await finance.adAction(root,ad.id,'terminate','Platform failure');assert.ok(BigInt(ended.refunded_satang)>=29999n);
    });
    await t.test('auto settlement respects cooldown and dedupes windows; reconciliation has no discrepancies',async()=>{
      await finance.setMode(staff.MANAGER,'AUTO_3_DAYS');
      const before=await db('merchant_withdrawals').where({merchant_id:merchant.id}).count('* as n').first();
      await finance.runScheduled();await finance.runScheduled();
      assert.equal((await db('merchant_withdrawals').where({merchant_id:merchant.id}).count('* as n').first()).n,before.n);
      assert.equal((await finance.reconcile(root)).issues,0);
    });
    await t.test('legacy funding allowed only backfill; source ownership and recipient FK enforced',async()=>{
      await assert.rejects(db('promotions').insert({name:'Unknown',promotion_type:'FIXED_AMOUNT',value:1,minimum_order_amount:0,starts_at:new Date(),ends_at:new Date(Date.now()+100000),funding_source:'LEGACY_UNKNOWN'}),{code:'23514'});
      await assert.rejects(db('payments').insert({order_id:first.id,method:'PROMPTPAY',expected_amount:'1015.00',status:'PENDING',verification_status:'PENDING',payment_recipient_version_id:null}),{code:'23514'});
    });
    await t.test('database aggregate balance, ownership, positive amounts and terminal protection',async()=>{
      const fresh=await paidOrder();
      const makeJournal=async(q,lines)=>{
        await q('orders').where({id:fresh.id}).update({status:'COMPLETED'});
        const [j]=await q('financial_transactions').insert({merchant_id:merchant.id,event_key:`ORDER_COMPLETED:${fresh.id}`,fingerprint:'a'.repeat(64),kind:'ORDER_COMPLETED',order_id:fresh.id}).returning('*');
        for(const [i,[kind,side,amount]] of lines.entries()){
          const a=await q('financial_accounts').where({merchant_id:merchant.id,kind}).first();
          await q('financial_postings').insert({transaction_id:j.id,line_no:i+1,account_id:a.id,side,amount_satang:amount});
        }
      };
      await assert.rejects(db.transaction(q=>makeJournal(q,[])),e=>e.code==='23514'&&e.message.includes('financial_journal_unbalanced'));
      await assert.rejects(db.transaction(q=>makeJournal(q,[['MERCHANT_PENDING','D',2],['MERCHANT_AVAILABLE','C',1]])),e=>e.code==='23514'&&e.message.includes('financial_journal_unbalanced'));
      await assert.rejects(db('financial_transactions').insert({merchant_id:merchant.id+999,event_key:`ORDER_COMPLETED:${fresh.id}`,fingerprint:'a'.repeat(64),kind:'ORDER_COMPLETED',order_id:fresh.id}),{code:'23514'});
      await assert.rejects(db('merchant_withdrawals').insert({id:uuid(),merchant_id:merchant.id,payout_account_id:account.id,idempotency_key:uuid(),fingerprint:'a'.repeat(64),amount_satang:-1}),{code:'23514'});
      await assert.rejects(db('merchant_withdrawals').where({id:withdrawal.id}).update({status:'REQUESTED',paid_at:null,paid_by_admin_id:null}),{code:'23514'});
      await complete(fresh,true);
    });
    await t.test('partial refunds before completion, after completion and concurrent cumulative cap',async()=>{
      const fresh=await paidOrder(), before=await finance.balances(merchant.id);
      await refund(fresh.id,{foodSatang:'20000',deliverySatang:'0',reason:'Before completion'},uuid());
      assert.equal(BigInt((await finance.balances(merchant.id)).PENDING),BigInt(before.PENDING)-19000n);
      await complete(fresh);
      const results=await Promise.allSettled([1,2].map(()=>refund(fresh.id,{foodSatang:'60000',deliverySatang:'0',reason:'Concurrent'},uuid())));
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      const totals=await db('finance_refunds').where({order_id:fresh.id}).sum('food_satang as n').first();assert.equal(totals.n,'80000');
    });
    await t.test('real session API auth, CSRF, IDOR, owner reauthentication and safe private proof',async()=>{
      const request=require('supertest'),bcrypt=require('bcryptjs');
      const {createApp}=require('../src/app.cjs'),{createAdminAuth}=require('../src/admin-auth.cjs'),{createMerchantStaffAuth}=require('../src/staff-auth.cjs');
      const apiPassword=`Test-${uuid()}`;
      const [apiOwner]=await db('platform_admins').insert({username:`finance_${uuid().slice(0,8)}`,full_name:'Isolated finance QA',role:'SUPER_ADMIN',password_hash:await bcrypt.hash(apiPassword,12)}).returning('*');
      const proofKey=`finance-proofs/2026/10/${uuid()}.png`;
      const proofStorage={put:async({namespace})=>{assert.equal(namespace,'finance-proofs');return {objectKey:proofKey};},read:async()=>({buffer:Buffer.from('image')})};
      const apiFinance=createFinanceService(db,{storage:proofStorage});
      const app=createApp({finance:apiFinance,storage:proofStorage,adminAuth:createAdminAuth({db,audit:require('../src/admin-audit.cjs').createAdminAudit(db)}),admins:{},staffAuth:createMerchantStaffAuth({db,config:{mode:'mock',devLoginEnabled:true}}),merchantOrders:merchants});
      await request(app).get('/api/finance/merchant').expect(401);
      const agent=request.agent(app),adminAgent=request.agent(app);
      await agent.post('/api/dev/merchant/auth/login').send({username:staff.MANAGER.username}).expect(200);
      const view=(await agent.get('/api/finance/merchant').expect(200)).body;
      assert.ok(!JSON.stringify(view).includes('9876543210'));assert.ok(!JSON.stringify(view).includes('encrypted_account'));
      await agent.post('/api/finance/merchant/settlement-mode').send({mode:'MANUAL_WITHDRAWAL'}).expect(403);
      await agent.post('/api/finance/merchant/settlement-mode').set('x-finance-csrf',view.csrf_token).send({mode:'MANUAL_WITHDRAWAL'}).expect(200);
      await agent.post(`/api/finance/merchant/withdrawals/${uuid()}/cancel`).set('x-finance-csrf',view.csrf_token).send({reason:'Wrong tenant'}).expect(404);
      const otherMerchant=await db('merchants').whereNot({id:merchant.id}).whereNull('deleted_at').first();
      const [otherManager]=await db('merchant_staffs').insert({merchant_id:otherMerchant.id,username:`other_${uuid().slice(0,8)}`,full_name:'Other QA',role:'MANAGER',password_hash:'DEV_ONLY_NO_PASSWORD_LOGIN'}).returning('*');
      const foreign=request.agent(app);await foreign.post('/api/dev/merchant/auth/login').send({username:otherManager.username}).expect(200);
      const foreignView=(await foreign.get('/api/finance/merchant').expect(200)).body;assert.equal(foreignView.withdrawals.length,0);
      await foreign.post(`/api/finance/merchant/withdrawals/${withdrawal.id}/cancel`).set('x-finance-csrf',foreignView.csrf_token).send({reason:'Wrong tenant'}).expect(404);
      for(const role of ['CASHIER','KITCHEN','RIDER']){const denied=request.agent(app);await denied.post('/api/dev/merchant/auth/login').send({username:staff[role].username}).expect(200);await denied.get('/api/finance/merchant').expect(403);}
      const session=(await adminAgent.post('/api/admin/auth/login').send({username:apiOwner.username,password:apiPassword}).expect(200)).body;
      await adminAgent.post('/api/finance/admin/reconcile').send({}).expect(403);
      const reveal=`/api/finance/admin/destinations/payout-accounts/${account.id}/reveal`;
      await adminAgent.post(reveal).set('x-csrf-token',session.csrf_token).send({password:'wrong'}).expect(401);
      const revealed=await adminAgent.post(reveal).set('x-csrf-token',session.csrf_token).send({password:apiPassword}).expect(200);
      assert.equal(revealed.body.identifier,'9876543210');assert.match(revealed.headers['cache-control'],/no-store/);
      await adminAgent.post('/api/finance/admin/proofs').set('x-csrf-token',session.csrf_token).attach('proof',Buffer.from('not an image'),{filename:'proof.png',contentType:'image/png'}).expect(422);
      const proof=await adminAgent.post('/api/finance/admin/proofs').set('x-csrf-token',session.csrf_token).attach('proof',Buffer.from('89504e470d0a1a0a','hex'),{filename:'original-name.png',contentType:'image/png'}).expect(201);
      assert.equal(proof.body.object_key,proofKey);assert.ok(!JSON.stringify(proof.body).includes('http'));
      const audit=JSON.stringify(await db('audit_logs').where({action:'FINANCE_DESTINATION_REVEALED'}));assert.ok(!audit.includes('9876543210'));assert.ok(!audit.includes(apiPassword));
      for(const role of ['FINANCE','ADMIN','SUPPORT']){
        const [a]=await db('platform_admins').insert({username:`f_${uuid().slice(0,8)}`,full_name:role,role,password_hash:apiOwner.password_hash}).returning('*');
        const other=request.agent(app),login=(await other.post('/api/admin/auth/login').send({username:a.username,password:apiPassword}).expect(200)).body;
        await other.get('/api/finance/admin').expect(role==='FINANCE'?200:403);
        await other.post(reveal).set('x-csrf-token',login.csrf_token).send({password:apiPassword}).expect(403);
      }
    });
    await t.test('successful AUTO_3_DAYS creates one normal request across concurrent workers',async()=>{
      const [m]=await db('merchants').insert({store_name:'Finance auto isolated',promptpay_identifier_type:'PHONE',promptpay_id:'0800000000',prefix:`A${uuid().slice(0,7)}`,phone:'0800000000',location_text:'Isolated',is_open:true}).returning('*');
      const [s]=await db('merchant_staffs').insert({merchant_id:m.id,username:`auto_${uuid().slice(0,7)}`,role:'MANAGER',full_name:'Auto',password_hash:'DEV_ONLY_NO_PASSWORD_LOGIN'}).returning('*');
      const [c]=await db('menu_categories').insert({merchant_id:m.id,name:'Auto'}).returning('*');
      const [i]=await db('menu_items').insert({merchant_id:m.id,category_id:c.id,name:'Auto food',price:'1000.00',is_available:true}).returning('*');
      await db('delivery_fees').insert({merchant_id:m.id,soi_id:address.soi_id,fee:'0.00'});
      const o=await orders.createOrder(customer.id,{...payload,merchantId:m.id,items:[{menuItemId:i.id,quantity:1}]});
      await payments.createAttempt(customer.id,o.id);await payments.uploadAndVerify(customer.id,o.id,{mimetype:'image/png',buffer:Buffer.from(uuid())},{});
      // Completion uses the same transactional hook; fulfillment API path is covered above.
      await db.transaction(async q=>{await finance.lockMerchant(q,m.id);await q('orders').where({id:o.id}).update({status:'COMPLETED',completed_at:q.fn.now()});await finance.orderEvent(q,o.id,'COMPLETED');});
      const a=await finance.saveAccount(s,{accountType:'BANK_ACCOUNT',bankCode:'004',identifier:'1231231234',accountName:'Synthetic auto'});await finance.verifyAccount(root,a.id);
      await db('merchants').where({id:m.id}).update({payout_account_changed_at:new Date(Date.now()-86401000)});
      await finance.setMode(s,'AUTO_3_DAYS');await Promise.all([finance.runScheduled(),finance.runScheduled()]);await finance.runScheduled();
      const requests=await db('merchant_withdrawals').where({merchant_id:m.id});assert.equal(requests.length,1);assert.equal(requests[0].status,'REQUESTED');assert.equal(requests[0].amount_satang,'95000');
      await finance.withdrawalAction(s,requests[0].id,'cancel',{reason:'End isolated test'});await finance.runScheduled();assert.equal((await db('merchant_withdrawals').where({merchant_id:m.id})).length,1);
      assert.equal((await finance.reconcile(root)).issues,0);
    });
    await finance.configure(root,{mode:'LEGACY_MERCHANT_DIRECT',confirm:true});
  } finally { await db.destroy(); }
});
