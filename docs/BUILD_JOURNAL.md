# Build journal

A running log of how I built Birthday Buddy: what I did, what went wrong, how I fixed it, why I picked each service, what it costs, and what is next. Newest information is added at the bottom of each section as the project grows.

Status at a glance:

| Piece | Status |
|---|---|
| Web app and API logic (runs locally) | Done |
| DynamoDB table with two indexes, deployed with CDK | Done |
| Lambda functions and API Gateway | Next |
| S3 and CloudFront website hosting | Planned |
| Hourly reminder job (EventBridge) and SES email | Planned |
| Cognito login | Planned |

---

## 1. The idea and the first version (4 Oct 2026)

**Goal.** I want to move into cloud engineering, so I wanted a project I could build properly on AWS and construct it according to industry standards. The brief: a static website plus an email reminder alert. I settled on a birthday reminder app: save the birthdays you care about, and get an email before each one, every year.

**What I built.** A plain HTML, CSS and JavaScript website and a Node.js backend. The business logic lives in one file, `service.js`, which knows nothing about HTTP or AWS. It receives a `storage` and a `mailer`, so locally they are an in-memory store and a console printout, and in the cloud they become DynamoDB and SES. Because of that, moving to AWS means writing new entry points, not rewriting the app.

**What went wrong, and how I fixed it**

| Problem | What I did |
| I first added a login (email and password with signed tokens), then decided the project should start simpler | Removed it and kept "enter your email" for now. Login is planned properly with Cognito |
| For gift ideas I first used a free recipe API (TheMealDB), but its cakes are recipes to bake, not things to buy | Dropped the outside API for a hand-picked list of gift ideas, each with a Google Maps and a web search link |
| I looked for a free Grab API for delivery | Grab's APIs are for restaurants (GrabFood) and approved business partners (GrabExpress), not individual developers, so I linked to search results instead as its more easier and flexible with whatever the recipient likes, and is not limited to what API services offer or the availability of API.|

**Why a curated list and not an API.** No keys, no outside dependency, no cost, more flexibility and nothing to break. A real shop API can be added later as another file next to it.

---

## 2. Choosing the database: DynamoDB, not RDS

I compared them for this app's needs.

| | DynamoDB | RDS (PostgreSQL) |
|---|---|---|
| Cost model | Pay per request, idle is near zero(serverless) | Pay per hour for a running server |
| Rough cost for a few rows | Pennies a month | About a few tens of dollars ($10+)  |
| Fits this app because | One flat list of independent birthdays, with lookups I know in advance | Better when data has many linked tables |
| Setup | Create a table | A private network (VPC), security groups, a password, connection handling |

**Decision: DynamoDB.** With no login, the data is one simple list, and I know my three lookups (one item by id, everything for an email, everything due on a given day). For login I plan to use Cognito, which keeps the accounts, so my database only stores birthdays.

**Cost note.** Via the use of amazon free tier, DynamoDB has an always-free allowance of 25 GB of storage. My indexes each keep a copy of the data, so I store roughly three times what the table holds, which is still tiny. Requests are billed on demand, which should be in the cents at this size. Cognito's free allowance covers the first 10,000 monthly active users. 
Hence by using the conditions and resources, I keep the cost low and by doing so, allow me to train keeping cost low as a habit.

---

## 3. Setting up the tools and AWS accounts (7 to 9 Oct 2026)

I set up the AWS CLI, CDK and Git, a login that uses no long-lived keys, and a separate AWS account for the project.

**What I did**
- Installed the AWS CLI and CDK, and signed in through IAM Identity Center (single sign-on) as a dedicated user, not the root account.
- Created a new member account under AWS Organizations just for this project, and gave only that user access to it.
- Bootstrapped CDK in that account and region (`ap-southeast-1`).

**What went wrong and how I fixed it**

| Problem | Cause | Fix |
|---|---|---|
| `aws configure sso` ended with "No AWS accounts are available to you" | My user could log in but was not assigned to any account | In Identity Center, assigned the user and a permission set to the account |
| I could not find a "password for the account" | Accounts have no password of their own. Users do | Log in as the user. The account is just what the user is given access to |
| `cdk bootstrap` said "Specify an environment name" | There was no CDK project yet for it to read the account from | Passed the account and region directly: `aws://ACCOUNT/REGION` |
| `npm install @aws-cdk/aws-lambda ...` added 31 vulnerabilities | Those are old CDK version 1 packages, and I ran it in the app folder instead of the CDK folder | Uninstalled them. CDK version 2 has everything in `aws-cdk-lib`, so nothing extra is needed |

**Why CDK.** I describe infrastructure in code I can read and review, and `cdk diff` shows exactly what will change before I deploy. I also compared it with Terraform: both do the same job, Terraform is more common across clouds, CDK suits an AWS-focused project. I will build a later project in Terraform to learn both. Currently learning CDK.

