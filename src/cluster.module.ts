import {Module} from '@nestjs/common';
import {ClusterController} from './cluster.controller';
import {ConfigModule, ConfigService} from '@nestjs/config';

import {KubernetesService} from './services/kubernetes.service';
import {ClusterService} from './services/cluster.service';
import {Cluster, ClusterSchema} from './entitys/cluster';
import * as winston from 'winston';
import {utilities as nestWinstonModuleUtilities, WinstonModule} from 'nest-winston';
import {StatusHist, StatusHistSchema} from './entitys/status.hist';
import {MongooseModule} from "@nestjs/mongoose";
import {HealthModule} from "./health/health.module";


@Module({
  imports: [
    HealthModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `./config.${process.env.NODE_ENV}.env`,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const uri: string = `mongodb://${configService.get('MONGODB_USERNAME')}:${configService.get('MONGODB_PASSWORD')}@${configService.get('MONGODB_HOST')}:27017/${configService.get('MONGODB_DB')}`;
        return {
          uri,
          useNewUrlParser: true,
          useCreateIndex: true,
          useFindAndModify: false,
          useUnifiedTopology: false,
          reconnectTries: Number.MAX_VALUE, // Never stop trying to reconnect
          reconnectInterval: 1000, // Reconnect every 500ms
          bufferMaxEntries: 0,
          connectTimeoutMS: 20000,
          socketTimeoutMS: 45000,
          connectionFactory: (connection) => {
            connection.plugin(require('mongoose-timestamp'));
            return connection;
          }
        }
      },
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([{name: Cluster.name, schema: ClusterSchema},
      {name: StatusHist.name, schema: StatusHistSchema}]),
    WinstonModule.forRootAsync({
      useFactory: () => ({
        // options
        format: winston.format.combine(
          winston.format.timestamp(),
          nestWinstonModuleUtilities.format.nestLike(),
        ),
        transports: [
          new winston.transports.Console({ level: 'error' }),
          new winston.transports.Console({ level: 'debug' }),
        ],
        exceptionHandlers: [
          new winston.transports.Console({ level: 'error' }),
        ],
      }),
      inject: [],
    }),
  ],
  controllers: [ClusterController],
  providers: [KubernetesService, ClusterService],
})
export class ClusterModule {
}
