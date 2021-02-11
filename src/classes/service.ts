import {Kube} from './Kube';

export class Service extends Kube {
  static kind = 'Service';

  spec: {
    type: string;
    clusterIP: string;
    externalTrafficPolicy?: string;
    loadBalancerIP?: string;
    sessionAffinity: string;
    selector: { [key: string]: string };
    ports: any[];
    externalIPs?: string[]; // https://kubernetes.io/docs/concepts/services-networking/service/#external-ips
  };

  status: {
    loadBalancer?: {
      ingress?: {
        ip?: string;
        hostname?: string;
      }[];
    };
  };

  constructor(service: any) {
    super();
    this.spec = service.spec;
    this.status = service.status;
    this.metadata = service.metadata;
  }

  getClusterIp() {
    return this.spec.clusterIP;
  }

  getExternalIps() {
    const lb = this.getLoadBalancer();
    if (lb && lb.ingress) {
      return lb.ingress.map(val => val.ip || val.hostname);
    }
    return this.spec.externalIPs || [];
  }

  getType() {
    return this.spec.type || '-';
  }

  getSelector(): string[] {
    if (!this.spec.selector) {
      return [];
    }
    return Object.entries(this.spec.selector).map(val => val.join('='));
  }

  getLoadBalancer() {
    return this.status.loadBalancer;
  }

  isActive() {
    return this.getType() !== 'LoadBalancer' || this.getExternalIps().length > 0;
  }

  isLoadBalancer() {
    return this.getType() === 'LoadBalancer' || this.getExternalIps().length > 0;
  }

  getStatus() {
    return this.isActive() ? 'Active' : "Pending";
  }
}
