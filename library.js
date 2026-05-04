'use strict';

const routeHelpers = require.main.require('./src/routes/helpers');
const partner = require('./lib/partner');

const plugin = {};

function asyncRoute(fn) {
  return function routeHandler(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function json(res, payload) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.json(payload);
}

plugin.init = async ({ router, middleware }) => {
  routeHelpers.setupPageRoute(router, '/partners', [], (req, res) => {
    res.render('peipe-partners', { uid: req.uid || 0 });
  });

  routeHelpers.setupPageRoute(router, '/nearby', [], (req, res) => {
    res.render('peipe-nearby', { uid: req.uid || 0 });
  });

  router.get('/api/peipe-partners', asyncRoute(async (req, res) => {
    json(res, await partner.list(req));
  }));

  router.get('/api/peipe-partners/options', asyncRoute(async (req, res) => {
    json(res, await partner.options());
  }));

  router.get('/api/peipe-partners/me/profile-status', middleware.ensureLoggedIn, asyncRoute(async (req, res) => {
    json(res, await partner.profileStatus(req.uid));
  }));

  router.put('/api/peipe-partners/me/profile', middleware.ensureLoggedIn, asyncRoute(async (req, res) => {
    json(res, await partner.saveProfile(req.uid, req.body || {}));
  }));

  router.put('/api/peipe-partners/location', middleware.ensureLoggedIn, asyncRoute(async (req, res) => {
    json(res, await partner.saveLocation(req.uid, req.body || {}));
  }));

  router.post('/api/peipe-partners/me/chatted', middleware.ensureLoggedIn, asyncRoute(async (req, res) => {
    json(res, await partner.markChatted(req.uid, req.body || {}));
  }));

  router.post('/api/peipe-partners/me/greet', middleware.ensureLoggedIn, asyncRoute(async (req, res) => {
    json(res, await partner.greet(req.uid, req.body || {}));
  }));
};

plugin.addRoutes = async ({ router, middleware, helpers }) => {
  routeHelpers.setupApiRoute(router, 'get', '/peipe-partners', [], async (req, res) => {
    helpers.formatApiResponse(200, res, await partner.list(req));
  });

  routeHelpers.setupApiRoute(router, 'get', '/peipe-partners/options', [], async (req, res) => {
    helpers.formatApiResponse(200, res, await partner.options());
  });

  routeHelpers.setupApiRoute(router, 'get', '/peipe-partners/me/profile-status', [middleware.ensureLoggedIn], async (req, res) => {
    helpers.formatApiResponse(200, res, await partner.profileStatus(req.uid));
  });

  routeHelpers.setupApiRoute(router, 'put', '/peipe-partners/me/profile', [middleware.ensureLoggedIn], async (req, res) => {
    helpers.formatApiResponse(200, res, await partner.saveProfile(req.uid, req.body || {}));
  });

  routeHelpers.setupApiRoute(router, 'put', '/peipe-partners/location', [middleware.ensureLoggedIn], async (req, res) => {
    helpers.formatApiResponse(200, res, await partner.saveLocation(req.uid, req.body || {}));
  });

  routeHelpers.setupApiRoute(router, 'post', '/peipe-partners/me/chatted', [middleware.ensureLoggedIn], async (req, res) => {
    helpers.formatApiResponse(200, res, await partner.markChatted(req.uid, req.body || {}));
  });

  routeHelpers.setupApiRoute(router, 'post', '/peipe-partners/me/greet', [middleware.ensureLoggedIn], async (req, res) => {
    helpers.formatApiResponse(200, res, await partner.greet(req.uid, req.body || {}));
  });
};

module.exports = plugin;
