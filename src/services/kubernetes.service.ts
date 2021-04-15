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

import fse = require('fs-extra');

import {PodStatus} from "@microfunctions/common";
import {Pod} from "../classes/pod";

interface RouteParams {
  [key: string]: string | undefined;
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

  public getNodes(kubeConfig: string): Observable<any> {
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
                console.log(services.map((s) => s.name))
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
                console.log(services.map((s) => s.name))
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
