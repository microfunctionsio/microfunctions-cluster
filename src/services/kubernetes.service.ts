import {HttpStatus, Injectable} from '@nestjs/common';
import {from, Observable, of, throwError} from 'rxjs';
import * as k8s from '@kubernetes/client-node';
import {catchError, map, mergeMap} from 'rxjs/operators';
import {Node} from '../classes/node';
import * as http from 'http';
import {ConfigService} from '@nestjs/config';
import * as yaml from 'js-yaml';
import {Cluster} from '../classes/cluster';
import {RpcException} from '@nestjs/microservices';
import {MessageErrorCode} from '../helpers/error.helpers';
import {promisify} from 'util';
import {Service} from "../classes/service";
import * as requestPromise from 'request-promise-native';
import fse = require('fs-extra');
import moment = require('moment');
import {IMetricsQuery, IMetricsReqParams, IPodMetrics, PodStatus} from "@microfunctions/common";
import {Pod} from "../classes/pod";
import {stringify} from "querystring";

interface RouteParams {
  [key: string]: string | undefined;
}

export interface IClusterMetrics extends IPodMetrics{

}
export type ApiRequest = {
  cluster?: Cluster;
  payload: any;
  raw?: {
    req: http.IncomingMessage;
  };
  params?: RouteParams;
  response?: http.ServerResponse;
  query: URLSearchParams;
  path: string;
  headers:any;
};

export interface IkubeConfig {
  kubeConfig: string,
  clusterName?: string,
  nodesCount?: number,
  version?: string,
  distribution?: string;
  server?: string;
  capacity?: any;
  name?: string;
  id?: string;
}

export class ClusterAccessError extends Error {
}

@Injectable()
export class KubernetesService {

  constructor(private configService: ConfigService) {

  }

  parseCluster(clusterconfig: string) {

    return of(clusterconfig).pipe(map((clusterconfig: string) => {
      const kc = new k8s.KubeConfig();
      kc.loadFromString(clusterconfig); // throws TypeError if we cannot parse kubeconfig
      const clusterInfo: IkubeConfig = {
        kubeConfig: this.dumpConfigYaml(kc),
        clusterName: kc.currentContext,

      };
      return clusterInfo;
    }));
  }

