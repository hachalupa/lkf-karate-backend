'use strict'

/**
 * Authorization regression guard — the Phase 0 student-write hole.
 *
 * Background: until 2026-10-12 the `authenticated` role held `create`/`update`/
 * `delete` on courses, chapters, questions and exams, so any approved student could
 * `DELETE /api/courses/:documentId` from devtools (roadmap §0.2, audit §0.5). The fix
 * is a `global::is-admin` policy attached to every write route of the six catalogue
 * content types; the grants stay in place, because admins and students share the
 * single `authenticated` role (see `src/policies/is-admin.js`).
 *
 * That fix is easy to undo by accident: add a route without the policy, grant a new
 * action, or reset the permissions table and forget the bootstrap. This script is the
 * tripwire.
 *
 * It is **read-only** — it boots Strapi in-process (the way the seed scripts do),
 * inspects the loaded route table and the permission rows, and exits non-zero on any
 * violation. No server, no HTTP, no accounts, no writes; safe to run at any time,
 * against any database.
 *
 * Usage:
 *   cd backend
 *   npm run check:authz                        # the guard + the self-test below
 *   node ./scripts/check-authz.js              # the checks only (faster to read)
 *   node ./scripts/check-authz.js --self-test  # checks + proof that each one can fail
 *
 * `--self-test` mutates a throwaway in-memory copy of the route/ grant data — one
 * invariant at a time — and asserts that the matching check turns red. A guard whose
 * checks cannot fail (a renamed action, a route the introspection stopped seeing) is
 * worse than no guard, because it reports safety it never verified. If the self-test
 * fails, the guard is broken; fix the guard, not the self-test.
 *
 * A failing check is labelled `security`, `grants` or `guard-integrity`, so a red run says
 * whether the hole is open, a grant went missing, or the guard itself needs fixing.
 *
 * This is a check script, not a test runner — the project still has no backend test
 * framework (AGENTS.md §3). Extend it rather than adding one.
 */

const ADMIN_POLICY = 'global::is-admin'
const POLICY_FILE = '../src/policies/is-admin.js'

// The catalogue content types a student must never write to directly.
const CATALOGUE_APIS = ['course', 'chapter', 'question', 'exam', 'seminar', 'competition']
const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

// Only the plugin `content-api` routers are in scope: the plugins' `admin` routers sit
// behind the admin JWT and `admin::hasPermissions`, which the `public`/`authenticated`
// roles this guard reasons about can never reach.
const CONTENT_API_ROUTER = 'content-api'

const OWNER_SCOPED_AUTH = 'own account/session only — the users-permissions auth surface'

