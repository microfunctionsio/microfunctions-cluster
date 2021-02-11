import {HttpStatus, Inject, Injectable} from '@nestjs/common';
import {ClusterDto} from '../dtos/cluster.dto';

import {Cluster, ClusterDocument} from '../entitys/cluster';

import {ClusterAccessError, IkubeConfig, KubernetesService} from './kubernetes.service';
import {ConfigService} from '@nestjs/config';
import {catchError, map, mergeMap, retryWhen, tap, toArray} from 'rxjs/operators';
import {RpcException} from '@nestjs/microservices';
import {catchErrorMongo, MessageErrorCode} from '../helpers/error.helpers';
import {from, Observable, of, throwError, timer} from 'rxjs';
import {plainToClass} from 'class-transformer';
import {StepEnum} from '../enums/step.enum';
import {StatusClusterEnums} from '../enums/status.cluster.Enums';
import {VisibilityCluster} from '../enums/visibility.cluster';
import {WINSTON_MODULE_PROVIDER} from 'nest-winston';
import {Logger} from 'winston';
import {Service} from '../classes/service';
import {User} from '../classes/user';
import {decrypt, encrypt} from '../helpers/symmetricCrypto';
import {MetricsConfiguration} from '../interfaces/metrics.configuration';
import {fromPromise} from 'rxjs/internal-compatibility';
import * as path from 'path';
import * as fs from 'fs';
import * as hb from 'handlebars';
import {StatusCluster} from '../interfaces/status.cluster';
import {StatusHist, StatusHistDocument} from '../entitys/status.hist';
import {v4 as uuid} from 'uuid';
import {fromArray} from 'rxjs/internal/observable/fromArray';
import {supportDistributions, supportVersions} from '../helpers/support.version';
import {IResponse} from "../interfaces/response";
import {MicroFunctionException} from "../errors/micro.function.Exception";
import {Messages, MessagesError} from "../messages";

import {Model} from "mongoose";
import {InjectModel} from "@nestjs/mongoose";

@Injectable()
export class ClusterService {
    private organizationSecret: string;

    constructor(
        @InjectModel(Cluster.name) private clusterModule: Model<ClusterDocument>,
        @InjectModel(StatusHist.name) private statusHistModule: Model<StatusHistDocument>,
        protected configService: ConfigService,
        private kubernetesService: KubernetesService,
        @Inject(WINSTON_MODULE_PROVIDER) protected readonly logger: Logger) {
        this.organizationSecret = this.configService.get('CLUSTER_SECRET');
    }

    public listSupportVersion(user: User) {

        return {
            status: HttpStatus.OK,
            data: {
                versions: supportVersions,
                distributions: supportDistributions,
            },
        };

    }

    public addCluster(user: User, clusterDto: ClusterDto) {

        return this.kubernetesService.parseCluster(clusterDto.config).pipe(
            mergeMap((clusterInfo: IkubeConfig) => {

                return this.kubernetesService.getNodes(clusterInfo.kubeConfig);
            }),
            catchError((error: any) => {
                console.log('addCluster raised:', error);
                let errorMsg;
                if (typeof error === 'string') {
                    errorMsg = error;
                } else if (error instanceof TypeError) {
                    errorMsg = 'cannot parse kubeconfig';
                } else if (error.response && error.response.statusCode === 401) {
                    errorMsg = 'invalid kubeconfig (access denied)';
                } else if (error.message) {
                    errorMsg = error.message;
                } else if (error instanceof ClusterAccessError) {
                    errorMsg = `Invalid kubeconfig context ${(error as any).context || (error as any).message}`;
                }
                const response: IResponse = {
                    status: HttpStatus.BAD_GATEWAY,
                    message: errorMsg,
                };
                throw new MicroFunctionException(response);
            })).pipe(mergeMap((clusterInfo: IkubeConfig) => {

            if (!this.isSupportVersion(clusterInfo)) {
                const response: IResponse = {
                    status: HttpStatus.BAD_GATEWAY,
                    message: `${clusterInfo.version} not Supported.`,
                };
                throw new MicroFunctionException(response);
            }
            const encryptConfig: {
                ivString: string,
                content: string
            } = encrypt(this.organizationSecret, clusterInfo.kubeConfig);
            const cluster: Cluster = new Cluster();
            cluster.idUser = user.id;
            cluster.name = clusterDto.name;
            cluster.kubeConfig = encryptConfig.content;
            cluster.ivString = encryptConfig.ivString;
            cluster.clusterName = clusterInfo.clusterName;
            cluster.nodesCount = clusterInfo.nodesCount;
            cluster.version = clusterInfo.version;
            cluster.distribution = clusterInfo.distribution;
            cluster.capacity = clusterInfo.capacity;
            cluster.status = {
                step: StepEnum.ADDED,
                status: StatusClusterEnums.ADDED,
            };
            const clusterModule = new this.clusterModule(cluster);

            return from(clusterModule.save()).pipe(
                catchError(err => {
                    const response: IResponse = {
                        status: HttpStatus.CONFLICT,
                        message: MessagesError.clusterAlreadyExists,
                    };
                    throw new MicroFunctionException(response);
                }),
                map(() => {
                    const response: IResponse = {
                        status: HttpStatus.CREATED,
                        id: clusterModule.id,
                    };
                    return response;

                })
            );

        }));
    }

