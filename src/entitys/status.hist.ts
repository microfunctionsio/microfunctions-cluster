
import {Expose} from 'class-transformer';
import {Prop, Schema, SchemaFactory} from '@nestjs/mongoose';
import {Document} from 'mongoose';
import {ClusterStatus,ClusterSteps} from "@microfunctions/common";
export type StatusHistDocument = StatusHist & Document;
@Schema()
export class StatusHist {
  @Expose()
  id: string;
  @Expose()
  @Prop()
  uuidInstall: string;
  @Expose()
  @Prop({type:ClusterSteps})
  step: ClusterSteps;
  @Expose()
  @Prop({type:ClusterStatus})
  status: ClusterStatus;
  @Expose()
  @Prop()
  message: string;
  @Expose()
  createdAt: Date;
  @Expose()
  updatedAt: Date;
  @Prop({ required: true, index: true })
  idCluster: string;

}

export const StatusHistSchema = SchemaFactory.createForClass(StatusHist);
