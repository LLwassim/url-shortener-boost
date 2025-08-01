import { NodeSDK } from "@opentelemetry/sdk-node";
// import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { JaegerExporter } from "@opentelemetry/exporter-jaeger";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

export function setupObservability() {
  if (!process.env.TRACING_ENABLED || process.env.TRACING_ENABLED === "false") {
    return;
  }

  const jaegerExporter = new JaegerExporter({
    endpoint:
      process.env.JAEGER_ENDPOINT || "http://localhost:14268/api/traces",
  });

  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]:
        process.env.APP_NAME || "url-shortener-boost",
      [SemanticResourceAttributes.SERVICE_VERSION]:
        process.env.npm_package_version || "1.0.0",
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
        process.env.NODE_ENV || "development",
    }),
    spanProcessor: new BatchSpanProcessor(jaegerExporter),
    instrumentations: [
      // Auto-instrumentations disabled for now
    ],
  });

  // Start the SDK
  sdk.start();

  console.log("🔍 OpenTelemetry tracing initialized");

  // Graceful shutdown
  process.on("SIGTERM", () => {
    sdk
      .shutdown()
      .then(() => console.log("🔍 OpenTelemetry terminated"))
      .catch((error) => console.log("Error terminating OpenTelemetry", error))
      .finally(() => process.exit(0));
  });
}
