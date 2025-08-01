import { Global, Module } from "@nestjs/common";
import { KafkaService } from "../../services/kafka.service";
import { LoggerModule } from "../logger/logger.module";

@Global()
@Module({
  imports: [LoggerModule],
  providers: [KafkaService],
  exports: [KafkaService],
})
export class KafkaModule {}