    public listCluster(user: User): Observable<any> {

        return from(this.clusterModule.find().or([{idUser: user.id}, {visibility: VisibilityCluster.PUBLIC}])).pipe(
            catchError(err => catchErrorMongo(err, 'The application encountered an unexpected error')),
            mergeMap((clusters: Cluster[]) => from(clusters)),
            mergeMap((cluster: Cluster) => {
                cluster.canShowStatus = cluster.idUser === user.id;
                cluster.canDelete = cluster.idUser === user.id;
                cluster.canInstall = cluster.idUser === user.id && (cluster.status.step === StepEnum.ADDED ||
                    (cluster.status.step === StepEnum.UNINSTALL && cluster.status.status == StatusClusterEnums.UNINSTALL) || cluster.status.status === StatusClusterEnums.ERROR || false);
                cluster.canUninstall = false;//cluster.idUser === user.id && ((cluster.status.step === StepEnum.INSTALL && cluster.status.status == StatusClusterEnums.INSTALLED) || (cluster.status.step === StepEnum.ACTIVE && cluster.status.status == StatusClusterEnums.ACTIVE) || cluster.status.status === StatusClusterEnums.ERROR || false);
                cluster.kubeConfig = decrypt(this.organizationSecret, cluster.ivString, cluster.kubeConfig);

                return this.kubernetesService.getNodes(cluster.kubeConfig).pipe(
                    catchError((err) => {
                        this.logger.error('listCluster  Start ', {user, cluster, err});
                        cluster.status = {
                            step: StepEnum.ACTIVE,
                            status: StatusClusterEnums.ERROR,
                            message: err,
                        };
                        return of(cluster);
                    }),
                    map(() => cluster),
                );
            }),
            map((cluster$: any) => {
                const cluster: Cluster = plainToClass(Cluster, cluster$, {
                    excludeExtraneousValues: true,
                });
                return cluster;
            }),
            toArray(),
            map((clusters: Cluster[]) => {
                return {
                    status: HttpStatus.OK,
                    data: clusters,
                };
            }),
        );
    }

    public deleteCluster(user: User, cluster: ClusterDto) {
        this.logger.debug('deleteCluster  ', {user, cluster});
        return from(this.clusterModule.deleteOne({_id: cluster.idCluster, idUser: user.id})).pipe(
            map((resulta: any) => {
                return {
                    status: HttpStatus.ACCEPTED,
                    id: cluster.idCluster,
                };
            }),
        );
    }

    public getClusterStatus(user: User, cluster: ClusterDto) {
        return from(this.clusterModule.findOne().or([{idUser: user.id, _id: cluster.idCluster}, {
            _id: cluster.idCluster
        }])).pipe(
            mergeMap((cluster: any) => {
                return fromPromise(this.statusHistModule.find({idCluster: cluster._id})).pipe(
                    map((statusHist$: any) => {
                        const statusHist: StatusHist = plainToClass(StatusHist, statusHist$, {
                            excludeExtraneousValues: true,
                        });
                        return {
                            status: HttpStatus.OK,
                            data: {status: cluster.status, statusHist},
                        };

                    }),
                );
            }));

    }

    public getClusterConfig(user: User, idCluster: string): Observable<IResponse> {

        return from(this.clusterModule.findOne({_id: idCluster})).pipe(
            map((cluster: any) => {
                if (cluster) {
                    const kubeConfig = decrypt(this.organizationSecret, cluster.ivString, cluster.kubeConfig);
                    this.kubernetesService.getCoreApi(kubeConfig);
                    const clusterInfo: IkubeConfig = {kubeConfig: kubeConfig, name: cluster.name, id: cluster._id};
                    return {
                        status: HttpStatus.OK,
                        data: clusterInfo,
                    };
                } else {
                    const response: IResponse = {
                        status: HttpStatus.BAD_REQUEST,
                        message: MessagesError.clusterIsUndefined,
                    };
                    throw new MicroFunctionException(response);
                }
            }),
        );
    }

