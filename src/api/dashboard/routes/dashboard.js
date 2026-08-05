// api/dashboard/routes/dashboard.js
'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/dashboard',
      handler: 'dashboard.user',
      config: { policies: [], middlewares: [] },
    },
  ],
}