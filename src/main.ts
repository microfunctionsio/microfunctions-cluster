import {NestFactory} from '@nestjs/core';
import {ClusterModule} from './cluster.module';
import {ConfigService} from '@nestjs/config';
import {Transport} from '@nestjs/microservices';

async function bootstrap() {

  const microFunctionCLusterModule = await NestFactory.create(ClusterModule);
  const configService:ConfigService = microFunctionCLusterModule.get(ConfigService)
  const guestUrls = [`amqp://${configService.get('RABBIT_USER')}:${configService.get('RABBITMQ_PASSWORD')}@${configService.get('RABBIT_HOST')}:5672`];
  microFunctionCLusterModule.connectMicroservice({
    transport: Transport.RMQ,
    options: {
      urls: guestUrls,
      queue: 'microfunctions_cluster',
      queueOptions: {
        durable: true,
      },
    },
  });
  if(process.env.NODE_ENV !== 'local')
  {
    await microFunctionCLusterModule.listen(4000);
  }
  await microFunctionCLusterModule.startAllMicroservicesAsync();

}

bootstrap();