    public installCluster(user: User, cluster: ClusterDto) {
        this.logger.log('installCluster  Start ', {user, cluster});
        const uuidInstall: string = uuid();
        this.getClusterConfig(user, cluster.idCluster).pipe(
            map((response: IResponse) => response.data),
            mergeMap((kubeConfig: IkubeConfig) => {
                this.updateStatus(user, cluster.idCluster, {
                    step: StepEnum.INSTALL,
                    status: StatusClusterEnums.INSTALLING,
                });
                return this.creeteMfNameSpace(kubeConfig, uuidInstall).pipe(
                    mergeMap(() => {
                        return this.installKubeless(kubeConfig, uuidInstall);
                    }),
                    mergeMap(() => {
                        return this.installIngress(kubeConfig, uuidInstall).pipe(
                            mergeMap(() => {
                                return this.installKong(kubeConfig, uuidInstall);
                            }),
                            retryWhen(
                                this.retryStrategy({
                                    maxRetryAttempts: 5,
                                }),
                            ),
                        );
                    }),
                    mergeMap(() => {
                        return this.installCertManager(kubeConfig, uuidInstall).pipe(
                            mergeMap(() => {
                                return this.installCertClusterIssuer(kubeConfig, uuidInstall);
                            }),
                            retryWhen(
                                this.retryStrategy({
                                    maxRetryAttempts: 5,
                                }),
                            ),
                        );
                    }),
                    mergeMap(() => {
                        return this.installMetricsServer(kubeConfig, uuidInstall);
                    }),
                    mergeMap(() => {
                        return this.installPrometheus(kubeConfig, uuidInstall);
                    }),
                    mergeMap(() => {
                        return this.checkLoadBalancers(kubeConfig, uuidInstall).pipe(
                            retryWhen(
                                this.retryStrategy({
                                    maxRetryAttempts: 5,
                                }),
                            ),
                        );
                    }),
                );
            }),
        ).subscribe(() => {

        }, (err: any) => {
            this.logger.error('InstallCluster Err  ', {user, cluster, err});
            this.updateStatus(user, cluster.idCluster, {
                step: StepEnum.INSTALL,
                status: StatusClusterEnums.ERROR,
                message: err?.message || ''
            });
        }, () => {
            this.logger.log(' InstallCluster  End', {user, cluster});

            this.updateStatus(user, cluster.idCluster, {
                step: StepEnum.ACTIVE,
                status: StatusClusterEnums.ACTIVE,
            });
        });
        return of({
            status: HttpStatus.ACCEPTED,
            message: Messages.instalationCLusterProgress,
        });

    }

    public uninstallCluster(user: User, cluster: ClusterDto) {
        this.logger.log('uninstallCluster  Start', {user, cluster});
        const uuidInstall: string = uuid();

        this.getClusterConfig(user, cluster.idCluster).pipe(
            map((response: IResponse) => response.data),
            mergeMap((kubeConfig: IkubeConfig) => {
                this.updateStatus(user, cluster.idCluster, {
                    step: StepEnum.UNINSTALL,
                    status: StatusClusterEnums.UNINSTALLING,
                });
                return this.uninstallPrometheus(kubeConfig, uuidInstall).pipe(
                    mergeMap(() => {
                        return this.uninstallCertManager(kubeConfig, uuidInstall);
                    }),
                    mergeMap(() => {
                        return this.uninstallKong(kubeConfig, uuidInstall).pipe(
                            mergeMap(() => {
                                return this.uninstalIngress(kubeConfig, uuidInstall);
                            }),
                            retryWhen(
                                this.retryStrategy({
                                    maxRetryAttempts: 5,
                                }),
                            ),
                        );
                    }),
                    mergeMap(() => {
                        return this.uninstalKubeless(kubeConfig, uuidInstall);

                    }),
                    mergeMap(() => {
                        return this.deleteMfNameSpace(kubeConfig, uuidInstall);
                    }),
                );
            }),
        ).subscribe(() => {

        }, (err: any) => {
            this.logger.error('uninstallCluster err  ', {user, cluster, err});
            this.updateStatus(user, cluster.idCluster, {
                step: StepEnum.UNINSTALL,
                status: StatusClusterEnums.ERROR,
                message: err.message,
            });
        }, () => {
            this.logger.log('uninstallCluster  End ', {user, cluster});
            this.updateStatus(user, cluster.idCluster, {
                step: StepEnum.UNINSTALL,
                status: StatusClusterEnums.UNINSTALL,
            });
        });
        return of({
            status: HttpStatus.ACCEPTED,
            message: Messages.uninstallCLusterProgress,
        });

    }

    private updateStatus(user: User, idCluster: string, statusCluster: StatusCluster) {

        this.clusterModule.updateOne({_id: idCluster}, {status: statusCluster}).catch((err => {
            this.logger.error('updateStatus  ', {user, idCluster, err});
        }));
    }