  public getCoreApi(kubeConfig: string) {
    try {
      const kc = new k8s.KubeConfig();
      kc.loadFromString(kubeConfig);
      const k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api);
      return k8sCoreApi;
    } catch (e) {
      throw new RpcException({
        status: HttpStatus.BAD_REQUEST,
        code: MessageErrorCode.CLUSTER_ERROR,
        message: e.message,
      });
    }

  }

  public getStorageClient(kubeConfig: string) {
    try {
      const kc = new k8s.KubeConfig();
      kc.loadFromString(kubeConfig);
      const storageClient = kc.makeApiClient(k8s.StorageV1Api);
      return storageClient;
    } catch (e) {
      throw new RpcException({
        status: HttpStatus.BAD_REQUEST,
        code: MessageErrorCode.CLUSTER_ERROR,
        message: e.message,
      });
    }
  }

  public getClusterInfo(kubeConfig: string): Observable<any> {
    const kc = new k8s.KubeConfig();
    kc.loadFromString(kubeConfig);
    const k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api);
    return from(k8sCoreApi.listNode()).pipe(
      catchError((error: any) => {

        if (error instanceof TypeError) {
          return throwError(error);
        }
        let errorMessage = error.message;
        if (error.statusCode) {
          if (error.statusCode >= 400 && error.statusCode < 500) {
            errorMessage = 'Invalid credentials';
          } else {
            errorMessage = error.error || error.message;
          }
        } else if (error.failed === true) {
          if (error.timedOut === true) {
            errorMessage = 'Connection timed out';
          } else {
            errorMessage = 'Failed to fetch credentials';
          }
        } else if (error.code) {
          errorMessage = error.code;
        }
        return throwError(errorMessage);
      }),
      map((response: any) => {
        return Object.values(response.body.items).map(
          (item: any) => {
            return new Node(item);
          },
        );
      }),
      map((nodes: Node[]) => {
        if (!nodes) {
          throw new ClusterAccessError('0 nodes');
        }
        const clusterInfo: IkubeConfig = { kubeConfig };
        const node: Node = nodes[0];

        const cpu: number = nodes.reduce((total, node) => total + (node.getCpuCapacity()), 0);
        const memory: number = nodes.reduce((total, node) => total + (node.getMemoryCapacity()), 0);
        clusterInfo.nodesCount = nodes.length;
        clusterInfo.server = kc.getCurrentCluster()?.server;
        clusterInfo.version = node.getKubeletVersion();
        clusterInfo.distribution = node.getDistribution(clusterInfo?.server);
        clusterInfo.capacity = { cpu, memory };
        return clusterInfo;
      }),
    );
  }
  public getNodes(kubeConfig: string): Observable<Node[]> {
    const kc = new k8s.KubeConfig();
    kc.loadFromString(kubeConfig);
    const k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api);
    return from(k8sCoreApi.listNode()).pipe(
        catchError((error: any) => {

          if (error instanceof TypeError) {
            return throwError(error);
          }
          let errorMessage = error.message;
          if (error.statusCode) {
            if (error.statusCode >= 400 && error.statusCode < 500) {
              errorMessage = 'Invalid credentials';
            } else {
              errorMessage = error.error || error.message;
            }
          } else if (error.failed === true) {
            if (error.timedOut === true) {
              errorMessage = 'Connection timed out';
            } else {
              errorMessage = 'Failed to fetch credentials';
            }
          } else if (error.code) {
            errorMessage = error.code;
          }
          return throwError(errorMessage);
        }),
        map((response: any) => {
          return Object.values(response.body.items).map(
              (item: any) => {
                return new Node(item);
              },
          );
        }),
        map((nodes: Node[]) => {
          if (!nodes) {
            throw new ClusterAccessError('0 nodes');
          }
          return nodes
        }),
    );
  }
  public getClusterMetrics(
      baseUrl: string,
      apiKey: string,
      nodes:Node[],
      rangePrame: number
  ): Observable<IClusterMetrics> {


    const rateAccuracy = "1m";
    const nodeSelector = nodes.map(node => node.name).join('|');
    const metrics: IMetricsQuery = {
      memoryUsage: `
          sum(
            node_memory_MemTotal_bytes - (node_memory_MemFree_bytes + node_memory_Buffers_bytes + node_memory_Cached_bytes)
          ) by (kubernetes_name)
        `.replace(/_bytes/g, `_bytes{kubernetes_node=~"${nodeSelector}"}`),
      memoryRequests: `sum(kube_pod_container_resource_requests{node=~"${nodeSelector}", resource="memory"}) by (component)`,
      memoryLimits: `sum(kube_pod_container_resource_limits{node=~"${nodeSelector}", resource="memory"}) by (component)`,
      memoryCapacity: `sum(kube_node_status_capacity{node=~"${nodeSelector}", resource="memory"}) by (component)`,
      cpuUsage: `sum(rate(node_cpu_seconds_total{kubernetes_node=~"${nodeSelector}", mode=~"user|system"}[${rateAccuracy}]))`,
      cpuRequests:`sum(kube_pod_container_resource_requests{node=~"${nodeSelector}", resource="cpu"}) by (component)`,
      cpuLimits: `sum(kube_pod_container_resource_limits{node=~"${nodeSelector}", resource="cpu"}) by (component)`,
      cpuCapacity: `sum(kube_node_status_capacity{node=~"${nodeSelector}", resource="cpu"}) by (component)`,
      podUsage: `sum({__name__=~"kubelet_running_pod_count|kubelet_running_pods", instance=~"${nodeSelector}"})`,
      podCapacity: `sum(kube_node_status_capacity{node=~"${nodeSelector}", resource="pods"}) by (component)`,
    }
    const reqParams: IMetricsReqParams = {};
    const {range = rangePrame || 1, step = 60} = reqParams;
    let {start, end} = reqParams;
    if (!start && !end) {
      const timeNow = Date.now() / 1000;
      const now = moment
          .unix(timeNow)
          .startOf('minute')
          .unix(); // round date to minutes
      start = now - range;
      end = now;
    }

    const path = `http://${baseUrl}/prometheus/api/v1/query_range`;

    const query: URLSearchParams = new URLSearchParams(
        stringify({
          start,
          end,
          step,
        }),
    );
    const headers = {
      'Content-type': 'application/json',
      'x-apikey-header': apiKey,
    };
    const request: ApiRequest = {
      payload: metrics,
      query: query,
      path,
      headers,
    };

    return from(this.getMetrics(request)).pipe(
        map((response: any) => {
          return response as IPodMetrics;
        }),
    );
  }

  private async getMetrics(request: ApiRequest) {

    const query: IMetricsQuery = request.payload;

    const metricsUrl = request.path;

    const queryParams: IMetricsQuery = {};
    request.query.forEach((value: string, key: string) => {
      queryParams[key] = value;
    });

    // prometheus metrics loader
    const attempts: { [query: string]: number } = {};
    const maxAttempts = 5;

    const loadMetrics = (orgQuery: string): Promise<any> => {
      const query = orgQuery.trim();
      const attempt = (attempts[query] = (attempts[query] || 0) + 1);
      return requestPromise
          .get(metricsUrl, {
            resolveWithFullResponse: false,
            headers: request.headers,
            json: true,
            // timeout: '333',
            qs: {
              query: query,
              ...queryParams,
            },
          })
          .catch(async error => {
            if (
                attempt < maxAttempts &&
                error.statusCode && error.statusCode != 404
            ) {
              await new Promise(resolve => setTimeout(resolve, attempt * 1000)); // add delay before repeating request
              return loadMetrics(query);
            }
            return {
              status: error.toString(),
              data: {
                result: [],
              },
            };
          });
    };

    // return data in same structure as query
    // return data in same structure as query
    let data: any;
    if (typeof query === 'string') {
      data = await loadMetrics(query);

    } else if (Array.isArray(query)) {
      data = await Promise.all(query.map(loadMetrics));

    } else {
      data = {};
      const result = await Promise.all(Object.values(query).map(loadMetrics));
      Object.keys(query).forEach((metricName, index) => {
        data[metricName] = result[index];
      });
    }
    return data;
  }
  public async apply(kubeConfig: string, spec: string, specPath?: string): Promise<k8s.KubernetesObject[]> {
    const kc = new k8s.KubeConfig();
    kc.loadFromString(kubeConfig);
    const client = k8s.KubernetesObjectApi.makeApiClient(kc);
    const fsReadFileP = promisify(fse.readFile);
    const specString = specPath ? await fsReadFileP(specPath, 'utf8') : spec;
    const specs: k8s.KubernetesObject[] = yaml.safeLoadAll(specString);
    const validSpecs = specs.filter((s) => s && s.kind && s.metadata);
    const created: k8s.KubernetesObject[] = [];
    for (const spec of validSpecs) {
      // this is to convince the old version of TypeScript that metadata exists even though we already filtered specs
      // without metadata out
      spec.metadata = spec.metadata || {};
      spec.metadata.annotations = spec.metadata.annotations || {};
      delete spec.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration'];
      spec.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration'] = JSON.stringify(spec);
      try {
        // try to get the resource, if it does not exist an error will be thrown and we will end up in the catch
        // block.
        await client.read(spec);
        // we got the resource, so it exists, so patch it
        const response = await client.patch(spec);
        created.push(response.body);
      } catch (e) {
        // we did not get the resource, so it does not exist, so create it
        const response = await client.create(spec);
        created.push(response.body);
      }
    }
    return created;
  }

  public async delete(kubeConfig: string, spec: string, specPath?: string): Promise<k8s.KubernetesObject[]> {
    const kc = new k8s.KubeConfig();
    kc.loadFromString(kubeConfig);
    const client = k8s.KubernetesObjectApi.makeApiClient(kc);
    const fsReadFileP = promisify(fse.readFile);
    const specString = specPath ? await fsReadFileP(specPath, 'utf8') : spec;
    const specs: k8s.KubernetesObject[] = yaml.safeLoadAll(specString);
    const validSpecs = specs.filter((s) => s && s.kind && s.metadata);
    const created: k8s.KubernetesObject[] = [];
    for (const spec of validSpecs) {
      // this is to convince the old version of TypeScript that metadata exists even though we already filtered specs
      // without metadata out
      spec.metadata = spec.metadata || {};
      spec.metadata.annotations = spec.metadata.annotations || {};
      delete spec.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration'];
      spec.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration'] = JSON.stringify(spec);
      try {
        // try to get the resource, if it does not exist an error will be thrown and we will end up in the catch
        // block.
        await client.read(spec);
        // we got the resource, so it exists, so patch it
        const response = await client.delete(spec);
        created.push(response.body);
      } catch (e) {
        throwError(e);
        // we did not get the resource, so it does not exist, so create it
        //  const response = await client.delete(spec);
        //   created.push(response.body);
      }
    }
    return created;
  }

  public isServiceExist(kubeConfig: IkubeConfig,namespaced:string, serviceName: string): Observable<boolean> {


    return of(kubeConfig.kubeConfig).pipe(
        mergeMap((kubeConfig$: string) => {
          const k8sCoreApi = this.getCoreApi(kubeConfig$);
          return from(k8sCoreApi.listNamespacedService(namespaced)).pipe(
              map((response: any) => {
                return Object.values(response.body.items).map(
                    (item: any) => {
                      return new Service(item);
                    },
                ).filter((service: Service) => service.getStatus() === "Active");
              }),
              map((services: Service[]) => {
                return services.find((s) => s.name.includes(serviceName)) ? true : false
              }),

          );
        }),
    );

  }

  public isDeploymentExist(kubeConfig: IkubeConfig,namespaced:string, deploymentName: string): Observable<boolean> {


    return of(kubeConfig.kubeConfig).pipe(
        mergeMap((kubeConfig$: string) => {
          const k8sCoreApi = this.getCoreApi(kubeConfig$);
          return from(k8sCoreApi.listNamespacedPod(namespaced)).pipe(
              map((response: any) => {
                return Object.values(response.body.items).map(
                    (item: any) => {
                      return new Pod(item);
                    },
                ).filter((pod: Pod) => pod.getStatus() === PodStatus.RUNNING);
              }),
              map((services: Pod[]) => {
                return services.find((s) => s.name.includes(deploymentName)) ? true : false
              }),

          );
        }),
    );

  }

  private dumpConfigYaml(kc: k8s.KubeConfig): string {

    const config = {
      apiVersion: 'v1',
      kind: 'Config',
      preferences: {},
      'current-context': kc.currentContext,
      clusters: kc.clusters.map(c => {
        return {
          name: c.name,
          cluster: {
            'certificate-authority-data': c.caData,
            'certificate-authority': c.caFile,
            server: c.server,
            'insecure-skip-tls-verify': c.skipTLSVerify,
          },
        };
      }),
      contexts: kc.contexts.map(c => {
        return {
          name: c.name,
          context: {
            cluster: c.cluster,
            user: c.user,
            namespace: c.namespace,
          },
        };
      }),
      users: kc.users.map(u => {
        return {
          name: u.name,
          user: {
            'client-certificate-data': u.certData,
            'client-certificate': u.certFile,
            'client-key-data': u.keyData,
            'client-key': u.keyFile,
            'auth-provider': u.authProvider,
            exec: u.exec,
            token: u.token,
            username: u.username,
            password: u.password,
          },
        };
      }),
    };

    // skipInvalid: true makes dump ignore undefined values
    return yaml.safeDump(config, { skipInvalid: true });
  }

}
