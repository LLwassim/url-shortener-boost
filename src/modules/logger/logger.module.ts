import { Module, Global } from "@nestjs/common";
import { LoggerService } from "../../services/logger.service";

@Global()
@Module({
  providers: [LoggerService],
  exports: [LoggerService],
})
export class LoggerModule {}
