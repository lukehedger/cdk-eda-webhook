import { App, Stack, StackProps } from "aws-cdk-lib";
import {
  Code,
  Function as LambdaFunction,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import path from "node:path";

export class EdaWebhook extends Stack {
  constructor(scope: App, id: string, props?: StackProps) {
    super(scope, id, props);

    new LambdaFunction(this, "MyFunction", {
      code: Code.fromAsset(path.join(__dirname, "/.build")),
      handler: "authorizer.handler",
      runtime: Runtime.NODEJS_20_X,
    });
  }
}

const app = new App();

new EdaWebhook(app, "EdaWebhook");

app.synth();
