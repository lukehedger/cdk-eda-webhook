import { APIGatewayRequestAuthorizerEventV2 } from "aws-lambda";

export const handler = async (event: APIGatewayRequestAuthorizerEventV2) => {
  console.log(event);

  return {
    isAuthorized: true,
  };
};