    private checkLoadBalancers(kubeConfig: IkubeConfig, uuidInstall: string) {
        this.addClusterStatus({
            step: StepEnum.CHECKLOADBALANCERS,
            status: StatusClusterEnums.CHECKING,
        }, kubeConfig.id, uuidInstall);

        return of(kubeConfig.kubeConfig).pipe(
            mergeMap((kubeConfig$: string) => {
                const k8sCoreApi = this.kubernetesService.getCoreApi(kubeConfig$);
                return from(k8sCoreApi.listNamespacedService('microfunctions')).pipe(
                    map((response: any) => {
                        return Object.values(response.body.items).map(
                            (item: any) => {
                                return new Service(item);
                            },
                        ).filter((service: Service) => service.getStatus() === "Active");
                        ;
                    }),
                    map((services: Service[]) => {
                        const service: Service = services.find((service: Service) => service.isLoadBalancer());
                        const externalIp: string = service ? service.getExternalIps()[0] : null;
                        if (externalIp) {
                            return externalIp;
                        }
                        throwError('External Ip not found');

                    }),
                    catchError((err: any) => {
                        this.addClusterStatus({
                            step: StepEnum.CHECKLOADBALANCERS,
                            status: StatusClusterEnums.ERROR,
                            message: err.response.body.message,
                        }, kubeConfig.id, uuidInstall);
                        throw new RpcException({
                            step: StepEnum.CHECKLOADBALANCERS,
                            status: HttpStatus.EXPECTATION_FAILED,
                            code: MessageErrorCode.CLUSTER_ERROR,
                            message: err.message || err.response.body.message,
                        });
                    }),
                    tap(() => {
                        this.addClusterStatus({
                            step: StepEnum.CHECKLOADBALANCERS,
                            status: StatusClusterEnums.CHECKED,
                        }, kubeConfig.id, uuidInstall);
                    }),
                );
            }),
        );

    }

    private isServiceExist(kubeConfig: IkubeConfig, serviceName: string,namespaced:string='microfunctions'): Observable<boolean> {
        return this.kubernetesService.isServiceExist(kubeConfig, namespaced, serviceName);
    }

    private isDeploymentExist(kubeConfig: IkubeConfig, deploymentName: string): Observable<boolean> {
        return this.kubernetesService.isDeploymentExist(kubeConfig, 'microfunctions', deploymentName);
    }

    private installKubeless(kubeConfig: IkubeConfig, uuidInstall: string) {
        const kubelessVersion = '1.0.8';

        return this.isDeploymentExist(kubeConfig, 'kubeless').pipe(
            mergeMap((exist: boolean) => {
                if (exist)
                    return of(true);
                this.addClusterStatus({
                    step: StepEnum.INSTALLKUBELESS,
                    status: StatusClusterEnums.INSTALLING,
                }, kubeConfig.id, uuidInstall);
                return from(this.kubernetesService.apply(kubeConfig.kubeConfig, null, `${this.configService.get('MANIFEST_PATH')}kubeless/kubeless-v${kubelessVersion}.yaml`)).pipe(
                    catchError((err: any) => {
                        this.addClusterStatus({
                            step: StepEnum.INSTALLKUBELESS,
                            status: StatusClusterEnums.ERROR,
                            message: err.response.body.message,
                        }, kubeConfig.id, uuidInstall);
                        throw new RpcException({
                            step: StepEnum.INSTALLKUBELESS,
                            status: HttpStatus.EXPECTATION_FAILED,
                            code: MessageErrorCode.CLUSTER_ERROR,
                            message: err.response.body.message,
                        });
                    }),
                    tap(() => {
                        this.addClusterStatus({
                            step: StepEnum.INSTALLKUBELESS,
                            status: StatusClusterEnums.INSTALLED,
                        }, kubeConfig.id, uuidInstall);

                    }));
            }));


    }

    private uninstalKubeless(kubeConfig: IkubeConfig, uuidInstall: string) {
        const kubelessVersion = '1.0.7';
        this.addClusterStatus({
            step: StepEnum.UNINSTALLKUBELESS,
            status: StatusClusterEnums.UNINSTALL,
        }, kubeConfig.id, uuidInstall);
        return from(this.kubernetesService.delete(kubeConfig.kubeConfig, null, `${this.configService.get('MANIFEST_PATH')}kubeless/kubeless-v${kubelessVersion}.yaml`)).pipe(
            catchError((err: any) => {
                this.addClusterStatus({
                    step: StepEnum.UNINSTALLKUBELESS,
                    status: StatusClusterEnums.ERROR,
                    message: err.response.body.message,
                }, kubeConfig.id, uuidInstall);
                throw new RpcException({
                    step: StepEnum.UNINSTALLKUBELESS,
                    status: HttpStatus.EXPECTATION_FAILED,
                    code: MessageErrorCode.CLUSTER_ERROR,
                    message: err.response.body.message,
                });
            }),
            tap(() => {
                this.addClusterStatus({
                    step: StepEnum.UNINSTALLKUBELESS,
                    status: StatusClusterEnums.UNINSTALL,
                }, kubeConfig.id, uuidInstall);

            }));
    }

    private creeteMfNameSpace(kubeConfig: IkubeConfig, uuidInstall: string) {
        this.addClusterStatus({
            step: StepEnum.CREETENAMESPACE,
            status: StatusClusterEnums.CREATING,
        }, kubeConfig.id, uuidInstall);
        return from(this.kubernetesService.apply(kubeConfig.kubeConfig, null, `${this.configService.get('MANIFEST_PATH')}microfunctions.namespace.yaml`)).pipe(
            catchError((err: any) => {
                this.addClusterStatus({
                    step: StepEnum.CREETENAMESPACE,
                    status: StatusClusterEnums.ERROR,
                    message: err.message || err.response.body.message,
                }, kubeConfig.id, uuidInstall);
                throw new RpcException({
                    step: StepEnum.CREETENAMESPACE,
                    status: HttpStatus.EXPECTATION_FAILED,
                    code: MessageErrorCode.CLUSTER_ERROR,
                    message: err.message || err.response.body.message,
                });
            }),
            tap(() => {
                this.addClusterStatus({
                    step: StepEnum.CREETENAMESPACE,
                    status: StatusClusterEnums.CREATED,
                }, kubeConfig.id, uuidInstall);

            }));
    }

