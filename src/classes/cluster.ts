import {Kube} from './Kube';
import {StatusClusterEnums} from '../enums/status.cluster.Enums';

export class Cluster extends Kube {
  spec: {
    clusterNetwork?: {
      serviceDomain?: string;
      pods?: {
        cidrBlocks?: string[];
      };
      services?: {
        cidrBlocks?: string[];
      };
    };
    providerSpec: {
      value: {
        profile: string;
      };
    };
  };
  status?: {
    apiEndpoints: {
      host: string;
      port: string;
    }[];
    providerStatus: {
      adminUser?: string;
      adminPassword?: string;
      kubeconfig?: string;
      processState?: string;
      lensAddress?: string;
    };
    errorMessage?: string;
    errorReason?: string;
  };

  getStatus() {
    if (this.metadata.deletionTimestamp) {
      return StatusClusterEnums.REMOVING;
    }
    if (!this.status || !this.status) {
      return StatusClusterEnums.CREATING;
    }
    if (this.status.errorMessage) {
      return StatusClusterEnums.ERROR;
    }
    return StatusClusterEnums.ACTIVE;
  }
}
