const express = require('express');
const crypto = require('node:crypto');
const multer = require('multer');
const { detectImage } = require('./slip-storage.cjs');
const { asyncRoute, HttpError, positiveId } = require('./http.cjs');

function createFinanceRouter({ finance, adminAuth, staffAuth, storage }) {
  const router = express.Router(), csrfTokens = new Map();
  router.use('/merchant', asyncRoute(async (req, res, next) => {
    const session = await staffAuth.authenticate(req);
    if (session.staff.role !== 'MANAGER') throw new HttpError(403, 'finance_manager_required');
    req.actor = session.staff;
    if (req.method === 'GET') {
      if (csrfTokens.size > 1000) csrfTokens.clear();
      if (!csrfTokens.has(session.token)) csrfTokens.set(session.token, crypto.randomBytes(32).toString('base64url'));
      req.financeCsrf = csrfTokens.get(session.token);
    } else if (!csrfTokens.has(session.token) || req.get('x-finance-csrf') !== csrfTokens.get(session.token)) throw new HttpError(403, 'finance_csrf_invalid');
    res.set('Cache-Control','no-store'); next();
  }));
  router.use('/admin', asyncRoute(async (req, res, next) => {
    const session = await adminAuth.authenticate(req, { csrf: req.method !== 'GET' });
    if (!['SUPER_ADMIN','FINANCE'].includes(session.admin.role)) throw new HttpError(403, 'finance_permission_denied');
    req.actor = session.admin; res.set('Cache-Control','no-store'); next();
  }));
  const key = req => req.get('idempotency-key');
  const reauth = async req => adminAuth.reauthenticateFinance(req.actor, req.body?.password);
  router.param('id',(req,_res,next,value)=>{
    if (!/^\d+$/.test(value) && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) return next(new HttpError(400,'invalid_finance_id'));
    next();
  });
  router.get('/merchant', asyncRoute(async (req,res) => res.json({ ...(await finance.merchantOverview(req.actor)), csrf_token: req.financeCsrf })));
  router.post('/merchant/payout-accounts', asyncRoute(async (req,res) => res.status(201).json(await finance.saveAccount(req.actor, req.body || {}))));
  router.post('/merchant/withdrawals', asyncRoute(async (req,res) => res.status(201).json(await finance.withdrawal(req.actor, req.body || {}, key(req)))));
  router.post('/merchant/withdrawals/:id/cancel', asyncRoute(async (req,res) => res.json(await finance.withdrawalAction(req.actor, req.params.id, 'cancel', req.body || {}))));
  router.post('/merchant/settlement-mode', asyncRoute(async (req,res) => res.json(await finance.setMode(req.actor, req.body?.mode))));
  router.post('/merchant/advertising', asyncRoute(async (req,res) => res.status(201).json(await finance.purchaseAd(req.actor, req.body || {}, key(req)))));
  router.post('/merchant/advertising/:id/cancel', asyncRoute(async (req,res) => res.json(await finance.adAction(req.actor, req.params.id, 'cancel', req.body?.reason))));
  router.get('/admin', asyncRoute(async (req,res) => res.json(await finance.adminOverview(req.actor))));
  if (storage) {
    const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:4194304,files:1,fields:0}}).single('proof');
    router.post('/admin/proofs', asyncRoute(async(req,_res,next)=>{if(req.actor.role!=='SUPER_ADMIN')throw new HttpError(403,'finance_owner_required');next();}), upload, asyncRoute(async(req,res)=>{
      if(!req.file || detectImage(req.file.buffer)?.contentType!==req.file.mimetype)throw new HttpError(422,'invalid_finance_proof');
      const result=await storage.put({buffer:req.file.buffer,contentType:req.file.mimetype,namespace:'finance-proofs'});
      res.status(201).json({object_key:result.objectKey});
    }));
  }
  router.post('/admin/configure', asyncRoute(async (req,res) => { await reauth(req); res.json(await finance.configure(req.actor, req.body || {})); }));
  router.post('/admin/destinations/:kind/:id/reveal',asyncRoute(async(req,res)=>{await reauth(req);res.json(await finance.revealDestination(req.actor,req.params.kind,req.params.id));}));
  router.post('/admin/payout-accounts/:id/verify', asyncRoute(async (req,res) => { await reauth(req); res.json(await finance.verifyAccount(req.actor, req.params.id)); }));
  router.post('/admin/withdrawals/:id/:action', asyncRoute(async (req,res) => {
    if (['paid','failed'].includes(req.params.action)) await reauth(req);
    res.json(await finance.withdrawalAction(req.actor, req.params.id, req.params.action, req.body || {}));
  }));
  router.post('/admin/orders/:id/refunds', asyncRoute(async (req,res) => { await reauth(req); res.status(201).json(await finance.refund(req.actor, positiveId(req.params.id), req.body || {}, key(req))); }));
  router.post('/admin/refunds/:id/:action', asyncRoute(async (req,res) => { await reauth(req); res.json(await finance.refundAction(req.actor, req.params.id, req.params.action, req.body || {})); }));
  router.post('/admin/advertising/:id/:action', asyncRoute(async (req,res) => res.json(await finance.adAction(req.actor, req.params.id, req.params.action, req.body?.reason))));
  router.post('/admin/reconcile', asyncRoute(async (req,res) => res.json(await finance.reconcile(req.actor))));
  return router;
}
module.exports = { createFinanceRouter };