// Routes whose writes stay open to `authenticated` on purpose: either student-owned (the
// controller scopes the write to `ctx.state.user`) or re-checked against `isAdmin` in the
// controller. Anything NOT listed here must carry the admin policy, or the check fails.
//
// This list is the one place where the guard can be talked out of a finding, so the way out
// is narrow: `exceptions-not-catalogue-writes` fails if a *catalogue* write is excused here
// instead of gated on its route. An exception is only ever acceptable for a route whose
// write is scoped to the caller by the controller itself.
const MUTATING_EXCEPTIONS = {
  'api::exam-attempt.exam-attempt.create': 'attempt is created for ctx.state.user',
  'api::exam-attempt.exam-attempt.update': 'attempt is scoped to ctx.state.user',
  'api::exam-attempt.exam-attempt.grade': 'controller asserts isAdmin',
  'api::exam-attempt.exam-attempt.findAll': 'controller asserts isAdmin (admin-only read)',
  'api::exam-attempt.exam-attempt.monitoring': 'controller asserts isAdmin (admin-only read)',
  'api::chapter-progress.chapter-progress.markSeen': 'writes progress for ctx.state.user only',
  'api::exam-session.exam-session.start': 'student exam flow, ownership in the controller',
  'api::exam-session.exam-session.submit': 'student exam flow, ownership in the controller',
  'api::exam-session.exam-session.saveProgress': 'student exam flow, ownership in the controller',
  'api::exam-session.exam-session.quickQuiz': 'self-study tool (AGENTS.md §5.4)',
  'api::question.question.bulkUpdateAnswers':
    'route is policy-gated and the controller asserts isAdmin — kept here so dropping the route config still leaves a reviewable note',
  'plugin::upload.content-api.upload': 'students upload their own media/profile picture',
  'plugin::upload.content-api.destroy':
    'KNOWN GAP — a student can delete any media file by id; not yet fixed (recorded in the roadmap)',
  'plugin::users-permissions.user.update': 'own profile only — enforced by the users-permissions extension',
  'plugin::users-permissions.auth.callback': OWNER_SCOPED_AUTH,
  'plugin::users-permissions.auth.register': OWNER_SCOPED_AUTH,
  'plugin::users-permissions.auth.forgotPassword': OWNER_SCOPED_AUTH,
  'plugin::users-permissions.auth.resetPassword': OWNER_SCOPED_AUTH,
  'plugin::users-permissions.auth.sendEmailConfirmation': OWNER_SCOPED_AUTH,
  'plugin::users-permissions.auth.changePassword': OWNER_SCOPED_AUTH,
  'plugin::users-permissions.auth.refresh': OWNER_SCOPED_AUTH,
  'plugin::users-permissions.auth.logout': OWNER_SCOPED_AUTH,
}

// Actions the permission layer can decide about that no loaded route reaches. The grant
// is real (a Strapi default) but inert, because these collections use an explicit route
// list. Listed by name so a *new* unmapped action — a renamed handler, a route whose
// scope drifted — fails the gate instead of hiding inside a count threshold.
const UNROUTED_ACTIONS = {
  'api::exam-attempt.exam-attempt.create':
    'service method only — the explicit route list exposes find/findAll/monitoring/findOne/grade; attempts are created by POST /exams/start',
  'api::exam-attempt.exam-attempt.update': 'service method only — see above',
  'api::chapter-progress.chapter-progress.findOne': 'explicit route list exposes only find + mark-seen',
  'api::chapter-progress.chapter-progress.create': 'explicit route list exposes only find + mark-seen',
  'api::chapter-progress.chapter-progress.update': 'explicit route list exposes only find + mark-seen',
}

// Public (guest) role: reads are an allow-list, writes are auth endpoints only.
const PUBLIC_READ_ALLOWLIST = [
  'api::chapter.chapter.find',
  'api::chapter.chapter.findOne',
  'api::competition.competition.find',
  'api::competition.competition.findOne',
  'api::course.course.find',
  'api::course.course.findOne',
]
const AUTH_ENDPOINT_PREFIX = 'plugin::users-permissions.auth.'

// Grants the app needs at runtime; they come from the bootstrap in src/index.js, so a
// fresh or reset database depends on them being re-created on boot.
const REQUIRED_AUTHENTICATED_GRANTS = [
  'api::seminar.seminar.find',
  'api::seminar.seminar.findOne',
  'api::competition.competition.find',
  'api::competition.competition.findOne',
  'api::seminar.seminar.create',
  'api::seminar.seminar.update',
  'api::seminar.seminar.delete',
  'api::competition.competition.create',
  'api::competition.competition.update',
  'api::competition.competition.delete',
]
const REQUIRED_PUBLIC_GRANTS = ['api::competition.competition.find', 'api::competition.competition.findOne']