    private deleteMfNameSpace(kubeConfig: IkubeConfig, uuidInstall: string) {
        this.addClusterStatus({
            step: StepEnum.DELETENAMESPACE,
            status: StatusClusterEnums.REMOVING,
        }, kubeConfig.id, uuidInstall);
        return from(this.kubernetesService.delete(kubeConfig.kubeConfig, null, `${this.configService.get('MANIFEST_PATH')}microfunctions.namespace.yaml`)).pipe(
            catchError((err: any) => {
                this.addClusterStatus({
                    step: StepEnum.DELETENAMESPACE,
                    status: StatusClusterEnums.ERROR,
                    message: err.message || err.response.body.message,
                }, kubeConfig.id, uuidInstall);
                throw new RpcException({
                    step: StepEnum.DELETENAMESPACE,
                    status: HttpStatus.EXPECTATION_FAILED,
                    code: MessageErrorCode.CLUSTER_ERROR,
                    message: err.message || err.response.body.message,
                });
            }),
            tap(() => {
                this.addClusterStatus({
                    step: StepEnum.DELETENAMESPACE,
                    status: StatusClusterEnums.REMOVED,
                }, kubeConfig.id, uuidInstall);

            }));
    }

    private installMetricsServer(kubeConfig: IkubeConfig, uuidInstall: string) {
        const metricsServerVersion = '0.4.2';


        return this.isServiceExist(kubeConfig,'metrics-server','microfunctions').pipe(
            mergeMap((exist: boolean) => {
                if (exist)
                    return of(true);
                this.addClusterStatus({
                    step: StepEnum.INSTALLMETRICSSERVER,
                    status: StatusClusterEnums.INSTALLING,
                }, kubeConfig.id, uuidInstall);
                return from(this.kubernetesService.apply(kubeConfig.kubeConfig, null, `${this.configService.get('MANIFEST_PATH')}metrics-server/components-v${metricsServerVersion}.yaml`)).pipe(
                    catchError((err: any) => {
                        this.addClusterStatus({
                            step: StepEnum.INSTALLMETRICSSERVER,
                            status: StatusClusterEnums.ERROR,
                            message: err.message || err.response.body.message,
                        }, kubeConfig.id, uuidInstall);
                        throw new RpcException({
                            step: StepEnum.INSTALLMETRICSSERVER,
                            status: HttpStatus.EXPECTATION_FAILED,
                            code: MessageErrorCode.CLUSTER_ERROR,
                            message: err.message || err.response.body.message,
                        });
                    }),
                    tap(() => {
                        this.addClusterStatus({
                            step: StepEnum.INSTALLMETRICSSERVER,
                            status: StatusClusterEnums.INSTALLED,
                        }, kubeConfig.id, uuidInstall);

                    }));

            })
        )

    }
    private installCertManager(kubeConfig: IkubeConfig, uuidInstall: string) {
        const certManagerVersion = '1.1.0';


        return this.isServiceExist(kubeConfig, 'cert-manager').pipe(
            mergeMap((exist: boolean) => {
                if (exist)
                    return of(true);
                this.addClusterStatus({
                    step: StepEnum.INSTALLCERTMANAGER,
                    status: StatusClusterEnums.INSTALLING,
                }, kubeConfig.id, uuidInstall);
                return from(this.kubernetesService.apply(kubeConfig.kubeConfig, null, `${this.configService.get('MANIFEST_PATH')}cert-manager/cert-manager-v${certManagerVersion}.yaml`)).pipe(
                    catchError((err: any) => {
                        this.addClusterStatus({
                            step: StepEnum.INSTALLCERTMANAGER,
                            status: StatusClusterEnums.ERROR,
                            message: err.message || err.response.body.message,
                        }, kubeConfig.id, uuidInstall);
                        throw new RpcException({
                            step: StepEnum.INSTALLCERTMANAGER,
                            status: HttpStatus.EXPECTATION_FAILED,
                            code: MessageErrorCode.CLUSTER_ERROR,
                            message: err.message || err.response.body.message,
                        });
                    }),
                    tap(() => {
                        this.addClusterStatus({
                            step: StepEnum.INSTALLCERTMANAGER,
                            status: StatusClusterEnums.INSTALLED,
                        }, kubeConfig.id, uuidInstall);

                    }));

            })
        )

    }
    private installCertClusterIssuer(kubeConfig: IkubeConfig, uuidInstall: string) {
        this.addClusterStatus({
            step: StepEnum.ADDCERTCLUSTERISSUER,
            status: StatusClusterEnums.ADDED,
        }, kubeConfig.id, uuidInstall);
        return from(this.kubernetesService.apply(kubeConfig.kubeConfig, null, `${this.configService.get('MANIFEST_PATH')}cert-manager/clusterIssuer.yaml`)).pipe(
            catchError((err: any) => {
                this.addClusterStatus({
                    step: StepEnum.ADDCERTCLUSTERISSUER,
                    status: StatusClusterEnums.ERROR,
                    message: err.message || err.response.body.message,
                }, kubeConfig.id, uuidInstall);
                throw new RpcException({
                    step: StepEnum.ADDCERTCLUSTERISSUER,
                    status: HttpStatus.EXPECTATION_FAILED,
                    code: MessageErrorCode.CLUSTER_ERROR,
                    message: err.message || err.response.body.message,
                });
            }),
            tap(() => {
                this.addClusterStatus({
                    step: StepEnum.ADDCERTCLUSTERISSUER,
                    status: StatusClusterEnums.ADDED,
                }, kubeConfig.id, uuidInstall);

            }));
    }

