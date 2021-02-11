import {Kube} from './Kube';
import {unitsToBytes} from '../helpers/convertMemory';
import {cpuUnitsToNumber} from '../helpers/convertCpu';

export class Node extends Kube {
  static kind = 'Node';

  spec: {
    podCIDR: string;
    externalID: string;
    taints?: {
      key: string;
      value: string;
      effect: string;
    }[];
    unschedulable?: boolean;
  };
  status: {
    capacity: {
      cpu: string;
      memory: string;
      pods: string;
    };
    allocatable: {
      cpu: string;
      memory: string;
      pods: string;
    };
    conditions: {
      type: string;
      status?: string;
      lastHeartbeatTime?: string;
      lastTransitionTime?: string;
      reason?: string;
      message?: string;
    }[];
    addresses: {
      type: string;
      address: string;
    }[];
    nodeInfo: {
      machineID: string;
      systemUUID: string;
      bootID: string;
      kernelVersion: string;
      osImage: string;
      containerRuntimeVersion: string;
      kubeletVersion: string;
      kubeProxyVersion: string;
      operatingSystem: string;
      architecture: string;
    };
    images: {
      names: string[];
      sizeBytes: number;
    }[];
  };

  constructor(node: any) {
    super();
    this.spec = node.spec;
    this.status = node.status;
    this.metadata = node.metadata;
  }

  getNodeConditionText() {
    const { conditions } = this.status;
    if (!conditions) {
      return '';
    }
    return conditions.reduce((types, current) => {
      if (current.status !== 'True') {
        return '';
      }
      return types += ` ${current.type}`;
    }, '');
  }

  getNodeInfo() {
    return this.status.nodeInfo;
  }

  getAddresses() {
    return this.status.addresses;
  }

  getTaints() {
    return this.spec.taints || [];
  }

  getRoleLabels() {
    const roleLabels = Object.keys(this.metadata.labels).filter(key =>
      key.includes('node-role.kubernetes.io'),
    ).map(key => key.match(/([^/]+$)/)[0]); // all after last slash

    if (this.metadata.labels['kubernetes.io/role'] != undefined) {
      roleLabels.push(this.metadata.labels['kubernetes.io/role']);
    }

    return roleLabels.join(', ');
  }

  getCpuCapacity() {
    if (!this.status.capacity || !this.status.capacity.cpu) {
      return 0;
    }
    return cpuUnitsToNumber(this.status.capacity.cpu);
  }

  getMemoryCapacity() {
    if (!this.status.capacity || !this.status.capacity.memory) {
      return 0;
    }
    return unitsToBytes(this.status.capacity.memory);
  }

  getConditions() {
    const conditions = this.status.conditions || [];
    if (this.isUnschedulable()) {
      return [{ type: 'SchedulingDisabled', status: 'True' }, ...conditions];
    }
    return conditions;
  }

  getActiveConditions() {
    return this.getConditions().filter(c => c.status === 'True');
  }

  getWarningConditions() {
    const goodConditions = ['Ready', 'HostUpgrades', 'SchedulingDisabled'];
    return this.getActiveConditions().filter(condition => {
      return !goodConditions.includes(condition.type);
    });
  }

  getKubeletVersion() {
    return this.status.nodeInfo.kubeletVersion;
  }

  getDistribution(apiUrl: string): string {
    if (this.status.nodeInfo.kubeletVersion.includes('gke')) {
      return 'gke';
    } else if (this.status.nodeInfo.kubeletVersion.includes('eks')) {
      return 'eks';
    } else if (this.status.nodeInfo.kubeletVersion.includes('IKS')) {
      return 'iks';
    } else if (apiUrl.endsWith('azmk8s.io')) {
      return 'aks';
    } else if (apiUrl.endsWith('k8s.ondigitalocean.com')) {
      return 'digitalocean';
    } else if (this.status.nodeInfo.kubeletVersion.includes('+')) {
      return 'custom';
    }

    return 'vanilla';
  }

  getOperatingSystem(): string {
    const label = this.labels.find(label => label.startsWith('kubernetes.io/os='));
    if (label) {
      return label.split('=', 2)[1];
    }

    return 'linux';
  }

  isUnschedulable() {
    return this.spec.unschedulable
  }
}


