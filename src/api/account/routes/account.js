'use strict'

module.exports = {
  routes: [
    {
      method: 'DELETE',
      path: '/account/delete',
      handler: 'account.deleteAccount',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
}
