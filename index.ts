import { App, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import {
  // AuthorizationType,
  AwsIntegration,
  Model,
  // IdentitySource,
  PassthroughBehavior,
  // RequestAuthorizer,
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
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { CfnPipe } from "aws-cdk-lib/aws-pipes";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { StateMachine } from "aws-cdk-lib/aws-stepfunctions";

export class EdaWebhook extends Stack {
  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props);

    // new Table(this, "EventLogTable", {
    //   billingMode: BillingMode.PAY_PER_REQUEST,
    //   contributorInsightsEnabled: true,
    //   deletionProtection: true,
    //   partitionKey: {
    //     name: "id",
    //     type: AttributeType.STRING,
    //   },
    //   removalPolicy: RemovalPolicy.RETAIN,
    //   sortKey: {
    //     name: "sortKey",
    //     type: AttributeType.STRING,
    //   },
    //   tableName: "EventLog",
    //   timeToLiveAttribute: "ttl",
    // });

    // const eventLogStateMachine = new StateMachine(
    //   this,
    //   "EventLogStateMachine",
    //   {}
    // );

    // new Rule(this, "EventLogRule", {
    //   targets: [new SfnStateMachine(eventLogStateMachine)],
    // });

    // const webhookStateMachine = new StateMachine(
    //   this,
    //   "WebhookStateMachine",
    //   {}
    // );

    const webhookQueue = new Queue(this, "WebhookQueue", {
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: new Queue(this, "WebhookQueueDLQ", {}),
      },
    });

    const defaultEventBusArn = `arn:aws:events:${this.region}:${this.account}:event-bus/default`;

    new CfnPipe(this, "WebhookPipe", {
      source: webhookQueue.queueArn,
      roleArn: new Role(this, "WebhookPipeRole", {
        assumedBy: new ServicePrincipal("pipes.amazonaws.com"),
        inlinePolicies: {
          eventBusPipeTagret: new PolicyDocument({
            statements: [
              new PolicyStatement({
                actions: ["events:PutEvents"],
                resources: [defaultEventBusArn],
                effect: Effect.ALLOW,
              }),
            ],
          }),
          sqsPipeSource: new PolicyDocument({
            statements: [
              new PolicyStatement({
                actions: [
                  "sqs:ReceiveMessage",
                  "sqs:DeleteMessage",
                  "sqs:GetQueueAttributes",
                ],
                resources: [webhookQueue.queueArn],
                effect: Effect.ALLOW,
              }),
            ],
          }),
        },
      }).roleArn,
      target: defaultEventBusArn,
    });

    const webhookApiAuthorizerFunction = new NodejsFunction(
      this,
      "WebhookApiAuthorizerFunction",
      {
        entry: "./authorizer.ts",
        runtime: Runtime.NODEJS_20_X,
      }
    );

    // TODO: This is not working
    // const webhookApiAuthorizer = new RequestAuthorizer(
    //   this,
    //   "WebhookApiAuthorizer",
    //   {
    //     handler: webhookApiAuthorizerFunction,
    //     identitySources: [IdentitySource.header("Authorization")],
    //     resultsCacheTtl: Duration.minutes(60),
    //   }
    // );

    const webhookApi = new RestApi(this, "WebhookApi", {
      // defaultMethodOptions: {
      //   authorizer: webhookApiAuthorizer,
      //   authorizationType: AuthorizationType.CUSTOM,
      // },
    });

    webhookApi.root.addMethod(
      "POST",
      new AwsIntegration({
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
          integrationResponses: [
            {
              statusCode: "200",
              responseTemplates: {
                "application/json": '"[accepted]"',
              },
            },
          ],
          passthroughBehavior: PassthroughBehavior.NEVER,
          requestParameters: {
            "integration.request.header.Content-Type": `'application/x-www-form-urlencoded'`,
          },
          requestTemplates: {
            "application/json":
              "Action=SendMessage&MessageBody=$util.urlEncode($input.body)",
          },
        },
        path: `${this.account}/${webhookQueue.queueName}`,
        region: "eu-central-1",
        service: "sqs",
      }),
      {
        methodResponses: [
          {
            statusCode: "200",
            responseModels: {
              "application/json": Model.EMPTY_MODEL,
            },
          },
          {
            statusCode: "400",
            responseModels: {
              "application/json": Model.ERROR_MODEL,
            },
          },
          {
            statusCode: "500",
            responseModels: {
              "application/json": Model.ERROR_MODEL,
            },
          },
        ],
      }
    );
  }
}

const app = new App();

new EdaWebhook(app, "EdaWebhook");

app.synth();
