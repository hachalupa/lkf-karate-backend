'use strict';

/**
 * exam-attempt service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::exam-attempt.exam-attempt');
