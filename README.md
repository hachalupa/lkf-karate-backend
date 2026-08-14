# 🥋 LKF Karate LMS — Backend API

Strapi 5 headless CMS that powers the **LKF Karate LMS** — the Latvian Karate
Federation qualification platform for referees and competition secretaries.
It serves courses (with block-based chapters), chapter quizzes, qualification
exams, results tracking, user approval, the student dashboard and the admin
panel for the React frontend.

## 🛠️ Stack

| Tehnoloģija | Versija | Mērķis |
|---|---|---|
| Strapi | 5.46 | Headless CMS + REST API |
| Node.js | 20–24 | Servera vide |
| SQLite (`better-sqlite3`) | 12 | Lokālās izstrādes datubāze |
| PostgreSQL (`pg`) | 8 | Produkcijas datubāze |
| `@strapi/provider-email-nodemailer` | 5 | E-pasta sūtīšana (Gmail SMTP) |
| `@fourlights/strapi-plugin-deep-populate` | 1.15 | Dziļa relāciju ielāde |

## 🚀 Quick start

Requirements: Node.js ≥ 20, npm.

```bash
npm install
cp .env.example .env   # fill in your values (see below)
npm run develop        # dev server with auto-reload → http://localhost:1337
```

- REST API: `http://localhost:1337/api`
- Admin panel: `http://localhost:1337/admin` (create the admin account on first run)

## 📜 Scripts

| Komanda | Apraksts |
|---|---|
| `npm run develop` | Izstrādes serveris ar auto-reload |
| `npm run start` | Produkcijas serveris (bez auto-reload) |
| `npm run build` | Admin paneļa build |
| `npm run console` | Strapi REPL konsole |
| `npm run seed:example` | Piemēru datu iesēšana (`scripts/seed.js`) |
| `node ./scripts/seed-courses.js` | Kursu un nodaļu iesēšana |
| `node ./check-db.js` | Datu bāzes pārbaude |
| `npm run upgrade` | Strapi jaunināšana uz jaunāko versiju |

## 🔑 Environment variables

Kopē `cp .env.example .env` — pilns saraksts ar komentāriem ir tur.

