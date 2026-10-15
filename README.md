# Birthday Buddy

A static website where you save the birthdays you care about and get an email before each one, every year. There is no login: you enter your email and your birthdays are saved under it.

## Tech and architecture

- **App:** Node.js backend and a plain HTML, CSS and JavaScript front end.
- **Data:** Amazon DynamoDB (on-demand billing), defined and deployed with AWS CDK (TypeScript) in `cdk/`. It has two indexes: `email-index` (all birthdays for an email) and `monthDay-index` (all birthdays on a given day, used by the hourly reminder job).
- **Storage layer:** the app talks to storage through a small interface, with an in-memory fallback for running locally without AWS and DynamoDB for the real thing.
- **Why serverless:** the app is small and bursty (one reminder check per hour), so pay-per-use services keep running costs close to zero.

## Status and next steps

- [x] Web app and API logic, running locally
- [x] DynamoDB table with two indexes, deployed with CDK
- [x] App connected to the real table and verified (data survives a restart)
- [x] API Gateway and Lambda for the API
- [ ] S3 and CloudFront to host the website
- [x] Hourly reminder job (EventBridge and Lambda), implemented
- [ ] Real email sending with SES (reminders are currently printed to the function's logs)
- [ ] Login with Cognito, so each person only sees their own birthdays
- [x] Monitoring and CI/CD
- [ ] Alarms

## Run locally

```bash
npm install
npm start      # http://localhost:3000
```

Enter any email, then add a birthday for today with "On the day" ticked. To skip the wait for the morning send hour, start with `SEND_FROM_HOUR=0` (`$env:SEND_FROM_HOUR=0; npm start` in PowerShell). Within 30 seconds the "email" is printed in the terminal. Data is in memory, so it disappears when the server stops.

## How it is built

```
frontend/            plain HTML/CSS/JS, no build step; deploy as-is to static hosting
  config.js          API_BASE_URL: where the API lives (empty means the same server)
backend/src/
  service.js         all business logic (validate, create, list, delete, the email job)
  storage/           storage interface: memory.js (in-memory fallback) and dynamodb.js
  mailer/            mailer interface: console.js prints emails locally; SES is planned
  catalog/           gift catalog interface: curated.js is a hand-picked list of gift ideas
  app.js, server.js  LOCAL ONLY: Express + a timer that stands in for a cloud scheduler
cdk/                 AWS CDK (TypeScript): the DynamoDB table, the API and reminder Lambdas, the hourly schedule and the GitHub deploy role
```

The key idea: `service.js` knows nothing about HTTP or AWS. It receives a `storage` and a `mailer`. In AWS, Lambda handlers call the same functions.

## Data and API

A **birthday** has: `id`, `email` (where reminders go), `name`, `month`, `day`, `monthDay` (like `"1005"`, added by the app), `year?`, `note`, `remindDaysBefore`, `timezone`, and which yearly reminders were already `sent`. The storage port in [memory.js](backend/src/storage/memory.js) lists every method a real database has to provide.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/birthdays` | `{ email, name, month, day, year?, remindDaysBefore: [0,1,3,7,14], timezone?, note? }` |
| GET | `/api/birthdays?email=...` | list the birthdays saved under that email |
| DELETE | `/api/birthdays/:id?email=...` | delete one (the email must match) |
| GET | `/api/gifts?category=all&q=choc` | gift ideas `[{ id, category, emoji, name, blurb, nearbyLink, onlineLink }]`; `category` is `all`, `cakes`, `flowers`, `treats` or `experiences`; `q` is optional |

**Gift ideas:** when a birthday is within 14 days, it gets a "Gift ideas" button that opens a dropdown and search bar. The ideas are a hand-picked list in `backend/src/catalog/curated.js`, so no outside API or key is needed. Each idea has two links that open in the user's own browser: Google Maps for nearby shops, and a web search. A real shop API would be another file in `backend/src/catalog/`.

There is no authentication, so anyone who knows an email address can see and change the list saved under it. That is acceptable for the current state; login with Cognito is planned.

The scheduled job is `processDueReminders({ storage, mailer, sendFromHour })`. Run it hourly: each reminder is remembered so it is emailed once per year, and it goes out once the birthday person's local time reaches `sendFromHour`. It never reads the whole table: it works out which few month-days could be due and asks storage for just those (`listByMonthDay`), so it stays cheap as the number of birthdays grows.

## Build journal

How this project was built, step by step: what I did, what went wrong and how I fixed it, why I chose each AWS service, cost considerations, troubleshooting methods, and what is next. See [BUILD_JOURNAL.md](BUILD_JOURNAL.md).

## Testing and troubleshooting

While building the app, a preset test birthday ("Test Friend", 5 October 2002, with reminders one day before and on the day) was loaded into the in-memory storage every time the local server started. It was used to check and troubleshoot the app without touching a real database: that the list and "Next up" countdown showed the right dates and ages, and that reminder emails were produced for the right day. It was removed once the app was connected to DynamoDB, so the real table starts empty. To check things by hand, add a birthday for today with "On the day" ticked and start the server with `SEND_FROM_HOUR=0`; the reminder prints in the terminal within 30 seconds.
