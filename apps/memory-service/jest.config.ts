import { createDefaultEsmPreset, type JestConfigWithTsJest } from "ts-jest";

const config: JestConfigWithTsJest = {
  ...createDefaultEsmPreset(),
  verbose: true,
  testPathIgnorePatterns: ["<rootDir>/dist/"],
  forceExit: true,
};

export default config;
