import { createDefaultEsmPreset, type JestConfigWithTsJest } from "ts-jest";

const config: JestConfigWithTsJest = {
  ...createDefaultEsmPreset(),
  verbose: true,
  testPathIgnorePatterns: ["<rootDir>/dist/"],
  forceExit: true,
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};

export default config;
