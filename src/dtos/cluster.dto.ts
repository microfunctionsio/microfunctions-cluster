import {VisibilityCluster} from '../enums/visibility.cluster';

export class ClusterDto {
  idCluster: string;
  //Kubernetes cluster name
  name: string;

  config: string;

  visibility: VisibilityCluster;

}
