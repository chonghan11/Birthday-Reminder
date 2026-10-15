import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

const GITHUB_REPO = 'chonghan11/Birthday-Reminder';
const GITHUB_HOST = 'token.actions.githubusercontent.com';


export class GithubOidcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const provider = new iam.OidcProviderNative(this, 'GithubProvider', {
      url: `https://${GITHUB_HOST}`,
      clientIds: ['sts.amazonaws.com'],
    });

    const role = new iam.Role(this, 'GithubDeployRole', {
      roleName: 'github-actions-deploy',
      description: 'Assumed by GitHub Actions to run cdk deploy for Birthday Buddy',
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.oidcProviderArn, {
        StringEquals: {
          [`${GITHUB_HOST}:aud`]: 'sts.amazonaws.com',
          [`${GITHUB_HOST}:sub`]: `repo:${GITHUB_REPO}:ref:refs/heads/main`,
        },
      }),
    });


    role.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*-role-${this.account}-${this.region}`],
    }));

    new cdk.CfnOutput(this, 'DeployRoleArn', {
      value: role.roleArn,
      description: 'Put this in GitHub: Settings > Secrets and variables > Actions > Variables > AWS_ROLE_ARN',
    });
  }
}
