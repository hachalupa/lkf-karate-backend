"use strict";

const { createCoreController } = require("@strapi/strapi").factories;

module.exports = createCoreController(
  "api::exam-attempt.exam-attempt",
  ({ strapi }) => ({
    async find(ctx) {
      const user = ctx.state.user;
      if (!user) return ctx.unauthorized();
      const attempts = await strapi.db
        .query("api::exam-attempt.exam-attempt")
        .findMany({
          where: { user: user.id },
          populate: ["exam", "course"],
          orderBy: { createdAt: "desc" },
        });

      // Strip score data from unreleased exam results
      const sanitized = attempts.map((a) => {
        const isExam = !!a.exam;
        const showResults = isExam && a.exam?.showResults === true;
        if (!showResults && isExam) {
          const { score, passed, answers, questions, ...rest } = a;
          return { ...rest, score: null, passed: null, answers: null, questions: null };
        }
        return a;
      });

      return ctx.send({ data: sanitized });
    },

    async findOne(ctx) {
      const user = ctx.state.user;
      if (!user) return ctx.unauthorized();

      const { id } = ctx.params;

      const attempt = await strapi.db
        .query("api::exam-attempt.exam-attempt")
        .findOne({
          where: { id },
          populate: ["exam", "course", "user"],
        });

      if (!attempt) return ctx.notFound("Attempt not found");

      // Enforce ownership — users can only view their own attempts
      if (attempt.user?.id !== user.id) {
        return ctx.forbidden("You can only view your own attempts");
      }

      return ctx.send({ data: attempt });
    },

    async findAll(ctx) {
      const user = ctx.state.user;
      if (!user) return ctx.unauthorized();
      const adminUser = await strapi.db
        .query("plugin::users-permissions.user")
        .findOne({
          where: { id: user.id },
        });
      if (!adminUser?.isAdmin) return ctx.forbidden();
      const attempts = await strapi.db
        .query("api::exam-attempt.exam-attempt")
        .findMany({
          where: {},
          populate: ["exam", "course", "user"],
          orderBy: { createdAt: "desc" },
        });
      return ctx.send({ data: attempts });
    },

    async grade(ctx) {
      const user = ctx.state.user;
      if (!user) return ctx.unauthorized();

      const adminUser = await strapi.db
        .query("plugin::users-permissions.user")
        .findOne({
          where: { id: user.id },
        });

      if (!adminUser?.isAdmin) return ctx.forbidden();

      const { id } = ctx.params;
      const { score, passed } = ctx.request.body;

      const updated = await strapi.db
        .query("api::exam-attempt.exam-attempt")
        .update({
          where: { id },
          data: { score, passed },
        });

      return ctx.send({ data: updated });
    },
  }),
);