// A red run has to be actionable, so each failing check is labelled with what it means:
// an open hole, a grant the app needs that went missing, or a guard that cannot see the
// whole picture (the only case where a green run elsewhere is not evidence of anything).
const SECURITY_CHECKS = ['catalogue-write-policy', 'mutating-grant-gated', 'exceptions-not-catalogue-writes', 'public-write']
const INTEGRITY_CHECKS = ['route-discovery', 'plugin-route-discovery', 'plugin-route-scopes', 'grant-route-alignment']
const FAILURE_KINDS = {
  security: 'an authorization hole — the student-write hole is open again (ROADMAP.md §0.2)',
  grants: 'a grant the app depends on changed — fix the bootstrap or the permission row',
  'guard-integrity': 'the guard is blind, not the API — fix the guard before trusting any green run',
}
function failureKind(id) {
  if (id.startsWith('selftest-')) return 'guard-integrity'
  if (id.startsWith('policy-') || SECURITY_CHECKS.includes(id)) return 'security'
  if (INTEGRITY_CHECKS.includes(id)) return 'guard-integrity'
  return 'grants'
}

const SECTION_ROUTES = '1. Write routes on the six catalogue types'
const SECTION_GRANTS = '2. Grants held by the roles'
const SECTION_REQUIRED = '3. Required grants (re-created by the bootstrap on every boot)'
const SECTION_POLICY = '4. The policy implementation'
const SECTION_SELF_TEST = '5. Self-test — every check can fail'

/**
 * The permission action a route is checked against.
 *
 * `config.auth.scope` is authoritative — it is literally what the users-permissions
 * strategy tests the caller's ability against. Reconstructing it from the handler is
 * only a fallback, and an explicit route list (`handler: 'question.create'`) does not
 * carry the `api::` prefix, so a naive `${apiName}.${handler}` produces
 * `question.question.create` and would silently match nothing.
 */
function actionsOf(route) {
  const scopes = route.auth?.scope
  if (Array.isArray(scopes) && scopes.length) return scopes
  if (!route.handler) return []
  return route.handler.startsWith('api::') ? [route.handler] : [`api::${route.apiName}.${route.handler}`]
}

/** Router definitions are either an array of routes or `{ routes: [...] }`. */
function normalizeRoutes(definition, fallbackApiName, routerName) {
  const list = Array.isArray(definition)
    ? definition
    : Array.isArray(definition?.routes)
      ? definition.routes
      : []
  return list.map((route) => ({
    apiName: route.info?.apiName || fallbackApiName,
    routerName,
    method: String(route.method).toUpperCase(),
    path: route.path,
    handler: route.handler,
    policies: (route.config?.policies || []).map((p) => (typeof p === 'string' ? p : p?.name)).filter(Boolean),
    auth: route.config?.auth,
    // Kept raw as well as parsed: a route without a scope drops out of the method map,
    // and that has to be reported rather than inferred from the fallback below.
    scope: Array.isArray(route.config?.auth?.scope) ? route.config.auth.scope : null,
  }))
}

/** Every API route the app actually loaded, with its api name and router. */
function collectApiRoutes(strapi) {
  const routes = []
  for (const apiName of Object.keys(strapi.apis)) {
    const byRouter = strapi.apis[apiName]?.routes || {}
    for (const [routerName, definition] of Object.entries(byRouter)) {
      routes.push(...normalizeRoutes(definition, apiName, routerName))
    }
  }
  return routes
}

/**
 * The plugins' content-api routes. They matter for two reasons: an action with no route
 * cannot be abused over REST, so `methodByAction` must not claim the plugin actions are
 * unmapped; and the public-write check would silently pass for a `plugin::` grant if the
 * plugin routers were not loaded at all.
 */
function collectPluginRoutes(strapi) {
  const routes = []
  for (const pluginName of Object.keys(strapi.plugins)) {
    const byRouter = strapi.plugins[pluginName]?.routes || {}
    for (const [routerName, definition] of Object.entries(byRouter)) {
      if (routerName !== CONTENT_API_ROUTER) continue
      routes.push(...normalizeRoutes(definition, `plugin::${pluginName}`, routerName))
    }
  }
  return routes
}

