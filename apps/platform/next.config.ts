import type { NextConfig } from "next";
import {readWorkingTreeProductRevision} from "./lib/runtime/product-revision";

const revision=readWorkingTreeProductRevision();
const nextConfig: NextConfig = {
  // Turbopack needs explicit polling for Windows Docker Desktop bind mounts.
  ...(process.env.LOCAL_WATCH_POLLING === "true" ? { watchOptions: { pollIntervalMs: 1000 } } : {}),
  generateBuildId:async()=>revision,
  webpack(config,{webpack}) {
    config.plugins.push(new webpack.DefinePlugin({__JURO_COMPILED_PRODUCT_REVISION__:JSON.stringify(revision)}));
    return config;
  },
};

export default nextConfig;