    private uninstallCertManager(kubeConfig: IkubeConfig, uuidInstall: string) {
        const certManagerVersion = '1.1.0';

        this.addClusterStatus({
            step: StepEnum.UNINSTALLCERTMANAGER,
            status: StatusClusterEnums.UNINSTALL,
        }, kubeConfig.id, uuidInstall);
        return from(this.kubernetesService.delete(kubeConfig.kubeConfig, null, `${this.configService.get('MANIFEST_PATH')}cert-manager/cert-manager-v${certManagerVersion}.yaml`)).pipe(
            catchError((err: any) => {
                this.addClusterStatus({
                    step: StepEnum.UNINSTALLCERTMANAGER,
                    status: StatusClusterEnums.ERROR,
                    message: err.message || err.response.body.message,
                }, kubeConfig.id, uuidInstall);
                throw new RpcException({
                    step: StepEnum.UNINSTALLCERTMANAGER,
                    status: HttpStatus.EXPECTATION_FAILED,
                    code: MessageErrorCode.CLUSTER_ERROR,
                    message: err.message || err.response.body.message,
                });
            }),
            tap(() => {
                this.addClusterStatus({
                    step: StepEnum.UNINSTALLCERTMANAGER,
                    status: StatusClusterEnums.UNINSTALL,
                }, kubeConfig.id, uuidInstall);

            }));

    }

    private installPrometheus(kubeConfig: IkubeConfig, uuidInstall: string) {
        this.addClusterStatus({
            step: StepEnum.INSTALLPROMETHEUS,
            status: StatusClusterEnums.INSTALLING,
        }, kubeConfig.id, uuidInstall);
        const name = 'metrics';

        const config: MetricsConfiguration = {
            persistence: {
                enabled: false,
                storageClass: null,
                size: '10G',
            },
            nodeExporter: {
                enabled: true,
            },
            retention: {
                time: '7d',
                size: '5GB',
            },
            kubeStateMetrics: {
                enabled: true,
            },
            alertManagers: null,
            replicas: 1,
            storageClass: null,
        };
        const storageClient = this.kubernetesService.getStorageClient(kubeConfig.kubeConfig);
        return of(storageClient).pipe(
            mergeMap((storageClient: any) => {
                return fromPromise(storageClient.listStorageClass()).pipe(map((scs: any) => {
                    scs.body.items.forEach(sc => {
                        if (sc.metadata.annotations &&
                            (sc.metadata.annotations['storageclass.kubernetes.io/is-default-class'] === 'true' || sc.metadata.annotations['storageclass.beta.kubernetes.io/is-default-class'] === 'true')) {
                            config.persistence.enabled = false;//true par defaut
                        }
                    });
                    return config;
                }));
            }),
            mergeMap((config: any) => {
                const resources = this.renderTemplates(config, name);
                return fromArray(resources).pipe(
                    mergeMap((resource: string) => {
                        return from(this.kubernetesService.apply(kubeConfig.kubeConfig, resource, null));
                    }),
                );

            }),
            catchError((err: any) => {
                this.addClusterStatus({
                    step: StepEnum.INSTALLPROMETHEUS,
                    status: StatusClusterEnums.ERROR,
                    message: err.message || err.response.body.message,
                }, kubeConfig.id, uuidInstall);
                throw new RpcException({
                    step: StepEnum.INSTALLPROMETHEUS,
                    status: HttpStatus.EXPECTATION_FAILED,
                    code: MessageErrorCode.CLUSTER_ERROR,
                    message: err.message || err.response.body.message,
                });
            }),
            tap(() => {
                this.addClusterStatus({
                    step: StepEnum.INSTALLPROMETHEUS,
                    status: StatusClusterEnums.INSTALLED,
                }, kubeConfig.id, uuidInstall);

            }),
        );

    }