/** The checks. Pure: everything they need is passed in, so the self-test can feed them lies. */
function buildChecks({ routes, pluginRoutes, byRole, mutationExceptions = MUTATING_EXCEPTIONS }) {
  const add = (section, id, name, pass, detail = '') => ({ section, id, name, pass, detail })
  const checks = []

  // ── 1. write routes on the six catalogue types ──────────────────────────────
  const catalogueRoutes = routes.filter((r) => CATALOGUE_APIS.includes(r.apiName))
  const catalogueWrites = catalogueRoutes.filter((r) => MUTATING_METHODS.includes(r.method))
  const missingPolicy = catalogueWrites
    .filter((r) => !r.policies.includes(ADMIN_POLICY))
    .map((r) => `${r.method} ${r.path} (${r.handler})`)
  const gatedReads = catalogueRoutes
    .filter((r) => !MUTATING_METHODS.includes(r.method) && r.policies.includes(ADMIN_POLICY))
    .map((r) => `${r.method} ${r.path}`)

  const pluginRoutesWithoutScope = pluginRoutes
    .filter((r) => !r.scope?.length)
    .map((r) => `${r.method} ${r.path}`)

  // Without this the "0 of 0 writes are gated" result below would read as a pass.
  checks.push(
    add(
      SECTION_ROUTES,
      'route-discovery',
      `catalogue routes discovered (${catalogueRoutes.length}, ${catalogueWrites.length} of them writes)`,
      catalogueRoutes.length > 0,
      catalogueRoutes.length ? CATALOGUE_APIS.join(', ') : 'found 0 catalogue routes — the introspection is wrong, not the API',
    ),
  )
  checks.push(
    add(
      SECTION_ROUTES,
      'plugin-route-discovery',
      `plugin content-api routes discovered (${pluginRoutes.length})`,
      pluginRoutes.length > 0,
      pluginRoutes.length
        ? 'used to map plugin grants to their method and to look for public writes'
        : 'found 0 plugin routes — the public-write check below would pass vacuously',
    ),
  )
  checks.push(
    add(
      SECTION_ROUTES,
      'plugin-route-scopes',
      'every plugin content-api route declares its scope',
      pluginRoutesWithoutScope.length === 0,
      pluginRoutesWithoutScope.length
        ? `no scope, so its grant cannot be mapped to a method: ${pluginRoutesWithoutScope.join(', ')}`
        : 'all plugin routes carry config.auth.scope',
    ),
  )
  checks.push(
    add(
      SECTION_ROUTES,
      'catalogue-write-policy',
      `all ${catalogueWrites.length} catalogue write routes are policy-gated`,
      missingPolicy.length === 0,
      missingPolicy.length ? `ungated: ${missingPolicy.join(', ')}` : `policy: ${ADMIN_POLICY}`,
    ),
  )
  checks.push(
    add(
      SECTION_ROUTES,
      'catalogue-reads-open',
      'catalogue read routes stay open to students',
      gatedReads.length === 0,
      gatedReads.length ? `unexpectedly gated: ${gatedReads.join(', ')}` : 'no GET route carries the admin policy',
    ),
  )

  // ── 2. grants held by the roles ─────────────────────────────────────────────
  const gatedActions = new Set(catalogueWrites.filter((r) => r.policies.includes(ADMIN_POLICY)).flatMap(actionsOf))
  // Every action the permission layer can be asked about, mapped to its method.
  const methodByAction = new Map()
  for (const route of [...routes, ...pluginRoutes]) {
    for (const action of actionsOf(route)) {
      if (!methodByAction.has(action) || MUTATING_METHODS.includes(route.method)) {
        methodByAction.set(action, route.method)
      }
    }
  }

  const authenticated = byRole.authenticated
  const publicRole = byRole.public

  checks.push(
    add(
      SECTION_GRANTS,
      'permission-rows-loaded',
      'permission rows loaded',
      authenticated.length + publicRole.length > 0,
      `${authenticated.length} authenticated, ${publicRole.length} public`,
    ),
  )

  // Smoke test of the mapping itself: if the action names stop lining up with the loaded
  // routes, every grant would look harmless and this whole section would pass for the
  // wrong reason.
  const unmapped = authenticated.filter((a) => !methodByAction.has(a))
  const undocumented = unmapped.filter((a) => !UNROUTED_ACTIONS[a])
  checks.push(
    add(
      SECTION_GRANTS,
      'grant-route-alignment',
      'every authenticated grant resolves to a loaded route or a documented unrouted action',
      undocumented.length === 0,
      undocumented.length
        ? `no route and no entry in UNROUTED_ACTIONS: ${undocumented.join(', ')}`
        : `${methodByAction.size} actions mapped, ${unmapped.length} known-unrouted`,
    ),
  )

  const unexpected = authenticated.filter((action) => {
    if (mutationExceptions[action]) return false
    if (gatedActions.has(action)) return false
    return MUTATING_METHODS.includes(methodByAction.get(action))
  })
  // Exceptions that excuse nothing in *this* database are reported, not failed: a fresh or
  // reset database legitimately holds a much smaller grant set, and crying wolf there is
  // how a guard gets switched off.
  const unusedExceptions = Object.keys(mutationExceptions).filter(
    (action) => !authenticated.includes(action) && !gatedActions.has(action),
  )
  checks.push(
    add(
      SECTION_GRANTS,
      'mutating-grant-gated',
      'every mutating grant is policy-gated or a documented exception',
      unexpected.length === 0,
      unexpected.length
        ? `new broad grant(s): ${unexpected.join(', ')} — attach '${ADMIN_POLICY}' to the route, or add it to MUTATING_EXCEPTIONS with a reason`
        : `${authenticated.length} grants inspected, ${Object.keys(mutationExceptions).length} documented exceptions` +
          (unusedExceptions.length ? ` (${unusedExceptions.length} not present in this database)` : ''),
    ),
  )

  // The list is the only way to talk the guard out of a finding, so the exit is narrow: a
  // catalogue write must be gated on its route, never excused by name here.
  const excusedCatalogueWrites = Object.keys(mutationExceptions).filter(
    (action) =>
      CATALOGUE_APIS.some((api) => action.startsWith(`api::${api}.`)) && !gatedActions.has(action),
  )
  checks.push(
    add(
      SECTION_GRANTS,
      'exceptions-not-catalogue-writes',
      'no catalogue write is excused by name instead of gated on its route',
      excusedCatalogueWrites.length === 0,
      excusedCatalogueWrites.length
        ? `excused: ${excusedCatalogueWrites.join(', ')} — remove them from MUTATING_EXCEPTIONS and attach '${ADMIN_POLICY}' to the route`
        : `checked ${Object.keys(mutationExceptions).length} exceptions`,
    ),
  )

  const publicWrites = publicRole.filter(
    (action) => MUTATING_METHODS.includes(methodByAction.get(action)) && !action.startsWith(AUTH_ENDPOINT_PREFIX),
  )
  checks.push(
    add(
      SECTION_GRANTS,
      'public-write',
      'the public role holds no write outside the auth endpoints',
      publicWrites.length === 0,
      publicWrites.length ? `public writes: ${publicWrites.join(', ')}` : 'guests can only register/log-in',
    ),
  )

  const publicExtraReads = publicRole.filter(
    (action) => !PUBLIC_READ_ALLOWLIST.includes(action) && !action.startsWith(AUTH_ENDPOINT_PREFIX),
  )
  checks.push(
    add(
      SECTION_GRANTS,
      'public-read-allowlist',
      'the public role reads only the allow-listed catalogue types',
      publicExtraReads.length === 0,
      publicExtraReads.length
        ? `new public read: ${publicExtraReads.join(', ')} — confirm it exposes nothing students must not see`
        : PUBLIC_READ_ALLOWLIST.join(', '),
    ),
  )

  // ── 3. the grants the bootstrap must keep in place ──────────────────────────
  const missingAuth = REQUIRED_AUTHENTICATED_GRANTS.filter((a) => !authenticated.includes(a))
  checks.push(
    add(
      SECTION_REQUIRED,
      'required-authenticated-grants',
      'authenticated can read and write seminars + competitions',
      missingAuth.length === 0,
      missingAuth.length ? `missing: ${missingAuth.join(', ')}` : `${REQUIRED_AUTHENTICATED_GRANTS.length} grants present`,
    ),
  )
  const missingPublic = REQUIRED_PUBLIC_GRANTS.filter((a) => !publicRole.includes(a))
  checks.push(
    add(
      SECTION_REQUIRED,
      'required-public-grants',
      'guests can still read competitions',
      missingPublic.length === 0,
      missingPublic.length ? `missing: ${missingPublic.join(', ')}` : 'landing calendar keeps working',
    ),
  )
  const guestSeminars = publicRole.filter((a) => a.startsWith('api::seminar.seminar.'))
  checks.push(
    add(
      SECTION_REQUIRED,
      'seminars-not-public',
      'seminars stay off the public role (judges-only by design)',
      guestSeminars.length === 0,
      guestSeminars.length ? `public got: ${guestSeminars.join(', ')}` : 'no public seminar grants',
    ),
  )

  return checks
}

