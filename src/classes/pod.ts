import {Kube} from './Kube';
import {
  IContainerProbe,
  IPodContainer,
  IPodContainerStatus,
  IPodSpec,
  IPodStatus,
  PodStatus
} from '@microfunctions/common';

export class Pod extends Kube {
  private spec: IPodSpec;
  private status: IPodStatus;
  private requestOpts: any = {};

  constructor(pods: any) {
    super();
    this.spec = pods.spec;
    this.status = pods.status;
    this.metadata = pods.metadata;

  }

  getInitContainers() {
    return this.spec.initContainers || [];
  }

  getContainers() {
    return this.spec.containers || [];
  }

  get container() {
    return this.spec.containers[0] || null;
  }

  getAllContainers() {
    return this.getContainers().concat(this.getInitContainers());
  }

  getContainerStatuses(includeInitContainers = true) {
    const statuses: IPodContainerStatus[] = [];
    const { containerStatuses, initContainerStatuses } = this.status;
    if (containerStatuses) {
      statuses.push(...containerStatuses);
    }
    if (includeInitContainers && initContainerStatuses) {
      statuses.push(...initContainerStatuses);
    }
    return statuses;
  }
  getQosClass() {
    return this.status.qosClass || '';
  }

  getReason() {
    return this.status.reason || '';
  }


  // Returns one of 5 statuses: Running, Succeeded, Pending, Failed, Evicted
  getStatus() {
    const phase = this.getStatusPhase();
    const reason = this.getReason();
    const goodConditions = ['Initialized', 'Ready'].every(
      condition =>
        !!this.getConditions().find(
          item => item.type === condition && item.status === 'True',
        ),
    );
    if (reason === PodStatus.EVICTED) {
      return PodStatus.EVICTED;
    }
    if (phase === PodStatus.FAILED) {
      return PodStatus.FAILED;
    }
    if (phase === PodStatus.SUCCEEDED) {
      return PodStatus.SUCCEEDED;
    }
    if (phase === PodStatus.RUNNING && goodConditions) {
      return PodStatus.RUNNING;
    }
    return PodStatus.PENDING;
  }

  // Returns pod phase or container error if occured
  getStatusMessage() {
    let message = '';
    const statuses = this.getContainerStatuses(false); // not including initContainers
    if (statuses.length) {
      statuses.forEach(status => {
        const { state } = status;
        if (state.waiting) {
          const { reason } = state.waiting;
          message = reason ? reason : 'Waiting';
        }
        if (state.terminated) {
          const { reason } = state.terminated;
          message = reason ? reason : 'Terminated';
        }
      });
    }
    if (this.getReason() === PodStatus.EVICTED) {
      return 'Evicted';
    }
    if (message) {
      return message;
    }
    return this.getStatusPhase();
  }

  getStatusPhase() {
    return this.status.phase;
  }

  getConditions() {
    return this.status.conditions || [];
  }

  getVolumes() {
    return this.spec.volumes || [];
  }

  getSecrets(): string[] {
    return this.getVolumes()
      .filter(vol => vol.secret)
      .map(vol => vol.secret.secretName);
  }

  getNodeSelectors(): string[] {
    const { nodeSelector } = this.spec;
    if (!nodeSelector) {
      return [];
    }
    return Object.entries(nodeSelector).map(values => values.join(': '));
  }

  getTolerations() {
    return this.spec.tolerations || [];
  }

  /*getAffinity(): IAffinity {
    return this.spec.affinity
  }*/

  hasIssues() {
    const notReady = !!this.getConditions().find(condition => {
      return condition.type == 'Ready' && condition.status !== 'True';
    });
    const crashLoop = !!this.getContainerStatuses().find(condition => {
      const waiting = condition.state.waiting;
      return waiting && waiting.reason == 'CrashLoopBackOff';
    });
    return notReady || crashLoop || this.getStatusPhase() !== 'Running';
  }

  getLivenessProbe(container: IPodContainer) {
    return this.getProbe(container.livenessProbe);
  }

  getReadinessProbe(container: IPodContainer) {
    return this.getProbe(container.readinessProbe);
  }

  getProbe(probeData: IContainerProbe) {
    if (!probeData) {
      return [];
    }
    const {
      httpGet,
      exec,
      tcpSocket,
      initialDelaySeconds,
      timeoutSeconds,
      periodSeconds,
      successThreshold,
      failureThreshold,
    } = probeData;
    const probe = [];
    // HTTP Request
    if (httpGet) {
      const { path, port, host, scheme } = httpGet;
      probe.push(
        'http-get',
        `${scheme.toLowerCase()}://${host || ''}:${port || ''}${path || ''}`,
      );
    }
    // Command
    if (exec && exec.command) {
      probe.push(`exec [${exec.command.join(' ')}]`);
    }
    // TCP Probe
    if (tcpSocket && tcpSocket.port) {
      probe.push(`tcp-socket :${tcpSocket.port}`);
    }
    probe.push(
      `delay=${initialDelaySeconds || '0'}s`,
      `timeout=${timeoutSeconds || '0'}s`,
      `period=${periodSeconds || '0'}s`,
      `#success=${successThreshold || '0'}`,
      `#failure=${failureThreshold || '0'}`,
    );
    return probe;
  }

  getNodeName() {
    return this.spec?.nodeName;
  }
}
