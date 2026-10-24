import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import { TableV2, Billing, AttributeType} from 'aws-cdk-lib/aws-dynamodb';
import {Stack,StackProps,RemovalPolicy} from 'aws-cdk-lib';
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as path from 'node:path';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as budgets from 'aws-cdk-lib/aws-budgets';

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new TableV2(
      this, 
      "BirthdaysTable",
      {
        partitionKey:{
          name: "id",
          type: AttributeType.STRING
        },
        
        billing: Billing.onDemand(),
        removalPolicy:RemovalPolicy.DESTROY,
        globalSecondaryIndexes: [
        { indexName: "email-index", partitionKey: { name: "email", type: AttributeType.STRING }},
        { indexName: "monthDay-index", partitionKey:{name:"monthDay",type: AttributeType.STRING}} 
      ],
      });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });

    const senderEmail = process.env.SENDER_EMAIL;

    // Log events older than a month are deleted, so logs never pile up and reduces cost.
    const monthOfLogs = (logId: string) => new logs.LogGroup(this, logId, {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const fn = new lambda.Function(this, 'birthdayadd', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'lambda/api.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend')),
      timeout: cdk.Duration.seconds(10),
      logGroup: monthOfLogs('ApiLogs'),
      environment:{
        STORAGE_BACKEND: 'dynamodb',
        TABLE_NAME: table.tableName,
      }
    });
    table.grantReadWriteData(fn);

    const api = new apigwv2.HttpApi(this, `birthdayAPI`, {
      apiName: `birthdayAPI`,
    });

    // Rate limit: each route accepts at most 10 requests a second, with bursts of up to 20. Beyond that API Gateway
    // answers 429 without calling Lambda, so a flood cannot run up Lambda or DynamoDB costs.
    (api.defaultStage!.node.defaultChild as apigwv2.CfnStage).defaultRouteSettings = {
      throttlingRateLimit: 10,
      throttlingBurstLimit: 20,
    };

    const integration = new HttpLambdaIntegration('BirthdayIntegration',fn);

const bucket = new s3.Bucket(this, 'SiteBucket', {
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  removalPolicy: RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
  enforceSSL: true,
 })

const distribution = new cloudfront.Distribution(this, 'SiteCdn', {
  defaultRootObject: 'index.html',
  defaultBehavior: { origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
  viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS },
  additionalBehaviors: { '/api/*': {
    originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    origin: new origins.HttpOrigin(`${api.apiId}.execute-api.${this.region}.${this.urlSuffix}`),
    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
  } },  
 })

// Sign-up guard: runs before Cognito creates an account. It refuses throwaway email domains and caps sign-up
// attempts per hour (it keeps its counter in the table), so bots cannot flood strangers with verification emails.
const preSignUp = new lambda.Function(this, 'PreSignUp', {
  runtime: lambda.Runtime.NODEJS_LATEST,
  handler: 'lambda/pre-signup.handler',
  code: lambda.Code.fromAsset(path.join(__dirname, '../../backend')),
  timeout: cdk.Duration.seconds(5),
  logGroup: monthOfLogs('PreSignUpLogs'),
  environment: {
    TABLE_NAME: table.tableName,
    MAX_SIGNUPS_PER_HOUR: '20',
  },
});
// The guard only ever updates its one counter item, so that is the only thing it may do.
table.grant(preSignUp, 'dynamodb:UpdateItem');

// Login: the site has its own sign-up and log-in page and talks to Cognito directly.
// The ID token Cognito returns carries a verified email, which the API uses to tell people apart.
const userPool = new cognito.UserPool(this, 'UserPool', {
  lambdaTriggers: { preSignUp },
  selfSignUpEnabled: true,
  signInAliases: { email: true },
  signInCaseSensitive: false,
  autoVerify: { email: true },
  standardAttributes: { email: { required: true, mutable: false } },
  passwordPolicy: {
    minLength: 8,
    requireLowercase: true,
    requireUppercase: true,
    requireDigits: true,
    requireSymbols: true,
  },
  accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
  removalPolicy: RemovalPolicy.DESTROY,
});