/**
 * ── 4. the policy itself ──────────────────────────────────────────────────────
 * Asserted directly, with fabricated `ctx` objects: no caller, a forged `isAdmin` in the
 * body, an id that does not exist, and a real admin. The DB lookup is stubbed, so this
 * measures the policy's decisions, not the database's contents.
 */
async function policyChecks() {
  const add = (id, name, pass, detail = '') => ({ section: SECTION_POLICY, id, name, pass, detail })
  const policy = require(POLICY_FILE)

  const callPolicy = async ({ user, record, body }) => {
    const seen = []
    const fakeStrapi = {
      db: {
        query: () => ({
          findOne: async (args) => {
            seen.push(args)
            return record
          },
        }),
      },
    }
    const ctx = { state: { user }, request: { body: body ?? {}, query: {} } }
    try {
      return { ok: true, value: await policy(ctx, {}, { strapi: fakeStrapi }), seen }
    } catch (error) {
      return { ok: false, name: error.name, seen }
    }
  }

  const checks = []
  const noUser = await callPolicy({ user: null })
  checks.push(add('policy-no-caller', 'no caller → rejected', !noUser.ok && noUser.name === 'UnauthorizedError', noUser.name || 'returned a value'))

  const student = await callPolicy({
    user: { id: 4242 },
    record: { id: 4242, isAdmin: false },
    // A forged flag in the payload must change nothing (§5.5).
    body: { isAdmin: true },
  })
  checks.push(
    add(
      'policy-forged-flag',
      'non-admin → rejected even with isAdmin in the request body',
      !student.ok && student.name === 'ForbiddenError',
      student.ok ? 'ALLOWED a non-admin' : student.name,
    ),
  )
  const lookedUp = student.seen[0]?.where?.id
  checks.push(
    add('policy-caller-id', 'the flag is looked up for the caller id from ctx.state.user', lookedUp === 4242, `where.id = ${JSON.stringify(lookedUp)}`),
  )
  const selectsFlag = (student.seen[0]?.select || []).includes('isAdmin')
  checks.push(add('policy-selects-flag', 'the query actually selects isAdmin', selectsFlag, `select = ${JSON.stringify(student.seen[0]?.select)}`))

  const unknownUser = await callPolicy({ user: { id: 999 }, record: undefined })
  checks.push(
    add('policy-unknown-user', 'unknown user → rejected (fails closed)', !unknownUser.ok && unknownUser.name === 'ForbiddenError', unknownUser.ok ? 'ALLOWED an unknown user' : unknownUser.name),
  )

  const admin = await callPolicy({ user: { id: 1 }, record: { id: 1, isAdmin: true } })
  checks.push(add('policy-admin-allowed', 'admin → allowed', admin.ok && !!admin.value, admin.ok ? `returned ${String(admin.value)}` : admin.name))

  return checks
}

