const express = require('express');
const { asyncRoute, HttpError, positiveId } = require('./http.cjs');
const multer = require('multer');
const { permit } = require('./merchant-management.cjs');
function createMerchantManagementRouter({ staffAuth, management }) {
  const router = express.Router();
  router.use(
    asyncRoute(async (req, _res, next) => {
      req.staff = (await staffAuth.authenticate(req)).staff;
      permit(req.staff, ['MANAGER', 'CASHIER', 'KITCHEN']);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        permit(req.staff);
        if (
          req.method !== 'DELETE' &&
          !req.path.startsWith('/images/') &&
          (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
        )
          throw new HttpError(400, 'invalid_request');
        if (req.get('X-Merchant-Request') !== '1')
          throw new HttpError(403, 'merchant_request_header_required');
      }
      next();
    }),
  );
  router.get(
    '/dashboard',
    asyncRoute(async (req, res) => res.json(await management.dashboard(req.staff))),
  );
  router.get(
    '/store',
    asyncRoute(async (req, res) => res.json(await management.store(req.staff))),
  );
  router.patch(
    '/store',
    asyncRoute(async (req, res) => res.json(await management.saveStore(req.staff, req.body))),
  );
  router.put(
    '/store/hours',
    asyncRoute(async (req, res) => res.json(await management.saveHours(req.staff, req.body))),
  );
  router.post(
    '/images/:namespace',
    multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
    }).single('image'),
    asyncRoute(async (req, res) =>
      res.status(201).json(await management.upload(req.staff, req.params.namespace, req.file)),
    ),
  );
  router.post(
    '/store/gallery',
    asyncRoute(async (req, res) => res.status(201).json(await management.gallery(req.staff, null, req.body))),
  );
  router.patch(
    '/store/gallery/:id',
    asyncRoute(async (req, res) =>
      res.json(await management.gallery(req.staff, positiveId(req.params.id), req.body)),
    ),
  );
  router.delete(
    '/store/gallery/:id',
    asyncRoute(async (req, res) =>
      res.json(await management.gallery(req.staff, positiveId(req.params.id), {}, true)),
    ),
  );
  router.get(
    '/categories',
    asyncRoute(async (req, res) => res.json(await management.categories(req.staff, req.query))),
  );
  router.post(
    '/categories',
    asyncRoute(async (req, res) =>
      res.status(201).json(await management.saveCategory(req.staff, null, req.body)),
    ),
  );
  router.patch(
    '/categories/:id',
    asyncRoute(async (req, res) =>
      res.json(await management.saveCategory(req.staff, positiveId(req.params.id), req.body)),
    ),
  );
  router.delete(
    '/categories/:id',
    asyncRoute(async (req, res) =>
      res.json(await management.saveCategory(req.staff, positiveId(req.params.id), {}, true)),
    ),
  );
  router.get(
    '/menu',
    asyncRoute(async (req, res) => res.json(await management.menu(req.staff, req.query))),
  );
  router.get(
    '/menu/:id',
    asyncRoute(async (req, res) =>
      res.json(await management.menuDetail(req.staff, positiveId(req.params.id))),
    ),
  );
  router.post(
    '/menu',
    asyncRoute(async (req, res) =>
      res.status(201).json(await management.saveMenu(req.staff, null, req.body)),
    ),
  );
  router.patch(
    '/menu/:id',
    asyncRoute(async (req, res) =>
      res.json(await management.saveMenu(req.staff, positiveId(req.params.id), req.body)),
    ),
  );
  router.delete(
    '/menu/:id',
    asyncRoute(async (req, res) =>
      res.json(await management.saveMenu(req.staff, positiveId(req.params.id), {}, true)),
    ),
  );
  router.post(
    '/menu/:itemId/groups',
    asyncRoute(async (req, res) =>
      res
        .status(201)
        .json(await management.optionGroup(req.staff, positiveId(req.params.itemId), null, req.body)),
    ),
  );
  router.patch(
    '/menu/:itemId/groups/:id',
    asyncRoute(async (req, res) =>
      res.json(
        await management.optionGroup(
          req.staff,
          positiveId(req.params.itemId),
          positiveId(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  router.delete(
    '/menu/:itemId/groups/:id',
    asyncRoute(async (req, res) =>
      res.json(
        await management.optionGroup(
          req.staff,
          positiveId(req.params.itemId),
          positiveId(req.params.id),
          {},
          true,
        ),
      ),
    ),
  );
  router.post(
    '/menu/:itemId/groups/:groupId/choices',
    asyncRoute(async (req, res) =>
      res
        .status(201)
        .json(
          await management.optionChoice(
            req.staff,
            positiveId(req.params.itemId),
            positiveId(req.params.groupId),
            null,
            req.body,
          ),
        ),
    ),
  );
  router.patch(
    '/menu/:itemId/groups/:groupId/choices/:id',
    asyncRoute(async (req, res) =>
      res.json(
        await management.optionChoice(
          req.staff,
          positiveId(req.params.itemId),
          positiveId(req.params.groupId),
          positiveId(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  router.delete(
    '/menu/:itemId/groups/:groupId/choices/:id',
    asyncRoute(async (req, res) =>
      res.json(
        await management.optionChoice(
          req.staff,
          positiveId(req.params.itemId),
          positiveId(req.params.groupId),
          positiveId(req.params.id),
          {},
          true,
        ),
      ),
    ),
  );
  router.get(
    '/delivery-fees',
    asyncRoute(async (req, res) => res.json(await management.fees(req.staff, req.query))),
  );
  router.put(
    '/delivery-fees/:id',
    asyncRoute(async (req, res) =>
      res.json(await management.saveFee(req.staff, positiveId(req.params.id), req.body)),
    ),
  );
  router.get(
    '/staff',
    asyncRoute(async (req, res) => res.json(await management.staffList(req.staff, req.query))),
  );
  router.post(
    '/staff',
    asyncRoute(async (req, res) =>
      res.status(201).json(await management.saveStaff(req.staff, null, req.body)),
    ),
  );
  router.patch(
    '/staff/:id',
    asyncRoute(async (req, res) =>
      res.json(await management.saveStaff(req.staff, positiveId(req.params.id), req.body)),
    ),
  );
  router.get(
    '/riders',
    asyncRoute(async (req, res) => res.json(await management.riders(req.staff, req.query))),
  );
  router.get(
    '/riders/:id/history',
    asyncRoute(async (req, res) =>
      res.json(await management.riderHistory(req.staff, positiveId(req.params.id), req.query)),
    ),
  );
  router.get(
    '/history',
    asyncRoute(async (req, res) => res.json(await management.history(req.staff, req.query))),
  );
  router.get(
    '/reports',
    asyncRoute(async (req, res) => res.json(await management.reports(req.staff, req.query))),
  );
  router.get(
    '/promotions',
    asyncRoute(async (req, res) => res.json(await management.promotions(req.staff, req.query))),
  );
  router.get(
    '/reviews',
    asyncRoute(async (req, res) => res.json(await management.reviews(req.staff, req.query))),
  );
  router.get(
    '/banners',
    asyncRoute(async (req, res) => res.json(await management.banners(req.staff, req.query))),
  );
  router.get(
    '/banners/:id/image',
    asyncRoute(async (req, res) => {
      const image = await management.bannerImage(req.staff, positiveId(req.params.id));
      res.set({ 'Content-Type': image.contentType, 'Cache-Control': 'private, no-store' }).send(image.buffer);
    }),
  );
  return router;
}
module.exports = { createMerchantManagementRouter };
