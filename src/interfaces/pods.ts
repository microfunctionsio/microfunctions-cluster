

export interface IPodContainer {
  name: string;
  image: string;
  command?: string[];
  args?: string[];
  ports: {
    name?: string;
    containerPort: number;
    protocol: string;
  }[];
  resources?: {
    limits: {
      cpu: string;
      memory: string;
    };
    requests: {
      cpu: string;
      memory: string;
    };
  };
  env?: {
    name: string;
    value?: string;
    valueFrom?: {
      fieldRef?: {
        apiVersion: string;
        fieldPath: string;
      };
      secretKeyRef?: {
        key: string;
        name: string;
      };
      configMapKeyRef?: {
        key: string;
        name: string;
      };
    };
  }[];
  envFrom?: {
    configMapRef?: {
      name: string;
    };
  }[];
  volumeMounts?: {
    name: string;
    readOnly: boolean;
    mountPath: string;
  }[];
  livenessProbe?: IContainerProbe;
  readinessProbe?: IContainerProbe;
  imagePullPolicy: string;
}

export interface IPodContainerStatus {
  name: string;
  state: {
    [index: string]: object;
    running?: {
      startedAt: string;
    };
    waiting?: {
      reason: string;
      message: string;
    };
    terminated?: {
      startedAt: string;
      finishedAt: string;
      exitCode: number;
      reason: string;
    };
  };
  lastState: {};
  ready: boolean;
  restartCount: number;
  image: string;
  imageID: string;
  containerID: string;
}
export interface IContainerProbe {
  httpGet?: {
    path?: string;
    port: number;
    scheme: string;
    host?: string;
  };
  exec?: {
    command: string[];
  };
  tcpSocket?: {
    port: number;
  };
  initialDelaySeconds?: number;
  timeoutSeconds?: number;
  periodSeconds?: number;
  successThreshold?: number;
  failureThreshold?: number;
}

export interface IPodSpec {
  volumes?: {
    name: string;
    persistentVolumeClaim: {
      claimName: string;
    };
    secret: {
      secretName: string;
      defaultMode: number;
    };
  }[];
  initContainers: IPodContainer[];
  containers: IPodContainer[];
  restartPolicy: string;
  terminationGracePeriodSeconds: number;
  dnsPolicy: string;
  serviceAccountName: string;
  serviceAccount: string;
  priority: number;
  priorityClassName: string;
  nodeName: string;
  nodeSelector?: {
    [selector: string]: string;
  };
  securityContext: {};
  schedulerName: string;
  tolerations: {
    key: string;
    operator: string;
    effect: string;
    tolerationSeconds: number;
  }[];
  // affinity: IAffinity;
}
export interface IPodStatus {
  phase: string;
  conditions: {
    type: string;
    status: string;
    lastProbeTime: number;
    lastTransitionTime: string;
  }[];
  hostIP: string;
  podIP: string;
  startTime: string;
  initContainerStatuses?: IPodContainerStatus[];
  containerStatuses?: IPodContainerStatus[];
  qosClass: string;
  reason?: string;
}
