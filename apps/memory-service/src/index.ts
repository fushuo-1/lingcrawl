import { config } from "./config";

console.log(
  `memory-service starting on ${config.HOST}:${config.PORT}, data: ${config.DATA_DIR}`,
);
