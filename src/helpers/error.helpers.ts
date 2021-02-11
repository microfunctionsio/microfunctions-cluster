import {HttpStatus} from '@nestjs/common';

import {RpcException} from '@nestjs/microservices';

export enum MessageErrorCode {
  FNEXISTS = 11000,
  FN_NOT_EXISTS = 11001,
  NAMESPACEXISTS = 12000,
  QUOTAS_LIMIT = 13000,
  CLUSTER_ERROR = 14,
  SERVERLESS_ERROR = 15
}

export const catchErrorMongo = (err: any, message?: string, code?: MessageErrorCode) => {
  console.error('err', err);
  throw new RpcException({
    status: HttpStatus.CONFLICT,
    code: MessageErrorCode.FNEXISTS || code,
    message: message || 'Internal server error ',
  });
};

export const catchErrorQuotas = (err: any, message?: string) => {

  throw new RpcException({
    status: HttpStatus.NOT_ACCEPTABLE,
    code: MessageErrorCode.QUOTAS_LIMIT,
    message: message || 'Internal server error ',
  });
};
export const catchErrorServerless = (err: any) => {
  console.error('catchErrorServerless', err);
  throw new RpcException({
    status: HttpStatus.EXPECTATION_FAILED,
    code: MessageErrorCode.SERVERLESS_ERROR,
    message: err,
  });
};
