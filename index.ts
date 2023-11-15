import {
  HttpApi,
  HttpIntegrationSubtype,
  HttpIntegrationType,
  HttpMethod,
  HttpRouteIntegration,
  IntegrationCredentials,
  MappingValue,
  ParameterMapping,
  PayloadFormatVersion,
} from "@aws-cdk/aws-apigatewayv2-alpha";
import {
  HttpLambdaAuthorizer,
  HttpLambdaResponseType,
} from "@aws-cdk/aws-apigatewayv2-authorizers-alpha";
import { App, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Rule } from "aws-cdk-lib/aws-events";
import { SfnStateMachine } from "aws-cdk-lib/aws-events-targets";
import { Role } from "aws-cdk-lib/aws-iam";
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

    new Queue(this, "WebhookQueueDLQ", {
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: new Queue(this, "WebhookQueueDLQ", {}),
      },
    });

    const webhookApi = new HttpApi(this, "WebhookApi", {});

    // TODO: https://docs.aws.amazon.com/cdk/api/v2/docs/@aws-cdk_aws-apigatewayv2-alpha.HttpIntegration.html
    // const webhookApiIntegration = new HttpRouteIntegration(
    //   this,
    //   "WebhookApiIntegration",
    //   {
    //     credentials: IntegrationCredentials.fromRole(
    //       new Role(this, "WebhookApiRole", {
    //         assumedBy: new ServicePrincipal("apigateway.amazonaws.com"),
    //       })
    //     ),
    //     method: HttpMethod.POST,
    //     payloadFormatVersion: PayloadFormatVersion.VERSION_1_0,
    //     parameterMapping: ParameterMapping.fromObject({
    //       QueueUrl: webhookQueue.queueUrl,
    //       // TODO: Encoded payload $util.base64Encode()
    //       MessageBody: MappingValue.requestBody("message"),
    //     }),
    //     subtype: HttpIntegrationSubtype.SQS_SEND_MESSAGE,
    //     type: HttpIntegrationType.AWS_PROXY,
    //   }
    // );

    const webhookApiAuthorizer = new LambdaFunction(this, "MyFunction", {
      code: Code.fromAsset(path.join(__dirname, "/.build")),
      handler: "authorizer.handler",
      runtime: Runtime.NODEJS_20_X,
    });

    webhookApi.addRoutes({
      authorizer: new HttpLambdaAuthorizer(
        "WebhookApiAuthorizer",
        webhookApiAuthorizer,
        {
          responseTypes: [HttpLambdaResponseType.SIMPLE],
          resultsCacheTtl: Duration.minutes(60),
        }
      ),
      integration: webhookApiIntegration,
      methods: [HttpMethod.POST],
      path: "/",
    });
  }
}

const app = new App();

new EdaWebhook(app, "EdaWebhook");

app.synth();