**Why a separate account.** Companies commonly give each project its own account. If something goes wrong, it stays contained, cost is easy to track, and the whole account can be closed at the end.

**One-time manual step.** Creating the first admin user and the account assignment is done by hand, because there is nothing to run automation with yet. Everything about the application itself is in CDK.

---

## 4. Designing the table (and the mistakes I caught before deploying)

**First draft problems.** My first table used `user_id` and a numeric sort key `dates`. Reviewing it against the code, I found it would not work:
- The code looks items up by `id` alone, so a sort key would make every read and delete fail.
- Two birthdays on the same date for one user would overwrite each other.
- The email index the code queries did not exist.

**Final design:** partition key `id`, plus two indexes: `email-index` (all birthdays for an email) and `monthDay-index` (all birthdays on a given day, like `"1005"`).

**A second mistake I caught.** I declared the `monthDay` index key as a number, but the app stores it as text so a leading zero is kept (`"0305"`). DynamoDB would have rejected every save. Fixed to text before deploying. `cdk synth` showed it correctly in the generated template.

**Scalability decision.** The hourly job first scanned the whole table, which is fine for a few rows but reads everything on every run. I replaced the scan with the `monthDay-index`: the job works out which few month-days could be due (the UTC date plus or minus one day for time zones, plus each reminder offset up to 14 days, with Feb 29 handled) and queries only those. This stays cheap as the number of birthdays grows.

**How I checked the date logic.** I ran a throwaway script (not part of the repo) with eight scenarios: a birthday that is "today" in Singapore while it is still the day before in UTC, reminders 7 and 14 days ahead, Feb 29 in leap and non-leap years, New Year's Day reminded on 31 December, and a day with nothing due. Each sent the right emails exactly once, and a second run sent nothing. I only ran this against the in-memory storage, so I tested the DynamoDB path separately (next section).

---

## 5. Deploying and checking it works

**What I did.** Ran `cdk synth` (compile only), `cdk diff` (preview: one table, nothing deleted), then `cdk deploy`. It created the stack in about 30 seconds. [fill in: date]

**How I verified it**
1. Ran the app locally against the real table, with `STORAGE_BACKEND=dynamodb`, `TABLE_NAME` set to the deployed table, and my AWS profile active.
2. Added a birthday on the website and saw it in the list.
3. **Restart test.** I stopped the server and started it again. The entry was still there, which proves it was stored in DynamoDB and not in memory.

**Another problem along the way.** While testing locally, a route returned "not found" even though it existed. Another, older copy of the app was already listening on port 3000, so my requests were hitting that one. I ran the new copy on a different port instead of killing a process I had not started.

---

## 6. Cost considerations

- **Who is billed.** The project account is a member of my AWS Organization, so its usage is billed to the original (management) account, and I check it under Billing there.
- **What costs money here.** DynamoDB on-demand is cents. Lambda, API Gateway and EventBridge have free allowances far above this project's use. Cognito is free for my scale. SES costs about US$0.10 per 1,000 emails.
- **What I am avoiding on purpose.** RDS (billed per hour), a NAT gateway (billed per hour, about SGD$45 a month, needed when Lambda runs inside a private network), and a custom domain (Route 53 plus a yearly registration fee). CloudFront already gives a free HTTPS address.
- **Free tier.** The rules depend on when the account was created, so I check Billing, then Free Tier, for my account instead of trusting a table.
- **Safety net.** A monthly budget alarm in the billing account. [fill in: done or not]
- **Clean-up.** `cdk destroy` removes everything the stack created. The table is set to be deleted with the stack.


---

## 8. What is next

1. **API Lambda and API Gateway.** A handler that builds the DynamoDB storage and calls `service.js`, with permission to the table granted in CDK, environment variables for the table name, and routes for add, list, delete and gift ideas. Test it with `curl` before any website exists.
2. **S3 and CloudFront** for the website, with the API address in `config.js`.
3. **Reminder Lambda, EventBridge hourly schedule and SES email.** Start verifying a sender email in SES early, because a new account is in a sandbox that only emails verified addresses.
4. **Cognito login,** so each person only sees their own birthdays. The table keys then change to `userId` (partition) and `id` (sort), and the service takes the user from the verified token.
5. **Abuse protection and monitoring:** API throttling, CloudWatch logs and alarms, and tracing.
6. **CI/CD** with GitHub Actions and an AWS role assumed without stored keys.

---

## 9. What I have learned so far

- Design the data around the lookups I know I need, then check the table against the code before deploying. Both of my table mistakes were found by reading, not by running.
- A cheap, managed service often beats a "more powerful" one for a small app (DynamoDB over RDS, Cognito over my own login).
- Keep infrastructure and application code separate, and keep the cloud-specific parts behind small interfaces.
- Check which account, region and tool I am actually in before assuming something is broken.
