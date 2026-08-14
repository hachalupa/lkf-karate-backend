'use strict';

/**
 * chapter service
 */

const { createCoreService } = require('@strapi/strapi').factories;
const { normalizeRelations } = require('../../../utils/normalize-relations');

const RELATION_FIELDS = {
  course: 'api::course.course',
};

module.exports = createCoreService('api::chapter.chapter', ({ strapi }) => ({
  async create(params) {
    params.data = await normalizeRelations(strapi, params.data, RELATION_FIELDS);
    return super.create(params);
  },

  async update(documentId, params) {
    params.data = await normalizeRelations(strapi, params.data, RELATION_FIELDS);
    return super.update(documentId, params);
  },
}));
