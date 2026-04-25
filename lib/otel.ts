import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";

let sdk: NodeSDK | null = null;

export function startOtelSDK() {
  if (sdk) return;

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "oncall",
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? "0.1.0",
    }),
    traceExporter: new ConsoleSpanExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
      }),
    ],
  });

  sdk.start();
  console.log("[OTel] SDK started");

  process.on("SIGTERM", async () => {
    await sdk?.shutdown();
  });
}