// A public client. It may log in with email and password.
const userPoolClient = userPool.addClient('WebClient', {
  generateSecret: false,
  authFlows: { userPassword: true },
  disableOAuth: true, 
});

const siteUrl = `https://${distribution.distributionDomainName}/`;

// Every API route needs a valid login token. Requests without one never reach the Lambda.
const authorizer = new HttpUserPoolAuthorizer('LoginAuthorizer', userPool, { userPoolClients: [userPoolClient] });

api.addRoutes({
  path: '/api/birthdays',
  methods: [apigwv2.HttpMethod.GET,apigwv2.HttpMethod.POST],
  integration: integration,
  authorizer,
});
api.addRoutes({
  path: '/api/birthdays/{id}',
  methods: [apigwv2.HttpMethod.DELETE],
  integration: integration,
  authorizer,
});
api.addRoutes({
  path: '/api/timezone',
  methods: [apigwv2.HttpMethod.PUT],
  integration: integration,
  authorizer,
});
api.addRoutes({
  path: '/api/gifts',
  methods: [apigwv2.HttpMethod.GET],
  integration: integration,
  authorizer,
});
new cdk.CfnOutput(this,'ApiUrl',{value: api.apiEndpoint});


new s3deploy.BucketDeployment(this, 'DeploySite', {
  sources: [
    s3deploy.Source.asset(path.join(__dirname, '../../frontend')),
    s3deploy.Source.data('config.js', `window.APP_CONFIG = ${JSON.stringify({
      API_BASE_URL: '',
      COGNITO: { region: this.region, clientId: userPoolClient.userPoolClientId },
    })};\n`),
  ],
  destinationBucket: bucket,
  distribution,
  distributionPaths: ['/*'],
  logGroup: monthOfLogs('DeploySiteLogs'),
})

new cdk.CfnOutput(this, 'SiteUrl', { value: siteUrl });

const Reminderfn = new lambda.Function(this, 'Remindercall', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'lambda/reminder.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend')),
      timeout: cdk.Duration.seconds(60),
      logGroup: monthOfLogs('ReminderLogs'),
      environment:{
        STORAGE_BACKEND: 'dynamodb',
        TABLE_NAME: table.tableName,
        MAILER_BACKEND: senderEmail ? 'ses' : 'console',
        SENDER_EMAIL: senderEmail ?? '',
      },
    });
     table.grantReadWriteData(Reminderfn);
     if (senderEmail) {
     Reminderfn.addToRolePolicy(new iam.PolicyStatement({
     actions: ['ses:SendEmail'],
     resources: [`arn:aws:ses:${this.region}:${this.account}:identity/${senderEmail}`],
  }));
}
  new events.Rule(this, 'HourlyReminderRule', {
  schedule: events.Schedule.rate(cdk.Duration.hours(1)),
  targets: [new targets.LambdaFunction(Reminderfn)],
});

// Spending alarm: AWS emails ALERT_EMAIL when this month's cost passes $4 (80%) or $5, or is forecast to pass $5.
// Credits are not subtracted, so it counts real usage. Skipped when ALERT_EMAIL is not set.
const alertEmail = process.env.ALERT_EMAIL;
if (alertEmail) {
  const subscribers = [{ subscriptionType: 'EMAIL', address: alertEmail }];
  new budgets.CfnBudget(this, 'MonthlyBudget', {
    budget: {
      budgetName: 'birthday-buddy-monthly',
      budgetType: 'COST',
      timeUnit: 'MONTHLY',
      budgetLimit: { amount: 5, unit: 'USD' },
      costTypes: { includeCredit: false },
    },
    notificationsWithSubscribers: [
      { notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 80, thresholdType: 'PERCENTAGE' }, subscribers },
      { notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 100, thresholdType: 'PERCENTAGE' }, subscribers },
      { notification: { notificationType: 'FORECASTED', comparisonOperator: 'GREATER_THAN', threshold: 100, thresholdType: 'PERCENTAGE' }, subscribers },
    ],
  });
}

  }}