/**
 * ── 5. the self-test ─────────────────────────────────────────────────────────
 * Each entry breaks exactly one invariant in a throwaway copy of the loaded data and
 * names the check that must notice. Nothing is written anywhere: this is the same
 * reasoning the guard does, fed deliberately wrong input.
 */
const SELF_TESTS = [
  {
    name: 'a new catalogue write route without the policy',
    expect: 'catalogue-write-policy',
    mutate: (fixture) =>
      fixture.routes.push({
        apiName: 'course',
        routerName: 'content-api',
        method: 'POST',
        path: '/courses',
        handler: 'api::course.course.create',
        policies: [],
        auth: { scope: ['api::course.course.create'] },
      }),
  },
  {
    name: 'the admin policy creeping onto a catalogue read route',
    expect: 'catalogue-reads-open',
    mutate: (fixture) => {
      const read = fixture.routes.find((r) => CATALOGUE_APIS.includes(r.apiName) && r.method === 'GET')
      read.policies.push(ADMIN_POLICY)
    },
  },
  {
    name: 'a new ungated write grant on a new content type',
    expect: 'mutating-grant-gated',
    mutate: (fixture) => {
      fixture.routes.push({
        apiName: 'newsletter',
        routerName: 'content-api',
        method: 'POST',
        path: '/newsletters',
        handler: 'api::newsletter.newsletter.create',
        policies: [],
        auth: { scope: ['api::newsletter.newsletter.create'] },
      })
      fixture.byRole.authenticated.push('api::newsletter.newsletter.create')
    },
  },
  {
    name: 'the policy dropping off a gated write route (grant kept)',
    expect: 'mutating-grant-gated',
    mutate: (fixture) => {
      const route = fixture.routes.find(
        (r) => CATALOGUE_APIS.includes(r.apiName) && MUTATING_METHODS.includes(r.method) && r.policies.includes(ADMIN_POLICY),
      )
      route.policies = []
      // Push the grant too: this self-test must bite on any database, including a fresh one
      // whose grant set is still small.
      fixture.byRole.authenticated.push(actionsOf(route)[0])
    },
  },
  {
    name: 'a write granted to the public role',
    expect: 'public-write',
    mutate: (fixture) => fixture.byRole.public.push('api::course.course.delete'),
  },
  {
    name: 'a public read outside the allow-list',
    expect: 'public-read-allowlist',
    mutate: (fixture) => fixture.byRole.public.push('api::exam.exam.find'),
  },
  {
    name: 'a grant for an action no loaded route ever reaches',
    expect: 'grant-route-alignment',
    mutate: (fixture) => fixture.byRole.authenticated.push('api::course.course.archive'),
  },
  {
    name: 'a catalogue write silenced by name instead of gated on its route',
    expect: 'exceptions-not-catalogue-writes',
    mutate: (fixture) => {
      const route = fixture.routes.find(
        (r) => CATALOGUE_APIS.includes(r.apiName) && MUTATING_METHODS.includes(r.method) && r.policies.includes(ADMIN_POLICY),
      )
      route.policies = []
      fixture.mutationExceptions[actionsOf(route)[0]] = 'silenced instead of gated'
    },
  },
  {
    name: 'a required authenticated grant missing (fresh-DB bootstrap gap)',
    expect: 'required-authenticated-grants',
    mutate: (fixture) => {
      fixture.byRole.authenticated = fixture.byRole.authenticated.filter((a) => a !== 'api::seminar.seminar.create')
    },
  },
  {
    name: 'a required public grant missing (landing calendar breaks)',
    expect: 'required-public-grants',
    mutate: (fixture) => {
      fixture.byRole.public = fixture.byRole.public.filter((a) => a !== 'api::competition.competition.find')
    },
  },
  {
    name: 'seminars leaking onto the public role',
    expect: 'seminars-not-public',
    mutate: (fixture) => fixture.byRole.public.push('api::seminar.seminar.find'),
  },
  {
    name: 'the route table coming back empty (introspection broke)',
    expect: 'route-discovery',
    mutate: (fixture) => {
      fixture.routes = []
    },
  },
  {
    name: 'the plugin route table coming back empty',
    expect: 'plugin-route-discovery',
    mutate: (fixture) => {
      fixture.pluginRoutes = []
    },
  },
  {
    name: 'a plugin content-api route losing its scope',
    expect: 'plugin-route-scopes',
    mutate: (fixture) => {
      fixture.pluginRoutes[0].scope = null
      fixture.pluginRoutes[0].auth = {}
    },
  },
]

