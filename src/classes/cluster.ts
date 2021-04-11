import {Kube} from './Kube';
import {ClusterStatus} from "@microfunctions/common";
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
      return ClusterStatus.REMOVING;
    }
    if (!this.status || !this.status) {
      return ClusterStatus.CREATING;
    }
    if (this.status.errorMessage) {
      return ClusterStatus.ERROR;
    }
    return ClusterStatus.ACTIVE;
  }
}
