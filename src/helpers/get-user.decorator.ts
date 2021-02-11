import {createParamDecorator, ExecutionContext, ForbiddenException} from '@nestjs/common';
import {IsNotEmptyObject} from 'class-validator';

export const GetUser = createParamDecorator(
  (data: any, ctx: ExecutionContext): any => {
    const request = ctx.switchToRpc().getData();
    if (IsNotEmptyObject(request.user)) {
      delete request.user.profiles;
      return request.user;
    }
    throw new ForbiddenException();
  },
);
