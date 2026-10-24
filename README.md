# Birthday Buddy

A web app where you save the birthdays you care about and get an email before each one, every year. There is no login yet: you enter your email and your birthdays are saved under it.

## Tech and architecture

- **App:** Node.js backend and a plain HTML, CSS and JavaScript front end.
- **Data:** Amazon DynamoDB (on-demand billing), defined and deployed with AWS CDK (TypeScript) in `cdk/`. It has two indexes: `email-index` (all birthdays for an email) and `monthDay-index` (all birthdays on a given day, used by the hourly reminder job).
- **Storage layer:** the app talks to storage through a small interface, with an in-memory fallback for running locally without AWS and DynamoDB for the real thing.
- **Email:** the app sends through a small mailer interface too. `console` prints the email (the default, nothing leaves your machine) and `ses` sends it with Amazon SES. See [Email: console or SES](#email-console-or-ses).
- **Why serverless:** the app is small and bursty (one reminder check per hour), so pay-per-use services keep running costs close to zero.

## Status and next steps

- [x] Web app and API logic, running locally
- [x] DynamoDB table with two indexes, deployed with CDK
- [x] App connected to the real table and verified (data survives a restart)
- [x] API Gateway and Lambda for the API
- [ ] S3 and CloudFront to host the website
- [x] Hourly reminder job (EventBridge and Lambda), implemented
- [x] Real email sending with SES (in the SES sandbox: verified addresses only)
- [ ] Login with Cognito, so each person only sees their own birthdays
- [x] Monitoring and CI/CD
- [ ] Alarms

## Run locally

```bash
npm install
npm start      # http://localhost:3000
```

Enter any email, then add a birthday for today with "On the day" ticked. To skip the wait for the morning send hour, start with `SEND_FROM_HOUR=0` (`$env:SEND_FROM_HOUR=0; npm start` in PowerShell). Within 30 seconds the "email" is printed in the terminal. Data is in memory, so it disappears when the server stops.

## Email: console or SES

The mailer is chosen with `MAILER_BACKEND`. The default is `console`, which prints emails instead of sending them, so the app can be run and tested without AWS.

| Mode                | Set     | What happens |
| `console` (default) | nothing | the email is printed in the terminal, or in the Lambda's logs when deployed |
| `ses`               | `MAILER_BACKEND=ses` and `SENDER_EMAIL=<address verified in SES>` | the email is sent through Amazon SES |

A new SES account starts in the **sandbox**: it can only send to verified addresses, and the sender and recipient must both be verified in the same region. Any other recipient is refused with `MessageRejected`. The reminder job then leaves that reminder pending and retries on the next run. Sending to anyone requires requesting production access from AWS.

## Run it on your own AWS account

This deploys the app to your own AWS account with your own credentials. The CDK code in `cdk/` creates the DynamoDB table (with both indexes), the two Lambda functions, the API and the hourly schedule, so nothing needs to be created by hand.

**Requirements:** an AWS account, [Node.js](https://nodejs.org) 22, and the [AWS CLI](https://aws.amazon.com/cli/) signed in to that account (`aws configure`, or `aws configure sso`). Check with `aws sts get-caller-identity`.

1. **Choose a region.** The stack deploys to the region of your AWS profile, or to `AWS_REGION` if it is set (`$env:AWS_REGION = "ap-southeast-1"` in PowerShell, `export AWS_REGION=ap-southeast-1` in bash). Use the same region in every step below.
2. **Install the dependencies.** From the project folder: `npm install`, then `cd cdk` and `npm install`.
3. **Bootstrap CDK once per account and region.** From `cdk/`: `npx cdk bootstrap`. This creates the resources CDK uses to upload the function code.
4. **Optional, for real emails.** Verify a sender address in SES (same region), then set `SENDER_EMAIL` to it (`$env:SENDER_EMAIL = "you@example.com"` in PowerShell, `export SENDER_EMAIL=...` in bash). While the account is in the SES sandbox, the recipient address must be verified too. Without `SENDER_EMAIL`, the hourly job prints each email to the function's CloudWatch logs instead of sending it.
5. **Deploy.** From `cdk/`: `npx cdk deploy CdkStack`, and approve the permissions prompt. When it finishes it prints:
   - `TableName`: the DynamoDB table
   - `ApiUrl`: the base URL of the API
6. **Check the API.** `curl "<ApiUrl>/api/gifts"` should return a list of gift ideas (use `curl.exe` in PowerShell).
7. **Use it from your computer (optional).** In one terminal window, set `STORAGE_BACKEND=dynamodb`, `TABLE_NAME=<TableName>` and the same `AWS_REGION`, plus `MAILER_BACKEND=ses` and `SENDER_EMAIL` if you did step 4, then run `npm start`. The first line should say `storage=dynamodb`. Your birthdays are now saved in your own table.


**Notes.** A local server pointed at a real table runs its own reminder timer alongside the hourly Lambda, so use the in-memory default for everyday work. The API has no login yet, so do not leave the stack deployed with real data.

**Clean up.** From `cdk/`: `npx cdk destroy CdkStack` deletes the table, the functions and the API. Everything is pay-per-use, so running costs are close to zero while it is deployed.

## How it is built

```
frontend/            plain HTML/CSS/JS, no build step; deploy as-is to static hosting
  config.js          API_BASE_URL: where the API lives (empty means the same server)
backend/src/
  service.js         all business logic (validate, create, list, delete, the email job)
  storage/           storage interface: memory.js (in-memory fallback) and dynamodb.js
  mailer/            mailer interface: console.js prints emails (the default) and ses.js sends them with SES
  catalog/           gift catalog interface: curated.js is a hand-picked list of gift ideas
  app.js, server.js  LOCAL ONLY: Express + a timer that stands in for a cloud scheduler
cdk/                 AWS CDK (TypeScript): the DynamoDB table, the API and reminder Lambdas, the hourly schedule and the GitHub deploy role
.github/workflows/   CI/CD: checks the stack on every push and deploys on main
```

`service.js` knows nothing about HTTP or AWS. It receives a `storage` and a `mailer`, and the Lambda handlers call the same functions.

## Data and API

A **birthday** has: `id`, `email` (where reminders go), `name`, `month`, `day`, `monthDay` (like `"1005"`, added by the app), `year?`, `note`, `remindDaysBefore`, `timezone`, and which yearly reminders were already `sent`. The storage port in [memory.js](backend/src/storage/memory.js) lists every method a real database has to provide.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/birthdays` | `{ email, name, month, day, year?, remindDaysBefore: [0,1,3,7,14], timezone?, note? }` |
| GET | `/api/birthdays?email=...` | list the birthdays saved under that email |
| DELETE | `/api/birthdays/:id?email=...` | delete one (the email must match) |
| GET | `/api/gifts?category=all&q=choc` | gift ideas `[{ id, category, emoji, name, blurb, nearbyLink, onlineLink }]`; `category` is `all`, `cakes`, `flowers`, `treats` or `experiences`; `q` is optional |

**Gift ideas:** when a birthday is within 14 days, it gets a "Gift ideas" button that opens a dropdown and search bar. The ideas are a hand-picked list in `backend/src/catalog/curated.js`, so no outside API or key is needed. Each idea has two links that open in the user's own browser: Google Maps for nearby shops, and a web search. A real shop API would be another file in `backend/src/catalog/`.

There is no authentication yet, so anyone who knows an email address can view and change the list saved under it. Login with Cognito is planned.

The scheduled job is `processDueReminders({ storage, mailer, sendFromHour })`. It runs hourly. Each reminder is recorded so it is emailed once per year, and it is sent once the birthday person's local time reaches `sendFromHour`. The job does not read the whole table: it works out which month-days could be due and asks storage for just those (`listByMonthDay`), so it stays cheap as the number of birthdays grows.

## Build journal

How this project was built, step by step: what I did, what went wrong and how I fixed it, why I chose each AWS service, cost considerations, troubleshooting methods, and what is next. See [BUILD_JOURNAL.md](BUILD_JOURNAL.md).

## Testing and troubleshooting

To check the reminders by hand, start the server with `SEND_FROM_HOUR=0`, then add a birthday for today with "On the day" ticked. The reminder is printed in the terminal within 30 seconds. The local server uses in-memory storage by default, so every run starts empty.
