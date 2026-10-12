import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import { TableV2, Billing, AttributeType} from 'aws-cdk-lib/aws-dynamodb';
import {Stack,StackProps,RemovalPolicy} from 'aws-cdk-lib';
//import * as lambda from 'aws-cdk-lib/aws-lambda';
//import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
//import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
//import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';

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
 };
}