import { App, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import {
  AuthorizationType,
  AwsIntegration,
  IdentitySource,
  PassthroughBehavior,
  RequestAuthorizer,
  RestApi,
} from "aws-cdk-lib/aws-apigateway";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Rule } from "aws-cdk-lib/aws-events";
import { SfnStateMachine } from "aws-cdk-lib/aws-events-targets";
import {
  Effect,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import {
  Code,
  Function as LambdaFunction,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import { CfnPipe } from "aws-cdk-lib/aws-pipes";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { StateMachine } from "aws-cdk-lib/aws-stepfunctions";
import path from "node:path";

export class EdaWebhook extends Stack {
  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props);

    new Table(this, "EventLogTable", {
      billingMode: BillingMode.PAY_PER_REQUEST,
      contributorInsightsEnabled: true,
      deletionProtection: true,
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      removalPolicy: RemovalPolicy.RETAIN,
      sortKey: {
        name: "sortKey",
        type: AttributeType.STRING,
      },
      tableName: "EventLog",
      timeToLiveAttribute: "ttl",
    });

    const eventLogStateMachine = new StateMachine(
      this,
      "EventLogStateMachine",
      {}
    );

    new Rule(this, "EventLogRule", {
      targets: [new SfnStateMachine(eventLogStateMachine)],
    });

    const webhookStateMachine = new StateMachine(
      this,
      "WebhookStateMachine",
      {}
    );

    // TODO: Pipe https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_pipes.CfnPipe.html
    new CfnPipe(this, "WebhookPipe", {});

    const webhookQueue = new Queue(this, "WebhookQueue", {
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: new Queue(this, "WebhookQueueDLQ", {}),
      },
    });

    const webhookApiAuthorizerFunction = new LambdaFunction(
      this,
      "WebhookApiAuthorizerFunction",
      {
        code: Code.fromAsset(path.join(__dirname, "/.build")),
        handler: "authorizer.handler",
        runtime: Runtime.NODEJS_20_X,
      }
    );

    const webhookApiAuthorizer = new RequestAuthorizer(
      this,
      "WebhookApiAuthorizer",
      {
        handler: webhookApiAuthorizerFunction,
        identitySources: [IdentitySource.header("Authorization")],
        resultsCacheTtl: Duration.minutes(60),
      }
    );

    const webhookApi = new RestApi(this, "WebhookApi", {
      defaultMethodOptions: {
        authorizer: webhookApiAuthorizer,
        authorizationType: AuthorizationType.CUSTOM,
      },
      defaultIntegration: new AwsIntegration({
        action: "SendMessage",
        actionParameters: {
          MessageBody: "hello world",
          // TODO: This is not working https://github.com/aws/aws-cdk/issues/7010
          QueueUrl: webhookQueue.queueUrl,
        },
        integrationHttpMethod: "POST",
        options: {
          credentialsRole: new Role(this, "WebhookApiRole", {
            assumedBy: new ServicePrincipal("apigateway.amazonaws.com"),
            inlinePolicies: {
              sqsSendMessage: new PolicyDocument({
                statements: [
                  new PolicyStatement({
                    actions: ["sqs:SendMessage"],
                    resources: [webhookQueue.queueArn],
                    effect: Effect.ALLOW,
                  }),
                ],
              }),
            },
          }),
          // TODO: respond 200 [accepted] https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_apigateway-readme.html#gateway-response
          passthroughBehavior: PassthroughBehavior.NEVER,
        },
        region: "eu-central-1",
        service: "sqs",
      }),
    });

    webhookApi.root.addMethod("POST");
  }
}

const app = new App();

new EdaWebhook(app, "EdaWebhook");

app.synth();