| Mainīgais | Apraksts |
|---|---|
| `HOST`, `PORT` | Servera adrese un ports (noklusējums `0.0.0.0:1337`) |
| `APP_KEYS` | Strapi lietotņu atslēgas (komatiem atdalīts saraksts) |
| `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `ENCRYPTION_KEY`, `JWT_SECRET` | Strapi drošības noslēpumi (`openssl rand -base64 32`) |
| `DATABASE_CLIENT` | `sqlite` (lokāli) vai `postgres` (produkcija) |
| `DATABASE_FILENAME` | SQLite faila ceļš (noklusējums `.tmp/data.db`) |
| `DATABASE_URL` / `DATABASE_HOST` / `DATABASE_PORT` / `DATABASE_NAME` / `DATABASE_USERNAME` / `DATABASE_PASSWORD` / `DATABASE_SSL` | PostgreSQL pieslēgums |
| `GMAIL_USER`, `GMAIL_PASS` | Gmail SMTP akreditācija (app password) e-pastiem |
| `FRONTEND_URL` | React frontenda publiskā adrese (reset-password saite + CORS allow-list) |
| `SERVER_URL` | Backenda publiskā adrese |

## 🗂️ Content types

| Satura tips | Apraksts |
|---|---|
| `course` | Kursi (title/description/slug/category, LV/RU/EN lauki, draft & publish) |
| `chapter` | Nodaļas ar bloku saturu (`blocks` JSON: text/video/image/note/question) |
| `question` | Jautājumu banka (MC / Yes-No / Open-text, LV/RU/EN, media, order, sourceFile) |
| `exam` | Eksāmeni (duration, passingScore, openAt/closeAt, showResults, questions M2M) |
| `exam-attempt` | Eksāmena mēģinājumi (answers JSON, score, passed, startedAt/submittedAt) |
| `chapter-progress` | Nodaļu apgūšanas uzskaite (seen, seenAt) |
| `user` | `users-permissions` paplašinājums ar `verification` (pending/rejected/approved) |

`exam-session` un `dashboard` ir pielāgoti kontrolieri/routes — ne satura tipi.

## 🔌 Custom API endpoints

### Eksāmenu sesijas (pielāgoti galapunkti)
| Metode | Ceļš | Apraksts |
|---|---|---|
| POST | `/api/exams/start` | Sākt eksāmenu (vai atsākt nepabeigtu mēģinājumu ar atlikušo laiku); pārbauda `openAt`/`closeAt` logu un vienu mēģinājumu uz eksāmenu |
| POST | `/api/exams/submit` | Automātiska vērtēšana; rezultāti slēpti līdz admin tos publicē (`showResults`) |
| POST | `/api/exams/save-progress` | Saglabāt atbildes eksāmena laikā (auto-save / resume) |
| POST | `/api/exams/quick-quiz` | Ātrais tests — nejauši jautājumi no kursa |

### Eksāmenu mēģinājumi (ar īpašumtiesību pārbaudi)
| Metode | Ceļš | Apraksts |
|---|---|---|
| GET | `/api/exam-attempts` | Lietotāja paša mēģinājumi |
| GET | `/api/exam-attempts/:id` | Viena mēģinājuma skatīšana — tikai īpašnieks (ownership check) |
| GET | `/api/exam-attempts/all` | Visi mēģinājumi (tikai admins) |
| PUT | `/api/exam-attempts/grade/:id` | Manuāla vērtēšana (tikai admins) |

> Piezīme: statiskie route (`/all`, `/grade/:id`) ir reģistrēti **pirms** parametriskā
> `/exam-attempts/:id`, lai koa-router tos nenorītu kā `:id` vērtības.

### Nodaļu progress
| Metode | Ceļš | Apraksts |
|---|---|---|
| GET | `/api/chapter-progress` | Lietotāja nodaļu progress |
| POST | `/api/chapter-progress/mark-seen` | Atzīmēt nodaļu kā apgūtu |

### Dashboard
| Metode | Ceļš | Apraksts |
|---|---|---|
| GET | `/api/dashboard` | Saskaites dati: sveiciens, statistika (quizzes/exams/study hours), jaunākie rezultāti, **tuvākais gaidāmais eksāmens** (tuvākais `openAt` nākotnē) |

### Konta dzēšana
| Metode | Ceļš | Apraksts |
|---|---|---|
| DELETE | `/api/account/delete` | Pašapkalpošanās konta dzēšana ar kaskādes tīrīšanu (mēģinājumi, progress, profila attēls) |

## ⚙️ Custom logic

- **`exam-session` kontrolieris** — pārbauda eksāmena logu (`openAt`/`closeAt`),
  neļauj atkārtot jau iesniegtu eksāmenu, atsāk nepabeigtu mēģinājumu ar atlikušo
  laiku, sajauc jautājumus, klientam **nepārsūta pareizās atbildes** (izņemot, ja
  `showResults` ir ieslēgts) un slēpj rezultātu līdz publicēšanai.
- **`exam-attempt` kontrolieri** — visi vaicājumi ir scoped uz `ctx.state.user`
  (lietotājs var redzēt tikai savus mēģinājumus; admin — visus un vērtēt).
- **`users-permissions` paplašinājums** — pēc reģistrācijas lietotājs saņem
  `verification: 'pending'`; apstiprināšana/noraidīšana notiek admin panelī.
- **Bootstrap** (`src/index.js`) — forgo-password e-pasta saite automātiski norāda
  uz React frontendu (`FRONTEND_URL/auth/reset-password`).
- **Upload** — servera puses MIME allow-list (`security.allowedTypes`), 10 MB
  ierobežojums, attēlu breakpoints; validācija notiek pēc satura noteikšanas
  (`file-type`), ne tikai pēc deklarētā tipa.
- **Dashboard** — `upcomingExam` vaicājums izmanto Strapi 5 document service
  atslēgas (`filters`/`sort`/`limit`), kas atgriež tikai eksāmenus ar `openAt`
  nākotnē, kārtotus pēc tuvuma.

## 🔐 Security

- `strapi::security` ar Content-Security-Policy (CSP), X-Frame-Options, HSTS, X-Content-Type-Options
- `strapi::cors` — atļauti tikai: `localhost:5173`, `localhost:5174`, Vercel produkcija un `FRONTEND_URL`
- JWT ar 7 dienu derīgumu (bcrypt parolēm), lomu pārbaudes pielāgotajos kontrolieros
- Upload MIME allow-list (skat. iepriekš)

## 🗄️ Migrations

`database/migrations/` — Strapi migrācijas (piem., kursu `published` migrācija,
performances indeksi). Automātiski izpildās pie servera starta.

## 📁 Projekta struktūra

```
backend/
├── config/
│   ├── admin.js          # Admin JWT / API token / transfer salt
│   ├── api.js            # REST iestatījumi (limit, withCount)
│   ├── database.js       # SQLite / PostgreSQL / MySQL konfigurācija
│   ├── middlewares.js    # CSP, CORS allow-list
│   ├── plugins.js        # Email (nodemailer), upload (MIME), deep-populate
│   └── server.js         # Host / ports / APP_KEYS
├── database/migrations/  # Datubāzes migrācijas
├── scripts/
│   ├── seed.js           # Piemēru dati
│   └── seed-courses.js   # Kursu iesēšana
├── src/
│   ├── index.js          # Bootstrap (reset-password URL)
│   ├── api/
│   │   ├── account/          # DELETE /api/account/delete
│   │   ├── chapter/
│   │   ├── chapter-progress/ # mark-seen + īpašnieka progress
│   │   ├── course/
│   │   ├── dashboard/        # GET /api/dashboard
│   │   ├── exam/
│   │   ├── exam-attempt/     # ownership-scoped find/findOne, all, grade
│   │   ├── exam-session/     # /exams/start, submit, save-progress, quick-quiz
│   │   └── question/
│   └── extensions/users-permissions/  # verification: 'pending' pēc reģistrācijas
└── .env.example
```
