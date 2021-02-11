import {StepEnum} from '../enums/step.enum';
import {StatusClusterEnums} from '../enums/status.cluster.Enums';
import {Expose} from 'class-transformer';
import {Prop, Schema, SchemaFactory} from '@nestjs/mongoose';
import {Document} from 'mongoose';

export type StatusHistDocument = StatusHist & Document;
@Schema()
export class StatusHist {
  @Expose()
  id: string;
  @Expose()
  @Prop()
  uuidInstall: string;
  @Expose()
  @Prop({type:StepEnum})
  step: StepEnum;
  @Expose()
  @Prop({type:StatusClusterEnums})
  status: StatusClusterEnums;
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