function runSelfTest(fixture, baseline) {
  return SELF_TESTS.map((test) => {
    const clone = structuredClone(fixture)
    test.mutate(clone)
    const checks = buildChecks(clone)
    const target = checks.find((c) => c.id === test.expect)
    const baselinePassed = baseline.get(test.expect)?.pass === true
    const fired = !!target && !target.pass
    return {
      section: SECTION_SELF_TEST,
      id: `selftest-${test.expect}-${test.name}`,
      name: `${test.name} → ${test.expect} fails`,
      pass: baselinePassed && fired,
      detail: !baselinePassed
        ? 'the baseline already fails this check, so the self-test proves nothing'
        : fired
          ? ''
          : `the check still passed${target ? ` (${target.detail})` : ' — no check with that id exists'}`,
    }
  })
}

function printChecks(checks) {
  let section = null
  for (const check of checks) {
    if (check.section !== section) {
      section = check.section
      console.log(`\n${section}`)
    }
    console.log(`${check.pass ? '  ok  ' : ' FAIL '} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`)
  }
}

async function main() {
  const withSelfTest = process.argv.includes('--self-test')
  const { createStrapi, compileStrapi } = require('@strapi/strapi')
  const appContext = await compileStrapi()
  const strapi = await createStrapi(appContext).load()
  strapi.log.level = 'error'

  console.log('Authorization guard: catalogue writes must be admin-only (roadmap §0.2, AGENTS.md §5)')
  console.log('Read-only: no server, no HTTP, no writes to the database.')

  const fixture = {
    routes: collectApiRoutes(strapi),
    pluginRoutes: [],
    byRole: { authenticated: [], public: [] },
    // Copied so the self-test can add an exception without touching the real list.
    mutationExceptions: { ...MUTATING_EXCEPTIONS },
  }
  const pluginRoutes = collectPluginRoutes(strapi)
  fixture.pluginRoutes = pluginRoutes

  const permissions = await strapi.query('plugin::users-permissions.permission').findMany({ populate: ['role'] })
  for (const permission of permissions) {
    if (fixture.byRole[permission.role?.type]) fixture.byRole[permission.role.type].push(permission.action)
  }

  const checks = buildChecks(fixture)

  const policy = await policyChecks()
  const all = [...checks, ...policy]

  const baseline = new Map(all.map((c) => [c.id, c]))
  const selfTest = withSelfTest ? runSelfTest(fixture, baseline) : []
  printChecks([...all, ...selfTest])

  await strapi.destroy()

  const failed = [...all, ...selfTest].filter((c) => !c.pass)
  const total = all.length + selfTest.length
  console.log(`\n${total - failed.length}/${total} checks passed${withSelfTest ? ` (${all.length} guard + ${selfTest.length} self-test)` : ' — run with --self-test to prove each check can fail'}`)
  if (failed.length) {
    console.log('\nFAILED:')
    for (const check of failed) {
      console.log(`- [${failureKind(check.id)}] ${check.name}${check.detail ? `: ${check.detail}` : ''}`)
    }
    console.log('\nWhat these kinds mean:')
    for (const kind of Object.keys(FAILURE_KINDS)) {
      if (failed.some((check) => failureKind(check.id) === kind)) console.log(`- ${kind}: ${FAILURE_KINDS[kind]}`)
    }
  }
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
