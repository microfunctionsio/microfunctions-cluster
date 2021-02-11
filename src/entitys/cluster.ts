import {Expose} from 'class-transformer';
import {Prop, Schema, SchemaFactory} from '@nestjs/mongoose';
import {Document} from 'mongoose';


import {StatusCluster} from '../interfaces/status.cluster';

export type ClusterDocument = Cluster & Document;
class Capacity {
  memory: number;
  cpu: number;
}
@Schema()
export class Cluster {
  @Expose()
  id: string;
  @Prop({ required: true, index: true })
  @Expose()
  name: string;
  @Prop()
  @Expose()
  clusterName: string;
  @Prop()
  @Expose()
  nodesCount: number;
  @Prop()
  @Expose()
  version: string;
  @Prop()
  @Expose()
  distribution: string;
  @Prop()
  server: string;
  @Prop({type:Capacity})
  @Expose()
  capacity: Capacity;
  @Prop()
  kubeConfig: string;
  @Prop()
  ivString: string;
  @Prop({ required: true, index: true })
  idUser: string;
  @Expose()
  @Prop({type: StatusCluster})
  status: StatusCluster;
  @Expose()
  createdAt: Date;
  @Expose()
  updatedAt: Date;
  @Expose()
  canDelete: boolean;
  @Expose()
  canInstall: boolean;
  @Expose()
  canUninstall: boolean;
  @Expose()
  canShowStatus: boolean;

}
export const ClusterSchema = SchemaFactory.createForClass(Cluster);
ClusterSchema.index({ name: 1, idUser: 1 }, { unique: true });
