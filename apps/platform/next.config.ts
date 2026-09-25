import type { NextConfig } from "next";
import {readWorkingTreeProductRevision} from "./lib/runtime/product-revision";

const revision=readWorkingTreeProductRevision();
const nextConfig: NextConfig = {
  generateBuildId:async()=>revision,
  webpack(config,{webpack}) {
    config.plugins.push(new webpack.DefinePlugin({__JURO_COMPILED_PRODUCT_REVISION__:JSON.stringify(revision)}));
    return config;
  },
};

export default nextConfig;
