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

    const fn = new lambda.Function(this, 'birthdayadd', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'lambda/api.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend')),
      timeout: cdk.Duration.seconds(10),
      environment:{
        STORAGE_BACKEND: 'dynamodb',
        TABLE_NAME: table.tableName,
      }
    });
    table.grantReadWriteData(fn);

    const api = new apigwv2.HttpApi(this, `birthdayAPI`, {
      apiName: `birthdayAPI`, 
    });
    
    const integration = new HttpLambdaIntegration('BirthdayIntegration',fn);

  api.addRoutes({
  path: '/api/birthdays',
  methods: [apigwv2.HttpMethod.GET,apigwv2.HttpMethod.POST],
  integration: integration,
});

api.addRoutes({
  path: '/api/birthdays/{id}',
  methods: [apigwv2.HttpMethod.DELETE],
  integration: integration,
});
api.addRoutes({
  path: '/api/gifts',
  methods: [apigwv2.HttpMethod.GET],
  integration: integration,
});
new cdk.CfnOutput(this,'ApiUrl',{value: api.apiEndpoint});

const Reminderfn = new lambda.Function(this, 'Remindercall', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'lambda/reminder.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend')),
      timeout: cdk.Duration.seconds(60),
      environment:{
        STORAGE_BACKEND: 'dynamodb',
        TABLE_NAME: table.tableName,
        MAILER_BACKEND:'console',
      },
    });
     table.grantReadWriteData(Reminderfn);

  new events.Rule(this, 'HourlyReminderRule', {
  schedule: events.Schedule.rate(cdk.Duration.hours(1)),
  targets: [new targets.LambdaFunction(Reminderfn)],
});
  }}