    private uninstallPrometheus(kubeConfig: IkubeConfig, uuidInstall: string) {
        this.addClusterStatus({
            step: StepEnum.UNINSTALLPROMETHEUS,
            status: StatusClusterEnums.UNINSTALL,
        }, kubeConfig.id, uuidInstall);
        const name = 'metrics';
        const config: MetricsConfiguration = {
            persistence: {
                enabled: false,
                storageClass: null,
                size: '10G',
            },
            nodeExporter: {
                enabled: true,
            },
            retention: {
                time: '7d',
                size: '5GB',
            },
            kubeStateMetrics: {
                enabled: true,
            },
            alertManagers: null,
            replicas: 1,
            storageClass: null,
        };
        return of(config).pipe(
            mergeMap((config$: any) => {
                const resources: string[] = this.renderTemplates(config$, name);
                return fromArray(resources.reverse()).pipe(
                    mergeMap((resource: string) => {
                        return from(this.kubernetesService.delete(kubeConfig.kubeConfig, resource, null));
                    }),
                );

            }),
            catchError((err: any) => {
                this.addClusterStatus({
                    step: StepEnum.UNINSTALLPROMETHEUS,
                    status: StatusClusterEnums.ERROR,
                    message: err.message || err.response.body.message,
                }, kubeConfig.id, uuidInstall);
                throw new RpcException({
                    step: StepEnum.UNINSTALLPROMETHEUS,
                    status: HttpStatus.EXPECTATION_FAILED,
                    code: MessageErrorCode.CLUSTER_ERROR,
                    message: err.message || err.response.body.message,
                });
            }),
            tap(() => {
                this.addClusterStatus({
                    step: StepEnum.UNINSTALLPROMETHEUS,
                    status: StatusClusterEnums.UNINSTALL,
                }, kubeConfig.id, uuidInstall);

            }),
        );

    }

    private installKong(kubeConfig: IkubeConfig, uuidInstall: string) {
        const kongVersion = '2.0.5';
        return this.isServiceExist(kubeConfig, 'kong').pipe(
            mergeMap((exist: boolean) => {
                if (exist)
                    return of(true);
                this.addClusterStatus({
                    step: StepEnum.INSTALLKONG,
                    status: StatusClusterEnums.INSTALLING,
                }, kubeConfig.id, uuidInstall);
                return from(this.kubernetesService.apply(kubeConfig.kubeConfig, null, `${this.configService.get('MANIFEST_PATH')}kong/kong-v${kongVersion}.yaml`)).pipe(
                    catchError((err: any) => {
                        this.addClusterStatus({
                            step: StepEnum.INSTALLKONG,
                            status: StatusClusterEnums.ERROR,
                            message: err.message || err.response.body.message,
                        }, kubeConfig.id, uuidInstall);
                        throw new RpcException({
                            step: StepEnum.INSTALLKONG,
                            status: HttpStatus.EXPECTATION_FAILED,
                            code: MessageErrorCode.CLUSTER_ERROR,
                            message: err.message || err.response.body.message,
                        });
                    }),
                    tap(() => {
                        this.addClusterStatus({
                            step: StepEnum.INSTALLKONG,
                            status: StatusClusterEnums.INSTALLED,
                        }, kubeConfig.id, uuidInstall);

                    }));
            })
        )

    }

    private uninstallKong(kubeConfig: IkubeConfig, uuidInstall: string) {
        const kongVersion = '2.0.5';

        this.addClusterStatus({
            step: StepEnum.UNINSTALLKONG,
            status: StatusClusterEnums.UNINSTALL,
        }, kubeConfig.id, uuidInstall);
        return from(this.kubernetesService.delete(kubeConfig.kubeConfig, null, `${this.configService.get('MANIFEST_PATH')}kong/kong-v${kongVersion}.yaml`)).pipe(
            catchError((err: any) => {
                this.addClusterStatus({
                    step: StepEnum.UNINSTALLKONG,
                    status: StatusClusterEnums.ERROR,
                    message: err.message || err.response.body.message,
                }, kubeConfig.id, uuidInstall);
                throw new RpcException({
                    step: StepEnum.UNINSTALLKONG,
                    status: HttpStatus.EXPECTATION_FAILED,
                    code: MessageErrorCode.CLUSTER_ERROR,
                    message: err.message || err.response.body.message,
                });
            }),
            tap(() => {
                this.addClusterStatus({
                    step: StepEnum.UNINSTALLKONG,
                    status: StatusClusterEnums.UNINSTALL,
                }, kubeConfig.id, uuidInstall);

            }));
    }

