import {RpcException} from "@nestjs/microservices";
import {IResponse} from "@microfunctions/common";

export class MicroFunctionException extends RpcException {
  status: number;
  constructor(private readonly response: IResponse) {
    super(response);
    this.message = response.message;
    this.status = response.status;
  }



  public getError(): string | object {
    return this.message;
  }
}
