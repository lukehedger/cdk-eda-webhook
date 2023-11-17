import {
  APIGatewayRequestAuthorizerEventV2,
  APIGatewaySimpleAuthorizerResult,
} from "aws-lambda";

export const handler = async (
  event: APIGatewayRequestAuthorizerEventV2
): Promise<APIGatewaySimpleAuthorizerResult> => {
  console.log(event);

  return {
    isAuthorized: true,
  };
};