    private installIngress(kubeConfig: IkubeConfig, uuidInstall: string) {
        const kubelessVersion = '0.41.2';

        return this.isServiceExist(kubeConfig, 'nginx-ingress').pipe(
            mergeMap((exist: boolean) => {
                if (exist)
                    return of(true);
                this.addClusterStatus({
                    step: StepEnum.INSTALLINGRESS,
                    status: StatusClusterEnums.INSTALLING,
                }, kubeConfig.id, uuidInstall);
                return from(this.kubernetesService.apply(kubeConfig.kubeConfig, null, `${this.configService.get('MANIFEST_PATH')}ingress/do/ingress-v${kubelessVersion}.yaml`)).pipe(
                    catchError((err: any) => {
                        this.addClusterStatus({
                            step: StepEnum.INSTALLINGRESS,
                            status: StatusClusterEnums.ERROR,
                            message: err.message || err.response.body.message,
                        }, kubeConfig.id, uuidInstall);
                        throw new RpcException({
                            step: StepEnum.INSTALLINGRESS,
                            status: HttpStatus.EXPECTATION_FAILED,
                            code: MessageErrorCode.CLUSTER_ERROR,
                            message: err.message || err.response.body.message,
                        });
                    }),
                    tap(() => {
                        this.addClusterStatus({
                            step: StepEnum.INSTALLINGRESS,
                            status: StatusClusterEnums.INSTALLED,
                        }, kubeConfig.id, uuidInstall);

                    }));
            })
        )

    }

    private uninstalIngress(kubeConfig: IkubeConfig, uuidInstall: string) {
        const kubelessVersion = '0.41.2';
        this.addClusterStatus({
            step: StepEnum.UNINSTALLINGRESS,
            status: StatusClusterEnums.UNINSTALL,
        }, kubeConfig.id, uuidInstall);
        return from(this.kubernetesService.delete(kubeConfig.kubeConfig, null, `${this.configService.get('MANIFEST_PATH')}/ingress/do/ingress-v${kubelessVersion}.yaml`)).pipe(
            catchError((err: any) => {
                this.addClusterStatus({
                    step: StepEnum.UNINSTALLINGRESS,
                    status: StatusClusterEnums.ERROR,
                    message: err.message || err.response.body.message,
                }, kubeConfig.id, uuidInstall);
                throw new RpcException({
                    step: StepEnum.UNINSTALLINGRESS,
                    status: HttpStatus.EXPECTATION_FAILED,
                    code: MessageErrorCode.CLUSTER_ERROR,
                    message: err.message || err.response.body.message,
                });
            }),
            tap(() => {
                this.addClusterStatus({
                    step: StepEnum.UNINSTALLINGRESS,
                    status: StatusClusterEnums.UNINSTALL,
                }, kubeConfig.id, uuidInstall);

            }));
    }

    private retryStrategy = ({
                                 maxRetryAttempts = 20,
                                 retryDuration = 10000,
                                 excludedStatusCodes = [],
                             }: {
        maxRetryAttempts?: number;
        retryDuration?: number;
        excludedStatusCodes?: number[];
    } = {}) => (attempts: Observable<any>) => {
        return attempts.pipe(
            mergeMap((error: any, i) => {

                const retryAttempt = i + 1;

                if (retryAttempt > maxRetryAttempts) {
                    console.error(`Falied to apply after ${maxRetryAttempts} retries `);
                    return throwError(error);
                }
                console.error(
                    `ERROR:  failed to be apply : retryAttempt[${retryAttempt}]`,
                );

                return timer(retryDuration);
            }),
        );
    };

    private addClusterStatus(statusCluster: StatusCluster, idCluster: string, uuidInstall: string) {
        const statusHist: StatusHist = new StatusHist();
        statusHist.idCluster = idCluster;
        statusHist.step = statusCluster.step;
        statusHist.status = statusCluster.status;
        statusHist.message = statusCluster.message;
        statusHist.uuidInstall = uuidInstall;

        this.statusHistModule.findOneAndUpdate({
            idCluster: idCluster,
            step: statusCluster.step,
        }, statusHist, {upsert: true, new: true}, (err, res) => {

            // Deal with the response data/error
        });
    }

    private renderTemplates(config: any, manifest: string) {
        console.log('starting to render resources...');
        const resources: string[] = [];
        fs.readdirSync(this.manifestPath(manifest)).forEach((f) => {
            const file = path.join(this.manifestPath(manifest), f);
            console.log('processing file:', file);
            const raw = fs.readFileSync(file);
            console.log('raw file loaded');
            if (f.endsWith('.hb')) {
                console.log('processing HB template');
                const template = hb.compile(raw.toString());
                resources.push(template(config));
                console.log('HB template done');
            } else {
                console.log('using as raw, no HB detected');
                resources.push(raw.toString());
            }
        });

        return resources;
    }

    private manifestPath(manifest: string) {
        return path.join(this.configService.get('MANIFEST_PATH'), manifest);
    }

    private isSupportVersion(clusterInfo: IkubeConfig): boolean {
        if (process.env.NODE_ENV !== 'production') {
            return true;
        }
        const versions: string[] = clusterInfo.version.split('.');
        const version = `${versions[0]}.${versions[1]}.*`;

        return supportVersions.includes(version) && (supportDistributions.includes(clusterInfo.distribution) || clusterInfo.distribution === 'custom' || clusterInfo.distribution === 'vanilla');
    }
}
