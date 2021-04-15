import {Controller, UseFilters, UseInterceptors} from '@nestjs/common';

import {ClusterService} from './services/cluster.service';
import {MessagePattern, Payload} from '@nestjs/microservices';
import {ClusterDto} from './dtos/cluster.dto';
import {GetUser} from './helpers/get-user.decorator';
import { ErrorsMicroFunctionInterceptor } from './interceptors/errors.interceptor';
import {IUser,IResponse, ClusterStatus ,ClusterSteps,MetricsConfiguration} from "@microfunctions/common";
@Controller()
@UseInterceptors(new ErrorsMicroFunctionInterceptor())
export class ClusterController {
  constructor(private readonly clusterService: ClusterService) {
  }

  @MessagePattern({ cmd: 'add-cluster' })
  addCluster(@Payload() cluster: ClusterDto, @GetUser() user: IUser) {
    return this.clusterService.addCluster(user, cluster);
  }

  @MessagePattern({ cmd: 'config-cluster' })
  configCluster(@Payload() cluster: ClusterDto, @GetUser() user: IUser) {
    return this.clusterService.getClusterConfig(user, cluster.idCluster);
  }

  @MessagePattern({ cmd: 'list-cluster' })
  listCluster(@GetUser() user: IUser) {
    return this.clusterService.listCluster(user);
  }

  @MessagePattern({ cmd: 'delete-cluster' })
  deleteCluster(@Payload() cluster: ClusterDto, @GetUser() user: IUser) {
    return this.clusterService.deleteCluster(user, cluster);
  }

  @MessagePattern({ cmd: 'install-cluster' })
  installCluster(@Payload() cluster: ClusterDto, @GetUser() user: IUser) {
    return this.clusterService.installCluster(user, cluster);
  }

  @MessagePattern({ cmd: 'uninstall-cluster' })
  uninstallCluster(@Payload() cluster: ClusterDto, @GetUser() user: IUser) {
    return this.clusterService.uninstallCluster(user, cluster);
  }

  @MessagePattern({ cmd: 'status-cluster' })
  getClusterStatus(@Payload() cluster: ClusterDto, @GetUser() user: IUser) {
    return this.clusterService.getClusterStatus(user, cluster);
  }

  @MessagePattern({ cmd: 'support-version-cluster' })
  listSupportVersion(@GetUser() user: IUser) {
    return this.clusterService.listSupportVersion(user);
  }
}
